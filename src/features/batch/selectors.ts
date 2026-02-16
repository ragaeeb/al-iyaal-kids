import type { BatchUiState, JobRecord } from "@/features/batch/types";

export const selectActiveBatch = (state: BatchUiState) => {
  if (!state.activeBatchId) {
    return null;
  }

  return state.batchesById[state.activeBatchId] ?? null;
};

export const selectSortedJobs = (jobs: JobRecord[]) =>
  [...jobs].sort((left, right) => left.fileName.localeCompare(right.fileName));

export const selectBatchProgress = (state: BatchUiState) => {
  const batch = selectActiveBatch(state);
  if (!batch || batch.jobs.length === 0) {
    return 0;
  }

  const sum = batch.jobs.reduce((acc, job) => acc + job.progressPct, 0);
  return Math.round(sum / batch.jobs.length);
};
