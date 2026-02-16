import { Construction } from "lucide-react";

import { Card, CardContent, CardDescription, CardTitle } from "@/components/ui/card";

type PlaceholderPanelProps = {
  title: string;
  description: string;
};

const PlaceholderPanel = ({ title, description }: PlaceholderPanelProps) => (
  <Card className="border-[#d1968f]/55 border-dashed">
    <CardTitle className="flex items-center gap-2">
      <Construction className="size-5 text-[#88322d]" />
      {title}
    </CardTitle>
    <CardDescription>{description}</CardDescription>
    <CardContent>
      <p className="text-[#6e3933] text-sm">
        This tab is intentionally scaffolded now so future feature delivery does not require
        navigation refactors.
      </p>
    </CardContent>
  </Card>
);

export { PlaceholderPanel };
