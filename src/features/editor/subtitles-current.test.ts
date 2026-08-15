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

  it("should return the later subtitle when cues share a boundary", () => {
    const result = findSubtitleAtTime(
      [
        { endTime: 2, index: 1, startTime: 0, text: "First line" },
        { endTime: 5, index: 2, startTime: 2, text: "Second line" },
      ],
      2,
    );

    expect(result?.text).toBe("Second line");
  });

  it("should find a cue in a large sorted transcript without scanning from the end", () => {
    const subtitles = Array.from({ length: 10_000 }, (_, index) => ({
      endTime: index + 0.75,
      index,
      startTime: index,
      text: `Cue ${index}`,
    }));

    expect(findSubtitleAtTime(subtitles, 12.5)?.text).toBe("Cue 12");
    expect(findSubtitleAtTime(subtitles, 12.9)).toBeUndefined();
  });
});
