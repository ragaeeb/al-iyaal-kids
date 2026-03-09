import { describe, expect, it } from "bun:test";
import { MAX_STORED_LOG_LINES } from "@/features/media/logs";
import { createInitialMediaUiState, mediaReducer } from "@/features/media/reducer";

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
        jobId: "tmp-clip-mp4",
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
        jobId: "tmp-clip-mp4",
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

  it("should keep remove-music and editor task states isolated", () => {
    const initial = {
      ...createInitialMediaUiState(),
      removeMusicSnapshot: {
        "batch-1": "running",
      },
    };

    const next = mediaReducer(initial, {
      payload: {
        inputPaths: ["/tmp/clip.mp4"],
        taskId: "task-2",
        taskKind: "flag",
      },
      type: "task_started",
    });

    expect(next.removeMusicSnapshot).toEqual(initial.removeMusicSnapshot);
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
            jobId: "tmp-clip-mp4",
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
      payload: "Unable to start task.",
      type: "task_start_error",
    });

    expect(next.errorMessage).toBe("Unable to start task.");
    expect(next.isLoadingVideos).toBe(true);
  });
});
