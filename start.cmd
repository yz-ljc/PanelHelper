@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22.13 or later is required. Visit https://nodejs.org/
  pause
  exit /b 1
)
node server/index.mjs --open
if errorlevel 1 pause
