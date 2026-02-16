import * as ProgressPrimitive from "@radix-ui/react-progress";

import { cn } from "@/lib/cn";

type ProgressProps = {
  value: number;
  className?: string;
};

const Progress = ({ value, className }: ProgressProps) => (
  <ProgressPrimitive.Root
    className={cn("relative h-3 w-full overflow-hidden rounded-full bg-[#f1d1b1]/55", className)}
    value={value}
  >
    <ProgressPrimitive.Indicator
      className="h-full bg-[#c57267] transition-all duration-300"
      style={{ transform: `translateX(-${100 - value}%)` }}
    />
  </ProgressPrimitive.Root>
);

export { Progress };
