// Pure helpers behind the notification panel (ADR-054), kept out of the
// component so they can be tested without React Native.
import type { MobileNotificationListResponse } from "../../services/api/notifications";

type List = MobileNotificationListResponse | undefined;

/** The list with one row removed, for an optimistic clear. */
export function withoutNotification(list: List, id: string): List {
  if (!list) return list;
  const gone = list.items.find((n) => n.id === id);
  if (!gone) return list;
  return {
    ...list,
    items: list.items.filter((n) => n.id !== id),
    total: Math.max(0, list.total - 1),
    unread_count: gone.is_read ? list.unread_count : Math.max(0, list.unread_count - 1),
  };
}

/** The list as it looks once everything is read (auto-read on open). */
export function allRead(list: List): List {
  if (!list) return list;
  return { ...list, unread_count: 0, items: list.items.map((n) => (n.is_read ? n : { ...n, is_read: true })) };
}

/** An empty list: what Clear all leaves. */
export function cleared(list: List): List {
  if (!list) return list;
  return { ...list, items: [], total: 0, unread_count: 0, has_more: false };
}

/** Ids that were unread when the panel opened. They keep their "new" look for
 * the whole visit even though the server has already marked them read. */
export function unreadIds(list: List): Set<string> {
  return new Set((list?.items ?? []).filter((n) => !n.is_read).map((n) => n.id));
}

/** How long the panel waits before marking everything read: long enough that a
 * glance-and-close still counts as seen, short enough that the badge is gone by
 * the time the user looks back at the bell. */
export const AUTO_READ_DELAY_MS = 800;
