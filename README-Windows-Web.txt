Storyboard Pro Windows Web Release

1. Install Node.js 18+
2. If you need video export, install ffmpeg and make sure ffmpeg.exe is in PATH
3. If Tailscale is missing, running check-storyboard-windows-env.bat will download the official installer
4. If you need AI generation, launch ComfyUI separately
5. Double-click start-storyboard-windows.bat for the full startup pipeline: git pull -> update/build -> env check -> start
6. Use start-storyboard-windows.bat --fast if you want to skip pull and rebuild
7. You can still run update-storyboard-windows.bat manually if you only want to rebuild dist
8. Double-click check-storyboard-windows-env.bat if you want a preflight check
9. Both start-storyboard-windows.bat and start-storyboard-windows-debug.bat write startup logs to logs\windows-web-latest.log
10. If port 3210 is already occupied, the startup scripts will stop the old PID automatically before relaunching
11. If startup still fails, run start-storyboard-windows-debug.bat and inspect logs\windows-web-latest.log

Default URL: http://127.0.0.1:3210
Default data dir: %APPDATA%\StoryboardProWeb
Remote log URL: http://<tailscale-ip>:3210/api/runtime-log/latest
Startup log URL: http://<tailscale-ip>:3210/api/startup-log/latest

Mac helpers:
- check-windows-remote-access.command <tailscale-ip> 3210
- copy-windows-runtime-log.command <tailscale-ip> 3210
- watch-windows-runtime-log.command <tailscale-ip> 3210
