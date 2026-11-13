import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ChevronRight,
  Eye,
  EyeOff,
  MapPin,
  Power,
  RefreshCw,
  Settings,
  ShieldCheck,
  TrendingUp,
  Truck,
  Wrench,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '../../components/ui/Button';
import { JobTimeline } from '../../components/JobTimeline';
import { usePartnerAvailability } from '../../features/partners/usePartnerAvailability';
import { usePartnerProfile } from '../../features/partners/partnerStore';
import { updateConsoleSettings, useConsoleSettings } from '../../features/partners/consoleSettings';
import {
  useActiveJob,
  useOfferResponse,
  usePartnerEarnings,
  usePartnerTrustStats,
  usePendingOffer, usePartnerServices } from '../../features/partners/useOffers';
import { jobsService } from '../../services/jobs.service';
import {
  verificationBadgeLabel,
  capabilityLabel,
  derivePartnerCapability,
  type EarningsWindow,
  type PartnerOffer,
  type PartnerProfile,
} from '../../types/partner';
import type { Job } from '../../types/jobs';
import './partner.css';

/* ── Formatter Helpers ─────────────────────────────────────────────────────── */

const RUPEES = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

function formatRupees(amount: number): string {
  return `₹${RUPEES.format(amount)}`;
}

function formatDistance(metres: number): string {
  return metres >= 1000 ? `${(metres / 1000).toFixed(1)} km` : `${Math.round(metres)} m`;
}

function formatAge(seconds: number): string {
  return seconds < 60 ? `${seconds}s ago` : `${Math.floor(seconds / 60)}m ago`;
}

/* ── Live Section State Machine ───────────────────────────────────────────── */

export type LiveState = 'active_job' | 'pending_offer' | 'off_duty' | 'idle';

export function resolveLiveState(input: {
  activeJob: Job | null | undefined;
  offer: PartnerOffer | null | undefined;
  isAvailable: boolean;
}): LiveState {
  if (input.activeJob) return 'active_job';
  if (input.offer) return 'pending_offer';
  if (!input.isAvailable) return 'off_duty';
  return 'idle';
}

/* ── 0. Left Sidebar: Sahayak identity ─────────── */

/** The four console destinations. Every one of them renders inside the console
 *  shell — none of them is a page of its own. */
export type ConsoleView = 'dispatches' | 'preferences' | 'verification' | 'settings';

export const CONSOLE_NAV: ReadonlyArray<{
  view: ConsoleView;
  label: string;
  Icon: typeof Truck;
  group: 'main' | 'settings';
  /** Kept so a deep link still resolves, and so the sidebar degrades to real
   *  anchors when it is rendered without an onNavigate handler. */
  path: string;
}> = [
  { view: 'dispatches', label: 'Dispatches', Icon: Truck, group: 'main', path: '/partner/dashboard' },
  { view: 'preferences', label: 'Services & Preferences', Icon: Wrench, group: 'main', path: '/partner/preferences' },
  { view: 'verification', label: 'Verification', Icon: ShieldCheck, group: 'main', path: '/partner/verification' },
  { view: 'settings', label: 'Settings', Icon: Settings, group: 'settings', path: '/partner/settings' },
];

export const PartnerSidebar: React.FC<{
  profile: PartnerProfile;
  isAvailable: boolean;
  activeNav?: ConsoleView;
  /** When supplied, the nav swaps the view in place and never changes the
   *  route. Without it the same entries fall back to <Link>s, which is what
   *  keeps the standalone pages (and their tests) working on their own. */
  onNavigate?: (view: ConsoleView) => void;
}> = ({ profile, isAvailable, activeNav = 'dispatches', onNavigate }) => {
  const { data: sidebarStats } = usePartnerTrustStats();
  // The sidebar is the one element on screen for all four views, so the shift
  // summary belongs here rather than on any single view. It also keeps the
  // column from collapsing into ~380px of empty cream between the nav and the
  // profile badge.
  const { data: today } = usePartnerEarnings('today');
  const { privacyMode } = useConsoleSettings();

  const renderNav = (group: 'main' | 'settings') =>
    CONSOLE_NAV.filter((item) => item.group === group).map(({ view, label, Icon, path }) => {
      const isActive = activeNav === view;
      const className = `w-full text-left flex items-center gap-3 px-3.5 py-2.5 text-xs font-semibold cursor-pointer transition-all ${
        isActive
          ? 'nav-active-pill'
          : 'text-[#475569] hover:text-[#0F172A] rounded-[10px] hover:bg-[#F6F8FA]/70'
      }`;
      const icon = (
        <Icon
          className={`w-4 h-4 shrink-0 ${isActive ? 'text-white' : view === 'settings' ? 'text-[#475569]' : 'text-[#0F766E]'}`}
        />
      );

      return onNavigate ? (
        <button
          key={view}
          type="button"
          aria-current={isActive ? 'page' : undefined}
          onClick={() => onNavigate(view)}
          className={className}
        >
          {icon}
          <span>{label}</span>
        </button>
      ) : (
        <Link key={view} to={path} aria-current={isActive ? 'page' : undefined} className={className}>
          {icon}
          <span>{label}</span>
        </Link>
      );
    });

  return (
    <aside
      aria-label="Partner Navigation Sidebar"
      className="partner-sidebar"
    >
      <div>
        {/* Brand header */}
        <div className="mb-6 pb-4 border-b border-[#EEF2F6]">
          <Link
            to="/partner/dashboard"
            onClick={(e) => {
              if (onNavigate) {
                e.preventDefault();
                onNavigate('dispatches');
              }
            }}
            className="block group focus:outline-none"
          >
            <span className="font-semibold text-xl tracking-tight text-[#0F172A] block leading-tight group-hover:text-[#0F766E] transition-colors">
              Sahayak
            </span>
            <span className="text-xs font-bold text-[#475569] tracking-wider uppercase block mt-0.5">
              Roadside Dispatch
            </span>
          </Link>
        </div>

        {/* Section 1: MAIN MENU */}
        <div className="partner-sidebar__label text-xs font-bold tracking-wider text-[#64748B] uppercase px-3 mt-4 mb-2">
          MAIN MENU
        </div>

        <nav className="partner-sidebar__nav space-y-1 w-full">{renderNav('main')}</nav>

        {/* Section 2: SETTINGS */}
        <div className="partner-sidebar__label text-xs font-bold tracking-wider text-[#64748B] uppercase px-3 mt-6 mb-2">
          SETTINGS
        </div>

        <nav className="partner-sidebar__nav space-y-1 w-full">{renderNav('settings')}</nav>

        {/* Section 3: TODAY — the shift at a glance, on every view */}
        <div className="partner-sidebar__label text-xs font-bold tracking-wider text-[#64748B] uppercase px-3 mt-8 mb-2">
          Today
        </div>

        <div className="max-lg:hidden rounded-card bg-white border border-line px-3.5 py-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-xl font-semibold text-[#0F172A] tabular-nums leading-none">
                {today?.jobsCompleted ?? 0}
              </div>
              <div className="text-xs text-[#64748B] font-medium mt-1">Jobs done</div>
            </div>
            <div>
              <div className="text-xl font-semibold text-[#0F172A] tabular-nums leading-none">
                {privacyMode ? '₹••••' : formatRupees(today?.amountEarned ?? 0)}
              </div>
              <div className="text-xs text-[#64748B] font-medium mt-1">Earned</div>
            </div>
          </div>
          <div className="mt-3 pt-2.5 border-t border-[#EEF2F6] flex items-center gap-1.5">
            <span
              className={`w-1.5 h-1.5 rounded-full shrink-0 ${isAvailable ? 'bg-emerald-600' : 'bg-neutral-300'}`}
            />
            <span className="text-xs font-semibold text-[#475569] truncate">
              {isAvailable ? 'On duty' : 'Off duty'}
            </span>
          </div>
        </div>
      </div>

      {/* Partner Profile Badge Card at bottom of sidebar */}
      <div className="max-lg:hidden p-3 rounded-card bg-white border border-line flex items-center gap-3 mt-6">
        <div className="relative shrink-0">
          <span aria-hidden="true" className="w-10 h-10 rounded-full flex items-center justify-center bg-brand-700 text-white font-semibold">{profile.name.trim().charAt(0).toUpperCase()}</span>
          <span
            className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-white ${
              isAvailable ? 'bg-emerald-600' : 'bg-neutral-300'
            }`}
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-bold text-xs text-[#0F172A] truncate leading-tight">
            {profile.name}
          </div>
          <div className="text-xs text-[#475569] font-medium truncate mt-0.5">
            {profile.phone || 'Service partner'}
          </div>
          <div className="text-xs text-[#0F766E] font-semibold flex items-center gap-1 mt-0.5">
            <span className="w-1.5 h-1.5 rounded-full bg-[#0F766E]" />
            <span>{verificationBadgeLabel(sidebarStats?.verificationStatus)}</span>
          </div>
        </div>
      </div>
    </aside>
  );
};

import { PartnerTopBar } from './components/PartnerTopBar';

const TopBar: React.FC<{
  profile: PartnerProfile;
  capability: string;
  hideTopRow?: boolean;
}> = ({ profile, capability, hideTopRow }) => {
  return (
    <header className="w-full flex flex-col gap-4 mb-6">
      {!hideTopRow && <PartnerTopBar profile={profile} />}
      {/* Subheader row: title, secondary tabs and action button */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
        <div>
          <h1 className="text-2xl sm:text-3xl font-semibold text-[#0F172A] tracking-tight">
            Dispatches
          </h1>
          <p className="text-xs text-[#475569] mt-0.5">
            Live Bengaluru urban grid rescue operations & automated dispatch
          </p>

          {/* Secondary Action Tabs with Deep Teal Active Underline */}
          <div className="flex items-center gap-5 mt-3 text-xs font-semibold text-[#475569]">
            <button
              type="button"
              className="text-[#0F172A] font-bold pb-1 border-b-2 border-[#0F766E] cursor-pointer"
            >
              All dispatches
            </button>
            <button
              type="button"
              className="hover:text-[#0F172A] pb-1 cursor-pointer transition-colors"
            >
              Active fleet units
            </button>
            <button
              type="button"
              className="hover:text-[#0F172A] pb-1 cursor-pointer transition-colors"
            >
              Settlements & Payouts
            </button>
          </div>
        </div>

        {/* Right Action: Capability Badge */}
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <div className="hidden lg:flex items-center gap-1.5 bg-white rounded-[10px] px-3 py-1.5 border border-[#EEF2F6] shadow-2xs text-xs font-bold text-[#0F172A]">
            <Wrench className="w-3.5 h-3.5 text-[#0F766E]" />
            <span>{capability}</span>
          </div>
        </div>
      </div>
    </header>
  );
};

/* ── 2. Dispatch status card ───────────────────────────────────────────────── */

interface LiveZoneMapProps {
  liveState: LiveState;
  profile: PartnerProfile;
  offer: PartnerOffer | null;
  activeJob: Job | null;
  onGoOnline: () => void;
  /** Whole seconds since the last position fix, or null when never located. */
  locationAgeSeconds: number | null;
  onRefreshLocation: () => void;
}

/**
 * The partner's main card: what dispatch is doing for them right now.
 *
 * It used to sit on a stock aerial photo with a decorative route drawn over it,
 * which read as a live map but showed nothing real. It now shows only things
 * the backend actually reports: shift state, the last GPS fix, the current offer
 * and the active job.
 */
const LiveZoneMap: React.FC<LiveZoneMapProps> = ({
  liveState,
  profile,
  offer,
  activeJob,
  onGoOnline,
  locationAgeSeconds,
  onRefreshLocation,
}) => {
  const navigate = useNavigate();
  const { accept, reject, isResponding } = useOfferResponse();

  const handleAccept = async () => {
    if (!offer) return;
    const job = await accept(offer.id);
    if (job) navigate(`/partner/jobs/${job.id}`);
  };

  const isOffDuty = liveState === 'off_duty';

  return (
    <section
      data-testid={`live-state-${liveState}`}
      aria-label="Dispatch status"
      className="bento-card relative overflow-hidden w-full flex flex-col min-h-[420px] lg:min-h-[560px] bg-white"
    >
      <div aria-live="assertive" className="sr-only">
        {liveState === 'pending_offer' && 'New job offer received.'}
        {liveState === 'active_job' && 'Job accepted and active. Check progress below.'}
      </div>
      <div aria-live="polite" className="sr-only">
        {liveState === 'off_duty' && 'You are now off duty. Dispatch is paused.'}
        {liveState === 'idle' && 'You are on duty. Scanning your zone for offers.'}
      </div>

      {/* Header: zone and GPS fix */}
      <div className="p-4 sm:p-5 flex items-center justify-between gap-3 border-b border-line">
        <span className="inline-flex items-center gap-2 text-sm font-semibold text-ink min-w-0">
          <MapPin className="w-4 h-4 text-brand-700 shrink-0" aria-hidden="true" />
          <span className="truncate">Dispatch status</span>
        </span>
        <button
          type="button"
          onClick={onRefreshLocation}
          className="inline-flex items-center gap-1.5 min-h-[44px] px-3 rounded-full border border-line text-sm font-semibold text-ink hover:bg-slate-50 shrink-0"
          title="Re-acquire GPS position"
        >
          <RefreshCw className="w-4 h-4 text-brand-700" aria-hidden="true" />
          <span className="tnum">
            {locationAgeSeconds !== null ? `GPS ${formatAge(locationAgeSeconds)}` : 'Share location'}
          </span>
        </button>
      </div>

      {/* Body: one state at a time */}
      <div className="flex-1 flex items-center justify-center p-4 sm:p-8">
        {liveState === 'off_duty' && (
          <div data-testid="map-overlay-off-duty" className="w-full max-w-sm text-center">
            <span className="mx-auto w-14 h-14 rounded-full bg-slate-100 text-ink-muted flex items-center justify-center">
              <Power className="w-6 h-6" aria-hidden="true" />
            </span>
            <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-ink-muted">Dispatch paused</p>
            <h2 className="mt-1 text-2xl font-bold tracking-tight">You are off duty</h2>
            <p className="mt-2 text-sm text-ink-soft leading-relaxed">
              Dispatch is not sending you offers and your GPS position is not being shared.
            </p>
            <Button type="button" variant="primary" size="lg" onClick={onGoOnline} className="mt-6 w-full">
              <Power className="w-5 h-5" aria-hidden="true" />
              <span>Go on duty</span>
            </Button>
          </div>
        )}

        {liveState === 'idle' && (
          <div data-testid="map-overlay-idle" className="w-full max-w-sm text-center">
            <span className="relative mx-auto flex w-14 h-14">
              <span className="absolute inset-0 rounded-full bg-brand-500/30 animate-pulse-ring" />
              <span className="relative w-14 h-14 rounded-full bg-brand-50 text-brand-700 flex items-center justify-center">
                <ShieldCheck className="w-6 h-6" aria-hidden="true" />
              </span>
            </span>
            <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-status-success">On duty</p>
            <h2 className="mt-1 text-2xl font-bold tracking-tight">
              You're available. Waiting for the next job.
            </h2>
            <ul className="mt-5 text-sm text-ink-soft space-y-2 text-left inline-block">
              <li className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-brand-700 shrink-0" aria-hidden="true" />
                <span>Your location is shared with dispatch while you are on duty.</span>
              </li>
            </ul>
          </div>
        )}

        {liveState === 'pending_offer' && offer && (
          <div
            data-testid="map-overlay-pending-offer"
            className="w-full max-w-sm rounded-card border-2 border-ink p-5 bg-white shadow-float"
          >
            <div className="flex items-center justify-between gap-2 pb-3 border-b border-line">
              <span className="text-xs font-bold uppercase tracking-wide text-emergency-700 bg-emergency-50 px-2.5 py-1 rounded-full border border-emergency-100">
                Incoming dispatch offer
              </span>
              <span className="text-xs font-semibold text-brand-800">Awaiting response</span>
            </div>

            <h2 className="mt-3 text-lg font-bold truncate">{offer.serviceName}</h2>
            <p className="text-sm font-mono text-ink-soft">{offer.vehicleNumber}</p>

            {offer.payoutEstimate !== undefined && (
              <div className="mt-3 p-3 rounded-control bg-slate-50 border border-line flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Est. payout</span>
                <span className="text-lg font-bold tnum">{formatRupees(offer.payoutEstimate)}</span>
              </div>
            )}

            <div className="mt-3 text-sm text-ink-soft space-y-1">
              <p className="flex gap-2">
                <MapPin className="w-4 h-4 mt-0.5 shrink-0 text-brand-700" aria-hidden="true" />
                <span className="break-words">{offer.pickupAddressText}</span>
              </p>
              <p className="tnum text-ink-muted">{formatDistance(offer.distanceAtOfferM)} from you</p>
            </div>

            <div className="mt-5 flex items-center gap-3">
              <Button
                type="button"
                variant="outline"
                size="lg"
                disabled={isResponding}
                onClick={() => reject(offer.id)}
                className="flex-1 !border-line !text-ink-soft hover:!bg-slate-50"
              >
                Reject
              </Button>
              <Button
                type="button"
                variant="primary"
                size="lg"
                disabled={isResponding}
                onClick={handleAccept}
                className="flex-1"
              >
                Accept Job
              </Button>
            </div>
          </div>
        )}

        {liveState === 'active_job' && activeJob && (
          <div
            data-testid="map-overlay-active-job"
            className="w-full max-w-sm rounded-card border border-line p-5 bg-white shadow-card"
          >
            <div className="flex items-center gap-2 pb-3 border-b border-line">
              <span className="w-2 h-2 rounded-full bg-status-success animate-pulse" />
              <span className="text-xs font-bold uppercase tracking-wide text-status-success">Job in progress</span>
            </div>
            <h2 className="mt-3 text-lg font-bold truncate">{activeJob.service?.name || 'Roadside assistance'}</h2>
            <p className="text-sm font-mono text-ink-soft mb-3">{activeJob.vehicle_number}</p>
            <div className="mb-4">
              <JobTimeline status={activeJob.status} variant="compact" />
            </div>
            <Link
              to={`/partner/jobs/${activeJob.id}`}
              className="w-full inline-flex items-center justify-center gap-1 min-h-[48px] text-sm font-semibold text-white bg-brand-700 hover:bg-brand-800 rounded-control transition-colors"
            >
              <span>View full progress</span>
              <ChevronRight className="w-4 h-4" aria-hidden="true" />
            </Link>
          </div>
        )}
      </div>

      {/* Footer: unit and broadcast state */}
      <div className="px-4 sm:px-5 py-3 border-t border-line flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Truck className="w-4 h-4 text-brand-700 shrink-0" aria-hidden="true" />
          <div className="min-w-0 text-sm">
            <div className="font-semibold font-mono truncate">
              {profile.name}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span
            className={`w-2 h-2 rounded-full ${isOffDuty ? 'bg-slate-300' : 'bg-status-success animate-pulse'}`}
          />
          <span className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
            {isOffDuty ? 'Not sharing location' : 'Sharing location'}
          </span>
        </div>
      </div>
    </section>
  );
};

/* ── 3. Center Top: Earnings & Settlements (High-Density Bar Chart) ────────── */

const EarningsAndSettlementsCard: React.FC = () => {
  const [window, setWindow] = useState<EarningsWindow>('week');
  // Privacy is a console-wide setting, not a per-card one — flipping it here
  // is the same switch that Console Settings shows, so it survives a view
  // swap and a reload.
  const { privacyMode } = useConsoleSettings();
  const { data: earnings } = usePartnerEarnings(window);

  // Derived, not asserted. The previous window's settled total comes down with
  // the earnings payload, so this figure moves when the data moves instead of
  // being a percentage typed into the markup.
  const previous = earnings?.previousAmountEarned ?? 0;
  const current = earnings?.amountEarned ?? 0;
  const changePct = previous > 0 ? ((current - previous) / previous) * 100 : null;

  return (
    <section
      aria-label="Earnings and performance"
      className="bento-card p-5 flex flex-col justify-between h-[345px]"
    >
      <div>
        {/* The title sits on its own line. Sharing a row with the period tabs
            wrapped "Earnings & Settlements" onto two lines in this column while
            every neighbouring card heading stayed on one. */}
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <h2 className="font-semibold text-lg text-[#0F172A] tracking-tight truncate min-w-0">
            Earnings &amp; Settlements
          </h2>

          <div className="flex items-center gap-1.5 shrink-0">
            {changePct !== null && !privacyMode && (
              <span
                className={`inline-flex items-center gap-1 text-xs font-bold ${
                  changePct >= 0 ? 'text-[#0F766E]' : 'text-rose-700'
                }`}
              >
                <TrendingUp
                  className={`w-3 h-3 shrink-0 ${changePct >= 0 ? '' : 'rotate-180'}`}
                  aria-hidden="true"
                />
                <span className="tabular-nums">
                  {changePct >= 0 ? '+' : '−'}
                  {Math.abs(changePct).toFixed(1)}%
                </span>
                <span className="font-medium text-[#64748B]">
                  {window === 'today' ? 'vs yesterday' : 'vs last week'}
                </span>
              </span>
            )}
            <button
              type="button"
              role="switch"
              aria-checked={privacyMode}
              aria-label="Hide earnings figures"
              onClick={() => updateConsoleSettings({ privacyMode: !privacyMode })}
              className="p-1 text-[#64748B] hover:text-[#0F172A] transition-colors shrink-0"
              title={privacyMode ? 'Show earnings figures' : 'Hide earnings figures'}
            >
              {privacyMode ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3">
          {/* Settled-to-date only. "Today" lived here as well as in the chart
              callout, so the same figure was printed twice on one card. */}
          <span className="text-xs text-[#475569]">
            Settled to date:{' '}
            <strong className="text-[#0F172A] tabular-nums">{privacyMode ? '₹••••' : formatRupees(earnings?.amountEarned ?? 0)}</strong>
            <span className="text-[#C9C0AE] mx-1.5">·</span>
            <strong className="text-[#0F172A] tabular-nums">{earnings?.jobsCompleted ?? 0}</strong> jobs{' '}
            {window === 'today' ? 'today' : 'this week'}
          </span>

          {/* Period tabs */}
          <div className="flex items-center gap-1 text-xs font-semibold text-[#64748B] shrink-0">
            <button
              type="button"
              onClick={() => setWindow('today')}
              className={`px-1.5 py-0.5 rounded-[6px] ${window === 'today' ? 'text-[#0F172A] font-bold bg-[#F6F8FA]' : 'hover:text-[#0F172A]'}`}
            >
              Today
            </button>
            <span>/</span>
            <button
              type="button"
              onClick={() => setWindow('week')}
              className={`px-1.5 py-0.5 rounded-[6px] ${window === 'week' ? 'text-[#0F172A] font-bold bg-[#F6F8FA]' : 'hover:text-[#0F172A]'}`}
            >
              This Week
            </button>
          </div>
        </div>
      </div>

      {/* Honest Empty State / Real Payout Summary */}
      <div className="relative pt-4 pb-2 flex-1 flex flex-col justify-center">
        {(earnings?.amountEarned ?? 0) === 0 ? (
          <div className="rounded-[12px] bg-[#F6F8FA]/70 border border-[#EEF2F6] p-5 text-center flex flex-col items-center justify-center my-auto">
            <div className="text-xs font-semibold text-[#0F172A]">No settled payouts yet</div>
            <p className="text-xs text-[#475569] mt-1 max-w-xs">
              Payouts are settled automatically upon job completion. Active dispatch assignments will appear here.
            </p>
          </div>
        ) : (
          <div className="bg-[#FFFFFF] rounded-[12px] p-5 border border-[#EEF2F6] text-center my-auto">
            <span className="text-xs font-bold text-[#64748B] uppercase tracking-wider">
              {window === 'today' ? "Today's Settled Payout" : "This Week's Settled Payout"}
            </span>
            <div className="text-2xl font-bold text-[#0F766E] mt-1.5 tabular-nums">
              {privacyMode ? '₹••••' : formatRupees(earnings?.amountEarned ?? 0)}
            </div>
            <div className="text-xs text-[#475569] mt-1">
              {earnings?.jobsCompleted ?? 0} jobs completed
            </div>
          </div>
        )}
      </div>
    </section>
  );
};

/* ── 4. Center Bottom: Recent Dispatch Activity (Real Jobs from API) ──────── */

const RecentDispatchActivityCard: React.FC = () => {
  const { privacyMode } = useConsoleSettings();
  const { data: jobHistory, isLoading } = useQuery({
    queryKey: ['partner', 'recent-jobs'],
    queryFn: () => jobsService.listMyJobs({ limit: 6 }),
  });

  const jobs = jobHistory?.items ?? [];

  return (
    <section
      aria-label="Recent Jobs"
      className="bento-card p-5 flex flex-col h-[355px] overflow-hidden"
    >
      <h2 className="font-semibold text-lg text-[#0F172A] tracking-tight mb-3 shrink-0">
        Recent Dispatch Activity
      </h2>

      <div className="min-h-0 flex-1 overflow-y-auto -mx-1 px-1">
        {isLoading ? (
          <div className="space-y-2 py-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-12 rounded-[10px] bg-[#F6F8FA] animate-pulse" />
            ))}
          </div>
        ) : jobs.length === 0 ? (
          <div className="flex-1 h-full flex flex-col items-center justify-center text-center p-4">
            <Truck className="w-7 h-7 text-[#64748B] mb-1.5 opacity-50" />
            <p className="text-xs font-bold text-[#0F172A]">No recent dispatch activity</p>
            <p className="text-xs text-[#475569] mt-0.5 max-w-[200px]">
              Assigned and completed roadside jobs will appear here.
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            {jobs.map((job) => {
              const reqDate = new Date(job.requested_at);
              const day = reqDate.toLocaleDateString([], { weekday: 'short' });
              const date = reqDate.toLocaleDateString([], { day: 'numeric' });
              const priceText = job.price_final ? ` · ₹${job.price_final}` : '';
              const detail = `${job.pickup_address_text || 'Bengaluru'}${privacyMode ? ' · ₹••••' : priceText}`;

              return (
                <div
                  key={job.id}
                  className="flex items-center gap-2.5 p-2 rounded-[10px] hover:bg-[#F6F8FA]/70 transition-colors"
                >
                  <div className="text-center w-8 shrink-0">
                    <span className="block text-xs text-[#64748B] font-semibold uppercase leading-none">
                      {day}
                    </span>
                    <span className="block text-sm font-semibold text-[#0F172A] leading-none mt-0.5">
                      {date}
                    </span>
                  </div>

                  <span className="w-7 h-7 rounded-full bg-[#0F766E] text-white flex items-center justify-center shrink-0">
                    <Truck className="w-3.5 h-3.5" />
                  </span>

                  <div className="min-w-0 flex-1">
                    <h3 className="text-xs font-bold text-[#0F172A] truncate leading-tight">
                      {job.service_name || 'Roadside Job'}{' '}
                      {job.vehicle_number && (
                        <span className="font-mono font-medium text-[#475569]">{job.vehicle_number}</span>
                      )}
                    </h3>
                    <p className="text-xs text-[#475569] truncate">{detail}</p>
                  </div>

                  <span
                    className={`text-xs font-semibold px-2 py-0.5 rounded-full shrink-0 ${
                      job.status === 'in_progress' || job.status === 'partner_en_route'
                        ? 'bg-[#0F172A] text-white font-bold'
                        : 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                    }`}
                  >
                    {job.status === 'in_progress'
                      ? 'In progress'
                      : job.status === 'partner_en_route'
                        ? 'En route'
                        : job.status === 'completed'
                          ? 'Completed'
                          : job.status}
                  </span>

                  <Link
                    to={`/partner/jobs/${job.id}`}
                    aria-label={`Open job ${job.id}`}
                    className="p-1 text-[#64748B] hover:text-[#0F172A] transition-colors shrink-0"
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                  </Link>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
};

/* ── 5. Right Top: services linked to this partner (from the backend) ────── */

const FleetAndEquipmentCard: React.FC<{ profile: PartnerProfile }> = ({ profile }) => {
  const { data: services, isLoading, isError } = usePartnerServices();

  return (
    <section aria-label="Service Capabilities" className="bento-card p-5 flex flex-col">
      <h2 className="font-semibold text-lg tracking-tight mb-1">Your services</h2>
      <p className="text-sm text-ink-soft mb-4">What dispatch can offer you.</p>

      {isLoading ? (
        <p className="text-sm text-ink-muted" role="status">Loading…</p>
      ) : isError ? (
        <p className="text-sm text-emergency-700" role="alert">We could not load your services.</p>
      ) : (services ?? []).length === 0 ? (
        <p className="text-sm text-ink-soft">
          No services are linked yet. Choose them in Preferences to start receiving offers.
        </p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {(services ?? []).map((service) => (
            <li
              key={service.service_id}
              className="text-sm font-semibold bg-canvas border border-line px-3 py-1 rounded-full"
            >
              {service.name}
            </li>
          ))}
        </ul>
      )}

      <p className="mt-4 pt-3 border-t border-line text-xs text-ink-muted">
        {profile.name ? `${profile.name} · ` : ''}Services that need equipment (like towing) are enabled once
        the Sahayak team has verified it.
      </p>
    </section>
  );
};

/* ── 6. Right Bottom: Partner Identity & Team Standing ────────────────────── */

const PartnerStandingCard: React.FC<{ profile: PartnerProfile }> = ({ profile }) => {
  const { data: stats } = usePartnerTrustStats();

  const rating = stats?.ratingAvg ?? 0;
  const acceptance = stats?.acceptanceRatePct ?? 0;

  return (
    <section
      aria-label="Partner Profile"
      className="bento-card p-5 flex flex-col justify-between h-[355px]"
    >
      <div>
        <h2 className="font-semibold text-lg text-[#0F172A] tracking-tight mb-3">
          Partner Standing
        </h2>

        {/* Identity — one portrait, at the size an avatar is actually read at.
            A fanned stack of three stock headshots used to fill the top half of
            this card and say nothing about standing. */}
        <div className="flex items-center gap-3 pb-3 border-b border-[#EEF2F6]">
          <span aria-hidden="true" className="w-11 h-11 rounded-full   shrink-0 flex items-center justify-center bg-brand-700 text-white font-semibold">{profile.name.trim().charAt(0).toUpperCase()}</span>
          <div className="min-w-0">
            <div className="text-sm font-bold text-[#0F172A] truncate">{profile.name || 'Service partner'}</div>
            <div className="text-xs text-[#475569] truncate mt-0.5">{profile.phone}</div>
          </div>
        </div>

        {/* The headline number gets headline treatment. */}
        <div className="flex items-end justify-between gap-3 pt-3.5">
          <div>
            <div className="text-3xl font-semibold text-[#0F172A] tabular-nums leading-none">
              {rating > 0 ? rating.toFixed(1) : '—'}
            </div>
            <div className="text-xs text-[#64748B] font-medium mt-1.5">
              Rating over {stats?.ratingCount ?? 0} jobs
            </div>
          </div>
          <div className="text-right">
            <div className="text-3xl font-semibold text-[#0F172A] tabular-nums leading-none">
              {stats?.lifetimeJobs ?? 0}
            </div>
            <div className="text-xs text-[#64748B] font-medium mt-1.5">Jobs completed</div>
          </div>
        </div>

        {/* Acceptance rate is the one figure a partner can move this week, so
            it gets a bar rather than another number in a row of numbers. */}
        <div className="mt-4">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-bold uppercase tracking-wider text-[#64748B]">
              Offer acceptance
            </span>
            <span className="text-xs font-bold text-[#0F172A] tabular-nums">{acceptance}%</span>
          </div>
          <div
            role="progressbar"
            aria-valuenow={acceptance}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Offer acceptance rate"
            className="h-1.5 w-full rounded-full bg-[#EFE8DA] overflow-hidden"
          >
            <div className="h-full rounded-full bg-[#0F766E]" style={{ width: `${acceptance}%` }} />
          </div>
        </div>
      </div>

      <div className="pt-3 border-t border-[#EEF2F6] flex items-center gap-1.5">
        <ShieldCheck className="w-3.5 h-3.5 text-[#0F766E] shrink-0" />
        <span className="text-xs font-bold text-[#0F766E]">{verificationBadgeLabel(stats?.verificationStatus)}</span>
      </div>
    </section>
  );
};

/* ── Main Partner Dashboard Layout ────────────────────────────────────────── */

/**
 * The Dispatches view.
 *
 * `embedded` is what lets the console own the shell: when the console renders
 * this, the sidebar and canvas already exist around it, so it returns only its
 * own content. Rendered on its own (tests, or a direct mount) it still brings
 * its own shell so it is never a bare fragment floating on the page.
 */
export const PartnerDashboard: React.FC<{ embedded?: boolean }> = ({ embedded = false }) => {
  const profile = usePartnerProfile();
  const { isAvailable, setAvailable, locationAgeSeconds, refreshLocation } = usePartnerAvailability();

  const activeJobQuery = useActiveJob();
  const activeJob = activeJobQuery.data ?? null;

  const offerQuery = usePendingOffer(isAvailable && !activeJobQuery.isLoading && !activeJob);
  const offer = offerQuery.data ?? null;

  const { error: offerError, clearError } = useOfferResponse();

  const liveState = resolveLiveState({ activeJob, offer, isAvailable });
  const capability = capabilityLabel(derivePartnerCapability(profile));

  const content = (
    <>
      {/* Top Header Strip */}
      <TopBar profile={profile} capability={capability} hideTopRow={embedded} />

      {/* Error banner if offer error occurs */}
      {offerError && (
        <div className="mb-4 bg-rose-50 border border-rose-200 text-rose-800 text-xs px-4 py-2.5 rounded-2xl flex items-center justify-between">
          <span>{offerError}</span>
          <button type="button" onClick={clearError} className="font-bold underline">
            Dismiss
          </button>
        </div>
      )}

      {/* 3-Column Bento Grid matching exact reference structure with real Sahayak data */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        {/* Column 1: Left Dominant Satellite Map Card (~42% desktop width) */}
        <div className="lg:col-span-5 w-full">
          <LiveZoneMap
            liveState={liveState}
            profile={profile}
            offer={offer}
            activeJob={activeJob}
            onGoOnline={() => setAvailable(true)}
            locationAgeSeconds={locationAgeSeconds}
            onRefreshLocation={refreshLocation}
          />
        </div>

        {/* Column 2: Center Stack (Earnings & Settlements + Recent Dispatch Activity) (~33% width) */}
        <div className="lg:col-span-4 w-full flex flex-col gap-4">
          <EarningsAndSettlementsCard />
          <RecentDispatchActivityCard />
        </div>

        {/* Column 3: Right Stack (Fleet & Equipment + Partner Standing & Team) (~25% width) */}
        <div className="lg:col-span-3 w-full flex flex-col gap-4">
          <FleetAndEquipmentCard profile={profile} />
          <PartnerStandingCard profile={profile} />
        </div>
      </div>
    </>
  );

  if (embedded) return content;

  return (
    <div className="partner-shell">
      {/* ── Left Sidebar (Navigation Sidebar) ── */}
      <PartnerSidebar profile={profile} isAvailable={isAvailable} />

      {/* ── Main Content Area (Rounded Left White Canvas) ── */}
      <main className="partner-main-canvas flex flex-col">{content}</main>
    </div>
  );
};

export default PartnerDashboard;
