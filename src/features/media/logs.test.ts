import { describe, expect, it } from "bun:test";

import { DEFAULT_VISIBLE_LOG_LINES, toVisibleLogLines } from "@/features/media/logs";

describe("toVisibleLogLines", () => {
  it("should keep only the most recent log lines within the default window", () => {
    const logs = Array.from({ length: DEFAULT_VISIBLE_LOG_LINES + 3 }, (_, index) => `${index}`);

    const result = toVisibleLogLines(logs);

    expect(result).toHaveLength(DEFAULT_VISIBLE_LOG_LINES);
    expect(result.at(0)?.text).toBe("3");
    expect(result.at(-1)?.text).toBe(`${DEFAULT_VISIBLE_LOG_LINES + 2}`);
  });

  it("should preserve repeated log lines with distinct ids", () => {
    const result = toVisibleLogLines(["1", "1", "1"], 10);

    expect(result.map((line) => line.text)).toEqual(["1", "1", "1"]);
    expect(new Set(result.map((line) => line.id)).size).toBe(3);
  });
});
