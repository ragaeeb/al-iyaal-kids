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

const getLatestTaskForInput = (tasksById: TaskMap, taskKind: TaskKind, inputPath: string) => {
  return Object.values(tasksById)
    .filter(
      (task) => task.taskKind === taskKind && task.jobs.some((job) => job.inputPath === inputPath),
    )
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

export const isFlagTaskActive = (isStarting: boolean, task: TaskState | undefined) =>
  isStarting || task?.status === "queued" || task?.status === "running";

const buildLatestTaskOutputPathByInput = (
  tasksById: TaskMap,
  taskKind: TaskKind,
  latestJobByKindAndInput: Record<string, TaskJobRecord> = {},
) => {
  const latestOutputByInputPath = Object.entries(latestJobByKindAndInput).reduce<
    Record<string, string>
  >((outputs, [key, job]) => {
    if (key.startsWith(`${taskKind}\0`) && job.status === "completed" && job.outputPath) {
      outputs[job.inputPath] = job.outputPath;
    }
    return outputs;
  }, {});

  return Object.values(tasksById).reduce<Record<string, string>>((outputs, task) => {
    if (task.taskKind !== taskKind) {
      return outputs;
    }

    for (const job of task.jobs) {
      if (
        job.status === "completed" &&
        typeof job.outputPath === "string" &&
        job.outputPath.length > 0
      ) {
        outputs[job.inputPath] = job.outputPath;
      }
    }

    return outputs;
  }, latestOutputByInputPath);
};

const buildLatestTaskJobByInput = (
  tasksById: TaskMap,
  taskKind: TaskKind,
  latestJobByKindAndInput: Record<string, TaskJobRecord> = {},
) => {
  const latestJobByInputPath = Object.fromEntries(
    Object.entries(latestJobByKindAndInput)
      .filter(([key]) => key.startsWith(`${taskKind}\0`))
      .map(([, job]) => [job.inputPath, job]),
  );

  return Object.values(tasksById).reduce<Record<string, TaskJobRecord>>((jobs, task) => {
    if (task.taskKind !== taskKind) {
      return jobs;
    }

    for (const job of task.jobs) {
      jobs[job.inputPath] = job;
    }

    return jobs;
  }, latestJobByInputPath);
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

export {
  buildLatestTaskJobByInput,
  buildLatestTaskOutputPathByInput,
  buildModerationResults,
  getLatestTask,
  getLatestTaskForInput,
  getLatestTaskLogLine,
  getTaskOutputPath,
};
