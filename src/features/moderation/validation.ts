import type { ModerationRule, ModerationSettings } from "@/features/media/types";

const isPriority = (value: string): value is "high" | "medium" | "low" =>
  value === "high" || value === "medium" || value === "low";

const isRule = (value: unknown): value is ModerationRule => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<ModerationRule>;
  return (
    typeof candidate.ruleId === "string" &&
    typeof candidate.category === "string" &&
    typeof candidate.reason === "string" &&
    Array.isArray(candidate.patterns) &&
    candidate.patterns.every((pattern) => typeof pattern === "string") &&
    typeof candidate.priority === "string" &&
    isPriority(candidate.priority)
  );
};

export const isValidModerationSettings = (value: unknown): value is ModerationSettings => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<ModerationSettings>;
  return (
    typeof candidate.contentCriteria === "string" &&
    typeof candidate.priorityGuidelines === "string" &&
    Array.isArray(candidate.profanityWords) &&
    candidate.profanityWords.every((word) => typeof word === "string") &&
    Array.isArray(candidate.rules) &&
    candidate.rules.every(isRule)
  );
};
