import { useSyncExternalStore } from 'react';

/**
 * Console Settings — the preferences that shape how the console *behaves*,
 * as opposed to Fleet & Preferences, which describes what the partner can do.
 *
 * These are client state: there is no settings endpoint yet, so they live in
 * localStorage under one key and survive a reload. When the backend grows a
 * `/partners/me/console-settings` route this module is the only thing that has
 * to change — every consumer goes through the hook.
 */

export type DistanceUnit = 'km' | 'mi';
export type ClockFormat = '12h' | '24h';

export interface ConsoleSettings {
  /** Play a sound when a dispatch offer arrives. */
  offerSound: boolean;
  /** Browser push for offers while the console is in a background tab. */
  desktopNotifications: boolean;
  /** SMS fallback if an offer goes unanswered. */
  smsFallback: boolean;
  /** Mask every ₹ figure in the console. For working in front of customers. */
  privacyMode: boolean;
  /** Auto-drop to Off Duty once a job completes, instead of queueing the next. */
  autoOffDutyAfterJob: boolean;
  distanceUnit: DistanceUnit;
  clockFormat: ClockFormat;
}

export const DEFAULT_CONSOLE_SETTINGS: ConsoleSettings = {
  offerSound: true,
  desktopNotifications: true,
  smsFallback: false,
  privacyMode: false,
  autoOffDutyAfterJob: false,
  distanceUnit: 'km',
  clockFormat: '12h',
};

const STORAGE_KEY = 'sahayak.partner.consoleSettings';

function read(): ConsoleSettings {
  if (typeof window === 'undefined') return DEFAULT_CONSOLE_SETTINGS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CONSOLE_SETTINGS;
    // Spread over the defaults so a settings key added in a later release does
    // not come back undefined for anyone who already has a stored blob.
    return { ...DEFAULT_CONSOLE_SETTINGS, ...(JSON.parse(raw) as Partial<ConsoleSettings>) };
  } catch {
    return DEFAULT_CONSOLE_SETTINGS;
  }
}

let state: ConsoleSettings = read();
const listeners = new Set<() => void>();

export function subscribeConsoleSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getConsoleSettings(): ConsoleSettings {
  return state;
}

export function updateConsoleSettings(patch: Partial<ConsoleSettings>): void {
  state = { ...state, ...patch };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // A full or blocked localStorage must not take the console down — the
    // change still applies for this session, it just will not survive a reload.
  }
  for (const listener of Array.from(listeners)) listener();
}

export function resetConsoleSettings(): void {
  updateConsoleSettings(DEFAULT_CONSOLE_SETTINGS);
}

export function useConsoleSettings(): ConsoleSettings {
  return useSyncExternalStore(subscribeConsoleSettings, getConsoleSettings, () => DEFAULT_CONSOLE_SETTINGS);
}
