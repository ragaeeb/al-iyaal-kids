import { open } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";
import { useEffect, useReducer } from "react";

import { batchReducer, createInitialBatchUiState } from "@/features/batch/reducer";
import {
  selectActiveBatch,
  selectBatchProgress,
  selectSortedJobs,
} from "@/features/batch/selectors";
import { cancelBatch, startBatch, subscribeToBatchEvents } from "@/features/batch/transport";
import {
  buildStartBatchRequest,
  createInitialBatchState,
  dedupePaths,
  isSupportedVideoPath,
} from "@/features/batch/utils";
import { listVideos } from "@/features/media/transport";

export const useBatchController = () => {
  const [state, dispatch] = useReducer(batchReducer, undefined, createInitialBatchUiState);

  useEffect(() => {
    let mounted = true;
    let unlisten: (() => void) | null = null;

    const setup = async () => {
      unlisten = await subscribeToBatchEvents((event) => {
        if (!mounted) {
          return;
        }

        dispatch({
          payload: event,
          type: "apply_event",
        });
      });
    };

    setup().catch((error: unknown) => {
      dispatch({
        payload: error instanceof Error ? error.message : "Failed to subscribe to worker events.",
        type: "start_batch_error",
      });
    });

    return () => {
      mounted = false;
      unlisten?.();
    };
  }, []);

  const setSelectedInputPaths = (value: string[]) => {
    dispatch({
      payload: dedupePaths(value),
      type: "set_selected_input_paths",
    });
  };

  const addInputFiles = async () => {
    const response = await open({
      directory: false,
      filters: [{ extensions: ["mp4", "mov"], name: "Videos" }],
      multiple: true,
    });
    const nextPaths = Array.isArray(response) ? response : response ? [response] : [];
    setSelectedInputPaths([...state.selectedInputPaths, ...nextPaths]);
  };

  const addInputFolder = async () => {
    const response = await open({ directory: true, multiple: false });
    const folder = Array.isArray(response) ? response.at(0) : response;
    if (!folder) {
      return;
    }

    const videos = await listVideos(folder);
    const nextPaths = videos.map((video) => video.path);
    setSelectedInputPaths([...state.selectedInputPaths, ...nextPaths]);
  };

  const addResolvedInputPaths = (paths: string[]) => {
    setSelectedInputPaths([...state.selectedInputPaths, ...paths]);
  };

  const start = async () => {
    if (state.selectedInputPaths.length === 0) {
      dispatch({
        payload: "Select or drop at least one .mp4 or .mov file before starting.",
        type: "start_batch_error",
      });
      return;
    }

    dispatch({
      type: "start_batch_request",
    });

    try {
      const request = buildStartBatchRequest(state.selectedInputPaths);
      const response = await startBatch(request);
      const initialPaths = response.inputPaths.filter((path) => isSupportedVideoPath(path));
      dispatch({
        payload: createInitialBatchState(response.batchId, initialPaths),
        type: "start_batch_success",
      });
    } catch (error: unknown) {
      dispatch({
        payload: error instanceof Error ? error.message : "Unable to start batch.",
        type: "start_batch_error",
      });
    }
  };

  const cancel = async () => {
    if (!state.activeBatchId) {
      return;
    }

    try {
      await cancelBatch({
        batchId: state.activeBatchId,
        mode: "stop_after_current",
      });
    } catch (error: unknown) {
      dispatch({
        payload: error instanceof Error ? error.message : "Unable to cancel batch.",
        type: "start_batch_error",
      });
    }
  };

  const openOutput = async (path: string) => {
    await openPath(path);
  };

  const activeBatch = selectActiveBatch(state);

  return {
    activeBatch,
    addInputFiles,
    addInputFolder,
    addResolvedInputPaths,
    cancel,
    clearError: () =>
      dispatch({
        type: "clear_error",
      }),
    jobs: activeBatch ? selectSortedJobs(activeBatch.jobs) : [],
    openOutput,
    progressPct: selectBatchProgress(state),
    setSelectedInputPaths,
    start,
    state,
  };
};
