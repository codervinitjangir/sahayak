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

export const metresToKm = (metres?: number | null): string | null =>
  metres == null ? null : `${(Number(metres) / 1000).toFixed(1)} km`;

export const statusLabelFor = (status: string): string =>
  JOB_STATUS_LABELS[status] ?? status.replace(/_/g, " ");
