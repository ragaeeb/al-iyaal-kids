import { describe, expect, it } from "bun:test";

import { brandPalette, isSemanticStatusVariant, statusClassByVariant } from "@/theme/brand";

describe("brand theme", () => {
  it("should expose the expected logo palette hex values", () => {
    expect(brandPalette).toEqual({
      dark: "#88322d",
      light: "#f1d1b1",
      muted: "#d1968f",
      primary: "#c57267",
    });
  });

  it("should keep completed and failed statuses semantic", () => {
    expect(isSemanticStatusVariant("completed")).toBe(true);
    expect(isSemanticStatusVariant("failed")).toBe(true);
    expect(isSemanticStatusVariant("running")).toBe(false);

    expect(statusClassByVariant.completed).toContain("emerald");
    expect(statusClassByVariant.failed).toContain("rose");
  });
});
