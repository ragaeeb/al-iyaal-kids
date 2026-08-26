import { type Dispatch, useEffect, useReducer, useRef } from "react";

import { openFolderPicker } from "@/features/batch/transport";
import { toTaskCancelOutcome } from "@/features/media/cancellation";
import { MEDIA_ALLOWED_EXTENSIONS } from "@/features/media/constants";
import {
  createInitialMediaUiState,
  type MediaUiAction,
  mediaReducer,
} from "@/features/media/reducer";
import {
  cancelTask,
  getModerationSettings,
  listVideos,
  saveModerationSettings,
  startCutJob,
  startFlagBatch,
  startTranscriptionBatch,
  subscribeToTaskEvents,
} from "@/features/media/transport";
import type {
  AnalysisStrategy,
  CompressionPreset,
  CutRange,
  ModerationEngine,
  ModerationSettings,
  TaskEvent,
  TaskKind,
} from "@/features/media/types";
import {
  appendBoundedEvent,
  clearBoundedEventBuffer,
  createBoundedEventBuffer,
  drainBoundedEventBuffer,
} from "@/features/shared/bounded-event-buffer";

const MAX_PRE_REGISTRATION_TASK_EVENTS = 256;
// Completed task IDs can leave the registry; active IDs stay known for delivery correctness.
const MAX_REGISTERED_TASK_IDS = 256;
type RegisteredTaskEvent = Exclude<TaskEvent, { type: "worker_status" }>;
type Deferred = {
  promise: Promise<void>;
  resolve: () => void;
  settled: boolean;
};

const createDeferred = (): Deferred => {
  let resolvePromise = () => {};
  const deferred: Deferred = {
    promise: new Promise<void>((resolve) => {
      resolvePromise = resolve;
    }),
    resolve: () => {},
    settled: false,
  };
  deferred.resolve = () => {
    if (deferred.settled) {
      return;
    }
    deferred.settled = true;
    resolvePromise();
  };
  return deferred;
};

const applyRegisteredTaskEvent = (
  dispatch: Dispatch<MediaUiAction>,
  terminalTaskIds: Set<string>,
  event: RegisteredTaskEvent,
) => {
  dispatch({
    payload: event,
    type: "apply_task_event",
  });
  if (event.type === "task_done") {
    terminalTaskIds.add(event.taskId);
  }
};

export const useMediaController = () => {
  const [state, dispatch] = useReducer(mediaReducer, undefined, createInitialMediaUiState);
  const registeredTaskIdsRef = useRef(new Set<string>());
  const terminalTaskIdsRef = useRef(new Set<string>());
  const preRegistrationEventsRef = useRef(
    createBoundedEventBuffer<RegisteredTaskEvent>(MAX_PRE_REGISTRATION_TASK_EVENTS),
  );
  const taskEventsReadyRef = useRef<Deferred | null>(null);
  if (!taskEventsReadyRef.current) {
    taskEventsReadyRef.current = createDeferred();
  }

  useEffect(() => {
    let mounted = true;
    let unlisten: (() => void) | null = null;
    const previousReady = taskEventsReadyRef.current;
    const taskEventsReady =
      previousReady && !previousReady.settled ? previousReady : createDeferred();
    taskEventsReadyRef.current = taskEventsReady;

    const setup = async () => {
      const registeredUnlisten = await subscribeToTaskEvents((event) => {
        if (!mounted) {
          return;
        }
        if (event.type === "worker_status") {
          dispatch({
            payload: event,
            type: "apply_task_event",
          });
          return;
        }

        if (!registeredTaskIdsRef.current.has(event.taskId)) {
          preRegistrationEventsRef.current = appendBoundedEvent(
            preRegistrationEventsRef.current,
            event,
          );
          return;
        }

        applyRegisteredTaskEvent(dispatch, terminalTaskIdsRef.current, event);
      });

      if (!mounted) {
        registeredUnlisten();
        return;
      }

      unlisten = registeredUnlisten;
    };

    setup()
      .catch((error: unknown) => {
        if (!mounted) {
          return;
        }
        dispatch({
          payload: error instanceof Error ? error.message : "Failed to subscribe to task events.",
          type: "load_videos_error",
        });
      })
      .finally(() => taskEventsReady.resolve());

    return () => {
      mounted = false;
      unlisten?.();
      taskEventsReady.resolve();
      registeredTaskIdsRef.current.clear();
      terminalTaskIdsRef.current.clear();
      preRegistrationEventsRef.current = clearBoundedEventBuffer(preRegistrationEventsRef.current);
    };
  }, []);

  const registerStartedTask = (payload: {
    inputPaths: string[];
    taskId: string;
    taskKind: TaskKind;
  }) => {
    dispatch({
      payload,
      type: "task_started",
    });
    registeredTaskIdsRef.current.add(payload.taskId);
    terminalTaskIdsRef.current.delete(payload.taskId);
    while (registeredTaskIdsRef.current.size > MAX_REGISTERED_TASK_IDS) {
      const oldestTerminalTaskId = [...registeredTaskIdsRef.current].find((taskId) =>
        terminalTaskIdsRef.current.has(taskId),
      );
      if (!oldestTerminalTaskId) {
        break;
      }
      registeredTaskIdsRef.current.delete(oldestTerminalTaskId);
      terminalTaskIdsRef.current.delete(oldestTerminalTaskId);
    }

    const drained = drainBoundedEventBuffer(preRegistrationEventsRef.current);
    preRegistrationEventsRef.current = drained.buffer;
    for (const event of drained.events) {
      if (event.taskId === payload.taskId) {
        applyRegisteredTaskEvent(dispatch, terminalTaskIdsRef.current, event);
        continue;
      }

      preRegistrationEventsRef.current = appendBoundedEvent(
        preRegistrationEventsRef.current,
        event,
      );
    }
  };

  const setSelectedInputDir = (value: string) => {
    dispatch({
      payload: value,
      type: "set_selected_input_dir",
    });
  };

  const chooseInputDir = async () => {
    const folder = await openFolderPicker();
    if (folder) {
      setSelectedInputDir(folder);
      await loadVideos(folder);
    }
  };

  const loadVideos = async (inputDir = state.selectedInputDir) => {
    if (!inputDir) {
      dispatch({
        payload: "Select a folder first.",
        type: "load_videos_error",
      });
      return;
    }

    dispatch({
      type: "load_videos_request",
    });
    try {
      const videos = await listVideos(inputDir);
      dispatch({
        payload: videos,
        type: "load_videos_success",
      });
    } catch (error: unknown) {
      dispatch({
        payload: error instanceof Error ? error.message : "Failed loading videos.",
        type: "load_videos_error",
      });
    }
  };

  const startTranscription = async () => {
    await startTranscriptionForPaths([]);
  };

  const startTranscriptionForPaths = async (inputPaths: string[]) => {
    try {
      await taskEventsReadyRef.current?.promise;
      const response = await startTranscriptionBatch({
        allowedExtensions: [...MEDIA_ALLOWED_EXTENSIONS],
        inputDir: inputPaths.length === 0 ? state.selectedInputDir : undefined,
        inputPaths: inputPaths.length > 0 ? inputPaths : undefined,
        yapMode: "auto",
      });
      registerStartedTask({
        inputPaths: response.inputPaths,
        taskId: response.batchId,
        taskKind: "transcription",
      });
    } catch (error: unknown) {
      dispatch({
        payload: {
          message: error instanceof Error ? error.message : "Failed starting transcription batch.",
          taskKind: "transcription",
        },
        type: "task_start_error",
      });
    }
  };

  const startFlagging = async (
    overrides?: Partial<Pick<ModerationSettings, "analysisStrategy" | "engine">>,
  ) => {
    await startFlaggingForPaths([], overrides);
  };

  const startFlaggingForPaths = async (
    inputPaths: string[],
    overrides?: {
      engine?: ModerationEngine;
      analysisStrategy?: AnalysisStrategy;
    },
  ) => {
    try {
      await taskEventsReadyRef.current?.promise;
      const response = await startFlagBatch({
        allowedExtensions: [".srt"],
        analysisStrategy: overrides?.analysisStrategy,
        engine: overrides?.engine,
        inputDir: inputPaths.length === 0 ? state.selectedInputDir : undefined,
        inputPaths: inputPaths.length > 0 ? inputPaths : undefined,
      });
      registerStartedTask({
        inputPaths: response.inputPaths,
        taskId: response.batchId,
        taskKind: "flag",
      });
    } catch (error: unknown) {
      dispatch({
        payload: {
          message: error instanceof Error ? error.message : "Failed starting flag batch.",
          taskKind: "flag",
        },
        type: "task_start_error",
      });
    }
  };

  const startCut = async (
    videoPath: string,
    ranges: CutRange[],
    compressionPreset: CompressionPreset = "apple_silicon",
  ) => {
    try {
      await taskEventsReadyRef.current?.promise;
      const response = await startCutJob({
        compressionPreset,
        outputMode: "video_cleaned_default",
        ranges,
        videoPath,
      });

      registerStartedTask({
        inputPaths: [response.videoPath],
        taskId: response.taskId,
        taskKind: "cut",
      });
      return response.taskId;
    } catch (error: unknown) {
      dispatch({
        payload: {
          message: error instanceof Error ? error.message : "Failed starting cut task.",
          taskKind: "cut",
        },
        type: "task_start_error",
      });
      return null;
    }
  };

  const cancelTaskById = async (taskId: string | null) => {
    if (!taskId) {
      return;
    }
    const taskKind = state.tasksById[taskId]?.taskKind ?? null;
    try {
      const outcome = toTaskCancelOutcome(
        await cancelTask({
          mode: "stop_after_current",
          taskId,
        }),
      );
      if (!outcome.accepted) {
        dispatch({
          payload: {
            message: outcome.errorMessage,
            taskKind,
          },
          type: "task_start_error",
        });
        return;
      }

      dispatch({
        payload: taskId,
        type: "task_cancel_requested",
      });
    } catch (error: unknown) {
      dispatch({
        payload: {
          message: error instanceof Error ? error.message : "Failed requesting task cancellation.",
          taskKind,
        },
        type: "task_start_error",
      });
    }
  };

  const cancelActiveTask = async () => {
    await cancelTaskById(state.activeTaskId);
  };

  const selectVideo = (path: string | null) => {
    dispatch({
      payload: path,
      type: "select_video",
    });
  };

  const loadSettings = async () => getModerationSettings();
  const saveSettings = async (settings: ModerationSettings) => saveModerationSettings(settings);
  const activeTask = state.activeTaskId ? state.tasksById[state.activeTaskId] : null;

  return {
    activeTask,
    cancelActiveTask,
    cancelTaskById,
    chooseInputDir,
    clearError: () =>
      dispatch({
        type: "clear_error",
      }),
    loadSettings,
    loadVideos,
    saveSettings,
    selectVideo,
    setSelectedInputDir,
    startCut,
    startFlagging,
    startFlaggingForPaths,
    startTranscription,
    startTranscriptionForPaths,
    state,
  };
};
