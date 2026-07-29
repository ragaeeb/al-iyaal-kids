import type { CutRange, FlaggedSegment } from "@/features/media/types";

const PRIORITY_ORDER = ["high", "medium", "low"] as const;

const byPriority = (left: FlaggedSegment, right: FlaggedSegment) => {
  const leftRank = PRIORITY_ORDER.indexOf(left.priority);
  const rightRank = PRIORITY_ORDER.indexOf(right.priority);
  return leftRank - rightRank;
};

const byStartTime = (left: FlaggedSegment, right: FlaggedSegment) =>
  left.startTime - right.startTime;

const toClock = (seconds: number) => {
  const safe = Math.max(0, Math.floor(seconds));
  const hh = Math.floor(safe / 3600);
  const mm = Math.floor((safe % 3600) / 60);
  const ss = safe % 60;
  if (hh > 0) {
    return `${hh}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
  }
  return `${mm}:${String(ss).padStart(2, "0")}`;
};

export const buildSuggestedCutRanges = (
  segments: FlaggedSegment[],
  selectedPriorities: Array<FlaggedSegment["priority"]> = ["high"],
): CutRange[] =>
  segments
    .filter((segment) => selectedPriorities.includes(segment.priority))
    .sort((left, right) => byStartTime(left, right) || byPriority(left, right))
    .map((segment) => ({
      end: toClock(segment.endTime ?? segment.startTime),
      start: toClock(segment.startTime),
    }));

export const parseRangeInput = (value: string): CutRange[] => {
  const pattern = /(\d{1,2}:\d{2}(?::\d{2})?)\s*-\s*(\d{1,2}:\d{2}(?::\d{2})?)/g;
  const matches = [...value.matchAll(pattern)];
  return matches.map((match) => ({
    end: match[2] ?? "0:00",
    start: match[1] ?? "0:00",
  }));
};

export const parseSavedCutRanges = (value: string): CutRange[] => {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || !("ranges" in parsed)) {
      return [];
    }

    const { ranges } = parsed;
    if (!Array.isArray(ranges)) {
      return [];
    }

    return ranges.flatMap((range) => {
      if (!range || typeof range !== "object" || !("start" in range) || !("end" in range)) {
        return [];
      }

      const { end, start } = range;
      if (typeof start !== "string" || typeof end !== "string") {
        return [];
      }

      const startSeconds = Number(start);
      const endSeconds = Number(end);
      if (
        !Number.isFinite(startSeconds) ||
        !Number.isFinite(endSeconds) ||
        startSeconds < 0 ||
        endSeconds <= startSeconds
      ) {
        return [];
      }

      return [{ end, start }];
    });
  } catch {
    return [];
  }
};
