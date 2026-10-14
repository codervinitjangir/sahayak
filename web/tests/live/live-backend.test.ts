import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { usersService } from '../../src/services/users.service';
import { vehiclesService } from '../../src/services/vehicles.service';
import { jobsService } from '../../src/services/jobs.service';
import { partnerService } from '../../src/services/partner.service';
import { notificationsService } from '../../src/services/notifications.service';
import { ratingsService } from '../../src/services/ratings.service';
import { setAuthToken } from '../../src/services/authToken';
import { SERVICE_CATALOG } from '../../src/types/partner';
import {
  createRealSupabaseUser,
  deleteRealSupabaseUser,
  setPartnerVerifiedInDb,
  cleanupDbRecords,
  RealSupabaseIdentity,
} from './supabase-auth-helper';

// Polyfill localStorage in node environment
if (typeof globalThis.localStorage === 'undefined') {
  let store: Record<string, string> = {};
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => {
      store[k] = String(v);
    },
    removeItem: (k: string) => {
      delete store[k];
    },
    clear: () => {
      store = {};
    },
    length: 0,
    key: () => null,
  };
}

// Ensure the API client points to the local running backend
process.env.VITE_API_BASE_URL = 'http://127.0.0.1:8010/api/v1';

describe('Live Backend Verification Suite', () => {
  let ownerIdentity: RealSupabaseIdentity;
  let partnerIdentity: RealSupabaseIdentity;

  const testPhones: string[] = [];
  const ownerPhone = `+919000${Math.floor(100000 + Math.random() * 900000)}`;
  const partnerPhone = `+919100${Math.floor(100000 + Math.random() * 900000)}`;
  testPhones.push(ownerPhone, partnerPhone);

  let ownerUserId: string;
  let registeredVehicleId: string;
  let partnerId: string;
  let dispatchJobId: string;
  let cancelJobId: string;

  beforeAll(async () => {
    // Mint real Supabase identities with ES256 tokens carrying verified phone claims
    ownerIdentity = await createRealSupabaseUser('owner', ownerPhone);
    partnerIdentity = await createRealSupabaseUser('partner', partnerPhone);
  }, 45000);

  afterAll(async () => {
    // Clean up Supabase auth accounts
    if (ownerIdentity?.auth_user_id) {
      await deleteRealSupabaseUser(ownerIdentity.auth_user_id);
    }
    if (partnerIdentity?.auth_user_id) {
      await deleteRealSupabaseUser(partnerIdentity.auth_user_id);
    }
    // Clean up created Postgres records
    cleanupDbRecords(testPhones);
  });

  describe('3. Service Codes: GET /services Alignment', () => {
    it('fetches GET /services from running backend and asserts exact seeded codes', async () => {
      const catalog = await jobsService.getServiceCatalog();
      expect(catalog).toBeDefined();
      expect(Array.isArray(catalog.items)).toBe(true);
      expect(catalog.total).toBe(6);

      const backendCodes = catalog.items.map((s) => s.code).sort();
      const expectedCodes = [
        'battery_jumpstart',
        'flat_tyre',
        'flatbed_towing',
        'fuel_delivery',
        'minor_repair',
        'wheel_lift_towing',
      ].sort();

      expect(backendCodes).toEqual(expectedCodes);

      // Verify that no frontend code in SERVICE_CATALOG uses an unseeded code
      const frontendCatalogCodes = SERVICE_CATALOG.map((s) => s.code);
      for (const code of frontendCatalogCodes) {
        expect(expectedCodes).toContain(code);
      }
    });
  });

  describe('1. Owner Setup: Signup & Add Vehicle', () => {
    it('signs up vehicle owner via POST /users with real token', async () => {
      setAuthToken(ownerIdentity.access_token);

      const user = await usersService.createUser({
        name: 'Asha Sharma',
        phone: ownerPhone,
        email: ownerIdentity.email,
      });

      expect(user).toBeDefined();
      expect(typeof user.id).toBe('string');
      expect(user.id.length).toBeGreaterThan(10);
      expect(user.name).toBe('Asha Sharma');
      expect(user.phone).toBe(ownerPhone);
      expect(typeof user.phone_verified).toBe('boolean');
      expect(typeof user.created_at).toBe('string');

      ownerUserId = user.id;
      expect(ownerUserId).toBeDefined();
    });

    it('adds vehicle via POST /vehicles and lists via GET /vehicles', async () => {
      setAuthToken(ownerIdentity.access_token);

      const vehicle = await vehiclesService.createVehicle({
        vehicle_type: 'four_wheeler',
        make: 'Hyundai',
        model: 'i20',
        vehicle_number: 'KA 05 MN 9999',
      });

      expect(vehicle).toBeDefined();
      expect(typeof vehicle.id).toBe('string');
      expect(vehicle.vehicle_type).toBe('four_wheeler');
      expect(vehicle.make).toBe('Hyundai');
      expect(vehicle.model).toBe('i20');
      // Backend normalises vehicle number to remove spaces
      expect(vehicle.vehicle_number).toBe('KA05MN9999');

      registeredVehicleId = vehicle.id;

      const list = await vehiclesService.listVehicles();
      expect(Array.isArray(list)).toBe(true);
      expect(list.some((v) => v.id === vehicle.id)).toBe(true);
    });
  });

  describe('2. Partner Onboarding & Qualification Flow', () => {
    it('registers partner via POST /partners', async () => {
      // POST /partners is unauthenticated
      setAuthToken(null);

      const partner = await partnerService.registerPartner({
        name: 'Ramesh Mechanic',
        phone: partnerPhone,
        primary_category_code: 'mechanical',
      });

      expect(partner).toBeDefined();
      expect(typeof partner.id).toBe('string');
      expect(partner.name).toBe('Ramesh Mechanic');
      expect(partner.phone).toBe(partnerPhone);
      expect(partner.verification_status).toBe('pending');

      partnerId = partner.id;
    });

    it('links partner to Supabase auth via POST /partners/{id}/link-auth', async () => {
      setAuthToken(partnerIdentity.access_token);

      const linkRes = await partnerService.linkAuth(partnerId);
      expect(linkRes).toBeDefined();
      expect(linkRes.id).toBe(partnerId);
      expect(linkRes.auth_user_id).toBe(partnerIdentity.auth_user_id);
      expect(linkRes.verification_status).toBe('pending');
    });

    it('makes partner eligible using documented SQL and links services', async () => {
      // Step: Set verification_status = 'verified' via SQL
      setPartnerVerifiedInDb(partnerId);

      setAuthToken(partnerIdentity.access_token);

      const servicesRes = await partnerService.updateServices(partnerId, [
        'battery_jumpstart',
        'flat_tyre',
      ]);
      expect(servicesRes).toBeDefined();
      expect(servicesRes.partner_id).toBe(partnerId);
      expect(servicesRes.services.length).toBe(2);
      expect(servicesRes.services.map((s) => s.code)).toContain('battery_jumpstart');
    });

    it('toggles availability via PATCH /partners/{id}/availability and reports location via POST /partners/{id}/location', async () => {
      setAuthToken(partnerIdentity.access_token);

      const availRes = await partnerService.setAvailability(true, partnerId);
      expect(availRes).toBeDefined();
      expect(availRes.id).toBe(partnerId);
      expect(availRes.is_available).toBe(true);

      const locRes = await partnerService.reportLocation(12.972, 77.595, partnerId);
      expect(locRes).toBeDefined();
      expect(locRes.partner_id).toBe(partnerId);
      expect(typeof locRes.recorded_at).toBe('string');
    });
  });

  describe('3. End-to-End Dispatch Lifecycle: Request -> Offer -> Accept -> In Progress -> Complete -> Stats', () => {
    it('creates job as owner and dispatches to nearby verified partner', async () => {
      setAuthToken(ownerIdentity.access_token);

      const job = await jobsService.createJob({
        vehicle_id: registeredVehicleId,
        service_code: 'battery_jumpstart',
        pickup_lat: 12.972,
        pickup_lng: 77.595,
        pickup_address_text: 'Brigade Rd, Bengaluru',
        issue_description: 'Dead battery dispatch test',
      });

      expect(job).toBeDefined();
      expect(typeof job.id).toBe('string');
      dispatchJobId = job.id;
      // Job starts in matching when dispatch engine immediately finds candidates, or requested
      expect(['requested', 'matching']).toContain(job.status);
    });

    it('partner polls pending offers and accepts the job offer', async () => {
      setAuthToken(partnerIdentity.access_token);

      const offer = await partnerService.getPendingOffer();
      expect(offer).not.toBeNull();
      expect(offer?.jobId).toBe(dispatchJobId);

      const acceptRes = await partnerService.acceptOffer(offer!.id);
      expect(acceptRes).toBeDefined();
      expect(acceptRes.assignment_status).toBe('accepted');
      expect(acceptRes.job_status).toBe('assigned');
    });

    it('partner inspects active job and advances status to completed', async () => {
      setAuthToken(partnerIdentity.access_token);

      const activeJob = await partnerService.getActiveJob();
      expect(activeJob).not.toBeNull();
      expect(activeJob?.id).toBe(dispatchJobId);
      expect(activeJob?.status).toBe('assigned');

      // Allowed transitions per ADR-013: assigned -> partner_en_route -> in_progress -> completed
      const enRouteRes = await partnerService.updateJobStatus(dispatchJobId, 'partner_en_route');
      expect(enRouteRes.status).toBe('partner_en_route');

      const inProgressRes = await partnerService.updateJobStatus(dispatchJobId, 'in_progress');
      expect(inProgressRes.status).toBe('in_progress');

      const completedRes = await partnerService.updateJobStatus(dispatchJobId, 'completed', {
        price_final: 500,
      });
      expect(completedRes.status).toBe('completed');
      expect(completedRes.price_final).toBe('500.00');
    });

    it('partner fetches live trust stats from GET /partners/me/stats', async () => {
      setAuthToken(partnerIdentity.access_token);

      const stats = await partnerService.getTrustStats();
      expect(stats).toBeDefined();
      expect(typeof stats.acceptanceRatePct).toBe('number');
      expect(typeof stats.ratingAvg).toBe('number');
      expect(typeof stats.ratingCount).toBe('number');
      expect(stats.lifetimeJobs).toBeGreaterThanOrEqual(1);
    });
  });

  describe('4. Owner Cancellation Flow: Request -> Get -> Cancel', () => {
    it('creates a second job and owner cancels it via POST /jobs/{id}/cancel', async () => {
      setAuthToken(ownerIdentity.access_token);

      const job2 = await jobsService.createJob({
        vehicle_id: registeredVehicleId,
        service_code: 'flat_tyre',
        pickup_lat: 12.9716,
        pickup_lng: 77.5946,
        pickup_address_text: 'MG Road, Bengaluru',
        issue_description: 'Punctured rear tire',
      });
      expect(job2).toBeDefined();
      cancelJobId = job2.id;

      const retrieved = await jobsService.getJob(cancelJobId);
      expect(retrieved.id).toBe(cancelJobId);

      const cancelRes = await jobsService.cancelJob(cancelJobId, 'Owner resolved situation');
      expect(cancelRes).toBeDefined();
      expect(cancelRes.id).toBe(cancelJobId);
      expect(cancelRes.status).toBe('cancelled');
      expect(typeof cancelRes.cancelled_at).toBe('string');

      const cancelledJob = await jobsService.getJob(cancelJobId);
      expect(cancelledJob.status).toBe('cancelled');
    });
  });

  describe('5. Notifications Feed: list, unread-count, mark-read, read-all', () => {
    it('retrieves notifications list and unread count for owner', async () => {
      setAuthToken(ownerIdentity.access_token);

      const unreadCount = await notificationsService.getUnreadCount();
      expect(typeof unreadCount).toBe('number');

      const feed = await notificationsService.listNotifications({ limit: 10 });
      expect(feed).toBeDefined();
      expect(Array.isArray(feed.items)).toBe(true);
      expect(typeof feed.total).toBe('number');
      expect(typeof feed.unread_count).toBe('number');

      // Test marking individual item read
      if (feed.items.length > 0) {
        const item = feed.items[0];
        const markRes = await notificationsService.markAsRead(item.id);
        expect(markRes).toBeDefined();
        expect(typeof markRes.updated).toBe('number');
        expect(typeof markRes.unread_count).toBe('number');
      }

      // Mark all read
      const markAllRes = await notificationsService.markAllAsRead();
      expect(markAllRes).toBeDefined();
      expect(markAllRes.unread_count).toBe(0);
    });
  });

  describe('6. Ratings: getJobRatings and submitRating', () => {
    it('rates completed job as owner and verifies rating', async () => {
      setAuthToken(ownerIdentity.access_token);

      const beforeRatings = await ratingsService.getJobRatings(dispatchJobId);
      expect(beforeRatings).toBeDefined();
      expect(beforeRatings.job_id).toBe(dispatchJobId);
      expect(beforeRatings.job_status).toBe('completed');
      expect(beforeRatings.can_rate).toBe(true);

      const submitRes = await ratingsService.submitRating(
        dispatchJobId,
        5,
        'Excellent fast service!'
      );
      expect(submitRes).not.toBeNull();
      expect(submitRes?.rating).toBe(5);
      expect(submitRes?.rated_by).toBe('user');

      const afterRatings = await ratingsService.getJobRatings(dispatchJobId);
      expect(afterRatings.can_rate).toBe(false);
      expect(afterRatings.ratings.length).toBeGreaterThanOrEqual(1);
      expect(afterRatings.ratings.some((r) => r.rating === 5)).toBe(true);
    });
  });
});
