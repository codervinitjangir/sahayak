import { useSyncExternalStore } from 'react';
import {
  PARTNER_PROFILE_EVENT,
  diffVerificationItems,
  getStoredPartnerProfile,
  saveStoredPartnerProfile,
  type PartnerProfile,
  type VerificationEvent,
} from '../../types/partner';

/**
 * The partner profile is client state backed by localStorage, not server state,
 * so it does not belong in React Query (see .agents/rules/api-client.md, which
 * scopes React Query to /api/v1 responses). It does need to be *shared*: the
 * dashboard availability toggle and the Preferences availability toggle are the
 * same switch, and a verification status change has to reach both the toast on
 * VerificationStatus and the dashboard Inbox.
 *
 * A module-level external store read through useSyncExternalStore gives one
 * live copy per tab with no provider to thread through the tree.
 */

export type AnnouncementTone = 'success' | 'warning' | 'info';

/**
 * The headline for a status change, consumed by the VerificationStatus toast.
 *
 * `seq` increments on every announcement so a consumer can tell "this is new"
 * from "this is the same one I already showed" — two identical messages in a
 * row are still two announcements.
 */
export interface PartnerAnnouncement {
  seq: number;
  message: string;
  tone: AnnouncementTone;
}

export interface PartnerStoreState {
  profile: PartnerProfile;
  /** ISO timestamp of the last position fix, or null when never located. */
  lastLocationAt: string | null;
  /** Verification status changes, newest batch first. Capped at MAX_EVENTS. */
  verificationEvents: VerificationEvent[];
  announcement: PartnerAnnouncement | null;
}

/** Enough for the Inbox to show recent history without growing without bound. */
const MAX_EVENTS = 20;

function freshState(lastLocationAt: string | null): PartnerStoreState {
  return {
    profile: getStoredPartnerProfile(),
    lastLocationAt,
    verificationEvents: [],
    announcement: null,
  };
}

let state: PartnerStoreState = freshState(new Date().toISOString());
let announcementSeq = 0;

const listeners = new Set<() => void>();

/** True while this module is mid-write, so it ignores the event it just fired. */
let writing = false;

function emit(next: PartnerStoreState): void {
  state = next;
  // Copy: a listener may unsubscribe during notification.
  for (const listener of Array.from(listeners)) listener();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getPartnerStoreState(): PartnerStoreState {
  return state;
}

/**
 * Adopt a profile written by something that still calls saveStoredPartnerProfile
 * directly — the Preferences service toggles, or a test seeding fixtures.
 *
 * Deliberately does NOT raise verification events: a wholesale profile
 * replacement is not a status *change*, and treating it as one would fire
 * phantom Inbox entries every time a test seeded a profile.
 */
function adoptExternalProfile(profile: PartnerProfile): void {
  if (writing || profile === state.profile) return;
  emit({ ...state, profile });
}

if (typeof window !== 'undefined') {
  window.addEventListener(PARTNER_PROFILE_EVENT, (event) => {
    const incoming = (event as CustomEvent<PartnerProfile>).detail;
    if (incoming) adoptExternalProfile(incoming);
  });
}

/** Renders an event as one line of prose. Shared so toast and Inbox agree. */
export function describeVerificationEvent(event: VerificationEvent): string {
  switch (event.status) {
    case 'complete':
      return `${event.itemLabel} approved.`;
    case 'requirements_due':
      // Never a bare "rejected" — the stored reason is the whole point.
      return event.reason
        ? `${event.itemLabel}: ${event.reason}`
        : `${event.itemLabel} needs a new upload before it can be approved.`;
    case 'in_progress':
      return `${event.itemLabel} is under review.`;
    default:
      return `${event.itemLabel} has not been submitted yet.`;
  }
}

/**
 * The single write path for the partner profile.
 *
 * Diffs verification items on the way through, so every status change becomes
 * an event exactly once no matter which screen triggered it. Returns the events
 * it raised, mostly so callers can assert on them in tests.
 */
export function updatePartnerProfile(
  updater: (prev: PartnerProfile) => PartnerProfile,
  announcement?: { message: string; tone: AnnouncementTone }
): VerificationEvent[] {
  const prev = state.profile;
  const next = updater(prev);

  const events =
    next === prev
      ? []
      : diffVerificationItems(prev.verificationItems, next.verificationItems, new Date().toISOString());

  if (next !== prev) {
    writing = true;
    try {
      saveStoredPartnerProfile(next);
    } finally {
      writing = false;
    }
  }

  let headline = state.announcement;
  if (announcement) {
    headline = { seq: ++announcementSeq, ...announcement };
  } else if (events.length > 0) {
    headline = { seq: ++announcementSeq, message: describeVerificationEvent(events[0]), tone: events[0].tone };
  }

  emit({
    ...state,
    profile: next,
    verificationEvents: events.length > 0 ? [...events, ...state.verificationEvents].slice(0, MAX_EVENTS) : state.verificationEvents,
    announcement: headline,
  });

  return events;
}

export function setPartnerAvailability(isAvailable: boolean): void {
  updatePartnerProfile((prev) => (prev.isAvailable === isAvailable ? prev : { ...prev, isAvailable }));
  // Going on duty is when the app starts reporting position again.
  if (isAvailable) recordLocationFix();
}

export function recordLocationFix(at: string = new Date().toISOString()): void {
  emit({ ...state, lastLocationAt: at });
}

export function dismissVerificationEvent(id: string): void {
  const remaining = state.verificationEvents.filter((event) => event.id !== id);
  if (remaining.length === state.verificationEvents.length) return;
  emit({ ...state, verificationEvents: remaining });
}

export function dismissAnnouncement(): void {
  if (!state.announcement) return;
  emit({ ...state, announcement: null });
}

/**
 * Drop everything and re-read localStorage.
 *
 * Called from tests/setup.ts before every test: a module-level store survives
 * between tests in the same file, so without this the second test in a file
 * would inherit the first one's profile and events.
 */
export function resetPartnerStore(options?: { lastLocationAt?: string | null }): void {
  announcementSeq = 0;
  emit(freshState(options && 'lastLocationAt' in options ? (options.lastLocationAt ?? null) : new Date().toISOString()));
}

/**
 * React binding.
 *
 * `selector` must return a primitive or a reference that is stable between
 * unchanged states — returning a fresh object literal makes useSyncExternalStore
 * loop forever.
 */
export function usePartnerStore<T>(selector: (state: PartnerStoreState) => T): T {
  const read = () => selector(getPartnerStoreState());
  return useSyncExternalStore(subscribe, read, read);
}

export function usePartnerProfile(): PartnerProfile {
  return usePartnerStore((s) => s.profile);
}
