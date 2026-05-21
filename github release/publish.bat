@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0.."
if "%~1"=="" (set MSG=Update %date% %time%) else (set MSG=%~1)

set TOKEN_FILE=%USERPROFILE%\.yoda_gh_token
if exist "!TOKEN_FILE!" (set /p GH_TOKEN=<"!TOKEN_FILE!") else (
    set /p GH_TOKEN=GitHub token: 
    echo !GH_TOKEN!>"!TOKEN_FILE!"
)
set GH_TOKEN=!GH_TOKEN: =!

git remote set-url origin https://!GH_TOKEN!@github.com/yodaaicreator/yoda.git >nul 2>&1
git add -A
git commit -m "%MSG%"
git push origin main

if %errorlevel% equ 0 (echo Published: %MSG%) else (echo Publish failed — check token)
pause
endlocal
