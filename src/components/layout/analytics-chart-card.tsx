import type { ReactNode } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type AnalyticsChartCardProps = {
  title: string;
  description: string;
  children: ReactNode;
};

const AnalyticsChartCard = ({ title, description, children }: AnalyticsChartCardProps) => {
  return (
    <Card className="rounded-[16px] border border-[#ead3c4] bg-white/88 shadow-[0_6px_20px_rgba(136,50,45,0.08)]">
      <CardHeader>
        <CardTitle className="text-[#5b2722] text-sm tracking-tight">{title}</CardTitle>
        <p className="mt-0.5 text-[#8f5e56] text-xs">{description}</p>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
};

export { AnalyticsChartCard };
