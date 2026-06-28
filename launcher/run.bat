@echo off
cd /d "%~dp0"
title Orbit

if not exist node_modules (
    echo Installing dependencies...
    call npm install
)

npx electron .
pause
