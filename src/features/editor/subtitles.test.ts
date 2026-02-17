import { describe, expect, it } from "bun:test";

import { parseSrt } from "@/features/editor/subtitles";

describe("parseSrt", () => {
  it("should parse srt into subtitle entries", () => {
    const subtitles = parseSrt(
      "1\n00:00:01,000 --> 00:00:02,500\nLine 1\n\n2\n00:00:03,000 --> 00:00:04,000\nLine 2",
    );

    expect(subtitles).toHaveLength(2);
    expect(subtitles[0]?.startTime).toBe(1);
    expect(subtitles[0]?.endTime).toBe(2.5);
    expect(subtitles[1]?.text).toBe("Line 2");
  });
});
