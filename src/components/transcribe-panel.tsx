import { open } from "@tauri-apps/plugin-dialog";
import { FileAudio2, FolderOpen, LoaderCircle, Plus, Sparkles, Trash2 } from "lucide-react";
import { useState } from "react";

import { LogOutput } from "@/components/log-output";
import { TaskDrawer } from "@/components/task-drawer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getLatestTask, getLatestTaskLogLine } from "@/features/media/selectors";
import { listVideos } from "@/features/media/transport";
import type { useMediaController } from "@/features/media/useMediaController";

type MediaController = ReturnType<typeof useMediaController>;

type TranscribePanelProps = {
  controller: MediaController;
};

const toPathList = (value: string | string[] | null): string[] => {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
};

const toFileName = (path: string) => path.split("/").at(-1) ?? path;

const dedupePaths = (paths: string[]) => Array.from(new Set(paths));

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
        ? "Transcribing..."
        : "Start Transcription",
    isBusy: isTaskStarting || isTaskRunning,
    isTaskRunning,
    isTaskStarting,
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

const TranscribePanel = ({ controller }: TranscribePanelProps) => {
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [isResolvingFolder, setIsResolvingFolder] = useState(false);

  const transcriptionTask = getLatestTask(controller.state.tasksById, "transcription");
  const taskActivity = toTaskActivity(transcriptionTask?.status, controller.state.workerStatus);
  const latestLogLine = getLatestTaskLogLine(transcriptionTask);

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
      <CardHeader className="grid grid-cols-[1fr_auto] gap-4">
        <div>
          <CardTitle className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-2xl bg-[#f5e6dc] text-[#88322d]">
              <FileAudio2 className="size-4" />
            </span>
            Transcribe
          </CardTitle>
          <p className="mt-2 text-[#8f5e56] text-sm">
            Generate `.srt` subtitles from selected videos or an imported folder.
          </p>
        </div>
        <TaskDrawer
          triggerLabel="Open Task"
          title="Latest Transcription Task"
          description="Most recent transcription run with file-level status and log lines."
        >
          {transcriptionTask ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between rounded-[20px] border border-[#ead3c4] bg-[#fffaf6] px-4 py-3">
                <div>
                  <p className="text-[#8f5e56] text-sm">Task Status</p>
                  <p className="mt-1 font-medium text-[#5b2722] text-sm">
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
                  className="rounded-[22px] border border-[#ead3c4] bg-[#fffaf7] p-4"
                >
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
          ) : (
            <p className="rounded-[22px] border border-[#e7d2c5] border-dashed bg-[#fff8f3] px-4 py-5 text-[#8f5e56] text-sm">
              No transcription task has run yet.
            </p>
          )}
        </TaskDrawer>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-3">
          <Button type="button" variant="secondary" onClick={addVideoFiles}>
            <Plus className="size-4" />
            Add Video Files
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
            variant="ghost"
            onClick={() => setSelectedPaths([])}
            disabled={selectedPaths.length === 0}
          >
            <Trash2 className="size-4" />
            Clear
          </Button>
          <Button
            type="button"
            onClick={startTranscription}
            disabled={selectedPaths.length === 0 || taskActivity.isBusy}
          >
            {taskActivity.isBusy ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <Sparkles className="size-4" />
            )}
            {taskActivity.buttonLabel}
          </Button>
          <Button type="button" variant="danger" onClick={controller.cancelActiveTask}>
            Cancel Task
          </Button>
        </div>

        <div className="rounded-[22px] border border-[#ead3c4] bg-[#fffaf6] px-4 py-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[#8f5e56] text-sm">Selected files</p>
            <span className="font-medium text-[#5b2722] text-sm">{selectedPaths.length}</span>
          </div>
          <div className="mt-3 max-h-64 space-y-2 overflow-auto pr-1">
            {selectedPaths.length === 0 ? (
              <p className="text-[#8f5e56] text-sm">No files selected.</p>
            ) : (
              selectedPaths.map((path) => (
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

        <div className="rounded-[22px] border border-[#ead3c4] bg-[#fffaf6] px-4 py-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[#8f5e56] text-sm">Worker Status</p>
            <Badge variant={toWorkerStatusVariant(controller.state.workerStatus)}>
              {controller.state.workerStatus}
            </Badge>
          </div>
          <p className="mt-2 text-[#7f524a] text-sm">{controller.state.workerMessage}</p>
          {latestLogLine ? (
            <div className="mt-3 rounded-[16px] bg-[#fdf1e8] px-3 py-2">
              <p className="font-mono text-[#7f524a] text-[11px]">{latestLogLine}</p>
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
};

export { TranscribePanel };
