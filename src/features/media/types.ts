export type TaskKind = "transcription" | "flag" | "cut";

export type TaskJobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
export type TaskStatus = "queued" | "running" | "completed" | "cancelled";

export type TaskSummary = {
  ok: number;
  failed: number;
  cancelled: number;
};

export type TaskJobRecord = {
  jobId: string;
  fileName: string;
  inputPath: string;
  outputPath?: string;
  status: TaskJobStatus;
  progressPct: number;
  error?: string;
  logs: string[];
};

export type TaskState = {
  taskId: string;
  taskKind: TaskKind;
  status: TaskStatus;
  jobs: TaskJobRecord[];
  summary?: TaskSummary;
};

export type TaskStartedResponse = {
  batchId: string;
  fileCount: number;
  inputPaths: string[];
};

export type StartTranscriptionBatchRequest = {
  inputDir?: string;
  inputPaths?: string[];
  allowedExtensions?: Array<".mp4" | ".mov">;
  yapMode: "auto";
};

export type StartFlagBatchRequest = {
  inputDir?: string;
  inputPaths?: string[];
  allowedExtensions?: Array<".srt">;
};

export type CutRange = {
  start: string;
  end: string;
};

export type StartCutJobRequest = {
  videoPath: string;
  ranges: CutRange[];
  outputMode: "video_cleaned_default";
};

export type CutJobStartedResponse = {
  taskId: string;
  videoPath: string;
};

export type CancelTaskRequest = {
  taskId: string;
  mode: "stop_after_current";
};

export type TaskCancelAck = {
  taskId: string;
  accepted: boolean;
};

export type VideoListItem = {
  fileName: string;
  path: string;
  srtPath?: string;
  analysisPath?: string;
  hasSrt: boolean;
  hasAnalysis: boolean;
};

export type SrtListItem = {
  fileName: string;
  path: string;
  analysisPath?: string;
  hasAnalysis: boolean;
};

export type FlaggedSegment = {
  startTime: number;
  endTime: number;
  text: string;
  reason: string;
  priority: "high" | "medium" | "low";
  category: string;
  ruleId: string;
};

export type ModerationRule = {
  ruleId: string;
  category: string;
  priority: "high" | "medium" | "low";
  reason: string;
  patterns: string[];
};

export type ModerationSettings = {
  contentCriteria: string;
  priorityGuidelines: string;
  profanityWords: string[];
  rules: ModerationRule[];
};

export type AnalysisSidecar = {
  engine: "local_rules";
  flagged: FlaggedSegment[];
  summary: string;
  createdAt: string;
  videoFileName: string;
};

export type TaskEvent =
  | {
      type: "job_progress";
      taskId: string;
      taskKind: TaskKind;
      jobId: string;
      progressPct: number;
    }
  | {
      type: "job_done";
      taskId: string;
      taskKind: TaskKind;
      jobId: string;
      outputPath?: string;
      artifacts?: unknown;
    }
  | {
      type: "job_error";
      taskId: string;
      taskKind: TaskKind;
      jobId: string;
      error: string;
    }
  | {
      type: "task_done";
      taskId: string;
      taskKind: TaskKind;
      summary: TaskSummary;
    }
  | {
      type: "job_log";
      taskId: string;
      taskKind: TaskKind;
      jobId: string;
      message: string;
      stream: "stdout" | "stderr";
    }
  | {
      type: "worker_status";
      status: "ready" | "starting" | "error";
      message: string;
    };

export type SubtitleEntry = {
  index: number;
  startTime: number;
  endTime: number;
  text: string;
};
