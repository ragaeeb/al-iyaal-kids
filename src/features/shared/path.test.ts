import { describe, expect, it } from "bun:test";

import { toFileName } from "@/features/shared/path";

describe("toFileName", () => {
  it("should extract POSIX and Windows file names", () => {
    expect(toFileName("/tmp/episode.mp4")).toBe("episode.mp4");
    expect(toFileName("C:\\Videos\\episode.mov")).toBe("episode.mov");
  });
});
