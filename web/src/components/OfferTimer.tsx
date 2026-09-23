import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Clock, Timer } from 'lucide-react';
import { OFFER_TIMEOUT_S } from '../types/partner';

export interface OfferTimerProps {
  /** ISO timestamp the offer was issued. The countdown derives from this, so a
   *  remount or a tab regaining focus never resurrects lost seconds. */
  offeredAt: string;
  timeoutSeconds?: number;
  /** Called exactly once when the countdown reaches zero. */
  onExpire?: () => void;
  className?: string;
}

type Urgency = 'calm' | 'soon' | 'critical';

/** Teal above 15s, amber from 15 to 5, red below 5 — per .agents/skills/dispatch-ui. */
function urgencyFor(secondsLeft: number): Urgency {
  if (secondsLeft > 15) return 'calm';
  if (secondsLeft > 5) return 'soon';
  return 'critical';
}

// Toned to the partner console palette (#181818 / #F03F3F / emerald), which is
// where this component is used. The three tiers stay semantically distinct by
// hue *and* by icon *and* by the note text — never by colour alone.
const URGENCY: Record<Urgency, { text: string; bar: string; track: string; note: string; Icon: typeof Clock }> = {
  calm: {
    text: 'text-emerald-700',
    bar: 'bg-emerald-600',
    track: 'bg-emerald-100',
    note: 'Respond before it is reassigned',
    Icon: Timer,
  },
  soon: {
    text: 'text-amber-700',
    bar: 'bg-amber-600',
    track: 'bg-amber-100',
    note: 'Running out — respond now',
    Icon: Clock,
  },
  critical: {
    text: 'text-accent',
    bar: 'bg-accent',
    track: 'bg-red-100',
    note: 'About to be reassigned',
    Icon: AlertTriangle,
  },
};

/**
 * The 45-second offer countdown.
 *
 * Ticks four times a second so the depleting bar reads as continuous motion,
 * but the accessible announcement only fires when the urgency tier changes —
 * a polite live region shouting a new number every 250ms is unusable.
 */
export const OfferTimer: React.FC<OfferTimerProps> = ({
  offeredAt,
  timeoutSeconds = OFFER_TIMEOUT_S,
  onExpire,
  className = '',
}) => {
  const computeRemaining = () => {
    const elapsed = (Date.now() - new Date(offeredAt).getTime()) / 1000;
    return Math.max(0, timeoutSeconds - elapsed);
  };

  const [remaining, setRemaining] = useState(computeRemaining);
  const expiredRef = useRef(false);

  useEffect(() => {
    expiredRef.current = false;
    setRemaining(computeRemaining());

    const tick = setInterval(() => {
      const next = computeRemaining();
      setRemaining(next);
      if (next <= 0 && !expiredRef.current) {
        expiredRef.current = true;
        onExpire?.();
      }
    }, 250);

    return () => clearInterval(tick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offeredAt, timeoutSeconds]);

  const secondsLeft = Math.ceil(remaining);
  const urgency = urgencyFor(secondsLeft);
  const { text, bar, track, note, Icon } = URGENCY[urgency];
  const percentLeft = Math.max(0, Math.min(100, (remaining / timeoutSeconds) * 100));

  return (
    <div className={className}>
      <div className="flex items-center justify-between gap-3">
        <div className={`flex items-center gap-2 ${text}`}>
          <Icon className="w-4 h-4" aria-hidden="true" />
          <span className="text-sm font-semibold">{note}</span>
        </div>
        <span
          role="timer"
          aria-live="off"
          aria-label={`${secondsLeft} seconds left to respond`}
          className={`text-lg font-extrabold tabular-nums ${text}`}
        >
          {secondsLeft}s
        </span>
      </div>

      <div className={`mt-2 h-1.5 rounded-full overflow-hidden ${track}`}>
        <div
          className={`h-full rounded-full ${bar}`}
          style={{ width: `${percentLeft}%` }}
          aria-hidden="true"
        />
      </div>

      {/* Announced only on a tier change, not on every tick. */}
      <p aria-live="polite" className="sr-only">
        {secondsLeft === 0 ? 'Offer expired' : note}
      </p>
    </div>
  );
};
