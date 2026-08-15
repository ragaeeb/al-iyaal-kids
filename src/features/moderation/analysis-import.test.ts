import { describe, expect, it } from "bun:test";

import {
  buildImportedAnalysisBundle,
  validateAnalysisImportPaths,
} from "@/features/moderation/analysis-import";

const run = { flagged: [], provider: "chatgpt", summary: "Safe." };
const subtitles = [
  { endTime: 61.2, index: 1, startTime: 59.924, text: "I will hit you with my fist." },
];

describe("analysis import", () => {
  it("should combine multiple files and report duplicate runs", () => {
    const result = buildImportedAnalysisBundle(
      JSON.stringify(run),
      [JSON.stringify(run), JSON.stringify([{ ...run, provider: "claude" }])],
      "episode.srt",
      subtitles,
    );

    expect(result.addedCount).toBe(1);
    expect(result.duplicateCount).toBe(1);
    expect(result.bundle.analyses.map((entry) => entry.provider)).toEqual(["chatgpt", "claude"]);
  });

  it("should enrich incomplete external findings from the subtitle sidecar", () => {
    const result = buildImportedAnalysisBundle(
      null,
      [
        JSON.stringify({
          flagged: [
            {
              priority: "medium",
              reason: "Threatens to hit someone with a fist.",
              startTime: 59.924,
            },
          ],
          provider: "chatgpt",
          summary: "Conflict occurs.",
        }),
      ],
      "episode.srt",
      subtitles,
    );

    expect(result.bundle.analyses[0]?.flagged[0]).toEqual({
      category: "external",
      cueIndex: 1,
      endTime: 61.2,
      priority: "medium",
      reason: "Threatens to hit someone with a fist.",
      ruleId: "chatgpt",
      startTime: 59.924,
      text: "I will hit you with my fist.",
    });
  });

  it("should resolve cue-index-only findings without model timestamp conversion", () => {
    const result = buildImportedAnalysisBundle(
      null,
      [
        JSON.stringify({
          flagged: [
            {
              cueIndex: 1,
              priority: "medium",
              reason: "Threatens to hit someone with a fist.",
            },
          ],
          provider: "chatgpt",
          summary: "Conflict occurs.",
        }),
      ],
      "episode.srt",
      subtitles,
    );

    expect(result.bundle.analyses[0]?.flagged[0]).toMatchObject({
      cueIndex: 1,
      endTime: 61.2,
      startTime: 59.924,
      text: "I will hit you with my fist.",
    });
  });

  it("should skip cue indexes that do not uniquely resolve", () => {
    const result = buildImportedAnalysisBundle(
      null,
      [
        JSON.stringify({
          flagged: [{ cueIndex: 99, priority: "low", reason: "Unknown." }],
          provider: "claude",
          summary: "Unknown.",
        }),
      ],
      "episode.srt",
      subtitles,
    );

    expect(result.bundle.analyses[0]?.flagged).toEqual([]);
    expect(result.warnings).toEqual([
      "Skipped claude finding for cue 99: the cue index did not uniquely match the source subtitles.",
    ]);
  });

  it("should preserve supplied fields and skip unmatched findings without text", () => {
    const supplied = buildImportedAnalysisBundle(
      null,
      [
        JSON.stringify({
          flagged: [
            {
              category: "violence",
              priority: "high",
              reason: "Fight.",
              ruleId: "manual-violence",
              startTime: 500,
              text: "Fight me.",
            },
          ],
          provider: "claude",
          summary: "Fight.",
        }),
      ],
      "episode.srt",
      subtitles,
    );
    expect(supplied.bundle.analyses[0]?.flagged[0]).toMatchObject({
      category: "violence",
      ruleId: "manual-violence",
      text: "Fight me.",
    });

    const skipped = buildImportedAnalysisBundle(
      null,
      [
        JSON.stringify({
          flagged: [
            { priority: "low", reason: "Unknown.", startTime: 500 },
            { priority: "high", reason: "Fight.", startTime: 600, text: "Fight me." },
          ],
          provider: "chatgpt",
          summary: "Unknown.",
        }),
      ],
      "episode.srt",
      subtitles,
    );

    expect(skipped.bundle.analyses[0]?.flagged).toHaveLength(1);
    expect(skipped.skippedCount).toBe(1);
    expect(skipped.warnings).toEqual([
      "Skipped chatgpt finding at 500.000s: no reliable subtitle cue match and no text was supplied.",
    ]);
  });

  it("should recover an approximate model timestamp using distinctive reason words", () => {
    const result = buildImportedAnalysisBundle(
      null,
      [
        JSON.stringify({
          flagged: [
            {
              priority: "high",
              reason:
                "Suggests surviving on the 'energy of the universe', introducing supernatural concepts.",
              startTime: 2810.1,
            },
          ],
          provider: "chatgpt",
          summary: "New-age concepts.",
        }),
      ],
      "kung-fu-panda_480.srt",
      [
        {
          endTime: 2791.111,
          index: 587,
          startTime: 2787.482,
          text: "It is said that the Dragon Warrior can survive for months",
        },
        {
          endTime: 2795.987,
          index: 588,
          startTime: 2791.186,
          text: "on nothing but the dew of ginkgo leaf and the energy of the universe.",
        },
        {
          endTime: 2801.261,
          index: 589,
          startTime: 2797.359,
          text: "I guess my body doesn't know it's the Dragon Warrior yet.",
        },
        {
          endTime: 2806.323,
          index: 590,
          startTime: 2801.329,
          text: "I'm gonna need a lot more than dew and universe juice.",
        },
      ],
    );

    expect(result.bundle.analyses[0]?.flagged[0]).toMatchObject({
      endTime: 2795.987,
      startTime: 2791.186,
      text: "on nothing but the dew of ginkgo leaf and the energy of the universe.",
    });
  });

  it("should reject mixed or empty dropped file selections", () => {
    expect(() => validateAnalysisImportPaths([])).toThrow("No analysis JSON");
    expect(() => validateAnalysisImportPaths(["one.json", "notes.txt"])).toThrow("Only JSON");
    expect(validateAnalysisImportPaths(["one.JSON", "one.JSON"])).toEqual(["one.JSON"]);
  });
});
