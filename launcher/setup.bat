@echo off
setlocal enabledelayedexpansion

:: Always run from Yoda root regardless of where you double-click from
cd /d "C:\Users\krist\Yoda"

title Yoda Release

echo.
echo  ====================================
echo    Yoda Setup + Release
echo  ====================================
echo.

:: Silence line ending warnings
git config core.autocrlf false >nul 2>&1
git config core.safecrlf false >nul 2>&1

:: Check requirements
node --version >nul 2>&1
if errorlevel 1 (echo [ERROR] Node.js not found - nodejs.org & pause & exit /b 1)
git --version >nul 2>&1
if errorlevel 1 (echo [ERROR] Git not found - git-scm.com & pause & exit /b 1)

:: npm packages
echo  [1/5] npm packages...
if not exist node_modules (
    call npm install --silent 2>nul || call npm install
)
echo  Done

:: Python packages
echo  [2/5] Python packages...
python -c "import vosk,sounddevice,pyautogui,PIL,pygame" >nul 2>&1
if errorlevel 1 (
    python -m pip install vosk sounddevice numpy pyautogui Pillow edge-tts pygame --quiet 2>nul
)
echo  Done

:: GitHub token
echo  [3/5] GitHub token...
set GH_TOKEN=
if exist "%USERPROFILE%\.yoda_gh_token" (
    set /p GH_TOKEN=<"%USERPROFILE%\.yoda_gh_token"
)
if "!GH_TOKEN!"=="" (
    set /p GH_TOKEN="  Enter GitHub token (ghp_...): "
    if "!GH_TOKEN!"=="" (echo  No token - skipping release & goto :run)
    echo !GH_TOKEN!>"%USERPROFILE%\.yoda_gh_token"
)
echo  OK

:: Bump version
echo  [4/5] Releasing...

:: Write a small helper script to bump version
echo const fs=require('fs'); > "%TEMP%\yoda_bump.js"
echo const p=JSON.parse(fs.readFileSync('C:\\Users\\krist\\Yoda\\package.json','utf8')); >> "%TEMP%\yoda_bump.js"
echo const a=p.version.split('.'); >> "%TEMP%\yoda_bump.js"
echo a[2]=String(parseInt(a[2])+1); >> "%TEMP%\yoda_bump.js"
echo p.version=a.join('.'); >> "%TEMP%\yoda_bump.js"
echo fs.writeFileSync('C:\\Users\\krist\\Yoda\\package.json',JSON.stringify(p,null,2)); >> "%TEMP%\yoda_bump.js"
echo process.stdout.write(p.version); >> "%TEMP%\yoda_bump.js"

for /f %%v in ('node "%TEMP%\yoda_bump.js"') do set NEW_VER=%%v
echo  Version: !NEW_VER!

:: Git push
git remote set-url origin "https://!GH_TOKEN!@github.com/yodaaicreator/yoda.git" >nul 2>&1
git add -A
git commit -m "v!NEW_VER!" >nul 2>&1
git push -u origin main
if errorlevel 1 (
    echo  [ERROR] Push failed - see error above
    pause & exit /b 1
)

:: Tag
git tag -d "v!NEW_VER!" >nul 2>&1
git push origin ":refs/tags/v!NEW_VER!" >nul 2>&1
git tag -a "v!NEW_VER!" -m "Release v!NEW_VER!"
git push origin "v!NEW_VER!" >nul 2>&1

:: Build
echo  [5/5] Building installer...
echo  (2-5 minutes)
echo.
set GH_TOKEN=!GH_TOKEN!
call npm run dist
if errorlevel 1 (echo  [ERROR] Build failed & pause & exit /b 1)

if exist installer rd /s /q installer >nul 2>&1

echo.
echo  ====================================
echo  Released v!NEW_VER! successfully
echo  github.com/yodaaicreator/yoda/releases
echo  ====================================
echo.

:run
echo  Starting Yoda...
start "" /b node_modules\.bin\electron.cmd .
timeout /t 2 /nobreak >nul
