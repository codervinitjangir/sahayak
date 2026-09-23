import { useEffect, useState } from 'react';
import {
  LOCATION_STALE_WARNING_S,
  MAX_LOCATION_AGE_S,
  locationFreshness,
  type LocationFreshness,
} from '../../types/partner';
import { recordLocationFix, setPartnerAvailability, usePartnerStore } from './partnerStore';

export interface PartnerAvailability {
  isAvailable: boolean;
  setAvailable: (next: boolean) => void;
  toggle: () => void;
  /** ISO timestamp of the last position fix, or null when never located. */
  lastLocationAt: string | null;
  /** Whole seconds since that fix. Null when there has never been one. */
  locationAgeSeconds: number | null;
  /** Null when there has never been a fix — that is "unknown", not "stale". */
  freshness: LocationFreshness | null;
  refreshLocation: () => void;
}

/**
 * The one place availability is read and written.
 *
 * Both the dashboard toggle and the Preferences toggle call this, so they are
 * the same switch rather than two copies that drift apart the moment a partner
 * goes off duty on one screen and back to the other.
 *
 * Also owns the freshness clock: the age line has to move on its own, since a
 * fix silently ageing past MAX_LOCATION_AGE_S is exactly the state a partner
 * needs to be told about.
 */
export function usePartnerAvailability(): PartnerAvailability {
  const isAvailable = usePartnerStore((s) => s.profile.isAvailable ?? true);
  const lastLocationAt = usePartnerStore((s) => s.lastLocationAt);

  const [, forceTick] = useState(0);

  useEffect(() => {
    // Off duty the age line is not rendered, so there is nothing to keep ticking.
    if (!isAvailable || !lastLocationAt) return;
    const timer = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [isAvailable, lastLocationAt]);

  const locationAgeSeconds = lastLocationAt
    ? Math.max(0, Math.floor((Date.now() - new Date(lastLocationAt).getTime()) / 1000))
    : null;

  return {
    isAvailable,
    setAvailable: setPartnerAvailability,
    toggle: () => setPartnerAvailability(!isAvailable),
    lastLocationAt,
    locationAgeSeconds,
    freshness: locationAgeSeconds === null ? null : locationFreshness(locationAgeSeconds),
    refreshLocation: () => recordLocationFix(),
  };
}

export { LOCATION_STALE_WARNING_S, MAX_LOCATION_AGE_S };
