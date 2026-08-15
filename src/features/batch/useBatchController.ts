import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useReducer, useRef } from "react";

import { batchReducer, createInitialBatchUiState } from "@/features/batch/reducer";
import {
  selectActiveBatch,
  selectBatchProgress,
  selectSortedJobs,
} from "@/features/batch/selectors";
import { cancelBatch, startBatch, subscribeToBatchEvents } from "@/features/batch/transport";
import type { BatchEvent } from "@/features/batch/types";
import {
  buildStartBatchRequest,
  createInitialBatchState,
  dedupePaths,
  isActiveBatchStatus,
  isSupportedVideoPath,
  toCancelOutcome,
} from "@/features/batch/utils";
import { listVideos } from "@/features/media/transport";
import {
  appendBoundedEvent,
  clearBoundedEventBuffer,
  createBoundedEventBuffer,
  drainBoundedEventBuffer,
} from "@/features/shared/bounded-event-buffer";

const MAX_PRE_REGISTRATION_BATCH_EVENTS = 256;

const getBatchStartBlockReason = ({
  hasActiveBatch,
  hasInputs,
  isStartPending,
}: {
  hasActiveBatch: boolean;
  hasInputs: boolean;
  isStartPending: boolean;
}) => {
  if (isStartPending) {
    return "A batch start request is already in progress.";
  }

  if (hasActiveBatch) {
    return "Wait for the active batch to finish or request cancellation before starting another.";
  }

  if (!hasInputs) {
    return "Select or drop at least one .mp4 or .mov file before starting.";
  }

  return null;
};

export const useBatchController = () => {
  const [state, dispatch] = useReducer(batchReducer, undefined, createInitialBatchUiState);
  const registeredBatchIdsRef = useRef(new Set<string>());
  const preRegistrationEventsRef = useRef(
    createBoundedEventBuffer<Exclude<BatchEvent, { type: "worker_status" }>>(
      MAX_PRE_REGISTRATION_BATCH_EVENTS,
    ),
  );
  const isStartPendingRef = useRef(false);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;

    const setup = async () => {
      const registeredUnlisten = await subscribeToBatchEvents((event) => {
        if (disposed) {
          return;
        }

        if (event.type === "worker_status") {
          dispatch({
            payload: event,
            type: "apply_event",
          });
          return;
        }

        if (!registeredBatchIdsRef.current.has(event.batchId)) {
          preRegistrationEventsRef.current = appendBoundedEvent(
            preRegistrationEventsRef.current,
            event,
          );
          return;
        }

        dispatch({
          payload: event,
          type: "apply_event",
        });
      });

      if (disposed) {
        registeredUnlisten();
        return;
      }

      unlisten = registeredUnlisten;
    };

    setup().catch((error: unknown) => {
      if (disposed) {
        return;
      }

      dispatch({
        payload: error instanceof Error ? error.message : "Failed to subscribe to worker events.",
        type: "start_batch_error",
      });
    });

    return () => {
      disposed = true;
      unlisten?.();
      registeredBatchIdsRef.current.clear();
      preRegistrationEventsRef.current = clearBoundedEventBuffer(preRegistrationEventsRef.current);
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
    dispatch({
      payload: nextPaths,
      type: "add_selected_input_paths",
    });
  };

  const addInputFolder = async () => {
    const response = await open({ directory: true, multiple: false });
    const folder = Array.isArray(response) ? response.at(0) : response;
    if (!folder) {
      return;
    }

    const videos = await listVideos(folder);
    const nextPaths = videos.map((video) => video.path);
    dispatch({
      payload: nextPaths,
      type: "add_selected_input_paths",
    });
  };

  const addResolvedInputPaths = (paths: string[]) => {
    dispatch({
      payload: paths,
      type: "add_selected_input_paths",
    });
  };

  const start = async () => {
    const currentBatch = selectActiveBatch(state);
    const blockReason = getBatchStartBlockReason({
      hasActiveBatch: Boolean(currentBatch && isActiveBatchStatus(currentBatch.status)),
      hasInputs: state.selectedInputPaths.length > 0,
      isStartPending: isStartPendingRef.current,
    });
    if (blockReason) {
      dispatch({
        payload: blockReason,
        type: "start_batch_error",
      });
      return;
    }

    isStartPendingRef.current = true;
    registeredBatchIdsRef.current.clear();
    preRegistrationEventsRef.current = clearBoundedEventBuffer(preRegistrationEventsRef.current);
    dispatch({
      type: "start_batch_request",
    });

    try {
      const request = buildStartBatchRequest(state.selectedInputPaths);
      const response = await startBatch(request);
      const initialPaths = response.inputPaths.filter((path) => isSupportedVideoPath(path));
      registeredBatchIdsRef.current.add(response.batchId);
      dispatch({
        payload: createInitialBatchState(response.batchId, initialPaths),
        type: "start_batch_success",
      });

      const drained = drainBoundedEventBuffer(preRegistrationEventsRef.current);
      preRegistrationEventsRef.current = drained.buffer;
      for (const event of drained.events.filter((event) => event.batchId === response.batchId)) {
        dispatch({
          payload: event,
          type: "apply_event",
        });
      }
    } catch (error: unknown) {
      registeredBatchIdsRef.current.clear();
      preRegistrationEventsRef.current = clearBoundedEventBuffer(preRegistrationEventsRef.current);
      dispatch({
        payload: error instanceof Error ? error.message : "Unable to start batch.",
        type: "start_batch_error",
      });
    } finally {
      isStartPendingRef.current = false;
    }
  };

  const cancel = async () => {
    if (!state.activeBatchId) {
      return;
    }

    try {
      const response = await cancelBatch({
        batchId: state.activeBatchId,
        mode: "stop_after_current",
      });
      const outcome = toCancelOutcome(response);
      if (outcome.accepted) {
        dispatch({
          type: "cancel_batch_accepted",
        });
        return;
      }

      dispatch({
        payload: outcome.errorMessage,
        type: "start_batch_error",
      });
    } catch (error: unknown) {
      dispatch({
        payload: error instanceof Error ? error.message : "Unable to cancel batch.",
        type: "start_batch_error",
      });
    }
  };

  const activeBatch = selectActiveBatch(state);
  const isActive = activeBatch ? isActiveBatchStatus(activeBatch.status) : false;

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
    isActive,
    jobs: activeBatch ? selectSortedJobs(activeBatch.jobs) : [],
    progressPct: selectBatchProgress(state),
    setSelectedInputPaths,
    start,
    state,
  };
};
