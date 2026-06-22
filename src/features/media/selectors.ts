import type { AnalysisSidecar, TaskJobRecord, TaskKind, TaskState } from "@/features/media/types";
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

const buildLatestTaskOutputPathByInput = (tasksById: TaskMap, taskKind: TaskKind) =>
  Object.values(tasksById).reduce<Record<string, string>>((latestOutputByInputPath, task) => {
    if (task.taskKind !== taskKind) {
      return latestOutputByInputPath;
    }

    for (const job of task.jobs) {
      if (
        job.status === "completed" &&
        typeof job.outputPath === "string" &&
        job.outputPath.length > 0
      ) {
        latestOutputByInputPath[job.inputPath] = job.outputPath;
      }
    }

    return latestOutputByInputPath;
  }, {});

const buildLatestTaskJobByInput = (tasksById: TaskMap, taskKind: TaskKind) =>
  Object.values(tasksById).reduce<Record<string, TaskJobRecord>>((latestJobByInputPath, task) => {
    if (task.taskKind !== taskKind) {
      return latestJobByInputPath;
    }

    for (const job of task.jobs) {
      latestJobByInputPath[job.inputPath] = job;
    }

    return latestJobByInputPath;
  }, {});

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

export {
  buildLatestTaskJobByInput,
  buildLatestTaskOutputPathByInput,
  buildModerationResults,
  getLatestTask,
  getLatestTaskLogLine,
  getTaskOutputPath,
};
