import { open } from "@tauri-apps/plugin-dialog";
import { FileAudio2, FolderOpen, LoaderCircle, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardTitle } from "@/components/ui/card";
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

const dedupePaths = (paths: string[]) => {
  return Array.from(new Set(paths));
};

const TranscribePanel = ({ controller }: TranscribePanelProps) => {
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [isResolvingFolder, setIsResolvingFolder] = useState(false);

  const transcriptionTask = useMemo(() => {
    return Object.values(controller.state.tasksById)
      .filter((task) => task.taskKind === "transcription")
      .at(-1);
  }, [controller.state.tasksById]);

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
      <CardTitle className="flex items-center gap-2">
        <FileAudio2 className="size-5 text-[#88322d]" />
        Speech to Text
      </CardTitle>
      <CardDescription>
        Add one or more videos or import an entire folder, then generate `.srt` subtitle sidecars.
      </CardDescription>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
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
            variant="secondary"
            onClick={() => setSelectedPaths([])}
            disabled={selectedPaths.length === 0}
          >
            <Trash2 className="size-4" />
            Clear
          </Button>
          <Button type="button" onClick={startTranscription} disabled={selectedPaths.length === 0}>
            Start Transcription
          </Button>
          <Button type="button" variant="danger" onClick={controller.cancelActiveTask}>
            Cancel Active Task
          </Button>
        </div>

        <div className="rounded-md border border-[#d1968f]/40 bg-white/70 p-3">
          <p className="mb-2 text-[#6e3933] text-xs">
            Selected video files: {selectedPaths.length}
          </p>
          <div className="max-h-48 space-y-1 overflow-auto">
            {selectedPaths.length === 0 ? (
              <p className="text-[#6e3933] text-sm">No files selected.</p>
            ) : (
              selectedPaths.map((path) => (
                <p key={path} className="truncate text-[#5f2823] text-sm">
                  {toFileName(path)}
                </p>
              ))
            )}
          </div>
        </div>

        {transcriptionTask ? (
          <div className="rounded-md border border-[#d1968f]/40 bg-white/70 p-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="font-medium text-[#5f2823] text-sm">Latest Transcription Task</p>
              <Badge variant={transcriptionTask.status === "completed" ? "completed" : "running"}>
                {transcriptionTask.status}
              </Badge>
            </div>
            <div className="max-h-44 space-y-2 overflow-auto">
              {transcriptionTask.jobs.map((job) => (
                <div key={job.jobId} className="rounded border border-[#e6c8b8] p-2">
                  <p className="truncate text-[#5f2823] text-xs">{job.fileName}</p>
                  {job.error ? <p className="text-rose-700 text-xs">{job.error}</p> : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
};

export { TranscribePanel };
