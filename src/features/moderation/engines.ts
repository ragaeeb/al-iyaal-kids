import type { AnalysisAgentId, AnalysisStrategy, ModerationEngine } from "@/features/media/types";

type ModerationEngineOption = {
  description: string;
  disabled: boolean;
  label: string;
  value: ModerationEngine;
};

const cloudModerationEngineOptions: ModerationEngineOption[] = [
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

const agentModerationEngineOptions: ModerationEngineOption[] = [
  {
    description: "Analysis through an installed OpenAI Codex CLI session.",
    disabled: false,
    label: "Codex",
    value: "codex",
  },
  {
    description: "Analysis through an installed Google Antigravity CLI session.",
    disabled: false,
    label: "Antigravity",
    value: "antigravity",
  },
  {
    description: "Analysis through an installed Kiro CLI session.",
    disabled: false,
    label: "Kiro CLI",
    value: "kiro_cli",
  },
  {
    description: "Analysis through an installed OpenCode CLI session.",
    disabled: false,
    label: "OpenCode",
    value: "opencode",
  },
];

const moderationEngineOptions = [...cloudModerationEngineOptions, ...agentModerationEngineOptions];

const moderationEngineValues = moderationEngineOptions.map((option) => option.value);
const analysisStrategyValues: AnalysisStrategy[] = ["fast", "deep"];
const analysisAgentValues = agentModerationEngineOptions.map(
  (option) => option.value as AnalysisAgentId,
);

const isModerationEngine = (value: unknown): value is ModerationEngine =>
  typeof value === "string" && moderationEngineValues.includes(value as ModerationEngine);

const isAnalysisAgent = (engine: ModerationEngine): engine is AnalysisAgentId =>
  analysisAgentValues.includes(engine as AnalysisAgentId);

const moderationEngineLabel = (engine: ModerationEngine) =>
  moderationEngineOptions.find((option) => option.value === engine)?.label ?? "Blacklist";

export type { ModerationEngineOption };
export {
  agentModerationEngineOptions,
  analysisAgentValues,
  analysisStrategyValues,
  cloudModerationEngineOptions,
  isAnalysisAgent,
  isModerationEngine,
  moderationEngineLabel,
  moderationEngineOptions,
  moderationEngineValues,
};
