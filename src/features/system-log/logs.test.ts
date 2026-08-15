import { describe, expect, it } from "bun:test";

import {
  appendSystemLogEntry,
  boundSystemLogEntries,
  createInitialSystemLogState,
  MAX_SYSTEM_LOG_CHARACTERS,
  MAX_SYSTEM_LOG_LINES,
  mergeSystemLogHistory,
  toSystemLogKey,
} from "@/features/system-log/logs";

describe("system log helpers", () => {
  it("should bound stored entries to the most recent 500 lines", () => {
    const entries = Array.from({ length: MAX_SYSTEM_LOG_LINES + 2 }, (_, id) => ({
      id,
      text: `line-${id}`,
    }));

    const bounded = boundSystemLogEntries(entries);

    expect(bounded).toHaveLength(MAX_SYSTEM_LOG_LINES);
    expect(bounded[0]?.text).toBe("line-2");
    expect(bounded.at(-1)?.text).toBe(`line-${MAX_SYSTEM_LOG_LINES + 1}`);
  });

  it("should preserve live lines received before history resolves", () => {
    const liveState = appendSystemLogEntry(
      appendSystemLogEntry(createInitialSystemLogState(), "live-1"),
      "live-2",
    );

    const merged = mergeSystemLogHistory(liveState, ["history-1", "live-1"]);

    expect(merged.entries.map((entry) => entry.text)).toEqual(["history-1", "live-1", "live-2"]);
    expect(merged.entries.at(-2)?.id).toBe(liveState.entries.at(0)?.id);
    expect(merged.entries.at(-1)?.id).toBe(liveState.entries.at(1)?.id);
  });

  it("should allocate stable keys for repeated log lines", () => {
    const state = appendSystemLogEntry(
      appendSystemLogEntry(createInitialSystemLogState(), "same"),
      "same",
    );

    const keys = state.entries.map(toSystemLogKey);

    expect(keys).toEqual(["system-log-0", "system-log-1"]);
    expect(new Set(keys).size).toBe(2);
  });

  it("should cap retained live and history line sizes", () => {
    const oversized = "x".repeat(MAX_SYSTEM_LOG_CHARACTERS + 1);
    const live = appendSystemLogEntry(createInitialSystemLogState(), oversized);
    const history = mergeSystemLogHistory(createInitialSystemLogState(), [oversized]);

    expect(live.entries[0]?.text.endsWith("[truncated]")).toBe(true);
    expect(history.entries[0]?.text).toBe(live.entries[0]?.text);
  });
});
