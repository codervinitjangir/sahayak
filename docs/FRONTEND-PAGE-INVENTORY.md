# Sahayak Frontend Page Inventory & Backend Contract Audit

**Phase 1 Deliverable — Audit Before UI Construction**  
**Date:** 2026-10-14  
**Scope:** Complete page inventory across `web/` (primary target) and `mobile/`, verification against backend route definitions (`backend/app/api/`) and schemas (`backend/app/schemas/`), exhaustive demo-data inventory by file and line, and backend gap analysis.

---

## 1. Page Inventory Table

Every page must handle **Loading**, **Empty**, and **Error** states without faked or mocked data.

| Surface & Page Name | Route / Screen | Role | Backend Endpoint(s) Needed | Endpoint Exists? (Verified in Code) | Current State | Notes & Action Required |
|---|---|---|---|---|---|---|
| **PUBLIC** | | | | | | |
| Landing / Home | `/` (`LandingPage.tsx`) | Public / Anonymous | `GET /api/v1/services` (service catalogue) | ✅ Yes (`backend/app/api/services.py:46`) | ⚠️ Partial / Demo Data | Visual source of truth. Contains fabricated stats (ride counts, active partner %, response time graphs, fake earnings), fabricated reviews, fake tiers ("Family", "Fleet"), and Zomato boilerplate. Needs clean service catalogue fetch and clear entry points for Owner and Partner. |
| Login | `/login` (`LoginPage.tsx`) | Public / Unauth | Supabase Phone OTP (`signInWithOtp`, `verifyOtp`), `GET /api/v1/auth/me` | ✅ Yes (`backend/app/api/auth.py:46`) | ✅ Real Data | Real Supabase Auth + identity routing (`user` → `/owner`, `partner` → `/partner/dashboard`, `admin` → `/admin/overview`). Remove pre-filled test numbers on clean builds. Handle `403 USER_NOT_REGISTERED` and `403 IDENTITY_NOT_LINKED`. |
| **OWNER** | | | | | | |
| Owner Signup / Profile Completion | `/owner/signup` (`OwnerSignup.tsx`) | Owner (`user`) | `POST /api/v1/users` | ✅ Yes (`backend/app/api/users.py:65`) | ✅ Real Data | Entered when `GET /auth/me` returns `403 USER_NOT_REGISTERED` after OTP. Sends `{ name, phone, email }`. Remove any `role` in payload (identity comes strictly from token). |
| Owner Home / Dashboard | `/owner` (`OwnerHome.tsx`) | Owner (`user`) | `GET /api/v1/vehicles`, `GET /api/v1/jobs` | ✅ Yes (`vehicles.py:42`, `jobs.py:53`) | ⚠️ Partial | Displays saved vehicles and recent requests. Currently reads recent jobs from `localStorage` (`RECENT_JOBS_STORAGE_KEY`); must read real `GET /api/v1/jobs` history instead. |
| Vehicles List & Add Vehicle | Modal in `/owner` & `/owner/request` (`VehicleSelector.tsx`, `AddVehicleModal.tsx`) | Owner (`user`) | `GET /api/v1/vehicles`, `POST /api/v1/vehicles`, `GET /api/v1/vehicles/{id}` | ✅ Yes (`vehicles.py:42, 60, 81`) | ⚠️ Partial | Add vehicle modal exists. Empty vehicle list `[]` is a normal state, not 404. Delete/Update endpoints do NOT exist on backend. Remove `DEMO_VEHICLES` fallback. |
| Request Roadside Help | `/owner/request` (`RequestHelpPage.tsx`) | Owner (`user`) | `GET /api/v1/services`, `GET /api/v1/vehicles`, `POST /api/v1/jobs` | ✅ Yes (`services.py:46`, `vehicles.py:42`, `jobs.py:84`) | ⚠️ Partial / Demo Data | Emergency-first flow: selects service code, vehicle, pickup location (lat/lng/address text). Sends flat `pickup_lat`, `pickup_lng`, `pickup_address_text`, `service_code`. Must remove `DEMO_VEHICLES` and `IS_DEMO_MODE` fallback. |
| Job Tracking | `/owner/jobs/:jobId` (`JobTrackingPage.tsx`) | Owner (`user`) | `GET /api/v1/jobs/{id}`, `POST /api/v1/jobs/{id}/cancel` | ✅ Yes (`jobs.py:133, 219`) | ⚠️ Partial | Polls `GET /jobs/{id}` every ~4–7s while active; stops on terminal states. Displays status pill, timeline, and `current_assignment` (partner details shown only when assigned/released by ADR-017). Fix bug: cancellation currently sends `{ reason }` instead of `{ cancellation_reason }` (`extra="forbid"` on backend causes 422). |
| Rating Submission | In `/owner/jobs/:jobId` (`JobTrackingPage.tsx`) | Owner (`user`) | `GET /api/v1/jobs/{id}/ratings`, `POST /api/v1/jobs/{id}/ratings` | ✅ Yes (`ratings.py:54, 88`) | ✅ Real Data | Uses plural `/ratings`. Evaluates `can_rate` boolean from GET before displaying form. Handles duplicate submission 409 `RATING_ALREADY_SUBMITTED` idempotently. |
| Job History | Embedded in `/owner` (planned standalone `/owner/history`) | Owner (`user`) | `GET /api/v1/jobs?limit=20&offset=0` | ✅ Yes (`jobs.py:53`) | ❌ Missing / Mocked in Storage | Paginated history list (`items`, `total`, `has_more`). Currently mocked via `localStorage` in `jobsService.listJobs()`; must repoint to `jobsService.listMyJobs()`. |
| Notifications Feed | Popover / Feed | Owner (`user`) | `GET /api/v1/notifications`, `GET /notifications/unread-count`, `POST /notifications/{id}/read`, `POST /notifications/read-all` | ✅ Yes (`notifications.py:38, 71, 91, 114`) | ❌ Missing for Owner | Notification service exists and is used in partner topbar; missing user-facing notification feed on Owner side. |
| Profile & Sign Out | Top header dropdown / nav | Owner (`user`) | `GET /api/v1/auth/me`, Supabase auth `signOut` | ✅ Yes (`auth.py:46`) | ⚠️ Partial | Reads role and user id from token. User profile update (`PATCH /users/{id}`) does not exist on backend. |
| **PARTNER** | | | | | | |
| Partner Signup / Registration | `/partner/signup` (`PartnerSignup.tsx`) | Partner (`partner`) | `POST /api/v1/partners`, `POST /partners/{id}/link-auth`, `POST /partners/{id}/services` | ✅ Yes (`partners.py:61, 98, 147`) | ⚠️ Partial / Mock Branch | Multi-step registration. In mock mode it fabricated `ptr_${Date.now()}` and bypassed the backend. Must delete the mock branch so all signups execute `POST /partners` + `link-auth` + `services`. |
| Partner Console & Dashboard | `/partner/dashboard` (`PartnerConsole.tsx`, `PartnerDashboard.tsx`) | Partner (`partner`) | `GET /partners/me/stats`, `GET /partners/me/offers`, `GET /partners/me/jobs/active` | ✅ Yes (`partners.py:270, 290, 311`) | ⚠️ Partial / Demo Controls | Live shift dashboard. Contains "Demo: queue a test offer" and countdown timer on offer overlay. Must remove demo simulator and countdown timer. |
| Service Preferences | `/partner/preferences` (`Preferences.tsx`) | Partner (`partner`) | `GET /api/v1/services`, `POST /partners/{id}/services` | ✅ Yes (`services.py:46`, `partners.py:147`) | ⚠️ Mock Only (Local Storage) | Currently only saves selected services to `localStorage` (`saveStoredPartnerProfile`); does not call `POST /api/v1/partners/{id}/services`. |
| Availability Toggle & Location Beacon | In `PartnerDashboard.tsx`, `usePartnerAvailability.ts` | Partner (`partner`) | `PATCH /partners/{id}/availability`, `POST /partners/{id}/location` | ✅ Yes (`partners.py:176, 217`) | ✅ Real Data | On-shift toggle calls `PATCH /availability`; beacons GPS coordinates to Redis GEO via `POST /location` every 60s while on-shift. Remove mock fallback when partner ID is missing. |
| Offers Screen | `/partner/offers` (`OffersPage.tsx`, overlay in `PartnerDashboard.tsx`) | Partner (`partner`) | `GET /api/v1/partners/me/offers`, `POST /job-assignments/{id}/respond` | ✅ Yes (`partners.py:290`, `job_assignments.py:46`) | ⚠️ Partial / Timer Violation | Polls offers every 5s while visible. Responds with `{ action: "accept" | "reject", rejection_reason?: string }`. Handles 409 `ASSIGNMENT_ALREADY_ANSWERED` and `PARTNER_AT_CAPACITY`. Must remove client countdown timer (`OfferTimer.tsx`). |
| Active Job | `/partner/jobs/:jobId` (`ActiveJobPage.tsx`) | Partner (`partner`) | `GET /partners/me/jobs/active`, `POST /jobs/{id}/status`, `GET /jobs/{id}` | ✅ Yes (`partners.py:311`, `jobs.py:183, 133`) | ✅ Real Data | Lifecycle progression: `assigned` → `partner_en_route` → `in_progress` → `completed` (requires `price_final`). Handles 409 `INVALID_STATUS_TRANSITION`. Support cold refresh via `GET /partners/me/jobs/active`. |
| Partner Performance Stats | In `PartnerDashboard.tsx` | Partner (`partner`) | `GET /api/v1/partners/me/stats` | ✅ Yes (`partners.py:270`) | ✅ Real Data | Real statistics (`rating_avg`, `rating_count`, `acceptance_rate_pct`, `lifetime_jobs`). |
| Earnings | In `ConsoleSettings.tsx`, `PartnerDashboard.tsx` | Partner (`partner`) | `GET /partners/me/earnings` | ❌ No Endpoint Exists (Backend Gap) | ⚠️ Faked in Mock | `partner.mock.ts` returns fabricated earnings. Must replace with an honest "Earnings summary not available yet" state. |
| Documents / Equipment & Verification | `/partner/verification` (`VerificationStatus.tsx`) | Partner (`partner`) | Document/Equipment upload endpoints | ❌ No Upload Endpoint Exists (Backend Gap) | ⚠️ Mock Simulation | Only `verification_status` on `PartnerOut` / `GET /partners/me/stats` exists. Document upload and RC checks are mock simulations with demo toggles. Must remove demo simulation and honestly render backend verification status. |
| Partner Settings | `/partner/settings` (`ConsoleSettings.tsx`) | Partner (`partner`) | Read profile, logout | Partial | ⚠️ Demo Controls | Contains "Demo Tools" section ("Simulate incoming dispatch", "Reset demo data"). Must remove demo tools. |
| Notifications Feed | Header popover (`PartnerTopBar.tsx`) | Partner (`partner`) | `GET /notifications`, `/unread-count`, `POST /notifications/{id}/read`, `/read-all` | ✅ Yes (`notifications.py:38, 71, 91, 114`) | ✅ Real Data | Unread count polling, list feed, mark-read actions all functional. |
| Ratings Received | Partner view | Partner (`partner`) | `GET /partners/me/ratings` | ❌ No Endpoint Exists (Backend Gap) | ❌ Missing | Aggregated ratings appear in `stats`, but list of customer feedback comments has no endpoint. |
| **ADMIN** | | | | | | |
| Admin Console: Overview | `/admin/overview` (`AdminConsole.tsx`, `OverviewPanel.tsx`) | Admin (`admin`) | `GET /api/v1/admin/analytics/overview` | ✅ Yes (`admin.py:73`) | ✅ Real Data | 12 tests passing. Requires `admin` JWT role. Metrics: completion rate, funnel, active partner supply, time-to-work-started. |
| Admin Console: Dispatch | `/admin/dispatch` (`AdminConsole.tsx`, `DispatchPanel.tsx`) | Admin (`admin`) | `GET /api/v1/admin/analytics/dispatch` | ✅ Yes (`admin.py:117`) | ✅ Real Data | Offer outcomes, acceptance rates, no-match breakdown, dispatch latency percentiles. Verbatim `notes[]` rendering. |
| Admin Console: Matching | `/admin/matching` (`AdminConsole.tsx`, `MatchingPanel.tsx`) | Admin (`admin`) | `GET /api/v1/admin/analytics/matching` | ✅ Yes (`admin.py:173`) | ✅ Real Data | Weighted dispatch vs nearest-partner baseline comparison, divergence rate, score component deltas, driver attribution. |
| **MOBILE (FOR SUBSEQUENT PHASE)** | | | | | | |
| Mobile Auth / Login | `LoginScreen.tsx` | Public / Unauth | Supabase OTP, `GET /auth/me` | ✅ Yes | ✅ Real Data (shipped 2026-10-07) | Vitest passing for auth routing logic. |
| Mobile Owner Flow | `OwnerHelpFlowScreen.tsx`, `HomeScreen.tsx` | Owner (`user`) | `GET /services`, `GET /vehicles`, `POST /jobs`, `GET /jobs/{id}` | ✅ Yes | ⚠️ Heavily Mocked | Consumes `MOCK_VEHICLES`, `MOCK_SUB_SERVICES`, `MOCK_USER_OWNER` from `mobile/src/services/api.ts`. |
| Mobile Partner Flow | `PartnerHomeScreen.tsx`, `IncomingOfferScreen.tsx`, `ActiveJobScreen.tsx` | Partner (`partner`) | `GET /partners/me/offers`, `POST /job-assignments/{id}/respond`, `GET /partners/me/jobs/active`, `POST /jobs/{id}/status` | ✅ Yes | ⚠️ Heavily Mocked | Consumes `MOCK_PARTNER`, `MOCK_JOBS`, `MOCK_INCOMING_OFFER` from `mobile/src/services/api.ts`. |

---

## 2. Exhaustive Demo-Data & Mock Inventory (By File and Line)

The following items violate Non-Negotiable Rule A ("ALL data comes from the backend API. No demo data anywhere in app code") and must be systematically removed in Phase 2:

### `web/src/services/`
1. **`web/src/services/partner.mock.ts`**:
   - **Lines 1–254 (Entire File)**: Mock dispatch simulator, stateful mock offer store (`state.pendingOffer`), mock active job (`state.activeJob`), fabricated partner profile (`ptr_ramesh_01`), mock vehicle (`veh_mock_1`), mock owner (`usr_mock_owner`), and mock earnings calculation (`getEarnings`). Must be completely removed from the production bundle.
2. **`web/src/services/partner.service.ts`**:
   - **Line 3**: `import * as mock from './partner.mock';`
   - **Lines 24–37, 50–54**: Documentation documenting mock behavior.
   - **Line 55**: `export const IS_PARTNER_API_MOCK = import.meta.env.VITE_PARTNER_API_MOCK === 'true';`
   - **Lines 58–72**: `MOCK_LATENCY_MS`, `settle()`, `settleWith()` mock latency wrappers.
   - **Line 124**: `if (IS_PARTNER_API_MOCK) return settleWith(() => mock.getPendingOffer());`
   - **Lines 173–182**: `if (IS_PARTNER_API_MOCK) { ... return mock.acceptOffer() ... }`
   - **Line 205**: `if (IS_PARTNER_API_MOCK) return settleWith(() => mock.rejectOffer(offerId));`
   - **Line 229**: `if (IS_PARTNER_API_MOCK) return settleWith(() => mock.getActiveJob());`
   - **Line 236**: `if (IS_PARTNER_API_MOCK) return settleWith(() => mock.getJob(jobId));`
   - **Line 246**: `if (IS_PARTNER_API_MOCK) return settleWith(() => mock.updateJobStatus(jobId, status));`
   - **Lines 260, 268, 278–280**: Mock fallback in `setAvailability()` and mention of `ptr_ramesh_01`.
   - **Lines 302–306, 314–319**: Mock fallback in `reportLocation()` returning `partner_id: 'mock'`.
   - **Lines 340–351**: `getEarnings()` unconditionally returning `settleWith(() => mock.getEarnings(window))`.
   - **Line 363**: `if (IS_PARTNER_API_MOCK) return settleWith(() => mock.getTrustStats());`
   - **Lines 386–392**: `simulateIncomingOffer()` calling `mock.issueOffer()`.
3. **`web/src/services/jobs.service.ts`**:
   - **Line 74, 104–110, 119–126**: `RECENT_JOBS_STORAGE_KEY` and `listJobs()` reading from `localStorage` instead of using real `GET /api/v1/jobs`.
   - **Line 146**: `cancelJob()` sends `{ reason }` instead of `{ cancellation_reason }`.

### `web/src/types/` & `web/src/app/`
4. **`web/src/types/partner.ts`**:
   - **Lines 210–232**: `DEFAULT_PARTNER_PROFILE` with hardcoded ID `id: 'ptr_ramesh_01'`, name `'Ramesh Kumar (Speedy Mechanics)'`, phone `'+91 98111 22334'`, and hardcoded verification checklist.
5. **`web/src/app/config.ts`**:
   - **Lines 4–17**: `IS_DEMO_MODE` flag and `readDemoModeFlag()`.
6. **`web/src/app/AuthProvider.tsx`**:
   - **Line 9**: `import { IS_DEMO_MODE } from './config';`
   - **Lines 42–56**: `DEMO_IDENTITIES` record defining hardcoded accounts:
     - `owner`: `id: 'usr_owner_01'` ('Asha Rao')
     - `partner`: `id: 'ptr_ramesh_01'` ('Ramesh Kumar')
     - `ops`: `id: 'usr_ops_01'` ('Ops Admin')
     - `super_admin`: `id: 'usr_admin_01'` ('Platform Superadmin')
   - **Line 96**: `IS_DEMO_MODE ? DEMO_IDENTITIES[readStoredRole()] : null`
   - **Lines 106–107**: `if (IS_DEMO_MODE) { setUser(DEMO_IDENTITIES[newRole]); }`

### `web/src/pages/owner/`
7. **`web/src/pages/owner/RequestHelpPage.tsx`**:
   - **Line 7**: `import { IS_DEMO_MODE } from '../../app/config';`
   - **Lines 30–42**: `DEMO_VEHICLE_ID_PREFIX = 'demo-'` and `DEMO_VEHICLES` constant with `id: 'demo-veh-1'`, `user_id: 'usr_demo_owner'`, `'KA-01-MJ-5021'`.
   - **Line 44**: `isRealVehicleId()` filter.
   - **Line 60**: `serverVehicles.length > 0 ? serverVehicles : IS_DEMO_MODE ? DEMO_VEHICLES : [];`
   - **Lines 177–179**: Comments referencing `IS_DEMO_MODE` / demo bearer tokens.

### `web/src/pages/partner/`
8. **`web/src/pages/partner/PartnerSignup.tsx`**:
   - **Line 43**: `import { IS_PARTNER_API_MOCK } from '../../services/partner.service';`
   - **Line 317**: `id: ptr_${Date.now()}` on mock profile fallback.
   - **Line 332**: `id: veh_${Date.now()}` on mock vehicle fallback.
   - **Line 349**: `if (!IS_PARTNER_API_MOCK)` wrapping real API submission.
9. **`web/src/pages/partner/PartnerDashboard.tsx`**:
   - **Line 32**: `import { IS_PARTNER_API_MOCK, partnerService } from '../../services/partner.service';`
   - **Lines 542–552**: Demo affordance button ("Demo: queue a test offer").
   - **Line 567**: `<OfferTimer offeredAt={offer.offeredAt} onExpire={handleOfferExpire} />` countdown timer (violates rule B).
   - **Line 1183**: `const simulate = IS_PARTNER_API_MOCK ? ...`
10. **`web/src/pages/partner/PartnerConsole.tsx`**:
    - **Line 10**: `import { IS_PARTNER_API_MOCK, partnerService } from '../../services/partner.service';`
    - **Line 51**: `const simulate = IS_PARTNER_API_MOCK ? ...`
11. **`web/src/pages/partner/ConsoleSettings.tsx`**:
    - **Line 31**: `import { IS_PARTNER_API_MOCK, partnerService } from '../../services/partner.service';`
    - **Lines 186–189**: `handleResetDemoData()` callback.
    - **Lines 356–389**: "Demo Tools" card with `Simulate incoming dispatch` and `Reset demo data` buttons.
12. **`web/src/pages/partner/VerificationStatus.tsx`**:
    - **Lines 191–230**: `handleSimulateStatus()` simulator function.
    - **Lines 554–571**: "Demo Simulation" button.
13. **`web/src/pages/partner/components/PartnerTopBar.tsx`**:
    - **Lines 227–246**: Role switcher select ("Owner (Asha)", "Partner (Ramesh)", "Admin (Ops)").
14. **`web/src/components/OfferTimer.tsx`**:
    - **Lines 1–95 (Entire Component)**: Client-side countdown timer for offers (offers do not expire server-side).

### `web/src/pages/landing/` (Fabricated Stats, Testimonials & Lore)
15. **`web/src/pages/landing/FeatureBlocks.tsx`**:
    - **Line 53**: Fabricated statistic: `"72% partners active now"`.
    - **Lines 80–97**: Fabricated response time decay graph (`"Indiranagar 85%"`, `"HSR 72%"`, etc.) and `"Avg. response under 15 min across all zones"`.
    - **Line 127**: Fabricated partner earnings card (`"12 jobs completed · ₹8,400 earned"`).
    - **Lines 139–147**: Fabricated supply claims (`"Indiranagar: 8 mechanics, 3 tow trucks"`, `"Koramangala: 6 mechanics..."`).
    - **Lines 179–198**: Fabricated partner/job statistics (`"14 verified partners · 238 jobs this month"`, `"194 jobs"`, `"87 jobs"`).
    - **Lines 202–206**: Fabricated cohort counts (`"Mechanics (32)"`, `"Tow Trucks (12)"`, etc.).
16. **`web/src/pages/landing/ReviewsSection.tsx`**:
    - **Lines 41–180**: `REVIEWS: Review[]` with fabricated testimonials, ratings, and customer stories (`"Thanae"`, `"Rajesh"`, `"Divya M. · ★4.9"`).
17. **`web/src/pages/landing/TestimonialRow.tsx`**:
    - **Lines 44–58**: Fabricated matched partner card (`"Rajesh M."`, `"★ 4.9"`, `"240+ jobs done"`, `"1.2 km away · Arriving in 6 min"`).
18. **`web/src/pages/landing/PricingSection.tsx`**:
    - **Lines 17–80**: Fabricated subscription pricing plans (`"Pay Per Use"`, `"Family"` @ ₹499/mo, `"Fleet"` @ ₹1999/mo). Sahayak has no subscription plans.
19. **`web/src/pages/landing/FinalCta.tsx`**:
    - **Line 12**: Copied Zomato boilerplate text: `"Experience seamless online ordering only on the Zomato app"`.
    - **Lines 22, 41**: Fake app download click alerts.
20. **`web/src/pages/landing/LandingNav.tsx`**:
    - Missing explicit, prominent partner onboarding / sign in links in header.

---

## 3. Backend Gaps (Verified Against Backend Routes & Schemas)

When an endpoint does not exist, the UI will **never fake it** or show invented numbers. The following gaps are confirmed in the backend:

1. **Partner Earnings (`GET /api/v1/partners/me/earnings`) — GAP**:
   - **Evidence**: `backend/app/api/` has zero routes for earnings. The `payments` table exists in SQL migrations, but no payment or payout APIs have been implemented (deferred in `TASKS.md`).
   - **UI Requirement**: Render an honest `"Earnings summary not available yet"` empty state on `ConsoleSettings` and `PartnerDashboard`. Do not render fake rupees.
2. **Partner Document & Equipment Upload (`POST /api/v1/partners/{id}/documents`) — GAP**:
   - **Evidence**: No document upload endpoints exist in `backend/app/api/partners.py`. The only exposed field is `verification_status` (`pending`, `verified`, `rejected`, `suspended`) on `PartnerOut` and `GET /api/v1/partners/me/stats`.
   - **UI Requirement**: Remove the interactive document upload simulation from `VerificationStatus.tsx`. Display the real `verification_status` from the backend, explain that document verification is handled by Sahayak operations staff, and provide an honest status badge.
3. **Partner Shift / Duty History — GAP**:
   - **Evidence**: No endpoint returns historical on-duty / off-duty logs or hours worked.
   - **UI Requirement**: Only the current duty toggle (`PATCH /partners/{id}/availability`) is rendered.
4. **Partner Received Reviews List (`GET /api/v1/partners/me/ratings`) — GAP**:
   - **Evidence**: `GET /api/v1/partners/me/stats` returns aggregated `rating_avg` and `rating_count`, but there is no endpoint to list individual reviews or comments left by owners.
   - **UI Requirement**: Render aggregated trust stars and job counts only; do not invent a list of customer reviews.
5. **Vehicle Modification & Deletion (`PATCH/DELETE /api/v1/vehicles/{id}`) — GAP**:
   - **Evidence**: `backend/app/api/vehicles.py` defines only `GET /vehicles`, `POST /vehicles`, and `GET /vehicles/{id}`.
   - **UI Requirement**: Vehicles can be listed and added, but cannot be edited or deleted from the frontend.
6. **Owner Profile Update (`PATCH /api/v1/users/{id}`) — GAP**:
   - **Evidence**: `backend/app/api/users.py` only exposes `POST /users` (registration) and `POST /users/{id}/link-auth`.
   - **UI Requirement**: Profile view displays account details from `GET /auth/me`; editing is disabled.
7. **Guaranteed Upfront Pricing / Estimates — GAP (Amended)**:
   - **Evidence**: `services` table in PostgreSQL has no price column; `jobs.price_estimate` is nullable and never computed or populated server-side.
   - **UI Requirement (Per User Amendment #1)**: Do NOT keep any local indicative price guidance. It is invented data and violates Rule A. Show only: `"Final price is confirmed when the job is completed."`
8. **Real-Time WebSockets — ARCHITECTURAL RULE**:
   - **Evidence**: No WebSocket routes exist in FastAPI.
   - **UI Requirement**: Polling on `GET /api/v1/jobs/{id}` and `GET /api/v1/partners/me/offers` on an ~5 second interval while screens are visible; polling must pause on tab hide (`document.hidden`) and stop when a job reaches a terminal state (`completed`, `cancelled`, `no_match_found`).
9. **Partner Verification Lifecycle & Dispatch Eligibility — GAP (Added per Amendment #3)**:
   - **Evidence**: In `backend/app/repositories/dispatch_repository.py:304`, the dispatch engine queries candidate partners filtering strictly for `Partner.verification_status == 'verified'`. However, `POST /api/v1/partners` initializes partners as `'pending'`, and zero backend endpoints exist to transition a partner to `'verified'`. Consequently, self-registered partners can never receive offers.
   - **Proposed Smallest Fixes**:
     - *Option A (Minimal Admin Endpoint & UI - Recommended for production)*: A minimal endpoint `PATCH /api/v1/admin/partners/{id}/verify` accepting `{ "verification_status": "verified" | "rejected" }` protected by `require_admin`, paired with a pending-partners approval list in `AdminConsole`. (Kept as a separate backend task; not built until approved).
     - *Option B (Documented Ops Script)*: A standalone ops utility script `backend/tools/verify_partner.py <partner_id_or_phone>` to verify partners without modifying the API.
   - **How to make a partner dispatch-eligible for testing/demo**:
     Run SQL directly against the database:
     ```sql
     UPDATE partners SET verification_status = 'verified' WHERE phone = '+919811122334';
     -- If towing service, also verify equipment:
     UPDATE partner_equipment SET verification_status = 'verified' WHERE partner_id = (SELECT id FROM partners WHERE phone = '+919811122334');
     ```

### Admin Account Creation & Supabase Linking (Per ADR-020)
1. User logs in with phone OTP at `/login`. Supabase Auth generates a user session and a UUID (`sub`).
2. Identify the Supabase user UUID (`sub`) from the Supabase dashboard or auth token.
3. Link the admin profile directly in PostgreSQL (no link-auth endpoint exists for admins by design):
   ```sql
   UPDATE admins SET auth_user_id = '<supabase-sub-uuid>' WHERE email = 'ops@sahayak.in';
   ```
4. Upon subsequent calls to `GET /api/v1/auth/me`, `resolve_identity` matches the `auth_user_id` against `admins`, returns `{ role: "admin", id: "<admin_uuid>" }`, and `/login` automatically routes to `/admin/overview`.


---

## 4. Contract Discrepancies & API Mismatches Flagged in Code

1. **Owner Cancel Request Body Trap**:
   - In `web/src/services/jobs.service.ts:146`: `cancelJob()` sends `{ reason }`.
   - In `backend/app/schemas/job.py:285–287`: `JobCancelRequest` expects `cancellation_reason: Optional[str]` with `model_config = ConfigDict(extra="forbid")`.
   - **Consequence**: Every cancellation attempted with `{ reason }` receives a 422 Unprocessable Entity error from FastAPI.
   - **Fix Required in Phase 2**: Update `jobsService.cancelJob` to send `{ cancellation_reason: reason }` (or empty object if omitted).
2. **Job History API Availability**:
   - `web/src/services/jobs.service.ts:119` implements `listJobs()` by parsing `localStorage.getItem('sahayak_recent_jobs')`.
   - In `backend/app/api/jobs.py:53`, `GET /api/v1/jobs` is fully functional and already wrapped in `jobsService.listMyJobs()`.
   - **Fix Required in Phase 2**: Switch `OwnerHome.tsx` and `useJobs` hook from the `localStorage` fallback to `jobsService.listMyJobs()`.
3. **`updateJobStatus` and `cancelJob` Return Types**:
   - In `jobs.service.ts`, both methods are typed as returning `Promise<Job>`.
   - On the backend, `POST /jobs/{id}/status` returns `JobStatusTransitionResponse` (`id`, `status`, `assignment_status`, `price_final`, etc.) and `POST /jobs/{id}/cancel` returns `JobCancelResponse`.
   - **Fix Required in Phase 2**: Align TypeScript return signatures with the true wire schemas; refetch the canonical job with `getJob(jobId)` when a full `Job` object is required by UI state.

---

## 5. Next Steps for Phase 2 Execution (Awaiting User Approval)

Upon approval to proceed to Phase 2, implementation will proceed systematically in the following order:
1. **Design System & UI Component Library**:
   - Extract design tokens from the landing page (`#F6F1E6` canvas, `#1B1712` text, `#0F766E` brand teal, `#F03F3F` accent, `#B45309` warning, radii, shadows) into Tailwind / CSS variables.
   - Create unified, reusable components in `web/src/components/ui/`: `Button`, `Input`, `Card`, `Badge`, `Modal`, `Skeleton`, `EmptyState`, `ErrorState`, `StatusPill`, `Timeline`, `StarRating`, `Toast`.
2. **Auth, API Client Cleanup & Complete Demo-Data Removal**:
   - Delete `partner.mock.ts` and remove `IS_DEMO_MODE` and `IS_PARTNER_API_MOCK`.
   - Remove hardcoded `ptr_` / `usr_` identifiers.
   - Add automated check enforcing zero `mock`, `demo`, `fixture`, or hardcoded ID references in application code.
   - Fix `cancelJob` payload to send `cancellation_reason`.
3. **Owner Flow End-to-End**:
   - Refactor Landing Page: eliminate fabricated stats and fake reviews, add clear Owner and Partner entry points.
   - Complete `OwnerHome` with real `GET /api/v1/jobs` history.
   - Ensure `RequestHelpPage` uses real vehicles and services.
   - Harden `JobTrackingPage` with real polling, partner details gate, and cancellation.
4. **Partner Flow End-to-End**:
   - Connect `PartnerSignup` strictly to real endpoints (`/partners`, `/link-auth`, `/services`).
   - Remove `OfferTimer.tsx` countdown timer; wire `OffersPage` to real `GET /partners/me/offers` and response handling.
   - Connect `Preferences` to `POST /partners/{id}/services`.
   - Replace fake earnings with honest "not available yet" state.
   - Replace fake document simulation in `VerificationStatus` with honest verification status.
5. **Admin Flow**:
   - Audit and confirm all analytics panels remain clean against real endpoints.
6. **Verification & Testing**:
   - Clean `tsc --noEmit` and green Vitest test suite.
