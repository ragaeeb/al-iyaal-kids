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
      className={className ?? "mt-1.5 max-h-32 overflow-auto rounded-[12px] bg-[#fdf1e8] px-2 py-1.5"}
    >
      {visibleLogs.map((line) => (
        <p key={line.id} className="font-mono text-[#7f524a] text-[9px]">
          {line.text}
        </p>
      ))}
    </div>
  );
};

export { LogOutput };
