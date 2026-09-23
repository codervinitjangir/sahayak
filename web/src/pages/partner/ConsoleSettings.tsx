import React, { useState } from 'react';
import {
  Bell,
  BellRing,
  Clock,
  Database,
  Eye,
  EyeOff,
  MapPin,
  MessageSquare,
  Phone,
  Plus,
  RotateCcw,
  Ruler,
  Settings,
  ShieldCheck,
  Users,
  Volume2,
} from 'lucide-react';

import { usePartnerAvailability } from '../../features/partners/usePartnerAvailability';
import { resetPartnerStore, usePartnerProfile } from '../../features/partners/partnerStore';
import {
  resetConsoleSettings,
  updateConsoleSettings,
  useConsoleSettings,
  type ClockFormat,
  type ConsoleSettings,
  type DistanceUnit,
} from '../../features/partners/consoleSettings';
import { IS_PARTNER_API_MOCK, partnerService } from '../../services/partner.service';
import type { ConsoleView } from './PartnerDashboard';
import './partner.css';

/* ── Shared row primitives ────────────────────────────────────────────────── */

/** A labelled switch. The label is the button's accessible name, so every row
 *  is reachable by name in a test and by a screen reader without a title. */
const ToggleRow: React.FC<{
  Icon: typeof Bell;
  label: string;
  hint: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}> = ({ Icon, label, hint, checked, onChange }) => (
  <div className="flex items-start justify-between gap-4 py-3 border-b border-[#F0EADB] last:border-b-0">
    <div className="flex items-start gap-3 min-w-0">
      <span className="w-8 h-8 rounded-[10px] bg-[#F6F1E6] border border-[#E7E0D2] flex items-center justify-center shrink-0 mt-0.5">
        <Icon className={`w-4 h-4 ${checked ? 'text-[#0F766E]' : 'text-[#9A917F]'}`} />
      </span>
      <div className="min-w-0">
        <div className="text-xs font-bold text-[#1B1712]">{label}</div>
        <p className="text-[11px] text-[#5B5346] mt-0.5 leading-snug">{hint}</p>
      </div>
    </div>
    <div className="flex items-center gap-2 shrink-0 pt-1">
      {/* Never state by colour alone — the word carries the state too. */}
      <span className="text-[10px] font-bold uppercase tracking-wider text-[#5B5346] tabular-nums w-6 text-right">
        {checked ? 'On' : 'Off'}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`toggle-switch ${checked ? 'toggle-switch--active' : ''}`}
      >
        <span className="toggle-switch__thumb" />
      </button>
    </div>
  </div>
);

/** Two-or-more mutually exclusive options, rendered as one segmented control. */
function SegmentedRow<T extends string>({
  Icon,
  label,
  hint,
  value,
  options,
  onChange,
}: {
  Icon: typeof Bell;
  label: string;
  hint: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (next: T) => void;
}): React.ReactElement {
  return (
    <div className="flex items-start justify-between gap-4 py-3 border-b border-[#F0EADB] last:border-b-0">
      <div className="flex items-start gap-3 min-w-0">
        <span className="w-8 h-8 rounded-[10px] bg-[#F6F1E6] border border-[#E7E0D2] flex items-center justify-center shrink-0 mt-0.5">
          <Icon className="w-4 h-4 text-[#0F766E]" />
        </span>
        <div className="min-w-0">
          <div className="text-xs font-bold text-[#1B1712]">{label}</div>
          <p className="text-[11px] text-[#5B5346] mt-0.5 leading-snug">{hint}</p>
        </div>
      </div>
      <div
        role="radiogroup"
        aria-label={label}
        className="flex items-center gap-0.5 bg-[#F6F1E6] border border-[#E7E0D2] rounded-[10px] p-0.5 shrink-0"
      >
        {options.map((option) => {
          const isActive = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={isActive}
              onClick={() => onChange(option.value)}
              className={`px-2.5 py-1 rounded-[8px] text-[11px] font-bold transition-all ${
                isActive ? 'bg-[#0F766E] text-white shadow-2xs' : 'text-[#5B5346] hover:text-[#1B1712]'
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** A read-only fact. Left-aligned, because a centred icon in a circle says
 *  nothing that the value itself does not say better. */
const FactRow: React.FC<{ Icon: typeof Bell; label: string; value: string }> = ({ Icon, label, value }) => (
  <div className="flex items-center justify-between gap-3 py-2.5 border-b border-[#F0EADB] last:border-b-0">
    <div className="flex items-center gap-2.5 min-w-0">
      <Icon className="w-3.5 h-3.5 text-[#9A917F] shrink-0" />
      <span className="text-[11px] font-medium text-[#5B5346] truncate">{label}</span>
    </div>
    <span className="text-[11px] font-bold text-[#1B1712] text-right truncate">{value}</span>
  </div>
);

const CardHeading: React.FC<{ title: string; caption: string }> = ({ title, caption }) => (
  <div className="mb-1">
    <h2 className="text-sm font-bold text-[#1B1712] font-['Fraunces']">{title}</h2>
    <p className="text-[11px] text-[#5B5346] mt-0.5">{caption}</p>
  </div>
);

/* ── The view ─────────────────────────────────────────────────────────────── */

const DISTANCE_OPTIONS: ReadonlyArray<{ value: DistanceUnit; label: string }> = [
  { value: 'km', label: 'KM' },
  { value: 'mi', label: 'MI' },
];

const CLOCK_OPTIONS: ReadonlyArray<{ value: ClockFormat; label: string }> = [
  { value: '12h', label: '12 h' },
  { value: '24h', label: '24 h' },
];

/**
 * Console Settings — the fourth sidebar destination.
 *
 * Fleet & Preferences describes what the partner *can do*; this describes how
 * the console *behaves* for them. Everything here is client state (see
 * consoleSettings.ts) — nothing on this screen needs a backend round-trip, so
 * nothing on it has a Save button: each control applies as it is flipped.
 */
export const ConsoleSettingsView: React.FC<{
  embedded?: boolean;
  /** Supplied by the console so a cross-reference swaps the view in place. */
  onNavigate?: (view: ConsoleView) => void;
}> = ({ embedded = false, onNavigate }) => {
  const profile = usePartnerProfile();
  const { isAvailable, toggle } = usePartnerAvailability();
  const settings = useConsoleSettings();
  const [notice, setNotice] = useState<string | null>(null);

  const set = <K extends keyof ConsoleSettings>(key: K, value: ConsoleSettings[K]) => {
    updateConsoleSettings({ [key]: value } as Partial<ConsoleSettings>);
  };

  const handleReset = () => {
    resetConsoleSettings();
    setNotice('Console settings restored to defaults.');
  };

  const handleResetDemoData = () => {
    resetPartnerStore();
    setNotice('Demo partner data reset — profile, verification and duty state are back to seed values.');
  };

  const handleSimulate = () => {
    void partnerService.simulateIncomingOffer().then(() => {
      setNotice('A dispatch offer was queued. Open Dispatches to respond to it.');
    });
  };

  const body = (
    <div className="w-full flex flex-col gap-5">
      {/* Header — same shape as the other three views so the canvas does not
          jump when the sidebar swaps the view. */}
      <header className="w-full flex flex-col gap-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
              <span className="text-[11px] font-bold tracking-wider text-[#0F766E] uppercase bg-[#0F766E]/10 px-2.5 py-0.5 rounded-full border border-[#0F766E]/20">
                Console Preferences
              </span>
              <span className="text-xs font-medium text-[#5B5346]">Applies to this device</span>
            </div>
            <h1 className="font-['Fraunces'] text-2xl sm:text-3xl font-semibold text-[#1B1712] tracking-tight">
              Console Settings
            </h1>
            <p className="text-xs text-[#5B5346] mt-0.5">
              Alerts, display units and duty behaviour for the dispatch console — every change saves as you make it
            </p>
          </div>

          <div className="flex items-center gap-2.5 flex-wrap">
            {/* Duty Status Switch Pill */}
            <div className="flex items-center gap-2 bg-white rounded-[12px] px-3.5 py-1.5 border border-[#E7E0D2] shadow-2xs text-xs">
              <span className="text-[#5B5346] font-medium text-[11px]">Status:</span>
              <span className="relative flex h-2 w-2">
                {isAvailable && (
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                )}
                <span
                  className={`relative inline-flex rounded-full h-2 w-2 ${
                    isAvailable ? 'bg-emerald-600' : 'bg-neutral-300'
                  }`}
                />
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

            <button
              type="button"
              onClick={handleReset}
              className="px-3.5 py-1.5 rounded-[10px] bg-white hover:bg-[#FBF8F1] border border-[#E7E0D2] shadow-2xs text-xs font-semibold text-[#1B1712] flex items-center gap-1.5 transition-all"
            >
              <RotateCcw className="w-3.5 h-3.5 text-[#0F766E]" />
              <span>Restore defaults</span>
            </button>
          </div>
        </div>
      </header>

      {notice && (
        <div
          role="status"
          className="flex items-start justify-between gap-3 rounded-[14px] border border-[#0F766E]/25 bg-[#0F766E]/8 px-4 py-3"
        >
          <p className="text-xs font-semibold text-[#0F5C55]">{notice}</p>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="text-[11px] font-bold text-[#0F5C55] underline underline-offset-2 shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        {/* Column 1 — Dispatch alerts */}
        <section aria-label="Dispatch alerts" className="lg:col-span-5 bento-card p-5">
          <CardHeading
            title="Dispatch Alerts"
            caption="How this console reaches you when a rescue job is offered"
          />
          <div className="mt-2">
            <ToggleRow
              Icon={Volume2}
              label="Offer sound"
              hint="Plays a chime the moment an offer lands, so you catch it with the tab in the background."
              checked={settings.offerSound}
              onChange={(v) => set('offerSound', v)}
            />
            <ToggleRow
              Icon={BellRing}
              label="Desktop notifications"
              hint="A system banner for every new offer, even when the console is not the active window."
              checked={settings.desktopNotifications}
              onChange={(v) => set('desktopNotifications', v)}
            />
            <ToggleRow
              Icon={MessageSquare}
              label="SMS fallback"
              hint="If an offer goes unanswered for 30 seconds, send it to the registered phone as a text."
              checked={settings.smsFallback}
              onChange={(v) => set('smsFallback', v)}
            />
          </div>
        </section>

        {/* Column 2 — Display + duty behaviour */}
        <div className="lg:col-span-4 w-full flex flex-col gap-4">
          <section aria-label="Display and units" className="bento-card p-5">
            <CardHeading title="Display & Units" caption="What the console shows, and in which units" />
            <div className="mt-2">
              <ToggleRow
                Icon={settings.privacyMode ? EyeOff : Eye}
                label="Privacy mode"
                hint="Masks every rupee figure in the console. For working with a customer looking over your shoulder."
                checked={settings.privacyMode}
                onChange={(v) => set('privacyMode', v)}
              />
              <SegmentedRow
                Icon={Ruler}
                label="Distance unit"
                hint="Used for pickup distance and coverage radius."
                value={settings.distanceUnit}
                options={DISTANCE_OPTIONS}
                onChange={(v) => set('distanceUnit', v)}
              />
              <SegmentedRow
                Icon={Clock}
                label="Clock format"
                hint="Applies to dispatch timestamps and settlement history."
                value={settings.clockFormat}
                options={CLOCK_OPTIONS}
                onChange={(v) => set('clockFormat', v)}
              />
            </div>
          </section>

          <section aria-label="Duty behaviour" className="bento-card p-5">
            <CardHeading title="Duty Behaviour" caption="What happens between one job and the next" />
            <div className="mt-2">
              <ToggleRow
                Icon={Bell}
                label="Go off duty after each job"
                hint="Drop to Off Duty the moment a job completes, instead of queueing the next dispatch."
                checked={settings.autoOffDutyAfterJob}
                onChange={(v) => set('autoOffDutyAfterJob', v)}
              />
              <FactRow
                Icon={Clock}
                label="Availability window"
                value={profile.extraDetails.availabilityMode === '24_7' ? '24 / 7' : 'Daytime only'}
              />
              <FactRow Icon={MapPin} label="Operating zone" value={profile.extraDetails.operatingZone} />
            </div>
            <p className="text-[11px] text-[#5B5346] mt-3">
              The window and zone are set in{' '}
              {onNavigate ? (
                <button
                  type="button"
                  onClick={() => onNavigate('preferences')}
                  className="font-bold text-[#0F766E] underline underline-offset-2 hover:text-[#0C5F58]"
                >
                  Fleet &amp; Preferences
                </button>
              ) : (
                <span className="font-bold text-[#1B1712]">Fleet &amp; Preferences</span>
              )}
              .
            </p>
          </section>
        </div>

        {/* Column 3 — Account + demo tools */}
        <div className="lg:col-span-3 w-full flex flex-col gap-4">
          <section aria-label="Account" className="bento-card p-5">
            <CardHeading title="Account" caption="Registered with Sahayak dispatch" />
            <div className="mt-2">
              <FactRow Icon={ShieldCheck} label="Partner ID" value={profile.id} />
              <FactRow Icon={Phone} label="Phone" value={profile.phone} />
              <FactRow Icon={Users} label="Team size" value={`${profile.extraDetails.teamSize} on the roster`} />
            </div>
          </section>

          <section aria-label="Demo and developer tools" className="bento-card p-5">
            <CardHeading title="Demo Tools" caption="Only visible while the console runs on mock data" />
            <div className="mt-2">
              <FactRow
                Icon={Database}
                label="Dispatch API"
                value={IS_PARTNER_API_MOCK ? 'Mock (local)' : 'Live backend'}
              />
            </div>
            {IS_PARTNER_API_MOCK ? (
              <div className="flex flex-col gap-2 mt-3">
                <button
                  type="button"
                  onClick={handleSimulate}
                  className="w-full px-3.5 py-2.5 rounded-[10px] bg-[#0F766E] hover:bg-[#0C5F58] text-white text-xs font-bold flex items-center justify-center gap-1.5 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Simulate incoming dispatch</span>
                </button>
                <button
                  type="button"
                  onClick={handleResetDemoData}
                  className="w-full px-3.5 py-2.5 rounded-[10px] bg-white hover:bg-[#FBF8F1] border border-[#E7E0D2] text-[#1B1712] text-xs font-bold flex items-center justify-center gap-1.5 transition-colors"
                >
                  <RotateCcw className="w-3.5 h-3.5 text-[#5B5346]" />
                  <span>Reset demo data</span>
                </button>
              </div>
            ) : (
              <p className="text-[11px] text-[#5B5346] mt-3">
                This console is pointed at the live dispatch backend, so the demo controls are unavailable.
              </p>
            )}
          </section>
        </div>
      </div>
    </div>
  );

  if (embedded) return body;

  return (
    <div className="min-h-screen bg-[#F6F1E6] text-[#1B1712] py-6 px-4 sm:px-6 lg:px-8">
      <div className="max-w-6xl mx-auto flex items-center gap-2 mb-4 text-[#5B5346]">
        <Settings className="w-4 h-4 text-[#0F766E]" />
        <span className="text-xs font-bold uppercase tracking-wider">Partner Console</span>
      </div>
      <div className="max-w-6xl mx-auto">{body}</div>
    </div>
  );
};

export default ConsoleSettingsView;
