import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { BATCH_EVENT_NAME } from "@/features/batch/constants";
import type {
  BatchEvent,
  BatchStartedResponse,
  BatchState,
  CancelAck,
  CancelBatchRequest,
  StartBatchRequest,
} from "@/features/batch/types";

type InvokeFn = typeof invoke;
type ListenFn = typeof listen;

export const buildStartBatchInvokeArgs = (request: StartBatchRequest) => ({
  request,
});

export const buildCancelBatchInvokeArgs = (request: CancelBatchRequest) => ({
  request,
});

export const buildGetBatchStateInvokeArgs = (batchId: string) => ({
  batchId,
});

export const openFolderPicker = (invokeFn: InvokeFn = invoke) =>
  invokeFn<string | null>("open_folder_picker");

export const startBatch = (request: StartBatchRequest, invokeFn: InvokeFn = invoke) =>
  invokeFn<BatchStartedResponse>("start_batch", buildStartBatchInvokeArgs(request));

export const cancelBatch = (request: CancelBatchRequest, invokeFn: InvokeFn = invoke) =>
  invokeFn<CancelAck>("cancel_batch", buildCancelBatchInvokeArgs(request));

export const getBatchState = (batchId: string, invokeFn: InvokeFn = invoke) =>
  invokeFn<BatchState | null>("get_batch_state", buildGetBatchStateInvokeArgs(batchId));

export const trashFile = (path: string, invokeFn: InvokeFn = invoke) =>
  invokeFn<{ success: boolean }>("trash_file", {
    path,
  });

export const subscribeToBatchEvents = async (
  onEvent: (event: BatchEvent) => void,
  listenFn: ListenFn = listen,
): Promise<UnlistenFn> =>
  listenFn<BatchEvent>(BATCH_EVENT_NAME, (event) => {
    onEvent(event.payload);
  });
