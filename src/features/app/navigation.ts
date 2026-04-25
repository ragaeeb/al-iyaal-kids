import { ChartColumn, LayoutGrid, Scissors, Settings2, WandSparkles } from "lucide-react";

export type AppPage = "dashboard" | "remove-music" | "cut-video" | "analytics" | "settings";

export type AppPageDefinition = {
  key: AppPage;
  label: string;
  description: string;
  icon: typeof WandSparkles;
};

export const dashboardPage: AppPageDefinition = {
  description: "App overview and privacy summary.",
  icon: LayoutGrid,
  key: "dashboard",
  label: "Dashboard",
};

export const appPages: AppPageDefinition[] = [
  {
    description: "Remove background music.",
    icon: WandSparkles,
    key: "remove-music",
    label: "Remove Music",
  },
  {
    description: "Review, subtitle, flag, and export.",
    icon: Scissors,
    key: "cut-video",
    label: "Edit Video",
  },
  {
    description: "Processing stats and history.",
    icon: ChartColumn,
    key: "analytics",
    label: "Analytics",
  },
  {
    description: "AI keys and preferences.",
    icon: Settings2,
    key: "settings",
    label: "Settings",
  },
];

export const defaultAppPage: AppPage = "dashboard";

export const getPageDefinition = (page: AppPage): AppPageDefinition => {
  if (page === "dashboard") {
    return dashboardPage;
  }

  const pageDefinition = appPages.find((item) => item.key === page);

  return pageDefinition ?? dashboardPage;
};
