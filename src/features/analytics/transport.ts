import type { AnalyticsSnapshot } from "@/features/analytics/types";
import { invoke } from "@/lib/tauri";

export const getAnalyticsSnapshot = () => invoke<AnalyticsSnapshot>("get_analytics_snapshot");
