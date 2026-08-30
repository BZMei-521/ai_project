#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use base64::Engine as _;
use image::GenericImageView;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::Manager;

mod video_continuity;
mod spatial_stage;
mod codex_storyboard;
mod crop_attestation;

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
    #[serde(flatten)]
    extra_fields: HashMap<String, serde_json::Value>,
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

fn default_workbench_schema_version() -> i64 {
    1
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct StoredWorkbenchSnapshot {
    #[serde(default = "default_workbench_schema_version")]
    schema_version: i64,
    #[serde(default)]
    migration_backup_pending: bool,
    #[serde(default)]
    director_plan: serde_json::Value,
    #[serde(default)]
    spatial_scenes: Vec<serde_json::Value>,
    #[serde(default)]
    spatial_objects: Vec<serde_json::Value>,
    #[serde(default)]
    pose_keyframes: Vec<serde_json::Value>,
    #[serde(default)]
    camera_plans: Vec<serde_json::Value>,
    #[serde(default)]
    extra_snapshot_fields: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct StoryboardSnapshotPayload {
    #[serde(default = "default_workbench_schema_version")]
    schema_version: i64,
    #[serde(default)]
    migration_backup_pending: bool,
    #[serde(default)]
    director_plan: serde_json::Value,
    #[serde(default)]
    spatial_scenes: Vec<serde_json::Value>,
    #[serde(default)]
    spatial_objects: Vec<serde_json::Value>,
    #[serde(default)]
    pose_keyframes: Vec<serde_json::Value>,
    #[serde(default)]
    camera_plans: Vec<serde_json::Value>,
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
    #[serde(flatten)]
    extra_snapshot_fields: HashMap<String, serde_json::Value>,
}

fn serialize_workbench_snapshot(snapshot: &StoryboardSnapshotPayload) -> Result<String, String> {
    serde_json::to_string(&StoredWorkbenchSnapshot {
        schema_version: snapshot.schema_version,
        migration_backup_pending: snapshot.migration_backup_pending,
        director_plan: snapshot.director_plan.clone(),
        spatial_scenes: snapshot.spatial_scenes.clone(),
        spatial_objects: snapshot.spatial_objects.clone(),
        pose_keyframes: snapshot.pose_keyframes.clone(),
        camera_plans: snapshot.camera_plans.clone(),
        extra_snapshot_fields: snapshot.extra_snapshot_fields.clone(),
    })
    .map_err(|err| format!("Unable to serialize workbench snapshot: {err}"))
}

fn deserialize_workbench_snapshot(raw: &str) -> Result<StoredWorkbenchSnapshot, String> {
    serde_json::from_str(raw).map_err(|err| format!("Unable to decode workbench snapshot: {err}"))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SaveResult {
    project_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MigrationBackupResult {
    backup_path: String,
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
struct TrustedCharacterReferenceResult {
    base64_data: String,
    byte_length: usize,
    image_format: String,
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
struct ComfyMaintenanceResult {
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
    let desktop = app
        .path()
        .desktop_dir()
        .map_err(|err| format!("Unable to resolve desktop dir: {err}"))?;
    let root = desktop.join("小说").join("应用项目");
    fs::create_dir_all(&root).map_err(|err| format!("Unable to create workspace dir: {err}"))?;
    Ok(root)
}

fn current_project_marker_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|err| format!("Unable to resolve app data dir: {err}"))?;
    fs::create_dir_all(&root).map_err(|err| format!("Unable to create app data dir: {err}"))?;
    Ok(root.join("current-project.txt"))
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
    let workspace = fs::canonicalize(workspace_root_dir(app)?)
        .map_err(|err| format!("Unable to resolve workspace dir: {err}"))?;
    let marker = current_project_marker_path(app)?;
    if marker.exists() {
        let raw = fs::read_to_string(&marker)
            .map_err(|err| format!("Unable to read current project marker: {err}"))?;
        let selected = PathBuf::from(raw.trim());
        if selected.exists() {
            if let Ok(canonical_selected) = fs::canonicalize(&selected) {
                if canonical_selected.starts_with(&workspace) {
                    return Ok(canonical_selected);
                }
            }
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
                tags_json TEXT NOT NULL,
                extra_json TEXT NOT NULL DEFAULT '{}'
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
                shot_history_json TEXT NOT NULL,
                workbench_snapshot_json TEXT NOT NULL DEFAULT '{}'
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

fn ensure_snapshot_meta_workbench_column(connection: &Connection) -> Result<(), String> {
    let mut statement = connection
        .prepare("PRAGMA table_info(snapshot_meta)")
        .map_err(|err| format!("Failed to inspect snapshot_meta schema: {err}"))?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|err| format!("Failed to read snapshot_meta schema rows: {err}"))?;
    let mut has_workbench_snapshot = false;
    for column_name in rows {
        if column_name.map_err(|err| format!("Failed to decode schema row: {err}"))?
            == "workbench_snapshot_json"
        {
            has_workbench_snapshot = true;
        }
    }
    if !has_workbench_snapshot {
        connection
            .execute(
                "ALTER TABLE snapshot_meta ADD COLUMN workbench_snapshot_json TEXT NOT NULL DEFAULT '{}'",
                [],
            )
            .map_err(|err| format!("Failed to add workbench_snapshot_json column: {err}"))?;
    }
    Ok(())
}

fn ensure_shots_extra_json_column(connection: &Connection) -> Result<(), String> {
    let mut statement = connection
        .prepare("PRAGMA table_info(shots)")
        .map_err(|err| format!("Failed to inspect shots schema: {err}"))?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|err| format!("Failed to read shots schema rows: {err}"))?;
    let mut has_extra_json = false;
    for column_name in rows {
        if column_name.map_err(|err| format!("Failed to decode shots schema row: {err}"))?
            == "extra_json"
        {
            has_extra_json = true;
        }
    }
    if !has_extra_json {
        connection
            .execute(
                "ALTER TABLE shots ADD COLUMN extra_json TEXT NOT NULL DEFAULT '{}'",
                [],
            )
            .map_err(|err| format!("Failed to add shots extra_json column: {err}"))?;
    }
    Ok(())
}

const SHOT_BASE_FIELD_KEYS: [&str; 8] = [
    "id",
    "sequenceId",
    "order",
    "title",
    "durationFrames",
    "dialogue",
    "notes",
    "tags",
];

fn is_shot_base_field_key(key: &str) -> bool {
    SHOT_BASE_FIELD_KEYS.contains(&key)
}

fn sanitized_shot_extra_fields(
    extra_fields: &HashMap<String, serde_json::Value>,
) -> HashMap<String, serde_json::Value> {
    extra_fields
        .iter()
        .filter(|(key, _)| !is_shot_base_field_key(key))
        .map(|(key, value)| (key.clone(), value.clone()))
        .collect()
}

fn serialize_shot_extra_fields(shot: &ShotPayload) -> Result<String, String> {
    serde_json::to_string(&sanitized_shot_extra_fields(&shot.extra_fields))
        .map_err(|err| format!("Unable to serialize shot extra fields: {err}"))
}

fn deserialize_shot_extra_fields(
    raw: &str,
) -> rusqlite::Result<HashMap<String, serde_json::Value>> {
    let parsed: HashMap<String, serde_json::Value> = serde_json::from_str(raw).map_err(|err| {
        rusqlite::Error::FromSqlConversionFailure(8, rusqlite::types::Type::Text, Box::new(err))
    })?;
    Ok(sanitized_shot_extra_fields(&parsed))
}

fn replace_shots(
    transaction: &rusqlite::Transaction<'_>,
    shots: &[ShotPayload],
) -> Result<(), String> {
    transaction
        .execute("DELETE FROM shots", [])
        .map_err(|err| format!("Unable to clear shots table: {err}"))?;
    for shot in shots {
        let tags_json = serde_json::to_string(&shot.tags)
            .map_err(|err| format!("Unable to serialize shot tags: {err}"))?;
        let extra_json = serialize_shot_extra_fields(shot)?;
        transaction
            .execute(
                "INSERT INTO shots (id, sequence_id, shot_order, title, duration_frames, dialogue, notes, tags_json, extra_json) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    &shot.id,
                    &shot.sequence_id,
                    shot.order,
                    &shot.title,
                    shot.duration_frames,
                    &shot.dialogue,
                    &shot.notes,
                    tags_json,
                    extra_json
                ],
            )
            .map_err(|err| format!("Unable to write shot row: {err}"))?;
    }
    Ok(())
}

fn load_shots(connection: &Connection) -> Result<Vec<ShotPayload>, String> {
    let mut statement = connection
        .prepare(
            "SELECT id, sequence_id, shot_order, title, duration_frames, dialogue, notes, tags_json, extra_json
             FROM shots
             ORDER BY shot_order ASC",
        )
        .map_err(|err| format!("Unable to prepare shots query: {err}"))?;
    let rows = statement
        .query_map([], |row| {
            let tags_json: String = row.get(7)?;
            let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();
            let extra_json: String = row.get(8)?;
            let extra_fields = deserialize_shot_extra_fields(&extra_json)?;
            Ok(ShotPayload {
                id: row.get(0)?,
                sequence_id: row.get(1)?,
                order: row.get(2)?,
                title: row.get(3)?,
                duration_frames: row.get(4)?,
                dialogue: row.get(5)?,
                notes: row.get(6)?,
                tags,
                extra_fields,
            })
        })
        .map_err(|err| format!("Unable to query shots: {err}"))?;
    let mut shots = Vec::new();
    for row in rows {
        shots.push(row.map_err(|err| format!("Unable to decode shot row: {err}"))?);
    }
    Ok(shots)
}

#[tauri::command]
fn create_migration_backup(
    app: tauri::AppHandle,
    snapshot: serde_json::Value,
    destination: String,
) -> Result<MigrationBackupResult, String> {
    if destination != "current-project" {
        return Err("Migration backup destination must be the current project".to_string());
    }
    let project_dir = resolve_current_project_dir(&app)?;
    let backup_dir = project_dir.join("migration-backups");
    fs::create_dir_all(&backup_dir)
        .map_err(|err| format!("Unable to create migration backup directory: {err}"))?;
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|err| format!("Unable to create migration backup timestamp: {err}"))?
        .as_millis();
    let backup_path = backup_dir.join(format!("migration-backup-{timestamp}.json"));
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&backup_path)
        .map_err(|err| format!("Unable to create migration backup: {err}"))?;
    let payload = serde_json::json!({
        "schemaVersion": 1,
        "exportedAtUnixMillis": timestamp,
        "snapshot": snapshot
    });
    serde_json::to_writer_pretty(&mut file, &payload)
        .map_err(|err| format!("Unable to serialize migration backup: {err}"))?;
    file.write_all(b"\n")
        .map_err(|err| format!("Unable to finalize migration backup: {err}"))?;
    Ok(MigrationBackupResult {
        backup_path: backup_path.to_string_lossy().to_string(),
    })
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
        let name =
            column_name.map_err(|err| format!("Failed to decode assets schema row: {err}"))?;
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
        let name = column_name
            .map_err(|err| format!("Failed to decode audio_tracks schema row: {err}"))?;
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
    ensure_snapshot_meta_workbench_column(&connection)?;
    ensure_shots_extra_json_column(&connection)?;
    ensure_assets_voice_profile_column(&connection)?;
    ensure_audio_track_metadata_columns(&connection)?;

    let transaction = connection
        .transaction()
        .map_err(|err| format!("Unable to start transaction: {err}"))?;

    transaction
        .execute("DELETE FROM projects", [])
        .map_err(|err| format!("Unable to clear projects table: {err}"))?;
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

    replace_shots(&transaction, &snapshot.shots)?;

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
    let workbench_snapshot_json = serialize_workbench_snapshot(&snapshot)?;

    transaction
        .execute(
            "INSERT INTO snapshot_meta (id, selected_shot_id, active_layer_by_shot_json, canvas_tool_json, export_settings_json, shot_strokes_json, shot_history_json, workbench_snapshot_json) VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(id) DO UPDATE SET
               selected_shot_id=excluded.selected_shot_id,
               active_layer_by_shot_json=excluded.active_layer_by_shot_json,
               canvas_tool_json=excluded.canvas_tool_json,
               export_settings_json=excluded.export_settings_json,
               shot_strokes_json=excluded.shot_strokes_json,
               shot_history_json=excluded.shot_history_json,
               workbench_snapshot_json=excluded.workbench_snapshot_json",
            params![
                &snapshot.selected_shot_id,
                active_layer_by_shot_json,
                canvas_tool_json,
                export_settings_json,
                shot_strokes_json,
                shot_history_json,
                workbench_snapshot_json
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
    ensure_snapshot_meta_workbench_column(&connection)?;
    ensure_shots_extra_json_column(&connection)?;
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

    let shots = load_shots(&connection)?;

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
            "SELECT selected_shot_id, active_layer_by_shot_json, canvas_tool_json, export_settings_json, shot_strokes_json, shot_history_json, workbench_snapshot_json FROM snapshot_meta WHERE id = 1",
            [],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, String>(6)?,
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
        workbench_snapshot_json,
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
    let workbench_snapshot = deserialize_workbench_snapshot(&workbench_snapshot_json)?;

    Ok(Some(StoryboardSnapshotPayload {
        schema_version: workbench_snapshot.schema_version,
        migration_backup_pending: workbench_snapshot.migration_backup_pending,
        director_plan: workbench_snapshot.director_plan,
        spatial_scenes: workbench_snapshot.spatial_scenes,
        spatial_objects: workbench_snapshot.spatial_objects,
        pose_keyframes: workbench_snapshot.pose_keyframes,
        camera_plans: workbench_snapshot.camera_plans,
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
        extra_snapshot_fields: workbench_snapshot.extra_snapshot_fields,
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
    for path in &video_paths {
        video_continuity::reject_authority_file_command_path(&app, path)?;
    }
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
            return Err(format!(
                "Video concat failed with status code {:?}",
                status.code()
            ));
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

        Ok(ExportResult {
            output_path: output,
        })
    })();

    let _ = fs::remove_dir_all(&temp_dir);
    result
}

#[tauri::command]
fn mux_video_with_audio_tracks(
    app: tauri::AppHandle,
    video_path: String,
    video_assembly_receipt: Option<video_continuity::AssemblyReceipt>,
    fps: i64,
    audio_tracks: Vec<AudioTrackPayload>,
) -> Result<ExportResult, String> {
    let input_video_path = match video_assembly_receipt.as_ref() {
        Some(receipt) => {
            let verified = video_continuity::verify_assembly_receipt_for_app(&app, receipt)?;
            if verified != fs::canonicalize(video_path.trim())
                .map_err(|_| "video_assembly_output_binding_mismatch".to_string())?
            {
                return Err("video_assembly_output_binding_mismatch".to_string());
            }
            verified
        }
        None => {
            video_continuity::reject_authority_file_command_path(&app, &video_path)?;
            PathBuf::from(video_path.trim())
        }
    };
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

    Ok(ExportResult {
        output_path: output,
    })
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
        valid_audio.push((
            track.file_path.clone(),
            track.start_frame.max(0),
            track.gain.max(0.0),
        ));
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

    Ok(ExportResult {
        output_path: output,
    })
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
    video_continuity::reject_authority_file_command_path(&app, &primary_image_path)?;
    if let Some(path) = secondary_image_path.as_deref() {
        video_continuity::reject_authority_file_command_path(&app, path)?;
    }
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
                        message: format!(
                            "Local single-frame video failed with status {:?}",
                            status.code()
                        ),
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
                        message: format!(
                            "Local first-last video failed with status {:?}",
                            status.code()
                        ),
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
        .map_err(|err| format!("鍒涘缓 Comfy 瀹㈡埛绔け璐? {err}"))
}

#[tauri::command]
fn comfy_ping(base_url: String) -> Result<ComfyPingResult, String> {
    let base = normalize_base_url(&base_url);
    let client = comfy_http_client(6)?;
    let checks = ["/queue", "/object_info"];
    for path in checks {
        let url = format!("{base}{path}");
        let response = client.get(&url).send();
        if let Ok(resp) = response {
            let status = resp.status();
            if status.is_success() || status.as_u16() == 401 || status.as_u16() == 403 {
                return Ok(ComfyPingResult {
                    ok: true,
                    status_code: Some(status.as_u16()),
                    message: format!("ComfyUI available: {url} [tauri_queue_first_v2]"),
                });
            }
        }
    }
    let url = format!("{base}/queue");
    let response = client.get(&url).send();
    match response {
        Ok(resp) => Ok(ComfyPingResult {
            ok: false,
            status_code: Some(resp.status().as_u16()),
            message: format!("ComfyUI 杩斿洖 HTTP {}", resp.status().as_u16()),
        }),
        Err(err) => Ok(ComfyPingResult {
            ok: false,
            status_code: None,
            message: format!("杩炴帴澶辫触: {err}"),
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
        .map_err(|err| format!("鎻愪氦 Comfy 浠诲姟澶辫触: {err}"))?;
    if !resp.status().is_success() {
        let code = resp.status().as_u16();
        let body = resp.text().unwrap_or_else(|_| "".to_string());
        return Err(format!("鎻愪氦 Comfy 浠诲姟澶辫触: HTTP {code} {body}"));
    }
    let value: serde_json::Value = resp
        .json()
        .map_err(|err| format!("瑙ｆ瀽 Comfy 鍝嶅簲澶辫触: {err}"))?;
    let prompt_id = value
        .get("prompt_id")
        .and_then(|item| item.as_str())
        .unwrap_or("")
        .to_string();
    if prompt_id.is_empty() {
        return Err("Comfy 鏈繑鍥?prompt_id".to_string());
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
        .map_err(|err| format!("璇诲彇 Comfy history 澶辫触: {err}"))?;
    if !resp.status().is_success() {
        return Err(format!(
            "璇诲彇 Comfy history 澶辫触: HTTP {}",
            resp.status().as_u16()
        ));
    }
    resp.json()
        .map_err(|err| format!("瑙ｆ瀽 Comfy history 澶辫触: {err}"))
}

#[tauri::command]
fn comfy_maintenance(
    base_url: String,
    path: String,
    payload: Option<serde_json::Value>,
) -> Result<ComfyMaintenanceResult, String> {
    let normalized_path = path.trim().to_string();
    if normalized_path != "/interrupt" && normalized_path != "/free" {
        return Err(format!(
            "Unsupported comfy maintenance path: {}",
            normalized_path
        ));
    }
    let url = format!("{}{}", normalize_base_url(&base_url), normalized_path);
    let client = comfy_http_client(12)?;
    let body = payload.unwrap_or_else(|| serde_json::json!({}));
    let response = client
        .post(&url)
        .json(&body)
        .send()
        .map_err(|err| format!("Comfy maintenance request failed: {err}"))?;
    let status = response.status().as_u16();
    let status_ok = response.status().is_success();
    let response_text = response.text().unwrap_or_else(|_| "".to_string());
    Ok(ComfyMaintenanceResult {
        ok: status_ok,
        status_code: Some(status),
        message: if status_ok {
            format!("HTTP {}", status)
        } else if response_text.trim().is_empty() {
            format!("HTTP {}", status)
        } else {
            format!("HTTP {} {}", status, response_text)
                .chars()
                .take(240)
                .collect()
        },
    })
}

#[tauri::command]
fn comfy_fetch_view_base64(url: String) -> Result<String, String> {
    let target = url.trim();
    if target.is_empty() {
        return Err("url 涓嶈兘涓虹┖".to_string());
    }
    let client = comfy_http_client(30)?;
    let bytes = client
        .get(target)
        .send()
        .and_then(|resp| resp.error_for_status())
        .map_err(|err| format!("涓嬭浇 Comfy 鍥惧儚澶辫触: {err}"))?
        .bytes()
        .map_err(|err| format!("璇诲彇 Comfy 鍥惧儚瀛楄妭澶辫触: {err}"))?;
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
        let checks = ["/queue", "/object_info"];
        let mut ok = false;
        for path in checks {
            let url = format!("{base}{path}");
            if let Ok(resp) = client.get(&url).send() {
                if resp.status().is_success()
                    || resp.status().as_u16() == 401
                    || resp.status().as_u16() == 403
                {
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
fn comfy_install_plugins(
    comfy_root_dir: String,
    repos: Vec<String>,
) -> Result<PluginInstallResult, String> {
    let comfy_root = PathBuf::from(comfy_root_dir.trim());
    if !comfy_root.exists() || !comfy_root.is_dir() {
        return Err(format!(
            "ComfyUI 鏍圭洰褰曟棤鏁? {}",
            comfy_root.to_string_lossy()
        ));
    }
    let custom_nodes_dir = comfy_root.join("custom_nodes");
    fs::create_dir_all(&custom_nodes_dir)
        .map_err(|err| format!("鍒涘缓 custom_nodes 鐩綍澶辫触: {err}"))?;
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
                error: "浠呮敮鎸?https://github.com/ 寮€澶寸殑浠撳簱鍦板潃".to_string(),
            });
            continue;
        }
        let Some(dir_name) = repo_dir_name(&repo) else {
            failed.push(PluginInstallFailure {
                repo: repo.clone(),
                error: "Unable to infer the repository directory name".to_string(),
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
                .map_err(|err| format!("鎵ц git pull 澶辫触: {err}"))
        } else {
            Command::new("git")
                .arg("clone")
                .arg("--depth=1")
                .arg(&repo)
                .arg(&target_dir)
                .status()
                .map_err(|err| format!("鎵ц git clone 澶辫触: {err}"))
        };

        match git_status {
            Ok(status) if status.success() => {}
            Ok(status) => {
                failed.push(PluginInstallFailure {
                    repo: repo.clone(),
                    error: format!("git 閫€鍑虹爜寮傚父: {:?}", status.code()),
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
                    .map_err(|err| format!("瀹夎渚濊禆澶辫触: {err}"));
                match pip_status {
                    Ok(status) if status.success() => {}
                    Ok(status) => {
                        failed.push(PluginInstallFailure {
                            repo: repo.clone(),
                            error: format!("pip 閫€鍑虹爜寮傚父: {:?}", status.code()),
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
                skipped.push(format!(
                    "{dir_name}锛堟湭妫€娴嬪埌 .venv/bin/python锛岃烦杩囦緷璧栧畨瑁咃級"
                ));
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
            "ComfyUI 鏍圭洰褰曟棤鏁? {}",
            comfy_root.to_string_lossy()
        ));
    }
    let model_root = comfy_root.join("models");
    let checks_spec = vec![
        (
            "checkpoints",
            "Base model checkpoints",
            true,
            model_root.join("checkpoints"),
        ),
        ("vae", "VAE", false, model_root.join("vae")),
        ("loras", "Lora", false, model_root.join("loras")),
        (
            "controlnet",
            "ControlNet",
            false,
            model_root.join("controlnet"),
        ),
        (
            "ipadapter",
            "IPAdapter",
            false,
            model_root.join("ipadapter"),
        ),
        (
            "clip_vision",
            "CLIP Vision",
            false,
            model_root.join("clip_vision"),
        ),
        (
            "animatediff_models",
            "AnimateDiff Motion Models",
            false,
            model_root.join("animatediff_models"),
        ),
        (
            "animatediff_models_plugin",
            "AnimateDiff 鎻掍欢 Models",
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
        .map_err(|err| format!("璇诲彇 Comfy object_info 澶辫触: {err}"))?;
    if !resp.status().is_success() {
        return Err(format!(
            "璇诲彇 Comfy object_info 澶辫触: HTTP {}",
            resp.status().as_u16()
        ));
    }
    resp.json()
        .map_err(|err| format!("瑙ｆ瀽 Comfy object_info 澶辫触: {err}"))
}

#[tauri::command]
fn write_base64_file(
    app: tauri::AppHandle,
    file_path: String,
    base64_data: String,
) -> Result<FileWriteResult, String> {
    video_continuity::reject_authority_file_command_path(&app, &file_path)?;
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
fn copy_file_to(
    app: tauri::AppHandle,
    source_path: String,
    target_path: String,
) -> Result<FileWriteResult, String> {
    video_continuity::reject_authority_file_command_path(&app, &source_path)?;
    video_continuity::reject_authority_file_command_path(&app, &target_path)?;
    let source = PathBuf::from(source_path.trim());
    if !source.exists() || !source.is_file() {
        return Err(format!(
            "Source file not found: {}",
            source.to_string_lossy()
        ));
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
    app: tauri::AppHandle,
    source_paths: Vec<String>,
    exclude_paths: Option<Vec<String>>,
) -> Result<DeleteGeneratedFileFamiliesResult, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|_| "normalization_registry_unavailable".to_string())?;
    delete_generated_file_families_at_app_data(&app_data, source_paths, exclude_paths)
}

fn delete_generated_file_families_at_app_data(
    app_data: &Path,
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
            } else if let Some(stripped) =
                strip_trailing_numbered_suffix(&normalized, "_triptych_input_")
            {
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

    let exclude_values = exclude_paths.unwrap_or_default();
    for raw in source_paths.iter().chain(exclude_values.iter()) {
        video_continuity::reject_authority_file_command_path_at_app_data(app_data, raw)?;
    }
    let excludes: HashSet<PathBuf> = exclude_values
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
        video_continuity::reject_authority_file_command_path_at_app_data(
            app_data,
            directory.to_string_lossy().as_ref(),
        )?;
        let entries = match fs::read_dir(&directory) {
            Ok(entries) => entries,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let candidate_path = entry.path();
            if !candidate_path.is_file() || excludes.contains(&candidate_path) {
                continue;
            }
            let Some(file_name) = candidate_path.file_name().and_then(|value| value.to_str())
            else {
                continue;
            };
            if !prefixes
                .iter()
                .any(|prefix| !prefix.is_empty() && file_name.starts_with(prefix))
            {
                continue;
            }
            video_continuity::reject_authority_file_command_path_at_app_data(
                app_data,
                candidate_path.to_string_lossy().as_ref(),
            )?;
            fs::remove_file(&candidate_path).map_err(|err| {
                format!(
                    "Failed to delete generated file {}: {err}",
                    candidate_path.to_string_lossy()
                )
            })?;
            deleted_paths.push(candidate_path.to_string_lossy().to_string());
        }
    }

    Ok(DeleteGeneratedFileFamiliesResult { deleted_paths })
}

fn compute_threeview_sheet_ranges(image: &image::RgbaImage) -> [(u32, u32); 3] {
    let (width, height) = image.dimensions();
    if width < 3 || height == 0 {
        return [(0, width.max(1)), (0, width.max(1)), (0, width.max(1))];
    }

    let mut border_r: u64 = 0;
    let mut border_g: u64 = 0;
    let mut border_b: u64 = 0;
    let mut border_count: u64 = 0;
    let mut sample_border = |x: u32, y: u32| {
        let pixel = image.get_pixel(x, y).0;
        border_r += pixel[0] as u64;
        border_g += pixel[1] as u64;
        border_b += pixel[2] as u64;
        border_count += 1;
    };
    for x in 0..width {
        sample_border(x, 0);
        sample_border(x, height - 1);
    }
    if height > 2 {
        for y in 1..(height - 1) {
            sample_border(0, y);
            sample_border(width - 1, y);
        }
    }
    let bg_r = border_r as f32 / border_count.max(1) as f32;
    let bg_g = border_g as f32 / border_count.max(1) as f32;
    let bg_b = border_b as f32 / border_count.max(1) as f32;
    let threshold_sq = 26.0_f32 * 26.0_f32;

    let mut column_scores = vec![0_u32; width as usize];
    for y in 0..height {
        for x in 0..width {
            let pixel = image.get_pixel(x, y).0;
            if pixel[3] <= 8 {
                continue;
            }
            let dr = pixel[0] as f32 - bg_r;
            let dg = pixel[1] as f32 - bg_g;
            let db = pixel[2] as f32 - bg_b;
            let distance_sq = dr * dr + dg * dg + db * db;
            if distance_sq >= threshold_sq {
                column_scores[x as usize] += 1;
            }
        }
    }

    let smoothing_radius = (((width as f32) / 192.0).round() as i32).clamp(1, 4);
    let mut smoothed_scores = vec![0_u32; width as usize];
    for x in 0..width as i32 {
        let start = (x - smoothing_radius).max(0) as u32;
        let end = (x + smoothing_radius).min(width as i32 - 1) as u32;
        let mut sum: u64 = 0;
        let mut count: u64 = 0;
        for sample_x in start..=end {
            sum += column_scores[sample_x as usize] as u64;
            count += 1;
        }
        smoothed_scores[x as usize] = (sum / count.max(1)) as u32;
    }

    let panel_width = width / 3;
    let fallback_overlap = ((panel_width as f32 * 0.08).round() as u32).clamp(6, 48);
    let fallback_ranges = [
        (0, width.min(panel_width + fallback_overlap).max(1)),
        (
            panel_width.saturating_sub(fallback_overlap),
            width
                .min(panel_width * 2 + fallback_overlap)
                .max(panel_width.saturating_sub(fallback_overlap) + 1),
        ),
        ((panel_width * 2).saturating_sub(fallback_overlap), width),
    ];
    let min_panel_width = ((width as f32) / 5.0).round() as u32;
    let search_radius = ((panel_width as f32 * 0.22).round() as u32).clamp(16, 96);

    let find_separator = |expected: u32, lower_bound: u32, upper_bound: u32| -> u32 {
        let start = lower_bound.max(expected.saturating_sub(search_radius));
        let end = upper_bound
            .min(expected.saturating_add(search_radius))
            .min(width.saturating_sub(2));
        if end <= start {
            return expected.clamp(lower_bound, upper_bound.min(width.saturating_sub(2)));
        }
        let mut best_x = expected.clamp(start, end);
        let mut best_score = u32::MAX;
        let mut best_distance = u32::MAX;
        for x in start..=end {
            let score = smoothed_scores[x as usize];
            let distance = x.abs_diff(expected);
            if score < best_score || (score == best_score && distance < best_distance) {
                best_x = x;
                best_score = score;
                best_distance = distance;
            }
        }
        best_x
    };

    let separator1 = find_separator(
        panel_width,
        12,
        width.saturating_sub(min_panel_width * 2).max(12),
    );
    let separator2 = find_separator(
        panel_width * 2,
        separator1.saturating_add(min_panel_width),
        width.saturating_sub(12),
    );
    if separator2 <= separator1.saturating_add(min_panel_width / 2) {
        return fallback_ranges;
    }

    let padding = ((panel_width as f32 * 0.06).round() as u32).clamp(8, 36);
    let safe_padding = padding.min(separator2.saturating_sub(separator1).saturating_sub(12) / 2);
    let front_end = separator1.saturating_add(safe_padding).min(width);
    let side_start = separator1.saturating_sub(safe_padding);
    let side_end = separator2.saturating_add(safe_padding).min(width);
    let back_start = separator2.saturating_sub(safe_padding);

    if front_end <= 1 || side_end <= side_start + 1 || width <= back_start + 1 {
        return fallback_ranges;
    }

    [(0, front_end), (side_start, side_end), (back_start, width)]
}

fn trusted_character_image_format(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]) {
        return Some("png");
    }
    if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        return Some("jpeg");
    }
    if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        return Some("webp");
    }
    None
}

#[tauri::command]
fn read_trusted_character_reference(
    app: tauri::AppHandle,
    file_path: String,
) -> Result<TrustedCharacterReferenceResult, String> {
    video_continuity::reject_authority_file_command_path(&app, &file_path)?;
    read_trusted_character_reference_file(file_path)
}

fn read_trusted_character_reference_file(
    file_path: String,
) -> Result<TrustedCharacterReferenceResult, String> {
    const MAX_REFERENCE_BYTES: u64 = 40 * 1024 * 1024;
    let requested = PathBuf::from(file_path.trim());
    if requested.as_os_str().is_empty() {
        return Err("reference_path_missing".to_string());
    }
    let canonical =
        fs::canonicalize(&requested).map_err(|_| "reference_read_failed".to_string())?;
    let metadata = fs::metadata(&canonical).map_err(|_| "reference_read_failed".to_string())?;
    if !metadata.file_type().is_file() || metadata.len() == 0 {
        return Err("reference_image_invalid".to_string());
    }
    if metadata.len() > MAX_REFERENCE_BYTES {
        return Err("reference_too_large".to_string());
    }
    let extension = canonical
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !matches!(extension.as_str(), "png" | "jpg" | "jpeg" | "webp") {
        return Err("reference_image_invalid".to_string());
    }
    let bytes = fs::read(&canonical).map_err(|_| "reference_read_failed".to_string())?;
    if bytes.is_empty() || bytes.len() as u64 > MAX_REFERENCE_BYTES {
        let reason = if bytes.is_empty() {
            "reference_image_invalid"
        } else {
            "reference_too_large"
        };
        return Err(reason.to_string());
    }
    let image_format = trusted_character_image_format(&bytes)
        .ok_or_else(|| "reference_image_invalid".to_string())?;
    let extension_matches = match extension.as_str() {
        "png" => image_format == "png",
        "jpg" | "jpeg" => image_format == "jpeg",
        "webp" => image_format == "webp",
        _ => false,
    };
    if !extension_matches {
        return Err("reference_image_invalid".to_string());
    }
    Ok(TrustedCharacterReferenceResult {
        base64_data: base64::engine::general_purpose::STANDARD.encode(&bytes),
        byte_length: bytes.len(),
        image_format: image_format.to_string(),
    })
}

const MAX_CHARACTER_EVIDENCE_INPUT_BYTES: usize = 10 * 1024 * 1024;
const MAX_CHARACTER_EVIDENCE_IMAGE_BYTES: u64 = 40 * 1024 * 1024;
const MAX_CHARACTER_ATTESTOR_OUTPUT_BYTES: usize = 1024 * 1024;
const CHARACTER_ATTESTOR_DEADLINE: Duration = Duration::from_secs(120);

fn valid_receipt_id(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn kill_attestor_tree(child: &mut std::process::Child) {
    #[cfg(windows)]
    {
        let _ = Command::new("taskkill")
            .args(["/PID", &child.id().to_string(), "/T", "/F"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    let _ = child.kill();
    let _ = child.wait();
}

fn read_attestor_pipe<R: Read + Send + 'static>(
    mut pipe: R,
    exceeded: Arc<AtomicBool>,
) -> thread::JoinHandle<Result<Vec<u8>, String>> {
    thread::spawn(move || {
        let mut output = Vec::new();
        let mut chunk = [0_u8; 8192];
        loop {
            let count = pipe
                .read(&mut chunk)
                .map_err(|_| "attestor_failed".to_string())?;
            if count == 0 {
                return Ok(output);
            }
            if output.len().saturating_add(count) > MAX_CHARACTER_ATTESTOR_OUTPUT_BYTES {
                exceeded.store(true, Ordering::SeqCst);
                return Err("attestor_output_too_large".to_string());
            }
            output.extend_from_slice(&chunk[..count]);
        }
    })
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|_| "receipt_artifact_read_failed".to_string())?;
    if bytes.is_empty() || bytes.len() as u64 > MAX_CHARACTER_EVIDENCE_IMAGE_BYTES {
        return Err("receipt_artifact_invalid".to_string());
    }
    let mut digest = Sha256::new();
    digest.update(&bytes);
    Ok(digest
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect())
}

fn validate_receipt_image_path(
    path_value: &str,
    root: Option<&Path>,
    expected_sha: &str,
) -> Result<PathBuf, String> {
    let requested = PathBuf::from(path_value.trim());
    if requested.as_os_str().is_empty() || !requested.is_absolute() {
        return Err("receipt_path_invalid".to_string());
    }
    let canonical = fs::canonicalize(&requested).map_err(|_| "receipt_path_invalid".to_string())?;
    if let Some(required_root) = root {
        if canonical == required_root || !canonical.starts_with(required_root) {
            return Err("receipt_path_invalid".to_string());
        }
    }
    let metadata = fs::metadata(&canonical).map_err(|_| "receipt_artifact_invalid".to_string())?;
    if !metadata.is_file()
        || metadata.len() == 0
        || metadata.len() > MAX_CHARACTER_EVIDENCE_IMAGE_BYTES
    {
        return Err("receipt_artifact_invalid".to_string());
    }
    let extension = canonical
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !matches!(extension.as_str(), "png" | "jpg" | "jpeg" | "webp") {
        return Err("receipt_artifact_invalid".to_string());
    }
    let bytes = fs::read(&canonical).map_err(|_| "receipt_artifact_read_failed".to_string())?;
    let format = trusted_character_image_format(&bytes)
        .ok_or_else(|| "receipt_artifact_invalid".to_string())?;
    let extension_matches = match extension.as_str() {
        "png" => format == "png",
        "jpg" | "jpeg" => format == "jpeg",
        "webp" => format == "webp",
        _ => false,
    };
    if !extension_matches {
        return Err("receipt_artifact_invalid".to_string());
    }
    if expected_sha.len() != 64 || sha256_file(&canonical)? != expected_sha.to_ascii_lowercase() {
        return Err("receipt_artifact_hash_mismatch".to_string());
    }
    Ok(canonical)
}

fn prevalidate_character_attestation_report(report: &serde_json::Value) -> Result<(), String> {
    let bundle = report
        .get("verificationBundle")
        .and_then(|value| value.as_object())
        .ok_or_else(|| "receipt_verification_bundle_missing".to_string())?;
    let root_value = bundle
        .get("artifactRoot")
        .and_then(|value| value.as_str())
        .ok_or_else(|| "receipt_path_invalid".to_string())?;
    let artifact_root =
        fs::canonicalize(root_value).map_err(|_| "receipt_path_invalid".to_string())?;
    if !artifact_root.is_dir() {
        return Err("receipt_path_invalid".to_string());
    }
    let shots = report
        .get("shots")
        .and_then(|value| value.as_array())
        .ok_or_else(|| "receipt_shot_invalid".to_string())?;
    let outputs = bundle
        .get("outputs")
        .and_then(|value| value.as_array())
        .ok_or_else(|| "receipt_verification_bundle_missing".to_string())?;
    if shots.len() != 8 || outputs.len() != 8 {
        return Err("receipt_verification_bundle_missing".to_string());
    }
    let shot_ids: HashSet<&str> = shots
        .iter()
        .filter_map(|shot| shot.get("id").and_then(|value| value.as_str()))
        .collect();
    let output_ids: HashSet<&str> = outputs
        .iter()
        .filter_map(|output| output.get("id").and_then(|value| value.as_str()))
        .collect();
    if shot_ids.len() != 8 || output_ids != shot_ids {
        return Err("receipt_shot_invalid".to_string());
    }
    for output in outputs {
        let id = output
            .get("id")
            .and_then(|value| value.as_str())
            .ok_or_else(|| "receipt_shot_invalid".to_string())?;
        let output_path = output
            .get("outputPath")
            .and_then(|value| value.as_str())
            .ok_or_else(|| "receipt_path_invalid".to_string())?;
        let output_sha = output
            .get("outputSha256")
            .and_then(|value| value.as_str())
            .ok_or_else(|| "receipt_output_hash_mismatch".to_string())?;
        let shot_sha = shots
            .iter()
            .find(|shot| shot.get("id").and_then(|value| value.as_str()) == Some(id))
            .and_then(|shot| shot.get("outputSha256"))
            .and_then(|value| value.as_str())
            .ok_or_else(|| "receipt_shot_invalid".to_string())?;
        if output_sha != shot_sha {
            return Err("receipt_output_hash_mismatch".to_string());
        }
        validate_receipt_image_path(output_path, Some(&artifact_root), output_sha)?;
    }
    let references = bundle
        .get("references")
        .and_then(|value| value.as_array())
        .ok_or_else(|| "receipt_verification_bundle_missing".to_string())?;
    let expected_slots = ["front", "side", "back"];
    if references.len() != expected_slots.len()
        || references.iter().enumerate().any(|(index, item)| {
            item.get("slot").and_then(|value| value.as_str()) != Some(expected_slots[index])
        })
    {
        return Err("receipt_reference_invalid".to_string());
    }
    for reference in references {
        let source_path = reference
            .get("sourcePath")
            .and_then(|value| value.as_str())
            .ok_or_else(|| "receipt_path_invalid".to_string())?;
        let source_sha = reference
            .get("sourceSha256")
            .and_then(|value| value.as_str())
            .ok_or_else(|| "receipt_reference_hash_mismatch".to_string())?;
        validate_receipt_image_path(source_path, None, source_sha)?;
    }
    let routed = report
        .get("references")
        .and_then(|value| value.as_array())
        .ok_or_else(|| "receipt_reference_evidence_mismatch".to_string())?;
    if routed.len() != 16 {
        return Err("receipt_reference_evidence_mismatch".to_string());
    }
    let identity = bundle
        .get("identityContext")
        .and_then(|value| value.as_object())
        .ok_or_else(|| "receipt_identity_context_mismatch".to_string())?;
    let subject = report
        .get("subject")
        .and_then(|value| value.as_object())
        .ok_or_else(|| "receipt_identity_context_mismatch".to_string())?;
    for field in [
        "characterAssetId",
        "identityPackVersion",
        "identityMetadataDigest",
    ] {
        if identity.get(field) != subject.get(field) {
            return Err("receipt_identity_context_mismatch".to_string());
        }
    }
    Ok(())
}

fn resolve_comfy_python(comfy_root_dir: &str) -> Result<PathBuf, String> {
    let root = fs::canonicalize(PathBuf::from(comfy_root_dir.trim()))
        .map_err(|_| "comfy_root_invalid".to_string())?;
    let candidates = if cfg!(windows) {
        vec![root.join(".venv").join("Scripts").join("python.exe")]
    } else {
        vec![
            root.join(".venv").join("bin").join("python3"),
            root.join(".venv").join("bin").join("python"),
        ]
    };
    candidates
        .into_iter()
        .find(|candidate| candidate.is_file() && candidate.starts_with(&root))
        .ok_or_else(|| "comfy_python_missing".to_string())
}

fn character_attestor_script(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let resource = app
        .path()
        .resource_dir()
        .map_err(|_| "attestor_resource_missing".to_string())?
        .join("scripts")
        .join("evaluators")
        .join("siglip2-character-attestor.py");
    let development = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("scripts")
        .join("evaluators")
        .join("siglip2-character-attestor.py");
    [resource, development]
        .into_iter()
        .find_map(|candidate| fs::canonicalize(candidate).ok())
        .filter(|path| path.is_file())
        .ok_or_else(|| "attestor_resource_missing".to_string())
}

fn character_evaluator_model_dir(comfy_root_dir: &str) -> Result<PathBuf, String> {
    let root =
        fs::canonicalize(comfy_root_dir.trim()).map_err(|_| "comfy_root_invalid".to_string())?;
    let mut candidates = vec![root
        .join("models")
        .join("character_evaluators")
        .join("siglip2-base-patch16-224-75de2d5")];
    for ancestor in root.ancestors() {
        if ancestor
            .file_name()
            .and_then(|value| value.to_str())
            .map(|value| value.eq_ignore_ascii_case("ComfyUI-Installs"))
            .unwrap_or(false)
        {
            if let Some(parent) = ancestor.parent() {
                candidates.push(
                    parent
                        .join("ComfyUI-Shared")
                        .join("models")
                        .join("character_evaluators")
                        .join("siglip2-base-patch16-224-75de2d5"),
                );
            }
        }
    }
    candidates
        .into_iter()
        .find_map(|candidate| fs::canonicalize(candidate).ok())
        .filter(|path| path.is_dir())
        .ok_or_else(|| "character_evaluator_model_missing".to_string())
}

fn run_character_attestor(
    app: &tauri::AppHandle,
    operation: &str,
    payload: serde_json::Value,
    comfy_root_dir: &str,
) -> Result<serde_json::Value, String> {
    let serialized =
        serde_json::to_vec(&payload).map_err(|_| "attestation_input_invalid".to_string())?;
    if serialized.is_empty() || serialized.len() > MAX_CHARACTER_EVIDENCE_INPUT_BYTES {
        return Err("attestation_input_too_large".to_string());
    }
    let python = resolve_comfy_python(comfy_root_dir)?;
    let script = character_attestor_script(app)?;
    let registry = app
        .path()
        .app_data_dir()
        .map_err(|_| "receipt_registry_invalid".to_string())?
        .join("character-evidence")
        .join("receipts");
    fs::create_dir_all(&registry).map_err(|_| "receipt_registry_invalid".to_string())?;
    let model_dir = character_evaluator_model_dir(comfy_root_dir)?;
    let manifest = script
        .parent()
        .and_then(|value| value.parent())
        .and_then(|value| value.parent())
        .ok_or_else(|| "attestor_resource_missing".to_string())?
        .join("examples")
        .join("character-consistency-benchmark")
        .join("siglip2-snapshot-manifest.json");
    let mut child = Command::new(python)
        .arg(&script)
        .arg(operation)
        .arg(&registry)
        .env("CHARACTER_EVALUATOR_MODEL_DIR", model_dir)
        .env("CHARACTER_EVALUATOR_SNAPSHOT_MANIFEST", manifest)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|_| "attestor_start_failed".to_string())?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "attestor_start_failed".to_string())?;
    let writer = thread::spawn(move || -> Result<(), String> {
        stdin
            .write_all(&serialized)
            .map_err(|_| "attestor_write_failed".to_string())?;
        stdin
            .flush()
            .map_err(|_| "attestor_write_failed".to_string())
    });
    let exceeded = Arc::new(AtomicBool::new(false));
    let stdout_reader = read_attestor_pipe(
        child
            .stdout
            .take()
            .ok_or_else(|| "attestor_start_failed".to_string())?,
        Arc::clone(&exceeded),
    );
    let stderr_reader = read_attestor_pipe(
        child
            .stderr
            .take()
            .ok_or_else(|| "attestor_start_failed".to_string())?,
        Arc::clone(&exceeded),
    );
    let started = Instant::now();
    let status = loop {
        if exceeded.load(Ordering::SeqCst) {
            kill_attestor_tree(&mut child);
            break Err("attestor_output_too_large".to_string());
        }
        if started.elapsed() >= CHARACTER_ATTESTOR_DEADLINE {
            kill_attestor_tree(&mut child);
            break Err("attestor_timeout".to_string());
        }
        match child.try_wait() {
            Ok(Some(status)) => break Ok(status),
            Ok(None) => thread::sleep(Duration::from_millis(20)),
            Err(_) => {
                kill_attestor_tree(&mut child);
                break Err("attestor_failed".to_string());
            }
        }
    }?;
    writer
        .join()
        .map_err(|_| "attestor_write_failed".to_string())??;
    let stdout = stdout_reader
        .join()
        .map_err(|_| "attestor_failed".to_string())??;
    let stderr = stderr_reader
        .join()
        .map_err(|_| "attestor_failed".to_string())??;
    if !status.success() {
        let parsed = serde_json::from_slice::<serde_json::Value>(&stderr)
            .ok()
            .and_then(|value| {
                value
                    .get("error")
                    .and_then(|item| item.as_str())
                    .map(str::to_string)
            });
        return Err(parsed.unwrap_or_else(|| "attestor_failed".to_string()));
    }
    serde_json::from_slice(&stdout).map_err(|_| "attestor_protocol_invalid".to_string())
}

#[tauri::command]
fn attest_character_generation_report(
    app: tauri::AppHandle,
    report: serde_json::Value,
    comfy_root_dir: String,
) -> Result<serde_json::Value, String> {
    prevalidate_character_attestation_report(&report)?;
    run_character_attestor(
        &app,
        "attest",
        serde_json::json!({ "report": report }),
        &comfy_root_dir,
    )
}

#[tauri::command]
fn verify_character_evidence_receipt(
    app: tauri::AppHandle,
    receipt: serde_json::Value,
    evidence: serde_json::Value,
    comfy_root_dir: String,
) -> Result<serde_json::Value, String> {
    let receipt_id = receipt
        .get("receiptId")
        .and_then(|value| value.as_str())
        .ok_or_else(|| "trusted_receipt_invalid".to_string())?;
    if !valid_receipt_id(receipt_id) {
        return Err("trusted_receipt_invalid".to_string());
    }
    run_character_attestor(
        &app,
        "verify",
        serde_json::json!({ "receipt": receipt, "evidence": evidence }),
        &comfy_root_dir,
    )
}

#[cfg(test)]
mod persistence_tests {
    use super::*;

    #[test]
    fn sqlite_shot_roundtrip_preserves_storyboard_and_video_fields() {
        let rich_shot = serde_json::json!({
            "id": "C01",
            "sequenceId": "sequence-e01",
            "order": 0,
            "title": "棺中惊醒",
            "durationFrames": 120,
            "dialogue": "",
            "notes": "",
            "tags": ["棺中"],
            "storyPrompt": "李宝珠在黑暗棺木中骤然睁眼",
            "imagePrompt": "cinematic coffin interior",
            "videoPrompt": "slow push in, shallow breathing",
            "codexReferenceBindings": [
                { "assetId": "character-li-baozhu", "usage": "identity" },
                { "assetId": "scene-coffin-interior", "usage": "environment" }
            ],
            "generatedImagePath": "",
            "generatedVideoPath": "C:/sample/C01.mp4",
            "videoStatus": "blocked",
            "codexStoryboardSemanticProfile": "yingdi_e01_c22_ots_insert",
            "futureShotField": { "retained": true }
        });
        let shot: ShotPayload = serde_json::from_value(rich_shot.clone()).unwrap();
        let mut connection = Connection::open_in_memory().unwrap();
        initialize_db(&connection).unwrap();
        ensure_shots_extra_json_column(&connection).unwrap();
        let transaction = connection.transaction().unwrap();
        replace_shots(&transaction, &[shot]).unwrap();
        transaction.commit().unwrap();

        let persisted_extra: serde_json::Value = connection
            .query_row("SELECT extra_json FROM shots WHERE id = 'C01'", [], |row| row.get::<_, String>(0))
            .map(|raw| serde_json::from_str(&raw).unwrap())
            .unwrap();
        assert_eq!(
            persisted_extra["codexStoryboardSemanticProfile"],
            "yingdi_e01_c22_ots_insert"
        );

        let restored = load_shots(&connection).unwrap().remove(0);
        let restored_json = serde_json::to_value(restored).unwrap();

        for field in [
            "storyPrompt",
            "imagePrompt",
            "videoPrompt",
            "codexReferenceBindings",
            "generatedImagePath",
            "generatedVideoPath",
            "videoStatus",
            "codexStoryboardSemanticProfile",
            "futureShotField",
        ] {
            assert_eq!(
                restored_json.get(field),
                rich_shot.get(field),
                "shot field {field} must survive the SQLite round-trip"
            );
        }
    }

    #[test]
    fn legacy_shots_table_migrates_with_empty_extra_json_default() {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                r#"
                CREATE TABLE shots (
                    id TEXT PRIMARY KEY,
                    sequence_id TEXT NOT NULL,
                    shot_order INTEGER NOT NULL,
                    title TEXT NOT NULL,
                    duration_frames INTEGER NOT NULL,
                    dialogue TEXT NOT NULL,
                    notes TEXT NOT NULL,
                    tags_json TEXT NOT NULL
                );
                INSERT INTO shots VALUES ('legacy', 'sequence', 0, 'Legacy', 24, '', '', '[]');
                "#,
            )
            .unwrap();

        ensure_shots_extra_json_column(&connection).unwrap();
        ensure_shots_extra_json_column(&connection).unwrap();

        let extra_json: String = connection
            .query_row(
                "SELECT extra_json FROM shots WHERE id = 'legacy'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(extra_json, "{}");
        let restored = load_shots(&connection).unwrap();
        assert_eq!(restored.len(), 1);
        assert_eq!(restored[0].id, "legacy");
        assert!(restored[0].extra_fields.is_empty());
    }

    #[test]
    fn shot_save_and_load_keep_base_fields_authoritative_over_conflicting_extra() {
        let mut shot: ShotPayload = serde_json::from_value(serde_json::json!({
            "id": "C01",
            "sequenceId": "sequence-e01",
            "order": 7,
            "title": "Authority title",
            "durationFrames": 120,
            "dialogue": "Authority dialogue",
            "notes": "Authority notes",
            "tags": ["authority"],
            "futureShotField": { "retained": true }
        }))
        .unwrap();
        for key in SHOT_BASE_FIELD_KEYS {
            shot.extra_fields
                .insert(key.to_string(), serde_json::json!("malicious"));
        }
        let mut connection = Connection::open_in_memory().unwrap();
        initialize_db(&connection).unwrap();
        ensure_shots_extra_json_column(&connection).unwrap();
        let transaction = connection.transaction().unwrap();
        replace_shots(&transaction, &[shot]).unwrap();
        transaction.commit().unwrap();

        let persisted_extra: serde_json::Value = connection
            .query_row("SELECT extra_json FROM shots WHERE id = 'C01'", [], |row| {
                row.get::<_, String>(0)
            })
            .map(|raw| serde_json::from_str(&raw).unwrap())
            .unwrap();
        for key in SHOT_BASE_FIELD_KEYS {
            assert!(
                persisted_extra.get(key).is_none(),
                "base key {key} leaked into extra_json"
            );
        }
        assert_eq!(persisted_extra["futureShotField"]["retained"], true);

        connection
            .execute(
                "UPDATE shots SET extra_json = ?1 WHERE id = 'C01'",
                params![serde_json::json!({
                    "title": "Historical conflict",
                    "tags": ["conflict"],
                    "futureShotField": { "retained": true }
                })
                .to_string()],
            )
            .unwrap();
        let restored = load_shots(&connection).unwrap().remove(0);
        let serialized = serde_json::to_string(&restored).unwrap();
        let value: serde_json::Value = serde_json::from_str(&serialized).unwrap();
        assert_eq!(value["title"], "Authority title");
        assert_eq!(value["tags"], serde_json::json!(["authority"]));
        assert_eq!(value["futureShotField"]["retained"], true);
        assert_eq!(serialized.matches("\"title\"").count(), 1);
        assert_eq!(serialized.matches("\"tags\"").count(), 1);
    }

    #[test]
    fn shot_load_fails_closed_for_invalid_non_object_and_null_extra_json() {
        for raw in ["{invalid", "[]"] {
            let connection = Connection::open_in_memory().unwrap();
            initialize_db(&connection).unwrap();
            connection
                .execute(
                    "INSERT INTO shots (id, sequence_id, shot_order, title, duration_frames, dialogue, notes, tags_json, extra_json) VALUES ('bad', 'sequence', 0, 'Bad', 24, '', '', '[]', ?1)",
                    params![raw],
                )
                .unwrap();
            assert!(
                load_shots(&connection).is_err(),
                "extra_json {raw:?} must fail closed"
            );
        }

        let connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                r#"
                CREATE TABLE shots (
                    id TEXT PRIMARY KEY,
                    sequence_id TEXT NOT NULL,
                    shot_order INTEGER NOT NULL,
                    title TEXT NOT NULL,
                    duration_frames INTEGER NOT NULL,
                    dialogue TEXT NOT NULL,
                    notes TEXT NOT NULL,
                    tags_json TEXT NOT NULL,
                    extra_json TEXT
                );
                INSERT INTO shots VALUES ('null-extra', 'sequence', 0, 'Null', 24, '', '', '[]', NULL);
                "#,
            )
            .unwrap();
        assert!(
            load_shots(&connection).is_err(),
            "NULL extra_json must fail closed"
        );
    }

    #[test]
    fn workbench_sqlite_roundtrip_preserves_unknown_fields() {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .execute(
                "CREATE TABLE snapshot_meta (id INTEGER PRIMARY KEY, workbench_snapshot_json TEXT NOT NULL)",
                [],
            )
            .unwrap();
        let mut extra_snapshot_fields = HashMap::new();
        extra_snapshot_fields.insert(
            "futureLegacyField".to_string(),
            serde_json::json!({ "retained": true }),
        );
        let payload = StoryboardSnapshotPayload {
            schema_version: 2,
            migration_backup_pending: true,
            director_plan: serde_json::Value::Null,
            spatial_scenes: vec![],
            spatial_objects: vec![],
            pose_keyframes: vec![],
            camera_plans: vec![],
            project: serde_json::from_value(serde_json::json!({
                "id": "p1", "name": "Project", "fps": 24, "width": 1920,
                "height": 1080, "createdAt": "now", "updatedAt": "now"
            })).unwrap(),
            sequences: vec![],
            shots: vec![],
            layers: vec![],
            assets: vec![],
            audio_tracks: vec![],
            selected_shot_id: String::new(),
            active_layer_by_shot_id: HashMap::new(),
            canvas_tool: serde_json::from_value(serde_json::json!({ "brushColor": "#000", "brushSize": 4 })).unwrap(),
            export_settings: serde_json::from_value(serde_json::json!({ "width": 1920, "height": 1080, "fps": 24, "videoBitrateKbps": 8000 })).unwrap(),
            shot_strokes: HashMap::new(),
            shot_history: HashMap::new(),
            extra_snapshot_fields,
        };
        let serialized = serialize_workbench_snapshot(&payload).unwrap();
        connection
            .execute(
                "INSERT INTO snapshot_meta (id, workbench_snapshot_json) VALUES (1, ?1)",
                params![serialized],
            )
            .unwrap();
        let raw: String = connection
            .query_row("SELECT workbench_snapshot_json FROM snapshot_meta WHERE id = 1", [], |row| row.get(0))
            .unwrap();
        let restored = deserialize_workbench_snapshot(&raw).unwrap();
        assert_eq!(restored.schema_version, 2);
        assert!(restored.migration_backup_pending);
        assert_eq!(restored.extra_snapshot_fields["futureLegacyField"]["retained"], true);
    }
}

#[cfg(test)]
mod trusted_character_reference_tests {
    use super::*;

    #[test]
    fn receipt_ids_are_canonical_lowercase_hashes_only() {
        assert!(valid_receipt_id(&"a".repeat(64)));
        assert!(!valid_receipt_id(&"A".repeat(64)));
        assert!(!valid_receipt_id(&format!("../{}", "a".repeat(61))));
        assert!(!valid_receipt_id(&"g".repeat(64)));
    }

    #[test]
    fn attestor_pipe_reader_fails_closed_at_hard_limit() {
        let exceeded = Arc::new(AtomicBool::new(false));
        let bytes = vec![b'x'; MAX_CHARACTER_ATTESTOR_OUTPUT_BYTES + 1];
        let result = read_attestor_pipe(std::io::Cursor::new(bytes), Arc::clone(&exceeded))
            .join()
            .unwrap();
        assert_eq!(result.unwrap_err(), "attestor_output_too_large");
        assert!(exceeded.load(Ordering::SeqCst));
    }

    #[test]
    fn trusted_reference_accepts_matching_magic_and_rejects_disguised_files() {
        let root = std::env::temp_dir().join(format!(
            "storyboard-trusted-reference-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&root).unwrap();
        let valid = root.join("valid.png");
        fs::write(&valid, [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]).unwrap();
        let result = read_trusted_character_reference_file(valid.to_string_lossy().to_string()).unwrap();
        assert_eq!(result.image_format, "png");
        assert_eq!(result.byte_length, 8);

        let disguised = root.join("disguised.png");
        fs::write(&disguised, b"not an image").unwrap();
        assert_eq!(
            read_trusted_character_reference_file(disguised.to_string_lossy().to_string()).unwrap_err(),
            "reference_image_invalid"
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn generic_family_delete_cannot_remove_task7_authority_or_managed_files() {
        let root = std::env::temp_dir().join(format!(
            "storyboard-task7-delete-guard-{}",
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
        ));
        let app_data = root.join("app-data");
        let project = root.join("guard.sbproj");
        let assets = project.join("assets");
        let authority = app_data.join("video-normalization-authority");
        fs::create_dir_all(authority.join("receipts")).unwrap();
        fs::create_dir_all(assets.join("video-assembled")).unwrap();
        fs::write(app_data.join("current-project.txt"), project.to_string_lossy().as_bytes()).unwrap();
        let keyring = authority.join("authority.keys.json");
        let record = authority.join("receipts").join(format!("{}.json", "a".repeat(64)));
        let assembled = assets.join("video-assembled/final.mp4");
        fs::write(&keyring, b"keyring-unchanged").unwrap();
        fs::write(&record, b"record-unchanged").unwrap();
        fs::write(&assembled, b"assembly-unchanged").unwrap();

        for target in [&keyring, &record, &assembled] {
            assert!(delete_generated_file_families_at_app_data(
                &app_data,
                vec![target.to_string_lossy().to_string()],
                None,
            ).is_err());
        }
        assert_eq!(fs::read(keyring).unwrap(), b"keyring-unchanged");
        assert_eq!(fs::read(record).unwrap(), b"record-unchanged");
        assert_eq!(fs::read(assembled).unwrap(), b"assembly-unchanged");
        fs::remove_dir_all(root).unwrap();
    }
}

#[tauri::command]
fn split_threeview_sheet(
    app: tauri::AppHandle,
    source_path: String,
) -> Result<ThreeViewSplitResult, String> {
    video_continuity::reject_authority_file_command_path(&app, &source_path)?;
    let source = PathBuf::from(source_path.trim());
    if !source.exists() || !source.is_file() {
        return Err(format!(
            "Three-view sheet not found: {}",
            source.to_string_lossy()
        ));
    }

    let image =
        image::open(&source).map_err(|err| format!("Failed to open three-view sheet: {err}"))?;
    let (width, height) = image.dimensions();
    if width < 3 || height == 0 {
        return Err(format!(
            "Three-view sheet has invalid dimensions: {}x{}",
            width, height
        ));
    }

    let rgba = image.to_rgba8();
    let ranges = compute_threeview_sheet_ranges(&rgba);
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
    for target in &targets {
        video_continuity::reject_authority_file_command_path(
            &app,
            target.to_string_lossy().as_ref(),
        )?;
    }

    for (index, target) in targets.iter().enumerate() {
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)
                .map_err(|err| format!("Failed to create split image directory: {err}"))?;
        }
        if target.exists() {
            fs::remove_file(target)
                .map_err(|err| format!("Failed to overwrite split image: {err}"))?;
        }
        let (start_x, end_x) = ranges[index];
        let crop_width = end_x.saturating_sub(start_x).max(1);
        let crop = image.crop_imm(start_x, 0, crop_width, height);
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
                user_dir
                    .join(format!("comfyui_{port}.log"))
                    .to_string_lossy(),
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
            create_migration_backup,
            load_current_project,
            export_animatic,
            export_animatic_from_frames,
            concat_video_segments,
            codex_storyboard::prepare_codex_storyboard_job,
            codex_storyboard::import_codex_storyboard_result,
            codex_storyboard::transition_codex_storyboard_lifecycle,
            video_continuity::prepare_runninghub_handoff,
            video_continuity::record_runninghub_submission,
            video_continuity::import_runninghub_result,
            spatial_stage::write_spatial_control_artifact,
            video_continuity::begin_video_assembly_run,
            video_continuity::stage_video_segment,
            video_continuity::probe_video_segment,
            video_continuity::normalize_video_segment,
            video_continuity::extract_video_review_frames,
            video_continuity::verify_normalization_credential,
            video_continuity::verify_video_review_frames,
            video_continuity::retain_video_assembly_run,
            video_continuity::discard_retained_video_assembly_run,
            video_continuity::concat_normalized_video_segments,
            video_continuity::verify_video_assembly_receipt,
            video_continuity::cleanup_video_assembly_assets,
            video_continuity::gc_video_continuity_assets,
            mux_video_with_audio_tracks,
            mix_audio_tracks,
            generate_local_video_from_images,
            write_base64_file,
            read_trusted_character_reference,
            attest_character_generation_report,
            verify_character_evidence_receipt,
            copy_file_to,
            delete_generated_file_families,
            split_threeview_sheet,
            comfy_read_server_log_tail,
            comfy_ping,
            comfy_queue_prompt,
            comfy_get_history,
            comfy_maintenance,
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
