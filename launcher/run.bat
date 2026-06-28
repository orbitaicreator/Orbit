@echo off
cd /d "%~dp0"
title Orbit

:: Check Node/Electron
where npx >nul 2>&1
if errorlevel 1 (
    echo Node.js not found. Install from nodejs.org
    pause
    exit /b 1
)

:: Install if needed
if not exist node_modules (
    echo Installing dependencies...
    call npm install
)

:: Launch
start "" npx electron .
