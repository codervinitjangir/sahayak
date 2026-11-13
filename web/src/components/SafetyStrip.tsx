import React, { useState } from 'react';
import { Phone, Share2 } from 'lucide-react';

/** India's single emergency number. Always one tap away while someone is stranded. */
export const EMERGENCY_NUMBER = '112';

type ShareState = 'idle' | 'locating' | 'shared' | 'copied' | 'error';

/**
 * Two actions that need no backend and no account: call the emergency number, and
 * send your current position to someone you trust.
 *
 * Sharing builds a plain maps link from the device's GPS fix. Nothing is sent to
 * Sahayak; the link goes wherever the person chooses in the system share sheet, or
 * to the clipboard where the browser has no share sheet.
 */
export const SafetyStrip: React.FC<{ className?: string }> = ({ className = '' }) => {
  const [state, setState] = useState<ShareState>('idle');

  const shareLocation = () => {
    if (!('geolocation' in navigator)) {
      setState('error');
      return;
    }
    setState('locating');
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        const url = `https://www.google.com/maps?q=${coords.latitude.toFixed(6)},${coords.longitude.toFixed(6)}`;
        const text = `I need roadside help. My location: ${url}`;
        try {
          if (typeof navigator.share === 'function') {
            await navigator.share({ title: 'My location', text, url });
            setState('shared');
          } else {
            await navigator.clipboard.writeText(text);
            setState('copied');
          }
        } catch (err) {
          // Dismissing the share sheet rejects with AbortError: not a failure.
          setState((err as DOMException)?.name === 'AbortError' ? 'idle' : 'error');
        }
      },
      () => setState('error'),
      { enableHighAccuracy: true, timeout: 10_000 }
    );
  };

  const message: Record<ShareState, string> = {
    idle: '',
    locating: 'Finding your location…',
    shared: 'Location shared.',
    copied: 'Location copied. Paste it into a message.',
    error: 'Could not get your location. Check that location access is allowed.',
  };

  return (
    <div className={className}>
      <div className="grid grid-cols-2 gap-3">
        <a
          href={`tel:${EMERGENCY_NUMBER}`}
          className="inline-flex items-center justify-center gap-2 min-h-[52px] rounded-control border border-emergency-600 text-emergency-700 font-semibold hover:bg-emergency-50 transition-colors"
        >
          <Phone className="w-5 h-5" aria-hidden="true" />
          <span>Call {EMERGENCY_NUMBER}</span>
        </a>
        <button
          type="button"
          onClick={shareLocation}
          disabled={state === 'locating'}
          className="inline-flex items-center justify-center gap-2 min-h-[52px] rounded-control border border-line bg-white text-ink font-semibold hover:bg-slate-50 transition-colors disabled:opacity-60"
        >
          <Share2 className="w-5 h-5 text-brand-700" aria-hidden="true" />
          <span>Share location</span>
        </button>
      </div>
      <p role="status" aria-live="polite" className="mt-2 min-h-[1.25rem] text-sm text-ink-soft">
        {message[state]}
      </p>
    </div>
  );
};
