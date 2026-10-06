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
}

/** Default coordinates for Bengaluru center when GPS is disabled in browser */
const BENGALURU_COORDS = { lat: 12.9716, lng: 77.5946 };

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

  // Freshness clock ticking every second while on duty
  useEffect(() => {
    if (!isAvailable || !lastLocationAt) return;
    const timer = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [isAvailable, lastLocationAt]);

  // Report location to backend and update store fix timestamp
  const reportLocationFix = useCallback(async () => {
    const postCoords = (lat: number, lng: number) => {
      recordLocationFix();
      partnerService.reportLocation(lat, lng).catch((err) => {
        console.warn('[usePartnerAvailability] Location beacon failed:', err);
      });
    };

    if (typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => postCoords(pos.coords.latitude, pos.coords.longitude),
        () => postCoords(BENGALURU_COORDS.lat, BENGALURU_COORDS.lng),
        { enableHighAccuracy: true, timeout: 5000 }
      );
    } else {
      postCoords(BENGALURU_COORDS.lat, BENGALURU_COORDS.lng);
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
          console.warn('[usePartnerAvailability] Failed to sync availability to server:', err);
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
  };
}

export { LOCATION_STALE_WARNING_S, MAX_LOCATION_AGE_S };
