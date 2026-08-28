use cap_std::{
    ambient_authority,
    fs::{Dir as CapabilityDir, OpenOptions as CapabilityOpenOptions},
};
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
const MAX_IMAGE_BYTES: usize = 64 * 1024 * 1024;
const MAX_IMAGE_PIXELS: u64 = 64 * 1024 * 1024;

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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TransitionCodexStoryboardLifecycleRequest {
    pub schema_version: u8,
    pub job_id: String,
    pub project_id: String,
    pub episode_id: String,
    pub shot_id: String,
    pub provider: String,
    pub project_path: String,
    pub expected_state: String,
    pub next_state: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CodexStoryboardLifecycleReceipt {
    pub schema_version: u8,
    pub job_id: String,
    pub state: String,
    pub version: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CodexStoryboardLifecycleRecord {
    schema_version: u8,
    project_id: String,
    episode_id: String,
    shot_id: String,
    job_id: String,
    request_digest: String,
    version: u32,
    previous_state: Option<String>,
    state: String,
    result_digest: Option<String>,
    candidate_digest: Option<String>,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CodexStoryboardReadyRecord {
    schema_version: u8,
    canonical_project_path: String,
    project_id: String,
    job_id: String,
    request_digest: String,
    canonical_package_path: String,
    package_identity_a: u64,
    package_identity_b: u64,
    package_attributes: u32,
    request_sha256: String,
    request_identity_a: u64,
    request_identity_b: u64,
    request_len: u64,
    request_created_nanos: u128,
    request_modified_nanos: u128,
    request_attributes: u32,
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

#[cfg(test)]
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

fn component_contained(root: &Path, path: &Path) -> bool {
    let mut path_components = path.components();
    for root_component in root.components() {
        let Some(path_component) = path_components.next() else {
            return false;
        };
        #[cfg(windows)]
        if !root_component
            .as_os_str()
            .to_string_lossy()
            .eq_ignore_ascii_case(&path_component.as_os_str().to_string_lossy())
        {
            return false;
        }
        #[cfg(not(windows))]
        if root_component != path_component {
            return false;
        }
    }
    true
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
    attributes: u32,
}

fn metadata_attributes(metadata: &fs::Metadata) -> u32 {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        metadata.file_attributes()
    }
    #[cfg(not(windows))]
    {
        let _ = metadata;
        0
    }
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
        attributes: metadata_attributes(&metadata),
    })
}

fn open_directory_no_follow(path: &Path) -> Result<File, std::io::Error> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        const FILE_FLAG_BACKUP_SEMANTICS: u32 = 0x0200_0000;
        const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
        options.custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT);
    }
    options.open(path)
}

fn open_capability_directory(path: &Path, code: &str) -> Result<CapabilityDir, String> {
    CapabilityDir::open_ambient_dir(path, ambient_authority()).map_err(|_| code.to_string())
}

fn bind_capability_directory(
    directory: &CapabilityDir,
    stable: &StableDirectory,
    code: &str,
) -> Result<(), String> {
    let file = directory
        .try_clone()
        .map_err(|_| code.to_string())?
        .into_std_file();
    let metadata = file.metadata().map_err(|_| code.to_string())?;
    let (identity_a, identity_b) = opened_file_identity(&file).map_err(|_| code.to_string())?;
    if identity_a != stable.identity_a
        || identity_b != stable.identity_b
        || metadata_attributes(&metadata) != stable.attributes
    {
        return Err(code.to_string());
    }
    Ok(())
}

fn open_capability_child(
    parent: &CapabilityDir,
    name: &Path,
    code: &str,
) -> Result<CapabilityDir, String> {
    parent.open_dir(name).map_err(|_| code.to_string())
}

fn ensure_capability_child(
    parent: &CapabilityDir,
    name: &Path,
    code: &str,
) -> Result<CapabilityDir, String> {
    match parent.create_dir(name) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(_) => return Err(code.to_string()),
    }
    open_capability_child(parent, name, code)
}

#[derive(Debug, Clone)]
struct StableDirectory {
    original_path: PathBuf,
    canonical_path: PathBuf,
    identity_a: u64,
    identity_b: u64,
    attributes: u32,
}

fn capture_stable_directory(path: &Path, code: &str) -> Result<StableDirectory, String> {
    reject_symlink(path, code)?;
    let canonical_before = canonical_directory(path, code)?;
    let directory = open_directory_no_follow(path).map_err(|_| code.to_string())?;
    let metadata = directory.metadata().map_err(|_| code.to_string())?;
    let (identity_a, identity_b) =
        opened_file_identity(&directory).map_err(|_| code.to_string())?;
    let attributes = metadata_attributes(&metadata);
    reject_symlink(path, code)?;
    let canonical_after = canonical_directory(path, code)?;
    if canonical_before != canonical_after {
        return Err(code.to_string());
    }
    Ok(StableDirectory {
        original_path: path.to_path_buf(),
        canonical_path: canonical_after,
        identity_a,
        identity_b,
        attributes,
    })
}

fn revalidate_stable_directory(stable: &StableDirectory, code: &str) -> Result<(), String> {
    let current = capture_stable_directory(&stable.original_path, code)?;
    if current.canonical_path != stable.canonical_path
        || current.identity_a != stable.identity_a
        || current.identity_b != stable.identity_b
        || current.attributes != stable.attributes
    {
        return Err(code.to_string());
    }
    Ok(())
}

#[cfg(test)]
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

#[cfg(test)]
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

#[cfg(test)]
fn read_stable_file_within(root: &Path, path: &Path, code: &str) -> Result<StableFile, String> {
    let root = canonical_directory(root, code)?;
    let canonical_before = canonical_existing_file_within(&root, path, code)?;
    let mut file = open_read_no_follow(path).map_err(|_| code.to_string())?;
    let before = opened_file_fingerprint(&file).map_err(|_| code.to_string())?;
    if before.len > MAX_IMAGE_BYTES as u64 { return Err(code.to_string()); }
    let mut bytes = Vec::with_capacity(before.len as usize);
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

fn read_stable_file_at(
    directory: &CapabilityDir,
    root: &StableDirectory,
    relative: &Path,
    code: &str,
) -> Result<StableFile, String> {
    if relative.as_os_str().is_empty()
        || !relative
            .components()
            .all(|component| matches!(component, Component::Normal(_)))
    {
        return Err(code.to_string());
    }
    if directory
        .symlink_metadata(relative)
        .map_err(|_| code.to_string())?
        .file_type()
        .is_symlink()
    {
        return Err(code.to_string());
    }
    let mut file = directory
        .open(relative)
        .map_err(|_| code.to_string())?
        .into_std();
    let before = opened_file_fingerprint(&file).map_err(|_| code.to_string())?;
    if before.len > MAX_IMAGE_BYTES as u64 { return Err(code.to_string()); }
    let mut bytes = Vec::with_capacity(before.len as usize);
    file.read_to_end(&mut bytes).map_err(|_| code.to_string())?;
    let after = opened_file_fingerprint(&file).map_err(|_| code.to_string())?;
    if before != after || bytes.len() as u64 != after.len {
        return Err(code.to_string());
    }
    if directory
        .symlink_metadata(relative)
        .map_err(|_| code.to_string())?
        .file_type()
        .is_symlink()
    {
        return Err(code.to_string());
    }
    let reopened = directory
        .open(relative)
        .map_err(|_| code.to_string())?
        .into_std();
    if opened_file_fingerprint(&reopened).map_err(|_| code.to_string())? != after {
        return Err(code.to_string());
    }
    let canonical_path = fs::canonicalize(root.canonical_path.join(relative))
        .map_err(|_| code.to_string())?;
    if !component_contained(&root.canonical_path, &canonical_path) {
        return Err(code.to_string());
    }
    Ok(StableFile {
        bytes,
        canonical_path,
        fingerprint: after,
    })
}

fn revalidate_stable_file_at(
    stable: &StableFile,
    directory: &CapabilityDir,
    root: &StableDirectory,
    relative: &Path,
    code: &str,
) -> Result<(), String> {
    let current = read_stable_file_at(directory, root, relative, code)?;
    if current.canonical_path != stable.canonical_path
        || current.fingerprint != stable.fingerprint
        || current.bytes != stable.bytes
    {
        return Err(code.to_string());
    }
    Ok(())
}

#[cfg(test)]
fn read_stable_file_within_fixed_root_inner<B: FnOnce(), A: FnOnce()>(
    root: &StableDirectory,
    path: &Path,
    code: &str,
    before_read: B,
    after_read: A,
) -> Result<StableFile, String> {
    revalidate_stable_directory(root, code)?;
    before_read();
    let stable = read_stable_file_within(&root.canonical_path, path, code)?;
    after_read();
    if !component_contained(&root.canonical_path, &stable.canonical_path) {
        return Err(code.to_string());
    }
    revalidate_stable_directory(root, code)?;
    Ok(stable)
}

#[cfg(test)]
fn read_stable_file_within_fixed_root_with_hooks<B: FnOnce(), A: FnOnce()>(
    root: &StableDirectory,
    path: &Path,
    code: &str,
    before_read: B,
    after_read: A,
) -> Result<StableFile, String> {
    read_stable_file_within_fixed_root_inner(root, path, code, before_read, after_read)
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
    if bytes.is_empty() || bytes.len() > MAX_IMAGE_BYTES {
        return Err(invalid_code.to_string());
    }
    let (format, mime, extension) = if bytes.starts_with(&[137, 80, 78, 71, 13, 10, 26, 10]) {
        (image::ImageFormat::Png, "image/png".to_string(), "png")
    } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        (image::ImageFormat::Jpeg, "image/jpeg".to_string(), "jpg")
    } else {
        return Err(invalid_code.to_string());
    };
    let dimensions = image::ImageReader::with_format(std::io::Cursor::new(bytes), format)
        .into_dimensions()
        .map_err(|_| invalid_code.to_string())?
        ;
    if dimensions.0 == 0 || dimensions.1 == 0 {
        return Err(invalid_code.to_string());
    }
    if u64::from(dimensions.0).saturating_mul(u64::from(dimensions.1)) > MAX_IMAGE_PIXELS {
        return Err(invalid_code.to_string());
    }
    image::load_from_memory_with_format(bytes, format).map_err(|_| invalid_code.to_string())?;
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

fn canonical_request_bytes(request: &CodexStoryboardRequest) -> Result<Vec<u8>, String> {
    let value = serde_json::to_value(request)
        .map_err(|_| "codex_storyboard_request_invalid".to_string())?;
    serde_json::to_vec(&canonicalize_json(&value))
        .map_err(|_| "codex_storyboard_request_invalid".to_string())
}

fn request_digest(request: &CodexStoryboardRequest) -> Result<String, String> {
    Ok(sha256_bytes(&canonical_request_bytes(request)?))
}

fn compiled_prompt(request: &CodexStoryboardRequest) -> Result<String, String> {
    let prompt = request.prompt.as_object().ok_or_else(|| "codex_storyboard_prompt_invalid".to_string())?;
    let hard = prompt.get("hardConstraints").and_then(Value::as_object);
    let count = hard.and_then(|value| value.get("subjectCount")).and_then(Value::as_u64).filter(|value| *value > 0).unwrap_or(1);
    let anatomy = hard.and_then(|value| value.get("visibleAnatomy")).and_then(Value::as_str).map(str::trim).filter(|value| !value.is_empty()).unwrap_or("both arms, both hands, and all required fingers must remain visible and anatomically separate");
    let framing = hard.and_then(|value| value.get("cameraFramingLock")).and_then(Value::as_str).map(str::trim).filter(|value| !value.is_empty()).or_else(|| request.references.iter().find(|reference| reference.usage == "spatial_authority").map(|reference| reference.instruction.as_str())).ok_or_else(|| "codex_storyboard_prompt_invalid".to_string())?;
    let mut parts = request.references.iter().enumerate().map(|(index, reference)| format!("Picture {} [{}]: {}", index + 1, reference.usage, reference.instruction)).collect::<Vec<_>>();
    parts.push(format!("MANDATORY HARD CONSTRAINTS:\n- Exact subject count: {count}. Do not add, duplicate, merge, or remove subjects.\n- Visible anatomy: {anatomy}. No fused, missing, duplicated, or malformed limbs/hands.\n- Camera and framing lock: {framing}\n- No pose, composition, camera, framing, projection, or occlusion drift from spatial authority.\n- No text, captions, logos, signatures, or watermarks."));
    parts.push(prompt.get("primaryRequest").and_then(Value::as_str).ok_or_else(|| "codex_storyboard_prompt_invalid".to_string())?.to_string());
    Ok(parts.join("\n"))
}

fn valid_rfc3339_utc(value: &str) -> bool {
    let bytes = value.as_bytes();
    if value.len() != 24 || bytes.get(4) != Some(&b'-') || bytes.get(7) != Some(&b'-') || bytes.get(10) != Some(&b'T') || bytes.get(13) != Some(&b':') || bytes.get(16) != Some(&b':') || bytes.get(19) != Some(&b'.') || bytes.last() != Some(&b'Z') { return false; }
    let Ok(year) = value[..4].parse::<u16>() else { return false; }; let Ok(month) = value[5..7].parse::<u8>() else { return false; }; let Ok(day) = value[8..10].parse::<u8>() else { return false; };
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0); let max_day = match month { 1|3|5|7|8|10|12 => 31, 4|6|9|11 => 30, 2 if leap => 29, 2 => 28, _ => return false };
    day >= 1 && day <= max_day && value[11..13].parse::<u8>().is_ok_and(|v| v < 24) && value[14..16].parse::<u8>().is_ok_and(|v| v < 60) && value[17..19].parse::<u8>().is_ok_and(|v| v < 60) && value[20..23].bytes().all(|b| b.is_ascii_digit())
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

fn publish_bytes_at(
    directory: &CapabilityDir,
    path: &Path,
    bytes: &[u8],
    exists_code: &str,
) -> Result<(), String> {
    publish_bytes_at_inner(directory, path, bytes, exists_code, || {}, || {})
}

fn publish_bytes_at_inner<B: FnOnce(), L: FnOnce()>(
    directory: &CapabilityDir,
    path: &Path,
    bytes: &[u8],
    exists_code: &str,
    before_temp_create: B,
    before_link: L,
) -> Result<(), String> {
    if path.as_os_str().is_empty()
        || !path
            .components()
            .all(|component| matches!(component, Component::Normal(_)))
    {
        return Err("codex_storyboard_publish_failed".to_string());
    }
    let temporary = unique_temp_sibling(path)?;
    before_temp_create();
    let mut options = CapabilityOpenOptions::new();
    options.write(true).create_new(true);
    let mut file = directory
        .open_with(&temporary, &options)
        .map_err(|_| "codex_storyboard_publish_failed".to_string())?;
    file.write_all(bytes)
        .and_then(|_| file.sync_all())
        .map_err(|_| "codex_storyboard_publish_failed".to_string())?;
    drop(file);
    before_link();
    let link_result = directory.hard_link(&temporary, directory, path);
    let _ = directory.remove_file(&temporary);
    if link_result.is_err() {
        return if directory.symlink_metadata(path).is_ok() {
            Err(exists_code.to_string())
        } else {
            Err("codex_storyboard_publish_failed".to_string())
        };
    }
    Ok(())
}

fn publish_json_at<T: Serialize>(
    directory: &CapabilityDir,
    path: &Path,
    value: &T,
    exists_code: &str,
) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(value)
        .map_err(|_| "codex_storyboard_publish_failed".to_string())?;
    publish_bytes_at(directory, path, &bytes, exists_code)
}

#[cfg(test)]
fn publish_bytes_at_with_hooks<B: FnOnce(), L: FnOnce()>(
    directory: &CapabilityDir,
    path: &Path,
    bytes: &[u8],
    exists_code: &str,
    before_temp_create: B,
    before_link: L,
) -> Result<(), String> {
    publish_bytes_at_inner(
        directory,
        path,
        bytes,
        exists_code,
        before_temp_create,
        before_link,
    )
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

fn authority_project_dir(
    authority: &Path,
    family: &str,
    project: &Path,
    project_id: &str,
) -> Result<PathBuf, String> {
    let authority = canonical_authority_root(authority)?;
    let key = project_authority_key(project, project_id)?;
    let directory = authority.join(family).join(key);
    reject_symlink(&directory, "codex_storyboard_authority_invalid")?;
    let canonical = canonical_directory(&directory, "codex_storyboard_authority_invalid")?;
    if !canonical.starts_with(&authority) {
        return Err("codex_storyboard_authority_invalid".to_string());
    }
    Ok(canonical)
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
        authority_project_dir(authority, "exports", project, project_id)?
            .join(format!("{job_id}.json")),
    )
}

fn authority_ready_marker_path(
    authority: &Path,
    project: &Path,
    project_id: &str,
    job_id: &str,
) -> Result<PathBuf, String> {
    if !valid_identifier(job_id, 96) {
        return Err("codex_storyboard_jobId_invalid".to_string());
    }
    Ok(
        authority_project_dir(authority, "exports", project, project_id)?
            .join(format!("{job_id}.ready.json")),
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

fn lifecycle_transition_allowed(from: &str, to: &str) -> bool {
    matches!((from, to),
        ("queued", "needs_review") | ("queued", "cancelled") |
        ("needs_review", "accepted") | ("needs_review", "rejected"))
}

fn lifecycle_job_capability(
    authority_capability: &CapabilityDir,
    authority: &Path,
    project: &Path,
    project_id: &str,
    job_id: &str,
    create: bool,
) -> Result<(CapabilityDir, PathBuf), String> {
    let key = project_authority_key(project, project_id)?;
    let lifecycle = if create { ensure_capability_child(authority_capability, Path::new("lifecycle"), "codex_storyboard_authority_invalid")? } else { open_capability_child(authority_capability, Path::new("lifecycle"), "codex_storyboard_authority_invalid")? };
    let project_cap = if create { ensure_capability_child(&lifecycle, Path::new(&key), "codex_storyboard_authority_invalid")? } else { open_capability_child(&lifecycle, Path::new(&key), "codex_storyboard_authority_invalid")? };
    let job_cap = if create { ensure_capability_child(&project_cap, Path::new(job_id), "codex_storyboard_authority_invalid")? } else { open_capability_child(&project_cap, Path::new(job_id), "codex_storyboard_authority_invalid")? };
    Ok((job_cap, authority.join("lifecycle").join(key).join(job_id)))
}

fn read_lifecycle_record(
    job_capability: &CapabilityDir,
    job_path: &Path,
) -> Result<CodexStoryboardLifecycleRecord, String> {
    let mut versions = fs::read_dir(job_path).map_err(|_| "codex_storyboard_lifecycle_invalid".to_string())?
        .filter_map(Result::ok)
        .filter_map(|entry| entry.file_name().to_str().and_then(|name| name.strip_suffix(".json")).and_then(|stem| stem.parse::<u32>().ok()).map(|version| (version, entry.file_name())))
        .collect::<Vec<_>>();
    versions.sort_by_key(|(version, _)| *version);
    if versions.is_empty() || versions[0].0 != 0 || versions.iter().enumerate().any(|(index, (version, _))| *version != index as u32) {
        return Err("codex_storyboard_lifecycle_invalid".to_string());
    }
    let (version, name) = versions.last().unwrap();
    let bytes = read_stable_file_at(job_capability, &capture_stable_directory(job_path, "codex_storyboard_lifecycle_invalid")?, Path::new(name), "codex_storyboard_lifecycle_invalid")?.bytes;
    let record: CodexStoryboardLifecycleRecord = serde_json::from_slice(&bytes).map_err(|_| "codex_storyboard_lifecycle_invalid".to_string())?;
    if record.schema_version != 1 || record.version != *version || record.state.is_empty() { return Err("codex_storyboard_lifecycle_invalid".to_string()); }
    Ok(record)
}

fn cas_lifecycle_transition_bound(
    job_capability: &CapabilityDir,
    job_path: &Path,
    expected: &str,
    next: &str,
    result_digest: Option<&str>,
    candidate_digest: Option<&str>,
) -> Result<CodexStoryboardLifecycleRecord, String> {
    let current = read_lifecycle_record(job_capability, job_path)?;
    if current.state == next && lifecycle_transition_allowed(expected, next) {
        if result_digest.is_some_and(|digest| current.result_digest.as_deref() != Some(digest))
            || candidate_digest.is_some_and(|digest| current.candidate_digest.as_deref() != Some(digest)) {
            return Err("codex_storyboard_lifecycle_conflict".to_string());
        }
        return Ok(current);
    }
    if current.state != expected || !lifecycle_transition_allowed(expected, next) {
        return Err("codex_storyboard_lifecycle_conflict".to_string());
    }
    let next_record = CodexStoryboardLifecycleRecord {
        version: current.version + 1,
        previous_state: Some(current.state.clone()),
        state: next.to_string(),
        result_digest: result_digest.map(str::to_string).or(current.result_digest.clone()),
        candidate_digest: candidate_digest.map(str::to_string).or(current.candidate_digest.clone()),
        ..current
    };
    match publish_json_at(job_capability, Path::new(&format!("{:06}.json", next_record.version)), &next_record, "codex_storyboard_lifecycle_conflict") {
        Ok(()) => Ok(next_record),
        Err(error) if error == "codex_storyboard_lifecycle_conflict" => {
            let winner = read_lifecycle_record(job_capability, job_path)?;
            if winner.state == next
                && result_digest.is_none_or(|digest| winner.result_digest.as_deref() == Some(digest))
                && candidate_digest.is_none_or(|digest| winner.candidate_digest.as_deref() == Some(digest)) {
                Ok(winner)
            } else {
                Err(error)
            }
        }
        Err(error) => Err(error),
    }
}

fn cas_lifecycle_transition(
    job_capability: &CapabilityDir,
    job_path: &Path,
    expected: &str,
    next: &str,
) -> Result<CodexStoryboardLifecycleRecord, String> {
    cas_lifecycle_transition_bound(job_capability, job_path, expected, next, None, None)
}

fn write_bytes_create_new_at(
    directory: &CapabilityDir,
    destination: &Path,
    bytes: &[u8],
    code: &str,
) -> Result<(), String> {
    write_bytes_create_new_at_inner(directory, destination, bytes, code, || {})
}

fn write_bytes_create_new_at_inner<F: FnOnce()>(
    directory: &CapabilityDir,
    destination: &Path,
    bytes: &[u8],
    code: &str,
    before_open: F,
) -> Result<(), String> {
    if destination.as_os_str().is_empty()
        || !destination
            .components()
            .all(|component| matches!(component, Component::Normal(_)))
    {
        return Err(code.to_string());
    }
    before_open();
    let mut options = CapabilityOpenOptions::new();
    options.write(true).create_new(true);
    let mut output = directory
        .open_with(destination, &options)
        .map_err(|_| code.to_string())?;
    output
        .write_all(bytes)
        .and_then(|_| output.sync_all())
        .map_err(|_| code.to_string())
}

#[cfg(test)]
fn write_bytes_create_new_at_with_hook<F: FnOnce()>(
    directory: &CapabilityDir,
    destination: &Path,
    bytes: &[u8],
    code: &str,
    before_open: F,
) -> Result<(), String> {
    write_bytes_create_new_at_inner(directory, destination, bytes, code, before_open)
}

struct PrepareLayoutIdentity {
    project: StableDirectory,
    assets: StableDirectory,
    jobs: StableDirectory,
    package: StableDirectory,
    inputs: StableDirectory,
    outputs: StableDirectory,
}

fn revalidate_prepare_layout(layout: &PrepareLayoutIdentity) -> Result<(), String> {
    for directory in [
        &layout.project,
        &layout.assets,
        &layout.jobs,
        &layout.package,
        &layout.inputs,
        &layout.outputs,
    ] {
        revalidate_stable_directory(directory, "codex_storyboard_prepare_layout_changed")?;
    }
    if !component_contained(
        &layout.project.canonical_path,
        &layout.assets.canonical_path,
    ) || !component_contained(&layout.project.canonical_path, &layout.jobs.canonical_path)
        || !component_contained(&layout.jobs.canonical_path, &layout.package.canonical_path)
        || !component_contained(
            &layout.package.canonical_path,
            &layout.inputs.canonical_path,
        )
        || !component_contained(
            &layout.package.canonical_path,
            &layout.outputs.canonical_path,
        )
    {
        return Err("codex_storyboard_prepare_layout_changed".to_string());
    }
    Ok(())
}

fn revalidate_snapshots(
    inputs: &StableDirectory,
    inputs_capability: &CapabilityDir,
    snapshots: &[(StableFile, PathBuf)],
) -> Result<(), String> {
    for (snapshot, path) in snapshots {
        revalidate_stable_file_at(
            snapshot,
            inputs_capability,
            inputs,
            path,
            "codex_storyboard_snapshot_changed_during_export",
        )?;
    }
    Ok(())
}

fn prepare_at_roots(
    project: &Path,
    assets: &Path,
    authority: &Path,
    request: PrepareCodexStoryboardJobRequest,
) -> Result<CodexStoryboardExportReceipt, String> {
    prepare_at_roots_inner(
        project,
        assets,
        authority,
        request,
        |_| {},
        || {},
        || {},
        || {},
        || {},
    )
}

#[cfg(test)]
fn prepare_at_roots_with_copy_hook<F: FnMut(usize)>(
    project: &Path,
    assets: &Path,
    authority: &Path,
    request: PrepareCodexStoryboardJobRequest,
    before_copy: F,
) -> Result<CodexStoryboardExportReceipt, String> {
    prepare_at_roots_inner(
        project,
        assets,
        authority,
        request,
        before_copy,
        || {},
        || {},
        || {},
        || {},
    )
}

#[cfg(test)]
fn prepare_at_roots_with_layout_hook<F: FnOnce()>(
    project: &Path,
    assets: &Path,
    authority: &Path,
    request: PrepareCodexStoryboardJobRequest,
    before_publish: F,
) -> Result<CodexStoryboardExportReceipt, String> {
    prepare_at_roots_inner(
        project,
        assets,
        authority,
        request,
        |_| {},
        before_publish,
        || {},
        || {},
        || {},
    )
}

#[cfg(test)]
fn prepare_at_roots_with_publish_hooks<P: FnOnce(), A: FnOnce()>(
    project: &Path,
    assets: &Path,
    authority: &Path,
    request: PrepareCodexStoryboardJobRequest,
    before_publish: P,
    after_request_publish: A,
) -> Result<CodexStoryboardExportReceipt, String> {
    prepare_at_roots_inner(
        project,
        assets,
        authority,
        request,
        |_| {},
        before_publish,
        || {},
        || {},
        after_request_publish,
    )
}

#[cfg(test)]
fn prepare_at_roots_with_authority_open_hook<H: FnOnce()>(
    project: &Path,
    assets: &Path,
    authority: &Path,
    request: PrepareCodexStoryboardJobRequest,
    before_authority_capability_open: H,
) -> Result<CodexStoryboardExportReceipt, String> {
    prepare_at_roots_inner(
        project,
        assets,
        authority,
        request,
        |_| {},
        || {},
        before_authority_capability_open,
        || {},
        || {},
    )
}

#[cfg(test)]
fn prepare_at_roots_with_request_publish_hooks<B: FnOnce(), A: FnOnce()>(
    project: &Path,
    assets: &Path,
    authority: &Path,
    request: PrepareCodexStoryboardJobRequest,
    before_request_publish: B,
    after_request_publish: A,
) -> Result<CodexStoryboardExportReceipt, String> {
    prepare_at_roots_inner(
        project,
        assets,
        authority,
        request,
        |_| {},
        || {},
        || {},
        before_request_publish,
        after_request_publish,
    )
}

fn prepare_at_roots_inner<
    F: FnMut(usize),
    P: FnOnce(),
    H: FnOnce(),
    B: FnOnce(),
    A: FnOnce(),
>(
    project: &Path,
    assets: &Path,
    authority: &Path,
    request: PrepareCodexStoryboardJobRequest,
    mut before_copy: F,
    before_publish: P,
    before_authority_capability_open: H,
    before_request_publish: B,
    after_request_publish: A,
) -> Result<CodexStoryboardExportReceipt, String> {
    validate_prepare_request(&request)?;
    let project_root = capture_stable_directory(project, "codex_storyboard_project_root_invalid")?;
    let assets_root =
        capture_stable_directory(assets, "codex_storyboard_assets_root_outside_project")?;
    if !assets_root
        .canonical_path
        .starts_with(&project_root.canonical_path)
    {
        return Err("codex_storyboard_assets_root_outside_project".to_string());
    }
    let project = project_root.canonical_path.clone();
    let assets = assets_root.canonical_path.clone();
    let authority = canonical_authority_root(authority)?;
    let authority_root =
        capture_stable_directory(&authority, "codex_storyboard_authority_invalid")?;
    let project_capability =
        open_capability_directory(&project, "codex_storyboard_project_root_invalid")?;
    let assets_capability = if assets == project {
        project_capability
            .try_clone()
            .map_err(|_| "codex_storyboard_assets_root_outside_project".to_string())?
    } else {
        let relative = assets
            .strip_prefix(&project)
            .map_err(|_| "codex_storyboard_assets_root_outside_project".to_string())?;
        open_capability_child(
            &project_capability,
            relative,
            "codex_storyboard_assets_root_outside_project",
        )?
    };
    bind_capability_directory(
        &project_capability,
        &project_root,
        "codex_storyboard_prepare_layout_changed",
    )?;
    bind_capability_directory(
        &assets_capability,
        &assets_root,
        "codex_storyboard_prepare_layout_changed",
    )?;
    before_authority_capability_open();
    let authority_capability =
        open_capability_directory(&authority, "codex_storyboard_authority_invalid")?;
    bind_capability_directory(
        &authority_capability,
        &authority_root,
        "codex_storyboard_authority_invalid",
    )?;
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
        sources.push(
            source
                .strip_prefix(&assets)
                .map_err(|_| "codex_storyboard_reference_path_escape".to_string())?
                .to_path_buf(),
        );
    }

    revalidate_stable_directory(&project_root, "codex_storyboard_prepare_layout_changed")?;
    revalidate_stable_directory(&assets_root, "codex_storyboard_prepare_layout_changed")?;
    let jobs_capability = ensure_capability_child(
        &project_capability,
        Path::new("codex-storyboard-jobs"),
        "codex_storyboard_jobs_root_invalid",
    )?;
    let jobs = project.join("codex-storyboard-jobs");
    revalidate_stable_directory(&project_root, "codex_storyboard_prepare_layout_changed")?;
    let jobs_root = capture_stable_directory(&jobs, "codex_storyboard_prepare_layout_changed")?;
    if !component_contained(&project_root.canonical_path, &jobs_root.canonical_path) {
        return Err("codex_storyboard_prepare_layout_changed".to_string());
    }
    revalidate_stable_directory(&jobs_root, "codex_storyboard_prepare_layout_changed")?;
    bind_capability_directory(
        &jobs_capability,
        &jobs_root,
        "codex_storyboard_prepare_layout_changed",
    )?;
    let package = jobs_root.canonical_path.join(&request.job_id);
    match jobs_capability.create_dir(Path::new(&request.job_id)) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            return Err("codex_storyboard_destination_exists".to_string())
        }
        Err(_) => return Err("codex_storyboard_destination_create_failed".to_string()),
    }
    revalidate_stable_directory(&project_root, "codex_storyboard_prepare_layout_changed")?;
    revalidate_stable_directory(&jobs_root, "codex_storyboard_prepare_layout_changed")?;
    let package = fs::canonicalize(&package)
        .map_err(|_| "codex_storyboard_destination_create_failed".to_string())?;
    if !component_contained(&jobs_root.canonical_path, &package) {
        return Err("codex_storyboard_package_escape".to_string());
    }
    let package_root =
        capture_stable_directory(&package, "codex_storyboard_prepare_layout_changed")?;
    let package_capability = open_capability_child(
        &jobs_capability,
        Path::new(&request.job_id),
        "codex_storyboard_prepare_layout_changed",
    )?;
    bind_capability_directory(
        &package_capability,
        &package_root,
        "codex_storyboard_prepare_layout_changed",
    )?;
    revalidate_stable_directory(&jobs_root, "codex_storyboard_prepare_layout_changed")?;
    revalidate_stable_directory(&package_root, "codex_storyboard_prepare_layout_changed")?;
    let inputs = package.join("inputs");
    let outputs = package.join("outputs");
    package_capability
        .create_dir(Path::new("inputs"))
        .map_err(|_| "codex_storyboard_destination_create_failed".to_string())?;
    revalidate_stable_directory(&jobs_root, "codex_storyboard_prepare_layout_changed")?;
    revalidate_stable_directory(&package_root, "codex_storyboard_prepare_layout_changed")?;
    package_capability
        .create_dir(Path::new("outputs"))
        .map_err(|_| "codex_storyboard_destination_create_failed".to_string())?;
    revalidate_stable_directory(&jobs_root, "codex_storyboard_prepare_layout_changed")?;
    revalidate_stable_directory(&package_root, "codex_storyboard_prepare_layout_changed")?;

    let inputs = canonical_directory(&inputs, "codex_storyboard_inputs_escape")?;
    let outputs = canonical_directory(&outputs, "codex_storyboard_outputs_escape")?;
    if !component_contained(&jobs_root.canonical_path, &package)
        || !component_contained(&package, &inputs)
        || !component_contained(&package, &outputs)
    {
        return Err("codex_storyboard_package_escape".to_string());
    }

    let layout = PrepareLayoutIdentity {
        project: project_root,
        assets: assets_root,
        jobs: jobs_root,
        package: package_root,
        inputs: capture_stable_directory(&inputs, "codex_storyboard_prepare_layout_changed")?,
        outputs: capture_stable_directory(&outputs, "codex_storyboard_prepare_layout_changed")?,
    };
    let inputs_capability = open_capability_child(
        &package_capability,
        Path::new("inputs"),
        "codex_storyboard_prepare_layout_changed",
    )?;
    let outputs_capability = open_capability_child(
        &package_capability,
        Path::new("outputs"),
        "codex_storyboard_prepare_layout_changed",
    )?;
    bind_capability_directory(
        &inputs_capability,
        &layout.inputs,
        "codex_storyboard_prepare_layout_changed",
    )?;
    bind_capability_directory(
        &outputs_capability,
        &layout.outputs,
        "codex_storyboard_prepare_layout_changed",
    )?;
    revalidate_prepare_layout(&layout)?;

    let mut immutable_references = Vec::with_capacity(request.references.len());
    let mut stable_snapshots = Vec::with_capacity(request.references.len());
    for (index, (reference, source_relative)) in
        request.references.iter().zip(sources.iter()).enumerate()
    {
        revalidate_prepare_layout(&layout)?;
        before_copy(index);
        revalidate_prepare_layout(&layout)?;
        let source = read_stable_file_at(
            &assets_capability,
            &layout.assets,
            source_relative,
            "codex_storyboard_reference_changed_during_copy",
        )?;
        let usage = reference.usage.replace('_', "-");
        let placeholder = PathBuf::from(format!("{:02}-{usage}.snapshot", index + 1));
        let temporary = unique_temp_sibling(&placeholder)?;
        revalidate_prepare_layout(&layout)?;
        write_bytes_create_new_at(
            &inputs_capability,
            &temporary,
            &source.bytes,
            "codex_storyboard_snapshot_write_failed",
        )?;
        revalidate_prepare_layout(&layout)?;
        let temporary_snapshot = read_stable_file_at(
            &inputs_capability,
            &layout.inputs,
            &temporary,
            "codex_storyboard_snapshot_verify_failed",
        )?;
        let (_, _, _, extension) = inspect_image_bytes(
            &temporary_snapshot.bytes,
            "codex_storyboard_reference_image_invalid",
        )?;
        let filename = format!("{:02}-{usage}.{extension}", index + 1);
        let relative_path = format!("inputs/{filename}");
        let destination = PathBuf::from(&filename);
        revalidate_prepare_layout(&layout)?;
        if inputs_capability
            .hard_link(&temporary, &inputs_capability, &destination)
            .is_err()
        {
            let _ = inputs_capability.remove_file(&temporary);
            return Err(if inputs_capability.symlink_metadata(&destination).is_ok() {
                "codex_storyboard_snapshot_exists".to_string()
            } else {
                "codex_storyboard_snapshot_write_failed".to_string()
            });
        }
        let _ = inputs_capability.remove_file(&temporary);
        revalidate_prepare_layout(&layout)?;
        let snapshot = read_stable_file_at(
            &inputs_capability,
            &layout.inputs,
            &destination,
            "codex_storyboard_snapshot_verify_failed",
        )?;
        let (width, height, mime_type, verified_extension) =
            inspect_image_bytes(&snapshot.bytes, "codex_storyboard_reference_image_invalid")?;
        if verified_extension != extension || destination != Path::new(&filename) {
            return Err("codex_storyboard_snapshot_extension_mismatch".to_string());
        }
        stable_snapshots.push((snapshot.clone(), destination.clone()));
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
    let canonical_request = canonical_request_bytes(&immutable)?;
    let digest = sha256_bytes(&canonical_request);
    let authority_record = CodexStoryboardAuthorityRecord {
        schema_version: 1,
        canonical_project_path: project.to_string_lossy().to_string(),
        project_id: request.project_id.clone(),
        job_id: request.job_id.clone(),
        request_digest: digest.clone(),
        canonical_package_path: package.to_string_lossy().to_string(),
    };
    let authority_key = project_authority_key(&project, &request.project_id)?;
    revalidate_stable_directory(&authority_root, "codex_storyboard_authority_invalid")?;
    let exports_capability = ensure_capability_child(
        &authority_capability,
        Path::new("exports"),
        "codex_storyboard_authority_invalid",
    )?;
    let export_project_capability = ensure_capability_child(
        &exports_capability,
        Path::new(&authority_key),
        "codex_storyboard_authority_invalid",
    )?;
    let authority_record_name = PathBuf::from(format!("{}.json", request.job_id));
    before_publish();
    revalidate_prepare_layout(&layout)?;
    revalidate_stable_directory(&authority_root, "codex_storyboard_authority_invalid")?;
    revalidate_snapshots(&layout.inputs, &inputs_capability, &stable_snapshots)?;
    publish_json_at(
        &export_project_capability,
        &authority_record_name,
        &authority_record,
        "codex_storyboard_authority_record_exists",
    )?;
    revalidate_prepare_layout(&layout)?;
    revalidate_stable_directory(&authority_root, "codex_storyboard_authority_invalid")?;
    revalidate_snapshots(&layout.inputs, &inputs_capability, &stable_snapshots)?;
    let request_path = package.join("request.json");
    let request_relative = Path::new("request.json");
    revalidate_prepare_layout(&layout)?;
    revalidate_stable_directory(&authority_root, "codex_storyboard_authority_invalid")?;
    before_request_publish();
    publish_bytes_at(
        &package_capability,
        request_relative,
        &canonical_request,
        "codex_storyboard_request_exists",
    )?;
    after_request_publish();
    revalidate_prepare_layout(&layout)?;
    revalidate_stable_directory(&authority_root, "codex_storyboard_authority_invalid")?;
    let published_request = read_stable_file_at(
        &package_capability,
        &layout.package,
        request_relative,
        "codex_storyboard_request_changed_during_publication",
    )?;
    if published_request.bytes != canonical_request
        || sha256_bytes(&published_request.bytes) != digest
    {
        return Err("codex_storyboard_request_changed_during_publication".to_string());
    }
    revalidate_prepare_layout(&layout)?;
    revalidate_snapshots(&layout.inputs, &inputs_capability, &stable_snapshots)?;
    let ready_record = CodexStoryboardReadyRecord {
        schema_version: 1,
        canonical_project_path: project.to_string_lossy().to_string(),
        project_id: request.project_id.clone(),
        job_id: request.job_id.clone(),
        request_digest: digest.clone(),
        canonical_package_path: package.to_string_lossy().to_string(),
        package_identity_a: layout.package.identity_a,
        package_identity_b: layout.package.identity_b,
        package_attributes: layout.package.attributes,
        request_sha256: digest.clone(),
        request_identity_a: published_request.fingerprint.identity_a,
        request_identity_b: published_request.fingerprint.identity_b,
        request_len: published_request.fingerprint.len,
        request_created_nanos: published_request.fingerprint.created_nanos,
        request_modified_nanos: published_request.fingerprint.modified_nanos,
        request_attributes: published_request.fingerprint.attributes,
    };
    let ready_name = PathBuf::from(format!("{}.ready.json", request.job_id));
    revalidate_prepare_layout(&layout)?;
    revalidate_stable_directory(&authority_root, "codex_storyboard_authority_invalid")?;
    revalidate_snapshots(&layout.inputs, &inputs_capability, &stable_snapshots)?;
    revalidate_stable_file_at(
        &published_request,
        &package_capability,
        &layout.package,
        request_relative,
        "codex_storyboard_request_changed_during_publication",
    )?;
    outputs_capability
        .dir_metadata()
        .map_err(|_| "codex_storyboard_prepare_layout_changed".to_string())?;
    publish_json_at(
        &export_project_capability,
        &ready_name,
        &ready_record,
        "codex_storyboard_ready_marker_exists",
    )?;
    revalidate_stable_directory(&authority_root, "codex_storyboard_authority_invalid")?;
    revalidate_stable_file_at(
        &published_request,
        &package_capability,
        &layout.package,
        request_relative,
        "codex_storyboard_request_changed_during_publication",
    )?;
    revalidate_prepare_layout(&layout)?;
    revalidate_snapshots(&layout.inputs, &inputs_capability, &stable_snapshots)?;
    revalidate_stable_file_at(
        &published_request,
        &package_capability,
        &layout.package,
        request_relative,
        "codex_storyboard_request_changed_during_publication",
    )?;
    revalidate_stable_directory(&authority_root, "codex_storyboard_authority_invalid")?;
    let (lifecycle_capability, _) = lifecycle_job_capability(
        &authority_capability,
        &authority,
        &project,
        &request.project_id,
        &request.job_id,
        true,
    )?;
    let lifecycle = CodexStoryboardLifecycleRecord {
        schema_version: 1,
        project_id: request.project_id.clone(),
        episode_id: immutable.episode_id.clone(),
        shot_id: immutable.shot_id.clone(),
        job_id: request.job_id.clone(),
        request_digest: digest.clone(),
        version: 0,
        previous_state: None,
        state: "queued".to_string(),
        result_digest: None,
        candidate_digest: None,
    };
    publish_json_at(&lifecycle_capability, Path::new("000000.json"), &lifecycle, "codex_storyboard_lifecycle_exists")?;
    Ok(CodexStoryboardExportReceipt {
        schema_version: 1,
        job_id: request.job_id,
        package_path: package.to_string_lossy().to_string(),
        request_path: request_path.to_string_lossy().to_string(),
        request_digest: digest,
        status: "exported".to_string(),
    })
}

fn parse_stable_json_at<T: for<'de> Deserialize<'de>>(
    directory: &CapabilityDir,
    root: &StableDirectory,
    relative: &Path,
    code: &str,
) -> Result<(T, StableFile), String> {
    let stable = read_stable_file_at(directory, root, relative, code)?;
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
    Ok(())
}

#[derive(Debug, Clone)]
struct PackageLayout {
    package: PathBuf,
    inputs: PathBuf,
    outputs: PathBuf,
}

struct ImportLayoutIdentity {
    jobs: StableDirectory,
    package: StableDirectory,
    inputs: StableDirectory,
    outputs: StableDirectory,
}

fn capture_import_layout(
    project: &Path,
    layout: &PackageLayout,
) -> Result<ImportLayoutIdentity, String> {
    let identity = ImportLayoutIdentity {
        jobs: capture_stable_directory(
            &project.join("codex-storyboard-jobs"),
            "codex_storyboard_package_changed_during_validation",
        )?,
        package: capture_stable_directory(
            &layout.package,
            "codex_storyboard_package_changed_during_validation",
        )?,
        inputs: capture_stable_directory(
            &layout.inputs,
            "codex_storyboard_package_changed_during_validation",
        )?,
        outputs: capture_stable_directory(
            &layout.outputs,
            "codex_storyboard_package_changed_during_validation",
        )?,
    };
    revalidate_import_layout(project, &identity)?;
    Ok(identity)
}

fn revalidate_import_layout(project: &Path, layout: &ImportLayoutIdentity) -> Result<(), String> {
    for directory in [
        &layout.jobs,
        &layout.package,
        &layout.inputs,
        &layout.outputs,
    ] {
        revalidate_stable_directory(
            directory,
            "codex_storyboard_package_changed_during_validation",
        )?;
    }
    if !component_contained(project, &layout.jobs.canonical_path)
        || !component_contained(&layout.jobs.canonical_path, &layout.package.canonical_path)
        || !component_contained(
            &layout.package.canonical_path,
            &layout.inputs.canonical_path,
        )
        || !component_contained(
            &layout.package.canonical_path,
            &layout.outputs.canonical_path,
        )
    {
        return Err("codex_storyboard_package_changed_during_validation".to_string());
    }
    Ok(())
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

fn write_import_ledger_create_new_at(
    directory: &CapabilityDir,
    path: &Path,
    receipt: &CodexStoryboardImportReceipt,
) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(receipt)
        .map_err(|_| "codex_storyboard_authority_invalid".to_string())?;
    match publish_bytes_at(directory, path, &bytes, "codex_storyboard_result_already_imported") {
        Ok(()) => Ok(()),
        Err(error) if error == "codex_storyboard_result_already_imported" => {
            let mut existing = directory.open(path).map_err(|_| "codex_storyboard_authority_invalid".to_string())?;
            let metadata = existing.metadata().map_err(|_| "codex_storyboard_authority_invalid".to_string())?;
            if metadata.len() > MAX_IMAGE_BYTES as u64 { return Err("codex_storyboard_authority_invalid".to_string()); }
            let mut existing_bytes = Vec::with_capacity(metadata.len() as usize);
            existing.read_to_end(&mut existing_bytes).map_err(|_| "codex_storyboard_authority_invalid".to_string())?;
            return if existing_bytes == bytes { Ok(()) } else { Err("codex_storyboard_authority_invalid".to_string()) };
        }
        Err(_) => Err("codex_storyboard_authority_invalid".to_string()),
    }
}

fn revalidate_reference_snapshot_files(
    inputs_capability: &CapabilityDir,
    inputs: &StableDirectory,
    snapshots: &[(StableFile, PathBuf)],
) -> Result<(), String> {
    for (snapshot, path) in snapshots {
        revalidate_stable_file_at(
            snapshot,
            inputs_capability,
            inputs,
            path,
            "codex_storyboard_reference_changed_during_validation",
        )?;
    }
    Ok(())
}

fn import_at_roots(
    project: &Path,
    assets: &Path,
    authority: &Path,
    request: ImportCodexStoryboardResultRequest,
) -> Result<CodexStoryboardImportReceipt, String> {
    import_at_roots_inner(project, assets, authority, request, || {}, || {}, || Ok(()), || {})
}

#[cfg(test)]
fn import_at_roots_with_candidate_hook<F: FnOnce()>(
    project: &Path,
    assets: &Path,
    authority: &Path,
    request: ImportCodexStoryboardResultRequest,
    after_candidate_read: F,
) -> Result<CodexStoryboardImportReceipt, String> {
    import_at_roots_inner(
        project,
        assets,
        authority,
        request,
        after_candidate_read,
        || {},
        || Ok(()),
        || {},
    )
}

#[cfg(test)]
fn import_at_roots_with_reference_hooks<B: FnOnce(), A: FnOnce()>(
    project: &Path,
    assets: &Path,
    authority: &Path,
    request: ImportCodexStoryboardResultRequest,
    before_ledger: B,
    after_ledger: A,
) -> Result<CodexStoryboardImportReceipt, String> {
    import_at_roots_inner(
        project,
        assets,
        authority,
        request,
        || {},
        before_ledger,
        || Ok(()),
        after_ledger,
    )
}

#[cfg(test)]
fn import_at_roots_with_layout_hooks<B: FnOnce(), A: FnOnce()>(
    project: &Path,
    assets: &Path,
    authority: &Path,
    request: ImportCodexStoryboardResultRequest,
    before_ledger: B,
    after_ledger: A,
) -> Result<CodexStoryboardImportReceipt, String> {
    import_at_roots_inner(
        project,
        assets,
        authority,
        request,
        || {},
        before_ledger,
        || Ok(()),
        after_ledger,
    )
}

#[cfg(test)]
fn import_at_roots_with_lifecycle_commit_hook<L: FnOnce() -> Result<(), String>>(
    project: &Path,
    assets: &Path,
    authority: &Path,
    request: ImportCodexStoryboardResultRequest,
    after_lifecycle_commit: L,
) -> Result<CodexStoryboardImportReceipt, String> {
    import_at_roots_inner(project, assets, authority, request, || {}, || {}, after_lifecycle_commit, || {})
}

fn import_at_roots_inner<C: FnOnce(), B: FnOnce(), L: FnOnce() -> Result<(), String>, A: FnOnce()>(
    project: &Path,
    assets: &Path,
    authority: &Path,
    request: ImportCodexStoryboardResultRequest,
    after_candidate_read: C,
    before_ledger: B,
    after_lifecycle_commit: L,
    after_ledger: A,
) -> Result<CodexStoryboardImportReceipt, String> {
    validate_import_request(&request)?;
    let (project, assets) = ensure_child_root(project, assets)?;
    let authority = canonical_authority_root(authority)?;
    let project_root =
        capture_stable_directory(&project, "codex_storyboard_project_root_invalid")?;
    let assets_root = capture_stable_directory(
        &assets,
        "codex_storyboard_assets_root_outside_project",
    )?;
    let authority_root =
        capture_stable_directory(&authority, "codex_storyboard_authority_invalid")?;
    let project_capability =
        open_capability_directory(&project, "codex_storyboard_project_root_invalid")?;
    let assets_capability = if assets == project {
        project_capability
            .try_clone()
            .map_err(|_| "codex_storyboard_assets_root_outside_project".to_string())?
    } else {
        let relative = assets
            .strip_prefix(&project)
            .map_err(|_| "codex_storyboard_assets_root_outside_project".to_string())?;
        open_capability_child(
            &project_capability,
            relative,
            "codex_storyboard_assets_root_outside_project",
        )?
    };
    let authority_capability =
        open_capability_directory(&authority, "codex_storyboard_authority_invalid")?;
    bind_capability_directory(
        &project_capability,
        &project_root,
        "codex_storyboard_project_root_invalid",
    )?;
    bind_capability_directory(
        &assets_capability,
        &assets_root,
        "codex_storyboard_assets_root_outside_project",
    )?;
    bind_capability_directory(
        &authority_capability,
        &authority_root,
        "codex_storyboard_authority_invalid",
    )?;
    let requested_project = fs::canonicalize(Path::new(&request.project_path))
        .map_err(|_| "codex_storyboard_project_path_invalid".to_string())?;
    if requested_project != project {
        return Err("codex_storyboard_project_identity_mismatch".to_string());
    }
    let layout = validate_package_layout(&project, &request.job_id)?;
    let import_layout = capture_import_layout(&project, &layout)?;
    let jobs_capability = open_capability_child(
        &project_capability,
        Path::new("codex-storyboard-jobs"),
        "codex_storyboard_package_changed_during_validation",
    )?;
    let package_capability = open_capability_child(
        &jobs_capability,
        Path::new(&request.job_id),
        "codex_storyboard_package_changed_during_validation",
    )?;
    let inputs_capability = open_capability_child(
        &package_capability,
        Path::new("inputs"),
        "codex_storyboard_package_changed_during_validation",
    )?;
    let outputs_capability = open_capability_child(
        &package_capability,
        Path::new("outputs"),
        "codex_storyboard_package_changed_during_validation",
    )?;
    bind_capability_directory(
        &jobs_capability,
        &import_layout.jobs,
        "codex_storyboard_package_changed_during_validation",
    )?;
    bind_capability_directory(
        &package_capability,
        &import_layout.package,
        "codex_storyboard_package_changed_during_validation",
    )?;
    bind_capability_directory(
        &inputs_capability,
        &import_layout.inputs,
        "codex_storyboard_package_changed_during_validation",
    )?;
    bind_capability_directory(
        &outputs_capability,
        &import_layout.outputs,
        "codex_storyboard_package_changed_during_validation",
    )?;
    assets_capability
        .dir_metadata()
        .map_err(|_| "codex_storyboard_assets_root_outside_project".to_string())?;

    let authority_key = project_authority_key(&project, &request.project_id)?;
    let exports_capability = open_capability_child(
        &authority_capability,
        Path::new("exports"),
        "codex_storyboard_authority_invalid",
    )?;
    let export_project_capability = open_capability_child(
        &exports_capability,
        Path::new(&authority_key),
        "codex_storyboard_authority_invalid",
    )?;
    let export_project_path = authority.join("exports").join(&authority_key);
    let export_project_root =
        capture_stable_directory(&export_project_path, "codex_storyboard_authority_invalid")?;
    let authority_record_name = PathBuf::from(format!("{}.json", request.job_id));
    let (authority_record, authority_stable): (CodexStoryboardAuthorityRecord, StableFile) =
        parse_stable_json_at(
            &export_project_capability,
            &export_project_root,
            &authority_record_name,
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

    let ready_name = PathBuf::from(format!("{}.ready.json", request.job_id));
    let (ready_record, ready_stable): (CodexStoryboardReadyRecord, StableFile) =
        parse_stable_json_at(
            &export_project_capability,
            &export_project_root,
            &ready_name,
            "codex_storyboard_package_not_ready",
        )?;
    if ready_record.schema_version != 1
        || ready_record.canonical_project_path != project.to_string_lossy()
        || ready_record.project_id != request.project_id
        || ready_record.job_id != request.job_id
        || ready_record.request_digest != authority_record.request_digest
        || ready_record.canonical_package_path != layout.package.to_string_lossy()
        || ready_record.package_identity_a != import_layout.package.identity_a
        || ready_record.package_identity_b != import_layout.package.identity_b
        || ready_record.package_attributes != import_layout.package.attributes
    {
        return Err("codex_storyboard_package_not_ready".to_string());
    }

    let request_relative = Path::new("request.json");
    let (immutable, immutable_stable): (CodexStoryboardRequest, StableFile) =
        parse_stable_json_at(
            &package_capability,
            &import_layout.package,
            request_relative,
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
    let canonical_request = canonical_request_bytes(&immutable)?;
    let canonical_request_digest = sha256_bytes(&canonical_request);
    if canonical_request_digest != authority_record.request_digest {
        return Err("codex_storyboard_request_digest_mismatch".to_string());
    }
    let (lifecycle_capability, lifecycle_path) = lifecycle_job_capability(
        &authority_capability,
        &authority,
        &project,
        &request.project_id,
        &request.job_id,
        false,
    )?;
    let lifecycle = read_lifecycle_record(&lifecycle_capability, &lifecycle_path)?;
    if lifecycle.project_id != request.project_id || lifecycle.episode_id != request.episode_id || lifecycle.shot_id != request.shot_id || lifecycle.job_id != request.job_id || lifecycle.request_digest != canonical_request_digest {
        return Err("codex_storyboard_lifecycle_invalid".to_string());
    }
    let lifecycle_already_committed = lifecycle.state == "needs_review";
    if lifecycle.state != "queued" && !lifecycle_already_committed {
        return Err(match lifecycle.state.as_str() {
            "cancelled" => "codex_storyboard_task_cancelled",
            "rejected" => "codex_storyboard_task_rejected",
            "accepted" => "codex_storyboard_task_already_accepted",
            _ => "codex_storyboard_lifecycle_conflict",
        }.to_string());
    }
    if immutable_stable.bytes != canonical_request
        || canonical_request_digest != ready_record.request_sha256
        || immutable_stable.fingerprint.identity_a != ready_record.request_identity_a
        || immutable_stable.fingerprint.identity_b != ready_record.request_identity_b
        || immutable_stable.fingerprint.len != ready_record.request_len
        || immutable_stable.fingerprint.created_nanos != ready_record.request_created_nanos
        || immutable_stable.fingerprint.modified_nanos != ready_record.request_modified_nanos
        || immutable_stable.fingerprint.attributes != ready_record.request_attributes
    {
        return Err("codex_storyboard_package_not_ready".to_string());
    }
    let mut reference_snapshots = Vec::with_capacity(immutable.references.len());
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
        let relative_inside_inputs = Path::new(relative_inside_inputs);
        let raw = layout.inputs.join(relative_inside_inputs);
        let snapshot = read_stable_file_at(
            &inputs_capability,
            &import_layout.inputs,
            relative_inside_inputs,
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
        reference_snapshots.push((snapshot, relative_inside_inputs.to_path_buf()));
    }

    let result_path = layout.outputs.join("result.json");
    let result_relative = Path::new("result.json");
    let (result, result_stable): (CodexStoryboardResult, StableFile) =
        parse_stable_json_at(
            &outputs_capability,
            &import_layout.outputs,
            result_relative,
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
        || result.final_prompt != compiled_prompt(&immutable)?
        || !valid_rfc3339_utc(&result.completed_at)
        || result.output.relative_path != "outputs/candidate.png"
        || result.output.mime_type != "image/png"
    {
        return Err("codex_storyboard_result_invalid".to_string());
    }

    let candidate_relative = Path::new("candidate.png");
    let candidate = read_stable_file_at(
        &outputs_capability,
        &import_layout.outputs,
        candidate_relative,
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
    let result_file_digest = sha256_bytes(&result_stable.bytes);
    let candidate_file_digest = sha256_bytes(&candidate.bytes);
    if lifecycle_already_committed
        && (lifecycle.result_digest.as_deref() != Some(&result_file_digest)
            || lifecycle.candidate_digest.as_deref() != Some(&candidate_file_digest))
    {
        return Err("codex_storyboard_lifecycle_conflict".to_string());
    }

    after_candidate_read();
    before_ledger();
    revalidate_import_layout(&project, &import_layout)?;
    revalidate_reference_snapshot_files(
        &inputs_capability,
        &import_layout.inputs,
        &reference_snapshots,
    )?;
    revalidate_stable_file_at(
        &candidate,
        &outputs_capability,
        &import_layout.outputs,
        candidate_relative,
        "codex_storyboard_candidate_changed_during_validation",
    )?;
    revalidate_stable_file_at(
        &result_stable,
        &outputs_capability,
        &import_layout.outputs,
        result_relative,
        "codex_storyboard_result_changed_during_validation",
    )?;
    revalidate_stable_file_at(
        &immutable_stable,
        &package_capability,
        &import_layout.package,
        request_relative,
        "codex_storyboard_request_changed_during_validation",
    )?;
    revalidate_stable_file_at(
        &authority_stable,
        &export_project_capability,
        &export_project_root,
        &authority_record_name,
        "codex_storyboard_authority_invalid",
    )?;
    revalidate_stable_file_at(
        &ready_stable,
        &export_project_capability,
        &export_project_root,
        &ready_name,
        "codex_storyboard_package_not_ready",
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
    let imports_capability = ensure_capability_child(
        &authority_capability,
        Path::new("imports"),
        "codex_storyboard_authority_invalid",
    )?;
    let import_project_capability = ensure_capability_child(
        &imports_capability,
        Path::new(&authority_key),
        "codex_storyboard_authority_invalid",
    )?;
    let ledger_name = PathBuf::from(format!(
        "{}-{}.json",
        request.job_id, authority_record.request_digest
    ));
    if !lifecycle_already_committed {
        cas_lifecycle_transition_bound(
            &lifecycle_capability,
            &lifecycle_path,
            "queued",
            "needs_review",
            Some(&result_file_digest),
            Some(&candidate_file_digest),
        )?;
    }
    after_lifecycle_commit()?;
    write_import_ledger_create_new_at(&import_project_capability, &ledger_name, &receipt)?;
    after_ledger();
    revalidate_import_layout(&project, &import_layout)?;
    revalidate_reference_snapshot_files(
        &inputs_capability,
        &import_layout.inputs,
        &reference_snapshots,
    )?;
    let _ = publish_json_at(
        &outputs_capability,
        Path::new("import-receipt.json"),
        &receipt,
        "codex_storyboard_package_audit_exists",
    );

    // Lifecycle evidence is the authoritative commit. Revalidate after the
    // idempotent audit-ledger publication so recovery never accepts changed bytes.
    revalidate_stable_file_at(
        &candidate,
        &outputs_capability,
        &import_layout.outputs,
        candidate_relative,
        "codex_storyboard_candidate_changed_during_validation",
    )?;
    revalidate_stable_file_at(
        &result_stable,
        &outputs_capability,
        &import_layout.outputs,
        result_relative,
        "codex_storyboard_result_changed_during_validation",
    )?;
    revalidate_stable_file_at(
        &immutable_stable,
        &package_capability,
        &import_layout.package,
        request_relative,
        "codex_storyboard_request_changed_during_validation",
    )?;
    revalidate_stable_file_at(
        &authority_stable,
        &export_project_capability,
        &export_project_root,
        &authority_record_name,
        "codex_storyboard_authority_invalid",
    )?;
    revalidate_stable_file_at(
        &ready_stable,
        &export_project_capability,
        &export_project_root,
        &ready_name,
        "codex_storyboard_package_not_ready",
    )?;
    revalidate_reference_snapshot_files(
        &inputs_capability,
        &import_layout.inputs,
        &reference_snapshots,
    )?;
    revalidate_import_layout(&project, &import_layout)?;
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
    let app_data_root =
        capture_stable_directory(&app_data, "codex_storyboard_authority_invalid")?;
    let app_data_capability =
        open_capability_directory(&app_data, "codex_storyboard_authority_invalid")?;
    bind_capability_directory(
        &app_data_capability,
        &app_data_root,
        "codex_storyboard_authority_invalid",
    )?;
    let authority_capability = ensure_capability_child(
        &app_data_capability,
        Path::new("codex-storyboard-authority"),
        "codex_storyboard_authority_invalid",
    )?;
    let authority = app_data.join("codex-storyboard-authority");
    let authority_root =
        capture_stable_directory(&authority, "codex_storyboard_authority_invalid")?;
    bind_capability_directory(
        &authority_capability,
        &authority_root,
        "codex_storyboard_authority_invalid",
    )?;
    Ok(authority_root.canonical_path)
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

fn transition_at_roots(
    project: &Path,
    authority: &Path,
    request: TransitionCodexStoryboardLifecycleRequest,
) -> Result<CodexStoryboardLifecycleReceipt, String> {
    if request.schema_version != 1 || request.provider != PROVIDER || !valid_identifier(&request.job_id, 96) || !valid_identifier(&request.project_id, 96) || !valid_identifier(&request.episode_id, 96) || !valid_identifier(&request.shot_id, 96) {
        return Err("codex_storyboard_import_identity_invalid".to_string());
    }
    let project = canonical_directory(project, "codex_storyboard_project_root_invalid")?;
    let requested = fs::canonicalize(&request.project_path).map_err(|_| "codex_storyboard_project_path_invalid".to_string())?;
    if requested != project { return Err("codex_storyboard_project_identity_mismatch".to_string()); }
    let authority = canonical_authority_root(authority)?;
    let authority_root = capture_stable_directory(&authority, "codex_storyboard_authority_invalid")?;
    let authority_capability = open_capability_directory(&authority, "codex_storyboard_authority_invalid")?;
    bind_capability_directory(&authority_capability, &authority_root, "codex_storyboard_authority_invalid")?;
    let key = project_authority_key(&project, &request.project_id)?;
    let exports = open_capability_child(&authority_capability, Path::new("exports"), "codex_storyboard_authority_invalid")?;
    let export_project = open_capability_child(&exports, Path::new(&key), "codex_storyboard_authority_invalid")?;
    let export_path = authority.join("exports").join(&key);
    let export_root = capture_stable_directory(&export_path, "codex_storyboard_authority_invalid")?;
    let authority_record: CodexStoryboardAuthorityRecord = parse_stable_json_at(&export_project, &export_root, Path::new(&format!("{}.json", request.job_id)), "codex_storyboard_authority_invalid")?.0;
    if authority_record.project_id != request.project_id || authority_record.job_id != request.job_id || authority_record.canonical_project_path != project.to_string_lossy() {
        return Err("codex_storyboard_authority_mismatch".to_string());
    }
    let (lifecycle_capability, lifecycle_path) = lifecycle_job_capability(&authority_capability, &authority, &project, &request.project_id, &request.job_id, false)?;
    let current = read_lifecycle_record(&lifecycle_capability, &lifecycle_path)?;
    if current.project_id != request.project_id || current.episode_id != request.episode_id || current.shot_id != request.shot_id || current.job_id != request.job_id || current.request_digest != authority_record.request_digest {
        return Err("codex_storyboard_lifecycle_invalid".to_string());
    }
    let next = cas_lifecycle_transition(&lifecycle_capability, &lifecycle_path, &request.expected_state, &request.next_state)?;
    Ok(CodexStoryboardLifecycleReceipt { schema_version: 1, job_id: request.job_id, state: next.state, version: next.version })
}

#[tauri::command]
pub fn transition_codex_storyboard_lifecycle(
    app: tauri::AppHandle,
    request: TransitionCodexStoryboardLifecycleRequest,
) -> Result<CodexStoryboardLifecycleReceipt, String> {
    let project = active_project_path(&app, &request.project_path)?;
    let authority = app_authority_root(&app)?;
    transition_at_roots(&project, &authority, request)
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{ImageBuffer, Rgb, Rgba};
    use serde_json::{json, Value};
    use sha2::{Digest, Sha256};
    use std::cell::Cell;
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

    #[cfg(unix)]
    fn create_test_directory_link(target: &Path, link: &Path) -> bool {
        std::os::unix::fs::symlink(target, link).is_ok()
    }

    #[cfg(windows)]
    fn create_test_directory_link(target: &Path, link: &Path) -> bool {
        std::process::Command::new("cmd")
            .args([
                "/c",
                "mklink",
                "/J",
                &link.to_string_lossy(),
                &target.to_string_lossy(),
            ])
            .output()
            .map(|output| output.status.success())
            .unwrap_or(false)
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
        let typed_request: CodexStoryboardRequest = serde_json::from_value(request.clone()).unwrap();
        let final_prompt = compiled_prompt(&typed_request).unwrap();
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
            "finalPrompt": final_prompt,
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

    fn clone_tree_with_hardlinks(source: &Path, destination: &Path) {
        fs::create_dir(destination).unwrap();
        for entry in fs::read_dir(source).unwrap() {
            let entry = entry.unwrap();
            let source_path = entry.path();
            let destination_path = destination.join(entry.file_name());
            if entry.file_type().unwrap().is_dir() {
                clone_tree_with_hardlinks(&source_path, &destination_path);
            } else {
                fs::hard_link(&source_path, &destination_path).unwrap();
            }
        }
    }

    fn replace_tree_with_hardlinks(path: &Path, displaced: &Path) -> bool {
        if let Err(error) = fs::rename(path, displaced) {
            eprintln!(
                "SKIP: retained directory handle prevented path replacement: {error}"
            );
            return false;
        }
        clone_tree_with_hardlinks(displaced, path);
        true
    }

    fn import_request(fixture: &Fixture, task_status: &str) -> ImportCodexStoryboardResultRequest {
        if task_status == "cancelled" {
            transition_at_roots(&fixture.project, &fixture.authority, TransitionCodexStoryboardLifecycleRequest {
                schema_version: 1,
                job_id: fixture.request.job_id.clone(),
                project_id: fixture.request.project_id.clone(),
                episode_id: fixture.request.episode_id.clone(),
                shot_id: fixture.request.shot_id.clone(),
                provider: PROVIDER.to_string(),
                project_path: fixture.project.to_string_lossy().to_string(),
                expected_state: "queued".to_string(),
                next_state: "cancelled".to_string(),
            }).unwrap();
        }
        ImportCodexStoryboardResultRequest {
            schema_version: 1,
            job_id: fixture.request.job_id.clone(),
            project_id: fixture.request.project_id.clone(),
            episode_id: fixture.request.episode_id.clone(),
            shot_id: fixture.request.shot_id.clone(),
            provider: fixture.request.provider.clone(),
            project_path: fixture.request.project_path.clone(),
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
        let replay = import_at_roots(
                &fixture.project,
                &fixture.assets,
                &fixture.authority,
                import_request(&fixture, "queued"),
            ).unwrap();
        assert_eq!(replay.result.request_digest, imported.result.request_digest);
        assert_eq!(replay.candidate_path, imported.candidate_path);
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
    fn prepare_rejects_replaced_inputs_root_without_publishing_request() {
        let fixture = fixture("prepare-layout-replaced");
        let package = fixture
            .project
            .join("codex-storyboard-jobs")
            .join(&fixture.request.job_id);
        let inputs = package.join("inputs");
        let displaced = package.join("inputs-displaced");
        let swapped = Cell::new(false);
        let result = prepare_at_roots_with_layout_hook(
            &fixture.project,
            &fixture.assets,
            &fixture.authority,
            fixture.request.clone(),
            || {
                if fs::rename(&inputs, &displaced).is_ok() {
                    swapped.set(true);
                    fs::create_dir(&inputs).unwrap();
                }
            },
        );
        if swapped.get() {
            assert_eq!(
                result.unwrap_err(),
                "codex_storyboard_prepare_layout_changed"
            );
            assert!(!package.join("request.json").exists());
        } else {
            eprintln!("SKIP swap branch: retained Windows directory handle denied rename");
            assert_eq!(result.unwrap().status, "exported");
            assert!(package.join("request.json").is_file());
        }
    }

    #[test]
    fn prepare_rejects_authority_root_replacement_before_capability_open() {
        let fixture = fixture("authority-root-replaced");
        let displaced = fixture.authority.with_file_name("authority-root-displaced");
        let authority = fixture.authority.clone();
        let result = prepare_at_roots_with_authority_open_hook(
            &fixture.project,
            &fixture.assets,
            &fixture.authority,
            fixture.request.clone(),
            || {
                fs::rename(&authority, &displaced).unwrap();
                fs::create_dir(&authority).unwrap();
            },
        );
        assert_eq!(result.unwrap_err(), "codex_storyboard_authority_invalid");
        assert_eq!(fs::read_dir(&authority).unwrap().count(), 0);
        assert_eq!(fs::read_dir(&displaced).unwrap().count(), 0);
    }

    #[test]
    fn prepare_rejects_authority_root_replacement_before_first_authority_publish() {
        let fixture = fixture("authority-root-first-publish-replaced");
        let displaced = fixture.authority.with_file_name("authority-root-first-publish-displaced");
        let authority = fixture.authority.clone();
        let authority_key = project_authority_key(&fixture.project, &fixture.request.project_id).unwrap();
        let swapped = Cell::new(false);
        let result = prepare_at_roots_with_layout_hook(
            &fixture.project,
            &fixture.assets,
            &fixture.authority,
            fixture.request.clone(),
            || {
                if fs::rename(&authority, &displaced).is_ok() {
                    swapped.set(true);
                    fs::create_dir(&authority).unwrap();
                }
            },
        );
        if swapped.get() {
            assert_eq!(result.unwrap_err(), "codex_storyboard_authority_invalid");
            assert_eq!(fs::read_dir(&authority).unwrap().count(), 0);
            assert!(!displaced
                .join("exports")
                .join(authority_key)
                .join(format!("{}.json", fixture.request.job_id))
                .exists());
            assert!(!displaced
                .join("exports")
                .join(project_authority_key(&fixture.project, &fixture.request.project_id).unwrap())
                .join(format!("{}.ready.json", fixture.request.job_id))
                .exists());
        } else {
            eprintln!("SKIP swap branch: retained authority handle denied rename");
            assert_eq!(result.unwrap().status, "exported");
        }
    }

    #[test]
    fn fixed_root_read_rejects_instant_external_junction_even_when_root_is_restored() {
        let fixture = fixture("fixed-root-instant-junction");
        let fixed_root = capture_stable_directory(
            &fixture.assets,
            "codex_storyboard_reference_changed_during_copy",
        )
        .unwrap();
        let displaced = fixture.project.join("assets-displaced");
        let outside = unique_root("fixed-root-external");
        fs::create_dir_all(&outside).unwrap();
        write_png(&outside.join("spatial.png"), [71, 72, 73, 255]);
        let source = fixture.assets.join("spatial.png");
        fs::rename(&fixture.assets, &displaced).unwrap();
        if !create_test_directory_link(&outside, &fixture.assets) {
            fs::rename(&displaced, &fixture.assets).unwrap();
            eprintln!("SKIP: directory junction/symlink creation unavailable");
            return;
        }
        fs::remove_dir(&fixture.assets).unwrap();
        fs::rename(&displaced, &fixture.assets).unwrap();

        let result = read_stable_file_within_fixed_root_with_hooks(
            &fixed_root,
            &source,
            "codex_storyboard_reference_changed_during_copy",
            || {
                fs::rename(&fixture.assets, &displaced).unwrap();
                assert!(create_test_directory_link(&outside, &fixture.assets));
            },
            || {
                fs::remove_dir(&fixture.assets).unwrap();
                fs::rename(&displaced, &fixture.assets).unwrap();
            },
        );
        assert_eq!(
            result.unwrap_err(),
            "codex_storyboard_reference_changed_during_copy"
        );
    }

    #[test]
    fn capability_relative_snapshot_create_ignores_replaced_path_name() {
        let root = unique_root("cap-snapshot-create");
        let trusted = root.join("inputs");
        let displaced = root.join("inputs-displaced");
        fs::create_dir_all(&trusted).unwrap();
        let capability = open_capability_directory(
            &trusted,
            "codex_storyboard_snapshot_write_failed",
        )
        .unwrap();
        let swapped = Cell::new(false);
        let external = root.join("external-sentinel");
        fs::create_dir(&external).unwrap();
        fs::write(external.join("sentinel"), b"external").unwrap();
        write_bytes_create_new_at_with_hook(
            &capability,
            Path::new("01-spatial-authority.png"),
            b"stable snapshot bytes",
            "codex_storyboard_snapshot_write_failed",
            || {
                if fs::rename(&trusted, &displaced).is_ok() {
                    swapped.set(true);
                    fs::create_dir(&trusted).unwrap();
                    fs::write(trusted.join("sentinel"), b"external").unwrap();
                }
            },
        )
        .unwrap();
        assert_eq!(fs::read(external.join("sentinel")).unwrap(), b"external");
        assert_eq!(fs::read_dir(&external).unwrap().count(), 1);
        if swapped.get() {
            assert_eq!(fs::read(trusted.join("sentinel")).unwrap(), b"external");
            assert!(!trusted.join("01-spatial-authority.png").exists());
            assert_eq!(
                fs::read(displaced.join("01-spatial-authority.png")).unwrap(),
                b"stable snapshot bytes"
            );
        } else {
            eprintln!("SKIP swap branch: retained Windows directory handle denied rename");
            assert_eq!(
                fs::read(trusted.join("01-spatial-authority.png")).unwrap(),
                b"stable snapshot bytes"
            );
        }
    }

    #[test]
    fn capability_relative_publication_keeps_temp_and_final_out_of_replacement() {
        let root = unique_root("cap-request-publish");
        let trusted = root.join("package");
        let displaced = root.join("package-displaced");
        fs::create_dir_all(&trusted).unwrap();
        let capability = open_capability_directory(
            &trusted,
            "codex_storyboard_publish_failed",
        )
        .unwrap();
        let swapped = Cell::new(false);
        let external = root.join("external-sentinel");
        fs::create_dir(&external).unwrap();
        fs::write(external.join("sentinel"), b"external").unwrap();
        publish_bytes_at_with_hooks(
            &capability,
            Path::new("request.json"),
            b"canonical request bytes",
            "codex_storyboard_request_exists",
            || {
                if fs::rename(&trusted, &displaced).is_ok() {
                    swapped.set(true);
                    fs::create_dir(&trusted).unwrap();
                    fs::write(trusted.join("sentinel"), b"external").unwrap();
                }
            },
            || {},
        )
        .unwrap();
        assert_eq!(fs::read(external.join("sentinel")).unwrap(), b"external");
        assert_eq!(fs::read_dir(&external).unwrap().count(), 1);
        let authority_dir = if swapped.get() { &displaced } else { &trusted };
        if swapped.get() {
            assert_eq!(fs::read(trusted.join("sentinel")).unwrap(), b"external");
            assert_eq!(fs::read_dir(&trusted).unwrap().count(), 1);
        } else {
            eprintln!("SKIP swap branch: retained Windows directory handle denied rename");
        }
        assert_eq!(
            fs::read(authority_dir.join("request.json")).unwrap(),
            b"canonical request bytes"
        );
        assert!(fs::read_dir(authority_dir)
            .unwrap()
            .all(|entry| !entry.unwrap().file_name().to_string_lossy().contains(".tmp-")));
    }

    #[test]
    fn postpublish_package_swap_keeps_untrusted_request_and_never_marks_ready() {
        let fixture = fixture("postpublish-package-swap");
        let package = fixture
            .project
            .join("codex-storyboard-jobs")
            .join(&fixture.request.job_id);
        let displaced = fixture
            .project
            .join("codex-storyboard-jobs")
            .join("postpublish-displaced");
        let sentinel = b"untrusted replacement request";
        let swapped = Cell::new(false);
        let result = prepare_at_roots_with_publish_hooks(
            &fixture.project,
            &fixture.assets,
            &fixture.authority,
            fixture.request.clone(),
            || {},
            || {
                if fs::rename(&package, &displaced).is_ok() {
                    swapped.set(true);
                    fs::create_dir(&package).unwrap();
                    fs::write(package.join("request.json"), sentinel).unwrap();
                }
            },
        );
        let ready = authority_ready_marker_path(
            &fixture.authority,
            &fixture.project,
            &fixture.request.project_id,
            &fixture.request.job_id,
        )
        .unwrap();
        if swapped.get() {
            assert_eq!(
                result.unwrap_err(),
                "codex_storyboard_prepare_layout_changed"
            );
            assert_eq!(fs::read(package.join("request.json")).unwrap(), sentinel);
            assert!(!ready.exists());
        } else {
            eprintln!("SKIP swap branch: retained Windows directory handle denied rename");
            assert_eq!(result.unwrap().status, "exported");
            assert!(ready.is_file());
        }
    }

    #[test]
    fn import_requires_private_ready_marker_and_normal_ready_package_imports() {
        let fixture = fixture("ready-gate");
        let receipt = prepare_at_roots(
            &fixture.project,
            &fixture.assets,
            &fixture.authority,
            fixture.request.clone(),
        )
        .unwrap();
        let ready = authority_ready_marker_path(
            &fixture.authority,
            &fixture.project,
            &fixture.request.project_id,
            &fixture.request.job_id,
        )
        .unwrap();
        assert!(ready.is_file());
        publish_result(&receipt, |_| {});
        let held_ready = ready.with_extension("held");
        fs::rename(&ready, &held_ready).unwrap();
        assert_eq!(
            import_at_roots(
                &fixture.project,
                &fixture.assets,
                &fixture.authority,
                import_request(&fixture, "queued"),
            )
            .unwrap_err(),
            "codex_storyboard_package_not_ready"
        );
        fs::rename(&held_ready, &ready).unwrap();
        assert_eq!(
            import_at_roots(
                &fixture.project,
                &fixture.assets,
                &fixture.authority,
                import_request(&fixture, "queued"),
            )
            .unwrap()
            .status,
            "needs_review"
        );
    }

    #[test]
    fn request_publication_uses_retained_package_handle_during_instant_swap() {
        let fixture = fixture("request-publish-instant-swap");
        let package = fixture
            .project
            .join("codex-storyboard-jobs")
            .join(&fixture.request.job_id);
        let displaced = fixture
            .project
            .join("codex-storyboard-jobs")
            .join("request-publish-original");
        let untrusted = fixture
            .project
            .join("codex-storyboard-jobs")
            .join("request-publish-untrusted");
        let swapped = Cell::new(false);
        let result = prepare_at_roots_with_request_publish_hooks(
            &fixture.project,
            &fixture.assets,
            &fixture.authority,
            fixture.request.clone(),
            || {
                if fs::rename(&package, &displaced).is_ok() {
                    swapped.set(true);
                    fs::create_dir(&package).unwrap();
                }
            },
            || {
                if swapped.get() {
                    fs::rename(&package, &untrusted).unwrap();
                    fs::rename(&displaced, &package).unwrap();
                }
            },
        );
        assert_eq!(result.unwrap().status, "exported");
        assert!(package.join("request.json").is_file());
        if swapped.get() {
            assert!(!untrusted.join("request.json").exists());
            assert_eq!(fs::read_dir(&untrusted).unwrap().count(), 0);
        } else {
            eprintln!("SKIP swap branch: retained Windows directory handle denied rename");
        }
        assert!(authority_ready_marker_path(
            &fixture.authority,
            &fixture.project,
            &fixture.request.project_id,
            &fixture.request.job_id,
        )
        .unwrap()
        .is_file());
    }

    #[test]
    fn import_rejects_package_and_inputs_identity_changes_before_ledger_cas() {
        for kind in ["package", "inputs"] {
            let fixture = fixture(&format!("import-pre-cas-{kind}"));
            let receipt = prepare_at_roots(
                &fixture.project,
                &fixture.assets,
                &fixture.authority,
                fixture.request.clone(),
            )
            .unwrap();
            publish_result(&receipt, |_| {});
            let package = PathBuf::from(&receipt.package_path);
            let target = if kind == "package" {
                package.clone()
            } else {
                package.join("inputs")
            };
            let displaced = target.with_file_name(format!("{kind}-displaced"));
            let swapped = Cell::new(false);
            let result = import_at_roots_with_layout_hooks(
                &fixture.project,
                &fixture.assets,
                &fixture.authority,
                import_request(&fixture, "queued"),
                || swapped.set(replace_tree_with_hardlinks(&target, &displaced)),
                || {},
            );
            let ledger = authority_import_ledger_path(
                &fixture.authority,
                &fixture.project,
                &fixture.request.project_id,
                &fixture.request.job_id,
                &receipt.request_digest,
            )
            .unwrap();
            if swapped.get() {
                assert_eq!(
                    result.unwrap_err(),
                    "codex_storyboard_package_changed_during_validation"
                );
                assert!(!ledger.exists());
            } else {
                assert_eq!(result.unwrap().status, "needs_review");
                assert!(ledger.is_file());
            }
        }
    }

    #[test]
    fn import_rejects_outputs_identity_change_after_ledger_cas() {
        let fixture = fixture("import-post-cas-outputs");
        let receipt = prepare_at_roots(
            &fixture.project,
            &fixture.assets,
            &fixture.authority,
            fixture.request.clone(),
        )
        .unwrap();
        publish_result(&receipt, |_| {});
        let outputs = PathBuf::from(&receipt.package_path).join("outputs");
        let displaced = PathBuf::from(&receipt.package_path).join("outputs-displaced");
        let swapped = Cell::new(false);
        let result = import_at_roots_with_layout_hooks(
            &fixture.project,
            &fixture.assets,
            &fixture.authority,
            import_request(&fixture, "queued"),
            || {},
            || swapped.set(replace_tree_with_hardlinks(&outputs, &displaced)),
        );
        if swapped.get() {
            assert_eq!(
                result.unwrap_err(),
                "codex_storyboard_package_changed_during_validation"
            );
        } else {
            assert_eq!(result.unwrap().status, "needs_review");
        }
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
    fn import_revalidates_reference_snapshots_before_private_ledger_cas() {
        let fixture = fixture("reference-pre-cas-drift");
        let receipt = prepare_at_roots(
            &fixture.project,
            &fixture.assets,
            &fixture.authority,
            fixture.request.clone(),
        )
        .unwrap();
        publish_result(&receipt, |_| {});
        let snapshot = Path::new(&receipt.package_path).join("inputs/01-spatial-authority.png");
        let result = import_at_roots_with_reference_hooks(
            &fixture.project,
            &fixture.assets,
            &fixture.authority,
            import_request(&fixture, "queued"),
            || write_png(&snapshot, [41, 42, 43, 255]),
            || {},
        );
        assert_eq!(
            result.unwrap_err(),
            "codex_storyboard_reference_changed_during_validation"
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
    fn import_revalidates_reference_snapshots_after_private_ledger_cas() {
        let fixture = fixture("reference-post-cas-drift");
        let receipt = prepare_at_roots(
            &fixture.project,
            &fixture.assets,
            &fixture.authority,
            fixture.request.clone(),
        )
        .unwrap();
        publish_result(&receipt, |_| {});
        let snapshot = Path::new(&receipt.package_path).join("inputs/01-spatial-authority.png");
        let result = import_at_roots_with_reference_hooks(
            &fixture.project,
            &fixture.assets,
            &fixture.authority,
            import_request(&fixture, "queued"),
            || {},
            || write_png(&snapshot, [51, 52, 53, 255]),
        );
        assert_eq!(
            result.unwrap_err(),
            "codex_storyboard_reference_changed_during_validation"
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
    fn concurrent_capability_publish_and_import_have_one_winner() {
        use std::sync::{Arc, Barrier};
        use std::thread;

        let publish_root = unique_root("concurrent-publish");
        fs::create_dir_all(&publish_root).unwrap();
        let final_path = publish_root.join("final.json");
        let capability = open_capability_directory(&publish_root, "capability-open").unwrap();
        let barrier = Arc::new(Barrier::new(8));
        let publish_handles = (0..8)
            .map(|index| {
                let barrier = Arc::clone(&barrier);
                let directory = capability.try_clone().unwrap();
                thread::spawn(move || {
                    barrier.wait();
                    publish_json_at(
                        &directory,
                        Path::new("final.json"),
                        &json!({ "winner": index }),
                        "exists",
                    )
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
        assert!(fs::read_dir(&publish_root).unwrap().all(|entry| {
            !entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .starts_with(".final.json.tmp-")
        }));

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
        assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 8);
        assert!(results.iter().all(|result| result.as_ref().unwrap().result.request_digest == receipt.request_digest));
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
        let replay = import_at_roots(
                &valid_fixture.project,
                &valid_fixture.assets,
                &valid_fixture.authority,
                import_request(&valid_fixture, "queued"),
            ).unwrap();
        assert_eq!(replay.candidate_path, valid_import.candidate_path);
    }

    #[test]
    fn import_recomputes_prompt_and_rejects_invalid_completion_timestamp() {
        for (suffix, mutate) in [
            ("prompt-tamper", "prompt"),
            ("timestamp-tamper", "timestamp"),
        ] {
            let fixture = fixture(suffix);
            let receipt = prepare_at_roots(&fixture.project, &fixture.assets, &fixture.authority, fixture.request.clone()).unwrap();
            publish_result(&receipt, |result| {
                if mutate == "prompt" { result["finalPrompt"] = json!("attacker prompt"); }
                else { result["completedAt"] = json!("2026-02-31T00:00:00.000Z"); }
            });
            assert_eq!(import_at_roots(&fixture.project, &fixture.assets, &fixture.authority, import_request(&fixture, "queued")).unwrap_err(), "codex_storyboard_result_invalid");
        }
    }

    #[test]
    fn private_lifecycle_is_cas_bound_and_renderer_status_is_rejected() {
        let spoof = json!({"schemaVersion":1,"jobId":"job","projectId":"project","episodeId":"episode","shotId":"shot","provider":PROVIDER,"projectPath":"C:/project","taskStatus":"queued"});
        assert!(serde_json::from_value::<ImportCodexStoryboardResultRequest>(spoof).is_err());

        let cancelled = fixture("lifecycle-cancel");
        prepare_at_roots(&cancelled.project, &cancelled.assets, &cancelled.authority, cancelled.request.clone()).unwrap();
        let transition = TransitionCodexStoryboardLifecycleRequest {
            schema_version: 1, job_id: cancelled.request.job_id.clone(), project_id: cancelled.request.project_id.clone(), episode_id: cancelled.request.episode_id.clone(), shot_id: cancelled.request.shot_id.clone(), provider: PROVIDER.to_string(), project_path: cancelled.project.to_string_lossy().to_string(), expected_state: "queued".to_string(), next_state: "cancelled".to_string()
        };
        assert_eq!(transition_at_roots(&cancelled.project, &cancelled.authority, transition.clone()).unwrap().state, "cancelled");
        assert_eq!(transition_at_roots(&cancelled.project, &cancelled.authority, transition).unwrap().state, "cancelled");

        let rejected = fixture("lifecycle-reject");
        let receipt = prepare_at_roots(&rejected.project, &rejected.assets, &rejected.authority, rejected.request.clone()).unwrap();
        publish_result(&receipt, |_| {});
        import_at_roots(&rejected.project, &rejected.assets, &rejected.authority, import_request(&rejected, "queued")).unwrap();
        let rejection = TransitionCodexStoryboardLifecycleRequest {
            schema_version: 1, job_id: rejected.request.job_id.clone(), project_id: rejected.request.project_id.clone(), episode_id: rejected.request.episode_id.clone(), shot_id: rejected.request.shot_id.clone(), provider: PROVIDER.to_string(), project_path: rejected.project.to_string_lossy().to_string(), expected_state: "needs_review".to_string(), next_state: "rejected".to_string()
        };
        assert_eq!(transition_at_roots(&rejected.project, &rejected.authority, rejection.clone()).unwrap().state, "rejected");
        assert_eq!(transition_at_roots(&rejected.project, &rejected.authority, rejection).unwrap().state, "rejected");

        let accepted = fixture("lifecycle-accept");
        let receipt = prepare_at_roots(&accepted.project, &accepted.assets, &accepted.authority, accepted.request.clone()).unwrap();
        publish_result(&receipt, |_| {});
        import_at_roots(&accepted.project, &accepted.assets, &accepted.authority, import_request(&accepted, "queued")).unwrap();
        let acceptance = TransitionCodexStoryboardLifecycleRequest {
            schema_version: 1, job_id: accepted.request.job_id.clone(), project_id: accepted.request.project_id.clone(), episode_id: accepted.request.episode_id.clone(), shot_id: accepted.request.shot_id.clone(), provider: PROVIDER.to_string(), project_path: accepted.project.to_string_lossy().to_string(), expected_state: "needs_review".to_string(), next_state: "accepted".to_string()
        };
        assert_eq!(transition_at_roots(&accepted.project, &accepted.authority, acceptance.clone()).unwrap().state, "accepted");
        assert_eq!(transition_at_roots(&accepted.project, &accepted.authority, acceptance).unwrap().state, "accepted");
    }

    #[test]
    fn import_recovers_after_lifecycle_commit_before_replay_ledger() {
        let crash_fixture = fixture("lifecycle-ledger-crash");
        let receipt = prepare_at_roots(&crash_fixture.project, &crash_fixture.assets, &crash_fixture.authority, crash_fixture.request.clone()).unwrap();
        publish_result(&receipt, |_| {});
        assert_eq!(import_at_roots_with_lifecycle_commit_hook(
            &crash_fixture.project, &crash_fixture.assets, &crash_fixture.authority, import_request(&crash_fixture, "queued"),
            || Err("codex_storyboard_test_crash_after_lifecycle".to_string()),
        ).unwrap_err(), "codex_storyboard_test_crash_after_lifecycle");
        let ledger = authority_import_ledger_path(&crash_fixture.authority, &crash_fixture.project, &crash_fixture.request.project_id, &crash_fixture.request.job_id, &receipt.request_digest).unwrap();
        assert!(!ledger.exists());
        let recovered = import_at_roots(&crash_fixture.project, &crash_fixture.assets, &crash_fixture.authority, import_request(&crash_fixture, "queued")).unwrap();
        assert_eq!(recovered.status, "needs_review");
        assert!(ledger.is_file());

        let tampered = fixture("lifecycle-ledger-crash-tampered");
        let tampered_receipt = prepare_at_roots(&tampered.project, &tampered.assets, &tampered.authority, tampered.request.clone()).unwrap();
        publish_result(&tampered_receipt, |_| {});
        assert_eq!(import_at_roots_with_lifecycle_commit_hook(
            &tampered.project, &tampered.assets, &tampered.authority, import_request(&tampered, "queued"),
            || Err("codex_storyboard_test_crash_after_lifecycle".to_string()),
        ).unwrap_err(), "codex_storyboard_test_crash_after_lifecycle");
        let candidate_path = Path::new(&tampered_receipt.package_path).join("outputs/candidate.png");
        write_png(&candidate_path, [99, 88, 77, 255]);
        let result_path = Path::new(&tampered_receipt.package_path).join("outputs/result.json");
        let mut rewritten: Value = serde_json::from_slice(&fs::read(&result_path).unwrap()).unwrap();
        rewritten["output"]["sha256"] = json!(digest(&candidate_path));
        fs::write(&result_path, serde_json::to_vec_pretty(&rewritten).unwrap()).unwrap();
        assert_eq!(import_at_roots(&tampered.project, &tampered.assets, &tampered.authority, import_request(&tampered, "queued")).unwrap_err(), "codex_storyboard_lifecycle_conflict");
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
