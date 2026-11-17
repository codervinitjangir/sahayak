import { describe, expect, it } from 'vitest';
import {
  OFFER_TTL_FALLBACK_S,
  formatCountdown,
  offerDeadlineMs,
  secondsLeft,
} from '../../src/features/partners/offerCountdown';

// ADR-032: offers expire 60 s after they are made; the server sends expires_at.
describe('offer countdown', () => {
  const offeredAt = '2026-11-17T10:00:00.000Z';

  it('uses the server deadline when present', () => {
    expect(offerDeadlineMs({ offeredAt, expiresAt: '2026-11-17T10:01:30.000Z' })).toBe(
      Date.parse('2026-11-17T10:01:30.000Z')
    );
  });

  it('falls back to offered_at + 60 s for an older response', () => {
    expect(offerDeadlineMs({ offeredAt })).toBe(Date.parse(offeredAt) + OFFER_TTL_FALLBACK_S * 1000);
  });

  it('has no deadline without a usable timestamp', () => {
    expect(offerDeadlineMs(null)).toBeNull();
    expect(offerDeadlineMs({ offeredAt: 'not a date' })).toBeNull();
  });

  it('rounds up and never goes negative', () => {
    const deadline = Date.parse(offeredAt) + 60_000;
    expect(secondsLeft(deadline, Date.parse(offeredAt))).toBe(60);
    expect(secondsLeft(deadline, deadline - 100)).toBe(1);
    expect(secondsLeft(deadline, deadline)).toBe(0);
    expect(secondsLeft(deadline, deadline + 5000)).toBe(0);
  });

  it('formats as m:ss', () => {
    expect(formatCountdown(42)).toBe('0:42');
    expect(formatCountdown(75)).toBe('1:15');
    expect(formatCountdown(0)).toBe('0:00');
  });
});
