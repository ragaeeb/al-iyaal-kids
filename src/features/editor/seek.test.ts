import { describe, expect, it } from "bun:test";

import { clampSeekTime } from "@/features/editor/seek";

describe("clampSeekTime", () => {
  it("should keep seek targets within the video duration", () => {
    expect(clampSeekTime(12.5, 60)).toBe(12.5);
    expect(clampSeekTime(-5, 60)).toBe(0);
    expect(clampSeekTime(65, 60)).toBe(60);
  });
});
