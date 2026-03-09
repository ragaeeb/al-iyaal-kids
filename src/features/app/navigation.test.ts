import { describe, expect, it } from "bun:test";

import { defaultAppPage, getPageDefinition } from "@/features/app/navigation";

describe("navigation", () => {
  it("should map sidebar page selections to the expected app page state", () => {
    expect(defaultAppPage).toBe("dashboard");
    expect(getPageDefinition("dashboard").label).toBe("Dashboard");
    expect(getPageDefinition("analytics")?.label).toBe("Analytics");
    expect(getPageDefinition("cut-video")?.description).toContain("cut ranges");
  });
});
