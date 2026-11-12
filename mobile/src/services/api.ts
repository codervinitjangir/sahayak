// ─── Sahayak — Mobile Real API Services ────────────────────────────────────────
// Rule A Compliant: ALL data comes from backend API.
import { apiClient } from "./api/client";
import { jobsApi } from "./api/jobs";
import { notificationsApi } from "./api/notifications";
import { vehiclesApi } from "./api/vehicles";
import { servicesApi } from "./api/services";
import { partnerApi } from "./api/partner";
import type { SubService, ServiceType } from "../types";

export {
  apiClient,
  jobsApi,
  notificationsApi,
  vehiclesApi,
  servicesApi,
  partnerApi,
};

// ─── Standard Service Category Catalogue (Reference Data) ─────────────────────
export const SEEDED_SUB_SERVICES: Record<ServiceType, SubService[]> = {
  battery: [
    { id: "bat_01", name: "Jump Start (12V/24V)", estimatedPrice: 499 },
    { id: "bat_02", name: "Battery Health Diagnostics", estimatedPrice: 299 },
  ],
  tyre: [
    { id: "tyr_01", name: "Tubeless Puncture Repair", estimatedPrice: 399 },
    { id: "tyr_02", name: "Stepney Wheel Replacement", estimatedPrice: 349 },
  ],
  towing: [
    { id: "tow_01", name: "Flatbed Towing", estimatedPrice: 1499 },
    { id: "tow_02", name: "Wheel-Lift Towing", estimatedPrice: 1199 },
  ],
  fuel: [
    { id: "fue_01", name: "Emergency Fuel Delivery (5L)", estimatedPrice: 449 },
  ],
  lockout: [
    { id: "loc_01", name: "Emergency Vehicle Lockout Assist", estimatedPrice: 499 },
  ],
  mechanic: [
    { id: "mec_01", name: "On-Site Minor Mechanical Repair", estimatedPrice: 599 },
    { id: "mec_02", name: "Engine Breakdown Diagnosis", estimatedPrice: 599 },
  ],
};

// ─── Idempotency Key Generator ────────────────────────────────────────────────
export function createIdempotencyKey(): string {
  return "idem_" + Date.now() + "_" + Math.random().toString(36).substring(2, 9);
}
