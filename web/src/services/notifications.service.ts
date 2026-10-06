import { apiClient } from './api';

export interface NotificationItem {
  id: string;
  event: string;
  message?: string;
  job_id?: string;
  is_read: boolean;
  sent_at: string;
}

export interface NotificationListResponse {
  items: NotificationItem[];
  unread_count: number;
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
}

export interface UnreadCountResponse {
  unread_count: number;
}

export interface MarkReadResponse {
  updated: number;
  unread_count: number;
}

export const notificationsService = {
  /**
   * Fetch caller's notification feed.
   * Real path: GET /notifications
   */
  async listNotifications(options: {
    limit?: number;
    offset?: number;
    unreadOnly?: boolean;
  } = {}): Promise<NotificationListResponse> {
    const params = new URLSearchParams();
    if (options.limit !== undefined) params.set('limit', String(options.limit));
    if (options.offset !== undefined) params.set('offset', String(options.offset));
    if (options.unreadOnly !== undefined) params.set('unread_only', String(options.unreadOnly));

    const qs = params.toString();
    const endpoint = `/notifications${qs ? `?${qs}` : ''}`;
    const res = await apiClient<NotificationListResponse>(endpoint, { method: 'GET' });
    return res.data;
  },

  /**
   * Fetch caller's unread notification badge count.
   * Real path: GET /notifications/unread-count
   */
  async getUnreadCount(): Promise<number> {
    const res = await apiClient<UnreadCountResponse>('/notifications/unread-count', {
      method: 'GET',
    });
    return res.data.unread_count;
  },

  /**
   * Mark a single notification as read.
   * Real path: POST /notifications/{id}/read
   */
  async markAsRead(id: string): Promise<MarkReadResponse> {
    const res = await apiClient<MarkReadResponse>(`/notifications/${id}/read`, {
      method: 'POST',
    });
    return res.data;
  },

  /**
   * Mark all notifications as read.
   * Real path: POST /notifications/read-all
   */
  async markAllAsRead(): Promise<MarkReadResponse> {
    const res = await apiClient<MarkReadResponse>('/notifications/read-all', {
      method: 'POST',
    });
    return res.data;
  },
};
