import { describe, expect, it } from "bun:test";
import type { ModerationSettings } from "@/features/media/types";
import { createModerationSettingsSaveQueue } from "@/features/moderation/settings-persistence";

const antigravitySettings: ModerationSettings = {
  agentModel: "gemini-3.6-flash",
  agentReasoningLevel: "low",
  amazonNovaApiKey: "",
  analysisStrategy: "fast",
  contentCriteria: "criteria",
  engine: "antigravity",
  googleApiKey: "",
  priorityGuidelines: "guidelines",
  profanityWords: [],
  rules: [],
};

describe("moderation settings persistence", () => {
  it("should expose autosave rather than a manual save action", async () => {
    const settingsPanel = await Bun.file("src/components/settings-panel.tsx").text();

    expect(settingsPanel).not.toContain("Save settings");
    expect(settingsPanel).toContain("Changes save automatically");
    expect(settingsPanel).toContain("createModerationSettingsSaveQueue");
  });

  it("should persist the selected local agent and model without remapping the engine", async () => {
    const saved: ModerationSettings[] = [];
    const enqueueSave = createModerationSettingsSaveQueue(async (settings) => {
      saved.push(settings);
    });

    await enqueueSave(antigravitySettings);

    expect(saved).toEqual([antigravitySettings]);
    expect(saved[0]?.engine).toBe("antigravity");
    expect(saved[0]?.agentModel).toBe("gemini-3.6-flash");
  });

  it("should serialize rapid provider changes so the latest selection is persisted last", async () => {
    const savedEngines: string[] = [];
    const enqueueSave = createModerationSettingsSaveQueue(async (settings) => {
      await Promise.resolve();
      savedEngines.push(settings.engine);
    });

    await Promise.all([
      enqueueSave({ ...antigravitySettings, engine: "codex" }),
      enqueueSave(antigravitySettings),
    ]);

    expect(savedEngines).toEqual(["codex", "antigravity"]);
  });
});
