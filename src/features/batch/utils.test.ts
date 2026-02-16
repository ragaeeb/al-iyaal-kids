import { describe, expect, it } from "bun:test";

import {
  buildStartBatchRequest,
  clampProgress,
  createQueuedJobs,
  isSupportedVideoPath,
  toAllowedExtensions,
  toJobId,
} from "@/features/batch/utils";

describe("batch utils", () => {
  it("should build a start batch request with canonical defaults", () => {
    const result = buildStartBatchRequest("  /tmp/example  ");

    expect(result).toEqual({
      allowedExtensions: [".mp4", ".mov"],
      inputDir: "/tmp/example",
      outputDirMode: "audio_replaced_default",
    });
  });

  it("should mark only mp4/mov as supported video paths", () => {
    expect(isSupportedVideoPath("/tmp/clip.mp4")).toBe(true);
    expect(isSupportedVideoPath("/tmp/clip.mov")).toBe(true);
    expect(isSupportedVideoPath("/tmp/clip.mkv")).toBe(false);
  });

  it("should build deterministic job ids", () => {
    expect(toJobId("/tmp/My Clip 01.mov")).toBe("tmp-my-clip-01-mov");
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
});
