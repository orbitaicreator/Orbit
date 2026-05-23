"""Yoda Microphone - Vosk offline speech recognition"""
import sys, os, subprocess, time, json, queue, re

def ensure(pkg, pip_name=None):
    try: __import__(pkg)
    except ImportError:
        subprocess.check_call([sys.executable,"-m","pip","install",
                               pip_name or pkg,"--quiet"],
                              stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)

ensure("vosk"); ensure("sounddevice"); ensure("numpy")

WAKE_WORD  = (sys.argv[1] if len(sys.argv)>1 else "yoda").lower().strip()
SCRIPT_DIR = sys.argv[2] if len(sys.argv)>2 else os.path.dirname(os.path.abspath(__file__))

# All the ways Vosk mishears "yoda" — checked BEFORE normalization
WAKE_VARIANTS = {
    "yoda","yo da","yo-da","yoga","euler","order","loader",
    "yo dog","yo dawg","yodah","iota","joda","yotta","yoder",
    "yo duh","toda","coda","older","euler","iota","yoda yoda",
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
    # Strip wake word and all variants from command text
    for v in WAKE_VARIANTS:
        t = t.replace(v, "").strip()
    t = t.replace(WAKE_WORD, "").strip()
    # Apply general fixes
    for wrong, right in FIXES.items():
        if wrong in t:
            t = t.replace(wrong, right)
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
    sys.stdout.write("ERROR:Downloading voice model (~50MB)...\n")
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
    def cb(indata, frames, t, status): q.put(bytes(indata))
    with sd.RawInputStream(samplerate=16000, blocksize=4000, dtype="int16",
                           channels=1, device=None, latency="low", callback=cb):
        while True:
            try: data = q.get(timeout=1)
            except queue.Empty: continue
            if not rec.AcceptWaveform(data): continue
            result = json.loads(rec.Result())
            raw    = result.get("text","").strip()
            if not raw: continue
            sys.stderr.write(f"[Mic] raw={raw!r}\n")
            sys.stderr.flush()
            if not wake_active:
                if is_wake(raw):
                    wake_active = True
                    sys.stderr.write("[Mic] >>> WAKE DETECTED\n")
                    sys.stderr.flush()
                    sys.stdout.write("WAKE\n")
                    sys.stdout.flush()
            else:
                wake_active = False
                cmd = normalize(raw)
                if not cmd:
                    # Vosk sometimes gives empty after stripping wake word
                    # Stay in wake mode briefly to catch the command
                    wake_active = True
                    continue
                sys.stderr.write(f"[Mic] CMD={cmd!r}\n")
                sys.stderr.flush()
                sys.stdout.write(f"CMD:{cmd}\n")
                sys.stdout.flush()

if __name__ == "__main__":
    while True:
        try: run()
        except Exception as e:
            sys.stdout.write(f"ERROR:{e}\n")
            sys.stdout.flush()
        time.sleep(3)
        sys.stdout.write("READY\n")
        sys.stdout.flush()
