import { describe, expect, it } from "bun:test";

import type { AnalysisAgentCapability, ModerationSettings } from "@/features/media/types";
import { alignAgentSelection, updateAgentEngine } from "@/features/moderation/agents";

const settings: ModerationSettings = {
  agentModel: "",
  agentReasoningLevel: "",
  amazonNovaApiKey: "",
  analysisStrategy: "fast",
  contentCriteria: "criteria",
  engine: "blacklist",
  googleApiKey: "",
  priorityGuidelines: "guidelines",
  profanityWords: [],
  rules: [],
};

const capabilities: AnalysisAgentCapability[] = [
  {
    defaultModel: "gpt-test",
    id: "codex",
    installed: true,
    label: "Codex",
    models: [
      {
        defaultReasoningLevel: "low",
        id: "gpt-test",
        label: "GPT Test",
        reasoningLevels: ["low", "high"],
      },
    ],
  },
];

describe("analysis agent settings", () => {
  it("should select the discovered default model and reasoning level", () => {
    expect(updateAgentEngine(settings, "codex", capabilities)).toEqual({
      ...settings,
      agentModel: "gpt-test",
      agentReasoningLevel: "low",
      engine: "codex",
    });
  });

  it("should preserve a valid model and reasoning selection", () => {
    const selected = {
      ...settings,
      agentModel: "gpt-test",
      agentReasoningLevel: "high",
      engine: "codex" as const,
    };

    expect(alignAgentSelection(selected, capabilities)).toBe(selected);
  });

  it("should leave settings unchanged while agent models are unavailable", () => {
    const selected = { ...settings, engine: "opencode" as const };
    expect(alignAgentSelection(selected, capabilities)).toBe(selected);
  });
});
