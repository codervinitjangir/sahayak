import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { PartnerOffer } from '../../types/partner';

/**
 * Offers expire (ADR-032): the dispatch worker times an offer out 60 s after it
 * was made and passes the job to the next partner. The server sends the
 * deadline as `expires_at`; this fallback is only for a response that predates
 * the field.
 */
export const OFFER_TTL_FALLBACK_S = 60;

/** Below this many seconds the countdown switches to the warning colour. */
export const OFFER_URGENT_S = 15;

type OfferTimes = Pick<PartnerOffer, 'offeredAt'> & { expiresAt?: string };

/** The deadline in epoch ms, or null when the offer carries no usable timestamp. */
export function offerDeadlineMs(offer: OfferTimes | null | undefined): number | null {
  if (!offer) return null;
  if (offer.expiresAt) {
    const t = Date.parse(offer.expiresAt);
    if (!Number.isNaN(t)) return t;
  }
  const offered = Date.parse(offer.offeredAt);
  return Number.isNaN(offered) ? null : offered + OFFER_TTL_FALLBACK_S * 1000;
}

/** Whole seconds left, rounded up, never negative. */
export function secondsLeft(deadlineMs: number, nowMs: number): number {
  return Math.max(0, Math.ceil((deadlineMs - nowMs) / 1000));
}

/** 42 → "0:42", 75 → "1:15". */
export function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export interface OfferCountdownState {
  /** Null when there is no offer or no usable timestamp: render nothing. */
  secondsLeft: number | null;
  expired: boolean;
}

/**
 * Ticks once a second while an offer is on screen. When the deadline passes it
 * refetches the offer list once: the worker removes a timed-out offer within
 * one 15 s sweep, and the refetch makes the card go away as soon as it has.
 * Until then the offer may still be answerable, but the card stops inviting
 * a tap the server is about to refuse.
 */
export function useOfferCountdown(
  offer: OfferTimes | null | undefined,
  offerQueryKey: readonly unknown[]
): OfferCountdownState {
  const queryClient = useQueryClient();
  const deadline = offerDeadlineMs(offer);
  const [now, setNow] = useState(() => Date.now());
  const refetchedFor = useRef<number | null>(null);

  useEffect(() => {
    if (deadline === null) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [deadline]);

  const left = deadline === null ? null : secondsLeft(deadline, now);
  const expired = left === 0;

  useEffect(() => {
    if (expired && deadline !== null && refetchedFor.current !== deadline) {
      refetchedFor.current = deadline;
      void queryClient.invalidateQueries({ queryKey: offerQueryKey });
    }
  }, [expired, deadline, queryClient, offerQueryKey]);

  return { secondsLeft: left, expired };
}
