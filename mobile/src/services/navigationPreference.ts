// ─── Sahayak: partner's navigation-app preference ─────────────────────────────
// The Account screen used to offer a "Navigation app" picker that nothing read
// and that reset on every launch. This stores the choice on the device and is
// what the active-job Navigate button uses.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

export type NavApp = "google" | "system";

const KEY = "sahayak.navApp";

export const NAV_APP_LABEL: Record<NavApp, string> = {
  google: "Google Maps",
  system: Platform.OS === "ios" ? "Apple Maps" : "Ask each time",
};

export async function getNavApp(): Promise<NavApp> {
  try {
    const v = await AsyncStorage.getItem(KEY);
    return v === "system" ? "system" : "google";
  } catch {
    return "google";
  }
}

export async function setNavApp(app: NavApp): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, app);
  } catch {
    // A preference that fails to save falls back to Google Maps next launch.
  }
}

/** Directions URL for the chosen app. "system" on Android is a geo: link,
 *  which lets the phone show its own app chooser. */
export function directionsUrl(app: NavApp, lat: number, lng: number): string {
  if (app === "system") {
    return Platform.OS === "ios"
      ? `http://maps.apple.com/?daddr=${lat},${lng}`
      : `geo:${lat},${lng}?q=${lat},${lng}`;
  }
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}
