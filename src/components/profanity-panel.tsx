import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen, LoaderCircle, Plus, ShieldAlert, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { ModerationSettingsPanel } from "@/components/moderation-settings-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardTitle } from "@/components/ui/card";
import { listSrtFiles } from "@/features/media/transport";
import type { useMediaController } from "@/features/media/useMediaController";

type MediaController = ReturnType<typeof useMediaController>;

type ProfanityPanelProps = {
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

const ProfanityPanel = ({ controller }: ProfanityPanelProps) => {
  const [selectedSrtPaths, setSelectedSrtPaths] = useState<string[]>([]);
  const [isResolvingFolder, setIsResolvingFolder] = useState(false);

  const flagTask = useMemo(() => {
    return Object.values(controller.state.tasksById)
      .filter((task) => task.taskKind === "flag")
      .at(-1);
  }, [controller.state.tasksById]);

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

  const startFlagging = async () => {
    if (selectedSrtPaths.length === 0) {
      return;
    }
    await controller.startFlaggingForPaths(selectedSrtPaths);
  };

  return (
    <Card>
      <CardTitle className="flex items-center gap-2">
        <ShieldAlert className="size-5 text-[#88322d]" />
        Profanity Detection
      </CardTitle>
      <CardDescription>
        Add `.srt` files directly or import a folder of subtitle files, then generate
        `.analysis.json` outputs.
      </CardDescription>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
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
            onClick={() => setSelectedSrtPaths([])}
            disabled={selectedSrtPaths.length === 0}
          >
            <Trash2 className="size-4" />
            Clear
          </Button>
          <Button type="button" onClick={startFlagging} disabled={selectedSrtPaths.length === 0}>
            Run Detection
          </Button>
          <Button type="button" variant="danger" onClick={controller.cancelActiveTask}>
            Cancel Active Task
          </Button>
        </div>

        <div className="rounded-md border border-[#d1968f]/40 bg-white/70 p-3">
          <p className="mb-2 text-[#6e3933] text-xs">
            Selected subtitle files: {selectedSrtPaths.length}
          </p>
          <div className="max-h-48 space-y-1 overflow-auto">
            {selectedSrtPaths.length === 0 ? (
              <p className="text-[#6e3933] text-sm">No files selected.</p>
            ) : (
              selectedSrtPaths.map((path) => (
                <p key={path} className="truncate text-[#5f2823] text-sm">
                  {toFileName(path)}
                </p>
              ))
            )}
          </div>
        </div>

        {flagTask ? (
          <div className="rounded-md border border-[#d1968f]/40 bg-white/70 p-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="font-medium text-[#5f2823] text-sm">Latest Detection Task</p>
              <Badge variant={flagTask.status === "completed" ? "completed" : "running"}>
                {flagTask.status}
              </Badge>
            </div>
            <div className="max-h-44 space-y-2 overflow-auto">
              {flagTask.jobs.map((job) => (
                <div key={job.jobId} className="rounded border border-[#e6c8b8] p-2">
                  <p className="truncate text-[#5f2823] text-xs">{job.fileName}</p>
                  {job.outputPath ? (
                    <p className="text-[#6e3933] text-xs">{toFileName(job.outputPath)}</p>
                  ) : null}
                  {job.error ? <p className="text-rose-700 text-xs">{job.error}</p> : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <ModerationSettingsPanel
          onLoad={controller.loadSettings}
          onSave={controller.saveSettings}
        />
      </CardContent>
    </Card>
  );
};

export { ProfanityPanel };
