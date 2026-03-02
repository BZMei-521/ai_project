@echo off
setlocal EnableDelayedExpansion
cd /d %~dp0

set CHECK_ONLY=0
if /I "%~1"=="--check-only" set CHECK_ONLY=1

set HAS_ERROR=0

echo [INFO] Checking Storyboard Pro Windows Web environment...
echo [INFO] Project directory: %cd%

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js was not found. Install Node.js 18 or newer.
  set HAS_ERROR=1
) else (
  for /f "delims=" %%i in ('node -p "process.versions.node"') do set NODE_VERSION=%%i
  echo [INFO] Node.js version: !NODE_VERSION!
  node -e "const major=parseInt(process.versions.node.split('.')[0],10); process.exit(major>=18?0:1)" >nul 2>nul
  if errorlevel 1 (
    echo [ERROR] Node.js version is too old. Current: !NODE_VERSION!. Required: 18+.
    set HAS_ERROR=1
  )
)

if not exist dist\index.html (
  echo [ERROR] dist\index.html was not found.
  echo [ERROR] This folder is not a complete Windows Web release package.
  echo [ERROR] Copy the whole release\storyboard-pro-windows-web folder again.
  set HAS_ERROR=1
) else (
  echo [INFO] dist\index.html found
)

if not exist scripts\windows-web-server.mjs (
  echo [ERROR] scripts\windows-web-server.mjs was not found.
  echo [ERROR] The Windows package is incomplete.
  set HAS_ERROR=1
) else (
  echo [INFO] scripts\windows-web-server.mjs found
)

where ffmpeg >nul 2>nul
if errorlevel 1 (
  echo [WARN] ffmpeg was not found.
  echo [WARN] The UI can still start, but export, local video render, and audio mux will fail.
) else (
  set FFMPEG_LINE=
  for /f "delims=" %%i in ('ffmpeg -version ^| findstr /b /c:"ffmpeg version"') do (
    set FFMPEG_LINE=%%i
    echo [INFO] %%i
  )
)

where tailscale >nul 2>nul
if errorlevel 1 (
  echo [WARN] Tailscale was not found.
  echo [WARN] Install Tailscale if you want remote access or log sync across different networks.
  if not "%CHECK_ONLY%"=="1" (
    set TAILSCALE_INSTALLER=%TEMP%\tailscale-setup-latest.exe
    echo [INFO] Downloading Tailscale installer from the official stable URL...
    powershell -NoProfile -ExecutionPolicy Bypass -Command ^
      "$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -UseBasicParsing -Uri 'https://pkgs.tailscale.com/stable/tailscale-setup-latest.exe' -OutFile '%TEMP%\tailscale-setup-latest.exe'"
    if errorlevel 1 (
      echo [ERROR] Failed to download the Tailscale installer.
      echo [ERROR] Download it manually from https://tailscale.com/download/windows
      set HAS_ERROR=1
    ) else (
      echo [INFO] Tailscale installer downloaded to !TAILSCALE_INSTALLER!
      echo [INFO] Launching installer...
      start "" "!TAILSCALE_INSTALLER!"
      echo [INFO] Complete the installer, log in to Tailscale, then run this check again.
      set HAS_ERROR=1
    )
  )
) else (
  echo [INFO] Tailscale found
  set TAILSCALE_IPV4=
  for /f "delims=" %%i in ('tailscale ip -4 2^>nul') do (
    if not defined TAILSCALE_IPV4 set TAILSCALE_IPV4=%%i
  )
  if defined TAILSCALE_IPV4 (
    echo [INFO] Tailscale IPv4: !TAILSCALE_IPV4!
    echo [INFO] Remote health URL: http://!TAILSCALE_IPV4!:3210/api/health
    echo [INFO] Remote log URL: http://!TAILSCALE_IPV4!:3210/api/runtime-log/latest
  ) else (
    echo [WARN] Tailscale is installed but no IPv4 address was returned.
    echo [WARN] Make sure Tailscale is logged in and connected.
  )
)

set PORT_3210_PID=
for /f "tokens=5" %%i in ('netstat -ano ^| findstr /r /c:":3210 .*LISTENING"') do (
  if not defined PORT_3210_PID set PORT_3210_PID=%%i
)
if defined PORT_3210_PID (
  echo [WARN] Port 3210 is already in use. There may already be a running instance. PID: !PORT_3210_PID!
)

echo [INFO] ComfyUI is optional. Start it separately if you need AI image or video generation.

if "%CHECK_ONLY%"=="1" (
  echo.
  if "%HAS_ERROR%"=="1" (
    echo [RESULT] Environment check failed
    exit /b 1
  ) else (
    echo [RESULT] Environment check passed
    exit /b 0
  )
)

if "%HAS_ERROR%"=="1" (
  echo.
  echo [ERROR] Environment check failed. Startup aborted.
  pause
  exit /b 1
)

echo [INFO] Environment check passed
echo.
pause
exit /b 0
