import type { DragDropEvent } from "@tauri-apps/api/window";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { FileAudio2, FolderOpen, LoaderCircle, Plus, Sparkles, Trash2 } from "lucide-react";
import { type RefObject, useEffect, useRef, useState } from "react";

import { LogOutput } from "@/components/log-output";
import { TaskDrawer } from "@/components/task-drawer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { dedupePaths, isSupportedVideoPath } from "@/features/batch/utils";
import { getLatestTask, getLatestTaskLogLine } from "@/features/media/selectors";
import { listVideos } from "@/features/media/transport";
import type { useMediaController } from "@/features/media/useMediaController";

type MediaController = ReturnType<typeof useMediaController>;

type TranscribePanelProps = {
  controller: MediaController;
  isActive: boolean;
};

const toPathList = (value: string | string[] | null): string[] => {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
};

const toFileName = (path: string) => path.split("/").at(-1) ?? path;

const toTaskActivity = (
  taskStatus: MediaController["state"]["tasksById"][string]["status"] | undefined,
  workerStatus: MediaController["state"]["workerStatus"],
) => {
  const isTaskStarting = taskStatus === "queued" || workerStatus === "starting";
  const isTaskRunning = taskStatus === "running";

  return {
    buttonLabel: isTaskStarting ? "Starting..." : isTaskRunning ? "Transcribing..." : "Transcribe",
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

const toTaskStatusVariant = (status: MediaController["state"]["tasksById"][string]["status"]) => {
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

const handleDragDropEvent = async ({
  dropTargetRef,
  event,
  mounted,
  setIsDropTargetActive,
  setIsResolvingDrop,
  setSelectedPaths,
}: {
  dropTargetRef: RefObject<HTMLDivElement | null>;
  event: { payload: DragDropEvent };
  mounted: boolean;
  setIsDropTargetActive: (value: boolean) => void;
  setIsResolvingDrop: (value: boolean) => void;
  setSelectedPaths: React.Dispatch<React.SetStateAction<string[]>>;
}) => {
  if (!mounted) {
    return;
  }

  if (event.payload.type === "leave") {
    setIsDropTargetActive(false);
    return;
  }

  if (event.payload.type === "over" || event.payload.type === "enter") {
    setIsDropTargetActive(isWithinDropTarget(dropTargetRef, event.payload.position));
    return;
  }

  const droppedInsideTarget = isWithinDropTarget(dropTargetRef, event.payload.position);
  setIsDropTargetActive(false);
  if (!droppedInsideTarget) {
    return;
  }

  setIsResolvingDrop(true);
  try {
    const nextPaths = await resolveDroppedPaths(event.payload.paths);
    setSelectedPaths((previous) => dedupePaths([...previous, ...nextPaths]));
  } finally {
    if (mounted) {
      setIsResolvingDrop(false);
    }
  }
};

const TranscribePanel = ({ controller, isActive }: TranscribePanelProps) => {
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [isResolvingFolder, setIsResolvingFolder] = useState(false);
  const [isResolvingDrop, setIsResolvingDrop] = useState(false);
  const [isDropTargetActive, setIsDropTargetActive] = useState(false);
  const dropTargetRef = useRef<HTMLDivElement>(null);

  const transcriptionTask = getLatestTask(controller.state.tasksById, "transcription");
  const taskActivity = toTaskActivity(transcriptionTask?.status, controller.state.workerStatus);
  const latestLogLine = getLatestTaskLogLine(transcriptionTask);

  useEffect(() => {
    if (!isActive) {
      setIsDropTargetActive(false);
      return;
    }

    let mounted = true;

    const setup = async () => {
      const unlisten = await getCurrentWindow().onDragDropEvent((event) =>
        handleDragDropEvent({
          dropTargetRef,
          event,
          mounted,
          setIsDropTargetActive,
          setIsResolvingDrop,
          setSelectedPaths,
        }),
      );

      return unlisten;
    };

    let cleanup: (() => void) | undefined;
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

  const addVideoFiles = async () => {
    const response = await open({
      directory: false,
      filters: [{ extensions: ["mp4", "mov"], name: "Videos" }],
      multiple: true,
    });
    const next = toPathList(response as string | string[] | null);
    setSelectedPaths((previous) => dedupePaths([...previous, ...next]));
  };

  const addFolder = async () => {
    const response = await open({ directory: true, multiple: false });
    const folder = toPathList(response as string | string[] | null).at(0);
    if (!folder) {
      return;
    }

    setIsResolvingFolder(true);
    try {
      const videos = await listVideos(folder);
      const nextPaths = videos.map((video) => video.path);
      setSelectedPaths((previous) => dedupePaths([...previous, ...nextPaths]));
    } finally {
      setIsResolvingFolder(false);
    }
  };

  const startTranscription = async () => {
    if (selectedPaths.length === 0) {
      return;
    }
    await controller.startTranscriptionForPaths(selectedPaths);
  };

  return (
    <Card>
      <CardHeader className="grid grid-cols-[1fr_auto] gap-2">
        <div>
          <CardTitle className="flex items-center gap-1.5">
            <span className="flex size-6 items-center justify-center rounded-lg bg-[#f5e6dc] text-[#88322d]">
              <FileAudio2 className="size-3" />
            </span>
            Transcribe
          </CardTitle>
          <p className="mt-0.5 text-[#8f5e56] text-xs">
            Generate subtitles from videos or folders.
          </p>
        </div>
        <TaskDrawer
          triggerLabel="Open Task"
          title="Latest Transcription Task"
          description="Status and logs for the latest task."
        >
          {transcriptionTask ? (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between rounded-[12px] border border-[#ead3c4] bg-[#fffaf6] px-2 py-1.5">
                <div>
                  <p className="text-[#8f5e56] text-xs">Task Status</p>
                  <p className="mt-0.5 font-medium text-[#5b2722] text-xs">
                    {transcriptionTask.taskId}
                  </p>
                </div>
                <Badge variant={toTaskStatusVariant(transcriptionTask.status)}>
                  {transcriptionTask.status}
                </Badge>
              </div>
              {transcriptionTask.jobs.map((job) => (
                <div
                  key={job.jobId}
                  className="rounded-[12px] border border-[#ead3c4] bg-[#fffaf7] p-1.5"
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="truncate font-medium text-[#5f2823] text-xs">{job.fileName}</p>
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
          ) : (
            <p className="rounded-[12px] border border-[#e7d2c5] border-dashed bg-[#fff8f3] px-2.5 py-2.5 text-[#8f5e56] text-xs">
              No transcription task has run yet.
            </p>
          )}
        </TaskDrawer>
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
            {(isResolvingDrop || taskActivity.isBusy) && (
              <LoaderCircle className="mt-0.5 size-3.5 animate-spin text-[#88322d]" />
            )}
          </div>

          <div className="mt-2 flex flex-wrap gap-1.5">
            <Button type="button" size="sm" variant="secondary" onClick={addVideoFiles}>
              <Plus className="size-3" />
              Add Video Files
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
              variant="ghost"
              onClick={() => setSelectedPaths([])}
              disabled={selectedPaths.length === 0}
            >
              <Trash2 className="size-3" />
              Clear
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={startTranscription}
              disabled={selectedPaths.length === 0 || taskActivity.isBusy}
            >
              {taskActivity.isBusy ? (
                <LoaderCircle className="size-3 animate-spin" />
              ) : (
                <Sparkles className="size-3" />
              )}
              {taskActivity.buttonLabel}
            </Button>
            <Button type="button" size="sm" variant="danger" onClick={controller.cancelActiveTask}>
              Cancel Task
            </Button>
          </div>

          <div className="mt-2 rounded-[14px] border border-[#ead3c4] bg-white/70 px-2.5 py-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[#8f5e56] text-xs">Selected files</p>
              <span className="font-medium text-[#5b2722] text-xs">{selectedPaths.length}</span>
            </div>
            <div className="mt-2 max-h-48 space-y-1 overflow-auto pr-1">
              {selectedPaths.length === 0 ? (
                <p className="text-[#8f5e56] text-xs">No files selected.</p>
              ) : (
                selectedPaths.map((path) => (
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
        </div>

        <div className="rounded-[14px] border border-[#ead3c4] bg-[#fffaf6] px-2.5 py-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[#8f5e56] text-xs">Worker Status</p>
            <Badge variant={toWorkerStatusVariant(controller.state.workerStatus)}>
              {controller.state.workerStatus}
            </Badge>
          </div>
          <p className="mt-1 text-[#7f524a] text-xs">{controller.state.workerMessage}</p>
          {latestLogLine ? (
            <div className="mt-1.5 rounded-[12px] bg-[#fdf1e8] px-2 py-1.5">
              <p className="font-mono text-[#7f524a] text-[10px]">{latestLogLine}</p>
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
};

export { TranscribePanel };
