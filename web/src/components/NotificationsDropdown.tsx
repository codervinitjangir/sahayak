import React, { useState, useEffect, useRef } from 'react';
import { Bell, CheckCheck } from 'lucide-react';
import { notificationsService, type NotificationItem } from '../services/notifications.service';

export interface NotificationsDropdownProps {
  className?: string;
  iconClassName?: string;
}

export const NotificationsDropdown: React.FC<NotificationsDropdownProps> = ({
  className = '',
  iconClassName = 'w-4 h-4 text-[#475569]',
}) => {
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Poll unread count periodically
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
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleOutsideClick);
    }
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
    };
  }, [isOpen]);

  const loadNotifications = async () => {
    setIsLoading(true);
    try {
      const res = await notificationsService.listNotifications({ limit: 15 });
      setNotifications(res.items);
      setUnreadCount(res.unread_count);
    } catch {
      // fail silently
    } finally {
      setIsLoading(false);
    }
  };

  const toggleDropdown = () => {
    if (!isOpen) {
      loadNotifications();
    }
    setIsOpen((prev) => !prev);
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
    <div className={`relative ${className}`} ref={dropdownRef}>
      <button
        type="button"
        onClick={toggleDropdown}
        className="w-9 h-9 rounded-[10px] bg-white hover:bg-[#FFFFFF] border border-[#EEF2F6] shadow-2xs flex items-center justify-center text-[#475569] hover:text-[#0F172A] transition-colors relative cursor-pointer"
        title={unreadCount > 0 ? `${unreadCount} unread notifications` : 'Notifications'}
        aria-label="Notifications"
      >
        <Bell className={iconClassName} />
        {unreadCount > 0 && (
          <span className="w-2 h-2 rounded-full bg-red-600 absolute top-1.5 right-1.5 ring-2 ring-white" />
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 top-11 w-80 sm:w-96 bg-white rounded-[16px] border border-[#EEF2F6] shadow-xl z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-100">
          <div className="px-4 py-3 border-b border-[#EEF2F6] flex items-center justify-between bg-[#FDFBF7]">
            <div className="flex items-center gap-2">
              <h4 className="font-bold text-sm text-[#0F172A]">Notifications</h4>
              {unreadCount > 0 && (
                <span className="px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 text-xs font-bold">
                  {unreadCount} new
                </span>
              )}
            </div>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={handleMarkAllRead}
                className="text-xs text-[#0F766E] hover:text-[#115E59] font-semibold flex items-center gap-1 cursor-pointer"
              >
                <CheckCheck className="w-3.5 h-3.5" />
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-80 overflow-y-auto divide-y divide-slate-100">
            {isLoading ? (
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
                      !item.is_read ? 'bg-[#0F766E] ring-2 ring-[#0F766E]/20' : 'bg-transparent'
                    }`}
                  />
                  <div className="flex-1 min-w-0">
                    <p className={`text-xs ${!item.is_read ? 'font-semibold text-slate-900' : 'text-slate-600'}`}>
                      {item.message || item.event.replace(/_/g, ' ')}
                    </p>
                    <span className="text-xs text-slate-400 mt-1 block">
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
  );
};
