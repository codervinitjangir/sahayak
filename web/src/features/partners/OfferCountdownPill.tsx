import React from 'react';
import { Timer } from 'lucide-react';
import { OFFER_URGENT_S, formatCountdown, type OfferCountdownState } from './offerCountdown';

/**
 * "Respond within 0:42" on an offer card (ADR-032). Renders nothing without a
 * deadline. Not an aria-live region: a per-second announcement would drown a
 * screen reader. The expiry itself is announced once, by the text change in
 * the sibling status region the caller owns.
 */
export const OfferCountdown: React.FC<{ countdown: OfferCountdownState; className?: string }> = ({
  countdown,
  className = '',
}) => {
  if (countdown.secondsLeft === null) return null;
  if (countdown.expired) {
    return (
      <span data-testid="offer-countdown" className={`inline-flex items-center gap-1.5 text-xs font-semibold text-ink-muted ${className}`}>
        <Timer className="w-3.5 h-3.5" aria-hidden="true" />
        Time is up. Passing to the next partner
      </span>
    );
  }
  const urgent = countdown.secondsLeft <= OFFER_URGENT_S;
  return (
    <span
      data-testid="offer-countdown"
      role="timer"
      aria-label={`${countdown.secondsLeft} seconds left to respond`}
      className={`inline-flex items-center gap-1.5 text-xs font-semibold tnum ${urgent ? 'text-status-warning' : 'text-brand-800'} ${className}`}
    >
      <Timer className="w-3.5 h-3.5" aria-hidden="true" />
      Respond within {formatCountdown(countdown.secondsLeft)}
    </span>
  );
};
