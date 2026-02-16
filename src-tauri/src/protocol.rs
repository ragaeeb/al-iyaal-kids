use serde::{Deserialize, Serialize};

use crate::types::{BatchEvent, BatchSummary};

#[derive(Debug, Clone)]
pub enum WorkerCommand {
    StartBatch {
        batch_id: String,
        input_paths: Vec<String>,
        output_dir: String,
        compute_mode: String,
    },
    CancelBatch {
        batch_id: String,
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
    CancelBatch {
        #[serde(rename = "batchId")]
        batch_id: &'a str,
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
            WorkerCommand::CancelBatch { batch_id, mode } => WorkerCommandMessage::CancelBatch {
                batch_id,
                mode,
            },
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
        batch_id: String,
        #[serde(rename = "jobId")]
        job_id: String,
        #[serde(rename = "progressPct")]
        progress_pct: f64,
    },
    JobDone {
        #[serde(rename = "batchId")]
        batch_id: String,
        #[serde(rename = "jobId")]
        job_id: String,
        #[serde(rename = "outputPath")]
        output_path: String,
    },
    JobError {
        #[serde(rename = "batchId")]
        batch_id: String,
        #[serde(rename = "jobId")]
        job_id: String,
        error: String,
    },
    BatchDone {
        #[serde(rename = "batchId")]
        batch_id: String,
        summary: BatchSummary,
    },
    WorkerStatus {
        status: String,
        message: String,
    },
}

pub fn parse_worker_event(line: &str) -> Result<WorkerEvent, String> {
    serde_json::from_str(line).map_err(|error| format!("Failed to parse worker event: {error}"))
}

pub fn to_frontend_event(event: &WorkerEvent) -> Option<BatchEvent> {
    match event {
        WorkerEvent::JobProgress {
            batch_id,
            job_id,
            progress_pct,
        } => Some(BatchEvent::job_progress(
            batch_id,
            job_id,
            progress_pct.round().clamp(0.0, 100.0) as u8,
        )),
        WorkerEvent::JobDone {
            batch_id,
            job_id,
            output_path,
        } => Some(BatchEvent::job_done(batch_id, job_id, output_path)),
        WorkerEvent::JobError {
            batch_id,
            job_id,
            error,
        } => Some(BatchEvent::job_error(batch_id, job_id, error)),
        WorkerEvent::BatchDone { batch_id, summary } => {
            Some(BatchEvent::batch_done(batch_id, summary.clone()))
        }
        WorkerEvent::WorkerStatus { status, message } => match status.as_str() {
            "starting" => Some(BatchEvent::worker_status(
                crate::types::WorkerStatusKind::Starting,
                message,
            )),
            "ready" => Some(BatchEvent::worker_status(
                crate::types::WorkerStatusKind::Ready,
                message,
            )),
            "error" => Some(BatchEvent::worker_status(
                crate::types::WorkerStatusKind::Error,
                message,
            )),
            _ => None,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::{parse_worker_event, WorkerCommand};

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
    fn should_parse_job_progress_event() {
        let line = r#"{"type":"job_progress","batchId":"batch-1","jobId":"job-1","progressPct":42.4}"#;
        let event = parse_worker_event(line).expect("worker event should parse");

        match event {
            super::WorkerEvent::JobProgress {
                batch_id,
                job_id,
                progress_pct,
            } => {
                assert_eq!(batch_id, "batch-1");
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
    fn should_map_progress_with_rounding_and_clamping() {
        let event = parse_worker_event(
            r#"{"type":"job_progress","batchId":"batch-1","jobId":"job-1","progressPct":200.8}"#,
        )
        .expect("worker event should parse");
        let frontend_event =
            super::to_frontend_event(&event).expect("frontend event should be mapped");

        match frontend_event {
            crate::types::BatchEvent::JobProgress { progress_pct, .. } => {
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

        assert!(super::to_frontend_event(&event).is_none());
    }
}
