use cap_std::{
    ambient_authority,
    fs::{Dir, OpenOptions},
};
use image::{GenericImageView, ImageFormat};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    env, fs,
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    process,
    time::{SystemTime, UNIX_EPOCH},
};

const PROVIDER: &str = "codex_task_package";

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
    let mut bytes = Vec::new();
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
}
fn revalidate_package(package: &PackageCap) -> Result<(), String> {
    let code = "codex_storyboard_operator_package_invalid";
    check_absolute_components(&package.path, code)?;
    if fs::canonicalize(&package.path).map_err(|_| code.to_string())? != package.path {
        return fail(code);
    }
    let current =
        Dir::open_ambient_dir(&package.path, ambient_authority()).map_err(|_| code.to_string())?;
    if dir_identity(&current) != Some(package.identity)
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
    let dir = Dir::open_ambient_dir(&path, ambient_authority()).map_err(|_| code.to_string())?;
    if dir_identity(&dir) != Some(identity) {
        return fail(code);
    }
    let package = PackageCap {
        path,
        identity,
        dir,
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
    let mut bytes = Vec::new();
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
    )
}
fn inspect_image(bytes: &[u8], expected: Option<&str>) -> Result<(u32, u32, String), String> {
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
    let image = image::load_from_memory_with_format(bytes, format)
        .map_err(|_| "codex_storyboard_operator_image_invalid".to_string())?;
    let (width, height) = image.dimensions();
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
    if object.len() != expected.len()
        || expected.iter().any(|key| !object.contains_key(*key))
        || object.get("schemaVersion").and_then(Value::as_u64) != Some(1)
        || object.get("provider").and_then(Value::as_str) != Some(PROVIDER)
    {
        return fail("codex_storyboard_operator_request_invalid");
    }
    for key in ["jobId", "projectId", "episodeId", "shotId"] {
        if !valid_id(string(object, key)?, 96) {
            return fail("codex_storyboard_operator_request_invalid");
        }
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
    let refs = object
        .get("references")
        .and_then(Value::as_array)
        .filter(|items| !items.is_empty() && items.len() <= 16)
        .ok_or_else(|| "codex_storyboard_operator_request_invalid".to_string())?;
    let mut ids = std::collections::HashSet::new();
    let mut spatial = false;
    let mut identity = false;
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
            || !normal(rel)
            || digest.len() != 64
            || !digest
                .bytes()
                .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
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
    }
    if !spatial || !identity {
        return fail("codex_storyboard_operator_request_invalid");
    }
    let bytes = serde_json::to_vec(&canonical(&request))
        .map_err(|_| "codex_storyboard_operator_request_invalid".to_string())?;
    Ok((request, sha(&bytes)))
}
struct OutputCap {
    path: PathBuf,
    identity: (u64, u64),
    dir: Dir,
}
fn revalidate_outputs(package: &PackageCap, outputs: &OutputCap) -> Result<(), String> {
    revalidate_package(package)?;
    check_absolute_components(&outputs.path, "codex_storyboard_operator_publish_failed")?;
    let current = Dir::open_ambient_dir(&outputs.path, ambient_authority())
        .map_err(|_| "codex_storyboard_operator_publish_failed".to_string())?;
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
    let dir = package
        .dir
        .open_dir("outputs")
        .map_err(|_| "codex_storyboard_operator_publish_failed".to_string())?;
    let identity =
        dir_identity(&dir).ok_or_else(|| "codex_storyboard_operator_publish_failed".to_string())?;
    let outputs = OutputCap {
        path: package.path.join("outputs"),
        identity,
        dir,
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
fn publish(dir: &Dir, name: &str, bytes: &[u8], inject: bool) -> Result<(), String> {
    if exists(dir, name) {
        return fail("codex_storyboard_operator_output_exists");
    }
    let temp = temp_name(name);
    let mut opts = OpenOptions::new();
    opts.write(true).create_new(true);
    let mut file = dir
        .open_with(&temp, &opts)
        .map_err(|_| "codex_storyboard_operator_publish_failed".to_string())?;
    file.write_all(bytes)
        .and_then(|_| file.sync_all())
        .map_err(|_| "codex_storyboard_operator_publish_failed".to_string())?;
    drop(file);
    if inject {
        let _ = dir.remove_file(&temp);
        return fail("codex_storyboard_operator_publish_failed");
    }
    let linked = dir.hard_link(&temp, dir, name);
    let _ = dir.remove_file(&temp);
    match linked {
        Ok(()) => Ok(()),
        Err(_) if exists(dir, name) => fail("codex_storyboard_operator_output_exists"),
        Err(_) => fail("codex_storyboard_operator_publish_failed"),
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
    let mut parts = Vec::new();
    for (i, r) in refs.iter().enumerate() {
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
    parts.push(
        string(
            o.get("prompt")
                .and_then(Value::as_object)
                .ok_or_else(|| "codex_storyboard_operator_request_invalid".to_string())?,
            "primaryRequest",
        )?
        .to_string(),
    );
    Ok(parts.join("\n"))
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
            .filter(|value| !value.trim().is_empty())
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
    for (entry_value, reference_value) in refs.iter().zip(current) {
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
fn complete(
    package_argument: &str,
    candidate_path: &str,
    manifest_path: &str,
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
    } else if let Err(code) = publish(&outputs.dir, "candidate.png", &bytes, false) {
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
    let result = json!({"schemaVersion":1,"jobId":o["jobId"],"projectId":o["projectId"],"episodeId":o["episodeId"],"shotId":o["shotId"],"provider":PROVIDER,"requestDigest":request_digest,"referenceDigests":references,"generationMode":"codex_builtin_imagegen","finalPrompt":manifest_prompt,"output":{"relativePath":"outputs/candidate.png","sha256":candidate_digest,"width":width,"height":height,"mimeType":"image/png"},"completedAt":"1970-01-01T00:00:00.000Z","state":"completed"});
    let result_bytes = serde_json::to_vec_pretty(&result)
        .map_err(|_| "codex_storyboard_operator_publish_failed".to_string())?;
    let inject = env::var("NODE_ENV").ok().as_deref() == Some("test")
        && env::var("CODEX_STORYBOARD_TEST_FAIL_RESULT_PUBLISH")
            .ok()
            .as_deref()
            == Some("1");
    publish(&outputs.dir, "result.json", &result_bytes, inject)?;
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
    let result = if args.len() == 8
        && args[1] == "complete"
        && args[2] == "--package"
        && args[4] == "--candidate"
        && args[6] == "--inspection-manifest"
    {
        complete(&args[3], &args[5], &args[7])
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
}
