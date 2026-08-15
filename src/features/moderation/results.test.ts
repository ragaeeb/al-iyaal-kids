import { describe, expect, it } from "bun:test";

import {
  buildModerationOverview,
  combineAnalysisBundles,
  parseAnalysisBundle,
  parseAnalysisSidecar,
  toJobArtifacts,
  toModerationJobResult,
} from "@/features/moderation/results";

const canonicalSidecar = () => ({
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
  summary: "Flagged 1 subtitle item.",
  videoFileName: "episode.srt",
});

describe("moderation results", () => {
  it("should parse the canonical analysis sidecar schema", () => {
    const sidecar = parseAnalysisSidecar(JSON.stringify(canonicalSidecar()));

    expect(sidecar.flagged).toHaveLength(1);
    expect(sidecar.flagged[0]?.startTime).toBe(10);
    expect(sidecar.flagged[0]?.endTime).toBe(11);
  });

  it("should preserve installed-agent engine names in canonical sidecars", () => {
    const sidecar = parseAnalysisSidecar(
      JSON.stringify({ ...canonicalSidecar(), engine: "codex", flagged: [] }),
    );

    expect(sidecar.engine).toBe("codex");
  });

  it("should migrate object and array analysis inputs into a versioned bundle", () => {
    const canonical = canonicalSidecar();
    const bundle = parseAnalysisBundle(
      JSON.stringify([
        canonical,
        {
          flagged: [{ priority: "high", reason: "External finding", startTime: 20 }],
          provider: "chatgpt",
          summary: "External summary.",
        },
      ]),
      "episode.srt",
    );

    expect(bundle).toMatchObject({ schemaVersion: 2, sourceFile: "episode.srt" });
    expect(bundle.analyses).toHaveLength(2);
    expect(bundle.analyses[1]?.provider).toBe("chatgpt");
    expect(bundle.analyses[1]?.flagged[0]).toMatchObject({
      priority: "high",
      reason: "External finding",
      startTime: 20,
    });
  });

  it("should normalize external SRT and clock timestamp strings", () => {
    const bundle = parseAnalysisBundle(
      JSON.stringify({
        flagged: [
          { priority: "high", reason: "one", startTime: "00:46:31,186" },
          { priority: "low", reason: "two", startTime: "46:37.359" },
          { priority: "medium", reason: "three", startTime: "2801.329" },
        ],
        provider: "claude",
        summary: "summary",
      }),
      "episode.srt",
    );

    expect(bundle.analyses[0]?.flagged.map((flag) => flag.startTime)).toEqual([
      2791.186, 2797.359, 2801.329,
    ]);
  });

  it("should reject an entire import when any required external flag field is malformed", () => {
    const canonical = canonicalSidecar();
    expect(() =>
      parseAnalysisSidecar(
        JSON.stringify({
          ...canonical,
          flagged: [{ ...canonical.flagged[0], startTime: "not-a-time" }],
        }),
      ),
    ).toThrow("startTime");
    expect(() =>
      parseAnalysisSidecar(
        JSON.stringify({
          ...canonical,
          flagged: [{ ...canonical.flagged[0], startTime: -1 }],
        }),
      ),
    ).toThrow("startTime");
    expect(() =>
      parseAnalysisSidecar(
        JSON.stringify({
          ...canonical,
          flagged: [{ reason: "Missing priority", startTime: 12 }],
        }),
      ),
    ).toThrow("priority");
  });

  it("should consolidate bundle runs for display without losing provider provenance", () => {
    const sidecar = parseAnalysisSidecar(
      JSON.stringify({
        analyses: [
          canonicalSidecar(),
          {
            flagged: [{ priority: "high", reason: "External finding", startTime: 10.1 }],
            provider: "claude",
            summary: "Claude summary.",
          },
        ],
        schemaVersion: 2,
        sourceFile: "episode.srt",
      }),
    );

    expect(sidecar.analysisCount).toBe(2);
    expect(sidecar.providers).toEqual(["blacklist", "claude"]);
    expect(sidecar.flagged).toHaveLength(1);
    expect(sidecar.flagged[0]?.priority).toBe("high");
    expect(sidecar.summary).toBe("Flagged 1 subtitle item.\n\nClaude summary.");
  });

  it("should append imported runs and remove exact duplicates", () => {
    const existing = parseAnalysisBundle(JSON.stringify(canonicalSidecar()), "episode.srt");
    const imported = parseAnalysisBundle(
      JSON.stringify([canonicalSidecar(), { flagged: [], provider: "chatgpt", summary: "Safe." }]),
      "episode.srt",
    );

    const combined = combineAnalysisBundles(existing, [imported], "episode.srt");

    expect(combined.analyses).toHaveLength(2);
    expect(combined.analyses[1]?.provider).toBe("chatgpt");
  });

  it("should derive job and overview results from canonical sidecar data", () => {
    const sidecar = parseAnalysisSidecar(JSON.stringify(canonicalSidecar()));
    const result = toModerationJobResult(
      {
        fileName: "episode.srt",
        inputPath: "/tmp/episode.srt",
        jobId: "job-1",
        logs: [],
        progressPct: 100,
        status: "completed",
      },
      sidecar,
    );
    const overview = buildModerationOverview([result]);

    expect(result.flaggedCount).toBe(1);
    expect(result.summary).toBe("Flagged 1 subtitle item.");
    expect(overview).toEqual({
      counts: { high: 0, low: 0, medium: 1 },
      filesWithFlags: 1,
      totalFlagged: 1,
    });
  });

  it("should accept only finite nonnegative integer artifact counts", () => {
    expect(toJobArtifacts({ flaggedCount: 3, summary: "Flagged 3 items." })).toEqual({
      flaggedCount: 3,
      summary: "Flagged 3 items.",
    });
    expect(toJobArtifacts({ flaggedCount: -1, summary: "invalid" })).toBeUndefined();
    expect(toJobArtifacts({ flaggedCount: 1.5, summary: "invalid" })).toBeUndefined();
  });
});
