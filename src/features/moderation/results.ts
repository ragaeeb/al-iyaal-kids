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

type RawAnalysisSidecar = Record<string, unknown> & {
  createdAt?: unknown;
  engine?: unknown;
  flagged?: unknown;
  summary?: unknown;
  videoFileName?: unknown;
};

const flaggedMergeToleranceSeconds = 0.25;

const priorityRanks = {
  high: 3,
  low: 1,
  medium: 2,
} as const satisfies Record<FlaggedSegment["priority"], number>;

const emptyPriorityCounts = (): ModerationPriorityCounts => ({
  high: 0,
  low: 0,
  medium: 0,
});

const toFiniteNumber = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
};

const normalizeFlaggedSegment = (candidate: unknown): FlaggedSegment | null => {
  if (!candidate || typeof candidate !== "object") {
    return null;
  }

  const segment = candidate as Partial<FlaggedSegment>;
  const startTime = toFiniteNumber(segment.startTime);

  if (startTime === null) {
    return null;
  }

  if (segment.priority !== "high" && segment.priority !== "medium" && segment.priority !== "low") {
    return null;
  }

  return {
    category: typeof segment.category === "string" ? segment.category : "",
    endTime: toFiniteNumber(segment.endTime) ?? undefined,
    priority: segment.priority,
    reason: typeof segment.reason === "string" ? segment.reason : "",
    ruleId: typeof segment.ruleId === "string" ? segment.ruleId : "",
    startTime,
    text: typeof segment.text === "string" ? segment.text : "",
  };
};

const normalizeEngine = (value: unknown): AnalysisSidecar["engine"] =>
  value === "gemini" || value === "nova_pro" || value === "blacklist" ? value : "blacklist";

const firstNonEmptyString = (values: string[]) => values.find((value) => value.trim()) ?? "";

const mergeUniqueText = (values: string[], separator: string) => {
  const seen = new Set<string>();
  const uniqueValues: string[] = [];

  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }

    seen.add(trimmed);
    uniqueValues.push(trimmed);
  }

  return uniqueValues.join(separator);
};

const highestPriority = (
  left: FlaggedSegment["priority"],
  right: FlaggedSegment["priority"],
): FlaggedSegment["priority"] => (priorityRanks[left] >= priorityRanks[right] ? left : right);

const mergeEndTime = (left?: number, right?: number) => {
  if (left === undefined) {
    return right;
  }

  if (right === undefined) {
    return left;
  }

  return Math.max(left, right);
};

const chooseMostSpecificText = (left: string, right: string) =>
  right.trim().length > left.trim().length ? right : left;

const mergeFlaggedSegment = (
  existing: FlaggedSegment,
  incoming: FlaggedSegment,
): FlaggedSegment => ({
  category: mergeUniqueText([existing.category, incoming.category], ", "),
  endTime: mergeEndTime(existing.endTime, incoming.endTime),
  priority: highestPriority(existing.priority, incoming.priority),
  reason: mergeUniqueText([existing.reason, incoming.reason], "; "),
  ruleId: mergeUniqueText([existing.ruleId, incoming.ruleId], ", "),
  startTime: Math.min(existing.startTime, incoming.startTime),
  text: chooseMostSpecificText(existing.text, incoming.text),
});

const mergeFlaggedSegments = (segments: FlaggedSegment[]) => {
  const merged: FlaggedSegment[] = [];

  for (const segment of [...segments].sort((left, right) => left.startTime - right.startTime)) {
    const existingIndex = merged.findIndex(
      (entry) => Math.abs(entry.startTime - segment.startTime) <= flaggedMergeToleranceSeconds,
    );

    if (existingIndex === -1) {
      merged.push(segment);
      continue;
    }

    const existing = merged[existingIndex];
    if (!existing) {
      merged.push(segment);
      continue;
    }

    merged[existingIndex] = mergeFlaggedSegment(existing, segment);
  }

  return merged.sort((left, right) => left.startTime - right.startTime);
};

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

const parseAnalysisSidecarCandidate = (parsed: unknown): AnalysisSidecar => {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Invalid analysis sidecar shape");
  }

  const candidate = parsed as RawAnalysisSidecar;
  if (!Array.isArray(candidate.flagged) || typeof candidate.summary !== "string") {
    throw new Error("Invalid analysis sidecar shape");
  }

  const flagged = candidate.flagged
    .map((entry) => normalizeFlaggedSegment(entry))
    .filter((entry): entry is FlaggedSegment => entry !== null);

  return {
    createdAt: typeof candidate.createdAt === "string" ? candidate.createdAt : "",
    engine: normalizeEngine(candidate.engine),
    flagged,
    summary: candidate.summary,
    videoFileName: typeof candidate.videoFileName === "string" ? candidate.videoFileName : "",
  };
};

const consolidateAnalysisSidecars = (sidecars: AnalysisSidecar[]): AnalysisSidecar => {
  if (sidecars.length === 0) {
    throw new Error("Invalid analysis sidecar shape");
  }

  const firstSidecar = sidecars[0];
  if (!firstSidecar) {
    throw new Error("Invalid analysis sidecar shape");
  }

  return {
    createdAt: firstNonEmptyString(sidecars.map((sidecar) => sidecar.createdAt)),
    engine:
      sidecars.find((sidecar) => sidecar.engine !== "blacklist")?.engine ?? firstSidecar.engine,
    flagged: mergeFlaggedSegments(sidecars.flatMap((sidecar) => sidecar.flagged)),
    summary: sidecars
      .map((sidecar) => sidecar.summary.trim())
      .filter(Boolean)
      .join("\n\n"),
    videoFileName: firstNonEmptyString(sidecars.map((sidecar) => sidecar.videoFileName)),
  };
};

const parseAnalysisSidecar = (content: string): AnalysisSidecar => {
  const parsed = JSON.parse(content) as unknown;

  if (Array.isArray(parsed)) {
    return consolidateAnalysisSidecars(parsed.map((entry) => parseAnalysisSidecarCandidate(entry)));
  }

  return parseAnalysisSidecarCandidate(parsed);
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

export type { ModerationJobResult, ModerationOverview, ModerationPriorityCounts };
export { buildModerationOverview, parseAnalysisSidecar, toJobArtifacts, toModerationJobResult };
