@echo off
setlocal enabledelayedexpansion

:: Always run from Yoda root regardless of where you double-click from
cd /d "C:\Users\krist\Yoda"

title Yoda Update

echo.
echo  ====================================
echo    Yoda Update + Release
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
    if "!GH_TOKEN!"=="" (echo  No token - skipping release & goto :done)
    echo !GH_TOKEN!>"%USERPROFILE%\.yoda_gh_token"
)
echo  OK

:: Bump version
echo  [4/5] Releasing...

:: Bump MINOR version: 1.0.0 → 1.1.0 → 1.2.0 ... 1.10.0 → 1.11.0
echo const fs=require('fs'); > "%TEMP%\yoda_bump.js"
echo const p=JSON.parse(fs.readFileSync('C:\\Users\\krist\\Yoda\\package.json','utf8')); >> "%TEMP%\yoda_bump.js"
echo const a=p.version.split('.'); >> "%TEMP%\yoda_bump.js"
echo a[1]=String(parseInt(a[1])+1); >> "%TEMP%\yoda_bump.js"
echo a[2]='0'; >> "%TEMP%\yoda_bump.js"
echo p.version=a.join('.'); >> "%TEMP%\yoda_bump.js"
echo fs.writeFileSync('C:\\Users\\krist\\Yoda\\package.json',JSON.stringify(p,null,2)); >> "%TEMP%\yoda_bump.js"
echo process.stdout.write(p.version); >> "%TEMP%\yoda_bump.js"

for /f %%v in ('node "%TEMP%\yoda_bump.js"') do set NEW_VER=%%v
echo  Version: !NEW_VER!

:: Remove large/generated files from git tracking
git rm -r --cached installer/ >nul 2>&1
git rm -r --cached node_modules/ >nul 2>&1
git rm -r --cached dist/ >nul 2>&1
git rm -r --cached vosk-model-small-en-us/ >nul 2>&1
git rm -r --cached vosk-model-small-en-us-0.15/ >nul 2>&1

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


:: ── Generate AI release notes ──────────────────────────────────────────
echo  Generating release notes...

:: Get last 10 commits
for /f "tokens=*" %%c in ('git log -10 --oneline --no-merges 2^>nul') do (
  set COMMITS=!COMMITS! %%c
)

:: Write node script to call Claude API
echo const https=require('https'); > "%TEMP%\yoda_notes.js"
echo const commits=process.argv[1]||'general updates'; >> "%TEMP%\yoda_notes.js"
echo const apiKey=process.env.ANTHROPIC_API_KEY||''; >> "%TEMP%\yoda_notes.js"
echo if(!apiKey){process.stdout.write('General updates and improvements.');process.exit(0)} >> "%TEMP%\yoda_notes.js"
echo const body=JSON.stringify({model:'claude-haiku-4-5-20251001',max_tokens:200,messages:[{role:'user',content:'Write 2-3 bullet points summarizing these git commits as user-friendly release notes. Be brief and focus on what changed for the user. Commits: '+commits}]}); >> "%TEMP%\yoda_notes.js"
echo const req=https.request({hostname:'api.anthropic.com',path:'/v1/messages',method:'POST',headers:{'Content-Type':'application/json','anthropic-version':'2023-06-01','x-api-key':apiKey,'Content-Length':Buffer.byteLength(body)}},res=^>{let d='';res.on('data',c=^>d+=c);res.on('end',()=^>{try{const p=JSON.parse(d);process.stdout.write(p.content[0].text||'General updates.')}catch{process.stdout.write('General updates and improvements.')}})}); >> "%TEMP%\yoda_notes.js"
echo req.on('error',()=^>process.stdout.write('General updates and improvements.')); >> "%TEMP%\yoda_notes.js"
echo req.write(body);req.end(); >> "%TEMP%\yoda_notes.js"

for /f "tokens=*" %%n in ('node "%TEMP%\yoda_notes.js" "!COMMITS!" 2^>nul') do set RELEASE_NOTES=%%n
if "!RELEASE_NOTES!"=="" set RELEASE_NOTES=General updates and improvements.
echo  Notes: !RELEASE_NOTES!

:: Build
echo  [5/5] Building installer...
echo  (2-5 minutes)
echo.
set GH_TOKEN=!GH_TOKEN!
set RELEASE_NOTES=!RELEASE_NOTES!
set ELECTRON_BUILDER_CACHE=C:\Users\krist\AppData\Local\electron-builder\Cache
set ELECTRON_CACHE=C:\Users\krist\AppData\Local\electron\Cache
call npm run dist
if errorlevel 1 (echo  [ERROR] Build failed & pause & exit /b 1)

if exist installer rd /s /q installer >nul 2>&1

echo.
echo  ====================================
echo  Released v!NEW_VER! successfully
echo  github.com/yodaaicreator/yoda/releases
echo  ====================================
echo.

echo  Done. Run Yoda with run.bat

:done
