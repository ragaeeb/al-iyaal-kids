import { describe, expect, it } from "bun:test";

import { isValidModerationSettings } from "@/features/moderation/validation";

describe("isValidModerationSettings", () => {
  it("should validate moderation settings schema", () => {
    const valid = {
      amazonNovaApiKey: "",
      analysisStrategy: "fast",
      contentCriteria: "criteria",
      engine: "blacklist",
      googleApiKey: "",
      priorityGuidelines: "guidelines",
      profanityWords: ["word"],
      rules: [
        {
          category: "aqeedah",
          patterns: ["christmas"],
          priority: "high",
          reason: "issue",
          ruleId: "aqeedah_1",
        },
      ],
    };
    expect(isValidModerationSettings(valid)).toBe(true);
    expect(
      isValidModerationSettings({ ...valid, rules: [{ ...valid.rules[0], priority: "bad" }] }),
    ).toBe(false);
    expect(isValidModerationSettings({ ...valid, engine: "bad" })).toBe(false);
    expect(isValidModerationSettings({ ...valid, analysisStrategy: "bad" })).toBe(false);
  });
});
