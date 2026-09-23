import { useEffect, useRef, useState } from 'react';
import type { VerificationEvent } from '../../types/partner';
import {
  dismissVerificationEvent,
  usePartnerStore,
  type PartnerAnnouncement,
} from './partnerStore';

/**
 * Verification status changes, newest first.
 *
 * Feeds the dashboard Inbox. Same array the toast hook below reads its headline
 * from, so the two can never describe the same change differently.
 */
export function useVerificationEvents(): {
  events: VerificationEvent[];
  dismiss: (id: string) => void;
} {
  const events = usePartnerStore((s) => s.verificationEvents);
  return { events, dismiss: dismissVerificationEvent };
}

/**
 * The transient toast side of the same event source.
 *
 * Only surfaces announcements raised *after* this hook mounted — arriving on
 * VerificationStatus should not replay the change that happened on the
 * dashboard ten minutes ago.
 */
export function useAnnouncementToast(autoDismissMs = 4500): {
  toast: PartnerAnnouncement | null;
  dismiss: () => void;
} {
  const announcement = usePartnerStore((s) => s.announcement);
  const baselineRef = useRef<number | null>(null);
  if (baselineRef.current === null) baselineRef.current = announcement?.seq ?? 0;

  const [dismissedSeq, setDismissedSeq] = useState(0);

  const toast =
    announcement && announcement.seq > baselineRef.current && announcement.seq > dismissedSeq
      ? announcement
      : null;

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setDismissedSeq(toast.seq), autoDismissMs);
    return () => clearTimeout(timer);
  }, [toast, autoDismissMs]);

  return {
    toast,
    dismiss: () => {
      if (toast) setDismissedSeq(toast.seq);
    },
  };
}
