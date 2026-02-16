import { describe, expect, it } from "bun:test";

import { batchReducer, createInitialBatchUiState } from "@/features/batch/reducer";
import type { BatchState } from "@/features/batch/types";

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
  it("should set selected input directory", () => {
    const state = batchReducer(createInitialBatchUiState(), {
      payload: "/tmp/input",
      type: "set_selected_input_dir",
    });

    expect(state.selectedInputDir).toBe("/tmp/input");
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
});
