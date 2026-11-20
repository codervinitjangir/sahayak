import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Flag } from 'lucide-react';
import { Button } from './ui/Button';
import { ApiError } from '../services/api';
import {
  CANCELLED_JOB_REASONS,
  DISPUTE_REASONS,
  DISPUTE_STATUS_LABEL,
  disputesService,
  type DisputeReason,
} from '../services/disputes.service';

const ERRORS: Record<string, string> = {
  JOB_NOT_DISPUTABLE: 'This job cannot be reported. Only completed jobs, or cancelled jobs a partner had accepted, can.',
  DISPUTE_ALREADY_OPEN: 'You already have an open report for this job. Our team will get back to you.',
};

/**
 * Owner "Report a problem" on web, the twin of mobile's ReportProblemScreen.
 * Shown on a completed job, or a cancelled one a partner had accepted (ADR-043);
 * the backend decides, so a 409 is explained rather than hidden.
 */
export const ReportProblem: React.FC<{ jobId: string; cancelled?: boolean }> = ({ jobId, cancelled = false }) => {
  const qc = useQueryClient();
  const reasons = cancelled ? DISPUTE_REASONS.filter((r) => CANCELLED_JOB_REASONS.includes(r.value)) : DISPUTE_REASONS;
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<DisputeReason | ''>('');
  const [description, setDescription] = useState('');

  const reports = useQuery({ queryKey: ['disputes', jobId], queryFn: () => disputesService.list(jobId) });
  const send = useMutation({
    mutationFn: () => disputesService.open(jobId, reason as DisputeReason, description),
    onSuccess: () => {
      setOpen(false);
      setReason('');
      setDescription('');
      void qc.invalidateQueries({ queryKey: ['disputes', jobId] });
    },
  });
  const error = send.error instanceof ApiError
    ? ERRORS[send.error.code] ?? 'Could not send your report. Try again.'
    : send.isError ? 'Could not send your report. Try again.' : null;
  const hasOpen = (reports.data ?? []).some((d) => d.status === 'open');

  return (
    <section aria-labelledby={`report-${jobId}`} className="pt-4 border-t border-line space-y-3">
      <h3 id={`report-${jobId}`} className="text-sm font-bold text-ink flex items-center gap-1.5">
        <Flag className="w-4 h-4" aria-hidden="true" /> Problem with this job?
      </h3>

      {(reports.data ?? []).map((d) => (
        <div key={d.id} className="rounded-control border border-line p-3 text-sm">
          <p className="font-semibold text-ink">{DISPUTE_REASONS.find((r) => r.value === d.reason)?.label ?? d.reason}</p>
          <p className="text-ink-soft">{DISPUTE_STATUS_LABEL[d.status]}</p>
          {d.resolution_note && <p className="mt-1 text-ink-soft">Our team: {d.resolution_note}</p>}
        </div>
      ))}

      {!open && !hasOpen && (
        <Button size="sm" variant="outline" onClick={() => { send.reset(); setOpen(true); }}>
          Report a problem
        </Button>
      )}

      {open && (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (reason) send.mutate();
          }}
        >
          <fieldset>
            <legend className="text-sm font-semibold text-ink-soft">What went wrong?</legend>
            <div className="mt-2 grid gap-2">
              {reasons.map((r) => (
                <label key={r.value} className="flex items-center gap-2 text-sm text-ink">
                  <input type="radio" name={`reason-${jobId}`} value={r.value} checked={reason === r.value}
                    onChange={() => setReason(r.value)} />
                  {r.label}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="block text-sm font-semibold text-ink-soft" htmlFor={`report-text-${jobId}`}>
            Tell us more (optional)
          </label>
          <textarea id={`report-text-${jobId}`} value={description} onChange={(e) => setDescription(e.target.value)}
            maxLength={1000} rows={3} className="w-full rounded-control border border-line px-3 py-2 text-sm" />
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          <div className="flex gap-2 justify-end">
            <Button type="button" size="sm" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" size="sm" disabled={!reason} isLoading={send.isPending}>Send report</Button>
          </div>
        </form>
      )}
    </section>
  );
};
