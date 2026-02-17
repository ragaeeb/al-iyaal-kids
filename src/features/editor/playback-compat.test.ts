import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { isWebPreviewCompatible } from "@/features/editor/playback-compat";

const SAMPLE_VIDEO_PATH =
  "/Users/rhaq/Movies/al_iyaal/audio_replaced/adventures-from-the-book-of-virtues-season-1-episode-01-work_360.mp4";
const FFPROBE_FIXTURE_PATH = fileURLToPath(
  new URL("./fixtures/adventures-work_360.ffprobe.json", import.meta.url),
);

type FfprobeReport = {
  streams?: Array<{
    codec_name?: string;
    codec_type?: string;
    pix_fmt?: string;
  }>;
};

const runFfprobe = (videoPath: string): FfprobeReport => {
  const result = Bun.spawnSync(
    ["ffprobe", "-v", "error", "-print_format", "json", "-show_streams", videoPath],
    {
      stderr: "pipe",
      stdout: "pipe",
    },
  );

  if (result.exitCode !== 0) {
    const stderr = new TextDecoder().decode(result.stderr);
    throw new Error(`ffprobe failed (${result.exitCode}): ${stderr}`);
  }

  const stdout = new TextDecoder().decode(result.stdout);
  return JSON.parse(stdout) as FfprobeReport;
};

describe("isWebPreviewCompatible", () => {
  it("should return true for h264 yuv420p + aac streams", () => {
    const report: FfprobeReport = {
      streams: [
        {
          codec_name: "h264",
          codec_type: "video",
          pix_fmt: "yuv420p",
        },
        {
          codec_name: "aac",
          codec_type: "audio",
        },
      ],
    };

    expect(isWebPreviewCompatible(report)).toBe(true);
  });

  it("should report the ffprobe shell fixture as preview-compatible", async () => {
    const fixtureContent = await readFile(FFPROBE_FIXTURE_PATH, "utf-8");
    const report = JSON.parse(fixtureContent) as FfprobeReport;
    expect(isWebPreviewCompatible(report)).toBe(true);
  });

  it("should report the provided sample mp4 as preview-compatible when available", () => {
    const localVideoPath = process.env.ALIYAAL_TEST_VIDEO_PATH ?? SAMPLE_VIDEO_PATH;
    if (!existsSync(localVideoPath)) {
      return;
    }

    const report = runFfprobe(localVideoPath);
    expect(isWebPreviewCompatible(report)).toBe(true);
  });
});
