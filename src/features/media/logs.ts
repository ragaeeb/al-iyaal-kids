const DEFAULT_VISIBLE_LOG_LINES = 80;
const MAX_STORED_LOG_LINES = 200;

type VisibleLogLine = {
  id: string;
  text: string;
};

const appendBoundedLogLine = (
  logs: string[],
  message: string,
  maxLines = MAX_STORED_LOG_LINES,
): string[] => {
  const nextLogs = [...logs, message];
  if (nextLogs.length <= maxLines) {
    return nextLogs;
  }

  return nextLogs.slice(nextLogs.length - maxLines);
};

const toVisibleLogLines = (
  logs: string[],
  maxLines = DEFAULT_VISIBLE_LOG_LINES,
): VisibleLogLine[] => {
  const visibleLogs = logs.slice(-maxLines);
  const offset = logs.length - visibleLogs.length;

  return visibleLogs.map((text, index) => ({
    id: `log-${offset + index}`,
    text,
  }));
};

export { appendBoundedLogLine, DEFAULT_VISIBLE_LOG_LINES, MAX_STORED_LOG_LINES, toVisibleLogLines };
export type { VisibleLogLine };
