import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Bell,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  MapPin,
  MessageSquare,
  Plus,
  Power,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  TrendingUp,
  Truck,
  Wrench,
  Zap,
} from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { OfferTimer } from '../../components/OfferTimer';
import { JobTimeline } from '../../components/JobTimeline';
import { usePartnerAvailability } from '../../features/partners/usePartnerAvailability';
import { usePartnerProfile } from '../../features/partners/partnerStore';
import { updateConsoleSettings, useConsoleSettings } from '../../features/partners/consoleSettings';
import { useOptionalAuth, type UserRole } from '../../app/AuthProvider';
import {
  useActiveJob,
  useOfferResponse,
  usePartnerEarnings,
  usePartnerTrustStats,
  usePendingOffer,
} from '../../features/partners/useOffers';
import { IS_PARTNER_API_MOCK, partnerService } from '../../services/partner.service';
import {
  capabilityLabel,
  derivePartnerCapability,
  EQUIPMENT_TYPES,
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

/* ── 0. Left Sidebar: Warm Paper Stationery (Sahayak Identity) ─────────── */

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
  { view: 'preferences', label: 'Fleet & Preferences', Icon: Wrench, group: 'main', path: '/partner/preferences' },
  { view: 'verification', label: 'Verification & KYC', Icon: ShieldCheck, group: 'main', path: '/partner/verification' },
  { view: 'settings', label: 'Console Settings', Icon: Settings, group: 'settings', path: '/partner/settings' },
];

export const PartnerSidebar: React.FC<{
  profile: PartnerProfile;
  isAvailable: boolean;
  activeNav?: ConsoleView;
  /** When supplied, the nav swaps the view in place and never changes the
   *  route. Without it the same entries fall back to <Link>s, which is what
   *  keeps the standalone pages (and their tests) working on their own. */
  onNavigate?: (view: ConsoleView) => void;
  onSimulate?: () => void;
}> = ({ profile, isAvailable, activeNav = 'dispatches', onNavigate, onSimulate: _onSimulate }) => {
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
          ? 'citisum-active-pill'
          : 'text-[#5B5346] hover:text-[#1B1712] rounded-[10px] hover:bg-[#F6F1E6]/70'
      }`;
      const icon = (
        <Icon
          className={`w-4 h-4 shrink-0 ${isActive ? 'text-white' : view === 'settings' ? 'text-[#5B5346]' : 'text-[#0F766E]'}`}
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
        {/* Brand Header: Fraunces Serif Logo + Sahayak Deep Teal Emblem */}
        <div className="flex items-center gap-3 mb-6 pb-4 border-b border-[#E7E0D2]">
          <div className="w-9 h-9 rounded-[10px] bg-[#0F766E] flex items-center justify-center text-white shadow-xs shrink-0">
            <svg
              viewBox="0 0 24 24"
              className="w-5 h-5 text-white"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
            </svg>
          </div>
          <div className="min-w-0">
            <span className="font-['Fraunces'] font-semibold text-xl tracking-tight text-[#1B1712] block leading-tight">
              Sahayak
            </span>
            <span className="text-[10px] font-bold text-[#5B5346] tracking-wider uppercase block mt-0.5">
              Partner Console
            </span>
          </div>
        </div>

        {/* Section 1: MAIN MENU */}
        <div className="text-[10px] font-bold tracking-wider text-[#9A917F] uppercase px-3 mt-4 mb-2">
          MAIN MENU
        </div>

        <nav className="space-y-1 w-full">{renderNav('main')}</nav>

        {/* Section 2: SETTINGS */}
        <div className="text-[10px] font-bold tracking-wider text-[#9A917F] uppercase px-3 mt-6 mb-2">
          SETTINGS
        </div>

        <nav className="space-y-1 w-full">{renderNav('settings')}</nav>

        {/* Section 3: TODAY — the shift at a glance, on every view */}
        <div className="text-[10px] font-bold tracking-wider text-[#9A917F] uppercase px-3 mt-8 mb-2">
          Today
        </div>

        <div className="rounded-[14px] bg-[#FBF8F1] border border-[#E7E0D2] px-3.5 py-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="font-['Fraunces'] text-xl font-semibold text-[#1B1712] tabular-nums leading-none">
                {today?.jobsCompleted ?? 0}
              </div>
              <div className="text-[9px] text-[#9A917F] font-medium mt-1">Jobs done</div>
            </div>
            <div>
              <div className="font-['Fraunces'] text-xl font-semibold text-[#1B1712] tabular-nums leading-none">
                {privacyMode ? '₹••••' : formatRupees(today?.amountEarned ?? 0)}
              </div>
              <div className="text-[9px] text-[#9A917F] font-medium mt-1">Earned</div>
            </div>
          </div>
          <div className="mt-3 pt-2.5 border-t border-[#E7E0D2] flex items-center gap-1.5">
            <span
              className={`w-1.5 h-1.5 rounded-full shrink-0 ${isAvailable ? 'bg-emerald-600' : 'bg-neutral-300'}`}
            />
            <span className="text-[10px] font-semibold text-[#5B5346] truncate">
              {isAvailable ? 'On duty' : 'Off duty'} · {profile.extraDetails.operatingZone.split(' & ')[0]}
            </span>
          </div>
        </div>
      </div>

      {/* Partner Profile Badge Card at bottom of sidebar */}
      <div className="p-3 rounded-[14px] bg-[#FBF8F1] border border-[#E7E0D2] flex items-center gap-3 mt-6">
        <div className="relative shrink-0">
          <img
            src="/assets/partner_portrait.jpg"
            alt={profile.name}
            className="w-10 h-10 rounded-full object-cover ring-2 ring-[#0F766E]/40 shadow-xs"
          />
          <span
            className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-white ${
              isAvailable ? 'bg-emerald-600' : 'bg-neutral-300'
            }`}
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-bold text-xs text-[#1B1712] truncate leading-tight">
            {profile.name}
          </div>
          <div className="text-[10px] text-[#5B5346] font-medium truncate mt-0.5">
            Speedy Mechanics
          </div>
          <div className="text-[9px] text-[#0F766E] font-semibold flex items-center gap-1 mt-0.5">
            <span className="w-1.5 h-1.5 rounded-full bg-[#0F766E]" />
            <span>Tier 1 Verified</span>
          </div>
        </div>
      </div>
    </aside>
  );
};

/* ── 1. Top Bar: Header Strip with Search & Telemetry ─────────────────────── */

const TopBar: React.FC<{
  profile: PartnerProfile;
  capability: string;
  onSimulate?: () => void;
}> = ({ profile, capability, onSimulate }) => {
  const { isAvailable, toggle, locationAgeSeconds } = usePartnerAvailability();
  const auth = useOptionalAuth();

  return (
    <header className="w-full flex flex-col gap-4 mb-6">
      {/* Top Search + Actions + Profile Row */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        {/* Left: Main Search Bar */}
        <div className="flex-1 max-w-md">
          <div className="relative flex items-center bg-white hover:bg-[#FBF8F1] rounded-[12px] px-3.5 py-2 border border-[#E7E0D2] shadow-2xs transition-all">
            <Search className="w-4 h-4 text-[#9A917F] shrink-0 mr-2.5" />
            <input
              type="text"
              aria-label="Search dispatches"
              placeholder="Search a job ID or vehicle number"
              className="w-full bg-transparent text-xs text-[#1B1712] placeholder-[#9A917F] font-medium outline-none"
            />
          </div>
        </div>

        {/* Right: Messages + Notifications + Duty Switch + Avatar */}
        <div className="flex items-center gap-2.5 flex-wrap">
          {/* Messages Button */}
          <Link
            to="/partner/verification"
            className="w-9 h-9 rounded-[10px] bg-white hover:bg-[#FBF8F1] border border-[#E7E0D2] shadow-2xs flex items-center justify-center text-[#5B5346] hover:text-[#1B1712] transition-colors"
            title="Messages"
          >
            <MessageSquare className="w-4 h-4" />
          </Link>

          {/* Notifications Button */}
          <button
            type="button"
            className="w-9 h-9 rounded-[10px] bg-white hover:bg-[#FBF8F1] border border-[#E7E0D2] shadow-2xs flex items-center justify-center text-[#5B5346] hover:text-[#1B1712] transition-colors relative"
            title="Notifications"
          >
            <Bell className="w-4 h-4" />
            <span className="w-1.5 h-1.5 rounded-full bg-accent absolute top-2 right-2" />
          </button>

          {/* Optional Role Switcher for Demo / Dev */}
          {auth && (
            <div className="relative flex items-center bg-white hover:bg-[#FBF8F1] border border-[#E7E0D2] rounded-[10px] px-2.5 py-1.5 shadow-2xs transition-all">
              <div className="flex items-center gap-1.5 text-xs">
                <span className="text-[10px] font-bold text-[#9A917F] uppercase tracking-wider">Role</span>
                <span className="text-[#E7E0D2]">/</span>
                <select
                  value={auth.role}
                  onChange={(e) => auth.setRole(e.target.value as UserRole)}
                  className="bg-transparent text-xs font-semibold text-[#1B1712] outline-none cursor-pointer pr-3 appearance-none hover:text-black focus:ring-0"
                  aria-label="Switch User Role"
                >
                  <option value="owner">Owner (Asha)</option>
                  <option value="partner">Partner (Ramesh)</option>
                  <option value="ops">Admin (Ops)</option>
                </select>
              </div>
              <ChevronDown className="w-3 h-3 text-[#9A917F] pointer-events-none" />
            </div>
          )}

          {/* Duty Status Switch Pill (Tested by PartnerPages.test.tsx) */}
          <div className="flex items-center gap-2 bg-white rounded-[12px] px-3.5 py-1.5 border border-[#E7E0D2] shadow-2xs text-xs">
            <span className="text-[#5B5346] font-medium text-[11px]">Status:</span>
            <span className="relative flex h-2 w-2">
              {isAvailable && (
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              )}
              <span className={`relative inline-flex rounded-full h-2 w-2 ${isAvailable ? 'bg-emerald-600' : 'bg-neutral-300'}`} />
            </span>
            <span className="font-bold text-[#1B1712] text-[11px]">{isAvailable ? 'On Duty' : 'Off Duty'}</span>
            <button
              type="button"
              role="switch"
              aria-checked={isAvailable}
              aria-label="Toggle availability"
              onClick={toggle}
              className={`toggle-switch scale-75 origin-right ${isAvailable ? 'toggle-switch--active' : ''}`}
            >
              <span className="toggle-switch__thumb" />
            </button>
          </div>

          {/* GPS Freshness Pill */}
          <div className="hidden xl:flex items-center gap-1.5 bg-white rounded-[12px] px-3 py-1.5 border border-[#E7E0D2] shadow-2xs text-[11px]">
            <span className="text-[#5B5346] font-medium">GPS:</span>
            <span className="font-bold text-[#1B1712] tabular-nums">
              {/* No fix is "we don't know where you are", not a service-level
                  number — the old fallback quoted an arrival SLA here. */}
              {locationAgeSeconds !== null ? `Live (${formatAge(locationAgeSeconds)})` : 'No fix yet'}
            </span>
          </div>

          {/* User Profile Avatar with Teal Ring */}
          <div className="relative">
            <img
              src="/assets/partner_portrait.jpg"
              alt={profile.name}
              className="w-9 h-9 rounded-full object-cover ring-2 ring-[#0F766E]/40 shadow-xs"
              title={`${profile.name} (Speedy Mechanics)`}
            />
          </div>
        </div>
      </div>

      {/* Subheader Row: Fraunces Serif Title + Secondary Tabs + Action Button */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
        <div>
          <h1 className="font-['Fraunces'] text-2xl sm:text-3xl font-semibold text-[#1B1712] tracking-tight">
            Dispatch Console
          </h1>
          <p className="text-xs text-[#5B5346] mt-0.5">
            Live Bengaluru urban grid rescue operations & automated dispatch
          </p>

          {/* Secondary Action Tabs with Deep Teal Active Underline */}
          <div className="flex items-center gap-5 mt-3 text-xs font-semibold text-[#5B5346]">
            <button
              type="button"
              className="text-[#1B1712] font-bold pb-1 border-b-2 border-[#0F766E] cursor-pointer"
            >
              All dispatches
            </button>
            <button
              type="button"
              className="hover:text-[#1B1712] pb-1 cursor-pointer transition-colors"
            >
              Active fleet units
            </button>
            <button
              type="button"
              className="hover:text-[#1B1712] pb-1 cursor-pointer transition-colors"
            >
              Settlements & Payouts
            </button>
          </div>
        </div>

        {/* Right Action: Capability Badge + Quick Add / Simulate Button */}
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <div className="hidden lg:flex items-center gap-1.5 bg-white rounded-[10px] px-3 py-1.5 border border-[#E7E0D2] shadow-2xs text-[11px] font-bold text-[#1B1712]">
            <Wrench className="w-3.5 h-3.5 text-[#0F766E]" />
            <span>{capability}</span>
          </div>

          {onSimulate && (
            <button
              type="button"
              onClick={onSimulate}
              className="w-8 h-8 rounded-full bg-white hover:bg-[#FBF8F1] border border-[#E7E0D2] shadow-2xs flex items-center justify-center text-[#1B1712] hover:text-[#0F766E] transition-colors"
              title="Simulate incoming dispatch offer"
            >
              <Plus className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </header>
  );
};

/* ── 2. Left Dominant Card: Inland Bengaluru Satellite Map View ───────────── */

interface LiveZoneMapProps {
  liveState: LiveState;
  profile: PartnerProfile;
  offer: PartnerOffer | null;
  activeJob: Job | null;
  onGoOnline: () => void;
  onSimulate?: () => void;
  /** Whole seconds since the last position fix, or null when never located. */
  locationAgeSeconds: number | null;
  onRefreshLocation: () => void;
}

const LiveZoneMap: React.FC<LiveZoneMapProps> = ({
  liveState,
  profile,
  offer,
  activeJob,
  onGoOnline,
  onSimulate,
  locationAgeSeconds,
  onRefreshLocation,
}) => {
  const navigate = useNavigate();
  const { accept, reject, expire, isResponding } = useOfferResponse();
  const [offerExpiredAnnouncement, setOfferExpiredAnnouncement] = useState(false);

  const handleAccept = async () => {
    if (!offer) return;
    const job = await accept(offer.id);
    if (job) navigate(`/partner/jobs/${job.id}`);
  };

  const handleOfferExpire = () => {
    if (!offer) return;
    setOfferExpiredAnnouncement(true);
    expire(offer.id);
  };

  const isOffDuty = liveState === 'off_duty';

  return (
    <section
      data-testid={`live-state-${liveState}`}
      aria-label="Live Zone Map and Dispatch Telemetry"
      className="bento-card relative overflow-hidden h-[620px] lg:h-[720px] w-full flex flex-col justify-between group"
    >
      {/* Screen Reader ARIA Live Announcements */}
      <div aria-live="assertive" className="sr-only">
        {liveState === 'pending_offer' && 'New job offer received. 45 seconds to respond.'}
        {liveState === 'active_job' && 'Job accepted and active. Check progress below.'}
        {offerExpiredAnnouncement && 'Job offer expired and was reassigned.'}
      </div>
      <div aria-live="polite" className="sr-only">
        {liveState === 'off_duty' && 'You are now off duty. Dispatch is paused.'}
        {liveState === 'idle' && 'You are on duty. Scanning your zone for offers.'}
      </div>

      {/* Photorealistic Inland Bengaluru Aerial Map Background */}
      <img
        src="/assets/satellite_aerial_map.jpg"
        alt="Bengaluru Inland Urban Grid and Ring Road Flyovers"
        className={`absolute inset-0 w-full h-full object-cover select-none transition-all duration-700 ${
          isOffDuty ? 'filter grayscale contrast-125 opacity-70' : 'brightness-95 contrast-105'
        }`}
      />

      {/* SVG Overlay: Vector Connected Waypoint Route & Nodes */}
      <svg
        className="absolute inset-0 w-full h-full pointer-events-none z-10"
        viewBox="0 0 500 700"
        preserveAspectRatio="xMidYMid slice"
      >
        <defs>
          <filter id="bengaluru-node-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>

        {/* Connected Highway Route Polyline */}
        <path
          d="M 90 610 L 170 510 L 205 385 L 205 315 L 275 220 L 350 110"
          fill="none"
          stroke="#FFFFFF"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="drop-shadow-md"
        />

        {/* Waypoint 1 (Partner Station / Depot Start) */}
        <g transform="translate(90, 610)">
          <circle cx="0" cy="0" r="16" fill="rgba(255, 255, 255, 0.25)" filter="url(#bengaluru-node-glow)" />
          <circle cx="0" cy="0" r="7" fill="#FFFFFF" stroke="#181818" strokeWidth="2.5" />
        </g>

        {/* Waypoint 2 */}
        <g transform="translate(170, 510)">
          <circle cx="0" cy="0" r="14" fill="rgba(255, 255, 255, 0.2)" />
          <circle cx="0" cy="0" r="6" fill="#FFFFFF" stroke="#181818" strokeWidth="2" />
        </g>

        {/* Waypoint 3 (Active Dispatch Waypoint) */}
        <g transform="translate(205, 385)">
          <circle cx="0" cy="0" r="22" fill="rgba(255, 255, 255, 0.35)" className="animate-ping" style={{ animationDuration: '3s' }} />
          <circle cx="0" cy="0" r="16" fill="rgba(255, 255, 255, 0.3)" />
          <circle cx="0" cy="0" r="8" fill="#FFFFFF" stroke="#181818" strokeWidth="2.5" />
          <circle cx="0" cy="0" r="3" fill="#F03F3F" />
        </g>

        {/* Waypoint 4 */}
        <g transform="translate(205, 315)">
          <circle cx="0" cy="0" r="12" fill="rgba(255, 255, 255, 0.2)" />
          <circle cx="0" cy="0" r="5" fill="#FFFFFF" stroke="#181818" strokeWidth="2" />
        </g>

        {/* Waypoint 5 */}
        <g transform="translate(275, 220)">
          <circle cx="0" cy="0" r="14" fill="rgba(255, 255, 255, 0.2)" />
          <circle cx="0" cy="0" r="6" fill="#FFFFFF" stroke="#181818" strokeWidth="2" />
        </g>

        {/* Waypoint 6 (Route Terminus) */}
        <g transform="translate(350, 110)">
          <circle cx="0" cy="0" r="14" fill="rgba(255, 255, 255, 0.2)" />
          <circle cx="0" cy="0" r="6" fill="#FFFFFF" stroke="#181818" strokeWidth="2" />
        </g>
      </svg>

      {/* Top Floating Controls */}
      <div className="relative z-20 p-4 sm:p-5 flex items-center justify-between pointer-events-none">
        <div className="pointer-events-auto">
          <span className="glass-panel inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-semibold text-[#1B1712]">
            <MapPin className="w-3.5 h-3.5 text-[#0F766E]" />
            <span>{profile.extraDetails.operatingZone}</span>
            <span className="text-[#9A917F]">·</span>
            <span className="text-[#0F766E] font-bold">{profile.extraDetails.towCoverageRadiusKm} km</span>
          </span>
        </div>

        {/* One control, and it does the thing it says. An "Expand map" button
            over a static image and a duplicate of the sidebar's Settings entry
            were the only two here before, and neither did anything. */}
        <button
          type="button"
          onClick={onRefreshLocation}
          className="pointer-events-auto glass-panel inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold text-[#1B1712] hover:text-[#0F766E] transition-colors"
          title="Re-acquire GPS position"
        >
          <RefreshCw className="w-3.5 h-3.5 text-[#0F766E]" />
          <span className="tabular-nums">
            {locationAgeSeconds !== null ? `Fix ${formatAge(locationAgeSeconds)}` : 'Locate me'}
          </span>
        </button>
      </div>

      {/* Floating Translucent Route Info Card */}
      <div className="relative z-20 px-4 sm:px-6 pointer-events-auto my-auto">
        {/* STATE A: OFF DUTY */}
        {liveState === 'off_duty' && (
          <div
            data-testid="map-overlay-off-duty"
            className="glass-panel rounded-[18px] p-4 sm:p-5 text-[#1B1712] max-w-xs shadow-xl animate-in fade-in"
          >
            <div className="flex items-center gap-2 mb-2">
              <span className="w-2 h-2 rounded-full bg-[#9A917F]" />
              <span className="text-[10px] font-bold uppercase tracking-wider text-[#5B5346]">Dispatch Paused</span>
            </div>
            <h2 className="font-['Fraunces'] text-base sm:text-lg font-semibold text-[#1B1712] tracking-tight leading-snug">
              You are off duty
            </h2>
            <p className="text-xs text-[#5B5346] mt-1 leading-relaxed">
              Dispatch is not sending you offers and your GPS position is not being broadcast.
            </p>
            <div className="mt-4 pt-3 border-t border-[#E7E0D2] flex items-center justify-between gap-2">
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={onGoOnline}
                className="w-full text-xs font-semibold !bg-[#1B1712] hover:!bg-[#2A231C] text-white rounded-[12px] py-2 shadow-xs"
              >
                <Power className="w-3.5 h-3.5 mr-1.5" />
                <span>Go on duty</span>
              </Button>
            </div>
          </div>
        )}

        {/* STATE B: IDLE */}
        {liveState === 'idle' && (
          <div
            data-testid="map-overlay-idle"
            className="glass-panel rounded-[18px] p-4 text-[#1B1712] max-w-[270px] sm:max-w-[290px] shadow-xl animate-in fade-in"
          >
            <div className="flex items-center justify-between mb-2 pb-1.5 border-b border-[#E7E0D2]">
              <div className="flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-[#0F766E]" />
                <h2 className="text-xs font-bold text-[#1B1712] tracking-tight">Indiranagar Hub · Bengaluru Grid</h2>
              </div>
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            </div>

            {/* List with micro icons */}
            <div className="space-y-1.5 text-[11px] text-[#5B5346] my-2.5">
              <div className="flex items-center gap-2">
                <Truck className="w-3 h-3 text-[#0F766E] shrink-0" />
                <span className="truncate">Unit: KA-01-MJ-8899 (Ready)</span>
              </div>
              <div className="flex items-center gap-2">
                <TrendingUp className="w-3 h-3 text-emerald-600 shrink-0" />
                <span className="truncate">Avg SLA: 12–15m arrival</span>
              </div>
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-3 h-3 text-[#0F766E] shrink-0" />
                <span className="truncate">Verified Commercial Yellow Board</span>
              </div>
            </div>

            {/* Specified Single Plain Sentence Requirement */}
            <div className="pt-2 border-t border-[#E7E0D2]">
              <p className="text-xs font-semibold text-[#1B1712] leading-tight">
                You're available. Waiting for the next job.
              </p>
              {onSimulate && (
                /* A demo affordance, so it is labelled as one and sits below the
                   real status line rather than dressed up as a primary action. */
                <button
                  type="button"
                  onClick={onSimulate}
                  className="mt-1.5 text-[10px] font-semibold text-[#5B5346] hover:text-[#0F766E] underline underline-offset-2 decoration-[#C9C0AE] transition-colors"
                >
                  Demo: queue a test offer
                </button>
              )}
            </div>
          </div>
        )}

        {/* STATE C: PENDING OFFER (Intentional Exception: border-neutral-900) */}
        {liveState === 'pending_offer' && offer && (
          <div
            data-testid="map-overlay-pending-offer"
            className="glass-panel rounded-[18px] p-4 sm:p-5 text-[#1B1712] max-w-xs shadow-2xl border-2 border-neutral-900 animate-in fade-in"
          >
            <div className="flex items-center justify-between gap-2 mb-2 pb-2 border-b border-[#E7E0D2]">
              <span className="text-[10px] font-bold uppercase tracking-wider text-accent bg-red-50 px-2 py-0.5 rounded-full border border-red-200">
                Incoming Dispatch Offer
              </span>
              <OfferTimer offeredAt={offer.offeredAt} onExpire={handleOfferExpire} />
            </div>

            <h2 className="font-['Fraunces'] text-sm font-semibold text-[#1B1712] truncate mb-0.5">{offer.serviceName}</h2>
            <p className="text-[11px] font-mono text-[#5B5346] mb-2">{offer.vehicleNumber}</p>

            {offer.payoutEstimate !== undefined && (
              <div className="mb-2 p-2 bg-[#FBF8F1] rounded-[10px] border border-[#E7E0D2] flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-[#9A917F]">Est. Payout</span>
                <span className="font-['Fraunces'] text-base font-semibold text-[#1B1712] tabular-nums">{formatRupees(offer.payoutEstimate)}</span>
              </div>
            )}

            <div className="text-[11px] text-[#5B5346] mb-3 space-y-1">
              <p className="truncate">📍 {offer.pickupAddressText}</p>
              <p className="text-[#9A917F] tabular-nums">ETA: ~{formatDistance(offer.distanceAtOfferM)} away</p>
            </div>

            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isResponding}
                onClick={() => reject(offer.id)}
                className="flex-1 text-xs font-semibold text-[#5B5346] !border-[#E7E0D2] hover:bg-[#F6F1E6] rounded-[12px]"
              >
                Reject
              </Button>
              <Button
                type="button"
                variant="primary"
                size="sm"
                disabled={isResponding}
                onClick={handleAccept}
                className="flex-1 text-xs font-semibold !bg-accent hover:!bg-accent-hover text-white rounded-[12px] shadow-sm border-0"
              >
                Accept Job
              </Button>
            </div>
          </div>
        )}

        {/* STATE D: ACTIVE JOB */}
        {liveState === 'active_job' && activeJob && (
          <div
            data-testid="map-overlay-active-job"
            className="glass-panel rounded-[18px] p-4 sm:p-5 text-[#1B1712] max-w-xs shadow-2xl animate-in fade-in"
          >
            <div className="flex items-center gap-2 mb-2 pb-1.5 border-b border-[#E7E0D2]">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-800">Job In Progress</span>
            </div>
            <h2 className="font-['Fraunces'] text-sm font-semibold text-[#1B1712] truncate">{activeJob.service?.name || 'Roadside Assistance'}</h2>
            <p className="text-[11px] font-mono text-[#5B5346] mb-2">{activeJob.vehicle_number}</p>
            <div className="mb-3">
              <JobTimeline status={activeJob.status} variant="compact" />
            </div>
            <Link
              to={`/partner/jobs/${activeJob.id}`}
              className="w-full flex items-center justify-center gap-1 text-xs font-semibold text-[#1B1712] bg-[#F6F1E6] hover:bg-[#EFE8DA] border border-[#E7E0D2] py-2 rounded-[12px] transition-all"
            >
              <span>View Full Progress</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        )}
      </div>

      {/* Bottom Floating Bar: the unit this map is actually tracking.
          It replaces a dock of five controls where "Filter zones", "Dispatch"
          and "Recenter" did nothing at all and the other two were duplicates of
          sidebar entries one click away. */}
      <div className="relative z-20 p-4 sm:p-5 pointer-events-none">
        <div className="pointer-events-auto glass-dock rounded-[14px] px-3.5 py-2.5 flex items-center justify-between gap-3 shadow-md border border-[#E7E0D2]">
          <div className="flex items-center gap-2 min-w-0">
            <Truck className="w-4 h-4 text-[#0F766E] shrink-0" />
            <div className="min-w-0">
              <div className="text-[11px] font-bold text-[#1B1712] font-mono truncate">
                {profile.extraDetails.towRegistrationNumber}
              </div>
              <div className="text-[9px] text-[#5B5346] font-medium truncate">
                {profile.extraDetails.workshopName} · {profile.extraDetails.teamSize} on shift
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <span
              className={`w-1.5 h-1.5 rounded-full ${isOffDuty ? 'bg-neutral-400' : 'bg-emerald-500 animate-pulse'}`}
            />
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#5B5346]">
              {isOffDuty ? 'Not broadcasting' : 'Broadcasting'}
            </span>
          </div>
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

  // 32 High-Density Bars representing weekly dispatch revenue flow
  const DENSITY_BARS = [
    // Tue 22
    { h: 35, active: false }, { h: 55, active: false }, { h: 40, active: false }, { h: 60, active: false },
    { h: 25, active: false }, { h: 48, active: false }, { h: 68, active: false }, { h: 50, active: false },
    // Today 23 (Active Peak with highlighted brand accent cluster)
    { h: 65, active: true }, { h: 80, active: true }, { h: 95, active: true }, { h: 72, active: true },
    { h: 88, active: true }, { h: 78, active: true }, { h: 60, active: true }, { h: 70, active: true },
    // Thu 24 (Estimated / Scheduled)
    { h: 42, active: false }, { h: 58, active: false }, { h: 52, active: false }, { h: 45, active: false },
    { h: 62, active: false }, { h: 75, active: false }, { h: 58, active: false }, { h: 65, active: false },
    // Fri 25 (Estimated / Scheduled)
    { h: 30, active: false }, { h: 45, active: false }, { h: 55, active: false }, { h: 70, active: false },
    { h: 64, active: false }, { h: 52, active: false }, { h: 40, active: false }, { h: 35, active: false },
  ];

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
          <h2 className="font-['Fraunces'] font-semibold text-lg text-[#1B1712] tracking-tight truncate min-w-0">
            Earnings &amp; Settlements
          </h2>

          <div className="flex items-center gap-1.5 shrink-0">
            {changePct !== null && !privacyMode && (
              <span
                className={`inline-flex items-center gap-1 text-[10px] font-bold ${
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
                <span className="font-medium text-[#9A917F]">
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
              className="p-1 text-[#9A917F] hover:text-[#1B1712] transition-colors shrink-0"
              title={privacyMode ? 'Show earnings figures' : 'Hide earnings figures'}
            >
              {privacyMode ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3">
          {/* Settled-to-date only. "Today" lived here as well as in the chart
              callout, so the same figure was printed twice on one card. */}
          <span className="text-xs text-[#5B5346]">
            Settled to date:{' '}
            <strong className="text-[#1B1712] tabular-nums">{privacyMode ? '₹••••' : '₹48,250'}</strong>
            <span className="text-[#C9C0AE] mx-1.5">·</span>
            <strong className="text-[#1B1712] tabular-nums">{earnings?.jobsCompleted ?? 0}</strong> jobs{' '}
            {window === 'today' ? 'today' : 'this week'}
          </span>

          {/* Period tabs */}
          <div className="flex items-center gap-1 text-[10px] font-semibold text-[#9A917F] shrink-0">
            <button
              type="button"
              onClick={() => setWindow('today')}
              className={`px-1.5 py-0.5 rounded-[6px] ${window === 'today' ? 'text-[#1B1712] font-bold bg-[#F6F1E6]' : 'hover:text-[#1B1712]'}`}
            >
              Today
            </button>
            <span>/</span>
            <button
              type="button"
              onClick={() => setWindow('week')}
              className={`px-1.5 py-0.5 rounded-[6px] ${window === 'week' ? 'text-[#1B1712] font-bold bg-[#F6F1E6]' : 'hover:text-[#1B1712]'}`}
            >
              This Week
            </button>
          </div>
        </div>
      </div>

      {/* High-Density Bar Chart with Floating Leader Callout */}
      <div className="relative pt-6 pb-2">
        {/* Floating Callout Pill */}
        <div className="absolute top-0 left-[36%] transform -translate-x-1/2 flex flex-col items-center pointer-events-none">
          <div className="bg-[#FBF8F1] rounded-[10px] px-2.5 py-1 shadow-md border border-[#E7E0D2] text-center flex flex-col items-center">
            <span className="text-[9px] font-bold text-[#9A917F] uppercase tracking-wider">
              {window === 'today' ? "Today's Payout" : "This Week's Payout"}
            </span>
            <span className="font-['Fraunces'] text-sm font-semibold text-[#1B1712] tracking-tight tabular-nums">
              {privacyMode ? '₹••••' : formatRupees(earnings?.amountEarned ?? 8400)}
            </span>
          </div>
          <div className="w-px h-4 bg-[#E7E0D2]" />
        </div>

        {/* 32 Thin Bars */}
        <div className="flex items-end justify-between gap-1 h-32 px-1">
          {DENSITY_BARS.map((bar, idx) => (
            <div
              key={idx}
              className="flex-1 rounded-t-sm transition-all duration-200"
              style={{
                height: `${bar.h}%`,
                backgroundColor: bar.active ? '#0F766E' : '#EFE8DA',
                borderTop: bar.active ? '2px solid #115E59' : 'none',
              }}
            />
          ))}
        </div>

        {/* Chronological Day Labels */}
        <div className="flex items-center justify-between text-[10px] font-medium text-[#9A917F] pt-2 border-t border-[#E7E0D2]">
          <span className="flex-1 text-center">Tue 22</span>
          <span className="flex-1 text-center font-bold text-[#1B1712]">Today (23)</span>
          <span className="flex-1 text-center">Thu 24</span>
          <span className="flex-1 text-center">Fri 25</span>
        </div>
      </div>
    </section>
  );
};

/* ── 4. Center Bottom: Recent Dispatch Activity (Real Bengaluru Jobs) ──────── */

/** One row per settled or running job. This was four copy-pasted blocks of
 *  near-identical markup — the shape is the same for every row, so it is one
 *  component and a list now. */
interface DispatchLogEntry {
  id: string;
  day: string;
  date: string;
  Icon: typeof Truck;
  iconTone: string;
  title: string;
  vehicle: string;
  detail: string;
  status: 'in_progress' | 'completed';
}

const DISPATCH_LOG: ReadonlyArray<{ heading: string; rows: ReadonlyArray<DispatchLogEntry> }> = [
  {
    heading: 'Today · 23 Sep',
    rows: [
      {
        id: 'job_orr_8899',
        day: 'Wed',
        date: '23',
        Icon: Truck,
        iconTone: 'bg-[#0F766E]',
        title: 'Outer Ring Road breakdown',
        vehicle: 'KA-01-MJ-8899',
        detail: 'Flatbed recovery · ₹1,850 · 14m to arrival',
        status: 'in_progress',
      },
      {
        id: 'job_ind_1290',
        day: 'Wed',
        date: '23',
        Icon: Zap,
        iconTone: 'bg-amber-600',
        title: 'Indiranagar jumpstart',
        vehicle: 'KA-05-NB-1290',
        detail: 'Rapid battery jumpstart · ₹650 · Settled T+0',
        status: 'completed',
      },
      {
        id: 'job_kor_4002',
        day: 'Wed',
        date: '23',
        Icon: Wrench,
        iconTone: 'bg-[#0F766E]',
        title: 'Koramangala flat tyre',
        vehicle: 'KA-51-TR-4002',
        detail: 'On-site tyre support · ₹500 · Settled T+0',
        status: 'completed',
      },
    ],
  },
  {
    heading: 'Yesterday · 22 Sep',
    rows: [
      {
        id: 'job_mgr_3312',
        day: 'Tue',
        date: '22',
        Icon: Wrench,
        iconTone: 'bg-[#1B1712]',
        title: 'MG Road minor repair',
        vehicle: 'KA-03-HA-3312',
        detail: 'Coolant leakage fix · ₹1,200 · Settled T+0',
        status: 'completed',
      },
    ],
  },
];

const DispatchLogRow: React.FC<{ entry: DispatchLogEntry; masked: boolean }> = ({ entry, masked }) => (
  <div className="flex items-center gap-2.5 p-2 rounded-[10px] hover:bg-[#F6F1E6]/70 transition-colors">
    <div className="text-center w-8 shrink-0">
      <span className="block text-[9px] text-[#9A917F] font-semibold uppercase leading-none">{entry.day}</span>
      <span className="block font-['Fraunces'] text-sm font-semibold text-[#1B1712] leading-none mt-0.5">
        {entry.date}
      </span>
    </div>

    {/* The service icon, which says what kind of job this was. It used to be
        paired with a stock headshot that was the same face on every row. */}
    <span
      className={`w-7 h-7 rounded-full ${entry.iconTone} text-white flex items-center justify-center shrink-0`}
    >
      <entry.Icon className="w-3.5 h-3.5" />
    </span>

    <div className="min-w-0 flex-1">
      <h3 className="text-xs font-bold text-[#1B1712] truncate leading-tight">
        {entry.title} <span className="font-mono font-medium text-[#5B5346]">{entry.vehicle}</span>
      </h3>
      <p className="text-[10px] text-[#5B5346] truncate">
        {masked ? entry.detail.replace(/₹[\d,]+/, '₹••••') : entry.detail}
      </p>
    </div>

    {entry.status === 'in_progress' ? (
      <span className="bg-[#1B1712] text-white text-[9px] font-bold px-2.5 py-0.5 rounded-full shrink-0">
        In progress
      </span>
    ) : (
      <span className="bg-emerald-50 text-emerald-800 text-[9px] font-semibold px-2 py-0.5 rounded-full shrink-0 border border-emerald-200">
        Completed
      </span>
    )}

    {/* One affordance, not a view/edit pair — a settled job is not editable. */}
    <Link
      to={`/partner/jobs/${entry.id}`}
      aria-label={`Open ${entry.title}`}
      className="p-1 text-[#9A917F] hover:text-[#1B1712] transition-colors shrink-0"
    >
      <ChevronRight className="w-3.5 h-3.5" />
    </Link>
  </div>
);

const RecentDispatchActivityCard: React.FC = () => {
  const { privacyMode } = useConsoleSettings();

  return (
    <section
      aria-label="Recent Jobs"
      className="bento-card p-5 flex flex-col h-[355px] overflow-hidden"
    >
      <h2 className="font-['Fraunces'] font-semibold text-lg text-[#1B1712] tracking-tight mb-3 shrink-0">
        Recent Dispatch Activity
      </h2>

      <div className="min-h-0 flex-1 overflow-y-auto -mx-1 px-1">
        {DISPATCH_LOG.map((group) => (
          <div key={group.heading}>
            <div className="text-[10px] font-bold text-[#9A917F] uppercase tracking-wider mb-2 mt-3 first:mt-0">
              {group.heading}
            </div>
            <div className="space-y-1">
              {group.rows.map((entry) => (
                <DispatchLogRow key={entry.id} entry={entry} masked={privacyMode} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
};

/* ── 5. Right Top: Fleet & Equipment Readiness ────────────────────────────── */

const FleetAndEquipmentCard: React.FC<{ profile: PartnerProfile }> = ({ profile }) => {
  const activeServices = profile.services.filter((service) => service.active);
  const unitLabel =
    profile.extraDetails.mechanicUnitType === 'mobile_van'
      ? 'Mobile workshop van'
      : profile.extraDetails.mechanicUnitType === 'bike_toolkit'
        ? 'Bike toolkit unit'
        : 'Workshop dispatch';

  return (
    <section
      aria-label="Service Capabilities"
      className="bento-card p-5 flex flex-col justify-between h-[345px]"
    >
      <div className="min-h-0 flex flex-col">
        <h2 className="font-['Fraunces'] font-semibold text-lg text-[#1B1712] tracking-tight mb-3">
          Fleet &amp; Equipment
        </h2>

        {/* The unit that is actually on the road, read from the profile rather
            than hard-coded. This slot used to hold three stock photographs of
            trucks that were not this partner's trucks. */}
        <div className="rounded-[12px] bg-[#FBF8F1] border border-[#E7E0D2] px-3.5 py-3 mb-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="text-xs font-bold text-[#1B1712] leading-tight truncate">{unitLabel}</h3>
              <p className="text-[10px] font-mono text-[#5B5346] mt-0.5 truncate">
                {profile.extraDetails.towRegistrationNumber}
              </p>
            </div>
            <span className="text-[9px] font-bold uppercase tracking-wider text-[#0F766E] bg-[#0F766E]/10 border border-[#0F766E]/20 px-2 py-0.5 rounded-full shrink-0">
              {EQUIPMENT_TYPES.find((e) => e.code === profile.extraDetails.towTruckType)?.label ?? 'Recovery unit'}
            </span>
          </div>
          <p className="text-[10px] text-[#5B5346] mt-2 leading-snug">
            {profile.extraDetails.towCapacity}
            {profile.extraDetails.winchEquipped ? ' · Winch equipped' : ''}
          </p>
        </div>

        {/* What this unit is dispatched for */}
        <div className="min-h-0 flex-1 overflow-hidden">
          <div className="text-[9px] font-bold uppercase tracking-wider text-[#9A917F] mb-1.5">
            Accepting {activeServices.length} of {profile.services.length} services
          </div>
          <div className="flex flex-wrap gap-1.5">
            {activeServices.slice(0, 4).map((service) => (
              <span
                key={service.id}
                className="text-[10px] font-semibold text-[#1B1712] bg-[#F6F1E6] border border-[#E7E0D2] px-2 py-0.5 rounded-full truncate max-w-full"
              >
                {service.name}
              </span>
            ))}
            {activeServices.length > 4 && (
              <span className="text-[10px] font-semibold text-[#5B5346] px-1 py-0.5">
                +{activeServices.length - 4} more
              </span>
            )}
          </div>
        </div>

        {/* 2-Column Metrics — both measured, both from the profile. A third
            column reading "24/7 · Active readiness" was restating the duty
            toggle as if it were a statistic. */}
        <div className="grid grid-cols-2 gap-2 py-2 border-t border-b border-[#E7E0D2] text-left mt-3">
          <div>
            <div className="text-xs font-bold text-[#1B1712] tabular-nums">
              {profile.extraDetails.towCoverageRadiusKm} km
            </div>
            <div className="text-[9px] text-[#9A917F] font-medium">Coverage radius</div>
          </div>
          <div>
            <div className="text-xs font-bold text-[#1B1712] tabular-nums">
              {profile.extraDetails.availabilityMode === '24_7' ? '24 / 7' : 'Daytime'}
            </div>
            <div className="text-[9px] text-[#9A917F] font-medium">Availability window</div>
          </div>
        </div>
      </div>

      {/* Action Row */}
      <div className="flex items-center justify-between gap-2 pt-2">
        <span className="px-3.5 py-1.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 font-bold text-xs flex items-center gap-1">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
          <span>Active on grid</span>
        </span>
        <span className="text-[10px] text-[#9A917F] font-medium truncate">
          {profile.extraDetails.operatingZone}
        </span>
      </div>
    </section>
  );
};

/* ── 6. Right Bottom: Partner Identity & Team Standing ────────────────────── */

const PartnerStandingCard: React.FC<{ profile: PartnerProfile }> = ({ profile }) => {
  const { data: stats } = usePartnerTrustStats();

  const rating = stats?.ratingAvg ?? 4.8;
  const acceptance = stats?.acceptanceRatePct ?? 92;

  return (
    <section
      aria-label="Partner Profile"
      className="bento-card p-5 flex flex-col justify-between h-[355px]"
    >
      <div>
        <h2 className="font-['Fraunces'] font-semibold text-lg text-[#1B1712] tracking-tight mb-3">
          Partner Standing
        </h2>

        {/* Identity — one portrait, at the size an avatar is actually read at.
            A fanned stack of three stock headshots used to fill the top half of
            this card and say nothing about standing. */}
        <div className="flex items-center gap-3 pb-3 border-b border-[#E7E0D2]">
          <img
            src="/assets/partner_portrait.jpg"
            alt={profile.name}
            className="w-11 h-11 rounded-full object-cover ring-2 ring-[#0F766E]/40 shrink-0"
          />
          <div className="min-w-0">
            <div className="text-xs font-bold text-[#1B1712] truncate">{profile.name}</div>
            <div className="text-[10px] text-[#5B5346] truncate mt-0.5">
              {profile.extraDetails.workshopName} · {profile.extraDetails.teamSize} on the roster
            </div>
          </div>
        </div>

        {/* The headline number gets headline treatment. */}
        <div className="flex items-end justify-between gap-3 pt-3.5">
          <div>
            <div className="font-['Fraunces'] text-3xl font-semibold text-[#1B1712] tabular-nums leading-none">
              {rating.toFixed(1)}
            </div>
            <div className="text-[10px] text-[#9A917F] font-medium mt-1.5">
              Rating over {stats?.ratingCount ?? 118} jobs
            </div>
          </div>
          <div className="text-right">
            <div className="font-['Fraunces'] text-3xl font-semibold text-[#1B1712] tabular-nums leading-none">
              {stats?.lifetimeJobs ?? 142}
            </div>
            <div className="text-[10px] text-[#9A917F] font-medium mt-1.5">Jobs completed</div>
          </div>
        </div>

        {/* Acceptance rate is the one figure a partner can move this week, so
            it gets a bar rather than another number in a row of numbers. */}
        <div className="mt-4">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#9A917F]">
              Offer acceptance
            </span>
            <span className="text-[11px] font-bold text-[#1B1712] tabular-nums">{acceptance}%</span>
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

      <div className="pt-3 border-t border-[#E7E0D2] flex items-center gap-1.5">
        <ShieldCheck className="w-3.5 h-3.5 text-[#0F766E] shrink-0" />
        <span className="text-[11px] font-bold text-[#0F766E]">Tier 1 Verified</span>
        <span className="text-[10px] text-[#9A917F] ml-auto">
          {profile.verificationItems.filter((item) => item.status === 'complete').length}/
          {profile.verificationItems.length} checks cleared
        </span>
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

  const simulate = IS_PARTNER_API_MOCK
    ? () => {
        void partnerService.simulateIncomingOffer().then(() => offerQuery.refetch());
      }
    : undefined;

  const content = (
    <>
      {/* Top Header Strip */}
      <TopBar profile={profile} capability={capability} />

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
            onSimulate={simulate}
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
      {/* ── Left Sidebar (Mockup Match) ── */}
      <PartnerSidebar profile={profile} isAvailable={isAvailable} onSimulate={simulate} />

      {/* ── Main Content Area (Rounded Left White Canvas) ── */}
      <main className="partner-main-canvas flex flex-col">{content}</main>
    </div>
  );
};

export default PartnerDashboard;
