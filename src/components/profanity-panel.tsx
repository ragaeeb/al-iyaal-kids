import { open } from "@tauri-apps/plugin-dialog";
import {
  Brain,
  FolderOpen,
  LoaderCircle,
  Plus,
  Settings2,
  ShieldAlert,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { LogOutput } from "@/components/log-output";
import { ModerationSettingsPanel } from "@/components/moderation-settings-panel";
import { TaskDrawer } from "@/components/task-drawer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatTime } from "@/features/editor/subtitles";
import { listSrtFiles, readTextFile } from "@/features/media/transport";
import type {
  AnalysisSidecar,
  AnalysisStrategy,
  ModerationEngine,
  TaskState,
} from "@/features/media/types";
import type { useMediaController } from "@/features/media/useMediaController";
import { moderationEngineLabel, moderationEngineOptions } from "@/features/moderation/engines";
import {
  buildModerationOverview,
  type ModerationJobResult,
  parseAnalysisSidecar,
  toModerationJobResult,
} from "@/features/moderation/results";
import { toJobId } from "@/features/shared/job-id";

type MediaController = ReturnType<typeof useMediaController>;

type ProfanityPanelProps = {
  controller: MediaController;
};

type ManualAnalysisResult = {
  sidecarPath: string;
  sidecar: AnalysisSidecar;
  sourcePath: string;
};

const toPathList = (value: string | string[] | null): string[] => {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
};

const toFileName = (path: string) => path.split("/").at(-1) ?? path;

const dedupePaths = (paths: string[]) => Array.from(new Set(paths));

const toAnalysisPath = (path: string) => path.replace(/\.srt$/i, ".analysis.json");

const toTaskActivity = (
  taskStatus: MediaController["state"]["tasksById"][string]["status"] | undefined,
  workerStatus: MediaController["state"]["workerStatus"],
) => {
  const isTaskStarting = taskStatus === "queued" || workerStatus === "starting";
  const isTaskRunning = taskStatus === "running";

  return {
    buttonLabel: isTaskStarting
      ? "Starting..."
      : isTaskRunning
        ? "Running Detection..."
        : "Run Detection",
    isBusy: isTaskStarting || isTaskRunning,
  };
};

const toWorkerStatusVariant = (workerStatus: MediaController["state"]["workerStatus"]) => {
  if (workerStatus === "error") {
    return "failed" as const;
  }

  if (workerStatus === "ready") {
    return "completed" as const;
  }

  return "running" as const;
};

const toCompletionMessage = (
  taskStatus: MediaController["state"]["tasksById"][string]["status"] | undefined,
  totalFlagged: number,
  cancelRequested: boolean,
) => {
  if (cancelRequested && taskStatus !== "cancelled" && taskStatus !== "completed") {
    return "Cancellation requested. The worker will stop after the current file finishes.";
  }

  if (cancelRequested && taskStatus === "completed") {
    return "Cancellation was requested, but the current file was already in progress. It finished because cancel mode is stop-after-current.";
  }

  if (taskStatus === "completed" && totalFlagged === 0) {
    return "Detection completed. No concerning lines were found in the latest run.";
  }

  if (taskStatus === "completed") {
    return `Detection completed. Found ${totalFlagged} concerning subtitle line${
      totalFlagged === 1 ? "" : "s"
    }.`;
  }

  if (taskStatus === "cancelled") {
    return "Detection stopped after the current file. Completed results remain available below.";
  }

  return "Run local detection to generate analysis sidecars and review flagged lines.";
};

const getPendingAnalysisJobs = (
  jobs: NonNullable<MediaController["state"]["tasksById"][string]>["jobs"] | undefined,
  analysisByJobId: Record<string, AnalysisSidecar>,
) => {
  return (jobs ?? []).filter(
    (job) =>
      job.status === "completed" &&
      typeof job.outputPath === "string" &&
      !analysisByJobId[job.jobId],
  );
};

const loadAnalysisSidecars = async (
  jobs: NonNullable<MediaController["state"]["tasksById"][string]>["jobs"] | undefined,
  analysisByJobId: Record<string, AnalysisSidecar>,
  onSidecar: (jobId: string, sidecar: AnalysisSidecar) => void,
) => {
  const jobsToLoad = getPendingAnalysisJobs(jobs, analysisByJobId);

  for (const job of jobsToLoad) {
    const content = await readTextFile(job.outputPath ?? "");
    onSidecar(job.jobId, parseAnalysisSidecar(content));
  }
};

const toManualJobResult = ({
  sidecar,
  sidecarPath,
  sourcePath,
}: ManualAnalysisResult): ModerationJobResult => {
  const jobId = toJobId(sourcePath);
  return {
    fileName: toFileName(sourcePath),
    flaggedCount: sidecar.flagged.length,
    jobId,
    outputPath: sidecarPath,
    segments: sidecar.flagged,
    status: "completed",
    summary: sidecar.summary || "No analysis summary available yet.",
  };
};

type DetectionTaskDrawerContentProps = {
  flagTask: TaskState | undefined;
};

const DetectionTaskDrawerContent = ({ flagTask }: DetectionTaskDrawerContentProps) => {
  if (!flagTask) {
    return (
      <p className="rounded-[22px] border border-[#e7d2c5] border-dashed bg-[#fff8f3] px-4 py-5 text-[#8f5e56] text-sm">
        No detection task has run yet.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between rounded-[20px] border border-[#ead3c4] bg-[#fffaf6] px-4 py-3">
        <div>
          <p className="text-[#8f5e56] text-sm">Task Status</p>
          <p className="mt-1 font-medium text-[#5b2722] text-sm">{flagTask.taskId}</p>
        </div>
        <Badge variant={flagTask.status === "completed" ? "completed" : "running"}>
          {flagTask.status}
        </Badge>
      </div>
      {flagTask.cancelRequested ? (
        <div className="rounded-[18px] border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900 text-sm">
          Cancellation was requested. The worker will stop after the current file finishes.
        </div>
      ) : null}
      {flagTask.jobs.map((job) => (
        <div key={job.jobId} className="rounded-[22px] border border-[#ead3c4] bg-[#fffaf7] p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="truncate font-medium text-[#5f2823] text-sm">{job.fileName}</p>
            <Badge variant={job.status === "completed" ? "completed" : job.status}>
              {job.status}
            </Badge>
          </div>
          {job.outputPath ? (
            <p className="mt-2 text-[#8f5e56] text-xs">{toFileName(job.outputPath)}</p>
          ) : null}
          <LogOutput logs={job.logs} />
          {job.error ? <p className="mt-3 text-rose-700 text-xs">{job.error}</p> : null}
        </div>
      ))}
    </div>
  );
};

type SelectedFilesCardProps = {
  selectedSrtPaths: string[];
};

const SelectedFilesCard = ({ selectedSrtPaths }: SelectedFilesCardProps) => (
  <div className="rounded-[22px] border border-[#ead3c4] bg-[#fffaf6] px-4 py-4">
    <div className="flex items-center justify-between gap-3">
      <p className="text-[#8f5e56] text-sm">Selected subtitle files</p>
      <span className="font-medium text-[#5b2722] text-sm">{selectedSrtPaths.length}</span>
    </div>
    <div className="mt-3 max-h-56 space-y-2 overflow-auto pr-1">
      {selectedSrtPaths.length === 0 ? (
        <p className="text-[#8f5e56] text-sm">No files selected.</p>
      ) : (
        selectedSrtPaths.map((path) => (
          <div
            key={path}
            className="rounded-[18px] border border-[#ead3c4] bg-white px-3 py-2 text-[#5f2823] text-sm"
          >
            {toFileName(path)}
          </div>
        ))
      )}
    </div>
  </div>
);

type DetectionFeedbackCardProps = {
  cancelRequested: boolean;
  latestLogLine?: string;
  taskStatus: MediaController["state"]["tasksById"][string]["status"] | undefined;
  totalFlagged: number;
  workerMessage: string;
  workerStatus: MediaController["state"]["workerStatus"];
};

const DetectionFeedbackCard = ({
  cancelRequested,
  latestLogLine,
  taskStatus,
  totalFlagged,
  workerMessage,
  workerStatus,
}: DetectionFeedbackCardProps) => (
  <div className="rounded-[22px] border border-[#ead3c4] bg-[#fffaf6] px-4 py-4">
    <div className="flex items-center justify-between gap-3">
      <p className="text-[#8f5e56] text-sm">Detection Feedback</p>
      <Badge variant={toWorkerStatusVariant(workerStatus)}>{workerStatus}</Badge>
    </div>
    <p className="mt-2 text-[#7f524a] text-sm">{workerMessage}</p>
    <p className="mt-2 font-medium text-[#5b2722] text-sm">
      {toCompletionMessage(taskStatus, totalFlagged, cancelRequested)}
    </p>
    {latestLogLine ? (
      <div className="mt-3 rounded-[16px] bg-[#fdf1e8] px-3 py-2">
        <p className="font-mono text-[#7f524a] text-[11px]">{latestLogLine}</p>
      </div>
    ) : null}
  </div>
);

type EngineCardProps = {
  analysisStrategy: AnalysisStrategy;
  engine: ModerationEngine;
  onStrategyChange: (value: AnalysisStrategy) => void;
  onEngineChange: (value: ModerationEngine) => void;
  settingsError: string | null;
};

const EngineCard = ({
  analysisStrategy,
  engine,
  onStrategyChange,
  onEngineChange,
  settingsError,
}: EngineCardProps) => (
  <div className="rounded-[22px] border border-[#ead3c4] bg-[#fffaf6] px-4 py-4">
    <div className="flex items-center justify-between gap-3">
      <div>
        <p className="text-[#8f5e56] text-sm">Analysis Mode</p>
        <p className="mt-1 font-medium text-[#5b2722] text-sm">
          {moderationEngineLabel(engine)} · {analysisStrategy}
        </p>
      </div>
      <Brain className="size-4 text-[#8f5e56]" />
    </div>
    <div className="mt-3 grid gap-3">
      <label className="space-y-2">
        <span className="text-[#8f5e56] text-xs">Detection engine</span>
        <select
          value={engine}
          onChange={(event) => onEngineChange(event.currentTarget.value as ModerationEngine)}
          className="h-11 w-full rounded-[18px] border border-[#d9b7a5] bg-white px-4 text-[#4f1f1a] text-sm outline-none transition focus:border-[#88322d] focus:ring-[#c57267]/25 focus:ring-[3px]"
        >
          {moderationEngineOptions.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label className="space-y-2">
        <span className="text-[#8f5e56] text-xs">Reasoning depth</span>
        <select
          value={analysisStrategy}
          onChange={(event) => onStrategyChange(event.currentTarget.value as AnalysisStrategy)}
          className="h-11 w-full rounded-[18px] border border-[#d9b7a5] bg-white px-4 text-[#4f1f1a] text-sm outline-none transition focus:border-[#88322d] focus:ring-[#c57267]/25 focus:ring-[3px]"
        >
          <option value="fast">Fast</option>
          <option value="deep">Deep</option>
        </select>
      </label>
      <p className="text-[#8f5e56] text-xs">
        {moderationEngineOptions.find((option) => option.value === engine)?.description}
      </p>
      <p className="text-[#8f5e56] text-xs">
        Fast uses the lighter model path. Deep uses the stronger model path for harder contextual
        review.
      </p>
      {settingsError ? <p className="text-rose-700 text-xs">{settingsError}</p> : null}
    </div>
  </div>
);

type OverviewCardsProps = {
  filesWithFlags: number;
  highCount: number;
  lowCount: number;
  mediumCount: number;
  totalFlagged: number;
};

const OverviewCards = ({
  filesWithFlags,
  highCount,
  lowCount,
  mediumCount,
  totalFlagged,
}: OverviewCardsProps) => (
  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
    <div className="rounded-[22px] border border-[#ead3c4] bg-[#fffaf6] px-4 py-4">
      <p className="text-[#8f5e56] text-sm">Flagged Lines</p>
      <p className="mt-2 font-semibold text-2xl text-[#5b2722]">{totalFlagged}</p>
    </div>
    <div className="rounded-[22px] border border-[#ead3c4] bg-[#fffaf6] px-4 py-4">
      <p className="text-[#8f5e56] text-sm">Files With Flags</p>
      <p className="mt-2 font-semibold text-2xl text-[#5b2722]">{filesWithFlags}</p>
    </div>
    <div className="rounded-[22px] border border-[#ead3c4] bg-[#fffaf6] px-4 py-4">
      <p className="text-[#8f5e56] text-sm">Priority Mix</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Badge variant="failed">high {highCount}</Badge>
        <Badge variant="running">medium {mediumCount}</Badge>
        <Badge variant="queued">low {lowCount}</Badge>
      </div>
    </div>
  </div>
);

type ResultsSectionProps = {
  moderationResults: ModerationJobResult[];
};

const ResultsSection = ({ moderationResults }: ResultsSectionProps) => (
  <div className="space-y-3">
    <div className="flex items-center justify-between gap-3">
      <p className="font-medium text-[#5b2722] text-sm">Latest Results</p>
      <span className="text-[#8f5e56] text-xs">
        {moderationResults.length === 0
          ? "No completed analysis yet."
          : `${moderationResults.length} file result${moderationResults.length === 1 ? "" : "s"}`}
      </span>
    </div>
    {moderationResults.length === 0 ? (
      <div className="rounded-[22px] border border-[#e7d2c5] border-dashed bg-[#fff8f3] px-4 py-5 text-[#8f5e56] text-sm">
        Run detection or load existing `.analysis.json` sidecars to review flagged subtitle lines
        here.
      </div>
    ) : (
      moderationResults.map((result) => (
        <div
          key={result.jobId}
          className="rounded-[24px] border border-[#ead3c4] bg-[#fffaf7] px-4 py-4"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate font-medium text-[#5f2823] text-sm">{result.fileName}</p>
              <p className="mt-1 text-[#8f5e56] text-xs">{result.summary}</p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={result.status === "completed" ? "completed" : result.status}>
                {result.status}
              </Badge>
              <Badge variant={result.flaggedCount > 0 ? "running" : "completed"}>
                {result.flaggedCount} flagged
              </Badge>
            </div>
          </div>
          {result.segments.length === 0 ? (
            <p className="mt-3 text-[#7f524a] text-sm">
              {result.status === "completed"
                ? "No concerning lines were detected for this file."
                : "Detailed analysis output will appear here after completion."}
            </p>
          ) : (
            <div className="mt-3 space-y-2">
              {result.segments.map((segment) => (
                <div
                  key={`${result.jobId}-${segment.startTime}-${segment.ruleId}`}
                  className="rounded-[18px] border border-[#ead3c4] bg-white px-3 py-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
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
                    <span className="font-mono text-[#7f524a] text-xs">
                      {formatTime(segment.startTime, segment.endTime)} -{" "}
                      {formatTime(segment.endTime, segment.endTime)}
                    </span>
                    <span className="text-[#8f5e56] text-xs">{segment.category}</span>
                  </div>
                  <p className="mt-2 font-medium text-[#5b2722] text-sm">{segment.reason}</p>
                  <p className="mt-1 text-[#7f524a] text-sm">{segment.text}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      ))
    )}
  </div>
);

const ProfanityPanel = ({ controller }: ProfanityPanelProps) => {
  const [selectedSrtPaths, setSelectedSrtPaths] = useState<string[]>([]);
  const [isResolvingFolder, setIsResolvingFolder] = useState(false);
  const [isLoadingExistingResults, setIsLoadingExistingResults] = useState(false);
  const [analysisByJobId, setAnalysisByJobId] = useState<Record<string, AnalysisSidecar>>({});
  const [manualResults, setManualResults] = useState<Record<string, ManualAnalysisResult>>({});
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [engine, setEngine] = useState<ModerationEngine>("blacklist");
  const [analysisStrategy, setAnalysisStrategy] = useState<AnalysisStrategy>("fast");
  const previousTaskIdRef = useRef<string | null>(null);

  const flagTask = useMemo(() => {
    return Object.values(controller.state.tasksById)
      .filter((task) => task.taskKind === "flag")
      .at(-1);
  }, [controller.state.tasksById]);

  const taskActivity = toTaskActivity(flagTask?.status, controller.state.workerStatus);
  const latestLogLine = flagTask?.jobs
    .flatMap((job) => job.logs)
    .filter(Boolean)
    .at(-1);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      try {
        const loaded = await controller.loadSettings();
        if (!mounted) {
          return;
        }
        setEngine(loaded.engine);
        setAnalysisStrategy(loaded.analysisStrategy);
        setSettingsError(null);
      } catch (error: unknown) {
        if (!mounted) {
          return;
        }
        setSettingsError(
          error instanceof Error ? error.message : "Failed loading moderation settings.",
        );
      }
    };

    load().catch(() => undefined);

    return () => {
      mounted = false;
    };
  }, [controller.loadSettings]);

  useEffect(() => {
    const nextTaskId = flagTask?.taskId ?? null;
    if (previousTaskIdRef.current === nextTaskId) {
      return;
    }

    previousTaskIdRef.current = nextTaskId;
    setAnalysisByJobId({});
  }, [flagTask?.taskId]);

  useEffect(() => {
    let cancelled = false;

    loadAnalysisSidecars(flagTask?.jobs, analysisByJobId, (jobId, sidecar) => {
      if (cancelled) {
        return;
      }
      setAnalysisByJobId((previous) => ({
        ...previous,
        [jobId]: sidecar,
      }));
    }).catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [analysisByJobId, flagTask?.jobs]);

  const moderationResults = useMemo(() => {
    const taskResults = (flagTask?.jobs ?? []).map((job) =>
      toModerationJobResult(job, analysisByJobId[job.jobId]),
    );
    const taskResultIds = new Set(taskResults.map((result) => result.jobId));
    const loadedResults = Object.values(manualResults)
      .map(toManualJobResult)
      .filter((result) => !taskResultIds.has(result.jobId));

    return [...taskResults, ...loadedResults];
  }, [analysisByJobId, flagTask?.jobs, manualResults]);

  const moderationOverview = useMemo(
    () => buildModerationOverview(moderationResults),
    [moderationResults],
  );

  const addSrtFiles = async () => {
    const response = await open({
      directory: false,
      filters: [{ extensions: ["srt"], name: "Subtitles" }],
      multiple: true,
    });
    const next = toPathList(response as string | string[] | null);
    setSelectedSrtPaths((previous) => dedupePaths([...previous, ...next]));
  };

  const addFolder = async () => {
    const response = await open({ directory: true, multiple: false });
    const folder = toPathList(response as string | string[] | null).at(0);
    if (!folder) {
      return;
    }

    setIsResolvingFolder(true);
    try {
      const srtFiles = await listSrtFiles(folder);
      const nextPaths = srtFiles.map((item) => item.path);
      setSelectedSrtPaths((previous) => dedupePaths([...previous, ...nextPaths]));
    } finally {
      setIsResolvingFolder(false);
    }
  };

  const loadExistingResults = async () => {
    if (selectedSrtPaths.length === 0) {
      return;
    }

    setIsLoadingExistingResults(true);
    setSettingsError(null);

    try {
      const loadedEntries = await Promise.all(
        selectedSrtPaths.map(async (sourcePath) => {
          const sidecarPath = toAnalysisPath(sourcePath);
          const content = await readTextFile(sidecarPath);
          return {
            sidecar: parseAnalysisSidecar(content),
            sidecarPath,
            sourcePath,
          } satisfies ManualAnalysisResult;
        }),
      );

      setManualResults((previous) => {
        const next = { ...previous };
        for (const entry of loadedEntries) {
          next[entry.sourcePath] = entry;
        }
        return next;
      });
    } catch (error: unknown) {
      setSettingsError(
        error instanceof Error
          ? error.message
          : "Failed loading existing analysis sidecars for the selected SRT files.",
      );
    } finally {
      setIsLoadingExistingResults(false);
    }
  };

  const startFlagging = async () => {
    if (selectedSrtPaths.length === 0) {
      return;
    }

    await controller.startFlaggingForPaths(selectedSrtPaths, {
      analysisStrategy,
      engine,
    });
  };

  return (
    <Card>
      <CardHeader className="grid grid-cols-[1fr_auto] gap-4">
        <div>
          <CardTitle className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-2xl bg-[#f5e6dc] text-[#88322d]">
              <ShieldAlert className="size-4" />
            </span>
            Profanity Detection
          </CardTitle>
          <p className="mt-2 text-[#8f5e56] text-sm">
            Analyze `.srt` files, save `.analysis.json`, and review flagged lines with timestamps.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <TaskDrawer
            triggerLabel="Moderation Rules"
            title="Moderation Rules"
            description="Edit the blacklist, aqeedah rules, and guidance used by the detector."
          >
            <ModerationSettingsPanel
              onLoad={controller.loadSettings}
              onSave={async (nextSettings) => {
                return controller.saveSettings(nextSettings);
              }}
            />
          </TaskDrawer>
          <TaskDrawer
            triggerLabel="Open Task"
            title="Latest Detection Task"
            description="Latest moderation run with file-level status and full worker logs."
          >
            <DetectionTaskDrawerContent flagTask={flagTask} />
          </TaskDrawer>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-4">
            <div className="flex flex-wrap gap-3">
              <Button type="button" variant="secondary" onClick={addSrtFiles}>
                <Plus className="size-4" />
                Add SRT Files
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={addFolder}
                disabled={isResolvingFolder}
              >
                {isResolvingFolder ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <FolderOpen className="size-4" />
                )}
                Add Folder
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={loadExistingResults}
                disabled={selectedSrtPaths.length === 0 || isLoadingExistingResults}
              >
                {isLoadingExistingResults ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <Settings2 className="size-4" />
                )}
                Load Existing Results
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setManualResults({});
                  setSelectedSrtPaths([]);
                }}
                disabled={selectedSrtPaths.length === 0 && Object.keys(manualResults).length === 0}
              >
                <Trash2 className="size-4" />
                Clear
              </Button>
              <Button
                type="button"
                onClick={startFlagging}
                disabled={selectedSrtPaths.length === 0 || taskActivity.isBusy}
              >
                {taskActivity.isBusy ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <Sparkles className="size-4" />
                )}
                {taskActivity.buttonLabel}
              </Button>
              <Button
                type="button"
                variant="danger"
                onClick={() => controller.cancelTaskById(flagTask?.taskId ?? null)}
                disabled={
                  !flagTask || flagTask.cancelRequested === true || taskActivity.isBusy === false
                }
              >
                Cancel Task
              </Button>
            </div>

            <SelectedFilesCard selectedSrtPaths={selectedSrtPaths} />
            <DetectionFeedbackCard
              cancelRequested={flagTask?.cancelRequested ?? false}
              latestLogLine={latestLogLine}
              taskStatus={flagTask?.status}
              totalFlagged={moderationOverview.totalFlagged}
              workerMessage={controller.state.workerMessage}
              workerStatus={controller.state.workerStatus}
            />
          </div>

          <div className="space-y-4">
            <EngineCard
              analysisStrategy={analysisStrategy}
              engine={engine}
              onEngineChange={setEngine}
              onStrategyChange={setAnalysisStrategy}
              settingsError={settingsError}
            />
            <OverviewCards
              filesWithFlags={moderationOverview.filesWithFlags}
              highCount={moderationOverview.counts.high}
              lowCount={moderationOverview.counts.low}
              mediumCount={moderationOverview.counts.medium}
              totalFlagged={moderationOverview.totalFlagged}
            />
          </div>
        </div>

        <ResultsSection moderationResults={moderationResults} />
      </CardContent>
    </Card>
  );
};

export { ProfanityPanel };
