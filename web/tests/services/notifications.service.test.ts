import { describe, it, expect, vi, beforeEach } from 'vitest';
import { notificationsService } from '../../src/services/notifications.service';

function mockResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    text: () => Promise.resolve(JSON.stringify(body)),
    json: () => Promise.resolve(body),
    headers: new Headers({ 'Content-Type': 'application/json' }),
  } as unknown as Response;
}

describe('notifications.service — contract tests', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  it('listNotifications calls GET /notifications with query parameters', async () => {
    vi.mocked(fetch).mockResolvedValue(
      mockResponse(200, {
        data: {
          items: [
            {
              id: 'notif-1',
              event: 'job_completed',
              message: 'Your job has been marked completed',
              is_read: false,
              sent_at: '2026-10-06T10:00:00Z',
            },
          ],
          unread_count: 1,
          total: 1,
          limit: 10,
          offset: 0,
          has_more: false,
        },
        meta: { request_id: 'req-n1' },
      })
    );

    const res = await notificationsService.listNotifications({ limit: 10, offset: 0, unreadOnly: true });

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, options] = vi.mocked(fetch).mock.calls[0];
    expect(url).toMatch(/\/notifications\?limit=10&offset=0&unread_only=true$/);
    expect(options?.method ?? 'GET').toBe('GET');
    expect(res.unread_count).toBe(1);
    expect(res.items.length).toBe(1);
    expect(res.items[0].id).toBe('notif-1');
  });

  it('getUnreadCount calls GET /notifications/unread-count and returns number', async () => {
    vi.mocked(fetch).mockResolvedValue(
      mockResponse(200, {
        data: { unread_count: 3 },
        meta: { request_id: 'req-n2' },
      })
    );

    const count = await notificationsService.getUnreadCount();

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, options] = vi.mocked(fetch).mock.calls[0];
    expect(url).toMatch(/\/notifications\/unread-count$/);
    expect(options?.method ?? 'GET').toBe('GET');
    expect(count).toBe(3);
  });

  it('markAsRead calls POST /notifications/{id}/read', async () => {
    vi.mocked(fetch).mockResolvedValue(
      mockResponse(200, {
        data: { updated: 1, unread_count: 2 },
        meta: { request_id: 'req-n3' },
      })
    );

    const res = await notificationsService.markAsRead('notif-123');

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, options] = vi.mocked(fetch).mock.calls[0];
    expect(url).toMatch(/\/notifications\/notif-123\/read$/);
    expect(options?.method).toBe('POST');
    expect(res.updated).toBe(1);
    expect(res.unread_count).toBe(2);
  });

  it('markAllAsRead calls POST /notifications/read-all', async () => {
    vi.mocked(fetch).mockResolvedValue(
      mockResponse(200, {
        data: { updated: 5, unread_count: 0 },
        meta: { request_id: 'req-n4' },
      })
    );

    const res = await notificationsService.markAllAsRead();

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, options] = vi.mocked(fetch).mock.calls[0];
    expect(url).toMatch(/\/notifications\/read-all$/);
    expect(options?.method).toBe('POST');
    expect(res.updated).toBe(5);
    expect(res.unread_count).toBe(0);
  });
});
