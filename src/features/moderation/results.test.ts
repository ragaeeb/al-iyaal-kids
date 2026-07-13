import { describe, expect, it } from "bun:test";

import {
  buildModerationOverview,
  parseAnalysisSidecar,
  toJobArtifacts,
  toModerationJobResult,
} from "@/features/moderation/results";

describe("moderation results", () => {
  it("should parse an analysis sidecar with flagged subtitle segments", () => {
    const sidecar = parseAnalysisSidecar(
      JSON.stringify({
        createdAt: "2026-03-09T00:00:00.000Z",
        engine: "blacklist",
        flagged: [
          {
            category: "language",
            endTime: 11,
            priority: "medium",
            reason: "Contains profanity or offensive language.",
            ruleId: "profanity",
            startTime: 10,
            text: "bad word here",
          },
        ],
        summary: "Flagged 1 subtitle item(s). high=0, medium=1, low=0.",
        videoFileName: "episode.srt",
      }),
    );

    expect(sidecar.flagged).toHaveLength(1);
    expect(sidecar.flagged[0]?.startTime).toBe(10);
    expect(sidecar.flagged[0]?.endTime).toBe(11);
    expect(sidecar.summary).toContain("Flagged 1");
  });

  it("should normalize string timestamps in flagged segments", () => {
    const sidecar = parseAnalysisSidecar(
      JSON.stringify({
        createdAt: "2026-03-09T00:00:00.000Z",
        engine: "blacklist",
        flagged: [
          {
            category: "language",
            endTime: "11",
            priority: "medium",
            reason: "Contains profanity or offensive language.",
            ruleId: "profanity",
            startTime: "10",
            text: "bad word here",
          },
        ],
        summary: "Flagged 1 subtitle item(s). high=0, medium=1, low=0.",
        videoFileName: "episode.srt",
      }),
    );

    expect(sidecar.flagged[0]?.startTime).toBe(10);
    expect(sidecar.flagged[0]?.endTime).toBe(11);
  });

  it("should parse flagged segments that only provide start times", () => {
    const sidecar = parseAnalysisSidecar(
      JSON.stringify({
        createdAt: "2026-01-13T18:14:11.018Z",
        flagged: [
          {
            priority: "low",
            reason: "Musical performance (intro theme song).",
            startTime: 12,
          },
        ],
        models: ["gemini-3.5-flash"],
        strategy: "fast",
        summary: "Flagged 1 subtitle item(s).",
        timestamp: "2026-01-13T18:14:11.018Z",
        videoFileName:
          "adventures-from-the-book-of-virtues-season-1-episode-03-responsibility_360.mp4",
      }),
    );

    expect(sidecar.flagged).toHaveLength(1);
    expect(sidecar.flagged[0]?.startTime).toBe(12);
    expect(sidecar.flagged[0]?.endTime).toBeUndefined();
    expect(sidecar.flagged[0]?.reason).toContain("Musical performance");
  });

  it("should consolidate multiple analysis sidecars from a top-level array", () => {
    const sidecar = parseAnalysisSidecar(
      JSON.stringify([
        {
          createdAt: "2026-03-09T00:00:00.000Z",
          engine: "gemini",
          flagged: [
            {
              category: "music",
              endTime: 11,
              priority: "low",
              reason: "Musical performance.",
              ruleId: "gemini",
              startTime: 10,
              text: "Song starts.",
            },
          ],
          summary: "Gemini summary.",
          videoFileName: "episode.srt",
        },
        {
          createdAt: "2026-03-10T00:00:00.000Z",
          engine: "nova_pro",
          flagged: [
            {
              category: "relationships",
              endTime: 12,
              priority: "high",
              reason: "Romantic lyric in song.",
              ruleId: "nova_pro",
              startTime: 10.1,
              text: "Song starts with a romantic lyric.",
            },
            {
              priority: "medium",
              reason: "Frightening scene.",
              startTime: 20,
            },
          ],
          summary: "Nova summary.",
          videoFileName: "episode.srt",
        },
      ]),
    );

    expect(sidecar.engine).toBe("gemini");
    expect(sidecar.createdAt).toBe("2026-03-09T00:00:00.000Z");
    expect(sidecar.videoFileName).toBe("episode.srt");
    expect(sidecar.summary).toBe("Gemini summary.\n\nNova summary.");
    expect(sidecar.flagged).toHaveLength(2);
    expect(sidecar.flagged[0]).toEqual({
      category: "music, relationships",
      endTime: 12,
      priority: "high",
      reason: "Musical performance.; Romantic lyric in song.",
      ruleId: "gemini, nova_pro",
      startTime: 10,
      text: "Song starts with a romantic lyric.",
    });
    expect(sidecar.flagged[1]?.startTime).toBe(20);
  });

  it("should derive a job result from sidecar data before falling back to artifacts", () => {
    const result = toModerationJobResult(
      {
        artifacts: {
          flaggedCount: 1,
          summary: "artifact summary",
        },
        fileName: "episode.srt",
        inputPath: "/tmp/episode.srt",
        jobId: "job-1",
        logs: [],
        progressPct: 100,
        status: "completed",
      },
      {
        createdAt: "2026-03-09T00:00:00.000Z",
        engine: "blacklist",
        flagged: [
          {
            category: "aqeedah",
            endTime: 4,
            priority: "high",
            reason: "Promotes non-Islamic religious celebration.",
            ruleId: "aqeedah_christmas",
            startTime: 2,
            text: "Christmas is coming",
          },
        ],
        summary: "Flagged 1 subtitle item(s). high=1, medium=0, low=0.",
        videoFileName: "episode.srt",
      },
    );

    expect(result.flaggedCount).toBe(1);
    expect(result.segments[0]?.priority).toBe("high");
    expect(result.summary).toContain("high=1");
  });

  it("should summarize flagged counts and priority totals across job results", () => {
    const overview = buildModerationOverview([
      {
        fileName: "one.srt",
        flaggedCount: 2,
        jobId: "job-1",
        outputPath: "/tmp/one.analysis.json",
        segments: [
          {
            category: "aqeedah",
            endTime: 4,
            priority: "high",
            reason: "reason",
            ruleId: "r1",
            startTime: 2,
            text: "one",
          },
          {
            category: "language",
            endTime: 7,
            priority: "medium",
            reason: "reason",
            ruleId: "r2",
            startTime: 5,
            text: "two",
          },
        ],
        status: "completed",
        summary: "summary",
      },
      {
        fileName: "two.srt",
        flaggedCount: 0,
        jobId: "job-2",
        segments: [],
        status: "completed",
        summary: "No concerning content detected.",
      },
    ]);

    expect(overview.totalFlagged).toBe(2);
    expect(overview.filesWithFlags).toBe(1);
    expect(overview.counts.high).toBe(1);
    expect(overview.counts.medium).toBe(1);
    expect(overview.counts.low).toBe(0);
  });

  it("should sanitize unknown artifacts into a typed shape", () => {
    expect(
      toJobArtifacts({
        flaggedCount: 3,
        summary: "Flagged 3 subtitle item(s).",
      }),
    ).toEqual({
      flaggedCount: 3,
      summary: "Flagged 3 subtitle item(s).",
    });
  });
});
