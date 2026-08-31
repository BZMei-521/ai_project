use image::GenericImageView;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

const MAX_ARTIFACT_BYTES: usize = 64 * 1024 * 1024;
const PNG_SIGNATURE: [u8; 8] = [137, 80, 78, 71, 13, 10, 26, 10];

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteSpatialControlArtifactRequest {
    pub project_assets_dir: String,
    pub stage_id: String,
    pub shot_id: String,
    pub kind: String,
    pub png_bytes: Vec<u8>,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpatialControlArtifactReceipt {
    pub kind: String,
    pub file_path: String,
    pub sha256: String,
    pub width: u32,
    pub height: u32,
    pub byte_length: usize,
}

fn safe_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 100
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
}

fn safe_kind(value: &str) -> bool {
    matches!(value, "color" | "depth" | "normal" | "character_id" | "prop_id" | "environment_id" | "pose")
}

fn canonical_directory(value: &str) -> Result<PathBuf, String> {
    let root = fs::canonicalize(Path::new(value))
        .map_err(|error| format!("spatial_control_asset_root_invalid:{error}"))?;
    if !root.is_dir() {
        return Err("spatial_control_asset_root_invalid".to_string());
    }
    Ok(root)
}

#[tauri::command]
pub fn write_spatial_control_artifact(
    request: WriteSpatialControlArtifactRequest,
) -> Result<SpatialControlArtifactReceipt, String> {
    if !safe_identifier(&request.stage_id) {
        return Err("spatial_control_stage_id_invalid".to_string());
    }
    if !safe_identifier(&request.shot_id) {
        return Err("spatial_control_shot_id_invalid".to_string());
    }
    if !safe_kind(&request.kind) {
        return Err("spatial_control_kind_invalid".to_string());
    }
    if request.png_bytes.len() < PNG_SIGNATURE.len()
        || request.png_bytes.len() > MAX_ARTIFACT_BYTES
        || request.png_bytes[..PNG_SIGNATURE.len()] != PNG_SIGNATURE
    {
        return Err("spatial_control_png_invalid".to_string());
    }
    if request.width == 0 || request.height == 0 || request.width > 8192 || request.height > 8192 {
        return Err("spatial_control_dimensions_invalid".to_string());
    }
    let image = image::load_from_memory_with_format(&request.png_bytes, image::ImageFormat::Png)
        .map_err(|error| format!("spatial_control_png_invalid:{error}"))?;
    if image.dimensions() != (request.width, request.height) {
        return Err("spatial_control_dimensions_mismatch".to_string());
    }

    let root = canonical_directory(&request.project_assets_dir)?;
    let artifact_dir = root
        .join("spatial-control")
        .join(&request.stage_id)
        .join(&request.shot_id);
    fs::create_dir_all(&artifact_dir)
        .map_err(|error| format!("spatial_control_directory_failed:{error}"))?;
    let artifact_dir = fs::canonicalize(&artifact_dir)
        .map_err(|error| format!("spatial_control_directory_failed:{error}"))?;
    if !artifact_dir.starts_with(&root) {
        return Err("spatial_control_directory_escape".to_string());
    }

    let sha256 = format!("{:x}", Sha256::digest(&request.png_bytes));
    let artifact_path = artifact_dir.join(format!("{}-{}.png", request.kind, sha256));
    if !artifact_path.exists() {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&artifact_path)
            .map_err(|error| format!("spatial_control_write_failed:{error}"))?;
        file.write_all(&request.png_bytes)
            .map_err(|error| format!("spatial_control_write_failed:{error}"))?;
        file.sync_all()
            .map_err(|error| format!("spatial_control_write_failed:{error}"))?;
    }
    let canonical_path = fs::canonicalize(&artifact_path)
        .map_err(|error| format!("spatial_control_write_failed:{error}"))?;
    if !canonical_path.starts_with(&root) {
        return Err("spatial_control_file_escape".to_string());
    }

    Ok(SpatialControlArtifactReceipt {
        kind: request.kind,
        file_path: canonical_path.to_string_lossy().to_string(),
        sha256,
        width: request.width,
        height: request.height,
        byte_length: request.png_bytes.len(),
    })
}
