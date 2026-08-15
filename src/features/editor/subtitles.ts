import type { SubtitleEntry } from "@/features/media/types";

const SRT_TIME_PATTERN = /^(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})$/;

const parseSrtTime = (value: string): number | null => {
  const [hh, mm, rest] = value.split(":");
  if (!hh || !mm || !rest) {
    return null;
  }
  const [ss, ms] = rest.split(",");
  if (!ss || !ms) {
    return null;
  }
  const values = [hh, mm, ss, ms].map(Number);
  if (values.some((part) => !Number.isFinite(part))) {
    return null;
  }
  const [hours = 0, minutes = 0, seconds = 0, milliseconds = 0] = values;
  if (minutes >= 60 || seconds >= 60 || milliseconds >= 1000) {
    return null;
  }
  return hours * 3600 + minutes * 60 + seconds + milliseconds / 1000;
};

const invalidCueError = (cueNumber: number, reason: string) =>
  new Error(`Invalid subtitle cue ${cueNumber}: ${reason}.`);

const parseSrtBlock = (block: string, blockIndex: number): SubtitleEntry => {
  const lines = block.split("\n");
  if (lines.length < 3) {
    throw invalidCueError(blockIndex + 1, "expected an index, timestamp range, and text");
  }

  const index = Number(lines[0]?.trim());
  if (!Number.isInteger(index) || index < 1) {
    throw invalidCueError(blockIndex + 1, "the cue index must be a positive integer");
  }

  const timeMatch = lines[1]?.trim().match(SRT_TIME_PATTERN);
  if (!timeMatch) {
    throw invalidCueError(index, "the timestamp range is malformed");
  }

  const startTime = parseSrtTime(timeMatch[1] ?? "");
  const endTime = parseSrtTime(timeMatch[2] ?? "");
  if (startTime === null || endTime === null) {
    throw invalidCueError(index, "the timestamp contains an invalid value");
  }
  if (endTime <= startTime) {
    throw invalidCueError(index, "the end time must be after the start time");
  }

  const text = lines.slice(2).join("\n").trim();
  if (!text) {
    throw invalidCueError(index, "the subtitle text is empty");
  }

  return {
    endTime,
    index,
    startTime,
    text,
  };
};

export const parseSrt = (content: string): SubtitleEntry[] => {
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!normalized) {
    return [];
  }

  const blocks = normalized.split(/\n{2,}/).filter((block) => block.trim().length > 0);
  const subtitles = blocks.map(parseSrtBlock);

  return subtitles.sort(
    (left, right) => left.startTime - right.startTime || left.index - right.index,
  );
};

export const formatTime = (seconds: number, maxDuration = seconds) => {
  const hh = Math.floor(seconds / 3600);
  const mm = Math.floor((seconds % 3600) / 60);
  const ss = Math.floor(seconds % 60);
  if (maxDuration >= 3600) {
    return `${hh}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
  }
  return `${mm}:${String(ss).padStart(2, "0")}`;
};

export const findSubtitleAtTime = (subtitles: SubtitleEntry[], currentTime: number) => {
  let lower = 0;
  let upper = subtitles.length - 1;
  let candidateIndex = -1;

  while (lower <= upper) {
    const middle = Math.floor((lower + upper) / 2);
    const subtitle = subtitles[middle];
    if (subtitle && subtitle.startTime <= currentTime) {
      candidateIndex = middle;
      lower = middle + 1;
    } else {
      upper = middle - 1;
    }
  }

  const candidate = subtitles[candidateIndex];
  return candidate && currentTime <= candidate.endTime ? candidate : undefined;
};
