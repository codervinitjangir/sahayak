import { useCallback, useEffect, useRef, useState } from "react";
import * as Location from "expo-location";
import { jobContactApi, type JobMessage, type OwnerLocation } from "../../../services/api/jobContact";

// ADR-057 / ADR-058. Owner and accepted partner reach each other during a job.

export const ACTIVE_STATUSES = ["assigned", "partner_en_route", "in_progress"];
export const isActiveStatus = (s?: string | null) => !!s && ACTIVE_STATUSES.includes(s);

/** Seconds between owner fixes. Matches the partner side's 20 s cadence (ADR-049). */
export const OWNER_SHARE_INTERVAL_MS = 15000;
/** Thread poll while the chat is open / closed. */
export const CHAT_POLL_OPEN_MS = 4000;
export const CHAT_POLL_CLOSED_MS = 15000;

/** Messages from the other side that arrived after `seenAt`. */
export function unreadFrom(items: JobMessage[], seenAt: string | null): number {
  return items.filter((m) => !m.mine && (!seenAt || m.created_at > seenAt)).length;
}

/** A short "updated 20 s ago" for the owner pin on the partner map. */
export function freshness(updatedAt?: string | null, now = Date.now()): string | null {
  if (!updatedAt) return null;
  const s = Math.max(0, Math.round((now - new Date(updatedAt).getTime()) / 1000));
  return s < 60 ? `updated ${s} s ago` : `updated ${Math.round(s / 60)} min ago`;
}

/**
 * Owner side: while the job is active and the screen is open, send a fix every
 * 15 s. Foreground only, with the while-in-use permission the request flow
 * already asked for; nothing in the background.
 */
export function useShareOwnerLocation(jobId: string | null | undefined, active: boolean) {
  const [sharing, setSharing] = useState(false);
  useEffect(() => {
    if (!jobId || !active) {
      setSharing(false);
      return;
    }
    let stopped = false;
    let sub: Location.LocationSubscription | null = null;
    let last = 0;
    const send = (c: Location.LocationObject) => {
      const now = Date.now();
      if (now - last < OWNER_SHARE_INTERVAL_MS) return;
      last = now;
      jobContactApi
        .shareOwnerLocation(jobId, c.coords.latitude, c.coords.longitude, c.coords.accuracy)
        .then(() => !stopped && setSharing(true))
        .catch(() => !stopped && setSharing(false));
    };
    (async () => {
      const perm = await Location.getForegroundPermissionsAsync().catch(() => null);
      if (!perm?.granted || stopped) return;
      sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: OWNER_SHARE_INTERVAL_MS, distanceInterval: 20 },
        send,
      ).catch(() => null);
      if (stopped) sub?.remove();
    })();
    return () => {
      stopped = true;
      sub?.remove();
    };
  }, [jobId, active]);
  return sharing;
}

/** Partner side: poll the owner's live fix while the job is active. */
export function useOwnerLiveLocation(jobId: string | null | undefined, active: boolean) {
  const [loc, setLoc] = useState<OwnerLocation | null>(null);
  useEffect(() => {
    if (!jobId || !active) {
      setLoc(null);
      return;
    }
    let stopped = false;
    const tick = () =>
      jobContactApi
        .getOwnerLocation(jobId)
        .then((l) => !stopped && setLoc(l))
        .catch(() => undefined);
    void tick();
    const t = setInterval(tick, OWNER_SHARE_INTERVAL_MS);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, [jobId, active]);
  return loc;
}

/** The chat thread, polled faster while open. */
export function useJobChat(jobId: string | null | undefined, enabled: boolean, open: boolean) {
  const [items, setItems] = useState<JobMessage[]>([]);
  const [canSend, setCanSend] = useState(false);
  const [seenAt, setSeenAt] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const stoppedRef = useRef(false);

  const refresh = useCallback(async () => {
    if (!jobId) return;
    try {
      const r = await jobContactApi.listMessages(jobId);
      if (stoppedRef.current) return;
      setItems(r.items);
      setCanSend(r.can_send);
      setError(false);
    } catch {
      if (!stoppedRef.current) setError(true);
    }
  }, [jobId]);

  useEffect(() => {
    stoppedRef.current = false;
    if (!jobId || !enabled) return;
    void refresh();
    const t = setInterval(refresh, open ? CHAT_POLL_OPEN_MS : CHAT_POLL_CLOSED_MS);
    return () => {
      stoppedRef.current = true;
      clearInterval(t);
    };
  }, [jobId, enabled, open, refresh]);

  useEffect(() => {
    if (open && items.length) setSeenAt(items[items.length - 1].created_at);
  }, [open, items]);

  const send = useCallback(
    async (body: string) => {
      if (!jobId) return;
      const m = await jobContactApi.sendMessage(jobId, body);
      setItems((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
    },
    [jobId],
  );

  return { items, canSend, error, send, refresh, unread: open ? 0 : unreadFrom(items, seenAt) };
}
