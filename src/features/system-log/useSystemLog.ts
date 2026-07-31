import { useEffect, useState } from "react";

import { getLogHistory, subscribeToSystemLogs } from "@/features/system-log/transport";

const MAX_LOG_LINES = 500;

export const useSystemLog = () => {
  const [logs, setLogs] = useState<string[]>([]);

  useEffect(() => {
    let mounted = true;
    let unlisten: (() => void) | null = null;

    getLogHistory()
      .then((history) => {
        if (mounted) {
          setLogs(history.slice(-MAX_LOG_LINES));
        }
      })
      .catch(() => {
        // Fallback for non-tauri or dev mock environments
      });

    const setup = async () => {
      unlisten = await subscribeToSystemLogs((line) => {
        if (!mounted) {
          return;
        }
        setLogs((prev) => {
          const next = [...prev, line];
          if (next.length > MAX_LOG_LINES) {
            return next.slice(next.length - MAX_LOG_LINES);
          }
          return next;
        });
      });
    };

    setup().catch(() => {});

    return () => {
      mounted = false;
      unlisten?.();
    };
  }, []);

  const clearLogs = () => setLogs([]);

  return {
    clearLogs,
    logs,
  };
};
