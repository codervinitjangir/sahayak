import React from 'react';
import { Search } from 'lucide-react';
import { usePartnerAvailability } from '../../../features/partners/usePartnerAvailability';
import { usePartnerProfile } from '../../../features/partners/partnerStore';
import { NotificationsDropdown } from '../../../components/NotificationsDropdown';
import type { PartnerProfile } from '../../../types/partner';

function formatAge(seconds: number): string {
  if (seconds < 60) return `${seconds}s ago`;
  const mins = Math.floor(seconds / 60);
  return `${mins}m ago`;
}

export interface PartnerTopBarProps {
  profile?: PartnerProfile;
  searchPlaceholder?: string;
  /** The search box is only rendered when the page can act on it. */
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

  return (
    <div className="w-full flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
      <div className="flex-1 max-w-md">
        {onSearchChange && (
          <div className="relative flex items-center bg-white rounded-control px-3.5 min-h-[44px] border border-line">
            <Search className="w-4 h-4 text-ink-muted shrink-0 mr-2.5" aria-hidden="true" />
            <input
              type="text"
              aria-label="Search dispatches"
              placeholder={searchPlaceholder}
              value={searchValue}
              onChange={(e) => onSearchChange(e.target.value)}
              className="w-full bg-transparent text-sm text-ink placeholder-ink-muted font-medium outline-none"
            />
          </div>
        )}
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <NotificationsDropdown />

        {/* Duty switch (asserted by PartnerPages.test.tsx) */}
        <div className="flex items-center gap-2.5 bg-white rounded-control px-3.5 min-h-[44px] border border-line text-sm">
          <span className="relative flex h-2 w-2" aria-hidden="true">
            {isAvailable && (
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            )}
            <span
              className={`relative inline-flex rounded-full h-2 w-2 ${
                isAvailable ? 'bg-status-success' : 'bg-slate-300'
              }`}
            />
          </span>
          <span className="font-semibold text-ink">{isAvailable ? 'On Duty' : 'Off Duty'}</span>
          <button
            type="button"
            role="switch"
            aria-checked={isAvailable}
            aria-label="Toggle availability"
            onClick={toggle}
            className={`toggle-switch scale-90 origin-right ${isAvailable ? 'toggle-switch--active' : ''}`}
          >
            <span className="toggle-switch__thumb" />
          </button>
        </div>

        {/* GPS freshness: only states what the last fix actually was. */}
        <div className="hidden xl:flex items-center gap-1.5 bg-white rounded-control px-3 min-h-[44px] border border-line text-sm">
          <span className="text-ink-soft font-medium">GPS</span>
          <span className="font-semibold text-ink tnum">
            {locationAgeSeconds !== null ? formatAge(locationAgeSeconds) : 'Not shared yet'}
          </span>
        </div>

        <span
          aria-label={profile.name}
          title={profile.name}
          className="w-10 h-10 rounded-full bg-brand-700 text-white flex items-center justify-center font-semibold"
        >
          {profile.name.trim().charAt(0).toUpperCase()}
        </span>
      </div>
    </div>
  );
};
