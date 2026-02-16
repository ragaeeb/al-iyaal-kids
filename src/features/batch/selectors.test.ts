import { describe, expect, it } from "bun:test";
import { createInitialBatchUiState } from "@/features/batch/reducer";
import { selectBatchProgress, selectSortedJobs } from "@/features/batch/selectors";

describe("batch selectors", () => {
  it("should compute average progress from active jobs", () => {
    const state = createInitialBatchUiState();
    state.activeBatchId = "batch-1";
    state.batchesById["batch-1"] = {
      batchId: "batch-1",
      jobs: [
        {
          fileName: "c.mp4",
          inputPath: "",
          jobId: "job-1",
          progressPct: 20,
          status: "running",
        },
        {
          fileName: "a.mov",
          inputPath: "",
          jobId: "job-2",
          progressPct: 80,
          status: "running",
        },
      ],
      status: "running",
    };

    expect(selectBatchProgress(state)).toBe(50);
  });

  it("should sort jobs alphabetically for stable rendering", () => {
    const result = selectSortedJobs([
      { fileName: "z.mov", inputPath: "", jobId: "1", progressPct: 0, status: "queued" },
      { fileName: "a.mp4", inputPath: "", jobId: "2", progressPct: 0, status: "queued" },
    ]);

    expect(result[0]?.fileName).toBe("a.mp4");
    expect(result[1]?.fileName).toBe("z.mov");
  });
});
