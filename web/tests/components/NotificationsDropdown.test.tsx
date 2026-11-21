import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

import { NotificationsDropdown, AUTO_READ_DELAY_MS } from '../../src/components/NotificationsDropdown';
import { notificationsService } from '../../src/services/notifications.service';

vi.mock('../../src/services/notifications.service', () => ({
  notificationsService: {
    listNotifications: vi.fn(),
    getUnreadCount: vi.fn(),
    markAsRead: vi.fn(),
    markAllAsRead: vi.fn(),
    dismiss: vi.fn(),
    clearAll: vi.fn(),
  },
}));

const svc = vi.mocked(notificationsService);
const item = (id: string, is_read: boolean, message: string) => ({
  id, event: 'job_accepted', message, job_id: undefined, is_read, sent_at: '2026-11-21T10:00:00Z',
});

beforeEach(() => {
  vi.clearAllMocks();
  svc.listNotifications.mockResolvedValue({
    items: [item('a', false, 'A mechanic accepted'), item('b', true, 'Older update')],
    unread_count: 1, total: 2, limit: 20, offset: 0, has_more: false,
  });
  svc.getUnreadCount.mockResolvedValue(1);
  svc.markAllAsRead.mockResolvedValue({ updated: 1, unread_count: 0 });
  svc.dismiss.mockResolvedValue({ updated: 1, unread_count: 0 });
  svc.clearAll.mockResolvedValue({ updated: 2, unread_count: 0 });
});

describe('Notifications dropdown (ADR-054)', () => {
  it('the list is loaded before the bell is clicked', async () => {
    render(<NotificationsDropdown />);
    await waitFor(() => expect(svc.listNotifications).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: /Notifications/ }));
    expect(screen.getByText('A mechanic accepted')).toBeTruthy();
    expect(screen.queryByText('Loading notifications...')).toBeNull();
  });

  it('opening marks everything read after a beat and keeps the "new" label', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(<NotificationsDropdown />);
      await waitFor(() => expect(svc.listNotifications).toHaveBeenCalled());
      fireEvent.click(screen.getByRole('button', { name: /Notifications/ }));
      await waitFor(() => expect(screen.getByText('1 new')).toBeTruthy());
      expect(svc.markAllAsRead).not.toHaveBeenCalled();
      await act(async () => { vi.advanceTimersByTime(AUTO_READ_DELAY_MS + 50); });
      await waitFor(() => expect(svc.markAllAsRead).toHaveBeenCalledTimes(1));
      expect(screen.getByText('1 new')).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a row can be cleared, and Clear all empties the panel', async () => {
    render(<NotificationsDropdown />);
    await waitFor(() => expect(svc.listNotifications).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: /Notifications/ }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Clear this notification' })[1]);
    await waitFor(() => expect(svc.dismiss).toHaveBeenCalledWith('b'));
    expect(screen.queryByText('Older update')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    await waitFor(() => expect(svc.clearAll).toHaveBeenCalled());
    expect(screen.getByText('You are all caught up')).toBeTruthy();
  });

  it('a failed clear puts the row back', async () => {
    svc.dismiss.mockRejectedValue(new Error('offline'));
    render(<NotificationsDropdown />);
    await waitFor(() => expect(svc.listNotifications).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: /Notifications/ }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Clear this notification' })[1]);
    await waitFor(() => expect(screen.getByText('Older update')).toBeTruthy());
  });
});
