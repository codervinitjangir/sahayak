// ─── Sahayak — Partner display helpers ────────────────────────────────────────
// One place for the small translations every partner screen needs: the
// backend's service codes to the app's icon/colour vocabulary, its lifecycle
// status strings to labels, and money/distance formatting. Keeping these out of
// the screens is what stops three copies of the same mapping drifting apart.
import { ServiceConfig } from "../../constants/theme";
import type { ServiceType } from "../../types";

const SERVICE_TYPE_BY_CODE: Record<string, ServiceType> = {
  flatbed_towing: "towing",
  wheel_lift_towing: "towing",
  flat_tyre: "tyre",
  battery_jumpstart: "battery",
  fuel_delivery: "fuel",
  minor_repair: "mechanic",
};

export const serviceTypeFor = (code?: string | null): ServiceType =>
  (code && SERVICE_TYPE_BY_CODE[code]) || "mechanic";

export const serviceMetaFor = (code?: string | null) =>
  ServiceConfig[serviceTypeFor(code)];

export const JOB_STATUS_LABELS: Record<string, string> = {
  requested: "Requested",
  matching: "Matching",
  assigned: "Assigned",
  partner_en_route: "En route",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
  no_match_found: "No partner found",
};

export const inr = (value?: number | null): string =>
  value == null ? "—" : `₹${Math.round(Number(value)).toLocaleString("en-IN")}`;

/** "0.0 km" reads as a bug when the partner is standing at the pickup, so short
 *  distances are shown in metres and anything under 100 m as "Under 100 m". */
export const metresToKm = (metres?: number | null): string | null => {
  if (metres == null) return null;
  const m = Number(metres);
  if (!Number.isFinite(m)) return null;
  if (m < 100) return "Under 100 m";
  if (m < 1000) return `${Math.round(m / 10) * 10} m`;
  return `${(m / 1000).toFixed(1)} km`;
};

/** First name for greetings. Falls back to nothing (not "Service") when the
 *  partner still carries the placeholder name "Service partner". */
export const firstNameFor = (name?: string | null): string | null => {
  const trimmed = (name ?? "").trim();
  if (!trimmed || /^service partner$/i.test(trimmed)) return null;
  return trimmed.split(/\s+/)[0];
};

export const statusLabelFor = (status: string): string =>
  JOB_STATUS_LABELS[status] ?? status.replace(/_/g, " ");
