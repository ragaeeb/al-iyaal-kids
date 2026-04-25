import type { ReactNode } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type MetricCardProps = {
  icon: ReactNode;
  label: string;
  value: string;
  hint: string;
};

const MetricCard = ({ icon, label, value, hint }: MetricCardProps) => {
  return (
    <Card className="rounded-[16px] border border-[#ead3c4] bg-white/90 shadow-[0_6px_16px_rgba(136,50,45,0.08)]">
      <CardHeader className="grid grid-cols-[1fr_auto] items-start gap-2">
        <div>
          <p className="text-[#8f5e56] text-xs">{label}</p>
          <CardTitle className="mt-0.5 text-xl text-[#4f1f1a] tracking-tight">{value}</CardTitle>
        </div>
        <div className="flex size-7 items-center justify-center rounded-lg bg-[#f5e6dc] text-[#88322d]">
          {icon}
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-[#7f524a] text-xs">{hint}</p>
      </CardContent>
    </Card>
  );
};

export { MetricCard };
