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
    pub request_digest: String,
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

fn reject_symlink(path: &Path, code: &str) -> Result<(), String> {
    let metadata = fs::symlink_metadata(path).map_err(|_| code.to_string())?;
    if metadata.file_type().is_symlink() {
        return Err(code.to_string());
    }
    Ok(())
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

fn sha256_file(path: &Path) -> Result<String, String> {
    let mut file = File::open(path).map_err(|_| "codex_storyboard_file_unreadable".to_string())?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let count = file
            .read(&mut buffer)
            .map_err(|_| "codex_storyboard_file_unreadable".to_string())?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn inspect_image(
    path: &Path,
    invalid_code: &str,
) -> Result<(u32, u32, String, &'static str), String> {
    let mut header = [0_u8; 12];
    let count = File::open(path)
        .and_then(|mut file| file.read(&mut header))
        .map_err(|_| invalid_code.to_string())?;
    let (mime, extension) = if count >= 8 && header[..8] == [137, 80, 78, 71, 13, 10, 26, 10] {
        ("image/png".to_string(), "png")
    } else if count >= 3 && header[..3] == [0xff, 0xd8, 0xff] {
        ("image/jpeg".to_string(), "jpg")
    } else {
        return Err(invalid_code.to_string());
    };
    let dimensions = image::open(path)
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
    if fs::symlink_metadata(path).is_ok() {
        return Err(exists_code.to_string());
    }
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
    if fs::symlink_metadata(path).is_ok() {
        return Err(exists_code.to_string());
    }
    fs::rename(&temporary, path).map_err(|_| "codex_storyboard_publish_failed".to_string())
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

fn copy_snapshot(source: &Path, destination: &Path) -> Result<(), String> {
    let mut input =
        File::open(source).map_err(|_| "codex_storyboard_reference_unreadable".to_string())?;
    let mut output = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(destination)
        .map_err(|_| "codex_storyboard_snapshot_exists".to_string())?;
    std::io::copy(&mut input, &mut output)
        .and_then(|_| output.sync_all())
        .map_err(|_| "codex_storyboard_snapshot_write_failed".to_string())?;
    Ok(())
}

fn prepare_at_roots(
    project: &Path,
    assets: &Path,
    request: PrepareCodexStoryboardJobRequest,
) -> Result<CodexStoryboardExportReceipt, String> {
    validate_prepare_request(&request)?;
    let (project, assets) = ensure_child_root(project, assets)?;
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

    struct SourceInfo {
        source: PathBuf,
        sha256: String,
        width: u32,
        height: u32,
        mime_type: String,
        extension: &'static str,
    }
    let mut sources = Vec::with_capacity(request.references.len());
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
        let (width, height, mime_type, extension) =
            inspect_image(&source, "codex_storyboard_reference_image_invalid")?;
        let sha256 = sha256_file(&source)
            .map_err(|_| "codex_storyboard_reference_unreadable".to_string())?;
        sources.push(SourceInfo {
            source,
            sha256,
            width,
            height,
            mime_type,
            extension,
        });
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

    let mut immutable_references = Vec::with_capacity(request.references.len());
    for (index, (reference, source)) in request.references.iter().zip(sources.iter()).enumerate() {
        let usage = reference.usage.replace('_', "-");
        let filename = format!("{:02}-{usage}.{}", index + 1, source.extension);
        let relative_path = format!("inputs/{filename}");
        let destination = inputs.join(&filename);
        copy_snapshot(&source.source, &destination)?;
        if sha256_file(&destination)
            .map_err(|_| "codex_storyboard_snapshot_verify_failed".to_string())?
            != source.sha256
        {
            return Err("codex_storyboard_snapshot_verify_failed".to_string());
        }
        immutable_references.push(CodexStoryboardReference {
            id: reference.id.clone(),
            usage: reference.usage.clone(),
            instruction: reference.instruction.trim().to_string(),
            relative_path,
            sha256: source.sha256.clone(),
            width: source.width,
            height: source.height,
            mime_type: source.mime_type.clone(),
        });
    }

    let immutable = CodexStoryboardRequest {
        schema_version: 1,
        job_id: request.job_id.clone(),
        project_id: request.project_id,
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

fn load_json_no_follow<T: for<'de> Deserialize<'de>>(path: &Path, code: &str) -> Result<T, String> {
    reject_symlink(path, code)?;
    let mut bytes = Vec::new();
    File::open(path)
        .and_then(|mut file| file.read_to_end(&mut bytes))
        .map_err(|_| code.to_string())?;
    serde_json::from_slice(&bytes).map_err(|_| code.to_string())
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
    if request.request_digest.len() != 64
        || !request
            .request_digest
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err("codex_storyboard_request_digest_invalid".to_string());
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

fn import_at_roots(
    project: &Path,
    assets: &Path,
    request: ImportCodexStoryboardResultRequest,
) -> Result<CodexStoryboardImportReceipt, String> {
    validate_import_request(&request)?;
    let (project, _) = ensure_child_root(project, assets)?;
    let requested_project = fs::canonicalize(Path::new(&request.project_path))
        .map_err(|_| "codex_storyboard_project_path_invalid".to_string())?;
    if requested_project != project {
        return Err("codex_storyboard_project_identity_mismatch".to_string());
    }
    let jobs = project.join("codex-storyboard-jobs");
    reject_symlink(&jobs, "codex_storyboard_jobs_root_escape")?;
    let package_raw = jobs.join(&request.job_id);
    reject_symlink(&package_raw, "codex_storyboard_package_escape")?;
    let package = fs::canonicalize(&package_raw)
        .map_err(|_| "codex_storyboard_package_missing".to_string())?;
    if !package.is_dir() || !package.starts_with(&project) {
        return Err("codex_storyboard_package_escape".to_string());
    }
    let marker_path = package.join("outputs/import-receipt.json");
    if fs::symlink_metadata(&marker_path).is_ok() {
        return Err("codex_storyboard_result_already_imported".to_string());
    }

    let request_path = package.join("request.json");
    let immutable: CodexStoryboardRequest =
        load_json_no_follow(&request_path, "codex_storyboard_request_invalid")?;
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
    if canonical_request_digest != request.request_digest {
        return Err("codex_storyboard_request_digest_mismatch".to_string());
    }
    for reference in &immutable.references {
        if !safe_relative_path(&reference.relative_path)
            || !reference.relative_path.starts_with("inputs/")
        {
            return Err("codex_storyboard_reference_path_escape".to_string());
        }
        let raw = package.join(&reference.relative_path);
        reject_symlink(&raw, "codex_storyboard_reference_path_escape")?;
        let snapshot =
            fs::canonicalize(&raw).map_err(|_| "codex_storyboard_reference_missing".to_string())?;
        if !snapshot.is_file() || !snapshot.starts_with(&package) {
            return Err("codex_storyboard_reference_path_escape".to_string());
        }
        let actual_digest = sha256_file(&snapshot)
            .map_err(|_| "codex_storyboard_reference_unreadable".to_string())?;
        if actual_digest != reference.sha256 {
            return Err("codex_storyboard_reference_digest_mismatch".to_string());
        }
        let (width, height, mime_type, _) =
            inspect_image(&snapshot, "codex_storyboard_reference_image_invalid")?;
        if width != reference.width
            || height != reference.height
            || mime_type != reference.mime_type
        {
            return Err("codex_storyboard_reference_metadata_mismatch".to_string());
        }
    }

    let result_path = package.join("outputs/result.json");
    let result: CodexStoryboardResult =
        load_json_no_follow(&result_path, "codex_storyboard_result_invalid")?;
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

    let candidate_raw = package.join("outputs/candidate.png");
    reject_symlink(&candidate_raw, "codex_storyboard_candidate_escape")?;
    let candidate = fs::canonicalize(&candidate_raw)
        .map_err(|_| "codex_storyboard_candidate_missing".to_string())?;
    if !candidate.is_file() || !candidate.starts_with(&package) {
        return Err("codex_storyboard_candidate_escape".to_string());
    }
    if sha256_file(&candidate).map_err(|_| "codex_storyboard_candidate_unreadable".to_string())?
        != result.output.sha256
    {
        return Err("codex_storyboard_candidate_digest_mismatch".to_string());
    }
    let (width, height, mime_type, _) =
        inspect_image(&candidate, "codex_storyboard_candidate_invalid")?;
    if width != result.output.width
        || height != result.output.height
        || mime_type != result.output.mime_type
    {
        return Err("codex_storyboard_candidate_metadata_mismatch".to_string());
    }

    let receipt = CodexStoryboardImportReceipt {
        schema_version: 1,
        job_id: request.job_id,
        result_path: result_path.to_string_lossy().to_string(),
        result,
        status: "needs_review".to_string(),
        candidate_path: candidate.to_string_lossy().to_string(),
    };
    publish_json(
        &marker_path,
        &receipt,
        "codex_storyboard_result_already_imported",
    )?;
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

#[tauri::command]
pub fn prepare_codex_storyboard_job(
    app: tauri::AppHandle,
    request: PrepareCodexStoryboardJobRequest,
) -> Result<CodexStoryboardExportReceipt, String> {
    let project = active_project_path(&app, &request.project_path)?;
    prepare_at_roots(&project, &project, request)
}

#[tauri::command]
pub fn import_codex_storyboard_result(
    app: tauri::AppHandle,
    request: ImportCodexStoryboardResultRequest,
) -> Result<CodexStoryboardImportReceipt, String> {
    let project = active_project_path(&app, &request.project_path)?;
    import_at_roots(&project, &project, request)
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{ImageBuffer, Rgba};
    use serde_json::{json, Value};
    use sha2::{Digest, Sha256};
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};

    struct Fixture {
        project: PathBuf,
        assets: PathBuf,
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

    fn fixture(label: &str) -> Fixture {
        let project = unique_root(label).join("project.sbproj");
        let assets = project.join("assets");
        fs::create_dir_all(&assets).unwrap();
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

    fn import_request(
        fixture: &Fixture,
        task_status: &str,
        request_digest: &str,
    ) -> ImportCodexStoryboardResultRequest {
        ImportCodexStoryboardResultRequest {
            schema_version: 1,
            job_id: fixture.request.job_id.clone(),
            project_id: fixture.request.project_id.clone(),
            episode_id: fixture.request.episode_id.clone(),
            shot_id: fixture.request.shot_id.clone(),
            provider: fixture.request.provider.clone(),
            project_path: fixture.request.project_path.clone(),
            task_status: task_status.to_string(),
            request_digest: request_digest.to_string(),
        }
    }

    #[test]
    fn exports_ordered_snapshots_then_publishes_request_without_touching_accepted_image() {
        let fixture = fixture("export");
        let accepted_before = fs::read(&fixture.accepted).unwrap();
        let mut permissions = fs::metadata(&fixture.accepted).unwrap().permissions();
        permissions.set_readonly(true);
        fs::set_permissions(&fixture.accepted, permissions).unwrap();

        let receipt =
            prepare_at_roots(&fixture.project, &fixture.assets, fixture.request.clone()).unwrap();

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
            prepare_at_roots(&fixture.project, &fixture.assets, fixture.request.clone())
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
            prepare_at_roots(&fixture.project, &fixture.assets, request).unwrap_err(),
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
            prepare_at_roots(&fixture.project, &outside, fixture.request.clone()).unwrap_err(),
            "codex_storyboard_assets_root_outside_project"
        );
    }

    #[test]
    fn import_rejects_cancelled_identity_mismatch_tampering_and_replay() {
        let cancelled_fixture = fixture("cancelled");
        let cancelled_receipt = prepare_at_roots(
            &cancelled_fixture.project,
            &cancelled_fixture.assets,
            cancelled_fixture.request.clone(),
        )
        .unwrap();
        publish_result(&cancelled_receipt, |_| {});
        assert_eq!(
            import_at_roots(
                &cancelled_fixture.project,
                &cancelled_fixture.assets,
                import_request(
                    &cancelled_fixture,
                    "cancelled",
                    &cancelled_receipt.request_digest
                ),
            )
            .unwrap_err(),
            "codex_storyboard_task_cancelled"
        );

        let mismatch_fixture = fixture("mismatch");
        let mismatch_receipt = prepare_at_roots(
            &mismatch_fixture.project,
            &mismatch_fixture.assets,
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
                import_request(
                    &mismatch_fixture,
                    "queued",
                    &mismatch_receipt.request_digest
                ),
            )
            .unwrap_err(),
            "codex_storyboard_result_identity_mismatch"
        );

        let tampered_fixture = fixture("tampered");
        let tampered_receipt = prepare_at_roots(
            &tampered_fixture.project,
            &tampered_fixture.assets,
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
                import_request(
                    &tampered_fixture,
                    "queued",
                    &tampered_receipt.request_digest
                ),
            )
            .unwrap_err(),
            "codex_storyboard_reference_digest_mismatch"
        );

        let valid_fixture = fixture("valid-import");
        let valid_receipt = prepare_at_roots(
            &valid_fixture.project,
            &valid_fixture.assets,
            valid_fixture.request.clone(),
        )
        .unwrap();
        publish_result(&valid_receipt, |_| {});
        let valid_import = import_at_roots(
            &valid_fixture.project,
            &valid_fixture.assets,
            import_request(&valid_fixture, "queued", &valid_receipt.request_digest),
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
                import_request(&valid_fixture, "queued", &valid_receipt.request_digest),
            )
            .unwrap_err(),
            "codex_storyboard_result_already_imported"
        );
    }

    #[test]
    fn import_rejects_request_and_result_rewritten_to_a_new_digest() {
        let fixture = fixture("rewritten-request");
        let receipt =
            prepare_at_roots(&fixture.project, &fixture.assets, fixture.request.clone()).unwrap();
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
                import_request(&fixture, "queued", &receipt.request_digest),
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
            prepare_at_roots(&fixture.project, &fixture.assets, request).unwrap_err(),
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
            return;
        }
        let mut request = fixture.request.clone();
        request.references[0].source_path = link.to_string_lossy().to_string();
        assert_eq!(
            prepare_at_roots(&fixture.project, &fixture.assets, request).unwrap_err(),
            "codex_storyboard_reference_path_escape"
        );
    }
}
