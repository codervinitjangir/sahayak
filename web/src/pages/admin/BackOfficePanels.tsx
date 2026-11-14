import React, { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, ClipboardList, Phone, RefreshCw, Search, UserCheck, Users } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { Modal } from '../../components/ui/Modal';
import { StatusPill } from '../../components/ui/StatusPill';
import { ApiError } from '../../services/api';
import { adminService, AdminCatalogueItem, AdminJobItem, AdminUserItem, StaffMember, StaffRole } from '../../services/admin.service';

// Back office (ADR-024). Every write here is audited server-side in the same
// transaction as the change; these panels only display and request.

const PAGE = 50;

const when = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—';

const age = (iso: string) => {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins} min`;
  if (mins < 24 * 60) return `${Math.floor(mins / 60)} h ${mins % 60} min`;
  const days = Math.floor(mins / (24 * 60));
  return `${days} day${days === 1 ? '' : 's'}`;
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

/**
 * What needs a human now. Sits above the board because the board answers "which
 * jobs exist" and this answers "which of them is in trouble". The figures line
 * is always shown, so no alerts reads as "checked and fine".
 */
export const AlertsStrip: React.FC = () => {
  const alerts = useQuery({
    queryKey: ['admin', 'alerts'],
    queryFn: () => adminService.getAlerts(),
    refetchInterval: 30000,
  });
  // A failed alerts read must not hide the board; it says so in one line instead.
  if (alerts.isError) {
    return (
      <p role="status" className="text-xs text-[#92400E]">
        Alerts could not be loaded. The board below is still current.
      </p>
    );
  }
  if (!alerts.data) return null;
  const d = alerts.data;
  return (
    <div aria-label="Operational alerts" className="space-y-2">
      {d.alerts.map((a) => (
        <div
          key={a.code}
          role="alert"
          className={`rounded-[12px] border px-3.5 py-2.5 text-sm font-medium ${
            a.severity === 'critical'
              ? 'border-[#FECACA] bg-[#FEF2F2] text-[#991B1B]'
              : 'border-[#FDE68A] bg-[#FFFBEB] text-[#92400E]'
          }`}
        >
          {a.message}
          {a.job_ids.length > 0 && (
            <span className="block mt-0.5 text-xs font-normal break-words">
              Requests: {a.job_ids.map((id) => id.slice(0, 8)).join(', ')}
            </span>
          )}
        </div>
      ))}
      <p className="text-xs text-[#475569]">
        {d.alerts.length === 0 ? 'No alerts. ' : ''}
        {d.live_jobs} live {d.live_jobs === 1 ? 'job' : 'jobs'} · {d.partners_on_duty} of {d.partners_verified} verified
        partners on duty ·{' '}
        {d.no_match_rate === null
          ? `too few requests in the last ${d.window_minutes} min to state a no-match rate`
          : `${Math.round(d.no_match_rate * 100)}% no-match in the last ${d.window_minutes} min`}
      </p>
    </div>
  );
};

export const JobsBoardPanel: React.FC = () => {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<string>('live');
  const [q, setQ] = useState('');
  const [offset, setOffset] = useState(0);
  const [cancelling, setCancelling] = useState<AdminJobItem | null>(null);
  const [reassigning, setReassigning] = useState<AdminJobItem | null>(null);
  const [reassignNote, setReassignNote] = useState<string | null>(null);

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

  const reassign = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => adminService.reassignJob(id, reason),
    onSuccess: (job) => {
      setReassigning(null);
      setReassignNote(
        job.status === 'no_match_found'
          ? 'The partner was released, but no other partner is available. Call the owner.'
          : 'The partner was released and the job has been offered to the next-best partner.'
      );
      void qc.invalidateQueries({ queryKey: ['admin', 'jobs'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'alerts'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'audit'] });
    },
  });

  const finished = (s: string) => s === 'completed' || s === 'cancelled';
  // A partner holds the job or an unanswered offer, and work has not started (ADR-030).
  const reassignable = (j: AdminJobItem) =>
    ['matching', 'assigned', 'partner_en_route'].includes(j.status) &&
    (j.assignment_status === 'offered' || j.assignment_status === 'accepted');

  return (
    <section aria-label="Live jobs board" className="space-y-3">
      <AlertsStrip />
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
                    {reassignable(j) && (
                      <Button size="sm" variant="outline" className="mr-1.5" onClick={() => { reassign.reset(); setReassignNote(null); setReassigning(j); }}>
                        <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Reassign
                      </Button>
                    )}
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

      {reassignNote && <p role="status" className="text-sm font-medium text-[#0F766E]">{reassignNote}</p>}

      {reassigning && (
        <ReasonDialog
          title="Reassign this job?"
          description={`${reassigning.partner_name ?? 'The current partner'} will be told support moved the job, and it will be offered to the next-best partner. They will not be offered it again.`}
          confirm="Reassign job"
          busy={reassign.isPending}
          error={reassign.isError ? errText(reassign.error) : null}
          onClose={() => setReassigning(null)}
          onConfirm={(reason) => reassign.mutate({ id: reassigning.id, reason })}
        />
      )}

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
              <div className="text-xs text-slate-500 font-mono">{a.target_type} {a.target_id ? a.target_id.slice(0, 8) : String(a.details?.service_code ?? '')}</div>
              {a.reason && <p className="mt-0.5 text-slate-700">{a.reason}</p>}
            </li>
          ))}
        </ol>
      )}
      {audit.data && <Pager total={audit.data.total} offset={offset} onOffset={setOffset} />}
    </section>
  );
};

// ---------------------------------------------------------------------------
// Catalogue pricing (ADR-028)

const PRICE_MAX = 50000;

const PriceDialog: React.FC<{
  item: AdminCatalogueItem;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (price: string, reason: string) => void;
}> = ({ item, busy, error, onClose, onConfirm }) => {
  const [price, setPrice] = useState(item.base_price != null ? String(Number(item.base_price)) : '');
  const [reason, setReason] = useState('');
  const amount = Number(price);
  const priceOk = /^\d+(\.\d{1,2})?$/.test(price) && amount > 0 && amount <= PRICE_MAX;
  const changed = item.base_price == null || amount !== Number(item.base_price);
  const ok = priceOk && changed && reason.trim().length >= 3;
  return (
    <Modal
      isOpen
      onClose={onClose}
      title={`Change the price of ${item.name}`}
      description="Applies to requests made after you save. Requests already made keep the estimate the owner was shown."
      maxWidth="md"
    >
      <label htmlFor="price-amount" className="text-xs font-bold uppercase tracking-wider text-slate-500">
        Base price (₹)
      </label>
      <input
        id="price-amount"
        inputMode="decimal"
        value={price}
        onChange={(e) => setPrice(e.target.value.trim())}
        className="mt-1 w-full min-h-[44px] rounded-[10px] border border-[#EEF2F6] px-3 text-sm tnum"
      />
      {price !== '' && !priceOk && (
        <p className="mt-1 text-xs text-red-700">Enter an amount from 1 to {PRICE_MAX}, with at most two decimals.</p>
      )}
      <label htmlFor="price-reason" className="mt-3 block text-xs font-bold uppercase tracking-wider text-slate-500">
        Reason (required, recorded in the audit log)
      </label>
      <textarea
        id="price-reason"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={3}
        maxLength={500}
        className="mt-1 w-full rounded-[10px] border border-[#EEF2F6] p-2 text-sm"
      />
      {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>Back</Button>
        <Button disabled={!ok || busy} isLoading={busy} onClick={() => onConfirm(price, reason.trim())}>
          Save price
        </Button>
      </div>
    </Modal>
  );
};

export const CataloguePanel: React.FC = () => {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<AdminCatalogueItem | null>(null);
  const catalogue = useQuery({ queryKey: ['admin', 'catalogue'], queryFn: () => adminService.listCatalogue() });
  const save = useMutation({
    mutationFn: ({ code, price, reason }: { code: string; price: string; reason: string }) =>
      adminService.setServicePrice(code, price, reason),
    onSuccess: () => {
      setEditing(null);
      void qc.invalidateQueries({ queryKey: ['admin', 'catalogue'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'audit'] });
      void qc.invalidateQueries({ queryKey: ['services'] });
    },
  });

  if (catalogue.isError) return <ErrorState message={errText(catalogue.error)} onRetry={() => catalogue.refetch()} />;
  if (catalogue.isLoading) return <p className="text-sm text-slate-500">Loading the catalogue…</p>;
  const items = catalogue.data ?? [];
  if (items.length === 0) {
    return <EmptyState icon={ClipboardList} title="No services" description="The catalogue is empty." />;
  }

  return (
    <section aria-label="Service catalogue" className="space-y-3">
      <ul className="divide-y divide-[#EEF2F6] rounded-[14px] border border-[#EEF2F6] bg-white">
        {items.map((item) => (
          <li key={item.code} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <div className="font-semibold text-[#0F172A]">{item.name}</div>
              <div className="text-xs text-slate-500 font-mono break-all">
                {item.code}{item.category_name ? ` · ${item.category_name}` : ''}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm font-bold tnum text-[#0F172A]">
                {item.base_price != null ? `₹${Number(item.base_price)}` : 'No price set'}
              </span>
              <Button size="sm" variant="outline" onClick={() => { save.reset(); setEditing(item); }} aria-label={`Change price of ${item.name}`}>
                Change
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <p className="text-xs text-[#475569]">
        Service names and codes are fixed: the apps and partner coverage refer to them. Only the base price can be changed here.
      </p>
      {editing && (
        <PriceDialog
          item={editing}
          busy={save.isPending}
          error={save.isError ? errText(save.error) : null}
          onClose={() => setEditing(null)}
          onConfirm={(price, reason) => save.mutate({ code: editing.code, price, reason })}
        />
      )}
    </section>
  );
};

// ---------------------------------------------------------------------------
// Staff accounts and invites (ADR-029)

const ROLE_LABEL: Record<string, string> = {
  super_admin: 'Super admin',
  ops: 'Operations',
  support: 'Support',
  finance: 'Finance',
};
const ROLE_CAN: Record<string, string> = {
  super_admin: 'Everything, including staff accounts.',
  ops: 'Cancel jobs, verify partners, suspend owners, resolve disputes.',
  support: 'Cancel jobs and resolve disputes. No refunds, verification or suspension.',
  finance: 'Change prices, record refunds, resolve disputes.',
};
const ROLES: StaffRole[] = ['ops', 'support', 'finance', 'super_admin'];

export const StaffPanel: React.FC = () => {
  const qc = useQueryClient();
  const staff = useQuery({ queryKey: ['admin', 'staff'], queryFn: () => adminService.listStaff() });
  const [form, setForm] = useState({ name: '', phone: '', role: 'support' as StaffRole });
  const [issued, setIssued] = useState<{ token: string; name: string; phone: string } | null>(null);
  const [changing, setChanging] = useState<{ member: StaffMember; body: { role?: StaffRole; disabled?: boolean }; title: string } | null>(null);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['admin', 'staff'] });
    void qc.invalidateQueries({ queryKey: ['admin', 'audit'] });
  };
  const invite = useMutation({
    mutationFn: () => adminService.inviteStaff({ name: form.name.trim(), phone: `+91${form.phone}`, role: form.role }),
    onSuccess: (created) => {
      setIssued({ token: created.token, name: created.name, phone: created.phone });
      setForm({ name: '', phone: '', role: 'support' });
      refresh();
    },
  });
  const revoke = useMutation({ mutationFn: (id: string) => adminService.revokeInvite(id), onSuccess: refresh });
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: { role?: StaffRole; disabled?: boolean; reason: string } }) =>
      adminService.updateStaff(id, body),
    onSuccess: () => {
      setChanging(null);
      refresh();
    },
  });

  if (staff.isError) return <ErrorState message={errText(staff.error)} onRetry={() => staff.refetch()} />;
  if (!staff.data) return <p className="text-sm text-slate-500">Loading staff…</p>;
  const canManage = staff.data.your_role === 'super_admin';
  const formOk = form.name.trim().length >= 2 && /^\d{10}$/.test(form.phone);

  return (
    <section aria-label="Staff accounts" className="space-y-5">
      <ul className="divide-y divide-[#EEF2F6] rounded-[14px] border border-[#EEF2F6] bg-white">
        {staff.data.staff.map((m) => (
          <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <div className="font-semibold text-[#0F172A]">
                {m.name || 'Unnamed'} {m.is_you && <span className="text-xs font-normal text-slate-500">(you)</span>}
              </div>
              <div className="text-xs text-slate-500">
                {ROLE_LABEL[m.role] ?? m.role}
                {m.phone ? ` · ${m.phone}` : ''}
                {!m.has_login ? ' · no sign-in linked' : ''}
                {m.disabled_at ? ' · access switched off' : ''}
              </div>
            </div>
            {canManage && !m.is_you && (
              <div className="flex flex-wrap items-center gap-2">
                <label className="sr-only" htmlFor={`role-${m.id}`}>Role for {m.name || 'this member'}</label>
                <select
                  id={`role-${m.id}`}
                  value={m.role}
                  onChange={(e) => {
                    const role = e.target.value as StaffRole;
                    update.reset();
                    setChanging({ member: m, body: { role }, title: `Make ${m.name || 'this member'} ${ROLE_LABEL[role]}?` });
                  }}
                  className="min-h-[40px] rounded-[10px] border border-[#EEF2F6] bg-white px-2 text-xs"
                >
                  {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                </select>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    update.reset();
                    setChanging({
                      member: m,
                      body: { disabled: !m.disabled_at },
                      title: m.disabled_at ? `Switch access back on for ${m.name || 'this member'}?` : `Switch off access for ${m.name || 'this member'}?`,
                    });
                  }}
                >
                  {m.disabled_at ? 'Switch on' : 'Switch off'}
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>

      {staff.data.invites.length > 0 && (
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">Open invites</h3>
          <ul className="divide-y divide-[#EEF2F6] rounded-[14px] border border-[#EEF2F6] bg-white">
            {staff.data.invites.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                <span>
                  {i.name} · {ROLE_LABEL[i.role] ?? i.role} · {i.phone} ·{' '}
                  {i.expired ? <span className="text-red-700">expired</span> : `expires ${when(i.expires_at)}`}
                </span>
                {canManage && (
                  <Button size="sm" variant="outline" onClick={() => revoke.mutate(i.id)} disabled={revoke.isPending}>
                    Revoke
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {canManage ? (
        <form
          className="rounded-[14px] border border-[#EEF2F6] bg-white p-4 space-y-3"
          onSubmit={(e) => { e.preventDefault(); if (formOk) invite.mutate(); }}
        >
          <h3 className="font-bold text-[#0F172A]">Invite a staff member</h3>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label htmlFor="staff-name" className="text-xs font-semibold text-slate-600">Name</label>
              <input id="staff-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="mt-1 w-full min-h-[44px] rounded-[10px] border border-[#EEF2F6] px-3 text-sm" />
            </div>
            <div>
              <label htmlFor="staff-phone" className="text-xs font-semibold text-slate-600">Mobile number (+91)</label>
              <input id="staff-phone" inputMode="numeric" value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value.replace(/\D/g, '').slice(0, 10) })}
                className="mt-1 w-full min-h-[44px] rounded-[10px] border border-[#EEF2F6] px-3 text-sm tnum" />
            </div>
            <div>
              <label htmlFor="staff-role" className="text-xs font-semibold text-slate-600">Role</label>
              <select id="staff-role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as StaffRole })}
                className="mt-1 w-full min-h-[44px] rounded-[10px] border border-[#EEF2F6] bg-white px-2 text-sm">
                {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </select>
            </div>
          </div>
          <p className="text-xs text-[#475569]">{ROLE_LABEL[form.role]}: {ROLE_CAN[form.role]}</p>
          {invite.isError && <p role="alert" className="text-sm text-red-700">{errText(invite.error)}</p>}
          <Button type="submit" disabled={!formOk || invite.isPending} isLoading={invite.isPending}>Create invite</Button>
        </form>
      ) : (
        <p className="text-xs text-[#475569]">Only a super admin can invite staff or change roles.</p>
      )}

      {issued && (
        <Modal
          isOpen
          onClose={() => setIssued(null)}
          title={`Invite code for ${issued.name}`}
          description="This code is shown once. Send it to them over a channel you trust; it only works for their number."
          maxWidth="md"
        >
          <p className="rounded-[10px] border border-[#EEF2F6] bg-[#F6F8FA] p-3 font-mono text-sm break-all" data-testid="invite-token">
            {issued.token}
          </p>
          <p className="mt-3 text-sm text-[#475569]">
            They sign in at <span className="font-mono">/staff/join</span> with {issued.phone} and enter the code. It expires in 72 hours.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" onClick={() => void navigator.clipboard?.writeText(issued.token)}>Copy code</Button>
            <Button onClick={() => setIssued(null)}>Done</Button>
          </div>
        </Modal>
      )}

      {changing && (
        <ReasonDialog
          title={changing.title}
          description="Recorded in the audit log with your name."
          confirm="Confirm"
          busy={update.isPending}
          error={update.isError ? errText(update.error) : null}
          onClose={() => setChanging(null)}
          onConfirm={(reason) => update.mutate({ id: changing.member.id, body: { ...changing.body, reason } })}
        />
      )}
    </section>
  );
};
