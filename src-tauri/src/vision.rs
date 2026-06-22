use std::{
    env, fs,
    io::{BufRead, BufReader, Read},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{Arc, Mutex},
    thread,
};

use tauri::{AppHandle, Emitter};
use uuid::Uuid;

use crate::{
    runtime::{ensure_runtime_ready, RuntimePaths},
    types::{FrameAnalysisResponse, FrameScanEvent, ModerationSettings},
};

const FRAME_SCAN_MODULE: &str = "al_iyaal_worker.vision_scan";
const MLX_VLM_PACKAGE: &str = "mlx-vlm==0.4.4";
const TORCHVISION_PACKAGE: &str = "torchvision==0.26.0";
const FRAME_SCAN_EVENT_NAME: &str = "frame-scan-event";
const FRAME_SCAN_PROGRESS_PREFIX: &str = "AIYAAL_FRAME_SCAN:";

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct FrameScanProgressLine {
    stage: String,
    message: String,
    current: Option<usize>,
    total: Option<usize>,
}

pub fn is_supported_frame_scan_path(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|value| value.to_str())
            .map(|value| value.to_ascii_lowercase())
            .as_deref(),
        Some("mp4") | Some("mov")
    )
}

pub fn frame_analysis_sidecar_path(video_path: &Path) -> PathBuf {
    video_path.with_file_name(format!(
        "{}.frames.analysis.json",
        video_path
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or("video")
    ))
}

pub async fn scan_video_frames(
    app: &AppHandle,
    video_path: PathBuf,
    settings: ModerationSettings,
    sample_interval_seconds: f32,
) -> Result<FrameAnalysisResponse, String> {
    let runtime = ensure_runtime_ready(app).await?;
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        run_frame_scan(app, runtime, video_path, settings, sample_interval_seconds)
    })
    .await
    .map_err(|error| format!("Failed waiting for frame scan task: {error}"))?
}

fn run_frame_scan(
    app: AppHandle,
    runtime: RuntimePaths,
    video_path: PathBuf,
    settings: ModerationSettings,
    sample_interval_seconds: f32,
) -> Result<FrameAnalysisResponse, String> {
    if env::consts::ARCH != "aarch64" {
        return Err("Flagged Frames POC currently requires Apple Silicon.".to_string());
    }

    ensure_mlx_vlm_installed(&runtime.python_executable)?;
    ensure_torchvision_installed(&runtime.python_executable)?;
    let worker_src_dir = runtime
        .worker_script
        .parent()
        .map(|parent| parent.join("src"))
        .ok_or_else(|| "Failed to resolve worker source directory.".to_string())?;
    let worker_python_path = worker_src_dir.to_string_lossy().to_string();
    let merged_python_path = match env::var("PYTHONPATH") {
        Ok(existing) if !existing.is_empty() => format!("{worker_python_path}:{existing}"),
        _ => worker_python_path,
    };

    let venv_bin_dir = runtime
        .python_executable
        .parent()
        .map(PathBuf::from)
        .ok_or_else(|| "Failed to resolve Python venv bin directory.".to_string())?;
    let merged_path = match env::var("PATH") {
        Ok(existing) if !existing.is_empty() => {
            format!("{}:{existing}", venv_bin_dir.to_string_lossy())
        }
        _ => venv_bin_dir.to_string_lossy().to_string(),
    };

    let settings_path = env::temp_dir().join(format!(
        "al-iyaal-frame-scan-settings-{}.json",
        Uuid::new_v4()
    ));
    let settings_json = serde_json::to_string(&settings).map_err(|error| {
        format!("Failed serializing moderation settings for frame scan: {error}")
    })?;
    fs::write(&settings_path, settings_json).map_err(|error| {
        format!(
            "Failed writing frame scan settings {}: {error}",
            settings_path.display()
        )
    })?;
    let expected_output_path = frame_analysis_sidecar_path(&video_path);

    let scan_result = (|| -> Result<FrameAnalysisResponse, String> {
        let video_path_string = video_path.to_string_lossy().to_string();
        emit_frame_scan_event(
            &app,
            FrameScanEvent {
                video_path: video_path_string.clone(),
                stage: "starting".to_string(),
                message: format!(
                    "Starting local frame scan for {} at {}s intervals.",
                    video_path
                        .file_name()
                        .and_then(|value| value.to_str())
                        .unwrap_or("video"),
                    sample_interval_seconds
                ),
                current: None,
                total: None,
            },
        );
        eprintln!(
            "[frame-scan] starting video={} interval={}s",
            video_path.display(),
            sample_interval_seconds
        );

        let mut child = Command::new(&runtime.python_executable)
            .arg("-m")
            .arg(FRAME_SCAN_MODULE)
            .arg("--video-path")
            .arg(&video_path)
            .arg("--settings-path")
            .arg(&settings_path)
            .arg("--interval-seconds")
            .arg(sample_interval_seconds.to_string())
            .env("PYTHONUNBUFFERED", "1")
            .env("PYTHONPATH", merged_python_path)
            .env("PATH", merged_path)
            .env(
                "AIYAAL_FFMPEG_PATH",
                runtime.ffmpeg_executable.to_string_lossy().to_string(),
            )
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| {
                format!(
                    "Failed to start frame scan with {}: {error}",
                    runtime.python_executable.display()
                )
            })?;

        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| "Failed to capture frame scan stderr.".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Failed to capture frame scan stdout.".to_string())?;

        let stderr_lines = Arc::new(Mutex::new(Vec::<String>::new()));
        let stderr_lines_for_thread = Arc::clone(&stderr_lines);
        let app_for_stderr = app.clone();
        let video_path_for_stderr = video_path_string.clone();
        let stderr_handle = thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines() {
                match line {
                    Ok(value) => {
                        let progress = parse_frame_scan_progress_line(&value);
                        eprintln!("[frame-scan] {value}");
                        if let Ok(mut lines) = stderr_lines_for_thread.lock() {
                            lines.push(value.clone());
                        }
                        if let Some(progress) = progress {
                            emit_frame_scan_event(
                                &app_for_stderr,
                                FrameScanEvent {
                                    video_path: video_path_for_stderr.clone(),
                                    stage: progress.stage,
                                    message: progress.message,
                                    current: progress.current,
                                    total: progress.total,
                                },
                            );
                        } else {
                            emit_frame_scan_event(
                                &app_for_stderr,
                                FrameScanEvent {
                                    video_path: video_path_for_stderr.clone(),
                                    stage: "runtime_log".to_string(),
                                    message: value,
                                    current: None,
                                    total: None,
                                },
                            );
                        }
                    }
                    Err(error) => {
                        eprintln!("[frame-scan] failed reading stderr: {error}");
                        break;
                    }
                }
            }
        });

        let stdout_handle = thread::spawn(move || -> Result<String, String> {
            let mut content = String::new();
            let mut reader = BufReader::new(stdout);
            reader
                .read_to_string(&mut content)
                .map_err(|error| format!("Failed reading frame scan stdout: {error}"))?;
            Ok(content)
        });

        let status = child
            .wait()
            .map_err(|error| format!("Failed waiting for frame scan process: {error}"))?;

        let _ = stderr_handle.join();
        let stdout = stdout_handle
            .join()
            .map_err(|_| "Frame scan stdout reader thread panicked.".to_string())??;
        let stderr_lines = stderr_lines
            .lock()
            .map(|lines| lines.clone())
            .unwrap_or_default();

        if !status.success() {
            let stderr = stderr_lines.join("\n");
            let stdout = stdout.trim().to_string();
            let detail = if !stderr.is_empty() { stderr } else { stdout };
            emit_frame_scan_event(
                &app,
                FrameScanEvent {
                    video_path: video_path_string,
                    stage: "failed".to_string(),
                    message: if detail.is_empty() {
                        format!("Frame scan failed with status {status}.")
                    } else {
                        format!("Frame scan failed: {detail}")
                    },
                    current: None,
                    total: None,
                },
            );
            return Err(if detail.is_empty() {
                format!("Frame scan failed with status {status}.")
            } else {
                format!("Frame scan failed: {detail}")
            });
        }

        eprintln!("[frame-scan] process finished successfully");

        let response: FrameAnalysisResponse = serde_json::from_str(stdout.trim())
            .map_err(|error| format!("Failed parsing frame scan response JSON: {error}"))?;
        let response = validate_frame_scan_response(response, &expected_output_path)?;

        emit_frame_scan_event(
            &app,
            FrameScanEvent {
                video_path: video_path_string,
                stage: "completed".to_string(),
                message: format!(
                    "Frame scan completed with {} flagged frame(s).",
                    response.flagged_count
                ),
                current: None,
                total: None,
            },
        );

        Ok(response)
    })();

    let _ = fs::remove_file(&settings_path);
    scan_result
}

fn ensure_mlx_vlm_installed(python_executable: &Path) -> Result<(), String> {
    let import_check = Command::new(python_executable)
        .args(["-c", "import mlx_vlm"])
        .output()
        .map_err(|error| format!("Failed to execute MLX-VLM import check: {error}"))?;

    if import_check.status.success() {
        return Ok(());
    }

    let install_output = Command::new(python_executable)
        .args(["-m", "pip", "install", MLX_VLM_PACKAGE])
        .output()
        .map_err(|error| format!("Failed to install MLX-VLM runtime package: {error}"))?;

    if install_output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&install_output.stderr);
    Err(format!(
        "Failed installing MLX-VLM runtime package `{MLX_VLM_PACKAGE}`: {stderr}"
    ))
}

fn ensure_torchvision_installed(python_executable: &Path) -> Result<(), String> {
    let import_check = Command::new(python_executable)
        .args(["-c", "import torchvision"])
        .output()
        .map_err(|error| format!("Failed to execute torchvision import check: {error}"))?;

    if import_check.status.success() {
        return Ok(());
    }

    let install_output = Command::new(python_executable)
        .args(["-m", "pip", "install", TORCHVISION_PACKAGE, "--no-deps"])
        .output()
        .map_err(|error| format!("Failed to install torchvision runtime package: {error}"))?;

    if install_output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&install_output.stderr);
    Err(format!(
        "Failed installing torchvision runtime package `{TORCHVISION_PACKAGE}`: {stderr}"
    ))
}

fn parse_frame_scan_progress_line(line: &str) -> Option<FrameScanProgressLine> {
    line.strip_prefix(FRAME_SCAN_PROGRESS_PREFIX)
        .and_then(|payload| serde_json::from_str(payload).ok())
}

fn validate_frame_scan_response(
    response: FrameAnalysisResponse,
    expected_output_path: &Path,
) -> Result<FrameAnalysisResponse, String> {
    if response.output_path.trim().is_empty() {
        return Err(format!(
            "Frame scan did not report an output path. Expected {}.",
            expected_output_path.display()
        ));
    }

    let reported_output_path = PathBuf::from(&response.output_path);
    if reported_output_path != expected_output_path {
        return Err(format!(
            "Frame scan wrote an unexpected sidecar path. Expected {} but got {}.",
            expected_output_path.display(),
            reported_output_path.display()
        ));
    }

    if !reported_output_path.is_file() {
        return Err(format!(
            "Frame scan reported an output path that does not exist: {}.",
            reported_output_path.display()
        ));
    }

    Ok(response)
}

fn emit_frame_scan_event(app: &AppHandle, event: FrameScanEvent) {
    let _ = app.emit(FRAME_SCAN_EVENT_NAME, event);
}

#[cfg(test)]
mod tests {
    use super::{
        frame_analysis_sidecar_path, is_supported_frame_scan_path, parse_frame_scan_progress_line,
        validate_frame_scan_response,
    };
    use crate::types::FrameAnalysisResponse;
    use std::{fs, path::Path};
    use uuid::Uuid;

    #[test]
    fn should_build_frame_analysis_sidecar_path() {
        let path = frame_analysis_sidecar_path(Path::new("/tmp/episode.clip.mp4"));
        assert_eq!(path, Path::new("/tmp/episode.clip.frames.analysis.json"));
    }

    #[test]
    fn should_accept_supported_frame_scan_extensions() {
        assert!(is_supported_frame_scan_path(Path::new("/tmp/video.mp4")));
        assert!(is_supported_frame_scan_path(Path::new("/tmp/video.mov")));
        assert!(!is_supported_frame_scan_path(Path::new("/tmp/video.mkv")));
    }

    #[test]
    fn should_parse_progress_lines_emitted_by_the_python_scan() {
        let line = r#"AIYAAL_FRAME_SCAN:{"stage":"caption","message":"Captioning frame.","current":1,"total":4}"#;

        assert_eq!(
            parse_frame_scan_progress_line(line).map(|progress| (
                progress.stage,
                progress.message,
                progress.current,
                progress.total
            )),
            Some((
                "caption".to_string(),
                "Captioning frame.".to_string(),
                Some(1),
                Some(4),
            ))
        );
    }

    #[test]
    fn should_reject_frame_scan_responses_that_point_at_the_wrong_sidecar_path() {
        let response = FrameAnalysisResponse {
            output_path: "/tmp/wrong.frames.analysis.json".to_string(),
            flagged_count: 0,
            summary: "No flags".to_string(),
        };

        let error =
            validate_frame_scan_response(response, Path::new("/tmp/expected.frames.analysis.json"))
                .unwrap_err();

        assert!(error.contains("unexpected sidecar path"));
    }

    #[test]
    fn should_accept_frame_scan_responses_that_write_the_expected_sidecar() {
        let base_dir = std::env::temp_dir().join(format!("al-iyaal-frame-scan-{}", Uuid::new_v4()));
        fs::create_dir_all(&base_dir).unwrap();
        let output_path = base_dir.join("episode.frames.analysis.json");
        fs::write(&output_path, "{}").unwrap();

        let response = FrameAnalysisResponse {
            output_path: output_path.to_string_lossy().to_string(),
            flagged_count: 0,
            summary: "No flags".to_string(),
        };

        let validated = validate_frame_scan_response(response, &output_path).unwrap();
        assert_eq!(
            validated.output_path,
            output_path.to_string_lossy().to_string()
        );

        fs::remove_dir_all(base_dir).unwrap();
    }
}
