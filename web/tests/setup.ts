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

// Mock crypto.randomUUID for environments where it's not defined
if (!globalThis.crypto) {
  // @ts-expect-error polyfill for tests
  globalThis.crypto = {};
}
if (!globalThis.crypto.randomUUID) {
  globalThis.crypto.randomUUID = () => '00000000-0000-4000-8000-000000000000' as `${string}-${string}-${string}-${string}-${string}`;
}
