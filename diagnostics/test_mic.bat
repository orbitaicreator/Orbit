@echo off
cd /d "%~dp0.."
echo Testing mic for 10 seconds - say something...
python -c "
import vosk, sounddevice, json, queue, time, sys
vosk.SetLogLevel(-1)
try:
    model = vosk.Model('vosk-model-small-en-us')
    rec   = vosk.KaldiRecognizer(model, 16000)
    q     = queue.Queue()
    def cb(d,f,t,s): q.put(bytes(d))
    print('[OK] Mic listening for 10 seconds...')
    with sounddevice.RawInputStream(samplerate=16000,blocksize=8000,dtype='int16',channels=1,callback=cb):
        end=time.time()+10
        while time.time()<end:
            try:
                data=q.get(timeout=0.5)
                if rec.AcceptWaveform(data):
                    r=json.loads(rec.Result())
                    if r.get('text'): print('Heard:', r['text'])
            except: pass
    print('Done.')
except Exception as e:
    print('Error:', e)
"
pause
