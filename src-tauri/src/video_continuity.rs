use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;

const NORMALIZED_SCHEMA_VERSION: u32 = 1;
const NORMALIZED_FPS_NUM: u32 = 24;
const NORMALIZED_FPS_DEN: u32 = 1;
const MAX_VIDEO_DIMENSION: u32 = 8192;
const MAX_SEGMENT_FRAMES: u32 = 24 * 60 * 60;
const AUTHORITY_DIRECTORY: &str = "video-normalization-authority";
const AUTHORITY_SECRET_BYTES: usize = 32;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VideoProbe {
    pub width: u32,
    pub height: u32,
    pub fps_num: u32,
    pub fps_den: u32,
    pub duration_seconds: f64,
    pub video_codec: String,
    pub pixel_format: String,
    pub audio_sample_rate: Option<u32>,
    pub audio_channels: Option<u32>,
    pub has_monotonic_timestamps: bool,
    pub has_constant_frame_timestamps: bool,
    pub decoded_frame_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BlackInterval {
    pub start_seconds: f64,
    pub end_seconds: f64,
    pub duration_seconds: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FreezeInterval {
    pub start_seconds: f64,
    pub end_seconds: f64,
    pub duration_seconds: f64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VideoAnomalyReport {
    pub black_intervals: Vec<BlackInterval>,
    pub freeze_intervals: Vec<FreezeInterval>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VideoInspection {
    pub probe: VideoProbe,
    pub anomalies: VideoAnomalyReport,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NormalizationCredential {
    pub schema_version: u32,
    pub receipt_id: String,
    pub normalized_path: String,
    pub sha256: String,
    pub byte_length: u64,
    pub modified_unix_millis: u64,
    pub project_width: u32,
    pub project_height: u32,
    pub duration_frames: u32,
    pub probe: VideoProbe,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct NormalizationRegistryRecord {
    schema_version: u32,
    receipt_id: String,
    issuance_nonce: String,
    canonical_project_root: String,
    canonical_asset_root: String,
    issued_unix_millis: u64,
    state: String,
    credential: NormalizationCredential,
    #[serde(default)]
    derived_paths: Vec<String>,
    mac: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReceiptStateMarker {
    schema_version: u32,
    receipt_id: String,
    transaction_id: String,
    state: String,
    mac: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NormalizedVideoSegment {
    pub credential: NormalizationCredential,
    pub probe: VideoProbe,
    pub anomalies: VideoAnomalyReport,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StagedVideoSegment {
    pub staged_path: String,
    pub project_assets_dir: String,
    pub staging_receipt_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VideoReviewFrames {
    pub first_frame_path: String,
    pub middle_frame_path: String,
    pub last_frame_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ConcatenatedVideo {
    pub output_path: String,
    pub probe: VideoProbe,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VideoGcReport {
    pub receipts_removed: u32,
    pub assets_removed: u32,
}

#[derive(Debug, Deserialize)]
struct FfprobeOutput {
    #[serde(default)]
    packets: Vec<FfprobePacket>,
    streams: Vec<FfprobeStream>,
    format: FfprobeFormat,
}

#[derive(Debug, Deserialize)]
struct FfprobePacket {
    stream_index: u32,
    #[serde(default)]
    pts: Option<FfprobeTimestamp>,
    #[serde(default)]
    dts: Option<FfprobeTimestamp>,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum FfprobeTimestamp {
    Integer(i64),
    String(String),
}

impl FfprobeTimestamp {
    fn as_i64(&self) -> Option<i64> {
        match self {
            Self::Integer(value) => Some(*value),
            Self::String(value) => value.parse::<i64>().ok(),
        }
    }
}

#[derive(Debug, Deserialize)]
struct FfprobeStream {
    index: u32,
    codec_type: String,
    #[serde(default)]
    codec_name: Option<String>,
    #[serde(default)]
    pix_fmt: Option<String>,
    #[serde(default)]
    width: Option<u32>,
    #[serde(default)]
    height: Option<u32>,
    #[serde(default)]
    avg_frame_rate: Option<String>,
    #[serde(default)]
    r_frame_rate: Option<String>,
    #[serde(default)]
    sample_rate: Option<String>,
    #[serde(default)]
    channels: Option<u32>,
    #[serde(default)]
    nb_read_frames: Option<String>,
}

#[derive(Debug, Deserialize)]
struct FfprobeFormat {
    duration: String,
}

fn unique_suffix() -> Result<String, String> {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "video_clock_invalid".to_string())?
        .as_nanos();
    Ok(format!("{}-{nanos}", std::process::id()))
}

#[cfg(windows)]
fn fill_os_random(buffer: &mut [u8]) -> Result<(), String> {
    #[link(name = "bcrypt")]
    extern "system" {
        fn BCryptGenRandom(
            algorithm: *mut std::ffi::c_void,
            buffer: *mut u8,
            buffer_length: u32,
            flags: u32,
        ) -> i32;
    }
    const BCRYPT_USE_SYSTEM_PREFERRED_RNG: u32 = 0x0000_0002;
    let status = unsafe {
        BCryptGenRandom(
            std::ptr::null_mut(),
            buffer.as_mut_ptr(),
            buffer
                .len()
                .try_into()
                .map_err(|_| "normalization_random_failed".to_string())?,
            BCRYPT_USE_SYSTEM_PREFERRED_RNG,
        )
    };
    if status < 0 {
        return Err("normalization_random_failed".to_string());
    }
    Ok(())
}

#[cfg(unix)]
fn fill_os_random(buffer: &mut [u8]) -> Result<(), String> {
    fs::File::open("/dev/urandom")
        .and_then(|mut file| file.read_exact(buffer))
        .map_err(|_| "normalization_random_failed".to_string())
}

#[cfg(not(any(windows, unix)))]
fn fill_os_random(_buffer: &mut [u8]) -> Result<(), String> {
    Err("normalization_random_failed".to_string())
}

fn random_hex(byte_count: usize) -> Result<String, String> {
    let mut bytes = vec![0_u8; byte_count];
    fill_os_random(&mut bytes)?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn valid_receipt_id(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

fn registry_receipt_path(registry_root: &Path, receipt_id: &str) -> Result<PathBuf, String> {
    if !valid_receipt_id(receipt_id) {
        return Err("normalization_receipt_invalid".to_string());
    }
    Ok(registry_root.join(format!("{receipt_id}.json")))
}

fn registry_consumed_path(registry_root: &Path, receipt_id: &str) -> Result<PathBuf, String> {
    if !valid_receipt_id(receipt_id) {
        return Err("normalization_receipt_invalid".to_string());
    }
    Ok(registry_root.join(format!("{receipt_id}.consumed")))
}

fn registry_lease_path(registry_root: &Path, receipt_id: &str) -> Result<PathBuf, String> {
    if !valid_receipt_id(receipt_id) {
        return Err("normalization_receipt_invalid".to_string());
    }
    Ok(registry_root.join(format!("{receipt_id}.lease")))
}

fn authority_root_from_registry(registry_root: &Path) -> Result<&Path, String> {
    registry_root
        .parent()
        .ok_or_else(|| "normalization_registry_unavailable".to_string())
}

fn authority_secret(authority_root: &Path) -> Result<Vec<u8>, String> {
    let secret_path = authority_root.join("authority.secret");
    match OpenOptions::new().create_new(true).write(true).open(&secret_path) {
        Ok(mut file) => {
            let mut secret = vec![0_u8; AUTHORITY_SECRET_BYTES];
            fill_os_random(&mut secret)?;
            file.write_all(&secret)
                .and_then(|_| file.sync_all())
                .map_err(|_| "normalization_authority_unavailable".to_string())?;
            Ok(secret)
        }
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            let secret = fs::read(&secret_path)
                .map_err(|_| "normalization_authority_unavailable".to_string())?;
            if secret.len() != AUTHORITY_SECRET_BYTES {
                return Err("normalization_authority_unavailable".to_string());
            }
            Ok(secret)
        }
        Err(_) => Err("normalization_authority_unavailable".to_string()),
    }
}

fn hmac_sha256(key: &[u8], message: &[u8]) -> String {
    const BLOCK: usize = 64;
    let mut normalized = [0_u8; BLOCK];
    if key.len() > BLOCK {
        normalized[..32].copy_from_slice(&Sha256::digest(key));
    } else {
        normalized[..key.len()].copy_from_slice(key);
    }
    let mut inner_pad = [0x36_u8; BLOCK];
    let mut outer_pad = [0x5c_u8; BLOCK];
    for index in 0..BLOCK {
        inner_pad[index] ^= normalized[index];
        outer_pad[index] ^= normalized[index];
    }
    let mut inner = Sha256::new();
    inner.update(inner_pad);
    inner.update(message);
    let inner_hash = inner.finalize();
    let mut outer = Sha256::new();
    outer.update(outer_pad);
    outer.update(inner_hash);
    outer.finalize().iter().map(|byte| format!("{byte:02x}")).collect()
}

fn constant_time_hex_equal(left: &str, right: &str) -> bool {
    if left.len() != right.len() {
        return false;
    }
    left.as_bytes()
        .iter()
        .zip(right.as_bytes())
        .fold(0_u8, |difference, (a, b)| difference | (a ^ b))
        == 0
}

fn record_mac(record: &NormalizationRegistryRecord, secret: &[u8]) -> Result<String, String> {
    let mut unsigned = record.clone();
    unsigned.mac.clear();
    let bytes = serde_json::to_vec(&unsigned)
        .map_err(|_| "normalization_registry_invalid".to_string())?;
    Ok(hmac_sha256(secret, &bytes))
}

fn marker_mac(marker: &ReceiptStateMarker, secret: &[u8]) -> Result<String, String> {
    let mut unsigned = marker.clone();
    unsigned.mac.clear();
    let bytes = serde_json::to_vec(&unsigned)
        .map_err(|_| "normalization_registry_invalid".to_string())?;
    Ok(hmac_sha256(secret, &bytes))
}

fn read_state_marker(path: &Path, secret: &[u8]) -> Result<ReceiptStateMarker, String> {
    let marker: ReceiptStateMarker = serde_json::from_slice(
        &fs::read(path).map_err(|_| "normalization_registry_invalid".to_string())?,
    )
    .map_err(|_| "normalization_registry_invalid".to_string())?;
    let expected = marker_mac(&marker, secret)?;
    if marker.schema_version != NORMALIZED_SCHEMA_VERSION
        || !valid_receipt_id(&marker.receipt_id)
        || !constant_time_hex_equal(&marker.mac, &expected)
    {
        return Err("normalization_receipt_signature_invalid".to_string());
    }
    Ok(marker)
}

fn write_state_marker(
    path: &Path,
    receipt_id: &str,
    transaction_id: &str,
    state: &str,
    secret: &[u8],
) -> Result<(), String> {
    if transaction_id.is_empty() || transaction_id.len() > 128 {
        return Err("normalization_transaction_invalid".to_string());
    }
    let mut marker = ReceiptStateMarker {
        schema_version: NORMALIZED_SCHEMA_VERSION,
        receipt_id: receipt_id.to_string(),
        transaction_id: transaction_id.to_string(),
        state: state.to_string(),
        mac: String::new(),
    };
    marker.mac = marker_mac(&marker, secret)?;
    let bytes = serde_json::to_vec(&marker)
        .map_err(|_| "normalization_registry_invalid".to_string())?;
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(path)
        .map_err(|error| {
            if error.kind() == std::io::ErrorKind::AlreadyExists {
                "normalization_receipt_leased".to_string()
            } else {
                "normalization_consumption_failed".to_string()
            }
        })?;
    file.write_all(&bytes)
        .and_then(|_| file.sync_all())
        .map_err(|_| "normalization_consumption_failed".to_string())
}

fn ensure_registry_root(path: &Path) -> Result<PathBuf, String> {
    let authority = path
        .parent()
        .ok_or_else(|| "normalization_registry_unavailable".to_string())?;
    fs::create_dir_all(authority).map_err(|_| "normalization_registry_unavailable".to_string())?;
    let canonical_authority = fs::canonicalize(authority)
        .map_err(|_| "normalization_registry_unavailable".to_string())?;
    fs::create_dir_all(path).map_err(|_| "normalization_registry_unavailable".to_string())?;
    let canonical = fs::canonicalize(path)
        .map_err(|_| "normalization_registry_unavailable".to_string())?;
    if !canonical.is_dir() || canonical == canonical_authority || !canonical.starts_with(&canonical_authority) {
        return Err("normalization_registry_unavailable".to_string());
    }
    authority_secret(&canonical_authority)?;
    Ok(canonical)
}

fn resolve_authority_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|_| "normalization_registry_unavailable".to_string())?;
    fs::create_dir_all(&app_data).map_err(|_| "normalization_registry_unavailable".to_string())?;
    let canonical_app_data = fs::canonicalize(&app_data)
        .map_err(|_| "normalization_registry_unavailable".to_string())?;
    let authority = app_data.join(AUTHORITY_DIRECTORY);
    fs::create_dir_all(&authority).map_err(|_| "normalization_registry_unavailable".to_string())?;
    let canonical_authority = fs::canonicalize(authority)
        .map_err(|_| "normalization_registry_unavailable".to_string())?;
    if canonical_authority == canonical_app_data || !canonical_authority.starts_with(&canonical_app_data) {
        return Err("normalization_registry_unavailable".to_string());
    }
    authority_secret(&canonical_authority)?;
    Ok(canonical_authority)
}

fn resolve_registry_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let authority = resolve_authority_root(app)?;
    ensure_registry_root(&authority.join("receipts"))
}

pub fn reject_authority_file_command_path(
    app: &tauri::AppHandle,
    raw_path: &str,
) -> Result<(), String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|_| "normalization_registry_unavailable".to_string())?;
    reject_authority_file_command_path_at_app_data(&app_data, raw_path)
}

fn reject_authority_file_command_path_at_app_data(
    app_data: &Path,
    raw_path: &str,
) -> Result<(), String> {
    fs::create_dir_all(app_data).map_err(|_| "normalization_registry_unavailable".to_string())?;
    let canonical_app_data = fs::canonicalize(app_data)
        .map_err(|_| "normalization_registry_unavailable".to_string())?;
    let authority_path = app_data.join(AUTHORITY_DIRECTORY);
    fs::create_dir_all(&authority_path)
        .map_err(|_| "normalization_registry_unavailable".to_string())?;
    let authority = fs::canonicalize(authority_path)
        .map_err(|_| "normalization_registry_unavailable".to_string())?;
    if authority == canonical_app_data || !authority.starts_with(&canonical_app_data) {
        return Err("normalization_registry_unavailable".to_string());
    }
    let requested = absolute_path(raw_path, "file_path is empty")?;
    let mut existing = requested.as_path();
    while !existing.exists() {
        existing = existing
            .parent()
            .ok_or_else(|| "file_path_invalid".to_string())?;
    }
    let canonical_existing = fs::canonicalize(existing).map_err(|_| "file_path_invalid".to_string())?;
    if canonical_existing == authority || canonical_existing.starts_with(&authority) {
        return Err("video_authority_path_forbidden".to_string());
    }
    Ok(())
}

fn issue_registry_receipt(
    registry_root: &Path,
    project_root: &Path,
    asset_root: &Path,
    mut credential: NormalizationCredential,
) -> Result<NormalizationCredential, String> {
    for _ in 0..8 {
        let receipt_id = random_hex(32)?;
        let issuance_nonce = random_hex(32)?;
        let path = registry_receipt_path(registry_root, &receipt_id)?;
        credential.receipt_id = receipt_id.clone();
        let mut record = NormalizationRegistryRecord {
            schema_version: NORMALIZED_SCHEMA_VERSION,
            receipt_id,
            issuance_nonce,
            canonical_project_root: project_root.to_string_lossy().to_string(),
            canonical_asset_root: asset_root.to_string_lossy().to_string(),
            issued_unix_millis: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map_err(|_| "video_clock_invalid".to_string())?
                .as_millis() as u64,
            state: "available".to_string(),
            credential: credential.clone(),
            derived_paths: Vec::new(),
            mac: String::new(),
        };
        let secret = authority_secret(authority_root_from_registry(registry_root)?)?;
        record.mac = record_mac(&record, &secret)?;
        let serialized = serde_json::to_vec(&record)
            .map_err(|_| "normalization_registry_invalid".to_string())?;
        match OpenOptions::new().create_new(true).write(true).open(path) {
            Ok(mut file) => {
                file.write_all(&serialized)
                    .and_then(|_| file.sync_all())
                    .map_err(|_| "normalization_registry_write_failed".to_string())?;
                return Ok(credential);
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(_) => return Err("normalization_registry_write_failed".to_string()),
        }
    }
    Err("normalization_registry_collision".to_string())
}

fn load_registry_record(
    registry_root: &Path,
    project_root: &Path,
    asset_root: &Path,
    supplied: &NormalizationCredential,
) -> Result<NormalizationRegistryRecord, String> {
    let (record, secret) = load_signed_registry_record(
        registry_root,
        project_root,
        asset_root,
        supplied,
    )?;
    let consumed_path = registry_consumed_path(registry_root, &supplied.receipt_id)?;
    if consumed_path.exists() {
        let marker = read_state_marker(&consumed_path, &secret)?;
        if marker.receipt_id != supplied.receipt_id || marker.state != "consumed" {
            return Err("normalization_receipt_signature_invalid".to_string());
        }
        return Err("normalization_receipt_consumed".to_string());
    }
    Ok(record)
}

fn load_signed_registry_record(
    registry_root: &Path,
    project_root: &Path,
    asset_root: &Path,
    supplied: &NormalizationCredential,
) -> Result<(NormalizationRegistryRecord, Vec<u8>), String> {
    let path = registry_receipt_path(registry_root, &supplied.receipt_id)?;
    let bytes = fs::read(path).map_err(|_| "normalization_receipt_not_issued".to_string())?;
    let record: NormalizationRegistryRecord = serde_json::from_slice(&bytes)
        .map_err(|_| "normalization_registry_invalid".to_string())?;
    let secret = authority_secret(authority_root_from_registry(registry_root)?)?;
    let expected_mac = record_mac(&record, &secret)?;
    if !constant_time_hex_equal(&record.mac, &expected_mac) {
        return Err("normalization_receipt_signature_invalid".to_string());
    }
    if record.schema_version != NORMALIZED_SCHEMA_VERSION
        || record.receipt_id != supplied.receipt_id
        || !valid_receipt_id(&record.issuance_nonce)
        || record.canonical_project_root != project_root.to_string_lossy()
        || record.canonical_asset_root != asset_root.to_string_lossy()
        || record.state != "available"
        || &record.credential != supplied
    {
        return Err("normalization_credential_mismatch".to_string());
    }
    Ok((record, secret))
}

fn register_review_paths(
    registry_root: &Path,
    project_root: &Path,
    asset_root: &Path,
    credential: &NormalizationCredential,
    paths: &[&Path],
) -> Result<(), String> {
    let (mut record, secret) = load_signed_registry_record(
        registry_root,
        project_root,
        asset_root,
        credential,
    )?;
    record.derived_paths = paths
        .iter()
        .map(|path| path.to_string_lossy().to_string())
        .collect();
    record.mac.clear();
    record.mac = record_mac(&record, &secret)?;
    fs::write(
        registry_receipt_path(registry_root, &credential.receipt_id)?,
        serde_json::to_vec(&record).map_err(|_| "normalization_registry_invalid".to_string())?,
    )
    .map_err(|_| "normalization_registry_write_failed".to_string())
}

fn lease_registry_receipts(
    registry_root: &Path,
    credentials: &[NormalizationCredential],
    transaction_id: &str,
) -> Result<(), String> {
    let secret = authority_secret(authority_root_from_registry(registry_root)?)?;
    let mut created = Vec::new();
    for credential in credentials {
        let consumed = registry_consumed_path(registry_root, &credential.receipt_id)?;
        if consumed.exists() {
            let marker = read_state_marker(&consumed, &secret)?;
            if marker.state == "consumed" && marker.receipt_id == credential.receipt_id {
                for prior in created { let _ = fs::remove_file(prior); }
                return Err("normalization_receipt_consumed".to_string());
            }
            return Err("normalization_receipt_signature_invalid".to_string());
        }
        let path = registry_lease_path(registry_root, &credential.receipt_id)?;
        if let Err(error) = write_state_marker(
            &path,
            &credential.receipt_id,
            transaction_id,
            "leased",
            &secret,
        ) {
            for prior in created { let _ = fs::remove_file(prior); }
            return Err(error);
        }
        created.push(path);
    }
    Ok(())
}

fn release_registry_leases(
    registry_root: &Path,
    credentials: &[NormalizationCredential],
    transaction_id: &str,
) -> Result<(), String> {
    let secret = authority_secret(authority_root_from_registry(registry_root)?)?;
    for credential in credentials {
        let path = registry_lease_path(registry_root, &credential.receipt_id)?;
        if !path.exists() { continue; }
        let marker = read_state_marker(&path, &secret)?;
        if marker.receipt_id != credential.receipt_id
            || marker.transaction_id != transaction_id
            || marker.state != "leased"
        {
            return Err("normalization_receipt_lease_mismatch".to_string());
        }
        fs::remove_file(path).map_err(|_| "normalization_consumption_failed".to_string())?;
    }
    Ok(())
}

fn commit_registry_receipts(
    registry_root: &Path,
    credentials: &[NormalizationCredential],
    transaction_id: &str,
) -> Result<(), String> {
    let secret = authority_secret(authority_root_from_registry(registry_root)?)?;
    let mut consumed_created = Vec::new();
    for credential in credentials {
        let lease = registry_lease_path(registry_root, &credential.receipt_id)?;
        let marker = read_state_marker(&lease, &secret)?;
        if marker.receipt_id != credential.receipt_id
            || marker.transaction_id != transaction_id
            || marker.state != "leased"
        {
            for prior in consumed_created { let _ = fs::remove_file(prior); }
            return Err("normalization_receipt_lease_mismatch".to_string());
        }
        let consumed = registry_consumed_path(registry_root, &credential.receipt_id)?;
        if let Err(error) = write_state_marker(
            &consumed,
            &credential.receipt_id,
            transaction_id,
            "consumed",
            &secret,
        ) {
            for prior in consumed_created { let _ = fs::remove_file(prior); }
            return Err(error);
        }
        consumed_created.push(consumed);
    }
    for credential in credentials {
        fs::remove_file(registry_lease_path(registry_root, &credential.receipt_id)?)
            .map_err(|_| "normalization_consumption_failed".to_string())?;
    }
    Ok(())
}

fn absolute_path(raw: &str, missing_error: &str) -> Result<PathBuf, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(missing_error.to_string());
    }
    let path = PathBuf::from(trimmed);
    if !path.is_absolute() {
        return Err("video_path_must_be_absolute".to_string());
    }
    Ok(path)
}

fn canonical_dir(raw: &str, error: &str) -> Result<PathBuf, String> {
    let path = absolute_path(raw, error)?;
    let canonical = fs::canonicalize(path).map_err(|_| error.to_string())?;
    if !canonical.is_dir() {
        return Err(error.to_string());
    }
    Ok(canonical)
}

fn canonical_existing_file(
    raw: &str,
    project_root: &Path,
    asset_root: &Path,
) -> Result<PathBuf, String> {
    let path = absolute_path(raw, "video_input_path_missing")?;
    let canonical = fs::canonicalize(path).map_err(|_| "video_input_not_found".to_string())?;
    if !canonical.is_file() {
        return Err("video_input_not_found".to_string());
    }
    if !canonical.starts_with(project_root) && !canonical.starts_with(asset_root) {
        return Err("video_path_outside_project".to_string());
    }
    Ok(canonical)
}

fn canonical_external_file(raw: &str) -> Result<PathBuf, String> {
    let path = absolute_path(raw, "video_input_path_missing")?;
    let canonical = fs::canonicalize(path).map_err(|_| "video_input_not_found".to_string())?;
    if !canonical.is_file() {
        return Err("video_input_not_found".to_string());
    }
    Ok(canonical)
}

fn path_is_reparse(path: &Path) -> Result<bool, String> {
    let metadata = fs::symlink_metadata(path).map_err(|_| "video_output_path_invalid".to_string())?;
    if metadata.file_type().is_symlink() {
        return Ok(true);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
        return Ok(metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0);
    }
    #[cfg(not(windows))]
    Ok(false)
}

fn ensure_no_reparse_ancestors(asset_root: &Path, candidate: &Path) -> Result<(), String> {
    if !candidate.starts_with(asset_root) {
        return Err("video_output_outside_assets".to_string());
    }
    let canonical_asset_root = fs::canonicalize(asset_root)
        .map_err(|_| "video_assets_root_invalid".to_string())?;
    let mut cursor = candidate;
    loop {
        if path_is_reparse(cursor)? {
            return Err("video_output_reparse_forbidden".to_string());
        }
        let canonical_cursor = fs::canonicalize(cursor)
            .map_err(|_| "video_output_path_invalid".to_string())?;
        if canonical_cursor == canonical_asset_root {
            return Ok(());
        }
        if !canonical_cursor.starts_with(&canonical_asset_root) {
            return Err("video_output_outside_assets".to_string());
        }
        cursor = cursor
            .parent()
            .ok_or_else(|| "video_output_outside_assets".to_string())?;
    }
}

fn secure_copy_create_new(source: &Path, target: &Path, asset_root: &Path) -> Result<(), String> {
    let canonical_asset_root = fs::canonicalize(asset_root)
        .map_err(|_| "video_assets_root_invalid".to_string())?;
    let parent = target
        .parent()
        .ok_or_else(|| "video_output_path_invalid".to_string())?;
    ensure_no_reparse_ancestors(asset_root, parent)?;
    let canonical_parent = fs::canonicalize(parent)
        .map_err(|_| "video_output_path_invalid".to_string())?;
    if !canonical_parent.starts_with(&canonical_asset_root) {
        return Err("video_output_outside_assets".to_string());
    }
    let mut input = fs::File::open(source).map_err(|_| "video_snapshot_copy_failed".to_string())?;
    let mut output = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(target)
        .map_err(|error| {
            if error.kind() == std::io::ErrorKind::AlreadyExists {
                "video_output_already_exists".to_string()
            } else {
                "video_snapshot_copy_failed".to_string()
            }
        })?;
    if let Err(error) = std::io::copy(&mut input, &mut output).and_then(|_| output.sync_all()) {
        let _ = fs::remove_file(target);
        let _ = error;
        return Err("video_snapshot_copy_failed".to_string());
    }
    if path_is_reparse(target)? {
        let _ = fs::remove_file(target);
        return Err("video_output_reparse_forbidden".to_string());
    }
    let canonical_target = fs::canonicalize(target)
        .map_err(|_| "video_snapshot_copy_failed".to_string())?;
    if !canonical_target.starts_with(&canonical_asset_root) || !canonical_target.is_file() {
        let _ = fs::remove_file(target);
        return Err("video_output_outside_assets".to_string());
    }
    Ok(())
}

fn validate_publish_target(path: &Path, asset_root: &Path) -> Result<(), String> {
    if !path.is_absolute() {
        return Err("video_path_must_be_absolute".to_string());
    }
    if path.exists() {
        return Err("video_output_already_exists".to_string());
    }
    let parent = path
        .parent()
        .ok_or_else(|| "video_output_path_invalid".to_string())?;
    let canonical_parent =
        fs::canonicalize(parent).map_err(|_| "video_output_path_invalid".to_string())?;
    if !canonical_parent.starts_with(asset_root) {
        return Err("video_output_outside_assets".to_string());
    }
    Ok(())
}

fn ensure_derived_dir(asset_root: &Path, name: &str, error: &str) -> Result<PathBuf, String> {
    let candidate = asset_root.join(name);
    fs::create_dir_all(&candidate).map_err(|_| error.to_string())?;
    let canonical = fs::canonicalize(candidate).map_err(|_| error.to_string())?;
    if canonical == asset_root || !canonical.starts_with(asset_root) {
        return Err("video_output_outside_assets".to_string());
    }
    Ok(canonical)
}

fn resolve_roots(
    app: &tauri::AppHandle,
    project_assets_dir: &str,
) -> Result<(PathBuf, PathBuf), String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|_| "video_project_root_unavailable".to_string())?;
    fs::create_dir_all(&app_data).map_err(|_| "video_project_root_unavailable".to_string())?;
    let marker = app_data.join("current-project.txt");
    let selected = if marker.is_file() {
        let raw =
            fs::read_to_string(marker).map_err(|_| "video_project_root_unavailable".to_string())?;
        absolute_path(raw.trim(), "video_project_root_unavailable")?
    } else {
        let fallback = app_data.join("default.sbproj");
        fs::create_dir_all(&fallback).map_err(|_| "video_project_root_unavailable".to_string())?;
        fallback
    };
    let project_root =
        fs::canonicalize(selected).map_err(|_| "video_project_root_unavailable".to_string())?;
    if !project_root.is_dir() {
        return Err("video_project_root_unavailable".to_string());
    }
    let asset_root = canonical_dir(project_assets_dir, "video_assets_root_invalid")?;
    if asset_root == project_root || !asset_root.starts_with(&project_root) {
        return Err("video_assets_root_outside_project".to_string());
    }
    Ok((project_root, asset_root))
}

fn resolve_current_project_assets(app: &tauri::AppHandle) -> Result<(PathBuf, PathBuf), String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|_| "video_project_root_unavailable".to_string())?;
    resolve_current_project_assets_at_app_data(&app_data)
}

fn resolve_current_project_assets_at_app_data(
    app_data: &Path,
) -> Result<(PathBuf, PathBuf), String> {
    let marker = app_data.join("current-project.txt");
    let selected = fs::read_to_string(marker)
        .map_err(|_| "video_project_root_unavailable".to_string())?;
    let project_root = fs::canonicalize(absolute_path(
        selected.trim(),
        "video_project_root_unavailable",
    )?)
    .map_err(|_| "video_project_root_unavailable".to_string())?;
    if !project_root.is_dir()
        || project_root.extension().and_then(|value| value.to_str()) != Some("sbproj")
    {
        return Err("video_project_root_unavailable".to_string());
    }
    let assets = project_root.join("assets");
    fs::create_dir_all(&assets).map_err(|_| "video_assets_root_invalid".to_string())?;
    let asset_root = fs::canonicalize(assets).map_err(|_| "video_assets_root_invalid".to_string())?;
    if asset_root == project_root || !asset_root.starts_with(&project_root) || path_is_reparse(&asset_root)? {
        return Err("video_assets_root_outside_project".to_string());
    }
    Ok((project_root, asset_root))
}

fn parse_rational(raw: &str) -> Result<(u32, u32), String> {
    let (num_raw, den_raw) = raw
        .split_once('/')
        .ok_or_else(|| "ffprobe_frame_rate_invalid".to_string())?;
    let mut num = num_raw
        .parse::<u32>()
        .map_err(|_| "ffprobe_frame_rate_invalid".to_string())?;
    let mut den = den_raw
        .parse::<u32>()
        .map_err(|_| "ffprobe_frame_rate_invalid".to_string())?;
    if num == 0 || den == 0 {
        return Err("ffprobe_frame_rate_invalid".to_string());
    }
    let mut a = num;
    let mut b = den;
    while b != 0 {
        let remainder = a % b;
        a = b;
        b = remainder;
    }
    num /= a;
    den /= a;
    Ok((num, den))
}

fn probe_path(path: &Path) -> Result<VideoProbe, String> {
    let output = Command::new("ffprobe")
        .args([
            "-v",
            "error",
            "-count_frames",
            "-show_packets",
            "-show_entries",
            "packet=stream_index,pts,dts:stream=index,codec_type,codec_name,pix_fmt,width,height,avg_frame_rate,r_frame_rate,sample_rate,channels,nb_read_frames:format=duration",
            "-of",
            "json",
        ])
        .arg(path)
        .output()
        .map_err(|_| "ffprobe_start_failed".to_string())?;
    if !output.status.success() {
        return Err("ffprobe_failed".to_string());
    }
    let parsed: FfprobeOutput =
        serde_json::from_slice(&output.stdout).map_err(|_| "ffprobe_json_invalid".to_string())?;
    let videos: Vec<&FfprobeStream> = parsed
        .streams
        .iter()
        .filter(|stream| stream.codec_type == "video")
        .collect();
    let audios: Vec<&FfprobeStream> = parsed
        .streams
        .iter()
        .filter(|stream| stream.codec_type == "audio")
        .collect();
    if videos.len() != 1 || audios.len() > 1 {
        return Err("ffprobe_stream_layout_invalid".to_string());
    }
    let video = videos[0];
    let rate = video
        .avg_frame_rate
        .as_deref()
        .filter(|value| *value != "0/0")
        .or(video.r_frame_rate.as_deref())
        .ok_or_else(|| "ffprobe_frame_rate_invalid".to_string())?;
    let (fps_num, fps_den) = parse_rational(rate)?;
    let duration_seconds = parsed
        .format
        .duration
        .parse::<f64>()
        .map_err(|_| "ffprobe_duration_invalid".to_string())?;
    if !duration_seconds.is_finite() || duration_seconds <= 0.0 {
        return Err("ffprobe_duration_invalid".to_string());
    }
    let mut previous = None;
    let mut previous_delta = None;
    let mut packet_count = 0_u64;
    let mut monotonic = true;
    let mut constant_timestamps = true;
    for packet in parsed
        .packets
        .iter()
        .filter(|packet| packet.stream_index == video.index)
    {
        packet_count += 1;
        let timestamp = packet
            .dts
            .as_ref()
            .or(packet.pts.as_ref())
            .and_then(FfprobeTimestamp::as_i64);
        let Some(timestamp) = timestamp else {
            monotonic = false;
            continue;
        };
        if previous.is_some_and(|last| timestamp <= last) {
            monotonic = false;
        }
        if let Some(last) = previous {
            let delta = timestamp - last;
            if previous_delta.is_some_and(|expected| delta != expected) {
                constant_timestamps = false;
            }
            previous_delta = Some(delta);
        }
        previous = Some(timestamp);
    }
    let audio_sample_rate = audios
        .first()
        .map(|audio| {
            audio
                .sample_rate
                .as_deref()
                .ok_or_else(|| "ffprobe_audio_invalid".to_string())?
                .parse::<u32>()
                .map_err(|_| "ffprobe_audio_invalid".to_string())
        })
        .transpose()?;
    let audio_channels = audios.first().map(|audio| audio.channels).flatten();
    if !audios.is_empty() && audio_channels.is_none() {
        return Err("ffprobe_audio_invalid".to_string());
    }
    let decoded_frame_count = video
        .nb_read_frames
        .as_deref()
        .ok_or_else(|| "ffprobe_frame_count_invalid".to_string())?
        .parse::<u32>()
        .map_err(|_| "ffprobe_frame_count_invalid".to_string())?;
    if decoded_frame_count == 0 || decoded_frame_count as u64 != packet_count {
        return Err("ffprobe_frame_count_invalid".to_string());
    }
    Ok(VideoProbe {
        width: video
            .width
            .ok_or_else(|| "ffprobe_video_invalid".to_string())?,
        height: video
            .height
            .ok_or_else(|| "ffprobe_video_invalid".to_string())?,
        fps_num,
        fps_den,
        duration_seconds,
        video_codec: video
            .codec_name
            .clone()
            .ok_or_else(|| "ffprobe_video_invalid".to_string())?,
        pixel_format: video
            .pix_fmt
            .clone()
            .ok_or_else(|| "ffprobe_video_invalid".to_string())?,
        audio_sample_rate,
        audio_channels,
        has_monotonic_timestamps: monotonic && packet_count > 0,
        has_constant_frame_timestamps: constant_timestamps,
        decoded_frame_count,
    })
}

fn metric(line: &str, key: &str) -> Option<f64> {
    let start = line.find(key)? + key.len();
    let tail = line[start..].trim_start_matches([':', '=', ' ']);
    let value = tail
        .split(|character: char| character.is_ascii_whitespace())
        .next()?;
    value.parse::<f64>().ok().filter(|item| item.is_finite())
}

fn detect_anomalies(path: &Path) -> Result<VideoAnomalyReport, String> {
    let output = Command::new("ffmpeg")
        .args(["-v", "info", "-i"])
        .arg(path)
        .args([
            "-an",
            "-vf",
            "blackdetect=d=0.1:pix_th=0.10,freezedetect=n=-60dB:d=0.5",
            "-f",
            "null",
            "-",
        ])
        .output()
        .map_err(|_| "ffmpeg_anomaly_scan_start_failed".to_string())?;
    if !output.status.success() {
        return Err("ffmpeg_anomaly_scan_failed".to_string());
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    let mut report = VideoAnomalyReport::default();
    let mut freeze_start = None;
    let mut freeze_duration = None;
    for line in stderr.lines() {
        if let (Some(start), Some(end), Some(duration)) = (
            metric(line, "black_start"),
            metric(line, "black_end"),
            metric(line, "black_duration"),
        ) {
            report.black_intervals.push(BlackInterval {
                start_seconds: start,
                end_seconds: end,
                duration_seconds: duration,
            });
        }
        if let Some(start) = metric(line, "lavfi.freezedetect.freeze_start") {
            freeze_start = Some(start);
        }
        if let Some(duration) = metric(line, "lavfi.freezedetect.freeze_duration") {
            freeze_duration = Some(duration);
        }
        if let Some(end) = metric(line, "lavfi.freezedetect.freeze_end") {
            if let Some(start) = freeze_start.take() {
                report.freeze_intervals.push(FreezeInterval {
                    start_seconds: start,
                    end_seconds: end,
                    duration_seconds: freeze_duration.take().unwrap_or((end - start).max(0.0)),
                });
            }
        }
    }
    if let Some(start) = freeze_start {
        let end = probe_path(path)?.duration_seconds;
        if end > start {
            report.freeze_intervals.push(FreezeInterval {
                start_seconds: start,
                end_seconds: end,
                duration_seconds: freeze_duration.unwrap_or(end - start),
            });
        }
    }
    Ok(report)
}

fn validate_dimensions(width: u32, height: u32) -> Result<(), String> {
    if width == 0
        || height == 0
        || width > MAX_VIDEO_DIMENSION
        || height > MAX_VIDEO_DIMENSION
        || width % 2 != 0
        || height % 2 != 0
    {
        return Err("video_project_dimensions_invalid".to_string());
    }
    Ok(())
}

fn assert_normalized_probe(
    probe: &VideoProbe,
    width: u32,
    height: u32,
    duration_frames: u32,
) -> Result<(), String> {
    let expected_duration = duration_frames as f64 / NORMALIZED_FPS_NUM as f64;
    if probe.width != width
        || probe.height != height
        || probe.fps_num != NORMALIZED_FPS_NUM
        || probe.fps_den != NORMALIZED_FPS_DEN
        || probe.video_codec != "h264"
        || probe.pixel_format != "yuv420p"
        || probe.audio_sample_rate != Some(48_000)
        || probe.audio_channels != Some(2)
        || !probe.has_monotonic_timestamps
        || !probe.has_constant_frame_timestamps
        || probe.decoded_frame_count != duration_frames
        || (probe.duration_seconds - expected_duration).abs() > 0.005
    {
        return Err("normalized_video_contract_failed".to_string());
    }
    Ok(())
}

fn file_binding(path: &Path) -> Result<(String, u64, u64), String> {
    let mut file = fs::File::open(path).map_err(|_| "normalized_file_unreadable".to_string())?;
    let metadata = file
        .metadata()
        .map_err(|_| "normalized_file_unreadable".to_string())?;
    let modified = metadata
        .modified()
        .map_err(|_| "normalized_file_metadata_invalid".to_string())?
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "normalized_file_metadata_invalid".to_string())?
        .as_millis() as u64;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let count = file
            .read(&mut buffer)
            .map_err(|_| "normalized_file_unreadable".to_string())?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }
    Ok((format!("{:x}", hasher.finalize()), metadata.len(), modified))
}

fn publish_no_clobber(temp_path: &Path, output_path: &Path) -> Result<(), String> {
    fs::hard_link(temp_path, output_path).map_err(|error| {
        if output_path.exists() {
            "video_output_already_exists".to_string()
        } else {
            format!("video_atomic_publish_failed:{error}")
        }
    })?;
    fs::remove_file(temp_path).map_err(|_| "video_temp_cleanup_failed".to_string())
}

fn valid_segment_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 80
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
}

fn normalize_at_roots(
    project_root: &Path,
    asset_root: &Path,
    registry_root: &Path,
    input_path: &Path,
    segment_id: &str,
    project_width: u32,
    project_height: u32,
    duration_frames: u32,
) -> Result<NormalizedVideoSegment, String> {
    validate_dimensions(project_width, project_height)?;
    if duration_frames == 0 || duration_frames > MAX_SEGMENT_FRAMES {
        return Err("video_duration_frames_invalid".to_string());
    }
    if !valid_segment_id(segment_id) {
        return Err("video_segment_id_invalid".to_string());
    }
    let project_root =
        fs::canonicalize(project_root).map_err(|_| "video_project_root_unavailable".to_string())?;
    let asset_root =
        fs::canonicalize(asset_root).map_err(|_| "video_assets_root_invalid".to_string())?;
    let registry_root = ensure_registry_root(registry_root)?;
    let input = canonical_existing_file(
        input_path.to_string_lossy().as_ref(),
        &project_root,
        &asset_root,
    )?;
    let source_probe = probe_path(&input)?;
    let output_dir = ensure_derived_dir(
        &asset_root,
        "video-normalized",
        "video_output_directory_failed",
    )?;
    let output_path = output_dir.join(format!("{segment_id}-{}.mp4", random_hex(16)?));
    validate_publish_target(&output_path, &asset_root)?;
    if input == output_path {
        return Err("video_source_equals_output".to_string());
    }
    let temp_path = output_dir.join(format!(".{segment_id}.{}.tmp.mp4", unique_suffix()?));
    validate_publish_target(&temp_path, &asset_root)?;
    let duration = duration_frames as f64 / NORMALIZED_FPS_NUM as f64;
    let duration_arg = format!("{duration:.9}");
    let filter = format!(
        "fps=24,scale={project_width}:{project_height},setsar=1,format=yuv420p,tpad=stop_mode=clone:stop_duration={duration_arg}"
    );
    let mut command = Command::new("ffmpeg");
    command.args(["-v", "error", "-n", "-i"]).arg(&input);
    let synthetic_audio = source_probe.audio_channels.is_none();
    if synthetic_audio {
        command.args(["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"]);
    }
    command.args(["-map", "0:v:0"]);
    if synthetic_audio {
        command.args(["-map", "1:a:0"]);
    } else {
        command.args(["-map", "0:a:0"]);
    }
    let status = command
        .args(["-vf", &filter])
        .args(["-af", "aresample=48000,apad"])
        .args([
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-fps_mode",
            "cfr",
            "-c:a",
            "aac",
            "-ar",
            "48000",
            "-ac",
            "2",
            "-t",
            &duration_arg,
            "-movflags",
            "+faststart",
        ])
        .arg(&temp_path)
        .status()
        .map_err(|_| "ffmpeg_normalize_start_failed".to_string())?;
    if !status.success() {
        let _ = fs::remove_file(&temp_path);
        return Err("ffmpeg_normalize_failed".to_string());
    }
    let probe = match probe_path(&temp_path).and_then(|value| {
        assert_normalized_probe(&value, project_width, project_height, duration_frames)?;
        Ok(value)
    }) {
        Ok(value) => value,
        Err(error) => {
            let _ = fs::remove_file(&temp_path);
            return Err(error);
        }
    };
    let anomalies = match detect_anomalies(&temp_path) {
        Ok(value) => value,
        Err(error) => {
            let _ = fs::remove_file(&temp_path);
            return Err(error);
        }
    };
    publish_no_clobber(&temp_path, &output_path)?;
    let build_credential = (|| -> Result<NormalizationCredential, String> {
        let canonical_output = fs::canonicalize(&output_path)
            .map_err(|_| "video_atomic_publish_failed".to_string())?;
        let (sha256, byte_length, modified_unix_millis) = file_binding(&canonical_output)?;
        Ok(NormalizationCredential {
            schema_version: NORMALIZED_SCHEMA_VERSION,
            receipt_id: String::new(),
            normalized_path: canonical_output.to_string_lossy().to_string(),
            sha256,
            byte_length,
            modified_unix_millis,
            project_width,
            project_height,
            duration_frames,
            probe: probe.clone(),
        })
    })();
    let unsigned_credential = match build_credential {
        Ok(value) => value,
        Err(error) => {
            let _ = fs::remove_file(&output_path);
            return Err(error);
        }
    };
    let credential = match issue_registry_receipt(
        &registry_root,
        &project_root,
        &asset_root,
        unsigned_credential,
    ) {
        Ok(value) => value,
        Err(error) => {
            let _ = fs::remove_file(&output_path);
            return Err(error);
        }
    };
    Ok(NormalizedVideoSegment {
        credential,
        probe,
        anomalies,
    })
}

fn validate_concat_contract(segments: &[NormalizationCredential]) -> Result<(), String> {
    if segments.is_empty() {
        return Err("normalized_segments_missing".to_string());
    }
    let first = &segments[0];
    let mut receipt_ids = HashSet::new();
    for segment in segments {
        if segment.schema_version != NORMALIZED_SCHEMA_VERSION
            || !valid_receipt_id(&segment.receipt_id)
            || segment.normalized_path.trim().is_empty()
            || segment.sha256.len() != 64
            || !segment
                .sha256
                .bytes()
                .all(|value| value.is_ascii_hexdigit() && !value.is_ascii_uppercase())
        {
            return Err("normalization_credential_missing".to_string());
        }
        if !receipt_ids.insert(segment.receipt_id.as_str()) {
            return Err("normalization_receipt_duplicate".to_string());
        }
        if segment.probe.fps_num != NORMALIZED_FPS_NUM
            || segment.probe.fps_den != NORMALIZED_FPS_DEN
        {
            return Err("normalized_segment_fps_invalid".to_string());
        }
        if segment.project_width != first.project_width
            || segment.project_height != first.project_height
            || segment.probe.width != first.probe.width
            || segment.probe.height != first.probe.height
            || segment.probe.width != segment.project_width
            || segment.probe.height != segment.project_height
        {
            return Err("normalized_segment_dimensions_mismatch".to_string());
        }
        assert_normalized_probe(
            &segment.probe,
            segment.project_width,
            segment.project_height,
            segment.duration_frames,
        )?;
    }
    Ok(())
}

fn verify_credential(
    project_root: &Path,
    asset_root: &Path,
    registry_root: &Path,
    supplied: &NormalizationCredential,
) -> Result<PathBuf, String> {
    validate_concat_contract(std::slice::from_ref(supplied))?;
    let normalized = canonical_existing_file(&supplied.normalized_path, project_root, asset_root)?;
    if !normalized.starts_with(asset_root) {
        return Err("normalization_credential_outside_assets".to_string());
    }
    let record = load_registry_record(registry_root, project_root, asset_root, supplied)?;
    if fs::canonicalize(&record.credential.normalized_path)
        .ok()
        .as_ref()
        != Some(&normalized)
    {
        return Err("normalization_credential_mismatch".to_string());
    }
    let (sha256, byte_length, modified_unix_millis) = file_binding(&normalized)?;
    if sha256 != supplied.sha256
        || byte_length != supplied.byte_length
        || modified_unix_millis != supplied.modified_unix_millis
    {
        return Err("normalized_file_binding_mismatch".to_string());
    }
    let current_probe = probe_path(&normalized)?;
    if current_probe != supplied.probe {
        return Err("normalized_file_probe_mismatch".to_string());
    }
    Ok(normalized)
}

fn copy_verified_snapshot(source: &Path, target: &Path, expected_sha: &str) -> Result<(), String> {
    copy_verified_snapshot_with_hook(source, target, expected_sha, |_| Ok(()))
}

fn copy_verified_snapshot_with_hook<F>(
    source: &Path,
    target: &Path,
    expected_sha: &str,
    before_copy: F,
) -> Result<(), String>
where
    F: FnOnce(&Path) -> Result<(), String>,
{
    if target.exists() {
        return Err("video_snapshot_collision".to_string());
    }
    before_copy(source)?;
    let asset_root = target
        .ancestors()
        .find(|candidate| candidate.file_name().and_then(|value| value.to_str()) == Some("assets"))
        .ok_or_else(|| "video_output_outside_assets".to_string())?;
    secure_copy_create_new(source, target, asset_root)?;
    let (sha256, _, _) = file_binding(target)?;
    if sha256 != expected_sha {
        let _ = fs::remove_file(target);
        return Err("normalized_file_changed_during_snapshot".to_string());
    }
    Ok(())
}

fn stage_at_roots(
    project_root: &Path,
    asset_root: &Path,
    input_path: &Path,
) -> Result<StagedVideoSegment, String> {
    let project_root = fs::canonicalize(project_root)
        .map_err(|_| "video_project_root_unavailable".to_string())?;
    let asset_root = fs::canonicalize(asset_root)
        .map_err(|_| "video_assets_root_invalid".to_string())?;
    if asset_root == project_root || !asset_root.starts_with(&project_root) {
        return Err("video_assets_root_outside_project".to_string());
    }
    let source = canonical_external_file(input_path.to_string_lossy().as_ref())?;
    let stage_root = ensure_derived_dir(
        &asset_root,
        "video-staging",
        "video_staging_directory_failed",
    )?;
    let staging_receipt_id = random_hex(32)?;
    let target = stage_root.join(format!("stage-{staging_receipt_id}.media"));
    if source == target {
        return Err("video_source_equals_output".to_string());
    }
    secure_copy_create_new(&source, &target, &asset_root)?;
    Ok(StagedVideoSegment {
        staged_path: fs::canonicalize(&target)
            .map_err(|_| "video_snapshot_copy_failed".to_string())?
            .to_string_lossy()
            .to_string(),
        project_assets_dir: asset_root.to_string_lossy().to_string(),
        staging_receipt_id,
    })
}

fn remove_registered_file(path: &Path, allowed_root: &Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }
    let canonical = fs::canonicalize(path).map_err(|_| "video_cleanup_path_invalid".to_string())?;
    if !canonical.is_file() || !canonical.starts_with(allowed_root) || path_is_reparse(&canonical)? {
        return Err("video_cleanup_path_invalid".to_string());
    }
    fs::remove_file(canonical).map_err(|_| "video_cleanup_failed".to_string())
}

fn cleanup_at_roots(
    project_root: &Path,
    asset_root: &Path,
    registry_root: &Path,
    staged_segments: &[StagedVideoSegment],
    credentials: &[NormalizationCredential],
    review_frames: &[VideoReviewFrames],
) -> Result<(), String> {
    let project_root = fs::canonicalize(project_root)
        .map_err(|_| "video_project_root_unavailable".to_string())?;
    let asset_root = fs::canonicalize(asset_root)
        .map_err(|_| "video_assets_root_invalid".to_string())?;
    let staging_root = asset_root.join("video-staging");
    let normalized_root = asset_root.join("video-normalized");
    let review_root = asset_root.join("video-review");
    let mut registered_review_paths = HashSet::new();
    for staged in staged_segments {
        if staged.project_assets_dir != asset_root.to_string_lossy()
            || !valid_receipt_id(&staged.staging_receipt_id)
        {
            return Err("video_cleanup_claim_invalid".to_string());
        }
        let path = PathBuf::from(&staged.staged_path);
        if path.file_name().and_then(|value| value.to_str())
            != Some(format!("stage-{}.media", staged.staging_receipt_id).as_str())
        {
            return Err("video_cleanup_claim_invalid".to_string());
        }
        remove_registered_file(&path, &staging_root)?;
    }
    for credential in credentials {
        let (record, _) = load_signed_registry_record(
            registry_root,
            &project_root,
            &asset_root,
            credential,
        )?;
        registered_review_paths.extend(record.derived_paths.iter().cloned());
        remove_registered_file(Path::new(&record.credential.normalized_path), &normalized_root)?;
        let consumed = registry_consumed_path(registry_root, &credential.receipt_id)?;
        if !consumed.exists() {
            fs::remove_file(registry_receipt_path(registry_root, &credential.receipt_id)?)
                .map_err(|_| "video_cleanup_failed".to_string())?;
        }
    }
    for review in review_frames {
        for raw in [&review.first_frame_path, &review.middle_frame_path, &review.last_frame_path] {
            if !registered_review_paths.contains(raw) {
                return Err("video_cleanup_claim_invalid".to_string());
            }
            remove_registered_file(Path::new(raw), &review_root)?;
        }
        if let Some(parent) = Path::new(&review.first_frame_path).parent() {
            let _ = fs::remove_dir(parent);
        }
    }
    Ok(())
}

fn gc_at_roots(
    project_root: &Path,
    asset_root: &Path,
    registry_root: &Path,
    now_unix_millis: u64,
    ttl_millis: u64,
) -> Result<VideoGcReport, String> {
    let secret = authority_secret(authority_root_from_registry(registry_root)?)?;
    let canonical_project = project_root.to_string_lossy().to_string();
    let canonical_assets = asset_root.to_string_lossy().to_string();
    let normalized_root = asset_root.join("video-normalized");
    let review_root = asset_root.join("video-review");
    let mut report = VideoGcReport { receipts_removed: 0, assets_removed: 0 };
    for entry in fs::read_dir(registry_root)
        .map_err(|_| "normalization_registry_unavailable".to_string())?
    {
        let path = entry
            .map_err(|_| "normalization_registry_unavailable".to_string())?
            .path();
        if path.extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        let record: NormalizationRegistryRecord = serde_json::from_slice(
            &fs::read(&path).map_err(|_| "normalization_registry_invalid".to_string())?,
        )
        .map_err(|_| "normalization_registry_invalid".to_string())?;
        let expected = record_mac(&record, &secret)?;
        if !constant_time_hex_equal(&record.mac, &expected) {
            return Err("normalization_receipt_signature_invalid".to_string());
        }
        if record.canonical_project_root != canonical_project
            || record.canonical_asset_root != canonical_assets
        {
            continue;
        }
        if now_unix_millis.saturating_sub(record.issued_unix_millis) < ttl_millis {
            continue;
        }
        let lease = registry_lease_path(registry_root, &record.receipt_id)?;
        if lease.exists() {
            let marker = read_state_marker(&lease, &secret)?;
            if marker.state == "leased" {
                continue;
            }
            return Err("normalization_receipt_signature_invalid".to_string());
        }
        let normalized = Path::new(&record.credential.normalized_path);
        if normalized.exists() {
            remove_registered_file(normalized, &normalized_root)?;
            report.assets_removed += 1;
        }
        for raw in &record.derived_paths {
            let derived = Path::new(raw);
            if derived.exists() {
                remove_registered_file(derived, &review_root)?;
                report.assets_removed += 1;
                if let Some(parent) = derived.parent() { let _ = fs::remove_dir(parent); }
            }
        }
        let consumed = registry_consumed_path(registry_root, &record.receipt_id)?;
        if consumed.exists() {
            let marker = read_state_marker(&consumed, &secret)?;
            if marker.state != "consumed" || marker.receipt_id != record.receipt_id {
                return Err("normalization_receipt_signature_invalid".to_string());
            }
            fs::remove_file(consumed).map_err(|_| "video_cleanup_failed".to_string())?;
        }
        fs::remove_file(path).map_err(|_| "video_cleanup_failed".to_string())?;
        report.receipts_removed += 1;
    }
    Ok(report)
}

fn review_frame_filter(frame_index: u32) -> String {
    format!("select=eq(n\\,{frame_index})")
}

fn extract_frame(source: &Path, frame_index: u32, output: &Path) -> Result<(), String> {
    let filter = review_frame_filter(frame_index);
    let status = Command::new("ffmpeg")
        .args(["-v", "error", "-i"])
        .arg(source)
        .args(["-vf", &filter, "-frames:v", "1", "-an", "-n"])
        .arg(output)
        .status()
        .map_err(|_| "ffmpeg_review_frame_start_failed".to_string())?;
    if !status.success() || !output.is_file() {
        return Err("ffmpeg_review_frame_failed".to_string());
    }
    Ok(())
}

fn extract_review_frames_at_roots(
    project_root: &Path,
    asset_root: &Path,
    registry_root: &Path,
    credential: &NormalizationCredential,
) -> Result<VideoReviewFrames, String> {
    let project_root =
        fs::canonicalize(project_root).map_err(|_| "video_project_root_unavailable".to_string())?;
    let asset_root =
        fs::canonicalize(asset_root).map_err(|_| "video_assets_root_invalid".to_string())?;
    let registry_root = ensure_registry_root(registry_root)?;
    let source = verify_credential(&project_root, &asset_root, &registry_root, credential)?;
    let review_root =
        ensure_derived_dir(&asset_root, "video-review", "video_review_directory_failed")?;
    let output_dir = review_root.join(unique_suffix()?);
    fs::create_dir(&output_dir).map_err(|_| "video_review_directory_failed".to_string())?;
    let snapshot = output_dir.join("source.mp4");
    if let Err(error) = copy_verified_snapshot(&source, &snapshot, &credential.sha256) {
        let _ = fs::remove_dir_all(&output_dir);
        return Err(error);
    }
    let first = output_dir.join("first.png");
    let middle = output_dir.join("middle.png");
    let last = output_dir.join("last.png");
    let middle_index = credential.duration_frames / 2;
    let last_index = credential.duration_frames.saturating_sub(1);
    let extraction = extract_frame(&snapshot, 0, &first)
        .and_then(|_| extract_frame(&snapshot, middle_index, &middle))
        .and_then(|_| extract_frame(&snapshot, last_index, &last));
    let _ = fs::remove_file(&snapshot);
    if let Err(error) = extraction {
        let _ = fs::remove_dir_all(&output_dir);
        return Err(error);
    }
    if let Err(error) = register_review_paths(
        &registry_root,
        &project_root,
        &asset_root,
        credential,
        &[&first, &middle, &last],
    ) {
        let _ = fs::remove_dir_all(&output_dir);
        return Err(error);
    }
    Ok(VideoReviewFrames {
        first_frame_path: first.to_string_lossy().to_string(),
        middle_frame_path: middle.to_string_lossy().to_string(),
        last_frame_path: last.to_string_lossy().to_string(),
    })
}

fn same_stream_contract(left: &VideoProbe, right: &VideoProbe) -> bool {
    left.width == right.width
        && left.height == right.height
        && left.fps_num == right.fps_num
        && left.fps_den == right.fps_den
        && left.video_codec == right.video_codec
        && left.pixel_format == right.pixel_format
        && left.audio_sample_rate == right.audio_sample_rate
        && left.audio_channels == right.audio_channels
        && left.has_monotonic_timestamps
        && right.has_monotonic_timestamps
}

fn concat_at_roots(
    project_root: &Path,
    asset_root: &Path,
    registry_root: &Path,
    segments: &[NormalizationCredential],
) -> Result<ConcatenatedVideo, String> {
    concat_at_roots_with_ffmpeg_binary(
        project_root,
        asset_root,
        registry_root,
        segments,
        "ffmpeg",
    )
}

fn concat_at_roots_with_ffmpeg_binary(
    project_root: &Path,
    asset_root: &Path,
    registry_root: &Path,
    segments: &[NormalizationCredential],
    ffmpeg_binary: &str,
) -> Result<ConcatenatedVideo, String> {
    validate_concat_contract(segments)?;
    let project_root =
        fs::canonicalize(project_root).map_err(|_| "video_project_root_unavailable".to_string())?;
    let asset_root =
        fs::canonicalize(asset_root).map_err(|_| "video_assets_root_invalid".to_string())?;
    let registry_root = ensure_registry_root(registry_root)?;
    let assembled_root = ensure_derived_dir(
        &asset_root,
        "video-assembled",
        "video_concat_directory_failed",
    )?;
    let suffix = unique_suffix()?;
    let transaction_id = random_hex(32)?;
    let stage_dir = assembled_root.join(format!(".concat-stage-{suffix}"));
    fs::create_dir(&stage_dir).map_err(|_| "video_concat_stage_failed".to_string())?;
    let mut lease_active = false;
    let result = (|| -> Result<ConcatenatedVideo, String> {
        let mut list = String::new();
        let mut reference_probe: Option<VideoProbe> = None;
        for (index, credential) in segments.iter().enumerate() {
            let source = verify_credential(
                &project_root,
                &asset_root,
                &registry_root,
                credential,
            )?;
            let name = format!("segment-{index:06}.mp4");
            let snapshot = stage_dir.join(&name);
            copy_verified_snapshot(&source, &snapshot, &credential.sha256)?;
            let snapshot_probe = probe_path(&snapshot)?;
            if snapshot_probe != credential.probe {
                return Err("normalized_file_changed_during_snapshot".to_string());
            }
            if reference_probe
                .as_ref()
                .is_some_and(|reference| !same_stream_contract(reference, &snapshot_probe))
            {
                return Err("normalized_segment_probe_mismatch".to_string());
            }
            reference_probe.get_or_insert(snapshot_probe);
            list.push_str(&format!("file '{name}'\n"));
        }
        let list_path = stage_dir.join("segments.ffconcat");
        fs::write(&list_path, list).map_err(|_| "video_concat_list_failed".to_string())?;
        lease_registry_receipts(&registry_root, segments, &transaction_id)?;
        lease_active = true;
        let output_path = assembled_root.join(format!("assembled-{suffix}.mp4"));
        let temp_path = assembled_root.join(format!(".assembled-{suffix}.tmp.mp4"));
        validate_publish_target(&output_path, &asset_root)?;
        validate_publish_target(&temp_path, &asset_root)?;
        let first = &segments[0];
        let total_frames = segments.iter().try_fold(0_u32, |total, item| {
            total
                .checked_add(item.duration_frames)
                .ok_or_else(|| "video_duration_frames_invalid".to_string())
        })?;
        let total_duration = format!("{:.9}", total_frames as f64 / 24.0);
        let total_frames_arg = total_frames.to_string();
        let filter = format!(
            "fps=24,scale={}:{},setsar=1,format=yuv420p",
            first.project_width, first.project_height
        );
        let status = Command::new(ffmpeg_binary)
            .current_dir(&stage_dir)
            .args([
                "-v",
                "error",
                "-n",
                "-f",
                "concat",
                "-safe",
                "1",
                "-i",
                "segments.ffconcat",
                "-vf",
                &filter,
                "-af",
                "aresample=48000",
                "-c:v",
                "libx264",
                "-frames:v",
                &total_frames_arg,
                "-pix_fmt",
                "yuv420p",
                "-fps_mode",
                "cfr",
                "-c:a",
                "aac",
                "-ar",
                "48000",
                "-ac",
                "2",
                "-t",
                &total_duration,
                "-movflags",
                "+faststart",
            ])
            .arg(&temp_path)
            .status()
            .map_err(|_| "ffmpeg_concat_start_failed".to_string())?;
        if !status.success() {
            let _ = fs::remove_file(&temp_path);
            return Err("ffmpeg_concat_failed".to_string());
        }
        let probe = probe_path(&temp_path)?;
        assert_normalized_probe(
            &probe,
            first.project_width,
            first.project_height,
            total_frames,
        )?;
        publish_no_clobber(&temp_path, &output_path)?;
        if let Err(error) = commit_registry_receipts(&registry_root, segments, &transaction_id) {
            let _ = fs::remove_file(&output_path);
            return Err(error);
        }
        lease_active = false;
        Ok(ConcatenatedVideo {
            output_path: fs::canonicalize(output_path)
                .map_err(|_| "video_atomic_publish_failed".to_string())?
                .to_string_lossy()
                .to_string(),
            probe,
        })
    })();
    if lease_active {
        let _ = release_registry_leases(&registry_root, segments, &transaction_id);
    }
    let _ = fs::remove_dir_all(stage_dir);
    result
}

#[tauri::command]
pub fn stage_video_segment(
    app: tauri::AppHandle,
    input_path: String,
) -> Result<StagedVideoSegment, String> {
    let (project_root, asset_root) = resolve_current_project_assets(&app)?;
    stage_at_roots(&project_root, &asset_root, Path::new(&input_path))
}

#[tauri::command]
pub fn probe_video_segment(
    app: tauri::AppHandle,
    input_path: String,
    project_assets_dir: String,
) -> Result<VideoInspection, String> {
    let (project_root, asset_root) = resolve_roots(&app, &project_assets_dir)?;
    let input = canonical_existing_file(&input_path, &project_root, &asset_root)?;
    Ok(VideoInspection {
        probe: probe_path(&input)?,
        anomalies: detect_anomalies(&input)?,
    })
}

#[tauri::command]
pub fn normalize_video_segment(
    app: tauri::AppHandle,
    input_path: String,
    project_assets_dir: String,
    segment_id: String,
    project_width: u32,
    project_height: u32,
    duration_frames: u32,
) -> Result<NormalizedVideoSegment, String> {
    let (project_root, asset_root) = resolve_roots(&app, &project_assets_dir)?;
    let registry_root = resolve_registry_root(&app)?;
    let input = canonical_existing_file(&input_path, &project_root, &asset_root)?;
    normalize_at_roots(
        &project_root,
        &asset_root,
        &registry_root,
        &input,
        &segment_id,
        project_width,
        project_height,
        duration_frames,
    )
}

#[tauri::command]
pub fn extract_video_review_frames(
    app: tauri::AppHandle,
    project_assets_dir: String,
    credential: NormalizationCredential,
) -> Result<VideoReviewFrames, String> {
    let (project_root, asset_root) = resolve_roots(&app, &project_assets_dir)?;
    let registry_root = resolve_registry_root(&app)?;
    extract_review_frames_at_roots(&project_root, &asset_root, &registry_root, &credential)
}

#[tauri::command]
pub fn concat_normalized_video_segments(
    app: tauri::AppHandle,
    project_assets_dir: String,
    segments: Vec<NormalizationCredential>,
) -> Result<ConcatenatedVideo, String> {
    let (project_root, asset_root) = resolve_roots(&app, &project_assets_dir)?;
    let registry_root = resolve_registry_root(&app)?;
    concat_at_roots(&project_root, &asset_root, &registry_root, &segments)
}

#[tauri::command]
pub fn cleanup_video_assembly_assets(
    app: tauri::AppHandle,
    project_assets_dir: String,
    staged_segments: Vec<StagedVideoSegment>,
    credentials: Vec<NormalizationCredential>,
    review_frames: Vec<VideoReviewFrames>,
) -> Result<(), String> {
    let (project_root, asset_root) = resolve_roots(&app, &project_assets_dir)?;
    let registry_root = resolve_registry_root(&app)?;
    cleanup_at_roots(
        &project_root,
        &asset_root,
        &registry_root,
        &staged_segments,
        &credentials,
        &review_frames,
    )
}

#[tauri::command]
pub fn gc_video_continuity_assets(
    app: tauri::AppHandle,
    project_assets_dir: String,
    ttl_seconds: u64,
) -> Result<VideoGcReport, String> {
    if ttl_seconds == 0 || ttl_seconds > 365 * 24 * 60 * 60 {
        return Err("video_gc_ttl_invalid".to_string());
    }
    let (project_root, asset_root) = resolve_roots(&app, &project_assets_dir)?;
    let registry_root = resolve_registry_root(&app)?;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "video_clock_invalid".to_string())?
        .as_millis() as u64;
    gc_at_roots(
        &project_root,
        &asset_root,
        &registry_root,
        now,
        ttl_seconds.saturating_mul(1000),
    )
}

#[cfg(test)]
fn test_credential(
    name: &str,
    width: u32,
    height: u32,
    fps_num: u32,
    fps_den: u32,
) -> NormalizationCredential {
    NormalizationCredential {
        schema_version: NORMALIZED_SCHEMA_VERSION,
        receipt_id: "a".repeat(64),
        normalized_path: format!("C:\\project\\{name}.mp4"),
        sha256: "a".repeat(64),
        byte_length: 1,
        modified_unix_millis: 1,
        project_width: width,
        project_height: height,
        duration_frames: 24,
        probe: VideoProbe {
            width,
            height,
            fps_num,
            fps_den,
            duration_seconds: 1.0,
            video_codec: "h264".to_string(),
            pixel_format: "yuv420p".to_string(),
            audio_sample_rate: Some(48_000),
            audio_channels: Some(2),
            has_monotonic_timestamps: true,
            has_constant_frame_timestamps: true,
            decoded_frame_count: 24,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::process::Command;
    use std::time::{SystemTime, UNIX_EPOCH};

    struct FixtureDir(PathBuf);

    impl FixtureDir {
        fn new(label: &str) -> Self {
            let unique = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let root = std::env::temp_dir().join(format!(
                "storyboard-video-continuity-{label}-{}-{unique}",
                std::process::id()
            ));
            fs::create_dir_all(root.join("assets/raw")).unwrap();
            fs::create_dir_all(root.join("private-registry")).unwrap();
            Self(root)
        }

        fn root(&self) -> &Path {
            &self.0
        }

        fn assets(&self) -> PathBuf {
            self.0.join("assets")
        }

        fn registry(&self) -> PathBuf {
            self.0.join("private-registry")
        }
    }

    impl Drop for FixtureDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn make_fixture(path: &Path, fps: u32, size: &str, duration: &str, black: bool) {
        let color = if black { "black" } else { "red" };
        let status = Command::new("ffmpeg")
            .args(["-v", "error", "-f", "lavfi", "-i"])
            .arg(format!("color=c={color}:s={size}:r={fps}:d={duration}"))
            .args(["-f", "lavfi", "-i"])
            .arg(format!(
                "sine=frequency=440:sample_rate=48000:duration={duration}"
            ))
            .args([
                "-map",
                "0:v:0",
                "-map",
                "1:a:0",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-ar",
                "48000",
                "-ac",
                "2",
                "-shortest",
                "-n",
            ])
            .arg(path)
            .status()
            .unwrap();
        assert!(status.success());
    }

    fn make_distinct_fixture(path: &Path, frame_count: u32) {
        let duration = frame_count as f64 / 24.0;
        let status = Command::new("ffmpeg")
            .args(["-v", "error", "-f", "lavfi", "-i"])
            .arg(format!("testsrc2=s=160x120:r=24:d={duration:.9}"))
            .args(["-f", "lavfi", "-i"])
            .arg(format!(
                "sine=frequency=440:sample_rate=48000:duration={duration:.9}"
            ))
            .args([
                "-map",
                "0:v:0",
                "-map",
                "1:a:0",
                "-frames:v",
                &frame_count.to_string(),
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-ar",
                "48000",
                "-ac",
                "2",
                "-t",
                &format!("{duration:.9}"),
                "-n",
            ])
            .arg(path)
            .status()
            .unwrap();
        assert!(status.success());
    }

    fn make_silent_fixture(path: &Path, frame_count: u32) {
        let duration = frame_count as f64 / 24.0;
        let status = Command::new("ffmpeg")
            .args(["-v", "error", "-f", "lavfi", "-i"])
            .arg(format!("testsrc2=s=160x120:r=24:d={duration:.9}"))
            .args([
                "-frames:v",
                &frame_count.to_string(),
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                "-an",
                "-t",
                &format!("{duration:.9}"),
                "-n",
            ])
            .arg(path)
            .status()
            .unwrap();
        assert!(status.success());
    }

    fn assert_real_media_rejected_before_lease(
        fixture: &FixtureDir,
        media: &Path,
        label: &str,
    ) {
        let probe = probe_path(media).unwrap();
        let (sha256, byte_length, modified_unix_millis) = file_binding(media).unwrap();
        let project_root = fs::canonicalize(fixture.root()).unwrap();
        let asset_root = fs::canonicalize(fixture.assets()).unwrap();
        let registry_root = ensure_registry_root(fixture.registry().as_path()).unwrap();
        let credential = issue_registry_receipt(
            &registry_root,
            &project_root,
            &asset_root,
            NormalizationCredential {
                schema_version: NORMALIZED_SCHEMA_VERSION,
                receipt_id: String::new(),
                normalized_path: fs::canonicalize(media).unwrap().to_string_lossy().to_string(),
                sha256,
                byte_length,
                modified_unix_millis,
                project_width: probe.width,
                project_height: probe.height,
                duration_frames: probe.decoded_frame_count,
                probe,
            },
        )
        .unwrap();
        let error = concat_at_roots(
            &project_root,
            &asset_root,
            &registry_root,
            std::slice::from_ref(&credential),
        )
        .unwrap_err();
        assert!(
            error.starts_with("normalized_"),
            "{label} must fail the normalized media contract, got {error}"
        );
        assert!(!registry_lease_path(&registry_root, &credential.receipt_id).unwrap().exists());
        assert!(!registry_consumed_path(&registry_root, &credential.receipt_id).unwrap().exists());
        let visible = fixture.assets().join("video-assembled");
        assert!(
            !visible.exists()
                || fs::read_dir(visible)
                    .unwrap()
                    .filter_map(Result::ok)
                    .all(|entry| entry.path().extension().and_then(|value| value.to_str()) != Some("mp4"))
        );
    }

    #[test]
    fn path_guard_rejects_empty_relative_outside_same_source_and_existing_output() {
        let fixture = FixtureDir::new("path-guard");
        let input = fixture.assets().join("raw/input.mp4");
        fs::write(&input, b"fixture").unwrap();
        let outside = fixture.root().parent().unwrap().join("outside.mp4");
        fs::write(&outside, b"outside").unwrap();

        assert_eq!(
            canonical_existing_file("", fixture.root(), fixture.assets().as_path()).unwrap_err(),
            "video_input_path_missing"
        );
        assert_eq!(
            canonical_existing_file("relative.mp4", fixture.root(), fixture.assets().as_path())
                .unwrap_err(),
            "video_path_must_be_absolute"
        );
        assert_eq!(
            canonical_existing_file(
                outside.to_str().unwrap(),
                fixture.root(),
                fixture.assets().as_path()
            )
            .unwrap_err(),
            "video_path_outside_project"
        );
        assert_eq!(
            validate_publish_target(&input, fixture.assets().as_path()).unwrap_err(),
            "video_output_already_exists"
        );
    }

    #[test]
    fn atomic_publish_never_clobbers_a_preoccupied_target() {
        let fixture = FixtureDir::new("no-clobber");
        let temp = fixture.assets().join("candidate.tmp.mp4");
        let output = fixture.assets().join("final.mp4");
        fs::write(&temp, b"new-video").unwrap();
        fs::write(&output, b"existing-user-file").unwrap();
        assert_eq!(
            publish_no_clobber(&temp, &output).unwrap_err(),
            "video_output_already_exists"
        );
        assert_eq!(fs::read(&output).unwrap(), b"existing-user-file");
        assert!(temp.is_file(), "failed publication must retain the unpublished temp");
    }

    #[test]
    fn source_replacement_between_validation_and_snapshot_fails_closed() {
        let fixture = FixtureDir::new("toctou");
        let source = fixture.assets().join("raw/source.mp4");
        let snapshot = fixture.assets().join("snapshot.mp4");
        fs::write(&source, b"validated-content").unwrap();
        let expected_sha = file_binding(&source).unwrap().0;
        assert_eq!(
            copy_verified_snapshot_with_hook(&source, &snapshot, &expected_sha, |path| {
                fs::write(path, b"replacement-after-validation")
                    .map_err(|_| "test_replace_failed".to_string())
            })
            .unwrap_err(),
            "normalized_file_changed_during_snapshot"
        );
        assert!(!snapshot.exists(), "failed snapshot must not remain concat-visible");
    }

    #[test]
    fn derived_directory_symlink_escape_is_rejected_or_explicitly_skipped() {
        let fixture = FixtureDir::new("symlink");
        let outside = fixture.root().join("outside");
        fs::create_dir(&outside).unwrap();
        let link = fixture.assets().join("video-review");
        #[cfg(windows)]
        let linked = std::os::windows::fs::symlink_dir(&outside, &link);
        #[cfg(unix)]
        let linked = std::os::unix::fs::symlink(&outside, &link);
        #[cfg(not(any(windows, unix)))]
        let linked: std::io::Result<()> = Err(std::io::Error::new(
            std::io::ErrorKind::Unsupported,
            "symlink API unavailable",
        ));
        if let Err(error) = linked {
            eprintln!("SKIP symlink containment fixture: {error}");
            return;
        }
        assert_eq!(
            ensure_derived_dir(
                fs::canonicalize(fixture.assets()).unwrap().as_path(),
                "video-review",
                "video_review_directory_failed",
            )
            .unwrap_err(),
            "video_output_outside_assets"
        );
        assert!(fs::read_dir(&outside).unwrap().next().is_none());
    }

    #[test]
    fn vfr_bad_timestamps_codec_and_audio_claims_fail_preflight() {
        let mut vfr = test_credential("vfr", 320, 240, 24, 1);
        vfr.probe.has_constant_frame_timestamps = false;
        assert_eq!(
            validate_concat_contract(&[vfr]).unwrap_err(),
            "normalized_video_contract_failed"
        );
        let mut bad_timestamp = test_credential("timestamp", 320, 240, 24, 1);
        bad_timestamp.probe.has_monotonic_timestamps = false;
        assert_eq!(
            validate_concat_contract(&[bad_timestamp]).unwrap_err(),
            "normalized_video_contract_failed"
        );
        let mut wrong_codec = test_credential("codec", 320, 240, 24, 1);
        wrong_codec.probe.video_codec = "hevc".to_string();
        assert_eq!(
            validate_concat_contract(&[wrong_codec]).unwrap_err(),
            "normalized_video_contract_failed"
        );
        let mut wrong_audio = test_credential("audio", 320, 240, 24, 1);
        wrong_audio.probe.audio_sample_rate = Some(44_100);
        assert_eq!(
            validate_concat_contract(&[wrong_audio]).unwrap_err(),
            "normalized_video_contract_failed"
        );
    }

    #[test]
    fn silent_input_is_normalized_with_bounded_aac_stereo() {
        let fixture = FixtureDir::new("silent");
        let input = fixture.assets().join("raw/silent.mp4");
        make_silent_fixture(&input, 6);
        let normalized = normalize_at_roots(
            fixture.root(),
            fixture.assets().as_path(),
            fixture.registry().as_path(),
            &input,
            "silent",
            160,
            120,
            6,
        )
        .unwrap();
        assert_eq!(normalized.probe.decoded_frame_count, 6);
        assert_eq!(normalized.probe.audio_sample_rate, Some(48_000));
        assert_eq!(normalized.probe.audio_channels, Some(2));
        assert!((normalized.probe.duration_seconds - 0.25).abs() <= 0.005);
    }

    #[test]
    fn concat_preflight_rejects_missing_receipt_non_24fps_and_dimension_mismatch() {
        let base = test_credential("one", 1280, 720, 24, 1);
        let mut missing = base.clone();
        missing.receipt_id.clear();
        assert_eq!(
            validate_concat_contract(&[missing]).unwrap_err(),
            "normalization_credential_missing"
        );

        let mut wrong_fps = base.clone();
        wrong_fps.probe.fps_num = 30;
        assert_eq!(
            validate_concat_contract(&[wrong_fps]).unwrap_err(),
            "normalized_segment_fps_invalid"
        );

        let mut wrong_size = test_credential("two", 1920, 720, 24, 1);
        wrong_size.receipt_id = "b".repeat(64);
        wrong_size.probe.width = 1920;
        assert_eq!(
            validate_concat_contract(&[base, wrong_size]).unwrap_err(),
            "normalized_segment_dimensions_mismatch"
        );
    }

    #[test]
    fn caller_forged_project_receipt_is_never_backend_issued() {
        let fixture = FixtureDir::new("forged-receipt");
        let media = fixture.assets().join("raw/forged.mp4");
        make_fixture(&media, 24, "320x240", "1", false);
        let canonical_media = fs::canonicalize(&media).unwrap();
        let probe = probe_path(&canonical_media).unwrap();
        let (sha256, byte_length, modified_unix_millis) = file_binding(&canonical_media).unwrap();
        let fake_project_receipt = fixture.assets().join("raw/forged.normalized.json");
        let forged = NormalizationCredential {
            schema_version: NORMALIZED_SCHEMA_VERSION,
            receipt_id: "b".repeat(64),
            normalized_path: canonical_media.to_string_lossy().to_string(),
            sha256,
            byte_length,
            modified_unix_millis,
            project_width: 320,
            project_height: 240,
            duration_frames: 24,
            probe,
        };
        fs::write(
            &fake_project_receipt,
            serde_json::to_vec_pretty(&forged).unwrap(),
        )
        .unwrap();
        let project_root = fs::canonicalize(fixture.root()).unwrap();
        let asset_root = fs::canonicalize(fixture.assets()).unwrap();
        let registry_root = fs::canonicalize(fixture.registry()).unwrap();
        assert_eq!(
            verify_credential(&project_root, &asset_root, &registry_root, &forged).unwrap_err(),
            "normalization_receipt_not_issued"
        );
    }

    #[test]
    fn issued_registry_record_tampering_is_rejected_by_backend_mac() {
        let fixture = FixtureDir::new("registry-mac");
        let input = fixture.assets().join("raw/input.mp4");
        make_fixture(&input, 24, "160x120", "0.25", false);
        let normalized = normalize_at_roots(
            fixture.root(),
            fixture.assets().as_path(),
            fixture.registry().as_path(),
            &input,
            "mac",
            160,
            120,
            6,
        )
        .unwrap();
        let receipt_path = registry_receipt_path(
            fixture.registry().as_path(),
            &normalized.credential.receipt_id,
        )
        .unwrap();
        let mut record: serde_json::Value =
            serde_json::from_slice(&fs::read(&receipt_path).unwrap()).unwrap();
        record["issuanceNonce"] = serde_json::Value::String("f".repeat(64));
        fs::write(&receipt_path, serde_json::to_vec(&record).unwrap()).unwrap();
        let error = verify_credential(
            &fs::canonicalize(fixture.root()).unwrap(),
            &fs::canonicalize(fixture.assets()).unwrap(),
            &fs::canonicalize(fixture.registry()).unwrap(),
            &normalized.credential,
        )
        .unwrap_err();
        assert_eq!(error, "normalization_receipt_signature_invalid");
    }

    #[test]
    fn generic_file_command_guard_rejects_authority_sources_and_targets() {
        let fixture = FixtureDir::new("authority-command-guard");
        let app_data = fixture.root().join("app-data");
        let receipts = app_data.join(AUTHORITY_DIRECTORY).join("receipts");
        ensure_registry_root(&receipts).unwrap();
        let protected = receipts.join(format!("{}.json", "a".repeat(64)));
        fs::write(&protected, b"signed-record").unwrap();
        let ordinary = app_data.join("ordinary/output.bin");
        fs::create_dir_all(ordinary.parent().unwrap()).unwrap();

        assert_eq!(
            reject_authority_file_command_path_at_app_data(&app_data, protected.to_str().unwrap())
                .unwrap_err(),
            "video_authority_path_forbidden"
        );
        reject_authority_file_command_path_at_app_data(&app_data, ordinary.to_str().unwrap())
            .unwrap();
    }

    #[test]
    fn current_project_marker_stages_external_comfy_media_into_real_sbproj_assets() {
        let fixture = FixtureDir::new("project-marker-stage");
        let app_data = fixture.root().join("workspace");
        let project = app_data.join("demo.sbproj");
        fs::create_dir_all(&project).unwrap();
        fs::write(app_data.join("current-project.txt"), project.to_string_lossy().as_bytes()).unwrap();
        let comfy_output = fixture.root().join("ComfyUI/output");
        fs::create_dir_all(&comfy_output).unwrap();
        let source = comfy_output.join("h3.mp4");
        fs::write(&source, b"resolved-h3-output").unwrap();

        let (project_root, asset_root) = resolve_current_project_assets_at_app_data(&app_data).unwrap();
        let staged = stage_at_roots(&project_root, &asset_root, &source).unwrap();
        let staged_path = fs::canonicalize(&staged.staged_path).unwrap();
        assert_eq!(project_root, fs::canonicalize(&project).unwrap());
        assert_eq!(asset_root, fs::canonicalize(project.join("assets")).unwrap());
        assert!(staged_path.starts_with(&asset_root));
        assert_eq!(fs::read(staged_path).unwrap(), b"resolved-h3-output");
        assert!(!staged.project_assets_dir.contains("ComfyUI"));
    }

    #[test]
    fn receipt_leases_are_exclusive_releasable_and_only_commit_after_success() {
        let fixture = FixtureDir::new("receipt-lease");
        let input = fixture.assets().join("raw/input.mp4");
        make_fixture(&input, 24, "160x120", "0.25", false);
        let normalized = normalize_at_roots(
            fixture.root(),
            fixture.assets().as_path(),
            fixture.registry().as_path(),
            &input,
            "lease",
            160,
            120,
            6,
        )
        .unwrap();
        let credentials = vec![normalized.credential.clone()];
        lease_registry_receipts(fixture.registry().as_path(), &credentials, "txn-a").unwrap();
        assert_eq!(
            lease_registry_receipts(fixture.registry().as_path(), &credentials, "txn-b")
                .unwrap_err(),
            "normalization_receipt_leased"
        );
        release_registry_leases(fixture.registry().as_path(), &credentials, "txn-a").unwrap();
        lease_registry_receipts(fixture.registry().as_path(), &credentials, "txn-c").unwrap();
        commit_registry_receipts(fixture.registry().as_path(), &credentials, "txn-c").unwrap();
        assert_eq!(
            verify_credential(
                &fs::canonicalize(fixture.root()).unwrap(),
                &fs::canonicalize(fixture.assets()).unwrap(),
                &fs::canonicalize(fixture.registry()).unwrap(),
                &normalized.credential,
            )
            .unwrap_err(),
            "normalization_receipt_consumed"
        );
    }

    #[test]
    fn concat_ffmpeg_failure_releases_lease_and_retry_succeeds() {
        let fixture = FixtureDir::new("concat-retry");
        let input = fixture.assets().join("raw/input.mp4");
        make_fixture(&input, 24, "160x120", "0.25", false);
        let normalized = normalize_at_roots(
            fixture.root(),
            fixture.assets().as_path(),
            fixture.registry().as_path(),
            &input,
            "retry",
            160,
            120,
            6,
        )
        .unwrap();
        let credentials = vec![normalized.credential.clone()];
        assert_eq!(
            concat_at_roots_with_ffmpeg_binary(
                fixture.root(),
                fixture.assets().as_path(),
                fixture.registry().as_path(),
                &credentials,
                "definitely-missing-task7-ffmpeg",
            )
            .unwrap_err(),
            "ffmpeg_concat_start_failed"
        );
        assert!(!registry_lease_path(fixture.registry().as_path(), &credentials[0].receipt_id)
            .unwrap()
            .exists());
        let assembled = concat_at_roots(
            fixture.root(),
            fixture.assets().as_path(),
            fixture.registry().as_path(),
            &credentials,
        )
        .unwrap();
        assert!(Path::new(&assembled.output_path).is_file());
    }

    #[cfg(windows)]
    #[test]
    fn ordinary_user_junction_is_rejected_before_any_external_write() {
        let fixture = FixtureDir::new("junction");
        let outside = fixture.root().join("outside-target");
        fs::create_dir(&outside).unwrap();
        let junction = fixture.assets().join("video-staging");
        let status = Command::new("cmd")
            .args(["/c", "mklink", "/J"])
            .arg(&junction)
            .arg(&outside)
            .status()
            .unwrap();
        assert!(status.success(), "ordinary-user junction fixture must be available");
        assert_eq!(
            ensure_no_reparse_ancestors(fixture.assets().as_path(), &junction).unwrap_err(),
            "video_output_reparse_forbidden"
        );
        let source = fixture.assets().join("raw/source.bin");
        fs::write(&source, b"must-not-escape").unwrap();
        assert_eq!(
            secure_copy_create_new(&source, &junction.join("escaped.bin"), fixture.assets().as_path())
                .unwrap_err(),
            "video_output_reparse_forbidden"
        );
        assert!(fs::read_dir(&outside).unwrap().next().is_none());
    }

    #[test]
    fn real_media_contract_negatives_fail_before_lease_or_publish() {
        let fixture = FixtureDir::new("real-negatives");
        let cases = [
            ("ntsc", "testsrc2=s=160x120:r=24000/1001:d=1", "libx264", "aac", "48000", "2"),
            ("codec", "testsrc2=s=160x120:r=24:d=1", "mpeg4", "aac", "48000", "2"),
            ("audio", "testsrc2=s=160x120:r=24:d=1", "libx264", "aac", "44100", "1"),
        ];
        for (label, video_source, video_codec, audio_codec, sample_rate, channels) in cases {
            let media = fixture.assets().join("raw").join(format!("{label}.mp4"));
            let status = Command::new("ffmpeg")
                .args(["-v", "error", "-f", "lavfi", "-i", video_source])
                .args(["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=1"])
                .args(["-map", "0:v:0", "-map", "1:a:0", "-c:v", video_codec])
                .args(["-c:a", audio_codec, "-ar", sample_rate, "-ac", channels, "-n"])
                .arg(&media)
                .status()
                .unwrap();
            assert!(status.success(), "failed to generate {label} fixture");
            assert_real_media_rejected_before_lease(&fixture, &media, label);
        }

        let mixed = fixture.assets().join("raw/mixed.mp4");
        let status = Command::new("ffmpeg")
            .args(["-v", "error", "-f", "lavfi", "-i", "color=red:s=160x120:r=24:d=1"])
            .args(["-f", "lavfi", "-i", "color=blue:s=160x120:r=24:d=1"])
            .args(["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"])
            .args(["-map", "0:v:0", "-map", "1:v:0", "-map", "2:a:0", "-t", "1"])
            .args(["-c:v", "libx264", "-c:a", "aac", "-n"])
            .arg(&mixed)
            .status()
            .unwrap();
        assert!(status.success());
        assert_eq!(probe_path(&mixed).unwrap_err(), "ffprobe_stream_layout_invalid");
        assert!(!fixture.assets().join("video-assembled").exists());

        for (label, filter) in [
            (
                "vfr",
                "setpts=if(lt(N\\,12)\\,N/(24*TB)\\,(12/(24*TB)+(N-12)/(12*TB)))",
            ),
            ("duplicate-ts", "setpts=floor(N/2)/(24*TB)"),
            ("reverse-ts", "setpts=(24-N)/(24*TB)"),
        ] {
            let media = fixture.assets().join("raw").join(format!("{label}.mkv"));
            let status = Command::new("ffmpeg")
                .args(["-v", "error", "-f", "lavfi", "-i", "testsrc2=s=160x120:r=24:d=1"])
                .args(["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"])
                .args(["-vf", filter, "-fps_mode", "passthrough", "-map", "0:v:0", "-map", "1:a:0"])
                .args(["-c:v", "libx264", "-bf", "0", "-c:a", "aac", "-t", "1", "-n"])
                .arg(&media)
                .status()
                .unwrap();
            assert!(status.success(), "failed to generate {label}");
            let probe = match probe_path(&media) {
                Ok(probe) => probe,
                Err(error) if label == "reverse-ts" => {
                    assert_eq!(error, "ffprobe_frame_count_invalid");
                    assert!(!fixture.assets().join("video-assembled").exists());
                    continue;
                }
                Err(error) => panic!("{label}: {error}"),
            };
            assert!(
                !probe.has_constant_frame_timestamps || !probe.has_monotonic_timestamps,
                "{label} must expose non-CFR or non-monotonic packet timestamps"
            );
            assert_real_media_rejected_before_lease(&fixture, &media, label);
        }

        let missing_timestamps = fixture.assets().join("raw/missing-timestamps.h264");
        let status = Command::new("ffmpeg")
            .args(["-v", "error", "-f", "lavfi", "-i", "testsrc2=s=160x120:r=24:d=0.5"])
            .args(["-c:v", "libx264", "-bf", "0", "-an", "-f", "h264", "-n"])
            .arg(&missing_timestamps)
            .status()
            .unwrap();
        assert!(status.success());
        assert!(probe_path(&missing_timestamps).is_err(), "raw stream without observable timestamps/duration must fail closed");
    }

    #[test]
    fn gc_is_scoped_by_signed_project_claims_and_never_deletes_published_history() {
        let fixture = FixtureDir::new("gc");
        let project_one = fixture.root().join("one.sbproj");
        let project_two = fixture.root().join("two.sbproj");
        for project in [&project_one, &project_two] {
            fs::create_dir_all(project.join("assets/raw")).unwrap();
        }
        let registry = fixture.root().join("authority/receipts");
        let input_one = project_one.join("assets/raw/one.mp4");
        let input_two = project_two.join("assets/raw/two.mp4");
        make_fixture(&input_one, 24, "160x120", "0.25", false);
        make_fixture(&input_two, 24, "160x120", "0.25", false);
        let one = normalize_at_roots(
            &project_one,
            &project_one.join("assets"),
            &registry,
            &input_one,
            "one",
            160,
            120,
            6,
        )
        .unwrap();
        let two = normalize_at_roots(
            &project_two,
            &project_two.join("assets"),
            &registry,
            &input_two,
            "two",
            160,
            120,
            6,
        )
        .unwrap();
        let assembled = concat_at_roots(
            &project_one,
            &project_one.join("assets"),
            &registry,
            std::slice::from_ref(&one.credential),
        )
        .unwrap();
        let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as u64;
        let report = gc_at_roots(
            &fs::canonicalize(&project_one).unwrap(),
            &fs::canonicalize(project_one.join("assets")).unwrap(),
            &ensure_registry_root(&registry).unwrap(),
            now.saturating_add(10_000),
            1,
        )
        .unwrap();
        assert_eq!(report.receipts_removed, 1);
        assert!(!Path::new(&one.credential.normalized_path).exists());
        assert!(Path::new(&assembled.output_path).is_file(), "GC must retain published assembly history");
        assert!(Path::new(&two.credential.normalized_path).is_file(), "other project assets must remain");
        assert!(registry_receipt_path(&registry, &two.credential.receipt_id).unwrap().is_file());
    }

    #[test]
    fn ffprobe_fixture_reports_exact_stream_contract_and_monotonic_timestamps() {
        let fixture = FixtureDir::new("probe");
        let input = fixture.assets().join("raw/probe.mp4");
        make_fixture(&input, 24, "320x240", "1", false);
        let probe = probe_path(&input).unwrap();
        assert_eq!((probe.width, probe.height), (320, 240));
        assert_eq!((probe.fps_num, probe.fps_den), (24, 1));
        assert_eq!(probe.decoded_frame_count, 24);
        assert_eq!(probe.video_codec, "h264");
        assert_eq!(probe.pixel_format, "yuv420p");
        assert_eq!(probe.audio_sample_rate, Some(48_000));
        assert_eq!(probe.audio_channels, Some(2));
        assert!(probe.has_monotonic_timestamps);
    }

    #[test]
    fn review_frame_selection_is_by_decoded_index_not_timestamp_seek() {
        assert_eq!(review_frame_filter(0), "select=eq(n\\,0)");
        assert_eq!(review_frame_filter(7), "select=eq(n\\,7)");
    }

    #[test]
    fn review_frames_match_full_decode_golden_for_one_odd_and_even_counts() {
        let fixture = FixtureDir::new("review-golden");
        for frame_count in [1_u32, 5, 4] {
            let input = fixture
                .assets()
                .join("raw")
                .join(format!("distinct-{frame_count}.mp4"));
            make_distinct_fixture(&input, frame_count);
            let normalized = normalize_at_roots(
                fixture.root(),
                fixture.assets().as_path(),
                fixture.registry().as_path(),
                &input,
                &format!("distinct-{frame_count}"),
                160,
                120,
                frame_count,
            )
            .unwrap();
            let review = extract_review_frames_at_roots(
                fixture.root(),
                fixture.assets().as_path(),
                fixture.registry().as_path(),
                &normalized.credential,
            )
            .unwrap();
            let golden_dir = fixture.root().join(format!("golden-{frame_count}"));
            fs::create_dir(&golden_dir).unwrap();
            let status = Command::new("ffmpeg")
                .args(["-v", "error", "-i"])
                .arg(&normalized.credential.normalized_path)
                .args(["-vsync", "0", "-n"])
                .arg(golden_dir.join("frame-%03d.png"))
                .status()
                .unwrap();
            assert!(status.success());
            let expected = [0, frame_count / 2, frame_count - 1];
            let actual = [
                review.first_frame_path,
                review.middle_frame_path,
                review.last_frame_path,
            ];
            for (actual_path, expected_index) in actual.iter().zip(expected) {
                let golden_path = golden_dir.join(format!("frame-{:03}.png", expected_index + 1));
                assert_eq!(
                    file_binding(Path::new(actual_path)).unwrap().0,
                    file_binding(&golden_path).unwrap().0,
                    "review output must equal decoded frame index {expected_index} for {frame_count} frames"
                );
            }
        }
    }

    #[test]
    fn normalization_review_and_concat_use_real_ffmpeg_outputs() {
        let fixture = FixtureDir::new("pipeline");
        let first = fixture.assets().join("raw/first.mp4");
        let second = fixture.assets().join("raw/second.mp4");
        make_fixture(&first, 30, "160x120", "1", false);
        make_fixture(&second, 30, "160x120", "1", true);

        let first_result = normalize_at_roots(
            fixture.root(),
            fixture.assets().as_path(),
            fixture.registry().as_path(),
            &first,
            "first",
            320,
            240,
            24,
        )
        .unwrap();
        let second_result = normalize_at_roots(
            fixture.root(),
            fixture.assets().as_path(),
            fixture.registry().as_path(),
            &second,
            "second",
            320,
            240,
            24,
        )
        .unwrap();
        assert_normalized_probe(&first_result.probe, 320, 240, 24).unwrap();
        assert!(!second_result.anomalies.black_intervals.is_empty());
        assert!(!second_result.anomalies.freeze_intervals.is_empty());

        assert_eq!(
            concat_at_roots(
                fixture.root(),
                fixture.assets().as_path(),
                fixture.registry().as_path(),
                &[
                    first_result.credential.clone(),
                    first_result.credential.clone(),
                ],
            )
            .unwrap_err(),
            "normalization_receipt_duplicate"
        );

        let frames = extract_review_frames_at_roots(
            fixture.root(),
            fixture.assets().as_path(),
            fixture.registry().as_path(),
            &first_result.credential,
        )
        .unwrap();
        assert!(Path::new(&frames.first_frame_path).is_file());
        assert!(Path::new(&frames.middle_frame_path).is_file());
        assert!(Path::new(&frames.last_frame_path).is_file());

        let credentials = [
            first_result.credential.clone(),
            second_result.credential.clone(),
        ];
        let assembled = concat_at_roots(
            fixture.root(),
            fixture.assets().as_path(),
            fixture.registry().as_path(),
            &credentials,
        )
        .unwrap();
        assert!(Path::new(&assembled.output_path).is_file());
        assert_eq!((assembled.probe.fps_num, assembled.probe.fps_den), (24, 1));
        assert_eq!((assembled.probe.width, assembled.probe.height), (320, 240));
        assert_eq!(
            concat_at_roots(
                fixture.root(),
                fixture.assets().as_path(),
                fixture.registry().as_path(),
                &credentials,
            )
            .unwrap_err(),
            "normalization_receipt_consumed"
        );
        let visible_outputs = fs::read_dir(fixture.assets().join("video-assembled"))
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| {
                entry.path().extension().and_then(|value| value.to_str()) == Some("mp4")
            })
            .count();
        assert_eq!(visible_outputs, 1, "replay must not publish another output");
    }
}
