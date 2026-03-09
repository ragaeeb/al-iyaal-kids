import { PanelRightOpen } from "lucide-react";
import { type ReactNode, useState } from "react";

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
  triggerLabel: string;
  title: string;
  description: string;
  children: ReactNode;
};

const TaskDrawer = ({ children, description, title, triggerLabel }: TaskDrawerProps) => {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <PanelRightOpen className="size-4" />
        {triggerLabel}
      </Button>
      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerPopup>
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex items-start justify-between gap-4">
              <DrawerHeader>
                <DrawerTitle>{title}</DrawerTitle>
                <DrawerDescription>{description}</DrawerDescription>
              </DrawerHeader>
              <DrawerClose>Close</DrawerClose>
            </div>
            <DrawerBody>{children}</DrawerBody>
          </div>
        </DrawerPopup>
      </Drawer>
    </>
  );
};

export { TaskDrawer };
