import { Activity, AudioLines, Clock3, Scissors, ShieldAlert, WandSparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { AnalyticsChartCard } from "@/components/layout/analytics-chart-card";
import { MetricCard } from "@/components/layout/metric-card";
import { Button } from "@/components/ui/button";
import { getAnalyticsSnapshot } from "@/features/analytics/transport";
import type { AnalyticsSnapshot } from "@/features/analytics/types";
import {
  createSeededTrend,
  toAnalyticsMetricCards,
  toTaskBreakdown,
} from "@/features/analytics/utils";

const taskKindIcon = {
  cut: Scissors,
  flag: ShieldAlert,
  remove_music: WandSparkles,
  transcription: AudioLines,
};

const emptySnapshot: AnalyticsSnapshot = {
  breakdown: [],
  recentRuns: 0,
  totals: {
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
  },
};

const metricCardIcons = [Activity, WandSparkles, Clock3, ShieldAlert];

const AnalyticsPanel = () => {
  const [snapshot, setSnapshot] = useState<AnalyticsSnapshot>(emptySnapshot);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadSnapshot = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const nextSnapshot = await getAnalyticsSnapshot();
      setSnapshot(nextSnapshot);
    } catch (error: unknown) {
      setErrorMessage(
        error instanceof Error ? error.message : "Failed loading analytics snapshot.",
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSnapshot().catch(() => undefined);
  }, [loadSnapshot]);

  const metricCards = useMemo(() => toAnalyticsMetricCards(snapshot), [snapshot]);
  const trendPoints = useMemo(() => createSeededTrend(snapshot), [snapshot]);
  const breakdown = useMemo(() => toTaskBreakdown(snapshot), [snapshot]);
  const peakValue = Math.max(...trendPoints.map((point) => point.value), 1);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-4 gap-4">
        {metricCards.map((card, index) => {
          const Icon = metricCardIcons[index] ?? Activity;

          return (
            <MetricCard
              key={card.label}
              hint={card.hint}
              icon={<Icon className="size-5" />}
              label={card.label}
              value={card.value}
            />
          );
        })}
      </div>

      <div className="grid grid-cols-3 gap-4">
        <MetricCard
          hint={`${snapshot.totals.totalFlagJobs} detection run${snapshot.totals.totalFlagJobs === 1 ? "" : "s"} recorded`}
          icon={<ShieldAlert className="size-5" />}
          label="Flagged Lines"
          value={snapshot.totals.totalFlaggedItems.toString()}
        />
        <MetricCard
          hint="Files that produced one or more moderation flags"
          icon={<ShieldAlert className="size-5" />}
          label="Files With Flags"
          value={snapshot.totals.totalFilesWithFlags.toString()}
        />
        <MetricCard
          hint="Detection jobs completed across local and cloud analysis modes"
          icon={<Activity className="size-5" />}
          label="Detection Runs"
          value={snapshot.totals.totalFlagJobs.toString()}
        />
      </div>

      <div className="grid grid-cols-[1.35fr_1fr] gap-5">
        <AnalyticsChartCard
          title="Processing Activity"
          description="Top-level totals are real. Trend visualization is seeded for the first pass."
        >
          <div className="space-y-5">
            <div className="grid h-72 grid-cols-6 items-end gap-4 rounded-[22px] bg-[linear-gradient(180deg,#fff8f3,#fef4ee)] p-5">
              {trendPoints.map((point) => (
                <div key={point.label} className="flex h-full flex-col justify-end gap-3">
                  <div
                    className="rounded-t-[18px] bg-[linear-gradient(180deg,#c57267,#88322d)] shadow-[0_12px_30px_rgba(136,50,45,0.16)]"
                    style={{ height: `${Math.max((point.value / peakValue) * 100, 12)}%` }}
                  />
                  <p className="text-center text-[#8f5e56] text-xs">{point.label}</p>
                </div>
              ))}
            </div>
            <p className="text-[#8f5e56] text-sm">
              Recent completed runs:{" "}
              <span className="font-medium text-[#5b2722]">{snapshot.recentRuns}</span>
            </p>
          </div>
        </AnalyticsChartCard>

        <AnalyticsChartCard
          title="Workflow Mix"
          description="Breakdown is generated from persisted local task history."
        >
          <div className="space-y-3">
            {breakdown.length === 0 ? (
              <p className="rounded-2xl border border-[#e7d2c5] border-dashed bg-[#fff8f3] px-4 py-5 text-[#8f5e56] text-sm">
                No completed workflow history yet. Run a tool to start populating analytics.
              </p>
            ) : (
              breakdown.map((item) => {
                const Icon = taskKindIcon[item.taskKind];
                const width = Math.max(
                  10,
                  snapshot.totals.totalMediaProcessed === 0
                    ? 10
                    : Math.round((item.jobs / snapshot.totals.totalMediaProcessed) * 100),
                );

                return (
                  <div
                    key={item.taskKind}
                    className="rounded-[22px] border border-[#ead3c4] bg-[#fffaf7] p-4"
                  >
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <span className="flex size-10 items-center justify-center rounded-2xl bg-[#f5e6dc] text-[#88322d]">
                          <Icon className="size-4" />
                        </span>
                        <div>
                          <p className="font-medium text-[#5b2722] text-sm">{item.label}</p>
                          <p className="text-[#8f5e56] text-xs">{item.jobs} jobs recorded</p>
                        </div>
                      </div>
                      <span className="font-medium text-[#6a2924] text-sm">{width}%</span>
                    </div>
                    <div className="h-3 rounded-full bg-[#f4e6db]">
                      <div
                        className="h-full rounded-full bg-[linear-gradient(90deg,#c57267,#88322d)]"
                        style={{ width: `${width}%` }}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </AnalyticsChartCard>
      </div>

      <div className="grid grid-cols-[1fr_auto] items-center rounded-[26px] border border-[#ead3c4] bg-[#fff9f5] px-5 py-4">
        <div>
          <p className="font-medium text-[#5b2722] text-sm">Analytics source</p>
          <p className="mt-1 text-[#8f5e56] text-sm">
            Counts and processing minutes are persisted locally in app data and survive app
            restarts.
          </p>
          {errorMessage ? <p className="mt-2 text-rose-700 text-sm">{errorMessage}</p> : null}
        </div>
        <Button type="button" variant="secondary" onClick={loadSnapshot} disabled={isLoading}>
          {isLoading ? "Refreshing..." : "Refresh Analytics"}
        </Button>
      </div>
    </div>
  );
};

export { AnalyticsPanel };
