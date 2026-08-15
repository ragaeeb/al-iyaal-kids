import { describe, expect, it } from "bun:test";
import { MAX_STORED_LOG_LINES } from "@/features/media/logs";
import {
  createInitialMediaUiState,
  MAX_RETAINED_TASKS,
  mediaReducer,
} from "@/features/media/reducer";
import { buildLatestTaskJobByInput } from "@/features/media/selectors";
import { toJobId } from "@/features/shared/job-id";

const clipJobId = toJobId("/tmp/clip.mp4");

const completeTask = (state: Parameters<typeof mediaReducer>[0], taskId: string) =>
  mediaReducer(
    mediaReducer(state, {
      payload: {
        inputPaths: [`/tmp/${taskId}.mp4`],
        taskId,
        taskKind: "transcription",
      },
      type: "task_started",
    }),
    {
      payload: {
        summary: { cancelled: 0, failed: 0, ok: 1 },
        taskId,
        taskKind: "transcription",
        type: "task_done",
      },
      type: "apply_task_event",
    },
  );

describe("mediaReducer", () => {
  it("should map task events into queue state transitions", () => {
    const started = mediaReducer(createInitialMediaUiState(), {
      payload: {
        inputPaths: ["/tmp/clip.mp4"],
        taskId: "task-1",
        taskKind: "transcription",
      },
      type: "task_started",
    });

    const running = mediaReducer(started, {
      payload: {
        jobId: clipJobId,
        progressPct: 27,
        taskId: "task-1",
        taskKind: "transcription",
        type: "job_progress",
      },
      type: "apply_task_event",
    });

    expect(running.tasksById["task-1"]?.jobs[0]?.status).toBe("running");
    expect(running.tasksById["task-1"]?.jobs[0]?.progressPct).toBe(27);
    expect(started.workerStatus).toBe("starting");
    expect(started.workerMessage).toBe("Starting worker task...");

    const completed = mediaReducer(running, {
      payload: {
        artifacts: {
          summary: "Transcript written.",
        },
        jobId: clipJobId,
        outputPath: "/tmp/clip.srt",
        taskId: "task-1",
        taskKind: "transcription",
        type: "job_done",
      },
      type: "apply_task_event",
    });
    expect(completed.tasksById["task-1"]?.jobs[0]?.status).toBe("completed");
    expect(completed.tasksById["task-1"]?.jobs[0]?.outputPath).toBe("/tmp/clip.srt");
    expect(completed.tasksById["task-1"]?.jobs[0]?.artifacts?.summary).toBe("Transcript written.");
  });

  it("should cap task log history to the recent window", () => {
    const started = mediaReducer(createInitialMediaUiState(), {
      payload: {
        inputPaths: ["/tmp/clip.mp4"],
        taskId: "task-1",
        taskKind: "transcription",
      },
      type: "task_started",
    });

    const withLogs = Array.from({ length: MAX_STORED_LOG_LINES + 2 }, (_, index) => index).reduce(
      (state, index) =>
        mediaReducer(state, {
          payload: {
            jobId: clipJobId,
            message: `line-${index}`,
            stream: "stdout",
            taskId: "task-1",
            taskKind: "transcription",
            type: "job_log",
          },
          type: "apply_task_event",
        }),
      started,
    );

    const logs = withLogs.tasksById["task-1"]?.jobs[0]?.logs ?? [];
    expect(logs).toHaveLength(MAX_STORED_LOG_LINES);
    expect(logs.at(0)).toBe("line-2");
    expect(logs.at(-1)).toBe(`line-${MAX_STORED_LOG_LINES + 1}`);
  });

  it("should preserve video loading state when task start fails", () => {
    const seed = {
      ...createInitialMediaUiState(),
      isLoadingVideos: true,
    };

    const next = mediaReducer(seed, {
      payload: {
        message: "Unable to start task.",
        taskKind: "transcription",
      },
      type: "task_start_error",
    });

    expect(next.errorMessage).toBe("Unable to start task.");
    expect(next.errorTaskKind).toBe("transcription");
    expect(next.isLoadingVideos).toBe(true);
  });

  it("should clear a previous task start error when a new task starts", () => {
    const seed = {
      ...createInitialMediaUiState(),
      errorMessage: "Previous task failed.",
    };

    const next = mediaReducer(seed, {
      payload: {
        inputPaths: ["/tmp/clip.mp4"],
        taskId: "task-2",
        taskKind: "transcription",
      },
      type: "task_started",
    });

    expect(next.errorMessage).toBeNull();
  });

  it("should retain only the latest terminal task history", () => {
    const state = Array.from({ length: MAX_RETAINED_TASKS + 5 }, (_, index) => index).reduce(
      (current, index) => completeTask(current, `task-${index}`),
      createInitialMediaUiState(),
    );

    expect(Object.keys(state.tasksById)).toHaveLength(MAX_RETAINED_TASKS);
    expect(state.tasksById["task-0"]).toBeUndefined();
    expect(state.tasksById[`task-${MAX_RETAINED_TASKS + 4}`]).toBeDefined();
    expect(Object.keys(state.tasksById).at(-1)).toBe(`task-${MAX_RETAINED_TASKS + 4}`);
  });

  it("should retain bounded log-free row outcomes after full tasks are pruned", () => {
    const state = Array.from({ length: MAX_RETAINED_TASKS + 5 }, (_, index) => index).reduce(
      (current, index) => {
        const inputPath = `/tmp/summary-${index}.mp4`;
        const taskId = `summary-${index}`;
        const started = mediaReducer(current, {
          payload: { inputPaths: [inputPath], taskId, taskKind: "transcription" },
          type: "task_started",
        });
        const completed = mediaReducer(started, {
          payload: {
            jobId: toJobId(inputPath),
            outputPath: `/tmp/summary-${index}.srt`,
            taskId,
            taskKind: "transcription",
            type: "job_done",
          },
          type: "apply_task_event",
        });
        return mediaReducer(completed, {
          payload: {
            summary: { cancelled: 0, failed: 0, ok: 1 },
            taskId,
            taskKind: "transcription",
            type: "task_done",
          },
          type: "apply_task_event",
        });
      },
      createInitialMediaUiState(),
    );
    const jobs = buildLatestTaskJobByInput(
      state.tasksById,
      "transcription",
      state.latestJobByKindAndInput,
    );

    expect(state.tasksById["summary-0"]).toBeUndefined();
    expect(jobs["/tmp/summary-0.mp4"]?.outputPath).toBe("/tmp/summary-0.srt");
    expect(jobs["/tmp/summary-0.mp4"]?.logs).toEqual([]);
  });

  it("should never evict nonterminal tasks when the active set exceeds the bound", () => {
    const state = Array.from({ length: MAX_RETAINED_TASKS + 5 }, (_, index) => index).reduce(
      (current, index) =>
        mediaReducer(current, {
          payload: {
            inputPaths: [`/tmp/running-${index}.mp4`],
            taskId: `running-${index}`,
            taskKind: "flag",
          },
          type: "task_started",
        }),
      createInitialMediaUiState(),
    );

    expect(state.tasksById["running-0"]).toBeDefined();
    expect(Object.keys(state.tasksById)).toHaveLength(MAX_RETAINED_TASKS + 5);
  });

  it("should retain the active task even when it is terminal", () => {
    const state = Array.from({ length: MAX_RETAINED_TASKS }, (_, index) => index).reduce(
      (current, index) => completeTask(current, `task-${index}`),
      createInitialMediaUiState(),
    );
    const activeTask = state.tasksById[`task-${MAX_RETAINED_TASKS - 1}`];
    if (!activeTask) {
      throw new Error("Expected the latest task to exist.");
    }

    const overCapacity = {
      ...state,
      activeTaskId: activeTask.taskId,
      tasksById: {
        ...state.tasksById,
        "task-extra": {
          ...activeTask,
          taskId: "task-extra",
        },
      },
    };
    const next = mediaReducer(overCapacity, {
      payload: {
        jobId: toJobId(`/tmp/task-${MAX_RETAINED_TASKS - 1}.mp4`),
        message: "late terminal log",
        stream: "stdout",
        taskId: activeTask.taskId,
        taskKind: "transcription",
        type: "job_log",
      },
      type: "apply_task_event",
    });

    expect(next.tasksById[activeTask.taskId]).toBeDefined();
  });
});
