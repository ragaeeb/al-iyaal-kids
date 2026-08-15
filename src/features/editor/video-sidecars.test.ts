import { describe, expect, it } from "bun:test";

import {
  buildVideoDeleteTargets,
  toAnalysisSidecarPath,
  toCutRangesSidecarPath,
  toSrtSidecarPath,
} from "@/features/editor/video-sidecars";

describe("video sidecars", () => {
  it("should derive sibling sidecar paths from a video path", () => {
    const videoPath = "/tmp/episode.clip.mp4";

    expect(toSrtSidecarPath(videoPath)).toBe("/tmp/episode.clip.srt");
    expect(toAnalysisSidecarPath(videoPath)).toBe("/tmp/episode.clip.analysis.json");
    expect(toCutRangesSidecarPath(videoPath)).toBe("/tmp/episode.clip.ranges.json");
  });

  it("should plan video deletion against the video plus known sidecars", () => {
    expect(buildVideoDeleteTargets("/tmp/example.mov")).toEqual([
      "/tmp/example.mov",
      "/tmp/example.srt",
      "/tmp/example.analysis.json",
      "/tmp/example.ranges.json",
    ]);
  });
});
