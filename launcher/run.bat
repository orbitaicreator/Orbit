@echo off
title Orbit

:: Navigate to Orbit root (where package.json lives)
cd /d "%~dp0"
if not exist "package.json" cd ..
if not exist "package.json" (
    echo  [ERROR] Cannot find Orbit root. Move run.bat to the Orbit folder.
    pause & exit /b 1
)

:: Check Node.js
where node >nul 2>&1
if errorlevel 1 (
    echo  [ERROR] Node.js not found. Download from https://nodejs.org
    pause & exit /b 1
)

:: Install packages if missing
if not exist "node_modules\electron\package.json" (
    echo  Installing packages...
    call npm install
    if errorlevel 1 ( echo  [ERROR] npm install failed & pause & exit /b 1 )
)

:: Download Electron binary if missing
if not exist "node_modules\electron\dist\electron.exe" (
    echo  Downloading Electron binary...
    node node_modules\electron\install.js
)

:: Resolve launch path
set ELECTRON=
if exist "node_modules\electron\dist\electron.exe"  set ELECTRON=node_modules\electron\dist\electron.exe
if exist "node_modules\.bin\electron.cmd"            set ELECTRON=node_modules\.bin\electron.cmd

if "%ELECTRON%"=="" (
    echo.
    echo  [ERROR] Electron binary missing. Run in a terminal:
    echo    npm install --force
    echo.
    pause & exit /b 1
)

:: Launch Orbit
echo  Starting Orbit...
"%ELECTRON%" .
if errorlevel 1 (
    echo.
    echo  [ERROR] Orbit exited with an error.
    pause
)
