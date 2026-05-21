@echo off
echo ================================
echo    YODA GITHUB SETUP
echo ================================
echo.

git --version >nul 2>&1
if %errorlevel% neq 0 (
    echo Git is not installed.
    echo Download from: https://git-scm.com/download/win
    start https://git-scm.com/download/win
    pause & exit /b 1
)
echo [OK] Git installed

cd /d "%~dp0.."

for /f "tokens=*" %%i in ('git config --global user.name 2^>nul') do set GIT_USER=%%i
if "%GIT_USER%"=="" (
    set /p GIT_USER=Your name for Git commits: 
    git config --global user.name "%GIT_USER%"
)
for /f "tokens=*" %%i in ('git config --global user.email 2^>nul') do set GIT_EMAIL=%%i
if "%GIT_EMAIL%"=="" (
    set /p GIT_EMAIL=Your email for Git commits: 
    git config --global user.email "%GIT_EMAIL%"
)
echo [OK] Git configured: %GIT_USER%

if not exist ".git" (
    echo Initializing repository...
    git init & git branch -M main
)

set /p REMOTE=GitHub repository URL (e.g. https://github.com/yodaaicreator/yoda.git): 
if not "%REMOTE%"=="" (
    git remote remove origin 2>nul
    git remote add origin %REMOTE%
    echo [OK] Remote: %REMOTE%
)

echo.
echo ================================
echo  Setup complete!
echo  Now open Yoda and go to Settings
echo  to enter your GitHub token.
echo ================================
pause
