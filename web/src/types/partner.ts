/* ── Partner-side domain types ─────────────────────────────────────────────── */

export type PartnerCategory = 'towing' | 'mechanical' | 'both' | 'fuel_delivery';

/** Mirrors the 6 seeded rows in the services table. */
export interface PartnerService {
  id: number;
  code: string;
  name: string;
  categoryCode: 'towing' | 'mechanical' | 'fuel_delivery';
}

/** The real service catalog — exactly matches the backend seed data. */
export const SERVICE_CATALOG: PartnerService[] = [
  { id: 1, code: 'flat_tyre',         name: 'Flat-Tyre Support',     categoryCode: 'mechanical' },
  { id: 2, code: 'battery_jumpstart', name: 'Battery Jumpstart',     categoryCode: 'mechanical' },
  { id: 3, code: 'minor_repair',      name: 'On-Site Minor Repair',  categoryCode: 'mechanical' },
  { id: 4, code: 'flatbed_tow',       name: 'Flatbed Towing',        categoryCode: 'towing' },
  { id: 5, code: 'wheel_lift_tow',    name: 'Wheel-Lift Towing',     categoryCode: 'towing' },
  { id: 6, code: 'fuel_delivery',     name: 'Emergency Fuel (5L)',   categoryCode: 'fuel_delivery' },
];

export function servicesForCategory(cat: PartnerCategory): PartnerService[] {
  if (cat === 'both') {
    return SERVICE_CATALOG.filter((s) => s.categoryCode === 'towing' || s.categoryCode === 'mechanical');
  }
  return SERVICE_CATALOG.filter((s) => s.categoryCode === cat);
}

/* ── Category metadata ──────────────────────────────────────────────────── */

export interface CategoryMeta {
  code: PartnerCategory;
  label: string;
  description: string;
}

export const CATEGORIES: CategoryMeta[] = [
  { code: 'towing',        label: 'Towing',                 description: 'Flatbed & wheel-lift tow services' },
  { code: 'mechanical',    label: 'Mechanical',             description: 'Tyre, battery & on-site repairs' },
  { code: 'both',          label: 'Both (Tow & Mechanic)',  description: 'Full-service roadside workshop & rescue fleet' },
  { code: 'fuel_delivery', label: 'Fuel Delivery',          description: 'Emergency fuel drop-off' },
];

/* ── Equipment (towing only) ────────────────────────────────────────────── */

export type VehicleEquipmentType = 'flatbed_truck' | 'wheel_lift_truck' | 'bike_trailer';

export interface EquipmentEntry {
  type: VehicleEquipmentType;
  registrationNumber: string;
}

export const EQUIPMENT_TYPES: { code: VehicleEquipmentType; label: string }[] = [
  { code: 'flatbed_truck',    label: 'Flatbed Truck' },
  { code: 'wheel_lift_truck', label: 'Wheel-Lift Truck' },
  { code: 'bike_trailer',     label: 'Bike Trailer' },
];

/* ── Documents ──────────────────────────────────────────────────────────── */

export type DocumentType = 'aadhaar' | 'pan' | 'driving_licence' | 'rc_book' | 'insurance';

export interface DocumentUpload {
  type: DocumentType;
  label: string;
  fileName?: string;
  /** Set after submission; starts undefined during signup. */
  status?: 'pending' | 'approved' | 'rejected';
  rejectionReason?: string;
}

export const BASE_DOCUMENTS: DocumentUpload[] = [
  { type: 'aadhaar',         label: 'Aadhaar Card' },
  { type: 'pan',             label: 'PAN Card' },
  { type: 'driving_licence', label: 'Driving Licence' },
];

/** Extra docs required only for towing partners. */
export const TOWING_DOCUMENTS: DocumentUpload[] = [
  { type: 'rc_book',   label: 'RC Book' },
  { type: 'insurance', label: 'Vehicle Insurance' },
];

/* ── Verification ───────────────────────────────────────────────────────── */

export type VerificationTier = 'tier_1_identity' | 'tier_2_capabilities';

/**
 * Every verification item in either tier has exactly one of four states — never a bare "pending":
 * - not_started
 * - in_progress
 * - complete
 * - requirements_due (MUST specify the exact missing/rejected item by name)
 */
export type VerificationState = 'not_started' | 'in_progress' | 'complete' | 'requirements_due';

/** Backward-compat alias */
export type VerificationStatus = VerificationState | 'approved' | 'rejected' | 'pending' | 'not_submitted';

export interface VerificationItem {
  id: string;
  label: string;
  type: 'document' | 'service' | 'equipment';
  tier: VerificationTier;
  status: VerificationState;
  rejectionReason?: string;
  requirementsDueReason?: string;
}

/**
 * ARCHITECTURAL GATE NOTE:
 * Client-side toggles and greying-out are a UX convenience only, NOT the real gate.
 * The authoritative gate must exist server-side, in the dispatch path itself
 * (e.g., verifying partner tier_1_identity completion and per-capability verification status
 * before offering jobs), not solely inferred from what the client UI displays.
 */
export function isTier1Complete(profile: PartnerProfile): boolean {
  const tier1Items = profile.verificationItems.filter((i) => i.tier === 'tier_1_identity');
  return tier1Items.length > 0 && tier1Items.every((i) => i.status === 'complete');
}

/* ── Signup form state ──────────────────────────────────────────────────── */

export interface SignupFormState {
  phone: string;
  otpVerified: boolean;
  category: PartnerCategory | null;
  selectedServiceIds: number[];
  equipment: EquipmentEntry | null;
  documents: DocumentUpload[];
}

export const INITIAL_SIGNUP_STATE: SignupFormState = {
  phone: '',
  otpVerified: false,
  category: null,
  selectedServiceIds: [],
  equipment: null,
  documents: [],
};

/* ── Partner Profile (Preferences & Status storage) ─────────────────────── */

export interface PartnerVehicle {
  id: string;
  type: VehicleEquipmentType;
  registrationNumber: string;
}

export interface PartnerPreferenceService {
  id: number;
  code: string;
  name: string;
  active: boolean;
}

export interface PartnerOperationalDetails {
  // Operational zones & availability
  operatingZone: string;
  availabilityMode: '24_7' | 'daytime';
  teamSize: number;

  // Tow-specific details
  towTruckType: VehicleEquipmentType;
  towRegistrationNumber: string;
  towCapacity: string;
  winchEquipped: boolean;
  towCoverageRadiusKm: number;

  // Mechanic-specific details
  mechanicUnitType: 'bike_toolkit' | 'mobile_van' | 'workshop_dispatch';
  workshopName: string;
  workshopAddress: string;
  toolsEquipped: string[];
}

export const DEFAULT_OPERATIONAL_DETAILS: PartnerOperationalDetails = {
  operatingZone: 'Indiranagar & East Bengaluru',
  availabilityMode: '24_7',
  teamSize: 2,

  towTruckType: 'flatbed_truck',
  towRegistrationNumber: 'KA-01-MJ-8899',
  towCapacity: 'Up to 3.5 Tonnes (Cars & SUVs)',
  winchEquipped: true,
  towCoverageRadiusKm: 25,

  mechanicUnitType: 'mobile_van',
  workshopName: 'Speedy Mechanics',
  workshopAddress: '12th Main Road, Indiranagar, Bengaluru',
  toolsEquipped: [],
};

export interface PartnerProfile {
  id: string;
  phone: string;
  name: string;
  category: PartnerCategory;
  isAvailable?: boolean;
  services: PartnerPreferenceService[];
  vehicles: PartnerVehicle[];
  verificationItems: VerificationItem[];
  extraDetails: PartnerOperationalDetails;
  sampleJobCompleted?: boolean;
}

const STORAGE_KEY = 'sahayak_partner_profile';

export const DEFAULT_PARTNER_PROFILE: PartnerProfile = {
  id: 'ptr_ramesh_01',
  name: 'Ramesh Kumar (Speedy Mechanics)',
  phone: '+91 98111 22334',
  category: 'mechanical',
  isAvailable: true,
  services: [
    { id: 1, code: 'flat_tyre', name: 'Flat-Tyre Support', active: true },
    { id: 2, code: 'battery_jumpstart', name: 'Battery Jumpstart', active: true },
    { id: 3, code: 'minor_repair', name: 'On-Site Minor Repair', active: false },
  ],
  vehicles: [],
  verificationItems: [
    { id: 'doc_aadhaar', label: 'Aadhaar Card', type: 'document', tier: 'tier_1_identity', status: 'complete' },
    { id: 'doc_pan', label: 'PAN Card', type: 'document', tier: 'tier_1_identity', status: 'complete' },
    { id: 'doc_dl', label: 'Driving Licence', type: 'document', tier: 'tier_1_identity', status: 'complete' },
    { id: 'svc_flat_tyre', label: 'Flat-Tyre Support', type: 'service', tier: 'tier_2_capabilities', status: 'complete' },
    { id: 'svc_battery_jumpstart', label: 'Battery Jumpstart', type: 'service', tier: 'tier_2_capabilities', status: 'complete' },
    { id: 'svc_minor_repair', label: 'On-Site Minor Repair', type: 'service', tier: 'tier_2_capabilities', status: 'complete' },
  ],
  extraDetails: DEFAULT_OPERATIONAL_DETAILS,
  sampleJobCompleted: false,
};

function normalizeVerificationStatus(rawStatus: string): VerificationState {
  if (rawStatus === 'approved') return 'complete';
  if (rawStatus === 'pending') return 'in_progress';
  if (rawStatus === 'rejected') return 'requirements_due';
  if (rawStatus === 'not_submitted') return 'not_started';
  if (['not_started', 'in_progress', 'complete', 'requirements_due'].includes(rawStatus)) {
    return rawStatus as VerificationState;
  }
  return 'in_progress';
}

function inferTier(item: Partial<VerificationItem>): VerificationTier {
  if (item.tier) return item.tier;
  if (item.id === 'doc_aadhaar' || item.id === 'doc_pan' || item.id === 'doc_dl' || item.id?.startsWith('doc_')) {
    if (item.id === 'doc_rc_book' || item.id === 'doc_insurance') {
      return 'tier_2_capabilities';
    }
    return 'tier_1_identity';
  }
  return 'tier_2_capabilities';
}

export function getStoredPartnerProfile(): PartnerProfile {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const items: VerificationItem[] = (parsed.verificationItems || DEFAULT_PARTNER_PROFILE.verificationItems).map(
        (item: any) => ({
          ...item,
          tier: inferTier(item),
          status: normalizeVerificationStatus(item.status),
        })
      );
      return {
        ...DEFAULT_PARTNER_PROFILE,
        ...parsed,
        verificationItems: items,
        extraDetails: {
          ...DEFAULT_OPERATIONAL_DETAILS,
          ...(parsed.extraDetails || {}),
        },
      };
    }
  } catch {
    // localStorage unavailable
  }
  return DEFAULT_PARTNER_PROFILE;
}

/**
 * Fired on `window` after every profile write.
 *
 * localStorage only notifies *other* tabs, so two components in this document
 * that both hold a copy of the profile would silently drift apart after a save.
 * The partner store (src/features/partners/partnerStore.ts) listens for this so
 * there is exactly one live copy per tab.
 */
export const PARTNER_PROFILE_EVENT = 'sahayak:partner-profile';

export function saveStoredPartnerProfile(profile: PartnerProfile): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  } catch {
    // localStorage unavailable
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(PARTNER_PROFILE_EVENT, { detail: profile }));
  }
}

/* ── Dispatch operations: capability, location, offers, earnings ──────────── */

/**
 * Seconds a partner has to answer an offer before dispatch reassigns it.
 * Mirrors .agents/skills/dispatch-ui.
 */
export const OFFER_TIMEOUT_S = 45;

/**
 * How stale a partner's last GPS fix may be before dispatch should stop
 * treating them as locatable. Mirrors .agents/skills/dispatch-ui.
 */
export const MAX_LOCATION_AGE_S = 120;

/**
 * Warn before the fix actually expires. A partner who only finds out at the
 * moment they drop off the map has already missed offers; 90s leaves half a
 * minute to reopen the app or step outside.
 */
export const LOCATION_STALE_WARNING_S = 90;

export type LocationFreshness = 'fresh' | 'approaching_stale' | 'stale';

export function locationFreshness(ageSeconds: number): LocationFreshness {
  if (ageSeconds >= MAX_LOCATION_AGE_S) return 'stale';
  if (ageSeconds >= LOCATION_STALE_WARNING_S) return 'approaching_stale';
  return 'fresh';
}

export type PartnerCapability = 'mechanic' | 'tow_operator' | 'both' | 'fuel_delivery' | 'none';

/**
 * What this partner is cleared to do *right now*.
 *
 * Derived from Tier 2 service items that have actually cleared verification —
 * not from the category they picked in Preferences. A partner who selected
 * "Both" but has only had their mechanical services approved is a Mechanic
 * until the tow capability clears, and the dashboard must say so.
 */
export function derivePartnerCapability(profile: PartnerProfile): PartnerCapability {
  const verifiedCodes = new Set(
    profile.verificationItems
      .filter((item) => item.type === 'service' && item.status === 'complete')
      .map((item) => item.id.replace(/^svc_/, ''))
  );

  const verified = SERVICE_CATALOG.filter((svc) => verifiedCodes.has(svc.code));
  const hasTow = verified.some((svc) => svc.categoryCode === 'towing');
  const hasMechanical = verified.some((svc) => svc.categoryCode === 'mechanical');

  if (hasTow && hasMechanical) return 'both';
  if (hasTow) return 'tow_operator';
  if (hasMechanical) return 'mechanic';
  if (verified.some((svc) => svc.categoryCode === 'fuel_delivery')) return 'fuel_delivery';
  return 'none';
}

export function capabilityLabel(capability: PartnerCapability): string {
  switch (capability) {
    case 'both':
      return 'Both (Tow & Mechanic)';
    case 'tow_operator':
      return 'Tow Operator';
    case 'mechanic':
      return 'Mechanic';
    case 'fuel_delivery':
      return 'Fuel Delivery';
    default:
      return 'No verified services';
  }
}

/** A dispatch offer as the partner console needs it — flattened from job + assignment. */
export interface PartnerOffer {
  id: string;
  jobId: string;
  serviceCode: string;
  serviceName: string;
  /** Straight-line metres from the partner's last fix to the pickup. */
  distanceAtOfferM: number;
  pickupAddressText: string;
  vehicleNumber: string;
  issueDescription?: string;
  /** ISO timestamp. The countdown derives from this; it is never stored ticking. */
  offeredAt: string;
  /**
   * Absent until the job is priced. Callers must omit the payout line entirely
   * rather than render "₹0", which reads as "this job pays nothing".
   */
  payoutEstimate?: number;
}

export type EarningsWindow = 'today' | 'week';

export interface PartnerEarnings {
  window: EarningsWindow;
  jobsCompleted: number;
  amountEarned: number;
  /**
   * Settled total for the equivalent window immediately before this one — the
   * previous day for `today`, the previous week for `week`. The console derives
   * its trend figure from this rather than printing a hard-coded percentage.
   */
  previousAmountEarned: number;
}

export interface PartnerTrustStats {
  acceptanceRatePct: number;
  ratingAvg: number;
  ratingCount: number;
  lifetimeJobs: number;
}

export interface PartnerAvailabilityState {
  isAvailable: boolean;
  /** ISO timestamp of the last GPS fix, or null when never located. */
  lastLocationAt: string | null;
}

/**
 * A verification status change, surfaced in two places at once: the toast on
 * VerificationStatus and the dashboard Inbox.
 */
export interface VerificationEvent {
  id: string;
  itemId: string;
  itemLabel: string;
  status: VerificationState;
  /**
   * The specific stored reason — "Vehicle RC image is blurred", not "rejected".
   * Undefined for statuses that do not carry one (a clean approval).
   */
  reason?: string;
  /** ISO timestamp. */
  at: string;
  tone: 'success' | 'warning' | 'info';
}

/**
 * Diffs two verification item lists into the status changes between them.
 *
 * This is the single place a status change becomes an event, so the toast and
 * the Inbox can never disagree about what happened or why.
 */
export function diffVerificationItems(
  previous: VerificationItem[],
  next: VerificationItem[],
  at: string
): VerificationEvent[] {
  const before = new Map(previous.map((item) => [item.id, item]));

  return next
    .filter((item) => {
      const prior = before.get(item.id);
      // A newly added item counts as a change only if it is already actionable.
      return prior ? prior.status !== item.status : item.status !== 'not_started';
    })
    .map((item) => ({
      id: `${item.id}:${item.status}:${at}`,
      itemId: item.id,
      itemLabel: item.label,
      status: item.status,
      reason: item.requirementsDueReason || item.rejectionReason,
      at,
      tone:
        item.status === 'complete'
          ? ('success' as const)
          : item.status === 'requirements_due'
            ? ('warning' as const)
            : ('info' as const),
    }));
}
