import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { usersService } from '../services/users.service';
import { calloutsLine, careDate } from '../features/care/care';
import { useTranslation } from '../i18n';

/** Sahayak Care (ADR-051). Shown only to a member: nothing is on sale yet. */
export const CareCard: React.FC = () => {
  const { t } = useTranslation();
  const care = useQuery({ queryKey: ['owner', 'care'], queryFn: () => usersService.getMyCare() });
  const m = care.data?.membership;
  if (!m) return null;
  return (
    <section aria-label={m.plan_name} className="rounded-card border border-emerald-200 bg-emerald-50 p-4 space-y-1">
      <p className="flex items-center gap-2 font-bold text-ink">
        <ShieldCheck className="h-5 w-5 text-emerald-700" aria-hidden="true" /> {m.plan_name}
      </p>
      <p className="text-sm text-ink">{t('care.coveredUntil', { date: careDate(m.ends_at) })}</p>
      <p className="text-sm font-semibold text-emerald-900">{calloutsLine(m)}</p>
      <p className="text-xs text-ink-soft">{care.data?.pricing_note}</p>
    </section>
  );
};

/** One line on a job that used a call-out. */
export const CoveredBadge: React.FC = () => {
  const { t } = useTranslation();
  return (
    <p className="flex items-center gap-1.5 text-sm font-semibold text-emerald-800">
      <ShieldCheck className="h-4 w-4" aria-hidden="true" /> {t('care.coveredJob')}
    </p>
  );
};
