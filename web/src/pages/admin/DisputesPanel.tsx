import React, { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera, Flag } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { Modal } from '../../components/ui/Modal';
import { ApiError } from '../../services/api';
import { adminService, AdminDispute, DisputeReason, DisputeStatus } from '../../services/admin.service';
import { amountOf, inr, safeguardsService } from '../../services/safeguards.service';

// Support inbox for owner problem reports (ADR-027, ADR-043). Reading is open to
// every staff role; the server decides who may resolve and who may refund.

export const REASON_LABELS: Record<DisputeReason, string> = {
  overcharged: 'Overcharged',
  service_not_done: 'Job not done',
  partner_behaviour: 'Partner behaviour',
  damage: 'Damage to vehicle',
  off_app_payment: 'Asked to pay outside the app',
  other: 'Something else',
};

const STATUSES: { id: DisputeStatus; label: string }[] = [
  { id: 'open', label: 'Open' },
  { id: 'resolved', label: 'Resolved' },
  { id: 'refunded', label: 'Refunded' },
  { id: 'rejected', label: 'Rejected' },
];

const when = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—';
const errText = (e: unknown) => (e instanceof ApiError ? e.message : 'Something went wrong. Try again.');

export const DisputesPanel: React.FC = () => {
  const [status, setStatus] = useState<DisputeStatus>('open');
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<AdminDispute | null>(null);
  const list = useQuery({
    queryKey: ['admin', 'disputes', status, offset],
    queryFn: () => adminService.listDisputes(status, offset),
    placeholderData: keepPreviousData,
    refetchInterval: status === 'open' ? 30000 : false,
  });

  return (
    <section aria-label="Problem reports" className="space-y-3">
      <div role="group" aria-label="Report status" className="inline-flex flex-wrap gap-1 rounded-[12px] border border-[#EEF2F6] bg-white p-1">
        {STATUSES.map((s) => (
          <button
            key={s.id}
            type="button"
            aria-pressed={status === s.id}
            onClick={() => { setStatus(s.id); setOffset(0); }}
            className={`rounded-[8px] px-3 py-1.5 text-xs font-semibold ${status === s.id ? 'bg-[#111111] text-white' : 'text-[#475569] hover:bg-[#F6F8FA]'}`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {list.isError ? (
        <ErrorState message={errText(list.error)} onRetry={() => list.refetch()} />
      ) : list.isLoading ? (
        <p className="text-sm text-slate-500">Loading reports…</p>
      ) : !list.data?.items.length ? (
        <EmptyState icon={Flag} title={status === 'open' ? 'No open reports' : 'Nothing here'} description="Owners report problems from a finished or cancelled job." />
      ) : (
        <ul className="divide-y divide-[#EEF2F6] rounded-[12px] border border-[#EEF2F6] bg-white">
          {list.data.items.map((d) => (
            <li key={d.id}>
              <button
                type="button"
                onClick={() => setSelected(d)}
                className="w-full px-3 py-2.5 text-left hover:bg-[#F6F8FA] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#111111]"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className={`text-sm font-semibold ${d.reason === 'off_app_payment' ? 'text-[#991B1B]' : 'text-[#0F172A]'}`}>
                    {REASON_LABELS[d.reason] ?? d.reason}
                  </span>
                  <time className="text-xs text-slate-500" dateTime={d.created_at}>{when(d.created_at)}</time>
                </div>
                <div className="text-xs text-slate-500 font-mono">job {d.job_id.slice(0, 8)}</div>
                {d.description && <p className="mt-0.5 line-clamp-2 text-sm text-slate-700">{d.description}</p>}
              </button>
            </li>
          ))}
        </ul>
      )}

      {list.data && list.data.total > 50 && (
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>Previous</Button>
          <Button size="sm" variant="outline" disabled={offset + 50 >= list.data.total} onClick={() => setOffset(offset + 50)}>Next</Button>
        </div>
      )}

      {selected && <DisputeDialog dispute={selected} onClose={() => setSelected(null)} />}
    </section>
  );
};

const DisputeDialog: React.FC<{ dispute: AdminDispute; onClose: () => void }> = ({ dispute, onClose }) => {
  const qc = useQueryClient();
  const [note, setNote] = useState('');
  const evidence = useQuery({
    queryKey: ['admin', 'safeguards', dispute.job_id],
    queryFn: () => safeguardsService.get(dispute.job_id),
  });
  const resolve = useMutation({
    mutationFn: (resolution: 'resolved' | 'rejected' | 'refunded') => adminService.resolveDispute(dispute.id, resolution, note.trim()),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'disputes'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'alerts'] });
      onClose();
    },
  });
  const openPhoto = async (photoId: string) => {
    // Audited server-side (job_photo_viewed). The link lasts 60 seconds.
    const url = await safeguardsService.photoUrl(dispute.job_id, photoId);
    window.open(url, '_blank', 'noopener,noreferrer');
  };
  const isOpen = dispute.status === 'open';
  const ev = evidence.data;

  return (
    <Modal isOpen onClose={onClose} title={REASON_LABELS[dispute.reason] ?? dispute.reason} description={`Job ${dispute.job_id.slice(0, 8)} · reported ${when(dispute.created_at)}`} maxWidth="lg">
      <div className="space-y-4 text-sm">
        {dispute.description ? <p className="whitespace-pre-wrap text-slate-800">{dispute.description}</p> : <p className="text-slate-500">No description given.</p>}

        <div className="rounded-[12px] border border-[#EEF2F6] p-3 space-y-1.5">
          <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">Evidence</h3>
          {evidence.isError ? (
            <p className="text-slate-500">Could not load the job's price history and photos.</p>
          ) : !ev ? (
            <p className="text-slate-500">Loading…</p>
          ) : (
            <>
              <p>Estimate {inr(amountOf(ev.price_estimate))} · allowed without approval {inr(amountOf(ev.price_allowed_max))}</p>
              {ev.revisions.length > 0 ? (
                <ul className="list-disc pl-5">
                  {ev.revisions.map((r) => (
                    <li key={r.id}>
                      Asked {inr(amountOf(r.proposed_amount))}: <span className="italic">“{r.reason}”</span> · {r.status}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-slate-500">No price change was asked for.</p>
              )}
              {ev.photos.length > 0 ? (
                <div className="flex flex-wrap gap-2 pt-1">
                  {ev.photos.map((p) => (
                    <Button key={p.id} size="sm" variant="outline" onClick={() => void openPhoto(p.id)}>
                      <Camera className="mr-1 h-4 w-4" aria-hidden /> {p.stage === 'pickup' ? 'Before tow' : 'At drop'} · {when(p.uploaded_at)}
                    </Button>
                  ))}
                </div>
              ) : ev.photos_required ? (
                <p className="text-[#92400E]">Towing job with no photos on record.</p>
              ) : null}
            </>
          )}
        </div>

        {isOpen ? (
          <>
            <label className="block">
              <span className="text-xs font-semibold text-slate-600">Resolution note (the owner sees it)</span>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                maxLength={1000}
                className="mt-1 w-full rounded-[10px] border border-[#E2E8F0] p-2 text-sm"
              />
            </label>
            {resolve.isError && <p role="alert" className="text-sm text-red-700">{errText(resolve.error)}</p>}
            <div className="flex flex-wrap gap-2">
              <Button disabled={note.trim().length < 3} isLoading={resolve.isPending && resolve.variables === 'resolved'} onClick={() => resolve.mutate('resolved')}>Resolve</Button>
              <Button variant="outline" disabled={note.trim().length < 3} isLoading={resolve.isPending && resolve.variables === 'refunded'} onClick={() => resolve.mutate('refunded')}>Record refund</Button>
              <Button variant="ghost" disabled={note.trim().length < 3} isLoading={resolve.isPending && resolve.variables === 'rejected'} onClick={() => resolve.mutate('rejected')}>Reject</Button>
            </div>
            <p className="text-xs text-slate-500">A refund is recorded here and paid back outside the app (ADR-027). Only finance and super admin can record one.</p>
          </>
        ) : (
          <p className="text-slate-700"><span className="font-semibold">{dispute.status}</span> {dispute.resolved_at ? `on ${when(dispute.resolved_at)}` : ''}{dispute.resolution_note ? ` · ${dispute.resolution_note}` : ''}</p>
        )}
      </div>
    </Modal>
  );
};
