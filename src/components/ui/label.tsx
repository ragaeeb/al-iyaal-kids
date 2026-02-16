import * as LabelPrimitive from "@radix-ui/react-label";
import type { ComponentPropsWithoutRef } from "react";

import { cn } from "@/lib/cn";

type LabelProps = ComponentPropsWithoutRef<typeof LabelPrimitive.Root>;

const Label = ({ className, ...props }: LabelProps) => (
  <LabelPrimitive.Root
    className={cn("font-medium text-[#6e3933] text-sm leading-none", className)}
    {...props}
  />
);

export { Label };
