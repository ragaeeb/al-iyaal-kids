import type {
  AnalysisSidecar,
  FlaggedSegment,
  TaskJobArtifacts,
  TaskJobRecord,
} from "@/features/media/types";

type ModerationPriorityCounts = {
  high: number;
  medium: number;
  low: number;
};

type ModerationJobResult = {
  jobId: string;
  fileName: string;
  outputPath?: string;
  status: TaskJobRecord["status"];
  flaggedCount: number;
  summary: string;
  segments: FlaggedSegment[];
};

type ModerationOverview = {
  totalFlagged: number;
  filesWithFlags: number;
  counts: ModerationPriorityCounts;
};

const emptyPriorityCounts = (): ModerationPriorityCounts => ({
  high: 0,
  low: 0,
  medium: 0,
});

const toFlaggedCount = (job: TaskJobRecord, sidecar?: AnalysisSidecar) =>
  sidecar?.flagged.length ?? job.artifacts?.flaggedCount ?? 0;

const toSummary = (job: TaskJobRecord, sidecar?: AnalysisSidecar) =>
  sidecar?.summary ?? job.artifacts?.summary ?? "No analysis summary available yet.";

const toModerationJobResult = (
  job: TaskJobRecord,
  sidecar?: AnalysisSidecar,
): ModerationJobResult => ({
  fileName: job.fileName,
  flaggedCount: toFlaggedCount(job, sidecar),
  jobId: job.jobId,
  outputPath: job.outputPath,
  segments: sidecar?.flagged ?? [],
  status: job.status,
  summary: toSummary(job, sidecar),
});

const buildModerationOverview = (jobs: ModerationJobResult[]): ModerationOverview => {
  return jobs.reduce<ModerationOverview>(
    (overview, job) => {
      overview.totalFlagged += job.flaggedCount;
      if (job.flaggedCount > 0) {
        overview.filesWithFlags += 1;
      }
      for (const segment of job.segments) {
        overview.counts[segment.priority] += 1;
      }
      return overview;
    },
    {
      counts: emptyPriorityCounts(),
      filesWithFlags: 0,
      totalFlagged: 0,
    },
  );
};

const parseAnalysisSidecar = (content: string): AnalysisSidecar => {
  const parsed = JSON.parse(content) as unknown;

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid analysis sidecar shape");
  }

  const candidate = parsed as Partial<AnalysisSidecar>;
  if (!Array.isArray(candidate.flagged) || typeof candidate.summary !== "string") {
    throw new Error("Invalid analysis sidecar shape");
  }

  return {
    createdAt: typeof candidate.createdAt === "string" ? candidate.createdAt : "",
    engine:
      candidate.engine === "gemini" ||
      candidate.engine === "nova_pro" ||
      candidate.engine === "blacklist"
        ? candidate.engine
        : "blacklist",
    flagged: candidate.flagged,
    summary: candidate.summary,
    videoFileName: typeof candidate.videoFileName === "string" ? candidate.videoFileName : "",
  };
};

const toJobArtifacts = (value: unknown): TaskJobArtifacts | undefined => {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const candidate = value as Partial<TaskJobArtifacts>;
  return {
    flaggedCount: typeof candidate.flaggedCount === "number" ? candidate.flaggedCount : undefined,
    summary: typeof candidate.summary === "string" ? candidate.summary : undefined,
  };
};

export { buildModerationOverview, parseAnalysisSidecar, toJobArtifacts, toModerationJobResult };
export type { ModerationJobResult, ModerationOverview, ModerationPriorityCounts };
