import {
  Captions,
  CheckCircle2,
  Copy,
  FileJson,
  LoaderCircle,
  ShieldAlert,
  Upload,
} from "lucide-react";
import { type RefObject, useEffect, useState } from "react";
import { AnalysisRunControls } from "@/components/analysis-engine-select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatTime } from "@/features/editor/subtitles";
import { getAnalysisPromptPreview } from "@/features/media/transport";
import type {
  AnalysisPromptPreviewRequest,
  AnalysisSidecar,
  AnalysisStrategy,
  ModerationEngine,
  SubtitleEntry,
  TaskState,
} from "@/features/media/types";
import type { AnalysisRunSelection } from "@/features/moderation/run-settings";

export type FlaggedSectionsFilter = "all" | "high" | "medium" | "low";

type FlaggedSectionsDrawerContentProps = {
  analysisSidecar: AnalysisSidecar | null;
  analysisSettingsError: string | null;
  analysisRunSettings: AnalysisRunSelection | null;
  canAnalyze: boolean;
  canImportAnalysis: boolean;
  filter: FlaggedSectionsFilter;
  flagError: string | null;
  flagTask: TaskState | undefined;
  isLoadingAnalysisSettings: boolean;
  analysisImportError: string | null;
  analysisImportMessage: string | null;
  analysisImportHasWarnings: boolean;
  analysisImportTargetRef: RefObject<HTMLDivElement | null>;
  analysisPromptRequest: AnalysisPromptPreviewRequest | null;
  isAnalysisImportActive: boolean;
  isImportingAnalysis: boolean;
  onFilterChange: (value: FlaggedSectionsFilter) => void;
  onAnalysisEngineChange: (engine: ModerationEngine) => void;
  onAnalysisStrategyChange: (strategy: AnalysisStrategy) => void;
  onRetryAnalysisSettings: () => void;
  onChooseAnalysisFiles: () => void;
  onStartAnalysis: () => void;
  onSeek: (time: number) => void;
};

type SubtitlesDrawerContentProps = {
  canTranscribe: boolean;
  onSeek: (time: number) => void;
  onStartTranscription: () => Promise<void> | void;
  transcriptionError: string | null;
  subtitleLoadError: string | null;
  subtitles: SubtitleEntry[];
  transcriptionTask: TaskState | undefined;
};

const filterOptions: Array<{ label: string; value: FlaggedSectionsFilter }> = [
  { label: "All", value: "all" },
  { label: "Medium", value: "medium" },
  { label: "Low", value: "low" },
  { label: "High", value: "high" },
];

const formatSegmentTime = (segment: AnalysisSidecar["flagged"][number]) => {
  if (typeof segment.endTime === "number" && Number.isFinite(segment.endTime)) {
    return `${formatTime(segment.startTime, segment.endTime)} - ${formatTime(segment.endTime, segment.endTime)}`;
  }

  return formatTime(segment.startTime);
};

type AnalysisRunCardProps = Pick<
  FlaggedSectionsDrawerContentProps,
  | "analysisSettingsError"
  | "analysisRunSettings"
  | "canAnalyze"
  | "canImportAnalysis"
  | "flagError"
  | "isLoadingAnalysisSettings"
  | "analysisImportError"
  | "analysisImportHasWarnings"
  | "analysisImportMessage"
  | "analysisImportTargetRef"
  | "analysisPromptRequest"
  | "isAnalysisImportActive"
  | "isImportingAnalysis"
  | "onChooseAnalysisFiles"
  | "onAnalysisEngineChange"
  | "onAnalysisStrategyChange"
  | "onRetryAnalysisSettings"
  | "onStartAnalysis"
> & {
  hasExistingAnalysis: boolean;
  isFlagTaskActive: boolean;
};

type AnalysisImportCardProps = Pick<
  FlaggedSectionsDrawerContentProps,
  | "analysisImportError"
  | "analysisImportHasWarnings"
  | "analysisImportMessage"
  | "analysisImportTargetRef"
  | "analysisPromptRequest"
  | "canImportAnalysis"
  | "isAnalysisImportActive"
  | "isImportingAnalysis"
  | "onChooseAnalysisFiles"
>;

const CopyPromptButton = ({ request }: { request: AnalysisPromptPreviewRequest | null }) => {
  const [isCopied, setIsCopied] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!isCopied) {
      return;
    }

    const timeout = window.setTimeout(() => setIsCopied(false), 1500);
    return () => window.clearTimeout(timeout);
  }, [isCopied]);

  const copyPrompt = async () => {
    if (!request) {
      return;
    }

    try {
      const prompt = await getAnalysisPromptPreview(request);
      await navigator.clipboard.writeText(prompt);
      setErrorMessage(null);
      setIsCopied(true);
    } catch (error: unknown) {
      setErrorMessage(error instanceof Error ? error.message : "Failed copying prompt.");
      setIsCopied(false);
    }
  };

  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => void copyPrompt()}
        disabled={!request}
      >
        {isCopied ? <CheckCircle2 className="size-3" /> : <Copy className="size-3" />}
        {isCopied ? "Copied" : "Copy Prompt"}
      </Button>
      {errorMessage ? <p className="text-[11px] text-rose-700">{errorMessage}</p> : null}
    </div>
  );
};

const AnalysisImportCard = ({
  analysisImportError,
  analysisImportMessage,
  analysisImportHasWarnings,
  analysisImportTargetRef,
  canImportAnalysis,
  analysisPromptRequest,
  isAnalysisImportActive,
  isImportingAnalysis,
  onChooseAnalysisFiles,
}: AnalysisImportCardProps) => (
  <div
    ref={analysisImportTargetRef}
    className={`rounded-[12px] border border-dashed px-2.5 py-2.5 transition ${
      isAnalysisImportActive ? "border-[#88322d] bg-[#f5e6dc]" : "border-[#d9b7a5] bg-white"
    }`}
  >
    <div className="flex items-start gap-2">
      <FileJson className="mt-0.5 size-4 shrink-0 text-[#88322d]" />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-[#5b2722] text-xs">Import external analyses</p>
        <p className="mt-0.5 text-[#8f5e56] text-[11px]">
          Drop JSON results from ChatGPT, Claude, or another model, or copy a fresh prompt.
        </p>
        <div className="mt-2 flex flex-wrap items-start gap-1.5">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onChooseAnalysisFiles}
            disabled={!canImportAnalysis || isImportingAnalysis}
          >
            {isImportingAnalysis ? (
              <LoaderCircle className="size-3 animate-spin" />
            ) : (
              <Upload className="size-3" />
            )}
            {isImportingAnalysis ? "Importing..." : "Choose JSON Files"}
          </Button>
          <CopyPromptButton request={analysisPromptRequest} />
        </div>
      </div>
    </div>
    {analysisImportError ? (
      <p className="mt-2 text-rose-700 text-xs">{analysisImportError}</p>
    ) : null}
    {analysisImportMessage ? (
      <p
        className={`mt-2 text-xs ${analysisImportHasWarnings ? "text-amber-800" : "text-emerald-700"}`}
      >
        {analysisImportMessage}
      </p>
    ) : null}
  </div>
);

const AnalysisRunCard = ({
  flagError,
  analysisSettingsError,
  analysisImportError,
  analysisImportMessage,
  analysisImportHasWarnings,
  analysisImportTargetRef,
  analysisPromptRequest,
  analysisRunSettings,
  canAnalyze,
  canImportAnalysis,
  hasExistingAnalysis,
  isFlagTaskActive,
  isLoadingAnalysisSettings,
  isAnalysisImportActive,
  isImportingAnalysis,
  onChooseAnalysisFiles,
  onAnalysisEngineChange,
  onAnalysisStrategyChange,
  onRetryAnalysisSettings,
  onStartAnalysis,
}: AnalysisRunCardProps) => (
  <div className="space-y-2 rounded-[14px] border border-[#ead3c4] bg-[#fffaf6] px-2.5 py-2">
    <div>
      <p className="font-medium text-[#5b2722] text-xs">
        {hasExistingAnalysis ? "Run analysis again" : "Analysis settings"}
      </p>
      <p className="mt-0.5 text-[#8f5e56] text-[11px]">
        Choose the engine for this run. Saved model and reasoning defaults stay in Settings.
      </p>
    </div>
    {analysisRunSettings ? (
      <AnalysisRunControls
        idPrefix="editor-analysis-run"
        onEngineChange={onAnalysisEngineChange}
        onStrategyChange={onAnalysisStrategyChange}
        settings={analysisRunSettings}
      />
    ) : (
      <p className="text-[#8f5e56] text-xs">
        {isLoadingAnalysisSettings
          ? "Loading saved analysis settings..."
          : (analysisSettingsError ?? "Saved analysis settings are unavailable.")}
      </p>
    )}
    {analysisSettingsError ? (
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={onRetryAnalysisSettings}
        disabled={isLoadingAnalysisSettings}
      >
        {isLoadingAnalysisSettings ? "Loading..." : "Retry settings"}
      </Button>
    ) : null}
    {flagError ? <p className="text-rose-700 text-xs">{flagError}</p> : null}
    <AnalysisImportCard
      analysisImportError={analysisImportError}
      analysisImportMessage={analysisImportMessage}
      analysisImportHasWarnings={analysisImportHasWarnings}
      analysisImportTargetRef={analysisImportTargetRef}
      canImportAnalysis={canImportAnalysis}
      analysisPromptRequest={analysisPromptRequest}
      isAnalysisImportActive={isAnalysisImportActive}
      isImportingAnalysis={isImportingAnalysis}
      onChooseAnalysisFiles={onChooseAnalysisFiles}
    />
    <Button
      type="button"
      size="sm"
      onClick={onStartAnalysis}
      disabled={!canAnalyze || isFlagTaskActive || isImportingAnalysis}
    >
      {isFlagTaskActive ? (
        <LoaderCircle className="size-3 animate-spin" />
      ) : (
        <ShieldAlert className="size-3" />
      )}
      {isFlagTaskActive ? "Analyzing..." : hasExistingAnalysis ? "Run Again" : "Run Analysis"}
    </Button>
  </div>
);

export const FlaggedSectionsDrawerContent = ({
  analysisSidecar,
  analysisImportError,
  analysisImportMessage,
  analysisImportHasWarnings,
  analysisImportTargetRef,
  analysisPromptRequest,
  analysisSettingsError,
  analysisRunSettings,
  canAnalyze,
  canImportAnalysis,
  filter,
  flagError,
  flagTask,
  isLoadingAnalysisSettings,
  isAnalysisImportActive,
  isImportingAnalysis,
  onChooseAnalysisFiles,
  onAnalysisEngineChange,
  onAnalysisStrategyChange,
  onFilterChange,
  onRetryAnalysisSettings,
  onStartAnalysis,
  onSeek,
}: FlaggedSectionsDrawerContentProps) => {
  const isFlagTaskActive = flagTask?.status === "queued" || flagTask?.status === "running";
  const flagTaskError =
    flagTask?.jobs.find((job) => job.status === "failed")?.error ??
    (flagTask?.summary?.failed ? "Analysis failed." : null);
  const displayedFlagError = flagError ?? flagTaskError;

  if (!analysisSidecar) {
    return (
      <div className="space-y-1.5">
        <p className="rounded-[12px] border border-[#e7d2c5] border-dashed bg-[#fff8f3] px-2.5 py-2.5 text-[#8f5e56] text-xs">
          Analysis has not been run for this video.
        </p>
        <AnalysisRunCard
          flagError={displayedFlagError}
          analysisSettingsError={analysisSettingsError}
          analysisImportError={analysisImportError}
          analysisImportMessage={analysisImportMessage}
          analysisImportHasWarnings={analysisImportHasWarnings}
          analysisImportTargetRef={analysisImportTargetRef}
          analysisPromptRequest={analysisPromptRequest}
          analysisRunSettings={analysisRunSettings}
          canAnalyze={canAnalyze}
          canImportAnalysis={canImportAnalysis}
          hasExistingAnalysis={false}
          isFlagTaskActive={isFlagTaskActive}
          isLoadingAnalysisSettings={isLoadingAnalysisSettings}
          isAnalysisImportActive={isAnalysisImportActive}
          isImportingAnalysis={isImportingAnalysis}
          onChooseAnalysisFiles={onChooseAnalysisFiles}
          onAnalysisEngineChange={onAnalysisEngineChange}
          onAnalysisStrategyChange={onAnalysisStrategyChange}
          onRetryAnalysisSettings={onRetryAnalysisSettings}
          onStartAnalysis={onStartAnalysis}
        />
      </div>
    );
  }

  const counts = { high: 0, low: 0, medium: 0 };
  for (const segment of analysisSidecar.flagged) {
    counts[segment.priority] += 1;
  }
  const filteredSegments =
    filter === "all"
      ? analysisSidecar.flagged
      : analysisSidecar.flagged.filter((segment) => segment.priority === filter);

  return (
    <div className="space-y-1.5">
      <div className="rounded-[14px] border border-[#ead3c4] bg-[#fffaf6] px-2.5 py-2">
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-0.5">
            <p className="text-[#8f5e56] text-xs">Summary</p>
            <p className="whitespace-pre-line text-[#5b2722] text-xs">{analysisSidecar.summary}</p>
          </div>
          <Badge variant="queued">
            {analysisSidecar.providers.length > 1
              ? `${analysisSidecar.analysisCount} analyses`
              : analysisSidecar.providers[0]}
          </Badge>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Badge variant="failed">High {counts.high}</Badge>
          <Badge variant="running">Medium {counts.medium}</Badge>
          <Badge variant="queued">Low {counts.low}</Badge>
          <Badge variant="queued">Total {analysisSidecar.flagged.length}</Badge>
        </div>
      </div>
      <AnalysisRunCard
        flagError={displayedFlagError}
        analysisSettingsError={analysisSettingsError}
        analysisImportError={analysisImportError}
        analysisImportMessage={analysisImportMessage}
        analysisImportHasWarnings={analysisImportHasWarnings}
        analysisImportTargetRef={analysisImportTargetRef}
        analysisPromptRequest={analysisPromptRequest}
        analysisRunSettings={analysisRunSettings}
        canAnalyze={canAnalyze}
        canImportAnalysis={canImportAnalysis}
        hasExistingAnalysis
        isFlagTaskActive={isFlagTaskActive}
        isLoadingAnalysisSettings={isLoadingAnalysisSettings}
        isAnalysisImportActive={isAnalysisImportActive}
        isImportingAnalysis={isImportingAnalysis}
        onChooseAnalysisFiles={onChooseAnalysisFiles}
        onAnalysisEngineChange={onAnalysisEngineChange}
        onAnalysisStrategyChange={onAnalysisStrategyChange}
        onRetryAnalysisSettings={onRetryAnalysisSettings}
        onStartAnalysis={onStartAnalysis}
      />
      <div className="flex items-center justify-between gap-2 rounded-[12px] border border-[#ead3c4] bg-[#fffaf6] px-2.5 py-2">
        <div>
          <p className="text-[#8f5e56] text-xs">Filter</p>
          <p className="mt-0.5 text-[#5b2722] text-xs">
            {filteredSegments.length} of {analysisSidecar.flagged.length} section
            {analysisSidecar.flagged.length === 1 ? "" : "s"}
          </p>
        </div>
        <select
          value={filter}
          onChange={(event) => onFilterChange(event.currentTarget.value as FlaggedSectionsFilter)}
          className="h-9 rounded-[14px] border border-[#d9b7a5] bg-white px-3 text-[#4f1f1a] text-xs outline-none transition focus:border-[#88322d] focus:ring-[#c57267]/25 focus:ring-[2px]"
        >
          {filterOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      {analysisSidecar.flagged.length === 0 ? (
        <p className="rounded-[12px] border border-[#e7d2c5] border-dashed bg-[#fff8f3] px-2.5 py-2.5 text-[#8f5e56] text-xs">
          Analysis exists, but no flagged sections were found.
        </p>
      ) : filteredSegments.length === 0 ? (
        <p className="rounded-[12px] border border-[#e7d2c5] border-dashed bg-[#fff8f3] px-2.5 py-2.5 text-[#8f5e56] text-xs">
          No flagged sections match the selected filter.
        </p>
      ) : (
        filteredSegments.map((segment) => (
          <button
            key={`${segment.startTime}-${segment.endTime}-${segment.ruleId}`}
            type="button"
            onClick={() => onSeek(segment.startTime)}
            className="w-full rounded-[12px] border border-[#ead3c4] bg-[#fffaf7] px-2 py-1.5 text-left transition hover:border-[#c57267] hover:bg-white"
          >
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge
                variant={
                  segment.priority === "high"
                    ? "failed"
                    : segment.priority === "medium"
                      ? "running"
                      : "queued"
                }
              >
                {segment.priority}
              </Badge>
              <span className="font-mono text-[#7f524a] text-xs">{formatSegmentTime(segment)}</span>
            </div>
            <p className="mt-1 font-medium text-[#5b2722] text-xs">{segment.reason}</p>
            <p className="mt-0.5 text-[#7f524a] text-xs">{segment.text}</p>
          </button>
        ))
      )}
    </div>
  );
};

export const SubtitlesDrawerContent = ({
  canTranscribe,
  onSeek,
  onStartTranscription,
  transcriptionError,
  subtitleLoadError,
  subtitles,
  transcriptionTask,
}: SubtitlesDrawerContentProps) => {
  const isActive =
    transcriptionTask?.status === "queued" || transcriptionTask?.status === "running";
  const taskError =
    transcriptionTask?.jobs.find((job) => job.status === "failed")?.error ??
    (transcriptionTask?.summary?.failed ? "Subtitle generation failed." : null);
  const errorMessage = transcriptionError ?? taskError;

  if (subtitles.length === 0) {
    return (
      <div className="space-y-1.5">
        {errorMessage ? (
          <p className="rounded-[12px] border border-rose-200 bg-rose-50 px-2.5 py-2 text-rose-700 text-xs">
            {errorMessage}
          </p>
        ) : null}
        {subtitleLoadError ? (
          <p className="rounded-[12px] border border-rose-200 bg-rose-50 px-2.5 py-2 text-rose-700 text-xs">
            {subtitleLoadError}
          </p>
        ) : null}
        <p className="rounded-[12px] border border-[#e7d2c5] border-dashed bg-[#fff8f3] px-2.5 py-2.5 text-[#8f5e56] text-xs">
          No subtitles detected.
        </p>
        <Button
          type="button"
          size="sm"
          onClick={() => void onStartTranscription()}
          disabled={!canTranscribe || isActive}
        >
          {isActive ? (
            <LoaderCircle className="size-3 animate-spin" />
          ) : (
            <Captions className="size-3" />
          )}
          {isActive ? "Transcribing..." : "Generate Subtitles"}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2 rounded-[12px] border border-[#ead3c4] bg-[#fffaf6] px-2.5 py-2">
        <p className="font-medium text-[#5b2722] text-xs">Subtitles</p>
        <Badge variant="queued">{subtitles.length}</Badge>
      </div>
      {subtitles.map((subtitle) => (
        <button
          key={subtitle.index}
          type="button"
          onClick={() => onSeek(subtitle.startTime)}
          className="w-full rounded-[12px] border border-[#ead3c4] bg-[#fffaf7] px-2 py-1.5 text-left transition hover:border-[#c57267] hover:bg-white"
        >
          <span className="font-mono text-[#7f524a] text-xs">
            {formatTime(subtitle.startTime, subtitle.endTime)} -{" "}
            {formatTime(subtitle.endTime, subtitle.endTime)}
          </span>
          <p className="mt-1 text-[#5b2722] text-xs">{subtitle.text}</p>
        </button>
      ))}
    </div>
  );
};
