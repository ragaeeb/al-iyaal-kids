use serde::{Deserialize, Serialize};

use crate::types::{
    BatchEvent, BatchSummary, CutRange, ModerationSettings, TaskEvent, TaskKind, TaskSummary,
};

#[derive(Debug, Clone)]
pub enum WorkerCommand {
    StartBatch {
        batch_id: String,
        input_paths: Vec<String>,
        output_dir: String,
        compute_mode: String,
    },
    StartTranscriptionBatch {
        task_id: String,
        input_paths: Vec<String>,
        yap_mode: String,
    },
    StartFlagBatch {
        agent_executable_path: Option<String>,
        task_id: String,
        input_paths: Vec<String>,
        settings: ModerationSettings,
    },
    StartCutJob {
        task_id: String,
        video_path: String,
        ranges: Vec<CutRange>,
        output_mode: String,
        compression_preset: String,
    },
    CancelBatch {
        batch_id: String,
        mode: String,
    },
    CancelTask {
        task_id: String,
        mode: String,
    },
}

#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum WorkerCommandMessage<'a> {
    StartBatch {
        #[serde(rename = "batchId")]
        batch_id: &'a str,
        #[serde(rename = "inputPaths")]
        input_paths: &'a [String],
        #[serde(rename = "outputDir")]
        output_dir: &'a str,
        #[serde(rename = "computeMode")]
        compute_mode: &'a str,
    },
    StartTranscriptionBatch {
        #[serde(rename = "taskId")]
        task_id: &'a str,
        #[serde(rename = "inputPaths")]
        input_paths: &'a [String],
        #[serde(rename = "yapMode")]
        yap_mode: &'a str,
    },
    StartFlagBatch {
        #[serde(
            rename = "agentExecutablePath",
            skip_serializing_if = "Option::is_none"
        )]
        agent_executable_path: &'a Option<String>,
        #[serde(rename = "taskId")]
        task_id: &'a str,
        #[serde(rename = "inputPaths")]
        input_paths: &'a [String],
        settings: &'a ModerationSettings,
    },
    StartCutJob {
        #[serde(rename = "taskId")]
        task_id: &'a str,
        #[serde(rename = "videoPath")]
        video_path: &'a str,
        ranges: &'a [CutRange],
        #[serde(rename = "outputMode")]
        output_mode: &'a str,
        #[serde(rename = "compressionPreset")]
        compression_preset: &'a str,
    },
    CancelBatch {
        #[serde(rename = "batchId")]
        batch_id: &'a str,
        mode: &'a str,
    },
    CancelTask {
        #[serde(rename = "taskId")]
        task_id: &'a str,
        mode: &'a str,
    },
}

impl WorkerCommand {
    pub fn to_json_line(&self) -> Result<String, String> {
        let payload = match self {
            WorkerCommand::StartBatch {
                batch_id,
                input_paths,
                output_dir,
                compute_mode,
            } => WorkerCommandMessage::StartBatch {
                batch_id,
                input_paths,
                output_dir,
                compute_mode,
            },
            WorkerCommand::StartTranscriptionBatch {
                task_id,
                input_paths,
                yap_mode,
            } => WorkerCommandMessage::StartTranscriptionBatch {
                task_id,
                input_paths,
                yap_mode,
            },
            WorkerCommand::StartFlagBatch {
                agent_executable_path,
                task_id,
                input_paths,
                settings,
            } => WorkerCommandMessage::StartFlagBatch {
                agent_executable_path,
                task_id,
                input_paths,
                settings,
            },
            WorkerCommand::StartCutJob {
                task_id,
                video_path,
                ranges,
                output_mode,
                compression_preset,
            } => WorkerCommandMessage::StartCutJob {
                task_id,
                video_path,
                ranges,
                output_mode,
                compression_preset,
            },
            WorkerCommand::CancelBatch { batch_id, mode } => {
                WorkerCommandMessage::CancelBatch { batch_id, mode }
            }
            WorkerCommand::CancelTask { task_id, mode } => {
                WorkerCommandMessage::CancelTask { task_id, mode }
            }
        };

        serde_json::to_string(&payload)
            .map(|json| format!("{json}\n"))
            .map_err(|error| format!("Failed to encode worker command: {error}"))
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum WorkerEvent {
    JobProgress {
        #[serde(rename = "batchId")]
        batch_id: Option<String>,
        #[serde(rename = "taskId")]
        task_id: Option<String>,
        #[serde(rename = "taskKind")]
        task_kind: Option<String>,
        #[serde(rename = "jobId")]
        job_id: String,
        #[serde(rename = "progressPct")]
        progress_pct: f64,
    },
    JobDone {
        #[serde(rename = "batchId")]
        batch_id: Option<String>,
        #[serde(rename = "taskId")]
        task_id: Option<String>,
        #[serde(rename = "taskKind")]
        task_kind: Option<String>,
        #[serde(rename = "jobId")]
        job_id: String,
        #[serde(rename = "outputPath")]
        output_path: String,
        artifacts: Option<serde_json::Value>,
    },
    JobError {
        #[serde(rename = "batchId")]
        batch_id: Option<String>,
        #[serde(rename = "taskId")]
        task_id: Option<String>,
        #[serde(rename = "taskKind")]
        task_kind: Option<String>,
        #[serde(rename = "jobId")]
        job_id: String,
        error: String,
    },
    BatchDone {
        #[serde(rename = "batchId")]
        batch_id: String,
        summary: BatchSummary,
    },
    TaskDone {
        #[serde(rename = "taskId")]
        task_id: String,
        #[serde(rename = "taskKind")]
        task_kind: String,
        summary: TaskSummary,
    },
    JobLog {
        #[serde(rename = "batchId")]
        batch_id: Option<String>,
        #[serde(rename = "taskId")]
        task_id: Option<String>,
        #[serde(rename = "taskKind")]
        task_kind: Option<String>,
        #[serde(rename = "jobId")]
        job_id: String,
        message: String,
        stream: Option<String>,
    },
    WorkerStatus {
        status: String,
        message: String,
    },
}

pub fn parse_worker_event(line: &str) -> Result<WorkerEvent, String> {
    let event: WorkerEvent = serde_json::from_str(line)
        .map_err(|error| format!("Failed to parse worker event: {error}"))?;
    validate_worker_event(&event)?;
    Ok(event)
}

fn parse_task_kind(task_kind: &str) -> Option<TaskKind> {
    match task_kind {
        "transcription" => Some(TaskKind::Transcription),
        "flag" => Some(TaskKind::Flag),
        "cut" => Some(TaskKind::Cut),
        _ => None,
    }
}

fn to_worker_status(status: &str) -> Option<crate::types::WorkerStatusKind> {
    match status {
        "starting" => Some(crate::types::WorkerStatusKind::Starting),
        "ready" => Some(crate::types::WorkerStatusKind::Ready),
        "stopped" => Some(crate::types::WorkerStatusKind::Stopped),
        "error" => Some(crate::types::WorkerStatusKind::Error),
        _ => None,
    }
}

fn validate_job_route(
    batch_id: &Option<String>,
    task_id: &Option<String>,
    task_kind: &Option<String>,
) -> Result<(), String> {
    match (batch_id.as_deref(), task_id.as_deref()) {
        (Some(batch_id), None) if !batch_id.trim().is_empty() && task_kind.is_none() => Ok(()),
        (None, Some(task_id)) if !task_id.trim().is_empty() => {
            let task_kind = task_kind
                .as_deref()
                .ok_or_else(|| "Task job event is missing taskKind.".to_string())?;
            if parse_task_kind(task_kind).is_some() {
                Ok(())
            } else {
                Err(format!("Unknown taskKind in worker event: {task_kind}"))
            }
        }
        (Some(_), Some(_)) => {
            Err("Worker job event must contain exactly one route identity.".to_string())
        }
        (None, None) => {
            Err("Worker job event must contain exactly one route identity.".to_string())
        }
        _ => Err("Worker job event has an empty route identity.".to_string()),
    }
}

fn validate_worker_event(event: &WorkerEvent) -> Result<(), String> {
    match event {
        WorkerEvent::JobProgress {
            batch_id,
            task_id,
            task_kind,
            job_id,
            ..
        }
        | WorkerEvent::JobError {
            batch_id,
            task_id,
            task_kind,
            job_id,
            ..
        }
        | WorkerEvent::JobLog {
            batch_id,
            task_id,
            task_kind,
            job_id,
            ..
        } => {
            validate_job_route(batch_id, task_id, task_kind)?;
            if job_id.trim().is_empty() {
                return Err("Worker job event is missing jobId.".to_string());
            }
        }
        WorkerEvent::JobDone {
            batch_id,
            task_id,
            task_kind,
            job_id,
            output_path,
            ..
        } => {
            validate_job_route(batch_id, task_id, task_kind)?;
            if job_id.trim().is_empty() {
                return Err("Worker job event is missing jobId.".to_string());
            }
            if output_path.trim().is_empty() {
                return Err("Worker job_done event requires a non-empty outputPath.".to_string());
            }
        }
        WorkerEvent::BatchDone { batch_id, .. } => {
            if batch_id.trim().is_empty() {
                return Err("Worker batch_done event is missing batchId.".to_string());
            }
        }
        WorkerEvent::TaskDone {
            task_id, task_kind, ..
        } => {
            if task_id.trim().is_empty() {
                return Err("Worker task_done event is missing taskId.".to_string());
            }
            if parse_task_kind(task_kind).is_none() {
                return Err(format!("Unknown taskKind in worker event: {task_kind}"));
            }
        }
        WorkerEvent::WorkerStatus { .. } => {}
    }
    Ok(())
}

fn is_valid_batch_job_route(
    batch_id: &Option<String>,
    task_id: &Option<String>,
    task_kind: &Option<String>,
) -> bool {
    validate_job_route(batch_id, task_id, task_kind).is_ok() && batch_id.is_some()
}

fn is_valid_task_job_route(
    batch_id: &Option<String>,
    task_id: &Option<String>,
    task_kind: &Option<String>,
) -> bool {
    validate_job_route(batch_id, task_id, task_kind).is_ok() && task_id.is_some()
}

pub fn to_frontend_batch_event(event: &WorkerEvent) -> Option<BatchEvent> {
    match event {
        WorkerEvent::JobProgress {
            batch_id,
            task_id,
            task_kind,
            job_id,
            progress_pct,
            ..
        } if is_valid_batch_job_route(batch_id, task_id, task_kind) => {
            batch_id.as_ref().map(|batch_id| {
                BatchEvent::job_progress(
                    batch_id,
                    job_id,
                    progress_pct.round().clamp(0.0, 100.0) as u8,
                )
            })
        }
        WorkerEvent::JobDone {
            batch_id,
            task_id,
            task_kind,
            job_id,
            output_path,
            ..
        } if is_valid_batch_job_route(batch_id, task_id, task_kind)
            && !output_path.trim().is_empty() =>
        {
            batch_id
                .as_ref()
                .map(|batch_id| BatchEvent::job_done(batch_id, job_id, output_path.clone()))
        }
        WorkerEvent::JobError {
            batch_id,
            task_id,
            task_kind,
            job_id,
            error,
            ..
        } if is_valid_batch_job_route(batch_id, task_id, task_kind) => batch_id
            .as_ref()
            .map(|batch_id| BatchEvent::job_error(batch_id, job_id, error)),
        WorkerEvent::BatchDone { batch_id, summary } => {
            Some(BatchEvent::batch_done(batch_id, summary.clone()))
        }
        WorkerEvent::JobLog {
            batch_id,
            task_id,
            task_kind,
            job_id,
            message,
            stream,
            ..
        } if is_valid_batch_job_route(batch_id, task_id, task_kind) => {
            batch_id.as_ref().map(|batch_id| {
                BatchEvent::job_log(
                    batch_id,
                    job_id,
                    message,
                    stream.clone().unwrap_or_else(|| "stdout".to_string()),
                )
            })
        }
        WorkerEvent::WorkerStatus { status, message } => to_worker_status(status)
            .map(|status_kind| BatchEvent::worker_status(status_kind, message)),
        WorkerEvent::TaskDone { .. } => None,
        _ => None,
    }
}

pub fn to_frontend_task_event(event: &WorkerEvent) -> Option<TaskEvent> {
    match event {
        WorkerEvent::JobProgress {
            batch_id,
            task_id,
            task_kind,
            job_id,
            progress_pct,
            ..
        } if is_valid_task_job_route(batch_id, task_id, task_kind) => {
            let task_id = task_id.as_ref()?;
            let task_kind = parse_task_kind(task_kind.as_deref().unwrap_or_default())?;
            Some(TaskEvent::job_progress(
                task_id,
                task_kind,
                job_id,
                progress_pct.round().clamp(0.0, 100.0) as u8,
            ))
        }
        WorkerEvent::JobDone {
            batch_id,
            task_id,
            task_kind,
            job_id,
            output_path,
            artifacts,
            ..
        } if is_valid_task_job_route(batch_id, task_id, task_kind)
            && !output_path.trim().is_empty() =>
        {
            let task_id = task_id.as_ref()?;
            let task_kind = parse_task_kind(task_kind.as_deref().unwrap_or_default())?;
            Some(TaskEvent::job_done(
                task_id,
                task_kind,
                job_id,
                Some(output_path.clone()),
                artifacts.clone(),
            ))
        }
        WorkerEvent::JobError {
            batch_id,
            task_id,
            task_kind,
            job_id,
            error,
            ..
        } if is_valid_task_job_route(batch_id, task_id, task_kind) => {
            let task_id = task_id.as_ref()?;
            let task_kind = parse_task_kind(task_kind.as_deref().unwrap_or_default())?;
            Some(TaskEvent::job_error(task_id, task_kind, job_id, error))
        }
        WorkerEvent::TaskDone {
            task_id,
            task_kind,
            summary,
        } => parse_task_kind(task_kind)
            .map(|task_kind| TaskEvent::task_done(task_id, task_kind, summary.clone())),
        WorkerEvent::JobLog {
            batch_id,
            task_id,
            task_kind,
            job_id,
            message,
            stream,
            ..
        } if is_valid_task_job_route(batch_id, task_id, task_kind) => {
            let task_id = task_id.as_ref()?;
            let task_kind = parse_task_kind(task_kind.as_deref().unwrap_or_default())?;
            Some(TaskEvent::job_log(
                task_id,
                task_kind,
                job_id,
                message,
                stream.clone().unwrap_or_else(|| "stdout".to_string()),
            ))
        }
        WorkerEvent::WorkerStatus { status, message } => to_worker_status(status)
            .map(|status_kind| TaskEvent::worker_status(status_kind, message)),
        WorkerEvent::BatchDone { .. } => None,
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use crate::types::{ModerationSettings, TaskEvent};

    use super::{
        parse_worker_event, to_frontend_batch_event, to_frontend_task_event, WorkerCommand,
        WorkerEvent,
    };

    #[test]
    fn should_serialize_cancel_batch_command() {
        let line = WorkerCommand::CancelBatch {
            batch_id: "batch-1".to_string(),
            mode: "stop_after_current".to_string(),
        }
        .to_json_line()
        .expect("command serialization should succeed");

        assert!(line.contains("\"type\":\"cancel_batch\""));
        assert!(line.contains("\"batchId\":\"batch-1\""));
    }

    #[test]
    fn should_serialize_runtime_agent_path_for_flag_jobs() {
        let line = WorkerCommand::StartFlagBatch {
            agent_executable_path: Some("/tools/codex".to_string()),
            input_paths: vec!["/videos/episode.srt".to_string()],
            settings: ModerationSettings {
                agent_model: "gpt-test".to_string(),
                agent_reasoning_level: "low".to_string(),
                amazon_nova_api_key: String::new(),
                analysis_strategy: "fast".to_string(),
                content_criteria: "criteria".to_string(),
                engine: "codex".to_string(),
                google_api_key: String::new(),
                priority_guidelines: "guidelines".to_string(),
                profanity_words: Vec::new(),
                rules: Vec::new(),
            },
            task_id: "task-1".to_string(),
        }
        .to_json_line()
        .expect("command serialization should succeed");

        assert!(line.contains("\"agentExecutablePath\":\"/tools/codex\""));
        assert!(line.contains("\"agentModel\":\"gpt-test\""));
    }

    #[test]
    fn should_parse_job_progress_event() {
        let line =
            r#"{"type":"job_progress","batchId":"batch-1","jobId":"job-1","progressPct":42.4}"#;
        let event = parse_worker_event(line).expect("worker event should parse");

        match event {
            super::WorkerEvent::JobProgress {
                batch_id,
                job_id,
                progress_pct,
                ..
            } => {
                assert_eq!(batch_id, Some("batch-1".to_string()));
                assert_eq!(job_id, "job-1");
                assert_eq!(progress_pct, 42.4);
            }
            _ => panic!("expected job progress event"),
        }
    }

    #[test]
    fn should_fail_when_worker_event_json_is_invalid() {
        let result = parse_worker_event("{not-json");
        assert!(result.is_err());
    }

    #[test]
    fn should_fail_when_worker_event_type_is_unknown() {
        let result = parse_worker_event(r#"{"type":"unknown_event"}"#);
        assert!(result.is_err());
    }

    #[test]
    fn should_fail_when_required_fields_are_missing() {
        let result = parse_worker_event(r#"{"type":"job_progress","batchId":"batch-1"}"#);
        assert!(result.is_err());
    }

    #[test]
    fn should_reject_job_events_with_ambiguous_or_missing_route_identity() {
        for line in [
            r#"{"type":"job_progress","batchId":"batch-1","taskId":"task-1","jobId":"job-1","progressPct":1}"#,
            r#"{"type":"job_progress","jobId":"job-1","progressPct":1}"#,
            r#"{"type":"job_progress","taskId":"task-1","jobId":"job-1","progressPct":1}"#,
            r#"{"type":"job_progress","taskId":"task-1","taskKind":"unknown","jobId":"job-1","progressPct":1}"#,
        ] {
            assert!(
                parse_worker_event(line).is_err(),
                "expected rejection: {line}"
            );
        }
    }

    #[test]
    fn should_reject_job_done_without_a_non_empty_output_path() {
        for output_path in ["", "   "] {
            let line = format!(
                r#"{{"type":"job_done","batchId":"batch-1","jobId":"job-1","outputPath":"{output_path}"}}"#
            );
            assert!(parse_worker_event(&line).is_err());
        }
        assert!(
            parse_worker_event(r#"{"type":"job_done","batchId":"batch-1","jobId":"job-1"}"#)
                .is_err()
        );
    }

    #[test]
    fn should_drop_malformed_job_done_during_frontend_conversion() {
        let event = WorkerEvent::JobDone {
            batch_id: Some("batch-1".to_string()),
            task_id: None,
            task_kind: None,
            job_id: "job-1".to_string(),
            output_path: String::new(),
            artifacts: None,
        };

        assert!(to_frontend_batch_event(&event).is_none());
    }

    #[test]
    fn should_map_progress_with_rounding_and_clamping() {
        let event = parse_worker_event(
            r#"{"type":"job_progress","taskId":"task-1","taskKind":"flag","jobId":"job-1","progressPct":200.8}"#,
        )
        .expect("worker event should parse");
        let frontend_event =
            to_frontend_task_event(&event).expect("frontend task event should be mapped");

        match frontend_event {
            TaskEvent::JobProgress { progress_pct, .. } => {
                assert_eq!(progress_pct, 100);
            }
            _ => panic!("expected job progress frontend event"),
        }
    }

    #[test]
    fn should_ignore_unknown_worker_status_when_mapping_frontend_event() {
        let event = parse_worker_event(
            r#"{"type":"worker_status","status":"booting","message":"starting up"}"#,
        )
        .expect("worker event should parse");

        assert!(super::to_frontend_batch_event(&event).is_none());
    }

    #[test]
    fn should_map_job_log_to_task_event() {
        let event = parse_worker_event(
            r#"{"type":"job_log","taskId":"task-1","taskKind":"cut","jobId":"job-1","message":"line","stream":"stderr"}"#,
        )
        .expect("worker event should parse");

        let task_event = to_frontend_task_event(&event).expect("task event should map");
        match task_event {
            TaskEvent::JobLog {
                task_id,
                task_kind,
                stream,
                ..
            } => {
                assert_eq!(task_id, "task-1");
                assert_eq!(task_kind, crate::types::TaskKind::Cut);
                assert_eq!(stream, "stderr");
            }
            _ => panic!("expected job log event"),
        }
    }
}
