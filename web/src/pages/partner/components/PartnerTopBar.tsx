import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  Bell,
  CheckCheck,
  ChevronDown,
  MessageSquare,
  Search,
} from 'lucide-react';
import { usePartnerAvailability } from '../../../features/partners/usePartnerAvailability';
import { usePartnerProfile } from '../../../features/partners/partnerStore';
import { useOptionalAuth, type UserRole } from '../../../app/AuthProvider';
import { notificationsService, type NotificationItem } from '../../../services/notifications.service';
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

  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState<boolean>(false);
  const [isLoadingNotifs, setIsLoadingNotifs] = useState<boolean>(false);
  const notifRef = useRef<HTMLDivElement>(null);

  // Poll unread count every 30s
  useEffect(() => {
    let mounted = true;
    const fetchCount = async () => {
      try {
        const count = await notificationsService.getUnreadCount();
        if (mounted) setUnreadCount(count);
      } catch {
        // fail silently
      }
    };
    fetchCount();
    const interval = setInterval(fetchCount, 30000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  // Close on outside click
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setIsNotificationsOpen(false);
      }
    };
    if (isNotificationsOpen) {
      document.addEventListener('mousedown', handleOutsideClick);
    }
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
    };
  }, [isNotificationsOpen]);

  const loadNotifications = async () => {
    setIsLoadingNotifs(true);
    try {
      const res = await notificationsService.listNotifications({ limit: 15 });
      setNotifications(res.items);
      setUnreadCount(res.unread_count);
    } catch {
      // fail silently
    } finally {
      setIsLoadingNotifs(false);
    }
  };

  const toggleNotifications = () => {
    if (!isNotificationsOpen) {
      loadNotifications();
    }
    setIsNotificationsOpen((prev) => !prev);
  };

  const handleMarkRead = async (id: string) => {
    try {
      const res = await notificationsService.markAsRead(id);
      setNotifications((prev) =>
        prev.map((item) => (item.id === id ? { ...item, is_read: true } : item))
      );
      setUnreadCount(res.unread_count);
    } catch {
      // fail silently
    }
  };

  const handleMarkAllRead = async () => {
    try {
      const res = await notificationsService.markAllAsRead();
      setNotifications((prev) => prev.map((item) => ({ ...item, is_read: true })));
      setUnreadCount(res.unread_count);
    } catch {
      // fail silently
    }
  };

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

        {/* Notifications Button & Dropdown */}
        <div className="relative" ref={notifRef}>
          <button
            type="button"
            onClick={toggleNotifications}
            className="w-9 h-9 rounded-[10px] bg-white hover:bg-[#FBF8F1] border border-[#E7E0D2] shadow-2xs flex items-center justify-center text-[#5B5346] hover:text-[#1B1712] transition-colors relative cursor-pointer"
            title={unreadCount > 0 ? `${unreadCount} unread notifications` : 'Notifications'}
            aria-label="Notifications"
          >
            <Bell className="w-4 h-4" />
            {unreadCount > 0 && (
              <span className="w-2 h-2 rounded-full bg-red-600 absolute top-1.5 right-1.5 ring-2 ring-white" />
            )}
          </button>

          {/* Notifications Popover */}
          {isNotificationsOpen && (
            <div className="absolute right-0 top-11 w-80 sm:w-96 bg-white rounded-[16px] border border-[#E7E0D2] shadow-xl z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-100">
              <div className="px-4 py-3 border-b border-[#E7E0D2] flex items-center justify-between bg-[#FDFBF7]">
                <div className="flex items-center gap-2">
                  <h4 className="font-bold text-sm text-[#1B1712]">Notifications</h4>
                  {unreadCount > 0 && (
                    <span className="px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 text-[10px] font-bold">
                      {unreadCount} new
                    </span>
                  )}
                </div>
                {unreadCount > 0 && (
                  <button
                    type="button"
                    onClick={handleMarkAllRead}
                    className="text-xs text-brand-700 hover:text-brand-800 font-semibold flex items-center gap-1 cursor-pointer"
                  >
                    <CheckCheck className="w-3.5 h-3.5" />
                    Mark all read
                  </button>
                )}
              </div>

              <div className="max-h-80 overflow-y-auto divide-y divide-slate-100">
                {isLoadingNotifs ? (
                  <div className="p-6 text-center text-xs text-slate-500">Loading notifications...</div>
                ) : notifications.length === 0 ? (
                  <div className="p-8 text-center text-xs text-slate-500">
                    <Bell className="w-6 h-6 text-slate-300 mx-auto mb-2" />
                    No notifications right now
                  </div>
                ) : (
                  notifications.map((item) => (
                    <div
                      key={item.id}
                      onClick={() => !item.is_read && handleMarkRead(item.id)}
                      className={`p-3.5 transition-colors cursor-pointer hover:bg-[#FDFBF7] flex items-start gap-3 ${
                        !item.is_read ? 'bg-amber-50/40' : 'bg-white'
                      }`}
                    >
                      <div
                        className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${
                          !item.is_read ? 'bg-brand-600 ring-2 ring-brand-100' : 'bg-transparent'
                        }`}
                      />
                      <div className="flex-1 min-w-0">
                        <p className={`text-xs ${!item.is_read ? 'font-semibold text-slate-900' : 'text-slate-600'}`}>
                          {item.message || item.event.replace(/_/g, ' ')}
                        </p>
                        <span className="text-[10px] text-slate-400 mt-1 block">
                          {new Date(item.sent_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

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
