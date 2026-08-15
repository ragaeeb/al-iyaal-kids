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

  it("should sort valid cues by start time", () => {
    const subtitles = parseSrt(
      "2\n00:00:03,000 --> 00:00:04,000\nLater\n\n" +
        "1\n00:00:01,000 --> 00:00:02,000\nEarlier\n\n" +
        "3\n00:00:05,000 --> 00:00:06,000\nLast",
    );

    expect(subtitles.map((subtitle) => subtitle.text)).toEqual(["Earlier", "Later", "Last"]);
  });

  it("should reject a nonempty cue with malformed structure", () => {
    expect(() => parseSrt("1\n00:00:01,000 --> 00:00:02,000")).toThrow(
      "expected an index, timestamp range, and text",
    );
  });

  it("should reject malformed timestamp values", () => {
    expect(() => parseSrt("1\n00:99:01,000 --> 00:00:02,000\nInvalid")).toThrow(
      "timestamp contains an invalid value",
    );
    expect(() => parseSrt("1\n00:00:01,000 --> 00:00:02,000 trailing\nInvalid")).toThrow(
      "timestamp range is malformed",
    );
  });

  it("should reject backwards ranges and empty text", () => {
    expect(() => parseSrt("1\n00:00:02,000 --> 00:00:01,000\nBackwards")).toThrow(
      "end time must be after the start time",
    );
    expect(() =>
      parseSrt("1\n00:00:01,000 --> 00:00:02,000\n   \n\n2\n00:00:03,000 --> 00:00:04,000\nValid"),
    ).toThrow("subtitle text is empty");
  });
});
