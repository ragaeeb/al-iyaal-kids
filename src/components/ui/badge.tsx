import type { HTMLAttributes } from "react";

import { cn } from "@/lib/cn";
import { type BadgeVariant, statusClassByVariant } from "@/theme/brand";

type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  variant?: BadgeVariant;
};

const Badge = ({ className, variant = "queued", ...props }: BadgeProps) => (
  <span
    className={cn(
      "inline-flex min-w-20 items-center justify-center rounded-full px-2 py-1 font-semibold text-xs",
      statusClassByVariant[variant],
      className,
    )}
    {...props}
  />
);

export { Badge };
