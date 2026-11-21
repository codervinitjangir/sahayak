import { describe, it, expect, vi } from "vitest";

vi.mock("../src/services/api/notifications", () => ({ notificationsApi: {} }));
vi.mock("../src/services/api/jobs", () => ({ jobsApi: {} }));
vi.mock("../src/services/api/vehicles", () => ({ vehiclesApi: {} }));
vi.mock("../src/services/api/services", () => ({ servicesApi: {} }));
vi.mock("../src/components/ui/kit", () => ({
  TERMINAL_STATUSES: ["completed", "cancelled", "no_match_found"],
}));

import { dayLabel, groupByDay, slotLabel, timeLabel } from "../src/features/jobs/schedule";
import { isActiveStatus, isOpenStatus } from "../src/features/shared/ownerData";

// ADR-050: labels are India time whatever the phone's timezone.
describe("schedule labels", () => {
  const start = "2026-11-23T04:30:00Z"; // 10:00 IST, Monday
  const end = "2026-11-23T06:30:00Z";

  it("formats India time", () => {
    expect(dayLabel(start)).toBe("Mon 23 Nov");
    expect(timeLabel(start)).toBe("10:00");
    expect(slotLabel(start, end)).toBe("Mon 23 Nov, 10:00-12:00");
    expect(slotLabel(null, end)).toBe("");
  });

  it("an evening slot past midnight UTC stays on the right India day", () => {
    expect(dayLabel("2026-11-23T20:00:00Z")).toBe("Tue 24 Nov"); // 01:30 IST next day
  });

  it("groups slots by India day in order", () => {
    const s = (iso: string) => ({ start: iso, end: iso, label: "" });
    const groups = groupByDay([s("2026-11-23T04:30:00Z"), s("2026-11-23T06:30:00Z"), s("2026-11-24T02:30:00Z")]);
    expect(groups.map((g) => [g.day, g.slots.length])).toEqual([["Mon 23 Nov", 2], ["Tue 24 Nov", 1]]);
  });
});

describe("a booking is open but not live", () => {
  it("is under Active in Activity but never on the live-request bar", () => {
    expect(isOpenStatus("scheduled")).toBe(true);
    expect(isActiveStatus("scheduled")).toBe(false);
    expect(isActiveStatus("matching")).toBe(true);
    expect(isOpenStatus("completed")).toBe(false);
  });
});
