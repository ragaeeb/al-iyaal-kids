import type { TaskCancelAck } from "@/features/media/types";

export const TASK_CANCEL_REJECTED_MESSAGE =
  "Cancellation was not accepted because this task is no longer active or has already finished.";

export type TaskCancelOutcome =
  | {
      accepted: true;
      errorMessage: null;
    }
  | {
      accepted: false;
      errorMessage: string;
    };

export const toTaskCancelOutcome = (ack: TaskCancelAck): TaskCancelOutcome =>
  ack.accepted
    ? {
        accepted: true,
        errorMessage: null,
      }
    : {
        accepted: false,
        errorMessage: TASK_CANCEL_REJECTED_MESSAGE,
      };
