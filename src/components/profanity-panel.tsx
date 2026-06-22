import type { DragDropEvent } from "@tauri-apps/api/window";
import { getCurrentWindow } from "@tauri-apps/api/window";
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
import { type RefObject, useEffect, useRef, useState } from "react";

import { LogOutput } from "@/components/log-output";
import { ModerationSettingsPanel } from "@/components/moderation-settings-panel";
import { TaskDrawer } from "@/components/task-drawer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatTime } from "@/features/editor/subtitles";
import {
  buildModerationResults,
  getLatestTask,
  getLatestTaskLogLine,
} from "@/features/media/selectors";
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
  isActive: boolean;
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

const toFileName = (path: string) => {
  const normalized = path.replace(/[\\/]+$/, "");
  return normalized.split(/[\\/]/).at(-1) ?? normalized;
};

const dedupePaths = (paths: string[]) => Array.from(new Set(paths));

const toAnalysisPath = (path: string) => path.replace(/\.srt$/i, ".analysis.json");
const isSupportedSrtPath = (path: string) => /\.srt$/i.test(path);

const isWithinDropTarget = (
  targetRef: RefObject<HTMLDivElement | null>,
  position: { x: number; y: number },
) => {
  const element = targetRef.current;
  if (!element) {
    return false;
  }

  const rect = element.getBoundingClientRect();
  return (
    position.x >= rect.left &&
    position.x <= rect.right &&
    position.y >= rect.top &&
    position.y <= rect.bottom
  );
};

const resolveDroppedSrtPaths = (
  event: { payload: DragDropEvent },
  dropTargetRef: RefObject<HTMLDivElement | null>,
) => {
  if (
    !("position" in event.payload) ||
    !isWithinDropTarget(dropTargetRef, event.payload.position)
  ) {
    return [];
  }

  if (!("paths" in event.payload)) {
    return [];
  }

  return event.payload.paths.filter((path: string) => isSupportedSrtPath(path));
};

const toTaskActivity = (
  taskStatus: MediaController["state"]["tasksById"][string]["status"] | undefined,
  workerStatus: MediaController["state"]["workerStatus"],
) => {
  const isTaskStarting = taskStatus === "queued" || workerStatus === "starting";
  const isTaskRunning = taskStatus === "running";

  return {
    buttonLabel: isTaskStarting ? "Starting..." : isTaskRunning ? "Detecting..." : "Detect",
    isBusy: isTaskStarting || isTaskRunning,
  };
};

const toWorkerStatusVariant = (workerStatus: MediaController["state"]["workerStatus"]) => {
  if (workerStatus === "error") {
    return "failed" as const;
  }

  if (workerStatus === "ready" || workerStatus === "stopped") {
    return "completed" as const;
  }

  return "running" as const;
};

const toTaskStatusVariant = (status: TaskState["status"]) => {
  if (status === "completed") {
    return "completed" as const;
  }

  if (status === "cancelled") {
    return "cancelled" as const;
  }

  return "running" as const;
};

const toCompletionMessage = (
  taskStatus: MediaController["state"]["tasksById"][string]["status"] | undefined,
  totalFlagged: number,
  cancelRequested: boolean,
) => {
  if (cancelRequested && taskStatus !== "cancelled" && taskStatus !== "completed") {
    return "Stopping after current file.";
  }

  if (cancelRequested && taskStatus === "completed") {
    return "Cancelled, but current file finished.";
  }

  if (taskStatus === "completed" && totalFlagged === 0) {
    return "Detection completed. No flags found.";
  }

  if (taskStatus === "completed") {
    return `Found ${totalFlagged} flag${totalFlagged === 1 ? "" : "s"}.`;
  }

  if (taskStatus === "cancelled") {
    return "Detection stopped.";
  }

  return "Analyze subtitles to detect inappropriate content.";
};

const loadAnalysisSidecars = async (
  jobs: NonNullable<MediaController["state"]["tasksById"][string]>["jobs"] | undefined,
  loadedJobIds: Set<string>,
  onSidecar: (jobId: string, sidecar: AnalysisSidecar) => void,
  onError: (message: string) => void,
) => {
  const jobsToLoad = (jobs ?? []).filter(
    (job) =>
      job.status === "completed" &&
      typeof job.outputPath === "string" &&
      job.outputPath.length > 0 &&
      !loadedJobIds.has(job.jobId),
  );

  const results = await Promise.allSettled(
    jobsToLoad.map(async (job) => {
      const content = await readTextFile(job.outputPath ?? "");
      return {
        jobId: job.jobId,
        sidecar: parseAnalysisSidecar(content),
      };
    }),
  );

  const loadedSidecars = results.filter(
    (result): result is PromiseFulfilledResult<{ jobId: string; sidecar: AnalysisSidecar }> =>
      result.status === "fulfilled",
  );
  const failedCount = results.length - loadedSidecars.length;

  for (const result of loadedSidecars) {
    onSidecar(result.value.jobId, result.value.sidecar);
  }

  if (failedCount > 0) {
    onError(
      `Loaded ${loadedSidecars.length} analysis sidecar(s). ${failedCount} sidecar read(s) failed.`,
    );
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
      <p className="rounded-[12px] border border-[#e7d2c5] border-dashed bg-[#fff8f3] px-2.5 py-2.5 text-[#8f5e56] text-xs">
        No detection task has run yet.
      </p>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between rounded-[12px] border border-[#ead3c4] bg-[#fffaf6] px-2 py-1.5">
        <div>
          <p className="text-[#8f5e56] text-xs">Task Status</p>
          <p className="mt-0.5 font-medium text-[#5b2722] text-xs">{flagTask.taskId}</p>
        </div>
        <Badge variant={toTaskStatusVariant(flagTask.status)}>{flagTask.status}</Badge>
      </div>
      {flagTask.cancelRequested ? (
        <div className="rounded-[10px] border border-amber-200 bg-amber-50 px-2 py-1.5 text-amber-900 text-xs">
          Cancellation was requested. The worker will stop after the current file finishes.
        </div>
      ) : null}
      {flagTask.jobs.map((job) => (
        <div key={job.jobId} className="rounded-[12px] border border-[#ead3c4] bg-[#fffaf7] p-1.5">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate font-medium text-[#5f2823] text-xs">{job.fileName}</p>
            <Badge variant={job.status === "completed" ? "completed" : job.status}>
              {job.status}
            </Badge>
          </div>
          {job.outputPath ? (
            <p className="mt-1 text-[#8f5e56] text-xs">{toFileName(job.outputPath)}</p>
          ) : null}
          <LogOutput logs={job.logs} />
          {job.error ? <p className="mt-1 text-rose-700 text-xs">{job.error}</p> : null}
        </div>
      ))}
    </div>
  );
};

type SelectedFilesCardProps = {
  selectedSrtPaths: string[];
};

const SelectedFilesCard = ({ selectedSrtPaths }: SelectedFilesCardProps) => (
  <div className="rounded-[14px] border border-[#ead3c4] bg-[#fffaf6] px-2.5 py-2">
    <div className="flex items-center justify-between gap-2">
      <p className="text-[#8f5e56] text-xs">Selected subtitle files</p>
      <span className="font-medium text-[#5b2722] text-xs">{selectedSrtPaths.length}</span>
    </div>
    <div className="mt-1.5 max-h-40 space-y-1 overflow-auto pr-1">
      {selectedSrtPaths.length === 0 ? (
        <p className="text-[#8f5e56] text-xs">No files selected.</p>
      ) : (
        selectedSrtPaths.map((path) => (
          <div
            key={path}
            className="rounded-[12px] border border-[#ead3c4] bg-white px-2 py-1 text-[#5f2823] text-xs"
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
  <div className="rounded-[14px] border border-[#ead3c4] bg-[#fffaf6] px-2.5 py-2">
    <div className="flex items-center justify-between gap-2">
      <p className="text-[#8f5e56] text-xs">Detection Feedback</p>
      <Badge variant={toWorkerStatusVariant(workerStatus)}>{workerStatus}</Badge>
    </div>
    <p className="mt-1 text-[#7f524a] text-xs">{workerMessage}</p>
    <p className="mt-1 font-medium text-[#5b2722] text-xs">
      {toCompletionMessage(taskStatus, totalFlagged, cancelRequested)}
    </p>
    {latestLogLine ? (
      <div className="mt-1.5 rounded-[12px] bg-[#fdf1e8] px-2 py-1">
        <p className="font-mono text-[#7f524a] text-[9px]">{latestLogLine}</p>
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
  <div className="rounded-[14px] border border-[#ead3c4] bg-[#fffaf6] px-2.5 py-2">
    <div className="flex items-center justify-between gap-2">
      <div>
        <p className="text-[#8f5e56] text-xs">Analysis Mode</p>
        <p className="mt-0.5 font-medium text-[#5b2722] text-xs">
          {moderationEngineLabel(engine)} · {analysisStrategy}
        </p>
      </div>
      <Brain className="size-3.5 text-[#8f5e56]" />
    </div>
    <div className="mt-1.5 grid gap-1.5">
      <label className="space-y-1">
        <span className="text-[#8f5e56] text-xs">Detection engine</span>
        <select
          value={engine}
          onChange={(event) => onEngineChange(event.currentTarget.value as ModerationEngine)}
          className="h-9 w-full rounded-[14px] border border-[#d9b7a5] bg-white px-3 text-[#4f1f1a] text-xs outline-none transition focus:border-[#88322d] focus:ring-[#c57267]/25 focus:ring-[2px]"
        >
          {moderationEngineOptions.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label className="space-y-1">
        <span className="text-[#8f5e56] text-xs">Reasoning depth</span>
        <select
          value={analysisStrategy}
          onChange={(event) => onStrategyChange(event.currentTarget.value as AnalysisStrategy)}
          className="h-9 w-full rounded-[14px] border border-[#d9b7a5] bg-white px-3 text-[#4f1f1a] text-xs outline-none transition focus:border-[#88322d] focus:ring-[#c57267]/25 focus:ring-[2px]"
        >
          <option value="fast">Fast</option>
          <option value="deep">Deep</option>
        </select>
      </label>
      <p className="text-[#8f5e56] text-xs">
        {moderationEngineOptions.find((option) => option.value === engine)?.description}
      </p>
      <p className="text-[#8f5e56] text-xs">
        Fast: lighter model. Deep: stronger contextual review.
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
  <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-1">
    <div className="rounded-[14px] border border-[#ead3c4] bg-[#fffaf6] px-2.5 py-2">
      <p className="text-[#8f5e56] text-xs">Flagged Lines</p>
      <p className="mt-1 font-semibold text-[#5b2722] text-xl">{totalFlagged}</p>
    </div>
    <div className="rounded-[14px] border border-[#ead3c4] bg-[#fffaf6] px-2.5 py-2">
      <p className="text-[#8f5e56] text-xs">Files With Flags</p>
      <p className="mt-1 font-semibold text-[#5b2722] text-xl">{filesWithFlags}</p>
    </div>
    <div className="rounded-[14px] border border-[#ead3c4] bg-[#fffaf6] px-2.5 py-2">
      <p className="text-[#8f5e56] text-xs">Priority Mix</p>
      <div className="mt-1 flex flex-wrap gap-1">
        <Badge variant="failed">high {highCount}</Badge>
        <Badge variant="running">medium {mediumCount}</Badge>
        <Badge variant="queued">low {lowCount}</Badge>
      </div>
    </div>
  </div>
);

const formatSegmentTimeLabel = (segment: ModerationJobResult["segments"][number]) => {
  if (typeof segment.endTime === "number" && Number.isFinite(segment.endTime)) {
    return `${formatTime(segment.startTime, segment.endTime)} - ${formatTime(
      segment.endTime,
      segment.endTime,
    )}`;
  }

  return formatTime(segment.startTime);
};

type ResultSegmentRowProps = {
  jobId: string;
  segment: ModerationJobResult["segments"][number];
};

const ResultSegmentRow = ({ jobId, segment }: ResultSegmentRowProps) => (
  <div
    className="rounded-[12px] border border-[#ead3c4] bg-white px-2 py-1.5"
    key={`${jobId}-${segment.startTime}-${segment.ruleId}`}
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
      <span className="font-mono text-[#7f524a] text-xs">{formatSegmentTimeLabel(segment)}</span>
      <span className="text-[#8f5e56] text-xs">{segment.category}</span>
    </div>
    <p className="mt-1 font-medium text-[#5b2722] text-xs">{segment.reason}</p>
    <p className="mt-0.5 text-[#7f524a] text-xs">{segment.text}</p>
  </div>
);

type ResultsSectionProps = {
  moderationResults: ModerationJobResult[];
};

const ResultsSection = ({ moderationResults }: ResultsSectionProps) => (
  <div className="space-y-2">
    <div className="flex items-center justify-between gap-2">
      <p className="font-medium text-[#5b2722] text-xs">Latest Results</p>
      <span className="text-[#8f5e56] text-xs">
        {moderationResults.length === 0
          ? "No completed analysis yet."
          : `${moderationResults.length} file result${moderationResults.length === 1 ? "" : "s"}`}
      </span>
    </div>
    {moderationResults.length === 0 ? (
      <div className="rounded-[14px] border border-[#e7d2c5] border-dashed bg-[#fff8f3] px-3 py-3 text-[#8f5e56] text-xs">
        Run detection or load existing `.analysis.json` sidecars to review flagged subtitle lines
        here.
      </div>
    ) : (
      moderationResults.map((result) => (
        <div
          key={result.jobId}
          className="rounded-[16px] border border-[#ead3c4] bg-[#fffaf7] px-3 py-2"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate font-medium text-[#5f2823] text-xs">{result.fileName}</p>
              <p className="mt-0.5 text-[#8f5e56] text-xs">{result.summary}</p>
            </div>
            <div className="flex items-center gap-1">
              <Badge variant={result.status === "completed" ? "completed" : result.status}>
                {result.status}
              </Badge>
              <Badge variant={result.flaggedCount > 0 ? "running" : "completed"}>
                {result.flaggedCount} flagged
              </Badge>
            </div>
          </div>
          {result.segments.length === 0 ? (
            <p className="mt-2 text-[#7f524a] text-xs">
              {result.status === "completed"
                ? "No concerning lines were detected for this file."
                : "Detailed analysis output will appear here after completion."}
            </p>
          ) : (
            <div className="mt-2 space-y-1.5">
              {result.segments.map((segment) => (
                <ResultSegmentRow
                  key={`${result.jobId}-${segment.startTime}-${segment.ruleId}`}
                  jobId={result.jobId}
                  segment={segment}
                />
              ))}
            </div>
          )}
        </div>
      ))
    )}
  </div>
);

const ProfanityPanel = ({ controller, isActive }: ProfanityPanelProps) => {
  const [selectedSrtPaths, setSelectedSrtPaths] = useState<string[]>([]);
  const [isResolvingFolder, setIsResolvingFolder] = useState(false);
  const [isDropTargetActive, setIsDropTargetActive] = useState(false);
  const [isLoadingExistingResults, setIsLoadingExistingResults] = useState(false);
  const [analysisByJobId, setAnalysisByJobId] = useState<Record<string, AnalysisSidecar>>({});
  const [manualResults, setManualResults] = useState<Record<string, ManualAnalysisResult>>({});
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [engine, setEngine] = useState<ModerationEngine>("blacklist");
  const [analysisStrategy, setAnalysisStrategy] = useState<AnalysisStrategy>("fast");
  const previousTaskIdRef = useRef<string | null>(null);
  const loadedJobIdsRef = useRef<Set<string>>(new Set());
  const loadSettingsRef = useRef(controller.loadSettings);
  const dropTargetRef = useRef<HTMLDivElement>(null);
  loadSettingsRef.current = controller.loadSettings;

  const flagTask = getLatestTask(controller.state.tasksById, "flag");
  const taskActivity = toTaskActivity(flagTask?.status, controller.state.workerStatus);
  const latestLogLine = getLatestTaskLogLine(flagTask);

  useEffect(() => {
    if (!isActive) {
      setIsDropTargetActive(false);
      return;
    }

    let mounted = true;

    const handleDragDropEvent = async (event: { payload: DragDropEvent }) => {
      if (!mounted) {
        return;
      }

      switch (event.payload.type) {
        case "leave":
          setIsDropTargetActive(false);
          return;
        case "over":
        case "enter":
          setIsDropTargetActive(isWithinDropTarget(dropTargetRef, event.payload.position));
          return;
        default: {
          setIsDropTargetActive(false);
          const droppedPaths = resolveDroppedSrtPaths(event, dropTargetRef);
          if (droppedPaths.length === 0) {
            return;
          }

          setSelectedSrtPaths((previous) => dedupePaths([...previous, ...droppedPaths]));
        }
      }
    };

    let cleanup: (() => void) | undefined;
    const setup = async () => {
      const unlisten = await getCurrentWindow().onDragDropEvent((event) => {
        void handleDragDropEvent(event);
      });
      return unlisten;
    };

    setup()
      .then((unlisten) => {
        cleanup = unlisten;
      })
      .catch(() => {
        setIsDropTargetActive(false);
      });

    return () => {
      mounted = false;
      cleanup?.();
    };
  }, [isActive]);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      try {
        const loaded = await loadSettingsRef.current();
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
  }, []);

  useEffect(() => {
    const nextTaskId = flagTask?.taskId ?? null;
    if (previousTaskIdRef.current === nextTaskId) {
      return;
    }

    previousTaskIdRef.current = nextTaskId;
    setAnalysisByJobId({});
    loadedJobIdsRef.current = new Set();
  }, [flagTask?.taskId]);

  useEffect(() => {
    let cancelled = false;

    loadAnalysisSidecars(
      flagTask?.jobs,
      loadedJobIdsRef.current,
      (jobId, sidecar) => {
        if (cancelled) {
          return;
        }
        loadedJobIdsRef.current.add(jobId);
        setAnalysisByJobId((previous) => ({
          ...previous,
          [jobId]: sidecar,
        }));
      },
      (message) => {
        if (!cancelled) {
          setSettingsError(message);
        }
      },
    ).catch((error: unknown) => {
      if (!cancelled) {
        setSettingsError(
          error instanceof Error ? error.message : "Failed loading analysis sidecars.",
        );
      }
    });

    return () => {
      cancelled = true;
    };
  }, [flagTask?.jobs]);

  const moderationResults = buildModerationResults(
    flagTask,
    analysisByJobId,
    manualResults,
    toModerationJobResult,
    toManualJobResult,
  );
  const moderationOverview = buildModerationOverview(moderationResults);

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
      const results = await Promise.allSettled(
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
      const loadedEntries = results
        .filter(
          (result): result is PromiseFulfilledResult<ManualAnalysisResult> =>
            result.status === "fulfilled",
        )
        .map((result) => result.value);
      const failedCount = results.filter((result) => result.status === "rejected").length;

      setManualResults((previous) => {
        const next = { ...previous };
        for (const entry of loadedEntries) {
          next[entry.sourcePath] = entry;
        }
        return next;
      });

      if (failedCount > 0) {
        setSettingsError(
          `Loaded ${loadedEntries.length} file(s). ${failedCount} file(s) could not be loaded.`,
        );
      }
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
      <CardHeader className="grid grid-cols-[1fr_auto] gap-2">
        <div>
          <CardTitle className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-lg bg-[#f5e6dc] text-[#88322d]">
              <ShieldAlert className="size-3" />
            </span>
            Profanity Detection
          </CardTitle>
          <p className="mt-0.5 text-[#8f5e56] text-xs">
            Analyze subtitles for inappropriate content.
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <TaskDrawer
            triggerLabel="Moderation Rules"
            title="Moderation Rules"
            description="Edit detection rules and blacklist."
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
            description="Status and logs for the latest run."
          >
            <DetectionTaskDrawerContent flagTask={flagTask} />
          </TaskDrawer>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        <div
          ref={dropTargetRef}
          className={`rounded-[16px] transition ${
            isDropTargetActive
              ? "bg-[#fff1e8] shadow-[0_0_0_2px_rgba(197,114,103,0.15)]"
              : "bg-transparent"
          }`}
        >
          <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_280px]">
            <div className="space-y-2">
              <div className="flex flex-wrap gap-1.5">
                <Button type="button" size="sm" variant="secondary" onClick={addSrtFiles}>
                  <Plus className="size-3" />
                  Add SRT Files
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={addFolder}
                  disabled={isResolvingFolder}
                >
                  {isResolvingFolder ? (
                    <LoaderCircle className="size-3 animate-spin" />
                  ) : (
                    <FolderOpen className="size-3" />
                  )}
                  Add Folder
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={loadExistingResults}
                  disabled={selectedSrtPaths.length === 0 || isLoadingExistingResults}
                >
                  {isLoadingExistingResults ? (
                    <LoaderCircle className="size-3 animate-spin" />
                  ) : (
                    <Settings2 className="size-3" />
                  )}
                  Load Results
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setManualResults({});
                    setSelectedSrtPaths([]);
                  }}
                  disabled={
                    selectedSrtPaths.length === 0 && Object.keys(manualResults).length === 0
                  }
                >
                  <Trash2 className="size-3" />
                  Clear
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={startFlagging}
                  disabled={selectedSrtPaths.length === 0 || taskActivity.isBusy}
                >
                  {taskActivity.isBusy ? (
                    <LoaderCircle className="size-3 animate-spin" />
                  ) : (
                    <Sparkles className="size-3" />
                  )}
                  {taskActivity.buttonLabel}
                </Button>
                <Button
                  type="button"
                  size="sm"
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

            <div className="space-y-2">
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
        </div>

        <ResultsSection moderationResults={moderationResults} />
      </CardContent>
    </Card>
  );
};

export { ProfanityPanel };
