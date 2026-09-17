// ─── App-wide constants ───────────────────────────────────────────────────────

// The /api/v1 prefix is part of the contract — every endpoint the service
// modules call ("/jobs", "/jobs/:id") is relative to it. Without it every
// request 404s.
export const API_BASE_URL = __DEV__
  ? "http://10.0.2.2:8000/api/v1" // Android emulator localhost
  : "https://api.sahayak.app/api/v1";

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
