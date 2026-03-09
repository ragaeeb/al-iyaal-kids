import { describe, expect, it } from "bun:test";

import {
  buildModerationResults,
  getLatestTask,
  getLatestTaskLogLine,
  getTaskOutputPath,
} from "@/features/media/selectors";
import type { AnalysisSidecar, TaskState } from "@/features/media/types";
import type { ModerationJobResult } from "@/features/moderation/results";

const createTask = (taskId: string, taskKind: TaskState["taskKind"]): TaskState => ({
  jobs: [],
  status: "queued",
  taskId,
  taskKind,
});

describe("media selectors", () => {
  it("should return the latest task for a given kind", () => {
    const tasksById = {
      one: createTask("one", "transcription"),
      three: createTask("three", "transcription"),
      two: createTask("two", "flag"),
    };

    expect(getLatestTask(tasksById, "transcription")?.taskId).toBe("three");
    expect(getLatestTask(tasksById, "cut")).toBeUndefined();
  });

  it("should return the latest non-empty task log line", () => {
    const task: TaskState = {
      jobs: [
        {
          fileName: "a.mp4",
          inputPath: "/tmp/a.mp4",
          jobId: "a",
          logs: ["one", "", "two"],
          progressPct: 0,
          status: "running",
        },
      ],
      status: "running",
      taskId: "task-1",
      taskKind: "transcription",
    };

    expect(getLatestTaskLogLine(task)).toBe("two");
  });

  it("should return the first available task output path", () => {
    const task: TaskState = {
      jobs: [
        {
          fileName: "a.mp4",
          inputPath: "/tmp/a.mp4",
          jobId: "a",
          logs: [],
          progressPct: 100,
          status: "completed",
        },
        {
          fileName: "b.mp4",
          inputPath: "/tmp/b.mp4",
          jobId: "b",
          logs: [],
          outputPath: "/tmp/out.mp4",
          progressPct: 100,
          status: "completed",
        },
      ],
      status: "completed",
      taskId: "task-2",
      taskKind: "cut",
    };

    expect(getTaskOutputPath(task)).toBe("/tmp/out.mp4");
  });

  it("should merge task and manual moderation results without duplicates", () => {
    const task: TaskState = {
      jobs: [
        {
          fileName: "episode.srt",
          inputPath: "/tmp/episode.srt",
          jobId: "job-1",
          logs: [],
          outputPath: "/tmp/episode.analysis.json",
          progressPct: 100,
          status: "completed",
        },
      ],
      status: "completed",
      taskId: "task-3",
      taskKind: "flag",
    };
    const sidecar: AnalysisSidecar = {
      createdAt: "2026-03-09T00:00:00.000Z",
      engine: "blacklist",
      flagged: [],
      summary: "ok",
      videoFileName: "episode.srt",
    };
    const toModerationJobResult = (job: TaskState["jobs"][number]): ModerationJobResult => ({
      fileName: job.fileName,
      flaggedCount: 0,
      jobId: job.jobId,
      outputPath: job.outputPath,
      segments: [],
      status: job.status,
      summary: "task",
    });
    const toManualJobResult = (value: {
      sourcePath: string;
      sidecarPath: string;
      sidecar: AnalysisSidecar;
    }): ModerationJobResult => ({
      fileName: value.sourcePath,
      flaggedCount: value.sidecar.flagged.length,
      jobId: "job-1",
      outputPath: value.sidecarPath,
      segments: value.sidecar.flagged,
      status: "completed",
      summary: value.sidecar.summary,
    });

    const results = buildModerationResults(
      task,
      { "job-1": sidecar },
      {
        "/tmp/episode.srt": {
          sidecar,
          sidecarPath: "/tmp/episode.analysis.json",
          sourcePath: "/tmp/episode.srt",
        },
      },
      toModerationJobResult,
      toManualJobResult,
    );

    expect(results).toHaveLength(1);
    expect(results[0]?.jobId).toBe("job-1");
  });
});
