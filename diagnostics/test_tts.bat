@echo off
cd /d "%~dp0.."
echo Testing TTS...
python -c "import edge_tts; print('[OK] edge-tts')"
python -c "import pygame; pygame.mixer.init(); print('[OK] pygame')"
python yoda_tts.py "Yoda voice test. If you hear this, TTS is working." "en-GB-RyanNeural"
pause
