import { describe, expect, it } from "bun:test";

import {
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
