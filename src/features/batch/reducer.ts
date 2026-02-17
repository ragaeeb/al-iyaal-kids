import type {
  BatchEvent,
  BatchState,
  BatchUiAction,
  BatchUiState,
  JobRecord,
} from "@/features/batch/types";
import { clampProgress } from "@/features/batch/utils";

export const createInitialBatchUiState = (): BatchUiState => ({
  activeBatchId: null,
  batchesById: {},
  errorMessage: null,
  isStartingBatch: false,
  selectedInputDir: "",
  workerMessage: "Worker has not started yet.",
  workerStatus: "idle",
});

const updateJob = (batch: BatchState, jobId: string, transform: (job: JobRecord) => JobRecord) => ({
  ...batch,
  jobs: batch.jobs.map((job) => (job.jobId === jobId ? transform(job) : job)),
});

const applyBatchEvent = (batch: BatchState, event: BatchEvent): BatchState => {
  if (event.type === "job_progress") {
    return {
      ...updateJob(batch, event.jobId, (job) => ({
        ...job,
        progressPct: clampProgress(event.progressPct),
        status: "running",
      })),
      status: "running",
    };
  }

  if (event.type === "job_done") {
    return updateJob(batch, event.jobId, (job) => ({
      ...job,
      error: undefined,
      outputPath: event.outputPath,
      progressPct: 100,
      status: "completed",
    }));
  }

  if (event.type === "job_error") {
    return updateJob(batch, event.jobId, (job) => ({
      ...job,
      error: event.error,
      status: "failed",
    }));
  }

  if (event.type === "batch_done") {
    return {
      ...batch,
      jobs: batch.jobs.map((job) =>
        job.status === "queued"
          ? {
              ...job,
              status: "cancelled",
            }
          : job.status === "running"
            ? {
                ...job,
                error: job.error ?? "Worker ended before emitting final job state.",
                status: "failed",
              }
            : job,
      ),
      status: event.summary.cancelled > 0 ? "cancelled" : "completed",
      summary: event.summary,
    };
  }

  if (event.type === "job_log") {
    return updateJob(batch, event.jobId, (job) => ({
      ...job,
      logs: [...(job.logs ?? []), event.message],
    }));
  }

  return batch;
};

export const batchReducer = (state: BatchUiState, action: BatchUiAction): BatchUiState => {
  if (action.type === "set_selected_input_dir") {
    return {
      ...state,
      selectedInputDir: action.payload,
    };
  }

  if (action.type === "set_worker_status") {
    return {
      ...state,
      workerMessage: action.payload.message,
      workerStatus: action.payload.status,
    };
  }

  if (action.type === "start_batch_request") {
    return {
      ...state,
      errorMessage: null,
      isStartingBatch: true,
    };
  }

  if (action.type === "start_batch_success") {
    return {
      ...state,
      activeBatchId: action.payload.batchId,
      batchesById: {
        ...state.batchesById,
        [action.payload.batchId]: action.payload,
      },
      isStartingBatch: false,
    };
  }

  if (action.type === "start_batch_error") {
    return {
      ...state,
      errorMessage: action.payload,
      isStartingBatch: false,
    };
  }

  if (action.type === "apply_event") {
    if (action.payload.type === "worker_status") {
      return {
        ...state,
        workerMessage: action.payload.message,
        workerStatus: action.payload.status,
      };
    }

    const batch = state.batchesById[action.payload.batchId];
    if (!batch) {
      return state;
    }

    return {
      ...state,
      batchesById: {
        ...state.batchesById,
        [batch.batchId]: applyBatchEvent(batch, action.payload),
      },
    };
  }

  if (action.type === "clear_error") {
    return {
      ...state,
      errorMessage: null,
    };
  }

  return state;
};
