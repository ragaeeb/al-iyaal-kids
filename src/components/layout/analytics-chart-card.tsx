import type { ReactNode } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type AnalyticsChartCardProps = {
  title: string;
  description: string;
  children: ReactNode;
};

const AnalyticsChartCard = ({ title, description, children }: AnalyticsChartCardProps) => {
  return (
    <Card className="rounded-[28px] border border-[#ead3c4] bg-white/88 shadow-[0_14px_40px_rgba(136,50,45,0.08)]">
      <CardHeader>
        <CardTitle className="text-2xl text-[#5b2722] tracking-tight">{title}</CardTitle>
        <p className="text-[#8f5e56] text-sm">{description}</p>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
};

export { AnalyticsChartCard };
