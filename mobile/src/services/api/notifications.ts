import { apiClient } from "./client";

export interface MobileNotificationItem {
  id: string;
  event: string;
  message: string | null;
  job_id: string | null;
  is_read: boolean;
  sent_at: string;
}

export interface MobileNotificationListResponse {
  items: MobileNotificationItem[];
  unread_count: number;
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
}

export interface MobileUnreadCountResponse {
  unread_count: number;
}

export interface MobileMarkReadResponse {
  updated: number;
  unread_count: number;
}

export const notificationsApi = {
  /** List notifications for current identity (GET /api/v1/notifications) */
  listNotifications: (limit: number = 20, offset: number = 0, unreadOnly: boolean = false) => {
    const params = new URLSearchParams();
    if (limit) params.set("limit", String(limit));
    if (offset) params.set("offset", String(offset));
    if (unreadOnly) params.set("unread_only", "true");

    const qs = params.toString();
    const endpoint = `/notifications${qs ? `?${qs}` : ""}`;
    return apiClient.get<MobileNotificationListResponse>(endpoint).then((r) => r.data);
  },

  /** Get badge unread count (GET /api/v1/notifications/unread-count) */
  getUnreadCount: () =>
    apiClient
      .get<MobileUnreadCountResponse>("/notifications/unread-count", {
        // Suppress console warnings during periodic background polling when server is offline
        silent: true,
      } as any)
      .then((r) => r.data.unread_count)
      .catch(() => 0),

  /** Mark single notification as read (POST /api/v1/notifications/{id}/read) */
  markRead: (notificationId: string) =>
    apiClient
      .post<MobileMarkReadResponse>(`/notifications/${notificationId}/read`)
      .then((r) => r.data),

  /** Mark all notifications as read (POST /api/v1/notifications/read-all) */
  markAllRead: () =>
    apiClient
      .post<MobileMarkReadResponse>("/notifications/read-all")
      .then((r) => r.data),

  /** Clear one notification from the panel (POST /api/v1/notifications/{id}/dismiss, ADR-054) */
  dismiss: (notificationId: string) =>
    apiClient
      .post<MobileMarkReadResponse>(`/notifications/${notificationId}/dismiss`)
      .then((r) => r.data),

  /** Clear the whole panel (POST /api/v1/notifications/clear-all, ADR-054) */
  clearAll: () =>
    apiClient
      .post<MobileMarkReadResponse>("/notifications/clear-all")
      .then((r) => r.data),
};
