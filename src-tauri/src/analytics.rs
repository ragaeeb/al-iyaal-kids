use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::types::{
    AnalyticsSnapshot, AnalyticsTaskKind, AnalyticsTaskKindBreakdown, AnalyticsTotals,
    AnalyticsWorkRecord, BatchState, TaskKind, TaskState,
};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct AnalyticsStore {
    records: Vec<AnalyticsWorkRecord>,
}

fn analytics_store_path_from_dir(base_dir: &Path) -> PathBuf {
    base_dir.join("analytics/history.json")
}

fn analytics_store_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to resolve analytics app data directory: {error}"))?;
    Ok(analytics_store_path_from_dir(&app_data_dir))
}

fn read_store(path: &Path) -> Result<AnalyticsStore, String> {
    if !path.exists() {
        return Ok(AnalyticsStore::default());
    }

    let content = fs::read_to_string(path)
        .map_err(|error| format!("Failed reading analytics store {}: {error}", path.display()))?;
    serde_json::from_str(&content)
        .map_err(|error| format!("Invalid analytics store {}: {error}", path.display()))
}

fn write_store(path: &Path, store: &AnalyticsStore) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "Failed creating analytics directory {}: {error}",
                parent.display()
            )
        })?;
    }

    let content = serde_json::to_string_pretty(store)
        .map_err(|error| format!("Failed serializing analytics store: {error}"))?;
    let Some(parent) = path.parent() else {
        return Err(format!(
            "Failed determining parent directory for analytics store {}",
            path.display()
        ));
    };
    let temp_path = parent.join(format!(
        ".{}.tmp-{}",
        path.file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("history.json"),
        now_epoch_seconds()
    ));

    let mut temp_file = fs::File::create(&temp_path).map_err(|error| {
        format!(
            "Failed creating temp analytics store {}: {error}",
            temp_path.display()
        )
    })?;
    temp_file.write_all(content.as_bytes()).map_err(|error| {
        format!(
            "Failed writing temp analytics store {}: {error}",
            temp_path.display()
        )
    })?;
    temp_file.sync_all().map_err(|error| {
        format!(
            "Failed syncing temp analytics store {}: {error}",
            temp_path.display()
        )
    })?;
    drop(temp_file);

    fs::rename(&temp_path, path).map_err(|error| {
        format!(
            "Failed renaming analytics store {}: {error}",
            path.display()
        )
    })?;

    let parent_dir = fs::File::open(parent).map_err(|error| {
        format!(
            "Failed opening analytics directory {} for sync: {error}",
            parent.display()
        )
    })?;
    parent_dir.sync_all().map_err(|error| {
        format!(
            "Failed syncing analytics directory {}: {error}",
            parent.display()
        )
    })
}

fn now_epoch_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or(Duration::from_secs(0))
        .as_secs()
}

fn duration_minutes(started_at_epoch_seconds: Option<u64>) -> u64 {
    let Some(started_at_epoch_seconds) = started_at_epoch_seconds else {
        return 0;
    };

    let started_at = UNIX_EPOCH + Duration::from_secs(started_at_epoch_seconds);
    let elapsed = SystemTime::now()
        .duration_since(started_at)
        .unwrap_or(Duration::from_secs(0));
    elapsed.as_secs().div_ceil(60)
}

fn append_record(path: &Path, record: AnalyticsWorkRecord) -> Result<(), String> {
    let mut store = read_store(path)?;
    store.records.push(record);
    write_store(path, &store)
}

fn flagged_count_from_artifacts(value: &Option<serde_json::Value>) -> usize {
    let Some(artifacts) = value else {
        return 0;
    };

    artifacts
        .get("flaggedCount")
        .and_then(|value| value.as_u64())
        .unwrap_or(0) as usize
}

fn create_batch_record(batch: &BatchState, started_at_epoch_seconds: Option<u64>) -> AnalyticsWorkRecord {
    let summary = batch.summary.clone().unwrap_or_default();

    AnalyticsWorkRecord {
        cancelled_count: summary.cancelled,
        completed_at_epoch_seconds: now_epoch_seconds(),
        failed_count: summary.failed,
        flagged_file_count: 0,
        flagged_item_count: 0,
        job_count: batch.jobs.len(),
        processing_minutes: duration_minutes(started_at_epoch_seconds),
        success_count: summary.ok,
        task_kind: AnalyticsTaskKind::RemoveMusic,
    }
}

fn create_task_record(task: &TaskState, started_at_epoch_seconds: Option<u64>) -> AnalyticsWorkRecord {
    let summary = task.summary.clone().unwrap_or_default();
    let flagged_item_count = if task.task_kind == TaskKind::Flag {
        task.jobs.iter().map(|job| flagged_count_from_artifacts(&job.artifacts)).sum()
    } else {
        0
    };
    let flagged_file_count = if task.task_kind == TaskKind::Flag {
        task.jobs
            .iter()
            .filter(|job| flagged_count_from_artifacts(&job.artifacts) > 0)
            .count()
    } else {
        0
    };

    AnalyticsWorkRecord {
        cancelled_count: summary.cancelled,
        completed_at_epoch_seconds: now_epoch_seconds(),
        failed_count: summary.failed,
        flagged_file_count,
        flagged_item_count,
        job_count: task.jobs.len(),
        processing_minutes: duration_minutes(started_at_epoch_seconds),
        success_count: summary.ok,
        task_kind: task_kind_to_analytics_kind(&task.task_kind),
    }
}

fn task_kind_to_analytics_kind(task_kind: &TaskKind) -> AnalyticsTaskKind {
    match task_kind {
        TaskKind::Cut => AnalyticsTaskKind::Cut,
        TaskKind::Flag => AnalyticsTaskKind::Flag,
        TaskKind::Transcription => AnalyticsTaskKind::Transcription,
    }
}

fn breakdown_entry(task_kind: AnalyticsTaskKind, jobs: usize, label: &str) -> AnalyticsTaskKindBreakdown {
    AnalyticsTaskKindBreakdown {
        jobs,
        label: label.to_string(),
        task_kind,
    }
}

fn snapshot_from_store(store: &AnalyticsStore) -> AnalyticsSnapshot {
    let totals = store.records.iter().fold(AnalyticsTotals::default(), |mut totals, record| {
        totals.cancelled_count += record.cancelled_count;
        totals.cumulative_processing_minutes += record.processing_minutes;
        totals.failure_count += record.failed_count;
        totals.total_flagged_items += record.flagged_item_count;
        totals.total_files_with_flags += record.flagged_file_count;
        totals.success_count += record.success_count;
        totals.total_media_processed += record.job_count;

        match record.task_kind {
            AnalyticsTaskKind::Cut => totals.total_cut_jobs += record.job_count,
            AnalyticsTaskKind::Flag => totals.total_flag_jobs += record.job_count,
            AnalyticsTaskKind::RemoveMusic => totals.total_remove_music_jobs += record.job_count,
            AnalyticsTaskKind::Transcription => totals.total_transcription_jobs += record.job_count,
        }

        totals
    });

    AnalyticsSnapshot {
        breakdown: vec![
            breakdown_entry(
                AnalyticsTaskKind::RemoveMusic,
                totals.total_remove_music_jobs,
                "Remove Music",
            ),
            breakdown_entry(
                AnalyticsTaskKind::Transcription,
                totals.total_transcription_jobs,
                "Transcriptions",
            ),
            breakdown_entry(AnalyticsTaskKind::Flag, totals.total_flag_jobs, "Detection Runs"),
            breakdown_entry(AnalyticsTaskKind::Cut, totals.total_cut_jobs, "Cut Exports"),
        ],
        recent_runs: store.records.len(),
        totals,
    }
}

pub fn get_analytics_snapshot(app: &AppHandle) -> Result<AnalyticsSnapshot, String> {
    let path = analytics_store_path(app)?;
    let store = read_store(&path)?;
    Ok(snapshot_from_store(&store))
}

pub fn record_batch_completion(
    app: &AppHandle,
    batch: &BatchState,
    started_at_epoch_seconds: Option<u64>,
) -> Result<(), String> {
    let path = analytics_store_path(app)?;
    append_record(&path, create_batch_record(batch, started_at_epoch_seconds))
}

pub fn record_task_completion(
    app: &AppHandle,
    task: &TaskState,
    started_at_epoch_seconds: Option<u64>,
) -> Result<(), String> {
    let path = analytics_store_path(app)?;
    append_record(&path, create_task_record(task, started_at_epoch_seconds))
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use uuid::Uuid;

    use crate::types::{
        AnalyticsTaskKind, BatchState, BatchStatus, BatchSummary, JobRecord, JobStatus,
        TaskJobRecord, TaskJobStatus, TaskKind, TaskState, TaskStatus, TaskSummary,
    };

    use super::{
        analytics_store_path_from_dir, append_record, create_batch_record, create_task_record,
        read_store, snapshot_from_store,
    };

    fn temp_path() -> PathBuf {
        std::env::temp_dir().join(format!("al-iyaal-kids-analytics-{}", Uuid::new_v4()))
    }

    fn seed_batch() -> BatchState {
        BatchState {
            batch_id: "batch-1".to_string(),
            jobs: vec![JobRecord {
                error: None,
                file_name: "sample.mp4".to_string(),
                input_path: "/tmp/sample.mp4".to_string(),
                job_id: "job-1".to_string(),
                output_path: Some("/tmp/audio_replaced/sample.mp4".to_string()),
                progress_pct: 100,
                status: JobStatus::Completed,
            }],
            status: BatchStatus::Completed,
            summary: Some(BatchSummary {
                cancelled: 0,
                failed: 0,
                ok: 1,
            }),
        }
    }

    fn seed_task() -> TaskState {
        TaskState {
            jobs: vec![TaskJobRecord {
                artifacts: Some(serde_json::json!({
                    "flaggedCount": 3,
                    "summary": "Flagged 3 subtitle item(s).",
                })),
                error: None,
                file_name: "sample.srt".to_string(),
                input_path: "/tmp/sample.srt".to_string(),
                job_id: "job-2".to_string(),
                logs: vec![],
                output_path: Some("/tmp/sample.analysis.json".to_string()),
                progress_pct: 100,
                status: TaskJobStatus::Completed,
            }],
            status: TaskStatus::Completed,
            summary: Some(TaskSummary {
                cancelled: 0,
                failed: 0,
                ok: 1,
            }),
            task_id: "task-1".to_string(),
            task_kind: TaskKind::Flag,
        }
    }

    #[test]
    fn should_build_an_analytics_snapshot_from_persisted_task_history() {
        let base_dir = temp_path();
        let path = analytics_store_path_from_dir(&base_dir);

        append_record(&path, create_batch_record(&seed_batch(), Some(1))).unwrap();
        append_record(&path, create_task_record(&seed_task(), Some(1))).unwrap();

        let store = read_store(&path).unwrap();
        let snapshot = snapshot_from_store(&store);

        assert_eq!(snapshot.recent_runs, 2);
        assert_eq!(snapshot.totals.total_media_processed, 2);
        assert_eq!(snapshot.totals.total_remove_music_jobs, 1);
        assert_eq!(snapshot.totals.total_flag_jobs, 1);
        assert_eq!(snapshot.totals.total_flagged_items, 3);
        assert_eq!(snapshot.totals.total_files_with_flags, 1);
    }

    #[test]
    fn should_increment_the_correct_counters_for_each_completed_task_kind() {
        let batch_record = create_batch_record(&seed_batch(), Some(1));
        let task_record = create_task_record(&seed_task(), Some(1));

        assert_eq!(batch_record.task_kind, AnalyticsTaskKind::RemoveMusic);
        assert_eq!(task_record.task_kind, AnalyticsTaskKind::Flag);
    }

    #[test]
    fn should_ignore_in_progress_events_when_calculating_completed_totals() {
        let snapshot = snapshot_from_store(&Default::default());

        assert_eq!(snapshot.recent_runs, 0);
        assert_eq!(snapshot.totals.success_count, 0);
        assert_eq!(snapshot.totals.total_media_processed, 0);
    }
}
