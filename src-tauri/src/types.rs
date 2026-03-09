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

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListVideosRequest {
    pub input_dir: String,
    pub allowed_extensions: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct VideoListItem {
    pub file_name: String,
    pub path: String,
    pub srt_path: Option<String>,
    pub analysis_path: Option<String>,
    pub has_srt: bool,
    pub has_analysis: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartTranscriptionBatchRequest {
    pub input_dir: Option<String>,
    pub input_paths: Option<Vec<String>>,
    pub allowed_extensions: Option<Vec<String>>,
    pub yap_mode: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartFlagBatchRequest {
    pub input_dir: Option<String>,
    pub input_paths: Option<Vec<String>>,
    pub allowed_extensions: Option<Vec<String>>,
    pub engine: Option<String>,
    pub analysis_strategy: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListSrtFilesRequest {
    pub input_dir: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SrtListItem {
    pub file_name: String,
    pub path: String,
    pub analysis_path: Option<String>,
    pub has_analysis: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CutRange {
    pub start: String,
    pub end: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartCutJobRequest {
    pub video_path: String,
    pub ranges: Vec<CutRange>,
    pub output_mode: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelTaskRequest {
    pub task_id: String,
    pub mode: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CutJobStartedResponse {
    pub task_id: String,
    pub video_path: String,
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct BatchSummary {
    pub ok: usize,
    pub failed: usize,
    pub cancelled: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct TaskSummary {
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TaskKind {
    Transcription,
    Flag,
    Cut,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TaskJobStatus {
    Queued,
    Running,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    Queued,
    Running,
    Completed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TaskJobRecord {
    pub job_id: String,
    pub file_name: String,
    pub input_path: String,
    pub output_path: Option<String>,
    pub status: TaskJobStatus,
    pub progress_pct: u8,
    pub error: Option<String>,
    pub logs: Vec<String>,
    pub artifacts: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TaskState {
    pub task_id: String,
    pub task_kind: TaskKind,
    pub status: TaskStatus,
    pub jobs: Vec<TaskJobRecord>,
    pub summary: Option<TaskSummary>,
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
#[serde(rename_all = "camelCase")]
pub struct TaskCancelAck {
    pub task_id: String,
    pub accepted: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkerStatusKind {
    Starting,
    Ready,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AnalyticsTaskKind {
    RemoveMusic,
    Transcription,
    Flag,
    Cut,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AnalyticsWorkRecord {
    pub task_kind: AnalyticsTaskKind,
    pub job_count: usize,
    pub success_count: usize,
    pub failed_count: usize,
    pub cancelled_count: usize,
    pub flagged_item_count: usize,
    pub flagged_file_count: usize,
    pub processing_minutes: u64,
    pub completed_at_epoch_seconds: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct AnalyticsTotals {
    pub total_media_processed: usize,
    pub total_remove_music_jobs: usize,
    pub total_transcription_jobs: usize,
    pub total_flag_jobs: usize,
    pub total_cut_jobs: usize,
    pub total_flagged_items: usize,
    pub total_files_with_flags: usize,
    pub success_count: usize,
    pub failure_count: usize,
    pub cancelled_count: usize,
    pub cumulative_processing_minutes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AnalyticsTaskKindBreakdown {
    pub task_kind: AnalyticsTaskKind,
    pub jobs: usize,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AnalyticsSnapshot {
    pub totals: AnalyticsTotals,
    pub breakdown: Vec<AnalyticsTaskKindBreakdown>,
    pub recent_runs: usize,
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
    JobLog {
        #[serde(rename = "batchId")]
        batch_id: String,
        #[serde(rename = "jobId")]
        job_id: String,
        message: String,
        stream: String,
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

    pub fn job_log(
        batch_id: impl Into<String>,
        job_id: impl Into<String>,
        message: impl Into<String>,
        stream: impl Into<String>,
    ) -> Self {
        Self::JobLog {
            batch_id: batch_id.into(),
            job_id: job_id.into(),
            message: message.into(),
            stream: stream.into(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum TaskEvent {
    JobProgress {
        #[serde(rename = "taskId")]
        task_id: String,
        #[serde(rename = "taskKind")]
        task_kind: TaskKind,
        #[serde(rename = "jobId")]
        job_id: String,
        #[serde(rename = "progressPct")]
        progress_pct: u8,
    },
    JobDone {
        #[serde(rename = "taskId")]
        task_id: String,
        #[serde(rename = "taskKind")]
        task_kind: TaskKind,
        #[serde(rename = "jobId")]
        job_id: String,
        #[serde(rename = "outputPath")]
        output_path: Option<String>,
        artifacts: Option<serde_json::Value>,
    },
    JobError {
        #[serde(rename = "taskId")]
        task_id: String,
        #[serde(rename = "taskKind")]
        task_kind: TaskKind,
        #[serde(rename = "jobId")]
        job_id: String,
        error: String,
    },
    TaskDone {
        #[serde(rename = "taskId")]
        task_id: String,
        #[serde(rename = "taskKind")]
        task_kind: TaskKind,
        summary: TaskSummary,
    },
    JobLog {
        #[serde(rename = "taskId")]
        task_id: String,
        #[serde(rename = "taskKind")]
        task_kind: TaskKind,
        #[serde(rename = "jobId")]
        job_id: String,
        message: String,
        stream: String,
    },
    WorkerStatus {
        status: WorkerStatusKind,
        message: String,
    },
}

impl TaskEvent {
    pub fn worker_status(status: WorkerStatusKind, message: impl Into<String>) -> Self {
        Self::WorkerStatus {
            status,
            message: message.into(),
        }
    }

    pub fn job_progress(
        task_id: impl Into<String>,
        task_kind: TaskKind,
        job_id: impl Into<String>,
        progress_pct: u8,
    ) -> Self {
        Self::JobProgress {
            task_id: task_id.into(),
            task_kind,
            job_id: job_id.into(),
            progress_pct,
        }
    }

    pub fn job_done(
        task_id: impl Into<String>,
        task_kind: TaskKind,
        job_id: impl Into<String>,
        output_path: Option<String>,
        artifacts: Option<serde_json::Value>,
    ) -> Self {
        Self::JobDone {
            task_id: task_id.into(),
            task_kind,
            job_id: job_id.into(),
            output_path,
            artifacts,
        }
    }

    pub fn job_error(
        task_id: impl Into<String>,
        task_kind: TaskKind,
        job_id: impl Into<String>,
        error: impl Into<String>,
    ) -> Self {
        Self::JobError {
            task_id: task_id.into(),
            task_kind,
            job_id: job_id.into(),
            error: error.into(),
        }
    }

    pub fn task_done(task_id: impl Into<String>, task_kind: TaskKind, summary: TaskSummary) -> Self {
        Self::TaskDone {
            task_id: task_id.into(),
            task_kind,
            summary,
        }
    }

    pub fn job_log(
        task_id: impl Into<String>,
        task_kind: TaskKind,
        job_id: impl Into<String>,
        message: impl Into<String>,
        stream: impl Into<String>,
    ) -> Self {
        Self::JobLog {
            task_id: task_id.into(),
            task_kind,
            job_id: job_id.into(),
            message: message.into(),
            stream: stream.into(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModerationRule {
    pub rule_id: String,
    pub category: String,
    pub priority: String,
    pub reason: String,
    pub patterns: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModerationSettings {
    #[serde(default = "default_moderation_engine")]
    pub engine: String,
    #[serde(default = "default_analysis_strategy")]
    pub analysis_strategy: String,
    #[serde(default)]
    pub google_api_key: String,
    #[serde(default)]
    pub amazon_nova_api_key: String,
    pub content_criteria: String,
    pub priority_guidelines: String,
    pub profanity_words: Vec<String>,
    pub rules: Vec<ModerationRule>,
}

fn default_moderation_engine() -> String {
    "blacklist".to_string()
}

fn default_analysis_strategy() -> String {
    "fast".to_string()
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveAck {
    pub success: bool,
}
