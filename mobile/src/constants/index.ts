import { Platform, NativeModules } from "react-native";
import Constants from "expo-constants";

// The /api/v1 prefix is part of the contract — every endpoint the service
// modules call ("/jobs", "/jobs/:id") is relative to it. Without it every
// request 404s.
function getDevApiUrl(): string {
  if (process.env.EXPO_PUBLIC_API_BASE_URL) {
    return process.env.EXPO_PUBLIC_API_BASE_URL;
  }
  if (process.env.EXPO_PUBLIC_API_URL) {
    return process.env.EXPO_PUBLIC_API_URL;
  }

  // When testing on a physical device over Expo Go / Wi-Fi, hostUri contains
  // the developer's laptop IP (e.g. 192.168.1.62:8081).
  const hostUri =
    Constants.expoConfig?.hostUri ||
    (Constants as any).manifest2?.extra?.expoGo?.debuggerHost ||
    (Constants as any).manifest?.debuggerHost;
  if (hostUri) {
    const host = hostUri.split(":")[0];
    if (host && host !== "localhost" && host !== "127.0.0.1") {
      return `http://${host}:8010/api/v1`;
    }
  }

  const scriptURL: string | undefined = NativeModules?.SourceCode?.scriptURL;
  if (scriptURL) {
    const match = scriptURL.match(/^https?:\/\/([^:/]+)/);
    const host = match?.[1];
    if (host && host !== "localhost" && host !== "127.0.0.1") {
      return `http://${host}:8010/api/v1`;
    }
  }

  return Platform.OS === "android"
    ? "http://10.0.2.2:8010/api/v1"
    : "http://localhost:8010/api/v1";
}

export const API_BASE_URL = __DEV__
  ? getDevApiUrl()
  : (process.env.EXPO_PUBLIC_API_BASE_URL || process.env.EXPO_PUBLIC_API_URL || "https://api.sahayak.app/api/v1");

export const APP_NAME = "Sahayak";
export const APP_VERSION = "0.1.0";

// Job statuses (must match backend enum)
export const JOB_STATUS = {
  PENDING: "pending",
  ASSIGNED: "assigned",
  EN_ROUTE: "en_route",
  IN_PROGRESS: "in_progress",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
} as const;

// User roles
export const USER_ROLE = {
  OWNER: "owner",     // Vehicle owner requesting service
  PARTNER: "partner", // Mechanic / service partner
} as const;

// Service types
export const SERVICE_TYPE = {
  TYRE_PUNCTURE: "tyre_puncture",
  BATTERY_JUMP: "battery_jump",
  FUEL_DELIVERY: "fuel_delivery",
  TOWING: "towing",
  GENERAL: "general",
} as const;
