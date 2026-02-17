import { open } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";
import { Film, Plus, Scissors, Trash2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardTitle } from "@/components/ui/card";
import { formatTime } from "@/features/editor/subtitles";
import type { CutRange } from "@/features/media/types";
import type { useMediaController } from "@/features/media/useMediaController";
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

const SimpleCutEditorPanel = ({ controller }: SimpleCutEditorPanelProps) => {
  const [videoPath, setVideoPath] = useState<string | null>(null);
  const [markerStart, setMarkerStart] = useState<number | null>(null);
  const [markerEnd, setMarkerEnd] = useState<number | null>(null);
  const [ranges, setRanges] = useState<LocalRange[]>([]);
  const [isExporting, setIsExporting] = useState(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
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
      <CardTitle className="flex items-center gap-2">
        <Scissors className="size-5 text-[#88322d]" />
        Video Cut Editor
      </CardTitle>
      <CardDescription>
        Keep it simple: choose a video, mark start/end points from the current seek position, and
        export.
      </CardDescription>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={chooseVideo}>
            <Film className="size-4" />
            Choose Video
          </Button>
          <Button type="button" variant="secondary" onClick={markStart} disabled={!videoPath}>
            Mark Start
          </Button>
          <Button type="button" variant="secondary" onClick={markEnd} disabled={!videoPath}>
            Mark End
          </Button>
          <Button type="button" variant="secondary" onClick={addRange} disabled={!videoPath}>
            <Plus className="size-4" />
            Add Cut Range
          </Button>
          <Button
            type="button"
            onClick={startCutExport}
            disabled={!videoPath || ranges.length === 0}
          >
            Export
          </Button>
          <Button type="button" variant="danger" onClick={controller.cancelActiveTask}>
            Cancel Active Task
          </Button>
          {cutOutputPath ? (
            <Button type="button" variant="secondary" onClick={() => openPath(cutOutputPath)}>
              Open Output
            </Button>
          ) : null}
        </div>

        {videoPath ? (
          <video
            key={videoPath}
            ref={videoRef}
            src={convertFileSrc(videoPath)}
            controls
            playsInline
            preload="metadata"
            onLoadedData={() => setPlaybackError(null)}
            onError={handleVideoError}
            className="w-full rounded-lg border border-[#d1968f]/40 bg-black"
          >
            <track kind="captions" />
          </video>
        ) : (
          <p className="text-[#6e3933] text-sm">Choose a video file to begin.</p>
        )}

        {playbackError ? (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900 text-sm">
            {playbackError}
          </div>
        ) : null}

        <div className="rounded-md border border-[#d1968f]/40 bg-white/70 p-3">
          <p className="mb-2 text-[#6e3933] text-xs">
            Marker Start: {markerStart === null ? "-" : formatTime(markerStart)} | Marker End:{" "}
            {markerEnd === null ? "-" : formatTime(markerEnd)}
          </p>
          <div className="max-h-44 space-y-2 overflow-auto">
            {ranges.length === 0 ? (
              <p className="text-[#6e3933] text-sm">No ranges yet.</p>
            ) : (
              ranges.map((range) => (
                <div
                  key={range.id}
                  className="flex items-center justify-between rounded border border-[#e6c8b8] p-2"
                >
                  <p className="font-mono text-[#5f2823] text-xs">
                    {formatTime(range.start)} - {formatTime(range.end)}
                  </p>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() =>
                      setRanges((previous) => previous.filter((item) => item.id !== range.id))
                    }
                  >
                    <Trash2 className="size-4" />
                    Remove
                  </Button>
                </div>
              ))
            )}
          </div>
        </div>

        {cutTask ? (
          <div className="rounded-md border border-[#d1968f]/40 bg-white/70 p-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="font-medium text-[#5f2823] text-sm">Latest Cut Task</p>
              <Badge variant={cutTask.status === "completed" ? "completed" : "running"}>
                {cutTask.status}
              </Badge>
            </div>
            <p className="text-[#6e3933] text-xs">
              {isExporting ? "Export in progress..." : "Ready."}
            </p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
};

export { SimpleCutEditorPanel };
