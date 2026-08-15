import { appendBoundedLogLine } from "@/features/media/logs";
import type {
  TaskEvent,
  TaskJobArtifacts,
  TaskJobRecord,
  TaskKind,
  TaskState,
  VideoListItem,
} from "@/features/media/types";
import { toJobArtifacts } from "@/features/moderation/results";
import { toJobId } from "@/features/shared/job-id";
import { toFileName } from "@/features/shared/path";

// Keep recent terminal tasks for selectors and UI status without retaining an unbounded session log.
export const MAX_RETAINED_TASKS = 50;
export const MAX_RETAINED_TASK_JOB_SUMMARIES = 2_000;

export type MediaUiState = {
  selectedInputDir: string;
  videos: VideoListItem[];
  isLoadingVideos: boolean;
  activeTaskId: string | null;
  tasksById: Record<string, TaskState>;
  latestJobByKindAndInput: Record<string, TaskJobRecord>;
  selectedVideoPath: string | null;
  workerStatus: "idle" | "starting" | "ready" | "stopped" | "error";
  workerMessage: string;
  errorMessage: string | null;
  errorTaskKind: TaskKind | null;
};

export type MediaUiAction =
  | {
      type: "set_selected_input_dir";
      payload: string;
    }
  | {
      type: "load_videos_request";
    }
  | {
      type: "load_videos_success";
      payload: VideoListItem[];
    }
  | {
      type: "load_videos_error";
      payload: string;
    }
  | {
      type: "select_video";
      payload: string | null;
    }
  | {
      type: "task_started";
      payload: {
        taskId: string;
        taskKind: TaskKind;
        inputPaths: string[];
      };
    }
  | {
      type: "apply_task_event";
      payload: TaskEvent;
    }
  | {
      type: "task_cancel_requested";
      payload: string;
    }
  | {
      type: "task_start_error";
      payload: {
        message: string;
        taskKind: TaskKind | null;
      };
    }
  | {
      type: "clear_error";
    };

const createQueuedJobs = (inputPaths: string[]): TaskJobRecord[] =>
  inputPaths.map((inputPath) => ({
    fileName: toFileName(inputPath),
    inputPath,
    jobId: toJobId(inputPath),
    logs: [],
    progressPct: 0,
    status: "queued",
  }));

const isTerminalTask = (task: TaskState) =>
  task.status === "completed" || task.status === "cancelled";

const pruneTaskHistory = (tasksById: Record<string, TaskState>, activeTaskId: string | null) => {
  const entries = Object.entries(tasksById);
  if (entries.length <= MAX_RETAINED_TASKS) {
    return tasksById;
  }

  const protectedEntries = entries.filter(
    ([taskId, task]) => taskId === activeTaskId || !isTerminalTask(task),
  );
  const terminalEntries = entries.filter(
    ([taskId, task]) => taskId !== activeTaskId && isTerminalTask(task),
  );
  const retainedTerminalCount = Math.max(0, MAX_RETAINED_TASKS - protectedEntries.length);
  const retainedTerminalEntries =
    retainedTerminalCount === 0 ? [] : terminalEntries.slice(-retainedTerminalCount);
  const retainedTerminalIds = new Set(retainedTerminalEntries.map(([taskId]) => taskId));

  return Object.fromEntries(
    entries.filter(
      ([taskId, task]) =>
        !isTerminalTask(task) || taskId === activeTaskId || retainedTerminalIds.has(taskId),
    ),
  );
};

const toLatestJobKey = (taskKind: TaskKind, inputPath: string) => `${taskKind}\0${inputPath}`;

const updateLatestJobIndex = (
  index: Record<string, TaskJobRecord>,
  task: TaskState,
): Record<string, TaskJobRecord> => {
  const next = { ...index };
  for (const job of task.jobs) {
    const key = toLatestJobKey(task.taskKind, job.inputPath);
    delete next[key];
    next[key] = { ...job, logs: [] };
  }

  const keys = Object.keys(next);
  for (const key of keys.slice(0, Math.max(0, keys.length - MAX_RETAINED_TASK_JOB_SUMMARIES))) {
    delete next[key];
  }
  return next;
};

const applyTaskEvent = (task: TaskState, event: TaskEvent): TaskState => {
  if (event.type === "job_progress") {
    return {
      ...task,
      jobs: task.jobs.map((job) =>
        job.jobId === event.jobId
          ? {
              ...job,
              progressPct: Math.max(0, Math.min(100, Math.round(event.progressPct))),
              status: "running",
            }
          : job,
      ),
      status: "running",
    };
  }

  if (event.type === "job_done") {
    const artifacts: TaskJobArtifacts | undefined = toJobArtifacts(event.artifacts);
    return {
      ...task,
      jobs: task.jobs.map((job) =>
        job.jobId === event.jobId
          ? {
              ...job,
              artifacts,
              error: undefined,
              outputPath: event.outputPath,
              progressPct: 100,
              status: "completed",
            }
          : job,
      ),
    };
  }

  if (event.type === "job_error") {
    return {
      ...task,
      jobs: task.jobs.map((job) =>
        job.jobId === event.jobId
          ? {
              ...job,
              error: event.error,
              status: "failed",
            }
          : job,
      ),
    };
  }

  if (event.type === "job_log") {
    return {
      ...task,
      jobs: task.jobs.map((job) =>
        job.jobId === event.jobId
          ? {
              ...job,
              logs: appendBoundedLogLine(job.logs, event.message),
            }
          : job,
      ),
    };
  }

  if (event.type === "task_done") {
    return {
      ...task,
      cancelRequested: false,
      jobs: task.jobs.map((job) =>
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

  return task;
};

export const createInitialMediaUiState = (): MediaUiState => ({
  activeTaskId: null,
  errorMessage: null,
  errorTaskKind: null,
  isLoadingVideos: false,
  latestJobByKindAndInput: {},
  selectedInputDir: "",
  selectedVideoPath: null,
  tasksById: {},
  videos: [],
  workerMessage: "Worker has not started yet.",
  workerStatus: "idle",
});

const handleVideoLoadingAction = (
  state: MediaUiState,
  action: Extract<
    MediaUiAction,
    { type: "load_videos_request" | "load_videos_success" | "load_videos_error" }
  >,
): MediaUiState => {
  if (action.type === "load_videos_request") {
    return {
      ...state,
      errorMessage: null,
      isLoadingVideos: true,
    };
  }

  if (action.type === "load_videos_success") {
    return {
      ...state,
      isLoadingVideos: false,
      videos: action.payload,
    };
  }

  return {
    ...state,
    errorMessage: action.payload,
    isLoadingVideos: false,
  };
};

export const mediaReducer = (state: MediaUiState, action: MediaUiAction): MediaUiState => {
  if (action.type === "set_selected_input_dir") {
    return {
      ...state,
      selectedInputDir: action.payload,
    };
  }

  if (
    action.type === "load_videos_request" ||
    action.type === "load_videos_success" ||
    action.type === "load_videos_error"
  ) {
    return handleVideoLoadingAction(state, action);
  }

  if (action.type === "select_video") {
    return {
      ...state,
      selectedVideoPath: action.payload,
    };
  }

  if (action.type === "task_started") {
    const task: TaskState = {
      cancelRequested: false,
      jobs: createQueuedJobs(action.payload.inputPaths),
      status: "queued",
      taskId: action.payload.taskId,
      taskKind: action.payload.taskKind,
    };
    return {
      ...state,
      activeTaskId: task.taskId,
      errorMessage: null,
      errorTaskKind: null,
      latestJobByKindAndInput: updateLatestJobIndex(state.latestJobByKindAndInput, task),
      tasksById: pruneTaskHistory(
        {
          ...state.tasksById,
          [task.taskId]: task,
        },
        task.taskId,
      ),
      workerMessage: "Starting worker task...",
      workerStatus: "starting",
    };
  }

  if (action.type === "apply_task_event") {
    if (action.payload.type === "worker_status") {
      return {
        ...state,
        workerMessage: action.payload.message,
        workerStatus: action.payload.status,
      };
    }

    const task = state.tasksById[action.payload.taskId];
    if (!task) {
      return state;
    }

    const updatedTask = applyTaskEvent(task, action.payload);
    return {
      ...state,
      latestJobByKindAndInput: updateLatestJobIndex(state.latestJobByKindAndInput, updatedTask),
      tasksById: pruneTaskHistory(
        {
          ...state.tasksById,
          [task.taskId]: updatedTask,
        },
        state.activeTaskId,
      ),
    };
  }

  if (action.type === "task_cancel_requested") {
    const task = state.tasksById[action.payload];
    if (!task) {
      return state;
    }

    return {
      ...state,
      tasksById: {
        ...state.tasksById,
        [task.taskId]: {
          ...task,
          cancelRequested: true,
        },
      },
      workerMessage:
        "Cancellation requested. The worker will stop after the current file finishes.",
      workerStatus: state.workerStatus,
    };
  }

  if (action.type === "task_start_error") {
    return {
      ...state,
      errorMessage: action.payload.message,
      errorTaskKind: action.payload.taskKind,
    };
  }

  if (action.type === "clear_error") {
    return {
      ...state,
      errorMessage: null,
      errorTaskKind: null,
    };
  }

  return state;
};
