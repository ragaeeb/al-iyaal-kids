import type { SubtitleEntry } from "@/features/media/types";

const SRT_TIME_PATTERN = /(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})/;

export const parseSrtTime = (value: string) => {
  const [hh, mm, rest] = value.split(":");
  if (!hh || !mm || !rest) {
    return 0;
  }
  const [ss, ms] = rest.split(",");
  if (!ss || !ms) {
    return 0;
  }
  return Number(hh) * 3600 + Number(mm) * 60 + Number(ss) + Number(ms) / 1000;
};

export const parseSrt = (content: string): SubtitleEntry[] => {
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!normalized) {
    return [];
  }

  const blocks = normalized.split("\n\n");
  const subtitles: SubtitleEntry[] = [];

  for (const block of blocks) {
    const lines = block.split("\n");
    if (lines.length < 3) {
      continue;
    }

    const index = Number(lines[0]);
    if (!Number.isFinite(index)) {
      continue;
    }

    const timeMatch = lines[1]?.match(SRT_TIME_PATTERN);
    if (!timeMatch) {
      continue;
    }

    subtitles.push({
      endTime: parseSrtTime(timeMatch[2] ?? "00:00:00,000"),
      index,
      startTime: parseSrtTime(timeMatch[1] ?? "00:00:00,000"),
      text: lines.slice(2).join("\n"),
    });
  }

  return subtitles;
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

export const parseClockValueToSeconds = (value: string) => {
  const pieces = value.trim().split(":").map(Number);
  let total = 0;
  let multiplier = 1;
  for (let index = pieces.length - 1; index >= 0; index -= 1) {
    total += (pieces[index] ?? 0) * multiplier;
    multiplier *= 60;
  }
  return total;
};
