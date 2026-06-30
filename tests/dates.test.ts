import { describe, expect, it } from "vitest";
import { validateDateRange } from "../src/domain/dates.js";

describe("date range validation", () => {
  it("accepts valid ordered ISO dates", () => {
    expect(() => validateDateRange("2026-03-01", "2026-04-30")).not.toThrow();
  });

  it("rejects malformed, impossible, and reversed dates", () => {
    expect(() => validateDateRange("03/01/2026", "2026-04-30")).toThrow(/YYYY-MM-DD/);
    expect(() => validateDateRange("2026-02-30", "2026-04-30")).toThrow(/invalid/);
    expect(() => validateDateRange("2026-05-01", "2026-04-30")).toThrow(/after/);
  });
});
