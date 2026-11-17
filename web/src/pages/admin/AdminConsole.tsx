import React, { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  Compass,
  Globe,
  LogOut,
  RefreshCw,
  ShieldCheck,
  Zap,
  ClipboardList,
  Users,
  ScrollText,
} from 'lucide-react';

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
import { PartnersPanel } from './PartnersPanel';
import { AuditPanel, CataloguePanel, JobsBoardPanel, OwnersPanel, StaffPanel } from './BackOfficePanels';
import '../partner/partner.css';

type TabId = 'overview' | 'dispatch' | 'matching' | 'jobs' | 'partners' | 'owners' | 'catalogue' | 'staff' | 'audit';

const TABS: { id: TabId; label: string; blurb: string; Icon: React.ElementType }[] = [
  { id: 'overview', label: 'Overview', blurb: 'Jobs, completion and partner supply', Icon: BarChart3 },
  { id: 'dispatch', label: 'Dispatch', blurb: 'Offers, acceptance and latency', Icon: Zap },
  { id: 'matching', label: 'Matching', blurb: 'Weighted engine vs pure-nearest', Icon: Compass },
  { id: 'jobs', label: 'Jobs', blurb: 'Live board, staff cancel', Icon: ClipboardList },
  { id: 'partners', label: 'Partners', blurb: 'Mechanic verification & KYC approval', Icon: ShieldCheck },
  { id: 'owners', label: 'Owners', blurb: 'Search, suspend, reinstate', Icon: Users },
  { id: 'catalogue', label: 'Pricing', blurb: 'Service base prices', Icon: ClipboardList },
  { id: 'staff', label: 'Staff', blurb: 'Accounts, roles, invites', Icon: Users },
  { id: 'audit', label: 'Audit', blurb: 'Every staff action', Icon: ScrollText },
];

// Tabs that are operations, not time-windowed reports.
const OPS_TABS: TabId[] = ['jobs', 'partners', 'owners', 'catalogue', 'staff', 'audit'];
const OPS_COPY: Record<string, { tag: string; title: string; blurb: string }> = {
  jobs: { tag: 'Live Ops', title: 'Live jobs board', blurb: 'Every job still in motion, with who to call. Cancelling here notifies both sides and is recorded in the audit log.' },
  partners: { tag: 'Ops Verification Queue', title: 'Partner Verification & KYC', blurb: 'Review mechanic profiles, inspect workshop credentials and tools, and approve or reject partners on phone or desktop.' },
  owners: { tag: 'Accounts', title: 'Vehicle owners', blurb: 'Search owners and suspend or reinstate an account. Suspension is audited and blocks every request the owner makes.' },
  catalogue: { tag: 'Catalogue', title: 'Service pricing', blurb: 'The base price each new request is estimated at. Every change needs a reason and is recorded in the audit log.' },
  staff: { tag: 'Access', title: 'Staff accounts', blurb: 'Who can use this console and what each role may change. Invites are single-use and tied to one mobile number.' },
  audit: { tag: 'Compliance', title: 'Audit log', blurb: 'Append-only record of every staff action: who did what, to what, why and when.' },
};

/**
 * The Admin Operations Console.
 *
 * Fully unified with the Partner Console design language:
 * - Partner-shell sidebar layout with neutral canvas and white surfaces
 * - Active navigation pills (.nav-active-pill)
 * - Scoped global time window filter above all reporting panels
 */
export const AdminConsole: React.FC = () => {
  const navigate = useNavigate();
  const { tab } = useParams<{ tab?: string }>();
  const active: TabId = TABS.some((t) => t.id === tab) ? (tab as TabId) : 'overview';
  const isOps = OPS_TABS.includes(active);
  const [preset, setPreset] = useState<WindowPreset>('7d');
  const { logout } = useAuth();

  const overview = useOverview(preset, { enabled: active === 'overview' });
  const dispatch = useDispatch(preset, { enabled: active === 'dispatch' });
  const matching = useMatching(preset, { enabled: active === 'matching' });

  const query =
    active === 'overview' ? overview : active === 'dispatch' ? dispatch : matching;

  return (
    <div className="partner-shell">
      {/* ── Admin Operations Sidebar (Matching Partner Console UI/UX) ── */}
      <aside aria-label="Admin Navigation Sidebar" className="partner-sidebar">
        <div>
          {/* Brand Header */}
          <div className="mb-6 pb-4 border-b border-[#EEF2F6]">
            <Link to="/admin" className="block group focus:outline-none">
              <span className="font-semibold text-xl tracking-tight text-[#0F172A] block leading-tight group-hover:text-[#111111] transition-colors">
                Sahayak
              </span>
              <span className="text-xs font-bold text-[#111111] tracking-wider uppercase block mt-0.5">
                Operations & Analytics
              </span>
            </Link>
          </div>

          {/* Section: Analytics Panels */}
          <div className="partner-sidebar__label text-xs font-bold tracking-wider text-[#64748B] uppercase px-3 mt-4 mb-2">
            ANALYTICS REPORT
          </div>
          <nav className="partner-sidebar__nav space-y-1 w-full">
            {TABS.map(({ id, label, Icon }) => {
              const isActive = active === id;
              return (
                <button
                  key={id}
                  type="button"
                  aria-current={isActive ? 'page' : undefined}
                  onClick={() => navigate(`/admin/${id}`)}
                  className={`w-full text-left flex items-center gap-3 px-3.5 py-2.5 text-xs font-semibold cursor-pointer transition-all ${
                    isActive
                      ? 'nav-active-pill'
                      : 'text-[#475569] hover:text-[#0F172A] rounded-[10px] hover:bg-[#F6F8FA]/70'
                  }`}
                >
                  <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-white' : 'text-[#111111]'}`} />
                  <span>{label}</span>
                </button>
              );
            })}
          </nav>

          {/* Owner and partner screens are not reachable from an admin login
              (the backend answers them with 403), so no shortcuts to them. */}
          <nav className="partner-sidebar__nav space-y-1 w-full mt-6">
            <Link
              to="/"
              className="w-full text-left flex items-center gap-3 px-3.5 py-2.5 text-xs font-semibold text-[#475569] hover:text-[#0F172A] rounded-[10px] hover:bg-[#F6F8FA]/70 transition-all"
            >
              <Globe className="w-4 h-4 text-[#475569] shrink-0" />
              <span>Public website</span>
            </Link>
          </nav>
        </div>

        {/* Bottom Profile Badge & Sign out */}
        <div className="pt-4 border-t border-[#EEF2F6] flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-full bg-[#111111] text-white flex items-center justify-center text-xs font-bold shrink-0">
              A
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-[#0F172A] truncate">Operations</div>
              <div className="text-xs font-medium text-[#475569]">Admin access</div>
            </div>
          </div>
          <button
            type="button"
            onClick={logout}
            title="Sign out"
            aria-label="Sign out"
            className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center text-[#64748B] hover:text-[#B91C1C] transition-colors"
          >
            <LogOut className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      </aside>

      {/* ── Main Canvas ── */}
      <main className="partner-main-canvas flex flex-col min-w-0">
        {/* Executive Header & Filter Bar */}
        <div className="w-full flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6 pb-4 border-b border-[#EEF2F6]">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="px-2 py-0.5 rounded-[6px] text-xs font-bold bg-[#E6F4F1] text-[#111111] uppercase tracking-wider">
                {isOps ? OPS_COPY[active].tag : 'Live Ops Console'}
              </span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-[#0F172A]">
              {isOps ? OPS_COPY[active].title : 'Analytics'}
            </h1>
            <p className="mt-0.5 text-xs text-[#475569] max-w-2xl leading-relaxed">
              {isOps
                ? OPS_COPY[active].blurb
                : 'Read-only. Every figure carries its own caveats — the amber panel on each tab is part of the report, not a warning about it.'}
            </p>
          </div>

          {/* Time Window Selector & Refresh (analytics tabs only) */}
          {!isOps && (
            <div className="flex items-center gap-2.5 flex-wrap">
              <div
                role="group"
                aria-label="Time window"
                className="flex flex-wrap items-center gap-1 bg-white p-1 rounded-[12px] border border-[#EEF2F6] shadow-2xs"
              >
                {WINDOW_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPreset(p.id)}
                    aria-pressed={preset === p.id}
                    className={`rounded-[8px] px-3 py-1.5 text-xs font-semibold transition-all ${
                      preset === p.id
                        ? 'bg-[#111111] text-white shadow-2xs'
                        : 'text-[#475569] hover:text-[#0F172A] hover:bg-[#F6F8FA]'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={() => query.refetch()}
                disabled={query.isFetching}
                className="flex items-center gap-1.5 rounded-[12px] border border-[#EEF2F6] bg-white hover:bg-[#FFFFFF] px-3.5 py-2 text-xs font-semibold text-[#0F172A] transition-colors shadow-2xs disabled:opacity-50"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 text-[#111111] ${query.isFetching ? 'animate-spin' : ''}`}
                  aria-hidden="true"
                />
                <span>Refresh</span>
              </button>
            </div>
          )}
        </div>

        {/* Subnav Tabs & Scope Status */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5 border-b border-[#EEF2F6] pb-3">
          <nav aria-label="Reports" className="flex items-center gap-2 min-w-0 max-w-full overflow-x-auto">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => navigate(`/admin/${t.id}`)}
                aria-current={active === t.id ? 'page' : undefined}
                title={t.blurb}
                className={`shrink-0 whitespace-nowrap px-3.5 py-1.5 text-xs font-semibold rounded-[8px] transition-all ${
                  active === t.id
                    ? 'bg-[#0F172A] text-white shadow-2xs'
                    : 'text-[#475569] hover:text-[#0F172A] hover:bg-[#F6F8FA]'
                }`}
              >
                {t.label}
              </button>
            ))}
          </nav>

          {!isOps && (
            <WindowCaption
              from={query.data?.window.requested_from ?? null}
              firstJob={query.data?.window.first_job_at ?? null}
              lastJob={query.data?.window.last_job_at ?? null}
            />
          )}
        </div>

        {/* Panel Rendering */}
        {active === 'partners' ? (
          <PartnersPanel />
        ) : active === 'jobs' ? (
          <JobsBoardPanel />
        ) : active === 'owners' ? (
          <OwnersPanel />
        ) : active === 'catalogue' ? (
          <CataloguePanel />
        ) : active === 'staff' ? (
          <StaffPanel />
        ) : active === 'audit' ? (
          <AuditPanel />
        ) : query.isError ? (
          <AnalyticsError error={query.error} />
        ) : query.data ? (
          <div className={query.isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
            {active === 'overview' && overview.data && <OverviewPanel data={overview.data} />}
            {active === 'dispatch' && dispatch.data && <DispatchPanel data={dispatch.data} />}
            {active === 'matching' && matching.data && <MatchingPanel data={matching.data} />}
          </div>
        ) : (
          <div className="py-24 text-center">
            <RefreshCw className="w-6 h-6 text-[#111111] animate-spin mx-auto mb-3" />
            <p className="text-sm font-semibold text-[#475569]">Loading report…</p>
          </div>
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
    return <p className="text-xs text-[#64748B]">No jobs in this window</p>;
  }
  const fmt = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
  return (
    <p className="text-xs text-[#475569]">
      Data from {fmt(firstJob)} to {fmt(lastJob)}
      {from && <span className="text-[#64748B]"> · asked from {fmt(from)}</span>}
    </p>
  );
};

/**
 * 403s and 500 error presentation matching the partner design tokens.
 */
const AnalyticsError: React.FC<{ error: unknown }> = ({ error }) => {
  const apiError = error instanceof ApiError ? error : null;
  const isForbidden = apiError?.status === 403;

  return (
    <div className="rounded-[16px] border border-[#FDE68A] bg-[#FFFBEB] p-6 shadow-2xs">
      <h2 className="flex items-center gap-2 text-sm font-bold text-[#92400E]">
        <AlertTriangle className="h-4 w-4 text-[#D97706]" aria-hidden="true" />
        {isForbidden ? 'This account is not an administrator' : 'Could not load the report'}
      </h2>
      <p className="mt-2 max-w-2xl text-xs leading-relaxed text-[#92400E]">
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
                <code className="rounded bg-[#FEF3C7] px-1 py-0.5 font-mono text-xs font-bold text-[#92400E]">
                  {apiError.code}
                </code>
              </>
            )}
            {apiError?.requestId && (
              <span className="block pt-1 text-[#B45309]">
                Request id {apiError.requestId} — quote this when reporting it.
              </span>
            )}
          </>
        )}
      </p>
      <Link
        to="/owner"
        className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-[#92400E] underline hover:text-[#78350F]"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
        Back to the app
      </Link>
    </div>
  );
};

export default AdminConsole;
