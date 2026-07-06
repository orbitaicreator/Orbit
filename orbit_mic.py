"""Orbit Microphone - Vosk offline speech recognition"""
import sys, os, subprocess, time, json, queue, re

def ensure(pkg, pip_name=None):
    try: __import__(pkg)
    except ImportError:
        subprocess.check_call([sys.executable,"-m","pip","install",
                               pip_name or pkg,"--quiet"],
                              stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)

ensure("vosk"); ensure("sounddevice"); ensure("numpy")

WAKE_WORD  = (sys.argv[1] if len(sys.argv)>1 else "orbit").lower().strip()
SCRIPT_DIR = sys.argv[2] if len(sys.argv)>2 else os.path.dirname(os.path.abspath(__file__))

# All the ways Vosk mishears "orbit" — checked BEFORE normalization
WAKE_VARIANTS = {
    "orbit","yo da","yo-da","yoga","euler","order","loader",
    "yo dog","yo dawg","orbith","iota","joda","yotta","yoder",
    "yo duh","toda","coda","older","euler","iota","orbit orbit",
    "yo","yolda","joder","yona","yoba","yoka","yopa","yora",
}

# General mishear corrections — applied AFTER wake word check
FIXES = {
    "you tube":"youtube","u tube":"youtube",
    "tick tock":"tiktok","tik tok":"tiktok","disc cord":"discord",
    "disk cord":"discord","mine craft":"minecraft","note pad":"notepad",
    "spot if i":"spotify","spot ify":"spotify",
    "face book":"facebook","net flix":"netflix",
    "snap chat":"snapchat","vs code":"vscode",
    "file explorer":"explorer","task manager":"taskmgr",
    "snipping tool":"snippingtool","control panel":"control",
    "take a screen shot":"take a screenshot",
    "screen shot":"screenshot",
    "what time it is":"what time is it",
    "what is the time":"what time is it",
    "turn it up":"volume up","turn it down":"volume down",
    "be quiet":"stop talking","shut up":"stop talking",
    "say that again":"repeat that",
    "open up":"open",
    "set timer":"set a timer","set the timer":"set a timer",
    "lock my pc":"lock the pc","lock computer":"lock the pc",
    "vol up":"volume up","vol down":"volume down",
    "take note":"take a note","add note":"take a note",
    "to do":"todo","to-do":"todo",
    "weather today":"weather",
    "daily brief":"daily briefing",
}

def normalize(text):
    t = text.lower().strip()
    # FIX: old code did blind substring replaces of every wake variant
    # anywhere in the text, which corrupted commands:
    #   "open youtube" -> "open utube"   ("yo" stripped)
    #   "open folder"  -> "open f"       ("older" stripped)
    # Now we only strip wake word / variants from the START, whole-word.
    tokens = t.split()
    strip_words = set(WAKE_VARIANTS) | {WAKE_WORD}
    while tokens:
        # try two-word variants like "yo da" first
        if len(tokens) >= 2 and (tokens[0] + " " + tokens[1]) in strip_words:
            tokens = tokens[2:]
        elif tokens[0] in strip_words:
            tokens = tokens[1:]
        else:
            break
    t = " ".join(tokens)
    # Apply general fixes (word-boundary safe)
    for wrong, right in FIXES.items():
        t = re.sub(r"\b" + re.escape(wrong) + r"\b", right, t)
    return t.strip()

def is_wake(text):
    """Check if this is a wake word utterance"""
    tl = text.lower().strip()
    # Direct match
    if WAKE_WORD in tl:
        return True
    # Check all variant mishears
    for v in WAKE_VARIANTS:
        if tl == v or tl.startswith(v+" ") or (" "+v) in tl:
            return True
    return False

# UPGRADE: the tiny 50MB model misheard almost everything. The lgraph model
# (~128MB) is dramatically more accurate. We prefer it, auto-download it once,
# and keep the small model as an emergency fallback.
BIG_MODEL   = "vosk-model-en-us-0.22-lgraph"
SMALL_MODEL = "vosk-model-small-en-us"

def _dirs():
    return [SCRIPT_DIR,
            os.path.join(os.path.expanduser("~"), "Orbit"),
            os.getcwd()]



# ── Fuzzy command snapping ───────────────────────────────────────────────
# When Vosk mishears a known command ("diagnostic support" -> "diagnostics
# report"), snap it to the closest known phrase instead of passing garble on.
import difflib

KNOWN_COMMANDS = [
    "diagnostics report", "daily briefing", "system stats", "system report",
    "take a screenshot", "analyze my screen", "what time is it", "weather",
    "set a timer", "set a timer for five minutes", "set a timer for ten minutes",
    "start focus mode", "stop focus mode", "start pomodoro",
    "new conversation", "clear chat", "export chat", "open settings",
    "lock the pc", "go to sleep", "volume up", "volume down", "mute",
    "next track", "previous track", "pause music", "play music",
    "take a note", "show my notes", "add a task", "show my tasks",
    "whisper mode", "stop talking", "repeat that", "help",
    "open youtube", "open spotify", "open discord", "open chrome",
    "open explorer", "open notepad", "open vscode", "check internet",
    "battery status", "good morning", "good night", "who are you",
]

def snap_command(cmd):
    # exact or prefix hits pass straight through
    if cmd in KNOWN_COMMANDS: return cmd
    for k in KNOWN_COMMANDS:
        if cmd.startswith(k) or k.startswith(cmd): return cmd
    # dynamic commands keep their tail intact ("open ...", "set a timer for ...")
    first = cmd.split()[0] if cmd.split() else ""
    if first in ("open","play","search","google","type","write","say","remind"):
        return cmd
    m = difflib.get_close_matches(cmd, KNOWN_COMMANDS, n=1, cutoff=0.75)
    if m:
        sys.stderr.write(f"[Mic] snapped {cmd!r} -> {m[0]!r}\n")
        sys.stderr.flush()
        return m[0]
    return cmd

def find_model():
    for name in (BIG_MODEL, SMALL_MODEL):          # prefer the accurate one
        for d in _dirs():
            p = os.path.join(d, name)
            if os.path.exists(p): return p
    return os.path.join(SCRIPT_DIR, BIG_MODEL)      # will trigger download

def download_model(model_path):
    import urllib.request, zipfile
    name = os.path.basename(model_path)
    sys.stdout.write("ERROR:Downloading voice model %s (one-time, ~128MB)...\n" % name)
    sys.stdout.flush()
    url = "https://alphacephei.com/vosk/models/%s.zip" % (
        "vosk-model-en-us-0.22-lgraph" if name == BIG_MODEL else "vosk-model-small-en-us-0.15")
    zp = model_path + ".zip"
    try:
        urllib.request.urlretrieve(url, zp)
        with zipfile.ZipFile(zp, "r") as z: z.extractall(os.path.dirname(model_path))
        ext = os.path.join(os.path.dirname(model_path),
                           "vosk-model-en-us-0.22-lgraph" if name == BIG_MODEL else "vosk-model-small-en-us-0.15")
        if os.path.exists(ext) and not os.path.exists(model_path):
            os.rename(ext, model_path)
    finally:
        try: os.remove(zp)
        except OSError: pass

def run():
    import vosk, sounddevice as sd
    model_path = find_model()
    if not os.path.exists(model_path):
        download_model(model_path)
    vosk.SetLogLevel(-1)
    model = vosk.Model(model_path)
    rec   = vosk.KaldiRecognizer(model, 16000)
    try:
        dev = sd.query_devices(kind="input")
        sys.stderr.write(f"[Mic] Input: {dev['name']}\n")
        sys.stderr.flush()
    except: pass
    rec.SetWords(True)   # per-word confidence -> reject background mumble
    wake_active = False
    wake_time   = 0.0
    WAKE_WINDOW = 7.0    # seconds to say a command after the wake word
    # single filler words that are never a real command (ambient audio)
    JUNK = {"yeah","yes","no","it","what","ok","okay","oh","um","uh","the","a",
            "huh","hey","man","see","and","but","so","well","right","like","this","that"}

    def confidence(result):
        words = result.get("result") or []
        if not words: return 1.0
        return sum(w.get("conf", 1.0) for w in words) / len(words)

    sys.stdout.write("READY\n")
    sys.stdout.flush()
    q = queue.Queue()
    def cb(indata, frames, t, status): q.put(bytes(indata))
    with sd.RawInputStream(samplerate=16000, blocksize=4000, dtype="int16",
                           channels=1, device=None, latency="low", callback=cb):
        while True:
            try: data = q.get(timeout=1)
            except queue.Empty:
                if wake_active and time.time() - wake_time > WAKE_WINDOW:
                    wake_active = False
                    sys.stderr.write("[Mic] wake window expired\n"); sys.stderr.flush()
                continue
            if not rec.AcceptWaveform(data): continue
            result = json.loads(rec.Result())
            raw    = result.get("text","").strip()
            if not raw: continue
            conf = confidence(result)
            sys.stderr.write(f"[Mic] raw={raw!r} conf={conf:.2f}\n")
            sys.stderr.flush()
            if not wake_active:
                # require decent confidence for the wake word itself
                if conf >= 0.65 and is_wake(raw):
                    wake_active = True
                    wake_time   = time.time()
                    sys.stderr.write("[Mic] >>> WAKE DETECTED\n"); sys.stderr.flush()
                    sys.stdout.write("WAKE\n"); sys.stdout.flush()
                # wake word + command in one breath ("orbit diagnostics report")
                if wake_active:
                    inline = normalize(raw)
                    if inline and inline not in JUNK and len(inline) > 3:
                        cmd = snap_command(inline)
                        wake_active = False
                        sys.stderr.write(f"[Mic] CMD={cmd!r} (inline)\n"); sys.stderr.flush()
                        sys.stdout.write(f"CMD:{cmd}\n"); sys.stdout.flush()
            else:
                if time.time() - wake_time > WAKE_WINDOW:
                    wake_active = False
                    continue
                cmd = normalize(raw)
                # low-confidence garble or filler -> keep listening, don't consume the wake
                if not cmd or conf < 0.55 or (cmd in JUNK) or (len(cmd) <= 2):
                    sys.stderr.write(f"[Mic] ignored ({'junk' if cmd else 'empty'})\n")
                    sys.stderr.flush()
                    continue
                wake_active = False
                cmd = snap_command(cmd)
                sys.stderr.write(f"[Mic] CMD={cmd!r}\n"); sys.stderr.flush()
                sys.stdout.write(f"CMD:{cmd}\n"); sys.stdout.flush()

if __name__ == "__main__":
    while True:
        try: run()
        except Exception as e:
            sys.stdout.write(f"ERROR:{e}\n")
            sys.stdout.flush()
        time.sleep(3)
        sys.stdout.write("READY\n")
        sys.stdout.flush()
