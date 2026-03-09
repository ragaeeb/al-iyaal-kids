import { open } from "@tauri-apps/plugin-dialog";
import { Film, LoaderCircle, Plus, Scissors, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { TaskDrawer } from "@/components/task-drawer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DrawerClose } from "@/components/ui/drawer";
import { findSubtitleAtTime, formatTime, parseSrt } from "@/features/editor/subtitles";
import { readTextFile } from "@/features/media/transport";
import type { AnalysisSidecar, CutRange, SubtitleEntry, TaskState } from "@/features/media/types";
import type { useMediaController } from "@/features/media/useMediaController";
import { parseAnalysisSidecar } from "@/features/moderation/results";
import { convertFileSrc } from "@/lib/tauri";

type MediaController = ReturnType<typeof useMediaController>;

type SimpleCutEditorPanelProps = {
  controller: MediaController;
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

const toTimeToken = (value: number) => value.toFixed(3);

const toCutRanges = (ranges: LocalRange[]): CutRange[] => {
  return ranges.map((range) => ({
    end: toTimeToken(range.end),
    start: toTimeToken(range.start),
  }));
};

const toSrtSidecarPath = (path: string) => path.replace(/\.[^.]+$/, ".srt");
const toAnalysisSidecarPath = (path: string) => path.replace(/\.[^.]+$/, ".analysis.json");

const resetLoadedSidecars = (
  setAnalysisSidecar: (value: AnalysisSidecar | null) => void,
  setHasSubtitleSidecar: (value: boolean) => void,
  setSubtitles: (value: SubtitleEntry[]) => void,
) => {
  setSubtitles([]);
  setHasSubtitleSidecar(false);
  setAnalysisSidecar(null);
};

const applyLoadedSidecars = (
  analysisResult: PromiseSettledResult<string>,
  subtitleResult: PromiseSettledResult<string>,
  setAnalysisSidecar: (value: AnalysisSidecar | null) => void,
  setHasSubtitleSidecar: (value: boolean) => void,
  setSubtitles: (value: SubtitleEntry[]) => void,
) => {
  if (subtitleResult.status === "fulfilled") {
    setSubtitles(parseSrt(subtitleResult.value));
    setHasSubtitleSidecar(true);
  } else {
    setSubtitles([]);
    setHasSubtitleSidecar(false);
  }

  if (analysisResult.status === "fulfilled") {
    setAnalysisSidecar(parseAnalysisSidecar(analysisResult.value));
    return;
  }

  setAnalysisSidecar(null);
};

const toCurrentSliceLabel = (markerStart: number | null, markerEnd: number | null) => {
  if (markerStart === null && markerEnd === null) {
    return "Mark a start and end point to define the next slice.";
  }

  if (markerStart !== null && markerEnd === null) {
    return `Current slice start: ${formatTime(markerStart)}. Mark the end point next.`;
  }

  if (markerStart === null && markerEnd !== null) {
    return `Current slice end: ${formatTime(markerEnd)}. Mark the start point first.`;
  }

  if (markerStart !== null && markerEnd !== null && markerEnd > markerStart) {
    return `Current slice: ${formatTime(markerStart)} - ${formatTime(markerEnd)}.`;
  }

  return "End must be after start to create a valid slice.";
};

const CurrentSliceCard = ({
  markerEnd,
  markerStart,
}: {
  markerEnd: number | null;
  markerStart: number | null;
}) => (
  <div className="rounded-[22px] border border-[#ead3c4] bg-[#fffaf6] px-3 py-3">
    <p className="text-[#8f5e56] text-sm">Current Slice</p>
    <p className="mt-2 font-mono text-[#5b2722] text-sm">
      {markerStart === null ? "[Start-time]" : formatTime(markerStart)} -{" "}
      {markerEnd === null ? "[End time]" : formatTime(markerEnd)}
    </p>
    <p className="mt-1 text-[#7f524a] text-xs">{toCurrentSliceLabel(markerStart, markerEnd)}</p>
  </div>
);

type FlaggedSectionsDrawerContentProps = {
  analysisSidecar: AnalysisSidecar | null;
  onSeek: (time: number) => void;
};

const FlaggedSectionsDrawerContent = ({
  analysisSidecar,
  onSeek,
}: FlaggedSectionsDrawerContentProps) => {
  if (!analysisSidecar) {
    return (
      <p className="rounded-[22px] border border-[#e7d2c5] border-dashed bg-[#fff8f3] px-4 py-5 text-[#8f5e56] text-sm">
        No `.analysis.json` sidecar was found for this video.
      </p>
    );
  }

  if (analysisSidecar.flagged.length === 0) {
    return (
      <p className="rounded-[22px] border border-[#e7d2c5] border-dashed bg-[#fff8f3] px-4 py-5 text-[#8f5e56] text-sm">
        Analysis exists, but no flagged sections were found.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {analysisSidecar.flagged.map((segment) => (
        <button
          key={`${segment.startTime}-${segment.endTime}-${segment.ruleId}`}
          type="button"
          onClick={() => onSeek(segment.startTime)}
          className="w-full rounded-[18px] border border-[#ead3c4] bg-[#fffaf7] px-3 py-3 text-left transition hover:border-[#c57267] hover:bg-white"
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
          </div>
          <p className="mt-2 font-medium text-[#5b2722] text-sm">{segment.reason}</p>
          <p className="mt-1 text-[#7f524a] text-sm">{segment.text}</p>
        </button>
      ))}
    </div>
  );
};

const CurrentSubtitleCard = ({
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
  if (playbackError) {
    return null;
  }

  return (
    <div className="rounded-[22px] border border-[#ead3c4] bg-[#fffaf6] px-3 py-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[#8f5e56] text-sm">Subtitle At Cursor</p>
        <span className="font-mono text-[#7f524a] text-xs">
          {formatTime(currentTime, currentTime)}
        </span>
      </div>
      {!hasSubtitleSidecar ? (
        <p className="mt-2 text-[#7f524a] text-sm">
          No `.srt` sidecar was found for this video yet.
        </p>
      ) : subtitle ? (
        <div className="mt-2 rounded-[18px] border border-[#ead3c4] bg-white px-3 py-2.5">
          <p className="font-mono text-[#7f524a] text-xs">
            {formatTime(subtitle.startTime, subtitle.endTime)} -{" "}
            {formatTime(subtitle.endTime, subtitle.endTime)}
          </p>
          <p className="mt-1 text-[#5b2722] text-sm">{subtitle.text}</p>
        </div>
      ) : (
        <p className="mt-2 text-[#7f524a] text-sm">
          No subtitle is active at the current playback time.
        </p>
      )}
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

const RangesDrawerContent = ({
  cutOutputPath,
  cutTask,
  isExporting,
  onOpenOutput,
  onRemoveRange,
  ranges,
}: RangesDrawerContentProps) => (
  <div className="flex min-h-0 flex-1 flex-col">
    <div className="flex items-start justify-between gap-4">
      <div className="flex flex-col gap-1">
        <h3 className="font-semibold text-[#5b2722] text-xl">Cut Task And Ranges</h3>
        <p className="text-[#8f5e56] text-sm">
          Export status and the full list of saved cut ranges for this session.
        </p>
      </div>
      <DrawerClose>Close</DrawerClose>
    </div>
    <div className="mt-4 min-h-0 flex-1 space-y-4 overflow-auto pr-1">
      {cutTask ? (
        <div className="rounded-[20px] border border-[#ead3c4] bg-[#fffaf6] px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <p className="font-medium text-[#5b2722] text-sm">{cutTask.taskId}</p>
            <Badge variant={cutTask.status === "completed" ? "completed" : "running"}>
              {cutTask.status}
            </Badge>
          </div>
          <p className="mt-2 text-[#8f5e56] text-sm">
            {isExporting ? "Export in progress..." : "Ready."}
          </p>
          {cutOutputPath ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => onOpenOutput(cutOutputPath)}
            >
              Preview Output
            </Button>
          ) : null}
        </div>
      ) : (
        <p className="rounded-[22px] border border-[#e7d2c5] border-dashed bg-[#fff8f3] px-4 py-5 text-[#8f5e56] text-sm">
          No cut task has run yet.
        </p>
      )}

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <p className="font-medium text-[#5b2722] text-sm">Saved Ranges</p>
          <Badge variant="queued">{ranges.length}</Badge>
        </div>
        {ranges.length === 0 ? (
          <p className="rounded-[22px] border border-[#e7d2c5] border-dashed bg-[#fff8f3] px-4 py-5 text-[#8f5e56] text-sm">
            No ranges yet.
          </p>
        ) : (
          ranges.map((range) => (
            <div
              key={range.id}
              className="rounded-[22px] border border-[#ead3c4] bg-[#fffaf7] p-3.5"
            >
              <p className="font-mono text-[#5f2823] text-sm">
                {formatTime(range.start)} - {formatTime(range.end)}
              </p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="mt-2"
                onClick={() => onRemoveRange(range.id)}
              >
                <Trash2 className="size-4" />
                Remove
              </Button>
            </div>
          ))
        )}
      </div>
    </div>
  </div>
);

const SimpleCutEditorPanel = ({ controller }: SimpleCutEditorPanelProps) => {
  const [videoPath, setVideoPath] = useState<string | null>(null);
  const [markerStart, setMarkerStart] = useState<number | null>(null);
  const [markerEnd, setMarkerEnd] = useState<number | null>(null);
  const [ranges, setRanges] = useState<LocalRange[]>([]);
  const [isExporting, setIsExporting] = useState(false);
  const [isShowingExportOutput, setIsShowingExportOutput] = useState(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [subtitles, setSubtitles] = useState<SubtitleEntry[]>([]);
  const [hasSubtitleSidecar, setHasSubtitleSidecar] = useState(false);
  const [analysisSidecar, setAnalysisSidecar] = useState<AnalysisSidecar | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const cutTask = useMemo(() => {
    return Object.values(controller.state.tasksById)
      .filter((task) => task.taskKind === "cut")
      .at(-1);
  }, [controller.state.tasksById]);

  const cutOutputPath = useMemo(() => {
    if (!cutTask) {
      return null;
    }
    return cutTask.jobs.find((job) => typeof job.outputPath === "string")?.outputPath ?? null;
  }, [cutTask]);

  const currentSubtitle = useMemo(
    () => findSubtitleAtTime(subtitles, currentTime),
    [subtitles, currentTime],
  );
  const isCutTaskActive =
    isExporting || cutTask?.status === "queued" || cutTask?.status === "running";

  useEffect(() => {
    if (cutTask?.status !== "completed" || !cutOutputPath) {
      return;
    }

    setVideoPath(cutOutputPath);
    setPlaybackError(null);
    setCurrentTime(0);
    setIsShowingExportOutput(true);
  }, [cutOutputPath, cutTask?.status]);

  useEffect(() => {
    let cancelled = false;

    const loadSidecars = async () => {
      if (!videoPath) {
        resetLoadedSidecars(setAnalysisSidecar, setHasSubtitleSidecar, setSubtitles);
        return;
      }

      try {
        const [subtitleContent, analysisContent] = await Promise.allSettled([
          readTextFile(toSrtSidecarPath(videoPath)),
          readTextFile(toAnalysisSidecarPath(videoPath)),
        ]);

        if (cancelled) {
          return;
        }

        applyLoadedSidecars(
          analysisContent,
          subtitleContent,
          setAnalysisSidecar,
          setHasSubtitleSidecar,
          setSubtitles,
        );
      } catch {
        if (cancelled) {
          return;
        }
        resetLoadedSidecars(setAnalysisSidecar, setHasSubtitleSidecar, setSubtitles);
      }
    };

    loadSidecars().catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [videoPath]);

  const chooseVideo = async () => {
    const response = await open({
      directory: false,
      filters: [{ extensions: ["mp4", "mov"], name: "Videos" }],
      multiple: false,
    });
    const selectedPath = toPathList(response as string | string[] | null).at(0) ?? null;
    const selected = selectedPath ? normalizeDialogPath(selectedPath) : null;
    setVideoPath(selected);
    setRanges([]);
    setMarkerStart(null);
    setMarkerEnd(null);
    setPlaybackError(null);
    setCurrentTime(0);
    setIsShowingExportOutput(false);
    if (videoRef.current) {
      videoRef.current.load();
    }
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
    if (!videoRef.current) {
      return;
    }
    setMarkerEnd(videoRef.current.currentTime);
  };

  const addRange = () => {
    if (markerStart === null || markerEnd === null || markerEnd <= markerStart) {
      return;
    }
    setRanges((previous) => [
      ...previous,
      {
        end: markerEnd,
        id: `${markerStart}-${markerEnd}-${previous.length}`,
        start: markerStart,
      },
    ]);
    setMarkerStart(null);
    setMarkerEnd(null);
  };

  const startCutExport = async () => {
    if (!videoPath || ranges.length === 0) {
      return;
    }
    setIsExporting(true);
    await controller.startCut(videoPath, toCutRanges(ranges));
    setIsExporting(false);
  };

  return (
    <Card>
      <CardHeader className="grid grid-cols-[1fr_auto] gap-4">
        <div>
          <CardTitle className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-2xl bg-[#f5e6dc] text-[#88322d]">
              <Scissors className="size-4" />
            </span>
            Cut Video
          </CardTitle>
          <p className="mt-1.5 text-[#8f5e56] text-sm">
            Choose a video, mark the slice you want to remove, review subtitles at the current time,
            and export exact cut ranges.
          </p>
        </div>
        <TaskDrawer
          triggerLabel="Ranges And Task"
          title="Cut Task And Ranges"
          description="Export status and the full list of saved cut ranges for this session."
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
          triggerLabel="Flagged Sections"
          title="Flagged Sections"
          description="Jump directly to timestamps that were flagged in the analysis sidecar."
        >
          <FlaggedSectionsDrawerContent
            analysisSidecar={analysisSidecar}
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
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={chooseVideo}>
            <Film className="size-4" />
            Choose Video
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={markStart}
            disabled={!videoPath}
          >
            Mark Start
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={markEnd}
            disabled={!videoPath}
          >
            Mark End
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={addRange}
            disabled={!videoPath}
          >
            <Plus className="size-4" />
            Add Range
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={startCutExport}
            disabled={!videoPath || ranges.length === 0 || isCutTaskActive}
          >
            {isCutTaskActive ? <LoaderCircle className="size-4 animate-spin" /> : null}
            {isCutTaskActive ? "Exporting..." : "Export"}
          </Button>
          <Button
            type="button"
            variant="danger"
            size="sm"
            onClick={() => controller.cancelTaskById(cutTask?.taskId ?? null)}
          >
            Cancel Task
          </Button>
        </div>

        <div className="grid gap-3 xl:grid-cols-[280px_minmax(0,1fr)]">
          <CurrentSliceCard markerEnd={markerEnd} markerStart={markerStart} />
          <CurrentSubtitleCard
            currentTime={currentTime}
            hasSubtitleSidecar={hasSubtitleSidecar}
            playbackError={playbackError}
            subtitle={currentSubtitle}
          />
        </div>

        {videoPath ? (
          <div className="overflow-hidden rounded-[24px] border border-[#ead3c4] bg-black shadow-[0_18px_40px_rgba(0,0,0,0.12)]">
            <video
              key={videoPath}
              ref={videoRef}
              src={convertFileSrc(videoPath)}
              controls
              playsInline
              preload="metadata"
              onLoadedData={() => setPlaybackError(null)}
              onTimeUpdate={() => setCurrentTime(videoRef.current?.currentTime ?? 0)}
              onError={handleVideoError}
              className="aspect-video w-full bg-black"
            >
              <track kind="captions" />
            </video>
          </div>
        ) : (
          <div className="rounded-[22px] border border-[#e7d2c5] border-dashed bg-[#fff8f3] px-5 py-8 text-[#8f5e56] text-sm">
            Choose a video file to begin.
          </div>
        )}

        {playbackError ? (
          <div className="rounded-[20px] border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900 text-sm">
            {playbackError}
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
      </CardContent>
    </Card>
  );
};

export { SimpleCutEditorPanel };
