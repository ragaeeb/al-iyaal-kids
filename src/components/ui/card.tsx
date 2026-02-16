import type { HTMLAttributes } from "react";

import { cn } from "@/lib/cn";

const Card = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "rounded-xl border border-[#d1968f]/45 bg-[#fff7f1]/90 p-5 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-[#fff7f1]/75",
      className,
    )}
    {...props}
  />
);

const CardTitle = ({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) => (
  <h3 className={cn("font-semibold text-[#88322d] text-lg", className)} {...props} />
);

const CardDescription = ({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) => (
  <p className={cn("text-[#6e3933] text-sm", className)} {...props} />
);

const CardContent = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("mt-4", className)} {...props} />
);

export { Card, CardContent, CardDescription, CardTitle };
