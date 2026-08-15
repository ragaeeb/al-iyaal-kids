import { describe, expect, it } from "bun:test";

import { canResetVideoToOriginal } from "@/features/editor/video-reset";

describe("canResetVideoToOriginal", () => {
  it("should allow reset when previewing a cut export", () => {
    expect(canResetVideoToOriginal("/tmp/video_cleaned/episode.mp4", "/tmp/episode.mp4")).toBe(
      true,
    );
  });

  it("should not allow reset when the original is already displayed", () => {
    expect(canResetVideoToOriginal("/tmp/episode.mp4", "/tmp/episode.mp4")).toBe(false);
    expect(canResetVideoToOriginal(null, "/tmp/episode.mp4")).toBe(false);
  });
});
