import { ApiError } from './api';
import type { Job, JobStatus, Service } from '../types/jobs';
import {
  OFFER_TIMEOUT_S,
  SERVICE_CATALOG,
  type EarningsWindow,
  type PartnerEarnings,
  type PartnerOffer,
  type PartnerTrustStats,
} from '../types/partner';

/**
 * In-memory dispatch fixture.
 *
 * The /partners/me/* endpoints do not exist yet. Rather than stub each page
 * with hard-coded props, this keeps a real little state machine — offer issued
 * → accepted → en route → in progress → completed — so the partner console can
 * be clicked end to end, and so 409 races and timeouts are reachable instead of
 * theoretical. src/services/partner.service.ts switches to real fetch calls on
 * VITE_PARTNER_API_MOCK=false with no page changes.
 */

/* ── Fixture data ─────────────────────────────────────────────────────────── */

/** Indiranagar, Bengaluru — the demo service area used across the app. */
const PICKUP_AREA = { lat: 12.9716, lng: 77.6412 };

const CATEGORY_IDS: Record<string, number> = { towing: 1, mechanical: 2, fuel_delivery: 3 };

interface OfferScenario {
  serviceCode: string;
  distanceAtOfferM: number;
  pickupAddressText: string;
  vehicleNumber: string;
  issueDescription: string;
  /** Deliberately absent on one scenario: unpriced jobs must omit the payout
   *  line entirely rather than render "₹0", which reads as "this pays nothing". */
  payoutEstimate?: number;
}

const OFFER_SCENARIOS: OfferScenario[] = [
  {
    serviceCode: 'flat_tyre',
    distanceAtOfferM: 1800,
    pickupAddressText: '100 Feet Road, Indiranagar',
    vehicleNumber: 'KA 01 MJ 4412',
    issueDescription: 'Rear-left tyre flat. No spare in the boot.',
    payoutEstimate: 350,
  },
  {
    serviceCode: 'battery_jumpstart',
    distanceAtOfferM: 3200,
    pickupAddressText: 'CMH Road, near Jyoti Nivas, Koramangala',
    vehicleNumber: 'KA 05 HK 2087',
    issueDescription: 'Car will not crank after being parked two days.',
    payoutEstimate: 420,
  },
  {
    serviceCode: 'minor_repair',
    distanceAtOfferM: 900,
    pickupAddressText: 'Domlur Flyover, service road',
    vehicleNumber: 'KA 03 AB 6650',
    issueDescription: 'Coolant leaking, temperature warning on the cluster.',
    // No payout: the owner has not confirmed a quote yet.
  },
  {
    serviceCode: 'flatbed_tow',
    distanceAtOfferM: 5400,
    pickupAddressText: 'Old Airport Road, opposite Manipal Hospital',
    vehicleNumber: 'KA 51 MN 1193',
    issueDescription: 'Gearbox seized. Vehicle cannot roll, needs a flatbed.',
    payoutEstimate: 1250,
  },
];

/**
 * PLACEHOLDER EARNINGS — there is no /partners/me/earnings endpoint yet.
 * Completions made during this session are added on top of these so the
 * tracker visibly responds to finishing a job.
 */
const EARNINGS_BASELINE: Record<
  EarningsWindow,
  { jobsCompleted: number; amountEarned: number; previousAmountEarned: number }
> = {
  today: { jobsCompleted: 3, amountEarned: 1850, previousAmountEarned: 1720 },
  week: { jobsCompleted: 14, amountEarned: 8400, previousAmountEarned: 7317 },
};

/** PLACEHOLDER TRUST STATS — no /partners/me/stats endpoint yet. */
const TRUST_BASELINE = {
  offersReceived: 118,
  offersAccepted: 108,
  ratingAvg: 4.8,
  ratingCount: 96,
  lifetimeJobs: 142,
};

/* ── Mutable session state ────────────────────────────────────────────────── */

interface DispatchState {
  offer: PartnerOffer | null;
  activeJob: Job | null;
  /** Kept so a page can still resolve a job by id right after it completes. */
  finishedJobs: Job[];
  offersIssued: number;
  offersAccepted: number;
  jobsCompleted: number;
  earned: number;
  seq: number;
}

function emptyState(): DispatchState {
  return {
    offer: null,
    activeJob: null,
    finishedJobs: [],
    offersIssued: 0,
    offersAccepted: 0,
    jobsCompleted: 0,
    earned: 0,
    seq: 0,
  };
}

let state: DispatchState = emptyState();

export function resetPartnerDispatchMock(): void {
  state = emptyState();
}

/* ── Helpers ──────────────────────────────────────────────────────────────── */

function serviceFor(code: string): Service {
  const entry = SERVICE_CATALOG.find((s) => s.code === code);
  return {
    id: entry?.id ?? 0,
    category_id: CATEGORY_IDS[entry?.categoryCode ?? 'mechanical'] ?? 2,
    code,
    name: entry?.name ?? code,
    requires_vehicle_equipment: entry?.categoryCode === 'towing',
  };
}

function offerAgeSeconds(offer: PartnerOffer): number {
  return (Date.now() - new Date(offer.offeredAt).getTime()) / 1000;
}

function unavailable(): ApiError {
  // 409, not 404: the offer existed, someone else got there first.
  return new ApiError(409, {
    code: 'OFFER_UNAVAILABLE',
    message: 'This offer is no longer available',
  });
}

/* ── Operations ───────────────────────────────────────────────────────────── */

/** Issues a fresh offer, cycling through the scenarios so repeats stay varied. */
export function issueOffer(): PartnerOffer {
  const scenario = OFFER_SCENARIOS[state.offersIssued % OFFER_SCENARIOS.length];
  state.seq += 1;
  state.offersIssued += 1;

  state.offer = {
    id: `off_mock_${state.seq}`,
    jobId: `job_mock_${state.seq}`,
    serviceCode: scenario.serviceCode,
    serviceName: serviceFor(scenario.serviceCode).name,
    distanceAtOfferM: scenario.distanceAtOfferM,
    pickupAddressText: scenario.pickupAddressText,
    vehicleNumber: scenario.vehicleNumber,
    issueDescription: scenario.issueDescription,
    offeredAt: new Date().toISOString(),
    payoutEstimate: scenario.payoutEstimate,
  };

  return state.offer;
}

/**
 * The offer dispatch is currently holding for this partner, or null.
 *
 * Expires the offer on read, so a page that polls sees it disappear at 45s
 * exactly like the server would have reassigned it.
 */
export function getPendingOffer(): PartnerOffer | null {
  if (state.offer && offerAgeSeconds(state.offer) >= OFFER_TIMEOUT_S) {
    state.offer = null;
  }
  // Nothing in flight and nothing on the board — hand the partner something to
  // act on, so the console is demonstrable from a cold start.
  if (!state.offer && !state.activeJob && state.offersIssued === 0) {
    return issueOffer();
  }
  return state.offer;
}

export function acceptOffer(offerId: string): Job {
  const current = getPendingOffer();
  if (!current || current.id !== offerId) throw unavailable();

  state.offer = null;
  state.offersAccepted += 1;

  const now = new Date().toISOString();
  state.activeJob = {
    id: current.jobId,
    user_id: 'usr_mock_owner',
    vehicle_id: 'veh_mock_1',
    vehicle_number: current.vehicleNumber,
    service_id: serviceFor(current.serviceCode).id,
    service: serviceFor(current.serviceCode),
    status: 'assigned',
    pickup_location: { ...PICKUP_AREA, address: current.pickupAddressText },
    pickup_address_text: current.pickupAddressText,
    issue_description: current.issueDescription,
    price_estimate: current.payoutEstimate,
    requested_at: now,
    current_assignment: {
      id: `asg_${current.id}`,
      job_id: current.jobId,
      partner_id: 'ptr_ramesh_01',
      status: 'accepted',
      offered_at: current.offeredAt,
      responded_at: now,
      accepted_at: now,
      distance_at_offer_m: current.distanceAtOfferM,
    },
  };

  return state.activeJob;
}

/** Declining is never an error — an offer that already vanished is still declined. */
export function rejectOffer(offerId: string): void {
  if (state.offer && state.offer.id === offerId) {
    state.offer = null;
  }
}

export function getActiveJob(): Job | null {
  return state.activeJob;
}

export function getJob(jobId: string): Job | null {
  if (state.activeJob && state.activeJob.id === jobId) return state.activeJob;
  return state.finishedJobs.find((job) => job.id === jobId) ?? null;
}

export function updateJobStatus(jobId: string, status: JobStatus): Job {
  if (!state.activeJob || state.activeJob.id !== jobId) {
    throw new ApiError(409, {
      code: 'JOB_NOT_ACTIVE',
      message: 'This job is no longer active',
    });
  }

  const next: Job = { ...state.activeJob, status };

  if (status === 'completed') {
    next.completed_at = new Date().toISOString();
    next.price_final = state.activeJob.price_estimate;
    state.jobsCompleted += 1;
    state.earned += state.activeJob.price_estimate ?? 0;
    state.finishedJobs = [next, ...state.finishedJobs].slice(0, 10);
    state.activeJob = null;
    return next;
  }

  state.activeJob = next;
  return next;
}

/** Going off duty stops dispatch offering, so any held offer is released. */
export function setAvailability(isAvailable: boolean): void {
  if (!isAvailable) state.offer = null;
}

export function getEarnings(window: EarningsWindow): PartnerEarnings {
  const base = EARNINGS_BASELINE[window];
  return {
    window,
    jobsCompleted: base.jobsCompleted + state.jobsCompleted,
    amountEarned: base.amountEarned + state.earned,
    previousAmountEarned: base.previousAmountEarned,
  };
}

export function getTrustStats(): PartnerTrustStats {
  const received = TRUST_BASELINE.offersReceived + state.offersIssued;
  const accepted = TRUST_BASELINE.offersAccepted + state.offersAccepted;

  return {
    acceptanceRatePct: received === 0 ? 0 : Math.round((accepted / received) * 100),
    ratingAvg: TRUST_BASELINE.ratingAvg,
    ratingCount: TRUST_BASELINE.ratingCount,
    lifetimeJobs: TRUST_BASELINE.lifetimeJobs + state.jobsCompleted,
  };
}
