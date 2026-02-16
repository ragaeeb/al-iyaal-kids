import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";

import { cn } from "@/lib/cn";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-md font-semibold text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
  {
    defaultVariants: {
      size: "default",
      variant: "primary",
    },
    variants: {
      size: {
        default: "h-10",
        lg: "h-11 px-6",
        sm: "h-8 rounded px-3 text-xs",
      },
      variant: {
        danger: "bg-rose-700 px-4 py-2 text-white hover:bg-rose-600",
        ghost: "px-3 py-2 text-[#6e3933] hover:bg-[#f1d1b1]/50",
        primary: "bg-[#88322d] px-4 py-2 text-white hover:bg-[#7b2d28]",
        secondary: "bg-[#f1d1b1]/65 px-4 py-2 text-[#5f2823] hover:bg-[#f1d1b1]",
      },
    },
  },
);

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  };

const Button = ({ className, variant, size, asChild = false, ...props }: ButtonProps) => {
  const Comp = asChild ? Slot : "button";

  return <Comp className={cn(buttonVariants({ size, variant }), className)} {...props} />;
};

export { Button, buttonVariants };
