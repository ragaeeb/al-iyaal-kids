import type { AnalysisStrategy, ModerationEngine } from "@/features/media/types";

type ModerationEngineOption = {
  description: string;
  disabled: boolean;
  label: string;
  value: ModerationEngine;
};

const moderationEngineOptions: ModerationEngineOption[] = [
  {
    description: "Deterministic local rules and profanity blacklist.",
    disabled: false,
    label: "Blacklist",
    value: "blacklist",
  },
  {
    description: "Cloud analysis with Google Gemini using your saved API key.",
    disabled: false,
    label: "Gemini",
    value: "gemini",
  },
  {
    description: "Cloud analysis with Amazon Nova using your saved API key.",
    disabled: false,
    label: "Nova Pro",
    value: "nova_pro",
  },
];

const moderationEngineValues = moderationEngineOptions.map((option) => option.value);
const analysisStrategyValues: AnalysisStrategy[] = ["fast", "deep"];

const moderationEngineLabel = (engine: ModerationEngine) =>
  moderationEngineOptions.find((option) => option.value === engine)?.label ?? "Blacklist";

export {
  analysisStrategyValues,
  moderationEngineLabel,
  moderationEngineOptions,
  moderationEngineValues,
};
export type { ModerationEngineOption };
