import { AlertCircle, FolderOpen, LoaderCircle, Music2, OctagonX, Play } from "lucide-react";

import { LogOutput } from "@/components/log-output";
import { TaskDrawer } from "@/components/task-drawer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import type { JobRecord } from "@/features/batch/types";

type RemoveMusicPanelProps = {
  selectedInputDir: string;
  isStartingBatch: boolean;
  workerStatus: string;
  workerMessage: string;
  progressPct: number;
  errorMessage: string | null;
  jobs: JobRecord[];
  onInputDirChange: (value: string) => void;
  onChooseInputDir: () => Promise<void>;
  onStart: () => Promise<void>;
  onCancel: () => Promise<void>;
  onOpenOutput: (path: string) => Promise<void>;
  onClearError: () => void;
};

const toStatusVariant = (status: JobRecord["status"]) => status;

const RemoveMusicPanel = ({
  selectedInputDir,
  isStartingBatch,
  workerStatus,
  workerMessage,
  progressPct,
  errorMessage,
  jobs,
  onInputDirChange,
  onChooseInputDir,
  onStart,
  onCancel,
  onOpenOutput,
  onClearError,
}: RemoveMusicPanelProps) => (
  <div className="space-y-4">
    <Card>
      <CardHeader className="grid grid-cols-[1fr_auto] gap-4">
        <div>
          <CardTitle className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-2xl bg-[#f5e6dc] text-[#88322d]">
              <Music2 className="size-4" />
            </span>
            Remove Music
          </CardTitle>
          <p className="mt-2 text-[#8f5e56] text-sm">
            Vocals-only remux for `.mp4` and `.mov` folders. Outputs go to `audio_replaced`.
          </p>
        </div>
        <TaskDrawer
          triggerLabel="Open Queue"
          title="Batch Queue"
          description="Recent logs and per-file status for the current or latest remove-music batch."
        >
          <div className="space-y-3">
            {jobs.length === 0 ? (
              <p className="rounded-[22px] border border-[#e7d2c5] border-dashed bg-[#fff8f3] px-4 py-5 text-[#8f5e56] text-sm">
                No jobs yet. Start a batch to populate this queue.
              </p>
            ) : (
              jobs.map((job) => {
                const outputPath = job.outputPath;
                return (
                  <div
                    key={job.jobId}
                    className="rounded-[22px] border border-[#ead3c4] bg-[#fffaf7] px-4 py-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p
                          className="truncate font-medium text-[#5f2823] text-sm"
                          title={job.inputPath}
                        >
                          {job.fileName}
                        </p>
                        <p className="mt-1 text-[#9e6d63] text-xs">{job.progressPct}% complete</p>
                      </div>
                      {job.status === "completed" && typeof outputPath === "string" ? (
                        <button type="button" onClick={() => onOpenOutput(outputPath)}>
                          <Badge variant={toStatusVariant(job.status)}>open</Badge>
                        </button>
                      ) : (
                        <Badge variant={toStatusVariant(job.status)}>{job.status}</Badge>
                      )}
                    </div>
                    <Progress className="mt-3 h-2.5" value={job.progressPct} />
                    <LogOutput logs={job.logs ?? []} />
                    {job.error ? <p className="mt-3 text-rose-700 text-xs">{job.error}</p> : null}
                  </div>
                );
              })
            )}
          </div>
        </TaskDrawer>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3">
          <div className="space-y-2">
            <Label htmlFor="input-dir">Input Folder</Label>
            <Input
              id="input-dir"
              placeholder="/Users/you/Videos"
              value={selectedInputDir}
              onChange={(event) => onInputDirChange(event.currentTarget.value)}
            />
          </div>
          <div className="flex items-end">
            <Button type="button" variant="secondary" onClick={onChooseInputDir}>
              <FolderOpen className="size-4" />
              Browse
            </Button>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
          <div className="space-y-2 rounded-[22px] border border-[#ead3c4] bg-[#fffaf6] px-4 py-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[#8f5e56] text-sm">Progress</p>
              <Badge
                variant={
                  workerStatus === "error"
                    ? "failed"
                    : workerStatus === "ready"
                      ? "completed"
                      : "running"
                }
              >
                {workerStatus}
              </Badge>
            </div>
            <Progress className="h-2.5" value={progressPct} />
            <p className="text-[#7f524a] text-sm">{workerMessage}</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button type="button" onClick={onStart} disabled={isStartingBatch}>
              {isStartingBatch ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Play className="size-4" />
              )}
              Start Batch
            </Button>
            <Button type="button" variant="danger" onClick={onCancel}>
              <OctagonX className="size-4" />
              Cancel
            </Button>
          </div>
        </div>

        {errorMessage ? (
          <div className="rounded-[20px] border border-rose-200 bg-rose-50 px-4 py-3 text-rose-800 text-sm">
            <div className="flex items-start justify-between gap-4">
              <p className="flex items-center gap-2 font-medium">
                <AlertCircle className="size-4" />
                {errorMessage}
              </p>
              <Button type="button" variant="ghost" size="sm" onClick={onClearError}>
                Dismiss
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  </div>
);

export { RemoveMusicPanel };
