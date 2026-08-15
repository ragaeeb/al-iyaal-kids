import type { ModerationEngine, ModerationSettings } from "@/features/media/types";
import { isAnalysisAgent } from "@/features/moderation/engines";

type AnalysisRunSelection = Pick<ModerationSettings, "analysisStrategy" | "engine">;

const updateAnalysisRunEngine = (
  settings: AnalysisRunSelection,
  engine: ModerationEngine,
): AnalysisRunSelection => ({
  ...settings,
  engine,
});

const toAnalysisRunSelection = (settings: ModerationSettings): AnalysisRunSelection => ({
  analysisStrategy: settings.analysisStrategy,
  engine: settings.engine,
});

const analysisRunDescription = (settings: AnalysisRunSelection) => {
  if (settings.engine === "blacklist") {
    return "Blacklist analysis is deterministic, local, and does not use a model.";
  }

  if (isAnalysisAgent(settings.engine)) {
    return "This run uses the selected agent model and reasoning level from Settings.";
  }

  return settings.analysisStrategy === "deep"
    ? "Deep analysis uses stronger contextual reasoning."
    : "Fast analysis uses the lighter provider model.";
};

export type { AnalysisRunSelection };
export { analysisRunDescription, toAnalysisRunSelection, updateAnalysisRunEngine };
