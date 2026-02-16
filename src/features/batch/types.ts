export type SupportedExtension = ".mp4" | ".mov";

export type StartBatchRequest = {
  inputDir: string;
  outputDirMode: "audio_replaced_default";
  allowedExtensions: SupportedExtension[];
};

export type CancelBatchRequest = {
  batchId: string;
  mode: "stop_after_current";
};

export type JobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export type JobRecord = {
  jobId: string;
  fileName: string;
  inputPath: string;
  outputPath?: string;
  status: JobStatus;
  progressPct: number;
  error?: string;
};

export type BatchSummary = {
  ok: number;
  failed: number;
  cancelled: number;
};

export type BatchStatus = "queued" | "running" | "completed" | "cancelled";

export type BatchState = {
  batchId: string;
  status: BatchStatus;
  jobs: JobRecord[];
  summary?: BatchSummary;
};

export type BatchStartedResponse = {
  batchId: string;
  fileCount: number;
  inputPaths: string[];
};

export type CancelAck = {
  batchId: string;
  accepted: boolean;
};

export type BatchEvent =
  | {
      type: "job_progress";
      batchId: string;
      jobId: string;
      progressPct: number;
    }
  | {
      type: "job_done";
      batchId: string;
      jobId: string;
      outputPath: string;
    }
  | {
      type: "job_error";
      batchId: string;
      jobId: string;
      error: string;
    }
  | {
      type: "batch_done";
      batchId: string;
      summary: BatchSummary;
    }
  | {
      type: "worker_status";
      status: "ready" | "starting" | "error";
      message: string;
    };

export type BatchUiState = {
  selectedInputDir: string;
  activeBatchId: string | null;
  batchesById: Record<string, BatchState>;
  workerStatus: "idle" | "starting" | "ready" | "error";
  workerMessage: string;
  isStartingBatch: boolean;
  errorMessage: string | null;
};

export type BatchUiAction =
  | { type: "set_selected_input_dir"; payload: string }
  | {
      type: "set_worker_status";
      payload: { status: BatchUiState["workerStatus"]; message: string };
    }
  | { type: "start_batch_request" }
  | { type: "start_batch_success"; payload: BatchState }
  | { type: "start_batch_error"; payload: string }
  | { type: "apply_event"; payload: BatchEvent }
  | { type: "clear_error" };
