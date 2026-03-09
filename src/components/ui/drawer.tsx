import { DrawerPreview as DrawerPrimitive } from "@base-ui/react/drawer";
import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

type DrawerProps = DrawerPrimitive.Root.Props;

type DrawerPopupProps = Omit<DrawerPrimitive.Popup.Props, "className"> & {
  className?: string;
  children: ReactNode;
};

type DrawerTextProps = {
  className?: string;
  children: ReactNode;
};

const Drawer = (props: DrawerProps) => {
  return <DrawerPrimitive.Root data-slot="drawer" swipeDirection="right" {...props} />;
};

const DrawerPortal = ({ children }: { children: ReactNode }) => {
  return <DrawerPrimitive.Portal data-slot="drawer-portal">{children}</DrawerPrimitive.Portal>;
};

const DrawerOverlay = ({ className }: { className?: string }) => {
  return (
    <DrawerPrimitive.Backdrop
      data-slot="drawer-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-black/30 backdrop-blur-sm transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0",
        className,
      )}
    />
  );
};

const DrawerPopup = ({ children, className, ...props }: DrawerPopupProps) => {
  return (
    <DrawerPortal>
      <DrawerOverlay />
      <DrawerPrimitive.Popup
        data-slot="drawer-popup"
        className={cn(
          "fixed inset-y-4 right-4 z-50 flex w-[430px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-[30px] border border-[#e4cbbd] bg-[linear-gradient(180deg,#fffdfb,#fff6ef)] p-5 text-[#4f1f1a] shadow-[0_24px_64px_rgba(136,50,45,0.16)] outline-none transition-transform duration-300 data-ending-style:translate-x-[110%] data-starting-style:translate-x-[110%]",
          className,
        )}
        {...props}
      >
        {children}
      </DrawerPrimitive.Popup>
    </DrawerPortal>
  );
};

const DrawerHeader = ({ children, className }: DrawerTextProps) => {
  return <div className={cn("flex flex-col gap-1", className)}>{children}</div>;
};

const DrawerTitle = ({ children, className }: DrawerTextProps) => {
  return (
    <DrawerPrimitive.Title className={cn("font-semibold text-[#5b2722] text-xl", className)}>
      {children}
    </DrawerPrimitive.Title>
  );
};

const DrawerDescription = ({ children, className }: DrawerTextProps) => {
  return (
    <DrawerPrimitive.Description className={cn("text-[#8f5e56] text-sm", className)}>
      {children}
    </DrawerPrimitive.Description>
  );
};

const DrawerBody = ({ children, className }: DrawerTextProps) => {
  return <div className={cn("mt-4 min-h-0 flex-1 overflow-auto pr-1", className)}>{children}</div>;
};

const DrawerClose = ({ children, className }: DrawerTextProps) => {
  return (
    <DrawerPrimitive.Close
      className={cn(
        "inline-flex h-10 items-center justify-center rounded-[18px] border border-[#ead3c4] bg-[#f5e6dc] px-4 font-medium text-[#5f2823] text-sm transition hover:bg-[#edd9ca]",
        className,
      )}
    >
      {children}
    </DrawerPrimitive.Close>
  );
};

export {
  Drawer,
  DrawerBody,
  DrawerClose,
  DrawerDescription,
  DrawerHeader,
  DrawerPopup,
  DrawerTitle,
};
