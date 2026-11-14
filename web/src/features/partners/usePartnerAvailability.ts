import { useEffect, useState, useCallback } from 'react';
import {
  LOCATION_STALE_WARNING_S,
  MAX_LOCATION_AGE_S,
  locationFreshness,
  type LocationFreshness,
} from '../../types/partner';
import { recordLocationFix, setPartnerAvailability, usePartnerStore } from './partnerStore';
import { partnerService } from '../../services/partner.service';

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
  /**
   * Why the last attempt to read a position failed, or null. 'denied' means the
   * browser is blocking location for this site and retrying will not help until
   * the partner changes the site permission (N8).
   */
  locationProblem: LocationProblem | null;
}

export type LocationProblem = 'denied' | 'unavailable' | 'unsupported';

/** Default coordinates for Bengaluru center when GPS is disabled in browser */

/**
 * The one place availability is read and written.
 *
 * Both the dashboard toggle and the Preferences toggle call this, so they are
 * the same switch rather than two copies that drift apart the moment a partner
 * goes off duty on one screen and back to the other.
 *
 * Also owns the freshness clock and location reporting to Redis GEO while on shift.
 */
export function usePartnerAvailability(): PartnerAvailability {
  const isAvailable = usePartnerStore((s) => s.profile.isAvailable ?? true);
  const lastLocationAt = usePartnerStore((s) => s.lastLocationAt);

  const [, forceTick] = useState(0);
  const [locationProblem, setLocationProblem] = useState<LocationProblem | null>(null);

  // Freshness clock ticking every second while on duty
  useEffect(() => {
    if (!isAvailable || !lastLocationAt) return;
    const timer = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [isAvailable, lastLocationAt]);

  // Report location to backend and update store fix timestamp
  const reportLocationFix = useCallback(async () => {
    // A fix is recorded only once the backend has accepted a real GPS reading.
    // There is deliberately no fallback coordinate: reporting a made-up point
    // would put this partner into dispatch for jobs they are nowhere near.
    const postCoords = (lat: number, lng: number) => {
      partnerService
        .reportLocation(lat, lng)
        .then(() => {
          setLocationProblem(null);
          recordLocationFix();
        })
        .catch((err) => {
          console.warn('[usePartnerAvailability] Location beacon failed:', err);
        });
    };

    if (typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => postCoords(pos.coords.latitude, pos.coords.longitude),
        (err) => {
          // code 1 is PERMISSION_DENIED; 2 and 3 are "no position" and "timed out".
          setLocationProblem(err.code === 1 ? 'denied' : 'unavailable');
          console.warn('[usePartnerAvailability] GPS unavailable — location not reported:', err.message);
        },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    } else {
      setLocationProblem('unsupported');
    }
  }, []);

  // Periodic location beaconing while on shift (every 60s, plus on entering shift)
  useEffect(() => {
    if (!isAvailable || import.meta.env.MODE === 'test') return;

    reportLocationFix();
    const interval = setInterval(() => {
      reportLocationFix();
    }, 60000);

    return () => clearInterval(interval);
  }, [isAvailable, reportLocationFix]);

  const updateAvailability = useCallback(
    (next: boolean) => {
      setPartnerAvailability(next);
      if (import.meta.env.MODE !== 'test') {
        partnerService.setAvailability(next).catch((err) => {
          // The server did not take the change, so the switch must not claim it did.
          console.warn('[usePartnerAvailability] Failed to sync availability to server:', err);
          setPartnerAvailability(!next);
        });
        if (next) {
          reportLocationFix();
        }
      }
    },
    [reportLocationFix]
  );

  const locationAgeSeconds = lastLocationAt
    ? Math.max(0, Math.floor((Date.now() - new Date(lastLocationAt).getTime()) / 1000))
    : null;

  return {
    isAvailable,
    setAvailable: updateAvailability,
    toggle: () => updateAvailability(!isAvailable),
    lastLocationAt,
    locationAgeSeconds,
    freshness: locationAgeSeconds === null ? null : locationFreshness(locationAgeSeconds),
    refreshLocation: reportLocationFix,
    locationProblem,
  };
}

export { LOCATION_STALE_WARNING_S, MAX_LOCATION_AGE_S };
