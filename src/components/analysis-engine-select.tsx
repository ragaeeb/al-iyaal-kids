import type {
  AnalysisAgentCapability,
  ModerationEngine,
  ModerationSettings,
} from "@/features/media/types";
import {
  cloudModerationEngineOptions,
  isAnalysisAgent,
  moderationEngineLabel,
} from "@/features/moderation/engines";

type AnalysisEngineOption = {
  disabled?: boolean;
  label: string;
  value: ModerationEngine;
};

type AnalysisEngineSelectProps = {
  capabilities: AnalysisAgentCapability[] | null;
  disabled?: boolean;
  id: string;
  onChange: (engine: ModerationEngine) => void;
  value: ModerationEngine;
};

const selectClassName =
  "h-9 w-full rounded-[14px] border border-[#d9b7a5] bg-white px-3 text-[#4f1f1a] text-xs outline-none transition focus:border-[#88322d] focus:ring-[#c57267]/25 focus:ring-[2px] disabled:cursor-not-allowed disabled:opacity-60";

const toAgentOption = (
  engine: ModerationEngine,
  capabilities: AnalysisAgentCapability[] | null,
): AnalysisEngineOption | null => {
  if (!isAnalysisAgent(engine)) {
    return null;
  }

  const capability = capabilities?.find((candidate) => candidate.id === engine);
  return {
    disabled:
      capabilities !== null &&
      (!capability?.installed || capability.models.length === 0 || Boolean(capability.error)),
    label: capability?.label ?? moderationEngineLabel(engine),
    value: engine,
  };
};

const analysisEngineOptions = (
  value: ModerationEngine,
  capabilities: AnalysisAgentCapability[] | null,
) => {
  const installedAgents = (capabilities ?? []).filter(
    (capability) => capability.installed && capability.models.length > 0 && !capability.error,
  );
  const discoveredAgentOptions = installedAgents.map<AnalysisEngineOption>((capability) => ({
    label: capability.label,
    value: capability.id,
  }));
  const selectedAgentOption = toAgentOption(value, capabilities);
  const hasSelectedAgent = discoveredAgentOptions.some((option) => option.value === value);

  return {
    agents: hasSelectedAgent
      ? discoveredAgentOptions
      : selectedAgentOption
        ? [...discoveredAgentOptions, selectedAgentOption]
        : discoveredAgentOptions,
    cloud: cloudModerationEngineOptions,
  };
};

const AnalysisEngineSelect = ({
  capabilities,
  disabled = false,
  id,
  onChange,
  value,
}: AnalysisEngineSelectProps) => {
  const options = analysisEngineOptions(value, capabilities);

  return (
    <select
      id={id}
      value={value}
      onChange={(event) => onChange(event.currentTarget.value as ModerationEngine)}
      className={selectClassName}
      disabled={disabled}
    >
      <optgroup label="Built-in and cloud">
        {options.cloud.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </optgroup>
      {options.agents.length > 0 ? (
        <optgroup label="Installed CLI agents">
          {options.agents.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
              {option.disabled ? " (models unavailable)" : ""}
            </option>
          ))}
        </optgroup>
      ) : null}
    </select>
  );
};

type AnalysisRunControlsProps = {
  disabled?: boolean;
  idPrefix: string;
  onEngineChange: (engine: ModerationEngine) => void;
  onStrategyChange: (strategy: ModerationSettings["analysisStrategy"]) => void;
  settings: Pick<ModerationSettings, "analysisStrategy" | "engine"> | null;
};

const AnalysisRunControls = ({
  disabled = false,
  idPrefix,
  onEngineChange,
  onStrategyChange,
  settings,
}: AnalysisRunControlsProps) => {
  if (!settings) {
    return null;
  }

  const isCloudEngine = settings.engine === "gemini" || settings.engine === "nova_pro";
  const isLocalAgent = isAnalysisAgent(settings.engine);

  return (
    <div className="space-y-2">
      <label htmlFor={`${idPrefix}-engine`} className="block space-y-1">
        <span className="text-[#8f5e56] text-xs">Analysis engine</span>
        <AnalysisEngineSelect
          capabilities={null}
          disabled={disabled}
          id={`${idPrefix}-engine`}
          onChange={onEngineChange}
          value={settings.engine}
        />
      </label>
      {isCloudEngine ? (
        <label htmlFor={`${idPrefix}-strategy`} className="block space-y-1">
          <span className="text-[#8f5e56] text-xs">Reasoning depth</span>
          <select
            id={`${idPrefix}-strategy`}
            value={settings.analysisStrategy}
            onChange={(event) =>
              onStrategyChange(event.currentTarget.value as ModerationSettings["analysisStrategy"])
            }
            className={selectClassName}
            disabled={disabled}
          >
            <option value="fast">Fast</option>
            <option value="deep">Deep</option>
          </select>
        </label>
      ) : (
        <p className="rounded-[12px] border border-[#ead3c4] bg-[#fffaf6] px-2.5 py-2 text-[#7f524a] text-xs">
          {isLocalAgent
            ? "This run uses the selected agent model and reasoning level from Settings."
            : "Blacklist analysis is deterministic, local, and does not use a model."}
        </p>
      )}
    </div>
  );
};

export type { AnalysisEngineSelectProps, AnalysisRunControlsProps };

const analysisRunEngineOptions = (value: ModerationEngine) => analysisEngineOptions(value, null);

export {
  AnalysisEngineSelect,
  AnalysisRunControls,
  analysisEngineOptions,
  analysisRunEngineOptions,
};
