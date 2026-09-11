@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js was not found. Install Node 22+ and retry.
  pause
  exit /b 1
)

echo Stopping any leftover Workforce dev processes...
node tooling\scripts\stop-desktop.mjs
if errorlevel 1 (
  echo.
  echo Some Workforce processes could not be stopped. Close them manually and retry.
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
