@echo off
cd /d "%~dp0"
:: If this .bat lives in a subfolder (like launcher\), go up to the Orbit root
if not exist package.json cd ..
if not exist package.json cd /d "C:\Users\krist\Orbit"
title Orbit

if not exist node_modules (
    echo Installing dependencies...
    call npm install
)

npx electron .
pause
