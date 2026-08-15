import { describe, expect, it } from "bun:test";

import {
  buildStartBatchRequest,
  clampProgress,
  createQueuedJobs,
  dedupePaths,
  isActiveBatchStatus,
  isSupportedVideoPath,
  retainPathFlags,
  toAllowedExtensions,
  toCancelOutcome,
} from "@/features/batch/utils";
import { toJobId } from "@/features/shared/job-id";

describe("batch utils", () => {
  it("should build a start batch request with canonical defaults", () => {
    const result = buildStartBatchRequest(["  /tmp/example.mp4  ", "/tmp/example.mp4"]);

    expect(result).toEqual({
      allowedExtensions: [".mp4", ".mov"],
      inputPaths: ["/tmp/example.mp4"],
      outputDirMode: "audio_replaced_default",
    });
  });

  it("should dedupe and trim selected paths", () => {
    const result = dedupePaths([" /tmp/a.mp4 ", "", "/tmp/a.mp4", "/tmp/b.mov"]);

    expect(result).toEqual(["/tmp/a.mp4", "/tmp/b.mov"]);
  });

  it("should identify only queued and running batches as active", () => {
    expect(isActiveBatchStatus("queued")).toBe(true);
    expect(isActiveBatchStatus("running")).toBe(true);
    expect(isActiveBatchStatus("completed")).toBe(false);
    expect(isActiveBatchStatus("cancelled")).toBe(false);
  });

  it("should discard flags for paths removed from the selection", () => {
    expect(
      retainPathFlags(
        {
          "/tmp/a.mp4": true,
          "/tmp/b.mp4": false,
        },
        ["/tmp/a.mp4"],
      ),
    ).toEqual({
      "/tmp/a.mp4": true,
    });
  });

  it("should mark only mp4/mov as supported video paths", () => {
    expect(isSupportedVideoPath("/tmp/clip.mp4")).toBe(true);
    expect(isSupportedVideoPath("/tmp/clip.mov")).toBe(true);
    expect(isSupportedVideoPath("/tmp/clip.mkv")).toBe(false);
  });

  it("should build deterministic job ids", () => {
    expect(toJobId("/tmp/My Clip 01.mov")).toBe(
      "tmp-my-clip-01-mov-67c00333ba0ddded529abdc463341963",
    );
  });

  it("should create queued jobs from input paths", () => {
    const jobs = createQueuedJobs(["/tmp/a.mp4", "/tmp/b.mov"]);

    expect(jobs).toHaveLength(2);
    expect(jobs[0]?.status).toBe("queued");
    expect(jobs[1]?.fileName).toBe("b.mov");
  });

  it("should clamp progress into 0..100", () => {
    expect(clampProgress(-1)).toBe(0);
    expect(clampProgress(34.6)).toBe(35);
    expect(clampProgress(400)).toBe(100);
  });

  it("should keep only supported extensions", () => {
    const result = toAllowedExtensions([".mp4", ".mkv", ".mov"]);

    expect(result).toEqual([".mp4", ".mov"]);
  });

  it("should distinguish accepted and rejected cancellation responses", () => {
    expect(toCancelOutcome({ accepted: true, batchId: "batch-1" })).toEqual({
      accepted: true,
      errorMessage: null,
    });
    expect(toCancelOutcome({ accepted: false, batchId: "batch-1" })).toEqual({
      accepted: false,
      errorMessage:
        "Cancellation was not accepted because this batch is no longer active or has already finished.",
    });
  });
});
