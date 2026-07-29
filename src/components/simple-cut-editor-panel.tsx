import type { DragDropEvent } from "@tauri-apps/api/window";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Captions,
  Film,
  LoaderCircle,
  Pause,
  Play,
  RotateCcw,
  Scissors,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { LogOutput } from "@/components/log-output";
import { TaskDrawer } from "@/components/task-drawer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DrawerClose } from "@/components/ui/drawer";
import { trashFile } from "@/features/batch/transport";
import { parseSavedCutRanges } from "@/features/editor/ranges";
import { findSubtitleAtTime, formatTime, parseSrt } from "@/features/editor/subtitles";
import { canResetVideoToOriginal } from "@/features/editor/video-reset";
import {
  buildVideoDeleteTargets,
  isMissingDeleteTargetError,
  toAnalysisSidecarPath,
  toCutRangesSidecarPath,
  toFrameAnalysisSidecarPath,
  toSrtSidecarPath,
} from "@/features/editor/video-sidecars";
import { appendBoundedLogLine } from "@/features/media/logs";
import { getLatestTask, getTaskOutputPath } from "@/features/media/selectors";
import {
  getMediaPreviewUrl,
  readTextFile,
  saveCutRanges,
  scanVideoFrames,
  subscribeToFrameScanEvents,
} from "@/features/media/transport";
import type {
  AnalysisSidecar,
  CompressionPreset,
  CutRange,
  FrameScanEvent,
  SubtitleEntry,
  TaskState,
} from "@/features/media/types";
import type { useMediaController } from "@/features/media/useMediaController";
import { parseAnalysisSidecar } from "@/features/moderation/results";
import { convertFileSrc } from "@/lib/tauri";

type MediaController = ReturnType<typeof useMediaController>;

type SimpleCutEditorPanelProps = {
  controller: MediaController;
  isActive: boolean;
};

type LocalRange = {
  id: string;
  start: number;
  end: number;
};

const toPathList = (value: string | string[] | null): string[] => {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
};

const normalizeDialogPath = (path: string) => {
  if (!path.startsWith("file://")) {
    return path;
  }

  try {
    return decodeURIComponent(new URL(path).pathname);
  } catch {
    return path;
  }
};

const isSupportedCutVideoPath = (path: string) => /\.(mp4|mov)$/i.test(path);

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

const toTimeToken = (value: number) => value.toFixed(3);

const toCutRanges = (ranges: LocalRange[]): CutRange[] => {
  return ranges.map((range) => ({
    end: toTimeToken(range.end),
    start: toTimeToken(range.start),
  }));
};

const toLocalRanges = (ranges: CutRange[]): LocalRange[] =>
  ranges.map((range, index) => ({
    end: Number(range.end),
    id: `${range.start}-${range.end}-${index}`,
    start: Number(range.start),
  }));

const deleteVideoFiles = async (videoPath: string): Promise<void> => {
  const deleteTargets = buildVideoDeleteTargets(videoPath);
  const results = await Promise.allSettled(
    deleteTargets.map(async (path) => {
      try {
        await trashFile(path);
      } catch (error) {
        if (isMissingDeleteTargetError(error)) {
          return;
        }
        throw error;
      }
    }),
  );
  const failedCount = results.filter((result) => result.status === "rejected").length;

  if (failedCount > 0) {
    throw new Error(
      `Deleted ${deleteTargets.length - failedCount} of ${deleteTargets.length} files.`,
    );
  }
};

const resetLoadedSidecars = (
  setAnalysisSidecar: (value: AnalysisSidecar | null) => void,
  setFrameAnalysisSidecar: (value: AnalysisSidecar | null) => void,
  setHasSubtitleSidecar: (value: boolean) => void,
  setSubtitles: (value: SubtitleEntry[]) => void,
) => {
  setSubtitles([]);
  setHasSubtitleSidecar(false);
  setAnalysisSidecar(null);
  setFrameAnalysisSidecar(null);
};

const applyLoadedSidecars = (
  analysisResult: PromiseSettledResult<string>,
  frameAnalysisResult: PromiseSettledResult<string>,
  subtitleResult: PromiseSettledResult<string>,
  setAnalysisSidecar: (value: AnalysisSidecar | null) => void,
  setFrameAnalysisSidecar: (value: AnalysisSidecar | null) => void,
  setHasSubtitleSidecar: (value: boolean) => void,
  setSubtitles: (value: SubtitleEntry[]) => void,
) => {
  if (subtitleResult.status === "fulfilled") {
    try {
      setSubtitles(parseSrt(subtitleResult.value));
      setHasSubtitleSidecar(true);
    } catch {
      setSubtitles([]);
      setHasSubtitleSidecar(false);
    }
  } else {
    setSubtitles([]);
    setHasSubtitleSidecar(false);
  }

  if (analysisResult.status === "fulfilled") {
    try {
      setAnalysisSidecar(parseAnalysisSidecar(analysisResult.value));
    } catch {
      setAnalysisSidecar(null);
    }
  } else {
    setAnalysisSidecar(null);
  }

  if (frameAnalysisResult.status === "fulfilled") {
    try {
      setFrameAnalysisSidecar(parseAnalysisSidecar(frameAnalysisResult.value));
    } catch {
      setFrameAnalysisSidecar(null);
    }
  } else {
    setFrameAnalysisSidecar(null);
  }
};

const clampSeekTime = (time: number, duration: number) => {
  const upperBound =
    Number.isFinite(duration) && duration > 0 ? duration : Number.POSITIVE_INFINITY;
  return Math.max(0, Math.min(time, upperBound));
};

type DeleteVideoConfirmationCardProps = {
  isDeletingVideo: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

const DeleteVideoConfirmationCard = ({
  isDeletingVideo,
  onCancel,
  onConfirm,
}: DeleteVideoConfirmationCardProps) => (
  <div className="rounded-[20px] border border-rose-300 bg-rose-50 px-4 py-3 text-rose-900 text-sm">
    <p className="font-medium">Delete the current video and its sidecars?</p>
    <p className="mt-1 text-rose-800 text-xs">
      This moves the selected video to trash, plus the matching `.srt`, `.analysis.json`,
      `.frames.analysis.json`, and `.ranges.json` files when present.
    </p>
    <div className="mt-3 flex flex-wrap gap-2">
      <Button type="button" variant="danger" size="sm" onClick={onConfirm}>
        {isDeletingVideo ? "Deleting..." : "Confirm Delete"}
      </Button>
      <Button type="button" variant="outline" size="sm" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  </div>
);

type CutVideoStatusMessagesProps = {
  deleteError: string | null;
  isCutTaskActive: boolean;
  isShowingExportOutput: boolean;
  playbackError: string | null;
};

const CutVideoStatusMessages = ({
  deleteError,
  isCutTaskActive,
  isShowingExportOutput,
  playbackError,
}: CutVideoStatusMessagesProps) => (
  <>
    {playbackError ? (
      <div className="rounded-[20px] border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900 text-sm">
        {playbackError}
      </div>
    ) : null}

    {deleteError ? (
      <div className="rounded-[20px] border border-rose-300 bg-rose-50 px-4 py-3 text-rose-900 text-sm">
        {deleteError}
      </div>
    ) : null}

    {isCutTaskActive ? (
      <div className="rounded-[20px] border border-[#ead3c4] bg-[#fffaf6] px-4 py-3 text-[#5b2722] text-sm">
        Export in progress. The preview will switch to the exported video once the worker finishes.
      </div>
    ) : null}

    {isShowingExportOutput && !isCutTaskActive ? (
      <div className="rounded-[20px] border border-emerald-200 bg-emerald-50 px-4 py-3 text-emerald-800 text-sm">
        Previewing the exported video output in the main pane.
      </div>
    ) : null}
  </>
);

type FlaggedSectionsDrawerContentProps = {
  analysisSidecar: AnalysisSidecar | null;
  canAnalyze: boolean;
  filter: FlaggedSectionsFilter;
  flagTask: TaskState | undefined;
  onFilterChange: (value: FlaggedSectionsFilter) => void;
  onStartAnalysis: () => void;
  onSeek: (time: number) => void;
};

type FlaggedFramesDrawerContentProps = {
  frameAnalysisError: string | null;
  frameAnalysisLogs: string[];
  frameAnalysisStatusMessage: string | null;
  frameAnalysisSidecar: AnalysisSidecar | null;
  canAnalyze: boolean;
  filter: FlaggedSectionsFilter;
  isAnalyzingFrames: boolean;
  onFilterChange: (value: FlaggedSectionsFilter) => void;
  onStartAnalysis: () => void;
  onSeek: (time: number) => void;
};

type SubtitlesDrawerContentProps = {
  canTranscribe: boolean;
  onSeek: (time: number) => void;
  onStartTranscription: () => void;
  subtitles: SubtitleEntry[];
  transcriptionTask: TaskState | undefined;
};

type FlaggedSectionsFilter = "all" | "high" | "medium" | "low";

type FlaggedPriorityCounts = {
  high: number;
  medium: number;
  low: number;
};

const flaggedSectionsFilterOptions: Array<{
  label: string;
  value: FlaggedSectionsFilter;
}> = [
  { label: "All", value: "all" },
  { label: "Medium", value: "medium" },
  { label: "Low", value: "low" },
  { label: "High", value: "high" },
];

const filterFlaggedSegments = (
  segments: AnalysisSidecar["flagged"],
  filter: FlaggedSectionsFilter,
) => (filter === "all" ? segments : segments.filter((segment) => segment.priority === filter));

const buildFlaggedPriorityCounts = (segments: AnalysisSidecar["flagged"]): FlaggedPriorityCounts =>
  segments.reduce<FlaggedPriorityCounts>(
    (counts, segment) => {
      counts[segment.priority] += 1;
      return counts;
    },
    { high: 0, low: 0, medium: 0 },
  );

const formatFlaggedSegmentTimeLabel = (segment: AnalysisSidecar["flagged"][number]) => {
  if (typeof segment.endTime === "number" && Number.isFinite(segment.endTime)) {
    return `${formatTime(segment.startTime, segment.endTime)} - ${formatTime(
      segment.endTime,
      segment.endTime,
    )}`;
  }

  return formatTime(segment.startTime);
};

const getObjectMessage = (error: object) =>
  "message" in error && typeof error.message === "string" ? error.message : null;

const serializeUnknownError = (error: object) => {
  try {
    const serialized = JSON.stringify(error);
    return serialized && serialized !== "{}" ? serialized : null;
  } catch {
    return null;
  }
};

const toUnknownErrorMessage = (error: unknown, fallback: string) => {
  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }

  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  if (error && typeof error === "object") {
    const candidateMessage = getObjectMessage(error);
    if (candidateMessage && candidateMessage.trim().length > 0) {
      return candidateMessage;
    }

    return serializeUnknownError(error) ?? fallback;
  }

  return fallback;
};

const appendLocalLog = (logs: string[], message: string) =>
  appendBoundedLogLine(logs, `[${new Date().toLocaleTimeString()}] ${message}`);

const formatFrameScanStatusMessage = (event: FrameScanEvent) =>
  typeof event.current === "number" && typeof event.total === "number"
    ? `${event.message} (${event.current}/${event.total})`
    : event.message;

const resolveActiveFrameScanPath = (
  activeFrameScanVideoPath: string | null,
  videoPath: string | null,
) => activeFrameScanVideoPath ?? videoPath;

const shouldHandleFrameScanEvent = (
  event: FrameScanEvent,
  activeFrameScanVideoPath: string | null,
  videoPath: string | null,
) => {
  const expectedVideoPath = resolveActiveFrameScanPath(activeFrameScanVideoPath, videoPath);
  return Boolean(expectedVideoPath && event.videoPath === expectedVideoPath);
};

const loadSidecarContent = (videoPath: string) =>
  Promise.allSettled([
    readTextFile(toSrtSidecarPath(videoPath)),
    readTextFile(toAnalysisSidecarPath(videoPath)),
    readTextFile(toFrameAnalysisSidecarPath(videoPath)),
  ]);

const resolveDroppedVideoPath = (
  event: { payload: DragDropEvent },
  dropTargetRef: RefObject<HTMLDivElement | null>,
) => {
  if (!("position" in event.payload)) {
    return null;
  }

  if (!isWithinDropTarget(dropTargetRef, event.payload.position)) {
    return null;
  }

  if (!("paths" in event.payload)) {
    return null;
  }

  return (
    event.payload.paths
      .map((path: string) => normalizeDialogPath(path))
      .find((path: string) => isSupportedCutVideoPath(path)) ?? null
  );
};

const FrameScanStatusBanners = ({
  frameAnalysisError,
  frameAnalysisStatusMessage,
  isAnalyzingFrames,
}: Pick<
  FlaggedFramesDrawerContentProps,
  "frameAnalysisError" | "frameAnalysisStatusMessage" | "isAnalyzingFrames"
>) => (
  <>
    {frameAnalysisError ? (
      <p className="rounded-[12px] border border-rose-200 bg-rose-50 px-2.5 py-2 text-rose-900 text-xs">
        {frameAnalysisError}
      </p>
    ) : null}
    {isAnalyzingFrames && frameAnalysisStatusMessage ? (
      <p className="rounded-[12px] border border-[#ead3c4] bg-[#fffaf6] px-2.5 py-2 text-[#5b2722] text-xs">
        {frameAnalysisStatusMessage}
      </p>
    ) : null}
  </>
);

const FrameScanActionButton = ({
  canAnalyze,
  idleLabel,
  isAnalyzingFrames,
  onStartAnalysis,
}: {
  canAnalyze: boolean;
  idleLabel: string;
  isAnalyzingFrames: boolean;
  onStartAnalysis: () => void;
}) => (
  <Button
    type="button"
    size="sm"
    onClick={onStartAnalysis}
    disabled={!canAnalyze || isAnalyzingFrames}
  >
    {isAnalyzingFrames ? (
      <LoaderCircle className="size-3 animate-spin" />
    ) : (
      <ShieldAlert className="size-3" />
    )}
    {isAnalyzingFrames ? "Scanning Frames..." : idleLabel}
  </Button>
);

const useVideoSidecarLoading = (
  sidecarRefreshKey: number,
  videoPath: string | null,
  setAnalysisSidecar: (value: AnalysisSidecar | null) => void,
  setFrameAnalysisSidecar: (value: AnalysisSidecar | null) => void,
  setHasSubtitleSidecar: (value: boolean) => void,
  setSubtitles: (value: SubtitleEntry[]) => void,
) => {
  useEffect(() => {
    let cancelled = false;

    if (sidecarRefreshKey < 0) {
      return () => {
        cancelled = true;
      };
    }

    if (!videoPath) {
      resetLoadedSidecars(
        setAnalysisSidecar,
        setFrameAnalysisSidecar,
        setHasSubtitleSidecar,
        setSubtitles,
      );
      return () => {
        cancelled = true;
      };
    }

    const load = async () => {
      const [subtitleContent, analysisContent, frameAnalysisContent] =
        await loadSidecarContent(videoPath);

      if (cancelled) {
        return;
      }

      applyLoadedSidecars(
        analysisContent,
        frameAnalysisContent,
        subtitleContent,
        setAnalysisSidecar,
        setFrameAnalysisSidecar,
        setHasSubtitleSidecar,
        setSubtitles,
      );
    };

    load().catch(() => {
      if (cancelled) {
        return;
      }

      resetLoadedSidecars(
        setAnalysisSidecar,
        setFrameAnalysisSidecar,
        setHasSubtitleSidecar,
        setSubtitles,
      );
    });

    return () => {
      cancelled = true;
    };
  }, [
    sidecarRefreshKey,
    videoPath,
    setAnalysisSidecar,
    setFrameAnalysisSidecar,
    setHasSubtitleSidecar,
    setSubtitles,
  ]);
};

const useCutRangesSidecarLoading = (
  videoPath: string | null,
  setRanges: Dispatch<SetStateAction<LocalRange[]>>,
) => {
  useEffect(() => {
    let cancelled = false;

    if (!videoPath) {
      setRanges([]);
      return () => {
        cancelled = true;
      };
    }

    readTextFile(toCutRangesSidecarPath(videoPath))
      .then((content) => {
        if (!cancelled) {
          setRanges(toLocalRanges(parseSavedCutRanges(content)));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRanges([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [videoPath, setRanges]);
};

const useFrameScanEventSubscription = (
  activeFrameScanVideoPath: string | null,
  isActive: boolean,
  videoPath: string | null,
  setFrameAnalysisError: (value: string | null) => void,
  setFrameAnalysisLogs: Dispatch<SetStateAction<string[]>>,
  setFrameAnalysisStatusMessage: (value: string | null) => void,
  setIsAnalyzingFrames: (value: boolean) => void,
  setSidecarRefreshKey: Dispatch<SetStateAction<number>>,
) => {
  useEffect(() => {
    if (!isActive) {
      return;
    }

    let mounted = true;
    let unlisten: (() => void) | null = null;

    const handleFrameScanEvent = (event: FrameScanEvent) => {
      if (!mounted || !shouldHandleFrameScanEvent(event, activeFrameScanVideoPath, videoPath)) {
        return;
      }

      const message = formatFrameScanStatusMessage(event);
      setFrameAnalysisStatusMessage(message);
      setFrameAnalysisLogs((previous) => appendLocalLog(previous, message));

      if (event.stage === "completed") {
        setIsAnalyzingFrames(false);
        setSidecarRefreshKey((previous) => previous + 1);
        return;
      }

      if (event.stage === "failed") {
        setFrameAnalysisError(event.message);
        setIsAnalyzingFrames(false);
      }
    };

    const setup = async () => {
      unlisten = await subscribeToFrameScanEvents(handleFrameScanEvent);
    };

    setup().catch(() => undefined);

    return () => {
      mounted = false;
      unlisten?.();
    };
  }, [
    activeFrameScanVideoPath,
    isActive,
    setFrameAnalysisError,
    setFrameAnalysisLogs,
    setFrameAnalysisStatusMessage,
    setIsAnalyzingFrames,
    setSidecarRefreshKey,
    videoPath,
  ]);
};

const useSelectedVideoSync = (
  applySelectedVideoPath: (selected: string | null, shouldSyncController?: boolean) => void,
  isActive: boolean,
  requestedVideoPath: string | null,
  videoPath: string | null,
  setIsDropTargetActive: (value: boolean) => void,
) => {
  useEffect(() => {
    if (!isActive) {
      setIsDropTargetActive(false);
      return;
    }

    if (!requestedVideoPath || requestedVideoPath === videoPath) {
      return;
    }

    applySelectedVideoPath(requestedVideoPath, false);
  }, [applySelectedVideoPath, isActive, requestedVideoPath, setIsDropTargetActive, videoPath]);
};

const useVideoDropTarget = (
  applySelectedVideoPath: (selected: string | null, shouldSyncController?: boolean) => void,
  dropTargetRef: RefObject<HTMLDivElement | null>,
  isActive: boolean,
  setIsDropTargetActive: (value: boolean) => void,
) => {
  useEffect(() => {
    if (!isActive) {
      setIsDropTargetActive(false);
      return;
    }

    let mounted = true;
    let cleanup: (() => void) | undefined;

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
          const droppedPath = resolveDroppedVideoPath(event, dropTargetRef);
          if (!droppedPath) {
            return;
          }

          applySelectedVideoPath(droppedPath);
        }
      }
    };

    const setup = async () => {
      cleanup = await getCurrentWindow().onDragDropEvent((event) => {
        void handleDragDropEvent(event);
      });
    };

    setup().catch(() => {
      setIsDropTargetActive(false);
    });

    return () => {
      mounted = false;
      cleanup?.();
    };
  }, [applySelectedVideoPath, dropTargetRef, isActive, setIsDropTargetActive]);
};

const FlaggedSectionsDrawerContent = ({
  analysisSidecar,
  canAnalyze,
  filter,
  flagTask,
  onFilterChange,
  onStartAnalysis,
  onSeek,
}: FlaggedSectionsDrawerContentProps) => {
  const isFlagTaskActive = flagTask?.status === "queued" || flagTask?.status === "running";

  if (!analysisSidecar) {
    return (
      <div className="space-y-1.5">
        <p className="rounded-[12px] border border-[#e7d2c5] border-dashed bg-[#fff8f3] px-2.5 py-2.5 text-[#8f5e56] text-xs">
          Analysis has not been run for this video.
        </p>
        <Button
          type="button"
          size="sm"
          onClick={onStartAnalysis}
          disabled={!canAnalyze || isFlagTaskActive}
        >
          {isFlagTaskActive ? (
            <LoaderCircle className="size-3 animate-spin" />
          ) : (
            <ShieldAlert className="size-3" />
          )}
          {isFlagTaskActive ? "Analyzing..." : "Run Analysis"}
        </Button>
      </div>
    );
  }

  const flaggedCounts = buildFlaggedPriorityCounts(analysisSidecar.flagged);
  const filteredSegments = filterFlaggedSegments(analysisSidecar.flagged, filter);

  return (
    <div className="space-y-1.5">
      <div className="rounded-[14px] border border-[#ead3c4] bg-[#fffaf6] px-2.5 py-2">
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-0.5">
            <p className="text-[#8f5e56] text-xs">Summary</p>
            <p className="whitespace-pre-line text-[#5b2722] text-xs">{analysisSidecar.summary}</p>
          </div>
          <Badge variant="queued">{analysisSidecar.engine}</Badge>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Badge variant="failed">High {flaggedCounts.high}</Badge>
          <Badge variant="running">Medium {flaggedCounts.medium}</Badge>
          <Badge variant="queued">Low {flaggedCounts.low}</Badge>
          <Badge variant="queued">Total {analysisSidecar.flagged.length}</Badge>
        </div>
      </div>
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
          {flaggedSectionsFilterOptions.map((option) => (
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
              <span className="font-mono text-[#7f524a] text-xs">
                {formatFlaggedSegmentTimeLabel(segment)}
              </span>
            </div>
            <p className="mt-1 font-medium text-[#5b2722] text-xs">{segment.reason}</p>
            <p className="mt-0.5 text-[#7f524a] text-xs">{segment.text}</p>
          </button>
        ))
      )}
    </div>
  );
};

const FlaggedFramesDrawerContent = ({
  frameAnalysisError,
  frameAnalysisLogs,
  frameAnalysisStatusMessage,
  frameAnalysisSidecar,
  canAnalyze,
  filter,
  isAnalyzingFrames,
  onFilterChange,
  onStartAnalysis,
  onSeek,
}: FlaggedFramesDrawerContentProps) => {
  if (!frameAnalysisSidecar) {
    return (
      <div className="space-y-1.5">
        <p className="rounded-[12px] border border-[#e7d2c5] border-dashed bg-[#fff8f3] px-2.5 py-2.5 text-[#8f5e56] text-xs">
          Frame scan has not been run for this video.
        </p>
        <FrameScanStatusBanners
          frameAnalysisError={frameAnalysisError}
          frameAnalysisStatusMessage={frameAnalysisStatusMessage}
          isAnalyzingFrames={isAnalyzingFrames}
        />
        <FrameScanActionButton
          canAnalyze={canAnalyze}
          idleLabel="Run Frame Scan"
          isAnalyzingFrames={isAnalyzingFrames}
          onStartAnalysis={onStartAnalysis}
        />
        <LogOutput logs={frameAnalysisLogs} />
      </div>
    );
  }

  const flaggedCounts = buildFlaggedPriorityCounts(frameAnalysisSidecar.flagged);
  const filteredSegments = filterFlaggedSegments(frameAnalysisSidecar.flagged, filter);

  return (
    <div className="space-y-1.5">
      <FrameScanStatusBanners
        frameAnalysisError={frameAnalysisError}
        frameAnalysisStatusMessage={frameAnalysisStatusMessage}
        isAnalyzingFrames={isAnalyzingFrames}
      />
      <div className="rounded-[14px] border border-[#ead3c4] bg-[#fffaf6] px-2.5 py-2">
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-0.5">
            <p className="text-[#8f5e56] text-xs">Summary</p>
            <p className="whitespace-pre-line text-[#5b2722] text-xs">
              {frameAnalysisSidecar.summary}
            </p>
          </div>
          <Badge variant="queued">Local POC</Badge>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Badge variant="failed">High {flaggedCounts.high}</Badge>
          <Badge variant="running">Medium {flaggedCounts.medium}</Badge>
          <Badge variant="queued">Low {flaggedCounts.low}</Badge>
          <Badge variant="queued">Total {frameAnalysisSidecar.flagged.length}</Badge>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 rounded-[12px] border border-[#ead3c4] bg-[#fffaf6] px-2.5 py-2">
        <div>
          <p className="text-[#8f5e56] text-xs">Filter</p>
          <p className="mt-0.5 text-[#5b2722] text-xs">
            {filteredSegments.length} of {frameAnalysisSidecar.flagged.length} frame
            {frameAnalysisSidecar.flagged.length === 1 ? "" : "s"}
          </p>
        </div>
        <select
          value={filter}
          onChange={(event) => onFilterChange(event.currentTarget.value as FlaggedSectionsFilter)}
          className="h-9 rounded-[14px] border border-[#d9b7a5] bg-white px-3 text-[#4f1f1a] text-xs outline-none transition focus:border-[#88322d] focus:ring-[#c57267]/25 focus:ring-[2px]"
        >
          {flaggedSectionsFilterOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex gap-2">
        <FrameScanActionButton
          canAnalyze={canAnalyze}
          idleLabel="Run Again"
          isAnalyzingFrames={isAnalyzingFrames}
          onStartAnalysis={onStartAnalysis}
        />
      </div>
      <LogOutput logs={frameAnalysisLogs} />
      {frameAnalysisSidecar.flagged.length === 0 ? (
        <p className="rounded-[12px] border border-[#e7d2c5] border-dashed bg-[#fff8f3] px-2.5 py-2.5 text-[#8f5e56] text-xs">
          Frame scan exists, but no flagged frames were found.
        </p>
      ) : filteredSegments.length === 0 ? (
        <p className="rounded-[12px] border border-[#e7d2c5] border-dashed bg-[#fff8f3] px-2.5 py-2.5 text-[#8f5e56] text-xs">
          No flagged frames match the selected filter.
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
              <span className="font-mono text-[#7f524a] text-xs">
                {formatFlaggedSegmentTimeLabel(segment)}
              </span>
            </div>
            <p className="mt-1 font-medium text-[#5b2722] text-xs">{segment.reason}</p>
            <p className="mt-0.5 text-[#7f524a] text-xs">{segment.text}</p>
          </button>
        ))
      )}
    </div>
  );
};

const SubtitlesDrawerContent = ({
  canTranscribe,
  onSeek,
  onStartTranscription,
  subtitles,
  transcriptionTask,
}: SubtitlesDrawerContentProps) => {
  const isTranscriptionTaskActive =
    transcriptionTask?.status === "queued" || transcriptionTask?.status === "running";

  if (subtitles.length === 0) {
    return (
      <div className="space-y-1.5">
        <p className="rounded-[12px] border border-[#e7d2c5] border-dashed bg-[#fff8f3] px-2.5 py-2.5 text-[#8f5e56] text-xs">
          No subtitles detected.
        </p>
        <Button
          type="button"
          size="sm"
          onClick={onStartTranscription}
          disabled={!canTranscribe || isTranscriptionTaskActive}
        >
          {isTranscriptionTaskActive ? (
            <LoaderCircle className="size-3 animate-spin" />
          ) : (
            <Captions className="size-3" />
          )}
          {isTranscriptionTaskActive ? "Transcribing..." : "Generate Subtitles"}
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

const SubtitleOverlay = ({
  currentTime,
  hasSubtitleSidecar,
  playbackError,
  subtitle,
}: {
  currentTime: number;
  hasSubtitleSidecar: boolean;
  playbackError: string | null;
  subtitle?: SubtitleEntry;
}) => {
  if (playbackError || !hasSubtitleSidecar || !subtitle?.text) {
    return null;
  }

  const timeLabel = subtitle
    ? `${formatTime(subtitle.startTime, subtitle.endTime)} - ${formatTime(subtitle.endTime, subtitle.endTime)}`
    : formatTime(currentTime, currentTime);

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center p-3">
      <div className="max-w-[min(100%-1.5rem,52rem)] rounded-[18px] border border-white/15 bg-black/55 px-4 py-2.5 text-center shadow-[0_10px_30px_rgba(0,0,0,0.45)] backdrop-blur-sm">
        <p className="font-mono text-[10px] text-white/70 uppercase tracking-[0.2em]">
          {timeLabel}
        </p>
        <p className="mt-1 text-balance text-sm text-white leading-5">{subtitle.text}</p>
      </div>
    </div>
  );
};

type VideoControlsProps = {
  currentTime: number;
  duration: number;
  hoverPosition: number | null;
  hoverTime: number | null;
  isPlaying: boolean;
  onSeek: (time: number) => void;
  onSeekBackwardTen: () => void;
  onSeekForwardTen: () => void;
  onSeekHover: (time: number, position: number) => void;
  onSeekHoverEnd: () => void;
  onTogglePlayback: () => void;
};

const VideoControls = ({
  currentTime,
  duration,
  hoverPosition,
  hoverTime,
  isPlaying,
  onSeek,
  onSeekBackwardTen,
  onSeekForwardTen,
  onSeekHover,
  onSeekHoverEnd,
  onTogglePlayback,
}: VideoControlsProps) => {
  return (
    <div className="absolute inset-x-0 bottom-0 p-3">
      <div className="flex items-center gap-2 rounded-[18px] border border-white/12 bg-black/45 px-3 py-2 text-white shadow-[0_10px_30px_rgba(0,0,0,0.38)] backdrop-blur-md">
        <button
          type="button"
          onClick={onSeekBackwardTen}
          className="flex h-8 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/10 px-2.5 font-semibold text-[11px] transition hover:bg-white/18"
          aria-label="Seek backward 10 seconds"
        >
          -10s
        </button>
        <button
          type="button"
          onClick={onTogglePlayback}
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white/10 transition hover:bg-white/18"
          aria-label={isPlaying ? "Pause video" : "Play video"}
        >
          {isPlaying ? (
            <Pause className="size-3.5 fill-current" />
          ) : (
            <Play className="ml-0.5 size-3.5 fill-current" />
          )}
        </button>
        <button
          type="button"
          onClick={onSeekForwardTen}
          className="flex h-8 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/10 px-2.5 font-semibold text-[11px] transition hover:bg-white/18"
          aria-label="Seek forward 10 seconds"
        >
          +10s
        </button>
        <span className="w-12 shrink-0 text-right font-mono text-[11px] text-white/80 tabular-nums">
          {formatTime(currentTime, duration)}
        </span>
        <div className="relative min-w-0 flex-1">
          {hoverTime !== null && hoverPosition !== null ? (
            <div
              className="pointer-events-none absolute bottom-full mb-2 -translate-x-1/2 rounded-full border border-white/15 bg-black/80 px-2 py-1 font-mono text-[10px] text-white shadow-[0_8px_20px_rgba(0,0,0,0.3)]"
              style={{ left: `${hoverPosition}%` }}
            >
              {formatTime(hoverTime, duration)}
            </div>
          ) : null}
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.1}
            value={Math.min(currentTime, duration || 0)}
            onChange={(event) => onSeek(Number(event.currentTarget.value))}
            onMouseLeave={onSeekHoverEnd}
            onMouseMove={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              if (rect.width <= 0) {
                return;
              }
              const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
              onSeekHover(clampSeekTime(duration * ratio, duration), ratio * 100);
            }}
            className="h-2 w-full cursor-pointer appearance-none rounded-full bg-white/20 accent-white"
            aria-label="Seek video"
          />
        </div>
        <span className="w-12 shrink-0 font-mono text-[11px] text-white/80 tabular-nums">
          {formatTime(duration)}
        </span>
      </div>
    </div>
  );
};

type RangesDrawerContentProps = {
  cutOutputPath: string | null;
  cutTask: TaskState | undefined;
  isExporting: boolean;
  onOpenOutput: (path: string) => void;
  onRemoveRange: (rangeId: string) => void;
  ranges: LocalRange[];
};

const toTaskStatusVariant = (status: TaskState["status"]) => {
  if (status === "completed") {
    return "completed" as const;
  }

  if (status === "cancelled") {
    return "cancelled" as const;
  }

  if (status === "queued") {
    return "queued" as const;
  }

  return "running" as const;
};

const RangesDrawerContent = ({
  cutOutputPath,
  cutTask,
  isExporting,
  onOpenOutput,
  onRemoveRange,
  ranges,
}: RangesDrawerContentProps) => (
  <div className="flex min-h-0 flex-1 flex-col">
    <div className="flex items-start justify-between gap-2">
      <div className="flex flex-col gap-0.5">
        <h3 className="font-semibold text-[#5b2722] text-sm">Cut Task And Ranges</h3>
        <p className="text-[#8f5e56] text-xs">
          Export status and the full list of saved cut ranges for this session.
        </p>
      </div>
      <DrawerClose>Close</DrawerClose>
    </div>
    <div className="mt-2 min-h-0 flex-1 space-y-2 overflow-auto pr-1">
      {cutTask ? (
        <div className="rounded-[14px] border border-[#ead3c4] bg-[#fffaf6] px-2.5 py-2">
          <div className="flex items-center justify-between gap-2">
            <p className="font-medium text-[#5b2722] text-xs">{cutTask.taskId}</p>
            <Badge variant={toTaskStatusVariant(cutTask.status)}>{cutTask.status}</Badge>
          </div>
          <p className="mt-1 text-[#8f5e56] text-xs">
            {isExporting ? "Export in progress..." : "Ready."}
          </p>
          {cutOutputPath ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() => onOpenOutput(cutOutputPath)}
            >
              Preview Output
            </Button>
          ) : null}
        </div>
      ) : (
        <p className="rounded-[12px] border border-[#e7d2c5] border-dashed bg-[#fff8f3] px-2.5 py-2.5 text-[#8f5e56] text-xs">
          No cut task has run yet.
        </p>
      )}

      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <p className="font-medium text-[#5b2722] text-xs">Saved Ranges</p>
          <Badge variant="queued">{ranges.length}</Badge>
        </div>
        {ranges.length === 0 ? (
          <p className="rounded-[12px] border border-[#e7d2c5] border-dashed bg-[#fff8f3] px-2.5 py-2.5 text-[#8f5e56] text-xs">
            No ranges yet.
          </p>
        ) : (
          ranges.map((range) => (
            <div key={range.id} className="rounded-[14px] border border-[#ead3c4] bg-[#fffaf7] p-2">
              <p className="font-mono text-[#5f2823] text-xs">
                {formatTime(range.start)} - {formatTime(range.end)}
              </p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="mt-1"
                onClick={() => onRemoveRange(range.id)}
              >
                <Trash2 className="size-3" />
                Remove
              </Button>
            </div>
          ))
        )}
      </div>
    </div>
  </div>
);

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: this coordinator still owns several drawer actions, but the sidecar/frame-scan state transitions now live in extracted helpers and hooks.
const SimpleCutEditorPanel = ({ controller, isActive }: SimpleCutEditorPanelProps) => {
  const [videoPath, setVideoPath] = useState<string | null>(null);
  const [selectedVideoPath, setSelectedVideoPath] = useState<string | null>(null);
  const [markerStart, setMarkerStart] = useState<number | null>(null);
  const [markerEnd, setMarkerEnd] = useState<number | null>(null);
  const [ranges, setRanges] = useState<LocalRange[]>([]);
  const [isSavingRanges, setIsSavingRanges] = useState(false);
  const [rangeSaveError, setRangeSaveError] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isShowingExportOutput, setIsShowingExportOutput] = useState(false);
  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [flaggedSectionsFilter, setFlaggedSectionsFilter] = useState<FlaggedSectionsFilter>("all");
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [hoverSeekTime, setHoverSeekTime] = useState<number | null>(null);
  const [hoverSeekPosition, setHoverSeekPosition] = useState<number | null>(null);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [isDeletingVideo, setIsDeletingVideo] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [compressionPreset, setCompressionPreset] = useState<CompressionPreset>("max_compression");
  const [isDropTargetActive, setIsDropTargetActive] = useState(false);
  const [sidecarRefreshKey, setSidecarRefreshKey] = useState(0);
  const [subtitles, setSubtitles] = useState<SubtitleEntry[]>([]);
  const [hasSubtitleSidecar, setHasSubtitleSidecar] = useState(false);
  const [analysisSidecar, setAnalysisSidecar] = useState<AnalysisSidecar | null>(null);
  const [frameAnalysisSidecar, setFrameAnalysisSidecar] = useState<AnalysisSidecar | null>(null);
  const [frameAnalysisError, setFrameAnalysisError] = useState<string | null>(null);
  const [frameAnalysisLogs, setFrameAnalysisLogs] = useState<string[]>([]);
  const [frameAnalysisStatusMessage, setFrameAnalysisStatusMessage] = useState<string | null>(null);
  const [isAnalyzingFrames, setIsAnalyzingFrames] = useState(false);
  const [activeFrameScanVideoPath, setActiveFrameScanVideoPath] = useState<string | null>(null);
  const [flaggedFramesFilter, setFlaggedFramesFilter] = useState<FlaggedSectionsFilter>("all");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const dropTargetRef = useRef<HTMLDivElement>(null);

  const cutTask = getLatestTask(controller.state.tasksById, "cut");
  const transcriptionTask = getLatestTask(controller.state.tasksById, "transcription");
  const flagTask = getLatestTask(controller.state.tasksById, "flag");
  const cutOutputPath = getTaskOutputPath(cutTask);
  const currentSubtitle = findSubtitleAtTime(subtitles, currentTime);
  const isCutTaskActive =
    isExporting || cutTask?.status === "queued" || cutTask?.status === "running";
  const hasStartedMarking = markerStart !== null;
  const canResetToOriginal = canResetVideoToOriginal(videoPath, selectedVideoPath);
  const cutFromLabel = `Cut from ${formatTime(
    markerStart ?? currentTime,
    Number.isFinite(duration) && duration > 0 ? duration : currentTime,
  )}`;
  const cutUntilLabel = `Cut Until ${formatTime(
    markerEnd ?? currentTime,
    Number.isFinite(duration) && duration > 0 ? duration : currentTime,
  )}`;
  const srtSidecarPath = videoPath ? toSrtSidecarPath(videoPath) : null;
  const sidecarTaskRefreshSignature = [
    transcriptionTask?.status,
    transcriptionTask?.jobs
      .map((job) => `${job.inputPath}:${job.status}:${job.outputPath ?? ""}`)
      .join(","),
    flagTask?.status,
    flagTask?.jobs.map((job) => `${job.inputPath}:${job.status}:${job.outputPath ?? ""}`).join(","),
  ].join("|");

  const applySelectedVideoPath = useCallback(
    (selected: string | null, shouldSyncController = true) => {
      if (shouldSyncController) {
        controller.selectVideo(selected);
      }
      setVideoPath(selected);
      setSelectedVideoPath(selected);
      setRanges([]);
      setRangeSaveError(null);
      setIsSavingRanges(false);
      setMarkerStart(null);
      setMarkerEnd(null);
      setVideoSrc(null);
      setPlaybackError(null);
      setCurrentTime(0);
      setDuration(0);
      setIsPlaying(false);
      setHoverSeekTime(null);
      setHoverSeekPosition(null);
      setIsDeleteConfirmOpen(false);
      setIsShowingExportOutput(false);
      setDeleteError(null);
      setFrameAnalysisError(null);
      setFrameAnalysisLogs([]);
      setFrameAnalysisStatusMessage(null);
      setActiveFrameScanVideoPath(null);
      setIsAnalyzingFrames(false);
      if (videoRef.current) {
        videoRef.current.load();
      }
    },
    [controller],
  );

  useEffect(() => {
    let isCancelled = false;

    setVideoSrc(null);
    if (!videoPath) {
      return () => {
        isCancelled = true;
      };
    }

    getMediaPreviewUrl(videoPath)
      .then((previewUrl) => {
        if (!isCancelled) {
          setVideoSrc(previewUrl);
        }
      })
      .catch(() => {
        if (!isCancelled) {
          setVideoSrc(convertFileSrc(videoPath));
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [videoPath]);

  useEffect(() => {
    if (
      cutTask?.status !== "completed" ||
      !cutOutputPath ||
      !selectedVideoPath ||
      !cutTask.jobs.some((job) => job.inputPath === selectedVideoPath)
    ) {
      return;
    }

    setVideoPath(cutOutputPath);
    setPlaybackError(null);
    setCurrentTime(0);
    setDuration(0);
    setIsPlaying(false);
    setHoverSeekTime(null);
    setHoverSeekPosition(null);
    setIsDeleteConfirmOpen(false);
    setIsShowingExportOutput(true);
    setDeleteError(null);
  }, [cutOutputPath, cutTask?.jobs, cutTask?.status, selectedVideoPath]);

  useVideoSidecarLoading(
    sidecarRefreshKey,
    videoPath,
    setAnalysisSidecar,
    setFrameAnalysisSidecar,
    setHasSubtitleSidecar,
    setSubtitles,
  );

  useCutRangesSidecarLoading(videoPath, setRanges);

  useEffect(() => {
    if (!sidecarTaskRefreshSignature) {
      return;
    }

    setSidecarRefreshKey((previous) => previous + 1);
  }, [sidecarTaskRefreshSignature]);

  useEffect(() => {
    if (!isAnalyzingFrames) {
      return;
    }

    if (!frameAnalysisSidecar) {
      return;
    }

    setFrameAnalysisLogs((previous) =>
      appendLocalLog(previous, "Frame scan results loaded into the drawer."),
    );
    setFrameAnalysisStatusMessage("Frame scan results loaded.");
    setIsAnalyzingFrames(false);
  }, [frameAnalysisSidecar, isAnalyzingFrames]);

  useFrameScanEventSubscription(
    activeFrameScanVideoPath,
    isActive,
    videoPath,
    setFrameAnalysisError,
    setFrameAnalysisLogs,
    setFrameAnalysisStatusMessage,
    setIsAnalyzingFrames,
    setSidecarRefreshKey,
  );

  useSelectedVideoSync(
    applySelectedVideoPath,
    isActive,
    controller.state.selectedVideoPath,
    videoPath,
    setIsDropTargetActive,
  );

  useVideoDropTarget(applySelectedVideoPath, dropTargetRef, isActive, setIsDropTargetActive);

  const chooseVideo = async () => {
    const response = await open({
      directory: false,
      filters: [{ extensions: ["mp4", "mov"], name: "Videos" }],
      multiple: false,
    });
    const selectedPath = toPathList(response as string | string[] | null).at(0) ?? null;
    const selected = selectedPath ? normalizeDialogPath(selectedPath) : null;
    applySelectedVideoPath(selected);
  };

  const resetToOriginalVideo = () => {
    if (!selectedVideoPath) {
      return;
    }

    applySelectedVideoPath(selectedVideoPath);
  };

  const handleVideoError = () => {
    const mediaError = videoRef.current?.error;
    if (!mediaError) {
      setPlaybackError("The selected video could not be played in the app preview.");
      return;
    }

    if (mediaError.code === mediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) {
      setPlaybackError(
        "This video format/codec is not supported by the in-app preview. Try another file or re-encode to H.264/AAC MP4.",
      );
      return;
    }

    if (mediaError.code === mediaError.MEDIA_ERR_DECODE) {
      setPlaybackError(
        "The video could not be decoded in the in-app preview. Try re-encoding to H.264/AAC MP4.",
      );
      return;
    }

    setPlaybackError("The selected video could not be played in the app preview.");
  };

  const markStart = () => {
    if (!videoRef.current) {
      return;
    }
    setMarkerStart(videoRef.current.currentTime);
  };

  const markEnd = () => {
    if (!videoRef.current || markerStart === null) {
      return;
    }
    const endTime = videoRef.current.currentTime;
    setMarkerEnd(endTime);

    if (endTime <= markerStart) {
      return;
    }

    setRanges((previous) => [
      ...previous,
      {
        end: endTime,
        id: `${markerStart}-${endTime}-${previous.length}`,
        start: markerStart,
      },
    ]);
    resetMarking();
  };

  const resetMarking = () => {
    setMarkerStart(null);
    setMarkerEnd(null);
  };

  const startCutExport = async () => {
    if (!videoPath || ranges.length === 0) {
      return;
    }
    setSelectedVideoPath(videoPath);
    setIsExporting(true);
    try {
      await controller.startCut(videoPath, toCutRanges(ranges), compressionPreset);
    } finally {
      setIsExporting(false);
    }
  };

  const saveSelectedRanges = async () => {
    if (!videoPath) {
      return;
    }

    setRangeSaveError(null);
    setIsSavingRanges(true);
    try {
      await saveCutRanges({ ranges: toCutRanges(ranges), videoPath });
    } catch (error) {
      setRangeSaveError(toUnknownErrorMessage(error, "Failed saving cut ranges."));
    } finally {
      setIsSavingRanges(false);
    }
  };

  const startSubtitleGeneration = async () => {
    if (!videoPath) {
      return;
    }
    await controller.startTranscriptionForPaths([videoPath]);
  };

  const startFlaggedSectionAnalysis = async () => {
    if (!srtSidecarPath) {
      return;
    }
    await controller.startFlaggingForPaths([srtSidecarPath]);
  };

  const startFlaggedFrameAnalysis = async () => {
    if (!videoPath) {
      return;
    }

    setFrameAnalysisError(null);
    setFrameAnalysisLogs([]);
    setFrameAnalysisStatusMessage("Requesting local frame scan...");
    setActiveFrameScanVideoPath(videoPath);
    setIsAnalyzingFrames(true);

    try {
      await scanVideoFrames({
        sampleIntervalSeconds: 2,
        videoPath,
      });
      setFrameAnalysisError(null);
    } catch (error) {
      const message = toUnknownErrorMessage(error, "Failed running local frame scan.");
      setFrameAnalysisError(message);
      setFrameAnalysisLogs((previous) => appendLocalLog(previous, `Scan failed: ${message}`));
      setFrameAnalysisStatusMessage(message);
    } finally {
      setIsAnalyzingFrames(false);
    }
  };

  const togglePlayback = () => {
    if (!videoRef.current) {
      return;
    }

    if (videoRef.current.paused) {
      void videoRef.current.play().catch(() => undefined);
      return;
    }

    videoRef.current.pause();
  };

  const seekTo = (time: number) => {
    if (!videoRef.current) {
      return;
    }
    const nextTime = clampSeekTime(time, duration);
    videoRef.current.currentTime = nextTime;
    setCurrentTime(nextTime);
  };

  const seekBackwardTen = () => {
    seekTo(currentTime - 10);
  };

  const seekForwardTen = () => {
    seekTo(currentTime + 10);
  };

  const openDeleteConfirmation = () => {
    setDeleteError(null);
    setIsDeleteConfirmOpen(true);
  };

  const cancelDeleteConfirmation = () => {
    setIsDeleteConfirmOpen(false);
  };

  const confirmDeleteCurrentVideo = async () => {
    if (!videoPath) {
      return;
    }

    setDeleteError(null);
    setIsDeletingVideo(true);

    try {
      await deleteVideoFiles(videoPath);
      applySelectedVideoPath(null);
      resetLoadedSidecars(
        setAnalysisSidecar,
        setFrameAnalysisSidecar,
        setHasSubtitleSidecar,
        setSubtitles,
      );
    } catch (error) {
      setDeleteError(
        error instanceof Error ? error.message : "Failed deleting the selected files.",
      );
    } finally {
      setIsDeletingVideo(false);
    }
  };

  return (
    <Card>
      <CardHeader className="grid grid-cols-[1fr_auto] gap-2">
        <div>
          <CardTitle className="flex items-center gap-1.5">
            <span className="flex size-7 items-center justify-center rounded-lg bg-[#f5e6dc] text-[#88322d]">
              <Scissors className="size-3" />
            </span>
            Edit Video
          </CardTitle>
          <p className="mt-0.5 text-[#8f5e56] text-xs">
            Review video, mark segments, and export cuts.
          </p>
        </div>
        <TaskDrawer
          triggerLabel="Ranges And Task"
          title="Cut Task And Ranges"
          description="Export status and saved segments."
        >
          <RangesDrawerContent
            cutOutputPath={cutOutputPath}
            cutTask={cutTask}
            isExporting={isExporting}
            onOpenOutput={(path) => {
              setVideoPath(path);
              setPlaybackError(null);
              setCurrentTime(0);
              setIsShowingExportOutput(true);
            }}
            onRemoveRange={(rangeId) =>
              setRanges((previous) => previous.filter((item) => item.id !== rangeId))
            }
            ranges={ranges}
          />
        </TaskDrawer>
        <TaskDrawer
          triggerLabel="Subtitles"
          title="Subtitles"
          description="Review or generate subtitle sidecars."
        >
          <SubtitlesDrawerContent
            canTranscribe={videoPath !== null}
            onSeek={seekTo}
            onStartTranscription={startSubtitleGeneration}
            subtitles={subtitles}
            transcriptionTask={transcriptionTask}
          />
        </TaskDrawer>
        <TaskDrawer
          triggerLabel="Flagged Sections"
          title="Flagged Sections"
          description="Quick jump to flagged content."
        >
          <FlaggedSectionsDrawerContent
            analysisSidecar={analysisSidecar}
            canAnalyze={srtSidecarPath !== null && hasSubtitleSidecar}
            filter={flaggedSectionsFilter}
            flagTask={flagTask}
            onFilterChange={setFlaggedSectionsFilter}
            onStartAnalysis={startFlaggedSectionAnalysis}
            onSeek={(time) => {
              if (!videoRef.current) {
                return;
              }
              videoRef.current.currentTime = time;
              setCurrentTime(time);
            }}
          />
        </TaskDrawer>
        <TaskDrawer
          triggerLabel="Flagged Frames"
          title="Flagged Frames"
          description="Local frame scan detections for the current video."
        >
          <FlaggedFramesDrawerContent
            frameAnalysisError={frameAnalysisError}
            frameAnalysisLogs={frameAnalysisLogs}
            frameAnalysisStatusMessage={frameAnalysisStatusMessage}
            frameAnalysisSidecar={frameAnalysisSidecar}
            canAnalyze={videoPath !== null}
            filter={flaggedFramesFilter}
            isAnalyzingFrames={isAnalyzingFrames}
            onFilterChange={setFlaggedFramesFilter}
            onStartAnalysis={startFlaggedFrameAnalysis}
            onSeek={(time) => {
              if (!videoRef.current) {
                return;
              }
              videoRef.current.currentTime = time;
              setCurrentTime(time);
            }}
          />
        </TaskDrawer>
      </CardHeader>
      <CardContent>
        <div
          ref={dropTargetRef}
          className={`space-y-2 rounded-[16px] transition ${
            isDropTargetActive
              ? "bg-[#fff1e8] shadow-[0_0_0_2px_rgba(197,114,103,0.15)]"
              : "bg-transparent"
          }`}
        >
          <div className="flex flex-wrap gap-1.5">
            <Button type="button" variant="secondary" size="sm" onClick={chooseVideo}>
              <Film className="size-3" />
              Choose Video
            </Button>
            {canResetToOriginal ? (
              <Button type="button" variant="secondary" size="sm" onClick={resetToOriginalVideo}>
                <RotateCcw className="size-3" />
                Reset to Original
              </Button>
            ) : null}
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={markStart}
              disabled={!videoPath || hasStartedMarking}
            >
              {cutFromLabel}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={markEnd}
              disabled={!videoPath || !hasStartedMarking}
            >
              {cutUntilLabel}
            </Button>
            {hasStartedMarking ? (
              <Button type="button" variant="outline" size="sm" onClick={resetMarking}>
                Cancel Marking
              </Button>
            ) : null}
            <label className="flex items-center gap-1.5 text-[#5b2722] text-xs">
              <span className="text-[#8f5e56]">Quality</span>
              <select
                value={compressionPreset}
                onChange={(event) =>
                  setCompressionPreset(event.currentTarget.value as CompressionPreset)
                }
                disabled={isCutTaskActive}
                className="h-8 rounded-[14px] border border-[#d9b7a5] bg-white px-2 text-[#4f1f1a] text-xs outline-none transition focus:border-[#88322d] focus:ring-[#c57267]/25 focus:ring-[2px] disabled:opacity-50"
              >
                <option value="max_compression">Max compression (HEVC)</option>
                <option value="balanced">Balanced (H.264)</option>
              </select>
            </label>
            <Button
              type="button"
              size="sm"
              onClick={startCutExport}
              disabled={!videoPath || ranges.length === 0 || isCutTaskActive}
            >
              {isCutTaskActive ? <LoaderCircle className="size-3 animate-spin" /> : null}
              {isCutTaskActive ? "Exporting..." : "Export"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={saveSelectedRanges}
              disabled={!videoPath || isSavingRanges}
            >
              {isSavingRanges ? <LoaderCircle className="size-3 animate-spin" /> : null}
              {isSavingRanges ? "Saving Ranges..." : "Save Ranges"}
            </Button>
            {isCutTaskActive ? (
              <Button
                type="button"
                variant="danger"
                size="sm"
                onClick={() => controller.cancelTaskById(cutTask?.taskId ?? null)}
              >
                Cancel Task
              </Button>
            ) : null}
            <Button
              type="button"
              variant="danger"
              size="sm"
              onClick={openDeleteConfirmation}
              disabled={!videoPath || isCutTaskActive || isDeletingVideo}
            >
              <Trash2 className="size-3" />
              Delete Video
            </Button>
          </div>

          {rangeSaveError ? <p className="text-[#b5453d] text-xs">{rangeSaveError}</p> : null}

          {isDeleteConfirmOpen ? (
            <DeleteVideoConfirmationCard
              isDeletingVideo={isDeletingVideo}
              onCancel={cancelDeleteConfirmation}
              onConfirm={confirmDeleteCurrentVideo}
            />
          ) : null}

          {videoPath ? (
            <div className="relative overflow-hidden rounded-[24px] border border-[#ead3c4] bg-black shadow-[0_18px_40px_rgba(0,0,0,0.12)]">
              {videoSrc ? (
                <video
                  key={videoSrc}
                  ref={videoRef}
                  src={videoSrc}
                  playsInline
                  preload="metadata"
                  onLoadedData={() => setPlaybackError(null)}
                  onLoadedMetadata={() => setDuration(videoRef.current?.duration ?? 0)}
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => setIsPlaying(false)}
                  onEnded={() => setIsPlaying(false)}
                  onTimeUpdate={() => setCurrentTime(videoRef.current?.currentTime ?? 0)}
                  onError={handleVideoError}
                  onClick={togglePlayback}
                  className="aspect-video w-full cursor-pointer bg-black"
                >
                  <track kind="captions" />
                </video>
              ) : (
                <div className="flex aspect-video w-full items-center justify-center bg-black text-sm text-white/70">
                  Preparing preview...
                </div>
              )}
              <SubtitleOverlay
                currentTime={currentTime}
                hasSubtitleSidecar={hasSubtitleSidecar}
                playbackError={playbackError}
                subtitle={currentSubtitle}
              />
              {!playbackError ? (
                <VideoControls
                  currentTime={currentTime}
                  duration={duration}
                  hoverPosition={hoverSeekPosition}
                  hoverTime={hoverSeekTime}
                  isPlaying={isPlaying}
                  onSeek={seekTo}
                  onSeekBackwardTen={seekBackwardTen}
                  onSeekForwardTen={seekForwardTen}
                  onSeekHover={(time, position) => {
                    setHoverSeekTime(time);
                    setHoverSeekPosition(position);
                  }}
                  onSeekHoverEnd={() => {
                    setHoverSeekTime(null);
                    setHoverSeekPosition(null);
                  }}
                  onTogglePlayback={togglePlayback}
                />
              ) : null}
            </div>
          ) : (
            <div className="rounded-[22px] border border-[#e7d2c5] border-dashed bg-[#fff8f3] px-5 py-8 text-[#8f5e56] text-sm">
              Choose a video file to begin.
            </div>
          )}

          <CutVideoStatusMessages
            deleteError={deleteError}
            isCutTaskActive={isCutTaskActive}
            isShowingExportOutput={isShowingExportOutput}
            playbackError={playbackError}
          />
        </div>
      </CardContent>
    </Card>
  );
};

export { SimpleCutEditorPanel };
