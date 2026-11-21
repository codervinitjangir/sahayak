// Scheduled jobs (ADR-050): the slot picker used when booking, and the card a
// 'scheduled' job shows on its page (move or cancel while it is still waiting).
import React, { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock } from 'lucide-react';

import { jobsService } from '../services/jobs.service';
import { ApiError } from '../services/api';
import { Button } from './ui/Button';
import { groupByDay, slotLabel, timeLabel, type ScheduleSlot } from '../features/jobs/schedule';
import { bookingError, useTranslation } from '../i18n';

export const SlotPicker: React.FC<{ value: string | null; onChange: (slot: ScheduleSlot | null) => void }> = ({
  value,
  onChange,
}) => {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['schedule-slots'], queryFn: () => jobsService.getScheduleSlots(), staleTime: 60_000 });
  const days = useMemo(() => groupByDay(q.data?.slots ?? []), [q.data]);
  const [day, setDay] = useState<string | null>(null);
  const current = days.find((d) => d.day === day) ?? days[0];

  if (q.isLoading) return <p className="text-sm text-ink-soft">{t('booking.loading')}</p>;
  if (q.isError)
    return (
      <p role="alert" className="text-sm text-red-700">
        {t('booking.slotsFailed')}{' '}
        <button type="button" className="underline font-semibold" onClick={() => void q.refetch()}>
          {t('booking.tryAgain')}
        </button>
      </p>
    );
  if (!days.length) return <p className="text-sm text-ink-soft">{t('booking.noneNow')}</p>;

  return (
    <div className="space-y-3">
      <div role="radiogroup" aria-label={t('booking.day')} className="flex flex-wrap gap-2">
        {days.map((d) => (
          <button
            key={d.day}
            type="button"
            role="radio"
            aria-checked={current?.day === d.day}
            onClick={() => {
              setDay(d.day);
              onChange(null);
            }}
            className={`min-h-[44px] px-3 rounded-control border text-sm font-semibold ${
              current?.day === d.day ? 'bg-ink text-white border-ink' : 'bg-white border-line'
            }`}
          >
            {d.day}
          </button>
        ))}
      </div>
      <div role="radiogroup" aria-label={t('booking.time')} className="flex flex-wrap gap-2">
        {current?.slots.map((s) => (
          <button
            key={s.start}
            type="button"
            role="radio"
            aria-checked={value === s.start}
            onClick={() => onChange(s)}
            className={`min-h-[44px] px-3 rounded-control border text-sm font-semibold ${
              value === s.start ? 'bg-brand-700 text-white border-brand-700' : 'bg-white border-line'
            }`}
          >
            {timeLabel(s.start)}-{timeLabel(s.end)}
          </button>
        ))}
      </div>
      {q.data ? (
        <p className="text-xs text-ink-soft">{t('booking.leadNote', { min: q.data.release_lead_min })}</p>
      ) : null}
    </div>
  );
};

export const BookingCard: React.FC<{
  jobId: string;
  scheduledFor?: string | null;
  slotEnd?: string | null;
  onCancel: () => void;
}> = ({ jobId, scheduledFor, slotEnd, onCancel }) => {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [moving, setMoving] = useState(false);
  const [slot, setSlot] = useState<ScheduleSlot | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const move = async () => {
    if (!slot) return;
    setBusy(true);
    setErr(null);
    try {
      await jobsService.reschedule(jobId, slot.start);
      await qc.invalidateQueries({ queryKey: ['jobs', jobId] });
      await qc.invalidateQueries({ queryKey: ['jobs'] });
      setMoving(false);
      setSlot(null);
    } catch (e) {
      setErr((e instanceof ApiError && bookingError(e.code)) || t('booking.moveFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label={t('booking.bookedFor', { slot: slotLabel(scheduledFor, slotEnd) })} className="space-y-3">
      <div className="flex items-start gap-3">
        <CalendarClock className="w-5 h-5 text-brand-700 mt-0.5" aria-hidden="true" />
        <div>
          <p className="text-sm font-semibold text-ink">{t('booking.bookedFor', { slot: slotLabel(scheduledFor, slotEnd) })}</p>
          <p className="text-sm text-ink-soft">{t('booking.waitingNote')}</p>
        </div>
      </div>
      {moving ? (
        <div className="space-y-3">
          <SlotPicker value={slot?.start ?? null} onChange={setSlot} />
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="primary" onClick={move} isLoading={busy} disabled={!slot}>
              {t('booking.move')}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setMoving(false)} disabled={busy}>
              {t('booking.keep')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={() => setMoving(true)}>
            {t('booking.moveOther')}
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel}>
            {t('booking.cancel')}
          </Button>
        </div>
      )}
      {err ? (
        <p role="alert" className="text-sm text-red-700">
          {err}
        </p>
      ) : null}
    </section>
  );
};
