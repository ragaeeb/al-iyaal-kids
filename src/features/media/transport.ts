import { MEDIA_ALLOWED_EXTENSIONS, TASK_EVENT_NAME } from "@/features/media/constants";
import type {
  CancelTaskRequest,
  CutJobStartedResponse,
  ModerationSettings,
  SrtListItem,
  StartCutJobRequest,
  StartFlagBatchRequest,
  StartTranscriptionBatchRequest,
  TaskCancelAck,
  TaskEvent,
  TaskStartedResponse,
  TaskState,
  VideoListItem,
} from "@/features/media/types";
import { invoke, listen, type UnlistenFn } from "@/lib/tauri";

type InvokeFn = typeof invoke;
type ListenFn = typeof listen;

export const listVideos = (inputDir: string, invokeFn: InvokeFn = invoke) =>
  invokeFn<VideoListItem[]>("list_videos", {
    request: {
      allowedExtensions: [...MEDIA_ALLOWED_EXTENSIONS],
      inputDir,
    },
  });

export const listSrtFiles = (inputDir: string, invokeFn: InvokeFn = invoke) =>
  invokeFn<SrtListItem[]>("list_srt_files", {
    request: {
      inputDir,
    },
  });

export const startTranscriptionBatch = (
  request: StartTranscriptionBatchRequest,
  invokeFn: InvokeFn = invoke,
) =>
  invokeFn<TaskStartedResponse>("start_transcription_batch", {
    request,
  });

export const startFlagBatch = (request: StartFlagBatchRequest, invokeFn: InvokeFn = invoke) =>
  invokeFn<TaskStartedResponse>("start_flag_batch", {
    request,
  });

export const startCutJob = (request: StartCutJobRequest, invokeFn: InvokeFn = invoke) =>
  invokeFn<CutJobStartedResponse>("start_cut_job", {
    request,
  });

export const cancelTask = (request: CancelTaskRequest, invokeFn: InvokeFn = invoke) =>
  invokeFn<TaskCancelAck>("cancel_task", {
    request,
  });

export const getTaskState = (taskId: string, invokeFn: InvokeFn = invoke) =>
  invokeFn<TaskState | null>("get_task_state", {
    taskId,
  });

export const getModerationSettings = (invokeFn: InvokeFn = invoke) =>
  invokeFn<ModerationSettings>("get_moderation_settings");

export const saveModerationSettings = (settings: ModerationSettings, invokeFn: InvokeFn = invoke) =>
  invokeFn<{ success: boolean }>("save_moderation_settings", {
    request: settings,
  });

export const readTextFile = (path: string, invokeFn: InvokeFn = invoke) =>
  invokeFn<string>("read_text_file", {
    path,
  });

export const subscribeToTaskEvents = async (
  onEvent: (event: TaskEvent) => void,
  listenFn: ListenFn = listen,
): Promise<UnlistenFn> =>
  listenFn<TaskEvent>(TASK_EVENT_NAME, (event) => {
    onEvent(event.payload);
  });
