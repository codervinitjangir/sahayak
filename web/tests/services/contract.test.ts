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
    it('submits owner registration and stores returned token', async () => {
      vi.mocked(fetch).mockResolvedValue(
        mockResponse(200, {
          data: {
            id: 'usr-new-001',
            name: 'Asha Sharma',
            phone: '+919876543210',
            role: 'owner',
            token: 'jwt-auth-token-from-signup',
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

      const parsedBody = JSON.parse(options?.body as string);
      expect(parsedBody.name).toBe('Asha Sharma');
      expect(parsedBody.phone).toBe('+919876543210');
      expect(parsedBody.role).toBe('owner');

      // Check that token was stored in auth storage
      expect(getAuthToken()).toBe('jwt-auth-token-from-signup');
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
      expect(body.reason).toBe('Wait time too long');
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

      // 3. Update
      vi.mocked(fetch).mockResolvedValueOnce(
        mockResponse(200, {
          data: { ...created, model: 'Swift Dzire' },
        })
      );
      const updated = await vehiclesService.updateVehicle('veh-new-1', { model: 'Swift Dzire' });
      expect(updated.model).toBe('Swift Dzire');

      // 4. Delete
      vi.mocked(fetch).mockResolvedValueOnce(
        mockResponse(200, { data: null })
      );
      await expect(vehiclesService.deleteVehicle('veh-new-1')).resolves.toBeUndefined();
    });
  });
});
