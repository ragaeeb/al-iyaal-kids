import { describe, expect, it } from "bun:test";

import { toJobId } from "@/features/shared/job-id";

describe("toJobId", () => {
  it("should match the cross-language stable job-id fixture", () => {
    expect(toJobId("/tmp/My Clip 01.mov")).toBe(
      "tmp-my-clip-01-mov-67c00333ba0ddded529abdc463341963",
    );
  });

  it("should keep separator variants distinct", () => {
    expect(toJobId("/tmp/a-b.mp4")).toBe("tmp-a-b-mp4-eaed9543b571fc817e9dcf8c9b8e1bc5");
    expect(toJobId("/tmp/a_b.mp4")).toBe("tmp-a-b-mp4-05bb79b9b571fc817d10c731641c878b");
    expect(toJobId("/tmp/a-b.mp4")).not.toBe(toJobId("/tmp/a_b.mp4"));
  });

  it("should match the unicode punctuation fixture", () => {
    expect(
      toJobId(
        "/Users/rhaq/Movies/al_iyaal/audio_replaced/Rothschild’s Giraffe - Leo The Wildlife Ranger Minisode #155.srt",
      ),
    ).toBe("users-rhaq-movies-al-iyaal-audio-replaced-rothsc-f753e9abda221288d4cdc252c91813d9");
  });

  it("should return a job slug with a digest for paths without readable characters", () => {
    expect(toJobId("///---___")).toBe("job-d2baa8fb31043c92e01567e8ca80c0e4");
  });
});
