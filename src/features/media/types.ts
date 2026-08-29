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
  artifacts?: TaskJobArtifacts;
};

export type TaskState = {
  taskId: string;
  taskKind: TaskKind;
  status: TaskStatus;
  jobs: TaskJobRecord[];
  summary?: TaskSummary;
  cancelRequested?: boolean;
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
  engine?: ModerationEngine;
  analysisStrategy?: AnalysisStrategy;
};

export type CutRange = {
  start: string;
  end: string;
};

export type CompressionPreset = "apple_silicon" | "max_compression" | "balanced";

export type StartCutJobRequest = {
  videoPath: string;
  ranges: CutRange[];
  outputMode: "video_cleaned_default";
  compressionPreset: CompressionPreset;
};

export type SaveCutRangesRequest = {
  videoPath: string;
  ranges: CutRange[];
};

export type SaveAnalysisSidecarRequest = {
  videoPath: string;
  content: string;
};

export type AnalysisPromptPreviewRequest = {
  engine: ModerationEngine;
  contentCriteria: string;
  priorityGuidelines: string;
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
  cueIndex?: number;
  startTime: number;
  endTime?: number;
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

export type AnalysisAgentId = "codex" | "antigravity" | "kiro_cli" | "opencode";
export type ModerationEngine = "blacklist" | "gemini" | "nova_pro" | AnalysisAgentId;
export type AnalysisStrategy = "fast" | "deep";

export type AnalysisAgentModel = {
  id: string;
  label: string;
  reasoningLevels: string[];
  defaultReasoningLevel?: string;
};

export type AnalysisAgentCapability = {
  id: AnalysisAgentId;
  label: string;
  installed: boolean;
  executableName?: string;
  models: AnalysisAgentModel[];
  defaultModel?: string;
  error?: string;
};

export type ModerationSettings = {
  engine: ModerationEngine;
  analysisStrategy: AnalysisStrategy;
  agentModel: string;
  agentReasoningLevel: string;
  googleApiKey: string;
  amazonNovaApiKey: string;
  contentCriteria: string;
  priorityGuidelines: string;
  profanityWords: string[];
  rules: ModerationRule[];
};

export type AnalysisSidecar = {
  engine: string;
  flagged: FlaggedSegment[];
  summary: string;
  createdAt: string;
  videoFileName: string;
  analysisCount: number;
  providers: string[];
};

export type AnalysisRun = {
  id?: string;
  provider: string;
  model?: string;
  reasoning?: string;
  createdAt?: string;
  summary: string;
  flagged: FlaggedSegment[];
};

export type AnalysisBundle = {
  schemaVersion: 2;
  sourceFile: string;
  analyses: AnalysisRun[];
};

export type TaskJobArtifacts = {
  flaggedCount?: number;
  summary?: string;
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
      artifacts?: TaskJobArtifacts;
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
      status: "ready" | "starting" | "stopped" | "error";
      message: string;
    };

export type SubtitleEntry = {
  index: number;
  startTime: number;
  endTime: number;
  text: string;
};
