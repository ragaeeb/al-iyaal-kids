import { Terminal, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

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
import { useSystemLog } from "@/features/system-log/useSystemLog";
import { cn } from "@/lib/cn";

type SystemLogDrawerProps = {
  isSidebarCollapsed?: boolean;
};

const isErrorLine = (line: string): boolean => {
  const lower = line.toLowerCase();
  return (
    lower.includes("error") ||
    lower.includes("traceback") ||
    lower.includes("failed") ||
    lower.includes("exception")
  );
};

const isStderrLine = (line: string): boolean => {
  return line.startsWith("worker stderr:");
};

const SystemLogDrawer = ({ isSidebarCollapsed }: SystemLogDrawerProps) => {
  const [open, setOpen] = useState(false);
  const { clearLogs, logs } = useSystemLog();
  const logContainerRef = useRef<HTMLDivElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll to bottom on new log entries or open
  useEffect(() => {
    if (open && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs.length, open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open System Log"
        className={cn(
          "group flex items-center rounded-lg px-1.5 py-1 text-left transition-all",
          isSidebarCollapsed ? "justify-center" : "gap-1.5",
          "text-[#71443c] hover:bg-[#fbefe7] hover:text-[#88322d]",
        )}
        title="System Log"
      >
        <span className="flex size-6 items-center justify-center rounded-lg border border-transparent bg-[#f8e8de] text-[#9e5c50] transition-all group-hover:border-[#efd5c8] group-hover:bg-white">
          <Terminal className="size-2.5" />
        </span>
        {!isSidebarCollapsed ? (
          <span className="truncate font-medium text-xs">System Log</span>
        ) : null}
      </button>

      {open ? (
        <Drawer open={open} onOpenChange={setOpen}>
          <DrawerPopup className="w-[560px] max-w-[calc(100vw-2rem)]">
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex items-start justify-between gap-1.5">
                <DrawerHeader>
                  <DrawerTitle className="flex items-center gap-1.5">
                    <Terminal className="size-3.5 text-[#88322d]" />
                    <span>System Log</span>
                  </DrawerTitle>
                  <DrawerDescription>
                    Live runtime logs from Rust backend and Python worker.
                  </DrawerDescription>
                </DrawerHeader>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={clearLogs}
                    title="Clear logs"
                    className="h-8 px-2"
                  >
                    <Trash2 className="size-3" />
                  </Button>
                  <DrawerClose>Close</DrawerClose>
                </div>
              </div>

              <DrawerBody className="mt-3 flex min-h-0 flex-1 flex-col">
                <div
                  ref={logContainerRef}
                  className="min-h-0 flex-1 overflow-auto rounded-[12px] border border-[#ead3c4] bg-[#221b1a] p-2.5 font-mono text-[#e6d5cc] text-[10px] leading-relaxed"
                >
                  {logs.length === 0 ? (
                    <p className="text-[#a0857c] italic">No logs recorded yet.</p>
                  ) : (
                    logs.map((line, index) => {
                      const error = isErrorLine(line);
                      const stderr = isStderrLine(line);

                      return (
                        <div
                          // biome-ignore lint/suspicious/noArrayIndexKey: log lines don't have stable IDs
                          key={index}
                          className={cn(
                            "whitespace-pre-wrap break-all py-0.5",
                            error
                              ? "font-semibold text-[#f87171]"
                              : stderr
                                ? "text-[#fbbf24]"
                                : "text-[#d1d5db]",
                          )}
                        >
                          {line}
                        </div>
                      );
                    })
                  )}
                </div>
              </DrawerBody>
            </div>
          </DrawerPopup>
        </Drawer>
      ) : null}
    </>
  );
};

export { SystemLogDrawer };
