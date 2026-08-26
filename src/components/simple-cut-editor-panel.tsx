import type { DragDropEvent } from "@tauri-apps/api/window";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { Film, LoaderCircle, Pause, Play, RotateCcw, Scissors, Trash2, X } from "lucide-react";
import type { Dispatch, RefObject, SetStateAction, UIEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  FlaggedSectionsDrawerContent,
  type FlaggedSectionsFilter,
  SubtitlesDrawerContent,
} from "@/components/editor/review-drawers";
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
  toAnalysisSidecarPath,
  toCutRangesSidecarPath,
  toSrtSidecarPath,
} from "@/features/editor/video-sidecars";
import { getLatestTaskForInput, getTaskOutputPath } from "@/features/media/selectors";
import {
  getMediaPreviewUrl,
  readAnalysisImportFile,
  readTextFile,
  saveAnalysisSidecar,
  saveCutRanges,
} from "@/features/media/transport";
import type {
  AnalysisPromptPreviewRequest,
  AnalysisSidecar,
  AnalysisStrategy,
  CompressionPreset,
  CutRange,
  ModerationEngine,
  ModerationSettings,
  SubtitleEntry,
  TaskKind,
  TaskState,
} from "@/features/media/types";
import type { useMediaController } from "@/features/media/useMediaController";
import { useTauriFileDrop } from "@/features/media/useTauriFileDrop";
import {
  type AnalysisImportResult,
  buildImportedAnalysisBundle,
  validateAnalysisImportPaths,
} from "@/features/moderation/analysis-import";
import { parseAnalysisSidecar, toAnalysisSidecar } from "@/features/moderation/results";
import type { AnalysisRunSelection } from "@/features/moderation/run-settings";
import {
  toAnalysisRunSelection,
  updateAnalysisRunEngine,
} from "@/features/moderation/run-settings";

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

type AnalysisPromptCriteria = Pick<ModerationSettings, "contentCriteria" | "priorityGuidelines">;

const toAnalysisPromptRequest = (
  analysisRunSettings: AnalysisRunSelection | null,
  analysisPromptCriteria: AnalysisPromptCriteria | null,
): AnalysisPromptPreviewRequest | null => {
  if (!analysisRunSettings || !analysisPromptCriteria) {
    return null;
  }

  return {
    contentCriteria: analysisPromptCriteria.contentCriteria,
    engine: analysisRunSettings.engine,
    priorityGuidelines: analysisPromptCriteria.priorityGuidelines,
  };
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
  const results = await Promise.allSettled(deleteTargets.map((path) => trashFile(path)));
  const failures = results.filter(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );

  if (failures.length > 0) {
    const messages = failures.map((failure) =>
      toUnknownErrorMessage(failure.reason, "Unknown delete failure."),
    );
    throw new Error(
      `Failed to move ${failures.length} of ${deleteTargets.length} files to trash: ${messages.join("; ")}`,
    );
  }
};

const resetLoadedSidecars = (
  setAnalysisSidecar: (value: AnalysisSidecar | null) => void,
  setHasSubtitleSidecar: (value: boolean) => void,
  setSubtitleLoadError: (value: string | null) => void,
  setSubtitles: (value: SubtitleEntry[]) => void,
) => {
  setSubtitles([]);
  setHasSubtitleSidecar(false);
  setSubtitleLoadError(null);
  setAnalysisSidecar(null);
};

const applyLoadedSidecars = (
  analysisResult: PromiseSettledResult<string>,
  subtitleResult: PromiseSettledResult<string>,
  setAnalysisSidecar: (value: AnalysisSidecar | null) => void,
  setHasSubtitleSidecar: (value: boolean) => void,
  setSubtitleLoadError: (value: string | null) => void,
  setSubtitles: (value: SubtitleEntry[]) => void,
) => {
  if (subtitleResult.status === "fulfilled") {
    try {
      setSubtitles(parseSrt(subtitleResult.value));
      setHasSubtitleSidecar(true);
      setSubtitleLoadError(null);
    } catch (error: unknown) {
      setSubtitles([]);
      setHasSubtitleSidecar(false);
      setSubtitleLoadError(
        error instanceof Error ? error.message : "Failed parsing the subtitle sidecar.",
      );
    }
  } else {
    setSubtitles([]);
    setHasSubtitleSidecar(false);
    setSubtitleLoadError(null);
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
      This moves the selected video to trash, plus the matching `.srt`, `.analysis.json`, and
      `.ranges.json` files when present.
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
  cutError: string | null;
  cutTask: TaskState | undefined;
  deleteError: string | null;
  isCutTaskActive: boolean;
  isShowingExportOutput: boolean;
  playbackError: string | null;
  subtitleLoadError: string | null;
};

const CutVideoStatusMessages = ({
  cutError,
  cutTask,
  deleteError,
  isCutTaskActive,
  isShowingExportOutput,
  playbackError,
  subtitleLoadError,
}: CutVideoStatusMessagesProps) => {
  const taskError =
    cutTask?.jobs.find((job) => job.status === "failed")?.error ??
    (cutTask?.summary?.failed ? "Cut export failed." : null);
  const displayedCutError = cutError ?? taskError;

  return (
    <>
      {displayedCutError ? (
        <div className="rounded-[20px] border border-rose-300 bg-rose-50 px-4 py-3 text-rose-900 text-sm">
          {displayedCutError}
        </div>
      ) : null}

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

      {subtitleLoadError ? (
        <div className="rounded-[20px] border border-rose-300 bg-rose-50 px-4 py-3 text-rose-900 text-sm">
          Subtitle sidecar could not be loaded: {subtitleLoadError}
        </div>
      ) : null}

      {isCutTaskActive ? (
        <div className="rounded-[20px] border border-[#ead3c4] bg-[#fffaf6] px-4 py-3 text-[#5b2722] text-sm">
          Export in progress. The preview will switch to the exported video once the worker
          finishes.
        </div>
      ) : null}

      {isShowingExportOutput && !isCutTaskActive ? (
        <div className="rounded-[20px] border border-emerald-200 bg-emerald-50 px-4 py-3 text-emerald-800 text-sm">
          Previewing the exported video output in the main pane.
        </div>
      ) : null}
    </>
  );
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

const loadSidecarContent = (videoPath: string) =>
  Promise.allSettled([
    readTextFile(toSrtSidecarPath(videoPath)),
    readTextFile(toAnalysisSidecarPath(videoPath)),
  ]);

type AnalysisImportRequest = {
  analysisSidecar: AnalysisSidecar | null;
  analysisSidecarPath: string;
  paths: string[];
  sourceFile: string;
  subtitles: SubtitleEntry[];
  videoPath: string;
};

const importAnalysisBundle = async ({
  analysisSidecar,
  analysisSidecarPath,
  paths,
  sourceFile,
  subtitles,
  videoPath,
}: AnalysisImportRequest): Promise<AnalysisImportResult> => {
  const importPaths = validateAnalysisImportPaths(paths);
  const [existingContent, importedContents] = await Promise.all([
    analysisSidecar ? readTextFile(analysisSidecarPath) : Promise.resolve(null),
    Promise.all(importPaths.map((path) => readAnalysisImportFile(path))),
  ]);
  const result = buildImportedAnalysisBundle(
    existingContent,
    importedContents,
    sourceFile,
    subtitles,
  );
  await saveAnalysisSidecar({
    content: JSON.stringify(result.bundle, null, 2),
    videoPath,
  });
  return result;
};

const formatAnalysisImportMessage = ({
  addedCount,
  duplicateCount,
  skippedCount,
  warnings,
}: AnalysisImportResult) => {
  const duplicateText = duplicateCount > 0 ? ` ${duplicateCount} duplicate(s) skipped.` : "";
  const warningText =
    skippedCount > 0 ? ` ${skippedCount} invalid finding(s) skipped: ${warnings.join(" ")}` : "";
  return `Imported ${addedCount} analysis run(s).${duplicateText}${warningText}`;
};

const getTaskStartError = (
  errorTaskKind: TaskKind | null,
  errorMessage: string | null,
  taskKind: TaskKind,
) => (errorTaskKind === taskKind ? errorMessage : null);

const getEditorTaskState = (
  tasksById: Record<string, TaskState>,
  selectedVideoPath: string | null,
  videoPath: string | null,
) => {
  const srtSidecarPath = videoPath ? toSrtSidecarPath(videoPath) : null;
  const cutInputPath = selectedVideoPath ?? videoPath;
  return {
    cutTask: cutInputPath ? getLatestTaskForInput(tasksById, "cut", cutInputPath) : undefined,
    flagTask: srtSidecarPath ? getLatestTaskForInput(tasksById, "flag", srtSidecarPath) : undefined,
    srtSidecarPath,
    transcriptionTask: videoPath
      ? getLatestTaskForInput(tasksById, "transcription", videoPath)
      : undefined,
  };
};

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

const useVideoSidecarLoading = (
  sidecarRefreshKey: number,
  videoPath: string | null,
  setAnalysisSidecar: (value: AnalysisSidecar | null) => void,
  setHasSubtitleSidecar: (value: boolean) => void,
  setSubtitleLoadError: (value: string | null) => void,
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
        setHasSubtitleSidecar,
        setSubtitleLoadError,
        setSubtitles,
      );
      return () => {
        cancelled = true;
      };
    }

    setSubtitleLoadError(null);

    const load = async () => {
      const [subtitleContent, analysisContent] = await loadSidecarContent(videoPath);

      if (cancelled) {
        return;
      }

      applyLoadedSidecars(
        analysisContent,
        subtitleContent,
        setAnalysisSidecar,
        setHasSubtitleSidecar,
        setSubtitleLoadError,
        setSubtitles,
      );
    };

    load().catch(() => {
      if (cancelled) {
        return;
      }

      resetLoadedSidecars(
        setAnalysisSidecar,
        setHasSubtitleSidecar,
        setSubtitleLoadError,
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
    setHasSubtitleSidecar,
    setSubtitleLoadError,
    setSubtitles,
  ]);
};

const useCutRangesSidecarLoading = (
  videoPath: string | null,
  setRanges: Dispatch<SetStateAction<LocalRange[]>>,
  setRangeLoadError: Dispatch<SetStateAction<string | null>>,
) => {
  useEffect(() => {
    let cancelled = false;

    if (!videoPath) {
      setRanges([]);
      setRangeLoadError(null);
      return () => {
        cancelled = true;
      };
    }

    readTextFile(toCutRangesSidecarPath(videoPath))
      .then((content) => {
        if (cancelled) {
          return;
        }
        try {
          setRanges(toLocalRanges(parseSavedCutRanges(content)));
          setRangeLoadError(null);
        } catch (error: unknown) {
          setRanges([]);
          setRangeLoadError(
            error instanceof Error ? error.message : "Invalid saved cut-ranges sidecar.",
          );
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRanges([]);
          setRangeLoadError(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [setRangeLoadError, setRanges, videoPath]);
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
      const registeredCleanup = await getCurrentWindow().onDragDropEvent((event) => {
        void handleDragDropEvent(event);
      });
      if (!mounted) {
        registeredCleanup();
        return;
      }
      cleanup = registeredCleanup;
    };

    setup().catch(() => {
      if (mounted) {
        setIsDropTargetActive(false);
      }
    });

    return () => {
      mounted = false;
      cleanup?.();
    };
  }, [applySelectedVideoPath, dropTargetRef, isActive, setIsDropTargetActive]);
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

const videoPlaybackErrorMessage = (mediaError: MediaError | null) => {
  if (!mediaError) {
    return "The selected video could not be played in the app preview.";
  }

  if (mediaError.code === mediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) {
    return "This video format/codec is not supported by the in-app preview. Try another file or re-encode to H.264/AAC MP4.";
  }

  if (mediaError.code === mediaError.MEDIA_ERR_DECODE) {
    return "The video could not be decoded in the in-app preview. Try re-encoding to H.264/AAC MP4.";
  }

  return "The selected video could not be played in the app preview.";
};

type EditorActionInputs = {
  analysisRunSettings: AnalysisRunSelection | null;
  applySelectedVideoPath: (selected: string | null, shouldSyncController?: boolean) => void;
  compressionPreset: CompressionPreset;
  controller: MediaController;
  currentTime: number;
  duration: number;
  markerStart: number | null;
  ranges: LocalRange[];
  selectedVideoPath: string | null;
  setAnalysisRunSettings: Dispatch<SetStateAction<AnalysisRunSelection | null>>;
  setCurrentTime: (value: number) => void;
  setDeleteError: (value: string | null) => void;
  setDuration: (value: number) => void;
  setHoverSeekPosition: (value: number | null) => void;
  setHoverSeekTime: (value: number | null) => void;
  setIsDeleteConfirmOpen: (value: boolean) => void;
  setIsDeletingVideo: (value: boolean) => void;
  setIsExporting: (value: boolean) => void;
  setIsShowingExportOutput: (value: boolean) => void;
  setIsSavingRanges: (value: boolean) => void;
  setMarkerEnd: (value: number | null) => void;
  setMarkerStart: (value: number | null) => void;
  setPlaybackError: (value: string | null) => void;
  setRangeSaveError: (value: string | null) => void;
  setRanges: Dispatch<SetStateAction<LocalRange[]>>;
  setSelectedVideoPath: (value: string | null) => void;
  setVideoPath: (value: string | null) => void;
  videoPath: string | null;
  videoRef: RefObject<HTMLVideoElement | null>;
};

const useEditorActions = ({
  analysisRunSettings,
  applySelectedVideoPath,
  compressionPreset,
  controller,
  currentTime,
  duration,
  markerStart,
  ranges,
  selectedVideoPath,
  setAnalysisRunSettings,
  setCurrentTime,
  setDeleteError,
  setDuration,
  setHoverSeekPosition,
  setHoverSeekTime,
  setIsDeleteConfirmOpen,
  setIsDeletingVideo,
  setIsExporting,
  setIsShowingExportOutput,
  setIsSavingRanges,
  setMarkerEnd,
  setMarkerStart,
  setPlaybackError,
  setRangeSaveError,
  setRanges,
  setSelectedVideoPath,
  setVideoPath,
  videoPath,
  videoRef,
}: EditorActionInputs) => {
  const chooseVideo = useCallback(async () => {
    const response = await open({
      directory: false,
      filters: [{ extensions: ["mp4", "mov"], name: "Videos" }],
      multiple: false,
    });
    const selectedPath = toPathList(response as string | string[] | null).at(0) ?? null;
    const selected = selectedPath ? normalizeDialogPath(selectedPath) : null;
    applySelectedVideoPath(selected);
  }, [applySelectedVideoPath]);

  const resetToOriginalVideo = useCallback(() => {
    if (selectedVideoPath) {
      applySelectedVideoPath(selectedVideoPath);
    }
  }, [applySelectedVideoPath, selectedVideoPath]);

  const clearVideo = useCallback(() => {
    videoRef.current?.pause();
    videoRef.current?.removeAttribute("src");
    videoRef.current?.load();
    applySelectedVideoPath(null);
  }, [applySelectedVideoPath, videoRef]);

  const handleVideoError = useCallback(() => {
    setPlaybackError(videoPlaybackErrorMessage(videoRef.current?.error ?? null));
  }, [setPlaybackError, videoRef]);

  const resetMarking = useCallback(() => {
    setMarkerStart(null);
    setMarkerEnd(null);
  }, [setMarkerEnd, setMarkerStart]);

  const markStart = useCallback(() => {
    if (videoRef.current) {
      setMarkerStart(videoRef.current.currentTime);
    }
  }, [setMarkerStart, videoRef]);

  const markEnd = useCallback(() => {
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
  }, [markerStart, resetMarking, setMarkerEnd, setRanges, videoRef]);

  const startCutExport = useCallback(async () => {
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
  }, [compressionPreset, controller, ranges, setIsExporting, setSelectedVideoPath, videoPath]);

  const saveSelectedRanges = useCallback(async () => {
    if (!videoPath) {
      return;
    }

    setRangeSaveError(null);
    setIsSavingRanges(true);
    try {
      await saveCutRanges({ ranges: toCutRanges(ranges), videoPath });
    } catch (error: unknown) {
      setRangeSaveError(toUnknownErrorMessage(error, "Failed saving cut ranges."));
    } finally {
      setIsSavingRanges(false);
    }
  }, [ranges, setIsSavingRanges, setRangeSaveError, videoPath]);

  const startSubtitleGeneration = useCallback(async () => {
    if (videoPath) {
      await controller.startTranscriptionForPaths([videoPath]);
    }
  }, [controller, videoPath]);

  const startFlaggedSectionAnalysis = useCallback(async () => {
    const srtSidecarPath = videoPath ? toSrtSidecarPath(videoPath) : null;
    if (srtSidecarPath && analysisRunSettings) {
      await controller.startFlaggingForPaths([srtSidecarPath], analysisRunSettings);
    }
  }, [analysisRunSettings, controller, videoPath]);

  const togglePlayback = useCallback(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    if (video.paused) {
      void video.play().catch(() => undefined);
      return;
    }

    video.pause();
  }, [videoRef]);

  const seekTo = useCallback(
    (time: number) => {
      if (!videoRef.current) {
        return;
      }

      const nextTime = clampSeekTime(time, duration);
      videoRef.current.currentTime = nextTime;
      setCurrentTime(nextTime);
    },
    [duration, setCurrentTime, videoRef],
  );

  const seekBackwardTen = useCallback(() => seekTo(currentTime - 10), [currentTime, seekTo]);
  const seekForwardTen = useCallback(() => seekTo(currentTime + 10), [currentTime, seekTo]);

  const openDeleteConfirmation = useCallback(() => {
    setDeleteError(null);
    setIsDeleteConfirmOpen(true);
  }, [setDeleteError, setIsDeleteConfirmOpen]);

  const cancelDeleteConfirmation = useCallback(() => {
    setIsDeleteConfirmOpen(false);
  }, [setIsDeleteConfirmOpen]);

  const confirmDeleteCurrentVideo = useCallback(async () => {
    if (!videoPath) {
      return;
    }

    setDeleteError(null);
    setIsDeletingVideo(true);
    try {
      await deleteVideoFiles(videoPath);
      applySelectedVideoPath(null);
    } catch (error: unknown) {
      setDeleteError(
        error instanceof Error ? error.message : "Failed deleting the selected files.",
      );
    } finally {
      setIsDeletingVideo(false);
    }
  }, [applySelectedVideoPath, setDeleteError, setIsDeletingVideo, videoPath]);

  const openExportOutput = useCallback(
    (path: string) => {
      setVideoPath(path);
      setPlaybackError(null);
      setCurrentTime(0);
      setDuration(0);
      setIsShowingExportOutput(true);
    },
    [setCurrentTime, setDuration, setIsShowingExportOutput, setPlaybackError, setVideoPath],
  );

  const removeRange = useCallback(
    (rangeId: string) => {
      setRanges((previous) => previous.filter((item) => item.id !== rangeId));
    },
    [setRanges],
  );

  const updateSeekHover = useCallback(
    (time: number, position: number) => {
      setHoverSeekTime(time);
      setHoverSeekPosition(position);
    },
    [setHoverSeekPosition, setHoverSeekTime],
  );

  const clearSeekHover = useCallback(() => {
    setHoverSeekTime(null);
    setHoverSeekPosition(null);
  }, [setHoverSeekPosition, setHoverSeekTime]);

  const updateAnalysisEngine = useCallback(
    (engine: ModerationEngine) => {
      setAnalysisRunSettings((previous) =>
        previous ? updateAnalysisRunEngine(previous, engine) : previous,
      );
    },
    [setAnalysisRunSettings],
  );

  const updateAnalysisStrategy = useCallback(
    (analysisStrategy: AnalysisStrategy) => {
      setAnalysisRunSettings((previous) =>
        previous ? { ...previous, analysisStrategy } : previous,
      );
    },
    [setAnalysisRunSettings],
  );

  return {
    cancelDeleteConfirmation,
    chooseVideo,
    clearSeekHover,
    clearVideo,
    confirmDeleteCurrentVideo,
    handleVideoError,
    markEnd,
    markStart,
    openDeleteConfirmation,
    openExportOutput,
    removeRange,
    resetMarking,
    resetToOriginalVideo,
    saveSelectedRanges,
    seekBackwardTen,
    seekForwardTen,
    seekTo,
    startCutExport,
    startFlaggedSectionAnalysis,
    startSubtitleGeneration,
    togglePlayback,
    updateAnalysisEngine,
    updateAnalysisStrategy,
    updateSeekHover,
  };
};

type EditorPanelViewProps = {
  analysisImportError: string | null;
  analysisImportMessage: string | null;
  analysisImportHasWarnings: boolean;
  analysisImportTargetRef: RefObject<HTMLDivElement | null>;
  analysisPromptRequest: AnalysisPromptPreviewRequest | null;
  analysisRunSettings: AnalysisRunSelection | null;
  analysisSettingsError: string | null;
  analysisSidecar: AnalysisSidecar | null;
  canAnalyze: boolean;
  canImportAnalysis: boolean;
  canResetToOriginal: boolean;
  compressionPreset: CompressionPreset;
  currentSubtitle?: SubtitleEntry;
  currentTime: number;
  cutError: string | null;
  cutFromLabel: string;
  cutOutputPath: string | null;
  cutTask: TaskState | undefined;
  cutUntilLabel: string;
  deleteError: string | null;
  duration: number;
  dropTargetRef: RefObject<HTMLDivElement | null>;
  flaggedSectionsBodyRef: RefObject<HTMLDivElement | null>;
  flaggedSectionsFilter: FlaggedSectionsFilter;
  flagError: string | null;
  flagTask: TaskState | undefined;
  handleVideoError: () => void;
  hasStartedMarking: boolean;
  hasSubtitleSidecar: boolean;
  hoverSeekPosition: number | null;
  hoverSeekTime: number | null;
  isCutTaskActive: boolean;
  isDeleteConfirmOpen: boolean;
  isDeletingVideo: boolean;
  isDropTargetActive: boolean;
  isExporting: boolean;
  isFlaggedSectionsOpen: boolean;
  isLoadingAnalysisSettings: boolean;
  isAnalysisImportActive: boolean;
  isImportingAnalysis: boolean;
  isPlaying: boolean;
  isSavingRanges: boolean;
  isShowingExportOutput: boolean;
  onAnalysisEngineChange: (engine: ModerationEngine) => void;
  onAnalysisStrategyChange: (strategy: AnalysisStrategy) => void;
  onChooseAnalysisFiles: () => void;
  onCancelDelete: () => void;
  onCancelTask: () => void;
  onClearVideo: () => void;
  onChooseVideo: () => void;
  onConfirmDelete: () => void;
  onDeleteVideo: () => void;
  onFlaggedSectionsOpenChange: (open: boolean) => void;
  onFlaggedSectionsScroll: (event: UIEvent<HTMLDivElement>) => void;
  onFlaggedFilterChange: (filter: FlaggedSectionsFilter) => void;
  onMarkEnd: () => void;
  onOpenOutput: (path: string) => void;
  onRemoveRange: (rangeId: string) => void;
  onResetToOriginal: () => void;
  onRetryAnalysisSettings: () => void;
  onSaveRanges: () => void;
  onSeek: (time: number) => void;
  onSeekBackwardTen: () => void;
  onSeekForwardTen: () => void;
  onSeekHover: (time: number, position: number) => void;
  onSeekHoverEnd: () => void;
  onSetCompressionPreset: (preset: CompressionPreset) => void;
  onStartAnalysis: () => void;
  onStartCutExport: () => void;
  onStartMark: () => void;
  onStartSubtitleGeneration: () => void;
  onStopMarking: () => void;
  onTogglePlayback: () => void;
  onVideoCurrentTime: (time: number) => void;
  onVideoDuration: (duration: number) => void;
  onVideoLoaded: () => void;
  onVideoPause: () => void;
  onVideoPlay: () => void;
  playbackError: string | null;
  ranges: LocalRange[];
  rangeSaveError: string | null;
  subtitleLoadError: string | null;
  transcriptionError: string | null;
  subtitles: SubtitleEntry[];
  transcriptionTask: TaskState | undefined;
  videoPath: string | null;
  videoRef: RefObject<HTMLVideoElement | null>;
  videoSrc: string | null;
};

type EditorToolbarProps = Pick<
  EditorPanelViewProps,
  | "canResetToOriginal"
  | "compressionPreset"
  | "cutFromLabel"
  | "cutUntilLabel"
  | "hasStartedMarking"
  | "isCutTaskActive"
  | "isDeletingVideo"
  | "isSavingRanges"
  | "onCancelTask"
  | "onClearVideo"
  | "onChooseVideo"
  | "onDeleteVideo"
  | "onResetToOriginal"
  | "onSaveRanges"
  | "onSetCompressionPreset"
  | "onStartCutExport"
  | "onStartMark"
  | "onMarkEnd"
  | "onStopMarking"
  | "ranges"
  | "videoPath"
>;

const EditorToolbar = ({
  canResetToOriginal,
  compressionPreset,
  cutFromLabel,
  cutUntilLabel,
  hasStartedMarking,
  isCutTaskActive,
  isDeletingVideo,
  isSavingRanges,
  onCancelTask,
  onClearVideo,
  onChooseVideo,
  onDeleteVideo,
  onResetToOriginal,
  onSaveRanges,
  onSetCompressionPreset,
  onStartCutExport,
  onStartMark,
  onMarkEnd,
  onStopMarking,
  ranges,
  videoPath,
}: EditorToolbarProps) => (
  <div className="flex flex-wrap gap-1.5">
    <Button type="button" variant="secondary" size="sm" onClick={onChooseVideo}>
      <Film className="size-3" />
      Choose Video
    </Button>
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={onClearVideo}
      disabled={!videoPath || isCutTaskActive || isDeletingVideo}
    >
      <X className="size-3" />
      Clear Video
    </Button>
    {canResetToOriginal ? (
      <Button type="button" variant="secondary" size="sm" onClick={onResetToOriginal}>
        <RotateCcw className="size-3" />
        Reset to Original
      </Button>
    ) : null}
    <Button
      type="button"
      variant="secondary"
      size="sm"
      onClick={onStartMark}
      disabled={!videoPath || hasStartedMarking}
    >
      {cutFromLabel}
    </Button>
    <Button
      type="button"
      variant="secondary"
      size="sm"
      onClick={onMarkEnd}
      disabled={!videoPath || !hasStartedMarking}
    >
      {cutUntilLabel}
    </Button>
    {hasStartedMarking ? (
      <Button type="button" variant="outline" size="sm" onClick={onStopMarking}>
        Cancel Marking
      </Button>
    ) : null}
    <label className="flex items-center gap-1.5 text-[#5b2722] text-xs">
      <span className="text-[#8f5e56]">Quality</span>
      <select
        value={compressionPreset}
        onChange={(event) => onSetCompressionPreset(event.currentTarget.value as CompressionPreset)}
        disabled={isCutTaskActive}
        className="h-8 rounded-[14px] border border-[#d9b7a5] bg-white px-2 text-[#4f1f1a] text-xs outline-none transition focus:border-[#88322d] focus:ring-[#c57267]/25 focus:ring-[2px] disabled:opacity-50"
      >
        <option value="apple_silicon">Fast high quality (Apple HEVC)</option>
        <option value="max_compression">Smallest file (slow HEVC)</option>
        <option value="balanced">Compatibility (slow H.264)</option>
      </select>
    </label>
    <Button
      type="button"
      size="sm"
      onClick={onStartCutExport}
      disabled={!videoPath || ranges.length === 0 || isCutTaskActive}
    >
      {isCutTaskActive ? <LoaderCircle className="size-3 animate-spin" /> : null}
      {isCutTaskActive ? "Exporting..." : "Export"}
    </Button>
    <Button
      type="button"
      variant="secondary"
      size="sm"
      onClick={onSaveRanges}
      disabled={!videoPath || isSavingRanges}
    >
      {isSavingRanges ? <LoaderCircle className="size-3 animate-spin" /> : null}
      {isSavingRanges ? "Saving Ranges..." : "Save Ranges"}
    </Button>
    {isCutTaskActive ? (
      <Button type="button" variant="danger" size="sm" onClick={onCancelTask}>
        Cancel Task
      </Button>
    ) : null}
    <Button
      type="button"
      variant="danger"
      size="sm"
      onClick={onDeleteVideo}
      disabled={!videoPath || isCutTaskActive || isDeletingVideo}
    >
      <Trash2 className="size-3" />
      Delete Video
    </Button>
  </div>
);

type EditorPreviewProps = Pick<
  EditorPanelViewProps,
  | "currentSubtitle"
  | "currentTime"
  | "duration"
  | "handleVideoError"
  | "hasSubtitleSidecar"
  | "hoverSeekPosition"
  | "hoverSeekTime"
  | "isPlaying"
  | "onSeek"
  | "onSeekBackwardTen"
  | "onSeekForwardTen"
  | "onSeekHover"
  | "onSeekHoverEnd"
  | "onTogglePlayback"
  | "onVideoCurrentTime"
  | "onVideoDuration"
  | "onVideoLoaded"
  | "onVideoPause"
  | "onVideoPlay"
  | "playbackError"
  | "videoPath"
  | "videoRef"
  | "videoSrc"
>;

const EditorPreview = ({
  currentSubtitle,
  currentTime,
  duration,
  handleVideoError,
  hasSubtitleSidecar,
  hoverSeekPosition,
  hoverSeekTime,
  isPlaying,
  onSeek,
  onSeekBackwardTen,
  onSeekForwardTen,
  onSeekHover,
  onSeekHoverEnd,
  onTogglePlayback,
  onVideoCurrentTime,
  onVideoDuration,
  onVideoLoaded,
  onVideoPause,
  onVideoPlay,
  playbackError,
  videoPath,
  videoRef,
  videoSrc,
}: EditorPreviewProps) => {
  if (!videoPath) {
    return (
      <div className="rounded-[22px] border border-[#e7d2c5] border-dashed bg-[#fff8f3] px-5 py-8 text-[#8f5e56] text-sm">
        Choose a video file to begin.
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden rounded-[24px] border border-[#ead3c4] bg-black shadow-[0_18px_40px_rgba(0,0,0,0.12)]">
      {videoSrc ? (
        <video
          key={videoSrc}
          ref={videoRef}
          src={videoSrc}
          playsInline
          preload="metadata"
          onLoadedData={onVideoLoaded}
          onLoadedMetadata={() => onVideoDuration(videoRef.current?.duration ?? 0)}
          onPlay={onVideoPlay}
          onPause={onVideoPause}
          onEnded={onVideoPause}
          onTimeUpdate={() => onVideoCurrentTime(videoRef.current?.currentTime ?? 0)}
          onError={handleVideoError}
          onClick={onTogglePlayback}
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
          onSeek={onSeek}
          onSeekBackwardTen={onSeekBackwardTen}
          onSeekForwardTen={onSeekForwardTen}
          onSeekHover={onSeekHover}
          onSeekHoverEnd={onSeekHoverEnd}
          onTogglePlayback={onTogglePlayback}
        />
      ) : null}
    </div>
  );
};

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
  const [compressionPreset, setCompressionPreset] = useState<CompressionPreset>("apple_silicon");
  const [isDropTargetActive, setIsDropTargetActive] = useState(false);
  const [sidecarRefreshKey, setSidecarRefreshKey] = useState(0);
  const [subtitles, setSubtitles] = useState<SubtitleEntry[]>([]);
  const [hasSubtitleSidecar, setHasSubtitleSidecar] = useState(false);
  const [subtitleLoadError, setSubtitleLoadError] = useState<string | null>(null);
  const [analysisSidecar, setAnalysisSidecar] = useState<AnalysisSidecar | null>(null);
  const [analysisPromptCriteria, setAnalysisPromptCriteria] =
    useState<AnalysisPromptCriteria | null>(null);
  const [analysisRunSettings, setAnalysisRunSettings] = useState<AnalysisRunSelection | null>(null);
  const [analysisSettingsError, setAnalysisSettingsError] = useState<string | null>(null);
  const [isLoadingAnalysisSettings, setIsLoadingAnalysisSettings] = useState(false);
  const [analysisImportError, setAnalysisImportError] = useState<string | null>(null);
  const [analysisImportMessage, setAnalysisImportMessage] = useState<string | null>(null);
  const [analysisImportHasWarnings, setAnalysisImportHasWarnings] = useState(false);
  const [isImportingAnalysis, setIsImportingAnalysis] = useState(false);
  const [isFlaggedSectionsOpen, setIsFlaggedSectionsOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const dropTargetRef = useRef<HTMLDivElement>(null);
  const flaggedSectionsBodyRef = useRef<HTMLDivElement | null>(null);
  const flaggedSectionsScrollPositionsRef = useRef(new Map<string, number>());
  const controllerRef = useRef(controller);
  const analysisSettingsRequestRef = useRef(0);
  const analysisImportRequestRef = useRef(0);
  const analysisImportVideoGenerationRef = useRef(0);
  controllerRef.current = controller;

  const { cutTask, flagTask, srtSidecarPath, transcriptionTask } = getEditorTaskState(
    controller.state.tasksById,
    selectedVideoPath,
    videoPath,
  );
  const isFlagTaskActive = flagTask?.status === "queued" || flagTask?.status === "running";
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
  const analysisSidecarPath = videoPath ? toAnalysisSidecarPath(videoPath) : null;
  const analysisPromptRequest = toAnalysisPromptRequest(
    analysisRunSettings,
    analysisPromptCriteria,
  );
  const flaggedSectionsScrollKey = videoPath;
  const sidecarTaskRefreshSignature = [
    transcriptionTask?.status,
    transcriptionTask?.jobs
      .map((job) => `${job.inputPath}:${job.status}:${job.outputPath ?? ""}`)
      .join(","),
    flagTask?.status,
    flagTask?.jobs.map((job) => `${job.inputPath}:${job.status}:${job.outputPath ?? ""}`).join(","),
  ].join("|");

  const handleFlaggedSectionsScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      if (flaggedSectionsScrollKey) {
        flaggedSectionsScrollPositionsRef.current.set(
          flaggedSectionsScrollKey,
          event.currentTarget.scrollTop,
        );
      }
    },
    [flaggedSectionsScrollKey],
  );

  useEffect(() => {
    if (!isFlaggedSectionsOpen || !flaggedSectionsScrollKey || !analysisSidecar) {
      return;
    }

    const frame = requestAnimationFrame(() => {
      const body = flaggedSectionsBodyRef.current;
      if (body) {
        body.scrollTop =
          flaggedSectionsScrollPositionsRef.current.get(flaggedSectionsScrollKey) ?? 0;
      }
    });

    return () => cancelAnimationFrame(frame);
  }, [analysisSidecar, flaggedSectionsScrollKey, isFlaggedSectionsOpen]);

  const applySelectedVideoPath = useCallback(
    (selected: string | null, shouldSyncController = true) => {
      analysisImportVideoGenerationRef.current += 1;
      analysisImportRequestRef.current += 1;
      controllerRef.current.clearError();
      if (shouldSyncController) {
        controllerRef.current.selectVideo(selected);
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
      setSubtitles([]);
      setHasSubtitleSidecar(false);
      setSubtitleLoadError(null);
      setAnalysisSidecar(null);
      setAnalysisImportError(null);
      setAnalysisImportMessage(null);
      setAnalysisImportHasWarnings(false);
      setIsImportingAnalysis(false);
      setFlaggedSectionsFilter("all");
      setIsFlaggedSectionsOpen(false);
      if (videoRef.current) {
        videoRef.current.load();
      }
    },
    [],
  );

  const loadAnalysisRunSettings = useCallback(async () => {
    const requestId = analysisSettingsRequestRef.current + 1;
    analysisSettingsRequestRef.current = requestId;
    setIsLoadingAnalysisSettings(true);
    setAnalysisSettingsError(null);
    setAnalysisPromptCriteria(null);

    try {
      const settings = await controllerRef.current.loadSettings();
      if (analysisSettingsRequestRef.current !== requestId) {
        return;
      }
      setAnalysisRunSettings(toAnalysisRunSelection(settings));
      setAnalysisPromptCriteria({
        contentCriteria: settings.contentCriteria,
        priorityGuidelines: settings.priorityGuidelines,
      });
    } catch (error: unknown) {
      if (analysisSettingsRequestRef.current !== requestId) {
        return;
      }
      setAnalysisRunSettings(null);
      setAnalysisPromptCriteria(null);
      setAnalysisSettingsError(
        error instanceof Error ? error.message : "Failed loading analysis settings.",
      );
    } finally {
      if (analysisSettingsRequestRef.current === requestId) {
        setIsLoadingAnalysisSettings(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!isActive) {
      return;
    }

    void loadAnalysisRunSettings();
    return () => {
      analysisSettingsRequestRef.current += 1;
    };
  }, [isActive, loadAnalysisRunSettings]);

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
      .catch((error: unknown) => {
        if (!isCancelled) {
          setPlaybackError(
            toUnknownErrorMessage(error, "The local video preview service could not start."),
          );
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
    setHasSubtitleSidecar,
    setSubtitleLoadError,
    setSubtitles,
  );

  useCutRangesSidecarLoading(videoPath, setRanges, setRangeSaveError);

  useEffect(() => {
    if (!sidecarTaskRefreshSignature) {
      return;
    }

    setSidecarRefreshKey((previous) => previous + 1);
  }, [sidecarTaskRefreshSignature]);

  useSelectedVideoSync(
    applySelectedVideoPath,
    isActive,
    controller.state.selectedVideoPath,
    videoPath,
    setIsDropTargetActive,
  );

  useVideoDropTarget(applySelectedVideoPath, dropTargetRef, isActive, setIsDropTargetActive);

  const importAnalysisFiles = useCallback(
    async (paths: string[]) => {
      if (!videoPath || !analysisSidecarPath || !srtSidecarPath) {
        return;
      }
      const requestId = analysisImportRequestRef.current + 1;
      const videoGeneration = analysisImportVideoGenerationRef.current;
      analysisImportRequestRef.current = requestId;
      const isCurrentRequest = () =>
        analysisImportRequestRef.current === requestId &&
        analysisImportVideoGenerationRef.current === videoGeneration;

      setAnalysisImportError(null);
      setAnalysisImportMessage(null);
      setAnalysisImportHasWarnings(false);
      setIsImportingAnalysis(true);
      try {
        const sourceFile = srtSidecarPath.split(/[\\/]/).at(-1) ?? srtSidecarPath;
        const result = await importAnalysisBundle({
          analysisSidecar,
          analysisSidecarPath,
          paths,
          sourceFile,
          subtitles,
          videoPath,
        });
        if (!isCurrentRequest()) {
          return;
        }
        setAnalysisSidecar(toAnalysisSidecar(result.bundle));
        setSidecarRefreshKey((previous) => previous + 1);
        setAnalysisImportMessage(formatAnalysisImportMessage(result));
        setAnalysisImportHasWarnings(result.skippedCount > 0);
      } catch (error: unknown) {
        if (isCurrentRequest()) {
          setAnalysisImportError(
            toUnknownErrorMessage(error, "Failed importing external analysis files."),
          );
        }
      } finally {
        if (isCurrentRequest()) {
          setIsImportingAnalysis(false);
        }
      }
    },
    [analysisSidecar, analysisSidecarPath, srtSidecarPath, subtitles, videoPath],
  );

  const chooseAnalysisFiles = useCallback(async () => {
    const response = await open({
      directory: false,
      filters: [{ extensions: ["json"], name: "Analysis JSON" }],
      multiple: true,
    });
    const paths = toPathList(response as string | string[] | null).map(normalizeDialogPath);
    if (paths.length > 0) {
      await importAnalysisFiles(paths);
    }
  }, [importAnalysisFiles]);

  const { dropTargetRef: analysisImportTargetRef, isDropTargetActive: isAnalysisImportActive } =
    useTauriFileDrop<HTMLDivElement>({
      enabled: isActive && videoPath !== null && !isFlagTaskActive,
      onDrop: importAnalysisFiles,
      onError: (error) =>
        setAnalysisImportError(toUnknownErrorMessage(error, "Failed importing analysis files.")),
      resolvePaths: async (paths) => validateAnalysisImportPaths(paths),
    });

  const {
    cancelDeleteConfirmation,
    chooseVideo,
    clearSeekHover,
    clearVideo,
    confirmDeleteCurrentVideo,
    handleVideoError,
    markEnd,
    markStart,
    openDeleteConfirmation,
    openExportOutput,
    removeRange,
    resetMarking,
    resetToOriginalVideo,
    saveSelectedRanges,
    seekBackwardTen,
    seekForwardTen,
    seekTo,
    startCutExport,
    startFlaggedSectionAnalysis,
    startSubtitleGeneration,
    togglePlayback,
    updateAnalysisEngine,
    updateAnalysisStrategy,
    updateSeekHover,
  } = useEditorActions({
    analysisRunSettings,
    applySelectedVideoPath,
    compressionPreset,
    controller,
    currentTime,
    duration,
    markerStart,
    ranges,
    selectedVideoPath,
    setAnalysisRunSettings,
    setCurrentTime,
    setDeleteError,
    setDuration,
    setHoverSeekPosition,
    setHoverSeekTime,
    setIsDeleteConfirmOpen,
    setIsDeletingVideo,
    setIsExporting,
    setIsSavingRanges,
    setIsShowingExportOutput,
    setMarkerEnd,
    setMarkerStart,
    setPlaybackError,
    setRangeSaveError,
    setRanges,
    setSelectedVideoPath,
    setVideoPath,
    videoPath,
    videoRef,
  });

  return (
    <EditorPanelView
      analysisImportError={analysisImportError}
      analysisImportMessage={analysisImportMessage}
      analysisImportHasWarnings={analysisImportHasWarnings}
      analysisImportTargetRef={analysisImportTargetRef}
      analysisPromptRequest={analysisPromptRequest}
      analysisRunSettings={analysisRunSettings}
      analysisSettingsError={analysisSettingsError}
      analysisSidecar={analysisSidecar}
      canAnalyze={
        srtSidecarPath !== null &&
        hasSubtitleSidecar &&
        analysisRunSettings !== null &&
        !isLoadingAnalysisSettings
      }
      canImportAnalysis={videoPath !== null && !isFlagTaskActive}
      canResetToOriginal={canResetToOriginal}
      compressionPreset={compressionPreset}
      currentSubtitle={currentSubtitle}
      currentTime={currentTime}
      cutError={getTaskStartError(
        controller.state.errorTaskKind,
        controller.state.errorMessage,
        "cut",
      )}
      cutFromLabel={cutFromLabel}
      cutOutputPath={cutOutputPath}
      cutTask={cutTask}
      cutUntilLabel={cutUntilLabel}
      deleteError={deleteError}
      duration={duration}
      dropTargetRef={dropTargetRef}
      flaggedSectionsBodyRef={flaggedSectionsBodyRef}
      flaggedSectionsFilter={flaggedSectionsFilter}
      flagTask={flagTask}
      flagError={getTaskStartError(
        controller.state.errorTaskKind,
        controller.state.errorMessage,
        "flag",
      )}
      handleVideoError={handleVideoError}
      hasStartedMarking={hasStartedMarking}
      hasSubtitleSidecar={hasSubtitleSidecar}
      hoverSeekPosition={hoverSeekPosition}
      hoverSeekTime={hoverSeekTime}
      isCutTaskActive={isCutTaskActive}
      isDeleteConfirmOpen={isDeleteConfirmOpen}
      isDeletingVideo={isDeletingVideo}
      isDropTargetActive={isDropTargetActive}
      isExporting={isExporting}
      isFlaggedSectionsOpen={isFlaggedSectionsOpen}
      isLoadingAnalysisSettings={isLoadingAnalysisSettings}
      isAnalysisImportActive={isAnalysisImportActive}
      isImportingAnalysis={isImportingAnalysis}
      isPlaying={isPlaying}
      isSavingRanges={isSavingRanges}
      isShowingExportOutput={isShowingExportOutput}
      onAnalysisEngineChange={updateAnalysisEngine}
      onAnalysisStrategyChange={updateAnalysisStrategy}
      onChooseAnalysisFiles={() => void chooseAnalysisFiles()}
      onCancelDelete={cancelDeleteConfirmation}
      onCancelTask={() => void controller.cancelTaskById(cutTask?.taskId ?? null)}
      onClearVideo={clearVideo}
      onChooseVideo={chooseVideo}
      onConfirmDelete={confirmDeleteCurrentVideo}
      onDeleteVideo={openDeleteConfirmation}
      onFlaggedSectionsOpenChange={setIsFlaggedSectionsOpen}
      onFlaggedSectionsScroll={handleFlaggedSectionsScroll}
      onFlaggedFilterChange={setFlaggedSectionsFilter}
      onMarkEnd={markEnd}
      onOpenOutput={openExportOutput}
      onRemoveRange={removeRange}
      onResetToOriginal={resetToOriginalVideo}
      onRetryAnalysisSettings={() => void loadAnalysisRunSettings()}
      onSaveRanges={saveSelectedRanges}
      onSeek={seekTo}
      onSeekBackwardTen={seekBackwardTen}
      onSeekForwardTen={seekForwardTen}
      onSeekHover={updateSeekHover}
      onSeekHoverEnd={clearSeekHover}
      onSetCompressionPreset={setCompressionPreset}
      onStartAnalysis={startFlaggedSectionAnalysis}
      onStartCutExport={startCutExport}
      onStartMark={markStart}
      onStartSubtitleGeneration={startSubtitleGeneration}
      onStopMarking={resetMarking}
      onTogglePlayback={togglePlayback}
      onVideoCurrentTime={setCurrentTime}
      onVideoDuration={setDuration}
      onVideoLoaded={() => setPlaybackError(null)}
      onVideoPause={() => setIsPlaying(false)}
      onVideoPlay={() => setIsPlaying(true)}
      playbackError={playbackError}
      ranges={ranges}
      rangeSaveError={rangeSaveError}
      subtitleLoadError={subtitleLoadError}
      transcriptionError={getTaskStartError(
        controller.state.errorTaskKind,
        controller.state.errorMessage,
        "transcription",
      )}
      subtitles={subtitles}
      transcriptionTask={transcriptionTask}
      videoPath={videoPath}
      videoRef={videoRef}
      videoSrc={videoSrc}
    />
  );
};

const EditorPanelView = ({
  analysisImportError,
  analysisImportMessage,
  analysisImportHasWarnings,
  analysisImportTargetRef,
  analysisPromptRequest,
  analysisRunSettings,
  analysisSettingsError,
  analysisSidecar,
  canAnalyze,
  canImportAnalysis,
  canResetToOriginal,
  compressionPreset,
  currentSubtitle,
  currentTime,
  cutError,
  cutFromLabel,
  cutOutputPath,
  cutTask,
  cutUntilLabel,
  deleteError,
  duration,
  dropTargetRef,
  flaggedSectionsBodyRef,
  flaggedSectionsFilter,
  flagError,
  flagTask,
  handleVideoError,
  hasStartedMarking,
  hasSubtitleSidecar,
  hoverSeekPosition,
  hoverSeekTime,
  isCutTaskActive,
  isDeleteConfirmOpen,
  isDeletingVideo,
  isDropTargetActive,
  isExporting,
  isFlaggedSectionsOpen,
  isLoadingAnalysisSettings,
  isAnalysisImportActive,
  isImportingAnalysis,
  isPlaying,
  isSavingRanges,
  isShowingExportOutput,
  onAnalysisEngineChange,
  onAnalysisStrategyChange,
  onChooseAnalysisFiles,
  onCancelDelete,
  onCancelTask,
  onClearVideo,
  onChooseVideo,
  onConfirmDelete,
  onDeleteVideo,
  onFlaggedSectionsOpenChange,
  onFlaggedSectionsScroll,
  onFlaggedFilterChange,
  onMarkEnd,
  onOpenOutput,
  onRemoveRange,
  onResetToOriginal,
  onRetryAnalysisSettings,
  onSaveRanges,
  onSeek,
  onSeekBackwardTen,
  onSeekForwardTen,
  onSeekHover,
  onSeekHoverEnd,
  onSetCompressionPreset,
  onStartAnalysis,
  onStartCutExport,
  onStartMark,
  onStartSubtitleGeneration,
  onStopMarking,
  onTogglePlayback,
  onVideoCurrentTime,
  onVideoDuration,
  onVideoLoaded,
  onVideoPause,
  onVideoPlay,
  playbackError,
  ranges,
  rangeSaveError,
  subtitleLoadError,
  transcriptionError,
  subtitles,
  transcriptionTask,
  videoPath,
  videoRef,
  videoSrc,
}: EditorPanelViewProps) => (
  <Card
    ref={dropTargetRef}
    className={`transition ${
      isDropTargetActive ? "bg-[#fff1e8] shadow-[0_0_0_2px_rgba(197,114,103,0.28)]" : ""
    }`}
  >
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
          onOpenOutput={onOpenOutput}
          onRemoveRange={onRemoveRange}
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
          onSeek={onSeek}
          onStartTranscription={onStartSubtitleGeneration}
          transcriptionError={transcriptionError}
          subtitleLoadError={subtitleLoadError}
          subtitles={subtitles}
          transcriptionTask={transcriptionTask}
        />
      </TaskDrawer>
      <TaskDrawer
        bodyRef={flaggedSectionsBodyRef}
        triggerLabel="Flagged Sections"
        title="Flagged Sections"
        description="Quick jump to flagged content."
        modal={false}
        open={isFlaggedSectionsOpen}
        onBodyScroll={onFlaggedSectionsScroll}
        onOpenChange={onFlaggedSectionsOpenChange}
      >
        <FlaggedSectionsDrawerContent
          analysisImportError={analysisImportError}
          analysisImportMessage={analysisImportMessage}
          analysisImportHasWarnings={analysisImportHasWarnings}
          analysisImportTargetRef={analysisImportTargetRef}
          analysisPromptRequest={analysisPromptRequest}
          analysisSidecar={analysisSidecar}
          analysisSettingsError={analysisSettingsError}
          analysisRunSettings={analysisRunSettings}
          canAnalyze={canAnalyze}
          canImportAnalysis={canImportAnalysis}
          filter={flaggedSectionsFilter}
          flagError={flagError}
          flagTask={flagTask}
          isLoadingAnalysisSettings={isLoadingAnalysisSettings}
          isAnalysisImportActive={isAnalysisImportActive}
          isImportingAnalysis={isImportingAnalysis}
          onAnalysisEngineChange={onAnalysisEngineChange}
          onAnalysisStrategyChange={onAnalysisStrategyChange}
          onChooseAnalysisFiles={onChooseAnalysisFiles}
          onFilterChange={onFlaggedFilterChange}
          onRetryAnalysisSettings={onRetryAnalysisSettings}
          onStartAnalysis={onStartAnalysis}
          onSeek={onSeek}
        />
      </TaskDrawer>
    </CardHeader>
    <CardContent>
      <div className="space-y-2">
        <EditorToolbar
          canResetToOriginal={canResetToOriginal}
          compressionPreset={compressionPreset}
          cutFromLabel={cutFromLabel}
          cutUntilLabel={cutUntilLabel}
          hasStartedMarking={hasStartedMarking}
          isCutTaskActive={isCutTaskActive}
          isDeletingVideo={isDeletingVideo}
          isSavingRanges={isSavingRanges}
          onCancelTask={onCancelTask}
          onClearVideo={onClearVideo}
          onChooseVideo={onChooseVideo}
          onDeleteVideo={onDeleteVideo}
          onMarkEnd={onMarkEnd}
          onResetToOriginal={onResetToOriginal}
          onSaveRanges={onSaveRanges}
          onSetCompressionPreset={onSetCompressionPreset}
          onStartCutExport={onStartCutExport}
          onStartMark={onStartMark}
          onStopMarking={onStopMarking}
          ranges={ranges}
          videoPath={videoPath}
        />

        {rangeSaveError ? <p className="text-[#b5453d] text-xs">{rangeSaveError}</p> : null}

        {isDeleteConfirmOpen ? (
          <DeleteVideoConfirmationCard
            isDeletingVideo={isDeletingVideo}
            onCancel={onCancelDelete}
            onConfirm={onConfirmDelete}
          />
        ) : null}

        <EditorPreview
          currentSubtitle={currentSubtitle}
          currentTime={currentTime}
          duration={duration}
          handleVideoError={handleVideoError}
          hasSubtitleSidecar={hasSubtitleSidecar}
          hoverSeekPosition={hoverSeekPosition}
          hoverSeekTime={hoverSeekTime}
          isPlaying={isPlaying}
          onSeek={onSeek}
          onSeekBackwardTen={onSeekBackwardTen}
          onSeekForwardTen={onSeekForwardTen}
          onSeekHover={onSeekHover}
          onSeekHoverEnd={onSeekHoverEnd}
          onTogglePlayback={onTogglePlayback}
          onVideoCurrentTime={onVideoCurrentTime}
          onVideoDuration={onVideoDuration}
          onVideoLoaded={onVideoLoaded}
          onVideoPause={onVideoPause}
          onVideoPlay={onVideoPlay}
          playbackError={playbackError}
          videoPath={videoPath}
          videoRef={videoRef}
          videoSrc={videoSrc}
        />

        <CutVideoStatusMessages
          cutError={cutError}
          cutTask={cutTask}
          deleteError={deleteError}
          isCutTaskActive={isCutTaskActive}
          isShowingExportOutput={isShowingExportOutput}
          playbackError={playbackError}
          subtitleLoadError={subtitleLoadError}
        />
      </div>
    </CardContent>
  </Card>
);

export default SimpleCutEditorPanel;
