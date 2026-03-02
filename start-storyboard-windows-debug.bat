@echo off
setlocal EnableDelayedExpansion
cd /d %~dp0

call "%~dp0check-storyboard-windows-env.bat" --check-only
if errorlevel 1 (
  echo.
  echo [ERROR] Environment check failed. Debug startup aborted.
  pause
  exit /b 1
)

if not exist logs mkdir logs
set LOG_FILE=%~dp0logs\windows-web-latest.log

echo [INFO] Starting Storyboard Pro Windows Web in debug mode...
echo [INFO] Log file: %LOG_FILE%
echo [INFO] URL: http://127.0.0.1:3210
echo [INFO] Remote bind: http://0.0.0.0:3210
echo [INFO] Press Ctrl+C to stop the service
echo. > "%LOG_FILE%"
echo [%date% %time%] [INFO] Debug launch started >> "%LOG_FILE%"

node scripts\windows-web-server.mjs --host 0.0.0.0 --open-host 127.0.0.1 --port 3210 --open >> "%LOG_FILE%" 2>&1

set EXIT_CODE=%ERRORLEVEL%
echo.
echo [%date% %time%] [INFO] Debug launch finished with code %EXIT_CODE% >> "%LOG_FILE%"

if not "%EXIT_CODE%"=="0" (
  echo [ERROR] Debug startup failed. Exit code: %EXIT_CODE%
  echo [ERROR] Open the log file for details:
  echo [ERROR] %LOG_FILE%
  type "%LOG_FILE%"
  pause
  exit /b %EXIT_CODE%
)

echo [INFO] Service stopped. Log saved at:
echo [INFO] %LOG_FILE%
pause
exit /b 0
