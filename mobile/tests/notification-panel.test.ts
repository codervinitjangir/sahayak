import { describe, expect, it } from "vitest";
import { allRead, cleared, unreadIds, withoutNotification } from "../src/features/shared/notificationPanel";
import type { MobileNotificationListResponse } from "../src/services/api/notifications";

const item = (id: string, is_read: boolean) => ({
  id, event: "job_accepted", message: "m", job_id: null, is_read, sent_at: "2026-11-21T10:00:00Z",
});
const list = (): MobileNotificationListResponse => ({
  items: [item("a", false), item("b", true), item("c", false)],
  unread_count: 2, total: 3, limit: 30, offset: 0, has_more: false,
});

describe("notification panel helpers (ADR-054)", () => {
  it("clearing an unread row drops it from items, total and the badge", () => {
    const out = withoutNotification(list(), "a")!;
    expect(out.items.map((n) => n.id)).toEqual(["b", "c"]);
    expect([out.total, out.unread_count]).toEqual([2, 1]);
  });
  it("clearing a read row leaves the badge alone", () => {
    expect(withoutNotification(list(), "b")!.unread_count).toBe(2);
  });
  it("clearing an unknown id or an empty cache changes nothing", () => {
    const l = list();
    expect(withoutNotification(l, "zz")).toBe(l);
    expect(withoutNotification(undefined, "a")).toBeUndefined();
  });
  it("allRead marks every row read and zeroes the badge", () => {
    const out = allRead(list())!;
    expect(out.unread_count).toBe(0);
    expect(out.items.every((n) => n.is_read)).toBe(true);
  });
  it("cleared leaves nothing", () => {
    expect(cleared(list())).toMatchObject({ items: [], total: 0, unread_count: 0, has_more: false });
  });
  it("unreadIds snapshots the rows that were new on open", () => {
    expect([...unreadIds(list())].sort()).toEqual(["a", "c"]);
    expect(unreadIds(undefined).size).toBe(0);
  });
});
