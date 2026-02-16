use std::{collections::HashMap, sync::Arc};

use tokio::sync::{mpsc, Mutex};

use crate::{
    protocol::WorkerEvent,
    types::{BatchState, BatchStatus, JobStatus},
};

pub type WorkerSender = mpsc::UnboundedSender<crate::protocol::WorkerCommand>;

#[derive(Clone)]
pub struct AppState {
    pub batches: Arc<Mutex<HashMap<String, BatchState>>>,
    pub worker_sender: Arc<Mutex<Option<WorkerSender>>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            batches: Arc::new(Mutex::new(HashMap::new())),
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
                job_id,
                progress_pct,
            } => {
                let mut batches = self.batches.lock().await;
                if let Some(batch) = batches.get_mut(batch_id) {
                    batch.status = BatchStatus::Running;
                    if let Some(job) = batch.jobs.iter_mut().find(|job| job.job_id == *job_id) {
                        job.status = JobStatus::Running;
                        job.progress_pct = progress_pct.round().clamp(0.0, 100.0) as u8;
                    }
                }
            }
            WorkerEvent::JobDone {
                batch_id,
                job_id,
                output_path,
            } => {
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
            WorkerEvent::JobError {
                batch_id,
                job_id,
                error,
            } => {
                let mut batches = self.batches.lock().await;
                if let Some(batch) = batches.get_mut(batch_id) {
                    if let Some(job) = batch.jobs.iter_mut().find(|job| job.job_id == *job_id) {
                        job.status = JobStatus::Failed;
                        job.error = Some(error.clone());
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
            WorkerEvent::WorkerStatus { .. } => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::{
        protocol::WorkerEvent,
        types::{BatchState, BatchStatus, BatchSummary, JobRecord, JobStatus},
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

    #[tokio::test]
    async fn should_update_queue_state_from_worker_events() {
        let state = AppState::new();
        state.insert_batch(seed_batch()).await;

        state
            .apply_worker_event(&WorkerEvent::JobProgress {
                batch_id: "batch-1".to_string(),
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
}
