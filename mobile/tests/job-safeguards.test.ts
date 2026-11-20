import { describe, it, expect, vi } from "vitest";

vi.mock("../src/services/api/client", () => ({ apiClient: {} }));

const { amountOf, minutesUntil } = await import("../src/services/api/safeguards");
const { CANCELLED_JOB_REASONS, DISPUTE_REASONS } = await import("../src/services/api/disputes");

describe("safeguards helpers (ADR-039, ADR-041)", () => {
  it("reads decimal strings from the API as numbers and keeps null as null", () => {
    expect(amountOf("550.00")).toBe(550);
    expect(amountOf(null)).toBeNull();
    expect(amountOf(undefined)).toBeNull();
  });

  it("counts whole minutes up to the new-partner time and 0 once it has passed", () => {
    const now = Date.parse("2026-11-21T12:00:00Z");
    expect(minutesUntil("2026-11-21T12:10:30Z", now)).toBe(11);
    expect(minutesUntil("2026-11-21T11:59:00Z", now)).toBe(0);
    expect(minutesUntil(null, now)).toBeNull();
  });
});

describe("dispute reasons (ADR-043)", () => {
  it("offers 'asked to pay outside the app'", () => {
    expect(DISPUTE_REASONS.map((r) => r.value)).toContain("off_app_payment");
  });

  it("a cancelled job cannot be reported as overcharged or not done", () => {
    expect(CANCELLED_JOB_REASONS).not.toContain("overcharged");
    expect(CANCELLED_JOB_REASONS).not.toContain("service_not_done");
    expect(CANCELLED_JOB_REASONS).toContain("off_app_payment");
  });
});
