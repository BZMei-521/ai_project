Storyboard Pro Windows Web Release

1. Install Node.js 18+
2. If you need video export, install ffmpeg and make sure ffmpeg.exe is in PATH
3. Install Tailscale if you need remote access or log sync across different networks
4. If you need AI generation, launch ComfyUI separately
5. After pulling new source changes, run update-storyboard-windows.bat to rebuild dist locally
6. Double-click check-storyboard-windows-env.bat if you want a preflight check
7. Double-click start-storyboard-windows.bat
8. If startup still fails, run start-storyboard-windows-debug.bat and inspect logs\windows-web-latest.log

Default URL: http://127.0.0.1:3210
Default data dir: %APPDATA%\StoryboardProWeb
Remote log URL: http://<tailscale-ip>:3210/api/runtime-log/latest

Mac helpers:
- copy-windows-runtime-log.command <tailscale-ip> 3210
- watch-windows-runtime-log.command <tailscale-ip> 3210
