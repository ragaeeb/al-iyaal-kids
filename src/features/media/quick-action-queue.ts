import { toSrtSidecarPath } from "@/features/editor/video-sidecars";
import type { TaskState } from "@/features/media/types";

type MediaWorkerStatus = "idle" | "starting" | "ready" | "stopped" | "error";
type MediaQuickActionKind = "transcription" | "flag";

type MediaQuickAction = {
  id: string;
  inputPath: string;
  kind: MediaQuickActionKind;
};

type AutoActionSettings = {
  autoTranscribe?: boolean;
  autoAnalyze?: boolean;
};

type CanStartQueuedMediaActionInput = {
  hasActiveBatch: boolean;
  hasActiveTask: boolean;
  isLaunching: boolean;
  queueLength: number;
  workerStatus: MediaWorkerStatus;
};

type AnalysisPrerequisiteStatus = "ready" | "waiting" | "blocked" | "absent";

type QuickActionQueueStateInput = {
  queue: MediaQuickAction[];
  tasksById: Record<string, TaskState>;
};

const toMediaQuickActionId = (kind: MediaQuickActionKind, inputPath: string) =>
  `${kind}:${inputPath}`;

const enqueueMediaQuickAction = (
  queue: MediaQuickAction[],
  kind: MediaQuickActionKind,
  inputPath: string,
) => {
  const id = toMediaQuickActionId(kind, inputPath);
  if (queue.some((action) => action.id === id)) {
    return queue;
  }

  return [
    ...queue,
    {
      id,
      inputPath,
      kind,
    },
  ];
};

const removeMediaQuickAction = (queue: MediaQuickAction[], id: string) =>
  queue.filter((action) => action.id !== id);

const buildBatchAutoQuickActions = ({
  autoActionsByPath,
  completedJobs,
}: {
  autoActionsByPath: Record<string, AutoActionSettings>;
  completedJobs: Array<{ inputPath: string; outputPath?: string }>;
}): MediaQuickAction[] => {
  let queue: MediaQuickAction[] = [];

  for (const job of completedJobs) {
    if (!job.outputPath) {
      continue;
    }

    const settings = autoActionsByPath[job.inputPath];
    if (!settings) {
      continue;
    }

    // If autoAnalyze or autoTranscribe is enabled:
    // Transcribe must run first on the output video path to produce the .srt sidecar.
    if (settings.autoTranscribe || settings.autoAnalyze) {
      queue = enqueueMediaQuickAction(queue, "transcription", job.outputPath);
    }

    // Analyze runs on the .srt sidecar generated for the output video.
    if (settings.autoAnalyze) {
      const srtPath = toSrtSidecarPath(job.outputPath);
      queue = enqueueMediaQuickAction(queue, "flag", srtPath);
    }
  }

  return queue;
};

const hasActiveMediaTask = (tasksById: Record<string, TaskState>) =>
  Object.values(tasksById).some((task) => task.status === "queued" || task.status === "running");

const getAnalysisPrerequisiteStatus = ({
  queue,
  subtitlePath,
  tasksById,
}: {
  queue: MediaQuickAction[];
  subtitlePath: string;
  tasksById: Record<string, TaskState>;
}): AnalysisPrerequisiteStatus => {
  const transcriptionJobs = Object.values(tasksById)
    .filter((task) => task.taskKind === "transcription")
    .flatMap((task) => task.jobs);

  if (
    transcriptionJobs.some((job) => job.status === "completed" && job.outputPath === subtitlePath)
  ) {
    return "ready";
  }

  if (
    transcriptionJobs.some(
      (job) =>
        (job.status === "queued" || job.status === "running") &&
        toSrtSidecarPath(job.inputPath) === subtitlePath,
    ) ||
    queue.some(
      (action) =>
        action.kind === "transcription" && toSrtSidecarPath(action.inputPath) === subtitlePath,
    )
  ) {
    return "waiting";
  }

  if (
    transcriptionJobs.some(
      (job) =>
        (job.status === "failed" || job.status === "cancelled") &&
        toSrtSidecarPath(job.inputPath) === subtitlePath,
    )
  ) {
    return "blocked";
  }

  return "absent";
};

const retainReadyQuickActions = ({
  queue,
  tasksById,
}: QuickActionQueueStateInput): MediaQuickAction[] =>
  queue.filter((action) => {
    if (action.kind !== "flag") {
      return true;
    }

    const status = getAnalysisPrerequisiteStatus({
      queue,
      subtitlePath: action.inputPath,
      tasksById,
    });
    return status === "ready" || status === "waiting";
  });

const canStartQueuedMediaAction = ({
  hasActiveBatch,
  hasActiveTask,
  isLaunching,
  queueLength,
  workerStatus,
}: CanStartQueuedMediaActionInput) =>
  queueLength > 0 &&
  !hasActiveBatch &&
  !hasActiveTask &&
  !isLaunching &&
  (workerStatus === "idle" || workerStatus === "ready" || workerStatus === "stopped");

export type {
  AnalysisPrerequisiteStatus,
  AutoActionSettings,
  MediaQuickAction,
  MediaQuickActionKind,
  MediaWorkerStatus,
};
export {
  buildBatchAutoQuickActions,
  canStartQueuedMediaAction,
  enqueueMediaQuickAction,
  getAnalysisPrerequisiteStatus,
  hasActiveMediaTask,
  removeMediaQuickAction,
  retainReadyQuickActions,
  toMediaQuickActionId,
};
