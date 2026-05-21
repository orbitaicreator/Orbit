@echo off
cd /d "%~dp0.."
echo Installing voice packages...
python -m pip install edge-tts pygame --upgrade
python -c "import edge_tts; print('[OK] edge-tts works')"
echo Testing voice...
python yoda_tts.py "Voice test complete." "en-GB-RyanNeural"
pause
