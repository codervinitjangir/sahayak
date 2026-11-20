import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera, Clock, Hourglass, ShieldCheck, Tag } from 'lucide-react';
import { Button } from './ui/Button';
import { ApiError } from '../services/api';
import { amountOf, inr, minutesUntil, safeguardsService } from '../services/safeguards.service';

// The 2026-11-21 job safeguards on the web (ADR-039, ADR-041, ADR-042).

const codeOf = (e: unknown) => (e instanceof ApiError ? e.code : undefined);

export function useSafeguards(jobId: string | undefined) {
  return useQuery({
    queryKey: ['safeguards', jobId],
    queryFn: () => safeguardsService.get(jobId!),
    enabled: Boolean(jobId),
    refetchInterval: 10000,
  });
}

/** Owner: approve a higher price, swap an overdue partner, and the impersonation warning. */
export const OwnerSafeguards: React.FC<{ jobId: string; onChanged?: () => void }> = ({ jobId, onChanged }) => {
  const qc = useQueryClient();
  const q = useSafeguards(jobId);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const d = q.data;
  const pending = d?.pending_revision;
  const waitMin = minutesUntil(d?.new_partner_available_at);

  const run = async (key: string, fn: () => Promise<unknown>, messages: Record<string, string>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
      onChanged?.();
    } catch (e) {
      setError(messages[codeOf(e) ?? ''] ?? 'Could not save. Check your connection and try again.');
    } finally {
      setBusy(null);
      void qc.invalidateQueries({ queryKey: ['safeguards', jobId] });
    }
  };

  return (
    <div className="space-y-3">
      {pending && (
        <div role="alert" className="rounded-control border border-[#FDE68A] bg-[#FFFBEB] px-4 py-3 space-y-2">
          <p className="flex items-center gap-2 font-semibold text-ink">
            <Tag className="h-5 w-5 text-[#B45309]" aria-hidden /> Your partner asks for a higher price
          </p>
          <p className="text-base text-ink">
            New price <strong>{inr(amountOf(pending.proposed_amount))}</strong> · estimate was {inr(amountOf(d?.price_estimate))}
          </p>
          <p className="text-base italic text-ink-soft">“{pending.reason}”</p>
          <p className="text-sm text-ink-soft">Nothing above the estimate can be charged unless you approve it here.</p>
          <div className="flex gap-2">
            <Button variant="outline" isLoading={busy === 'reject'} disabled={busy !== null}
              onClick={() => void run('reject', () => safeguardsService.decidePrice(jobId, pending.id, false), { PRICE_REVISION_CLOSED: 'This price change was already answered.' })}>
              Reject
            </Button>
            <Button isLoading={busy === 'approve'} disabled={busy !== null}
              onClick={() => void run('approve', () => safeguardsService.decidePrice(jobId, pending.id, true), { PRICE_REVISION_CLOSED: 'This price change was already answered.' })}>
              Approve
            </Button>
          </div>
        </div>
      )}

      {d?.can_request_new_partner ? (
        <div className="rounded-control border border-line bg-white px-4 py-3 space-y-2">
          <p className="flex items-center gap-2 font-semibold text-ink"><Clock className="h-5 w-5 text-red-700" aria-hidden /> Your partner is late</p>
          <p className="text-base text-ink-soft">Keep waiting, or ask for another partner. Your request stays open.</p>
          <Button variant="outline" isLoading={busy === 'swap'} disabled={busy !== null}
            onClick={() => {
              if (!window.confirm('Release your current partner and search again from the same place?')) return;
              void run('swap', () => safeguardsService.requestNewPartner(jobId), {
                PARTNER_NOT_OVERDUE: 'Your partner is still within their arrival time.',
                JOB_NOT_REASSIGNABLE: 'Work has already started on this job.',
              });
            }}>
            Find another partner
          </Button>
        </div>
      ) : waitMin != null && waitMin > 0 ? (
        <p className="text-sm text-ink-soft">Not here in {waitMin} min? You will be able to ask for another partner.</p>
      ) : null}

      {error && <p role="alert" className="text-sm font-semibold text-red-700">{error}</p>}

      <p className="flex items-start gap-2 rounded-control bg-[#F1F2F4] px-3 py-2 text-sm text-ink-soft">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-ink" aria-hidden />
        Only the partner shown here is from Sahayak. Say your start code face to face, never on a call. Pay only the price in the
        app, and report anyone who asks you to cancel and pay them directly.
      </p>
    </div>
  );
};

/** Partner: what can be charged, and asking the owner to approve more. */
export const PartnerPriceRequest: React.FC<{ jobId: string }> = ({ jobId }) => {
  const qc = useQueryClient();
  const q = useSafeguards(jobId);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const d = q.data;
  if (!d) return null;
  const max = amountOf(d.price_allowed_max);
  const pending = d.pending_revision;
  const last = d.revisions.length ? d.revisions[d.revisions.length - 1] : null;
  const towPhotos = (['pickup', 'drop'] as const).filter((s) => !d.photos.some((p) => p.stage === s));

  const ask = async () => {
    setError(null);
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) return setError('Enter the new total price.');
    if (reason.trim().length < 5) return setError('Tell the owner why, for example "new battery needed".');
    setBusy(true);
    try {
      await safeguardsService.proposePrice(jobId, Math.round(n), reason.trim());
      setAmount('');
      setReason('');
    } catch (e) {
      const c = codeOf(e);
      setError(
        c === 'PRICE_REVISION_NOT_NEEDED' ? 'That is within what you can charge already. Enter it below.'
          : c === 'PRICE_FINAL_OUT_OF_RANGE' ? 'That is above the most this job can be billed.'
            : c === 'PRICE_REVISION_PENDING' ? 'You already asked. Wait for the owner.'
              : 'Could not send. Try again.');
    } finally {
      setBusy(false);
      void qc.invalidateQueries({ queryKey: ['safeguards', jobId] });
    }
  };

  return (
    <div className="space-y-3">
      {d.photos_required && towPhotos.length > 0 && (
        <p role="status" className="flex items-start gap-2 rounded-xl border border-[#FDE68A] bg-[#FFFBEB] px-3 py-2 text-sm text-[#92400E]">
          <Camera className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          A tow needs a photo before towing and one at the drop point. Add them in the Sahayak partner app; the job cannot be completed without them.
        </p>
      )}
      <p className="text-sm text-slate-600">
        {max == null
          ? 'This job has no estimate: ask the owner to approve the price before completing.'
          : `You can charge up to ${inr(max)} without asking. Above that, ask the owner first.`}
      </p>
      {pending ? (
        <p className="flex items-center gap-2 text-sm font-semibold text-[#92400E]">
          <Hourglass className="h-4 w-4" aria-hidden /> Waiting for the owner to approve {inr(amountOf(pending.proposed_amount))}
        </p>
      ) : (
        <div className="space-y-2">
          {last?.status === 'rejected' && <p className="text-sm text-red-700">The owner did not approve {inr(amountOf(last.proposed_amount))}.</p>}
          {last?.status === 'approved' && <p className="text-sm text-green-700">Approved: {inr(amountOf(last.proposed_amount))}</p>}
          <label htmlFor="revision-amount" className="block text-xs font-bold uppercase tracking-wider text-slate-500">Need to charge more? New total (₹)</label>
          <input id="revision-amount" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))}
            className="w-full min-h-[48px] rounded-xl border border-slate-300 px-4 text-lg text-slate-900 focus:ring-2 focus:ring-slate-600 focus:outline-none" />
          <label htmlFor="revision-reason" className="sr-only">Reason</label>
          <input id="revision-reason" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder="Why? e.g. battery needs replacing"
            className="w-full min-h-[48px] rounded-xl border border-slate-300 px-4 text-base text-slate-900 focus:ring-2 focus:ring-slate-600 focus:outline-none" />
          <Button variant="outline" isLoading={busy} disabled={busy} onClick={() => void ask()}>Ask owner to approve</Button>
        </div>
      )}
      {error && <p role="alert" className="text-sm font-semibold text-red-700">{error}</p>}
    </div>
  );
};
