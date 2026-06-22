import type { TaskState } from "@/features/media/types";

type MediaWorkerStatus = "idle" | "starting" | "ready" | "stopped" | "error";
type MediaQuickActionKind = "transcription" | "flag";

type MediaQuickAction = {
  id: string;
  inputPath: string;
  kind: MediaQuickActionKind;
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

export type { MediaQuickAction, MediaQuickActionKind, MediaWorkerStatus };
export {
  canStartQueuedMediaAction,
  enqueueMediaQuickAction,
  hasActiveMediaTask,
  removeMediaQuickAction,
  toMediaQuickActionId,
};
