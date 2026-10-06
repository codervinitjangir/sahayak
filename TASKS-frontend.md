# Sahayak — Frontend Task Backlog

**Last updated:** 2026-10-06
**See also:** `TASKS.md` (backend), `docs/FRONTEND-GUIDE.md` (screen/endpoint guide),
`HANDOFF-frontend-contract.md` (API contract log).

---

## Done

### [x] Repoint partner.service.ts at real backend endpoints — 2026-10-06

Fixed the 7 broken calls in `web/src/services/partner.service.ts`. Status per call:

| Function | Old path | Real path | Status |
|---|---|---|---|
| `getPendingOffer()` | `GET /partners/me/offers/current` | `GET /partners/me/offers` (list, take first) | ✅ **Fixed and verified** |
| `acceptOffer(id)` | `POST /partners/me/offers/{id}/accept` | `POST /job-assignments/{id}/respond` `{action:"accept"}` | ✅ **Fixed and verified** |
| `rejectOffer(id, reason)` | `POST /partners/me/offers/{id}/reject` | `POST /job-assignments/{id}/respond` `{action:"reject"}` | ✅ **Fixed and verified** |
| `setAvailability(bool)` | `POST /partners/me/availability` (wrong method, wrong path) | `PATCH /partners/{partner_id}/availability` | ✅ **Fixed and verified** |
| `getActiveJob()` | `GET /partners/me/jobs/active` | `GET /partners/me/jobs/active` | ✅ **Fixed and verified (Backend shipped 2026-10-06)** |
| `getEarnings(window)` | `GET /partners/me/earnings` | **No real endpoint** | ⚠️ **Mock-only, gap flagged** |
| `getTrustStats()` | `GET /partners/me/stats` | `GET /partners/me/stats` | ✅ **Fixed and verified (Backend shipped 2026-10-06)** |

**Key decisions made:**

- `getPendingOffer()` normalization: `assignment_id` from the wire is exposed as `PartnerOffer.id`
  in the local type. Call sites that pass `offer.id` to `acceptOffer()`/`rejectOffer()` will
  pass the correct `assignment_id` automatically. No call-site changes needed.
- `acceptOffer()` return type changed from `Promise<Job>` to `Promise<AssignmentRespondResponse>`
  because the real endpoint returns `{ assignment_status, job_status }`, not a full Job object.
  Call sites in `useOffers.ts` chain `acceptOffer` with `getJob(res.job_id)` to keep the active job cache populated.
- `getActiveJob()` backend endpoint shipped: `GET /api/v1/partners/me/jobs/active`. Reuses the active-job
  predicate (`status='accepted'` on `job_assignments` and status in `('assigned', 'partner_en_route', 'in_progress')`).
  Returns the full `JobDetailResponse` with assigned partner contact details, or `{"data": null}` (status 200)
  when idle. Cold refresh / page reload is now completely supported without local state.
- `getTrustStats()` backend endpoint shipped: `GET /api/v1/partners/me/stats`. Exposes `rating_avg`,
  `rating_count`, and `verification_status` from the `partners` row, alongside aggregated `acceptance_rate_pct`
  and `lifetime_jobs` computed from historical `job_assignments`. Frontend maps snake_case into `PartnerTrustStats`.
- `setAvailability()` reads `partner_id` from `getStoredPartnerProfile().id`, which is populated
  by partner registration and stored in localStorage. **This is not a gap** — the profile and its
  id are already persisted. Confirmed the default demo profile id is `ptr_ramesh_01`.
- `VITE_PARTNER_API_MOCK` default changed to `false` in `.env.example`. Earnings still
  uses mock regardless of this flag (explicitly documented in code and in env file).

**Tests added:**
- `web/tests/services/partner.service.test.ts` — 23 assertions covering exact
  method + path for every fixed call (including `GET /partners/me/jobs/active` and `GET /partners/me/stats`), rejection_reason body handling, partner_id sourcing, and
  negative assertions that unbuilt functions (`getEarnings`) never hit the network.
- `backend/tests/unit/test_partner_active_job.py` — 7 unit tests verifying cold refresh recovery,
  null on idle, exclusion of terminal/unaccepted jobs, PII visibility rules, SQL query compilation,
  and trust stats calculation and envelope.

---

## Open Gaps (backend decision needed)

### ⚠️ getEarnings(window) — no /partners/me/earnings endpoint

**Evidence:** Not in the backend route inventory (FRONTEND-GUIDE §1.4, §1.5).
`FRONTEND-GUIDE §5.4`: "partner earnings — no endpoint, no payments data".
The `payments` table exists in the schema but has zero routes.

**Current state:** Always mocked. Returns plausible fixture data from `partner.mock.ts`.

**Screens affected:** Earnings card in `ConsoleSettings`, stats block in `PartnerDashboard`.

**Backend action needed:** Decide whether to build a payments/earnings summary endpoint,
and if so, agree on what data it aggregates (completed job `price_final` values? a
separate `payments` table entry per payout?). This is explicitly a deferred feature
(TASKS.md backlog: "Payments — test-mode stub only, low priority").

**Do not add a fake real-path to this function.** The mock is the honest state here.

---

## Next Up (frontend tasks, all completed and verified)

- [x] **Wire acceptOffer() call sites to use getJob(jobId) after accept** — `useOffers.ts`
  now chains `partnerService.acceptOffer(offerId)` with `partnerService.getJob(res.job_id)`
  to populate the React Query cache with the full `Job` object, preserving UI behavior
  and passing all type checks.
- [x] **`/jobs/{id}/ratings` plural fix & `can_rate` query** — `jobs.service.ts` calls `POST /jobs/{job_id}/ratings`
  and `GET /jobs/{job_id}/ratings`. `JobTrackingPage.tsx` shows the 5-star rating form when `can_rate === true`
  and idempotently handles 409 `RATING_ALREADY_SUBMITTED` per ADR-018.
- [x] **Owner tracking screen hardening** — `JobTrackingPage.tsx` updated to extract partner details
  from `job.current_assignment` with fallback to `job.partner`, null-rating guards preventing `.toFixed(1)` errors,
  cancellation supported across all active non-terminal statuses with 409 `JOB_ALREADY_TERMINAL` recovery,
  and actionable retry/cancel buttons on `no_match_found`.
- [x] **Mobile API contract alignments** — `mobile/src/services/api/jobs.ts` aligned: `cancelJob` uses
  `POST /jobs/{id}/cancel`, replaced invalid job patches with `respondToAssignment` (`POST /job-assignments/{id}/respond`)
  and `updateJobStatus` (`POST /jobs/{id}/status`).
- [x] **Partner location reporting on shift toggle** (FRONTEND-GUIDE §4.1, §6 build order #2) —
  `POST /partners/{partner_id}/location` wired in `partner.service.ts`. `usePartnerAvailability.ts` reports
  GPS coordinates immediately when coming on-shift and beacons every 60s while online, ensuring mechanics
  are registered in Redis GEO for the dispatch engine.
- [x] **Notification badge + feed** (FRONTEND-GUIDE §2.7, §6 build order #4) — all four notification endpoints
  implemented in `notifications.service.ts` (`/notifications`, `/unread-count`, `/read`, `/read-all`).
  `PartnerTopBar.tsx` displays live unread count polling (30s cadence), reactive unread badge, and floating
  in-app notification popover with mark-read and mark-all-read actions.
- [x] **Partner signup against real routes** (FRONTEND-GUIDE §2.8, §6 build order #8) — `PartnerSignup.tsx`
  connected to real `POST /partners` and `POST /partners/{id}/services` when `!IS_PARTNER_API_MOCK`.
- [x] **Service catalogue & local request history** (FRONTEND-GUIDE §2.3, §5.1) — Hardcoded seeded services
  matching `db/seed.sql` exactly (`flatbed_towing`, `wheel_lift_towing`, etc.) preventing 404s, and cached
  recent requests in `localStorage` for `OwnerHome.tsx`.

