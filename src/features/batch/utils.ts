import { SUPPORTED_EXTENSIONS } from "@/features/batch/constants";
import type {
  BatchState,
  BatchStatus,
  CancelAck,
  JobRecord,
  StartBatchRequest,
  SupportedExtension,
} from "@/features/batch/types";
import { toJobId } from "@/features/shared/job-id";
import { toFileName } from "@/features/shared/path";

const normalizePath = (value: string) => value.trim();

const CANCEL_REJECTED_MESSAGE =
  "Cancellation was not accepted because this batch is no longer active or has already finished.";

type CancelOutcome =
  | {
      accepted: true;
      errorMessage: null;
    }
  | {
      accepted: false;
      errorMessage: string;
    };

const toCancelOutcome = (ack: CancelAck): CancelOutcome =>
  ack.accepted
    ? {
        accepted: true,
        errorMessage: null,
      }
    : {
        accepted: false,
        errorMessage: CANCEL_REJECTED_MESSAGE,
      };

export const isSupportedVideoPath = (path: string, allowedExtensions = SUPPORTED_EXTENSIONS) => {
  const normalized = path.toLowerCase();
  return allowedExtensions.some((extension) => normalized.endsWith(extension));
};

export const dedupePaths = (paths: string[]) =>
  Array.from(new Set(paths.map(normalizePath).filter((path) => path.length > 0)));

export const isActiveBatchStatus = (status: BatchStatus) =>
  status === "queued" || status === "running";

export const retainPathFlags = (
  flags: Record<string, boolean>,
  selectedPaths: string[],
): Record<string, boolean> => {
  const selectedPathSet = new Set(selectedPaths);

  return Object.fromEntries(Object.entries(flags).filter(([path]) => selectedPathSet.has(path)));
};

export const buildStartBatchRequest = (inputPaths: string[]): StartBatchRequest => ({
  allowedExtensions: SUPPORTED_EXTENSIONS,
  inputPaths: dedupePaths(inputPaths),
  outputDirMode: "audio_replaced_default",
});

export const createQueuedJobs = (inputPaths: string[]): JobRecord[] =>
  inputPaths.map((inputPath) => ({
    fileName: toFileName(inputPath),
    inputPath,
    jobId: toJobId(inputPath),
    logs: [],
    progressPct: 0,
    status: "queued",
  }));

export const createInitialBatchState = (batchId: string, inputPaths: string[]): BatchState => ({
  batchId,
  jobs: createQueuedJobs(inputPaths),
  status: "queued",
});

export const clampProgress = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

export const toAllowedExtensions = (extensions: string[]): SupportedExtension[] =>
  extensions.filter((value): value is SupportedExtension =>
    SUPPORTED_EXTENSIONS.includes(value as SupportedExtension),
  );

export { CANCEL_REJECTED_MESSAGE, toCancelOutcome };
