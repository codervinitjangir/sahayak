import React, { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, LifeBuoy, RefreshCw } from 'lucide-react';

import { ApiError } from '../../services/api';
import { useAuth } from '../../app/AuthProvider';
import {
  WINDOW_PRESETS,
  WindowPreset,
  useDispatch,
  useMatching,
  useOverview,
} from '../../features/admin/hooks';
import { OverviewPanel } from './OverviewPanel';
import { DispatchPanel } from './DispatchPanel';
import { MatchingPanel } from './MatchingPanel';

type TabId = 'overview' | 'dispatch' | 'matching';

const TABS: { id: TabId; label: string; blurb: string }[] = [
  { id: 'overview', label: 'Overview', blurb: 'Jobs, completion and partner supply' },
  { id: 'dispatch', label: 'Dispatch', blurb: 'Offers, acceptance and latency' },
  { id: 'matching', label: 'Matching', blurb: 'Weighted engine vs pure-nearest' },
];

/**
 * The ops console over the three admin analytics endpoints.
 *
 * ## One filter row, above everything it scopes
 *
 * The window presets sit in a single row at the top and every panel re-renders
 * against the same slice. Per-chart date pickers are the classic dashboard
 * mistake: two charts end up showing different windows and the reader compares
 * them anyway.
 *
 * ## Why the panels are tabs rather than one long page
 *
 * Three separate requests. Rendering all three at once would fire three
 * concurrent analytics queries — each of which scans jobs, assignments and
 * partners — against a database whose whole connection budget is fifteen shared
 * Supavisor sessions. Tabs mean one report in flight at a time, and the window
 * selection survives switching between them.
 *
 * ## This is not a security boundary
 *
 * `RequireRole` decides which screen makes sense to show; it reads client-side
 * state. Authorisation is `require_admin` on each of the three routes, and the
 * 403 handling below is what the reader actually sees if they are not an admin.
 */
export const AdminConsole: React.FC = () => {
  const navigate = useNavigate();
  const { tab } = useParams<{ tab?: string }>();
  const active: TabId = TABS.some((t) => t.id === tab) ? (tab as TabId) : 'overview';
  const [preset, setPreset] = useState<WindowPreset>('7d');
  const { logout } = useAuth();

  const overview = useOverview(preset);
  const dispatch = useDispatch(preset);
  const matching = useMatching(preset);

  const query =
    active === 'overview' ? overview : active === 'dispatch' ? dispatch : matching;

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <Link
              to="/"
              className="flex items-center gap-2 text-lg font-extrabold tracking-tight text-brand-700"
            >
              <span className="rounded-lg bg-brand-700 p-1.5 text-white">
                <LifeBuoy className="h-4 w-4" aria-hidden="true" />
              </span>
              Sahayak
            </Link>
            <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
              Ops
            </span>
          </div>
          <button
            type="button"
            onClick={logout}
            className="text-xs font-medium text-slate-500 transition hover:text-slate-900"
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <div className="mb-5">
          <h1 className="text-xl font-bold text-slate-900">Analytics</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Read-only. Every figure carries its own caveats — the amber panel on each tab is part
            of the report, not a warning about it.
          </p>
        </div>

        {/* Tabs */}
        <nav aria-label="Reports" className="mb-4 flex flex-wrap gap-1 border-b border-slate-200">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => navigate(`/admin/${t.id}`)}
              aria-current={active === t.id ? 'page' : undefined}
              title={t.blurb}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition ${
                active === t.id
                  ? 'border-brand-700 text-brand-700'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>

        {/* The one filter row. Scopes all three reports. */}
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div
            role="group"
            aria-label="Time window"
            className="flex flex-wrap gap-1 rounded-lg border border-slate-200 bg-white p-1"
          >
            {WINDOW_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPreset(p.id)}
                aria-pressed={preset === p.id}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                  preset === p.id
                    ? 'bg-brand-700 text-white'
                    : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-3">
            <WindowCaption
              from={query.data?.window.requested_from ?? null}
              firstJob={query.data?.window.first_job_at ?? null}
              lastJob={query.data?.window.last_job_at ?? null}
            />
            <button
              type="button"
              onClick={() => query.refetch()}
              disabled={query.isFetching}
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${query.isFetching ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
              Refresh
            </button>
          </div>
        </div>

        {query.isError ? (
          <AnalyticsError error={query.error} />
        ) : query.data ? (
          // Held at reduced opacity while refetching rather than swapped for a
          // skeleton — no layout jump when the window changes.
          <div className={query.isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
            {active === 'overview' && overview.data && <OverviewPanel data={overview.data} />}
            {active === 'dispatch' && dispatch.data && <DispatchPanel data={dispatch.data} />}
            {active === 'matching' && matching.data && <MatchingPanel data={matching.data} />}
          </div>
        ) : (
          <p className="py-16 text-center text-sm text-slate-400">Loading report…</p>
        )}
      </main>
    </div>
  );
};

/** What the window actually covered, which is rarely what was asked for. */
const WindowCaption: React.FC<{
  from: string | null;
  firstJob: string | null;
  lastJob: string | null;
}> = ({ from, firstJob, lastJob }) => {
  if (!firstJob && !lastJob) {
    return <p className="text-xs text-slate-400">No jobs in this window</p>;
  }
  const fmt = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
  return (
    <p className="text-xs text-slate-500">
      Data from {fmt(firstJob)} to {fmt(lastJob)}
      {from && <span className="text-slate-400"> · asked from {fmt(from)}</span>}
    </p>
  );
};

/**
 * The 403s are the interesting failures here, and they are distinguishable.
 *
 * `FORBIDDEN` means a real account that is not an admin. `USER_NOT_REGISTERED`
 * means a verified token with no profile at all. Neither is fixable by retrying,
 * and neither is fixable in this app: an `admins` row is written by hand in SQL
 * on purpose (ADR-020), so the honest message says who to ask rather than
 * offering a button that cannot work.
 */
const AnalyticsError: React.FC<{ error: unknown }> = ({ error }) => {
  const apiError = error instanceof ApiError ? error : null;
  const isForbidden = apiError?.status === 403;

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-6">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-amber-900">
        <AlertTriangle className="h-4 w-4" aria-hidden="true" />
        {isForbidden ? 'This account is not an administrator' : 'Could not load the report'}
      </h2>
      <p className="mt-2 max-w-2xl text-xs leading-relaxed text-amber-900">
        {isForbidden ? (
          <>
            The analytics endpoints are admin-only, and admin access is granted directly in the
            database rather than through any screen — there is deliberately no way to claim it by
            presenting a token. Ask the Sahayak team to provision this account.
          </>
        ) : (
          <>
            {apiError?.message ?? 'The request failed.'}
            {apiError?.code && (
              <>
                {' '}
                <code className="rounded bg-amber-100 px-1 py-0.5 font-mono text-[10px]">
                  {apiError.code}
                </code>
              </>
            )}
            {apiError?.requestId && (
              <span className="block pt-1 text-amber-700">
                Request id {apiError.requestId} — quote this when reporting it.
              </span>
            )}
          </>
        )}
      </p>
      <Link
        to="/owner"
        className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-amber-900 underline"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
        Back to the app
      </Link>
    </div>
  );
};
