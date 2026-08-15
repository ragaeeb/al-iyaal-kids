import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/cn";

const buttonVariants = cva(
  "inline-flex shrink-0 select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-[14px] border font-medium text-xs outline-none transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    defaultVariants: {
      size: "default",
      variant: "primary",
    },
    variants: {
      size: {
        default: "h-8 px-3",
        icon: "size-9",
        lg: "h-9 px-4 text-sm",
        sm: "h-7 px-2 text-xs",
      },
      variant: {
        danger:
          "border-rose-700 bg-rose-700 text-white shadow-[0_14px_28px_rgba(190,24,93,0.22)] hover:border-rose-600 hover:bg-rose-600",
        ghost:
          "border-transparent bg-transparent text-[#71443c] hover:bg-[#f8e9de] hover:text-[#88322d]",
        link: "border-transparent bg-transparent px-0 text-[#88322d] underline-offset-4 hover:underline",
        outline:
          "border-[#d9b7a5] bg-white text-[#5f2823] shadow-[0_8px_18px_rgba(136,50,45,0.06)] hover:bg-[#fdf1e8]",
        primary:
          "border-[#88322d] bg-[#88322d] text-white shadow-[0_16px_32px_rgba(136,50,45,0.22)] hover:border-[#6f2823] hover:bg-[#6f2823]",
        secondary:
          "border-[#ead3c4] bg-[#f5e6dc] text-[#5f2823] shadow-[0_8px_18px_rgba(136,50,45,0.06)] hover:bg-[#edd9ca]",
      },
    },
  },
);

type ButtonProps = React.ComponentPropsWithoutRef<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  };

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ asChild = false, className, size, variant, ...props }, ref) => {
    const Comp = asChild ? Slot : ButtonPrimitive;

    return (
      <Comp
        ref={ref}
        data-slot="button"
        className={cn(buttonVariants({ size, variant }), className)}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button };
