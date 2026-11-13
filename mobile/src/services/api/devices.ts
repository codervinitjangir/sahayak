import { apiClient } from "./client";

/**
 * Device push tokens (ADR-026). Call `register` after sign-in with the Expo push
 * token from `Notifications.getExpoPushTokenAsync({ projectId })`, and
 * `unregister` before sign-out. Not wired yet: the app needs expo-notifications
 * and an EAS project id first (see docs/NEXT-STEPS.md, G2).
 */
export const devicesApi = {
  register: (token: string, platform: "ios" | "android" | "web") =>
    apiClient.post<{ registered: boolean }>("/devices/push-token", { token, platform }).then((r) => r.data),

  unregister: (token: string) =>
    apiClient.delete<{ registered: boolean }>("/devices/push-token", { data: { token } }).then((r) => r.data),
};
