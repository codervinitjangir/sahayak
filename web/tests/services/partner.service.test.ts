/**
 * Partner Service Contract Tests
 *
 * These tests assert exact HTTP method + path for every fixed call.
 * Path/method regressions are exactly the bug class this task exists to close —
 * see docs/FRONTEND-GUIDE.md §5.1 and TASKS-frontend.md for the full list.
 *
 * Tests run against the real fetch path (IS_PARTNER_API_MOCK = false) by
 * stubbing import.meta.env and mocking global fetch.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Patch the env flag before the module is imported — Vite's import.meta.env
// is read at module initialisation, so the stub must exist beforehand.
vi.stubEnv('VITE_PARTNER_API_MOCK', 'false');

// Stub localStorage so getStoredPartnerProfile() finds a known partner_id.
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
  };
})();
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true });

// Seed a partner profile so setAvailability() has a real partner_id.
const SEEDED_PARTNER_ID = 'ptr-test-123';
localStorageMock.setItem(
  'sahayak_partner_profile',
  JSON.stringify({ id: SEEDED_PARTNER_ID })
);

import { partnerService } from '../../src/services/partner.service';

// ── Helpers ──────────────────────────────────────────────────────────────────

function mockResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : status === 201 ? 'Created' : '',
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response;
}

function offerListResponse(assignmentId = 'asgn-001', jobId = 'job-001') {
  return mockResponse(200, {
    data: [
      {
        assignment_id: assignmentId,
        job_id: jobId,
        offered_at: '2026-09-27T11:03:30.784705Z',
        distance_at_offer_m: '988.74',
        estimated_arrival_min: 4,
        assignment_rank: 1,
        job: {
          status: 'matching',
          service_code: 'battery_jumpstart',
          service_name: 'Battery Jumpstart',
          vehicle_number: 'GJ01AB1234',
          pickup_address_text: 'Outer Ring Rd, near Marathahalli bridge',
          issue_description: 'Battery dead, car won\'t start',
          price_estimate: '450.00',
          requested_at: '2026-09-27T11:03:29.101422Z',
        },
      },
    ],
    meta: { request_id: 'req-001' },
  });
}

function emptyOfferListResponse() {
  return mockResponse(200, { data: [], meta: { request_id: 'req-002' } });
}

function respondResponse(action: 'accept' | 'reject') {
  return mockResponse(200, {
    data: {
      assignment_id: 'asgn-abc',
      assignment_status: action === 'accept' ? 'accepted' : 'rejected',
      job_id: 'job-001',
      job_status: action === 'accept' ? 'assigned' : 'matching',
    },
    meta: { request_id: 'req-003' },
  });
}

function availabilityResponse() {
  return mockResponse(200, { data: { is_available: true }, meta: { request_id: 'req-004' } });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('partner.service — real-path contract tests', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    localStorageMock.setItem(
      'sahayak_partner_profile',
      JSON.stringify({ id: SEEDED_PARTNER_ID })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorageMock.clear();
  });

  // ── 1. getPendingOffer ─────────────────────────────────────────────────────

  describe('getPendingOffer()', () => {
    it('calls GET /partners/me/offers — exact method and path', async () => {
      vi.mocked(fetch).mockResolvedValue(offerListResponse());

      await partnerService.getPendingOffer();

      expect(fetch).toHaveBeenCalledTimes(1);
      const [url, options] = vi.mocked(fetch).mock.calls[0];
      expect(url).toMatch(/\/partners\/me\/offers$/);
      expect(options?.method).toBe('GET');
    });

    it('returns the first item from the list as a PartnerOffer', async () => {
      vi.mocked(fetch).mockResolvedValue(offerListResponse('asgn-999', 'job-999'));

      const offer = await partnerService.getPendingOffer();

      expect(offer).not.toBeNull();
      // id should be the assignment_id from the wire (not a separate "offer id")
      expect(offer!.id).toBe('asgn-999');
      expect(offer!.jobId).toBe('job-999');
      expect(offer!.payoutEstimate).toBe(450);        // parsed from "450.00" string
      expect(offer!.distanceAtOfferM).toBe(988.74);   // parsed from "988.74" string
    });

    it('returns null (not an error) when the list is empty', async () => {
      vi.mocked(fetch).mockResolvedValue(emptyOfferListResponse());

      const offer = await partnerService.getPendingOffer();

      expect(offer).toBeNull();
      // Must NOT throw
    });

    it('does NOT call /partners/me/offers/current (old wrong path)', async () => {
      vi.mocked(fetch).mockResolvedValue(offerListResponse());

      await partnerService.getPendingOffer();

      const [url] = vi.mocked(fetch).mock.calls[0];
      expect(url).not.toMatch(/\/current$/);
    });
  });

  // ── 2. acceptOffer ─────────────────────────────────────────────────────────

  describe('acceptOffer(assignmentId)', () => {
    it('calls POST /job-assignments/{id}/respond — exact method and path', async () => {
      vi.mocked(fetch).mockResolvedValue(respondResponse('accept'));

      await partnerService.acceptOffer('asgn-abc');

      expect(fetch).toHaveBeenCalledTimes(1);
      const [url, options] = vi.mocked(fetch).mock.calls[0];
      expect(url).toMatch(/\/job-assignments\/asgn-abc\/respond$/);
      expect(options?.method).toBe('POST');
    });

    it('sends { action: "accept" } in the body', async () => {
      vi.mocked(fetch).mockResolvedValue(respondResponse('accept'));

      await partnerService.acceptOffer('asgn-abc');

      const [, options] = vi.mocked(fetch).mock.calls[0];
      const body = JSON.parse(options?.body as string);
      expect(body.action).toBe('accept');
      // Must NOT send "rejection_reason" on an accept
      expect(body.rejection_reason).toBeUndefined();
    });

    it('does NOT call /partners/me/offers/{id}/accept (old wrong path)', async () => {
      vi.mocked(fetch).mockResolvedValue(respondResponse('accept'));

      await partnerService.acceptOffer('asgn-abc');

      const [url] = vi.mocked(fetch).mock.calls[0];
      expect(url).not.toMatch(/\/accept$/);
      expect(url).not.toMatch(/\/partners\/me\/offers/);
    });

    it('returns AssignmentRespondResponse with assignment_status accepted', async () => {
      vi.mocked(fetch).mockResolvedValue(respondResponse('accept'));

      const result = await partnerService.acceptOffer('asgn-abc');

      expect(result.assignment_status).toBe('accepted');
    });
  });

  // ── 3. rejectOffer ─────────────────────────────────────────────────────────

  describe('rejectOffer(assignmentId, reason?)', () => {
    it('calls POST /job-assignments/{id}/respond — exact method and path', async () => {
      vi.mocked(fetch).mockResolvedValue(respondResponse('reject'));

      await partnerService.rejectOffer('asgn-xyz');

      expect(fetch).toHaveBeenCalledTimes(1);
      const [url, options] = vi.mocked(fetch).mock.calls[0];
      expect(url).toMatch(/\/job-assignments\/asgn-xyz\/respond$/);
      expect(options?.method).toBe('POST');
    });

    it('sends { action: "reject" } without rejection_reason when none provided', async () => {
      vi.mocked(fetch).mockResolvedValue(respondResponse('reject'));

      await partnerService.rejectOffer('asgn-xyz');

      const [, options] = vi.mocked(fetch).mock.calls[0];
      const body = JSON.parse(options?.body as string);
      expect(body.action).toBe('reject');
      expect(body.rejection_reason).toBeUndefined();
    });

    it('sends rejection_reason in the body when provided', async () => {
      vi.mocked(fetch).mockResolvedValue(respondResponse('reject'));

      await partnerService.rejectOffer('asgn-xyz', 'Too far away');

      const [, options] = vi.mocked(fetch).mock.calls[0];
      const body = JSON.parse(options?.body as string);
      expect(body.action).toBe('reject');
      expect(body.rejection_reason).toBe('Too far away');
    });

    it('does NOT call /partners/me/offers/{id}/reject (old wrong path)', async () => {
      vi.mocked(fetch).mockResolvedValue(respondResponse('reject'));

      await partnerService.rejectOffer('asgn-xyz');

      const [url] = vi.mocked(fetch).mock.calls[0];
      expect(url).not.toMatch(/\/reject$/);
      expect(url).not.toMatch(/\/partners\/me\/offers/);
    });
  });

  // ── 4. setAvailability ─────────────────────────────────────────────────────

  describe('setAvailability(isAvailable)', () => {
    it('calls PATCH /partners/{partner_id}/availability — exact method and path', async () => {
      vi.mocked(fetch).mockResolvedValue(availabilityResponse());

      await partnerService.setAvailability(true);

      expect(fetch).toHaveBeenCalledTimes(1);
      const [url, options] = vi.mocked(fetch).mock.calls[0];
      expect(url).toMatch(new RegExp(`/partners/${SEEDED_PARTNER_ID}/availability$`));
      expect(options?.method).toBe('PATCH');
    });

    it('sends { is_available: bool } in the body', async () => {
      vi.mocked(fetch).mockResolvedValue(availabilityResponse());

      await partnerService.setAvailability(false);

      const [, options] = vi.mocked(fetch).mock.calls[0];
      const body = JSON.parse(options?.body as string);
      expect(body.is_available).toBe(false);
    });

    it('does NOT call POST /partners/me/availability (old wrong method+path)', async () => {
      vi.mocked(fetch).mockResolvedValue(availabilityResponse());

      await partnerService.setAvailability(true);

      const [url, options] = vi.mocked(fetch).mock.calls[0];
      expect(options?.method).not.toBe('POST');
      expect(url).not.toMatch(/\/me\/availability/);
    });

    it('uses the partner_id from the stored profile, not a hardcoded value', async () => {
      // Override the stored profile with a different id
      localStorageMock.setItem(
        'sahayak_partner_profile',
        JSON.stringify({ id: 'ptr-different-456' })
      );
      vi.mocked(fetch).mockResolvedValue(availabilityResponse());

      await partnerService.setAvailability(true);

      const [url] = vi.mocked(fetch).mock.calls[0];
      expect(url).toMatch(/\/partners\/ptr-different-456\/availability$/);
    });
  });

  // ── 4b. reportLocation ─────────────────────────────────────────────────────

  describe('reportLocation(lat, lng)', () => {
    it('calls POST /partners/{partner_id}/location — exact method and path', async () => {
      vi.mocked(fetch).mockResolvedValue(
        mockResponse(200, {
          data: { partner_id: SEEDED_PARTNER_ID, recorded_at: '2026-10-06T12:00:00Z' },
          meta: { request_id: 'req-loc-001' },
        }),
      );

      const res = await partnerService.reportLocation(12.9716, 77.5946);

      expect(fetch).toHaveBeenCalledTimes(1);
      const [url, options] = vi.mocked(fetch).mock.calls[0];
      expect(url).toMatch(new RegExp(`/partners/${SEEDED_PARTNER_ID}/location$`));
      expect(options?.method).toBe('POST');
      expect(res?.partner_id).toBe(SEEDED_PARTNER_ID);
    });

    it('sends { lat, lng } numbers in the body', async () => {
      vi.mocked(fetch).mockResolvedValue(
        mockResponse(200, {
          data: { partner_id: SEEDED_PARTNER_ID, recorded_at: '2026-10-06T12:00:00Z' },
          meta: { request_id: 'req-loc-002' },
        }),
      );

      await partnerService.reportLocation(12.9716, 77.5946);

      const [, options] = vi.mocked(fetch).mock.calls[0];
      const body = JSON.parse(options?.body as string);
      expect(body).toEqual({ lat: 12.9716, lng: 77.5946 });
    });
  });

  // ── 5. getActiveJob ────────────────────────────────────────────────────────

  describe('getActiveJob()', () => {
    it('calls GET /partners/me/jobs/active — exact method and path', async () => {
      vi.mocked(fetch).mockResolvedValue(
        mockResponse(200, {
          data: {
            id: 'job-active-123',
            status: 'assigned',
            vehicle_id: 'veh-001',
            requested_at: '2026-10-06T10:00:00Z',
          },
          meta: { request_id: 'req-active-001' },
        }),
      );

      const job = await partnerService.getActiveJob();

      expect(fetch).toHaveBeenCalledTimes(1);
      const [url, options] = vi.mocked(fetch).mock.calls[0];
      expect(url).toMatch(/\/partners\/me\/jobs\/active$/);
      expect(options?.method ?? 'GET').toBe('GET');
      expect(job?.id).toBe('job-active-123');
    });

    it('returns null (not an error) when partner has no active job', async () => {
      vi.mocked(fetch).mockResolvedValue(
        mockResponse(200, { data: null, meta: { request_id: 'req-active-002' } }),
      );

      const job = await partnerService.getActiveJob();

      expect(job).toBeNull();
    });

    it('does NOT call wrong path shapes like /partners/me/active-job', async () => {
      vi.mocked(fetch).mockResolvedValue(
        mockResponse(200, { data: null, meta: { request_id: 'req-active-003' } }),
      );

      await partnerService.getActiveJob();

      const [url] = vi.mocked(fetch).mock.calls[0];
      expect(url).not.toMatch(/\/partners\/me\/active-job$/);
      expect(url).toMatch(/\/partners\/me\/jobs\/active$/);
    });
  });

  // ── 6. getEarnings — mock-only gap ────────────────────────────────────────

  describe('getEarnings() — backend gap', () => {
    it('never hits the network (no /partners/me/earnings endpoint exists)', async () => {
      vi.mocked(fetch).mockResolvedValue(mockResponse(200, { data: null, meta: {} }));

      await partnerService.getEarnings('today');

      expect(fetch).not.toHaveBeenCalled();
    });
  });

  // ── 7. getTrustStats ──────────────────────────────────────────────────────

  describe('getTrustStats()', () => {
    it('calls GET /partners/me/stats — exact method and path', async () => {
      vi.mocked(fetch).mockResolvedValue(
        mockResponse(200, {
          data: {
            partner_id: 'ptr_123',
            verification_status: 'verified',
            rating_avg: 4.85,
            rating_count: 24,
            acceptance_rate_pct: 92,
            lifetime_jobs: 38,
          },
          meta: { request_id: 'req-stats-001' },
        }),
      );

      const stats = await partnerService.getTrustStats();

      expect(fetch).toHaveBeenCalledTimes(1);
      const [url, options] = vi.mocked(fetch).mock.calls[0];
      expect(url).toMatch(/\/partners\/me\/stats$/);
      expect(options?.method ?? 'GET').toBe('GET');
      expect(stats).toEqual({
        acceptanceRatePct: 92,
        ratingAvg: 4.85,
        ratingCount: 24,
        lifetimeJobs: 38,
      });
    });

    it('handles numeric string rating_avg gracefully', async () => {
      vi.mocked(fetch).mockResolvedValue(
        mockResponse(200, {
          data: {
            partner_id: 'ptr_123',
            verification_status: 'verified',
            rating_avg: '4.50',
            rating_count: 10,
            acceptance_rate_pct: 100,
            lifetime_jobs: 5,
          },
          meta: { request_id: 'req-stats-002' },
        }),
      );

      const stats = await partnerService.getTrustStats();

      expect(stats.ratingAvg).toBe(4.5);
    });
  });
});

