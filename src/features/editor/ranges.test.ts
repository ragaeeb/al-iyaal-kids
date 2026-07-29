import { describe, expect, it } from "bun:test";

import { buildSuggestedCutRanges, parseSavedCutRanges } from "@/features/editor/ranges";
import type { FlaggedSegment } from "@/features/media/types";

describe("buildSuggestedCutRanges", () => {
  it("should build exact cut ranges from high-priority flags", () => {
    const segments: FlaggedSegment[] = [
      {
        category: "language",
        endTime: 12.2,
        priority: "medium",
        reason: "bad language",
        ruleId: "profanity",
        startTime: 10.1,
        text: "text",
      },
      {
        category: "aqeedah",
        endTime: 5.9,
        priority: "high",
        reason: "aqeedah issue",
        ruleId: "aqeedah",
        startTime: 4.2,
        text: "text",
      },
    ];

    const ranges = buildSuggestedCutRanges(segments, ["high"]);
    expect(ranges).toEqual([
      {
        end: "0:05",
        start: "0:04",
      },
    ]);
  });
});

describe("parseSavedCutRanges", () => {
  it("should restore valid persisted cut ranges", () => {
    expect(parseSavedCutRanges('{"ranges":[{"start":"1.500","end":"3.750"}]}')).toEqual([
      { end: "3.750", start: "1.500" },
    ]);
  });

  it("should ignore malformed and invalid persisted ranges", () => {
    expect(parseSavedCutRanges('{"ranges":[{"start":"4","end":"2"},{}]}')).toEqual([]);
    expect(parseSavedCutRanges("not json")).toEqual([]);
  });
});
