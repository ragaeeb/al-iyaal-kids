import { describe, expect, it } from "bun:test";

import { toJobId } from "@/features/shared/job-id";

describe("toJobId", () => {
  it("should preserve dash runs exactly like the worker for unicode punctuation", () => {
    expect(
      toJobId(
        "/Users/rhaq/Movies/al_iyaal/audio_replaced/Rothschild’s Giraffe - Leo The Wildlife Ranger Minisode #155.srt",
      ),
    ).toBe(
      "users-rhaq-movies-al-iyaal-audio-replaced-rothschild-s-giraffe---leo-the-wildlife-ranger-minisode--155-srt",
    );
  });

  it("should return job when the path contains no letters or numbers", () => {
    expect(toJobId("///---___")).toBe("job");
  });
});
