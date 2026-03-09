import type {
  AnalyticsMetricCard,
  AnalyticsSnapshot,
  AnalyticsTaskKindBreakdown,
  AnalyticsTotals,
  AnalyticsTrendPoint,
} from "@/features/analytics/types";

const taskKindLabel: Record<AnalyticsTaskKindBreakdown["taskKind"], string> = {
  cut: "Cut Exports",
  flag: "Detection Runs",
  remove_music: "Remove Music",
  transcription: "Transcriptions",
};

const formatMinutes = (minutes: number) => {
  if (minutes < 60) {
    return `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder === 0 ? `${hours}h` : `${hours}h ${remainder}m`;
};

export const createEmptyAnalyticsTotals = (): AnalyticsTotals => ({
  cancelledCount: 0,
  cumulativeProcessingMinutes: 0,
  failureCount: 0,
  successCount: 0,
  totalCutJobs: 0,
  totalFilesWithFlags: 0,
  totalFlaggedItems: 0,
  totalFlagJobs: 0,
  totalMediaProcessed: 0,
  totalRemoveMusicJobs: 0,
  totalTranscriptionJobs: 0,
});

export const toAnalyticsMetricCards = (snapshot: AnalyticsSnapshot): AnalyticsMetricCard[] => {
  const { totals } = snapshot;
  const totalRuns =
    totals.totalRemoveMusicJobs +
    totals.totalTranscriptionJobs +
    totals.totalFlagJobs +
    totals.totalCutJobs;

  return [
    {
      hint: `${totals.successCount} successful completions`,
      icon: "activity",
      label: "Media Processed",
      value: totals.totalMediaProcessed.toString(),
    },
    {
      hint: `${snapshot.recentRuns} completed runs recorded`,
      icon: "wand",
      label: "Workflow Runs",
      value: totalRuns.toString(),
    },
    {
      hint: `${totals.failureCount} failed, ${totals.cancelledCount} cancelled`,
      icon: "clock",
      label: "Processing Time",
      value: formatMinutes(totals.cumulativeProcessingMinutes),
    },
    {
      hint: "Local-only analytics stored on this machine",
      icon: "shield",
      label: "Success Rate",
      value:
        totals.totalMediaProcessed === 0
          ? "0%"
          : `${Math.round((totals.successCount / totals.totalMediaProcessed) * 100)}%`,
    },
  ];
};

export const toTaskBreakdown = (snapshot: AnalyticsSnapshot): AnalyticsTaskKindBreakdown[] => {
  return snapshot.breakdown.map((item) => ({
    ...item,
    label: taskKindLabel[item.taskKind],
  }));
};

export const createSeededTrend = (snapshot: AnalyticsSnapshot): AnalyticsTrendPoint[] => {
  const base = Math.max(snapshot.totals.totalMediaProcessed, 4);
  const values = [0.45, 0.58, 0.38, 0.71, 0.62, 0.84].map((ratio) =>
    Math.max(1, Math.round(base * ratio)),
  );

  return ["Jan", "Feb", "Mar", "Apr", "May", "Jun"].map((label, index) => ({
    label,
    value: values[index] ?? 1,
  }));
};
