import React from 'react';
import { Link } from 'react-router-dom';
import {
  Bell,
  ChevronDown,
  MessageSquare,
  Search,
} from 'lucide-react';
import { usePartnerAvailability } from '../../../features/partners/usePartnerAvailability';
import { usePartnerProfile } from '../../../features/partners/partnerStore';
import { useOptionalAuth, type UserRole } from '../../../app/AuthProvider';
import type { PartnerProfile } from '../../../types/partner';

function formatAge(seconds: number): string {
  if (seconds < 60) return `${seconds}s ago`;
  const mins = Math.floor(seconds / 60);
  return `${mins}m ago`;
}

export interface PartnerTopBarProps {
  profile?: PartnerProfile;
  searchPlaceholder?: string;
  onSearchChange?: (val: string) => void;
  searchValue?: string;
}

export const PartnerTopBar: React.FC<PartnerTopBarProps> = ({
  profile: propProfile,
  searchPlaceholder = 'Search a job ID or vehicle number',
  onSearchChange,
  searchValue,
}) => {
  const storeProfile = usePartnerProfile();
  const profile = propProfile ?? storeProfile;
  const { isAvailable, toggle, locationAgeSeconds } = usePartnerAvailability();
  const auth = useOptionalAuth();

  return (
    <div className="w-full flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
      {/* Left: Main Search Bar */}
      <div className="flex-1 max-w-md">
        <div className="relative flex items-center bg-white hover:bg-[#FBF8F1] rounded-[12px] px-3.5 py-2 border border-[#E7E0D2] shadow-2xs transition-all">
          <Search className="w-4 h-4 text-[#9A917F] shrink-0 mr-2.5" />
          <input
            type="text"
            aria-label="Search dispatches"
            placeholder={searchPlaceholder}
            value={searchValue}
            onChange={(e) => onSearchChange?.(e.target.value)}
            className="w-full bg-transparent text-xs text-[#1B1712] placeholder-[#9A917F] font-medium outline-none"
          />
        </div>
      </div>

      {/* Right: Messages + Notifications + Role Switch + Duty Switch + GPS + Avatar */}
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

        {/* GPS Freshness Pill */}
        <div className="hidden xl:flex items-center gap-1.5 bg-white rounded-[12px] px-3 py-1.5 border border-[#E7E0D2] shadow-2xs text-[11px]">
          <span className="text-[#5B5346] font-medium">GPS:</span>
          <span className="font-bold text-[#1B1712] tabular-nums">
            {locationAgeSeconds !== null ? `Live (${formatAge(locationAgeSeconds)})` : 'Live (1m ago)'}
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
  );
};
