import { describe, expect, it } from "bun:test";

import { parseSavedCutRanges, toFlaggedTimelineRanges } from "@/features/editor/ranges";

describe("parseSavedCutRanges", () => {
  it("should restore valid persisted cut ranges", () => {
    expect(parseSavedCutRanges('{"ranges":[{"start":"1.500","end":"3.750"}]}')).toEqual([
      { end: "3.750", start: "1.500" },
    ]);
  });

  it("should preserve an explicitly empty range list", () => {
    expect(parseSavedCutRanges('{"ranges":[]}')).toEqual([]);
  });

  it("should reject malformed and invalid persisted ranges", () => {
    expect(() => parseSavedCutRanges('{"ranges":[{"start":"4","end":"2"},{}]}')).toThrow();
    expect(() => parseSavedCutRanges("not json")).toThrow();
  });
});

describe("toFlaggedTimelineRanges", () => {
  it("should use subtitle bounds and text when a flag has only a timestamp", () => {
    const ranges = toFlaggedTimelineRanges(
      [
        {
          category: "language",
          priority: "medium",
          reason: "Review this subtitle.",
          ruleId: "language",
          startTime: 10,
          text: "",
        },
        {
          category: "violence",
          endTime: 25,
          priority: "high",
          reason: "Review this range.",
          ruleId: "violence",
          startTime: 20,
          text: "Explicit flag text",
        },
      ],
      [{ endTime: 12.5, index: 1, startTime: 10, text: "Flagged subtitle" }],
      30,
    );

    expect(
      ranges.map(({ endTime, priority, startTime, text }) => ({
        endTime,
        priority,
        startTime,
        text,
      })),
    ).toEqual([
      { endTime: 12.5, priority: "medium", startTime: 10, text: "Flagged subtitle" },
      { endTime: 25, priority: "high", startTime: 20, text: "Explicit flag text" },
    ]);
  });
});
