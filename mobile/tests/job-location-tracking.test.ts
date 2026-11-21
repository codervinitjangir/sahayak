import { describe, it, expect, vi, beforeEach } from "vitest";

// ADR-049: partner position during an accepted job.
const loc = vi.hoisted(() => ({
  requestForegroundPermissionsAsync: vi.fn(),
  hasStartedLocationUpdatesAsync: vi.fn(),
  startLocationUpdatesAsync: vi.fn(),
  stopLocationUpdatesAsync: vi.fn(),
  watchPositionAsync: vi.fn(),
  Accuracy: { High: 4 },
  ActivityType: { AutomotiveNavigation: 2 },
}));
const tm = vi.hoisted(() => ({ isTaskDefined: vi.fn(() => false), defineTask: vi.fn() }));
vi.mock("expo-location", () => loc);
vi.mock("expo-task-manager", () => tm);
vi.mock("react-native", () => ({ Platform: { OS: "android" } }));
vi.mock("../src/services/api/partner", () => ({ partnerApi: { reportLocation: vi.fn() } }));

import * as T from "../src/features/partner/jobLocationTracking";

const definedAtLoad = [...tm.defineTask.mock.calls];

const fix = (lat: number, lng: number, at: number) => ({ coords: { latitude: lat, longitude: lng }, timestamp: at });

beforeEach(() => {
  vi.clearAllMocks();
  T.__reset();
});

describe("send rules", () => {
  it("first fix always, then every 20 s or after 75 m, never faster than 5 s", () => {
    const a = { lat: 12.9, lng: 77.6, at: 0 };
    expect(T.shouldSend(null, a)).toBe(true);
    expect(T.shouldSend(a, { ...a, at: 10_000 })).toBe(false);              // 10 s, not moved
    expect(T.shouldSend(a, { ...a, at: 20_000 })).toBe(true);               // 20 s
    expect(T.shouldSend(a, { lat: 12.901, lng: 77.6, at: 8_000 })).toBe(true); // ~111 m at 8 s
    expect(T.shouldSend(a, { lat: 12.901, lng: 77.6, at: 3_000 })).toBe(false); // under the floor
  });

  it("measures distance in metres", () => {
    expect(Math.round(T.metresBetween({ lat: 12.9, lng: 77.6 }, { lat: 12.901, lng: 77.6 }))).toBe(111);
  });
});

describe("start, report, stop", () => {
  it("defines the task at load time", () => {
    expect(definedAtLoad[0]?.[0]).toBe(T.JOB_LOCATION_TASK);
    expect(typeof definedAtLoad[0]?.[1]).toBe("function");
  });

  it("starts a foreground service with a visible notification and no background permission ask", async () => {
    loc.requestForegroundPermissionsAsync.mockResolvedValue({ status: "granted" });
    loc.hasStartedLocationUpdatesAsync.mockResolvedValue(false);
    loc.startLocationUpdatesAsync.mockResolvedValue(undefined);
    expect(await T.startJobTracking("p1")).toBe("service");
    const opts = loc.startLocationUpdatesAsync.mock.calls[0][1];
    expect(opts.foregroundService.notificationTitle).toMatch(/sharing your location/i);
    expect(opts.foregroundService.killServiceOnDestroy).toBe(true);
    expect((loc as Record<string, unknown>).requestBackgroundPermissionsAsync).toBeUndefined();
  });

  it("reports fixes for the partner, throttled, and nothing after stop", async () => {
    const sent: unknown[][] = [];
    T.__setSender(async (...args) => void sent.push(args));
    loc.requestForegroundPermissionsAsync.mockResolvedValue({ status: "granted" });
    loc.hasStartedLocationUpdatesAsync.mockResolvedValue(false);
    await T.startJobTracking("p1");
    await T.handleFixes([fix(12.9, 77.6, 1_000)]);
    await T.handleFixes([fix(12.9, 77.6, 4_000)]);                 // too soon
    await T.handleFixes([fix(12.9, 77.6, 30_000), fix(12.95, 77.6, 31_000)]); // newest wins
    expect(sent).toEqual([["p1", 12.9, 77.6], ["p1", 12.95, 77.6]]);
    loc.hasStartedLocationUpdatesAsync.mockResolvedValue(true);
    await T.stopJobTracking();
    expect(loc.stopLocationUpdatesAsync).toHaveBeenCalledWith(T.JOB_LOCATION_TASK);
    await T.handleFixes([fix(13, 77.6, 90_000)]);
    expect(sent).toHaveLength(2);
  });

  it("falls back to a screen-open watch when the service cannot start", async () => {
    loc.requestForegroundPermissionsAsync.mockResolvedValue({ status: "granted" });
    loc.hasStartedLocationUpdatesAsync.mockResolvedValue(false);
    loc.startLocationUpdatesAsync.mockRejectedValue(new Error("not allowed"));
    loc.watchPositionAsync.mockResolvedValue({ remove: vi.fn() });
    expect(await T.startJobTracking("p1")).toBe("foreground");
    expect(loc.watchPositionAsync).toHaveBeenCalled();
  });

  it("does nothing when location permission is refused", async () => {
    loc.requestForegroundPermissionsAsync.mockResolvedValue({ status: "denied" });
    expect(await T.startJobTracking("p1")).toBe("off");
    expect(loc.startLocationUpdatesAsync).not.toHaveBeenCalled();
  });

  it("tracks only while the partner is on the way or carrying the vehicle", () => {
    expect([...T.TRACKED_STATUSES].sort()).toEqual(["assigned", "in_progress", "partner_en_route"]);
  });
});
