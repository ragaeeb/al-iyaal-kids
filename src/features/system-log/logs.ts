import { truncateText } from "@/features/shared/text";

export const MAX_SYSTEM_LOG_LINES = 500;
export const MAX_SYSTEM_LOG_CHARACTERS = 4_000;

type SystemLogEntry = {
  id: number;
  text: string;
};

type SystemLogState = {
  entries: SystemLogEntry[];
  nextId: number;
};

const createInitialSystemLogState = (): SystemLogState => ({
  entries: [],
  nextId: 0,
});

const boundSystemLogEntries = (
  entries: SystemLogEntry[],
  maxLines = MAX_SYSTEM_LOG_LINES,
): SystemLogEntry[] => entries.slice(-Math.max(0, maxLines));

const appendSystemLogEntry = (
  state: SystemLogState,
  text: string,
  maxLines = MAX_SYSTEM_LOG_LINES,
): SystemLogState => ({
  entries: boundSystemLogEntries(
    [
      ...state.entries,
      {
        id: state.nextId,
        text: truncateText(text, MAX_SYSTEM_LOG_CHARACTERS),
      },
    ],
    maxLines,
  ),
  nextId: state.nextId + 1,
});

const findHistoryLiveOverlap = (history: string[], liveEntries: SystemLogEntry[]) => {
  const maxOverlap = Math.min(history.length, liveEntries.length);

  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    const historyStart = history.length - overlap;
    const matches = liveEntries
      .slice(0, overlap)
      .every((entry, index) => history[historyStart + index] === entry.text);

    if (matches) {
      return overlap;
    }
  }

  return 0;
};

const mergeSystemLogHistory = (
  state: SystemLogState,
  history: string[],
  maxLines = MAX_SYSTEM_LOG_LINES,
): SystemLogState => {
  const boundedHistory = history
    .slice(-Math.max(0, maxLines))
    .map((line) => truncateText(line, MAX_SYSTEM_LOG_CHARACTERS));
  const historyEntries = boundedHistory.map((text, index) => ({
    id: state.nextId + index,
    text,
  }));
  const overlap = findHistoryLiveOverlap(boundedHistory, state.entries);
  const mergedHistoryEntries =
    overlap === 0
      ? historyEntries
      : [...historyEntries.slice(0, -overlap), ...state.entries.slice(0, overlap)];

  return {
    entries: boundSystemLogEntries(
      [...mergedHistoryEntries, ...state.entries.slice(overlap)],
      maxLines,
    ),
    nextId: state.nextId + historyEntries.length,
  };
};

const toSystemLogKey = (entry: SystemLogEntry) => `system-log-${entry.id}`;

export type { SystemLogEntry, SystemLogState };
export {
  appendSystemLogEntry,
  boundSystemLogEntries,
  createInitialSystemLogState,
  mergeSystemLogHistory,
  toSystemLogKey,
};
