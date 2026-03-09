import { ChartColumn, ShieldCheck, WandSparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { type AppPage, appPages } from "@/features/app/navigation";

import logoPng from "../../logo.png";

type DashboardPanelProps = {
  onNavigate: (page: AppPage) => void;
};

const DashboardPanel = ({ onNavigate }: DashboardPanelProps) => {
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_420px]">
      <Card>
        <CardContent className="grid gap-5 p-6 lg:grid-cols-[auto_minmax(0,1fr)] lg:items-start">
          <img
            src={logoPng}
            alt="al-Iyal Kids logo"
            width={88}
            height={88}
            className="rounded-[24px] border border-[#d8b7a4] bg-white p-2 shadow-sm"
          />
          <div>
            <p className="font-medium text-[#9e5c50] text-xs uppercase tracking-[0.22em]">
              al-Iyaal Kids
            </p>
            <h2 className="mt-3 text-4xl text-[#88322d] tracking-tight">
              Local media tools for Muslim families
            </h2>
            <p className="mt-3 max-w-3xl text-[#7f524a] text-sm leading-6">
              Remove music, generate subtitles, flag inappropriate content, export cleaned cuts, and
              track processing history locally on-device.
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <Button type="button" onClick={() => onNavigate("remove-music")}>
                <WandSparkles className="size-4" />
                Open Remove Music
              </Button>
              <Button type="button" variant="secondary" onClick={() => onNavigate("analytics")}>
                <ChartColumn className="size-4" />
                View Analytics
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-2xl bg-[#f5e6dc] text-[#88322d]">
              <ShieldCheck className="size-4" />
            </span>
            Local-first workflows
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-[#7f524a] text-sm leading-6">
          <p>No telemetry is sent anywhere.</p>
          <p>Processing history and analytics stay on this machine.</p>
          <p>Python runtime, Demucs, ffmpeg, and yap are managed inside the app workflow.</p>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:col-span-2 xl:grid-cols-5">
        {appPages.map((page) => {
          const Icon = page.icon;

          return (
            <button
              key={page.key}
              type="button"
              onClick={() => onNavigate(page.key)}
              className="rounded-[24px] border border-[#ead3c4] bg-[#fffaf7] px-5 py-5 text-left shadow-[0_12px_28px_rgba(136,50,45,0.07)] transition hover:-translate-y-0.5 hover:border-[#d4aa96] hover:bg-white"
            >
              <span className="flex size-11 items-center justify-center rounded-2xl bg-[#f5e6dc] text-[#88322d]">
                <Icon className="size-5" />
              </span>
              <p className="mt-4 font-medium text-[#5b2722] text-sm">{page.label}</p>
              <p className="mt-2 text-[#8f5e56] text-xs leading-5">{page.description}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export { DashboardPanel };
