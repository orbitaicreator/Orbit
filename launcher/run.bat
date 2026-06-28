@echo off
cd /d "%~dp0"
title Orbit

:: ── Check Node.js ─────────────────────────────────────
where node >nul 2>&1
if errorlevel 1 (
    echo  [ERROR] Node.js not found. Download from https://nodejs.org
    pause & exit /b 1
)

:: ── Install packages if missing ───────────────────────
if not exist "node_modules\electron\package.json" (
    echo  Installing packages...
    call npm install
    if errorlevel 1 ( echo  [ERROR] npm install failed & pause & exit /b 1 )
)

:: ── Download Electron binary if missing ───────────────
if not exist "node_modules\electron\dist\electron.exe" (
    echo  Downloading Electron binary...
    node node_modules\electron\install.js
    if errorlevel 1 (
        echo  Retrying with npm install...
        call npm install --force
        node node_modules\electron\install.js
    )
)

:: ── Resolve launch path ───────────────────────────────
set ELECTRON=
if exist "node_modules\electron\dist\electron.exe"  set ELECTRON=node_modules\electron\dist\electron.exe
if exist "node_modules\.bin\electron.cmd"            set ELECTRON=node_modules\.bin\electron.cmd

if "%ELECTRON%"=="" (
    echo.
    echo  [ERROR] Could not download Electron binary.
    echo  This usually means the GitHub download was blocked.
    echo.
    echo  Fix: open a terminal here and run:
    echo    set ELECTRON_GET_USE_PROXY=true
    echo    npm install --force
    echo.
    pause & exit /b 1
)

:: ── Launch Orbit ───────────────────────────────────────
echo  Starting Orbit...
"%ELECTRON%" .
if errorlevel 1 (
    echo.
    echo  [ERROR] Orbit exited with an error. Check the output above.
    echo.
    pause
)
