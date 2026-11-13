import '@testing-library/jest-dom';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { resetPartnerStore } from '../src/features/partners/partnerStore';

// Automatically unmount and cleanup DOM after the test is finished.
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  // The partner store is module-level, so it outlives a test unless told
  // otherwise — without this, test 2 in a file inherits test 1's profile.
  resetPartnerStore();
});

// Node 25+ ships its own `localStorage` global that is unusable without
// --localstorage-file and shadows jsdom's. Fall back to a minimal in-memory Storage
// so the suite does not depend on which Node major runs it.
function memoryStorage(): Storage {
  let data: Record<string, string> = {};
  return {
    get length() { return Object.keys(data).length; },
    clear: () => { data = {}; },
    getItem: (k: string) => (k in data ? data[k] : null),
    key: (i: number) => Object.keys(data)[i] ?? null,
    removeItem: (k: string) => { delete data[k]; },
    setItem: (k: string, v: string) => { data[k] = String(v); },
  } as Storage;
}
for (const name of ['localStorage', 'sessionStorage'] as const) {
  let usable = false;
  try { usable = typeof globalThis[name]?.clear === 'function'; } catch { usable = false; }
  if (!usable) {
    Object.defineProperty(globalThis, name, { value: memoryStorage(), configurable: true });
  }
}

// Mock crypto.randomUUID for environments where it's not defined
if (!globalThis.crypto) {
  // @ts-expect-error polyfill for tests
  globalThis.crypto = {};
}
if (!globalThis.crypto.randomUUID) {
  globalThis.crypto.randomUUID = () => '00000000-0000-4000-8000-000000000000' as `${string}-${string}-${string}-${string}-${string}`;
}
