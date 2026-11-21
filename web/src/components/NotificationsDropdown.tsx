import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Bell, X } from 'lucide-react';
import { notificationsService, type NotificationItem } from '../services/notifications.service';

export interface NotificationsDropdownProps {
  className?: string;
  iconClassName?: string;
}

/** How long the open panel waits before marking everything read (ADR-054). */
export const AUTO_READ_DELAY_MS = 800;

// ADR-054: the list is fetched before the bell is clicked (on mount, and again
// whenever the badge goes up), so opening shows rows at once. Opening is
// reading: after a short beat everything is marked read, while the rows that
// were new keep their highlight until the panel closes. Each row can be
// cleared, and Clear all empties the panel.
export const NotificationsDropdown: React.FC<NotificationsDropdownProps> = ({
  className = '',
  iconClassName = 'w-4 h-4 text-[#475569]',
}) => {
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [notifications, setNotifications] = useState<NotificationItem[] | null>(null);
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [newIds, setNewIds] = useState<Set<string>>(() => new Set());
  const dropdownRef = useRef<HTMLDivElement>(null);
  const lastCount = useRef(0);
  // Rows cleared here. A fetch that was already in flight when a row was
  // cleared must not put it back.
  const clearedIds = useRef<Set<string>>(new Set());
  const clearedAllAt = useRef<number>(0);

  const loadNotifications = useCallback(async () => {
    const startedAt = Date.now();
    try {
      const res = await notificationsService.listNotifications({ limit: 20 });
      if (startedAt < clearedAllAt.current) return; // Clear all won the race
      setNotifications(res.items.filter((n) => !clearedIds.current.has(n.id)));
      setUnreadCount(res.unread_count);
    } catch {
      setNotifications((prev) => prev ?? []);
    }
  }, []);

  // Poll the badge; fetch the list up front and whenever the badge goes up.
  useEffect(() => {
    let mounted = true;
    void loadNotifications();
    const fetchCount = async () => {
      try {
        const count = await notificationsService.getUnreadCount();
        if (!mounted) return;
        setUnreadCount(count);
        if (count > lastCount.current) void loadNotifications();
        lastCount.current = count;
      } catch {
        // fail silently
      }
    };
    const interval = setInterval(fetchCount, 30000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [loadNotifications]);

  // Close on outside click or Escape.
  useEffect(() => {
    if (!isOpen) return;
    const handleOutsideClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setIsOpen(false);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [isOpen]);

  // Auto-read while open.
  useEffect(() => {
    if (!isOpen || !notifications) return;
    const fresh = notifications.filter((n) => !n.is_read).map((n) => n.id);
    if (fresh.length === 0) return;
    setNewIds((prev) => new Set([...prev, ...fresh]));
    const t = setTimeout(async () => {
      try {
        await notificationsService.markAllAsRead();
        setNotifications((prev) => prev?.map((n) => ({ ...n, is_read: true })) ?? prev);
        setUnreadCount(0);
        lastCount.current = 0;
      } catch {
        // a convenience; the badge simply stays
      }
    }, AUTO_READ_DELAY_MS);
    return () => clearTimeout(t);
  }, [isOpen, notifications]);

  const toggleDropdown = () => {
    if (!isOpen) void loadNotifications();
    else setNewIds(new Set());
    setIsOpen((prev) => !prev);
  };

  const handleDismiss = async (id: string) => {
    const before = notifications;
    clearedIds.current.add(id);
    setNotifications((prev) => prev?.filter((n) => n.id !== id) ?? prev);
    try {
      const res = await notificationsService.dismiss(id);
      setUnreadCount(res.unread_count);
    } catch {
      clearedIds.current.delete(id);
      setNotifications(before);
    }
  };

  const handleClearAll = async () => {
    const before = notifications;
    const prevClearedAt = clearedAllAt.current;
    clearedAllAt.current = Date.now() + 1;
    setNotifications([]);
    setUnreadCount(0);
    try {
      await notificationsService.clearAll();
    } catch {
      clearedAllAt.current = prevClearedAt;
      setNotifications(before);
    }
  };

  const items = notifications ?? [];

  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      <button
        type="button"
        onClick={toggleDropdown}
        className="w-9 h-9 rounded-[10px] bg-white hover:bg-[#FFFFFF] border border-[#EEF2F6] shadow-2xs flex items-center justify-center text-[#475569] hover:text-[#0F172A] transition-colors relative cursor-pointer"
        title={unreadCount > 0 ? `${unreadCount} unread notifications` : 'Notifications'}
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
        aria-expanded={isOpen}
      >
        <Bell className={iconClassName} />
        {unreadCount > 0 && (
          <span className="w-2 h-2 rounded-full bg-red-600 absolute top-1.5 right-1.5 ring-2 ring-white" />
        )}
      </button>

      {isOpen && (
        <div
          role="dialog"
          aria-label="Notifications"
          className="absolute right-0 top-11 w-80 sm:w-96 bg-white rounded-[16px] border border-[#EEF2F6] shadow-xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150"
        >
          <div className="px-4 py-3 border-b border-[#EEF2F6] flex items-center justify-between bg-[#FDFBF7]">
            <div className="flex items-center gap-2">
              <h4 className="font-bold text-sm text-[#0F172A]">Notifications</h4>
              {newIds.size > 0 && (
                <span className="px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 text-xs font-bold">
                  {newIds.size} new
                </span>
              )}
            </div>
            {items.length > 0 && (
              <button
                type="button"
                onClick={handleClearAll}
                className="text-xs text-[#111111] hover:text-[#000000] font-semibold cursor-pointer"
              >
                Clear all
              </button>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto divide-y divide-slate-100">
            {notifications === null ? (
              <div className="p-6 text-center text-xs text-slate-500">Loading notifications...</div>
            ) : items.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500">
                <Bell className="w-6 h-6 text-slate-300 mx-auto mb-2" />
                You are all caught up
              </div>
            ) : (
              items.map((item) => {
                const isNew = newIds.has(item.id);
                return (
                  <div
                    key={item.id}
                    className={`group p-3.5 flex items-start gap-3 ${isNew ? 'bg-amber-50/40' : 'bg-white'}`}
                  >
                    <div
                      className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${
                        isNew ? 'bg-[#111111] ring-2 ring-[#111111]/20' : 'bg-transparent'
                      }`}
                    />
                    <div className="flex-1 min-w-0">
                      <p className={`text-xs ${isNew ? 'font-semibold text-slate-900' : 'text-slate-600'}`}>
                        {item.message || item.event.replace(/_/g, ' ')}
                      </p>
                      <span className="text-xs text-slate-400 mt-1 block">
                        {new Date(item.sent_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleDismiss(item.id)}
                      aria-label="Clear this notification"
                      className="shrink-0 w-7 h-7 -mr-1 rounded-md flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};
