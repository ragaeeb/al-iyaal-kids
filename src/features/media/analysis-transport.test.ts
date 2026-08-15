import { describe, expect, it } from "bun:test";

import {
  getAnalysisPromptPreview,
  readAnalysisImportFile,
  saveAnalysisSidecar,
  startTranscriptionBatch,
} from "@/features/media/transport";

describe("analysis transport", () => {
  it("should request the selected analysis prompt preview", async () => {
    const calls: Array<{ command: string; payload?: unknown }> = [];
    const invoke = async (command: string, payload?: unknown) => {
      calls.push({ command, payload });
      return "prompt";
    };

    await getAnalysisPromptPreview(
      { contentCriteria: "criteria", engine: "codex", priorityGuidelines: "guidelines" },
      invoke as never,
    );

    expect(calls).toEqual([
      {
        command: "get_analysis_prompt_preview",
        payload: {
          request: {
            contentCriteria: "criteria",
            engine: "codex",
            priorityGuidelines: "guidelines",
          },
        },
      },
    ]);
  });

  it("should invoke native analysis import read and save commands", async () => {
    const calls: Array<{ command: string; payload?: unknown }> = [];
    const invoke = async (command: string, payload?: unknown) => {
      calls.push({ command, payload });
      return command === "read_analysis_import_file" ? "{}" : { success: true };
    };

    await readAnalysisImportFile("/tmp/chatgpt.json", invoke as never);
    await saveAnalysisSidecar(
      { content: '{"schemaVersion":2}', videoPath: "/tmp/episode.mp4" },
      invoke as never,
    );

    expect(calls).toEqual([
      { command: "read_analysis_import_file", payload: { path: "/tmp/chatgpt.json" } },
      {
        command: "save_analysis_sidecar",
        payload: {
          request: { content: '{"schemaVersion":2}', videoPath: "/tmp/episode.mp4" },
        },
      },
    ]);
  });

  it("should send an explicitly selected video to subtitle generation", async () => {
    const calls: Array<{ command: string; payload?: unknown }> = [];
    const invoke = async (command: string, payload?: unknown) => {
      calls.push({ command, payload });
      return { batchId: "task-1", fileCount: 1, inputPaths: ["/tmp/episode.mp4"] };
    };

    await startTranscriptionBatch(
      {
        allowedExtensions: [".mp4", ".mov"],
        inputPaths: ["/tmp/episode.mp4"],
        yapMode: "auto",
      },
      invoke as never,
    );

    expect(calls).toEqual([
      {
        command: "start_transcription_batch",
        payload: {
          request: {
            allowedExtensions: [".mp4", ".mov"],
            inputPaths: ["/tmp/episode.mp4"],
            yapMode: "auto",
          },
        },
      },
    ]);
  });
});
