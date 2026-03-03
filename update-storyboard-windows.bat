@echo off
setlocal
cd /d %~dp0

set SKIP_PULL=0
set NO_PAUSE=0

:parse_args
if "%~1"=="" goto args_done
if /I "%~1"=="--skip-pull" set SKIP_PULL=1
if /I "%~1"=="--no-pause" set NO_PAUSE=1
shift
goto parse_args

:args_done

echo [INFO] Updating Storyboard Pro Windows workspace...

where git >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Git is required but was not found in PATH.
  pause
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js is required but was not found in PATH.
  pause
  exit /b 1
)

if "%SKIP_PULL%"=="1" (
  echo [INFO] Skipping git pull as requested.
) else (
  echo [INFO] Pulling latest source...
  git pull --ff-only
  if errorlevel 1 (
    echo [ERROR] git pull failed.
    if not "%NO_PAUSE%"=="1" pause
    exit /b 1
  )
)

echo [INFO] Installing dependencies...
call npm install
if errorlevel 1 (
  echo [ERROR] npm install failed.
  if not "%NO_PAUSE%"=="1" pause
  exit /b 1
)

if exist dist (
  echo [INFO] Removing previous dist bundle...
  rmdir /s /q dist
)

echo [INFO] Rebuilding frontend bundle...
call npm run build
if errorlevel 1 (
  echo [ERROR] npm run build failed.
  if not "%NO_PAUSE%"=="1" pause
  exit /b 1
)

echo [INFO] Update complete.
echo [INFO] You can now run start-storyboard-windows.bat
if not "%NO_PAUSE%"=="1" pause
