#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use base64::Engine as _;
use image::GenericImageView;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::Manager;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ProjectPayload {
    id: String,
    name: String,
    fps: i64,
    width: i64,
    height: i64,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ShotPayload {
    id: String,
    sequence_id: String,
    order: i64,
    title: String,
    duration_frames: i64,
    dialogue: String,
    notes: String,
    tags: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ShotLayerPayload {
    id: String,
    shot_id: String,
    name: String,
    visible: bool,
    locked: bool,
    z_index: i64,
    bitmap_path: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AssetPayload {
    id: String,
    project_id: String,
    r#type: String,
    name: String,
    file_path: String,
    character_front_path: String,
    character_side_path: String,
    character_back_path: String,
    voice_profile: String,
    skybox_description: String,
    skybox_tags: Vec<String>,
    skybox_faces: HashMap<String, String>,
    skybox_update_events: Vec<serde_json::Value>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SequencePayload {
    id: String,
    project_id: String,
    name: String,
    order: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct CanvasToolPayload {
    brush_color: String,
    brush_size: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ExportSettingsPayload {
    width: i64,
    height: i64,
    fps: i64,
    video_bitrate_kbps: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct PointPayload {
    x: f64,
    y: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct StrokePayload {
    id: String,
    points: Vec<PointPayload>,
    color: String,
    size: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct CanvasHistoryPayload {
    past: Vec<Vec<StrokePayload>>,
    future: Vec<Vec<StrokePayload>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct StoryboardSnapshotPayload {
    project: ProjectPayload,
    sequences: Vec<SequencePayload>,
    shots: Vec<ShotPayload>,
    layers: Vec<ShotLayerPayload>,
    assets: Vec<AssetPayload>,
    audio_tracks: Vec<AudioTrackPayload>,
    selected_shot_id: String,
    active_layer_by_shot_id: HashMap<String, String>,
    canvas_tool: CanvasToolPayload,
    export_settings: ExportSettingsPayload,
    shot_strokes: HashMap<String, Vec<StrokePayload>>,
    shot_history: HashMap<String, CanvasHistoryPayload>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SaveResult {
    project_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceProjectEntry {
    name: String,
    path: String,
    is_current: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceSelectionResult {
    project_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenPathResult {
    opened_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FileWriteResult {
    file_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ThreeViewSplitResult {
    front_path: String,
    side_path: String,
    back_path: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DeleteGeneratedFileFamiliesResult {
    deleted_paths: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ComfyPingResult {
    ok: bool,
    status_code: Option<u16>,
    message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ComfyDiscoverResult {
    found: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ComfyLocalDirsResult {
    root_dir: String,
    input_dir: String,
    output_dir: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PluginInstallFailure {
    repo: String,
    error: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PluginInstallResult {
    installed: Vec<String>,
    skipped: Vec<String>,
    failed: Vec<PluginInstallFailure>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ComfyModelCheckItem {
    key: String,
    label: String,
    path: String,
    exists: bool,
    file_count: usize,
    required: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ComfyModelHealthResult {
    checks: Vec<ComfyModelCheckItem>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportResult {
    output_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
enum LocalVideoMode {
    SingleFrame,
    FirstLastFrame,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct FramePayload {
    png_base64: String,
    duration_frames: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AudioTrackPayload {
    id: String,
    project_id: String,
    file_path: String,
    start_frame: i64,
    gain: f64,
    #[serde(default = "default_audio_track_kind")]
    kind: String,
    #[serde(default)]
    label: String,
}

fn default_audio_track_kind() -> String {
    "manual".to_string()
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ExportLogEntry {
    timestamp: u64,
    kind: String,
    status: String,
    message: String,
    output_path: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectFile {
    schema_version: i64,
    project_id: String,
    name: String,
    fps: i64,
    resolution: Resolution,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct Resolution {
    width: i64,
    height: i64,
}

fn workspace_root_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|err| format!("Unable to resolve app data dir: {err}"))?;
    fs::create_dir_all(&root).map_err(|err| format!("Unable to create workspace dir: {err}"))?;
    Ok(root)
}

fn current_project_marker_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(workspace_root_dir(app)?.join("current-project.txt"))
}

fn set_current_project_path(app: &tauri::AppHandle, path: &Path) -> Result<(), String> {
    let marker = current_project_marker_path(app)?;
    fs::write(&marker, path.to_string_lossy().to_string())
        .map_err(|err| format!("Unable to write current project marker: {err}"))
}

fn fallback_project_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let workspace = workspace_root_dir(app)?;
    Ok(workspace.join("default.sbproj"))
}

fn resolve_current_project_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let marker = current_project_marker_path(app)?;
    if marker.exists() {
        let raw = fs::read_to_string(&marker)
            .map_err(|err| format!("Unable to read current project marker: {err}"))?;
        let selected = PathBuf::from(raw.trim());
        if selected.exists() {
            return Ok(selected);
        }
    }

    let fallback = fallback_project_dir(app)?;
    fs::create_dir_all(&fallback)
        .map_err(|err| format!("Unable to create fallback project dir: {err}"))?;
    set_current_project_path(app, &fallback)?;
    Ok(fallback)
}

fn db_path(project_dir: &Path) -> PathBuf {
    project_dir.join("project.db")
}

fn exports_dir(project_dir: &Path) -> Result<PathBuf, String> {
    let export_dir = project_dir.join("exports");
    fs::create_dir_all(&export_dir)
        .map_err(|err| format!("Unable to create exports directory: {err}"))?;
    Ok(export_dir)
}

fn export_file_path(project_dir: &Path, extension: &str) -> Result<PathBuf, String> {
    let export_dir = exports_dir(project_dir)?;
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|err| format!("Unable to create timestamp: {err}"))?
        .as_secs();
    Ok(export_dir.join(format!("animatic-{timestamp}.{extension}")))
}

fn frame_dir(project_dir: &Path) -> Result<PathBuf, String> {
    let export_dir = exports_dir(project_dir)?;
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|err| format!("Unable to create timestamp: {err}"))?
        .as_secs();
    let dir = export_dir.join(format!("frames-{timestamp}"));
    fs::create_dir_all(&dir).map_err(|err| format!("Unable to create frame dir: {err}"))?;
    Ok(dir)
}

fn append_export_log(project_dir: &Path, entry: &ExportLogEntry) -> Result<(), String> {
    let log_path = exports_dir(project_dir)?.join("export-log.jsonl");
    let line = serde_json::to_string(entry)
        .map_err(|err| format!("Failed to serialize export log: {err}"))?;

    let mut existing = if log_path.exists() {
        fs::read_to_string(&log_path).map_err(|err| format!("Failed to read export log: {err}"))?
    } else {
        String::new()
    };
    existing.push_str(&line);
    existing.push('\n');
    fs::write(log_path, existing).map_err(|err| format!("Failed to write export log: {err}"))
}

fn now_timestamp() -> Result<u64, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .map_err(|err| format!("Unable to create timestamp: {err}"))
}

#[tauri::command]
fn list_export_logs(
    app: tauri::AppHandle,
    limit: Option<usize>,
) -> Result<Vec<ExportLogEntry>, String> {
    let project_dir = resolve_current_project_dir(&app)?;
    let log_path = exports_dir(&project_dir)?.join("export-log.jsonl");
    if !log_path.exists() {
        return Ok(Vec::new());
    }

    let content = fs::read_to_string(&log_path)
        .map_err(|err| format!("Failed to read export log file: {err}"))?;
    let mut entries = Vec::new();
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Ok(entry) = serde_json::from_str::<ExportLogEntry>(trimmed) {
            entries.push(entry);
        }
    }

    entries.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    let safe_limit = limit.unwrap_or(30);
    entries.truncate(safe_limit);
    Ok(entries)
}

#[tauri::command]
fn clear_export_logs(app: tauri::AppHandle) -> Result<(), String> {
    let project_dir = resolve_current_project_dir(&app)?;
    let log_path = exports_dir(&project_dir)?.join("export-log.jsonl");
    if log_path.exists() {
        fs::remove_file(&log_path).map_err(|err| format!("Failed to clear export logs: {err}"))?;
    }
    Ok(())
}

#[tauri::command]
fn open_path_in_os(path: String) -> Result<OpenPathResult, String> {
    let target = PathBuf::from(path.clone());
    if !target.exists() {
        return Err("Path does not exist".to_string());
    }

    #[cfg(target_os = "macos")]
    let mut command = {
        let mut c = Command::new("open");
        c.arg(&path);
        c
    };

    #[cfg(target_os = "windows")]
    let mut command = {
        let mut c = Command::new("explorer");
        c.arg(&path);
        c
    };

    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = {
        let mut c = Command::new("xdg-open");
        c.arg(&path);
        c
    };

    let status = command
        .status()
        .map_err(|err| format!("Failed to open path in OS: {err}"))?;
    if !status.success() {
        return Err(format!(
            "Open path command failed with status {:?}",
            status.code()
        ));
    }

    Ok(OpenPathResult { opened_path: path })
}

#[tauri::command]
fn find_missing_paths(paths: Vec<String>) -> Result<Vec<String>, String> {
    let mut missing = Vec::new();
    for path in paths {
        if path.trim().is_empty() {
            continue;
        }
        let p = PathBuf::from(&path);
        if !p.exists() {
            missing.push(path);
        }
    }
    Ok(missing)
}

fn initialize_db(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS projects (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                fps INTEGER NOT NULL,
                width INTEGER NOT NULL,
                height INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS shots (
                id TEXT PRIMARY KEY,
                sequence_id TEXT NOT NULL,
                shot_order INTEGER NOT NULL,
                title TEXT NOT NULL,
                duration_frames INTEGER NOT NULL,
                dialogue TEXT NOT NULL,
                notes TEXT NOT NULL,
                tags_json TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS sequences (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                name TEXT NOT NULL,
                sequence_order INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS shot_layers (
                id TEXT PRIMARY KEY,
                shot_id TEXT NOT NULL,
                name TEXT NOT NULL,
                visible INTEGER NOT NULL,
                locked INTEGER NOT NULL,
                z_index INTEGER NOT NULL,
                bitmap_path TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS assets (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                type TEXT NOT NULL,
                name TEXT NOT NULL,
                file_path TEXT NOT NULL,
                character_front_path TEXT NOT NULL DEFAULT '',
                character_side_path TEXT NOT NULL DEFAULT '',
                character_back_path TEXT NOT NULL DEFAULT '',
                voice_profile TEXT NOT NULL DEFAULT '',
                skybox_description TEXT NOT NULL DEFAULT '',
                skybox_tags_json TEXT NOT NULL DEFAULT '[]',
                skybox_faces_json TEXT NOT NULL DEFAULT '{}',
                skybox_update_events_json TEXT NOT NULL DEFAULT '[]'
            );

            CREATE TABLE IF NOT EXISTS audio_tracks (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                file_path TEXT NOT NULL,
                start_frame INTEGER NOT NULL,
                gain REAL NOT NULL,
                kind TEXT NOT NULL DEFAULT 'manual',
                label TEXT NOT NULL DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS snapshot_meta (
                id INTEGER PRIMARY KEY CHECK(id = 1),
                selected_shot_id TEXT NOT NULL,
                active_layer_by_shot_json TEXT NOT NULL DEFAULT '{}',
                canvas_tool_json TEXT NOT NULL,
                export_settings_json TEXT NOT NULL,
                shot_strokes_json TEXT NOT NULL,
                shot_history_json TEXT NOT NULL
            );
            "#,
        )
        .map_err(|err| format!("Failed to initialize database: {err}"))
}

fn ensure_snapshot_meta_export_settings_column(connection: &Connection) -> Result<(), String> {
    let mut statement = connection
        .prepare("PRAGMA table_info(snapshot_meta)")
        .map_err(|err| format!("Failed to inspect snapshot_meta schema: {err}"))?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|err| format!("Failed to read snapshot_meta schema rows: {err}"))?;

    let mut has_export_settings = false;
    let mut has_active_layer_map = false;
    for column_name in rows {
        let name = column_name.map_err(|err| format!("Failed to decode schema row: {err}"))?;
        if name == "export_settings_json" {
            has_export_settings = true;
        }
        if name == "active_layer_by_shot_json" {
            has_active_layer_map = true;
        }
    }

    if !has_export_settings {
        connection
            .execute(
                "ALTER TABLE snapshot_meta ADD COLUMN export_settings_json TEXT NOT NULL DEFAULT '{\"width\":1920,\"height\":1080,\"fps\":24,\"videoBitrateKbps\":8000}'",
                [],
            )
            .map_err(|err| format!("Failed to add export_settings_json column: {err}"))?;
    }

    if !has_active_layer_map {
        connection
            .execute(
                "ALTER TABLE snapshot_meta ADD COLUMN active_layer_by_shot_json TEXT NOT NULL DEFAULT '{}'",
                [],
            )
            .map_err(|err| format!("Failed to add active_layer_by_shot_json column: {err}"))?;
    }

    Ok(())
}

fn ensure_assets_voice_profile_column(connection: &Connection) -> Result<(), String> {
    let mut statement = connection
        .prepare("PRAGMA table_info(assets)")
        .map_err(|err| format!("Failed to inspect assets schema: {err}"))?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|err| format!("Failed to read assets schema rows: {err}"))?;

    let mut has_voice_profile = false;
    for column_name in rows {
        let name = column_name.map_err(|err| format!("Failed to decode assets schema row: {err}"))?;
        if name == "voice_profile" {
            has_voice_profile = true;
        }
    }

    if !has_voice_profile {
        connection
            .execute(
                "ALTER TABLE assets ADD COLUMN voice_profile TEXT NOT NULL DEFAULT ''",
                [],
            )
            .map_err(|err| format!("Failed to add voice_profile column: {err}"))?;
    }

    Ok(())
}

fn ensure_audio_track_metadata_columns(connection: &Connection) -> Result<(), String> {
    let mut statement = connection
        .prepare("PRAGMA table_info(audio_tracks)")
        .map_err(|err| format!("Failed to inspect audio_tracks schema: {err}"))?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|err| format!("Failed to read audio_tracks schema rows: {err}"))?;

    let mut has_kind = false;
    let mut has_label = false;
    for column_name in rows {
        let name = column_name.map_err(|err| format!("Failed to decode audio_tracks schema row: {err}"))?;
        if name == "kind" {
            has_kind = true;
        }
        if name == "label" {
            has_label = true;
        }
    }

    if !has_kind {
        connection
            .execute(
                "ALTER TABLE audio_tracks ADD COLUMN kind TEXT NOT NULL DEFAULT 'manual'",
                [],
            )
            .map_err(|err| format!("Failed to add kind column: {err}"))?;
    }

    if !has_label {
        connection
            .execute(
                "ALTER TABLE audio_tracks ADD COLUMN label TEXT NOT NULL DEFAULT ''",
                [],
            )
            .map_err(|err| format!("Failed to add label column: {err}"))?;
    }

    Ok(())
}

fn save_project_json(project_dir: &Path, project: &ProjectPayload) -> Result<(), String> {
    let project_file = ProjectFile {
        schema_version: 1,
        project_id: project.id.clone(),
        name: project.name.clone(),
        fps: project.fps,
        resolution: Resolution {
            width: project.width,
            height: project.height,
        },
        created_at: project.created_at.clone(),
        updated_at: project.updated_at.clone(),
    };

    let serialized = serde_json::to_string_pretty(&project_file)
        .map_err(|err| format!("Failed to serialize project.json: {err}"))?;

    fs::write(project_dir.join("project.json"), serialized)
        .map_err(|err| format!("Failed to write project.json: {err}"))
}

#[tauri::command]
fn save_current_project(
    app: tauri::AppHandle,
    snapshot: StoryboardSnapshotPayload,
) -> Result<SaveResult, String> {
    let project_dir = resolve_current_project_dir(&app)?;
    let database_path = db_path(&project_dir);

    let mut connection =
        Connection::open(database_path).map_err(|err| format!("Unable to open database: {err}"))?;
    initialize_db(&connection)?;
    ensure_snapshot_meta_export_settings_column(&connection)?;
    ensure_assets_voice_profile_column(&connection)?;
    ensure_audio_track_metadata_columns(&connection)?;

    let transaction = connection
        .transaction()
        .map_err(|err| format!("Unable to start transaction: {err}"))?;

    transaction
        .execute("DELETE FROM projects", [])
        .map_err(|err| format!("Unable to clear projects table: {err}"))?;
    transaction
        .execute("DELETE FROM shots", [])
        .map_err(|err| format!("Unable to clear shots table: {err}"))?;
    transaction
        .execute("DELETE FROM sequences", [])
        .map_err(|err| format!("Unable to clear sequences table: {err}"))?;
    transaction
        .execute("DELETE FROM shot_layers", [])
        .map_err(|err| format!("Unable to clear shot layers table: {err}"))?;
    transaction
        .execute("DELETE FROM assets", [])
        .map_err(|err| format!("Unable to clear assets table: {err}"))?;
    transaction
        .execute("DELETE FROM audio_tracks", [])
        .map_err(|err| format!("Unable to clear audio tracks table: {err}"))?;

    transaction
        .execute(
            "INSERT INTO projects (id, name, fps, width, height, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                &snapshot.project.id,
                &snapshot.project.name,
                snapshot.project.fps,
                snapshot.project.width,
                snapshot.project.height,
                &snapshot.project.created_at,
                &snapshot.project.updated_at
            ],
        )
        .map_err(|err| format!("Unable to write project row: {err}"))?;

    for shot in &snapshot.shots {
        let tags_json = serde_json::to_string(&shot.tags)
            .map_err(|err| format!("Unable to serialize shot tags: {err}"))?;

        transaction
            .execute(
                "INSERT INTO shots (id, sequence_id, shot_order, title, duration_frames, dialogue, notes, tags_json) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    &shot.id,
                    &shot.sequence_id,
                    shot.order,
                    &shot.title,
                    shot.duration_frames,
                    &shot.dialogue,
                    &shot.notes,
                    tags_json
                ],
            )
            .map_err(|err| format!("Unable to write shot row: {err}"))?;
    }

    for sequence in &snapshot.sequences {
        transaction
            .execute(
                "INSERT INTO sequences (id, project_id, name, sequence_order) VALUES (?1, ?2, ?3, ?4)",
                params![
                    &sequence.id,
                    &sequence.project_id,
                    &sequence.name,
                    sequence.order
                ],
            )
            .map_err(|err| format!("Unable to write sequence row: {err}"))?;
    }

    for layer in &snapshot.layers {
        transaction
            .execute(
                "INSERT INTO shot_layers (id, shot_id, name, visible, locked, z_index, bitmap_path) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    &layer.id,
                    &layer.shot_id,
                    &layer.name,
                    if layer.visible { 1 } else { 0 },
                    if layer.locked { 1 } else { 0 },
                    layer.z_index,
                    &layer.bitmap_path
                ],
            )
            .map_err(|err| format!("Unable to write shot layer row: {err}"))?;
    }

    for asset in &snapshot.assets {
        let skybox_tags_json = serde_json::to_string(&asset.skybox_tags)
            .map_err(|err| format!("Unable to serialize skybox tags: {err}"))?;
        let skybox_faces_json = serde_json::to_string(&asset.skybox_faces)
            .map_err(|err| format!("Unable to serialize skybox faces: {err}"))?;
        let skybox_update_events_json = serde_json::to_string(&asset.skybox_update_events)
            .map_err(|err| format!("Unable to serialize skybox update events: {err}"))?;

        transaction
            .execute(
                "INSERT INTO assets (id, project_id, type, name, file_path, character_front_path, character_side_path, character_back_path, voice_profile, skybox_description, skybox_tags_json, skybox_faces_json, skybox_update_events_json)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
                params![
                    &asset.id,
                    &asset.project_id,
                    &asset.r#type,
                    &asset.name,
                    &asset.file_path,
                    &asset.character_front_path,
                    &asset.character_side_path,
                    &asset.character_back_path,
                    &asset.voice_profile,
                    &asset.skybox_description,
                    skybox_tags_json,
                    skybox_faces_json,
                    skybox_update_events_json
                ],
            )
            .map_err(|err| format!("Unable to write asset row: {err}"))?;
    }

    for audio in &snapshot.audio_tracks {
        transaction
            .execute(
                "INSERT INTO audio_tracks (id, project_id, file_path, start_frame, gain, kind, label) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    &audio.id,
                    &audio.project_id,
                    &audio.file_path,
                    audio.start_frame,
                    audio.gain,
                    &audio.kind,
                    &audio.label
                ],
            )
            .map_err(|err| format!("Unable to write audio track row: {err}"))?;
    }

    let canvas_tool_json = serde_json::to_string(&snapshot.canvas_tool)
        .map_err(|err| format!("Unable to serialize canvas tool: {err}"))?;
    let active_layer_by_shot_json = serde_json::to_string(&snapshot.active_layer_by_shot_id)
        .map_err(|err| format!("Unable to serialize active layer map: {err}"))?;
    let export_settings_json = serde_json::to_string(&snapshot.export_settings)
        .map_err(|err| format!("Unable to serialize export settings: {err}"))?;
    let shot_strokes_json = serde_json::to_string(&snapshot.shot_strokes)
        .map_err(|err| format!("Unable to serialize shot strokes: {err}"))?;
    let shot_history_json = serde_json::to_string(&snapshot.shot_history)
        .map_err(|err| format!("Unable to serialize shot history: {err}"))?;

    transaction
        .execute(
            "INSERT INTO snapshot_meta (id, selected_shot_id, active_layer_by_shot_json, canvas_tool_json, export_settings_json, shot_strokes_json, shot_history_json) VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(id) DO UPDATE SET
               selected_shot_id=excluded.selected_shot_id,
               active_layer_by_shot_json=excluded.active_layer_by_shot_json,
               canvas_tool_json=excluded.canvas_tool_json,
               export_settings_json=excluded.export_settings_json,
               shot_strokes_json=excluded.shot_strokes_json,
               shot_history_json=excluded.shot_history_json",
            params![
                &snapshot.selected_shot_id,
                active_layer_by_shot_json,
                canvas_tool_json,
                export_settings_json,
                shot_strokes_json,
                shot_history_json
            ],
        )
        .map_err(|err| format!("Unable to write snapshot meta: {err}"))?;

    transaction
        .commit()
        .map_err(|err| format!("Unable to commit transaction: {err}"))?;

    save_project_json(&project_dir, &snapshot.project)?;

    Ok(SaveResult {
        project_path: project_dir.to_string_lossy().to_string(),
    })
}

#[tauri::command]
fn load_current_project(
    app: tauri::AppHandle,
) -> Result<Option<StoryboardSnapshotPayload>, String> {
    let project_dir = resolve_current_project_dir(&app)?;
    let database_path = db_path(&project_dir);

    if !database_path.exists() {
        return Ok(None);
    }

    let connection =
        Connection::open(database_path).map_err(|err| format!("Unable to open database: {err}"))?;
    initialize_db(&connection)?;
    ensure_snapshot_meta_export_settings_column(&connection)?;
    ensure_assets_voice_profile_column(&connection)?;
    ensure_audio_track_metadata_columns(&connection)?;

    let project = connection
        .query_row(
            "SELECT id, name, fps, width, height, created_at, updated_at FROM projects LIMIT 1",
            [],
            |row| {
                Ok(ProjectPayload {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    fps: row.get(2)?,
                    width: row.get(3)?,
                    height: row.get(4)?,
                    created_at: row.get(5)?,
                    updated_at: row.get(6)?,
                })
            },
        )
        .optional()
        .map_err(|err| format!("Unable to read project row: {err}"))?;

    let Some(project) = project else {
        return Ok(None);
    };

    let mut shots_statement = connection
        .prepare(
            "SELECT id, sequence_id, shot_order, title, duration_frames, dialogue, notes, tags_json
             FROM shots
             ORDER BY shot_order ASC",
        )
        .map_err(|err| format!("Unable to prepare shots query: {err}"))?;

    let shots_iter = shots_statement
        .query_map([], |row| {
            let tags_json: String = row.get(7)?;
            let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();

            Ok(ShotPayload {
                id: row.get(0)?,
                sequence_id: row.get(1)?,
                order: row.get(2)?,
                title: row.get(3)?,
                duration_frames: row.get(4)?,
                dialogue: row.get(5)?,
                notes: row.get(6)?,
                tags,
            })
        })
        .map_err(|err| format!("Unable to query shots: {err}"))?;

    let mut shots = Vec::new();
    for shot_result in shots_iter {
        shots.push(shot_result.map_err(|err| format!("Unable to decode shot row: {err}"))?);
    }

    let mut sequence_statement = connection
        .prepare(
            "SELECT id, project_id, name, sequence_order
             FROM sequences
             ORDER BY sequence_order ASC",
        )
        .map_err(|err| format!("Unable to prepare sequence query: {err}"))?;

    let sequence_iter = sequence_statement
        .query_map([], |row| {
            Ok(SequencePayload {
                id: row.get(0)?,
                project_id: row.get(1)?,
                name: row.get(2)?,
                order: row.get(3)?,
            })
        })
        .map_err(|err| format!("Unable to query sequences: {err}"))?;

    let mut sequences = Vec::new();
    for sequence_result in sequence_iter {
        sequences
            .push(sequence_result.map_err(|err| format!("Unable to decode sequence row: {err}"))?);
    }

    let mut audio_statement = connection
        .prepare(
            "SELECT id, project_id, file_path, start_frame, gain, kind, label
             FROM audio_tracks
             ORDER BY rowid ASC",
        )
        .map_err(|err| format!("Unable to prepare audio query: {err}"))?;

    let audio_iter = audio_statement
        .query_map([], |row| {
            Ok(AudioTrackPayload {
                id: row.get(0)?,
                project_id: row.get(1)?,
                file_path: row.get(2)?,
                start_frame: row.get(3)?,
                gain: row.get(4)?,
                kind: row.get(5)?,
                label: row.get(6)?,
            })
        })
        .map_err(|err| format!("Unable to query audio tracks: {err}"))?;

    let mut audio_tracks = Vec::new();
    for audio_result in audio_iter {
        audio_tracks
            .push(audio_result.map_err(|err| format!("Unable to decode audio row: {err}"))?);
    }

    let mut layer_statement = connection
        .prepare(
            "SELECT id, shot_id, name, visible, locked, z_index, bitmap_path
             FROM shot_layers
             ORDER BY z_index ASC",
        )
        .map_err(|err| format!("Unable to prepare shot layer query: {err}"))?;

    let layer_iter = layer_statement
        .query_map([], |row| {
            Ok(ShotLayerPayload {
                id: row.get(0)?,
                shot_id: row.get(1)?,
                name: row.get(2)?,
                visible: row.get::<_, i64>(3)? != 0,
                locked: row.get::<_, i64>(4)? != 0,
                z_index: row.get(5)?,
                bitmap_path: row.get(6)?,
            })
        })
        .map_err(|err| format!("Unable to query shot layers: {err}"))?;

    let mut layers = Vec::new();
    for layer_result in layer_iter {
        layers.push(layer_result.map_err(|err| format!("Unable to decode layer row: {err}"))?);
    }

    let mut asset_statement = connection
        .prepare(
            "SELECT id, project_id, type, name, file_path, character_front_path, character_side_path, character_back_path, voice_profile, skybox_description, skybox_tags_json, skybox_faces_json, skybox_update_events_json
             FROM assets
             ORDER BY rowid ASC",
        )
        .map_err(|err| format!("Unable to prepare asset query: {err}"))?;
    let asset_iter = asset_statement
        .query_map([], |row| {
            let skybox_tags_json: String = row.get(10)?;
            let skybox_faces_json: String = row.get(11)?;
            let skybox_update_events_json: String = row.get(12)?;
            let skybox_tags: Vec<String> =
                serde_json::from_str(&skybox_tags_json).unwrap_or_default();
            let skybox_faces: HashMap<String, String> =
                serde_json::from_str(&skybox_faces_json).unwrap_or_default();
            let skybox_update_events: Vec<serde_json::Value> =
                serde_json::from_str(&skybox_update_events_json).unwrap_or_default();
            Ok(AssetPayload {
                id: row.get(0)?,
                project_id: row.get(1)?,
                r#type: row.get(2)?,
                name: row.get(3)?,
                file_path: row.get(4)?,
                character_front_path: row.get(5)?,
                character_side_path: row.get(6)?,
                character_back_path: row.get(7)?,
                voice_profile: row.get(8)?,
                skybox_description: row.get(9)?,
                skybox_tags,
                skybox_faces,
                skybox_update_events,
            })
        })
        .map_err(|err| format!("Unable to query assets: {err}"))?;
    let mut assets = Vec::new();
    for asset_result in asset_iter {
        assets.push(asset_result.map_err(|err| format!("Unable to decode asset row: {err}"))?);
    }

    let meta = connection
        .query_row(
            "SELECT selected_shot_id, active_layer_by_shot_json, canvas_tool_json, export_settings_json, shot_strokes_json, shot_history_json FROM snapshot_meta WHERE id = 1",
            [],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                ))
            },
        )
        .optional()
        .map_err(|err| format!("Unable to read snapshot meta: {err}"))?;

    let Some((
        selected_shot_id,
        active_layer_by_shot_json,
        canvas_tool_json,
        export_settings_json,
        shot_strokes_json,
        shot_history_json,
    )) = meta
    else {
        return Ok(None);
    };

    let active_layer_by_shot_id: HashMap<String, String> =
        serde_json::from_str(&active_layer_by_shot_json)
            .map_err(|err| format!("Unable to decode active layer map: {err}"))?;
    let canvas_tool: CanvasToolPayload = serde_json::from_str(&canvas_tool_json)
        .map_err(|err| format!("Unable to decode canvas tool: {err}"))?;
    let export_settings: ExportSettingsPayload = serde_json::from_str(&export_settings_json)
        .map_err(|err| format!("Unable to decode export settings: {err}"))?;
    let shot_strokes: HashMap<String, Vec<StrokePayload>> =
        serde_json::from_str(&shot_strokes_json)
            .map_err(|err| format!("Unable to decode shot strokes: {err}"))?;
    let shot_history: HashMap<String, CanvasHistoryPayload> =
        serde_json::from_str(&shot_history_json)
            .map_err(|err| format!("Unable to decode shot history: {err}"))?;

    Ok(Some(StoryboardSnapshotPayload {
        project,
        sequences,
        shots,
        layers,
        assets,
        audio_tracks,
        selected_shot_id,
        active_layer_by_shot_id,
        canvas_tool,
        export_settings,
        shot_strokes,
        shot_history,
    }))
}

fn slugify_project_name(name: &str) -> String {
    let mut out = String::new();
    for ch in name.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
        } else if (ch.is_ascii_whitespace() || ch == '-' || ch == '_') && !out.ends_with('-') {
            out.push('-');
        }
    }
    let trimmed = out.trim_matches('-');
    if trimmed.is_empty() {
        "project".to_string()
    } else {
        trimmed.to_string()
    }
}

fn is_sbproj_dir(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext == "sbproj")
        .unwrap_or(false)
}

#[tauri::command]
fn list_workspace_projects(app: tauri::AppHandle) -> Result<Vec<WorkspaceProjectEntry>, String> {
    let workspace = workspace_root_dir(&app)?;
    let current = resolve_current_project_dir(&app)?;
    let mut entries = Vec::new();

    for item in
        fs::read_dir(&workspace).map_err(|err| format!("Unable to read workspace: {err}"))?
    {
        let entry = item.map_err(|err| format!("Unable to read workspace entry: {err}"))?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        if !is_sbproj_dir(&path) {
            continue;
        }

        let name = path
            .file_stem()
            .and_then(|n| n.to_str())
            .unwrap_or("project")
            .to_string();

        entries.push(WorkspaceProjectEntry {
            name,
            path: path.to_string_lossy().to_string(),
            is_current: path == current,
        });
    }

    entries.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(entries)
}

#[tauri::command]
fn create_workspace_project(
    app: tauri::AppHandle,
    name: String,
) -> Result<WorkspaceSelectionResult, String> {
    let workspace = workspace_root_dir(&app)?;
    let slug = slugify_project_name(&name);
    let project_dir = workspace.join(format!("{slug}.sbproj"));
    fs::create_dir_all(&project_dir)
        .map_err(|err| format!("Unable to create project dir: {err}"))?;
    set_current_project_path(&app, &project_dir)?;

    Ok(WorkspaceSelectionResult {
        project_path: project_dir.to_string_lossy().to_string(),
    })
}

#[tauri::command]
fn select_workspace_project(
    app: tauri::AppHandle,
    project_path: String,
) -> Result<WorkspaceSelectionResult, String> {
    let path = PathBuf::from(project_path);
    if !path.exists() {
        return Err("Selected project path does not exist".to_string());
    }
    if !path.is_dir() {
        return Err("Selected project path is not a directory".to_string());
    }
    if !is_sbproj_dir(&path) {
        return Err("Selected project path must end with .sbproj".to_string());
    }
    set_current_project_path(&app, &path)?;
    Ok(WorkspaceSelectionResult {
        project_path: path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
fn rename_workspace_project(
    app: tauri::AppHandle,
    project_path: String,
    new_name: String,
) -> Result<WorkspaceSelectionResult, String> {
    let old_path = PathBuf::from(project_path);
    if !old_path.exists() || !old_path.is_dir() || !is_sbproj_dir(&old_path) {
        return Err("Project path is invalid".to_string());
    }

    let workspace = workspace_root_dir(&app)?;
    let new_slug = slugify_project_name(&new_name);
    let new_path = workspace.join(format!("{new_slug}.sbproj"));
    if new_path.exists() && new_path != old_path {
        return Err("A project with the same name already exists".to_string());
    }

    fs::rename(&old_path, &new_path).map_err(|err| format!("Unable to rename project: {err}"))?;

    let current = resolve_current_project_dir(&app)?;
    if current == old_path {
        set_current_project_path(&app, &new_path)?;
    }

    Ok(WorkspaceSelectionResult {
        project_path: new_path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
fn delete_workspace_project(
    app: tauri::AppHandle,
    project_path: String,
) -> Result<Vec<WorkspaceProjectEntry>, String> {
    let path = PathBuf::from(project_path);
    if !path.exists() || !path.is_dir() || !is_sbproj_dir(&path) {
        return Err("Project path is invalid".to_string());
    }

    fs::remove_dir_all(&path).map_err(|err| format!("Unable to delete project: {err}"))?;

    let projects = list_workspace_projects(app.clone())?;
    if projects.is_empty() {
        let fallback = fallback_project_dir(&app)?;
        fs::create_dir_all(&fallback)
            .map_err(|err| format!("Unable to recreate fallback project: {err}"))?;
        set_current_project_path(&app, &fallback)?;
    } else {
        let current_exists = projects.iter().any(|item| item.is_current);
        if !current_exists {
            set_current_project_path(&app, Path::new(&projects[0].path))?;
        }
    }

    list_workspace_projects(app)
}

#[tauri::command]
fn export_animatic(
    app: tauri::AppHandle,
    width: Option<i64>,
    height: Option<i64>,
    fps: Option<i64>,
    duration_seconds: Option<i64>,
) -> Result<ExportResult, String> {
    let project_dir = resolve_current_project_dir(&app)?;
    let output_path = export_file_path(&project_dir, "mp4")?;

    let output_status = Command::new("ffmpeg")
        .args([
            "-y",
            "-f",
            "lavfi",
            "-i",
            &format!(
                "color=c=black:s={}x{}:r={}:d={}",
                width.unwrap_or(1920),
                height.unwrap_or(1080),
                fps.unwrap_or(24),
                duration_seconds.unwrap_or(3)
            ),
            "-pix_fmt",
            "yuv420p",
            output_path.to_string_lossy().as_ref(),
        ])
        .status()
        .map_err(|err| format!("Unable to execute ffmpeg. Make sure ffmpeg is installed. {err}"))?;

    if !output_status.success() {
        let _ = append_export_log(
            &project_dir,
            &ExportLogEntry {
                timestamp: now_timestamp().unwrap_or(0),
                kind: "placeholder-video".to_string(),
                status: "failed".to_string(),
                message: format!(
                    "FFmpeg export failed with status {:?}",
                    output_status.code()
                ),
                output_path: None,
            },
        );
        return Err(format!(
            "FFmpeg export failed with status code {:?}",
            output_status.code()
        ));
    }

    let _ = append_export_log(
        &project_dir,
        &ExportLogEntry {
            timestamp: now_timestamp().unwrap_or(0),
            kind: "placeholder-video".to_string(),
            status: "success".to_string(),
            message: "Placeholder animatic exported".to_string(),
            output_path: Some(output_path.to_string_lossy().to_string()),
        },
    );

    Ok(ExportResult {
        output_path: output_path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
fn export_animatic_from_frames(
    app: tauri::AppHandle,
    fps: i64,
    video_bitrate_kbps: Option<i64>,
    frames: Vec<FramePayload>,
    audio_tracks: Vec<AudioTrackPayload>,
) -> Result<ExportResult, String> {
    if frames.is_empty() {
        return Err("No frames provided for export".to_string());
    }

    let safe_fps = fps.max(1);
    let safe_bitrate_kbps = video_bitrate_kbps.unwrap_or(8000).max(500);
    let project_dir = resolve_current_project_dir(&app)?;
    let output_path = export_file_path(&project_dir, "mp4")?;
    let frame_output_dir = frame_dir(&project_dir)?;
    let result = (|| -> Result<ExportResult, String> {
        let mut concat_text = String::new();
        let mut last_frame_path: Option<PathBuf> = None;

        for (index, frame) in frames.iter().enumerate() {
            let frame_path = frame_output_dir.join(format!("frame-{index:04}.png"));
            let frame_bytes = base64::engine::general_purpose::STANDARD
                .decode(&frame.png_base64)
                .map_err(|err| format!("Failed to decode frame image: {err}"))?;

            fs::write(&frame_path, frame_bytes)
                .map_err(|err| format!("Failed to write frame image: {err}"))?;

            let duration_seconds = (frame.duration_frames.max(1) as f64) / (safe_fps as f64);
            concat_text.push_str(&format!(
                "file '{}'\nduration {:.6}\n",
                frame_path.to_string_lossy().replace('\'', "'\\''"),
                duration_seconds
            ));

            last_frame_path = Some(frame_path);
        }

        if let Some(last) = &last_frame_path {
            concat_text.push_str(&format!(
                "file '{}'\n",
                last.to_string_lossy().replace('\'', "'\\''")
            ));
        }

        let concat_file_path = frame_output_dir.join("concat.txt");
        fs::write(&concat_file_path, concat_text)
            .map_err(|err| format!("Failed to write concat file: {err}"))?;

        let mut ffmpeg = Command::new("ffmpeg");
        ffmpeg
            .arg("-y")
            .arg("-f")
            .arg("concat")
            .arg("-safe")
            .arg("0")
            .arg("-i")
            .arg(concat_file_path.to_string_lossy().as_ref());

        let mut valid_audio = Vec::new();
        let mut next_input_index = 1_i64;
        for track in &audio_tracks {
            let audio_path = PathBuf::from(&track.file_path);
            if !audio_path.exists() {
                continue;
            }
            ffmpeg.arg("-i").arg(&track.file_path);
            valid_audio.push((
                next_input_index,
                track.start_frame.max(0),
                track.gain.max(0.0),
            ));
            next_input_index += 1;
        }

        let audio_message = if valid_audio.is_empty() {
            "No audio track".to_string()
        } else {
            let mut parts = Vec::new();
            for (idx, (input_index, start_frame, gain)) in valid_audio.iter().enumerate() {
                let delay_ms = ((*start_frame as f64) / (safe_fps as f64) * 1000.0).round() as i64;
                parts.push(format!(
                    "[{}:a]adelay={}|{},volume={:.3}[a{}]",
                    input_index, delay_ms, delay_ms, gain, idx
                ));
            }
            let mixed_inputs = (0..valid_audio.len())
                .map(|idx| format!("[a{}]", idx))
                .collect::<String>();
            let filter_complex = format!(
                "{};{}amix=inputs={}:duration=longest:dropout_transition=0[aout]",
                parts.join(";"),
                mixed_inputs,
                valid_audio.len()
            );

            ffmpeg
                .arg("-filter_complex")
                .arg(filter_complex)
                .arg("-map")
                .arg("0:v:0")
                .arg("-map")
                .arg("[aout]")
                .arg("-c:v")
                .arg("libx264")
                .arg("-c:a")
                .arg("aac")
                .arg("-shortest");

            format!("Mixed {} audio tracks", valid_audio.len())
        };

        let ffmpeg_status = ffmpeg
            .arg("-vsync")
            .arg("vfr")
            .arg("-pix_fmt")
            .arg("yuv420p")
            .arg("-b:v")
            .arg(format!("{safe_bitrate_kbps}k"))
            .arg("-r")
            .arg(safe_fps.to_string())
            .arg(output_path.to_string_lossy().as_ref())
            .status()
            .map_err(|err| {
                format!("Unable to execute ffmpeg. Make sure ffmpeg is installed. {err}")
            })?;

        if !ffmpeg_status.success() {
            let _ = append_export_log(
                &project_dir,
                &ExportLogEntry {
                    timestamp: now_timestamp().unwrap_or(0),
                    kind: "animatic-from-frames".to_string(),
                    status: "failed".to_string(),
                    message: format!(
                        "FFmpeg frame export failed with status {:?}. {}",
                        ffmpeg_status.code(),
                        audio_message
                    ),
                    output_path: None,
                },
            );
            return Err(format!(
                "FFmpeg frame export failed with status code {:?}",
                ffmpeg_status.code()
            ));
        }

        let _ = append_export_log(
            &project_dir,
            &ExportLogEntry {
                timestamp: now_timestamp().unwrap_or(0),
                kind: "animatic-from-frames".to_string(),
                status: "success".to_string(),
                message: format!("Frame export completed. {}", audio_message),
                output_path: Some(output_path.to_string_lossy().to_string()),
            },
        );

        Ok(ExportResult {
            output_path: output_path.to_string_lossy().to_string(),
        })
    })();

    let _ = fs::remove_dir_all(&frame_output_dir);
    result
}

#[tauri::command]
fn concat_video_segments(
    app: tauri::AppHandle,
    video_paths: Vec<String>,
) -> Result<ExportResult, String> {
    let paths: Vec<PathBuf> = video_paths
        .iter()
        .map(PathBuf::from)
        .filter(|path| path.exists() && path.is_file())
        .collect();
    if paths.is_empty() {
        return Err("No valid video segments found".to_string());
    }

    let project_dir = resolve_current_project_dir(&app)?;
    let output_path = export_file_path(&project_dir, "mp4")?;
    let temp_dir = frame_dir(&project_dir)?;
    let concat_file_path = temp_dir.join("video-concat.txt");

    let mut concat_text = String::new();
    for path in &paths {
        concat_text.push_str(&format!(
            "file '{}'\n",
            path.to_string_lossy().replace('\'', "'\\''")
        ));
    }
    fs::write(&concat_file_path, concat_text)
        .map_err(|err| format!("Failed to write concat file: {err}"))?;

    let result = (|| -> Result<ExportResult, String> {
        let status = Command::new("ffmpeg")
            .arg("-y")
            .arg("-f")
            .arg("concat")
            .arg("-safe")
            .arg("0")
            .arg("-i")
            .arg(concat_file_path.to_string_lossy().as_ref())
            .arg("-c:v")
            .arg("libx264")
            .arg("-c:a")
            .arg("aac")
            .arg("-pix_fmt")
            .arg("yuv420p")
            .arg(output_path.to_string_lossy().as_ref())
            .status()
            .map_err(|err| format!("Unable to execute ffmpeg concat: {err}"))?;

        if !status.success() {
            let _ = append_export_log(
                &project_dir,
                &ExportLogEntry {
                    timestamp: now_timestamp().unwrap_or(0),
                    kind: "video-concat".to_string(),
                    status: "failed".to_string(),
                    message: format!("Video concat failed with status {:?}", status.code()),
                    output_path: None,
                },
            );
            return Err(format!("Video concat failed with status code {:?}", status.code()));
        }

        let output = output_path.to_string_lossy().to_string();
        let _ = append_export_log(
            &project_dir,
            &ExportLogEntry {
                timestamp: now_timestamp().unwrap_or(0),
                kind: "video-concat".to_string(),
                status: "success".to_string(),
                message: format!("Concatenated {} video segments", paths.len()),
                output_path: Some(output.clone()),
            },
        );

        Ok(ExportResult { output_path: output })
    })();

    let _ = fs::remove_dir_all(&temp_dir);
    result
}

#[tauri::command]
fn mux_video_with_audio_tracks(
    app: tauri::AppHandle,
    video_path: String,
    fps: i64,
    audio_tracks: Vec<AudioTrackPayload>,
) -> Result<ExportResult, String> {
    let input_video_path = PathBuf::from(video_path.trim());
    if !input_video_path.exists() || !input_video_path.is_file() {
        return Err(format!(
            "Source video not found: {}",
            input_video_path.to_string_lossy()
        ));
    }

    let safe_fps = fps.max(1);
    let project_dir = resolve_current_project_dir(&app)?;
    let output_path = export_file_path(&project_dir, "mp4")?;

    let mut ffmpeg = Command::new("ffmpeg");
    ffmpeg
        .arg("-y")
        .arg("-i")
        .arg(input_video_path.to_string_lossy().as_ref());

    let mut valid_audio = Vec::new();
    let mut next_input_index = 1_i64;
    for track in &audio_tracks {
        let audio_path = PathBuf::from(&track.file_path);
        if !audio_path.exists() || !audio_path.is_file() {
            continue;
        }
        ffmpeg.arg("-i").arg(&track.file_path);
        valid_audio.push((
            next_input_index,
            track.start_frame.max(0),
            track.gain.max(0.0),
        ));
        next_input_index += 1;
    }

    if valid_audio.is_empty() {
        return Ok(ExportResult {
            output_path: input_video_path.to_string_lossy().to_string(),
        });
    }

    let mut parts = Vec::new();
    for (idx, (input_index, start_frame, gain)) in valid_audio.iter().enumerate() {
        let delay_ms = ((*start_frame as f64) / (safe_fps as f64) * 1000.0).round() as i64;
        parts.push(format!(
            "[{}:a]adelay={}|{},volume={:.3}[a{}]",
            input_index, delay_ms, delay_ms, gain, idx
        ));
    }
    let mixed_inputs = (0..valid_audio.len())
        .map(|idx| format!("[a{}]", idx))
        .collect::<String>();
    let filter_complex = format!(
        "{};{}amix=inputs={}:duration=longest:dropout_transition=0[aout]",
        parts.join(";"),
        mixed_inputs,
        valid_audio.len()
    );

    let status = ffmpeg
        .arg("-filter_complex")
        .arg(filter_complex)
        .arg("-map")
        .arg("0:v:0")
        .arg("-map")
        .arg("[aout]")
        .arg("-c:v")
        .arg("copy")
        .arg("-c:a")
        .arg("aac")
        .arg("-shortest")
        .arg(output_path.to_string_lossy().as_ref())
        .status()
        .map_err(|err| format!("Unable to execute ffmpeg audio mux: {err}"))?;

    if !status.success() {
        let _ = append_export_log(
            &project_dir,
            &ExportLogEntry {
                timestamp: now_timestamp().unwrap_or(0),
                kind: "video-audio-mux".to_string(),
                status: "failed".to_string(),
                message: format!("Video/audio mux failed with status {:?}", status.code()),
                output_path: None,
            },
        );
        return Err(format!(
            "Video/audio mux failed with status code {:?}",
            status.code()
        ));
    }

    let output = output_path.to_string_lossy().to_string();
    let _ = append_export_log(
        &project_dir,
        &ExportLogEntry {
            timestamp: now_timestamp().unwrap_or(0),
            kind: "video-audio-mux".to_string(),
            status: "success".to_string(),
            message: format!("Attached {} audio tracks to video", valid_audio.len()),
            output_path: Some(output.clone()),
        },
    );

    Ok(ExportResult { output_path: output })
}

#[tauri::command]
fn mix_audio_tracks(
    app: tauri::AppHandle,
    fps: i64,
    audio_tracks: Vec<AudioTrackPayload>,
) -> Result<ExportResult, String> {
    let safe_fps = fps.max(1);
    let project_dir = resolve_current_project_dir(&app)?;
    let output_path = export_file_path(&project_dir, "wav")?;

    let mut valid_audio = Vec::new();
    for track in &audio_tracks {
        let audio_path = PathBuf::from(&track.file_path);
        if !audio_path.exists() || !audio_path.is_file() {
            continue;
        }
        valid_audio.push((track.file_path.clone(), track.start_frame.max(0), track.gain.max(0.0)));
    }

    if valid_audio.is_empty() {
        return Err("No valid audio tracks found".to_string());
    }

    let mut ffmpeg = Command::new("ffmpeg");
    ffmpeg.arg("-y");
    for (file_path, _, _) in &valid_audio {
        ffmpeg.arg("-i").arg(file_path);
    }

    let mut parts = Vec::new();
    let mut mix_inputs = String::new();
    for (idx, (_, start_frame, gain)) in valid_audio.iter().enumerate() {
        let delay_ms = ((*start_frame as f64) / (safe_fps as f64) * 1000.0).round() as i64;
        parts.push(format!(
            "[{}:a]adelay={}|{},volume={:.3}[a{}]",
            idx, delay_ms, delay_ms, gain, idx
        ));
        mix_inputs.push_str(&format!("[a{}]", idx));
    }

    let filter_complex = format!(
        "{};{}amix=inputs={}:duration=longest:dropout_transition=0[aout]",
        parts.join(";"),
        mix_inputs,
        valid_audio.len()
    );

    let status = ffmpeg
        .arg("-filter_complex")
        .arg(filter_complex)
        .arg("-map")
        .arg("[aout]")
        .arg("-c:a")
        .arg("pcm_s16le")
        .arg(output_path.to_string_lossy().as_ref())
        .status()
        .map_err(|err| format!("Unable to execute ffmpeg audio mix: {err}"))?;

    if !status.success() {
        let _ = append_export_log(
            &project_dir,
            &ExportLogEntry {
                timestamp: now_timestamp().unwrap_or(0),
                kind: "audio-mix".to_string(),
                status: "failed".to_string(),
                message: format!("Audio mix failed with status code {:?}", status.code()),
                output_path: None,
            },
        );
        return Err(format!(
            "Audio mix failed with status code {:?}",
            status.code()
        ));
    }

    let output = output_path.to_string_lossy().to_string();
    let _ = append_export_log(
        &project_dir,
        &ExportLogEntry {
            timestamp: now_timestamp().unwrap_or(0),
            kind: "audio-mix".to_string(),
            status: "success".to_string(),
            message: format!("Mixed {} audio tracks", valid_audio.len()),
            output_path: Some(output.clone()),
        },
    );

    Ok(ExportResult { output_path: output })
}

#[tauri::command]
fn generate_local_video_from_images(
    app: tauri::AppHandle,
    primary_image_path: String,
    secondary_image_path: Option<String>,
    width: Option<i64>,
    height: Option<i64>,
    fps: Option<i64>,
    duration_frames: Option<i64>,
    mode: Option<LocalVideoMode>,
    motion_preset: Option<String>,
) -> Result<ExportResult, String> {
    let primary = PathBuf::from(primary_image_path.trim());
    if !primary.exists() || !primary.is_file() {
        return Err(format!(
            "Primary image not found: {}",
            primary.to_string_lossy()
        ));
    }

    let safe_width = width.unwrap_or(1920).max(320);
    let safe_height = height.unwrap_or(1080).max(320);
    let safe_fps = fps.unwrap_or(24).max(1);
    let safe_duration_frames = duration_frames.unwrap_or(48).max(1);
    let total_seconds = (safe_duration_frames as f64 / safe_fps as f64).max(0.4);
    let fade_seconds = total_seconds.min(0.45).max(0.15);
    let motion = motion_preset
        .unwrap_or_else(|| "auto".to_string())
        .trim()
        .to_ascii_lowercase();
    let project_dir = resolve_current_project_dir(&app)?;
    let output_path = export_file_path(&project_dir, "mp4")?;

    let scale_pad = format!(
        "scale={w}:{h}:force_original_aspect_ratio=decrease,pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1",
        w = safe_width,
        h = safe_height
    );

    let result = match mode.unwrap_or(LocalVideoMode::SingleFrame) {
        LocalVideoMode::SingleFrame => {
            let fade_out_start = (total_seconds - fade_seconds).max(0.0);
            let frame_span = (safe_duration_frames - 1).max(1) as f64;
            let motion_filter = match motion.as_str() {
                "still" | "fade" | "auto" => {
                    format!(
                        "{scale_pad},fade=t=in:st=0:d={fade:.3},fade=t=out:st={fade_out_start:.3}:d={fade:.3},format=yuv420p",
                        scale_pad = scale_pad,
                        fade = fade_seconds,
                        fade_out_start = fade_out_start
                    )
                }
                "push_out" => {
                    let step = (1.12_f64 - 1.0_f64) / frame_span;
                    format!(
                        "{scale_pad},zoompan=z='max(1.0,1.12-on*{step:.6})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s={w}x{h}:fps={fps},fade=t=in:st=0:d={fade:.3},fade=t=out:st={fade_out_start:.3}:d={fade:.3},format=yuv420p",
                        scale_pad = scale_pad,
                        step = step,
                        w = safe_width,
                        h = safe_height,
                        fps = safe_fps,
                        fade = fade_seconds,
                        fade_out_start = fade_out_start
                    )
                }
                "pan_left" => {
                    format!(
                        "{scale_pad},zoompan=z='1.06':x='(1-on/{frame_span:.3})*(iw-iw/zoom)':y='ih/2-(ih/zoom/2)':d=1:s={w}x{h}:fps={fps},fade=t=in:st=0:d={fade:.3},fade=t=out:st={fade_out_start:.3}:d={fade:.3},format=yuv420p",
                        scale_pad = scale_pad,
                        frame_span = frame_span,
                        w = safe_width,
                        h = safe_height,
                        fps = safe_fps,
                        fade = fade_seconds,
                        fade_out_start = fade_out_start
                    )
                }
                "pan_right" => {
                    format!(
                        "{scale_pad},zoompan=z='1.06':x='(on/{frame_span:.3})*(iw-iw/zoom)':y='ih/2-(ih/zoom/2)':d=1:s={w}x{h}:fps={fps},fade=t=in:st=0:d={fade:.3},fade=t=out:st={fade_out_start:.3}:d={fade:.3},format=yuv420p",
                        scale_pad = scale_pad,
                        frame_span = frame_span,
                        w = safe_width,
                        h = safe_height,
                        fps = safe_fps,
                        fade = fade_seconds,
                        fade_out_start = fade_out_start
                    )
                }
                _ => {
                    let step = (1.12_f64 - 1.0_f64) / frame_span;
                    format!(
                        "{scale_pad},zoompan=z='min(1.12,1.0+on*{step:.6})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s={w}x{h}:fps={fps},fade=t=in:st=0:d={fade:.3},fade=t=out:st={fade_out_start:.3}:d={fade:.3},format=yuv420p",
                        scale_pad = scale_pad,
                        step = step,
                        w = safe_width,
                        h = safe_height,
                        fps = safe_fps,
                        fade = fade_seconds,
                        fade_out_start = fade_out_start
                    )
                }
            };
            let status = Command::new("ffmpeg")
                .arg("-y")
                .arg("-loop")
                .arg("1")
                .arg("-t")
                .arg(format!("{:.3}", total_seconds))
                .arg("-i")
                .arg(primary.to_string_lossy().as_ref())
                .arg("-vf")
                .arg(motion_filter)
                .arg("-an")
                .arg("-c:v")
                .arg("libx264")
                .arg("-pix_fmt")
                .arg("yuv420p")
                .arg("-r")
                .arg(safe_fps.to_string())
                .arg(output_path.to_string_lossy().as_ref())
                .status()
                .map_err(|err| format!("Unable to execute local video ffmpeg: {err}"))?;
            if !status.success() {
                let _ = append_export_log(
                    &project_dir,
                    &ExportLogEntry {
                        timestamp: now_timestamp().unwrap_or(0),
                        kind: "local-video".to_string(),
                        status: "failed".to_string(),
                        message: format!("Local single-frame video failed with status {:?}", status.code()),
                        output_path: None,
                    },
                );
                return Err(format!(
                    "Local single-frame video failed with status code {:?}",
                    status.code()
                ));
            }
            append_export_log(
                &project_dir,
                &ExportLogEntry {
                    timestamp: now_timestamp().unwrap_or(0),
                    kind: "local-video".to_string(),
                    status: "success".to_string(),
                    message: "Local single-frame video generated".to_string(),
                    output_path: Some(output_path.to_string_lossy().to_string()),
                },
            )
        }
        LocalVideoMode::FirstLastFrame => {
            let secondary_raw = secondary_image_path.unwrap_or_default();
            let secondary = if secondary_raw.trim().is_empty() {
                primary.clone()
            } else {
                PathBuf::from(secondary_raw.trim())
            };
            if !secondary.exists() || !secondary.is_file() {
                return Err(format!(
                    "Secondary image not found: {}",
                    secondary.to_string_lossy()
                ));
            }
            let fade_offset = (total_seconds - fade_seconds).max(0.0);
            let filter = format!(
                "[0:v]{scale_pad},trim=duration={duration:.3},setpts=PTS-STARTPTS[v0];\
[1:v]{scale_pad},trim=duration={duration:.3},setpts=PTS-STARTPTS[v1];\
[v0][v1]xfade=transition=fade:duration={fade:.3}:offset={offset:.3},format=yuv420p[v]",
                scale_pad = scale_pad,
                duration = total_seconds,
                fade = fade_seconds,
                offset = fade_offset
            );
            let status = Command::new("ffmpeg")
                .arg("-y")
                .arg("-loop")
                .arg("1")
                .arg("-t")
                .arg(format!("{:.3}", total_seconds))
                .arg("-i")
                .arg(primary.to_string_lossy().as_ref())
                .arg("-loop")
                .arg("1")
                .arg("-t")
                .arg(format!("{:.3}", total_seconds))
                .arg("-i")
                .arg(secondary.to_string_lossy().as_ref())
                .arg("-filter_complex")
                .arg(filter)
                .arg("-map")
                .arg("[v]")
                .arg("-an")
                .arg("-c:v")
                .arg("libx264")
                .arg("-pix_fmt")
                .arg("yuv420p")
                .arg("-r")
                .arg(safe_fps.to_string())
                .arg(output_path.to_string_lossy().as_ref())
                .status()
                .map_err(|err| format!("Unable to execute local xfade ffmpeg: {err}"))?;
            if !status.success() {
                let _ = append_export_log(
                    &project_dir,
                    &ExportLogEntry {
                        timestamp: now_timestamp().unwrap_or(0),
                        kind: "local-video".to_string(),
                        status: "failed".to_string(),
                        message: format!("Local first-last video failed with status {:?}", status.code()),
                        output_path: None,
                    },
                );
                return Err(format!(
                    "Local first-last video failed with status code {:?}",
                    status.code()
                ));
            }
            append_export_log(
                &project_dir,
                &ExportLogEntry {
                    timestamp: now_timestamp().unwrap_or(0),
                    kind: "local-video".to_string(),
                    status: "success".to_string(),
                    message: "Local first-last video generated".to_string(),
                    output_path: Some(output_path.to_string_lossy().to_string()),
                },
            )
        }
    };

    if let Err(err) = result {
        return Err(err);
    }

    Ok(ExportResult {
        output_path: output_path.to_string_lossy().to_string(),
    })
}

fn normalize_base_url(raw: &str) -> String {
    let trimmed = raw.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return "http://127.0.0.1:8188".to_string();
    }
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        return trimmed.to_string();
    }
    format!("http://{trimmed}")
}

fn comfy_http_client(timeout_secs: u64) -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(timeout_secs))
        .build()
        .map_err(|err| format!("创建 Comfy 客户端失败: {err}"))
}

#[tauri::command]
fn comfy_ping(base_url: String) -> Result<ComfyPingResult, String> {
    let base = normalize_base_url(&base_url);
    let client = comfy_http_client(6)?;
    let checks = ["/system_stats", "/queue"];
    for path in checks {
        let url = format!("{base}{path}");
        let response = client.get(&url).send();
        if let Ok(resp) = response {
            let status = resp.status();
            if status.is_success() {
                return Ok(ComfyPingResult {
                    ok: true,
                    status_code: Some(status.as_u16()),
                    message: format!("ComfyUI 可用: {url}"),
                });
            }
        }
    }
    let url = format!("{base}/system_stats");
    let response = client.get(&url).send();
    match response {
        Ok(resp) => Ok(ComfyPingResult {
            ok: false,
            status_code: Some(resp.status().as_u16()),
            message: format!("ComfyUI 返回 HTTP {}", resp.status().as_u16()),
        }),
        Err(err) => Ok(ComfyPingResult {
            ok: false,
            status_code: None,
            message: format!("连接失败: {err}"),
        }),
    }
}

#[tauri::command]
fn comfy_queue_prompt(
    base_url: String,
    prompt: serde_json::Value,
    client_id: String,
) -> Result<String, String> {
    let url = format!("{}/prompt", normalize_base_url(&base_url));
    let client = comfy_http_client(15)?;
    let payload = serde_json::json!({
        "prompt": prompt,
        "client_id": client_id
    });
    let resp = client
        .post(&url)
        .json(&payload)
        .send()
        .map_err(|err| format!("提交 Comfy 任务失败: {err}"))?;
    if !resp.status().is_success() {
        let code = resp.status().as_u16();
        let body = resp.text().unwrap_or_else(|_| "".to_string());
        return Err(format!("提交 Comfy 任务失败: HTTP {code} {body}"));
    }
    let value: serde_json::Value = resp
        .json()
        .map_err(|err| format!("解析 Comfy 响应失败: {err}"))?;
    let prompt_id = value
        .get("prompt_id")
        .and_then(|item| item.as_str())
        .unwrap_or("")
        .to_string();
    if prompt_id.is_empty() {
        return Err("Comfy 未返回 prompt_id".to_string());
    }
    Ok(prompt_id)
}

#[tauri::command]
fn comfy_get_history(base_url: String, prompt_id: String) -> Result<serde_json::Value, String> {
    let url = format!("{}/history/{}", normalize_base_url(&base_url), prompt_id);
    let client = comfy_http_client(12)?;
    let resp = client
        .get(&url)
        .send()
        .map_err(|err| format!("读取 Comfy history 失败: {err}"))?;
    if !resp.status().is_success() {
        return Err(format!("读取 Comfy history 失败: HTTP {}", resp.status().as_u16()));
    }
    resp.json()
        .map_err(|err| format!("解析 Comfy history 失败: {err}"))
}

#[tauri::command]
fn comfy_fetch_view_base64(url: String) -> Result<String, String> {
    let target = url.trim();
    if target.is_empty() {
        return Err("url 不能为空".to_string());
    }
    let client = comfy_http_client(30)?;
    let bytes = client
        .get(target)
        .send()
        .and_then(|resp| resp.error_for_status())
        .map_err(|err| format!("下载 Comfy 图像失败: {err}"))?
        .bytes()
        .map_err(|err| format!("读取 Comfy 图像字节失败: {err}"))?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

#[tauri::command]
fn comfy_discover_endpoints() -> Result<ComfyDiscoverResult, String> {
    let candidates = [
        "http://127.0.0.1:8188",
        "http://127.0.0.1:8000",
        "http://127.0.0.1:17888",
        "http://127.0.0.1:17788",
        "http://127.0.0.1:7860",
        "http://localhost:8188",
        "http://localhost:8000",
    ];
    let client = comfy_http_client(2)?;
    let mut found = Vec::new();
    for base in candidates {
        let checks = ["/system_stats", "/queue"];
        let mut ok = false;
        for path in checks {
            let url = format!("{base}{path}");
            if let Ok(resp) = client.get(&url).send() {
                if resp.status().is_success() {
                    ok = true;
                    break;
                }
            }
        }
        if ok {
            found.push(base.to_string());
        }
    }
    Ok(ComfyDiscoverResult { found })
}

#[tauri::command]
fn comfy_discover_local_dirs() -> Result<ComfyLocalDirsResult, String> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd.join("../ComfyUI_JM_windows_portable/ComfyUI"));
        candidates.push(cwd.join("ComfyUI_JM_windows_portable/ComfyUI"));
    }
    if let Ok(home) = std::env::var("HOME") {
        let home_dir = PathBuf::from(home);
        candidates.push(home_dir.join("Documents/ComfyUI"));
        candidates.push(home_dir.join("ComfyUI"));
        candidates.push(home_dir.join("Desktop/ComfyUI"));
        candidates.push(home_dir.join("Downloads/ComfyUI"));
        candidates.push(home_dir.join("Library/Application Support/ComfyUI"));
    }
    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd);
    }

    let mut best_root: Option<PathBuf> = None;
    let mut best_score: i32 = -1;
    let mut seen = HashSet::new();
    for root in candidates {
        let key = root.to_string_lossy().to_string();
        if seen.contains(&key) {
            continue;
        }
        seen.insert(key);
        if !root.exists() || !root.is_dir() {
            continue;
        }
        let input = root.join("input");
        let output = root.join("output");
        let models = root.join("models");
        let custom_nodes = root.join("custom_nodes");
        let mut score = 0;
        if input.is_dir() {
            score += 3;
        }
        if output.is_dir() {
            score += 3;
        }
        if models.is_dir() {
            score += 1;
        }
        if custom_nodes.is_dir() {
            score += 1;
        }
        if score > best_score {
            best_score = score;
            best_root = Some(root);
        }
    }

    if let Some(root) = best_root {
        let input = root.join("input");
        let output = root.join("output");
        return Ok(ComfyLocalDirsResult {
            root_dir: root.to_string_lossy().to_string(),
            input_dir: input.to_string_lossy().to_string(),
            output_dir: output.to_string_lossy().to_string(),
        });
    }

    Ok(ComfyLocalDirsResult {
        root_dir: "".to_string(),
        input_dir: "".to_string(),
        output_dir: "".to_string(),
    })
}

fn is_valid_github_repo_url(url: &str) -> bool {
    url.starts_with("https://github.com/")
        && !url.contains(' ')
        && !url.contains('\n')
        && url.matches('/').count() >= 4
}

fn repo_dir_name(repo: &str) -> Option<String> {
    let tail = repo
        .trim_end_matches('/')
        .rsplit('/')
        .next()
        .unwrap_or("")
        .trim_end_matches(".git")
        .trim();
    if tail.is_empty() {
        return None;
    }
    let sanitized: String = tail
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || *ch == '-' || *ch == '_')
        .collect();
    if sanitized.is_empty() {
        None
    } else {
        Some(sanitized)
    }
}

fn count_model_files(path: &Path) -> usize {
    let Ok(entries) = fs::read_dir(path) else {
        return 0;
    };
    let mut count = 0usize;
    for item in entries.flatten() {
        let p = item.path();
        if !p.is_file() {
            continue;
        }
        let ext = p
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if matches!(
            ext.as_str(),
            "safetensors" | "ckpt" | "pt" | "pth" | "bin" | "onnx"
        ) {
            count += 1;
        }
    }
    count
}

#[tauri::command]
fn comfy_install_plugins(comfy_root_dir: String, repos: Vec<String>) -> Result<PluginInstallResult, String> {
    let comfy_root = PathBuf::from(comfy_root_dir.trim());
    if !comfy_root.exists() || !comfy_root.is_dir() {
        return Err(format!(
            "ComfyUI 根目录无效: {}",
            comfy_root.to_string_lossy()
        ));
    }
    let custom_nodes_dir = comfy_root.join("custom_nodes");
    fs::create_dir_all(&custom_nodes_dir)
        .map_err(|err| format!("创建 custom_nodes 目录失败: {err}"))?;
    let venv_python = comfy_root.join(".venv").join("bin").join("python");
    let has_venv_python = venv_python.exists();

    let mut installed = Vec::new();
    let mut skipped = Vec::new();
    let mut failed = Vec::new();

    for raw_repo in repos {
        let repo = raw_repo.trim().to_string();
        if repo.is_empty() {
            continue;
        }
        if !is_valid_github_repo_url(&repo) {
            failed.push(PluginInstallFailure {
                repo: repo.clone(),
                error: "仅支持 https://github.com/ 开头的仓库地址".to_string(),
            });
            continue;
        }
        let Some(dir_name) = repo_dir_name(&repo) else {
            failed.push(PluginInstallFailure {
                repo: repo.clone(),
                error: "无法从仓库地址推断目录名".to_string(),
            });
            continue;
        };

        let target_dir = custom_nodes_dir.join(&dir_name);
        let git_status = if target_dir.exists() {
            Command::new("git")
                .arg("-C")
                .arg(&target_dir)
                .arg("pull")
                .arg("--ff-only")
                .status()
                .map_err(|err| format!("执行 git pull 失败: {err}"))
        } else {
            Command::new("git")
                .arg("clone")
                .arg("--depth=1")
                .arg(&repo)
                .arg(&target_dir)
                .status()
                .map_err(|err| format!("执行 git clone 失败: {err}"))
        };

        match git_status {
            Ok(status) if status.success() => {}
            Ok(status) => {
                failed.push(PluginInstallFailure {
                    repo: repo.clone(),
                    error: format!("git 退出码异常: {:?}", status.code()),
                });
                continue;
            }
            Err(err) => {
                failed.push(PluginInstallFailure {
                    repo: repo.clone(),
                    error: err,
                });
                continue;
            }
        }

        let requirements = target_dir.join("requirements.txt");
        if requirements.exists() {
            if has_venv_python {
                let pip_status = Command::new(&venv_python)
                    .arg("-m")
                    .arg("pip")
                    .arg("install")
                    .arg("-r")
                    .arg(&requirements)
                    .status()
                    .map_err(|err| format!("安装依赖失败: {err}"));
                match pip_status {
                    Ok(status) if status.success() => {}
                    Ok(status) => {
                        failed.push(PluginInstallFailure {
                            repo: repo.clone(),
                            error: format!("pip 退出码异常: {:?}", status.code()),
                        });
                        continue;
                    }
                    Err(err) => {
                        failed.push(PluginInstallFailure {
                            repo: repo.clone(),
                            error: err,
                        });
                        continue;
                    }
                }
            } else {
                skipped.push(format!("{dir_name}（未检测到 .venv/bin/python，跳过依赖安装）"));
            }
        }

        if target_dir.exists() {
            installed.push(dir_name);
        } else {
            skipped.push(repo);
        }
    }

    Ok(PluginInstallResult {
        installed,
        skipped,
        failed,
    })
}

#[tauri::command]
fn comfy_check_model_health(comfy_root_dir: String) -> Result<ComfyModelHealthResult, String> {
    let comfy_root = PathBuf::from(comfy_root_dir.trim());
    if !comfy_root.exists() || !comfy_root.is_dir() {
        return Err(format!(
            "ComfyUI 根目录无效: {}",
            comfy_root.to_string_lossy()
        ));
    }
    let model_root = comfy_root.join("models");
    let checks_spec = vec![
        ("checkpoints", "基础模型 Checkpoints", true, model_root.join("checkpoints")),
        ("vae", "VAE", false, model_root.join("vae")),
        ("loras", "Lora", false, model_root.join("loras")),
        ("controlnet", "ControlNet", false, model_root.join("controlnet")),
        ("ipadapter", "IPAdapter", false, model_root.join("ipadapter")),
        ("clip_vision", "CLIP Vision", false, model_root.join("clip_vision")),
        ("animatediff_models", "AnimateDiff Motion Models", false, model_root.join("animatediff_models")),
        (
            "animatediff_models_plugin",
            "AnimateDiff 插件 Models",
            false,
            comfy_root
                .join("custom_nodes")
                .join("ComfyUI-AnimateDiff-Evolved")
                .join("models"),
        ),
    ];
    let mut checks = Vec::new();
    for (key, label, required, path) in checks_spec {
        let exists = path.exists() && path.is_dir();
        let file_count = if exists { count_model_files(&path) } else { 0 };
        checks.push(ComfyModelCheckItem {
            key: key.to_string(),
            label: label.to_string(),
            path: path.to_string_lossy().to_string(),
            exists,
            file_count,
            required,
        });
    }
    Ok(ComfyModelHealthResult { checks })
}

#[tauri::command]
fn comfy_get_object_info(base_url: String) -> Result<serde_json::Value, String> {
    let url = format!("{}/object_info", normalize_base_url(&base_url));
    let client = comfy_http_client(12)?;
    let resp = client
        .get(&url)
        .send()
        .map_err(|err| format!("读取 Comfy object_info 失败: {err}"))?;
    if !resp.status().is_success() {
        return Err(format!(
            "读取 Comfy object_info 失败: HTTP {}",
            resp.status().as_u16()
        ));
    }
    resp.json()
        .map_err(|err| format!("解析 Comfy object_info 失败: {err}"))
}

#[tauri::command]
fn write_base64_file(file_path: String, base64_data: String) -> Result<FileWriteResult, String> {
    let path = PathBuf::from(file_path.trim());
    if path.as_os_str().is_empty() {
        return Err("file_path is empty".to_string());
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("Failed to create parent directory: {err}"))?;
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(base64_data)
        .map_err(|err| format!("Failed to decode base64 data: {err}"))?;
    fs::write(&path, bytes).map_err(|err| format!("Failed to write file: {err}"))?;
    Ok(FileWriteResult {
        file_path: path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
fn copy_file_to(source_path: String, target_path: String) -> Result<FileWriteResult, String> {
    let source = PathBuf::from(source_path.trim());
    if !source.exists() || !source.is_file() {
        return Err(format!("Source file not found: {}", source.to_string_lossy()));
    }
    let target = PathBuf::from(target_path.trim());
    if target.as_os_str().is_empty() {
        return Err("target_path is empty".to_string());
    }
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("Failed to create target directory: {err}"))?;
    }
    fs::copy(&source, &target).map_err(|err| format!("Failed to copy file: {err}"))?;
    Ok(FileWriteResult {
        file_path: target.to_string_lossy().to_string(),
    })
}

#[tauri::command]
fn delete_generated_file_families(
    source_paths: Vec<String>,
    exclude_paths: Option<Vec<String>>,
) -> Result<DeleteGeneratedFileFamiliesResult, String> {
    fn strip_trailing_numbered_suffix(value: &str, marker: &str) -> Option<String> {
        let (base, suffix) = value.rsplit_once(marker)?;
        if suffix.is_empty() || !suffix.as_bytes().iter().all(|byte| byte.is_ascii_digit()) {
            return None;
        }
        Some(base.to_string())
    }

    fn strip_generated_run_suffixes(value: &str) -> Option<String> {
        let bytes = value.as_bytes();
        let mut end = value.len();
        let mut removed_long_group = false;
        loop {
            let mut split = end;
            while split > 0 && bytes[split - 1].is_ascii_digit() {
                split -= 1;
            }
            if split == end || split == 0 || bytes[split - 1] != b'_' {
                break;
            }
            let digit_count = end - split;
            if !removed_long_group && digit_count < 4 {
                break;
            }
            removed_long_group = true;
            end = split - 1;
        }
        if removed_long_group {
            Some(value[..end].to_string())
        } else {
            None
        }
    }

    fn normalize_generated_family_prefix(stem: &str) -> String {
        let mut normalized = stem.trim().to_string();
        if normalized.is_empty() {
            return normalized;
        }
        loop {
            let before = normalized.clone();
            for suffix in ["_front", "_side", "_back", "_flatbg", "_subject", "_framed"] {
                if normalized.ends_with(suffix) {
                    normalized.truncate(normalized.len() - suffix.len());
                    break;
                }
            }
            if let Some(stripped) = strip_trailing_numbered_suffix(&normalized, "_panel") {
                normalized = stripped;
            } else if let Some(stripped) = strip_trailing_numbered_suffix(&normalized, "_triptych_input_") {
                normalized = stripped;
            }
            if normalized == before {
                break;
            }
        }
        let scoped_family = [
            "asset_char_",
            "asset_panel_char_",
            "import_char_anchor_",
            "threeview_sheet",
            "character_anchor_import_char_anchor_",
            "character_anchor_cleanup_import_char_anchor_",
            "character_anchor_asset_char_",
            "character_orthoview_asset_char_",
            "character_mv_",
            "character_threeview",
            "fallback_",
            "cleanup_",
            "reference_cleanup",
        ]
        .iter()
        .any(|token| normalized.contains(token));
        if scoped_family {
            let trimmed = normalized.trim_end_matches('_').to_string();
            if let Some(stripped) = strip_generated_run_suffixes(&trimmed) {
                normalized = stripped;
            } else {
                normalized = trimmed;
            }
        }
        normalized
    }

    let excludes: HashSet<PathBuf> = exclude_paths
        .unwrap_or_default()
        .into_iter()
        .map(|value| PathBuf::from(value.trim()))
        .filter(|path| !path.as_os_str().is_empty())
        .collect();

    let mut grouped_prefixes: HashMap<PathBuf, HashSet<String>> = HashMap::new();
    for raw_path in source_paths {
        let path = PathBuf::from(raw_path.trim());
        if path.as_os_str().is_empty() {
            continue;
        }
        let Some(parent) = path.parent() else {
            continue;
        };
        let Some(stem) = path.file_stem().and_then(|value| value.to_str()) else {
            continue;
        };
        let normalized_prefix = normalize_generated_family_prefix(stem);
        if normalized_prefix.trim().is_empty() {
            continue;
        }
        grouped_prefixes
            .entry(parent.to_path_buf())
            .or_default()
            .insert(normalized_prefix);
    }

    let mut deleted_paths = Vec::new();
    for (directory, prefixes) in grouped_prefixes {
        let entries = match fs::read_dir(&directory) {
            Ok(entries) => entries,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let candidate_path = entry.path();
            if !candidate_path.is_file() || excludes.contains(&candidate_path) {
                continue;
            }
            let Some(file_name) = candidate_path.file_name().and_then(|value| value.to_str()) else {
                continue;
            };
            if !prefixes
                .iter()
                .any(|prefix| !prefix.is_empty() && file_name.starts_with(prefix))
            {
                continue;
            }
            fs::remove_file(&candidate_path)
                .map_err(|err| format!("Failed to delete generated file {}: {err}", candidate_path.to_string_lossy()))?;
            deleted_paths.push(candidate_path.to_string_lossy().to_string());
        }
    }

    Ok(DeleteGeneratedFileFamiliesResult { deleted_paths })
}

#[tauri::command]
fn split_threeview_sheet(source_path: String) -> Result<ThreeViewSplitResult, String> {
    let source = PathBuf::from(source_path.trim());
    if !source.exists() || !source.is_file() {
        return Err(format!("Three-view sheet not found: {}", source.to_string_lossy()));
    }

    let image = image::open(&source).map_err(|err| format!("Failed to open three-view sheet: {err}"))?;
    let (width, height) = image.dimensions();
    if width < 3 || height == 0 {
        return Err(format!(
            "Three-view sheet has invalid dimensions: {}x{}",
            width, height
        ));
    }

    let panel_width = width / 3;
    let widths = [panel_width, panel_width, width - panel_width * 2];
    let starts = [0, panel_width, panel_width * 2];
    let stem = source
        .file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("threeview");
    let parent = source.parent().unwrap_or_else(|| Path::new(""));
    let front_path = parent.join(format!("{stem}_front.png"));
    let side_path = parent.join(format!("{stem}_side.png"));
    let back_path = parent.join(format!("{stem}_back.png"));
    let targets = [front_path.clone(), side_path.clone(), back_path.clone()];

    for (index, target) in targets.iter().enumerate() {
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)
                .map_err(|err| format!("Failed to create split image directory: {err}"))?;
        }
        if target.exists() {
            fs::remove_file(target)
                .map_err(|err| format!("Failed to overwrite split image: {err}"))?;
        }
        let crop = image.crop_imm(starts[index], 0, widths[index], height);
        crop.save(target)
            .map_err(|err| format!("Failed to save split image: {err}"))?;
    }

    Ok(ThreeViewSplitResult {
        front_path: front_path.to_string_lossy().to_string(),
        side_path: side_path.to_string_lossy().to_string(),
        back_path: back_path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
fn comfy_read_server_log_tail(
    comfy_root_dir: String,
    base_url: String,
    max_lines: Option<usize>,
) -> Result<String, String> {
    let root = PathBuf::from(comfy_root_dir.trim());
    if root.as_os_str().is_empty() {
        return Err("comfy_root_dir is empty".to_string());
    }
    let normalized = normalize_base_url(&base_url);
    let port = normalized
        .rsplit(':')
        .next()
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(8188);
    let user_dir = root.join("user");
    let candidate_paths = [
        user_dir.join(format!("comfyui_{port}.log")),
        user_dir.join("comfyui.log"),
    ];
    let log_path = candidate_paths
        .into_iter()
        .find(|path| path.exists())
        .ok_or_else(|| {
            format!(
                "Comfy server log not found: {} or {}",
                user_dir.join(format!("comfyui_{port}.log")).to_string_lossy(),
                user_dir.join("comfyui.log").to_string_lossy()
            )
        })?;
    let content = fs::read_to_string(&log_path)
        .map_err(|err| format!("Failed to read Comfy server log: {err}"))?;
    let limit = max_lines.unwrap_or(160);
    let lines: Vec<&str> = content.lines().collect();
    let start = lines.len().saturating_sub(limit);
    Ok(lines[start..].join("\n"))
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            list_workspace_projects,
            create_workspace_project,
            select_workspace_project,
            rename_workspace_project,
            delete_workspace_project,
            list_export_logs,
            clear_export_logs,
            open_path_in_os,
            find_missing_paths,
            save_current_project,
            load_current_project,
            export_animatic,
            export_animatic_from_frames,
            concat_video_segments,
            mux_video_with_audio_tracks,
            mix_audio_tracks,
            generate_local_video_from_images,
            write_base64_file,
            copy_file_to,
            delete_generated_file_families,
            split_threeview_sheet,
            comfy_read_server_log_tail,
            comfy_ping,
            comfy_queue_prompt,
            comfy_get_history,
            comfy_fetch_view_base64,
            comfy_discover_endpoints,
            comfy_discover_local_dirs,
            comfy_get_object_info,
            comfy_install_plugins,
            comfy_check_model_health
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
