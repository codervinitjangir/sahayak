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
| `getActiveJob()` | `GET /partners/me/jobs/active` | **No real endpoint — see gap below** | ⚠️ **Mock-only, gap flagged** |
| `getEarnings(window)` | `GET /partners/me/earnings` | **No real endpoint** | ⚠️ **Mock-only, gap flagged** |
| `getTrustStats()` | `GET /partners/me/stats` | **No real endpoint** | ⚠️ **Mock-only, gap flagged** |

**Key decisions made:**

- `getPendingOffer()` normalization: `assignment_id` from the wire is exposed as `PartnerOffer.id`
  in the local type. Call sites that pass `offer.id` to `acceptOffer()`/`rejectOffer()` will
  pass the correct `assignment_id` automatically. No call-site changes needed.
- `acceptOffer()` return type changed from `Promise<Job>` to `Promise<AssignmentRespondResponse>`
  because the real endpoint returns `{ assignment_status, job_status }`, not a full Job object.
  Call sites that previously used the returned `Job` directly need updating — see Active Job gap below.
- `setAvailability()` reads `partner_id` from `getStoredPartnerProfile().id`, which is populated
  by partner registration and stored in localStorage. **This is not a gap** — the profile and its
  id are already persisted. Confirmed the default demo profile id is `ptr_ramesh_01`.
- `VITE_PARTNER_API_MOCK` default changed to `false` in `.env.example`. Earnings and stats still
  use mock regardless of this flag (explicitly documented in code and in env file).

**Tests added:** `web/tests/services/partner.service.test.ts` — 14 assertions covering exact
method + path for every fixed call, rejection_reason body handling, partner_id sourcing, and
a negative assertion that mock-only functions never hit the network.

---

## Open Gaps (backend decision needed)

### ⚠️ getActiveJob() — no GET /partners/me/active-job endpoint

**Evidence:** `POST /job-assignments/{id}/respond` accept response returns only
`{ assignment_status, job_status }` (FRONTEND-GUIDE §4.3 "Accept succeeds" row).
There are exactly 20 routes in the backend route inventory (FRONTEND-GUIDE §1.4,
checked 2026-10-01). None of them is a "get this partner's current active job" endpoint.

**Current workaround:** `getActiveJob()` in `partner.service.ts` always uses the mock,
regardless of `IS_PARTNER_API_MOCK`. This works in demo mode. In a real build:

- The accept flow works (a partner can accept an offer).
- After accepting, the calling code has `job_id` from the offer object, so it can call
  `getJob(job_id)` immediately — this IS a real endpoint (`GET /jobs/{job_id}`).
- **What breaks on page refresh**: the active-job screen has no way to re-discover which
  job the partner is on, because there is no "show me my current accepted job" query.

**Two resolution options — backend team to decide:**

1. **Add `GET /api/v1/partners/me/active-job`** that returns the job the partner's current
   `accepted` assignment points at. Small endpoint, very similar to `GET /jobs/{id}`.
2. **Persist the active `job_id` client-side** after accept, and use `GET /jobs/{job_id}`
   on load. Requires no new endpoint, but loses on cold-start if client state is cleared.
   Also fragile: if the partner opens the app from a different device after accepting,
   there's no job to load.

Option 1 is recommended. The data is trivially available server-side.

**Screens affected:** `web/src/pages/partner/ActiveJobPage.tsx`,
`web/src/features/partners/useOffers.ts`.

---

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

### ⚠️ getTrustStats() — no /partners/me/stats endpoint

**Evidence:** Not in the backend route inventory (FRONTEND-GUIDE §1.4, §1.5).
`FRONTEND-GUIDE §5.4`: "partner trust/stats — no endpoint".

**Current state:** Always mocked. Returns seeded acceptance rate, rating avg, rating count,
lifetime jobs from `partner.mock.ts`.

**Partial data that IS available today:**
- `partner_rating` and `partner_rating_count` live on `partners` table, are written by the
  ratings endpoint (HANDOFF §12.6), and are readable via `GET /jobs/{job_id}`
  `current_assignment.partner_rating` / `.partner_rating_count` — but only the owner/assigned
  partner sees them, not the partner querying their own profile.
- There is no `GET /partners/me` endpoint to read one's own stats.

**Backend action needed:** Either a dedicated `GET /partners/me` or a
`GET /partners/me/stats` that exposes acceptance rate, rating avg+count, lifetime job count.
This is a natural next step once the pilot produces real data to aggregate.

**Screens affected:** Stats card in `ConsoleSettings`, metrics block in `PartnerDashboard`.

---

## Next Up (frontend tasks, not yet started)

- [x] **Wire acceptOffer() call sites to use getJob(jobId) after accept** — `useOffers.ts`
  now chains `partnerService.acceptOffer(offerId)` with `partnerService.getJob(res.job_id)`
  to populate the React Query cache with the full `Job` object, preserving UI behavior
  and passing all type checks.
- [ ] **Partner location reporting on shift toggle** (FRONTEND-GUIDE §4.1, §6 build order #2) —
  `POST /partners/{partner_id}/location` while on shift. A partner who never reports location
  is invisible to dispatch. Currently nothing calls this endpoint.
- [ ] **Notification badge + feed** (FRONTEND-GUIDE §2.7, §6 build order #4) — all four
  notification endpoints exist and are tested (TASKS.md 2026-10-01). The bell in
  `PartnerTopBar.tsx:67` has no onClick and the dot on line 73 is always rendered.
- [ ] **Owner tracking screen hardening** — `job.partner.*` → `current_assignment.*` renames,
  null guards, all 8 status states, timeline stepper (FRONTEND-GUIDE §2.4, §5.1).
- [ ] **`/jobs/{id}/ratings` plural fix** — `jobs.service.ts:78` POSTs to `/rating` (singular,
  404s). Change to `/ratings` (HANDOFF §12.1, FRONTEND-GUIDE §5.1).
- [ ] **Mobile's four broken job calls** (FRONTEND-GUIDE §5.1) — `GET /jobs/me`, wrong-method
  cancel, and the accept/complete calls that assume the partner acts on a job not an assignment.
- [ ] **Partner signup against real routes** (FRONTEND-GUIDE §2.8, §6 build order #8) —
  `POST /partners` and link-auth currently go through mock.
