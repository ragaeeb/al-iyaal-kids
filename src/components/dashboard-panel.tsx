import { ShieldCheck, WandSparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { type AppPage, appPages } from "@/features/app/navigation";

import logoPng from "../../src-tauri/icons/128x128.png";

type DashboardPanelProps = {
  onNavigate: (page: AppPage) => void;
};

const DashboardPanel = ({ onNavigate }: DashboardPanelProps) => {
  return (
    <div className="grid gap-2.5 lg:grid-cols-[minmax(0,1.3fr)_320px]">
      <Card>
        <CardContent className="grid gap-2.5 p-3 lg:grid-cols-[auto_minmax(0,1fr)] lg:items-start">
          <img
            src={logoPng}
            alt="al-Iyal Kids logo"
            width={48}
            height={48}
            className="rounded-[14px] border border-[#d8b7a4] bg-white p-1 shadow-sm"
          />
          <div>
            <p className="font-medium text-[#9e5c50] text-xs uppercase tracking-[0.2em]">
              al-Iyaal Kids
            </p>
            <h2 className="mt-1 text-[#88322d] text-base tracking-tight">
              Media tools for Muslim families
            </h2>
            <p className="mt-0.5 max-w-3xl text-[#7f524a] text-xs leading-4">
              Private, local-first media tools: music removal, subtitles, content flagging, and
              video editing.
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Button type="button" size="sm" onClick={() => onNavigate("remove-music")}>
                <WandSparkles className="size-3" />
                Open Remove Music
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            <span className="flex size-6 items-center justify-center rounded-lg bg-[#f5e6dc] text-[#88322d]">
              <ShieldCheck className="size-3" />
            </span>
            Local-first workflows
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-[#7f524a] text-xs leading-4">
          <p>No telemetry sent.</p>
          <p>Your media stays on this device.</p>
          <p>Core workflows run on-device; subtitle moderation can use opted-in providers.</p>
        </CardContent>
      </Card>

      <div className="grid gap-2 sm:grid-cols-3 lg:col-span-2 lg:grid-cols-5">
        {appPages.map((page) => {
          const Icon = page.icon;

          return (
            <button
              key={page.key}
              type="button"
              onClick={() => onNavigate(page.key)}
              className="rounded-[16px] border border-[#ead3c4] bg-[#fffaf7] px-2.5 py-2.5 text-left shadow-[0_6px_16px_rgba(136,50,45,0.07)] transition hover:-translate-y-0.5 hover:border-[#d4aa96] hover:bg-white"
            >
              <span className="flex size-6 items-center justify-center rounded-lg bg-[#f5e6dc] text-[#88322d]">
                <Icon className="size-3" />
              </span>
              <p className="mt-1.5 font-medium text-[#5b2722] text-xs">{page.label}</p>
              <p className="mt-0.5 text-[#8f5e56] text-xs leading-3">{page.description}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export { DashboardPanel };
