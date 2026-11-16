// ─── Push notifications (ADR-026) ─────────────────────────────────────────────
// Registers this device's Expo push token with the backend after sign-in and
// removes it on sign-out. Every step degrades to "no push" rather than throwing:
// a simulator, a denied permission or a build without an EAS project id must
// never block sign-in. The in-app notifications list stays the source of truth.
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { devicesApi } from "./api/devices";

let registeredToken: string | null = null;

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

function easProjectId(): string | undefined {
  return (
    (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ??
    Constants.easConfig?.projectId
  );
}

/** Ask for permission, fetch the Expo token and register it. Returns the token or null. */
export async function registerForPush(): Promise<string | null> {
  try {
    if (!Device.isDevice) return null; // simulators get no push token
    const projectId = easProjectId();
    if (!projectId) {
      console.warn("[push] no EAS projectId in app config; run `eas init` to enable push");
      return null;
    }

    if (Platform.OS === "android") {
      // Two channels so a partner can keep offers loud and status updates
      // quiet in Android settings. Ids must match backend push_service.
      await Notifications.setNotificationChannelAsync("jobs", {
        name: "Job updates",
        description: "Partner assigned, on the way, work started, completed",
        importance: Notifications.AndroidImportance.HIGH,
        lightColor: "#111111",
      });
      await Notifications.setNotificationChannelAsync("offers", {
        name: "New job offers",
        description: "A new roadside job is waiting for your answer",
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 400, 200, 400],
        lightColor: "#111111",
        sound: "default",
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      });
    }

    let { status } = await Notifications.getPermissionsAsync();
    if (status !== "granted") {
      ({ status } = await Notifications.requestPermissionsAsync());
    }
    if (status !== "granted") return null;

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    if (token === registeredToken) return token;
    await devicesApi.register(token, Platform.OS === "ios" ? "ios" : "android");
    registeredToken = token;
    return token;
  } catch (err) {
    console.warn("[push] registration failed", err);
    return null;
  }
}

/**
 * Remove this device's token. Takes the access token explicitly because sign-out
 * clears the store's token before this request goes out.
 */
export async function unregisterPush(authToken: string | null): Promise<void> {
  const token = registeredToken;
  registeredToken = null;
  if (!token || !authToken) return;
  try {
    await devicesApi.unregister(token, authToken);
  } catch {
    // Best effort: the server also prunes tokens Expo reports as unregistered.
  }
}
