import { openPath } from "@tauri-apps/plugin-opener";
import { useEffect, useReducer } from "react";

import { batchReducer, createInitialBatchUiState } from "@/features/batch/reducer";
import {
  selectActiveBatch,
  selectBatchProgress,
  selectSortedJobs,
} from "@/features/batch/selectors";
import {
  cancelBatch,
  openFolderPicker,
  startBatch,
  subscribeToBatchEvents,
} from "@/features/batch/transport";
import {
  buildStartBatchRequest,
  createInitialBatchState,
  isSupportedVideoPath,
} from "@/features/batch/utils";

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

  const setSelectedInputDir = (value: string) => {
    dispatch({
      payload: value,
      type: "set_selected_input_dir",
    });
  };

  const chooseInputDir = async () => {
    const folder = await openFolderPicker();
    if (!folder) {
      return;
    }

    setSelectedInputDir(folder);
  };

  const start = async () => {
    if (!state.selectedInputDir) {
      dispatch({
        payload: "Select a folder before starting.",
        type: "start_batch_error",
      });
      return;
    }

    dispatch({
      type: "start_batch_request",
    });

    try {
      const request = buildStartBatchRequest(state.selectedInputDir);
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

    await cancelBatch({
      batchId: state.activeBatchId,
      mode: "stop_after_current",
    });
  };

  const openOutput = async (path: string) => {
    await openPath(path);
  };

  const activeBatch = selectActiveBatch(state);

  return {
    activeBatch,
    cancel,
    chooseInputDir,
    clearError: () =>
      dispatch({
        type: "clear_error",
      }),
    jobs: activeBatch ? selectSortedJobs(activeBatch.jobs) : [],
    openOutput,
    progressPct: selectBatchProgress(state),
    setSelectedInputDir,
    start,
    state,
  };
};
