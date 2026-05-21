@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0.."
node --version >nul 2>&1
if errorlevel 1 (echo Node.js not found. Run launcher\setup.bat & pause & exit /b 1)
if not exist node_modules (call npm install)
if exist "%APPDATA%\yoda" rmdir /s /q "%APPDATA%\yoda" >nul 2>&1
:: Backup only — do NOT bump version here (release.bat handles versioning)
set BDIR=%~dp0..\backups
if not exist "!BDIR!" mkdir "!BDIR!"
set NOW=%date:~-4%%date:~3,2%%date:~0,2%_%time:~0,2%%time:~3,2%%time:~6,2%
set NOW=%NOW: =0%
for /f "tokens=*" %%v in ('node -e "console.log(require('./package.json').version)"') do set VERSION=%%v
mkdir "!BDIR!\v!VERSION!_!NOW!\src" >nul 2>&1
copy "src\index.html" "!BDIR!\v!VERSION!_!NOW!\src\" >nul 2>&1
copy "src\main.js"    "!BDIR!\v!VERSION!_!NOW!\src\" >nul 2>&1
copy "src\preload.js" "!BDIR!\v!VERSION!_!NOW!\src\" >nul 2>&1
copy "package.json"   "!BDIR!\v!VERSION!_!NOW!\" >nul 2>&1
echo [OK] Backup saved ^(v!VERSION!^)
echo Starting Yoda...
call npm start
endlocal
