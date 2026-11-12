import React, { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  Compass,
  Globe,
  LifeBuoy,
  LogOut,
  RefreshCw,
  ShieldCheck,
  Wrench,
  Zap,
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
import '../partner/partner.css';

type TabId = 'overview' | 'dispatch' | 'matching' | 'partners';

const TABS: { id: TabId; label: string; blurb: string; Icon: React.ElementType }[] = [
  { id: 'overview', label: 'Overview', blurb: 'Jobs, completion and partner supply', Icon: BarChart3 },
  { id: 'dispatch', label: 'Dispatch', blurb: 'Offers, acceptance and latency', Icon: Zap },
  { id: 'matching', label: 'Matching', blurb: 'Weighted engine vs pure-nearest', Icon: Compass },
  { id: 'partners', label: 'Partners', blurb: 'Mechanic verification & KYC approval', Icon: ShieldCheck },
];

/**
 * The Admin Operations Console.
 *
 * Fully unified with the Partner Console design language:
 * - Partner-shell sidebar layout with warm paper styling (#F6F1E6 / #FBF8F1)
 * - Fraunces typographic brand identity
 * - Citilink active navigation pills (.citisum-active-pill)
 * - Scoped global time window filter above all reporting panels
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
    <div className="partner-shell">
      {/* ── Admin Operations Sidebar (Matching Partner Console UI/UX) ── */}
      <aside aria-label="Admin Navigation Sidebar" className="partner-sidebar">
        <div>
          {/* Brand Header */}
          <div className="mb-6 pb-4 border-b border-[#E7E0D2]">
            <Link to="/admin" className="block group focus:outline-none">
              <span className="font-['Fraunces'] font-semibold text-xl tracking-tight text-[#1B1712] block leading-tight group-hover:text-[#0F766E] transition-colors">
                Sahayak
              </span>
              <span className="text-[10px] font-bold text-[#0F766E] tracking-wider uppercase block mt-0.5">
                Operations & Analytics
              </span>
            </Link>
          </div>

          {/* Section: Analytics Panels */}
          <div className="text-[10px] font-bold tracking-wider text-[#9A917F] uppercase px-3 mt-4 mb-2">
            ANALYTICS REPORT
          </div>
          <nav className="space-y-1 w-full">
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
                      ? 'citisum-active-pill'
                      : 'text-[#5B5346] hover:text-[#1B1712] rounded-[10px] hover:bg-[#F6F1E6]/70'
                  }`}
                >
                  <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-white' : 'text-[#0F766E]'}`} />
                  <span>{label}</span>
                </button>
              );
            })}
          </nav>

          {/* Section: Platform Shortcuts */}
          <div className="text-[10px] font-bold tracking-wider text-[#9A917F] uppercase px-3 mt-6 mb-2">
            PLATFORM SHORTCUTS
          </div>
          <nav className="space-y-1 w-full">
            <Link
              to="/partner/dashboard"
              className="w-full text-left flex items-center gap-3 px-3.5 py-2.5 text-xs font-semibold text-[#5B5346] hover:text-[#1B1712] rounded-[10px] hover:bg-[#F6F1E6]/70 transition-all"
            >
              <Wrench className="w-4 h-4 text-[#5B5346] shrink-0" />
              <span>Partner Console</span>
            </Link>
            <Link
              to="/owner/request"
              className="w-full text-left flex items-center gap-3 px-3.5 py-2.5 text-xs font-semibold text-[#5B5346] hover:text-[#1B1712] rounded-[10px] hover:bg-[#F6F1E6]/70 transition-all"
            >
              <LifeBuoy className="w-4 h-4 text-[#5B5346] shrink-0" />
              <span>Request Help</span>
            </Link>
            <Link
              to="/"
              className="w-full text-left flex items-center gap-3 px-3.5 py-2.5 text-xs font-semibold text-[#5B5346] hover:text-[#1B1712] rounded-[10px] hover:bg-[#F6F1E6]/70 transition-all"
            >
              <Globe className="w-4 h-4 text-[#5B5346] shrink-0" />
              <span>Public Landing</span>
            </Link>
          </nav>
        </div>

        {/* Bottom Profile Badge & Sign out */}
        <div className="pt-4 border-t border-[#E7E0D2] flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-full bg-[#0F766E] text-white flex items-center justify-center text-xs font-bold shrink-0">
              OP
            </div>
            <div className="min-w-0">
              <div className="text-xs font-bold text-[#1B1712] truncate">Operations Lead</div>
              <div className="text-[10px] font-medium text-[#0F766E] flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                Admin Access
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={logout}
            title="Sign out"
            className="text-xs font-medium text-[#9A917F] hover:text-[#B91C1C] transition-colors p-1"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </aside>

      {/* ── Main Canvas ── */}
      <main className="partner-main-canvas flex flex-col">
        {/* Executive Header & Filter Bar */}
        <div className="w-full flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6 pb-4 border-b border-[#E7E0D2]">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="px-2 py-0.5 rounded-[6px] text-[10px] font-bold bg-[#E6F4F1] text-[#0F766E] uppercase tracking-wider">
                Live Ops Console
              </span>
              <span className="text-xs text-[#9A917F]">
                PostGIS Engine · Supabase Auth
              </span>
            </div>
            <h1 className="font-['Fraunces'] text-2xl font-bold tracking-tight text-[#1B1712]">
              Analytics
            </h1>
            <p className="mt-0.5 text-xs text-[#5B5346] max-w-2xl leading-relaxed">
              Read-only. Every figure carries its own caveats — the amber panel on each tab is part
              of the report, not a warning about it.
            </p>
          </div>

          {/* Time Window Selector & Refresh */}
          <div className="flex items-center gap-2.5 flex-wrap">
            <div
              role="group"
              aria-label="Time window"
              className="flex items-center gap-1 bg-white p-1 rounded-[12px] border border-[#E7E0D2] shadow-2xs"
            >
              {WINDOW_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPreset(p.id)}
                  aria-pressed={preset === p.id}
                  className={`rounded-[8px] px-3 py-1.5 text-xs font-semibold transition-all ${
                    preset === p.id
                      ? 'bg-[#0F766E] text-white shadow-2xs'
                      : 'text-[#5B5346] hover:text-[#1B1712] hover:bg-[#F6F1E6]'
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
              className="flex items-center gap-1.5 rounded-[12px] border border-[#E7E0D2] bg-white hover:bg-[#FBF8F1] px-3.5 py-2 text-xs font-semibold text-[#1B1712] transition-colors shadow-2xs disabled:opacity-50"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 text-[#0F766E] ${query.isFetching ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
              <span>Refresh</span>
            </button>
          </div>
        </div>

        {/* Subnav Tabs & Scope Status */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5 border-b border-[#E7E0D2] pb-3">
          <nav aria-label="Reports" className="flex items-center gap-2">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => navigate(`/admin/${t.id}`)}
                aria-current={active === t.id ? 'page' : undefined}
                title={t.blurb}
                className={`px-3.5 py-1.5 text-xs font-semibold rounded-[8px] transition-all ${
                  active === t.id
                    ? 'bg-[#1B1712] text-white shadow-2xs'
                    : 'text-[#5B5346] hover:text-[#1B1712] hover:bg-[#F6F1E6]'
                }`}
              >
                {t.label}
              </button>
            ))}
          </nav>

          <WindowCaption
            from={query.data?.window.requested_from ?? null}
            firstJob={query.data?.window.first_job_at ?? null}
            lastJob={query.data?.window.last_job_at ?? null}
          />
        </div>

        {/* Panel Rendering */}
        {active === 'partners' ? (
          <PartnersPanel />
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
            <RefreshCw className="w-6 h-6 text-[#0F766E] animate-spin mx-auto mb-3" />
            <p className="text-sm font-semibold text-[#5B5346]">Loading report…</p>
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
    return <p className="text-xs text-[#9A917F]">No jobs in this window</p>;
  }
  const fmt = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
  return (
    <p className="text-xs text-[#5B5346]">
      Data from {fmt(firstJob)} to {fmt(lastJob)}
      {from && <span className="text-[#9A917F]"> · asked from {fmt(from)}</span>}
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
                <code className="rounded bg-[#FEF3C7] px-1 py-0.5 font-mono text-[10px] font-bold text-[#92400E]">
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
