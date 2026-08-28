use image::GenericImageView;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;

const PROVIDER: &str = "codex_task_package";
const MAX_REFERENCES: usize = 16;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CodexStoryboardReferenceSelection {
    pub id: String,
    pub usage: String,
    pub instruction: String,
    pub source_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PrepareCodexStoryboardJobRequest {
    pub schema_version: u8,
    pub job_id: String,
    pub project_id: String,
    pub episode_id: String,
    pub shot_id: String,
    pub provider: String,
    pub created_at: String,
    pub project_path: String,
    pub prompt: Value,
    pub references: Vec<CodexStoryboardReferenceSelection>,
    pub accepted_image_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CodexStoryboardReference {
    id: String,
    usage: String,
    instruction: String,
    relative_path: String,
    sha256: String,
    width: u32,
    height: u32,
    mime_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ExpectedOutput {
    candidate_path: String,
    result_path: String,
    mime_types: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CodexStoryboardRequest {
    schema_version: u8,
    job_id: String,
    project_id: String,
    episode_id: String,
    shot_id: String,
    provider: String,
    created_at: String,
    prompt: Value,
    references: Vec<CodexStoryboardReference>,
    accepted_image_path: Option<String>,
    expected_output: ExpectedOutput,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CodexStoryboardExportReceipt {
    pub schema_version: u8,
    pub job_id: String,
    pub package_path: String,
    pub request_path: String,
    pub request_digest: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImportCodexStoryboardResultRequest {
    pub schema_version: u8,
    pub job_id: String,
    pub project_id: String,
    pub episode_id: String,
    pub shot_id: String,
    pub provider: String,
    pub project_path: String,
    pub task_status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CodexStoryboardAuthorityRecord {
    schema_version: u8,
    canonical_project_path: String,
    project_id: String,
    job_id: String,
    request_digest: String,
    canonical_package_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReferenceDigest {
    id: String,
    sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ResultOutput {
    relative_path: String,
    sha256: String,
    width: u32,
    height: u32,
    mime_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CodexStoryboardResult {
    schema_version: u8,
    job_id: String,
    project_id: String,
    episode_id: String,
    shot_id: String,
    provider: String,
    request_digest: String,
    reference_digests: Vec<ReferenceDigest>,
    generation_mode: String,
    final_prompt: String,
    output: ResultOutput,
    completed_at: String,
    state: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CodexStoryboardImportReceipt {
    pub schema_version: u8,
    pub job_id: String,
    pub result_path: String,
    pub result: CodexStoryboardResult,
    pub status: String,
    pub candidate_path: String,
}

fn valid_identifier(value: &str, max: usize) -> bool {
    !value.is_empty()
        && value.len() <= max
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
}

fn valid_usage(value: &str) -> bool {
    matches!(
        value,
        "spatial_authority"
            | "pose_reference"
            | "face_identity"
            | "body_costume"
            | "prop_detail"
            | "style_only"
            | "lighting_only"
            | "negative_example"
    )
}

fn canonical_directory(path: &Path, code: &str) -> Result<PathBuf, String> {
    let canonical = fs::canonicalize(path).map_err(|_| code.to_string())?;
    if !canonical.is_dir() {
        return Err(code.to_string());
    }
    Ok(canonical)
}

fn is_symlink_or_reparse(metadata: &fs::Metadata) -> bool {
    if metadata.file_type().is_symlink() {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0000_0400;
        return metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0;
    }
    #[cfg(not(windows))]
    false
}

fn reject_symlink(path: &Path, code: &str) -> Result<(), String> {
    let metadata = fs::symlink_metadata(path).map_err(|_| code.to_string())?;
    if is_symlink_or_reparse(&metadata) {
        return Err(code.to_string());
    }
    Ok(())
}

fn open_read_no_follow(path: &Path) -> Result<File, std::io::Error> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
        options.custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
    }
    options.open(path)
}

fn path_to_forward_slashes(path: &Path) -> String {
    path.components()
        .filter_map(|component| match component {
            Component::Normal(value) => Some(value.to_string_lossy().to_string()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("/")
}

fn safe_relative_path(path: &str) -> bool {
    let value = Path::new(path);
    !path.is_empty()
        && !value.is_absolute()
        && value
            .components()
            .all(|component| matches!(component, Component::Normal(_)))
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct FileFingerprint {
    identity_a: u64,
    identity_b: u64,
    len: u64,
    created_nanos: u128,
    modified_nanos: u128,
}

#[cfg(unix)]
fn platform_file_identity(metadata: &fs::Metadata) -> (u64, u64) {
    use std::os::unix::fs::MetadataExt;
    (metadata.dev(), metadata.ino())
}

#[cfg(not(any(unix, windows)))]
fn platform_file_identity(_metadata: &fs::Metadata) -> (u64, u64) {
    (0, 0)
}

#[cfg(windows)]
#[repr(C)]
struct WindowsFileTime {
    low: u32,
    high: u32,
}

#[cfg(windows)]
#[repr(C)]
struct WindowsByHandleFileInformation {
    attributes: u32,
    creation_time: WindowsFileTime,
    last_access_time: WindowsFileTime,
    last_write_time: WindowsFileTime,
    volume_serial_number: u32,
    file_size_high: u32,
    file_size_low: u32,
    number_of_links: u32,
    file_index_high: u32,
    file_index_low: u32,
}

#[cfg(windows)]
#[link(name = "kernel32")]
extern "system" {
    fn GetFileInformationByHandle(
        file: *mut std::ffi::c_void,
        information: *mut WindowsByHandleFileInformation,
    ) -> i32;
}

#[cfg(windows)]
fn opened_file_identity(file: &File) -> Result<(u64, u64), std::io::Error> {
    use std::mem::MaybeUninit;
    use std::os::windows::io::AsRawHandle;

    let mut information = MaybeUninit::<WindowsByHandleFileInformation>::uninit();
    let succeeded =
        unsafe { GetFileInformationByHandle(file.as_raw_handle(), information.as_mut_ptr()) };
    if succeeded == 0 {
        return Err(std::io::Error::last_os_error());
    }
    let information = unsafe { information.assume_init() };
    Ok((
        information.volume_serial_number as u64,
        ((information.file_index_high as u64) << 32) | information.file_index_low as u64,
    ))
}

#[cfg(unix)]
fn opened_file_identity(file: &File) -> Result<(u64, u64), std::io::Error> {
    Ok(platform_file_identity(&file.metadata()?))
}

#[cfg(not(any(unix, windows)))]
fn opened_file_identity(file: &File) -> Result<(u64, u64), std::io::Error> {
    Ok(platform_file_identity(&file.metadata()?))
}

fn system_time_nanos(value: Result<SystemTime, std::io::Error>) -> u128 {
    value
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_nanos())
        .unwrap_or(0)
}

fn opened_file_fingerprint(file: &File) -> Result<FileFingerprint, std::io::Error> {
    let metadata = file.metadata()?;
    let (identity_a, identity_b) = opened_file_identity(file)?;
    Ok(FileFingerprint {
        identity_a,
        identity_b,
        len: metadata.len(),
        created_nanos: system_time_nanos(metadata.created()),
        modified_nanos: system_time_nanos(metadata.modified()),
    })
}

fn ensure_no_symlink_components(root: &Path, path: &Path, code: &str) -> Result<(), String> {
    let relative = path.strip_prefix(root).map_err(|_| code.to_string())?;
    let mut current = root.to_path_buf();
    for component in relative.components() {
        if !matches!(component, Component::Normal(_)) {
            return Err(code.to_string());
        }
        current.push(component.as_os_str());
        let metadata = fs::symlink_metadata(&current).map_err(|_| code.to_string())?;
        if is_symlink_or_reparse(&metadata) {
            return Err(code.to_string());
        }
    }
    Ok(())
}

fn canonical_existing_file_within(root: &Path, path: &Path, code: &str) -> Result<PathBuf, String> {
    let root = canonical_directory(root, code)?;
    reject_symlink(path, code)?;
    let canonical = fs::canonicalize(path).map_err(|_| code.to_string())?;
    if !canonical.is_file() || !canonical.starts_with(&root) {
        return Err(code.to_string());
    }
    ensure_no_symlink_components(&root, &canonical, code)?;
    Ok(canonical)
}

#[derive(Debug, Clone)]
struct StableFile {
    bytes: Vec<u8>,
    canonical_path: PathBuf,
    fingerprint: FileFingerprint,
}

fn read_stable_file_within(root: &Path, path: &Path, code: &str) -> Result<StableFile, String> {
    let root = canonical_directory(root, code)?;
    let canonical_before = canonical_existing_file_within(&root, path, code)?;
    let mut file = open_read_no_follow(path).map_err(|_| code.to_string())?;
    let before = opened_file_fingerprint(&file).map_err(|_| code.to_string())?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes).map_err(|_| code.to_string())?;
    let after = opened_file_fingerprint(&file).map_err(|_| code.to_string())?;
    if before != after || bytes.len() as u64 != after.len {
        return Err(code.to_string());
    }
    let canonical_after = canonical_existing_file_within(&root, path, code)?;
    let path_file = open_read_no_follow(path).map_err(|_| code.to_string())?;
    let path_fingerprint = opened_file_fingerprint(&path_file).map_err(|_| code.to_string())?;
    if canonical_before != canonical_after || after != path_fingerprint {
        return Err(code.to_string());
    }
    Ok(StableFile {
        bytes,
        canonical_path: canonical_after,
        fingerprint: after,
    })
}

fn revalidate_stable_file(
    stable: &StableFile,
    root: &Path,
    path: &Path,
    code: &str,
) -> Result<(), String> {
    let current = read_stable_file_within(root, path, code)?;
    if current.canonical_path != stable.canonical_path
        || current.fingerprint != stable.fingerprint
        || current.bytes != stable.bytes
    {
        return Err(code.to_string());
    }
    Ok(())
}

fn sha256_bytes(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    for chunk in bytes.chunks(64 * 1024) {
        hasher.update(chunk);
    }
    format!("{:x}", hasher.finalize())
}

fn inspect_image_bytes(
    bytes: &[u8],
    invalid_code: &str,
) -> Result<(u32, u32, String, &'static str), String> {
    let (format, mime, extension) = if bytes.starts_with(&[137, 80, 78, 71, 13, 10, 26, 10]) {
        (image::ImageFormat::Png, "image/png".to_string(), "png")
    } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        (image::ImageFormat::Jpeg, "image/jpeg".to_string(), "jpg")
    } else {
        return Err(invalid_code.to_string());
    };
    let dimensions = image::load_from_memory_with_format(bytes, format)
        .map_err(|_| invalid_code.to_string())?
        .dimensions();
    if dimensions.0 == 0 || dimensions.1 == 0 {
        return Err(invalid_code.to_string());
    }
    Ok((dimensions.0, dimensions.1, mime, extension))
}

fn canonicalize_json(value: &Value) -> Value {
    match value {
        Value::Array(items) => Value::Array(items.iter().map(canonicalize_json).collect()),
        Value::Object(object) => {
            let sorted = object
                .iter()
                .map(|(key, value)| (key.clone(), canonicalize_json(value)))
                .collect::<BTreeMap<_, _>>();
            Value::Object(sorted.into_iter().collect())
        }
        _ => value.clone(),
    }
}

fn request_digest(request: &CodexStoryboardRequest) -> Result<String, String> {
    let value = serde_json::to_value(request)
        .map_err(|_| "codex_storyboard_request_invalid".to_string())?;
    let bytes = serde_json::to_vec(&canonicalize_json(&value))
        .map_err(|_| "codex_storyboard_request_invalid".to_string())?;
    Ok(format!("{:x}", Sha256::digest(bytes)))
}

fn unique_temp_sibling(final_path: &Path) -> Result<PathBuf, String> {
    let name = final_path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "codex_storyboard_publish_failed".to_string())?;
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "codex_storyboard_publish_failed".to_string())?
        .as_nanos();
    Ok(final_path.with_file_name(format!(".{name}.tmp-{}-{nonce}", std::process::id())))
}

fn publish_json<T: Serialize>(path: &Path, value: &T, exists_code: &str) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "codex_storyboard_publish_failed".to_string())?;
    reject_symlink(parent, "codex_storyboard_path_escape")?;
    let temporary = unique_temp_sibling(path)?;
    let bytes = serde_json::to_vec_pretty(value)
        .map_err(|_| "codex_storyboard_publish_failed".to_string())?;
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .map_err(|_| "codex_storyboard_publish_failed".to_string())?;
    file.write_all(&bytes)
        .and_then(|_| file.sync_all())
        .map_err(|_| "codex_storyboard_publish_failed".to_string())?;
    drop(file);
    let link_result = fs::hard_link(&temporary, path);
    let _ = fs::remove_file(&temporary);
    if link_result.is_err() {
        return if fs::symlink_metadata(path).is_ok() {
            Err(exists_code.to_string())
        } else {
            Err("codex_storyboard_publish_failed".to_string())
        };
    }
    Ok(())
}

fn validate_prepare_request(request: &PrepareCodexStoryboardJobRequest) -> Result<(), String> {
    if request.schema_version != 1 || request.provider != PROVIDER {
        return Err("codex_storyboard_provider_mismatch".to_string());
    }
    for (value, code) in [
        (&request.job_id, "codex_storyboard_jobId_invalid"),
        (&request.project_id, "codex_storyboard_projectId_invalid"),
        (&request.episode_id, "codex_storyboard_episodeId_invalid"),
        (&request.shot_id, "codex_storyboard_shotId_invalid"),
    ] {
        if !valid_identifier(value, 96) {
            return Err(code.to_string());
        }
    }
    if request.references.is_empty() || request.references.len() > MAX_REFERENCES {
        return Err("codex_storyboard_references_invalid".to_string());
    }
    let prompt = request
        .prompt
        .as_object()
        .ok_or_else(|| "codex_storyboard_prompt_invalid".to_string())?;
    if prompt.get("useCase").and_then(Value::as_str) != Some("stylized-concept")
        || prompt
            .get("primaryRequest")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .is_none()
    {
        return Err("codex_storyboard_prompt_invalid".to_string());
    }
    let mut ids = HashSet::new();
    let mut spatial = false;
    let mut identity = false;
    for reference in &request.references {
        if !valid_identifier(&reference.id, 64) || !ids.insert(reference.id.clone()) {
            return Err("codex_storyboard_reference_id_invalid".to_string());
        }
        if !valid_usage(&reference.usage) {
            return Err("codex_storyboard_reference_usage_invalid".to_string());
        }
        if reference.instruction.trim().is_empty() {
            return Err("codex_storyboard_reference_instruction_invalid".to_string());
        }
        spatial |= reference.usage == "spatial_authority";
        identity |= matches!(reference.usage.as_str(), "face_identity" | "body_costume");
    }
    if !spatial || !identity {
        return Err("codex_storyboard_required_reference_usage_missing".to_string());
    }
    Ok(())
}

fn ensure_child_root(project: &Path, assets: &Path) -> Result<(PathBuf, PathBuf), String> {
    let project = canonical_directory(project, "codex_storyboard_project_root_invalid")?;
    let assets = canonical_directory(assets, "codex_storyboard_assets_root_outside_project")?;
    if !assets.starts_with(&project) {
        return Err("codex_storyboard_assets_root_outside_project".to_string());
    }
    Ok((project, assets))
}

fn canonical_authority_root(authority: &Path) -> Result<PathBuf, String> {
    reject_symlink(authority, "codex_storyboard_authority_invalid")?;
    canonical_directory(authority, "codex_storyboard_authority_invalid")
}

fn project_authority_key(project: &Path, project_id: &str) -> Result<String, String> {
    let project = canonical_directory(project, "codex_storyboard_project_root_invalid")?;
    let mut hasher = Sha256::new();
    hasher.update(project.to_string_lossy().as_bytes());
    hasher.update([0]);
    hasher.update(project_id.as_bytes());
    Ok(format!("{:x}", hasher.finalize()))
}

fn ensure_private_child(parent: &Path, name: &str) -> Result<PathBuf, String> {
    let child = parent.join(name);
    match fs::create_dir(&child) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(_) => return Err("codex_storyboard_authority_invalid".to_string()),
    }
    reject_symlink(&child, "codex_storyboard_authority_invalid")?;
    let canonical = canonical_directory(&child, "codex_storyboard_authority_invalid")?;
    if !canonical.starts_with(parent) {
        return Err("codex_storyboard_authority_invalid".to_string());
    }
    Ok(canonical)
}

fn authority_project_dir(
    authority: &Path,
    family: &str,
    project: &Path,
    project_id: &str,
    create: bool,
) -> Result<PathBuf, String> {
    let authority = canonical_authority_root(authority)?;
    let key = project_authority_key(project, project_id)?;
    if create {
        let family = ensure_private_child(&authority, family)?;
        ensure_private_child(&family, &key)
    } else {
        let directory = authority.join(family).join(key);
        reject_symlink(&directory, "codex_storyboard_authority_invalid")?;
        let canonical = canonical_directory(&directory, "codex_storyboard_authority_invalid")?;
        if !canonical.starts_with(&authority) {
            return Err("codex_storyboard_authority_invalid".to_string());
        }
        Ok(canonical)
    }
}

fn authority_export_record_path(
    authority: &Path,
    project: &Path,
    project_id: &str,
    job_id: &str,
) -> Result<PathBuf, String> {
    if !valid_identifier(job_id, 96) {
        return Err("codex_storyboard_jobId_invalid".to_string());
    }
    Ok(
        authority_project_dir(authority, "exports", project, project_id, false)?
            .join(format!("{job_id}.json")),
    )
}

fn ensure_authority_export_record_path(
    authority: &Path,
    project: &Path,
    project_id: &str,
    job_id: &str,
) -> Result<PathBuf, String> {
    Ok(
        authority_project_dir(authority, "exports", project, project_id, true)?
            .join(format!("{job_id}.json")),
    )
}

fn authority_import_ledger_path(
    authority: &Path,
    project: &Path,
    project_id: &str,
    job_id: &str,
    request_digest: &str,
) -> Result<PathBuf, String> {
    if !valid_identifier(job_id, 96)
        || request_digest.len() != 64
        || !request_digest
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err("codex_storyboard_authority_invalid".to_string());
    }
    let authority = canonical_authority_root(authority)?;
    let key = project_authority_key(project, project_id)?;
    Ok(authority
        .join("imports")
        .join(key)
        .join(format!("{job_id}-{request_digest}.json")))
}

fn ensure_authority_import_ledger_path(
    authority: &Path,
    project: &Path,
    project_id: &str,
    job_id: &str,
    request_digest: &str,
) -> Result<PathBuf, String> {
    Ok(
        authority_project_dir(authority, "imports", project, project_id, true)?
            .join(format!("{job_id}-{request_digest}.json")),
    )
}

fn ensure_jobs_root(project: &Path) -> Result<PathBuf, String> {
    let jobs = project.join("codex-storyboard-jobs");
    match fs::create_dir(&jobs) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            reject_symlink(&jobs, "codex_storyboard_jobs_root_escape")?;
            if !jobs.is_dir() {
                return Err("codex_storyboard_jobs_root_invalid".to_string());
            }
        }
        Err(_) => return Err("codex_storyboard_jobs_root_invalid".to_string()),
    }
    let canonical =
        fs::canonicalize(&jobs).map_err(|_| "codex_storyboard_jobs_root_invalid".to_string())?;
    if !canonical.starts_with(project) {
        return Err("codex_storyboard_jobs_root_escape".to_string());
    }
    Ok(canonical)
}

fn write_bytes_create_new(destination: &Path, bytes: &[u8], code: &str) -> Result<(), String> {
    let mut output = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(destination)
        .map_err(|_| code.to_string())?;
    output
        .write_all(bytes)
        .and_then(|_| output.sync_all())
        .map_err(|_| code.to_string())?;
    Ok(())
}

fn prepare_at_roots(
    project: &Path,
    assets: &Path,
    authority: &Path,
    request: PrepareCodexStoryboardJobRequest,
) -> Result<CodexStoryboardExportReceipt, String> {
    prepare_at_roots_inner(project, assets, authority, request, |_| {})
}

#[cfg(test)]
fn prepare_at_roots_with_copy_hook<F: FnMut(usize)>(
    project: &Path,
    assets: &Path,
    authority: &Path,
    request: PrepareCodexStoryboardJobRequest,
    before_copy: F,
) -> Result<CodexStoryboardExportReceipt, String> {
    prepare_at_roots_inner(project, assets, authority, request, before_copy)
}

fn prepare_at_roots_inner<F: FnMut(usize)>(
    project: &Path,
    assets: &Path,
    authority: &Path,
    request: PrepareCodexStoryboardJobRequest,
    mut before_copy: F,
) -> Result<CodexStoryboardExportReceipt, String> {
    validate_prepare_request(&request)?;
    let (project, assets) = ensure_child_root(project, assets)?;
    let authority = canonical_authority_root(authority)?;
    let requested_project = fs::canonicalize(Path::new(&request.project_path))
        .map_err(|_| "codex_storyboard_project_path_invalid".to_string())?;
    if requested_project != project {
        return Err("codex_storyboard_project_identity_mismatch".to_string());
    }

    let accepted_image_path = if let Some(path) = request.accepted_image_path.as_deref() {
        let raw = Path::new(path);
        if !raw.is_absolute() {
            return Err("codex_storyboard_accepted_path_invalid".to_string());
        }
        reject_symlink(raw, "codex_storyboard_accepted_path_escape")?;
        let accepted = fs::canonicalize(raw)
            .map_err(|_| "codex_storyboard_accepted_path_invalid".to_string())?;
        if !accepted.is_file() || !accepted.starts_with(&project) {
            return Err("codex_storyboard_accepted_path_escape".to_string());
        }
        Some(path_to_forward_slashes(
            accepted
                .strip_prefix(&project)
                .map_err(|_| "codex_storyboard_accepted_path_escape".to_string())?,
        ))
    } else {
        None
    };

    let mut sources = Vec::<PathBuf>::with_capacity(request.references.len());
    let mut duplicate_assignments: HashMap<PathBuf, (&str, &str)> = HashMap::new();
    for reference in &request.references {
        let raw = Path::new(&reference.source_path);
        if !raw.is_absolute() {
            return Err("codex_storyboard_reference_path_invalid".to_string());
        }
        if !raw.exists() {
            return Err("codex_storyboard_reference_missing".to_string());
        }
        reject_symlink(raw, "codex_storyboard_reference_path_escape")?;
        let source =
            fs::canonicalize(raw).map_err(|_| "codex_storyboard_reference_missing".to_string())?;
        if !source.is_file() || !source.starts_with(&assets) {
            return Err("codex_storyboard_reference_path_escape".to_string());
        }
        if let Some((usage, instruction)) = duplicate_assignments.get(&source) {
            if *usage != reference.usage || *instruction != reference.instruction {
                return Err("codex_storyboard_reference_path_conflict".to_string());
            }
        } else {
            duplicate_assignments.insert(
                source.clone(),
                (reference.usage.as_str(), reference.instruction.as_str()),
            );
        }
        sources.push(raw.to_path_buf());
    }

    let jobs = ensure_jobs_root(&project)?;
    let package = jobs.join(&request.job_id);
    match fs::create_dir(&package) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            return Err("codex_storyboard_destination_exists".to_string())
        }
        Err(_) => return Err("codex_storyboard_destination_create_failed".to_string()),
    }
    let inputs = package.join("inputs");
    let outputs = package.join("outputs");
    fs::create_dir(&inputs)
        .map_err(|_| "codex_storyboard_destination_create_failed".to_string())?;
    fs::create_dir(&outputs)
        .map_err(|_| "codex_storyboard_destination_create_failed".to_string())?;

    let package = fs::canonicalize(&package)
        .map_err(|_| "codex_storyboard_destination_create_failed".to_string())?;
    let inputs = canonical_directory(&inputs, "codex_storyboard_inputs_escape")?;
    let outputs = canonical_directory(&outputs, "codex_storyboard_outputs_escape")?;
    if !inputs.starts_with(&package) || !outputs.starts_with(&package) {
        return Err("codex_storyboard_package_escape".to_string());
    }

    let mut immutable_references = Vec::with_capacity(request.references.len());
    for (index, (reference, source_path)) in
        request.references.iter().zip(sources.iter()).enumerate()
    {
        before_copy(index);
        let source = read_stable_file_within(
            &assets,
            source_path,
            "codex_storyboard_reference_changed_during_copy",
        )?;
        let usage = reference.usage.replace('_', "-");
        let placeholder = inputs.join(format!("{:02}-{usage}.snapshot", index + 1));
        let temporary = unique_temp_sibling(&placeholder)?;
        write_bytes_create_new(
            &temporary,
            &source.bytes,
            "codex_storyboard_snapshot_write_failed",
        )?;
        let temporary_snapshot = read_stable_file_within(
            &inputs,
            &temporary,
            "codex_storyboard_snapshot_verify_failed",
        )?;
        let (_, _, _, extension) = inspect_image_bytes(
            &temporary_snapshot.bytes,
            "codex_storyboard_reference_image_invalid",
        )?;
        let filename = format!("{:02}-{usage}.{extension}", index + 1);
        let relative_path = format!("inputs/{filename}");
        let destination = inputs.join(&filename);
        if fs::hard_link(&temporary, &destination).is_err() {
            let _ = fs::remove_file(&temporary);
            return Err(if fs::symlink_metadata(&destination).is_ok() {
                "codex_storyboard_snapshot_exists".to_string()
            } else {
                "codex_storyboard_snapshot_write_failed".to_string()
            });
        }
        let _ = fs::remove_file(&temporary);
        let snapshot = read_stable_file_within(
            &inputs,
            &destination,
            "codex_storyboard_snapshot_verify_failed",
        )?;
        let (width, height, mime_type, verified_extension) =
            inspect_image_bytes(&snapshot.bytes, "codex_storyboard_reference_image_invalid")?;
        if verified_extension != extension || !destination.ends_with(&filename) {
            return Err("codex_storyboard_snapshot_extension_mismatch".to_string());
        }
        immutable_references.push(CodexStoryboardReference {
            id: reference.id.clone(),
            usage: reference.usage.clone(),
            instruction: reference.instruction.trim().to_string(),
            relative_path,
            sha256: sha256_bytes(&snapshot.bytes),
            width,
            height,
            mime_type,
        });
    }

    let immutable = CodexStoryboardRequest {
        schema_version: 1,
        job_id: request.job_id.clone(),
        project_id: request.project_id.clone(),
        episode_id: request.episode_id,
        shot_id: request.shot_id,
        provider: PROVIDER.to_string(),
        created_at: request.created_at,
        prompt: request.prompt,
        references: immutable_references,
        accepted_image_path,
        expected_output: ExpectedOutput {
            candidate_path: "outputs/candidate.png".to_string(),
            result_path: "outputs/result.json".to_string(),
            mime_types: vec!["image/png".to_string()],
        },
    };
    let digest = request_digest(&immutable)?;
    let authority_record = CodexStoryboardAuthorityRecord {
        schema_version: 1,
        canonical_project_path: project.to_string_lossy().to_string(),
        project_id: request.project_id.clone(),
        job_id: request.job_id.clone(),
        request_digest: digest.clone(),
        canonical_package_path: package.to_string_lossy().to_string(),
    };
    let authority_record_path = ensure_authority_export_record_path(
        &authority,
        &project,
        &request.project_id,
        &request.job_id,
    )?;
    publish_json(
        &authority_record_path,
        &authority_record,
        "codex_storyboard_authority_record_exists",
    )?;
    let request_path = package.join("request.json");
    publish_json(&request_path, &immutable, "codex_storyboard_request_exists")?;
    Ok(CodexStoryboardExportReceipt {
        schema_version: 1,
        job_id: request.job_id,
        package_path: package.to_string_lossy().to_string(),
        request_path: request_path.to_string_lossy().to_string(),
        request_digest: digest,
        status: "exported".to_string(),
    })
}

fn parse_stable_json<T: for<'de> Deserialize<'de>>(
    root: &Path,
    path: &Path,
    code: &str,
) -> Result<(T, StableFile), String> {
    let stable = read_stable_file_within(root, path, code)?;
    let value = serde_json::from_slice(&stable.bytes).map_err(|_| code.to_string())?;
    Ok((value, stable))
}

fn validate_import_request(request: &ImportCodexStoryboardResultRequest) -> Result<(), String> {
    if request.schema_version != 1 || request.provider != PROVIDER {
        return Err("codex_storyboard_provider_mismatch".to_string());
    }
    for value in [
        &request.job_id,
        &request.project_id,
        &request.episode_id,
        &request.shot_id,
    ] {
        if !valid_identifier(value, 96) {
            return Err("codex_storyboard_import_identity_invalid".to_string());
        }
    }
    match request.task_status.as_str() {
        "cancelled" => return Err("codex_storyboard_task_cancelled".to_string()),
        "rejected" => return Err("codex_storyboard_task_rejected".to_string()),
        "accepted" | "completed" => {
            return Err("codex_storyboard_task_already_accepted".to_string())
        }
        "queued" | "exported" | "running" => {}
        _ => return Err("codex_storyboard_task_state_invalid".to_string()),
    }
    Ok(())
}

#[derive(Debug, Clone)]
struct PackageLayout {
    package: PathBuf,
    inputs: PathBuf,
    outputs: PathBuf,
}

fn validate_package_layout(project: &Path, job_id: &str) -> Result<PackageLayout, String> {
    let project = canonical_directory(project, "codex_storyboard_project_root_invalid")?;
    let jobs_raw = project.join("codex-storyboard-jobs");
    reject_symlink(&jobs_raw, "codex_storyboard_jobs_root_escape")?;
    let jobs = canonical_directory(&jobs_raw, "codex_storyboard_jobs_root_escape")?;
    if !jobs.starts_with(&project) {
        return Err("codex_storyboard_jobs_root_escape".to_string());
    }
    let package_raw = jobs.join(job_id);
    reject_symlink(&package_raw, "codex_storyboard_package_escape")?;
    let package = canonical_directory(&package_raw, "codex_storyboard_package_missing")?;
    if !package.starts_with(&project) || !package.starts_with(&jobs) {
        return Err("codex_storyboard_package_escape".to_string());
    }
    let inputs_raw = package.join("inputs");
    reject_symlink(&inputs_raw, "codex_storyboard_inputs_escape")?;
    let inputs = canonical_directory(&inputs_raw, "codex_storyboard_inputs_escape")?;
    if !inputs.starts_with(&package) {
        return Err("codex_storyboard_inputs_escape".to_string());
    }
    let outputs_raw = package.join("outputs");
    reject_symlink(&outputs_raw, "codex_storyboard_outputs_escape")?;
    let outputs = canonical_directory(&outputs_raw, "codex_storyboard_outputs_escape")?;
    if !outputs.starts_with(&package) {
        return Err("codex_storyboard_outputs_escape".to_string());
    }
    Ok(PackageLayout {
        package,
        inputs,
        outputs,
    })
}

fn write_import_ledger_create_new(
    path: &Path,
    receipt: &CodexStoryboardImportReceipt,
) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(receipt)
        .map_err(|_| "codex_storyboard_authority_invalid".to_string())?;
    let mut file = match OpenOptions::new().write(true).create_new(true).open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            return Err("codex_storyboard_result_already_imported".to_string())
        }
        Err(_) => return Err("codex_storyboard_authority_invalid".to_string()),
    };
    file.write_all(&bytes)
        .and_then(|_| file.sync_all())
        .map_err(|_| "codex_storyboard_authority_invalid".to_string())
}

fn import_at_roots(
    project: &Path,
    assets: &Path,
    authority: &Path,
    request: ImportCodexStoryboardResultRequest,
) -> Result<CodexStoryboardImportReceipt, String> {
    import_at_roots_inner(project, assets, authority, request, || {})
}

#[cfg(test)]
fn import_at_roots_with_candidate_hook<F: FnOnce()>(
    project: &Path,
    assets: &Path,
    authority: &Path,
    request: ImportCodexStoryboardResultRequest,
    after_candidate_read: F,
) -> Result<CodexStoryboardImportReceipt, String> {
    import_at_roots_inner(project, assets, authority, request, after_candidate_read)
}

fn import_at_roots_inner<F: FnOnce()>(
    project: &Path,
    assets: &Path,
    authority: &Path,
    request: ImportCodexStoryboardResultRequest,
    after_candidate_read: F,
) -> Result<CodexStoryboardImportReceipt, String> {
    validate_import_request(&request)?;
    let (project, _) = ensure_child_root(project, assets)?;
    let authority = canonical_authority_root(authority)?;
    let requested_project = fs::canonicalize(Path::new(&request.project_path))
        .map_err(|_| "codex_storyboard_project_path_invalid".to_string())?;
    if requested_project != project {
        return Err("codex_storyboard_project_identity_mismatch".to_string());
    }
    let layout = validate_package_layout(&project, &request.job_id)?;

    let authority_record_path =
        authority_export_record_path(&authority, &project, &request.project_id, &request.job_id)?;
    let (authority_record, authority_stable): (CodexStoryboardAuthorityRecord, StableFile) =
        parse_stable_json(
            &authority,
            &authority_record_path,
            "codex_storyboard_authority_invalid",
        )?;
    if authority_record.schema_version != 1
        || authority_record.canonical_project_path != project.to_string_lossy()
        || authority_record.project_id != request.project_id
        || authority_record.job_id != request.job_id
        || authority_record.canonical_package_path != layout.package.to_string_lossy()
    {
        return Err("codex_storyboard_authority_mismatch".to_string());
    }

    let request_path = layout.package.join("request.json");
    let (immutable, immutable_stable): (CodexStoryboardRequest, StableFile) = parse_stable_json(
        &layout.package,
        &request_path,
        "codex_storyboard_request_invalid",
    )?;
    if immutable.schema_version != 1
        || immutable.provider != PROVIDER
        || immutable.job_id != request.job_id
        || immutable.project_id != request.project_id
        || immutable.episode_id != request.episode_id
        || immutable.shot_id != request.shot_id
    {
        return Err("codex_storyboard_request_identity_mismatch".to_string());
    }
    if immutable.expected_output.candidate_path != "outputs/candidate.png"
        || immutable.expected_output.result_path != "outputs/result.json"
        || immutable.expected_output.mime_types != ["image/png"]
    {
        return Err("codex_storyboard_request_output_invalid".to_string());
    }
    let canonical_request_digest = request_digest(&immutable)?;
    if canonical_request_digest != authority_record.request_digest {
        return Err("codex_storyboard_request_digest_mismatch".to_string());
    }
    for reference in &immutable.references {
        if !safe_relative_path(&reference.relative_path)
            || !reference.relative_path.starts_with("inputs/")
        {
            return Err("codex_storyboard_reference_path_escape".to_string());
        }
        let relative_inside_inputs = reference
            .relative_path
            .strip_prefix("inputs/")
            .ok_or_else(|| "codex_storyboard_reference_path_escape".to_string())?;
        let raw = layout.inputs.join(relative_inside_inputs);
        let snapshot = read_stable_file_within(
            &layout.inputs,
            &raw,
            "codex_storyboard_reference_path_escape",
        )?;
        let actual_digest = sha256_bytes(&snapshot.bytes);
        if actual_digest != reference.sha256 {
            return Err("codex_storyboard_reference_digest_mismatch".to_string());
        }
        let (width, height, mime_type, extension) =
            inspect_image_bytes(&snapshot.bytes, "codex_storyboard_reference_image_invalid")?;
        if width != reference.width
            || height != reference.height
            || mime_type != reference.mime_type
            || raw.extension().and_then(|value| value.to_str()) != Some(extension)
        {
            return Err("codex_storyboard_reference_metadata_mismatch".to_string());
        }
    }

    let result_path = layout.outputs.join("result.json");
    let (result, result_stable): (CodexStoryboardResult, StableFile) = parse_stable_json(
        &layout.outputs,
        &result_path,
        "codex_storyboard_result_invalid",
    )?;
    if result.schema_version != 1
        || result.provider != PROVIDER
        || result.job_id != request.job_id
        || result.project_id != request.project_id
        || result.episode_id != request.episode_id
        || result.shot_id != request.shot_id
    {
        return Err("codex_storyboard_result_identity_mismatch".to_string());
    }
    if result.request_digest != canonical_request_digest {
        return Err("codex_storyboard_result_lineage_mismatch".to_string());
    }
    let expected_reference_digests = immutable
        .references
        .iter()
        .map(|reference| ReferenceDigest {
            id: reference.id.clone(),
            sha256: reference.sha256.clone(),
        })
        .collect::<Vec<_>>();
    if result.reference_digests != expected_reference_digests {
        return Err("codex_storyboard_result_lineage_mismatch".to_string());
    }
    if result.generation_mode != "codex_builtin_imagegen"
        || result.state != "completed"
        || result.final_prompt.trim().is_empty()
        || result.output.relative_path != "outputs/candidate.png"
        || result.output.mime_type != "image/png"
    {
        return Err("codex_storyboard_result_invalid".to_string());
    }

    let candidate_raw = layout.outputs.join("candidate.png");
    let candidate = read_stable_file_within(
        &layout.outputs,
        &candidate_raw,
        "codex_storyboard_candidate_escape",
    )?;
    if sha256_bytes(&candidate.bytes) != result.output.sha256 {
        return Err("codex_storyboard_candidate_digest_mismatch".to_string());
    }
    let (width, height, mime_type, extension) =
        inspect_image_bytes(&candidate.bytes, "codex_storyboard_candidate_invalid")?;
    if width != result.output.width
        || height != result.output.height
        || mime_type != result.output.mime_type
        || extension != "png"
    {
        return Err("codex_storyboard_candidate_metadata_mismatch".to_string());
    }

    after_candidate_read();
    revalidate_stable_file(
        &candidate,
        &layout.outputs,
        &candidate_raw,
        "codex_storyboard_candidate_changed_during_validation",
    )?;
    revalidate_stable_file(
        &result_stable,
        &layout.outputs,
        &result_path,
        "codex_storyboard_result_changed_during_validation",
    )?;
    revalidate_stable_file(
        &immutable_stable,
        &layout.package,
        &request_path,
        "codex_storyboard_request_changed_during_validation",
    )?;
    revalidate_stable_file(
        &authority_stable,
        &authority,
        &authority_record_path,
        "codex_storyboard_authority_invalid",
    )?;
    let final_layout = validate_package_layout(&project, &request.job_id)?;
    if final_layout.package != layout.package
        || final_layout.inputs != layout.inputs
        || final_layout.outputs != layout.outputs
    {
        return Err("codex_storyboard_package_changed_during_validation".to_string());
    }

    let receipt = CodexStoryboardImportReceipt {
        schema_version: 1,
        job_id: request.job_id.clone(),
        result_path: result_path.to_string_lossy().to_string(),
        result,
        status: "needs_review".to_string(),
        candidate_path: candidate.canonical_path.to_string_lossy().to_string(),
    };
    let ledger_path = ensure_authority_import_ledger_path(
        &authority,
        &project,
        &request.project_id,
        &request.job_id,
        &authority_record.request_digest,
    )?;
    write_import_ledger_create_new(&ledger_path, &receipt)?;
    let marker_path = layout.outputs.join("import-receipt.json");
    let _ = publish_json(
        &marker_path,
        &receipt,
        "codex_storyboard_package_audit_exists",
    );

    // The private ledger is deliberately fail-closed: if anything changes after
    // its CAS succeeds, reject the import while leaving the ledger consumed.
    revalidate_stable_file(
        &candidate,
        &layout.outputs,
        &candidate_raw,
        "codex_storyboard_candidate_changed_during_validation",
    )?;
    revalidate_stable_file(
        &result_stable,
        &layout.outputs,
        &result_path,
        "codex_storyboard_result_changed_during_validation",
    )?;
    revalidate_stable_file(
        &immutable_stable,
        &layout.package,
        &request_path,
        "codex_storyboard_request_changed_during_validation",
    )?;
    revalidate_stable_file(
        &authority_stable,
        &authority,
        &authority_record_path,
        "codex_storyboard_authority_invalid",
    )?;
    let return_layout = validate_package_layout(&project, &request.job_id)?;
    if return_layout.package != layout.package
        || return_layout.inputs != layout.inputs
        || return_layout.outputs != layout.outputs
    {
        return Err("codex_storyboard_package_changed_during_validation".to_string());
    }
    Ok(receipt)
}

fn active_project_path(app: &tauri::AppHandle, requested: &str) -> Result<PathBuf, String> {
    let requested_path = Path::new(requested);
    if !requested_path.is_absolute() {
        return Err("codex_storyboard_project_path_invalid".to_string());
    }
    let requested = canonical_directory(requested_path, "codex_storyboard_project_path_invalid")?;
    let marker = app
        .path()
        .app_data_dir()
        .map_err(|_| "codex_storyboard_active_project_unavailable".to_string())?
        .join("current-project.txt");
    let selected = fs::read_to_string(marker)
        .map_err(|_| "codex_storyboard_active_project_unavailable".to_string())?;
    let active = canonical_directory(
        Path::new(selected.trim()),
        "codex_storyboard_active_project_unavailable",
    )?;
    if requested != active {
        return Err("codex_storyboard_project_identity_mismatch".to_string());
    }
    Ok(active)
}

fn app_authority_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|_| "codex_storyboard_authority_invalid".to_string())?;
    fs::create_dir_all(&app_data).map_err(|_| "codex_storyboard_authority_invalid".to_string())?;
    reject_symlink(&app_data, "codex_storyboard_authority_invalid")?;
    let app_data = canonical_directory(&app_data, "codex_storyboard_authority_invalid")?;
    ensure_private_child(&app_data, "codex-storyboard-authority")
}

#[tauri::command]
pub fn prepare_codex_storyboard_job(
    app: tauri::AppHandle,
    request: PrepareCodexStoryboardJobRequest,
) -> Result<CodexStoryboardExportReceipt, String> {
    let project = active_project_path(&app, &request.project_path)?;
    let authority = app_authority_root(&app)?;
    prepare_at_roots(&project, &project, &authority, request)
}

#[tauri::command]
pub fn import_codex_storyboard_result(
    app: tauri::AppHandle,
    request: ImportCodexStoryboardResultRequest,
) -> Result<CodexStoryboardImportReceipt, String> {
    let project = active_project_path(&app, &request.project_path)?;
    let authority = app_authority_root(&app)?;
    import_at_roots(&project, &project, &authority, request)
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{ImageBuffer, Rgb, Rgba};
    use serde_json::{json, Value};
    use sha2::{Digest, Sha256};
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};

    struct Fixture {
        project: PathBuf,
        assets: PathBuf,
        authority: PathBuf,
        accepted: PathBuf,
        request: PrepareCodexStoryboardJobRequest,
    }

    fn unique_root(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "storyboard-codex-{label}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }

    fn write_png(path: &Path, color: [u8; 4]) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        ImageBuffer::<Rgba<u8>, Vec<u8>>::from_pixel(3, 2, Rgba(color))
            .save(path)
            .unwrap();
    }

    fn write_png_dimensions(path: &Path, width: u32, height: u32, color: [u8; 4]) {
        ImageBuffer::<Rgba<u8>, Vec<u8>>::from_pixel(width, height, Rgba(color))
            .save_with_format(path, image::ImageFormat::Png)
            .unwrap();
    }

    fn write_jpeg_with_disguised_extension(path: &Path) {
        ImageBuffer::<Rgb<u8>, Vec<u8>>::from_pixel(4, 3, Rgb([7, 8, 9]))
            .save_with_format(path, image::ImageFormat::Jpeg)
            .unwrap();
    }

    fn fixture(label: &str) -> Fixture {
        let root = unique_root(label);
        let project = root.join("project.sbproj");
        let assets = project.join("assets");
        let authority = root.join("tauri-private-authority");
        fs::create_dir_all(&assets).unwrap();
        fs::create_dir_all(&authority).unwrap();
        let spatial = assets.join("spatial.png");
        let identity = assets.join("identity.png");
        let style_a = assets.join("style-a.png");
        let style_b = assets.join("style-b.png");
        let accepted = assets.join("accepted.png");
        write_png(&spatial, [255, 0, 0, 255]);
        write_png(&identity, [0, 255, 0, 255]);
        write_png(&style_a, [0, 0, 255, 255]);
        write_png(&style_b, [255, 255, 0, 255]);
        write_png(&accepted, [255, 0, 255, 255]);
        let request = PrepareCodexStoryboardJobRequest {
            schema_version: 1,
            job_id: format!("job-{label}"),
            project_id: "project-1".to_string(),
            episode_id: "episode-1".to_string(),
            shot_id: "shot-1".to_string(),
            provider: "codex_task_package".to_string(),
            created_at: "2026-08-28T12:00:00.000Z".to_string(),
            project_path: project.to_string_lossy().to_string(),
            prompt: json!({
                "useCase": "stylized-concept",
                "primaryRequest": "Create one storyboard frame.",
                "assetType": "AI comic-drama storyboard frame"
            }),
            references: vec![
                CodexStoryboardReferenceSelection {
                    id: "spatial".to_string(),
                    usage: "spatial_authority".to_string(),
                    instruction: "Keep camera and geometry.".to_string(),
                    source_path: spatial.to_string_lossy().to_string(),
                },
                CodexStoryboardReferenceSelection {
                    id: "identity".to_string(),
                    usage: "face_identity".to_string(),
                    instruction: "Keep face identity.".to_string(),
                    source_path: identity.to_string_lossy().to_string(),
                },
                CodexStoryboardReferenceSelection {
                    id: "style-a".to_string(),
                    usage: "style_only".to_string(),
                    instruction: "Use materials only.".to_string(),
                    source_path: style_a.to_string_lossy().to_string(),
                },
                CodexStoryboardReferenceSelection {
                    id: "style-b".to_string(),
                    usage: "style_only".to_string(),
                    instruction: "Use lighting only.".to_string(),
                    source_path: style_b.to_string_lossy().to_string(),
                },
            ],
            accepted_image_path: Some(accepted.to_string_lossy().to_string()),
        };
        Fixture {
            project,
            assets,
            authority,
            accepted,
            request,
        }
    }

    fn digest(path: &Path) -> String {
        format!("{:x}", Sha256::digest(fs::read(path).unwrap()))
    }

    fn publish_result(receipt: &CodexStoryboardExportReceipt, mutate: impl FnOnce(&mut Value)) {
        let package = Path::new(&receipt.package_path);
        let request: Value =
            serde_json::from_slice(&fs::read(&receipt.request_path).unwrap()).unwrap();
        let candidate = package.join("outputs/candidate.png");
        write_png(&candidate, [12, 34, 56, 255]);
        let references = request["references"]
            .as_array()
            .unwrap()
            .iter()
            .map(|reference| {
                json!({
                    "id": reference["id"],
                    "sha256": reference["sha256"]
                })
            })
            .collect::<Vec<_>>();
        let mut result = json!({
            "schemaVersion": 1,
            "jobId": request["jobId"],
            "projectId": request["projectId"],
            "episodeId": request["episodeId"],
            "shotId": request["shotId"],
            "provider": "codex_task_package",
            "requestDigest": receipt.request_digest,
            "referenceDigests": references,
            "generationMode": "codex_builtin_imagegen",
            "finalPrompt": "final prompt",
            "output": {
                "relativePath": "outputs/candidate.png",
                "sha256": digest(&candidate),
                "width": 3,
                "height": 2,
                "mimeType": "image/png"
            },
            "completedAt": "2026-08-28T12:01:00.000Z",
            "state": "completed"
        });
        mutate(&mut result);
        fs::write(
            package.join("outputs/result.json"),
            serde_json::to_vec_pretty(&result).unwrap(),
        )
        .unwrap();
    }

    fn import_request(fixture: &Fixture, task_status: &str) -> ImportCodexStoryboardResultRequest {
        ImportCodexStoryboardResultRequest {
            schema_version: 1,
            job_id: fixture.request.job_id.clone(),
            project_id: fixture.request.project_id.clone(),
            episode_id: fixture.request.episode_id.clone(),
            shot_id: fixture.request.shot_id.clone(),
            provider: fixture.request.provider.clone(),
            project_path: fixture.request.project_path.clone(),
            task_status: task_status.to_string(),
        }
    }

    #[test]
    fn exports_ordered_snapshots_then_publishes_request_without_touching_accepted_image() {
        let fixture = fixture("export");
        let accepted_before = fs::read(&fixture.accepted).unwrap();
        let mut permissions = fs::metadata(&fixture.accepted).unwrap().permissions();
        permissions.set_readonly(true);
        fs::set_permissions(&fixture.accepted, permissions).unwrap();

        let receipt = prepare_at_roots(
            &fixture.project,
            &fixture.assets,
            &fixture.authority,
            fixture.request.clone(),
        )
        .unwrap();

        assert_eq!(receipt.status, "exported");
        assert!(Path::new(&receipt.request_path).is_file());
        assert!(Path::new(&receipt.package_path)
            .join("inputs/01-spatial-authority.png")
            .is_file());
        assert!(Path::new(&receipt.package_path)
            .join("inputs/03-style-only.png")
            .is_file());
        assert!(Path::new(&receipt.package_path)
            .join("inputs/04-style-only.png")
            .is_file());
        let published: Value =
            serde_json::from_slice(&fs::read(&receipt.request_path).unwrap()).unwrap();
        assert_eq!(
            published["references"][2]["relativePath"],
            "inputs/03-style-only.png"
        );
        assert_eq!(
            published["references"][3]["relativePath"],
            "inputs/04-style-only.png"
        );
        for reference in published["references"].as_array().unwrap() {
            assert!(Path::new(&receipt.package_path)
                .join(reference["relativePath"].as_str().unwrap())
                .is_file());
        }
        assert_eq!(fs::read(&fixture.accepted).unwrap(), accepted_before);
        assert_eq!(
            prepare_at_roots(
                &fixture.project,
                &fixture.assets,
                &fixture.authority,
                fixture.request.clone(),
            )
            .unwrap_err(),
            "codex_storyboard_destination_exists"
        );
    }

    #[test]
    fn failed_late_snapshot_never_publishes_request() {
        let fixture = fixture("late-failure");
        let mut request = fixture.request.clone();
        request.references[3].source_path = fixture
            .assets
            .join("missing.png")
            .to_string_lossy()
            .to_string();
        assert_eq!(
            prepare_at_roots(
                &fixture.project,
                &fixture.assets,
                &fixture.authority,
                request,
            )
            .unwrap_err(),
            "codex_storyboard_reference_missing"
        );
        assert!(!fixture
            .project
            .join("codex-storyboard-jobs")
            .join(&fixture.request.job_id)
            .join("request.json")
            .exists());
    }

    #[test]
    fn rejects_asset_roots_outside_project() {
        let fixture = fixture("outside-assets");
        let outside = unique_root("outside-assets-root");
        fs::create_dir_all(&outside).unwrap();
        assert_eq!(
            prepare_at_roots(
                &fixture.project,
                &outside,
                &fixture.authority,
                fixture.request.clone(),
            )
            .unwrap_err(),
            "codex_storyboard_assets_root_outside_project"
        );
    }

    #[test]
    fn authority_record_is_private_and_ipc_cannot_replace_its_digest() {
        let fixture = fixture("private-authority");
        let receipt = prepare_at_roots(
            &fixture.project,
            &fixture.assets,
            &fixture.authority,
            fixture.request.clone(),
        )
        .unwrap();
        let record = authority_export_record_path(
            &fixture.authority,
            &fixture.project,
            &fixture.request.project_id,
            &fixture.request.job_id,
        )
        .unwrap();
        assert!(record.is_file());
        assert!(!Path::new(&receipt.package_path)
            .join("authority.json")
            .exists());

        publish_result(&receipt, |_| {});
        let mut rewritten: CodexStoryboardRequest =
            serde_json::from_slice(&fs::read(Path::new(&receipt.request_path)).unwrap()).unwrap();
        rewritten.prompt["primaryRequest"] = json!("rewritten with matching result");
        let rewritten_digest = request_digest(&rewritten).unwrap();
        fs::write(
            &receipt.request_path,
            serde_json::to_vec_pretty(&rewritten).unwrap(),
        )
        .unwrap();
        let result_path = Path::new(&receipt.package_path).join("outputs/result.json");
        let mut result: Value = serde_json::from_slice(&fs::read(&result_path).unwrap()).unwrap();
        result["requestDigest"] = json!(rewritten_digest);
        fs::write(&result_path, serde_json::to_vec_pretty(&result).unwrap()).unwrap();
        assert_eq!(
            import_at_roots(
                &fixture.project,
                &fixture.assets,
                &fixture.authority,
                import_request(&fixture, "queued"),
            )
            .unwrap_err(),
            "codex_storyboard_request_digest_mismatch"
        );
    }

    #[test]
    fn package_marker_cannot_block_or_reenable_import_replay() {
        let fixture = fixture("authority-replay");
        let receipt = prepare_at_roots(
            &fixture.project,
            &fixture.assets,
            &fixture.authority,
            fixture.request.clone(),
        )
        .unwrap();
        publish_result(&receipt, |_| {});
        let package_marker = Path::new(&receipt.package_path).join("outputs/import-receipt.json");
        fs::write(&package_marker, b"attacker-prebuilt-marker").unwrap();

        let imported = import_at_roots(
            &fixture.project,
            &fixture.assets,
            &fixture.authority,
            import_request(&fixture, "queued"),
        )
        .unwrap();
        assert_eq!(imported.status, "needs_review");
        assert_eq!(
            fs::read(&package_marker).unwrap(),
            b"attacker-prebuilt-marker"
        );
        fs::remove_file(&package_marker).unwrap();
        assert_eq!(
            import_at_roots(
                &fixture.project,
                &fixture.assets,
                &fixture.authority,
                import_request(&fixture, "queued"),
            )
            .unwrap_err(),
            "codex_storyboard_result_already_imported"
        );
        assert!(authority_import_ledger_path(
            &fixture.authority,
            &fixture.project,
            &fixture.request.project_id,
            &fixture.request.job_id,
            &receipt.request_digest,
        )
        .unwrap()
        .is_file());
    }

    #[test]
    fn source_exchange_before_copy_uses_only_final_snapshot_bytes_and_metadata() {
        let fixture = fixture("source-exchange");
        let source = PathBuf::from(&fixture.request.references[0].source_path);
        let receipt = prepare_at_roots_with_copy_hook(
            &fixture.project,
            &fixture.assets,
            &fixture.authority,
            fixture.request.clone(),
            |index| {
                if index == 0 {
                    write_png_dimensions(&source, 5, 4, [31, 32, 33, 255]);
                }
            },
        )
        .unwrap();
        let immutable: CodexStoryboardRequest =
            serde_json::from_slice(&fs::read(&receipt.request_path).unwrap()).unwrap();
        let snapshot =
            Path::new(&receipt.package_path).join(&immutable.references[0].relative_path);
        assert_eq!(immutable.references[0].sha256, digest(&snapshot));
        assert_eq!(
            (
                immutable.references[0].width,
                immutable.references[0].height
            ),
            (5, 4)
        );
    }

    #[test]
    fn candidate_metadata_drift_during_validation_fails_before_replay_claim() {
        let fixture = fixture("candidate-drift");
        let receipt = prepare_at_roots(
            &fixture.project,
            &fixture.assets,
            &fixture.authority,
            fixture.request.clone(),
        )
        .unwrap();
        publish_result(&receipt, |_| {});
        let candidate = Path::new(&receipt.package_path).join("outputs/candidate.png");
        assert_eq!(
            import_at_roots_with_candidate_hook(
                &fixture.project,
                &fixture.assets,
                &fixture.authority,
                import_request(&fixture, "queued"),
                || write_png_dimensions(&candidate, 7, 6, [90, 91, 92, 255]),
            )
            .unwrap_err(),
            "codex_storyboard_candidate_changed_during_validation"
        );
        assert!(!authority_import_ledger_path(
            &fixture.authority,
            &fixture.project,
            &fixture.request.project_id,
            &fixture.request.job_id,
            &receipt.request_digest,
        )
        .unwrap()
        .exists());
    }

    #[test]
    fn canonical_containment_oracle_rejects_external_file() {
        let fixture = fixture("containment-oracle");
        let outside = unique_root("containment-oracle-outside").join("candidate.png");
        write_png(&outside, [1, 2, 3, 255]);
        assert_eq!(
            canonical_existing_file_within(
                &fixture.project,
                &outside,
                "codex_storyboard_candidate_escape",
            )
            .unwrap_err(),
            "codex_storyboard_candidate_escape"
        );
    }

    #[test]
    fn jpeg_magic_controls_snapshot_extension_and_mime_not_source_suffix() {
        let fixture = fixture("jpeg-magic");
        let disguised = fixture.assets.join("actually-jpeg.png");
        write_jpeg_with_disguised_extension(&disguised);
        let mut request = fixture.request.clone();
        request.references[3].source_path = disguised.to_string_lossy().to_string();
        let receipt = prepare_at_roots(
            &fixture.project,
            &fixture.assets,
            &fixture.authority,
            request,
        )
        .unwrap();
        let immutable: CodexStoryboardRequest =
            serde_json::from_slice(&fs::read(&receipt.request_path).unwrap()).unwrap();
        assert_eq!(immutable.references[3].mime_type, "image/jpeg");
        assert_eq!(
            immutable.references[3].relative_path,
            "inputs/04-style-only.jpg"
        );
    }

    #[test]
    fn concurrent_no_replace_publish_and_import_have_one_winner() {
        use std::sync::{Arc, Barrier};
        use std::thread;

        let publish_root = unique_root("concurrent-publish");
        fs::create_dir_all(&publish_root).unwrap();
        let final_path = publish_root.join("final.json");
        let barrier = Arc::new(Barrier::new(8));
        let publish_handles = (0..8)
            .map(|index| {
                let barrier = Arc::clone(&barrier);
                let path = final_path.clone();
                thread::spawn(move || {
                    barrier.wait();
                    publish_json(&path, &json!({ "winner": index }), "exists")
                })
            })
            .collect::<Vec<_>>();
        let publish_results = publish_handles
            .into_iter()
            .map(|handle| handle.join().unwrap())
            .collect::<Vec<_>>();
        assert_eq!(
            publish_results
                .iter()
                .filter(|result| result.is_ok())
                .count(),
            1
        );
        let published: Value = serde_json::from_slice(&fs::read(&final_path).unwrap()).unwrap();
        assert!(published["winner"].as_u64().unwrap() < 8);

        let fixture = fixture("concurrent-import");
        let receipt = prepare_at_roots(
            &fixture.project,
            &fixture.assets,
            &fixture.authority,
            fixture.request.clone(),
        )
        .unwrap();
        publish_result(&receipt, |_| {});
        let barrier = Arc::new(Barrier::new(8));
        let import_handles = (0..8)
            .map(|_| {
                let barrier = Arc::clone(&barrier);
                let project = fixture.project.clone();
                let assets = fixture.assets.clone();
                let authority = fixture.authority.clone();
                let request = import_request(&fixture, "queued");
                thread::spawn(move || {
                    barrier.wait();
                    import_at_roots(&project, &assets, &authority, request)
                })
            })
            .collect::<Vec<_>>();
        let results = import_handles
            .into_iter()
            .map(|handle| handle.join().unwrap())
            .collect::<Vec<_>>();
        assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
        assert_eq!(
            results
                .iter()
                .filter_map(|result| result.as_ref().err())
                .filter(|error| error.as_str() == "codex_storyboard_result_already_imported")
                .count(),
            7
        );
    }

    #[test]
    fn import_rejects_cancelled_identity_mismatch_tampering_and_replay() {
        let cancelled_fixture = fixture("cancelled");
        let cancelled_receipt = prepare_at_roots(
            &cancelled_fixture.project,
            &cancelled_fixture.assets,
            &cancelled_fixture.authority,
            cancelled_fixture.request.clone(),
        )
        .unwrap();
        publish_result(&cancelled_receipt, |_| {});
        assert_eq!(
            import_at_roots(
                &cancelled_fixture.project,
                &cancelled_fixture.assets,
                &cancelled_fixture.authority,
                import_request(&cancelled_fixture, "cancelled"),
            )
            .unwrap_err(),
            "codex_storyboard_task_cancelled"
        );

        let mismatch_fixture = fixture("mismatch");
        let mismatch_receipt = prepare_at_roots(
            &mismatch_fixture.project,
            &mismatch_fixture.assets,
            &mismatch_fixture.authority,
            mismatch_fixture.request.clone(),
        )
        .unwrap();
        publish_result(&mismatch_receipt, |result| {
            result["shotId"] = json!("other-shot")
        });
        assert_eq!(
            import_at_roots(
                &mismatch_fixture.project,
                &mismatch_fixture.assets,
                &mismatch_fixture.authority,
                import_request(&mismatch_fixture, "queued"),
            )
            .unwrap_err(),
            "codex_storyboard_result_identity_mismatch"
        );

        let tampered_fixture = fixture("tampered");
        let tampered_receipt = prepare_at_roots(
            &tampered_fixture.project,
            &tampered_fixture.assets,
            &tampered_fixture.authority,
            tampered_fixture.request.clone(),
        )
        .unwrap();
        publish_result(&tampered_receipt, |_| {});
        fs::write(
            Path::new(&tampered_receipt.package_path).join("inputs/02-face-identity.png"),
            b"tampered",
        )
        .unwrap();
        assert_eq!(
            import_at_roots(
                &tampered_fixture.project,
                &tampered_fixture.assets,
                &tampered_fixture.authority,
                import_request(&tampered_fixture, "queued"),
            )
            .unwrap_err(),
            "codex_storyboard_reference_digest_mismatch"
        );

        let valid_fixture = fixture("valid-import");
        let valid_receipt = prepare_at_roots(
            &valid_fixture.project,
            &valid_fixture.assets,
            &valid_fixture.authority,
            valid_fixture.request.clone(),
        )
        .unwrap();
        publish_result(&valid_receipt, |_| {});
        let valid_import = import_at_roots(
            &valid_fixture.project,
            &valid_fixture.assets,
            &valid_fixture.authority,
            import_request(&valid_fixture, "queued"),
        )
        .unwrap();
        assert_eq!(valid_import.status, "needs_review");
        assert!(Path::new(&valid_import.candidate_path).ends_with("outputs/candidate.png"));
        assert_eq!(valid_import.job_id, valid_receipt.job_id);
        assert_eq!(valid_import.result.job_id, valid_import.job_id);
        assert_eq!(
            valid_import.result.request_digest,
            valid_receipt.request_digest
        );
        assert_eq!(
            valid_import.result_path,
            Path::new(&valid_receipt.package_path)
                .join("outputs/result.json")
                .to_string_lossy()
        );
        assert_eq!(
            import_at_roots(
                &valid_fixture.project,
                &valid_fixture.assets,
                &valid_fixture.authority,
                import_request(&valid_fixture, "queued"),
            )
            .unwrap_err(),
            "codex_storyboard_result_already_imported"
        );
    }

    #[test]
    fn import_rejects_request_and_result_rewritten_to_a_new_digest() {
        let fixture = fixture("rewritten-request");
        let receipt = prepare_at_roots(
            &fixture.project,
            &fixture.assets,
            &fixture.authority,
            fixture.request.clone(),
        )
        .unwrap();
        let request_path = Path::new(&receipt.request_path);
        let mut rewritten: CodexStoryboardRequest =
            serde_json::from_slice(&fs::read(request_path).unwrap()).unwrap();
        rewritten.prompt["primaryRequest"] = json!("attacker-rewritten prompt");
        let rewritten_digest = request_digest(&rewritten).unwrap();
        fs::write(request_path, serde_json::to_vec_pretty(&rewritten).unwrap()).unwrap();
        publish_result(&receipt, |result| {
            result["requestDigest"] = json!(rewritten_digest);
        });

        assert_eq!(
            import_at_roots(
                &fixture.project,
                &fixture.assets,
                &fixture.authority,
                import_request(&fixture, "queued"),
            )
            .unwrap_err(),
            "codex_storyboard_request_digest_mismatch"
        );
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlink_reference_escape() {
        use std::os::unix::fs::symlink;
        let fixture = fixture("symlink-unix");
        let outside = unique_root("symlink-target").join("outside.png");
        write_png(&outside, [1, 2, 3, 255]);
        let link = fixture.assets.join("escape.png");
        symlink(&outside, &link).unwrap();
        let mut request = fixture.request.clone();
        request.references[0].source_path = link.to_string_lossy().to_string();
        assert_eq!(
            prepare_at_roots(
                &fixture.project,
                &fixture.assets,
                &fixture.authority,
                request,
            )
            .unwrap_err(),
            "codex_storyboard_reference_path_escape"
        );
    }

    #[cfg(windows)]
    #[test]
    fn rejects_symlink_reference_escape_when_windows_allows_symlinks() {
        use std::os::windows::fs::symlink_file;
        let fixture = fixture("symlink-windows");
        let outside = unique_root("symlink-target").join("outside.png");
        write_png(&outside, [1, 2, 3, 255]);
        let link = fixture.assets.join("escape.png");
        if symlink_file(&outside, &link).is_err() {
            eprintln!("SKIP: Windows symlink privilege unavailable; containment oracle still ran");
            return;
        }
        let mut request = fixture.request.clone();
        request.references[0].source_path = link.to_string_lossy().to_string();
        assert_eq!(
            prepare_at_roots(
                &fixture.project,
                &fixture.assets,
                &fixture.authority,
                request,
            )
            .unwrap_err(),
            "codex_storyboard_reference_path_escape"
        );
    }

    #[cfg(unix)]
    #[test]
    fn rejects_outputs_directory_symlink_replacement() {
        use std::os::unix::fs::symlink;
        let fixture = fixture("outputs-symlink-unix");
        let receipt = prepare_at_roots(
            &fixture.project,
            &fixture.assets,
            &fixture.authority,
            fixture.request.clone(),
        )
        .unwrap();
        publish_result(&receipt, |_| {});
        let package = Path::new(&receipt.package_path);
        let outside = unique_root("outputs-outside-unix");
        fs::rename(package.join("outputs"), &outside).unwrap();
        symlink(&outside, package.join("outputs")).unwrap();
        assert_eq!(
            import_at_roots(
                &fixture.project,
                &fixture.assets,
                &fixture.authority,
                import_request(&fixture, "queued"),
            )
            .unwrap_err(),
            "codex_storyboard_outputs_escape"
        );
    }

    #[cfg(windows)]
    #[test]
    fn rejects_outputs_directory_symlink_replacement_when_windows_allows_symlinks() {
        use std::os::windows::fs::symlink_dir;
        let fixture = fixture("outputs-symlink-windows");
        let receipt = prepare_at_roots(
            &fixture.project,
            &fixture.assets,
            &fixture.authority,
            fixture.request.clone(),
        )
        .unwrap();
        publish_result(&receipt, |_| {});
        let package = Path::new(&receipt.package_path);
        let outside = unique_root("outputs-outside-windows");
        fs::rename(package.join("outputs"), &outside).unwrap();
        if symlink_dir(&outside, package.join("outputs")).is_err() {
            eprintln!("SKIP: Windows directory-symlink privilege unavailable; containment oracle still ran");
            return;
        }
        assert_eq!(
            import_at_roots(
                &fixture.project,
                &fixture.assets,
                &fixture.authority,
                import_request(&fixture, "queued"),
            )
            .unwrap_err(),
            "codex_storyboard_outputs_escape"
        );
    }
}
