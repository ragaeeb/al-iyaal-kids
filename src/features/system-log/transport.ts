import { invoke, listen, type UnlistenFn } from "@/lib/tauri";

export const SYSTEM_LOG_EVENT_NAME = "system-log-line";

export const getLogHistory = (invokeFn = invoke) => invokeFn<string[]>("get_log_history");

export const subscribeToSystemLogs = async (
  onLine: (line: string) => void,
  listenFn = listen,
): Promise<UnlistenFn> =>
  listenFn<string>(SYSTEM_LOG_EVENT_NAME, (event) => {
    onLine(event.payload);
  });
