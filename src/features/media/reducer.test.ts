import { describe, expect, it } from "bun:test";

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

    const completed = mediaReducer(running, {
      payload: {
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
});
