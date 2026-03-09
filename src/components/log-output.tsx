import { toVisibleLogLines } from "@/features/media/logs";

type LogOutputProps = {
  logs: string[];
  className?: string;
  maxLines?: number;
};

const LogOutput = ({ className, logs, maxLines }: LogOutputProps) => {
  if (logs.length === 0) {
    return null;
  }

  const visibleLogs = toVisibleLogLines(logs, maxLines);

  return (
    <div
      className={className ?? "mt-3 max-h-48 overflow-auto rounded-[16px] bg-[#fdf1e8] px-3 py-2"}
    >
      {visibleLogs.map((line) => (
        <p key={line.id} className="font-mono text-[#7f524a] text-[11px]">
          {line.text}
        </p>
      ))}
    </div>
  );
};

export { LogOutput };
