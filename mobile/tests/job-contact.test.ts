import { describe, expect, it, vi } from "vitest";

vi.mock("expo-location", () => ({}));
vi.mock("../src/services/api/jobContact", () => ({ jobContactApi: {} }));

import { freshness, isActiveStatus, unreadFrom } from "../src/features/jobs/contact/useJobContact";

const m = (mine: boolean, at: string) => ({ id: at, sender: mine ? "owner" : "partner", mine, body: "x", created_at: at }) as const;

describe("job contact (ADR-057/058)", () => {
  it("counts only the other side's messages after the last read", () => {
    const items = [m(false, "2026-11-21T10:00:00Z"), m(true, "2026-11-21T10:01:00Z"), m(false, "2026-11-21T10:02:00Z")];
    expect(unreadFrom(items as never, null)).toBe(2);
    expect(unreadFrom(items as never, "2026-11-21T10:00:00Z")).toBe(1);
    expect(unreadFrom(items as never, "2026-11-21T10:02:00Z")).toBe(0);
  });
  it("shares and chats only while a partner is on the job", () => {
    expect(["assigned", "partner_en_route", "in_progress"].every(isActiveStatus)).toBe(true);
    expect(["matching", "scheduled", "completed", "cancelled", undefined].some((s) => isActiveStatus(s))).toBe(false);
  });
  it("labels how fresh the owner pin is", () => {
    const now = Date.parse("2026-11-21T10:01:00Z");
    expect(freshness("2026-11-21T10:00:40Z", now)).toBe("updated 20 s ago");
    expect(freshness("2026-11-21T09:58:00Z", now)).toBe("updated 3 min ago");
    expect(freshness(null, now)).toBeNull();
  });
});
