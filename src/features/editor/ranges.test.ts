import { describe, expect, it } from "bun:test";

import { parseSavedCutRanges } from "@/features/editor/ranges";

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
