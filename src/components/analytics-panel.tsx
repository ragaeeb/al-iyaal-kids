import { Activity, AudioLines, Clock3, Scissors, ShieldAlert, WandSparkles } from "lucide-react";
import { useEffect, useState } from "react";

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

const metricCardIconByKey = {
  activity: Activity,
  clock: Clock3,
  shield: ShieldAlert,
  wand: WandSparkles,
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

const fetchAnalyticsSnapshot = async () => getAnalyticsSnapshot();

const toErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Failed loading analytics snapshot.";

const AnalyticsPanel = () => {
  const [snapshot, setSnapshot] = useState<AnalyticsSnapshot>(emptySnapshot);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadSnapshot = async () => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const nextSnapshot = await fetchAnalyticsSnapshot();
      setSnapshot(nextSnapshot);
    } catch (error: unknown) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      setIsLoading(true);
      setErrorMessage(null);

      try {
        const nextSnapshot = await fetchAnalyticsSnapshot();
        if (!mounted) {
          return;
        }
        setSnapshot(nextSnapshot);
      } catch (error: unknown) {
        if (!mounted) {
          return;
        }
        setErrorMessage(toErrorMessage(error));
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    };

    load().catch(() => undefined);

    return () => {
      mounted = false;
    };
  }, []);

  const metricCards = toAnalyticsMetricCards(snapshot);
  const trendPoints = createSeededTrend(snapshot);
  const breakdown = toTaskBreakdown(snapshot);
  const peakValue = Math.max(...trendPoints.map((point) => point.value), 1);

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {metricCards.map((card) => {
          const Icon = metricCardIconByKey[card.icon] ?? Activity;

          return (
            <MetricCard
              key={card.label}
              hint={card.hint}
              icon={<Icon className="size-3.5" />}
              label={card.label}
              value={card.value}
            />
          );
        })}
      </div>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
        <MetricCard
          hint={`${snapshot.totals.totalFlagJobs} detection run${snapshot.totals.totalFlagJobs === 1 ? "" : "s"}`}
          icon={<ShieldAlert className="size-3.5" />}
          label="Flagged Lines"
          value={snapshot.totals.totalFlaggedItems.toString()}
        />
        <MetricCard
          hint="Files with one or more flags."
          icon={<ShieldAlert className="size-3.5" />}
          label="Files With Flags"
          value={snapshot.totals.totalFilesWithFlags.toString()}
        />
        <MetricCard
          hint="Total local and cloud detection jobs."
          icon={<Activity className="size-3.5" />}
          label="Detection Runs"
          value={snapshot.totals.totalFlagJobs.toString()}
        />
      </div>

      <div className="grid gap-2 lg:grid-cols-[1.35fr_1fr]">
        <AnalyticsChartCard
          title="Illustrative Activity Trend"
          description="Activity trend (historical data coming soon)."
        >
          <div className="space-y-1.5">
            <div className="grid h-36 grid-cols-6 items-end gap-2 rounded-[14px] bg-[linear-gradient(180deg,#fff8f3,#fef4ee)] p-2.5">
              {trendPoints.map((point) => (
                <div key={point.label} className="flex h-full flex-col justify-end gap-1">
                  <div
                    className="rounded-t-[10px] bg-[linear-gradient(180deg,#c57267,#88322d)] shadow-[0_6px_16px_rgba(136,50,45,0.16)]"
                    style={{ height: `${Math.max((point.value / peakValue) * 100, 12)}%` }}
                  />
                  <p className="text-center text-[#8f5e56] text-xs">{point.label}</p>
                </div>
              ))}
            </div>
            <p className="text-[#8f5e56] text-xs">
              Recent runs: <span className="font-medium text-[#5b2722]">{snapshot.recentRuns}</span>
            </p>
          </div>
        </AnalyticsChartCard>

        <AnalyticsChartCard title="Workflow Mix" description="Workflow mix from local history.">
          <div className="space-y-1.5">
            {breakdown.length === 0 ? (
              <p className="rounded-[12px] border border-[#e7d2c5] border-dashed bg-[#fff8f3] px-2.5 py-2.5 text-[#8f5e56] text-xs">
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
                    className="rounded-[14px] border border-[#ead3c4] bg-[#fffaf7] p-2"
                  >
                    <div className="mb-1.5 flex items-center justify-between gap-1.5">
                      <div className="flex items-center gap-1.5">
                        <span className="flex size-6 items-center justify-center rounded-lg bg-[#f5e6dc] text-[#88322d]">
                          <Icon className="size-3" />
                        </span>
                        <div>
                          <p className="font-medium text-[#5b2722] text-xs">{item.label}</p>
                          <p className="text-[#8f5e56] text-xs">{item.jobs} jobs recorded</p>
                        </div>
                      </div>
                      <span className="font-medium text-[#6a2924] text-xs">{width}%</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-[#f4e6db]">
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

      <div className="grid grid-cols-[1fr_auto] items-center rounded-[16px] border border-[#ead3c4] bg-[#fff9f5] px-3 py-2">
        <div>
          <p className="font-medium text-[#5b2722] text-xs">Analytics source</p>
          <p className="mt-0.5 text-[#8f5e56] text-xs">
            Stats are saved locally and persist between restarts.
          </p>
          {errorMessage ? <p className="mt-1 text-rose-700 text-xs">{errorMessage}</p> : null}
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={loadSnapshot}
          disabled={isLoading}
        >
          {isLoading ? "Refreshing..." : "Refresh Analytics"}
        </Button>
      </div>
    </div>
  );
};

export { AnalyticsPanel };
