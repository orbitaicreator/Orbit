@echo off
cd /d "%~dp0"
if not exist node_modules (
    echo Installing packages first...
    call npm install --silent
)
node_modules\.bin\electron.cmd .
