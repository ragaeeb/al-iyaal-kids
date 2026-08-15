import {
  BrainCircuit,
  CheckCircle2,
  Cloud,
  KeyRound,
  LoaderCircle,
  RefreshCw,
  SquareTerminal,
  TriangleAlert,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { AnalysisEngineSelect } from "@/components/analysis-engine-select";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  getModerationSettings,
  listAnalysisAgents,
  saveModerationSettings,
} from "@/features/media/transport";
import type {
  AnalysisAgentCapability,
  AnalysisStrategy,
  ModerationEngine,
  ModerationSettings,
} from "@/features/media/types";
import {
  alignAgentSelection,
  defaultReasoningForModel,
  reasoningLevelsForModel,
  selectedAgentCapability,
  updateAgentEngine,
} from "@/features/moderation/agents";
import { isAnalysisAgent, moderationEngineLabel } from "@/features/moderation/engines";
import { createModerationSettingsSaveQueue } from "@/features/moderation/settings-persistence";

const selectClassName =
  "h-9 w-full rounded-[14px] border border-[#d9b7a5] bg-white px-3 text-[#4f1f1a] text-xs outline-none transition focus:border-[#88322d] focus:ring-[#c57267]/25 focus:ring-[2px] disabled:cursor-not-allowed disabled:opacity-60";

const capabilityStatus = (capability: AnalysisAgentCapability) => {
  if (!capability.installed) {
    return "Not found";
  }
  if (capability.error) {
    return "Installed - models unavailable";
  }
  return `Ready - ${capability.models.length} model${capability.models.length === 1 ? "" : "s"}`;
};

const updateEngineSelection = (
  settings: ModerationSettings | null,
  engine: ModerationEngine,
  capabilities: AnalysisAgentCapability[],
) => {
  if (!settings) {
    return settings;
  }
  return isAnalysisAgent(engine)
    ? updateAgentEngine(settings, engine, capabilities)
    : { ...settings, engine };
};

const updateModelSelection = (
  settings: ModerationSettings | null,
  capability: AnalysisAgentCapability | undefined,
  agentModel: string,
) => {
  if (!settings || !capability) {
    return settings;
  }
  return {
    ...settings,
    agentModel,
    agentReasoningLevel: defaultReasoningForModel(capability, agentModel),
  };
};

const isAgentSelectionUnavailable = (
  settings: ModerationSettings | null,
  capabilities: AnalysisAgentCapability[] | null,
) => {
  if (!settings || !isAnalysisAgent(settings.engine)) {
    return false;
  }
  if (capabilities === null) {
    return false;
  }

  const capability = selectedAgentCapability(settings.engine, capabilities);
  return (
    capability?.installed !== true || capability.models.length === 0 || Boolean(capability.error)
  );
};

type AgentControlsProps = {
  capability: AnalysisAgentCapability | undefined;
  onModelChange: (model: string) => void;
  onReasoningChange: (level: string) => void;
  settings: ModerationSettings;
};

const AgentControls = ({
  capability,
  onModelChange,
  onReasoningChange,
  settings,
}: AgentControlsProps) => {
  const reasoningLevels = capability
    ? reasoningLevelsForModel(capability, settings.agentModel)
    : [];

  return (
    <>
      <label htmlFor="analysis-agent-model" className="space-y-1">
        <span className="text-[#8f5e56] text-xs">Agent model</span>
        <select
          id="analysis-agent-model"
          value={settings.agentModel}
          onChange={(event) => onModelChange(event.currentTarget.value)}
          className={selectClassName}
          disabled={!capability || capability.models.length === 0 || Boolean(capability.error)}
        >
          {capability?.models.map((model) => (
            <option key={model.id} value={model.id}>
              {model.label === model.id ? model.id : `${model.label} (${model.id})`}
            </option>
          ))}
        </select>
      </label>
      <label htmlFor="analysis-agent-reasoning" className="space-y-1">
        <span className="text-[#8f5e56] text-xs">Reasoning / thinking level</span>
        <select
          id="analysis-agent-reasoning"
          value={settings.agentReasoningLevel}
          onChange={(event) => onReasoningChange(event.currentTarget.value)}
          className={selectClassName}
          disabled={reasoningLevels.length === 0 || Boolean(capability?.error)}
        >
          {reasoningLevels.length === 0 ? (
            <option value="">Managed by selected model</option>
          ) : (
            reasoningLevels.map((level) => (
              <option key={level} value={level}>
                {level}
              </option>
            ))
          )}
        </select>
      </label>
      <p className="rounded-[12px] border border-amber-200 bg-amber-50 px-2.5 py-2 text-amber-900 text-xs">
        The installed CLI handles authentication and may send subtitle text to its configured
        provider. Analysis runs in an isolated temporary workspace.
      </p>
    </>
  );
};

type ProviderControlsProps = AgentControlsProps & {
  onStrategyChange: (strategy: AnalysisStrategy) => void;
};

const ProviderControls = ({
  capability,
  onModelChange,
  onReasoningChange,
  onStrategyChange,
  settings,
}: ProviderControlsProps) => {
  if (isAnalysisAgent(settings.engine)) {
    return (
      <AgentControls
        capability={capability}
        onModelChange={onModelChange}
        onReasoningChange={onReasoningChange}
        settings={settings}
      />
    );
  }

  if (settings.engine === "gemini" || settings.engine === "nova_pro") {
    return (
      <label htmlFor="cloud-analysis-strategy" className="space-y-1">
        <span className="text-[#8f5e56] text-xs">Reasoning depth</span>
        <select
          id="cloud-analysis-strategy"
          value={settings.analysisStrategy}
          onChange={(event) => onStrategyChange(event.currentTarget.value as AnalysisStrategy)}
          className={selectClassName}
        >
          <option value="fast">Fast</option>
          <option value="deep">Deep</option>
        </select>
        <span className="block text-[#8f5e56] text-xs">
          Fast uses the lighter provider model. Deep uses stronger contextual reasoning.
        </span>
      </label>
    );
  }

  return (
    <p className="rounded-[12px] border border-[#ead3c4] bg-[#fffaf6] px-2.5 py-2 text-[#7f524a] text-xs">
      Blacklist analysis is deterministic, local, and does not use a model.
    </p>
  );
};

type AgentDiscoveryProps = {
  capabilities: AnalysisAgentCapability[] | null;
  errorMessage: string | null;
  isRefreshing: boolean;
  onRefresh: () => void;
};

const AgentDiscovery = ({
  capabilities,
  errorMessage,
  isRefreshing,
  onRefresh,
}: AgentDiscoveryProps) => (
  <div className="rounded-[14px] border border-[#ead3c4] bg-[#fffaf6] p-2.5">
    <div className="flex items-center justify-between gap-2">
      <div>
        <p className="font-medium text-[#5b2722] text-xs">Installed agents</p>
        <p className="mt-0.5 text-[#8f5e56] text-[11px]">
          Models are queried directly from each CLI.
        </p>
      </div>
      <Button type="button" size="sm" variant="outline" onClick={onRefresh} disabled={isRefreshing}>
        <RefreshCw className={`size-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
        Refresh
      </Button>
    </div>
    <div className="mt-2 space-y-1.5">
      {capabilities === null ? (
        <p className="flex items-center gap-1.5 text-[#8f5e56] text-xs">
          <LoaderCircle className="size-3.5 animate-spin" />
          Scanning Codex, Antigravity, Kiro CLI, and OpenCode...
        </p>
      ) : (
        capabilities.map((capability) => (
          <div
            key={capability.id}
            className="rounded-[11px] border border-[#ead3c4] bg-white px-2 py-1.5"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 font-medium text-[#5b2722] text-xs">
                <SquareTerminal className="size-3.5 text-[#8f5e56]" />
                {capability.label}
              </span>
              <span
                className={
                  capability.installed && !capability.error
                    ? "text-[10px] text-emerald-700"
                    : "text-[#9b7068] text-[10px]"
                }
              >
                {capabilityStatus(capability)}
              </span>
            </div>
            {capability.error ? (
              <p className="mt-1 flex gap-1 text-[10px] text-amber-800">
                <TriangleAlert className="mt-0.5 size-3 shrink-0" />
                {capability.error}
              </p>
            ) : null}
          </div>
        ))
      )}
    </div>
    {errorMessage ? <p className="mt-2 text-rose-700 text-xs">{errorMessage}</p> : null}
  </div>
);

type AnalysisDefaultsCardProps = {
  agentErrorMessage: string | null;
  capabilities: AnalysisAgentCapability[] | null;
  saveErrorMessage: string | null;
  settingsErrorMessage: string | null;
  isLoadingSettings: boolean;
  isRefreshing: boolean;
  isSaving: boolean;
  onEngineChange: (engine: ModerationEngine) => void;
  onModelChange: (model: string) => void;
  onReasoningChange: (level: string) => void;
  onRefresh: () => void;
  onRetrySettings: () => void;
  onStrategyChange: (strategy: AnalysisStrategy) => void;
  saveMessage: string | null;
  settings: ModerationSettings | null;
};

const AnalysisDefaultsCard = ({
  agentErrorMessage,
  capabilities,
  isLoadingSettings,
  isRefreshing,
  isSaving,
  onEngineChange,
  onModelChange,
  onReasoningChange,
  onRefresh,
  onRetrySettings,
  onStrategyChange,
  saveErrorMessage,
  saveMessage,
  settings,
  settingsErrorMessage,
}: AnalysisDefaultsCardProps) => {
  const capability = settings
    ? selectedAgentCapability(settings.engine, capabilities ?? [])
    : undefined;

  return (
    <Card>
      <CardHeader className="grid grid-cols-[1fr_auto] gap-2">
        <div>
          <CardTitle className="flex items-center gap-1.5">
            <span className="flex size-7 items-center justify-center rounded-lg bg-[#f5e6dc] text-[#88322d]">
              <BrainCircuit className="size-3.5" />
            </span>
            Analysis Defaults
          </CardTitle>
          <p className="mt-0.5 text-[#8f5e56] text-xs">
            Choose the provider used when an Analyze job starts.
          </p>
        </div>
        <span className="text-[#8f5e56] text-xs">
          {isSaving ? "Saving..." : "Changes save automatically"}
        </span>
      </CardHeader>
      <CardContent className="grid gap-3 lg:grid-cols-[1.05fr_0.95fr]">
        <div className="space-y-2">
          <label htmlFor="analysis-engine" className="block space-y-1">
            <span className="text-[#8f5e56] text-xs">Analysis engine</span>
            <AnalysisEngineSelect
              capabilities={capabilities}
              disabled={!settings}
              id="analysis-engine"
              onChange={onEngineChange}
              value={settings?.engine ?? "blacklist"}
            />
          </label>
          {settings ? (
            <ProviderControls
              capability={capability}
              onModelChange={onModelChange}
              onReasoningChange={onReasoningChange}
              onStrategyChange={onStrategyChange}
              settings={settings}
            />
          ) : null}
          {settingsErrorMessage ? (
            <div className="rounded-[12px] border border-rose-200 bg-rose-50 px-2.5 py-2 text-rose-700 text-xs">
              <p>{settingsErrorMessage}</p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="mt-2"
                onClick={onRetrySettings}
                disabled={isLoadingSettings}
              >
                {isLoadingSettings ? "Loading..." : "Retry settings"}
              </Button>
            </div>
          ) : null}
          {saveErrorMessage ? (
            <p className="rounded-[12px] border border-rose-200 bg-rose-50 px-2.5 py-2 text-rose-700 text-xs">
              {saveErrorMessage}
            </p>
          ) : null}
          {saveMessage ? (
            <p className="flex items-center gap-1.5 text-emerald-700 text-xs">
              <CheckCircle2 className="size-3.5" />
              {saveMessage}
            </p>
          ) : null}
        </div>
        <AgentDiscovery
          capabilities={capabilities}
          errorMessage={agentErrorMessage}
          isRefreshing={isRefreshing}
          onRefresh={onRefresh}
        />
      </CardContent>
    </Card>
  );
};

type CloudKeysCardProps = {
  onGeminiKeyChange: (value: string) => void;
  onNovaKeyChange: (value: string) => void;
  settings: ModerationSettings | null;
};

const CloudKeysCard = ({ onGeminiKeyChange, onNovaKeyChange, settings }: CloudKeysCardProps) => (
  <Card>
    <CardHeader>
      <CardTitle className="flex items-center gap-1.5">
        <span className="flex size-7 items-center justify-center rounded-lg bg-[#f5e6dc] text-[#88322d]">
          <KeyRound className="size-3.5" />
        </span>
        Cloud API Keys
      </CardTitle>
      <p className="mt-0.5 text-[#8f5e56] text-xs">
        Used only when Gemini or Nova Pro is selected. Saved locally.
      </p>
    </CardHeader>
    <CardContent className="grid gap-2">
      <label htmlFor="google-gemini-api-key" className="space-y-1">
        <span className="text-[#8f5e56] text-xs">Google Gemini API Key</span>
        <Input
          id="google-gemini-api-key"
          type="password"
          value={settings?.googleApiKey ?? ""}
          onChange={(event) => onGeminiKeyChange(event.currentTarget.value)}
          placeholder="AIza..."
          disabled={!settings}
        />
      </label>
      <label htmlFor="amazon-nova-api-key" className="space-y-1">
        <span className="text-[#8f5e56] text-xs">Amazon Nova API Key</span>
        <Input
          id="amazon-nova-api-key"
          type="password"
          value={settings?.amazonNovaApiKey ?? ""}
          onChange={(event) => onNovaKeyChange(event.currentTarget.value)}
          placeholder="nova_..."
          disabled={!settings}
        />
      </label>
    </CardContent>
  </Card>
);

const ProviderBehaviorCard = ({ settings }: { settings: ModerationSettings | null }) => (
  <Card>
    <CardHeader>
      <CardTitle className="flex items-center gap-1.5">
        <Cloud className="size-4 text-[#88322d]" />
        Provider Behavior
      </CardTitle>
    </CardHeader>
    <CardContent className="space-y-2 text-[#7f524a] text-xs">
      <p className="rounded-[12px] border border-[#ead3c4] bg-[#fffaf6] px-2.5 py-2">
        New Analyze jobs use {settings ? moderationEngineLabel(settings.engine) : "the saved"}{" "}
        default. Existing analysis sidecars are not changed until you run analysis again.
      </p>
      <p>
        Blacklist stays on-device. Cloud engines and installed CLI agents use the provider account
        and privacy terms configured for that provider.
      </p>
    </CardContent>
  </Card>
);

const SettingsPanel = () => {
  const [settings, setSettings] = useState<ModerationSettings | null>(null);
  const [agentCapabilities, setAgentCapabilities] = useState<AnalysisAgentCapability[] | null>(
    null,
  );
  const [settingsErrorMessage, setSettingsErrorMessage] = useState<string | null>(null);
  const [saveErrorMessage, setSaveErrorMessage] = useState<string | null>(null);
  const [agentErrorMessage, setAgentErrorMessage] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [isLoadingSettings, setIsLoadingSettings] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isRefreshingAgents, setIsRefreshingAgents] = useState(false);

  const agentCapabilitiesRef = useRef<AnalysisAgentCapability[] | null>(null);
  const agentRequestRef = useRef(0);
  const settingsRequestRef = useRef(0);
  const saveRequestRef = useRef(0);
  const settingsLoadedRef = useRef(false);
  const saveQueueRef = useRef(createModerationSettingsSaveQueue(saveModerationSettings));

  const loadSettings = useCallback(() => {
    const requestId = settingsRequestRef.current + 1;
    settingsRequestRef.current = requestId;
    setIsLoadingSettings(true);
    setSettingsErrorMessage(null);
    setSaveErrorMessage(null);
    setSaveMessage(null);
    setSettings(null);
    settingsLoadedRef.current = false;
    getModerationSettings()
      .then((persistedSettings) => {
        if (settingsRequestRef.current !== requestId) {
          return;
        }
        setSettings(alignAgentSelection(persistedSettings, agentCapabilitiesRef.current ?? []));
        settingsLoadedRef.current = true;
      })
      .catch((error: unknown) => {
        if (settingsRequestRef.current !== requestId) {
          return;
        }
        setSettings(null);
        setSettingsErrorMessage(
          error instanceof Error ? error.message : "Failed loading settings.",
        );
      })
      .finally(() => {
        if (settingsRequestRef.current === requestId) {
          setIsLoadingSettings(false);
        }
      });
  }, []);

  const discoverAgents = useCallback(async () => {
    const requestId = agentRequestRef.current + 1;
    agentRequestRef.current = requestId;
    setIsRefreshingAgents(true);
    setAgentErrorMessage(null);
    try {
      const capabilities = await listAnalysisAgents();
      if (agentRequestRef.current !== requestId) {
        return;
      }
      agentCapabilitiesRef.current = capabilities;
      setAgentCapabilities(capabilities);
      setSettings((previous) =>
        previous ? alignAgentSelection(previous, capabilities) : previous,
      );
    } catch (error: unknown) {
      if (agentRequestRef.current === requestId) {
        agentCapabilitiesRef.current = [];
        setAgentCapabilities([]);
        setAgentErrorMessage(
          error instanceof Error ? error.message : "Failed scanning installed analysis agents.",
        );
      }
    } finally {
      if (agentRequestRef.current === requestId) {
        setIsRefreshingAgents(false);
      }
    }
  }, []);

  useEffect(() => {
    loadSettings();
    void discoverAgents();
    return () => {
      settingsRequestRef.current += 1;
      agentRequestRef.current += 1;
    };
  }, [discoverAgents, loadSettings]);

  useEffect(() => {
    if (!settings || !settingsLoadedRef.current) {
      return;
    }
    if (isAgentSelectionUnavailable(settings, agentCapabilities)) {
      return;
    }

    const requestId = saveRequestRef.current + 1;
    saveRequestRef.current = requestId;
    const timeoutId = window.setTimeout(() => {
      setIsSaving(true);
      setSaveErrorMessage(null);
      setSaveMessage(null);
      saveQueueRef
        .current(settings)
        .then(() => {
          if (saveRequestRef.current === requestId) {
            setSaveMessage("Settings saved locally.");
          }
        })
        .catch((error: unknown) => {
          if (saveRequestRef.current === requestId) {
            setSaveErrorMessage(error instanceof Error ? error.message : "Failed saving settings.");
          }
        })
        .finally(() => {
          if (saveRequestRef.current === requestId) {
            setIsSaving(false);
          }
        });
    }, 250);

    return () => window.clearTimeout(timeoutId);
  }, [agentCapabilities, settings]);

  const updateSettings = (patch: Partial<ModerationSettings>) => {
    setSaveMessage(null);
    setSaveErrorMessage(null);
    setSettings((previous) => (previous ? { ...previous, ...patch } : previous));
  };

  const refreshAgents = () => {
    void discoverAgents();
  };

  const updateEngine = (engine: ModerationEngine) => {
    setSaveMessage(null);
    setSaveErrorMessage(null);
    setSettings((previous) => updateEngineSelection(previous, engine, agentCapabilities ?? []));
  };

  const updateAgentModel = (agentModel: string) => {
    setSaveMessage(null);
    setSaveErrorMessage(null);
    setSettings((previous) => {
      const capability = previous
        ? selectedAgentCapability(previous.engine, agentCapabilities ?? [])
        : undefined;
      return updateModelSelection(previous, capability, agentModel);
    });
  };

  return (
    <div className="space-y-2">
      <AnalysisDefaultsCard
        agentErrorMessage={agentErrorMessage}
        capabilities={agentCapabilities}
        isLoadingSettings={isLoadingSettings}
        isRefreshing={isRefreshingAgents}
        isSaving={isSaving}
        onEngineChange={updateEngine}
        onModelChange={updateAgentModel}
        onReasoningChange={(agentReasoningLevel) => updateSettings({ agentReasoningLevel })}
        onRefresh={refreshAgents}
        onRetrySettings={loadSettings}
        onStrategyChange={(analysisStrategy) => updateSettings({ analysisStrategy })}
        saveErrorMessage={saveErrorMessage}
        saveMessage={saveMessage}
        settings={settings}
        settingsErrorMessage={settingsErrorMessage}
      />
      <div className="grid gap-2 lg:grid-cols-[1.1fr_0.9fr]">
        <CloudKeysCard
          onGeminiKeyChange={(googleApiKey) => updateSettings({ googleApiKey })}
          onNovaKeyChange={(amazonNovaApiKey) => updateSettings({ amazonNovaApiKey })}
          settings={settings}
        />
        <ProviderBehaviorCard settings={settings} />
      </div>
    </div>
  );
};

export default SettingsPanel;
