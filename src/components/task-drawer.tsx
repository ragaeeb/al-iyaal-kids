import { PanelRightOpen } from "lucide-react";
import { type ReactNode, type Ref, type UIEventHandler, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerBody,
  DrawerClose,
  DrawerDescription,
  DrawerHeader,
  DrawerPopup,
  DrawerTitle,
} from "@/components/ui/drawer";

type TaskDrawerProps = {
  bodyRef?: Ref<HTMLDivElement>;
  triggerLabel: string;
  title: string;
  description: string;
  children: ReactNode;
  open?: boolean;
  modal?: boolean;
  onBodyScroll?: UIEventHandler<HTMLDivElement>;
  onOpenChange?: (open: boolean) => void;
};

const TaskDrawer = ({
  bodyRef,
  children,
  description,
  modal = true,
  open: controlledOpen,
  onBodyScroll,
  onOpenChange,
  title,
  triggerLabel,
}: TaskDrawerProps) => {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const updateOpen = (nextOpen: boolean) => {
    if (controlledOpen === undefined) {
      setUncontrolledOpen(nextOpen);
    }
    onOpenChange?.(nextOpen);
  };

  return (
    <>
      <Button type="button" variant="secondary" size="sm" onClick={() => updateOpen(true)}>
        <PanelRightOpen className="size-3" />
        {triggerLabel}
      </Button>
      {open ? (
        <Drawer
          open={open}
          modal={modal}
          disablePointerDismissal={!modal}
          onOpenChange={updateOpen}
        >
          <DrawerPopup showOverlay={modal}>
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex items-start justify-between gap-1.5">
                <DrawerHeader>
                  <DrawerTitle>{title}</DrawerTitle>
                  <DrawerDescription>{description}</DrawerDescription>
                </DrawerHeader>
                <DrawerClose>Close</DrawerClose>
              </div>
              <DrawerBody ref={bodyRef} onScroll={onBodyScroll}>
                {children}
              </DrawerBody>
            </div>
          </DrawerPopup>
        </Drawer>
      ) : null}
    </>
  );
};

export { TaskDrawer };
