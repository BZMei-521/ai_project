use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
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
    pub normalized_path: String,
    pub receipt_path: String,
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
pub struct NormalizedVideoSegment {
    pub credential: NormalizationCredential,
    pub probe: VideoProbe,
    pub anomalies: VideoAnomalyReport,
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
            "-show_packets",
            "-show_entries",
            "packet=stream_index,pts,dts:stream=index,codec_type,codec_name,pix_fmt,width,height,avg_frame_rate,r_frame_rate,sample_rate,channels:format=duration",
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
    let mut packet_count = 0_u64;
    let mut monotonic = true;
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
        || (probe.duration_seconds - expected_duration).abs() > (1.0 / 24.0 + 0.005)
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
    let output_path = output_dir.join(format!("{segment_id}.mp4"));
    let receipt_path = output_dir.join(format!("{segment_id}.normalized.json"));
    validate_publish_target(&output_path, &asset_root)?;
    validate_publish_target(&receipt_path, &asset_root)?;
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
            normalized_path: canonical_output.to_string_lossy().to_string(),
            receipt_path: receipt_path.to_string_lossy().to_string(),
            sha256,
            byte_length,
            modified_unix_millis,
            project_width,
            project_height,
            duration_frames,
            probe: probe.clone(),
        })
    })();
    let credential = match build_credential {
        Ok(value) => value,
        Err(error) => {
            let _ = fs::remove_file(&output_path);
            return Err(error);
        }
    };
    let serialized = serde_json::to_vec_pretty(&credential)
        .map_err(|_| "normalization_receipt_invalid".to_string())?;
    let mut receipt = match OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&receipt_path)
    {
        Ok(value) => value,
        Err(_) => {
            let _ = fs::remove_file(&output_path);
            return Err("normalization_receipt_exists".to_string());
        }
    };
    if receipt.write_all(&serialized).is_err() || receipt.sync_all().is_err() {
        let _ = fs::remove_file(&receipt_path);
        let _ = fs::remove_file(&output_path);
        return Err("normalization_receipt_write_failed".to_string());
    }
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
    for segment in segments {
        if segment.schema_version != NORMALIZED_SCHEMA_VERSION
            || segment.normalized_path.trim().is_empty()
            || segment.receipt_path.trim().is_empty()
            || segment.sha256.len() != 64
            || !segment
                .sha256
                .bytes()
                .all(|value| value.is_ascii_hexdigit() && !value.is_ascii_uppercase())
        {
            return Err("normalization_credential_missing".to_string());
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
    supplied: &NormalizationCredential,
) -> Result<PathBuf, String> {
    validate_concat_contract(std::slice::from_ref(supplied))?;
    let normalized = canonical_existing_file(&supplied.normalized_path, project_root, asset_root)?;
    let receipt = canonical_existing_file(&supplied.receipt_path, project_root, asset_root)?;
    if !normalized.starts_with(asset_root) || !receipt.starts_with(asset_root) {
        return Err("normalization_credential_outside_assets".to_string());
    }
    let stored: NormalizationCredential = serde_json::from_slice(
        &fs::read(&receipt).map_err(|_| "normalization_receipt_unreadable".to_string())?,
    )
    .map_err(|_| "normalization_receipt_invalid".to_string())?;
    if &stored != supplied
        || fs::canonicalize(&stored.normalized_path).ok().as_ref() != Some(&normalized)
        || fs::canonicalize(&stored.receipt_path).ok().as_ref() != Some(&receipt)
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
    if target.exists() {
        return Err("video_snapshot_collision".to_string());
    }
    fs::copy(source, target).map_err(|_| "video_snapshot_copy_failed".to_string())?;
    let (sha256, _, _) = file_binding(target)?;
    if sha256 != expected_sha {
        let _ = fs::remove_file(target);
        return Err("normalized_file_changed_during_snapshot".to_string());
    }
    Ok(())
}

fn extract_frame(source: &Path, timestamp: f64, output: &Path) -> Result<(), String> {
    let status = Command::new("ffmpeg")
        .args(["-v", "error", "-ss", &format!("{timestamp:.9}"), "-i"])
        .arg(source)
        .args(["-frames:v", "1", "-an", "-n"])
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
    credential: &NormalizationCredential,
) -> Result<VideoReviewFrames, String> {
    let project_root =
        fs::canonicalize(project_root).map_err(|_| "video_project_root_unavailable".to_string())?;
    let asset_root =
        fs::canonicalize(asset_root).map_err(|_| "video_assets_root_invalid".to_string())?;
    let source = verify_credential(&project_root, &asset_root, credential)?;
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
    let middle_seconds = (credential.duration_frames / 2) as f64 / 24.0;
    let last_seconds = credential.duration_frames.saturating_sub(1) as f64 / 24.0;
    let extraction = extract_frame(&snapshot, 0.0, &first)
        .and_then(|_| extract_frame(&snapshot, middle_seconds, &middle))
        .and_then(|_| extract_frame(&snapshot, last_seconds, &last));
    let _ = fs::remove_file(&snapshot);
    if let Err(error) = extraction {
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
    segments: &[NormalizationCredential],
) -> Result<ConcatenatedVideo, String> {
    validate_concat_contract(segments)?;
    let project_root =
        fs::canonicalize(project_root).map_err(|_| "video_project_root_unavailable".to_string())?;
    let asset_root =
        fs::canonicalize(asset_root).map_err(|_| "video_assets_root_invalid".to_string())?;
    let assembled_root = ensure_derived_dir(
        &asset_root,
        "video-assembled",
        "video_concat_directory_failed",
    )?;
    let suffix = unique_suffix()?;
    let stage_dir = assembled_root.join(format!(".concat-stage-{suffix}"));
    fs::create_dir(&stage_dir).map_err(|_| "video_concat_stage_failed".to_string())?;
    let result = (|| -> Result<ConcatenatedVideo, String> {
        let mut list = String::new();
        let mut reference_probe: Option<VideoProbe> = None;
        for (index, credential) in segments.iter().enumerate() {
            let source = verify_credential(&project_root, &asset_root, credential)?;
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
        let output_path = assembled_root.join(format!("assembled-{suffix}.mp4"));
        let temp_path = assembled_root.join(format!(".assembled-{suffix}.tmp.mp4"));
        validate_publish_target(&output_path, &asset_root)?;
        validate_publish_target(&temp_path, &asset_root)?;
        let first = &segments[0];
        let filter = format!(
            "fps=24,scale={}:{},setsar=1,format=yuv420p",
            first.project_width, first.project_height
        );
        let status = Command::new("ffmpeg")
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
            segments.iter().map(|item| item.duration_frames).sum(),
        )?;
        publish_no_clobber(&temp_path, &output_path)?;
        Ok(ConcatenatedVideo {
            output_path: fs::canonicalize(output_path)
                .map_err(|_| "video_atomic_publish_failed".to_string())?
                .to_string_lossy()
                .to_string(),
            probe,
        })
    })();
    let _ = fs::remove_dir_all(stage_dir);
    result
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
    let input = canonical_existing_file(&input_path, &project_root, &asset_root)?;
    normalize_at_roots(
        &project_root,
        &asset_root,
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
    extract_review_frames_at_roots(&project_root, &asset_root, &credential)
}

#[tauri::command]
pub fn concat_normalized_video_segments(
    app: tauri::AppHandle,
    project_assets_dir: String,
    segments: Vec<NormalizationCredential>,
) -> Result<ConcatenatedVideo, String> {
    let (project_root, asset_root) = resolve_roots(&app, &project_assets_dir)?;
    concat_at_roots(&project_root, &asset_root, &segments)
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
        normalized_path: format!("C:\\project\\{name}.mp4"),
        receipt_path: format!("C:\\project\\{name}.normalized.json"),
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
            Self(root)
        }

        fn root(&self) -> &Path {
            &self.0
        }

        fn assets(&self) -> PathBuf {
            self.0.join("assets")
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
    fn concat_preflight_rejects_missing_receipt_non_24fps_and_dimension_mismatch() {
        let base = test_credential("one", 1280, 720, 24, 1);
        let mut missing = base.clone();
        missing.receipt_path.clear();
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
        wrong_size.probe.width = 1920;
        assert_eq!(
            validate_concat_contract(&[base, wrong_size]).unwrap_err(),
            "normalized_segment_dimensions_mismatch"
        );
    }

    #[test]
    fn ffprobe_fixture_reports_exact_stream_contract_and_monotonic_timestamps() {
        let fixture = FixtureDir::new("probe");
        let input = fixture.assets().join("raw/probe.mp4");
        make_fixture(&input, 24, "320x240", "1", false);
        let probe = probe_path(&input).unwrap();
        assert_eq!((probe.width, probe.height), (320, 240));
        assert_eq!((probe.fps_num, probe.fps_den), (24, 1));
        assert_eq!(probe.video_codec, "h264");
        assert_eq!(probe.pixel_format, "yuv420p");
        assert_eq!(probe.audio_sample_rate, Some(48_000));
        assert_eq!(probe.audio_channels, Some(2));
        assert!(probe.has_monotonic_timestamps);
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

        let frames = extract_review_frames_at_roots(
            fixture.root(),
            fixture.assets().as_path(),
            &first_result.credential,
        )
        .unwrap();
        assert!(Path::new(&frames.first_frame_path).is_file());
        assert!(Path::new(&frames.middle_frame_path).is_file());
        assert!(Path::new(&frames.last_frame_path).is_file());

        let assembled = concat_at_roots(
            fixture.root(),
            fixture.assets().as_path(),
            &[first_result.credential, second_result.credential],
        )
        .unwrap();
        assert!(Path::new(&assembled.output_path).is_file());
        assert_eq!((assembled.probe.fps_num, assembled.probe.fps_den), (24, 1));
        assert_eq!((assembled.probe.width, assembled.probe.height), (320, 240));
    }
}
