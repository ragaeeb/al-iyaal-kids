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
    <Card className="rounded-[26px] border border-[#ead3c4] bg-white/90 shadow-[0_12px_34px_rgba(136,50,45,0.08)]">
      <CardHeader className="grid grid-cols-[1fr_auto] items-start gap-4">
        <div>
          <p className="text-[#8f5e56] text-sm">{label}</p>
          <CardTitle className="mt-3 text-4xl text-[#4f1f1a] tracking-tight">{value}</CardTitle>
        </div>
        <div className="flex size-12 items-center justify-center rounded-2xl bg-[#f5e6dc] text-[#88322d]">
          {icon}
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-[#7f524a] text-sm">{hint}</p>
      </CardContent>
    </Card>
  );
};

export { MetricCard };
