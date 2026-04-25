import type { DragDropEvent } from "@tauri-apps/api/window";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  AlertCircle,
  FileAudio2,
  FolderOpen,
  LoaderCircle,
  Music2,
  OctagonX,
  Play,
  ScanText,
  Scissors,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { type RefObject, useEffect, useMemo, useRef, useState } from "react";

import { LogOutput } from "@/components/log-output";
import { TaskDrawer } from "@/components/task-drawer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import type { JobRecord } from "@/features/batch/types";
import { dedupePaths, isSupportedVideoPath } from "@/features/batch/utils";
import { listVideos } from "@/features/media/transport";

type RemoveMusicPanelProps = {
  isActive: boolean;
  selectedInputPaths: string[];
  isStartingBatch: boolean;
  workerStatus: string;
  workerMessage: string;
  progressPct: number;
  errorMessage: string | null;
  jobs: JobRecord[];
  onAddInputFiles: () => Promise<void>;
  onAddInputFolder: () => Promise<void>;
  onAddResolvedInputPaths: (paths: string[]) => void;
  onClearSelectedInputs: () => void;
  onStart: () => Promise<void>;
  onCancel: () => Promise<void>;
  onOpenOutput: (path: string) => Promise<void>;
  onSendToTranscription: (path: string) => Promise<void>;
  onSendToProfanity: (path: string) => Promise<void>;
  onSendToCut: (path: string) => void;
  onTrashOriginal: (path: string) => Promise<void>;
  transcriptionOutputByInputPath: Record<string, string>;
  analysisOutputByInputPath: Record<string, string>;
  onClearError: () => void;
};

type CompletedJobActionsProps = {
  analysisOutputByInputPath: Record<string, string>;
  busyDetectPath: string | null;
  job: JobRecord;
  busyTrashPath: string | null;
  busyTranscribePath: string | null;
  isOriginalTrashed: boolean;
  onOpenOutput: (path: string) => Promise<void>;
  onSendToProfanity: (path: string) => Promise<void>;
  onSendToCut: (path: string) => void;
  onSendToTranscription: (path: string) => Promise<void>;
  onTrashOriginal: (path: string) => Promise<void>;
  setBusyDetectPath: (path: string | null) => void;
  setBusyTrashPath: (path: string | null) => void;
  setBusyTranscribePath: (path: string | null) => void;
  transcriptionOutputByInputPath: Record<string, string>;
  setTrashedPaths: React.Dispatch<React.SetStateAction<string[]>>;
};

type ProcessedVideoQuickActionsProps = {
  analysisOutputByInputPath: Record<string, string>;
  busyDetectPath: string | null;
  busyTranscribePath: string | null;
  onSendToCut: (path: string) => void;
  onSendToProfanity: (path: string) => Promise<void>;
  onSendToTranscription: (path: string) => Promise<void>;
  processedVideoPath: string;
  setBusyDetectPath: (path: string | null) => void;
  setBusyTranscribePath: (path: string | null) => void;
  transcriptionOutputByInputPath: Record<string, string>;
};

const toStatusVariant = (status: JobRecord["status"]) => status;

const toFileName = (path: string) => path.split("/").at(-1) ?? path;

const ProcessedVideoQuickActions = ({
  analysisOutputByInputPath,
  busyDetectPath,
  busyTranscribePath,
  onSendToCut,
  onSendToProfanity,
  onSendToTranscription,
  processedVideoPath,
  setBusyDetectPath,
  setBusyTranscribePath,
  transcriptionOutputByInputPath,
}: ProcessedVideoQuickActionsProps) => {
  const subtitlePath = transcriptionOutputByInputPath[processedVideoPath];
  const hasCompletedAnalysis = Boolean(subtitlePath && analysisOutputByInputPath[subtitlePath]);

  return (
    <div className="flex items-center gap-1">
      <Button
        type="button"
        size="icon"
        variant="secondary"
        title="Transcribe this video"
        aria-label="Transcribe this video"
        disabled={busyTranscribePath === processedVideoPath}
        onClick={async () => {
          setBusyTranscribePath(processedVideoPath);
          try {
            await onSendToTranscription(processedVideoPath);
          } finally {
            setBusyTranscribePath(null);
          }
        }}
      >
        {busyTranscribePath === processedVideoPath ? (
          <LoaderCircle className="size-3.5 animate-spin" />
        ) : (
          <ScanText className="size-3.5" />
        )}
      </Button>
      {subtitlePath ? (
        <Button
          type="button"
          size="icon"
          variant={hasCompletedAnalysis ? "secondary" : "outline"}
          title={hasCompletedAnalysis ? "Run profanity detection again" : "Run profanity detection"}
          aria-label={
            hasCompletedAnalysis ? "Run profanity detection again" : "Run profanity detection"
          }
          disabled={busyDetectPath === subtitlePath}
          onClick={async () => {
            setBusyDetectPath(subtitlePath);
            try {
              await onSendToProfanity(subtitlePath);
            } finally {
              setBusyDetectPath(null);
            }
          }}
        >
          {busyDetectPath === subtitlePath ? (
            <LoaderCircle className="size-3.5 animate-spin" />
          ) : (
            <ShieldAlert className="size-3.5" />
          )}
        </Button>
      ) : null}
      <Button
        type="button"
        size="icon"
        variant="outline"
        title="Open this video in Edit Video"
        aria-label="Open this video in Edit Video"
        onClick={() => onSendToCut(processedVideoPath)}
      >
        <Scissors className="size-3.5" />
      </Button>
    </div>
  );
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

const updateDropTargetState = (
  targetRef: RefObject<HTMLDivElement | null>,
  position: { x: number; y: number },
  setIsDropTargetActive: (value: boolean) => void,
) => {
  setIsDropTargetActive(isWithinDropTarget(targetRef, position));
};

const handleDragDropEvent = async ({
  event,
  mounted,
  dropTargetRef,
  onAddResolvedInputPaths,
  setIsDropTargetActive,
  setIsResolvingDrop,
}: {
  event: { payload: DragDropEvent };
  mounted: boolean;
  dropTargetRef: RefObject<HTMLDivElement | null>;
  onAddResolvedInputPaths: (paths: string[]) => void;
  setIsDropTargetActive: (value: boolean) => void;
  setIsResolvingDrop: (value: boolean) => void;
}) => {
  if (!mounted) {
    return;
  }

  if (event.payload.type === "leave") {
    setIsDropTargetActive(false);
    return;
  }

  if (event.payload.type === "over" || event.payload.type === "enter") {
    updateDropTargetState(dropTargetRef, event.payload.position, setIsDropTargetActive);
    return;
  }

  const droppedInsideTarget = isWithinDropTarget(dropTargetRef, event.payload.position);
  setIsDropTargetActive(false);
  if (!droppedInsideTarget) {
    return;
  }

  setIsResolvingDrop(true);
  try {
    onAddResolvedInputPaths(await resolveDroppedPaths(event.payload.paths));
  } finally {
    if (mounted) {
      setIsResolvingDrop(false);
    }
  }
};

const CompletedJobActions = ({
  analysisOutputByInputPath,
  busyDetectPath,
  job,
  busyTrashPath,
  busyTranscribePath,
  isOriginalTrashed,
  onOpenOutput,
  onSendToProfanity,
  onSendToCut,
  onSendToTranscription,
  onTrashOriginal,
  setBusyDetectPath,
  setBusyTrashPath,
  setBusyTranscribePath,
  transcriptionOutputByInputPath,
  setTrashedPaths,
}: CompletedJobActionsProps) => {
  const outputPath = job.outputPath;

  return (
    <div className="mt-1.5 space-y-1">
      <div className="rounded-[12px] border border-[#ead3c4] bg-white/80 px-2 py-1.5">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="font-medium text-[#5f2823] text-xs uppercase tracking-[0.12em]">
              Original
            </p>
            <p className="mt-0.5 truncate text-[#7f524a] text-xs" title={job.inputPath}>
              {job.inputPath}
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            variant={isOriginalTrashed ? "ghost" : "danger"}
            disabled={isOriginalTrashed || busyTrashPath === job.inputPath}
            onClick={async () => {
              setBusyTrashPath(job.inputPath);
              try {
                await onTrashOriginal(job.inputPath);
                setTrashedPaths((previous) => [...previous, job.inputPath]);
              } finally {
                setBusyTrashPath(null);
              }
            }}
          >
            {busyTrashPath === job.inputPath ? (
              <LoaderCircle className="size-3 animate-spin" />
            ) : (
              <Trash2 className="size-3" />
            )}
            {isOriginalTrashed ? "Trashed" : "Trash"}
          </Button>
        </div>
      </div>
      {outputPath ? (
        <div className="rounded-[12px] border border-[#ead3c4] bg-white/80 px-2 py-1.5">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="font-medium text-[#5f2823] text-xs uppercase tracking-[0.12em]">
                Processed
              </p>
              <p className="mt-0.5 truncate text-[#7f524a] text-xs" title={outputPath}>
                {outputPath}
              </p>
            </div>
            <div className="flex flex-wrap gap-1">
              <ProcessedVideoQuickActions
                analysisOutputByInputPath={analysisOutputByInputPath}
                busyDetectPath={busyDetectPath}
                busyTranscribePath={busyTranscribePath}
                onSendToCut={onSendToCut}
                onSendToProfanity={onSendToProfanity}
                onSendToTranscription={onSendToTranscription}
                processedVideoPath={outputPath}
                setBusyDetectPath={setBusyDetectPath}
                setBusyTranscribePath={setBusyTranscribePath}
                transcriptionOutputByInputPath={transcriptionOutputByInputPath}
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => onOpenOutput(outputPath)}
              >
                <FileAudio2 className="size-3" />
                Open
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

const RemoveMusicPanel = ({
  isActive,
  selectedInputPaths,
  isStartingBatch,
  workerStatus,
  workerMessage,
  progressPct,
  errorMessage,
  jobs,
  onAddInputFiles,
  onAddInputFolder,
  onAddResolvedInputPaths,
  onClearSelectedInputs,
  onStart,
  onCancel,
  onOpenOutput,
  onSendToCut,
  onSendToProfanity,
  onSendToTranscription,
  onTrashOriginal,
  transcriptionOutputByInputPath,
  analysisOutputByInputPath,
  onClearError,
}: RemoveMusicPanelProps) => {
  const [isResolvingDrop, setIsResolvingDrop] = useState(false);
  const [isDropTargetActive, setIsDropTargetActive] = useState(false);
  const [busyDetectPath, setBusyDetectPath] = useState<string | null>(null);
  const [busyTrashPath, setBusyTrashPath] = useState<string | null>(null);
  const [busyTranscribePath, setBusyTranscribePath] = useState<string | null>(null);
  const [trashedPaths, setTrashedPaths] = useState<string[]>([]);
  const dropTargetRef = useRef<HTMLDivElement>(null);
  const jobInputPaths = useMemo(() => jobs.map((job) => job.inputPath), [jobs]);
  const jobsByInputPath = useMemo(
    () =>
      jobs.reduce<Record<string, JobRecord>>((index, job) => {
        index[job.inputPath] = job;
        return index;
      }, {}),
    [jobs],
  );

  useEffect(() => {
    setTrashedPaths((previous) => previous.filter((path) => jobInputPaths.includes(path)));
  }, [jobInputPaths]);

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
          onAddResolvedInputPaths,
          setIsDropTargetActive,
          setIsResolvingDrop,
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
  }, [isActive, onAddResolvedInputPaths]);

  return (
    <div className="space-y-2">
      <Card>
        <CardHeader className="grid grid-cols-[1fr_auto] gap-2">
          <div>
            <CardTitle className="flex items-center gap-1.5">
              <span className="flex size-6 items-center justify-center rounded-lg bg-[#f5e6dc] text-[#88322d]">
                <Music2 className="size-3" />
              </span>
              Remove Music
            </CardTitle>
            <p className="mt-0.5 text-[#8f5e56] text-xs">
              Process MP4/MOV files. Outputs saved to `audio_replaced/` folders.
            </p>
          </div>
          <TaskDrawer
            triggerLabel="Open Queue"
            title="Batch Queue"
            description="Log output and file status for the latest batch."
          >
            <div className="space-y-1.5">
              {jobs.length === 0 ? (
                <p className="rounded-[12px] border border-[#e7d2c5] border-dashed bg-[#fff8f3] px-2.5 py-2.5 text-[#8f5e56] text-xs">
                  No jobs yet. Start a batch to populate this queue.
                </p>
              ) : (
                jobs.map((job) => {
                  const isOriginalTrashed = trashedPaths.includes(job.inputPath);
                  return (
                    <div
                      key={job.jobId}
                      className="rounded-[12px] border border-[#ead3c4] bg-[#fffaf7] px-2 py-1.5"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p
                            className="truncate font-medium text-[#5f2823] text-xs"
                            title={job.inputPath}
                          >
                            {job.fileName}
                          </p>
                          <p className="mt-0.5 text-[#9e6d63] text-xs">
                            {job.progressPct}% complete
                          </p>
                        </div>
                        <Badge variant={toStatusVariant(job.status)}>{job.status}</Badge>
                      </div>
                      <Progress className="mt-1.5 h-1.5" value={job.progressPct} />
                      {job.status === "completed" ? (
                        <CompletedJobActions
                          analysisOutputByInputPath={analysisOutputByInputPath}
                          busyDetectPath={busyDetectPath}
                          job={job}
                          busyTrashPath={busyTrashPath}
                          busyTranscribePath={busyTranscribePath}
                          isOriginalTrashed={isOriginalTrashed}
                          onOpenOutput={onOpenOutput}
                          onSendToCut={onSendToCut}
                          onSendToProfanity={onSendToProfanity}
                          onSendToTranscription={onSendToTranscription}
                          onTrashOriginal={onTrashOriginal}
                          setBusyDetectPath={setBusyDetectPath}
                          setBusyTrashPath={setBusyTrashPath}
                          setBusyTranscribePath={setBusyTranscribePath}
                          transcriptionOutputByInputPath={transcriptionOutputByInputPath}
                          setTrashedPaths={setTrashedPaths}
                        />
                      ) : null}
                      <LogOutput logs={job.logs ?? []} />
                      {job.error ? <p className="mt-3 text-rose-700 text-xs">{job.error}</p> : null}
                    </div>
                  );
                })
              )}
            </div>
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
              {(isResolvingDrop || isStartingBatch) && (
                <LoaderCircle className="mt-0.5 size-3.5 animate-spin text-[#88322d]" />
              )}
            </div>

            <div className="mt-2 flex flex-wrap gap-1.5">
              <Button type="button" size="sm" variant="secondary" onClick={onAddInputFiles}>
                <FileAudio2 className="size-3" />
                Add Video Files
              </Button>
              <Button type="button" size="sm" variant="secondary" onClick={onAddInputFolder}>
                <FolderOpen className="size-3" />
                Add Folder
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={onClearSelectedInputs}
                disabled={selectedInputPaths.length === 0}
              >
                <Trash2 className="size-3" />
                Clear
              </Button>
            </div>

            <div className="mt-2 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[#8f5e56] text-xs">
                  {selectedInputPaths.length} file{selectedInputPaths.length === 1 ? "" : "s"}{" "}
                  selected
                </p>
              </div>
              {selectedInputPaths.length === 0 ? (
                <p className="rounded-[12px] border border-[#ead3c4] bg-white/70 px-2 py-1.5 text-[#9e6d63] text-xs">
                  No inputs selected yet.
                </p>
              ) : (
                <div className="space-y-1">
                  {selectedInputPaths.map((path) => {
                    const job = jobsByInputPath[path];
                    const processedOutputPath =
                      job?.status === "completed" && typeof job.outputPath === "string"
                        ? job.outputPath
                        : null;

                    return (
                      <div
                        key={path}
                        className="rounded-[12px] border border-[#ead3c4] bg-white/80 px-2 py-1.5"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate font-medium text-[#5f2823] text-xs" title={path}>
                              {toFileName(path)}
                            </p>
                            <p className="mt-0.5 truncate text-[#9e6d63] text-xs" title={path}>
                              {path}
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            {job ? (
                              <Badge variant={toStatusVariant(job.status)}>{job.status}</Badge>
                            ) : null}
                            {processedOutputPath ? (
                              <ProcessedVideoQuickActions
                                analysisOutputByInputPath={analysisOutputByInputPath}
                                busyDetectPath={busyDetectPath}
                                busyTranscribePath={busyTranscribePath}
                                onSendToCut={onSendToCut}
                                onSendToProfanity={onSendToProfanity}
                                onSendToTranscription={onSendToTranscription}
                                processedVideoPath={processedOutputPath}
                                setBusyDetectPath={setBusyDetectPath}
                                setBusyTranscribePath={setBusyTranscribePath}
                                transcriptionOutputByInputPath={transcriptionOutputByInputPath}
                              />
                            ) : null}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            <div className="space-y-1 rounded-[14px] border border-[#ead3c4] bg-[#fffaf6] px-2.5 py-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[#8f5e56] text-xs">Progress</p>
                <Badge
                  variant={
                    workerStatus === "error"
                      ? "failed"
                      : workerStatus === "ready" || workerStatus === "stopped"
                        ? "completed"
                        : "running"
                  }
                >
                  {workerStatus}
                </Badge>
              </div>
              <Progress className="h-1.5" value={progressPct} />
              <p className="text-[#7f524a] text-xs">{workerMessage}</p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Button type="button" size="sm" onClick={onStart} disabled={isStartingBatch}>
                {isStartingBatch ? (
                  <LoaderCircle className="size-3 animate-spin" />
                ) : (
                  <Play className="size-3" />
                )}
                Start Batch
              </Button>
              <Button type="button" size="sm" variant="danger" onClick={onCancel}>
                <OctagonX className="size-3" />
                Cancel
              </Button>
            </div>
          </div>

          {errorMessage ? (
            <div className="rounded-[12px] border border-rose-200 bg-rose-50 px-2.5 py-2 text-rose-800 text-xs">
              <div className="flex items-start justify-between gap-3">
                <p className="flex items-center gap-1.5 font-medium">
                  <AlertCircle className="size-3" />
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
};

export { RemoveMusicPanel };
