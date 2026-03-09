const DEFAULT_VISIBLE_LOG_LINES = 80;

type VisibleLogLine = {
  id: string;
  text: string;
};

const toVisibleLogLines = (
  logs: string[],
  maxLines = DEFAULT_VISIBLE_LOG_LINES,
): VisibleLogLine[] => {
  return logs.slice(-maxLines).map((text, index, visibleLogs) => ({
    id: `${visibleLogs.length}-${index}-${text}`,
    text,
  }));
};

export { DEFAULT_VISIBLE_LOG_LINES, toVisibleLogLines };
export type { VisibleLogLine };
