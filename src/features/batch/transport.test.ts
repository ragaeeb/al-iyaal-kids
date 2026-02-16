import { describe, expect, it } from "bun:test";
import {
  buildCancelBatchInvokeArgs,
  buildGetBatchStateInvokeArgs,
  buildStartBatchInvokeArgs,
  cancelBatch,
  getBatchState,
  openFolderPicker,
  startBatch,
  subscribeToBatchEvents,
} from "@/features/batch/transport";
import type { BatchEvent, CancelBatchRequest, StartBatchRequest } from "@/features/batch/types";

describe("batch transport", () => {
  it("should build invoke payloads for start/cancel/get state", () => {
    const startRequest: StartBatchRequest = {
      allowedExtensions: [".mp4", ".mov"],
      inputDir: "/tmp/in",
      outputDirMode: "audio_replaced_default",
    };
    const cancelRequest: CancelBatchRequest = {
      batchId: "batch-1",
      mode: "stop_after_current",
    };

    expect(buildStartBatchInvokeArgs(startRequest)).toEqual({
      request: startRequest,
    });
    expect(buildCancelBatchInvokeArgs(cancelRequest)).toEqual({
      request: cancelRequest,
    });
    expect(buildGetBatchStateInvokeArgs("batch-1")).toEqual({
      batchId: "batch-1",
    });
  });

  it("should call invoke with the expected tauri command names", async () => {
    const calls: Array<{ command: string; payload?: unknown }> = [];
    const invokeMock = async <T>(command: string, payload?: unknown) => {
      calls.push({ command, payload });
      return null as T;
    };

    await openFolderPicker(invokeMock);
    await startBatch(
      {
        allowedExtensions: [".mp4", ".mov"],
        inputDir: "/tmp/in",
        outputDirMode: "audio_replaced_default",
      },
      invokeMock,
    );
    await cancelBatch(
      {
        batchId: "batch-1",
        mode: "stop_after_current",
      },
      invokeMock,
    );
    await getBatchState("batch-1", invokeMock);

    expect(calls.map((call) => call.command)).toEqual([
      "open_folder_picker",
      "start_batch",
      "cancel_batch",
      "get_batch_state",
    ]);
  });

  it("should forward payload from subscribed events", async () => {
    const received: BatchEvent[] = [];
    const unlisten = () => {};
    type ListenOverride = NonNullable<Parameters<typeof subscribeToBatchEvents>[1]>;
    const listenMock: ListenOverride = async (_eventName, handler) => {
      const payload: BatchEvent = {
        batchId: "batch-1",
        jobId: "job-1",
        progressPct: 42,
        type: "job_progress",
      };
      const event = {
        event: "batch://event",
        id: 1,
        payload,
      } as Parameters<typeof handler>[0];
      handler(event);
      return unlisten;
    };

    const result = await subscribeToBatchEvents((event) => received.push(event), listenMock);

    expect(received).toEqual([
      {
        batchId: "batch-1",
        jobId: "job-1",
        progressPct: 42,
        type: "job_progress",
      },
    ]);
    expect(result).toBe(unlisten);
  });
});
