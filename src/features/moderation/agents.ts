import type {
  AnalysisAgentCapability,
  AnalysisAgentId,
  ModerationSettings,
} from "@/features/media/types";
import { isAnalysisAgent } from "@/features/moderation/engines";

const selectedAgentCapability = (
  engine: ModerationSettings["engine"],
  capabilities: AnalysisAgentCapability[],
) => (isAnalysisAgent(engine) ? capabilities.find((agent) => agent.id === engine) : undefined);

const defaultModelForAgent = (capability: AnalysisAgentCapability) =>
  capability.defaultModel ?? capability.models[0]?.id ?? "";

const reasoningLevelsForModel = (capability: AnalysisAgentCapability, modelId: string) =>
  capability.models.find((model) => model.id === modelId)?.reasoningLevels ?? [];

const defaultReasoningForModel = (capability: AnalysisAgentCapability, modelId: string) => {
  const model = capability.models.find((candidate) => candidate.id === modelId);
  return model?.defaultReasoningLevel ?? model?.reasoningLevels[0] ?? "";
};

const alignAgentSelection = (
  settings: ModerationSettings,
  capabilities: AnalysisAgentCapability[],
): ModerationSettings => {
  const capability = selectedAgentCapability(settings.engine, capabilities);
  if (!capability || capability.models.length === 0) {
    return settings;
  }

  const model = capability.models.some((candidate) => candidate.id === settings.agentModel)
    ? settings.agentModel
    : defaultModelForAgent(capability);
  const reasoningLevels = reasoningLevelsForModel(capability, model);
  const reasoning = reasoningLevels.includes(settings.agentReasoningLevel)
    ? settings.agentReasoningLevel
    : defaultReasoningForModel(capability, model);

  if (model === settings.agentModel && reasoning === settings.agentReasoningLevel) {
    return settings;
  }

  return {
    ...settings,
    agentModel: model,
    agentReasoningLevel: reasoning,
  };
};

const updateAgentEngine = (
  settings: ModerationSettings,
  engine: AnalysisAgentId,
  capabilities: AnalysisAgentCapability[],
) => alignAgentSelection({ ...settings, engine }, capabilities);

export {
  alignAgentSelection,
  defaultModelForAgent,
  defaultReasoningForModel,
  reasoningLevelsForModel,
  selectedAgentCapability,
  updateAgentEngine,
};
