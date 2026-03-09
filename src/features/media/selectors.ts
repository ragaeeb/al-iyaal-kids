import type { AnalysisSidecar, TaskKind, TaskState } from "@/features/media/types";
import type { ModerationJobResult } from "@/features/moderation/results";

type TaskMap = Record<string, TaskState>;

type ManualAnalysisResultLike = {
  sourcePath: string;
  sidecarPath: string;
  sidecar: AnalysisSidecar;
};

const getLatestTask = (tasksById: TaskMap, taskKind: TaskKind) => {
  return Object.values(tasksById)
    .filter((task) => task.taskKind === taskKind)
    .at(-1);
};

const getLatestTaskLogLine = (task: TaskState | undefined) => {
  return task?.jobs
    .flatMap((job) => job.logs)
    .filter(Boolean)
    .at(-1);
};

const getTaskOutputPath = (task: TaskState | undefined) => {
  return task?.jobs.find((job) => typeof job.outputPath === "string")?.outputPath ?? null;
};

const buildModerationResults = (
  task: TaskState | undefined,
  analysisByJobId: Record<string, AnalysisSidecar>,
  manualResults: Record<string, ManualAnalysisResultLike>,
  toModerationJobResult: (
    job: TaskState["jobs"][number],
    sidecar?: AnalysisSidecar,
  ) => ModerationJobResult,
  toManualJobResult: (value: ManualAnalysisResultLike) => ModerationJobResult,
) => {
  const taskResults = (task?.jobs ?? []).map((job) =>
    toModerationJobResult(job, analysisByJobId[job.jobId]),
  );
  const taskResultIds = new Set(taskResults.map((result) => result.jobId));
  const loadedResults = Object.values(manualResults)
    .map(toManualJobResult)
    .filter((result) => !taskResultIds.has(result.jobId));

  return [...taskResults, ...loadedResults];
};

export { buildModerationResults, getLatestTask, getLatestTaskLogLine, getTaskOutputPath };
