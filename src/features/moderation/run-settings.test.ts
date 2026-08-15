import { describe, expect, it } from "bun:test";

import type { ModerationSettings } from "@/features/media/types";
import {
  analysisRunDescription,
  toAnalysisRunSelection,
  updateAnalysisRunEngine,
} from "@/features/moderation/run-settings";

const settings: Pick<ModerationSettings, "analysisStrategy" | "engine"> = {
  analysisStrategy: "fast",
  engine: "gemini",
};

describe("analysis run settings", () => {
  it("should update only the per-run engine selection", () => {
    expect(updateAnalysisRunEngine(settings, "blacklist")).toEqual({
      analysisStrategy: "fast",
      engine: "blacklist",
    });
  });

  it("should keep model and reasoning settings out of the per-run selection", () => {
    expect(
      toAnalysisRunSelection({
        agentModel: "gpt-test",
        agentReasoningLevel: "low",
        amazonNovaApiKey: "",
        analysisStrategy: "deep",
        contentCriteria: "criteria",
        engine: "codex",
        googleApiKey: "",
        priorityGuidelines: "guidelines",
        profanityWords: [],
        rules: [],
      }),
    ).toEqual({ analysisStrategy: "deep", engine: "codex" });
  });

  it("should describe local agent runs as using the saved Settings model", () => {
    expect(analysisRunDescription({ ...settings, engine: "codex" })).toContain("Settings");
  });

  it("should describe cloud reasoning depth", () => {
    expect(analysisRunDescription({ ...settings, analysisStrategy: "deep" })).toContain("Deep");
  });
});
