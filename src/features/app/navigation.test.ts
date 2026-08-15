import { describe, expect, it } from "bun:test";

import { addVisitedPage, defaultAppPage, getPageDefinition } from "@/features/app/navigation";

describe("navigation", () => {
  it("should map sidebar page selections to the expected app page state", () => {
    expect(defaultAppPage).toBe("dashboard");
    expect(getPageDefinition("dashboard").label).toBe("Dashboard");
    expect(getPageDefinition("cut-video")?.label).toBe("Edit Video");
    expect(getPageDefinition("settings")?.label).toBe("Settings");
  });

  it("should preserve pages after their first visit", () => {
    const initialPages = new Set([defaultAppPage]);
    const withEditor = addVisitedPage(initialPages, "cut-video");

    expect([...withEditor]).toEqual(["dashboard", "cut-video"]);
    expect(addVisitedPage(withEditor, "cut-video")).toBe(withEditor);
  });
});
