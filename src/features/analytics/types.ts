export type AnalyticsTaskKind = "remove_music" | "transcription" | "flag" | "cut";

export type AnalyticsTotals = {
  totalMediaProcessed: number;
  totalRemoveMusicJobs: number;
  totalTranscriptionJobs: number;
  totalFlagJobs: number;
  totalCutJobs: number;
  totalFlaggedItems: number;
  totalFilesWithFlags: number;
  successCount: number;
  failureCount: number;
  cancelledCount: number;
  cumulativeProcessingMinutes: number;
};

export type AnalyticsTaskKindBreakdown = {
  taskKind: AnalyticsTaskKind;
  jobs: number;
  label: string;
};

export type AnalyticsTrendPoint = {
  label: string;
  value: number;
};

export type AnalyticsSnapshot = {
  totals: AnalyticsTotals;
  breakdown: AnalyticsTaskKindBreakdown[];
  recentRuns: number;
};

export type AnalyticsMetricCard = {
  icon: "activity" | "clock" | "shield" | "wand";
  label: string;
  value: string;
  hint: string;
};
