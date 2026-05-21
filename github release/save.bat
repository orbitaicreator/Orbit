@echo off
cd /d "%~dp0.."
if "%~1"=="" (set MSG=Update %date% %time%) else (set MSG=%~1)
git add -A
git commit -m "%MSG%"
echo Saved: %MSG%
pause
