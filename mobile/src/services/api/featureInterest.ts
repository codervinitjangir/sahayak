import { apiClient } from "./client";

// ADR-035: "notify me" on features that are announced but not built. Owners
// and partners each have their own list; the backend picks it from the token.
export type OwnerComingSoon = "scheduled" | "doorstep" | "pickup-drop";
export type PartnerComingSoon = "financing" | "certification" | "custody-tier";
export type ComingSoonFeature = OwnerComingSoon | PartnerComingSoon;

export const featureInterestApi = {
  listMine: () =>
    apiClient.get<{ features: ComingSoonFeature[] }>("/feature-interest/me").then((r) => r.data.features),
  register: (feature: ComingSoonFeature) =>
    apiClient.post<{ features: ComingSoonFeature[] }>("/feature-interest", { feature }).then((r) => r.data.features),
};
