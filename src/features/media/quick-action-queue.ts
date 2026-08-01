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

export type { AutoActionSettings, MediaQuickAction, MediaQuickActionKind, MediaWorkerStatus };
export {
  buildBatchAutoQuickActions,
  canStartQueuedMediaAction,
  enqueueMediaQuickAction,
  hasActiveMediaTask,
  removeMediaQuickAction,
  toMediaQuickActionId,
};
