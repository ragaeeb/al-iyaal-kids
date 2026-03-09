import { describe, expect, it } from "bun:test";
import type { AnalyticsSnapshot } from "@/features/analytics/types";
import {
  createSeededTrend,
  toAnalyticsMetricCards,
  toTaskBreakdown,
} from "@/features/analytics/utils";

const snapshot: AnalyticsSnapshot = {
  breakdown: [
    { jobs: 5, label: "", taskKind: "remove_music" },
    { jobs: 3, label: "", taskKind: "transcription" },
  ],
  recentRuns: 4,
  totals: {
    cancelledCount: 1,
    cumulativeProcessingMinutes: 135,
    failureCount: 2,
    successCount: 9,
    totalCutJobs: 1,
    totalFilesWithFlags: 2,
    totalFlaggedItems: 7,
    totalFlagJobs: 2,
    totalMediaProcessed: 12,
    totalRemoveMusicJobs: 5,
    totalTranscriptionJobs: 4,
  },
};

describe("analytics utils", () => {
  it("should derive analytics cards from persisted totals", () => {
    const cards = toAnalyticsMetricCards(snapshot);

    expect(cards[0]?.value).toBe("12");
    expect(cards[2]?.value).toBe("2h 15m");
    expect(cards[3]?.value).toBe("75%");
  });

  it("should keep analytics chart data separate from real summary counters", () => {
    const trend = createSeededTrend(snapshot);
    const breakdown = toTaskBreakdown(snapshot);

    expect(trend).toHaveLength(6);
    expect(breakdown[0]?.label).toBe("Remove Music");
    expect(breakdown[1]?.jobs).toBe(3);
  });
});
