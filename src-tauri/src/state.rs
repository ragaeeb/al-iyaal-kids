use std::{collections::HashMap, sync::Arc};

use tokio::sync::{mpsc, Mutex};

use crate::{
    protocol::WorkerEvent,
    types::{
        BatchState, BatchStatus, JobStatus, TaskJobStatus, TaskKind, TaskState, TaskStatus,
    },
};

pub type WorkerSender = mpsc::UnboundedSender<crate::protocol::WorkerCommand>;

#[derive(Clone)]
pub struct AppState {
    pub batches: Arc<Mutex<HashMap<String, BatchState>>>,
    pub tasks: Arc<Mutex<HashMap<String, TaskState>>>,
    pub worker_sender: Arc<Mutex<Option<WorkerSender>>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            batches: Arc::new(Mutex::new(HashMap::new())),
            tasks: Arc::new(Mutex::new(HashMap::new())),
            worker_sender: Arc::new(Mutex::new(None)),
        }
    }

    pub async fn insert_batch(&self, batch: BatchState) {
        let mut batches = self.batches.lock().await;
        batches.insert(batch.batch_id.clone(), batch);
    }

    pub async fn get_batch(&self, batch_id: &str) -> Option<BatchState> {
        let batches = self.batches.lock().await;
        batches.get(batch_id).cloned()
    }

    pub async fn set_worker_sender(&self, sender: WorkerSender) {
        let mut worker_sender = self.worker_sender.lock().await;
        *worker_sender = Some(sender);
    }

    pub async fn insert_task(&self, task: TaskState) {
        let mut tasks = self.tasks.lock().await;
        tasks.insert(task.task_id.clone(), task);
    }

    pub async fn get_task(&self, task_id: &str) -> Option<TaskState> {
        let tasks = self.tasks.lock().await;
        tasks.get(task_id).cloned()
    }

    pub async fn clear_worker_sender(&self) {
        let mut worker_sender = self.worker_sender.lock().await;
        *worker_sender = None;
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
                ..
            } => {
                if let Some(batch_id) = batch_id {
                    let mut batches = self.batches.lock().await;
                    if let Some(batch) = batches.get_mut(batch_id) {
                        if let Some(job) = batch.jobs.iter_mut().find(|job| job.job_id == *job_id) {
                            job.status = JobStatus::Completed;
                            job.progress_pct = 100;
                            job.output_path = output_path.clone();
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
                            job.status = TaskJobStatus::Completed;
                            job.progress_pct = 100;
                            job.output_path = output_path.clone();
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
                                job.error =
                                    Some("Worker ended before emitting final job state.".to_string());
                            }
                        }
                    }
                }
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
                                job.error =
                                    Some("Worker ended before emitting final job state.".to_string());
                            }
                        }
                    }
                }
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
                            job.logs.push(message.clone());
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

#[cfg(test)]
mod tests {
    use crate::{
        protocol::WorkerEvent,
        types::{
            BatchState, BatchStatus, BatchSummary, JobRecord, JobStatus, TaskJobRecord,
            TaskJobStatus, TaskState, TaskStatus, TaskSummary,
        },
    };

    use super::AppState;

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
            status: TaskStatus::Queued,
            jobs: vec![TaskJobRecord {
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

        state
            .apply_worker_event(&WorkerEvent::BatchDone {
                batch_id: "batch-1".to_string(),
                summary: BatchSummary {
                    ok: 1,
                    failed: 0,
                    cancelled: 1,
                },
            })
            .await;

        let batch = state
            .get_batch("batch-1")
            .await
            .expect("batch should still exist");

        assert_eq!(batch.status, BatchStatus::Cancelled);
        assert_eq!(batch.jobs[0].status, JobStatus::Failed);
        assert_eq!(batch.jobs[1].status, JobStatus::Cancelled);
        assert_eq!(batch.summary.expect("summary should exist").cancelled, 1);
    }

    #[tokio::test]
    async fn should_update_task_state_and_logs_from_worker_events() {
        let state = AppState::new();
        state.insert_task(seed_task()).await;

        state
            .apply_worker_event(&WorkerEvent::JobProgress {
                batch_id: None,
                task_id: Some("task-1".to_string()),
                task_kind: Some("transcription".to_string()),
                job_id: "job-a".to_string(),
                progress_pct: 58.0,
            })
            .await;

        state
            .apply_worker_event(&WorkerEvent::JobLog {
                batch_id: None,
                task_id: Some("task-1".to_string()),
                task_kind: Some("transcription".to_string()),
                job_id: "job-a".to_string(),
                message: "line".to_string(),
                stream: Some("stdout".to_string()),
            })
            .await;

        state
            .apply_worker_event(&WorkerEvent::TaskDone {
                task_id: "task-1".to_string(),
                task_kind: "transcription".to_string(),
                summary: TaskSummary {
                    ok: 1,
                    failed: 0,
                    cancelled: 0,
                },
            })
            .await;

        let task = state
            .get_task("task-1")
            .await
            .expect("task should still exist");
        assert_eq!(task.status, TaskStatus::Completed);
        assert_eq!(task.jobs[0].logs.len(), 1);
    }
}
