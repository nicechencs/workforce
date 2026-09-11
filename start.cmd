@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js was not found. Install Node 22+ and retry.
  pause
  exit /b 1
)

node tooling\scripts\start-desktop.mjs %*
if errorlevel 1 (
  echo.
  echo Workforce failed to start.
  pause
  exit /b 1
)
