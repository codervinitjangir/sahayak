import '@testing-library/jest-dom';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// Automatically unmount and cleanup DOM after the test is finished.
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// Mock crypto.randomUUID for environments where it's not defined
if (!globalThis.crypto) {
  // @ts-expect-error polyfill for tests
  globalThis.crypto = {};
}
if (!globalThis.crypto.randomUUID) {
  globalThis.crypto.randomUUID = () => '00000000-0000-4000-8000-000000000000' as `${string}-${string}-${string}-${string}-${string}`;
}
