import {
  AlertCircle,
  FolderOpen,
  LoaderCircle,
  Music2,
  OctagonX,
  Play,
  Sparkles,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardTitle } from "@/components/ui/card";
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
  <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
    <Card>
      <CardTitle className="flex items-center gap-2">
        <Music2 className="size-5 text-[#88322d]" />
        Remove Music (Vocals-Only Output)
      </CardTitle>
      <CardDescription>
        Select a folder with `.mp4`/`.mov` files. Outputs are written to an `audio_replaced` folder
        in that directory.
      </CardDescription>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="input-dir">Input Folder</Label>
          <div className="flex gap-2">
            <Input
              id="input-dir"
              placeholder="/Users/you/Videos"
              value={selectedInputDir}
              onChange={(event) => onInputDirChange(event.currentTarget.value)}
            />
            <Button type="button" variant="secondary" onClick={onChooseInputDir}>
              <FolderOpen className="size-4" />
              Browse
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Batch Progress</Label>
            <span className="font-semibold text-[#6e3933] text-xs">{progressPct}%</span>
          </div>
          <Progress value={progressPct} />
        </div>

        <div className="flex flex-wrap items-center gap-2">
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
            Cancel After Current
          </Button>
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

        <p className="text-[#6e3933] text-xs">{workerMessage}</p>

        {errorMessage ? (
          <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-rose-800 text-sm">
            <div className="flex items-start justify-between gap-3">
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

    <Card>
      <CardTitle className="flex items-center gap-2">
        <Sparkles className="size-5 text-[#c57267]" />
        Queue
      </CardTitle>
      <CardDescription>
        Files process sequentially. Failures are reported per file while the queue continues.
      </CardDescription>
      <CardContent>
        <div className="max-h-[28rem] space-y-3 overflow-auto pr-1">
          {jobs.length === 0 ? (
            <p className="text-[#6e3933] text-sm">
              No jobs yet. Start a batch to populate this list.
            </p>
          ) : (
            jobs.map((job) => {
              const outputPath = job.outputPath;
              return (
                <div
                  key={job.jobId}
                  className="rounded-lg border border-[#d1968f]/45 bg-white/70 px-3 py-2"
                >
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <p
                      className="truncate font-medium text-[#5f2823] text-sm"
                      title={job.inputPath}
                    >
                      {job.fileName}
                    </p>
                    {job.status === "completed" && typeof outputPath === "string" ? (
                      <button type="button" onClick={() => onOpenOutput(outputPath)}>
                        <Badge variant={toStatusVariant(job.status)}>open</Badge>
                      </button>
                    ) : (
                      <Badge variant={toStatusVariant(job.status)}>{job.status}</Badge>
                    )}
                  </div>
                  <Progress value={job.progressPct} className="h-2" />
                  {job.error ? <p className="mt-1 text-rose-700 text-xs">{job.error}</p> : null}
                </div>
              );
            })
          )}
        </div>
      </CardContent>
    </Card>
  </div>
);

export { RemoveMusicPanel };
