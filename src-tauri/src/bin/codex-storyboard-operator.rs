use cap_std::{
    ambient_authority,
    fs::{Dir, OpenOptions},
};
use image::ImageFormat;
use serde_json::{json, Map, Value};
#[path = "../crop_attestation.rs"]
mod crop_attestation;
use crop_attestation::verify_exact_crop_pixels;
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    env, fs,
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    process,
    time::{SystemTime, UNIX_EPOCH},
};

const PROVIDER: &str = "codex_task_package";
const MAX_IMAGE_BYTES: usize = 64 * 1024 * 1024;
const MAX_IMAGE_PIXELS: u64 = 64 * 1024 * 1024;

fn fail<T>(code: &str) -> Result<T, String> {
    Err(code.to_string())
}
fn sha(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn normal(relative: &str) -> bool {
    !relative.is_empty()
        && Path::new(relative)
            .components()
            .all(|c| matches!(c, Component::Normal(_)))
}
fn no_link(metadata: &fs::Metadata) -> bool {
    if metadata.file_type().is_symlink() {
        return false;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            return false;
        }
    }
    true
}
fn cap_no_link(metadata: &cap_std::fs::Metadata) -> bool {
    !metadata.file_type().is_symlink()
}
#[cfg(windows)]
#[repr(C)]
struct FileTime {
    low: u32,
    high: u32,
}
#[cfg(windows)]
#[repr(C)]
struct ByHandleFileInformation {
    attributes: u32,
    creation: FileTime,
    access: FileTime,
    write: FileTime,
    volume_serial: u32,
    size_high: u32,
    size_low: u32,
    links: u32,
    index_high: u32,
    index_low: u32,
}
#[cfg(windows)]
#[link(name = "kernel32")]
unsafe extern "system" {
    fn GetFileInformationByHandle(
        handle: *mut std::ffi::c_void,
        information: *mut ByHandleFileInformation,
    ) -> i32;
}
#[cfg(windows)]
fn raw_handle_identity(handle: *mut std::ffi::c_void) -> Option<(u64, u64)> {
    let mut information = std::mem::MaybeUninit::<ByHandleFileInformation>::uninit();
    let success = unsafe { GetFileInformationByHandle(handle, information.as_mut_ptr()) };
    if success == 0 {
        return None;
    }
    let information = unsafe { information.assume_init() };
    Some((
        information.volume_serial as u64,
        ((information.index_high as u64) << 32) | information.index_low as u64,
    ))
}
#[cfg(windows)]
fn file_identity(file: &fs::File) -> Option<(u64, u64)> {
    use std::os::windows::io::AsRawHandle;
    raw_handle_identity(file.as_raw_handle())
}
#[cfg(windows)]
fn dir_identity(dir: &Dir) -> Option<(u64, u64)> {
    use std::os::windows::io::AsRawHandle;
    raw_handle_identity(dir.as_raw_handle())
}
#[cfg(windows)]
fn open_deny_delete_dir(path: &Path, expected: (u64, u64), code: &str) -> Result<fs::File, String> {
    use std::os::windows::fs::OpenOptionsExt;
    const FILE_SHARE_READ: u32 = 0x0000_0001;
    const FILE_SHARE_WRITE: u32 = 0x0000_0002;
    const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
    const FILE_FLAG_BACKUP_SEMANTICS: u32 = 0x0200_0000;

    check_absolute_components(path, code)?;
    let guard = fs::OpenOptions::new()
        .read(true)
        .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE)
        .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_BACKUP_SEMANTICS)
        .open(path)
        .map_err(|_| code.to_string())?;
    if !guard.metadata().map_err(|_| code.to_string())?.is_dir()
        || file_identity(&guard) != Some(expected)
    {
        return fail(code);
    }
    check_absolute_components(path, code)?;
    Ok(guard)
}
#[cfg(unix)]
fn file_identity(file: &fs::File) -> Option<(u64, u64)> {
    use std::os::unix::fs::MetadataExt;
    let metadata = file.metadata().ok()?;
    Some((metadata.dev(), metadata.ino()))
}
#[cfg(unix)]
fn dir_identity(dir: &Dir) -> Option<(u64, u64)> {
    use cap_std::fs::MetadataExt;
    let metadata = dir.dir_metadata().ok()?;
    Some((metadata.dev(), metadata.ino()))
}
fn check_absolute_components(path: &Path, code: &str) -> Result<(), String> {
    if !path.is_absolute() {
        return fail(code);
    }
    let mut current = PathBuf::new();
    for component in path.components() {
        current.push(component.as_os_str());
        if matches!(component, Component::Prefix(_) | Component::RootDir) {
            continue;
        }
        let metadata = fs::symlink_metadata(&current).map_err(|_| code.to_string())?;
        if !no_link(&metadata) {
            return fail(code);
        }
    }
    Ok(())
}
fn stable_ambient_read(path: &Path, code: &str) -> Result<Vec<u8>, String> {
    check_absolute_components(path, code)?;
    let before = fs::symlink_metadata(path).map_err(|_| code.to_string())?;
    if !before.is_file() || !no_link(&before) {
        return fail(code);
    }
    let mut file = fs::File::open(path).map_err(|_| code.to_string())?;
    let identity = file_identity(&file).ok_or_else(|| code.to_string())?;
    if before.len() > MAX_IMAGE_BYTES as u64 { return fail(code); }
    let mut bytes = Vec::with_capacity(before.len() as usize);
    file.read_to_end(&mut bytes).map_err(|_| code.to_string())?;
    let after = file.metadata().map_err(|_| code.to_string())?;
    let current = fs::File::open(path).map_err(|_| code.to_string())?;
    if file_identity(&file) != Some(identity)
        || file_identity(&current) != Some(identity)
        || before.len() != bytes.len() as u64
        || after.len() != bytes.len() as u64
    {
        return fail(code);
    }
    check_absolute_components(path, code)?;
    Ok(bytes)
}
struct PackageCap {
    path: PathBuf,
    identity: (u64, u64),
    dir: Dir,
    parent_path: PathBuf,
    parent_identity: (u64, u64),
    parent: Dir,
    name: PathBuf,
    #[cfg(windows)]
    _parent_rename_guard: fs::File,
    #[cfg(windows)]
    _package_rename_guard: fs::File,
}
fn open_stable_child_dir(
    parent: &Dir,
    name: &Path,
    expected: Option<(u64, u64)>,
    code: &str,
) -> Result<(Dir, (u64, u64)), String> {
    if name.components().count() != 1
        || !matches!(name.components().next(), Some(Component::Normal(_)))
    {
        return fail(code);
    }
    let before = parent
        .symlink_metadata(name)
        .map_err(|_| code.to_string())?;
    if !before.is_dir() || !cap_no_link(&before) {
        return fail(code);
    }
    let dir = parent.open_dir(name).map_err(|_| code.to_string())?;
    let identity = dir_identity(&dir).ok_or_else(|| code.to_string())?;
    if expected.is_some_and(|value| value != identity) {
        return fail(code);
    }
    let after = parent
        .symlink_metadata(name)
        .map_err(|_| code.to_string())?;
    let current = parent.open_dir(name).map_err(|_| code.to_string())?;
    if !after.is_dir()
        || !cap_no_link(&after)
        || dir_identity(&current) != Some(identity)
        || dir_identity(&dir) != Some(identity)
    {
        return fail(code);
    }
    Ok((dir, identity))
}
fn revalidate_package(package: &PackageCap) -> Result<(), String> {
    let code = "codex_storyboard_operator_package_invalid";
    check_absolute_components(&package.path, code)?;
    if fs::canonicalize(&package.path).map_err(|_| code.to_string())? != package.path {
        return fail(code);
    }
    let current_parent = Dir::open_ambient_dir(&package.parent_path, ambient_authority())
        .map_err(|_| code.to_string())?;
    let (current, _) =
        open_stable_child_dir(&package.parent, &package.name, Some(package.identity), code)?;
    if dir_identity(&current_parent) != Some(package.parent_identity)
        || dir_identity(&package.parent) != Some(package.parent_identity)
        || dir_identity(&current) != Some(package.identity)
        || dir_identity(&package.dir) != Some(package.identity)
    {
        return fail(code);
    }
    Ok(())
}
fn acquire_package(argument: &Path) -> Result<PackageCap, String> {
    let code = "codex_storyboard_operator_package_invalid";
    check_absolute_components(argument, code)?;
    let path = fs::canonicalize(argument).map_err(|_| code.to_string())?;
    check_absolute_components(&path, code)?;
    let metadata = fs::symlink_metadata(&path).map_err(|_| code.to_string())?;
    if !metadata.is_dir() || !no_link(&metadata) {
        return fail(code);
    }
    let captured =
        Dir::open_ambient_dir(&path, ambient_authority()).map_err(|_| code.to_string())?;
    let identity = dir_identity(&captured).ok_or_else(|| code.to_string())?;
    drop(captured);
    if env::var("CODEX_STORYBOARD_TEST_SWAP_PACKAGE_BEFORE_OPEN")
        .ok()
        .as_deref()
        == Some("1")
    {
        let parent = path.parent().ok_or_else(|| code.to_string())?;
        let name = path
            .file_name()
            .and_then(|value| value.to_str())
            .ok_or_else(|| code.to_string())?;
        let backup = parent.join(format!(
            ".{name}.capture-swap-{}-{}",
            process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        fs::rename(&path, &backup).map_err(|_| code.to_string())?;
        let swapped = (|| -> Result<(), String> {
            fs::create_dir(&path).map_err(|_| code.to_string())?;
            let replacement =
                Dir::open_ambient_dir(&path, ambient_authority()).map_err(|_| code.to_string())?;
            if dir_identity(&replacement) == Some(identity) {
                return fail(code);
            }
            drop(replacement);
            Ok(())
        })();
        let _ = fs::remove_dir(&path);
        let restored = fs::rename(&backup, &path);
        if swapped.is_err() || restored.is_err() {
            return fail(code);
        }
        return fail(code);
    }
    let parent_path = path.parent().ok_or_else(|| code.to_string())?.to_path_buf();
    let name = PathBuf::from(path.file_name().ok_or_else(|| code.to_string())?);
    let parent =
        Dir::open_ambient_dir(&parent_path, ambient_authority()).map_err(|_| code.to_string())?;
    let parent_identity = dir_identity(&parent).ok_or_else(|| code.to_string())?;
    let (dir, opened_identity) = open_stable_child_dir(&parent, &name, Some(identity), code)?;
    if opened_identity != identity {
        return fail(code);
    }
    #[cfg(windows)]
    let parent_rename_guard = open_deny_delete_dir(&parent_path, parent_identity, code)?;
    #[cfg(windows)]
    let package_rename_guard = open_deny_delete_dir(&path, identity, code)?;
    let package = PackageCap {
        path,
        identity,
        dir,
        parent_path,
        parent_identity,
        parent,
        name,
        #[cfg(windows)]
        _parent_rename_guard: parent_rename_guard,
        #[cfg(windows)]
        _package_rename_guard: package_rename_guard,
    };
    revalidate_package(&package)?;
    Ok(package)
}
fn check_path_components(root: &Path, relative: &str, code: &str) -> Result<(), String> {
    if !normal(relative) {
        return fail(code);
    }
    let mut current = root.to_path_buf();
    for component in Path::new(relative).components() {
        current.push(component.as_os_str());
        let metadata = fs::symlink_metadata(&current).map_err(|_| code.to_string())?;
        if !no_link(&metadata) {
            return fail(code);
        }
    }
    Ok(())
}
fn stable_read(dir: &Dir, root: &Path, relative: &str, code: &str) -> Result<Vec<u8>, String> {
    check_path_components(root, relative, code)?;
    let metadata = dir
        .symlink_metadata(relative)
        .map_err(|_| code.to_string())?;
    if !metadata.is_file() || !cap_no_link(&metadata) {
        return fail(code);
    }
    let mut file = dir.open(relative).map_err(|_| code.to_string())?.into_std();
    let before = file.metadata().map_err(|_| code.to_string())?;
    if before.len() > MAX_IMAGE_BYTES as u64 { return fail(code); }
    let mut bytes = Vec::with_capacity(before.len() as usize);
    file.read_to_end(&mut bytes).map_err(|_| code.to_string())?;
    let after = file.metadata().map_err(|_| code.to_string())?;
    if before.len() != after.len() || bytes.len() as u64 != after.len() {
        return fail(code);
    }
    let again = dir
        .symlink_metadata(relative)
        .map_err(|_| code.to_string())?;
    if !again.is_file() || !cap_no_link(&again) {
        return fail(code);
    }
    Ok(bytes)
}
fn canonical(value: &Value) -> Value {
    match value {
        Value::Array(items) => Value::Array(items.iter().map(canonical).collect()),
        Value::Object(items) => Value::Object(
            items
                .iter()
                .map(|(k, v)| (k.clone(), canonical(v)))
                .collect::<BTreeMap<_, _>>()
                .into_iter()
                .collect(),
        ),
        _ => value.clone(),
    }
}
fn string<'a>(object: &'a Map<String, Value>, key: &str) -> Result<&'a str, String> {
    object
        .get(key)
        .and_then(Value::as_str)
        .filter(|v| !v.trim().is_empty())
        .ok_or_else(|| "codex_storyboard_operator_request_invalid".to_string())
}
fn valid_id(value: &str, max: usize) -> bool {
    !value.is_empty()
        && value.len() <= max
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}
fn usage(value: &str) -> bool {
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
            | "spatial_depth"
            | "spatial_normal"
            | "character_id"
            | "prop_id"
            | "environment_id"
            | "environment_reference"
    )
}
fn valid_digest(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
}
fn spatial_artifact_usage(kind: &str) -> Option<&'static str> {
    match kind {
        "color" => Some("spatial_authority"),
        "depth" => Some("spatial_depth"),
        "normal" => Some("spatial_normal"),
        "character_id" => Some("character_id"),
        "prop_id" => Some("prop_id"),
        "environment_id" => Some("environment_id"),
        "pose" => Some("pose_reference"),
        _ => None,
    }
}
fn spatial_reference_usage(value: &str) -> bool {
    matches!(value, "spatial_authority" | "spatial_depth" | "spatial_normal" | "character_id" | "prop_id" | "environment_id" | "pose_reference" | "environment_reference")
}
fn old_candidate_instruction(value: &str) -> bool {
    let normalized = value.to_ascii_lowercase();
    normalized.contains("prior storyboard candidate") || normalized.contains("old storyboard candidate") || normalized.contains("previous storyboard candidate")
}
fn validate_spatial_control(
    object: &Map<String, Value>,
    references: &HashMap<String, (String, String)>,
    spatial_count: usize,
    environment_count: usize,
) -> Result<(), String> {
    if spatial_count != 1 || environment_count != 1 { return fail("codex_storyboard_operator_request_invalid"); }
    let spatial = object.get("spatialControl").and_then(Value::as_object).ok_or_else(|| "codex_storyboard_operator_request_invalid".to_string())?;
    let keys = ["stageId", "stageRevision", "stageDigest", "shotId", "snapshotId", "cameraId", "cameraDigest", "panoramaAssetId", "panoramaSha256", "artifacts"];
    if spatial.len() != keys.len() || keys.iter().any(|key| !spatial.contains_key(*key)) { return fail("codex_storyboard_operator_request_invalid"); }
    for key in ["stageId", "shotId", "snapshotId", "cameraId", "panoramaAssetId"] {
        if !valid_id(string(spatial, key)?, 160) { return fail("codex_storyboard_operator_request_invalid"); }
    }
    if spatial.get("stageRevision").and_then(Value::as_u64).filter(|revision| *revision > 0).is_none()
        || !valid_digest(string(spatial, "stageDigest")?)
        || !valid_digest(string(spatial, "cameraDigest")?)
        || !valid_digest(string(spatial, "panoramaSha256")?)
        || string(spatial, "shotId")? != string(object, "shotId")?
    {
        return fail("codex_storyboard_operator_request_invalid");
    }
    let artifacts = spatial.get("artifacts").and_then(Value::as_array).filter(|items| items.len() == 7).ok_or_else(|| "codex_storyboard_operator_request_invalid".to_string())?;
    let mut kinds = HashSet::new();
    for artifact in artifacts {
        let binding = artifact.as_object().ok_or_else(|| "codex_storyboard_operator_request_invalid".to_string())?;
        let keys = ["kind", "referenceId", "sha256"];
        if binding.len() != keys.len() || keys.iter().any(|key| !binding.contains_key(*key)) { return fail("codex_storyboard_operator_request_invalid"); }
        let kind = string(binding, "kind")?;
        let expected_usage = spatial_artifact_usage(kind).ok_or_else(|| "codex_storyboard_operator_request_invalid".to_string())?;
        let reference_id = string(binding, "referenceId")?;
        let digest = string(binding, "sha256")?;
        if !kinds.insert(kind) || !valid_digest(digest) { return fail("codex_storyboard_operator_request_invalid"); }
        let (usage, reference_digest) = references.get(reference_id).ok_or_else(|| "codex_storyboard_operator_request_invalid".to_string())?;
        if usage != expected_usage || reference_digest != digest { return fail("codex_storyboard_operator_request_invalid"); }
    }
    if kinds.len() != 7 { return fail("codex_storyboard_operator_request_invalid"); }
    Ok(())
}
fn inspect_image(bytes: &[u8], expected: Option<&str>) -> Result<(u32, u32, String), String> {
    if bytes.is_empty() || bytes.len() > MAX_IMAGE_BYTES { return fail("codex_storyboard_operator_image_invalid"); }
    let format = image::guess_format(bytes)
        .map_err(|_| "codex_storyboard_operator_image_invalid".to_string())?;
    let mime = match format {
        ImageFormat::Png => "image/png",
        ImageFormat::Jpeg => "image/jpeg",
        _ => return fail("codex_storyboard_operator_image_invalid"),
    };
    if expected.is_some() && expected != Some(mime) {
        return fail("codex_storyboard_operator_image_invalid");
    }
    let (width, height) = image::ImageReader::with_format(std::io::Cursor::new(bytes), format).into_dimensions().map_err(|_| "codex_storyboard_operator_image_invalid".to_string())?;
    if u64::from(width).saturating_mul(u64::from(height)) > MAX_IMAGE_PIXELS { return fail("codex_storyboard_operator_image_invalid"); }
    image::load_from_memory_with_format(bytes, format).map_err(|_| "codex_storyboard_operator_image_invalid".to_string())?;
    if width == 0 || height == 0 {
        return fail("codex_storyboard_operator_image_invalid");
    }
    Ok((width, height, mime.to_string()))
}
fn request_and_digest(package: &Dir, package_path: &Path) -> Result<(Value, String), String> {
    let bytes = stable_read(
        package,
        package_path,
        "request.json",
        "codex_storyboard_operator_request_invalid",
    )?;
    let request: Value = serde_json::from_slice(&bytes)
        .map_err(|_| "codex_storyboard_operator_request_invalid".to_string())?;
    let object = request
        .as_object()
        .ok_or_else(|| "codex_storyboard_operator_request_invalid".to_string())?;
    let expected = [
        "schemaVersion",
        "jobId",
        "projectId",
        "episodeId",
        "shotId",
        "provider",
        "createdAt",
        "prompt",
        "references",
        "acceptedImagePath",
        "expectedOutput",
    ];
    let schema_version = object.get("schemaVersion").and_then(Value::as_u64);
    let valid_keys = match schema_version {
        Some(1) => object.len() == expected.len() && expected.iter().all(|key| object.contains_key(*key)),
        Some(2) => object.len() == expected.len() + 1 && expected.iter().all(|key| object.contains_key(*key)) && object.contains_key("spatialControl"),
        _ => false,
    };
    if !valid_keys || object.get("provider").and_then(Value::as_str) != Some(PROVIDER)
    {
        return fail("codex_storyboard_operator_request_invalid");
    }
    for key in ["jobId", "projectId", "episodeId", "shotId"] {
        if !valid_id(string(object, key)?, 96) {
            return fail("codex_storyboard_operator_request_invalid");
        }
    }
    if string(object, "createdAt").is_err() {
        return fail("codex_storyboard_operator_request_invalid");
    }
    let prompt = object
        .get("prompt")
        .and_then(Value::as_object)
        .ok_or_else(|| "codex_storyboard_operator_request_invalid".to_string())?;
    if prompt.get("useCase").and_then(Value::as_str) != Some("stylized-concept")
        || string(prompt, "primaryRequest").is_err()
    {
        return fail("codex_storyboard_operator_request_invalid");
    }
    if !object
        .get("acceptedImagePath")
        .is_some_and(|value| value.is_null() || value.as_str().is_some())
    {
        return fail("codex_storyboard_operator_request_invalid");
    }
    let expected_output = object
        .get("expectedOutput")
        .and_then(Value::as_object)
        .ok_or_else(|| "codex_storyboard_operator_request_invalid".to_string())?;
    let output_keys = ["candidatePath", "resultPath", "mimeTypes"];
    if expected_output.len() != output_keys.len()
        || output_keys
            .iter()
            .any(|key| !expected_output.contains_key(*key))
        || expected_output.get("candidatePath").and_then(Value::as_str)
            != Some("outputs/candidate.png")
        || expected_output.get("resultPath").and_then(Value::as_str) != Some("outputs/result.json")
        || expected_output.get("mimeTypes").and_then(Value::as_array)
            != Some(&vec![Value::String("image/png".to_string())])
    {
        return fail("codex_storyboard_operator_request_invalid");
    }
    let refs = object
        .get("references")
        .and_then(Value::as_array)
        .filter(|items| !items.is_empty() && items.len() <= 16)
        .ok_or_else(|| "codex_storyboard_operator_request_invalid".to_string())?;
    let mut ids = HashSet::new();
    let mut spatial = false;
    let mut identity = false;
    let mut spatial_count = 0;
    let mut environment_count = 0;
    let mut validated_references = HashMap::new();
    for reference in refs {
        let r = reference
            .as_object()
            .ok_or_else(|| "codex_storyboard_operator_request_invalid".to_string())?;
        let keys = [
            "id",
            "usage",
            "instruction",
            "relativePath",
            "sha256",
            "width",
            "height",
            "mimeType",
        ];
        if r.len() != keys.len() || keys.iter().any(|key| !r.contains_key(*key)) {
            return fail("codex_storyboard_operator_request_invalid");
        }
        let id = string(r, "id")?;
        let u = string(r, "usage")?;
        let rel = string(r, "relativePath")?;
        let digest = string(r, "sha256")?;
        let mime = string(r, "mimeType")?;
        if !valid_id(id, 64)
            || !ids.insert(id.to_string())
            || !usage(u)
            || string(r, "instruction").is_err()
            || !normal(rel)
            || !matches!(mime, "image/png" | "image/jpeg")
            || !valid_digest(digest)
        {
            return fail("codex_storyboard_operator_request_invalid");
        }
        let bytes = stable_read(
            package,
            package_path,
            rel,
            "codex_storyboard_operator_reference_invalid",
        )?;
        let (w, h, actual) = inspect_image(&bytes, Some(mime))?;
        if sha(&bytes) != digest
            || r.get("width").and_then(Value::as_u64) != Some(w as u64)
            || r.get("height").and_then(Value::as_u64) != Some(h as u64)
            || actual != mime
        {
            return fail("codex_storyboard_operator_reference_invalid");
        }
        spatial |= u == "spatial_authority";
        identity |= u == "face_identity" || u == "body_costume";
        spatial_count += usize::from(u == "spatial_authority");
        environment_count += usize::from(u == "environment_reference");
        if schema_version == Some(2) && spatial_reference_usage(u) && old_candidate_instruction(string(r, "instruction")?) {
            return fail("codex_storyboard_operator_request_invalid");
        }
        validated_references.insert(id.to_string(), (u.to_string(), digest.to_string()));
    }
    if !spatial || !identity {
        return fail("codex_storyboard_operator_request_invalid");
    }
    if schema_version == Some(2) {
        validate_spatial_control(object, &validated_references, spatial_count, environment_count)?;
    }
    let bytes = serde_json::to_vec(&canonical(&request))
        .map_err(|_| "codex_storyboard_operator_request_invalid".to_string())?;
    Ok((request, sha(&bytes)))
}
struct OutputCap {
    path: PathBuf,
    identity: (u64, u64),
    dir: Dir,
    #[cfg(windows)]
    _rename_guard: fs::File,
}
fn revalidate_outputs(package: &PackageCap, outputs: &OutputCap) -> Result<(), String> {
    revalidate_package(package)?;
    check_absolute_components(&outputs.path, "codex_storyboard_operator_publish_failed")?;
    let (current, _) = open_stable_child_dir(
        &package.dir,
        Path::new("outputs"),
        Some(outputs.identity),
        "codex_storyboard_operator_publish_failed",
    )?;
    if dir_identity(&current) != Some(outputs.identity)
        || dir_identity(&outputs.dir) != Some(outputs.identity)
    {
        return fail("codex_storyboard_operator_publish_failed");
    }
    Ok(())
}
fn output_dir(package: &PackageCap) -> Result<OutputCap, String> {
    match package.dir.create_dir("outputs") {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(_) => return fail("codex_storyboard_operator_publish_failed"),
    }
    revalidate_package(package)?;
    check_path_components(
        &package.path,
        "outputs",
        "codex_storyboard_operator_publish_failed",
    )?;
    let (dir, identity) = open_stable_child_dir(
        &package.dir,
        Path::new("outputs"),
        None,
        "codex_storyboard_operator_publish_failed",
    )?;
    #[cfg(windows)]
    let rename_guard = open_deny_delete_dir(
        &package.path.join("outputs"),
        identity,
        "codex_storyboard_operator_publish_failed",
    )?;
    let outputs = OutputCap {
        path: package.path.join("outputs"),
        identity,
        dir,
        #[cfg(windows)]
        _rename_guard: rename_guard,
    };
    revalidate_outputs(package, &outputs)?;
    Ok(outputs)
}
fn exists(dir: &Dir, name: &str) -> bool {
    dir.symlink_metadata(name).is_ok()
}
fn temp_name(name: &str) -> String {
    format!(
        ".{name}.tmp-{}-{}",
        process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    )
}
#[cfg(windows)]
fn test_directory_link(target: &Path, link: &Path) -> std::io::Result<()> {
    std::os::windows::fs::symlink_dir(target, link)
}
#[cfg(unix)]
fn test_directory_link(target: &Path, link: &Path) -> std::io::Result<()> {
    std::os::unix::fs::symlink(target, link)
}
fn test_replace_after_validate_before_link(
    package: &PackageCap,
    outputs: &OutputCap,
    name: &str,
) -> Result<(), String> {
    if env::var("NODE_ENV").ok().as_deref() != Some("test") {
        return Ok(());
    }
    let stage = if name == "candidate.png" {
        "CANDIDATE"
    } else if name == "result.json" {
        "RESULT"
    } else {
        return Ok(());
    };
    let outputs_key = format!(
        "CODEX_STORYBOARD_TEST_REPLACE_OUTPUTS_AFTER_VALIDATE_BEFORE_{stage}_LINK"
    );
    if let Ok(target) = env::var(outputs_key) {
        let target = Path::new(&target);
        if !target.is_absolute() || target.exists() {
            return fail("codex_storyboard_operator_publish_failed");
        }
        fs::rename(&outputs.path, target)
            .map_err(|_| "codex_storyboard_operator_publish_failed".to_string())?;
        test_directory_link(target, &outputs.path)
            .map_err(|_| "codex_storyboard_operator_publish_failed".to_string())?;
    }
    let package_key = format!(
        "CODEX_STORYBOARD_TEST_REPLACE_PACKAGE_AFTER_VALIDATE_BEFORE_{stage}_LINK"
    );
    if let Ok(target) = env::var(package_key) {
        let target = Path::new(&target);
        if !target.is_absolute() || target.exists() {
            return fail("codex_storyboard_operator_publish_failed");
        }
        fs::rename(&package.path, target)
            .map_err(|_| "codex_storyboard_operator_publish_failed".to_string())?;
        test_directory_link(target, &package.path)
            .map_err(|_| "codex_storyboard_operator_publish_failed".to_string())?;
    }
    Ok(())
}
fn anchored_exists(outputs: &OutputCap, name: &str) -> bool {
    outputs.dir.symlink_metadata(name).is_ok()
}
fn test_mark_link_attempt() -> Result<(), String> {
    if env::var("NODE_ENV").ok().as_deref() != Some("test") {
        return Ok(());
    }
    let Ok(marker) = env::var("CODEX_STORYBOARD_TEST_LINK_ATTEMPT_MARKER") else {
        return Ok(());
    };
    let marker = Path::new(&marker);
    if !marker.is_absolute() || marker.exists() {
        return fail("codex_storyboard_operator_publish_failed");
    }
    fs::write(marker, b"link-attempted")
        .map_err(|_| "codex_storyboard_operator_publish_failed".to_string())
}
fn publish(
    package: &PackageCap,
    outputs: &OutputCap,
    name: &str,
    bytes: &[u8],
    inject: bool,
) -> Result<(), String> {
    if anchored_exists(outputs, name) {
        return fail("codex_storyboard_operator_output_exists");
    }
    let temp = temp_name(name);
    let mut opts = OpenOptions::new();
    opts.write(true).create_new(true);
    let mut file = outputs
        .dir
        .open_with(&temp, &opts)
        .map_err(|_| "codex_storyboard_operator_publish_failed".to_string())?;
    file.write_all(bytes)
        .and_then(|_| file.sync_all())
        .map_err(|_| "codex_storyboard_operator_publish_failed".to_string())?;
    drop(file);
    if inject {
        let _ = outputs.dir.remove_file(&temp);
        return fail("codex_storyboard_operator_publish_failed");
    }
    if let Err(code) = revalidate_outputs(package, outputs) {
        let _ = outputs.dir.remove_file(&temp);
        return Err(code);
    }
    if let Err(code) = test_replace_after_validate_before_link(package, outputs, name) {
        let _ = outputs.dir.remove_file(&temp);
        return Err(code);
    }
    if let Err(code) = test_mark_link_attempt() {
        let _ = outputs.dir.remove_file(&temp);
        return Err(code);
    }
    let linked = outputs.dir.hard_link(&temp, &outputs.dir, name);
    match linked {
        Ok(()) => {
            if let Err(code) = revalidate_outputs(package, outputs) {
                let _ = outputs.dir.remove_file(name);
                let _ = outputs.dir.remove_file(&temp);
                return Err(code);
            }
            let _ = outputs.dir.remove_file(&temp);
            Ok(())
        }
        Err(_) if anchored_exists(outputs, name) => {
            let _ = outputs.dir.remove_file(&temp);
            fail("codex_storyboard_operator_output_exists")
        }
        Err(_) => {
            let _ = outputs.dir.remove_file(&temp);
            fail("codex_storyboard_operator_publish_failed")
        }
    }
}
fn verify_candidate(
    dir: &Dir,
    root: &Path,
    expected_digest: &str,
    width: u32,
    height: u32,
    mime: &str,
) -> Result<(), String> {
    let current = stable_read(
        dir,
        root,
        "candidate.png",
        "codex_storyboard_operator_publish_failed",
    )?;
    let (current_width, current_height, current_mime) = inspect_image(&current, Some("image/png"))?;
    if sha(&current) != expected_digest
        || current_width != width
        || current_height != height
        || current_mime != mime
    {
        return fail("codex_storyboard_operator_candidate_conflict");
    }
    Ok(())
}
fn compiled_prompt(request: &Value) -> Result<String, String> {
    let o = request
        .as_object()
        .ok_or_else(|| "codex_storyboard_operator_request_invalid".to_string())?;
    let refs = o
        .get("references")
        .and_then(Value::as_array)
        .ok_or_else(|| "codex_storyboard_operator_request_invalid".to_string())?;
    let schema_version = o.get("schemaVersion").and_then(Value::as_u64);
    let ordered_refs = canonical_reference_sequence(refs, schema_version);
    let mut parts = Vec::new();
    for (i, r) in ordered_refs.iter().enumerate() {
        let m = r
            .as_object()
            .ok_or_else(|| "codex_storyboard_operator_request_invalid".to_string())?;
        parts.push(format!(
            "Picture {} [{}]: {}",
            i + 1,
            string(m, "usage")?,
            string(m, "instruction")?
        ));
    }
    if schema_version == Some(2) {
        let spatial = o.get("spatialControl").and_then(Value::as_object).ok_or_else(|| "codex_storyboard_operator_request_invalid".to_string())?;
        parts.push(format!(
            "SPATIAL LINEAGE (non-visual provenance; do not render):\n- Stage: {} rev {} digest {}\n- Shot snapshot: {} / {}\n- Camera: {} digest {}\n- Panorama: {} sha256 {}",
            string(spatial, "stageId")?, spatial.get("stageRevision").and_then(Value::as_u64).ok_or_else(|| "codex_storyboard_operator_request_invalid".to_string())?, string(spatial, "stageDigest")?,
            string(spatial, "shotId")?, string(spatial, "snapshotId")?, string(spatial, "cameraId")?, string(spatial, "cameraDigest")?, string(spatial, "panoramaAssetId")?, string(spatial, "panoramaSha256")?
        ));
    }
    let prompt = o.get("prompt").and_then(Value::as_object).ok_or_else(|| "codex_storyboard_operator_request_invalid".to_string())?;
    let hard = prompt.get("hardConstraints").and_then(Value::as_object);
    let count = hard.and_then(|v| v.get("subjectCount")).and_then(Value::as_u64).filter(|v| *v > 0).unwrap_or(1);
    let subject_visibility = hard.and_then(|v| v.get("subjectVisibility")).and_then(Value::as_str).map(str::trim).filter(|v| !v.is_empty());
    let anatomy = hard.and_then(|v| v.get("visibleAnatomy")).and_then(Value::as_str).map(str::trim).filter(|v| !v.is_empty()).unwrap_or("both arms, both hands, and all required fingers must remain visible and anatomically separate");
    let framing = hard.and_then(|v| v.get("cameraFramingLock")).and_then(Value::as_str).map(str::trim).filter(|v| !v.is_empty()).or_else(|| refs.iter().find(|r| r.get("usage").and_then(Value::as_str) == Some("spatial_authority")).and_then(|r| r.get("instruction")).and_then(Value::as_str)).ok_or_else(|| "codex_storyboard_operator_request_invalid".to_string())?;
    let spatial_role = hard.and_then(|v| v.get("spatialAuthorityRole")).and_then(Value::as_str).map(str::trim).filter(|v| !v.is_empty());
    let subject_line = subject_visibility.map(|value| format!("- Subject visibility: {value}")).unwrap_or_else(|| format!("- Exact subject count: {count}. Do not add, duplicate, merge, or remove subjects."));
    let spatial_line = spatial_role.map(|value| format!("- Spatial authority role: {value}")).unwrap_or_else(|| "- No pose, composition, camera, framing, projection, or occlusion drift from spatial authority.".to_string());
    parts.push(format!("MANDATORY HARD CONSTRAINTS:\n{subject_line}\n- Visible anatomy: {anatomy}. No fused, missing, duplicated, or malformed limbs/hands.\n- Camera and framing lock: {framing}\n{spatial_line}\n- No text, captions, logos, signatures, or watermarks."));
    parts.push(string(prompt, "primaryRequest")?.to_string());
    Ok(parts.join("\n"))
}

fn canonical_reference_sequence<'a>(references: &'a [Value], schema_version: Option<u64>) -> Vec<&'a Value> {
    let mut ordered = references.iter().collect::<Vec<_>>();
    if schema_version == Some(2) {
        ordered.sort_by_key(|reference| spatial_reference_rank(reference.get("usage").and_then(Value::as_str).unwrap_or_default()));
    }
    ordered
}

fn spatial_reference_rank(usage: &str) -> u8 {
    match usage {
        "face_identity" | "body_costume" => 0,
        "prop_detail" => 1,
        "spatial_authority" => 2,
        "pose_reference" => 3,
        "character_id" => 4,
        "environment_reference" => 5,
        "prop_id" => 6,
        "environment_id" => 7,
        "spatial_depth" => 8,
        "spatial_normal" => 9,
        "style_only" | "lighting_only" => 10,
        "negative_example" => 11,
        _ => 12,
    }
}

fn utc_rfc3339_now() -> Result<String, String> {
    let duration = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|_| "codex_storyboard_operator_publish_failed".to_string())?;
    let seconds = duration.as_secs();
    let days = (seconds / 86_400) as i64;
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let mut year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = mp + if mp < 10 { 3 } else { -9 };
    year += if month <= 2 { 1 } else { 0 };
    let sod = seconds % 86_400;
    Ok(format!("{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{:03}Z", sod / 3600, (sod % 3600) / 60, sod % 60, duration.subsec_millis()))
}

fn valid_rfc3339_utc(value: &str) -> bool {
    let bytes = value.as_bytes();
    if value.len() != 24 || bytes.get(4) != Some(&b'-') || bytes.get(7) != Some(&b'-') || bytes.get(10) != Some(&b'T') || bytes.get(13) != Some(&b':') || bytes.get(16) != Some(&b':') || bytes.get(19) != Some(&b'.') || bytes.last() != Some(&b'Z') { return false; }
    let Ok(year) = value[..4].parse::<u16>() else { return false; }; let Ok(month) = value[5..7].parse::<u8>() else { return false; }; let Ok(day) = value[8..10].parse::<u8>() else { return false; };
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0); let max_day = match month { 1|3|5|7|8|10|12 => 31, 4|6|9|11 => 30, 2 if leap => 29, 2 => 28, _ => return false };
    day >= 1 && day <= max_day && value[11..13].parse::<u8>().is_ok_and(|v| v < 24) && value[14..16].parse::<u8>().is_ok_and(|v| v < 60) && value[17..19].parse::<u8>().is_ok_and(|v| v < 60) && value[20..23].bytes().all(|b| b.is_ascii_digit())
}
fn checked_manifest(
    path: &str,
    package_path: &Path,
    request: &Value,
    request_digest: &str,
) -> Result<String, String> {
    let manifest_path = Path::new(path);
    let bytes = stable_ambient_read(manifest_path, "codex_storyboard_operator_manifest_invalid")?;
    let manifest: Value = serde_json::from_slice(&bytes)
        .map_err(|_| "codex_storyboard_operator_manifest_invalid".to_string())?;
    let m = manifest
        .as_object()
        .ok_or_else(|| "codex_storyboard_operator_manifest_invalid".to_string())?;
    let o = request
        .as_object()
        .ok_or_else(|| "codex_storyboard_operator_manifest_invalid".to_string())?;
    let prompt = compiled_prompt(request)?;
    let expected = [
        "schemaVersion",
        "jobId",
        "packagePath",
        "requestDigest",
        "references",
        "compiledPrompt",
        "promptDigest",
        "createdAt",
    ];
    let manifest_package_path = m
        .get("packagePath")
        .and_then(Value::as_str)
        .map(Path::new)
        .ok_or_else(|| "codex_storyboard_operator_manifest_invalid".to_string())?;
    check_absolute_components(
        manifest_package_path,
        "codex_storyboard_operator_manifest_invalid",
    )?;
    let manifest_package = fs::canonicalize(manifest_package_path)
        .map_err(|_| "codex_storyboard_operator_manifest_invalid".to_string())?;
    if m.len() != expected.len()
        || expected.iter().any(|key| !m.contains_key(*key))
        || m.get("schemaVersion").and_then(Value::as_u64) != Some(1)
        || m.get("jobId").and_then(Value::as_str) != o.get("jobId").and_then(Value::as_str)
        || manifest_package != package_path
        || m.get("requestDigest").and_then(Value::as_str) != Some(request_digest)
        || m.get("compiledPrompt").and_then(Value::as_str) != Some(prompt.as_str())
        || m.get("promptDigest").and_then(Value::as_str) != Some(sha(prompt.as_bytes()).as_str())
        || m.get("createdAt")
            .and_then(Value::as_str)
            .filter(|value| valid_rfc3339_utc(value))
            .is_none()
    {
        return fail("codex_storyboard_operator_manifest_invalid");
    }
    let refs = m
        .get("references")
        .and_then(Value::as_array)
        .ok_or_else(|| "codex_storyboard_operator_manifest_invalid".to_string())?;
    let current = o
        .get("references")
        .and_then(Value::as_array)
        .ok_or_else(|| "codex_storyboard_operator_manifest_invalid".to_string())?;
    if refs.len() != current.len() {
        return fail("codex_storyboard_operator_manifest_invalid");
    }
    let manifest_root = manifest_path
        .parent()
        .ok_or_else(|| "codex_storyboard_operator_manifest_invalid".to_string())?;
    let canonical_root = fs::canonicalize(manifest_root)
        .map_err(|_| "codex_storyboard_operator_manifest_invalid".to_string())?;
    let ordered_current = canonical_reference_sequence(
        current,
        o.get("schemaVersion").and_then(Value::as_u64),
    );
    for (entry_value, reference_value) in refs.iter().zip(ordered_current) {
        let entry = entry_value
            .as_object()
            .ok_or_else(|| "codex_storyboard_operator_manifest_invalid".to_string())?;
        let reference = reference_value
            .as_object()
            .ok_or_else(|| "codex_storyboard_operator_manifest_invalid".to_string())?;
        let keys = ["id", "sha256", "stagedPath"];
        if entry.len() != keys.len()
            || keys.iter().any(|key| !entry.contains_key(*key))
            || entry.get("id") != reference.get("id")
            || entry.get("sha256") != reference.get("sha256")
        {
            return fail("codex_storyboard_operator_manifest_invalid");
        }
        let staged = entry
            .get("stagedPath")
            .and_then(Value::as_str)
            .map(Path::new)
            .filter(|value| value.is_absolute())
            .ok_or_else(|| "codex_storyboard_operator_manifest_invalid".to_string())?;
        check_absolute_components(staged, "codex_storyboard_operator_manifest_invalid")?;
        let canonical_staged = fs::canonicalize(staged)
            .map_err(|_| "codex_storyboard_operator_manifest_invalid".to_string())?;
        if canonical_staged.parent() != Some(canonical_root.as_path()) {
            return fail("codex_storyboard_operator_manifest_invalid");
        }
        let staged_bytes = stable_ambient_read(
            &canonical_staged,
            "codex_storyboard_operator_manifest_invalid",
        )?;
        let expected_digest = string(reference, "sha256")?;
        let expected_mime = string(reference, "mimeType")?;
        let (width, height, mime) = inspect_image(&staged_bytes, Some(expected_mime))
            .map_err(|_| "codex_storyboard_operator_manifest_invalid".to_string())?;
        if sha(&staged_bytes) != expected_digest
            || reference.get("width").and_then(Value::as_u64) != Some(width as u64)
            || reference.get("height").and_then(Value::as_u64) != Some(height as u64)
            || mime != expected_mime
        {
            return fail("codex_storyboard_operator_manifest_invalid");
        }
    }
    Ok(prompt)
}
fn validate_result(
    result: &Value,
    request: &Value,
    request_digest: &str,
    final_prompt: &str,
    candidate_digest: &str,
    width: u32,
    height: u32,
) -> Result<(), String> {
    let invalid = "codex_storyboard_operator_result_invalid";
    let object = result.as_object().ok_or_else(|| invalid.to_string())?;
    let request = request.as_object().ok_or_else(|| invalid.to_string())?;
    let mut keys = vec![
        "schemaVersion",
        "jobId",
        "projectId",
        "episodeId",
        "shotId",
        "provider",
        "requestDigest",
        "referenceDigests",
        "generationMode",
        "finalPrompt",
        "output",
        "completedAt",
        "state",
    ];
    let crop_mode = object.get("generationMode").and_then(Value::as_str)
        == Some("user_authorized_local_deterministic_crop");
    if crop_mode { keys.push("derivedTransform"); }
    if object.len() != keys.len()
        || keys.iter().any(|key| !object.contains_key(*key))
        || object.get("schemaVersion").and_then(Value::as_u64) != Some(1)
        || object.get("provider").and_then(Value::as_str) != Some(PROVIDER)
        || !matches!(object.get("generationMode").and_then(Value::as_str), Some("codex_builtin_imagegen" | "user_authorized_local_deterministic_crop"))
        || object.get("state").and_then(Value::as_str) != Some("completed")
        || object.get("requestDigest").and_then(Value::as_str) != Some(request_digest)
        || object.get("finalPrompt").and_then(Value::as_str) != Some(final_prompt)
        || object
            .get("completedAt")
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .is_none()
        || ["jobId", "projectId", "episodeId", "shotId"]
            .iter()
            .any(|key| object.get(*key) != request.get(*key))
    {
        return fail(invalid);
    }
    let expected_references: Vec<Value> = request
        .get("references")
        .and_then(Value::as_array)
        .ok_or_else(|| invalid.to_string())?
        .iter()
        .map(|reference| json!({"id":reference["id"],"sha256":reference["sha256"]}))
        .collect();
    let references = object
        .get("referenceDigests")
        .and_then(Value::as_array)
        .ok_or_else(|| invalid.to_string())?;
    if references != &expected_references
        || references.iter().any(|reference| {
            reference.as_object().is_none_or(|entry| {
                let keys = ["id", "sha256"];
                entry.len() != keys.len() || keys.iter().any(|key| !entry.contains_key(*key))
            })
        })
    {
        return fail(invalid);
    }
    let output = object
        .get("output")
        .and_then(Value::as_object)
        .ok_or_else(|| invalid.to_string())?;
    let output_keys = ["relativePath", "sha256", "width", "height", "mimeType"];
    if output.len() != output_keys.len()
        || output_keys.iter().any(|key| !output.contains_key(*key))
        || output.get("relativePath").and_then(Value::as_str) != Some("outputs/candidate.png")
        || output.get("sha256").and_then(Value::as_str) != Some(candidate_digest)
        || output.get("width").and_then(Value::as_u64) != Some(width as u64)
        || output.get("height").and_then(Value::as_u64) != Some(height as u64)
        || output.get("mimeType").and_then(Value::as_str) != Some("image/png")
    {
        return fail(invalid);
    }
    Ok(())
}

fn validated_derived_transform(path: &str, request: &Value, request_digest: &str, candidate_digest: &str, width: u32, height: u32) -> Result<Value, String> {
    let invalid = "codex_storyboard_operator_derived_transform_invalid";
    let raw = Path::new(path);
    check_absolute_components(raw, invalid)?;
    let canonical = fs::canonicalize(raw).map_err(|_| invalid.to_string())?;
    let value: Value = serde_json::from_slice(&stable_ambient_read(&canonical, invalid)?).map_err(|_| invalid.to_string())?;
    let o = value.as_object().ok_or_else(|| invalid.to_string())?;
    let keys = ["operation","authorization","tool","source","cropRectangle","output","pixelExactCrop"];
    if o.len()!=keys.len() || keys.iter().any(|k| !o.contains_key(*k)) || o.get("operation").and_then(Value::as_str)!=Some("user_authorized_local_deterministic_crop") || o.get("pixelExactCrop").and_then(Value::as_bool)!=Some(true) { return fail(invalid); }
    let authorization=o["authorization"].as_object().ok_or_else(|| invalid.to_string())?;
    if authorization.len()!=2 || !authorization.contains_key("observedAt") || !authorization.contains_key("context") || !authorization.get("observedAt").and_then(Value::as_str).is_some_and(valid_rfc3339_utc) || authorization.get("context").and_then(Value::as_str).is_none_or(|v| v.trim().is_empty()) { return fail(invalid); }
    let tool=o["tool"].as_object().ok_or_else(|| invalid.to_string())?;
    if tool.len()!=3 || tool.get("name").and_then(Value::as_str)!=Some("ffmpeg") || tool.get("generative").and_then(Value::as_bool)!=Some(false) { return fail(invalid); }
    let source=o["source"].as_object().ok_or_else(|| invalid.to_string())?;
    let output=o["output"].as_object().ok_or_else(|| invalid.to_string())?;
    let crop=o["cropRectangle"].as_object().ok_or_else(|| invalid.to_string())?;
    let file_keys=["absolutePath","sha256","width","height"];
    let crop_keys=["x","y","width","height"];
    if source.len()!=4 || output.len()!=4 || crop.len()!=4 || file_keys.iter().any(|k| !source.contains_key(*k)||!output.contains_key(*k)) || crop_keys.iter().any(|k| !crop.contains_key(*k)) { return fail(invalid); }
    let sw=source["width"].as_u64().ok_or_else(|| invalid.to_string())?; let sh=source["height"].as_u64().ok_or_else(|| invalid.to_string())?;
    let x=crop["x"].as_u64().ok_or_else(|| invalid.to_string())?; let y=crop["y"].as_u64().ok_or_else(|| invalid.to_string())?; let w=crop["width"].as_u64().ok_or_else(|| invalid.to_string())?; let h=crop["height"].as_u64().ok_or_else(|| invalid.to_string())?;
    if w==0 || h==0 || x.checked_add(w).is_none_or(|v|v>sw) || y.checked_add(h).is_none_or(|v|v>sh) || output["width"].as_u64()!=Some(w) || output["height"].as_u64()!=Some(h) || w*9!=h*16 || w!=width as u64 || h!=height as u64 || output["sha256"].as_str()!=Some(candidate_digest) || tool.get("filter").and_then(Value::as_str)!=Some(format!("crop={w}:{h}:{x}:{y}").as_str()) { return fail(invalid); }
    let mut verified_files=Vec::new();
    for (entry, ew, eh) in [(source,sw,sh),(output,w,h)] {
        let file_path=entry["absolutePath"].as_str().map(Path::new).filter(|p|p.is_absolute()).ok_or_else(|| invalid.to_string())?;
        check_absolute_components(file_path, invalid)?;
        let bytes=stable_ambient_read(&fs::canonicalize(file_path).map_err(|_| invalid.to_string())?, invalid)?;
        let (aw,ah,mime)=inspect_image(&bytes, Some("image/png"))?;
        if aw as u64!=ew || ah as u64!=eh || mime!="image/png" || sha(&bytes)!=entry["sha256"].as_str().unwrap_or_default() { return fail(invalid); }
        verified_files.push(bytes);
    }
    verify_exact_crop_pixels(&verified_files[0], &verified_files[1], x as u32, y as u32, w as u32, h as u32).map_err(|_| invalid.to_string())?;
    let _ = request; let _ = request_digest;
    Ok(value)
}
fn complete(
    package_argument: &str,
    candidate_path: &str,
    expected_candidate_digest: &str,
    manifest_path: &str,
    derived_transform_path: Option<&str>,
) -> Result<Value, String> {
    let package = acquire_package(Path::new(package_argument))?;
    let package_path = package.path.clone();
    let (request, request_digest) = request_and_digest(&package.dir, &package_path)?;
    revalidate_package(&package)?;
    let manifest_prompt =
        checked_manifest(manifest_path, &package_path, &request, &request_digest)?;
    revalidate_package(&package)?;
    let candidate_argument = Path::new(candidate_path);
    check_absolute_components(
        candidate_argument,
        "codex_storyboard_operator_candidate_invalid",
    )?;
    let source = fs::canonicalize(candidate_argument)
        .map_err(|_| "codex_storyboard_operator_candidate_invalid".to_string())?;
    let bytes = stable_ambient_read(&source, "codex_storyboard_operator_candidate_invalid")?;
    let (width, height, mime) = inspect_image(&bytes, Some("image/png"))?;
    let candidate_digest = sha(&bytes);
    if expected_candidate_digest.len() != 64
        || !expected_candidate_digest
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
        || candidate_digest != expected_candidate_digest
    {
        return fail("codex_storyboard_operator_candidate_invalid");
    }
    revalidate_package(&package)?;
    let outputs = output_dir(&package)?;
    revalidate_outputs(&package, &outputs)?;
    if exists(&outputs.dir, "result.json") {
        return fail("codex_storyboard_operator_replay");
    }
    let output_path = outputs.path.clone();
    if exists(&outputs.dir, "candidate.png") {
        verify_candidate(
            &outputs.dir,
            &output_path,
            &candidate_digest,
            width,
            height,
            &mime,
        )?;
    } else if let Err(code) = publish(&package, &outputs, "candidate.png", &bytes, false) {
        if code != "codex_storyboard_operator_output_exists" {
            return Err(code);
        }
        verify_candidate(
            &outputs.dir,
            &output_path,
            &candidate_digest,
            width,
            height,
            &mime,
        )?;
    }
    revalidate_outputs(&package, &outputs)?;
    let o = request.as_object().unwrap();
    let refs = o.get("references").and_then(Value::as_array).unwrap();
    let references: Vec<Value> = refs
        .iter()
        .map(|r| json!({"id":r["id"],"sha256":r["sha256"]}))
        .collect();
    let completed_at = utc_rfc3339_now()?;
    let mut result = json!({"schemaVersion":1,"jobId":o["jobId"],"projectId":o["projectId"],"episodeId":o["episodeId"],"shotId":o["shotId"],"provider":PROVIDER,"requestDigest":request_digest,"referenceDigests":references,"generationMode":"codex_builtin_imagegen","finalPrompt":manifest_prompt,"output":{"relativePath":"outputs/candidate.png","sha256":candidate_digest,"width":width,"height":height,"mimeType":"image/png"},"completedAt":completed_at,"state":"completed"});
    if let Some(transform_path) = derived_transform_path {
        result["generationMode"] = json!("user_authorized_local_deterministic_crop");
        result["derivedTransform"] = validated_derived_transform(transform_path, &request, &request_digest, &candidate_digest, width, height)?;
    }
    validate_result(
        &result,
        &request,
        &request_digest,
        result["finalPrompt"].as_str().unwrap_or_default(),
        &candidate_digest,
        width,
        height,
    )?;
    if env::var("NODE_ENV").ok().as_deref() == Some("test")
        && env::var("CODEX_STORYBOARD_TEST_FORGE_RESULT_SHAPE")
            .ok()
            .as_deref()
            == Some("1")
    {
        result["unknown"] = json!(true);
    }
    if env::var("NODE_ENV").ok().as_deref() == Some("test")
        && env::var("CODEX_STORYBOARD_TEST_FORGE_RESULT_IDENTITY")
            .ok()
            .as_deref()
            == Some("1")
    {
        result["provider"] = json!("forged_provider");
        result["projectId"] = json!("forged-project");
    }
    let result_bytes = serde_json::to_vec_pretty(&result)
        .map_err(|_| "codex_storyboard_operator_publish_failed".to_string())?;
    let inject = env::var("NODE_ENV").ok().as_deref() == Some("test")
        && env::var("CODEX_STORYBOARD_TEST_FAIL_RESULT_PUBLISH")
            .ok()
            .as_deref()
            == Some("1");
    publish(&package, &outputs, "result.json", &result_bytes, inject)?;
    revalidate_outputs(&package, &outputs)?;
    let mut handoff = json!({"jobId":o["jobId"],"requestDigest":request_digest,"candidatePath":output_path.join("candidate.png"),"resultPath":output_path.join("result.json")});
    if env::var("CODEX_STORYBOARD_TEST_FORGE_STDOUT")
        .ok()
        .as_deref()
        == Some("1")
    {
        handoff["jobId"] = json!("forged-job");
    }
    Ok(handoff)
}
fn main() {
    let args: Vec<String> = env::args().collect();
    let result = if (args.len() == 10 || args.len() == 12)
        && args[1] == "complete"
        && args[2] == "--package"
        && args[4] == "--candidate"
        && args[6] == "--candidate-digest"
        && args[8] == "--inspection-manifest"
        && (args.len() == 10 || args[10] == "--derived-transform")
    {
        complete(&args[3], &args[5], &args[7], &args[9], args.get(11).map(String::as_str))
    } else {
        fail("codex_storyboard_operator_usage")
    };
    match result {
        Ok(value) => println!("{}", value),
        Err(code) => {
            eprintln!("{code}");
            process::exit(15)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{DynamicImage, ImageFormat, Rgba, RgbaImage};
    use std::io::Cursor;

    fn png(image: RgbaImage) -> Vec<u8> {
        let mut bytes=Cursor::new(Vec::new());
        DynamicImage::ImageRgba8(image).write_to(&mut bytes, ImageFormat::Png).unwrap();
        bytes.into_inner()
    }

    #[test]
    fn exact_crop_rejects_single_pixel_tamper() {
        let source=RgbaImage::from_fn(4,4,|x,y|Rgba([x as u8,y as u8,(x+y) as u8,255]));
        let expected=RgbaImage::from_fn(2,2,|x,y|*source.get_pixel(x+1,y+1));
        let source_bytes=png(source);
        let candidate_bytes=png(expected.clone());
        assert!(verify_exact_crop_pixels(&source_bytes,&candidate_bytes,1,1,2,2).is_ok());
        let mut tampered=expected; tampered.put_pixel(0,0,Rgba([255,0,0,255]));
        assert_eq!(verify_exact_crop_pixels(&source_bytes,&png(tampered),1,1,2,2),Err("codex_storyboard_crop_pixels_mismatch".to_string()));
    }
    #[test]
    fn rejects_relative_paths() {
        assert!(!normal("../escape.png"));
        assert!(!normal("/absolute.png"));
    }
    #[test]
    fn canonical_order_is_stable() {
        assert_eq!(
            canonical(&json!({"b":1,"a":2})).to_string(),
            "{\"a\":2,\"b\":1}"
        );
    }
    #[test]
    fn compiled_prompt_honors_non_exact_subject_visibility_and_spatial_role() {
        let request = json!({
            "references":[{"usage":"spatial_authority","instruction":"environment layout only"}],
            "prompt":{
                "primaryRequest":"story request",
                "hardConstraints":{
                    "primarySubject":"the short broad shovel blade, horizontal phoenix panel, and clear air gap are primary",
                    "secondaryPresence":"Wei = cropped shoulder/back-of-head edge framing only; Li = limited secondary continuity inside the coffin, never co-equal",
                    "subjectVisibility":"Wei is a cropped foreground edge; Li is limited secondary continuity",
                    "visibleAnatomy":"only insert-required anatomy",
                    "cameraFramingLock":"genuine locked-off over-the-shoulder insert",
                    "spatialAuthorityRole":"environment and layout only; not camera authority"
                }
            }
        });
        let compiled = compiled_prompt(&request).expect("shot-specific prompt compiles");
        assert!(compiled.contains("Subject visibility: Wei is a cropped foreground edge; Li is limited secondary continuity"));
        assert!(compiled.contains("Spatial authority role: environment and layout only; not camera authority"));
        assert!(!compiled.contains("Exact subject count"));
        assert!(!compiled.contains("No pose, composition, camera, framing, projection, or occlusion drift"));
    }
    fn spatial_v2_request(reference_sha: &str) -> Value {
        let references = [
            ("color", "spatial_authority", "Camera-bound color pass."),
            ("depth", "spatial_depth", "Camera-bound metric depth pass."),
            ("normal", "spatial_normal", "Camera-bound world normal pass."),
            ("character-id", "character_id", "Character segmentation pass."),
            ("prop-id", "prop_id", "Prop segmentation pass."),
            ("environment-id", "environment_id", "Immutable environment segmentation pass."),
            ("pose", "pose_reference", "Complete humanoid pose projection."),
            ("environment", "environment_reference", "Perspective derived from the approved panorama."),
            ("li", "face_identity", "Li Baozhu identity and costume authority."),
            ("wei", "face_identity", "Wei Xun identity and costume authority."),
            ("coffin", "prop_detail", "Coffin appearance and hardware identity authority."),
        ].into_iter().map(|(id, usage, instruction)| json!({
            "id":id,"usage":usage,"instruction":instruction,"relativePath":format!("references/{id}.png"),"sha256":reference_sha,"width":1,"height":1,"mimeType":"image/png"
        })).collect::<Vec<_>>();
        json!({
            "schemaVersion":2,"jobId":"job-v2","projectId":"project-v2","episodeId":"episode-v2","shotId":"E01-S01-C19","provider":PROVIDER,"createdAt":"2026-08-30T00:00:00.000Z",
            "prompt":{"useCase":"stylized-concept","primaryRequest":"A locked spatial storyboard frame."},"references":references,"acceptedImagePath":null,
            "expectedOutput":{"candidatePath":"outputs/candidate.png","resultPath":"outputs/result.json","mimeTypes":["image/png"]},
            "spatialControl":{"stageId":"stage_yingdi_e01_tomb_v2","stageRevision":2,"stageDigest":"a".repeat(64),"shotId":"E01-S01-C19","snapshotId":"stage_yingdi_e01_tomb_v2_E01-S01-C19","cameraId":"E01-S01-C19-camera","cameraDigest":"b".repeat(64),"panoramaAssetId":"yingdi-e01-tomb-v2-panorama","panoramaSha256":"c".repeat(64),"artifacts":[
                {"kind":"color","referenceId":"color","sha256":reference_sha},{"kind":"depth","referenceId":"depth","sha256":reference_sha},{"kind":"normal","referenceId":"normal","sha256":reference_sha},
                {"kind":"character_id","referenceId":"character-id","sha256":reference_sha},{"kind":"prop_id","referenceId":"prop-id","sha256":reference_sha},{"kind":"environment_id","referenceId":"environment-id","sha256":reference_sha},{"kind":"pose","referenceId":"pose","sha256":reference_sha}
            ]}
        })
    }
    fn write_spatial_v2_request(root: &Path, request: &Value) {
        fs::write(root.join("request.json"), serde_json::to_vec_pretty(request).unwrap()).unwrap();
    }
    #[test]
    fn request_schema_v2_binds_spatial_lineage_before_completion() {
        let root = env::temp_dir().join(format!("codex-storyboard-operator-v2-{}-{}", process::id(), SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));
        fs::create_dir_all(root.join("references")).unwrap();
        let bytes = png(RgbaImage::new(1, 1));
        let digest = sha(&bytes);
        for id in ["color", "depth", "normal", "character-id", "prop-id", "environment-id", "pose", "environment", "li", "wei", "coffin"] {
            fs::write(root.join("references").join(format!("{id}.png")), &bytes).unwrap();
        }
        let mut request = spatial_v2_request(&digest);
        write_spatial_v2_request(&root, &request);
        let package = acquire_package(&root).unwrap();
        assert!(request_and_digest(&package.dir, &root).is_ok(), "valid schema-v2 spatial package is accepted");
        let compiled = compiled_prompt(&request).unwrap();
        assert!(compiled.find("[face_identity]").unwrap() < compiled.find("[prop_detail]").unwrap());
        assert!(compiled.find("[prop_detail]").unwrap() < compiled.find("[spatial_authority]").unwrap());
        assert!(compiled.find("[spatial_authority]").unwrap() < compiled.find("[pose_reference]").unwrap());
        assert!(compiled.find("[pose_reference]").unwrap() < compiled.find("[character_id]").unwrap());
        assert!(compiled.find("[character_id]").unwrap() < compiled.find("[environment_reference]").unwrap());
        assert!(compiled.find("[environment_reference]").unwrap() < compiled.find("[prop_id]").unwrap());
        assert!(compiled.find("[prop_id]").unwrap() < compiled.find("[environment_id]").unwrap());
        assert!(compiled.find("[environment_id]").unwrap() < compiled.find("[spatial_depth]").unwrap());
        assert!(compiled.find("[spatial_depth]").unwrap() < compiled.find("[spatial_normal]").unwrap());
        assert!(compiled.contains("SPATIAL LINEAGE (non-visual provenance; do not render):"));
        assert!(compiled.contains("stage_yingdi_e01_tomb_v2"));
        assert!(compiled.contains("E01-S01-C19-camera"));
        assert!(compiled.contains("yingdi-e01-tomb-v2-panorama"));

        request["spatialControl"]["artifacts"].as_array_mut().unwrap().remove(0);
        write_spatial_v2_request(&root, &request);
        assert_eq!(request_and_digest(&package.dir, &root), Err("codex_storyboard_operator_request_invalid".to_string()));

        request = spatial_v2_request(&digest);
        request["spatialControl"]["shotId"] = json!("E01-S01-C20");
        write_spatial_v2_request(&root, &request);
        assert_eq!(request_and_digest(&package.dir, &root), Err("codex_storyboard_operator_request_invalid".to_string()));

        request = spatial_v2_request(&digest);
        request["spatialControl"]["artifacts"][0]["sha256"] = json!("f".repeat(64));
        write_spatial_v2_request(&root, &request);
        assert_eq!(request_and_digest(&package.dir, &root), Err("codex_storyboard_operator_request_invalid".to_string()));

        request = spatial_v2_request(&digest);
        request["spatialControl"]["artifacts"][5]["kind"] = json!("color");
        write_spatial_v2_request(&root, &request);
        assert_eq!(request_and_digest(&package.dir, &root), Err("codex_storyboard_operator_request_invalid".to_string()));

        request = spatial_v2_request(&digest);
        request["references"] = Value::Array(request["references"].as_array().unwrap().iter().filter(|reference| reference["usage"] != "environment_reference").cloned().collect());
        write_spatial_v2_request(&root, &request);
        assert_eq!(request_and_digest(&package.dir, &root), Err("codex_storyboard_operator_request_invalid".to_string()));

        request = spatial_v2_request(&digest);
        request["references"][0]["instruction"] = json!("Use the prior storyboard candidate for framing.");
        write_spatial_v2_request(&root, &request);
        assert_eq!(request_and_digest(&package.dir, &root), Err("codex_storyboard_operator_request_invalid".to_string()));
        drop(package);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn result_schema_rejects_unknown_fields_and_identity_forgery() {
        let request = json!({
            "jobId":"job-1","projectId":"project-1","episodeId":"episode-1","shotId":"shot-1",
            "references":[{"id":"stage","sha256":"a".repeat(64)}]
        });
        let mut result = json!({
            "schemaVersion":1,"jobId":"job-1","projectId":"project-1","episodeId":"episode-1","shotId":"shot-1",
            "provider":PROVIDER,"requestDigest":"b".repeat(64),"referenceDigests":[{"id":"stage","sha256":"a".repeat(64)}],
            "generationMode":"codex_builtin_imagegen","finalPrompt":"prompt","output":{"relativePath":"outputs/candidate.png","sha256":"c".repeat(64),"width":1,"height":1,"mimeType":"image/png"},
            "completedAt":"1970-01-01T00:00:00.000Z","state":"completed"
        });
        assert!(validate_result(
            &result,
            &request,
            &"b".repeat(64),
            "prompt",
            &"c".repeat(64),
            1,
            1
        )
        .is_ok());
        result["unknown"] = json!(true);
        assert_eq!(
            validate_result(
                &result,
                &request,
                &"b".repeat(64),
                "prompt",
                &"c".repeat(64),
                1,
                1
            ),
            Err("codex_storyboard_operator_result_invalid".to_string())
        );
        result.as_object_mut().unwrap().remove("unknown");
        result["projectId"] = json!("forged");
        assert_eq!(
            validate_result(
                &result,
                &request,
                &"b".repeat(64),
                "prompt",
                &"c".repeat(64),
                1,
                1
            ),
            Err("codex_storyboard_operator_result_invalid".to_string())
        );
    }
}
