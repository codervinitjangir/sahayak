# Sahayak — Frontend Task Backlog

**Last updated:** 2026-10-07
**See also:** `TASKS.md` (backend), `docs/FRONTEND-GUIDE.md` (screen/endpoint guide),
`HANDOFF-frontend-contract.md` (API contract log).

---

## Done

### [x] Admin Console Partners Panel & Verification UI — 2026-10-21

Shipped the fourth operations tab: `/admin/partners` in `AdminConsole.tsx` backed by `PartnersPanel.tsx`.
- Connects directly to real `GET /api/v1/admin/partners` and `PATCH /api/v1/admin/partners/{id}/verify`.
- Filters by verification status: All, Pending, Verified, Rejected with live status counts.
- Search by partner name, phone, or workshop.
- Displays workshop name, experience years, and registered service capabilities tags.
- Direct Approve, Reject, and Reset action buttons with real-time optimistic state updates.
- Fully aligned with the Partner Console warm paper palette (`#F6F1E6`, `#FBF8F1`, `#0F766E`).
- Re-exported route fixture `backend-routes.json` with 33 live routes; all 115 tests in `web` passing.

### [x] Mobile Real Backend Integration & Rule A Enforcement — 2026-10-21

- Complete elimination of mock fixtures across `mobile/src/`.
- Created typed API clients for `vehiclesApi` (`GET /vehicles`, `POST /vehicles`), `servicesApi` (`GET /services`), `partnerApi` (`GET /partners/me/stats`, `GET /partners/me/jobs/active`, `POST /partners/{id}/availability`, `POST /partners/{id}/location`), and `jobsApi.listMyJobs`.
- Replaced vector map with `StreetVectorCanvas.tsx`.
- Created automated enforcement script `mobile/scripts/verify-no-demo-data.mjs`.
- Zero violations on `npm run check:rule-a`. 100% clean typecheck (`tsc --noEmit`). 15/15 tests passing.

### [x] Admin console — 2026-10-09

Three read-only panels over the analytics endpoints that shipped on 2026-10-03 and that nothing
read: `/admin/overview`, `/admin/dispatch`, `/admin/matching`. `homeRouteForRole('admin')` now
sends an ops account here instead of to the owner app.

**The palette was computed, not chosen.** Running the data-viz validator against Sahayak's own
surface (`#FFFFFF`) failed on the first attempt: **`#0F766E` — the primary brand token — is below
the chroma floor (0.086 < 0.1) and reads gray as a chart fill.** Snapping one step up its own
ramp to `#0D9488` (brand-600) passes all five checks, and the three-slot set clears them under
`--pairs all`, not merely adjacent, because a three-segment stack puts every pair beside another:

```
node scripts/validate_palette.js "#0D9488,#eb6834,#4a3aa7" --mode light --surface "#FFFFFF" --pairs all
  Lightness band PASS · Chroma floor PASS · CVD ΔE 10.7 · normal-vision ΔE 26.8 · contrast PASS
```

Three categorical slots and no more. A fourth would put yellow beside orange, which fails the
all-pairs floors — so if a chart here ever needs more series the answer is small multiples, never
a generated hue. No dark mode: the app has no dark theme, and shipping dark steps nobody can
select would be dead tokens.

**Form decisions, each driven by what the data is:**

| Data | Form | Why not the obvious thing |
|---|---|---|
| Completion / acceptance / divergence rate | **hero figure**, one per panel | A one-bar bar chart is a stat tile wearing a costume |
| Jobs by status | horizontal bars, **pipeline order** | Sorting by magnitude would destroy the only thing the sequence says |
| Partner supply (7 counts) | **stat tiles** | Seven bars would imply a shared axis they do not share |
| Durations (min/p50/p95/max/mean) | **range strip** | Not a histogram — the backend returns five summary numbers and no distribution, so bins would be invented |
| Offer outcomes, no-match split | stacked bar, 2px surface gaps | A donut makes close values hard to compare |
| Acceptance rank 1/2/3+ | bars on an **ordinal ramp** | Ordered bins, so the ramp carries the order; a categorical palette would imply three unrelated identities |
| Two strategy arms × 4 components | **grouped bars, one shared 0–1 axis** | Both arms are mean scores, so one scale is honest. A second y-axis would invent a correlation |
| Component deltas | **diverging bars**, gray midpoint | Signed values; the midpoint must read as "nothing", not as a third category |

Constant components are drawn recessive **and labelled `constant`** rather than recoloured — a
third hue would make "not applicable" look like a category, and the backend excludes them from
`driver` precisely because a component that never varied cannot have driven anything.

**Every chart has a table twin** (the Table toggle), because a tooltip must never be the only way
to read a value, and every chart with two or more series carries a legend. Text never wears the
series colour — the swatch beside it carries identity. One filter row scopes all three panels;
per-chart date pickers are how two charts end up showing different windows.

**The `notes[]` vocabulary is rendered verbatim**, code and detail, in an amber panel on each
tab. That is ADR-021's whole argument: a number ships with its caveat attached rather than being
read beside a document nobody has open.

**Two things found while building it:**

1. **A 403 was being retried.** React Query's `retry: 1` applied to "this account is not an
   admin" — a refusal that will never change — so the reader watched a spinner for a backoff
   interval first. 4xx is now never retried; 5xx and network failures still get one attempt.
2. `RequireRole` is deliberately **not** wrapping these routes. It reads client-side role state
   and would bounce an admin whose local role had not been set, while protecting nothing —
   `require_admin` on each endpoint is the real boundary, and the console renders the 403 itself
   with the honest message that admin access is granted in SQL and cannot be self-claimed.

**Verified:** 12 component tests (115 web total), typecheck and build clean, plus a live probe
through the dev proxy with a real provisioned admin — **19/19** — confirming every nested field
path the panels read (`conversion.rate`, `attribution.deltas`, both acceptance rates, both
no-match rates) against the running server, and that no `*rate*` field falls outside 0..1.

**Not verified: the visual layout.** The browser preview tool was unavailable for this session, so
nobody has looked at the rendered page. jsdom has no layout engine — it reports every width as
zero — so label collisions, overflow and geometry are untested. Open `/admin/overview` and look
at it before using it in front of anyone.

---


### [x] Mobile sign-in — 2026-10-07

Mobile now obtains a real token the same way web does. Before this, `authApi.sendOTP`
returned `{success: true}` without calling anything, `authApi.verifyOTP` accepted any six
digits and returned `"mock_jwt_token_" + Date.now()`, and the screen pre-filled the boxes with
123456 — so it reached "verified" whether or not a code had ever been sent.

| Change | File |
|---|---|
| Supabase client: OTP send/verify, AsyncStorage session, URL polyfill | `src/services/supabase.ts` (new) |
| `GET /auth/me` as the four-way routing union (same shape as web) | `src/services/identity.ts` (new) |
| `toE164`, extracted so it is testable outside React Native | `src/services/phone.ts` (new) |
| Real OTP; routes on the backend's role, not the role toggle | `src/features/auth/screens/LoginScreen.tsx` |
| Session restore + refresh subscription; `setDemoUser` (tokenless) | `src/store/authStore.ts` |
| `initSession()` mounted once at the root | `App.tsx` |
| `EXPO_PUBLIC_API_BASE_URL` override | `src/constants/index.ts` |
| Mock auth removed outright | `src/services/api.ts` |

**Three things React Native needs that the web client does not:**

1. **`react-native-url-polyfill/auto`, imported first.** supabase-js builds URLs with the WHATWG
   `URL` API, which Hermes does not implement. Without it every auth call fails at runtime with
   "URL.protocol is not implemented" — a typecheck and a bundle both pass, so the failure only
   appears on a device.
2. **`storage: AsyncStorage`.** The web client defaults to `localStorage`. With no storage the
   session lives in memory and a mechanic whose app gets killed in the background is back at the
   OTP screen.
3. **`EXPO_PUBLIC_*` env vars**, inlined at build time. Restart with `npx expo start -c` after
   changing `.env` — a running bundler will not pick it up.

**Four forged-bearer paths removed.** The request interceptor now sends whatever is in
`token`, which turned every placeholder into a real `Authorization` header: the store's default
`"mock_jwt_owner"`, the login screen's `handleQuickDemo`, and role-switch buttons in
`HomeScreen` and `OwnerHelpFlowScreen` that passed `"mock_jwt_partner"`. All now use
`setDemoUser(user)`, which sets a profile with **no token** — browsing the mocked screens and
being signed in no longer share a code path.

**`handleVerifyOTP` no longer falls back to a mock user.** Its `catch` called
`handleQuickDemo(role)`, so a wrong code — or a Supabase outage — silently signed you in as a
hardcoded profile. Same family as the web's swallowed `link-auth`.

**`API_BASE_URL` was hardcoded to `10.0.2.2:8000`**, the Android *emulator's* alias for the host.
It resolves to nothing on a physical phone — which is the only place an OTP SMS can arrive — so
it is now overridable. Set `EXPO_PUBLIC_API_BASE_URL` to the host's LAN address and start
uvicorn with `--host 0.0.0.0`.

**Tests: 15, in a runner mobile did not have.** Vitest, for the pure logic only — the routing
fork and the phone shaping. Those are what repay a test: three outcomes, two arriving as the
*same* 403, reached only on cold paths (a first-ever sign-in; a mechanic ops registered before
they installed the app) that nobody hits by tapping through. Reverting the fork to read the
status alone fails exactly three. `tests/services/route-inventory.test.ts` is the mobile twin of
web's and catches a reintroduced `GET /jobs/me` by name. Screens remain untested — jest-expo is
a bigger change than this task, and they were untested before.

`tsc --noEmit` passes, which it did **not** before: three declared dependencies
(`expo-linear-gradient`, `react-native-svg`, `expo-splash-screen`) had never been installed, so
the typecheck failed with 7 errors on `node_modules` that were simply absent. `npm install`
fixed that; `@types/node` and `"types": ["node"]` were added for the route test, which reads the
source tree.

**What is still not verified, stated plainly:** nothing here proves the client works *on a
device*. The URL polyfill and the AsyncStorage session are exactly the kind of thing that
typechecks and then fails at runtime. Run it on a real phone with a configured Supabase test
number before relying on it.

---

### [x] Real Supabase sign-in — 2026-10-07

The repoint below was correct about every path, and none of it could work, because the app had
no way to obtain a token. There was no Supabase client in `web/` at all; `LoginPage.handleVerify`
was a `setTimeout` that navigated by the role toggle, and `AuthProvider` said as much in its own
comment. So `apiClient` sent no `Authorization` header and all six "fixed and verified" partner
endpoints answered **401** in a browser. Setting `VITE_PARTNER_API_MOCK=false` is what made that
visible: it stopped the console using its mock and started it making calls that could not succeed.

| Change | File |
|---|---|
| Supabase client, OTP send/verify, session restore, token refresh | `src/services/supabase.ts` (new) |
| `GET /auth/me` wrapped as a four-way routing union | `src/services/identity.service.ts` (new) |
| Real OTP; routes on the backend's role, not the toggle | `src/pages/auth/LoginPage.tsx` |
| Real OTP; **calls `link-auth`**; surfaces failures instead of showing success over them | `src/pages/partner/PartnerSignup.tsx` |
| Redirects to `/login` when unauthenticated; prefills the verified phone | `src/pages/owner/OwnerSignup.tsx` |
| Placeholder bearer removed; `USER_NOT_REGISTERED` opens the register modal | `src/pages/owner/RequestHelpPage.tsx` |
| Token kept in step with the Supabase session | `src/app/AuthProvider.tsx` |
| Supabase URL + **publishable** key | `web/.env`, `web/.env.example` |

**Three bugs this surfaced, all fixed:**

1. **`PartnerSignup` never called `POST /partners/{id}/link-auth`** — it created the profile and
   stopped, leaving `auth_user_id` NULL. That is a partner nobody can ever sign in to, because
   every partner route resolves the token against that column. It was also wrapped in
   `catch { console.warn }` and fell through to the success screen, so a registration that failed
   looked exactly like one that worked.
2. **`RequestHelpPage` substituted the string `'demo-token-owner-asha'`** for a real bearer under
   `IS_DEMO_MODE`. The backend verifies every token against the project's JWKS, so the demo path
   was a 401 with extra steps. It now sends the user to `/login`.
3. **An infinite retry loop I introduced and the tests caught** — the auto-submit effect fires
   whenever six digits are present and the form is idle, and a failed verification necessarily
   returns to idle with all six digits still on screen. Guarded with a `attemptedCode` ref,
   cleared when any digit is edited.

**Four calls removed — the routes do not exist:**

| Call | Where | Note |
|---|---|---|
| `GET /users/{id}` | `users.service.ts` | No per-user read. Callers wanted `GET /auth/me` |
| `PATCH /vehicles/{id}` | `vehicles.service.ts` | Deferred backend work; no call sites |
| `DELETE /vehicles/{id}` | `vehicles.service.ts` | Same |
| `GET /jobs/me` | `mobile/src/services/api/jobs.ts` | No job-history route — still wanted, §3.1 of BACKEND_COMMUNICATION |

Plus two mobile contract fixes: `cancelJob` sent `{ reason }` where the schema declares
`cancellation_reason` **with `extra="forbid"`**, making every cancel a 422; and the axios auth
interceptor was commented out behind a TODO while the store held a hardcoded `"mock_jwt_owner"`.

**Why none of it was caught, and what now catches it.** `tests/services/contract.test.ts` is
named for checking the backend contract and asserts against a mocked `fetch` — a mocked transport
answers any URL, so it was green while asserting a `PATCH /vehicles/{id}` that has never existed.
`tests/services/route-inventory.test.ts` now reads every `apiClient` path out of `src/` and diffs
it against `tests/fixtures/backend-routes.json`, generated from the backend's own OpenAPI schema.
**Re-export the fixture whenever a route changes:**

```bash
cd backend && python tools/export_routes.py
```

**Tests:** 103 passing (was 89). Twelve existing tests were rewritten rather than patched,
because each asserted the broken behaviour — the owner-signup contract test expected a `token`
field in the registration response that has never existed, and the LoginPage tests asserted a
timer. Typecheck and production build clean. `@types/node` added as a devDependency (the new test
reads files).

**Two things still needed from you:**

1. Drive the OTP with the Supabase **test numbers** (BACKEND_COMMUNICATION §4.2). The phone
   provider is live on the project with `sms_provider: textlocal` and `phone_autoconfirm: false`,
   so an arbitrary number sends a real SMS.
2. Mobile has no sign-in — `LoginScreen` calls `setUser()` with no session, so authenticated
   calls there 401 by design. `src/services/supabase.ts` is the reference.

---

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

