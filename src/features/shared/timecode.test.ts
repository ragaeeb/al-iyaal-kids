import { describe, expect, it } from "bun:test";

import { parseFlexibleTimeToSeconds } from "@/features/shared/timecode";

describe("flexible timecode", () => {
  it("should parse numeric seconds and common subtitle clock formats", () => {
    expect(parseFlexibleTimeToSeconds(2791.186)).toBe(2791.186);
    expect(parseFlexibleTimeToSeconds("2791.186")).toBe(2791.186);
    expect(parseFlexibleTimeToSeconds("46:31.186")).toBe(2791.186);
    expect(parseFlexibleTimeToSeconds("00:46:31,186")).toBe(2791.186);
  });

  it("should reject malformed, negative, and non-finite values", () => {
    for (const value of ["", "1:70", "1:2:3:4", -1, Number.NaN, "Infinity"]) {
      expect(parseFlexibleTimeToSeconds(value)).toBeNull();
    }
  });
});
