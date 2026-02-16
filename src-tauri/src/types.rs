use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartBatchRequest {
    pub input_dir: String,
    pub output_dir_mode: String,
    pub allowed_extensions: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelBatchRequest {
    pub batch_id: String,
    pub mode: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum JobStatus {
    Queued,
    Running,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct JobRecord {
    pub job_id: String,
    pub file_name: String,
    pub input_path: String,
    pub output_path: Option<String>,
    pub status: JobStatus,
    pub progress_pct: u8,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BatchSummary {
    pub ok: usize,
    pub failed: usize,
    pub cancelled: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum BatchStatus {
    Queued,
    Running,
    Completed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BatchState {
    pub batch_id: String,
    pub status: BatchStatus,
    pub jobs: Vec<JobRecord>,
    pub summary: Option<BatchSummary>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchStartedResponse {
    pub batch_id: String,
    pub file_count: usize,
    pub input_paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelAck {
    pub batch_id: String,
    pub accepted: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkerStatusKind {
    Starting,
    Ready,
    Error,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum BatchEvent {
    JobProgress {
        #[serde(rename = "batchId")]
        batch_id: String,
        #[serde(rename = "jobId")]
        job_id: String,
        #[serde(rename = "progressPct")]
        progress_pct: u8,
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
        status: WorkerStatusKind,
        message: String,
    },
}

impl BatchEvent {
    pub fn worker_status(status: WorkerStatusKind, message: impl Into<String>) -> Self {
        Self::WorkerStatus {
            status,
            message: message.into(),
        }
    }

    pub fn job_progress(batch_id: impl Into<String>, job_id: impl Into<String>, progress_pct: u8) -> Self {
        Self::JobProgress {
            batch_id: batch_id.into(),
            job_id: job_id.into(),
            progress_pct,
        }
    }

    pub fn job_done(batch_id: impl Into<String>, job_id: impl Into<String>, output_path: impl Into<String>) -> Self {
        Self::JobDone {
            batch_id: batch_id.into(),
            job_id: job_id.into(),
            output_path: output_path.into(),
        }
    }

    pub fn job_error(batch_id: impl Into<String>, job_id: impl Into<String>, error: impl Into<String>) -> Self {
        Self::JobError {
            batch_id: batch_id.into(),
            job_id: job_id.into(),
            error: error.into(),
        }
    }

    pub fn batch_done(batch_id: impl Into<String>, summary: BatchSummary) -> Self {
        Self::BatchDone {
            batch_id: batch_id.into(),
            summary,
        }
    }
}
