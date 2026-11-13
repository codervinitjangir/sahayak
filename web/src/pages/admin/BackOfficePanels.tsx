import React, { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, ClipboardList, Phone, RefreshCw, Search, UserCheck, Users } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { Modal } from '../../components/ui/Modal';
import { StatusPill } from '../../components/ui/StatusPill';
import { ApiError } from '../../services/api';
import { adminService, AdminJobItem, AdminUserItem } from '../../services/admin.service';

// Back office (ADR-024). Every write here is audited server-side in the same
// transaction as the change; these panels only display and request.

const PAGE = 50;

const when = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—';

const age = (iso: string) => {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  return mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)} h ${mins % 60} min`;
};

const errText = (e: unknown) => (e instanceof ApiError ? e.message : 'Something went wrong. Try again.');

const SearchBox: React.FC<{ value: string; onChange: (v: string) => void; placeholder: string }> = ({ value, onChange, placeholder }) => (
  <label className="relative flex-1 min-w-[200px]">
    <span className="sr-only">{placeholder}</span>
    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" aria-hidden="true" />
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full rounded-[10px] border border-[#EEF2F6] bg-white pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0F766E]/30"
    />
  </label>
);

const Pager: React.FC<{ total: number; offset: number; onOffset: (n: number) => void }> = ({ total, offset, onOffset }) =>
  total > PAGE ? (
    <div className="flex items-center justify-end gap-2 pt-3 text-xs text-slate-500">
      <span>
        {offset + 1}–{Math.min(offset + PAGE, total)} of {total}
      </span>
      <Button size="sm" variant="outline" disabled={offset === 0} onClick={() => onOffset(Math.max(0, offset - PAGE))}>
        Previous
      </Button>
      <Button size="sm" variant="outline" disabled={offset + PAGE >= total} onClick={() => onOffset(offset + PAGE)}>
        Next
      </Button>
    </div>
  ) : null;

const ReasonDialog: React.FC<{
  title: string;
  description: string;
  confirm: string;
  required?: boolean;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}> = ({ title, description, confirm, required = true, busy, error, onClose, onConfirm }) => {
  const [reason, setReason] = useState('');
  const ok = !required || reason.trim().length >= 3;
  return (
    <Modal isOpen onClose={onClose} title={title} description={description} maxWidth="md">
      <label htmlFor="bo-reason" className="text-xs font-bold uppercase tracking-wider text-slate-500">
        Reason {required ? '(required, recorded in the audit log)' : '(optional)'}
      </label>
      <textarea
        id="bo-reason"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={3}
        maxLength={500}
        className="mt-1 w-full rounded-[10px] border border-[#EEF2F6] p-2 text-sm"
      />
      {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>Back</Button>
        <Button variant="danger" disabled={!ok || busy} isLoading={busy} onClick={() => onConfirm(reason.trim())}>
          {confirm}
        </Button>
      </div>
    </Modal>
  );
};

// ---------------------------------------------------------------------------

const JOB_FILTERS = [
  { id: 'live', label: 'Live' },
  { id: 'no_match_found', label: 'No partner' },
  { id: 'all', label: 'All' },
] as const;

export const JobsBoardPanel: React.FC = () => {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<string>('live');
  const [q, setQ] = useState('');
  const [offset, setOffset] = useState(0);
  const [cancelling, setCancelling] = useState<AdminJobItem | null>(null);

  const board = useQuery({
    queryKey: ['admin', 'jobs', filter, q, offset],
    queryFn: () => adminService.listJobs({ status: filter, q: q.trim() || undefined, limit: PAGE, offset }),
    refetchInterval: 15000,
    placeholderData: keepPreviousData,
  });
  const cancel = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => adminService.cancelJob(id, reason),
    onSuccess: () => {
      setCancelling(null);
      void qc.invalidateQueries({ queryKey: ['admin', 'jobs'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'audit'] });
    },
  });

  const finished = (s: string) => s === 'completed' || s === 'cancelled';

  return (
    <section aria-label="Live jobs board" className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Job filter" className="flex gap-1 rounded-[12px] border border-[#EEF2F6] bg-white p-1">
          {JOB_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={filter === f.id}
              onClick={() => { setFilter(f.id); setOffset(0); }}
              className={`rounded-[8px] px-3 py-1.5 text-xs font-semibold ${filter === f.id ? 'bg-[#0F766E] text-white' : 'text-[#475569] hover:bg-[#F6F8FA]'}`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <SearchBox value={q} onChange={(v) => { setQ(v); setOffset(0); }} placeholder="Search owner, phone, plate or address" />
        <Button size="sm" variant="outline" onClick={() => board.refetch()} disabled={board.isFetching}>
          <RefreshCw className={`h-3.5 w-3.5 ${board.isFetching ? 'animate-spin' : ''}`} aria-hidden="true" /> Refresh
        </Button>
      </div>

      {board.isError ? (
        <ErrorState message={errText(board.error)} onRetry={() => board.refetch()} />
      ) : board.isLoading ? (
        <p className="text-sm text-slate-500">Loading jobs…</p>
      ) : !board.data?.items.length ? (
        <EmptyState icon={ClipboardList} title="Nothing here" description="No jobs match this filter right now." />
      ) : (
        <div className="overflow-x-auto rounded-[12px] border border-[#EEF2F6] bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-[#F6F8FA] text-left text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Raised</th>
                <th className="px-3 py-2">Service</th>
                <th className="px-3 py-2">Owner</th>
                <th className="px-3 py-2">Partner</th>
                <th className="px-3 py-2">Pickup</th>
                <th className="px-3 py-2"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {board.data.items.map((j) => (
                <tr key={j.id} className="border-t border-[#EEF2F6] align-top">
                  <td className="px-3 py-2"><StatusPill status={j.status} size="sm" /></td>
                  <td className="px-3 py-2 whitespace-nowrap" title={when(j.requested_at)}>{age(j.requested_at)} ago</td>
                  <td className="px-3 py-2">
                    {j.service_name ?? '—'}
                    {j.vehicle_number && <div className="font-mono text-xs text-slate-500">{j.vehicle_number}</div>}
                  </td>
                  <td className="px-3 py-2">
                    {j.owner_name ?? '—'}
                    {j.owner_phone && (
                      <a href={`tel:${j.owner_phone}`} className="flex items-center gap-1 text-xs text-[#0F766E]">
                        <Phone className="h-3 w-3" aria-hidden="true" />{j.owner_phone}
                      </a>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {j.partner_name ?? <span className="text-slate-400">None yet</span>}
                    {j.assignment_status && <div className="text-xs text-slate-500">{j.assignment_status}</div>}
                    {j.partner_phone && (
                      <a href={`tel:${j.partner_phone}`} className="flex items-center gap-1 text-xs text-[#0F766E]">
                        <Phone className="h-3 w-3" aria-hidden="true" />{j.partner_phone}
                      </a>
                    )}
                  </td>
                  <td className="px-3 py-2 max-w-[220px] text-xs text-slate-600">{j.pickup_address_text ?? '—'}</td>
                  <td className="px-3 py-2 text-right">
                    {!finished(j.status) && (
                      <Button size="sm" variant="outline" onClick={() => { cancel.reset(); setCancelling(j); }}>
                        <Ban className="h-3.5 w-3.5" aria-hidden="true" /> Cancel
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {board.data && <Pager total={board.data.total} offset={offset} onOffset={setOffset} />}

      {cancelling && (
        <ReasonDialog
          title="Cancel this job?"
          description={`The owner${cancelling.partner_name ? ' and the partner' : ''} will be told Sahayak support cancelled it.`}
          confirm="Cancel job"
          busy={cancel.isPending}
          error={cancel.isError ? errText(cancel.error) : null}
          onClose={() => setCancelling(null)}
          onConfirm={(reason) => cancel.mutate({ id: cancelling.id, reason })}
        />
      )}
    </section>
  );
};

// ---------------------------------------------------------------------------

export const OwnersPanel: React.FC = () => {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [offset, setOffset] = useState(0);
  const [target, setTarget] = useState<AdminUserItem | null>(null);

  const users = useQuery({
    queryKey: ['admin', 'users', q, offset],
    queryFn: () => adminService.listUsers({ q: q.trim() || undefined, limit: PAGE, offset }),
    placeholderData: keepPreviousData,
  });
  const suspend = useMutation({
    mutationFn: ({ id, suspended, reason }: { id: string; suspended: boolean; reason?: string }) =>
      adminService.setUserSuspension(id, suspended, reason),
    onSuccess: () => {
      setTarget(null);
      void qc.invalidateQueries({ queryKey: ['admin', 'users'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'audit'] });
    },
  });

  return (
    <section aria-label="Vehicle owners" className="space-y-3">
      <SearchBox value={q} onChange={(v) => { setQ(v); setOffset(0); }} placeholder="Search name, phone or email" />
      {users.isError ? (
        <ErrorState message={errText(users.error)} onRetry={() => users.refetch()} />
      ) : users.isLoading ? (
        <p className="text-sm text-slate-500">Loading owners…</p>
      ) : !users.data?.items.length ? (
        <EmptyState icon={Users} title="No owners found" description="Try a different search." />
      ) : (
        <div className="overflow-x-auto rounded-[12px] border border-[#EEF2F6] bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-[#F6F8FA] text-left text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-3 py-2">Owner</th>
                <th className="px-3 py-2">Joined</th>
                <th className="px-3 py-2">Jobs</th>
                <th className="px-3 py-2">Account</th>
                <th className="px-3 py-2"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {users.data.items.map((u) => (
                <tr key={u.id} className="border-t border-[#EEF2F6] align-top">
                  <td className="px-3 py-2">
                    {u.name}
                    <div className="text-xs text-slate-500">{u.phone}{u.email ? ` · ${u.email}` : ''}</div>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{when(u.created_at)}</td>
                  <td className="px-3 py-2">{u.job_count}</td>
                  <td className="px-3 py-2">
                    {u.suspended_at ? (
                      <span className="text-red-700 font-semibold">Suspended</span>
                    ) : (
                      <span className="text-emerald-700">{u.has_login ? 'Active' : 'No login yet'}</span>
                    )}
                    {u.suspension_reason && <div className="text-xs text-slate-500">{u.suspension_reason}</div>}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {u.suspended_at ? (
                      <Button size="sm" variant="outline" isLoading={suspend.isPending && suspend.variables?.id === u.id}
                        onClick={() => suspend.mutate({ id: u.id, suspended: false })}>
                        <UserCheck className="h-3.5 w-3.5" aria-hidden="true" /> Reinstate
                      </Button>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => { suspend.reset(); setTarget(u); }}>
                        <Ban className="h-3.5 w-3.5" aria-hidden="true" /> Suspend
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {users.data && <Pager total={users.data.total} offset={offset} onOffset={setOffset} />}

      {target && (
        <ReasonDialog
          title={`Suspend ${target.name}?`}
          description="They will be signed out of every request until reinstated."
          confirm="Suspend account"
          busy={suspend.isPending}
          error={suspend.isError ? errText(suspend.error) : null}
          onClose={() => setTarget(null)}
          onConfirm={(reason) => suspend.mutate({ id: target.id, suspended: true, reason })}
        />
      )}
    </section>
  );
};

// ---------------------------------------------------------------------------

const ACTION_LABELS: Record<string, string> = {
  job_cancelled: 'Cancelled a job',
  user_suspended: 'Suspended an owner',
  user_reinstated: 'Reinstated an owner',
  partner_verified: 'Verified a partner',
  partner_rejected: 'Rejected a partner',
  partner_suspended: 'Suspended a partner',
  partner_pending: 'Moved a partner back to pending',
};

export const AuditPanel: React.FC = () => {
  const [type, setType] = useState<string>('');
  const [offset, setOffset] = useState(0);
  const audit = useQuery({
    queryKey: ['admin', 'audit', type, offset],
    queryFn: () => adminService.listAudit({ target_type: type || undefined, limit: PAGE, offset }),
    placeholderData: keepPreviousData,
  });

  return (
    <section aria-label="Audit log" className="space-y-3">
      <div role="group" aria-label="Audit filter" className="inline-flex gap-1 rounded-[12px] border border-[#EEF2F6] bg-white p-1">
        {[['', 'All'], ['job', 'Jobs'], ['user', 'Owners'], ['partner', 'Partners']].map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-pressed={type === id}
            onClick={() => { setType(id); setOffset(0); }}
            className={`rounded-[8px] px-3 py-1.5 text-xs font-semibold ${type === id ? 'bg-[#0F766E] text-white' : 'text-[#475569] hover:bg-[#F6F8FA]'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {audit.isError ? (
        <ErrorState message={errText(audit.error)} onRetry={() => audit.refetch()} />
      ) : audit.isLoading ? (
        <p className="text-sm text-slate-500">Loading audit log…</p>
      ) : !audit.data?.items.length ? (
        <EmptyState icon={ClipboardList} title="No staff actions yet" description="Every cancel, suspension and verification appears here." />
      ) : (
        <ol className="divide-y divide-[#EEF2F6] rounded-[12px] border border-[#EEF2F6] bg-white">
          {audit.data.items.map((a) => (
            <li key={a.id} className="px-3 py-2 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-semibold text-[#0F172A]">{ACTION_LABELS[a.action] ?? a.action}</span>
                <time className="text-xs text-slate-500" dateTime={a.created_at}>{when(a.created_at)}</time>
              </div>
              <div className="text-xs text-slate-500 font-mono">{a.target_type} {a.target_id.slice(0, 8)}</div>
              {a.reason && <p className="mt-0.5 text-slate-700">{a.reason}</p>}
            </li>
          ))}
        </ol>
      )}
      {audit.data && <Pager total={audit.data.total} offset={offset} onOffset={setOffset} />}
    </section>
  );
};
