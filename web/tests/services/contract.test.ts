import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { jobsService } from '../../src/services/jobs.service';
import { usersService } from '../../src/services/users.service';
import { vehiclesService } from '../../src/services/vehicles.service';
import { getAuthToken, setAuthToken } from '../../src/services/authToken';

function mockResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : '',
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response;
}

describe('Backend Contract Compliance Tests', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  describe('Job Create Contract', () => {
    it('sends service_code, pickup_lat, pickup_lng and omits user_id from request body', async () => {
      setAuthToken('test-jwt-token');

      vi.mocked(fetch).mockResolvedValue(
        mockResponse(200, {
          data: {
            id: 'job-xyz-123',
            service_code: 'flat_tyre',
            pickup_lat: 12.9716,
            pickup_lng: 77.5946,
            status: 'matching',
            requested_at: '2026-09-23T12:00:00Z',
          },
        })
      );

      const job = await jobsService.createJob({
        service_code: 'flat_tyre',
        pickup_lat: 12.9716,
        pickup_lng: 77.5946,
        vehicle_id: 'veh-123',
        pickup_address_text: 'Indiranagar 100ft Rd',
        issue_description: 'Flat left tyre',
      });

      expect(job.id).toBe('job-xyz-123');
      expect(fetch).toHaveBeenCalledTimes(1);

      const [url, options] = vi.mocked(fetch).mock.calls[0];
      expect(url).toContain('/jobs');
      expect(options?.method).toBe('POST');

      const headers = options?.headers as Record<string, string>;
      expect(headers['Authorization']).toBe('Bearer test-jwt-token');
      expect(headers['Idempotency-Key']).toBeTruthy();

      const parsedBody = JSON.parse(options?.body as string);
      expect(parsedBody.service_code).toBe('flat_tyre');
      expect(parsedBody.pickup_lat).toBe(12.9716);
      expect(parsedBody.pickup_lng).toBe(77.5946);
      expect(parsedBody.vehicle_id).toBe('veh-123');
      expect(parsedBody.pickup_address_text).toBe('Indiranagar 100ft Rd');
      expect(parsedBody.issue_description).toBe('Flat left tyre');
      expect(parsedBody.user_id).toBeUndefined();
    });
  });

  describe('Owner Signup Contract (POST /api/v1/users)', () => {
    it('submits owner registration with the caller already authenticated', async () => {
      // The precondition, not an incidental detail: POST /users is an
      // authenticated route. It creates the profile *and* binds it to the Supabase
      // account the bearer token belongs to, so a request without a token is a 401
      // and registration is impossible before sign-in.
      setAuthToken('supabase-access-token');

      vi.mocked(fetch).mockResolvedValue(
        mockResponse(200, {
          data: {
            id: 'usr-new-001',
            name: 'Asha Sharma',
            phone: '+919876543210',
            phone_verified: true,
            created_at: '2026-10-06T10:00:00Z',
          },
        })
      );

      const user = await usersService.createUser({
        name: 'Asha Sharma',
        phone: '+919876543210',
        role: 'owner',
      });

      expect(user.id).toBe('usr-new-001');
      expect(fetch).toHaveBeenCalledTimes(1);

      const [url, options] = vi.mocked(fetch).mock.calls[0];
      expect(url).toContain('/users');
      expect(options?.method).toBe('POST');
      expect((options?.headers as Record<string, string>)?.Authorization).toBe(
        'Bearer supabase-access-token'
      );

      const parsedBody = JSON.parse(options?.body as string);
      expect(parsedBody.name).toBe('Asha Sharma');
      expect(parsedBody.phone).toBe('+919876543210');
      expect(parsedBody.role).toBe('owner');
    });

    it('does not replace the session token, because registration issues none', async () => {
      // This test used to assert the opposite: that `createUser` read a `token`
      // field off the response and stored it. No such field has ever existed.
      // Sahayak's backend verifies Supabase tokens against the project's JWKS and
      // never mints its own, so the only thing that can produce a bearer is the
      // OTP exchange — and a registration response that appeared to carry one
      // would mean something was impersonating the auth server.
      setAuthToken('supabase-access-token');

      vi.mocked(fetch).mockResolvedValue(
        mockResponse(200, {
          data: {
            id: 'usr-new-002',
            name: 'Asha Sharma',
            phone: '+919876543210',
            // Deliberately present, and deliberately ignored.
            token: 'not-a-real-token',
            access_token: 'also-not-a-real-token',
          },
        })
      );

      await usersService.createUser({
        name: 'Asha Sharma',
        phone: '+919876543210',
        role: 'owner',
      });

      expect(getAuthToken()).toBe('supabase-access-token');
    });
  });

  describe('Cancel Job Contract', () => {
    it('submits cancellation request to /jobs/:id/cancel', async () => {
      vi.mocked(fetch).mockResolvedValue(
        mockResponse(200, {
          data: {
            id: 'job-cancel-1',
            status: 'cancelled',
            cancellation_reason: 'Wait time too long',
          },
        })
      );

      const result = await jobsService.cancelJob('job-cancel-1', 'Wait time too long');
      expect(result.status).toBe('cancelled');

      const [url, options] = vi.mocked(fetch).mock.calls[0];
      expect(url).toContain('/jobs/job-cancel-1/cancel');
      expect(options?.method).toBe('POST');

      const body = JSON.parse(options?.body as string);
      expect(body.cancellation_reason).toBe('Wait time too long');
    });
  });

  describe('Job Details Contract (GET /api/v1/jobs/:id with current_assignment and timeline)', () => {
    it('receives current_assignment and timeline correctly', async () => {
      vi.mocked(fetch).mockResolvedValue(
        mockResponse(200, {
          data: {
            id: 'job-detail-1',
            vehicle_id: 'veh-1',
            vehicle_number: 'KA-01-MJ-4521',
            status: 'partner_en_route',
            pickup_lat: 12.9716,
            pickup_lng: 77.5946,
            requested_at: '2026-09-23T10:00:00Z',
            current_assignment: {
              id: 'asgn-1',
              job_id: 'job-detail-1',
              partner_id: 'ptr-1',
              status: 'accepted',
              offered_at: '2026-09-23T10:01:00Z',
              accepted_at: '2026-09-23T10:01:25Z',
              estimated_arrival_min: 12,
              distance_at_offer_m: 2300,
            },
            timeline: [
              { status: 'requested', timestamp: '2026-09-23T10:00:00Z' },
              { status: 'matching', timestamp: '2026-09-23T10:00:30Z' },
              { status: 'assigned', timestamp: '2026-09-23T10:01:25Z' },
              { status: 'partner_en_route', timestamp: '2026-09-23T10:02:00Z' },
            ],
          },
        })
      );

      const job = await jobsService.getJob('job-detail-1');
      expect(job.current_assignment?.status).toBe('accepted');
      expect(job.current_assignment?.estimated_arrival_min).toBe(12);
      expect(Array.isArray(job.timeline)).toBe(true);
      expect((job.timeline as unknown[]).length).toBe(4);
      // Normalized pickup_location from pickup_lat/lng
      expect(job.pickup_location?.lat).toBe(12.9716);
      expect(job.pickup_location?.lng).toBe(77.5946);
    });
  });

  describe('Vehicle APIs Contract', () => {
    it('creates, lists, updates, and deletes vehicles', async () => {
      // 1. Create
      vi.mocked(fetch).mockResolvedValueOnce(
        mockResponse(200, {
          data: {
            id: 'veh-new-1',
            vehicle_type: 'four_wheeler',
            make: 'Maruti Suzuki',
            model: 'Swift',
            vehicle_number: 'KA-05-NB-9988',
          },
        })
      );

      const created = await vehiclesService.createVehicle({
        vehicle_type: 'four_wheeler',
        make: 'Maruti Suzuki',
        model: 'Swift',
        vehicle_number: 'KA-05-NB-9988',
      });
      expect(created.id).toBe('veh-new-1');

      // 2. List
      vi.mocked(fetch).mockResolvedValueOnce(
        mockResponse(200, {
          data: [created],
        })
      );
      const list = await vehiclesService.listVehicles();
      expect(list).toHaveLength(1);
      expect(list[0].make).toBe('Maruti Suzuki');

      // 3. Read one back
      vi.mocked(fetch).mockResolvedValueOnce(
        mockResponse(200, {
          data: created,
        })
      );
      const fetched = await vehiclesService.getVehicle('veh-new-1');
      expect(fetched.id).toBe('veh-new-1');

      // There is deliberately no update or delete step. This block used to assert
      // a PATCH and a DELETE on /vehicles/{id} — routes the backend has never
      // exposed — and passed anyway, because every assertion here is made against
      // a mocked `fetch`. A mocked transport cannot tell a real path from an
      // imagined one; see route-inventory.test.ts, which checks the paths this
      // app emits against the backend's own OpenAPI schema and is the test that
      // catches this class of drift.
    });
  });

  describe('Ratings Contract (GET & POST /api/v1/jobs/:id/ratings)', () => {
    it('calls GET /jobs/:id/ratings to fetch can_rate and existing reviews', async () => {
      vi.mocked(fetch).mockResolvedValue(
        mockResponse(200, {
          data: {
            job_id: 'job-rate-1',
            job_status: 'completed',
            ratings: [],
            can_rate: true,
          },
        })
      );

      const res = await jobsService.getJobRatings('job-rate-1');
      expect(res.can_rate).toBe(true);
      expect(fetch).toHaveBeenCalledTimes(1);
      const [url, options] = vi.mocked(fetch).mock.calls[0];
      expect(url).toContain('/jobs/job-rate-1/ratings');
      expect(options?.method).toBe('GET');
    });

    it('submits rating via POST /jobs/:id/ratings', async () => {
      vi.mocked(fetch).mockResolvedValue(
        mockResponse(201, {
          data: {
            id: 'rate-1',
            job_id: 'job-rate-1',
            rated_by: 'user',
            rating: 5,
            comment: 'Fast and helpful!',
            created_at: '2026-10-06T12:00:00Z',
          },
        })
      );

      await jobsService.submitRating('job-rate-1', 5, 'Fast and helpful!');
      expect(fetch).toHaveBeenCalledTimes(1);
      const [url, options] = vi.mocked(fetch).mock.calls[0];
      expect(url).toContain('/jobs/job-rate-1/ratings');
      expect(options?.method).toBe('POST');
      const body = JSON.parse(options?.body as string);
      expect(body.rating).toBe(5);
      expect(body.comment).toBe('Fast and helpful!');
    });

    it('treats 409 RATING_ALREADY_SUBMITTED as idempotent success', async () => {
      vi.mocked(fetch).mockResolvedValue(
        mockResponse(409, {
          error: {
            code: 'RATING_ALREADY_SUBMITTED',
            message: 'You have already rated this job.',
          },
        })
      );

      await expect(jobsService.submitRating('job-rate-1', 5)).resolves.toBeUndefined();
    });
  });

  describe('Service Catalogue', () => {
    it('returns seeded services matching database codes', async () => {
      const services = await jobsService.listServices();
      expect(services.length).toBe(6);
      const codes = services.map((s) => s.code);
      expect(codes).toContain('flatbed_towing');
      expect(codes).toContain('wheel_lift_towing');
      expect(codes).toContain('battery_jumpstart');
      expect(codes).toContain('flat_tyre');
      expect(codes).toContain('minor_repair');
      expect(codes).toContain('fuel_delivery');
    });
  });
});

