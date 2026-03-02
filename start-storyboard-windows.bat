@echo off
setlocal EnableDelayedExpansion
cd /d %~dp0

set NO_PROXY=127.0.0.1,localhost
set no_proxy=127.0.0.1,localhost

call "%~dp0check-storyboard-windows-env.bat" --check-only
if errorlevel 1 (
  exit /b 1
)

if not exist logs mkdir logs
set LOG_FILE=%~dp0logs\windows-web-latest.log

echo [INFO] Starting Storyboard Pro Windows Web...
echo [INFO] Startup log: %LOG_FILE%
echo [%date% %time%] [INFO] Normal launch started > "%LOG_FILE%"

node scripts\windows-web-server.mjs --host 0.0.0.0 --open-host 127.0.0.1 --port 3210 --open >> "%LOG_FILE%" 2>&1

set EXIT_CODE=%ERRORLEVEL%
echo [%date% %time%] [INFO] Normal launch finished with code %EXIT_CODE% >> "%LOG_FILE%"

if not "%EXIT_CODE%"=="0" (
  echo [ERROR] Startup failed.
  echo [ERROR] Open the startup log for details:
  echo [ERROR] %LOG_FILE%
  echo [ERROR] Run check-storyboard-windows-env.bat first to inspect the environment.
  type "%LOG_FILE%"
  pause
  exit /b %EXIT_CODE%
)
