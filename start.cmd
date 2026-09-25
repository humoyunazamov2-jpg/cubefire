@echo off
rem Cubefire launcher: double-click to play on this computer.
setlocal
cd /d "%~dp0"
title Cubefire

rem Use the portable Node.js in .tools\node if it is there, otherwise one installed on the computer.
if exist ".tools\node\node.exe" set "PATH=%CD%\.tools\node;%PATH%"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found on this computer.
  echo Install the "LTS" version from https://nodejs.org and then double-click start.cmd again.
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo First start: downloading the parts the game is built from. This takes a minute...
  call npm install
  if errorlevel 1 (
    echo Downloading failed. Check the internet connection and try again.
    pause
    exit /b 1
  )
)

echo Building the game...
call npx vite build
if errorlevel 1 (
  echo Building the game failed. Please send a screenshot of this window.
  pause
  exit /b 1
)

echo.
echo Cubefire is running at http://127.0.0.1:5174/  (your browser opens it now)
echo Keep this window open while you play. Close it to stop the game.
echo.
call npx vite preview --host 127.0.0.1 --open
pause
