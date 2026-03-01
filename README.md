# Storyboard Pro (MVP Scaffold)

This repository now contains the initial scaffold for a professional storyboard animation desktop app.

## Stack
- Tauri 2.x
- React + TypeScript + Vite
- Zustand state store

## Project Structure
- `src/` frontend editor shell and feature modules
- `src-tauri/` desktop runtime and native command bridge
- `docs/PRD-v1.md` product requirement document
- `docs/Architecture-v1.md` technical architecture plan

## Run (frontend only)
```bash
npm install
npm run dev
```

## Run (desktop)
```bash
# prerequisites: Rust toolchain + Tauri requirements
npm install
npm run tauri:dev
```

Mac direct entry:
- `start-storyboard-mac.command`

## Run (Windows Web Bridge)
This mode is for the workflow: develop on macOS, run on Windows through a local `.bat` that opens a browser UI.

Build on macOS:
```bash
npm install
npm run web:build
```

Then copy the whole project folder to Windows and start:
```bat
start-storyboard-windows.bat
```

Windows direct entry:
- `start-storyboard-windows.bat`

Or build a portable Windows release folder directly on macOS:
```bash
npm run web:build
npm run release:windows-web
```

Generated folder:
- `release/storyboard-pro-windows-web`

Requirements on Windows:
- Node.js 18+
- `ffmpeg` in `PATH` if you want export / video concat
- ComfyUI can be started separately by your own `.bat` / desktop launcher

Windows Web Bridge notes:
- Local bridge server: `scripts/windows-web-server.mjs`
- Default URL: `http://127.0.0.1:3210`
- Local data directory default: `%APPDATA%\\StoryboardProWeb`
- Supports workspace projects, export logs, open folder, local file preview, Comfy queue/history/view proxy, server log tail, file copy/write

## Current Status
- Editor shell layout in place (Shot list, Canvas panel, Asset panel, Timeline)
- Core storyboard data models and Zustand store implemented
- Canvas drawing prototype implemented (brush color/size, per-shot undo/redo)
- Timeline playback loop implemented (play/pause + scrubber + frame counter)
- Local autosave snapshot + restore on startup implemented
- Desktop persistence implemented via Tauri commands + SQLite (`project.db`, `project/sequences/shots`)
- Workspace project management implemented (create/list/switch `.sbproj` projects)
- Workspace project operations implemented (open by path, rename, delete)
- Export pipeline implemented:
  - MP4 via FFmpeg from rendered shot frames (with shot text overlay)
  - Optional audio mixing during MP4 export (when audio file exists)
  - Export parameter panel (width/height/fps/bitrate)
  - Export presets (1080p/720p/vertical) + save as project default
  - Export queue UI (progress + cancel + retry) and export history panel
  - Queue safeguards (active-job dedupe + capped queue length)
  - Queue pause/resume control
  - Temporary frame directory auto cleanup after export
  - Open exported output from queue/history entries
  - History filter (all/success/failed) + clear history
  - History pagination + pending job priority boost (Move to Top)
  - Queue persistence across app restarts + configurable auto retry attempts
  - Per-job detail panel with full export error message
  - Storyboard PDF template via jsPDF
  - Export run log written to `exports/export-log.jsonl`
- Tauri app skeleton and native health command created

## Next Implementation Targets
1. PixiJS canvas engine integration
2. True `.sbproj` file/folder picker and multi-project management
3. Timeline preview playback with audio sync
4. Command-based undo/redo history and migration framework
