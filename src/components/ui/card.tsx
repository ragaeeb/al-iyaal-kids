import { forwardRef, type HTMLAttributes } from "react";

import { cn } from "@/lib/cn";

type CardProps = HTMLAttributes<HTMLDivElement> & {
  size?: "default" | "sm";
};

const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ className, size = "default", ...props }, ref) => (
    <div
      ref={ref}
      data-size={size}
      data-slot="card"
      className={cn(
        "flex flex-col gap-1.5 rounded-[20px] border border-[#ead3c4] bg-[linear-gradient(180deg,rgba(255,251,248,0.96),rgba(255,246,240,0.92))] py-2.5 text-[#4f1f1a] text-xs shadow-[0_12px_28px_rgba(136,50,45,0.08)] data-[size=sm]:gap-1 data-[size=sm]:py-2",
        className,
      )}
      {...props}
    />
  ),
);

Card.displayName = "Card";

const CardHeader = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn("grid items-start gap-1 px-3", className)}
    data-slot="card-header"
    {...props}
  />
);

const CardTitle = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn("font-semibold text-[#5b2722] text-sm tracking-tight", className)}
    data-slot="card-title"
    {...props}
  />
);

const CardContent = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("px-3", className)} data-slot="card-content" {...props} />
);

export { Card, CardContent, CardHeader, CardTitle };
