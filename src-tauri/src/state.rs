use std::{
    collections::{HashMap, VecDeque},
    sync::Arc,
};

use tokio::sync::{mpsc, Mutex};

use crate::{
    protocol::WorkerEvent,
    types::{
        BatchState, BatchStatus, BatchSummary, JobStatus, TaskJobStatus, TaskKind, TaskState,
        TaskStatus, TaskSummary,
    },
};

pub type WorkerSender = mpsc::UnboundedSender<crate::protocol::WorkerCommand>;
const MAX_TASK_JOB_LOG_LINES: usize = 200;
const MAX_SYSTEM_LOG_LINES: usize = 500;
const MAX_TERMINAL_HISTORY: usize = 100;
const MAX_DIAGNOSTIC_LINE_CHARS: usize = 4096;
const DIAGNOSTIC_TRUNCATION_MARKER: &str = " ...[truncated]";

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum BackendOperation {
    Batch(String),
    Task(String),
}

fn push_bounded_log(logs: &mut Vec<String>, message: String) {
    logs.push(bound_diagnostic_line(message));
    if logs.len() > MAX_TASK_JOB_LOG_LINES {
        let overflow = logs.len() - MAX_TASK_JOB_LOG_LINES;
        logs.drain(0..overflow);
    }
}

pub(crate) fn bound_diagnostic_line(message: String) -> String {
    if message.chars().count() <= MAX_DIAGNOSTIC_LINE_CHARS {
        return message;
    }

    let prefix_length =
        MAX_DIAGNOSTIC_LINE_CHARS.saturating_sub(DIAGNOSTIC_TRUNCATION_MARKER.chars().count());
    format!(
        "{}{}",
        message.chars().take(prefix_length).collect::<String>(),
        DIAGNOSTIC_TRUNCATION_MARKER
    )
}

#[derive(Clone)]
pub struct AppState {
    pub batches: Arc<Mutex<HashMap<String, BatchState>>>,
    pub tasks: Arc<Mutex<HashMap<String, TaskState>>>,
    pub worker_sender: Arc<Mutex<Option<WorkerSender>>>,
    pub worker_start_lock: Arc<Mutex<()>>,
    backend_admission: Arc<Mutex<Option<BackendOperation>>>,
    terminal_batch_order: Arc<Mutex<VecDeque<String>>>,
    terminal_task_order: Arc<Mutex<VecDeque<String>>>,
    pub log_lines: Arc<Mutex<VecDeque<String>>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            batches: Arc::new(Mutex::new(HashMap::new())),
            tasks: Arc::new(Mutex::new(HashMap::new())),
            worker_sender: Arc::new(Mutex::new(None)),
            worker_start_lock: Arc::new(Mutex::new(())),
            backend_admission: Arc::new(Mutex::new(None)),
            terminal_batch_order: Arc::new(Mutex::new(VecDeque::new())),
            terminal_task_order: Arc::new(Mutex::new(VecDeque::new())),
            log_lines: Arc::new(Mutex::new(VecDeque::new())),
        }
    }

    pub async fn push_log_line(&self, line: String) -> String {
        let line = bound_diagnostic_line(line);
        let mut logs = self.log_lines.lock().await;
        logs.push_back(line.clone());
        if logs.len() > MAX_SYSTEM_LOG_LINES {
            logs.pop_front();
        }
        line
    }

    pub async fn get_log_history(&self) -> Vec<String> {
        let logs = self.log_lines.lock().await;
        logs.iter().cloned().collect()
    }

    pub async fn insert_batch(&self, batch: BatchState) {
        let batch_id = batch.batch_id.clone();
        let mut batches = self.batches.lock().await;
        batches.insert(batch_id, batch);
    }

    pub async fn get_batch(&self, batch_id: &str) -> Option<BatchState> {
        let batches = self.batches.lock().await;
        batches.get(batch_id).cloned()
    }

    pub async fn remove_batch(&self, batch_id: &str) {
        self.terminal_batch_order
            .lock()
            .await
            .retain(|id| id != batch_id);
        self.batches.lock().await.remove(batch_id);
    }

    pub async fn set_worker_sender(&self, sender: WorkerSender) {
        let mut worker_sender = self.worker_sender.lock().await;
        *worker_sender = Some(sender);
    }

    pub async fn insert_task(&self, task: TaskState) {
        let task_id = task.task_id.clone();
        let mut tasks = self.tasks.lock().await;
        tasks.insert(task_id, task);
    }

    pub async fn get_task(&self, task_id: &str) -> Option<TaskState> {
        let tasks = self.tasks.lock().await;
        tasks.get(task_id).cloned()
    }

    pub async fn remove_task(&self, task_id: &str) {
        self.terminal_task_order
            .lock()
            .await
            .retain(|id| id != task_id);
        self.tasks.lock().await.remove(task_id);
    }

    pub async fn clear_worker_sender_if_current(&self, sender: &WorkerSender) -> bool {
        let mut worker_sender = self.worker_sender.lock().await;
        let is_current = worker_sender
            .as_ref()
            .is_some_and(|current| current.same_channel(sender));
        if is_current {
            *worker_sender = None;
        }
        is_current
    }

    pub async fn try_admit_backend_operation(&self, operation: BackendOperation) -> bool {
        let mut admission = self.backend_admission.lock().await;
        if admission.is_some() {
            return false;
        }

        let batches = self.batches.lock().await;
        if batches
            .values()
            .any(|batch| matches!(batch.status, BatchStatus::Queued | BatchStatus::Running))
        {
            return false;
        }
        drop(batches);

        let tasks = self.tasks.lock().await;
        if tasks
            .values()
            .any(|task| matches!(task.status, TaskStatus::Queued | TaskStatus::Running))
        {
            return false;
        }

        *admission = Some(operation);
        true
    }

    pub async fn release_backend_operation(&self, operation: &BackendOperation) {
        let mut admission = self.backend_admission.lock().await;
        if admission.as_ref() == Some(operation) {
            *admission = None;
        }
    }

    pub async fn terminalize_active_work(&self, error: &str) -> Vec<WorkerEvent> {
        let mut events = Vec::new();
        {
            let batches = self.batches.lock().await;
            for batch in batches.values() {
                if !matches!(batch.status, BatchStatus::Queued | BatchStatus::Running) {
                    continue;
                }
                for job in &batch.jobs {
                    if matches!(job.status, JobStatus::Queued | JobStatus::Running) {
                        events.push(WorkerEvent::JobError {
                            batch_id: Some(batch.batch_id.clone()),
                            task_id: None,
                            task_kind: None,
                            job_id: job.job_id.clone(),
                            error: error.to_string(),
                        });
                    }
                }
                events.push(WorkerEvent::BatchDone {
                    batch_id: batch.batch_id.clone(),
                    summary: batch_failure_summary(batch),
                });
            }
        }

        {
            let tasks = self.tasks.lock().await;
            for task in tasks.values() {
                if !matches!(task.status, TaskStatus::Queued | TaskStatus::Running) {
                    continue;
                }
                let task_kind = task_kind_name(&task.task_kind).to_string();
                for job in &task.jobs {
                    if matches!(job.status, TaskJobStatus::Queued | TaskJobStatus::Running) {
                        events.push(WorkerEvent::JobError {
                            batch_id: None,
                            task_id: Some(task.task_id.clone()),
                            task_kind: Some(task_kind.clone()),
                            job_id: job.job_id.clone(),
                            error: error.to_string(),
                        });
                    }
                }
                events.push(WorkerEvent::TaskDone {
                    task_id: task.task_id.clone(),
                    task_kind,
                    summary: task_failure_summary(task),
                });
            }
        }

        for event in &events {
            self.apply_worker_event(event).await;
        }
        events
    }

    async fn record_terminal_batch(&self, batch_id: &str) {
        let mut order = self.terminal_batch_order.lock().await;
        if !order.iter().any(|id| id == batch_id) {
            order.push_back(batch_id.to_string());
        }
    }

    async fn record_terminal_task(&self, task_id: &str) {
        let mut order = self.terminal_task_order.lock().await;
        if !order.iter().any(|id| id == task_id) {
            order.push_back(task_id.to_string());
        }
    }

    pub async fn prune_terminal_history(&self) {
        let mut batch_order = self.terminal_batch_order.lock().await;
        let mut batches = self.batches.lock().await;
        while batch_order.len() > MAX_TERMINAL_HISTORY {
            if let Some(batch_id) = batch_order.pop_front() {
                let is_active = batches.get(&batch_id).is_some_and(|batch| {
                    matches!(batch.status, BatchStatus::Queued | BatchStatus::Running)
                });
                if !is_active {
                    batches.remove(&batch_id);
                }
            }
        }
        drop(batches);
        drop(batch_order);

        let mut task_order = self.terminal_task_order.lock().await;
        let mut tasks = self.tasks.lock().await;
        while task_order.len() > MAX_TERMINAL_HISTORY {
            if let Some(task_id) = task_order.pop_front() {
                let is_active = tasks.get(&task_id).is_some_and(|task| {
                    matches!(task.status, TaskStatus::Queued | TaskStatus::Running)
                });
                if !is_active {
                    tasks.remove(&task_id);
                }
            }
        }
    }

    pub async fn worker_sender(&self) -> Option<WorkerSender> {
        let worker_sender = self.worker_sender.lock().await;
        worker_sender.clone()
    }

    pub async fn apply_worker_event(&self, event: &WorkerEvent) {
        match event {
            WorkerEvent::JobProgress {
                batch_id,
                task_id,
                task_kind,
                job_id,
                progress_pct,
            } => {
                if let Some(batch_id) = batch_id {
                    let mut batches = self.batches.lock().await;
                    if let Some(batch) = batches.get_mut(batch_id) {
                        batch.status = BatchStatus::Running;
                        if let Some(job) = batch.jobs.iter_mut().find(|job| job.job_id == *job_id) {
                            job.status = JobStatus::Running;
                            job.progress_pct = progress_pct.round().clamp(0.0, 100.0) as u8;
                        }
                    }
                }

                if let (Some(task_id), Some(task_kind)) = (task_id, task_kind) {
                    let Some(_task_kind) = parse_task_kind(task_kind) else {
                        return;
                    };
                    let mut tasks = self.tasks.lock().await;
                    if let Some(task) = tasks.get_mut(task_id) {
                        task.status = TaskStatus::Running;
                        if let Some(job) = task.jobs.iter_mut().find(|job| job.job_id == *job_id) {
                            job.status = TaskJobStatus::Running;
                            job.progress_pct = progress_pct.round().clamp(0.0, 100.0) as u8;
                        }
                    }
                }
            }
            WorkerEvent::JobDone {
                batch_id,
                task_id,
                task_kind,
                job_id,
                output_path,
                artifacts,
                ..
            } => {
                if let Some(batch_id) = batch_id {
                    let mut batches = self.batches.lock().await;
                    if let Some(batch) = batches.get_mut(batch_id) {
                        if let Some(job) = batch.jobs.iter_mut().find(|job| job.job_id == *job_id) {
                            job.status = JobStatus::Completed;
                            job.progress_pct = 100;
                            job.output_path = Some(output_path.clone());
                            job.error = None;
                        }
                    }
                }

                if let (Some(task_id), Some(task_kind)) = (task_id, task_kind) {
                    let Some(_task_kind) = parse_task_kind(task_kind) else {
                        return;
                    };
                    let mut tasks = self.tasks.lock().await;
                    if let Some(task) = tasks.get_mut(task_id) {
                        if let Some(job) = task.jobs.iter_mut().find(|job| job.job_id == *job_id) {
                            job.artifacts = artifacts.clone();
                            job.status = TaskJobStatus::Completed;
                            job.progress_pct = 100;
                            job.output_path = Some(output_path.clone());
                            job.error = None;
                        }
                    }
                }
            }
            WorkerEvent::JobError {
                batch_id,
                task_id,
                task_kind,
                job_id,
                error,
            } => {
                if let Some(batch_id) = batch_id {
                    let mut batches = self.batches.lock().await;
                    if let Some(batch) = batches.get_mut(batch_id) {
                        if let Some(job) = batch.jobs.iter_mut().find(|job| job.job_id == *job_id) {
                            job.status = JobStatus::Failed;
                            job.error = Some(error.clone());
                        }
                    }
                }

                if let (Some(task_id), Some(task_kind)) = (task_id, task_kind) {
                    let Some(_task_kind) = parse_task_kind(task_kind) else {
                        return;
                    };
                    let mut tasks = self.tasks.lock().await;
                    if let Some(task) = tasks.get_mut(task_id) {
                        if let Some(job) = task.jobs.iter_mut().find(|job| job.job_id == *job_id) {
                            job.status = TaskJobStatus::Failed;
                            job.error = Some(error.clone());
                        }
                    }
                }
            }
            WorkerEvent::BatchDone { batch_id, summary } => {
                let mut batches = self.batches.lock().await;
                if let Some(batch) = batches.get_mut(batch_id) {
                    batch.summary = Some(summary.clone());
                    batch.status = if summary.cancelled > 0 {
                        BatchStatus::Cancelled
                    } else {
                        BatchStatus::Completed
                    };
                    for job in &mut batch.jobs {
                        if job.status == JobStatus::Queued {
                            job.status = JobStatus::Cancelled;
                        } else if job.status == JobStatus::Running {
                            job.status = JobStatus::Failed;
                            if job.error.is_none() {
                                job.error = Some(
                                    "Worker ended before emitting final job state.".to_string(),
                                );
                            }
                        }
                    }
                }
                drop(batches);
                self.release_backend_operation(&BackendOperation::Batch(batch_id.clone()))
                    .await;
                self.record_terminal_batch(batch_id).await;
            }
            WorkerEvent::TaskDone {
                task_id,
                task_kind,
                summary,
            } => {
                let Some(_task_kind) = parse_task_kind(task_kind) else {
                    return;
                };
                let mut tasks = self.tasks.lock().await;
                if let Some(task) = tasks.get_mut(task_id) {
                    task.summary = Some(summary.clone());
                    task.status = if summary.cancelled > 0 {
                        TaskStatus::Cancelled
                    } else {
                        TaskStatus::Completed
                    };
                    for job in &mut task.jobs {
                        if job.status == TaskJobStatus::Queued {
                            job.status = TaskJobStatus::Cancelled;
                        } else if job.status == TaskJobStatus::Running {
                            job.status = TaskJobStatus::Failed;
                            if job.error.is_none() {
                                job.error = Some(
                                    "Worker ended before emitting final job state.".to_string(),
                                );
                            }
                        }
                    }
                }
                drop(tasks);
                self.release_backend_operation(&BackendOperation::Task(task_id.clone()))
                    .await;
                self.record_terminal_task(task_id).await;
            }
            WorkerEvent::JobLog {
                task_id,
                task_kind,
                job_id,
                message,
                ..
            } => {
                if let (Some(task_id), Some(task_kind)) = (task_id, task_kind) {
                    let Some(_task_kind) = parse_task_kind(task_kind) else {
                        return;
                    };
                    let mut tasks = self.tasks.lock().await;
                    if let Some(task) = tasks.get_mut(task_id) {
                        if let Some(job) = task.jobs.iter_mut().find(|job| job.job_id == *job_id) {
                            push_bounded_log(&mut job.logs, message.clone());
                        }
                    }
                }
            }
            WorkerEvent::WorkerStatus { .. } => {}
        }
    }
}

fn parse_task_kind(value: &str) -> Option<TaskKind> {
    match value {
        "transcription" => Some(TaskKind::Transcription),
        "flag" => Some(TaskKind::Flag),
        "cut" => Some(TaskKind::Cut),
        _ => None,
    }
}

fn task_kind_name(task_kind: &TaskKind) -> &'static str {
    match task_kind {
        TaskKind::Transcription => "transcription",
        TaskKind::Flag => "flag",
        TaskKind::Cut => "cut",
    }
}

fn batch_failure_summary(batch: &BatchState) -> BatchSummary {
    let mut summary = BatchSummary::default();
    for job in &batch.jobs {
        match job.status {
            JobStatus::Completed => summary.ok += 1,
            JobStatus::Failed | JobStatus::Queued | JobStatus::Running => summary.failed += 1,
            JobStatus::Cancelled => summary.cancelled += 1,
        }
    }
    summary
}

fn task_failure_summary(task: &TaskState) -> TaskSummary {
    let mut summary = TaskSummary::default();
    for job in &task.jobs {
        match job.status {
            TaskJobStatus::Completed => summary.ok += 1,
            TaskJobStatus::Failed | TaskJobStatus::Queued | TaskJobStatus::Running => {
                summary.failed += 1
            }
            TaskJobStatus::Cancelled => summary.cancelled += 1,
        }
    }
    summary
}

#[cfg(test)]
mod tests {
    use crate::{
        protocol::WorkerEvent,
        types::{
            BatchState, BatchStatus, BatchSummary, JobRecord, JobStatus, TaskJobRecord,
            TaskJobStatus, TaskState, TaskSummary,
        },
    };

    use super::{
        push_bounded_log, AppState, BackendOperation, DIAGNOSTIC_TRUNCATION_MARKER,
        MAX_DIAGNOSTIC_LINE_CHARS, MAX_TASK_JOB_LOG_LINES, MAX_TERMINAL_HISTORY,
    };

    fn seed_batch() -> BatchState {
        BatchState {
            batch_id: "batch-1".to_string(),
            status: BatchStatus::Queued,
            jobs: vec![
                JobRecord {
                    job_id: "job-a".to_string(),
                    file_name: "a.mov".to_string(),
                    input_path: "/tmp/a.mov".to_string(),
                    output_path: None,
                    status: JobStatus::Queued,
                    progress_pct: 0,
                    error: None,
                },
                JobRecord {
                    job_id: "job-b".to_string(),
                    file_name: "b.mp4".to_string(),
                    input_path: "/tmp/b.mp4".to_string(),
                    output_path: None,
                    status: JobStatus::Queued,
                    progress_pct: 0,
                    error: None,
                },
            ],
            summary: None,
        }
    }

    fn seed_task() -> TaskState {
        TaskState {
            task_id: "task-1".to_string(),
            task_kind: crate::types::TaskKind::Transcription,
            status: crate::types::TaskStatus::Queued,
            jobs: vec![TaskJobRecord {
                artifacts: None,
                job_id: "job-a".to_string(),
                file_name: "a.mov".to_string(),
                input_path: "/tmp/a.mov".to_string(),
                output_path: None,
                status: TaskJobStatus::Queued,
                progress_pct: 0,
                error: None,
                logs: Vec::new(),
            }],
            summary: None,
        }
    }

    #[tokio::test]
    async fn should_update_queue_state_from_worker_events() {
        let state = AppState::new();
        state.insert_batch(seed_batch()).await;

        state
            .apply_worker_event(&WorkerEvent::JobProgress {
                batch_id: Some("batch-1".to_string()),
                task_id: None,
                task_kind: None,
                job_id: "job-a".to_string(),
                progress_pct: 33.0,
            })
            .await;

        let batch = state.get_batch("batch-1").await.unwrap();
        assert_eq!(batch.status, BatchStatus::Running);
        assert_eq!(batch.jobs[0].status, JobStatus::Running);
        assert_eq!(batch.jobs[0].progress_pct, 33);
    }

    #[tokio::test]
    async fn should_record_task_logs_and_completion() {
        let state = AppState::new();
        state.insert_task(seed_task()).await;

        state
            .apply_worker_event(&WorkerEvent::JobLog {
                batch_id: None,
                task_id: Some("task-1".to_string()),
                task_kind: Some("transcription".to_string()),
                job_id: "job-a".to_string(),
                message: "processing".to_string(),
                stream: Some("stdout".to_string()),
            })
            .await;
        state
            .apply_worker_event(&WorkerEvent::TaskDone {
                task_id: "task-1".to_string(),
                task_kind: "transcription".to_string(),
                summary: TaskSummary {
                    cancelled: 0,
                    failed: 0,
                    ok: 1,
                },
            })
            .await;

        let task = state.get_task("task-1").await.unwrap();
        assert_eq!(task.jobs[0].logs, vec!["processing".to_string()]);
        assert_eq!(task.summary.unwrap().ok, 1);
        assert_eq!(task.status, crate::types::TaskStatus::Completed);
    }

    #[tokio::test]
    async fn should_remove_published_work() {
        let state = AppState::new();
        state.insert_batch(seed_batch()).await;
        state.insert_task(seed_task()).await;

        state.remove_batch("batch-1").await;
        state.remove_task("task-1").await;

        assert!(state.get_batch("batch-1").await.is_none());
        assert!(state.get_task("task-1").await.is_none());
    }

    #[tokio::test]
    async fn should_only_clear_the_worker_sender_that_is_still_current() {
        let state = AppState::new();
        let (first_sender, _first_receiver) = tokio::sync::mpsc::unbounded_channel();
        let (second_sender, _second_receiver) = tokio::sync::mpsc::unbounded_channel();

        state.set_worker_sender(second_sender.clone()).await;

        assert!(!state.clear_worker_sender_if_current(&first_sender).await);
        assert!(state.worker_sender().await.is_some());
        assert!(state.clear_worker_sender_if_current(&second_sender).await);
        assert!(state.worker_sender().await.is_none());
    }

    #[tokio::test]
    async fn should_admit_only_one_backend_operation_concurrently() {
        let state = AppState::new();
        let (first, second) = tokio::join!(
            state.try_admit_backend_operation(BackendOperation::Task("task-1".to_string())),
            state.try_admit_backend_operation(BackendOperation::Batch("batch-1".to_string()))
        );

        assert_ne!(first, second);
        let admitted = if first {
            BackendOperation::Task("task-1".to_string())
        } else {
            BackendOperation::Batch("batch-1".to_string())
        };
        assert!(
            !state
                .try_admit_backend_operation(BackendOperation::Task("task-2".to_string()))
                .await
        );
        state.release_backend_operation(&admitted).await;
        assert!(
            state
                .try_admit_backend_operation(BackendOperation::Task("task-2".to_string()))
                .await
        );
    }

    #[tokio::test]
    async fn should_reject_admission_when_active_state_exists() {
        let state = AppState::new();
        state.insert_task(seed_task()).await;

        assert!(
            !state
                .try_admit_backend_operation(BackendOperation::Batch("batch-1".to_string()))
                .await
        );
    }

    #[tokio::test]
    async fn should_terminalize_active_work_and_release_admission() {
        let state = AppState::new();
        assert!(
            state
                .try_admit_backend_operation(BackendOperation::Task("task-1".to_string()))
                .await
        );
        state.insert_task(seed_task()).await;

        let events = state
            .terminalize_active_work("worker exited unexpectedly")
            .await;

        assert!(matches!(events.first(), Some(WorkerEvent::JobError { .. })));
        assert!(matches!(events.last(), Some(WorkerEvent::TaskDone { .. })));
        let task = state.get_task("task-1").await.unwrap();
        assert_eq!(task.status, crate::types::TaskStatus::Completed);
        assert_eq!(task.jobs[0].status, TaskJobStatus::Failed);
        assert_eq!(
            task.jobs[0].error.as_deref(),
            Some("worker exited unexpectedly")
        );
        assert!(
            state
                .try_admit_backend_operation(BackendOperation::Batch("batch-1".to_string()))
                .await
        );
    }

    #[tokio::test]
    async fn should_bound_terminal_history_without_evicting_active_work() {
        let state = AppState::new();

        let mut active_batch = seed_batch();
        active_batch.batch_id = "active-batch".to_string();
        active_batch.status = BatchStatus::Running;
        state.insert_batch(active_batch).await;

        let mut active_task = seed_task();
        active_task.task_id = "active-task".to_string();
        active_task.status = crate::types::TaskStatus::Running;
        state.insert_task(active_task).await;

        for index in 0..(MAX_TERMINAL_HISTORY + 5) {
            let batch_id = format!("batch-{index}");
            let mut batch = seed_batch();
            batch.batch_id = batch_id.clone();
            batch.jobs[0].job_id = format!("job-{index}");
            state.insert_batch(batch).await;
            state
                .apply_worker_event(&WorkerEvent::BatchDone {
                    batch_id: batch_id.clone(),
                    summary: BatchSummary {
                        cancelled: 0,
                        failed: 0,
                        ok: 1,
                    },
                })
                .await;
            state.prune_terminal_history().await;

            let task_id = format!("task-{index}");
            let mut task = seed_task();
            task.task_id = task_id.clone();
            task.jobs[0].job_id = format!("task-job-{index}");
            state.insert_task(task).await;
            state
                .apply_worker_event(&WorkerEvent::TaskDone {
                    task_id: task_id.clone(),
                    task_kind: "flag".to_string(),
                    summary: TaskSummary {
                        cancelled: 0,
                        failed: 0,
                        ok: 1,
                    },
                })
                .await;
            state.prune_terminal_history().await;
        }

        assert!(state.get_batch("batch-0").await.is_none());
        assert!(state.get_task("task-0").await.is_none());
        assert!(state
            .get_batch(&format!("batch-{}", MAX_TERMINAL_HISTORY + 4))
            .await
            .is_some());
        assert!(state
            .get_task(&format!("task-{}", MAX_TERMINAL_HISTORY + 4))
            .await
            .is_some());
        assert!(state.get_batch("active-batch").await.is_some());
        assert!(state.get_task("active-task").await.is_some());
    }

    #[tokio::test]
    async fn should_not_prune_an_active_record_that_reuses_a_terminal_id() {
        let state = AppState::new();

        let mut completed = seed_batch();
        completed.batch_id = "reused-batch".to_string();
        state.insert_batch(completed).await;
        state
            .apply_worker_event(&WorkerEvent::BatchDone {
                batch_id: "reused-batch".to_string(),
                summary: BatchSummary {
                    cancelled: 0,
                    failed: 0,
                    ok: 1,
                },
            })
            .await;

        let mut active = seed_batch();
        active.batch_id = "reused-batch".to_string();
        active.status = BatchStatus::Running;
        state.insert_batch(active).await;

        for index in 0..MAX_TERMINAL_HISTORY {
            let batch_id = format!("terminal-{index}");
            let mut batch = seed_batch();
            batch.batch_id = batch_id.clone();
            state.insert_batch(batch).await;
            state
                .apply_worker_event(&WorkerEvent::BatchDone {
                    batch_id,
                    summary: BatchSummary {
                        cancelled: 0,
                        failed: 0,
                        ok: 1,
                    },
                })
                .await;
        }
        state.prune_terminal_history().await;

        assert_eq!(
            state.get_batch("reused-batch").await.unwrap().status,
            BatchStatus::Running
        );
    }

    #[test]
    fn should_cap_task_job_logs_to_recent_entries() {
        let mut logs = Vec::new();
        for index in 0..(MAX_TASK_JOB_LOG_LINES + 5) {
            push_bounded_log(&mut logs, format!("line-{index}"));
        }

        assert_eq!(logs.len(), MAX_TASK_JOB_LOG_LINES);
        assert_eq!(logs.first().unwrap(), "line-5");
        assert_eq!(
            logs.last().unwrap(),
            &format!("line-{}", MAX_TASK_JOB_LOG_LINES + 4)
        );
    }

    #[tokio::test]
    async fn should_cap_system_log_lines_to_recent_entries() {
        let state = AppState::new();
        for index in 0..505 {
            state.push_log_line(format!("system-line-{index}")).await;
        }

        let history = state.get_log_history().await;
        assert_eq!(history.len(), 500);
        assert_eq!(history.first().unwrap(), "system-line-5");
        assert_eq!(history.last().unwrap(), "system-line-504");
    }

    #[tokio::test]
    async fn should_bound_diagnostic_line_bytes_without_splitting_utf8() {
        let state = AppState::new();
        let bounded = state
            .push_log_line("字幕".repeat(MAX_DIAGNOSTIC_LINE_CHARS))
            .await;

        assert!(bounded.chars().count() <= MAX_DIAGNOSTIC_LINE_CHARS);
        assert!(bounded.ends_with(DIAGNOSTIC_TRUNCATION_MARKER));
        assert!(std::str::from_utf8(bounded.as_bytes()).is_ok());

        let history = state.get_log_history().await;
        assert_eq!(history, vec![bounded]);
    }

    #[test]
    fn should_bound_task_diagnostic_lines_with_the_same_marker() {
        let mut logs = Vec::new();
        push_bounded_log(&mut logs, "日志".repeat(MAX_DIAGNOSTIC_LINE_CHARS));

        assert_eq!(logs.len(), 1);
        assert!(logs[0].ends_with(DIAGNOSTIC_TRUNCATION_MARKER));
        assert!(logs[0].chars().count() <= MAX_DIAGNOSTIC_LINE_CHARS);
    }
}
