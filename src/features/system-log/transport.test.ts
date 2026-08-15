import { describe, expect, it } from "bun:test";

import { getLogHistory, SYSTEM_LOG_EVENT_NAME } from "@/features/system-log/transport";

describe("system log transport", () => {
  it("should define the system log event name", () => {
    expect(SYSTEM_LOG_EVENT_NAME).toBe("system-log-line");
  });

  it("should invoke get_log_history command", async () => {
    const mockInvoke = async (command: "get_log_history") => {
      if (command === "get_log_history") {
        return ["line 1", "line 2"];
      }
      throw new Error(`Unexpected command ${command}`);
    };

    const result = await getLogHistory(mockInvoke);
    expect(result).toEqual(["line 1", "line 2"]);
  });
});
