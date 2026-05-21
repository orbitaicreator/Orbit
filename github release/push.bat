@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0.."
set TOKEN_FILE=%USERPROFILE%\.yoda_gh_token
if exist "!TOKEN_FILE!" (set /p GH_TOKEN=<"!TOKEN_FILE!") else (set /p GH_TOKEN=Paste GitHub token: & echo !GH_TOKEN!>"!TOKEN_FILE!")
set GH_TOKEN=!GH_TOKEN: =!
git config user.email "yoda@yoda.com" >nul 2>&1
git config user.name "Yoda" >nul 2>&1
git remote set-url origin https://!GH_TOKEN!@github.com/yodaaicreator/yoda.git
git add src/index.html src/main.js src/preload.js yoda_tts.py yoda_mic.py package.json .gitignore
git commit -m "update"
git push -u origin main --force
echo Pushed to github.com/yodaaicreator/yoda
pause
endlocal
