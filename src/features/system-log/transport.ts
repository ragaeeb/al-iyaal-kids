import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export const SYSTEM_LOG_EVENT_NAME = "system-log-line";

type GetLogHistoryInvoke = (command: "get_log_history") => Promise<string[]>;

export const getLogHistory = (invokeFn: GetLogHistoryInvoke = invoke) =>
  invokeFn("get_log_history");

export const subscribeToSystemLogs = async (
  onLine: (line: string) => void,
  listenFn = listen,
): Promise<UnlistenFn> =>
  listenFn<string>(SYSTEM_LOG_EVENT_NAME, (event) => {
    onLine(event.payload);
  });
