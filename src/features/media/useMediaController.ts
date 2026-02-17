import { useEffect, useMemo, useReducer } from "react";

import { openFolderPicker } from "@/features/batch/transport";
import { MEDIA_ALLOWED_EXTENSIONS } from "@/features/media/constants";
import { createInitialMediaUiState, mediaReducer } from "@/features/media/reducer";
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
import type { CutRange, ModerationSettings } from "@/features/media/types";

export const useMediaController = () => {
  const [state, dispatch] = useReducer(mediaReducer, undefined, createInitialMediaUiState);

  useEffect(() => {
    let mounted = true;
    let unlisten: (() => void) | null = null;

    const setup = async () => {
      unlisten = await subscribeToTaskEvents((event) => {
        if (!mounted) {
          return;
        }
        dispatch({
          payload: event,
          type: "apply_task_event",
        });
      });
    };

    setup().catch((error: unknown) => {
      dispatch({
        payload: error instanceof Error ? error.message : "Failed to subscribe to task events.",
        type: "load_videos_error",
      });
    });

    return () => {
      mounted = false;
      unlisten?.();
    };
  }, []);

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
      const response = await startTranscriptionBatch({
        allowedExtensions: [...MEDIA_ALLOWED_EXTENSIONS],
        inputDir: inputPaths.length === 0 ? state.selectedInputDir : undefined,
        inputPaths: inputPaths.length > 0 ? inputPaths : undefined,
        yapMode: "auto",
      });
      dispatch({
        payload: {
          inputPaths: response.inputPaths,
          taskId: response.batchId,
          taskKind: "transcription",
        },
        type: "task_started",
      });
    } catch (error: unknown) {
      dispatch({
        payload: error instanceof Error ? error.message : "Failed starting transcription batch.",
        type: "load_videos_error",
      });
    }
  };

  const startFlagging = async () => {
    await startFlaggingForPaths([]);
  };

  const startFlaggingForPaths = async (inputPaths: string[]) => {
    try {
      const response = await startFlagBatch({
        allowedExtensions: [".srt"],
        inputDir: inputPaths.length === 0 ? state.selectedInputDir : undefined,
        inputPaths: inputPaths.length > 0 ? inputPaths : undefined,
      });
      dispatch({
        payload: {
          inputPaths: response.inputPaths,
          taskId: response.batchId,
          taskKind: "flag",
        },
        type: "task_started",
      });
    } catch (error: unknown) {
      dispatch({
        payload: error instanceof Error ? error.message : "Failed starting flag batch.",
        type: "load_videos_error",
      });
    }
  };

  const startCut = async (videoPath: string, ranges: CutRange[]) => {
    try {
      const response = await startCutJob({
        outputMode: "video_cleaned_default",
        ranges,
        videoPath,
      });

      dispatch({
        payload: {
          inputPaths: [response.videoPath],
          taskId: response.taskId,
          taskKind: "cut",
        },
        type: "task_started",
      });
      return response.taskId;
    } catch (error: unknown) {
      dispatch({
        payload: error instanceof Error ? error.message : "Failed starting cut task.",
        type: "load_videos_error",
      });
      return null;
    }
  };

  const cancelActiveTask = async () => {
    if (!state.activeTaskId) {
      return;
    }
    await cancelTask({
      mode: "stop_after_current",
      taskId: state.activeTaskId,
    });
  };

  const selectVideo = (path: string | null) => {
    dispatch({
      payload: path,
      type: "select_video",
    });
  };

  const loadSettings = async () => getModerationSettings();
  const saveSettings = async (settings: ModerationSettings) => saveModerationSettings(settings);

  const activeTask = useMemo(
    () => (state.activeTaskId ? state.tasksById[state.activeTaskId] : null),
    [state.activeTaskId, state.tasksById],
  );

  return {
    activeTask,
    cancelActiveTask,
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
