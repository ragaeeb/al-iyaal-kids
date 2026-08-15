import type {
  AnalysisBundle,
  AnalysisRun,
  AnalysisSidecar,
  FlaggedSegment,
  TaskJobArtifacts,
  TaskJobRecord,
} from "@/features/media/types";
import { parseFlexibleTimeToSeconds } from "@/features/shared/timecode";

type ModerationPriorityCounts = { high: number; medium: number; low: number };
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

const flaggedMergeToleranceSeconds = 0.25;
const priorityRanks = { high: 3, low: 1, medium: 2 } as const;
const emptyPriorityCounts = (): ModerationPriorityCounts => ({ high: 0, low: 0, medium: 0 });

const requiredString = (value: unknown, message: string) => {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(message);
  }
  return value.trim();
};

const optionalString = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const parseFlaggedSegment = (candidate: unknown, index: number): FlaggedSegment => {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new Error(`Invalid analysis flag ${index + 1}: expected an object.`);
  }
  const segment = candidate as Record<string, unknown>;
  const startTime = parseFlexibleTimeToSeconds(segment.startTime);
  if (startTime === null) {
    throw new Error(`Invalid analysis flag ${index + 1}: startTime must be a valid timecode.`);
  }
  if (segment.priority !== "high" && segment.priority !== "medium" && segment.priority !== "low") {
    throw new Error(`Invalid analysis flag ${index + 1}: priority is unsupported.`);
  }
  const endTime =
    typeof segment.endTime === "number" &&
    Number.isFinite(segment.endTime) &&
    segment.endTime > startTime
      ? segment.endTime
      : undefined;
  return {
    category: optionalString(segment.category) ?? "",
    cueIndex:
      Number.isInteger(segment.cueIndex) && Number(segment.cueIndex) >= 0
        ? Number(segment.cueIndex)
        : undefined,
    endTime,
    priority: segment.priority,
    reason: requiredString(
      segment.reason,
      `Invalid analysis flag ${index + 1}: reason is required.`,
    ),
    ruleId: optionalString(segment.ruleId) ?? "",
    startTime,
    text: optionalString(segment.text) ?? "",
  };
};

const parseAnalysisRun = (candidate: unknown, index: number): AnalysisRun => {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new Error(`Invalid analysis entry ${index + 1}: expected an object.`);
  }
  const run = candidate as Record<string, unknown>;
  if (!Array.isArray(run.flagged)) {
    throw new Error(`Invalid analysis entry ${index + 1}: flagged must be an array.`);
  }
  const provider =
    optionalString(run.provider) ??
    optionalString(run.engine) ??
    optionalString(run.model) ??
    "external";
  return {
    createdAt: optionalString(run.createdAt) ?? optionalString(run.timestamp),
    flagged: run.flagged.map(parseFlaggedSegment),
    id: optionalString(run.id),
    model: optionalString(run.model),
    provider,
    reasoning: optionalString(run.reasoning) ?? optionalString(run.strategy),
    summary: requiredString(
      run.summary,
      `Invalid analysis entry ${index + 1}: summary is required.`,
    ),
  };
};

const parseAnalysisBundle = (content: string, fallbackSourceFile = ""): AnalysisBundle => {
  const parsed = JSON.parse(content) as unknown;
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const candidate = parsed as Record<string, unknown>;
    if (candidate.schemaVersion === 2) {
      if (!Array.isArray(candidate.analyses)) {
        throw new Error("Invalid analysis bundle: analyses must be an array.");
      }
      return {
        analyses: candidate.analyses.map(parseAnalysisRun),
        schemaVersion: 2,
        sourceFile: optionalString(candidate.sourceFile) ?? fallbackSourceFile,
      };
    }
  }

  const entries = Array.isArray(parsed) ? parsed : [parsed];
  if (entries.length === 0) {
    throw new Error("Invalid analysis import: no analysis entries were found.");
  }
  const first = entries[0] as Record<string, unknown> | undefined;
  return {
    analyses: entries.map(parseAnalysisRun),
    schemaVersion: 2,
    sourceFile: optionalString(first?.videoFileName) ?? fallbackSourceFile,
  };
};

const runFingerprint = (run: AnalysisRun) =>
  JSON.stringify({
    createdAt: run.createdAt ?? "",
    flagged: run.flagged,
    model: run.model ?? "",
    provider: run.provider,
    reasoning: run.reasoning ?? "",
    summary: run.summary,
  });

const combineAnalysisBundles = (
  existing: AnalysisBundle | null,
  imports: AnalysisBundle[],
  sourceFile: string,
): AnalysisBundle => {
  const analyses: AnalysisRun[] = [];
  const fingerprints = new Set<string>();
  for (const run of [
    ...(existing?.analyses ?? []),
    ...imports.flatMap((bundle) => bundle.analyses),
  ]) {
    const fingerprint = runFingerprint(run);
    if (!fingerprints.has(fingerprint)) {
      fingerprints.add(fingerprint);
      analyses.push(run);
    }
  }
  return { analyses, schemaVersion: 2, sourceFile: sourceFile || existing?.sourceFile || "" };
};

const mergeText = (left: string, right: string, separator: string) =>
  [...new Set([left.trim(), right.trim()].filter(Boolean))].join(separator);

const mergeSegment = (left: FlaggedSegment, right: FlaggedSegment): FlaggedSegment => ({
  category: mergeText(left.category, right.category, ", "),
  endTime:
    left.endTime === undefined
      ? right.endTime
      : right.endTime === undefined
        ? left.endTime
        : Math.max(left.endTime, right.endTime),
  priority:
    priorityRanks[left.priority] >= priorityRanks[right.priority] ? left.priority : right.priority,
  reason: mergeText(left.reason, right.reason, "; "),
  ruleId: mergeText(left.ruleId, right.ruleId, ", "),
  startTime: Math.min(left.startTime, right.startTime),
  text: right.text.length > left.text.length ? right.text : left.text,
});

const mergeFlaggedSegments = (segments: FlaggedSegment[]) => {
  const merged: FlaggedSegment[] = [];
  for (const segment of [...segments].sort((left, right) => left.startTime - right.startTime)) {
    const index = merged.findIndex(
      (entry) => Math.abs(entry.startTime - segment.startTime) <= flaggedMergeToleranceSeconds,
    );
    if (index < 0) {
      merged.push(segment);
    } else {
      const existing = merged[index];
      if (existing) {
        merged[index] = mergeSegment(existing, segment);
      }
    }
  }
  return merged;
};

const toAnalysisSidecar = (bundle: AnalysisBundle): AnalysisSidecar => {
  if (bundle.analyses.length === 0) {
    throw new Error("Invalid analysis bundle: at least one analysis is required for display.");
  }
  const providers = [...new Set(bundle.analyses.map((run) => run.provider))];
  return {
    analysisCount: bundle.analyses.length,
    createdAt: bundle.analyses.find((run) => run.createdAt)?.createdAt ?? "",
    engine: providers[0] ?? "external",
    flagged: mergeFlaggedSegments(bundle.analyses.flatMap((run) => run.flagged)),
    providers,
    summary: bundle.analyses
      .map((run) => run.summary.trim())
      .filter(Boolean)
      .join("\n\n"),
    videoFileName: bundle.sourceFile,
  };
};

const parseAnalysisSidecar = (content: string): AnalysisSidecar =>
  toAnalysisSidecar(parseAnalysisBundle(content));

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

const buildModerationOverview = (jobs: ModerationJobResult[]): ModerationOverview =>
  jobs.reduce<ModerationOverview>(
    (overview, job) => {
      overview.totalFlagged += job.flaggedCount;
      overview.filesWithFlags += job.flaggedCount > 0 ? 1 : 0;
      for (const segment of job.segments) {
        overview.counts[segment.priority] += 1;
      }
      return overview;
    },
    { counts: emptyPriorityCounts(), filesWithFlags: 0, totalFlagged: 0 },
  );

const toJobArtifacts = (value: unknown): TaskJobArtifacts | undefined => {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const candidate = value as Partial<TaskJobArtifacts>;
  if (
    (candidate.flaggedCount !== undefined &&
      (!Number.isInteger(candidate.flaggedCount) || candidate.flaggedCount < 0)) ||
    (candidate.summary !== undefined && typeof candidate.summary !== "string")
  ) {
    return undefined;
  }
  return { flaggedCount: candidate.flaggedCount, summary: candidate.summary };
};

export type { ModerationJobResult, ModerationOverview, ModerationPriorityCounts };
export {
  buildModerationOverview,
  combineAnalysisBundles,
  parseAnalysisBundle,
  parseAnalysisSidecar,
  toAnalysisSidecar,
  toJobArtifacts,
  toModerationJobResult,
};
