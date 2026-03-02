@echo off
setlocal
cd /d %~dp0

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

echo [INFO] Pulling latest source...
git pull --ff-only
if errorlevel 1 (
  echo [ERROR] git pull failed.
  pause
  exit /b 1
)

echo [INFO] Installing dependencies...
npm install
if errorlevel 1 (
  echo [ERROR] npm install failed.
  pause
  exit /b 1
)

if exist dist (
  echo [INFO] Removing previous dist bundle...
  rmdir /s /q dist
)

echo [INFO] Rebuilding frontend bundle...
npm run build
if errorlevel 1 (
  echo [ERROR] npm run build failed.
  pause
  exit /b 1
)

echo [INFO] Update complete.
echo [INFO] You can now run start-storyboard-windows.bat
pause
