@echo off
cd /d "%~dp0"
title Orbit

:: ── Check Node.js ─────────────────────────────────────
where node >nul 2>&1
if errorlevel 1 (
    echo.
    echo  [ERROR] Node.js not found. Download from https://nodejs.org
    echo.
    pause & exit /b 1
)

:: ── Resolve electron path ──────────────────────────────
set ELECTRON=
if exist "node_modules\.bin\electron.cmd"          set ELECTRON=node_modules\.bin\electron.cmd
if "%ELECTRON%"=="" if exist "node_modules\electron\dist\electron.exe"  set ELECTRON=node_modules\electron\dist\electron.exe

:: ── Install / repair if electron not found ────────────
if "%ELECTRON%"=="" (
    echo.
    echo  Installing dependencies...
    echo.
    :: Force-reinstall to fix broken .bin links
    call npm install --prefer-offline 2>nul
    call npm install
    :: Re-check after install
    if exist "node_modules\.bin\electron.cmd"         set ELECTRON=node_modules\.bin\electron.cmd
    if "%ELECTRON%"=="" if exist "node_modules\electron\dist\electron.exe" set ELECTRON=node_modules\electron\dist\electron.exe
)

:: ── Still not found — hard fail ────────────────────────
if "%ELECTRON%"=="" (
    echo.
    echo  [ERROR] Electron not found after npm install.
    echo.
    echo  Try running these commands manually:
    echo    npm install
    echo    npm install electron --save-dev
    echo.
    pause & exit /b 1
)

:: ── Launch Orbit ───────────────────────────────────────
echo  Starting Orbit...
"%ELECTRON%" .
if errorlevel 1 (
    echo.
    echo  [ERROR] Orbit exited with an error.
    echo.
    pause
)
