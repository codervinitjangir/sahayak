// ─── Partner location during an accepted job (ADR-049) ───────────────────────
// While a partner drives to the pickup they usually have Google Maps in front,
// not Sahayak. Without this the owner's map, the ETA and the start-at-pickup
// check (ADR-040) all read a position from when the partner last opened the app.
//
// Android: a location **foreground service** started while the app is open, with
// a visible notification ("Sharing your location for this job"). That is
// while-in-use access, so the app never asks for "Allow all the time"
// (ACCESS_BACKGROUND_LOCATION), which Google Play reviews hardest. iOS: the same
// call keeps reporting while the app is in the background during the job.
//
// Scope is the job only: it starts when the partner opens an accepted job and
// stops when the job is completed or cancelled, when the partner signs out, and
// when the app is swiped away (killServiceOnDestroy). If the service cannot start
// (permission refused, an OS that disallows it), a foreground-only watch takes
// over so the screen still reports while it is open.
import { Platform } from "react-native";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";

import { partnerApi } from "../../services/api/partner";

export const JOB_LOCATION_TASK = "sahayak-job-location";

/** Send at most every MIN_GAP_MS, and sooner only after moving MIN_MOVE_M. */
export const MIN_GAP_MS = 20_000;
export const MIN_MOVE_M = 75;
const HARD_FLOOR_MS = 5_000;

export type Fix = { lat: number; lng: number; at: number };

export function metresBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Pure: should this fix be sent, given the last one that was? */
export function shouldSend(last: Fix | null, next: Fix): boolean {
  if (!last) return true;
  const gap = next.at - last.at;
  if (gap < HARD_FLOOR_MS) return false;
  return gap >= MIN_GAP_MS || metresBetween(last, next) >= MIN_MOVE_M;
}

// Module state: the task callback runs in the same JS runtime while the
// foreground service keeps the process alive.
let activePartnerId: string | null = null;
let lastSent: Fix | null = null;
let watchSub: Location.LocationSubscription | null = null;

type Sender = (partnerId: string, lat: number, lng: number) => Promise<unknown>;
let send: Sender = (id, lat, lng) => partnerApi.reportLocation(id, lat, lng);

/** Tests only. */
export function __setSender(s: Sender) {
  send = s;
}
export function __reset() {
  activePartnerId = null;
  lastSent = null;
  watchSub = null;
}

export async function handleFixes(locations: { coords: { latitude: number; longitude: number }; timestamp: number }[]) {
  const partnerId = activePartnerId;
  if (!partnerId || !locations?.length) return;
  const newest = locations[locations.length - 1];
  const fix = { lat: newest.coords.latitude, lng: newest.coords.longitude, at: newest.timestamp || Date.now() };
  if (!shouldSend(lastSent, fix)) return;
  try {
    await send(partnerId, fix.lat, fix.lng);
    lastSent = fix;
  } catch {
    // The next fix retries; a dropped beacon only means a slightly older position.
  }
}

// Must run at module load (imported from index.ts), before React mounts, so the
// OS can deliver fixes to a task that is already defined.
if (Platform.OS !== "web" && !TaskManager.isTaskDefined(JOB_LOCATION_TASK)) {
  TaskManager.defineTask<{ locations: Location.LocationObject[] }>(JOB_LOCATION_TASK, async ({ data, error }) => {
    if (error || !data) return;
    await handleFixes(data.locations);
  });
}

export type TrackingMode = "service" | "foreground" | "off";

export async function startJobTracking(partnerId: string): Promise<TrackingMode> {
  if (Platform.OS === "web") return "off";
  activePartnerId = partnerId;
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== "granted") {
    activePartnerId = null;
    return "off";
  }
  try {
    if (await Location.hasStartedLocationUpdatesAsync(JOB_LOCATION_TASK)) return "service";
    await Location.startLocationUpdatesAsync(JOB_LOCATION_TASK, {
      accuracy: Location.Accuracy.High,
      timeInterval: 10_000,
      distanceInterval: 25,
      activityType: Location.ActivityType.AutomotiveNavigation,
      pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: "Sharing your location for this job",
        notificationBody: "The owner sees you on the way. Stops when the job ends.",
        notificationColor: "#0B0B0C",
        killServiceOnDestroy: true,
      },
    });
    return "service";
  } catch {
    // Fall back to reporting only while the screen is open.
    if (!watchSub) {
      watchSub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: 10_000, distanceInterval: 25 },
        (loc) => void handleFixes([loc]),
      );
    }
    return "foreground";
  }
}

export async function stopJobTracking(): Promise<void> {
  activePartnerId = null;
  lastSent = null;
  watchSub?.remove();
  watchSub = null;
  if (Platform.OS === "web") return;
  try {
    if (await Location.hasStartedLocationUpdatesAsync(JOB_LOCATION_TASK)) {
      await Location.stopLocationUpdatesAsync(JOB_LOCATION_TASK);
    }
  } catch {
    // Already stopped or never registered.
  }
}

/** Statuses during which the partner is on the way or carrying the vehicle. */
export const TRACKED_STATUSES = new Set(["assigned", "partner_en_route", "in_progress"]);
