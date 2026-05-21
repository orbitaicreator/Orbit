"""
Yoda Microphone - Vosk offline speech recognition
"""
import sys, os, subprocess, time, json, queue

def ensure(pkg, pip_name=None):
    try: __import__(pkg)
    except ImportError:
        subprocess.check_call([sys.executable,"-m","pip","install",
                               pip_name or pkg,"--quiet"],
                              stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)

ensure("vosk"); ensure("sounddevice"); ensure("numpy")

WAKE_WORD  = (sys.argv[1] if len(sys.argv)>1 else "yoda").lower().strip()
SCRIPT_DIR = sys.argv[2] if len(sys.argv)>2 else os.path.dirname(os.path.abspath(__file__))

# ── All the ways Vosk mishears "yoda" ────────────────────────────────────
WAKE_VARIANTS = {
    "yoda","yo da","yo-da","yoga","euler","order","loader","yo dog",
    "yo dawg","yodah","iota","joda","yotta","older","folder","yoder",
    "yo duh","yode","yoda","yo da","eoda","toda","coda",
}

# ── General mishear corrections ──────────────────────────────────────────
FIXES = {
    # Sites
    "you tube":"youtube","u tube":"youtube","tick tock":"tiktok",
    "tick tok":"tiktok","tik tok":"tiktok","face book":"facebook",
    "net flix":"netflix","you tube dot com":"youtube.com",
    "insta gram":"instagram","snap chat":"snapchat",
    # Apps
    "mine craft":"minecraft","note pad":"notepad",
    "spot if i":"spotify","spot ify":"spotify","spotif":"spotify",
    "disc cord":"discord","disk cord":"discord","the cord":"discord",
    "vs code":"vscode","visual studio code":"vscode","be scode":"vscode",
    "file explorer":"explorer","task manager":"taskmgr",
    "snipping tool":"snippingtool","control panel":"control",
    "steam":"steam","chrome":"chrome","firefox":"firefox",
    # Commands
    "take a screen shot":"take a screenshot",
    "take screenshot":"take a screenshot",
    "screen shot":"screenshot",
    "what time it is":"what time is it",
    "what is the time":"what time is it",
    "what is the weather":"weather",
    "how is the weather":"weather",
    "turn it up":"volume up","turn it down":"volume down",
    "be quiet":"stop talking","shut up":"stop talking",
    "say that again":"repeat that","what did you say":"repeat that",
    "open up":"open","lunch":"launch",
    "set timer":"set a timer","set the timer":"set a timer",
    "in five minutes":"in 5 minutes","in ten minutes":"in 10 minutes",
    "lock my pc":"lock the pc","lock computer":"lock the pc",
    "open browser":"open chrome","open internet":"open chrome",
    "play music":"media play","pause music":"media pause",
    "next song":"media next","previous song":"media previous",
    "vol up":"volume up","vol down":"volume down",
    "take note":"take a note","add note":"take a note",
    "to do":"todo","add to do":"add todo","to-do":"todo",
    "weather today":"weather","what weather":"weather",
    "daily brief":"daily briefing",
    "your dog":"","yo dog":"","yo dawg":"","yo da ":"",
}

def normalize(text):
    t = text.lower().strip()
    if t in FIXES:
        return FIXES[t]
    for wrong, right in FIXES.items():
        if wrong in t:
            t = t.replace(wrong, right)
    return t.strip()

def is_wake(text):
    """Check if text contains the wake word or a known variant"""
    tl = text.lower().strip()
    # Exact match
    if tl == WAKE_WORD:
        return True
    # Direct contains
    if WAKE_WORD in tl:
        return True
    # Check all variants
    for v in WAKE_VARIANTS:
        if v in tl or tl == v:
            return True
    # Check normalized version
    norm = normalize(tl)
    if WAKE_WORD in norm:
        return True
    return False

def find_model():
    candidates = [
        os.path.join(SCRIPT_DIR, "vosk-model-small-en-us"),
        os.path.join(os.path.expanduser("~"), "Yoda", "vosk-model-small-en-us"),
        os.path.join(os.getcwd(), "vosk-model-small-en-us"),
        r"C:\Users\krist\Yoda\vosk-model-small-en-us",
    ]
    for p in candidates:
        if os.path.exists(p): return p
    return candidates[0]

def download_model(model_path):
    sys.stdout.write("ERROR:Downloading voice model (~50MB, one time)...\n")
    sys.stdout.flush()
    import urllib.request, zipfile
    url = "https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip"
    zp  = model_path + ".zip"
    urllib.request.urlretrieve(url, zp)
    with zipfile.ZipFile(zp,"r") as z: z.extractall(os.path.dirname(model_path))
    ext = os.path.join(os.path.dirname(model_path),"vosk-model-small-en-us-0.15")
    if os.path.exists(ext): os.rename(ext, model_path)
    os.remove(zp)

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

    wake_active = False
    sys.stdout.write("READY\n")
    sys.stdout.flush()

    q = queue.Queue()
    def cb(indata, frames, time_info, status):
        q.put(bytes(indata))

    with sd.RawInputStream(samplerate=16000, blocksize=4000,
                           dtype="int16", channels=1,
                           device=None, latency="low", callback=cb):
        while True:
            try:
                data = q.get(timeout=1)
            except queue.Empty:
                continue

            if not rec.AcceptWaveform(data):
                continue

            result = json.loads(rec.Result())
            raw    = result.get("text","").strip()
            if not raw:
                continue

            text = normalize(raw)

            # Only log when something real is heard
            if raw:
                sys.stderr.write(f"[Mic] raw={raw!r} fixed={text!r}\n")
                sys.stderr.flush()

            if not wake_active:
                if is_wake(raw):  # check raw AND normalized
                    wake_active = True
                    sys.stderr.write("[Mic] WAKE DETECTED\n")
                    sys.stderr.flush()
                    sys.stdout.write("WAKE\n")
                    sys.stdout.flush()
            else:
                # Got command after wake
                # Strip all wake variants from the command text
                cmd = text
                for v in WAKE_VARIANTS:
                    cmd = cmd.replace(v, "").strip()
                cmd = cmd.replace(WAKE_WORD, "").strip()
                wake_active = False
                if cmd:
                    sys.stderr.write(f"[Mic] CMD: {cmd!r}\n")
                    sys.stderr.flush()
                    sys.stdout.write(f"CMD:{cmd}\n")
                    sys.stdout.flush()
                # If nothing left after stripping, stay in wake mode
                # (Vosk might split "yoda open spotify" into two results)
                else:
                    sys.stderr.write("[Mic] Empty cmd after wake strip — staying ready\n")
                    sys.stderr.flush()

if __name__ == "__main__":
    while True:
        try:
            run()
        except Exception as e:
            sys.stdout.write(f"ERROR:{e}\n")
            sys.stdout.flush()
            sys.stderr.write(f"[Mic] Crashed: {e}\n")
            sys.stderr.flush()
        time.sleep(3)
        sys.stdout.write("READY\n")
        sys.stdout.flush()
