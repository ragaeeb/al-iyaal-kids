import { useEffect, useRef, useState } from "react";
import {
  appendSystemLogEntry,
  createInitialSystemLogState,
  mergeSystemLogHistory,
} from "@/features/system-log/logs";
import { getLogHistory, subscribeToSystemLogs } from "@/features/system-log/transport";

const registerLiveSystemLogListener = async (
  isMounted: () => boolean,
  onLine: (line: string) => void,
): Promise<(() => void) | null> => {
  try {
    const registeredUnlisten = await subscribeToSystemLogs(onLine);
    if (!isMounted()) {
      registeredUnlisten();
      return null;
    }

    return registeredUnlisten;
  } catch {
    return null;
  }
};

const loadSystemLogHistory = async (
  isCurrent: () => boolean,
  onHistory: (history: string[]) => void,
) => {
  if (!isCurrent()) {
    return;
  }

  try {
    const history = await getLogHistory();
    if (isCurrent()) {
      onHistory(history);
    }
  } catch {
    // History is best-effort; live events can still be displayed.
  }
};

export const useSystemLog = (enabled = true) => {
  const [logState, setLogState] = useState(createInitialSystemLogState);
  const clearGenerationRef = useRef(0);

  useEffect(() => {
    if (!enabled) {
      setLogState(createInitialSystemLogState());
      return;
    }

    let mounted = true;
    let unlisten: (() => void) | null = null;
    const clearGeneration = clearGenerationRef.current;

    const setup = async () => {
      unlisten = await registerLiveSystemLogListener(mountedCheck, (line) => {
        if (mounted) {
          setLogState((previous) => appendSystemLogEntry(previous, line));
        }
      });
      await loadSystemLogHistory(isCurrent, (history) => {
        setLogState((previous) => mergeSystemLogHistory(previous, history));
      });
    };

    const mountedCheck = () => mounted;
    const isCurrent = () => mounted && clearGenerationRef.current === clearGeneration;

    void setup();

    return () => {
      mounted = false;
      unlisten?.();
    };
  }, [enabled]);

  const clearLogs = () => {
    clearGenerationRef.current += 1;
    setLogState(createInitialSystemLogState());
  };

  return {
    clearLogs,
    logs: logState.entries,
  };
};
