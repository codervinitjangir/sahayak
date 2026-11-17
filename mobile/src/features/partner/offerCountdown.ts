// Offers expire (ADR-032): the dispatch worker times an offer out 60 s after it
// was made and passes the job to the next partner. The server sends the
// deadline as `expires_at`; the fallback covers a response from before the field.
import { useEffect, useState } from "react";

export const OFFER_TTL_FALLBACK_S = 60;
/** Below this many seconds the countdown turns to the warning colour. */
export const OFFER_URGENT_S = 15;

export function offerDeadlineMs(offer: { offered_at?: string | null; expires_at?: string | null } | null | undefined): number | null {
  if (!offer) return null;
  if (offer.expires_at) {
    const t = Date.parse(offer.expires_at);
    if (!Number.isNaN(t)) return t;
  }
  const offered = offer.offered_at ? Date.parse(offer.offered_at) : NaN;
  return Number.isNaN(offered) ? null : offered + OFFER_TTL_FALLBACK_S * 1000;
}

/** Whole seconds left, rounded up, never negative. */
export function secondsLeft(deadlineMs: number, nowMs: number): number {
  return Math.max(0, Math.ceil((deadlineMs - nowMs) / 1000));
}

/** 42 → "0:42", 75 → "1:15". */
export function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Seconds left on an offer, re-rendering once a second; null without a deadline. */
export function useSecondsLeft(deadlineMs: number | null): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (deadlineMs === null) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [deadlineMs]);
  return deadlineMs === null ? null : secondsLeft(deadlineMs, now);
}
