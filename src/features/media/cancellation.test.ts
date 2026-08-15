import { describe, expect, it } from "bun:test";

import { TASK_CANCEL_REJECTED_MESSAGE, toTaskCancelOutcome } from "@/features/media/cancellation";

describe("media cancellation", () => {
  it("should accept cancellation only when the task acknowledges it", () => {
    expect(toTaskCancelOutcome({ accepted: true, taskId: "task-1" })).toEqual({
      accepted: true,
      errorMessage: null,
    });
  });

  it("should explain when cancellation was rejected for an inactive task", () => {
    expect(toTaskCancelOutcome({ accepted: false, taskId: "task-1" })).toEqual({
      accepted: false,
      errorMessage: TASK_CANCEL_REJECTED_MESSAGE,
    });
  });
});
