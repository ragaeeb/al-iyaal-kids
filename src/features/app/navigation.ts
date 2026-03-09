import {
  AudioLines,
  ChartColumn,
  LayoutGrid,
  Scissors,
  Settings2,
  ShieldAlert,
  WandSparkles,
} from "lucide-react";

export type AppPage =
  | "dashboard"
  | "remove-music"
  | "transcribe"
  | "profanity-detection"
  | "cut-video"
  | "analytics"
  | "settings";

export type AppPageDefinition = {
  key: AppPage;
  label: string;
  description: string;
  icon: typeof WandSparkles;
};

export const dashboardPage: AppPageDefinition = {
  description: "Overview, app identity, privacy posture, and quick entry points.",
  icon: LayoutGrid,
  key: "dashboard",
  label: "Dashboard",
};

export const appPages: AppPageDefinition[] = [
  {
    description: "Demucs vocals-only remux batches for local media folders.",
    icon: WandSparkles,
    key: "remove-music",
    label: "Remove Music",
  },
  {
    description: "Generate subtitle sidecars from one or more videos.",
    icon: AudioLines,
    key: "transcribe",
    label: "Transcribe",
  },
  {
    description: "Analyze SRT files locally for profanity and aqeedah flags.",
    icon: ShieldAlert,
    key: "profanity-detection",
    label: "Profanity Detection",
  },
  {
    description: "Review a video and export exact cut ranges.",
    icon: Scissors,
    key: "cut-video",
    label: "Cut Video",
  },
  {
    description: "Track local processing metrics and recent workflow activity.",
    icon: ChartColumn,
    key: "analytics",
    label: "Analytics",
  },
  {
    description: "Manage local AI provider keys and analysis preferences.",
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
