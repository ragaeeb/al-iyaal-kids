use std::{env, path::PathBuf, process::Stdio};

use tauri::{AppHandle, Emitter};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::Command,
    sync::mpsc,
};

use crate::{
    protocol::{parse_worker_event, to_frontend_batch_event, to_frontend_task_event, WorkerCommand},
    runtime::ensure_runtime_ready,
    state::AppState,
    types::{BatchEvent, TaskEvent, WorkerStatusKind},
};

const BATCH_EVENT_NAME: &str = "batch-event";
const TASK_EVENT_NAME: &str = "task-event";

pub async fn ensure_worker_sender(app: AppHandle, state: AppState) -> Result<crate::state::WorkerSender, String> {
    if let Some(sender) = state.worker_sender().await {
        if !sender.is_closed() {
            return Ok(sender);
        }
    }

    app.emit(
        BATCH_EVENT_NAME,
        BatchEvent::worker_status(WorkerStatusKind::Starting, "Starting persistent Python worker..."),
    )
    .map_err(|error| format!("Failed to emit worker startup event: {error}"))?;
    app.emit(
        TASK_EVENT_NAME,
        TaskEvent::worker_status(WorkerStatusKind::Starting, "Starting persistent Python worker..."),
    )
    .map_err(|error| format!("Failed to emit task startup event: {error}"))?;

    let runtime = ensure_runtime_ready(&app).await?;
    let worker_sender = spawn_worker_process(app.clone(), state.clone(), runtime).await?;
    state.set_worker_sender(worker_sender.clone()).await;

    app.emit(
        BATCH_EVENT_NAME,
        BatchEvent::worker_status(WorkerStatusKind::Ready, "Worker ready."),
    )
    .map_err(|error| format!("Failed to emit worker ready event: {error}"))?;
    app.emit(
        TASK_EVENT_NAME,
        TaskEvent::worker_status(WorkerStatusKind::Ready, "Worker ready."),
    )
    .map_err(|error| format!("Failed to emit task ready event: {error}"))?;

    Ok(worker_sender)
}

async fn spawn_worker_process(
    app: AppHandle,
    state: AppState,
    runtime: crate::runtime::RuntimePaths,
) -> Result<crate::state::WorkerSender, String> {
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
    let demucs_path = venv_bin_dir.join("demucs");
    let merged_path = match env::var("PATH") {
        Ok(existing) if !existing.is_empty() => {
            format!("{}:{existing}", venv_bin_dir.to_string_lossy())
        }
        _ => venv_bin_dir.to_string_lossy().to_string(),
    };

    let mut command = Command::new(&runtime.python_executable);
    command
        .arg(&runtime.worker_script)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("PYTHONUNBUFFERED", "1")
        .env("PYTHONPATH", merged_python_path)
        .env("PATH", merged_path)
        .env("AIYAAL_DEMUCS_PATH", demucs_path.to_string_lossy().to_string())
        .env("AIYAAL_FFMPEG_PATH", runtime.ffmpeg_executable.to_string_lossy().to_string())
        .env("AIYAAL_YAP_PATH", runtime.yap_executable.to_string_lossy().to_string());

    let mut child = command.spawn().map_err(|error| {
        format!(
            "Failed to start worker with {} {}: {error}",
            runtime.python_executable.display(),
            runtime.worker_script.display()
        )
    })?;

    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Failed to access worker stdin".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to access worker stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Failed to access worker stderr".to_string())?;

    let (tx, mut rx) = mpsc::unbounded_channel::<WorkerCommand>();

    let app_for_stdin = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut stdin = stdin;
        while let Some(command) = rx.recv().await {
            let line = match command.to_json_line() {
                Ok(value) => value,
                Err(error) => {
                    eprintln!("worker command serialization error: {error}");
                    let _ = app_for_stdin.emit(
                        BATCH_EVENT_NAME,
                        BatchEvent::worker_status(WorkerStatusKind::Error, error.clone()),
                    );
                    let _ = app_for_stdin.emit(
                        TASK_EVENT_NAME,
                        TaskEvent::worker_status(WorkerStatusKind::Error, error),
                    );
                    continue;
                }
            };

            if let Err(error) = stdin.write_all(line.as_bytes()).await {
                eprintln!("worker stdin write error: {error}");
                let _ = app_for_stdin.emit(
                    BATCH_EVENT_NAME,
                    BatchEvent::worker_status(
                        WorkerStatusKind::Error,
                        format!("Failed writing to worker stdin: {error}"),
                    ),
                );
                let _ = app_for_stdin.emit(
                    TASK_EVENT_NAME,
                    TaskEvent::worker_status(
                        WorkerStatusKind::Error,
                        format!("Failed writing to worker stdin: {error}"),
                    ),
                );
                break;
            }
        }
    });

    let app_for_stdout = app.clone();
    let state_for_stdout = state.clone();
    tauri::async_runtime::spawn(async move {
        let mut reader = BufReader::new(stdout).lines();

        while let Ok(Some(line)) = reader.next_line().await {
            let parsed_event = match parse_worker_event(&line) {
                Ok(event) => event,
                Err(error) => {
                    eprintln!("worker event parse error: {error}; raw_line={line}");
                    let _ = app_for_stdout.emit(
                        BATCH_EVENT_NAME,
                        BatchEvent::worker_status(WorkerStatusKind::Error, error.clone()),
                    );
                    let _ = app_for_stdout.emit(
                        TASK_EVENT_NAME,
                        TaskEvent::worker_status(WorkerStatusKind::Error, error),
                    );
                    continue;
                }
            };

            state_for_stdout.apply_worker_event(&parsed_event).await;
            if let Some(frontend_event) = to_frontend_batch_event(&parsed_event) {
                let _ = app_for_stdout.emit(BATCH_EVENT_NAME, frontend_event);
            }
            if let Some(task_event) = to_frontend_task_event(&parsed_event) {
                let _ = app_for_stdout.emit(TASK_EVENT_NAME, task_event);
            }
        }
    });

    let app_for_stderr = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut reader = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            eprintln!("worker stderr: {line}");
            let _ = app_for_stderr.emit(
                BATCH_EVENT_NAME,
                BatchEvent::worker_status(WorkerStatusKind::Error, format!("worker stderr: {line}")),
            );
            let _ = app_for_stderr.emit(
                TASK_EVENT_NAME,
                TaskEvent::worker_status(WorkerStatusKind::Error, format!("worker stderr: {line}")),
            );
        }
    });

    let app_for_wait = app.clone();
    let state_for_wait = state.clone();
    tauri::async_runtime::spawn(async move {
        let status = child.wait().await;
        state_for_wait.clear_worker_sender().await;

        let message = match status {
            Ok(exit_status) => format!("Worker process exited unexpectedly: {exit_status}"),
            Err(error) => format!("Failed waiting on worker process: {error}"),
        };
        eprintln!("{message}");

        let _ = app_for_wait.emit(
            BATCH_EVENT_NAME,
            BatchEvent::worker_status(WorkerStatusKind::Error, message),
        );
        let _ = app_for_wait.emit(
            TASK_EVENT_NAME,
            TaskEvent::worker_status(WorkerStatusKind::Error, "Worker exited unexpectedly."),
        );
    });

    Ok(tx)
}
