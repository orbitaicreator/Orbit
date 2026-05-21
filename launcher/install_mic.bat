@echo off
cd /d "%~dp0.."
echo Installing mic packages...
python -m pip install vosk sounddevice numpy --upgrade
python -c "import sounddevice; print('[OK] sounddevice works')"
pause
