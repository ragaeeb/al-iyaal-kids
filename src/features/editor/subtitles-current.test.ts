import { describe, expect, it } from "bun:test";

import { findSubtitleAtTime } from "@/features/editor/subtitles";

describe("findSubtitleAtTime", () => {
  it("should return the subtitle active at the current playback time", () => {
    const result = findSubtitleAtTime(
      [
        {
          endTime: 2,
          index: 1,
          startTime: 0,
          text: "First line",
        },
        {
          endTime: 5,
          index: 2,
          startTime: 3,
          text: "Second line",
        },
      ],
      3.5,
    );

    expect(result?.text).toBe("Second line");
  });

  it("should return undefined when no subtitle matches the current playback time", () => {
    const result = findSubtitleAtTime(
      [
        {
          endTime: 2,
          index: 1,
          startTime: 0,
          text: "First line",
        },
      ],
      10,
    );

    expect(result).toBeUndefined();
  });

  it("should return the subtitle when currentTime equals startTime", () => {
    const result = findSubtitleAtTime(
      [{ endTime: 2, index: 1, startTime: 0, text: "First line" }],
      0,
    );
    expect(result?.text).toBe("First line");
  });

  it("should return the subtitle when currentTime equals endTime", () => {
    const result = findSubtitleAtTime(
      [{ endTime: 2, index: 1, startTime: 0, text: "First line" }],
      2,
    );
    expect(result?.text).toBe("First line");
  });
});
