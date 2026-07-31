import { describe, expect, it } from "bun:test";

import {
  buildVideoDeleteTargets,
  isMissingDeleteTargetError,
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

  it("should treat missing sidecar paths as ignorable delete errors", () => {
    expect(
      isMissingDeleteTargetError("Failed resolving file path /tmp/example.srt: No such file"),
    ).toBeTrue();
    expect(isMissingDeleteTargetError(new Error("Path is not a file: /tmp/example.srt"))).toBe(
      true,
    );
    expect(isMissingDeleteTargetError(new Error("Permission denied"))).toBe(false);
  });
});
