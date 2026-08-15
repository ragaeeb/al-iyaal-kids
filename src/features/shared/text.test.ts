import { describe, expect, it } from "bun:test";

import { TRUNCATION_MARKER, truncateText } from "@/features/shared/text";

describe("truncateText", () => {
  it("should truncate without splitting Unicode code points", () => {
    expect(truncateText("a😀b", 2)).toBe(`a😀${TRUNCATION_MARKER}`);
  });

  it("should preserve text within the bound", () => {
    expect(truncateText("short", 10)).toBe("short");
  });
});
