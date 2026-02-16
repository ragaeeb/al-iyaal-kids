import type { InputHTMLAttributes } from "react";

import { cn } from "@/lib/cn";

type InputProps = InputHTMLAttributes<HTMLInputElement>;

const Input = ({ className, ...props }: InputProps) => (
  <input
    className={cn(
      "flex h-10 w-full rounded-md border border-[#d1968f]/65 bg-white px-3 py-2 text-[#5f2823] text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#88322d] disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    {...props}
  />
);

export { Input };
