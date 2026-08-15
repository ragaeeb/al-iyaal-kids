import type {
  AnalysisBundle,
  AnalysisRun,
  FlaggedSegment,
  SubtitleEntry,
} from "@/features/media/types";
import { combineAnalysisBundles, parseAnalysisBundle } from "@/features/moderation/results";

type AnalysisImportResult = {
  bundle: AnalysisBundle;
  addedCount: number;
  duplicateCount: number;
  skippedCount: number;
  warnings: string[];
};
type CueResolutionResult = { content: string; warnings: string[] };

const subtitleMatchToleranceSeconds = 0.15;
const approximateMatchWindowSeconds = 30;
const minimumDistinctiveWordMatches = 2;
const ignoredMatchWords = new Set([
  "about",
  "against",
  "contains",
  "content",
  "introducing",
  "someone",
  "suggests",
  "that",
  "their",
  "there",
  "these",
  "this",
  "with",
]);

const toDistinctiveWords = (value: string) =>
  new Set(
    (value.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(
      (word) => word.length >= 4 && !ignoredMatchWords.has(word),
    ),
  );

const countSharedWords = (left: Set<string>, right: Set<string>) => {
  let count = 0;
  for (const word of left) {
    count += right.has(word) ? 1 : 0;
  }
  return count;
};

const findSubtitleInsertionIndex = (subtitles: SubtitleEntry[], startTime: number) => {
  let lower = 0;
  let upper = subtitles.length;
  while (lower < upper) {
    const middle = Math.floor((lower + upper) / 2);
    if ((subtitles[middle]?.startTime ?? Number.POSITIVE_INFINITY) < startTime) {
      lower = middle + 1;
    } else {
      upper = middle;
    }
  }
  return lower;
};

const findMatchingSubtitle = (subtitles: SubtitleEntry[], startTime: number) => {
  const lower = findSubtitleInsertionIndex(subtitles, startTime);
  for (const index of [lower - 1, lower, lower + 1]) {
    const subtitle = subtitles[index];
    if (
      subtitle &&
      (Math.abs(subtitle.startTime - startTime) <= subtitleMatchToleranceSeconds ||
        (subtitle.startTime <= startTime && startTime <= subtitle.endTime))
    ) {
      return subtitle;
    }
  }
  return undefined;
};

const analysisEntriesFromRoot = (root: unknown): Array<Record<string, unknown>> => {
  if (Array.isArray(root)) {
    return root.filter(
      (entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object",
    );
  }
  if (!root || typeof root !== "object") {
    return [];
  }
  const candidate = root as Record<string, unknown>;
  if (candidate.schemaVersion === 2 && Array.isArray(candidate.analyses)) {
    return candidate.analyses.filter(
      (entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object",
    );
  }
  return [candidate];
};

const providerFromRun = (run: Record<string, unknown>) => {
  if (typeof run.provider === "string") {
    return run.provider;
  }
  return typeof run.engine === "string" ? run.engine : "external";
};

const resolveCueIndexedFlag = (
  value: unknown,
  provider: string,
  subtitles: SubtitleEntry[],
  warnings: string[],
) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return true;
  }
  const flag = value as Record<string, unknown>;
  if (!Number.isInteger(flag.cueIndex) || Number(flag.cueIndex) < 0) {
    return true;
  }
  const cueIndex = Number(flag.cueIndex);
  const matches = subtitles.filter((subtitle) => subtitle.index === cueIndex);
  const subtitle = matches.length === 1 ? matches[0] : undefined;
  if (subtitle) {
    flag.startTime = subtitle.startTime;
    flag.endTime ??= subtitle.endTime;
    flag.text ??= subtitle.text;
    return true;
  }
  if (flag.startTime !== undefined) {
    return true;
  }
  warnings.push(
    `Skipped ${provider} finding for cue ${cueIndex}: the cue index did not uniquely match the source subtitles.`,
  );
  return false;
};

const resolveCueIndexes = (content: string, subtitles: SubtitleEntry[]): CueResolutionResult => {
  const root = JSON.parse(content) as unknown;
  const warnings: string[] = [];
  for (const run of analysisEntriesFromRoot(root)) {
    if (!Array.isArray(run.flagged)) {
      continue;
    }
    const provider = providerFromRun(run);
    run.flagged = run.flagged.filter((value) =>
      resolveCueIndexedFlag(value, provider, subtitles, warnings),
    );
  }
  return { content: JSON.stringify(root), warnings };
};

const findSubtitleByReason = (subtitles: SubtitleEntry[], startTime: number, reason: string) => {
  const reasonWords = toDistinctiveWords(reason);
  if (reasonWords.size < minimumDistinctiveWordMatches) {
    return undefined;
  }
  const candidates = subtitles.filter(
    (subtitle) => Math.abs(subtitle.startTime - startTime) <= approximateMatchWindowSeconds,
  );
  const ranked = candidates
    .map((subtitle) => ({
      distance: Math.abs(subtitle.startTime - startTime),
      score: countSharedWords(reasonWords, toDistinctiveWords(subtitle.text)),
      subtitle,
    }))
    .filter((candidate) => candidate.score >= minimumDistinctiveWordMatches)
    .sort((left, right) => right.score - left.score || left.distance - right.distance);
  const best = ranked[0];
  const runnerUp = ranked[1];
  return best && (!runnerUp || best.score > runnerUp.score) ? best.subtitle : undefined;
};

const enrichFlaggedSegment = (
  segment: FlaggedSegment,
  provider: string,
  subtitles: SubtitleEntry[],
): FlaggedSegment | null => {
  const subtitle =
    findMatchingSubtitle(subtitles, segment.startTime) ??
    findSubtitleByReason(subtitles, segment.startTime, segment.reason);
  if (!segment.text && !subtitle) {
    return null;
  }
  return {
    category: segment.category || "external",
    cueIndex: subtitle?.index ?? segment.cueIndex,
    endTime: segment.endTime ?? subtitle?.endTime,
    priority: segment.priority,
    reason: segment.reason,
    ruleId: segment.ruleId || provider,
    startTime: subtitle?.startTime ?? segment.startTime,
    text: segment.text || subtitle?.text || "",
  };
};

const enrichAnalysisRun = (run: AnalysisRun, subtitles: SubtitleEntry[]) => {
  const flagged: FlaggedSegment[] = [];
  const warnings: string[] = [];
  for (const segment of run.flagged) {
    const enriched = enrichFlaggedSegment(segment, run.provider, subtitles);
    if (enriched) {
      flagged.push(enriched);
    } else {
      warnings.push(
        `Skipped ${run.provider} finding at ${segment.startTime.toFixed(3)}s: no reliable subtitle cue match and no text was supplied.`,
      );
    }
  }
  return { run: { ...run, flagged }, warnings };
};

const buildImportedAnalysisBundle = (
  existingContent: string | null,
  importedContents: string[],
  sourceFile: string,
  subtitles: SubtitleEntry[],
): AnalysisImportResult => {
  if (importedContents.length === 0) {
    throw new Error("Drop or choose at least one analysis JSON file.");
  }
  const existing = existingContent ? parseAnalysisBundle(existingContent, sourceFile) : null;
  const resolvedImports = importedContents.map((content) => resolveCueIndexes(content, subtitles));
  const imports = resolvedImports.map(({ content }) => parseAnalysisBundle(content, sourceFile));
  const importedCount = imports.reduce((total, bundle) => total + bundle.analyses.length, 0);
  const existingCount = existing?.analyses.length ?? 0;
  const combined = combineAnalysisBundles(existing, imports, sourceFile);
  const enriched = combined.analyses.map((run) => enrichAnalysisRun(run, subtitles));
  const warnings = [
    ...resolvedImports.flatMap((result) => result.warnings),
    ...enriched.flatMap((result) => result.warnings),
  ];
  const bundle = {
    ...combined,
    analyses: enriched.map((result) => result.run),
  };
  const addedCount = bundle.analyses.length - existingCount;
  return {
    addedCount,
    bundle,
    duplicateCount: importedCount - addedCount,
    skippedCount: warnings.length,
    warnings,
  };
};

const validateAnalysisImportPaths = (paths: string[]) => {
  const unique = [...new Set(paths)];
  const unsupported = unique.filter((path) => !path.toLowerCase().endsWith(".json"));
  if (unsupported.length > 0) {
    throw new Error("Only JSON analysis files can be imported.");
  }
  if (unique.length === 0) {
    throw new Error("No analysis JSON files were selected.");
  }
  return unique;
};

export type { AnalysisImportResult };
export { buildImportedAnalysisBundle, validateAnalysisImportPaths };
