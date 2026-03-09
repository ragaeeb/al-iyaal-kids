import type { HTMLAttributes } from "react";

import { cn } from "@/lib/cn";

type CardProps = HTMLAttributes<HTMLDivElement> & {
  size?: "default" | "sm";
};

const Card = ({ className, size = "default", ...props }: CardProps) => (
  <div
    data-size={size}
    data-slot="card"
    className={cn(
      "flex flex-col gap-4 rounded-[28px] border border-[#ead3c4] bg-[linear-gradient(180deg,rgba(255,251,248,0.96),rgba(255,246,240,0.92))] py-5 text-[#4f1f1a] text-sm shadow-[0_18px_42px_rgba(136,50,45,0.08)] data-[size=sm]:gap-3 data-[size=sm]:py-4",
      className,
    )}
    {...props}
  />
);

const CardHeader = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn("grid items-start gap-2 px-5", className)}
    data-slot="card-header"
    {...props}
  />
);

const CardTitle = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn("font-semibold text-[#5b2722] text-xl tracking-tight", className)}
    data-slot="card-title"
    {...props}
  />
);

const CardDescription = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn("text-[#8f5e56] text-sm leading-6", className)}
    data-slot="card-description"
    {...props}
  />
);

const CardAction = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn("col-start-2 row-span-2 row-start-1 self-start justify-self-end", className)}
    data-slot="card-action"
    {...props}
  />
);

const CardContent = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("px-5", className)} data-slot="card-content" {...props} />
);

const CardFooter = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex items-center px-6", className)} data-slot="card-footer" {...props} />
);

export { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle };
