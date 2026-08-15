import {
  AlertCircle,
  FileAudio2,
  FolderOpen,
  LoaderCircle,
  Music2,
  OctagonX,
  Play,
  ScanText,
  Scissors,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import type { JobRecord } from "@/features/batch/types";
import { dedupePaths, isSupportedVideoPath } from "@/features/batch/utils";
import { toMediaQuickActionId } from "@/features/media/quick-action-queue";
import { listVideos } from "@/features/media/transport";
import type { TaskJobRecord, TaskJobStatus } from "@/features/media/types";
import { useTauriFileDrop } from "@/features/media/useTauriFileDrop";
import { toFileName } from "@/features/shared/path";

type RemoveMusicPanelProps = {
  isActive: boolean;
  selectedInputPaths: string[];
  autoTranscribePaths: Record<string, boolean>;
  autoAnalyzePaths: Record<string, boolean>;
  onToggleAutoTranscribe: (path: string, checked: boolean) => void;
  onToggleAutoAnalyze: (path: string, checked: boolean) => void;
  onToggleAllAutoTranscribe?: (checked: boolean) => void;
  onToggleAllAutoAnalyze?: (checked: boolean) => void;
  isStartingBatch: boolean;
  isBatchActive: boolean;
  workerStatus: string;
  workerMessage: string;
  progressPct: number;
  errorMessage: string | null;
  jobs: JobRecord[];
  onAddInputFiles: () => Promise<void>;
  onAddInputFolder: () => Promise<void>;
  onAddResolvedInputPaths: (paths: string[]) => void;
  onClearSelectedInputs: () => void;
  onStart: () => Promise<void>;
  onCancel: () => Promise<void>;
  onSendToTranscription: (path: string) => Promise<void>;
  onSendToAnalysis: (path: string) => Promise<void>;
  onSendToCut: (path: string) => void;
  transcriptionOutputByInputPath: Record<string, string>;
  analysisOutputByInputPath: Record<string, string>;
  transcriptionJobByInputPath: Record<string, TaskJobRecord>;
  analysisJobByInputPath: Record<string, TaskJobRecord>;
  queuedTranscriptionPaths: string[];
  queuedAnalysisPaths: string[];
  launchingQuickActionId: string | null;
  onClearError: () => void;
};

type ProcessedVideoQuickActionsProps = {
  analysisOutputByInputPath: Record<string, string>;
  analysisJobByInputPath: Record<string, TaskJobRecord>;
  launchingQuickActionId: string | null;
  onSendToCut: (path: string) => void;
  onSendToAnalysis: (path: string) => Promise<void>;
  onSendToTranscription: (path: string) => Promise<void>;
  processedVideoPath: string;
  queuedAnalysisPaths: string[];
  queuedTranscriptionPaths: string[];
  transcriptionJobByInputPath: Record<string, TaskJobRecord>;
  transcriptionOutputByInputPath: Record<string, string>;
};

type TranscriptionQuickActionState = {
  isActive: boolean;
  isQueued: boolean;
  isStarting: boolean;
  job: TaskJobRecord | undefined;
};

type AnalysisQuickActionState = {
  hasCompletedAnalysis: boolean;
  isActive: boolean;
  isQueued: boolean;
  isStarting: boolean;
  job: TaskJobRecord | undefined;
  subtitlePath: string | undefined;
};

const toStatusVariant = (status: JobRecord["status"]) => status;

const isActiveTaskStatus = (status: TaskJobStatus | undefined) =>
  status === "queued" || status === "running";

const toStatusText = (status: TaskJobStatus, progressPct: number | undefined) => {
  if (status === "completed") {
    return "done";
  }

  if (status === "running" && typeof progressPct === "number") {
    return `${progressPct}%`;
  }

  return status;
};

const QuickActionStatusBadge = ({
  isQueued,
  job,
  label,
}: {
  isQueued: boolean;
  job: TaskJobRecord | undefined;
  label: string;
}) => {
  const status = isQueued ? "queued" : (job?.status ?? null);
  if (!status) {
    return null;
  }

  return (
    <Badge className="min-w-0 px-1.5 normal-case" variant={status}>
      {label} {toStatusText(status, job?.progressPct)}
    </Badge>
  );
};

const buildTranscriptionQuickActionState = ({
  job,
  launchingQuickActionId,
  processedVideoPath,
  queuedTranscriptionPaths,
}: {
  job: TaskJobRecord | undefined;
  launchingQuickActionId: string | null;
  processedVideoPath: string;
  queuedTranscriptionPaths: string[];
}): TranscriptionQuickActionState => {
  const isQueued = queuedTranscriptionPaths.includes(processedVideoPath);

  return {
    isActive: isQueued || isActiveTaskStatus(job?.status),
    isQueued,
    isStarting:
      launchingQuickActionId === toMediaQuickActionId("transcription", processedVideoPath),
    job,
  };
};

const buildAnalysisQuickActionState = ({
  analysisJobByInputPath,
  analysisOutputByInputPath,
  launchingQuickActionId,
  queuedAnalysisPaths,
  subtitlePath,
}: {
  analysisJobByInputPath: Record<string, TaskJobRecord>;
  analysisOutputByInputPath: Record<string, string>;
  launchingQuickActionId: string | null;
  queuedAnalysisPaths: string[];
  subtitlePath: string | undefined;
}): AnalysisQuickActionState => {
  const job = subtitlePath ? analysisJobByInputPath[subtitlePath] : undefined;
  const isQueued = subtitlePath ? queuedAnalysisPaths.includes(subtitlePath) : false;

  return {
    hasCompletedAnalysis: Boolean(subtitlePath && analysisOutputByInputPath[subtitlePath]),
    isActive: isQueued || isActiveTaskStatus(job?.status),
    isQueued,
    isStarting:
      subtitlePath !== undefined &&
      launchingQuickActionId === toMediaQuickActionId("flag", subtitlePath),
    job,
    subtitlePath,
  };
};

const TranscriptionQuickActionButton = ({
  onClick,
  state,
}: {
  onClick: () => void;
  state: TranscriptionQuickActionState;
}) => {
  const isCompleted = state.job?.status === "completed";

  return (
    <Button
      type="button"
      size="icon"
      variant={isCompleted ? "secondary" : "outline"}
      title={isCompleted ? "Transcribe this video again" : "Transcribe this video"}
      aria-label={isCompleted ? "Transcribe this video again" : "Transcribe this video"}
      disabled={state.isActive}
      onClick={onClick}
    >
      {state.isActive || state.isStarting ? (
        <LoaderCircle className="size-3.5 animate-spin" />
      ) : (
        <ScanText className="size-3.5" />
      )}
    </Button>
  );
};

const AnalysisQuickActionButton = ({
  onClick,
  state,
}: {
  onClick: (subtitlePath: string) => void;
  state: AnalysisQuickActionState;
}) => {
  if (!state.subtitlePath) {
    return null;
  }

  const subtitlePath = state.subtitlePath;
  const label = state.hasCompletedAnalysis
    ? "Run flagged-sections analysis again"
    : "Run flagged-sections analysis";

  return (
    <Button
      type="button"
      size="icon"
      variant={state.hasCompletedAnalysis ? "secondary" : "outline"}
      title={label}
      aria-label={label}
      disabled={state.isActive}
      onClick={() => onClick(subtitlePath)}
    >
      {state.isActive || state.isStarting ? (
        <LoaderCircle className="size-3.5 animate-spin" />
      ) : (
        <ShieldAlert className="size-3.5" />
      )}
    </Button>
  );
};

const ProcessedVideoQuickActions = ({
  analysisOutputByInputPath,
  analysisJobByInputPath,
  launchingQuickActionId,
  onSendToCut,
  onSendToAnalysis,
  onSendToTranscription,
  processedVideoPath,
  queuedAnalysisPaths,
  queuedTranscriptionPaths,
  transcriptionJobByInputPath,
  transcriptionOutputByInputPath,
}: ProcessedVideoQuickActionsProps) => {
  const subtitlePath = transcriptionOutputByInputPath[processedVideoPath];
  const transcriptionJob = transcriptionJobByInputPath[processedVideoPath];
  const transcriptionState = buildTranscriptionQuickActionState({
    job: transcriptionJob,
    launchingQuickActionId,
    processedVideoPath,
    queuedTranscriptionPaths,
  });
  const analysisState = buildAnalysisQuickActionState({
    analysisJobByInputPath,
    analysisOutputByInputPath,
    launchingQuickActionId,
    queuedAnalysisPaths,
    subtitlePath,
  });

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-1">
        <TranscriptionQuickActionButton
          onClick={() => onSendToTranscription(processedVideoPath)}
          state={transcriptionState}
        />
        <AnalysisQuickActionButton onClick={onSendToAnalysis} state={analysisState} />
        <Button
          type="button"
          size="icon"
          variant="outline"
          title="Open this video in Edit Video"
          aria-label="Open this video in Edit Video"
          onClick={() => onSendToCut(processedVideoPath)}
        >
          <Scissors className="size-3.5" />
        </Button>
      </div>
      <div className="flex flex-wrap justify-end gap-1">
        <QuickActionStatusBadge
          isQueued={transcriptionState.isQueued}
          job={transcriptionJob}
          label="Transcript"
        />
        <QuickActionStatusBadge
          isQueued={analysisState.isQueued}
          job={analysisState.job}
          label="Analyze"
        />
      </div>
    </div>
  );
};

const resolveDroppedPaths = async (paths: string[]) => {
  const resolvedPaths = await Promise.all(
    paths.map(async (path) => {
      if (isSupportedVideoPath(path)) {
        return [path];
      }

      const videos = await listVideos(path);
      return videos.map((video) => video.path);
    }),
  );

  return dedupePaths(resolvedPaths.flat());
};

const DismissibleError = ({
  message,
  onDismiss,
}: {
  message: string | null;
  onDismiss: () => void;
}) => {
  if (!message) {
    return null;
  }

  return (
    <div className="rounded-[12px] border border-rose-200 bg-rose-50 px-2.5 py-2 text-rose-800 text-xs">
      <div className="flex items-start justify-between gap-3">
        <p className="flex items-center gap-1.5 font-medium">
          <AlertCircle className="size-3" />
          {message}
        </p>
        <Button type="button" variant="ghost" size="sm" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
    </div>
  );
};

const RemoveMusicPanel = ({
  isActive,
  selectedInputPaths,
  autoTranscribePaths,
  autoAnalyzePaths,
  onToggleAutoTranscribe,
  onToggleAutoAnalyze,
  onToggleAllAutoTranscribe,
  onToggleAllAutoAnalyze,
  isStartingBatch,
  isBatchActive,
  workerStatus,
  workerMessage,
  progressPct,
  errorMessage,
  jobs,
  onAddInputFiles,
  onAddInputFolder,
  onAddResolvedInputPaths,
  onClearSelectedInputs,
  onStart,
  onCancel,
  onSendToCut,
  onSendToAnalysis,
  onSendToTranscription,
  transcriptionOutputByInputPath,
  analysisOutputByInputPath,
  transcriptionJobByInputPath,
  analysisJobByInputPath,
  queuedTranscriptionPaths,
  queuedAnalysisPaths,
  launchingQuickActionId,
  onClearError,
}: RemoveMusicPanelProps) => {
  const [dropErrorMessage, setDropErrorMessage] = useState<string | null>(null);
  const jobsByInputPath = useMemo(
    () =>
      jobs.reduce<Record<string, JobRecord>>((index, job) => {
        index[job.inputPath] = job;
        return index;
      }, {}),
    [jobs],
  );

  useEffect(() => {
    if (!isActive) {
      setDropErrorMessage(null);
    }
  }, [isActive]);

  const { dropTargetRef, isDropTargetActive, isResolvingDrop } = useTauriFileDrop<HTMLDivElement>({
    enabled: isActive,
    onDrop: (paths) => {
      setDropErrorMessage(null);
      onAddResolvedInputPaths(paths);
    },
    onError: (error: unknown) => {
      setDropErrorMessage(error instanceof Error ? error.message : "Unable to read dropped paths.");
    },
    resolvePaths: resolveDroppedPaths,
  });

  return (
    <div className="space-y-2">
      <Card>
        <CardHeader className="grid grid-cols-[1fr_auto] gap-2">
          <div>
            <CardTitle className="flex items-center gap-1.5">
              <span className="flex size-6 items-center justify-center rounded-lg bg-[#f5e6dc] text-[#88322d]">
                <Music2 className="size-3" />
              </span>
              Remove Music
            </CardTitle>
            <p className="mt-0.5 text-[#8f5e56] text-xs">
              Process MP4/MOV files. Outputs saved to `audio_replaced/` folders.
            </p>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          <div
            ref={dropTargetRef}
            className={`rounded-[16px] border px-2.5 py-2.5 transition ${
              isDropTargetActive
                ? "border-[#c57267] bg-[#fff1e8] shadow-[0_0_0_2px_rgba(197,114,103,0.15)]"
                : "border-[#ead3c4] border-dashed bg-[#fffaf6]"
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-medium text-[#5f2823] text-xs">Drop videos or folders here</p>
                <p className="mt-0.5 text-[#8f5e56] text-xs">Supports MP4 and MOV.</p>
              </div>
              {(isResolvingDrop || isStartingBatch) && (
                <LoaderCircle className="mt-0.5 size-3.5 animate-spin text-[#88322d]" />
              )}
            </div>

            <div className="mt-2 flex flex-wrap gap-1.5">
              <Button type="button" size="sm" variant="secondary" onClick={onAddInputFiles}>
                <FileAudio2 className="size-3" />
                Add Video Files
              </Button>
              <Button type="button" size="sm" variant="secondary" onClick={onAddInputFolder}>
                <FolderOpen className="size-3" />
                Add Folder
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={onClearSelectedInputs}
                disabled={selectedInputPaths.length === 0}
              >
                <Trash2 className="size-3" />
                Clear
              </Button>
            </div>

            <div className="mt-2 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[#8f5e56] text-xs">
                  {selectedInputPaths.length} file{selectedInputPaths.length === 1 ? "" : "s"}{" "}
                  selected
                </p>
                {selectedInputPaths.length > 0 &&
                onToggleAllAutoTranscribe &&
                onToggleAllAutoAnalyze ? (
                  <div className="flex items-center gap-3">
                    <label className="flex cursor-pointer select-none items-center gap-1.5 font-medium text-[#8f5e56] text-xs">
                      <input
                        type="checkbox"
                        checked={selectedInputPaths.every((path) => autoTranscribePaths[path])}
                        onChange={(e) => onToggleAllAutoTranscribe(e.target.checked)}
                        className="size-3.5 rounded border-[#d9b7a5] text-[#88322d] accent-[#88322d] focus:ring-[#c57267]/25"
                      />
                      Transcribe All
                    </label>
                    <label className="flex cursor-pointer select-none items-center gap-1.5 font-medium text-[#8f5e56] text-xs">
                      <input
                        type="checkbox"
                        checked={selectedInputPaths.every((path) => autoAnalyzePaths[path])}
                        onChange={(e) => onToggleAllAutoAnalyze(e.target.checked)}
                        className="size-3.5 rounded border-[#d9b7a5] text-[#88322d] accent-[#88322d] focus:ring-[#c57267]/25"
                      />
                      Analyze All
                    </label>
                  </div>
                ) : null}
              </div>
              {selectedInputPaths.length === 0 ? (
                <p className="rounded-[12px] border border-[#ead3c4] bg-white/70 px-2 py-1.5 text-[#9e6d63] text-xs">
                  No inputs selected yet.
                </p>
              ) : (
                <div className="space-y-1">
                  {selectedInputPaths.map((path) => {
                    const job = jobsByInputPath[path];
                    const processedOutputPath =
                      job?.status === "completed" && typeof job.outputPath === "string"
                        ? job.outputPath
                        : null;

                    const isTranscribeChecked = Boolean(autoTranscribePaths[path]);
                    const isAnalyzeChecked = Boolean(autoAnalyzePaths[path]);

                    return (
                      <div
                        key={path}
                        className="rounded-[12px] border border-[#ead3c4] bg-white/80 px-2 py-1.5"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-medium text-[#5f2823] text-xs" title={path}>
                              {toFileName(path)}
                            </p>
                            <p className="mt-0.5 truncate text-[#9e6d63] text-xs" title={path}>
                              {path}
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-3">
                            <label className="flex cursor-pointer select-none items-center gap-1.5 font-medium text-[#5f2823] text-xs">
                              <input
                                type="checkbox"
                                checked={isTranscribeChecked}
                                onChange={(e) => onToggleAutoTranscribe(path, e.target.checked)}
                                className="size-3.5 rounded border-[#d9b7a5] text-[#88322d] accent-[#88322d] focus:ring-[#c57267]/25"
                              />
                              Transcribe
                            </label>
                            <label className="flex cursor-pointer select-none items-center gap-1.5 font-medium text-[#5f2823] text-xs">
                              <input
                                type="checkbox"
                                checked={isAnalyzeChecked}
                                onChange={(e) => onToggleAutoAnalyze(path, e.target.checked)}
                                className="size-3.5 rounded border-[#d9b7a5] text-[#88322d] accent-[#88322d] focus:ring-[#c57267]/25"
                              />
                              Analyze
                            </label>
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            {job ? (
                              <Badge variant={toStatusVariant(job.status)}>{job.status}</Badge>
                            ) : null}
                            {processedOutputPath ? (
                              <ProcessedVideoQuickActions
                                analysisOutputByInputPath={analysisOutputByInputPath}
                                analysisJobByInputPath={analysisJobByInputPath}
                                launchingQuickActionId={launchingQuickActionId}
                                onSendToCut={onSendToCut}
                                onSendToAnalysis={onSendToAnalysis}
                                onSendToTranscription={onSendToTranscription}
                                processedVideoPath={processedOutputPath}
                                queuedAnalysisPaths={queuedAnalysisPaths}
                                queuedTranscriptionPaths={queuedTranscriptionPaths}
                                transcriptionJobByInputPath={transcriptionJobByInputPath}
                                transcriptionOutputByInputPath={transcriptionOutputByInputPath}
                              />
                            ) : null}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            <div className="space-y-1 rounded-[14px] border border-[#ead3c4] bg-[#fffaf6] px-2.5 py-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[#8f5e56] text-xs">Progress</p>
                <Badge
                  variant={
                    workerStatus === "error"
                      ? "failed"
                      : workerStatus === "ready" || workerStatus === "stopped"
                        ? "completed"
                        : "running"
                  }
                >
                  {workerStatus}
                </Badge>
              </div>
              <Progress className="h-1.5" value={progressPct} />
              <p className="text-[#7f524a] text-xs">{workerMessage}</p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Button
                type="button"
                size="sm"
                onClick={onStart}
                disabled={isStartingBatch || isBatchActive}
              >
                {isStartingBatch ? (
                  <LoaderCircle className="size-3 animate-spin" />
                ) : (
                  <Play className="size-3" />
                )}
                Start Batch
              </Button>
              <Button
                type="button"
                size="sm"
                variant="danger"
                onClick={onCancel}
                disabled={!isBatchActive}
              >
                <OctagonX className="size-3" />
                Cancel
              </Button>
            </div>
          </div>

          <DismissibleError
            message={dropErrorMessage}
            onDismiss={() => setDropErrorMessage(null)}
          />
          <DismissibleError message={errorMessage} onDismiss={onClearError} />
        </CardContent>
      </Card>
    </div>
  );
};

export default RemoveMusicPanel;
