@echo off
cd /d "%~dp0"
title Orbit

:: ── Check Node.js ─────────────────────────────────────
where node >nul 2>&1
if errorlevel 1 (
    echo.
    echo  [ERROR] Node.js not found.
    echo  Download from https://nodejs.org
    echo.
    pause
    exit /b 1
)

:: ── Install dependencies if electron is missing ────────
if not exist "node_modules\.bin\electron.cmd" (
    echo.
    echo  Installing dependencies...
    echo.
    call npm install
    if errorlevel 1 (
        echo.
        echo  [ERROR] npm install failed. Check your internet connection.
        echo.
        pause
        exit /b 1
    )
)

:: ── Launch Orbit ───────────────────────────────────────
echo  Starting Orbit...
"node_modules\.bin\electron.cmd" .
if errorlevel 1 (
    echo.
    echo  [ERROR] Orbit crashed. See above for details.
    echo.
    pause
)
