import { describe, expect, it } from "bun:test";

import { batchReducer, createInitialBatchUiState } from "@/features/batch/reducer";
import type { BatchState } from "@/features/batch/types";
import { MAX_STORED_LOG_LINES } from "@/features/media/logs";

const createBatch = (): BatchState => ({
  batchId: "batch-1",
  jobs: [
    {
      fileName: "a.mov",
      inputPath: "/tmp/a.mov",
      jobId: "job-a",
      progressPct: 0,
      status: "queued",
    },
    {
      fileName: "b.mp4",
      inputPath: "/tmp/b.mp4",
      jobId: "job-b",
      progressPct: 0,
      status: "queued",
    },
  ],
  status: "queued",
});

describe("batch reducer", () => {
  it("should set selected input paths", () => {
    const state = batchReducer(createInitialBatchUiState(), {
      payload: ["/tmp/input/a.mp4", "/tmp/input/b.mov"],
      type: "set_selected_input_paths",
    });

    expect(state.selectedInputPaths).toEqual(["/tmp/input/a.mp4", "/tmp/input/b.mov"]);
  });

  it("should merge paths added after an earlier async operation started", () => {
    const initial = batchReducer(createInitialBatchUiState(), {
      payload: ["/tmp/input/a.mp4"],
      type: "set_selected_input_paths",
    });

    const withFirstResult = batchReducer(initial, {
      payload: ["/tmp/input/b.mov"],
      type: "add_selected_input_paths",
    });
    const withSecondResult = batchReducer(withFirstResult, {
      payload: ["/tmp/input/c.mp4", "/tmp/input/b.mov"],
      type: "add_selected_input_paths",
    });

    expect(withSecondResult.selectedInputPaths).toEqual([
      "/tmp/input/a.mp4",
      "/tmp/input/b.mov",
      "/tmp/input/c.mp4",
    ]);
  });

  it("should register a successful batch start", () => {
    const batch = createBatch();

    const state = batchReducer(createInitialBatchUiState(), {
      payload: batch,
      type: "start_batch_success",
    });

    expect(state.activeBatchId).toBe("batch-1");
    expect(state.batchesById["batch-1"]?.jobs).toHaveLength(2);
  });

  it("should preserve the current batch until a replacement start succeeds", () => {
    const withBatch = batchReducer(createInitialBatchUiState(), {
      payload: createBatch(),
      type: "start_batch_success",
    });

    const state = batchReducer(withBatch, { type: "start_batch_request" });

    expect(state.activeBatchId).toBe("batch-1");
    expect(state.batchesById["batch-1"]).toBe(withBatch.batchesById["batch-1"]);
    expect(state.isStartingBatch).toBe(true);
    expect(state.errorMessage).toBeNull();
  });

  it("should show the cancellation message only after an accepted request", () => {
    const seed = batchReducer(
      batchReducer(createInitialBatchUiState(), {
        payload: createBatch(),
        type: "start_batch_success",
      }),
      {
        payload: "stale error",
        type: "start_batch_error",
      },
    );

    const state = batchReducer(seed, { type: "cancel_batch_accepted" });

    expect(state.workerMessage).toBe(
      "Cancellation requested. The worker will stop after the current file finishes.",
    );
    expect(state.errorMessage).toBeNull();
  });

  it("should apply job progress events", () => {
    const seed = batchReducer(createInitialBatchUiState(), {
      payload: createBatch(),
      type: "start_batch_success",
    });

    const state = batchReducer(seed, {
      payload: {
        batchId: "batch-1",
        jobId: "job-a",
        progressPct: 22.7,
        type: "job_progress",
      },
      type: "apply_event",
    });

    expect(state.batchesById["batch-1"]?.jobs[0]?.status).toBe("running");
    expect(state.batchesById["batch-1"]?.jobs[0]?.progressPct).toBe(23);
  });

  it("should replay a buffered event sequence without losing terminal state", () => {
    const seed = batchReducer(createInitialBatchUiState(), {
      payload: createBatch(),
      type: "start_batch_success",
    });
    const bufferedEvents = [
      {
        batchId: "batch-1" as const,
        jobId: "job-a" as const,
        progressPct: 40,
        type: "job_progress" as const,
      },
      {
        batchId: "batch-1" as const,
        jobId: "job-a" as const,
        outputPath: "/tmp/output/a.mp4",
        type: "job_done" as const,
      },
      {
        batchId: "batch-1" as const,
        summary: { cancelled: 0, failed: 0, ok: 1 },
        type: "batch_done" as const,
      },
    ];

    const state = bufferedEvents.reduce(
      (current, event) => batchReducer(current, { payload: event, type: "apply_event" }),
      seed,
    );

    expect(state.batchesById["batch-1"]?.status).toBe("completed");
    expect(state.batchesById["batch-1"]?.jobs[0]?.status).toBe("completed");
    expect(state.batchesById["batch-1"]?.jobs[0]?.outputPath).toBe("/tmp/output/a.mp4");
  });

  it("should apply completion summary and cancel queued jobs", () => {
    const seed = batchReducer(createInitialBatchUiState(), {
      payload: createBatch(),
      type: "start_batch_success",
    });

    const state = batchReducer(seed, {
      payload: {
        batchId: "batch-1",
        summary: {
          cancelled: 1,
          failed: 0,
          ok: 1,
        },
        type: "batch_done",
      },
      type: "apply_event",
    });

    expect(state.batchesById["batch-1"]?.status).toBe("cancelled");
    expect(state.batchesById["batch-1"]?.jobs[0]?.status).toBe("cancelled");
  });

  it("should track worker status events", () => {
    const state = batchReducer(createInitialBatchUiState(), {
      payload: {
        message: "Worker online",
        status: "ready",
        type: "worker_status",
      },
      type: "apply_event",
    });

    expect(state.workerStatus).toBe("ready");
    expect(state.workerMessage).toBe("Worker online");
  });

  it("should cap remove-music job logs to the recent window", () => {
    const seed = batchReducer(createInitialBatchUiState(), {
      payload: createBatch(),
      type: "start_batch_success",
    });

    const next = Array.from({ length: MAX_STORED_LOG_LINES + 3 }, (_, index) => index).reduce(
      (state, index) =>
        batchReducer(state, {
          payload: {
            batchId: "batch-1",
            jobId: "job-a",
            message: `line-${index}`,
            stream: "stdout",
            type: "job_log",
          },
          type: "apply_event",
        }),
      seed,
    );

    const logs = next.batchesById["batch-1"]?.jobs[0]?.logs ?? [];
    expect(logs).toHaveLength(MAX_STORED_LOG_LINES);
    expect(logs.at(0)).toBe("line-3");
    expect(logs.at(-1)).toBe(`line-${MAX_STORED_LOG_LINES + 2}`);
  });
});
