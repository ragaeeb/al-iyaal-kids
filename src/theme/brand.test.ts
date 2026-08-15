import { describe, expect, it } from "bun:test";

import { statusClassByVariant } from "@/theme/brand";

describe("brand theme", () => {
  it("should keep completed and failed statuses semantic", () => {
    expect(statusClassByVariant.completed).toContain("emerald");
    expect(statusClassByVariant.failed).toContain("rose");
  });
});
