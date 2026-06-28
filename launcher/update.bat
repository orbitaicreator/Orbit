@echo off
setlocal enabledelayedexpansion

:: Always run from Orbit root regardless of where you double-click from
cd /d "C:\Users\krist\Orbit"

title Orbit Update

echo.
echo  ====================================
echo    Orbit Update + Release
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
if exist "%USERPROFILE%\.orbit_gh_token" (
    set /p GH_TOKEN=<"%USERPROFILE%\.orbit_gh_token"
)
if "!GH_TOKEN!"=="" (
    set /p GH_TOKEN="  Enter GitHub token (ghp_...): "
    if "!GH_TOKEN!"=="" (echo  No token - skipping release & goto :done)
    echo !GH_TOKEN!>"%USERPROFILE%\.orbit_gh_token"
)
echo  OK

:: Bump version
echo  [4/5] Releasing...

:: Bump MINOR version: 1.0.0 → 1.1.0 → 1.2.0 ... 1.10.0 → 1.11.0
echo const fs=require('fs'); > "%TEMP%\orbit_bump.js"
echo const p=JSON.parse(fs.readFileSync('C:\\Users\\krist\\Orbit\\package.json','utf8')); >> "%TEMP%\orbit_bump.js"
echo const a=p.version.split('.'); >> "%TEMP%\orbit_bump.js"
echo a[1]=String(parseInt(a[1])+1); >> "%TEMP%\orbit_bump.js"
echo a[2]='0'; >> "%TEMP%\orbit_bump.js"
echo p.version=a.join('.'); >> "%TEMP%\orbit_bump.js"
echo fs.writeFileSync('C:\\Users\\krist\\Orbit\\package.json',JSON.stringify(p,null,2)); >> "%TEMP%\orbit_bump.js"
echo process.stdout.write(p.version); >> "%TEMP%\orbit_bump.js"

for /f %%v in ('node "%TEMP%\orbit_bump.js"') do set NEW_VER=%%v
echo  Version: !NEW_VER!

:: Remove large/generated files from git tracking
git rm -r --cached installer/ >nul 2>&1
git rm -r --cached node_modules/ >nul 2>&1
git rm -r --cached dist/ >nul 2>&1
git rm -r --cached vosk-model-small-en-us/ >nul 2>&1
git rm -r --cached vosk-model-small-en-us-0.15/ >nul 2>&1

:: Git push
:: Store credentials so git never prompts
git config --global credential.helper store >nul 2>&1
echo https://orbitaicreator:!GH_TOKEN!@github.com > "%USERPROFILE%\.git-credentials" 2>nul
git remote set-url origin "https://github.com/orbitaicreator/Orbit.git" >nul 2>&1
git add -A
git commit -m "v!NEW_VER!" >nul 2>&1
git -c "http.extraheader=Authorization: token !GH_TOKEN!" push -u origin main
if errorlevel 1 (
    echo  [ERROR] Push failed - see error above
    pause & exit /b 1
)

:: Delete any existing draft release on GitHub with same tag
echo  Cleaning up any draft releases...
echo const https=require('https'); > "%TEMP%\orbit_del_draft.js"
echo const tok=process.argv[1]; >> "%TEMP%\orbit_del_draft.js"
echo function req(m,p,cb){const o={hostname:'api.github.com',path:p,method:m,headers:{'Authorization':'token '+tok,'User-Agent':'Orbit','Content-Type':'application/json'}};const r=https.request(o,res=>{let d='';res.on('data',c=>d+=c);res.on('end',()=>cb(null,d))});r.on('error',cb);r.end()} >> "%TEMP%\orbit_del_draft.js"
echo req('GET','/repos/orbitaicreator/orbit/releases',(e,d)=>{try{const rs=JSON.parse(d);const drafts=rs.filter(r=>r.draft||r.tag_name==='v'+process.argv[2]);drafts.forEach(r=>req('DELETE','/repos/orbitaicreator/orbit/releases/'+r.id,()=>{}))}catch{}}) >> "%TEMP%\orbit_del_draft.js"
node "%TEMP%\orbit_del_draft.js" "!GH_TOKEN!" "!NEW_VER!" >nul 2>&1
timeout /t 2 /nobreak >nul

:: Tag
git tag -d "v!NEW_VER!" >nul 2>&1
git -c "http.extraheader=Authorization: token !GH_TOKEN!" push origin ":refs/tags/v!NEW_VER!" >nul 2>&1
git tag -a "v!NEW_VER!" -m "Release v!NEW_VER!"
git -c "http.extraheader=Authorization: token !GH_TOKEN!" push origin "v!NEW_VER!" >nul 2>&1


:: ── Generate AI release notes ──────────────────────────────────────────
echo  Generating release notes...

:: Get last 10 commits
for /f "tokens=*" %%c in ('git log -10 --oneline --no-merges 2^>nul') do (
  set COMMITS=!COMMITS! %%c
)

:: Write node script to call Claude API
echo const https=require('https'); > "%TEMP%\orbit_notes.js"
echo const commits=process.argv[1]||'general updates'; >> "%TEMP%\orbit_notes.js"
echo const apiKey=process.env.ANTHROPIC_API_KEY||''; >> "%TEMP%\orbit_notes.js"
echo if(!apiKey){process.stdout.write('General updates and improvements.');process.exit(0)} >> "%TEMP%\orbit_notes.js"
echo const body=JSON.stringify({model:'claude-haiku-4-5-20251001',max_tokens:200,messages:[{role:'user',content:'Write 2-3 bullet points summarizing these git commits as user-friendly release notes. Be brief and focus on what changed for the user. Commits: '+commits}]}); >> "%TEMP%\orbit_notes.js"
echo const req=https.request({hostname:'api.anthropic.com',path:'/v1/messages',method:'POST',headers:{'Content-Type':'application/json','anthropic-version':'2023-06-01','x-api-key':apiKey,'Content-Length':Buffer.byteLength(body)}},res=^>{let d='';res.on('data',c=^>d+=c);res.on('end',()=^>{try{const p=JSON.parse(d);process.stdout.write(p.content[0].text||'General updates.')}catch{process.stdout.write('General updates and improvements.')}})}); >> "%TEMP%\orbit_notes.js"
echo req.on('error',()=^>process.stdout.write('General updates and improvements.')); >> "%TEMP%\orbit_notes.js"
echo req.write(body);req.end(); >> "%TEMP%\orbit_notes.js"

for /f "tokens=*" %%n in ('node "%TEMP%\orbit_notes.js" "!COMMITS!" 2^>nul') do set RELEASE_NOTES=%%n
if "!RELEASE_NOTES!"=="" set RELEASE_NOTES=General updates and improvements.
echo  Notes: !RELEASE_NOTES!

:: Generate manual upload script (fallback)
echo const https=require('https'),fs=require('fs'),path=require('path'); > "%TEMP%\orbit_upload.js"
echo const [tok,ver,notes]=process.argv.slice(1); >> "%TEMP%\orbit_upload.js"
echo const owner='orbitaicreator',repo='orbit'; >> "%TEMP%\orbit_upload.js"
echo function req(m,p,b,cb){const o={hostname:'api.github.com',path:p,method:m,headers:{'Authorization':'token '+tok,'User-Agent':'Orbit','Content-Type':'application/json','Accept':'application/vnd.github.v3+json'}};if(b)o.headers['Content-Length']=Buffer.byteLength(b);const r=https.request(o,res=>{let d='';res.on('data',c=>d+=c);res.on('end',()=>cb(null,res.statusCode,d))});r.on('error',e=>cb(e));if(b)r.write(b);r.end()} >> "%TEMP%\orbit_upload.js"
echo req('POST','/repos/'+owner+'/'+repo+'/releases',JSON.stringify({tag_name:'v'+ver,name:'v'+ver,body:notes||'General updates.',draft:false,prerelease:false}),(e,s,d)=>{if(e||s>=400){console.error('Release create failed:',s,d);process.exit(1)}const rel=JSON.parse(d);const up=rel.upload_url.replace('{?name,label}','');const ins=fs.readdirSync('installer').find(f=>f.endsWith('.exe')&&!f.includes('uninstall')&&!f.includes('blockmap'));if(!ins){console.log('No installer found');process.exit(0)}const data=fs.readFileSync('installer/'+ins);const uo=new URL(up+'?name='+ins);const ur=https.request({hostname:uo.hostname,path:uo.pathname+uo.search,method:'POST',headers:{'Authorization':'token '+tok,'User-Agent':'Orbit','Content-Type':'application/octet-stream','Content-Length':data.length,'Accept':'application/vnd.github.v3+json'}},res=>{let d2='';res.on('data',c=>d2+=c);res.on('end',()=>console.log('Uploaded:',res.statusCode))});ur.on('error',e=>console.error(e));ur.write(data);ur.end()}) >> "%TEMP%\orbit_upload.js"

:: Build
echo  [5/5] Building installer...
echo  (2-5 minutes)
echo.
:: Pass token directly to electron-builder via env
set GH_TOKEN=!GH_TOKEN!
set GITHUB_TOKEN=!GH_TOKEN!
set RELEASE_NOTES=!RELEASE_NOTES!
set ELECTRON_BUILDER_CACHE=C:\Users\krist\AppData\Local\electron-builder\Cache
set ELECTRON_CACHE=C:\Users\krist\AppData\Local\electron\Cache
:: Run with token explicitly in environment
cmd /c "set GH_TOKEN=!GH_TOKEN!&& set GITHUB_TOKEN=!GH_TOKEN!&& call npm run dist"
if errorlevel 1 (
    :: Fallback: build without publish, then upload manually
    echo  Build with publish failed, trying without publish...
    cmd /c "set GH_TOKEN=!GH_TOKEN!&& call npx electron-builder --win --x64 --publish never"
    if errorlevel 1 (echo  [ERROR] Build failed & pause & exit /b 1)
    echo  Built successfully. Uploading release manually...
    node "%TEMP%\orbit_upload.js" "!GH_TOKEN!" "!NEW_VER!" "!RELEASE_NOTES!"
)
if errorlevel 1 (echo  [ERROR] Build failed & pause & exit /b 1)

if exist installer rd /s /q installer >nul 2>&1

echo.
echo  ====================================
echo  Released v!NEW_VER! successfully
echo  github.com/orbitaicreator/orbit/releases
echo  ====================================
echo.

echo  Done. Run Orbit with run.bat

:done
