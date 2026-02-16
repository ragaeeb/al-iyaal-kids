import { describe, expect, it } from "bun:test";

import { statusClassByVariant } from "@/theme/brand";

describe("badge colors", () => {
  it("should map running to brand-aligned colors", () => {
    expect(statusClassByVariant.running).toContain("#d1968f");
    expect(statusClassByVariant.running).toContain("#88322d");
  });

  it("should map queued and cancelled to warm neutral tones", () => {
    expect(statusClassByVariant.queued).toContain("#f1d1b1");
    expect(statusClassByVariant.cancelled).toContain("#d1968f");
  });
});
