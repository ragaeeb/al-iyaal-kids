use std::{
    fs,
    path::{Path, PathBuf},
};

use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;
use tokio::sync::oneshot;
use uuid::Uuid;

use crate::{
    file_discovery::{build_output_dir, collect_media_files, discover_srt_items, discover_video_items},
    ids::{to_file_name, to_job_id},
    protocol::WorkerCommand,
    state::AppState,
    types::{
        BatchEvent, BatchStartedResponse, BatchState, BatchStatus, CancelAck, CancelBatchRequest,
        CancelTaskRequest, CutJobStartedResponse, JobRecord, JobStatus, ListSrtFilesRequest,
        ListVideosRequest, ModerationRule, ModerationSettings, SaveAck, SrtListItem,
        StartBatchRequest, StartCutJobRequest, StartFlagBatchRequest, StartTranscriptionBatchRequest,
        TaskCancelAck, TaskJobRecord, TaskJobStatus, TaskKind, TaskState, TaskStatus, VideoListItem,
        WorkerStatusKind,
    },
    worker::ensure_worker_sender,
};

const BATCH_EVENT_NAME: &str = "batch-event";

fn ensure_supported_output_mode(output_dir_mode: &str) -> Result<(), String> {
    if output_dir_mode != "audio_replaced_default" {
        return Err("Unsupported output mode. Use audio_replaced_default.".to_string());
    }

    Ok(())
}

fn ensure_supported_cut_output_mode(output_mode: &str) -> Result<(), String> {
    if output_mode != "video_cleaned_default" {
        return Err("Unsupported cut output mode. Use video_cleaned_default.".to_string());
    }

    Ok(())
}

fn ensure_supported_cancel_mode(mode: &str) -> Result<(), String> {
    if mode != "stop_after_current" {
        return Err("Unsupported cancellation mode. Use stop_after_current.".to_string());
    }

    Ok(())
}

fn ensure_supported_yap_mode(yap_mode: &str) -> Result<(), String> {
    if yap_mode != "auto" {
        return Err("Unsupported yap mode. Use auto.".to_string());
    }

    Ok(())
}

fn validate_paths_have_extensions(paths: &[String], allowed_extensions: &[String]) -> Result<(), String> {
    let normalized_extensions = allowed_extensions
        .iter()
        .map(|value| value.trim().to_ascii_lowercase())
        .map(|value| if value.starts_with('.') { value } else { format!(".{value}") })
        .collect::<Vec<_>>();

    for path in paths {
        let extension = Path::new(path)
            .extension()
            .and_then(|value| value.to_str())
            .map(|value| format!(".{}", value.to_ascii_lowercase()))
            .unwrap_or_default();
        if !normalized_extensions.contains(&extension) {
            return Err(format!("Unsupported file extension for path: {path}"));
        }
    }

    Ok(())
}

fn resolve_input_paths(
    input_dir: Option<&str>,
    input_paths: Option<&Vec<String>>,
    allowed_extensions: &[String],
    empty_error: &str,
) -> Result<Vec<String>, String> {
    if let Some(paths) = input_paths {
        if paths.is_empty() {
            return Err(empty_error.to_string());
        }
        validate_paths_have_extensions(paths, allowed_extensions)?;
        return Ok(paths.clone());
    }

    let directory = input_dir.ok_or_else(|| "Input directory is required.".to_string())?;
    let files = collect_media_files(Path::new(directory), allowed_extensions)?;
    let resolved_paths = files
        .iter()
        .map(|path| path.to_string_lossy().to_string())
        .collect::<Vec<_>>();
    if resolved_paths.is_empty() {
        return Err(empty_error.to_string());
    }
    Ok(resolved_paths)
}

fn require_worker_sender(sender: Option<crate::state::WorkerSender>) -> Result<crate::state::WorkerSender, String> {
    sender.ok_or_else(|| "Worker is not running.".to_string())
}

fn create_batch_jobs(input_paths: &[String]) -> Vec<JobRecord> {
    input_paths
        .iter()
        .map(|input_path| JobRecord {
            job_id: to_job_id(input_path),
            file_name: to_file_name(input_path),
            input_path: input_path.clone(),
            output_path: None,
            status: JobStatus::Queued,
            progress_pct: 0,
            error: None,
        })
        .collect::<Vec<_>>()
}

fn create_task_jobs(input_paths: &[String]) -> Vec<TaskJobRecord> {
    input_paths
        .iter()
        .map(|input_path| TaskJobRecord {
            job_id: to_job_id(input_path),
            file_name: to_file_name(input_path),
            input_path: input_path.clone(),
            output_path: None,
            status: TaskJobStatus::Queued,
            progress_pct: 0,
            error: None,
            logs: Vec::new(),
        })
        .collect::<Vec<_>>()
}

fn default_moderation_settings() -> ModerationSettings {
    ModerationSettings {
        content_criteria: "1. Adult relationships (kissing, romantic/sexual content, dating)\n2. Bad morals or unethical behavior\n3. Content against Islamic values and aqeedah\n4. Magic, sorcery, or supernatural practices\n5. Music references or musical performances\n6. Violence or frightening content\n7. Inappropriate language or themes".to_string(),
        priority_guidelines: "Priority Guidelines:\n- HIGH: Major aqeedah violations, explicit magic/sorcery, sexual content\n- MEDIUM: Offensive language, questionable behavior, moderate violence\n- LOW: Mild concerns, ambiguous references".to_string(),
        profanity_words: Vec::new(),
        rules: vec![
            ModerationRule {
                rule_id: "aqeedah_christmas".to_string(),
                category: "aqeedah".to_string(),
                priority: "high".to_string(),
                reason: "Promotes non-Islamic religious celebration.".to_string(),
                patterns: vec![
                    "christmas".to_string(),
                    "xmas".to_string(),
                    "easter".to_string(),
                ],
            },
            ModerationRule {
                rule_id: "magic_sorcery".to_string(),
                category: "magic".to_string(),
                priority: "high".to_string(),
                reason: "References magic or sorcery.".to_string(),
                patterns: vec![
                    "spell".to_string(),
                    "sorcery".to_string(),
                    "witchcraft".to_string(),
                ],
            },
            ModerationRule {
                rule_id: "offensive_language".to_string(),
                category: "language".to_string(),
                priority: "medium".to_string(),
                reason: "Contains offensive language.".to_string(),
                patterns: vec!["stupid".to_string(), "idiot".to_string(), "dumb".to_string()],
            },
        ],
    }
}

fn moderation_settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to resolve app data directory: {error}"))?;
    Ok(app_data_dir.join("settings/moderation.json"))
}

fn read_or_initialize_moderation_settings(app: &AppHandle) -> Result<ModerationSettings, String> {
    let settings_path = moderation_settings_path(app)?;
    if settings_path.exists() {
        let content = fs::read_to_string(&settings_path).map_err(|error| {
            format!(
                "Failed reading moderation settings {}: {error}",
                settings_path.display()
            )
        })?;
        return serde_json::from_str(&content)
            .map_err(|error| format!("Invalid moderation settings JSON: {error}"));
    }

    let defaults = default_moderation_settings();
    write_moderation_settings(app, &defaults)?;
    Ok(defaults)
}

fn write_moderation_settings(app: &AppHandle, settings: &ModerationSettings) -> Result<(), String> {
    let settings_path = moderation_settings_path(app)?;
    if let Some(parent) = settings_path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "Failed creating moderation settings directory {}: {error}",
                parent.display()
            )
        })?;
    }

    let content = serde_json::to_string_pretty(settings)
        .map_err(|error| format!("Failed serializing moderation settings: {error}"))?;
    fs::write(&settings_path, content).map_err(|error| {
        format!(
            "Failed writing moderation settings {}: {error}",
            settings_path.display()
        )
    })
}

async fn get_batch_state_inner(state: &AppState, batch_id: &str) -> Option<BatchState> {
    state.get_batch(batch_id).await
}

async fn get_task_state_inner(state: &AppState, task_id: &str) -> Option<TaskState> {
    state.get_task(task_id).await
}

#[tauri::command]
pub async fn start_batch(
    app: AppHandle,
    state: State<'_, AppState>,
    request: StartBatchRequest,
) -> Result<BatchStartedResponse, String> {
    ensure_supported_output_mode(&request.output_dir_mode)?;

    let input_dir = Path::new(&request.input_dir);
    let media_files = collect_media_files(input_dir, &request.allowed_extensions)?;

    if media_files.is_empty() {
        return Err("No .mp4/.mov files were found in the selected directory.".to_string());
    }

    let output_dir = build_output_dir(input_dir);
    std::fs::create_dir_all(&output_dir)
        .map_err(|error| format!("Failed to create output directory: {error}"))?;

    let batch_id = Uuid::new_v4().to_string();
    let input_paths = media_files
        .iter()
        .map(|path| path.to_string_lossy().to_string())
        .collect::<Vec<_>>();

    state
        .insert_batch(BatchState {
            batch_id: batch_id.clone(),
            status: BatchStatus::Queued,
            jobs: create_batch_jobs(&input_paths),
            summary: None,
        })
        .await;

    app.emit(
        BATCH_EVENT_NAME,
        BatchEvent::worker_status(WorkerStatusKind::Starting, "Preparing runtime and worker..."),
    )
    .map_err(|error| format!("Failed to emit startup status: {error}"))?;

    let worker_sender = ensure_worker_sender(app.clone(), state.inner().clone()).await?;

    worker_sender
        .send(WorkerCommand::StartBatch {
            batch_id: batch_id.clone(),
            input_paths: input_paths.clone(),
            output_dir: output_dir.to_string_lossy().to_string(),
            compute_mode: "auto".to_string(),
        })
        .map_err(|error| format!("Failed to enqueue start batch command: {error}"))?;

    Ok(BatchStartedResponse {
        batch_id,
        file_count: input_paths.len(),
        input_paths,
    })
}

#[tauri::command]
pub async fn start_transcription_batch(
    app: AppHandle,
    state: State<'_, AppState>,
    request: StartTranscriptionBatchRequest,
) -> Result<BatchStartedResponse, String> {
    ensure_supported_yap_mode(&request.yap_mode)?;
    let allowed_extensions = request
        .allowed_extensions
        .unwrap_or_else(|| vec![".mp4".to_string(), ".mov".to_string()]);
    let input_paths = resolve_input_paths(
        request.input_dir.as_deref(),
        request.input_paths.as_ref(),
        &allowed_extensions,
        "No .mp4/.mov files were selected.",
    )?;

    let task_id = Uuid::new_v4().to_string();

    state
        .insert_task(TaskState {
            task_id: task_id.clone(),
            task_kind: TaskKind::Transcription,
            status: TaskStatus::Queued,
            jobs: create_task_jobs(&input_paths),
            summary: None,
        })
        .await;

    let worker_sender = ensure_worker_sender(app.clone(), state.inner().clone()).await?;
    worker_sender
        .send(WorkerCommand::StartTranscriptionBatch {
            task_id: task_id.clone(),
            input_paths: input_paths.clone(),
            yap_mode: request.yap_mode,
        })
        .map_err(|error| format!("Failed to enqueue transcription task: {error}"))?;

    Ok(BatchStartedResponse {
        batch_id: task_id,
        file_count: input_paths.len(),
        input_paths,
    })
}

#[tauri::command]
pub async fn start_flag_batch(
    app: AppHandle,
    state: State<'_, AppState>,
    request: StartFlagBatchRequest,
) -> Result<BatchStartedResponse, String> {
    let allowed_extensions = request
        .allowed_extensions
        .unwrap_or_else(|| vec![".srt".to_string()]);
    let input_paths = resolve_input_paths(
        request.input_dir.as_deref(),
        request.input_paths.as_ref(),
        &allowed_extensions,
        "No .srt files were selected.",
    )?;

    let settings = read_or_initialize_moderation_settings(&app)?;
    let task_id = Uuid::new_v4().to_string();

    state
        .insert_task(TaskState {
            task_id: task_id.clone(),
            task_kind: TaskKind::Flag,
            status: TaskStatus::Queued,
            jobs: create_task_jobs(&input_paths),
            summary: None,
        })
        .await;

    let worker_sender = ensure_worker_sender(app.clone(), state.inner().clone()).await?;
    worker_sender
        .send(WorkerCommand::StartFlagBatch {
            task_id: task_id.clone(),
            input_paths: input_paths.clone(),
            settings,
        })
        .map_err(|error| format!("Failed to enqueue flag task: {error}"))?;

    Ok(BatchStartedResponse {
        batch_id: task_id,
        file_count: input_paths.len(),
        input_paths,
    })
}

#[tauri::command]
pub async fn start_cut_job(
    app: AppHandle,
    state: State<'_, AppState>,
    request: StartCutJobRequest,
) -> Result<CutJobStartedResponse, String> {
    ensure_supported_cut_output_mode(&request.output_mode)?;
    if request.ranges.is_empty() {
        return Err("Cut job requires at least one range.".to_string());
    }

    let task_id = Uuid::new_v4().to_string();
    let input_paths = vec![request.video_path.clone()];

    state
        .insert_task(TaskState {
            task_id: task_id.clone(),
            task_kind: TaskKind::Cut,
            status: TaskStatus::Queued,
            jobs: create_task_jobs(&input_paths),
            summary: None,
        })
        .await;

    let worker_sender = ensure_worker_sender(app.clone(), state.inner().clone()).await?;
    worker_sender
        .send(WorkerCommand::StartCutJob {
            task_id: task_id.clone(),
            video_path: request.video_path.clone(),
            ranges: request.ranges,
            output_mode: request.output_mode,
        })
        .map_err(|error| format!("Failed to enqueue cut task: {error}"))?;

    Ok(CutJobStartedResponse {
        task_id,
        video_path: request.video_path,
    })
}

#[tauri::command]
pub async fn cancel_batch(
    state: State<'_, AppState>,
    request: CancelBatchRequest,
) -> Result<CancelAck, String> {
    ensure_supported_cancel_mode(&request.mode)?;

    let worker_sender = require_worker_sender(state.worker_sender().await)?;

    let accepted = worker_sender
        .send(WorkerCommand::CancelBatch {
            batch_id: request.batch_id.clone(),
            mode: request.mode,
        })
        .is_ok();

    Ok(CancelAck {
        batch_id: request.batch_id,
        accepted,
    })
}

#[tauri::command]
pub async fn cancel_task(
    state: State<'_, AppState>,
    request: CancelTaskRequest,
) -> Result<TaskCancelAck, String> {
    ensure_supported_cancel_mode(&request.mode)?;
    let worker_sender = require_worker_sender(state.worker_sender().await)?;

    let accepted = worker_sender
        .send(WorkerCommand::CancelTask {
            task_id: request.task_id.clone(),
            mode: request.mode,
        })
        .is_ok();

    Ok(TaskCancelAck {
        task_id: request.task_id,
        accepted,
    })
}

#[tauri::command]
pub async fn get_batch_state(
    state: State<'_, AppState>,
    batch_id: String,
) -> Result<Option<BatchState>, String> {
    Ok(get_batch_state_inner(state.inner(), &batch_id).await)
}

#[tauri::command]
pub async fn get_task_state(
    state: State<'_, AppState>,
    task_id: String,
) -> Result<Option<TaskState>, String> {
    Ok(get_task_state_inner(state.inner(), &task_id).await)
}

#[tauri::command]
pub async fn list_videos(request: ListVideosRequest) -> Result<Vec<VideoListItem>, String> {
    let input_dir = Path::new(&request.input_dir);
    discover_video_items(input_dir, &request.allowed_extensions)
}

#[tauri::command]
pub async fn list_srt_files(request: ListSrtFilesRequest) -> Result<Vec<SrtListItem>, String> {
    let input_dir = Path::new(&request.input_dir);
    discover_srt_items(input_dir)
}

#[tauri::command]
pub async fn get_moderation_settings(app: AppHandle) -> Result<ModerationSettings, String> {
    read_or_initialize_moderation_settings(&app)
}

#[tauri::command]
pub async fn save_moderation_settings(
    app: AppHandle,
    request: ModerationSettings,
) -> Result<SaveAck, String> {
    write_moderation_settings(&app, &request)?;
    Ok(SaveAck { success: true })
}

#[tauri::command]
pub async fn read_text_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|error| format!("Failed reading file {path}: {error}"))
}

#[tauri::command]
pub async fn open_folder_picker(app: AppHandle) -> Result<Option<String>, String> {
    let (tx, rx) = oneshot::channel::<Option<String>>();

    app.dialog().file().pick_folder(move |result| {
        let path = result.and_then(|file_path| {
            file_path
                .into_path()
                .ok()
                .map(|path| path.to_string_lossy().to_string())
        });
        let _ = tx.send(path);
    });

    rx.await
        .map_err(|error| format!("Folder picker channel failed: {error}"))
}

#[cfg(test)]
mod tests {
    use super::{
        create_task_jobs, default_moderation_settings, ensure_supported_cancel_mode,
        ensure_supported_cut_output_mode, ensure_supported_output_mode, ensure_supported_yap_mode,
        get_batch_state_inner, get_task_state_inner, require_worker_sender,
    };
    use crate::state::AppState;

    #[test]
    fn should_reject_unsupported_output_mode() {
        let result = ensure_supported_output_mode("custom_mode");
        assert!(result.is_err());
    }

    #[test]
    fn should_reject_unsupported_cut_output_mode() {
        let result = ensure_supported_cut_output_mode("custom_mode");
        assert!(result.is_err());
    }

    #[test]
    fn should_reject_unsupported_yap_mode() {
        let result = ensure_supported_yap_mode("manual");
        assert!(result.is_err());
    }

    #[test]
    fn should_error_when_cancel_requested_without_running_worker() {
        let result = require_worker_sender(None);
        assert!(result.is_err());
        assert_eq!(result.err().unwrap_or_default(), "Worker is not running.");
    }

    #[tokio::test]
    async fn should_return_none_for_missing_batch_state() {
        let state = AppState::new();
        let result = get_batch_state_inner(&state, "missing-batch-id").await;
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn should_return_none_for_missing_task_state() {
        let state = AppState::new();
        let result = get_task_state_inner(&state, "missing-task-id").await;
        assert!(result.is_none());
    }

    #[test]
    fn should_reject_unsupported_cancel_mode() {
        let result = ensure_supported_cancel_mode("immediate");
        assert!(result.is_err());
    }

    #[test]
    fn should_create_task_jobs_with_empty_logs() {
        let jobs = create_task_jobs(&["/tmp/a.mov".to_string()]);
        assert_eq!(jobs.len(), 1);
        assert!(jobs[0].logs.is_empty());
    }

    #[test]
    fn should_provide_default_moderation_rules() {
        let settings = default_moderation_settings();
        assert!(!settings.rules.is_empty());
        assert_eq!(settings.rules[0].priority, "high");
    }
}
