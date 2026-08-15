import { describe, expect, it } from "bun:test";

import {
  analysisEngineOptions,
  analysisRunEngineOptions,
} from "@/components/analysis-engine-select";

describe("analysis engine options", () => {
  it("should keep every built-in and cloud engine available for persisted cloud settings", () => {
    const options = analysisEngineOptions("gemini", []);

    expect(options.cloud.map((option) => option.value)).toEqual([
      "blacklist",
      "gemini",
      "nova_pro",
    ]);
    expect(options.cloud.every((option) => !option.disabled)).toBe(true);
  });

  it("should keep the saved agent selectable while discovery is pending", () => {
    const options = analysisEngineOptions("codex", null);

    const option = options.agents.find((candidate) => candidate.value === "codex");
    expect(option?.disabled).toBe(false);
    expect(option?.label).toBe("Codex");
  });

  it("should disable a saved agent when completed discovery cannot provide it", () => {
    const options = analysisEngineOptions("codex", []);

    expect(options.agents.find((option) => option.value === "codex")?.disabled).toBe(true);
  });

  it("should disable an agent whose model discovery returned an error", () => {
    const options = analysisEngineOptions("codex", [
      {
        error: "database is locked",
        id: "codex",
        installed: true,
        label: "Codex",
        models: [{ id: "gpt-5", label: "GPT-5", reasoningLevels: ["low"] }],
      },
    ]);

    expect(options.agents.find((option) => option.value === "codex")?.disabled).toBe(true);
  });

  it("should limit per-run choices to cloud engines and the saved local agent", () => {
    const options = analysisRunEngineOptions("codex");

    expect(options.cloud.map((option) => option.value)).toEqual([
      "blacklist",
      "gemini",
      "nova_pro",
    ]);
    expect(options.agents.map((option) => option.value)).toEqual(["codex"]);
  });
});
