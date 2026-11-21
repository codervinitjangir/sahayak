// Announced but not built yet (docs/FUTURE-ROADMAP.md, ADR-035). Scheduled service
// shipped on 2026-11-21 (ADR-050) and left this list. Keep the
// wording in step with web/src/components/ComingSoonServices.tsx.
// B2B is deliberately not here: it stays in the roadmap until it has its own panel.
import type { ComingSoonFeature } from "../../services/api/featureInterest";

export interface ComingSoonItem {
  id: ComingSoonFeature;
  icon: string;
  title: string;
  blurb: string;
  detail: string;
}

export const OWNER_COMING_SOON: readonly ComingSoonItem[] = [
  {
    id: "doorstep",
    icon: "home-outline",
    title: "Doorstep repair",
    blurb: "A verified mechanic repairs your vehicle at home.",
    detail: "The mechanic inspects your vehicle and sends a quote in the app. No work starts until you approve it.",
  },
  {
    id: "pickup-drop",
    icon: "swap-horizontal-outline",
    title: "Pick-up & drop",
    blurb: "We take your vehicle to the workshop and bring it back.",
    detail:
      "Photos are taken at pick-up and again at drop, keys change hands with a one-time code, and you can follow the vehicle live while it is away.",
  },
];

export const PARTNER_COMING_SOON: readonly ComingSoonItem[] = [
  {
    id: "financing",
    icon: "wallet-outline",
    title: "Partner financing",
    blurb: "Loans for tools or a tow vehicle.",
    detail: "Get finance for equipment through a lending partner, repaid in small amounts from your Sahayak payouts.",
  },
  {
    id: "certification",
    icon: "school-outline",
    title: "Training & certification",
    blurb: "Short courses for EVs and newer vehicles.",
    detail:
      "Finish a course and earn a certification badge on your profile. Certified partners are matched to jobs that need the skill.",
  },
  {
    id: "custody-tier",
    icon: "key-outline",
    title: "Pick-up & drop partner",
    blurb: "Take vehicles to your workshop and bring them back.",
    detail:
      "Open to verified workshops only: police verification, a site visit and a security deposit. These jobs pay more because you hold the vehicle.",
  },
];
