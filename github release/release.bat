@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0.."
title Release Yoda

echo.
echo  ========================================
echo   Yoda Release Tool
echo  ========================================
echo.

:: ── Load token ────────────────────────────────────────
set TOKEN_FILE=%USERPROFILE%\.yoda_gh_token
if exist "!TOKEN_FILE!" (
    set /p SAVED=<"!TOKEN_FILE!"
    set GH_TOKEN=!SAVED!
    echo [OK] Token loaded
) else (
    echo No token found.
    echo Get one at: github.com/settings/tokens
    echo Needs: repo, write:packages permissions
    echo.
    set /p GH_TOKEN=Paste GitHub token (ghp_...): 
    echo !GH_TOKEN!>"!TOKEN_FILE!"
    echo [OK] Token saved
)

:: Clean token (remove spaces and any prefix)
set GH_TOKEN=!GH_TOKEN: =!
if "!GH_TOKEN:~0,4!" neq "ghp_" (
    if "!GH_TOKEN:~0,6!" neq "github" (
        echo [!] Token looks wrong: !GH_TOKEN:~0,10!...
        echo     Delete saved token and try again:
        echo     del %USERPROFILE%\.yoda_gh_token
        pause & exit /b 1
    )
)
echo [OK] Token: !GH_TOKEN:~0,8!...

:: ── Bump version ──────────────────────────────────────
for /f "tokens=*" %%v in ('node -e "const p=require('./package.json');const pts=p.version.split('.');pts[2]=parseInt(pts[2]||0)+1;console.log(pts.join('.'))"') do set VERSION=%%v
node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json'));p.version='!VERSION!';fs.writeFileSync('package.json',JSON.stringify(p,null,2))"
echo [OK] Version: !VERSION!

:: ── Confirm ───────────────────────────────────────────
echo.
set /p CONFIRM=Release v!VERSION! to github.com/yodaaicreator/yoda/releases? (y/n): 
if /i "!CONFIRM!" neq "y" (echo Cancelled. & pause & exit /b 0)

:: ── Push code to GitHub ───────────────────────────────
echo.
echo Pushing code to GitHub...
git config user.email "yoda@yoda.com" >nul 2>&1
git config user.name "Yoda" >nul 2>&1
git remote set-url origin https://!GH_TOKEN!@github.com/yodaaicreator/yoda.git
git add -A
git commit -m "v!VERSION!"
git push origin main
if errorlevel 1 (
    echo [!] Git push failed. Check your token has 'repo' permission.
    pause & exit /b 1
)
echo [OK] Code pushed

:: ── Build and publish ─────────────────────────────────
echo.
echo Building installer...
if exist dist rmdir /s /q dist

set GH_TOKEN=!GH_TOKEN!
call npm run dist

if errorlevel 1 (
    echo.
    echo [!] Build/publish failed.
    echo.
    echo Common fixes:
    echo  1. Token needs 'repo' AND 'write:packages' permissions
    echo  2. Delete old token: del %USERPROFILE%\.yoda_gh_token
    echo  3. Generate new token at github.com/settings/tokens
    echo.
    pause & exit /b 1
)

:: ── Cleanup ───────────────────────────────────────────
if exist dist rmdir /s /q dist

echo.
echo  ========================================
echo   Released v!VERSION! successfully!
echo   View at:
echo   github.com/yodaaicreator/yoda/releases
echo  ========================================
echo.
pause
endlocal
