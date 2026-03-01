@echo off
setlocal
cd /d %~dp0

set NO_PROXY=127.0.0.1,localhost
set no_proxy=127.0.0.1,localhost

call "%~dp0check-storyboard-windows-env.bat" --check-only
if errorlevel 1 (
  exit /b 1
)

echo [INFO] Starting Storyboard Pro Windows Web...
node scripts\windows-web-server.mjs --host 127.0.0.1 --port 3210 --open

if errorlevel 1 (
  echo [ERROR] Startup failed.
  echo [ERROR] Run check-storyboard-windows-env.bat first to inspect the environment.
  pause
  exit /b 1
)
