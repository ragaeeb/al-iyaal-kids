import { describe, expect, it } from "bun:test";

import {
  buildBatchAutoQuickActions,
  canStartQueuedMediaAction,
  enqueueMediaQuickAction,
  hasActiveMediaTask,
  removeMediaQuickAction,
  toMediaQuickActionId,
} from "@/features/media/quick-action-queue";
import type { TaskState } from "@/features/media/types";

describe("media quick action queue", () => {
  it("should enqueue each input once per action kind", () => {
    const queued = enqueueMediaQuickAction([], "transcription", "/tmp/a.mp4");
    const duplicated = enqueueMediaQuickAction(queued, "transcription", "/tmp/a.mp4");
    const withFlag = enqueueMediaQuickAction(duplicated, "flag", "/tmp/a.srt");

    expect(duplicated).toBe(queued);
    expect(withFlag).toHaveLength(2);
    expect(withFlag.map((action) => action.id)).toEqual([
      "transcription:/tmp/a.mp4",
      "flag:/tmp/a.srt",
    ]);
  });

  it("should remove a queued action by id", () => {
    const queue = enqueueMediaQuickAction(
      enqueueMediaQuickAction([], "transcription", "/tmp/a.mp4"),
      "flag",
      "/tmp/a.srt",
    );

    expect(
      removeMediaQuickAction(queue, toMediaQuickActionId("transcription", "/tmp/a.mp4")),
    ).toEqual([
      {
        id: "flag:/tmp/a.srt",
        inputPath: "/tmp/a.srt",
        kind: "flag",
      },
    ]);
  });

  it("should build auto quick actions for completed batch jobs", () => {
    const completedJobs = [
      { inputPath: "/tmp/a.mp4", outputPath: "/tmp/audio_replaced/a.mp4" },
      { inputPath: "/tmp/b.mp4", outputPath: "/tmp/audio_replaced/b.mp4" },
      { inputPath: "/tmp/c.mp4" }, // failed job, no output
    ];

    const actions = buildBatchAutoQuickActions({
      autoActionsByPath: {
        "/tmp/a.mp4": { autoTranscribe: true },
        "/tmp/b.mp4": { autoAnalyze: true, autoTranscribe: true },
      },
      completedJobs,
    });

    expect(actions).toEqual([
      {
        id: "transcription:/tmp/audio_replaced/a.mp4",
        inputPath: "/tmp/audio_replaced/a.mp4",
        kind: "transcription",
      },
      {
        id: "transcription:/tmp/audio_replaced/b.mp4",
        inputPath: "/tmp/audio_replaced/b.mp4",
        kind: "transcription",
      },
      {
        id: "flag:/tmp/audio_replaced/b.srt",
        inputPath: "/tmp/audio_replaced/b.srt",
        kind: "flag",
      },
    ]);
  });

  it("should wait until the shared worker has no active batch or task", () => {
    expect(
      canStartQueuedMediaAction({
        hasActiveBatch: false,
        hasActiveTask: false,
        isLaunching: false,
        queueLength: 1,
        workerStatus: "ready",
      }),
    ).toBe(true);
    expect(
      canStartQueuedMediaAction({
        hasActiveBatch: true,
        hasActiveTask: false,
        isLaunching: false,
        queueLength: 1,
        workerStatus: "ready",
      }),
    ).toBe(false);
    expect(
      canStartQueuedMediaAction({
        hasActiveBatch: false,
        hasActiveTask: true,
        isLaunching: false,
        queueLength: 1,
        workerStatus: "ready",
      }),
    ).toBe(false);
    expect(
      canStartQueuedMediaAction({
        hasActiveBatch: false,
        hasActiveTask: false,
        isLaunching: false,
        queueLength: 1,
        workerStatus: "starting",
      }),
    ).toBe(false);
  });

  it("should detect queued and running media tasks as active", () => {
    const completedTask: TaskState = {
      jobs: [],
      status: "completed",
      taskId: "completed",
      taskKind: "transcription",
    };
    const tasksById: Record<string, TaskState> = {
      completed: completedTask,
      queued: {
        jobs: [],
        status: "queued",
        taskId: "queued",
        taskKind: "flag",
      },
    };

    expect(hasActiveMediaTask(tasksById)).toBe(true);
    expect(hasActiveMediaTask({ completed: completedTask })).toBe(false);
  });
});
