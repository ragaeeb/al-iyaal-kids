import { SUPPORTED_EXTENSIONS } from "@/features/batch/constants";
import type {
  BatchState,
  JobRecord,
  StartBatchRequest,
  SupportedExtension,
} from "@/features/batch/types";

const normalizePath = (value: string) => value.trim();

export const isSupportedVideoPath = (path: string, allowedExtensions = SUPPORTED_EXTENSIONS) => {
  const normalized = path.toLowerCase();
  return allowedExtensions.some((extension) => normalized.endsWith(extension));
};

export const buildStartBatchRequest = (inputDir: string): StartBatchRequest => ({
  allowedExtensions: SUPPORTED_EXTENSIONS,
  inputDir: normalizePath(inputDir),
  outputDirMode: "audio_replaced_default",
});

export const toJobId = (inputPath: string) =>
  inputPath
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

export const toFileName = (path: string) => {
  const segments = path.split("/");
  return segments.at(-1) ?? path;
};

export const createQueuedJobs = (inputPaths: string[]): JobRecord[] =>
  inputPaths.map((inputPath) => ({
    fileName: toFileName(inputPath),
    inputPath,
    jobId: toJobId(inputPath),
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
