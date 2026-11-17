import { describe, it, expect, vi } from "vitest";

vi.mock("@react-navigation/native", () => ({}));
vi.mock("../src/services/api/jobs", () => ({ jobsApi: {} }));
vi.mock("../src/services/api/vehicles", () => ({ vehiclesApi: {} }));
vi.mock("../src/services/api/services", () => ({ servicesApi: {} }));
vi.mock("../src/services/api/notifications", () => ({ notificationsApi: {} }));
vi.mock("../src/components/ui/kit", () => ({
  TERMINAL_STATUSES: ["completed", "cancelled", "no_match_found"],
}));

const { pickBarJob, RECENT_MISS_MS } = await import("../src/features/home/ActiveRequestBar");
const { metresToKm, firstNameFor } = await import("../src/features/partner/partnerFormat");

const NOW = Date.parse("2026-11-15T00:00:00Z");
const job = (id: string, status: string, minsAgo = 1) =>
  ({ id, status, requested_at: new Date(NOW - minsAgo * 60_000).toISOString() }) as any;

describe("pickBarJob", () => {
  it("shows a live request even when it is not the newest job", () => {
    const picked = pickBarJob([job("a", "completed"), job("b", "matching")], new Set(), NOW);
    expect(picked).toEqual({ job: expect.objectContaining({ id: "b" }), kind: "live" });
  });

  it("treats a no-partner job inside its 10-minute window as still searching (ADR-032)", () => {
    // The server keeps widening the search with the app closed, so this is in flight.
    expect(pickBarJob([job("a", "no_match_found", 1)], new Set(), NOW)?.kind).toBe("live");
    expect(pickBarJob([job("a", "no_match_found", 9)], new Set(["a"]), NOW)?.kind).toBe("live");
  });

  it("surfaces a request that ended with no partner once its search window closed", () => {
    expect(pickBarJob([job("a", "no_match_found", 11)], new Set(), NOW)?.kind).toBe("missed");
  });

  it("drops the no-partner outcome once dismissed or stale", () => {
    expect(pickBarJob([job("a", "no_match_found", 11)], new Set(["a"]), NOW)).toBeNull();
    const staleMins = RECENT_MISS_MS / 60_000 + 1;
    expect(pickBarJob([job("a", "no_match_found", staleMins)], new Set(), NOW)).toBeNull();
  });

  it("shows nothing for finished or cancelled requests", () => {
    expect(pickBarJob([job("a", "cancelled"), job("b", "completed")], new Set(), NOW)).toBeNull();
    expect(pickBarJob(undefined, new Set(), NOW)).toBeNull();
  });
});

describe("partner formatters", () => {
  it("never shows 0.0 km for a partner at the pickup", () => {
    expect(metresToKm(0)).toBe("Under 100 m");
    expect(metresToKm(452)).toBe("450 m");
    expect(metresToKm(2400)).toBe("2.4 km");
    expect(metresToKm(null)).toBeNull();
  });

  it("does not greet the placeholder name 'Service partner' as 'Service'", () => {
    expect(firstNameFor("Service partner")).toBeNull();
    expect(firstNameFor("  Ravi Kumar ")).toBe("Ravi");
    expect(firstNameFor(null)).toBeNull();
  });
});
