use std::path::Path;

use tauri::{AppHandle, Emitter, State};
use tauri_plugin_dialog::DialogExt;
use tokio::sync::oneshot;
use uuid::Uuid;

use crate::{
    file_discovery::{build_output_dir, collect_media_files},
    ids::{to_file_name, to_job_id},
    protocol::WorkerCommand,
    state::AppState,
    types::{
        BatchEvent, BatchStartedResponse, BatchState, BatchStatus, CancelAck, CancelBatchRequest,
        JobRecord, JobStatus, StartBatchRequest, WorkerStatusKind,
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

fn ensure_supported_cancel_mode(mode: &str) -> Result<(), String> {
    if mode != "stop_after_current" {
        return Err("Unsupported cancellation mode. Use stop_after_current.".to_string());
    }

    Ok(())
}

fn require_worker_sender(sender: Option<crate::state::WorkerSender>) -> Result<crate::state::WorkerSender, String> {
    sender.ok_or_else(|| "Worker is not running.".to_string())
}

async fn get_batch_state_inner(state: &AppState, batch_id: &str) -> Option<BatchState> {
    state.get_batch(batch_id).await
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

    let jobs = input_paths
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
        .collect::<Vec<_>>();

    state
        .insert_batch(BatchState {
            batch_id: batch_id.clone(),
            status: BatchStatus::Queued,
            jobs,
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
pub async fn get_batch_state(
    state: State<'_, AppState>,
    batch_id: String,
) -> Result<Option<BatchState>, String> {
    Ok(get_batch_state_inner(state.inner(), &batch_id).await)
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
        ensure_supported_cancel_mode, ensure_supported_output_mode, get_batch_state_inner, require_worker_sender,
    };
    use crate::state::AppState;

    #[test]
    fn should_reject_unsupported_output_mode() {
        let result = ensure_supported_output_mode("custom_mode");
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

    #[test]
    fn should_reject_unsupported_cancel_mode() {
        let result = ensure_supported_cancel_mode("immediate");
        assert!(result.is_err());
    }
}
