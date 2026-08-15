import { describe, expect, it } from "bun:test";

import { isModerationEngine } from "@/features/moderation/engines";

describe("moderation engines", () => {
  it("should recognize every runtime moderation engine", () => {
    expect(isModerationEngine("blacklist")).toBe(true);
    expect(isModerationEngine("gemini")).toBe(true);
    expect(isModerationEngine("nova_pro")).toBe(true);
    expect(isModerationEngine("codex")).toBe(true);
    expect(isModerationEngine("antigravity")).toBe(true);
    expect(isModerationEngine("kiro_cli")).toBe(true);
    expect(isModerationEngine("opencode")).toBe(true);
  });

  it("should reject unknown runtime values", () => {
    expect(isModerationEngine("unknown")).toBe(false);
    expect(isModerationEngine(null)).toBe(false);
  });
});
