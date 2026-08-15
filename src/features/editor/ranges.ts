import type { CutRange } from "@/features/media/types";

export const parseSavedCutRanges = (value: string): CutRange[] => {
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || !("ranges" in parsed)) {
    throw new Error("Invalid cut-ranges sidecar: expected a ranges array.");
  }

  const { ranges } = parsed;
  if (!Array.isArray(ranges)) {
    throw new Error("Invalid cut-ranges sidecar: ranges must be an array.");
  }

  return ranges.map((range, index) => {
    if (!range || typeof range !== "object" || !("start" in range) || !("end" in range)) {
      throw new Error(`Invalid cut range ${index + 1}: start and end are required.`);
    }

    const { end, start } = range;
    if (typeof start !== "string" || typeof end !== "string") {
      throw new Error(`Invalid cut range ${index + 1}: start and end must be strings.`);
    }

    const startSeconds = Number(start);
    const endSeconds = Number(end);
    if (
      !Number.isFinite(startSeconds) ||
      !Number.isFinite(endSeconds) ||
      startSeconds < 0 ||
      endSeconds <= startSeconds
    ) {
      throw new Error(`Invalid cut range ${index + 1}: end must be greater than start.`);
    }

    return { end, start };
  });
};
