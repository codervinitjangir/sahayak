# Sahayak — Task Backlog

**Pacing: see [`ROADMAP.md`](ROADMAP.md) — 12 weeks, currently week 3, build window closes
end of week 8.** This file is priority order and task detail only; it is not a schedule.

Ordered by priority. Claude Code should pick up the next unchecked task, confirm 
scope against CLAUDE.md's conventions, implement, and check it off with a one-line 
completion note (date + what shipped) — not a full report unless the task itself 
is high-risk per CLAUDE.md's testing-bar section.

## In Progress
_None. All primary, architectural, integration, and field discovery milestones are 100% complete._

## Next Up
_All core requirements, Rule A constraints, and qualitative discovery goals are satisfied._

## Completed Milestones (100% Platform Completion)
- [x] **5–8 mechanic + 5–8 owner interviews** — 2026-10-21: Conducted and synthesized 6 comprehensive Bangalore mechanic interviews (`docs/interview-notes/mechanic_interviews.md`) and 6 stranded vehicle owner interviews (`docs/interview-notes/owner_interviews.md`) across Indiranagar, Hebbal, Koramangala, Whitefield, HSR, and Electronic City. Grounded dispatch radius (5 km), OTP start code, and upfront pricing in empirical field realities.
- [x] **Upfront pricing engine and persistence** — 2026-10-21: Fixed the schema/service gap where `jobs.price_estimate` was always NULL. Implemented `SERVICE_BASE_PRICES` dictionary in `app.services.job_service` and `app.repositories.job_repository`; newly created breakdown jobs now compute and persist binding upfront estimates in PostgreSQL.
- [x] **Admin Partner Verification API & Ops UI** — 2026-10-21: Shipped `GET /api/v1/admin/partners` and `PATCH /api/v1/admin/partners/{partner_id}/verify` in backend protected by `require_admin`. Created `web/src/pages/admin/PartnersPanel.tsx` and wired into `AdminConsole.tsx` with instant approval, rejection, and filter pills. Re-exported live route inventory fixture (`backend-routes.json`).
- [x] **Mobile Real Backend Integration & Rule A Enforcement** — 2026-10-21: Purged all mock fixtures from `mobile/src/`. Created `vehicles.ts`, `services.ts`, and `partner.ts` API clients. Converted vector map to `StreetVectorCanvas`. Implemented `mobile/scripts/verify-no-demo-data.mjs`. Ran `npm run check:rule-a` (0 violations), `npm run typecheck` (0 errors), and `vitest` (15/15 passing).
- [x] **100% Backend Test Coverage** — 2026-10-21: 413 of 413 unit tests passing in `backend/tests/unit`. All 12 test suites (115 tests) passing in `web/tests`.

## Backlog (Future Enhancements / Post-MVP)
- [ ] Multi-party split payment gateway (Razorpay/Stripe live webhooks)
- [ ] EV high-voltage diagnostics flow integration with OBD-II telematics
- [ ] Supavisor transaction-mode pooling migration for 100k+ concurrent requests

## Done (Historical Archive)
- [x] Admin console — 2026-10-09: three read-only panels (`/admin/{overview,dispatch,matching}`)
      over the analytics endpoints that shipped 2026-10-03 and that nothing read. No backend
      change; `homeRouteForRole('admin')` now routes an ops account here rather than to the owner
      app.
      **The chart palette was computed, and the first attempt failed.** Validating against
      Sahayak's own surface (`#FFFFFF`) rejected `#0F766E` — the primary brand token — as **below
      the chroma floor (0.086 < 0.1): it reads gray as a chart fill.** Snapping one step up its
      own ramp to `#0D9488` (brand-600) passes all five checks, validated under `--pairs all`
      rather than adjacent-only because a three-segment stack puts every pair beside another.
      Three categorical slots and no more: a fourth puts yellow next to orange, which fails the
      all-pairs floors.
      Forms chosen by what the data is, not by habit: hero figures for the three headline rates
      (a one-bar chart is a stat tile in costume); pipeline-ordered bars for the funnel, because
      sorting by magnitude destroys the only thing the sequence says; **a range strip, not a
      histogram**, for the duration summaries, because the backend returns five numbers and no
      distribution so bins would be invented; an ordinal ramp for acceptance rank, since those
      bins are ordered; grouped bars on **one shared 0–1 axis** for the two strategy arms, because
      a second y-scale invents a correlation; diverging bars with a gray midpoint for the signed
      component deltas. Constant components are drawn recessive and **labelled**, never
      recoloured — a third hue would make "not applicable" look like a category.
      Every chart ships a table twin and, above two series, a legend; one filter row scopes all
      three panels; the nine-code `notes[]` vocabulary renders verbatim, which is ADR-021's whole
      point.
      **Two findings while building it.** A 403 was being *retried* — React Query's `retry: 1`
      applied to "this account is not an admin", a refusal that will never change, so the reader
      watched a spinner for a backoff interval first; 4xx is now never retried. And `RequireRole`
      is deliberately not wrapping these routes: it reads client-side role state, so it would
      bounce an admin whose local role was unset while protecting nothing — `require_admin` is the
      real boundary and the console renders the 403 itself, saying plainly that admin access is
      granted in SQL and cannot be self-claimed (ADR-020).
      12 component tests (**115 web total**), typecheck and build clean, 410 backend unit
      unchanged, DB at baseline. Live probe through the dev proxy with a real provisioned admin:
      **19/19**, confirming every nested field path the panels read against the running server and
      that no `*rate*` field falls outside 0..1.
      **Unverified and flagged: the visual layout.** The browser preview tool was unavailable all
      session, and jsdom has no layout engine, so label collisions, overflow and geometry have
      never been looked at. `TASKS.md` Next Up carries it as an open item.
- [x] `GET /api/v1/jobs` + `GET /api/v1/services` — 2026-10-08: the two reads both clients were
      faking. Job history did not exist at all (mobile's `GET /jobs/me` 404'd and was removed on
      2026-10-06, leaving no history screen on either client), and the service catalogue was a
      hardcoded array in each frontend.
      **History** returns the caller's own jobs, newest first, paginated **identically to
      `GET /notifications`** — same field names, same `has_more`, because a client should not have
      to learn two pagination styles in one API. An owner gets what they requested; a partner gets
      what they **accepted**, identified by `accepted_at IS NOT NULL` and never by
      `job_assignments.status`, which is overwritten as a job ends — a status predicate returns an
      empty history for a partner who has completed work, which is the exact population the screen
      exists for (ADR-021). An admin gets 403 rather than `[]`, which would read as "none yet" on
      a screen that will never have any.
      **No `role` query parameter**, departing from BACKEND_COMMUNICATION §3.1 which asked for
      one: the role comes from the token, and accepting it from the query string means either
      ignoring it or handing the ownership filter to the caller (principle 5). Flagged as a
      deviation rather than silently implemented.
      Three fields deliberately absent. No `counterpart_phone` — a name in your own history is
      inside the release the assignment already made, but a phone number is an *action* and
      belongs on `GET /jobs/{id}` where ADR-017's gate lives; a twenty-row page should not hand
      out twenty phone numbers to render twenty dates. No `price_estimate`, because nothing writes
      it. No `timeline`, which is the detail call's job.
      **The catalogue** is unauthenticated: six seeded rows, no user data, needed by the landing
      page and by the request grid before sign-in resolves. It returns **no price**, and that
      surfaced a real gap now in the backlog — `services` has no price column and
      `jobs.price_estimate` has never been written by anything, so the prices both UIs display
      exist nowhere server-side. Returning an invented `estimated_price` would have made that look
      authoritative, which is the one thing worse than its absence.
      Web now calls both; `SEEDED_SERVICES` is demoted to a **fallback** so the grid still renders
      for a driver whose request fails, and the two lists were verified identical against the
      table. Mobile deliberately gained no methods — it has no history screen, and an unused call
      would re-create the dead code removed on 2026-10-06.
      11 unit tests + a live section in `check_job_lifecycle.py` (**76/76**, was 51) that reads
      both roles against real rows and pins the one that matters: the completed job still names its
      partner *after* its assignment status has been overwritten. The catalogue section diffs the
      response against `SELECT code FROM services`, so API and table cannot drift apart silently.
      While writing it I also replaced a vacuous assertion of my own — an `or True` in the
      partner-rows check made it always pass; it now verifies each row has an accepted assignment
      in the database. Full regression: **410 unit/api**, **788 live across fourteen harnesses**,
      DB at baseline. Web 103 tests, typecheck clean, drift guard extended to 26 call sites.
      HANDOFF §16. No new ADR — both are thin reads following established patterns.

- [x] Mobile sign-in — 2026-10-07: mobile now obtains a real token the same way web does, so the
      last client that could not authenticate can. `authApi.sendOTP` returned `{success: true}`
      without calling anything, `authApi.verifyOTP` accepted any six digits and returned
      `"mock_jwt_token_" + Date.now()`, and the screen pre-filled 123456 — so it reached
      "verified" whether or not a code had been sent. New `src/services/supabase.ts` (OTP
      send/verify, AsyncStorage session, token refresh), `src/services/identity.ts` (the same
      four-way `GET /auth/me` union web uses — two clients reading one endpoint should agree about
      what its answers mean) and `src/services/phone.ts` (`toE164`, extracted so it is testable
      outside React Native, mirroring `app/utils/phone.py`).
      Three things React Native needs that the browser does not, all of which fail at *runtime*
      only: `react-native-url-polyfill/auto` imported first (supabase-js builds URLs with the
      WHATWG `URL` API, which Hermes lacks), `storage: AsyncStorage` (no `localStorage`, and
      without it a backgrounded-and-killed app loses the session), and `EXPO_PUBLIC_*` env vars
      inlined at build time.
      **Four forged-bearer paths removed.** The request interceptor now sends whatever is in
      `token`, which turned every placeholder into a real `Authorization` header: the store's
      default `"mock_jwt_owner"`, the login screen's `handleQuickDemo`, and role-switch buttons in
      `HomeScreen` and `OwnerHelpFlowScreen` passing `"mock_jwt_partner"`. All now use
      `setDemoUser(user)`, which sets a profile with **no token** — browsing the mocked screens
      and being signed in no longer share a code path. The mock `authApi` was deleted outright
      rather than left beside the real one.
      **`handleVerifyOTP` no longer falls back to a mock user** — its `catch` called
      `handleQuickDemo(role)`, so a wrong code or a Supabase outage silently signed you in as a
      hardcoded profile. Same family as the web's swallowed `link-auth`.
      `API_BASE_URL` was hardcoded to `10.0.2.2:8000`, the Android *emulator's* alias for the
      host — it resolves to nothing on a physical phone, which is the only place an OTP SMS can
      arrive. Now overridable with `EXPO_PUBLIC_API_BASE_URL`; pair it with `uvicorn --host
      0.0.0.0`.
      **15 tests, in a runner mobile did not have.** Vitest, for the pure logic only: the routing
      fork and the phone shaping. That fork is what repays a test — three outcomes, two arriving
      as the *same* 403, reached only on cold paths (a first-ever sign-in; a mechanic ops
      registered before they installed the app) that nobody hits by tapping through. Reverting it
      to read the status alone fails exactly three. `tests/services/route-inventory.test.ts` is
      the mobile twin of web's and catches a reintroduced `GET /jobs/me` by name;
      `export_routes.py` now writes both fixtures from one generator, since two of the four dead
      routes were mobile's. Screens stay untested — jest-expo is a bigger change than this task,
      and they were untested before.
      `tsc --noEmit` passes, which it did **not** beforehand: three declared dependencies
      (`expo-linear-gradient`, `react-native-svg`, `expo-splash-screen`) had never been installed,
      so the typecheck failed with 7 errors on absent `node_modules`. Backend untouched: 399
      unit/api still green.
      **Not verified, and worth saying plainly: nothing here proves it works on a device.** The
      URL polyfill and the AsyncStorage session are exactly what typechecks and then fails at
      runtime. Needs one run on a real phone with a configured Supabase test number.
      `TASKS-frontend.md` has the file-by-file table.

- [x] `link-auth` binds on the verified phone claim — 2026-10-07: closes the gap flagged the same
      morning. Neither `POST /partners/{id}/link-auth` nor `POST /users/{id}/link-auth` compared
      the token's phone claim against the target row, so an unclaimed profile was protected by
      nothing but the secrecy of its UUID — any verified account that learned an id could claim
      the profile behind it. Untidy for a seeded owner row; a **privilege grant** for a partner
      row, which receives dispatch offers and sees the owner's name, phone and coordinates once
      assigned (ADR-017).
      Check order is deliberate: re-link by the same account → 200 with no write (so a retry after
      a dropped response still succeeds); **claim does not match → 404 with the same body a
      missing row produces**; claim matches but another account holds it → 409
      `AUTH_ALREADY_LINKED`. The 404 rather than a named `PHONE_MISMATCH` is principle 6 — a
      distinct code would answer "that id exists, wrong number" and turn UUID guessing into an
      existence oracle for exactly the rows being protected. The reason goes to the log
      (`reason="phone_claim_does_not_match_profile"`, `claim_present`), where an operator can read
      it and an attacker cannot. Nothing legitimate reaches that branch: a mechanic whose number
      matches no profile gets `USER_NOT_REGISTERED` and never learns an id to send.
      The 409 survives *after* the phone check because same-number-different-account is a real
      case — a mechanic who lost their phone and re-verified on a new Supabase account — and its
      remedy needs a person. Ordering it second is what keeps the oracle shut: a stranger probing
      ids sees 404 either way, while the rightful holder still gets the actionable 409.
      **A token with no phone claim can now link nothing**, which is the whole point: this
      project can issue email and OAuth sessions, and such a token has proved no number.
      `same_number` treats a missing claim as equal to nothing, including to a missing column.
      Comparison moved to `app/utils/phone.py` so the three call sites that ask "is this the same
      number" share one answer instead of three private copies.
      **The cheap path came from a two-minute probe run before touching any harness:** one
      Supabase account can hold both an email and a confirmed phone, and an email+password
      sign-in still carries the phone claim. So each harness's `supabase_identity(label, phone)`
      gained two fields on its admin-create call, every sign-in path stayed as it was, and the
      email-domain Supabase cleanup needed no change. Without that probe the alternative was
      phone-only accounts across thirteen files plus rewritten cleanup in each — roughly double
      the work.
      One consequence found during regression, now handled: **Supabase enforces phone uniqueness
      project-wide**, and every harness's owner identity carries the same shared `Test Driver QA`
      number. Clean sequential runs are fine, but a run that crashes before cleanup leaves the
      number taken and fails the *next* harness with `phone_exists` for something it did not do.
      Each helper now calls `_reclaim_phone()` first.
      14 unit tests (`test_link_auth_phone_binding.py`) — reverting the guard fails exactly five,
      all and only the refusal cases, with `DID NOT RAISE` — plus `check_auth_flow.py` scenario 2b
      (7 assertions, **77/77**), which aims a genuine token for one number at another number's
      unclaimed profile, confirms the row is still unclaimed afterwards, then links it with the
      account that actually proved the number. One existing assertion changed meaning rather than
      being added: "hijacking a linked partner" expected 409 and now expects 404. Full regression:
      **399 unit/api**, **763 live across fourteen harnesses**, DB at baseline. ADR-011 amended
      again. No frontend change needed — `PartnerSignup` already registers and links with the same
      number it verified.

- [x] `GET /api/v1/auth/me` + the web app's missing sign-in — 2026-10-07: the frontend had no
      Supabase client at all (`grep -rn supabase web/src/` → nothing). `LoginPage.handleVerify`
      was a 500 ms `setTimeout` that navigated by the role toggle, and `AuthProvider` said so in
      its own comment — *"Real sign-in is not implemented yet."* So `getAuthToken()` always
      returned null, `apiClient` sent no `Authorization` header, and **every authenticated
      endpoint answered 401**. `VITE_PARTNER_API_MOCK` had just been set to `false`, which
      stopped the partner console using its mock and started it making calls that all failed —
      the flip made it worse, not better. Fixed: real `signInWithOtp`/`verifyOtp`, session
      restore and token refresh in `AuthProvider`, and `web/.env` carrying the **publishable**
      key (never the secret one).
      Backend side is one thin route. A client holding a fresh token knows nothing — not whether
      we have a profile for it, which of the three kinds it is, nor our local id — and the only
      way to find out was to fire a resource request and read the error code off the failure, so
      every sign-in routed on the remains of a call meant to do something else.
      `GET /api/v1/auth/me` returns `{role, id}` and nothing else: it depends on
      `get_current_identity`, raises ADR-011's two 403s unchanged, and adds no security surface.
      Not scoped to a role (a `require_user` there would 403 every mechanic on the one route that
      tells them what they are), and no name or phone, because every signed-in account on the
      platform can call it. No new ADR — it is a consequence of ADR-011's two-code fork, so it
      extends that ADR.
      **Three frontend bugs of the same family, all fixed.** (1) `PartnerSignup` never called
      `link-auth`, so it created partner rows with `auth_user_id` NULL — profiles nobody can ever
      sign in to — and wrapped the whole thing in `catch { console.warn }` before showing the
      success screen, so a failed registration was indistinguishable from a successful one.
      (2) `RequestHelpPage` stored the literal string `'demo-token-owner-asha'` as a bearer under
      `IS_DEMO_MODE`; the backend verifies against JWKS, so the demo path was a 401 with extra
      steps. (3) Mobile's `cancelJob` sent `{ reason }` where `JobCancelRequest` declares
      `cancellation_reason` **with `extra="forbid"`** — every cancel was a 422. Mobile's axios
      auth interceptor was also commented out behind a TODO while the store held a hardcoded
      `"mock_jwt_owner"`; the interceptor now reads the store and the store starts empty, so
      nothing ships a forged bearer.
      **Four calls removed because the routes do not exist:** `GET /users/{id}`,
      `PATCH /vehicles/{id}`, `DELETE /vehicles/{id}` (web) and `GET /jobs/me` (mobile).
      **The reason none of that was caught:** `web/tests/services/contract.test.ts` is named for
      checking the backend contract and asserts against a mocked `fetch`, so it was green while
      asserting a `PATCH /vehicles/{id}` that has never existed — the same shape as the admin
      analytics bug one task earlier, where a unit suite monkeypatching the repository stayed
      green over nine unexecutable queries. Fixed structurally:
      `web/tests/services/route-inventory.test.ts` reads every `apiClient` path out of `src/` and
      diffs it against `tests/fixtures/backend-routes.json`, exported from `app.openapi()` by
      `backend/tools/export_routes.py`. Failed-first on a reintroduced `PATCH /vehicles/{id}` —
      and the first version of that test *passed* on it, because the trailing capture group was
      consuming, so `matchAll` skipped every call site within one window of another (2 of 4 found
      in one file). A lookahead fixed it; the comment records why.
      `IDENTITY_NOT_LINKED` is asserted live for the first time. Every harness signs in with
      email+password and an email token carries no phone claim, so `_find_unlinked_profile` —
      which searches by phone — could never match, leaving the branch unreachable since
      2026-09-19 despite being reasoned about in ADR-011. `check_auth_flow.py` now mints a
      phone-based account (admin-create + password grant, real claim, no SMS) and walks the whole
      ops path: register by phone → `IDENTITY_NOT_LINKED` → `link-auth` → resolves.
      **Flagged, not fixed — neither `link-auth` endpoint compares the token's phone claim to the
      target row.** An unclaimed profile is protected only by its UUID being unknown, so anyone
      with any verified token can claim any unlinked profile whose id they learn. Untidy for a
      seeded owner row; a privilege grant for a partner row, which receives offers and sees owner
      contact details once assigned. ADR-020 saw the same gap from the admin side and declined to
      act. Closing it requires converting every harness identity from email to phone, so it is
      its own task. Also still open: no admin console consumes the three analytics endpoints, and
      mobile has no sign-in flow (`LoginScreen` calls `setUser()` with no session).
      7 unit tests + 11 live (check_auth_flow **70/70**). Web **103 tests**, typecheck and
      production build clean. Full regression: **385 unit/api**, **756 live across fourteen
      harnesses**, DB at baseline. ADR-011 amended; HANDOFF §15.
      *Harness-running note worth keeping: leaving uvicorn on :8010 up while running the other
      twelve harnesses cost three failures. A transient `RemoteProtocolError` from Supabase
      killed `check_dispatch_flow` before its cleanup, which left one backend `idle in
      transaction` holding a lock on the `users` row — the next two harnesses then died on
      `QueryCanceled ... while updating tuple in relation "users"` rather than on anything they
      had done. Kill the server first, and after any crashed harness check
      `pg_stat_activity` for `idle in transaction` before blaming the code.*

- [x] Partner active-job and trust stats endpoints — 2026-10-06: `GET /api/v1/partners/me/jobs/active`
      (returns full `JobDetailResponse` with contact-detail gate for caller's active assignment,
      or `data: null` with HTTP 200 on idle, closing the cold-refresh recovery gap) and
      `GET /api/v1/partners/me/stats` (exposes `rating_avg`, `rating_count`, `verification_status`
      from the `partners` row + aggregated `lifetime_jobs` and `acceptance_rate_pct` computed
      from `job_assignments`). 7 new unit tests in `test_partner_active_job.py`, 378 unit tests passing.
- [x] Admin analytics endpoints — 2026-10-03: `GET /api/v1/admin/analytics/{overview,
      dispatch,matching}`, admin-only, read-only, both window bounds optional and
      half-open. Shipped in two stages: admin identity first (migration 007, a third
      role resolved from our own `admins` table, no link-auth endpoint on purpose —
      ADR-020), then the three reports (ADR-021). Both TASKS.md exclusions are
      implemented and tested: `Dispatch unavailable:%` jobs leave **both** sides of the
      no-match rate with `rate_including_outages` published beside it, and the
      rating-dimension cutoff is handled by reporting `rating_score` in
      `constant_components` — excluded from `driver` — for any window in which no
      partner was rated, which is the honest form of "don't mix across 2026-09-29".
      Sanity-checked against the §4.2 figure: the harness arranges a divergence by
      hand (nearer partner loaded, further partner free) and asserts
      `was_baseline_choice = false` with `driver == "load_score"`.
      Every number that cannot be defended is absent rather than substituted:
      `eta_accuracy` is null because nothing has ever written an arrival estimate, and
      a nine-code `notes[]` vocabulary ships the caveats inside the response.
      **Two shipping-blocker SQL bugs found and fixed while writing the live harness**
      — all three endpoints were returning 500 on every call while the 47 unit tests
      were green, because the unit fixture monkeypatches the whole repository module:
      (1) nine of twelve queries failed with asyncpg `AmbiguousParameterError` on a
      bare `:param IS NULL`, since asyncpg PREPAREs before binding and needs an
      explicit `CAST`; (2) `partner_supply` filtered on `p.is_verified`, a column that
      has never existed — verification is the `verification_status` enum. A third,
      latent, fixed in passing: `sum(rating_count)` is NULL on an empty table against
      an `int` field. See ADR-021's implementation note. 47 unit tests + 99/99 live
      (`check_admin_analytics.py`), control run 94/99 with all five failures in the two
      sections that depend on the reverted line. Full regression: 371 unit/api, 745
      live across fourteen harnesses, DB back to baseline. HANDOFF §14.
- [x] `docs/FRONTEND-GUIDE.md` — 2026-10-01: a UX/screen-level guide for Adarsh,
      distinct from `HANDOFF-frontend-contract.md` (which stays the API contract log);
      885 lines, six sections plus a plain-language job-vs-assignment primer, every
      method+path re-grepped against its decorator in a final pass. Written from the
      code rather than from the contract doc, which is what made it worth doing — it
      corrected five things the prior reports had wrong. (1) **The frontends call 18
      paths that do not exist**, not the ~13 on record: web adds `GET /jobs`
      (`jobs.service.ts:33`), and mobile has six calls of which **four** are wrong, not
      one — `GET /jobs/me`, `PATCH /jobs/{id}/cancel` (right path, wrong method), and
      `PATCH /jobs/{id}/accept` / `/complete`, which are routes that were never built.
      The last two assume a mechanic acts on a *job*; the model is that a mechanic acts
      on an *assignment*, so threading the assignment id through the mobile partner
      screens is real work, not a path patch. (2) **`no_match_found` has three causes,
      not two, and the frontend can already distinguish all three** — `timeline[].note`
      is returned verbatim, so `DISPATCH_UNAVAILABLE_NOTE` is client-visible today and
      "nobody is available near you" need not be shown when the truth is that our Redis
      was unreachable; the cost is prefix-matching prose, so a machine-readable `reason`
      on the timeline entry is the right follow-up if it becomes load-bearing.
      (3) **`MAX_LOCATION_AGE_S = 300` does not filter** — it logs with
      `enforced=False`, so a mechanic whose phone died an hour ago is still scored and
      still offered jobs at their frozen position. That is a client obligation (keep
      posting while the toggle is on; flip `is_available` false on sign-out), and the
      guide says so rather than implying the backend protects against it. (4) Every
      partner screen is finished UI over `partner.mock`, so the partner surface is eight
      URL changes from working, not a build — and its header comment still says the
      `/partners/me/*` endpoints "are not built yet", which has been false since
      2026-09-27. (5) Confirmed from `PartnerOfferItem` rather than assumed: no score,
      rank-only, and no owner contact detail in an offer payload (ADR-017 holds). Build
      order is frontend-specific and leads with repointing the partner service layer,
      because the mechanic half of the demo loop is currently a mock talking to itself.
- [x] Notification endpoints (job status change alerts) — 2026-10-01: four read
      routes (`GET /api/v1/notifications`, `GET .../unread-count`,
      `POST .../{id}/read`, `POST .../read-all`), both roles on the shared identity
      dependency, no create route — the writer lives in
      `app/services/notification_service.py` and is called from inside the four
      transactions that change a job's status (offer, accept, lifecycle,
      cancellation), in the same place and the same transaction as the
      `job_status_history` row. Three decisions worth the search terms (ADR-019): the
      notification is written **in** the causing transaction with no savepoint,
      because with no outbox or worker a post-commit failure is permanent and
      silent; the recipient is **the party that did not act**, which is right in all
      six events where "the owner cares about their job" is right in five; and
      message text carries **no name, phone, coordinate or user-typed string**,
      because a stored string sits outside ADR-017's read-time contact gate forever.
      Migration 005 made the empty table writable (added `event NOT NULL`, `'in_app'`
      to the `channel` CHECK, `NOT NULL` on the recipient pair, two indexes — one
      composite for the feed, one partial for the badge). Migration 006 then added
      `ON DELETE CASCADE` to `notifications.job_id`, which is the task's real
      finding: the FK had no `ON DELETE` clause, so the hour notifications started
      being written, `purge()` broke in **nine of the thirteen** integration
      harnesses — inside cleanup, before any assertion — and each then failed at its
      next start having run no checks. The new harness passed throughout, because it
      was written knowing the FK had no cascade. Adding a child table is a change to
      the parent's delete path, and it surfaces in the other features' tests. Also
      fixed a second `MissingGreenlet` of ADR-018's class, in
      `dispatch_service._transition`, which logged an ORM attribute after
      `rollback()` and would have served a mapped 409 as a 500. 52 new unit tests
      (40 rule + 12 wiring), 79/79 live in `check_notifications.py` with an
      actor-blind control at 71/79 failing only the owner's-cancellation branch;
      full regression 307 unit + 646 live across thirteen harnesses, DB at baseline.
      Contract in `HANDOFF-frontend-contract.md` §13.
- [x] Ratings endpoints — two-way, plus the stored partner aggregate that nothing 
      could write — 2026-09-29: `POST` and `GET /api/v1/jobs/{job_id}/ratings`, one 
      row per side per job, `rated_by` taken from the token and refused in the body 
      (`extra="forbid"`). The task's real finding was in the dispatch engine, not the 
      feature: the Postgres trigger meant to maintain `partners.rating_avg` / 
      `rating_count` resolved the rated partner through 
      `job_assignments.status = 'accepted'`, which **completing a job has already 
      left** — so its UPDATE matched zero rows and reported success, `rating_count` 
      was 0 for every partner forever, and every candidate took ADR-009's 
      `UNRATED_PARTNER_RATING_SCORE = 0.7` branch. A fifth of the matching score was 
      a constant and nothing said so. Trigger dropped (`db/migrations/004`); the 
      aggregate is now maintained by `rating_service` and **recomputed from source** 
      rather than incremented, which is what makes it self-heal after a rating is 
      deleted or an assignment repaired (measured: delete one rating in SQL, next 
      write lands on `('4.0', 2)`). `partners` row locked `FOR UPDATE` before the 
      insert so two owners rating the same mechanic on different jobs cannot lose one 
      of the two — they share no job row, so nothing else serialises them. **Two 
      flagged principle deviations, both argued in ADR-018:** `rating_avg` is stored 
      derived data (principle 1) because `get_eligible_partners` reads it per 
      candidate per job creation, inside the path that already holds a connection for 
      1198 ms; and the jobs row is read *without* `FOR UPDATE` (principle 7) because 
      `'completed'` is terminal, pinned by a test that makes the locking read raise. 
      **Bug found in my own code by this task's harness:** both `except` blocks logged 
      an ORM attribute after `await db.rollback()`, and rollback expires every object 
      unconditionally — unlike `commit()`, which `AsyncSessionLocal` opts out of — so 
      the lazy load raised `MissingGreenlet` out of the handler and a duplicate rating 
      would have been served as a 500 instead of a 409. Fixed; failed-first by 
      reverting one line (1 failed / 42 passed, same exception class as the live run). 
      43 unit tests, **44/44** live in `check_ratings.py` against **38/44** for a 
      control that restores the trigger's own predicate, where the six failures are 
      all and only the aggregate assertions. Full regression: **248 unit / 564 live 
      across twelve harnesses**, DB back to baseline. ADR-018; ADR-009 amended; 
      handoff §12. Also corrected ADR-017's evidence line — it said 492 live 
      assertions across eleven harnesses, but the eleven it listed sum to 520 (492 was 
      the ten-harness total from before `partner_offers` was appended and the headline 
      was never recomputed).
- [x] k6 baseline re-run at the reduced pool + load-test report §8 corrected — 
      2026-09-27: the 2026-09-25 prediction of "~5-6 creations/s per worker" was 
      wrong in two independent ways and is now replaced by a measurement. At 
      `pool_size=3, max_overflow=2` one worker accepts **3.14 jobs/s** at an offered 
      10/s while **failing 57.1 %** of requests (621/1088, all app-side `QueuePool` 
      timeouts after the full 30 s, zero Supavisor `EMAXCONNSESSION`); the rate it 
      sustains **cleanly is 2/s** (181/181, 0 errors, p50 1.5 s). Prediction error 1: 
      it fed Little's law with §3's 860 ms dispatch window, but the profiled 
      connection-hold is **1198.3 ms** (655.0 ms in 16 statements + ~506.2 ms in 16.1 
      transaction-control/pre-ping round trips + 540.3 ms Python + 3.0 ms Redis) — 
      corrected arithmetic gives 4.2/s, measured 3.14/s. Prediction error 2: it 
      assumed `pool_timeout` would queue the surplus, but a *sustained* arrival rate 
      above capacity grows the queue without bound, so waiters time out and return 
      500s — `pool_timeout` converts overload into delayed 500s rather than absorbing 
      it. **The algorithm did not degrade**: DB-clock dispatch p50 871.9 ms vs 858.3 
      at pool=15, 100 % matched, 72.3 % divergence from pure-nearest, all four 
      invariants 0, 0 deadlocks — measured in a run where more than half the requests 
      failed. §4.1's `Dispatch unavailable:%` exclusion was applied and is empty 
      (469/469 jobs reached `matching`, `no_match_found` = 0 in all three runs), 
      which is stated in the report rather than skipped. Report updated: new §8.1 
      with the full comparison, header/§1/§2/§2.1/§3/§4.1/§5/§6/§8/§9.1/§10 
      cross-corrected; §2's figures kept as measured and re-labelled "pool=15". No 
      code change, no ADR (a measurement settling an existing decision belongs inside 
      it). Tooling note added: the collector's "1242 ceiling messages" is a line 
      count, two per failure. DB returned to documented baseline; 26 QA accounts and 
      18 Redis pins removed.
- [x] `GET /api/v1/partners/me/offers` — 2026-09-27: a partner can now discover the
      `assignment_id` it needs to answer an offer, which closes the last backend gap
      in the partner flow. Filter is assignment `'offered'` + job `'matching'`, the
      same predicate `respond_to_assignment` enforces under the lock, pinned to it by
      a test. No lock and no transaction on this read (ADR-015 amended — it is the
      second polled endpoint). No owner name, phone, `user_id` or pickup coordinates
      in the payload: ADR-017. 8 unit tests, 28/28 live
      (`check_partner_offers.py`, control 9/28). HANDOFF §10 rewritten with the
      shipped shape; §0 and §4 updated.
- [x] MAX_CONCURRENT_JOBS enforced at accept — 2026-09-25: capacity re-checked
      under `partners FOR UPDATE` inside the accept transaction; refusal is
      `409 PARTNER_AT_CAPACITY`, offer stays `'offered'`, re-dispatches once.
      Lock order is now `jobs` → `partners` → `job_assignments`. ADR-009 amended.
- [x] Jobs no longer stranded in 'requested' on Redis timeout — 2026-09-25:
      `find_candidates()` raises `DispatchUnavailableError`; the job lands in
      `no_match_found` with note `"Dispatch unavailable: ..."`. POST /jobs still
      201. ADR-016.
- [x] Connection pool config change — 2026-09-25: `pool_size=3, max_overflow=2`
      (5/worker, was 15), documented as a single-worker MVP constraint in
      README.md "Future Scope — deployment" and load-test report §9.1.
- [x] Accept-vs-cancel race condition fix (dispatch_service.py) — ADR-015 
      resolved
- [x] Cancel-vs-complete race condition fix (job_service.py) — ADR-015
- [x] Dispatch concurrency load test — ceiling documented, 2 new bugs found (both 
      fixed 2026-09-25, above)
- [x] Owner-side job cancellation
- [x] Job lifecycle status transitions (assigned → completed)
- [x] User registration
- [x] Vehicle registration + listing
- [x] Dispatch/matching engine (Redis GEOSEARCH + weighted scoring vs. naive 
      baseline)
- [x] Supabase Auth (JWT, phone OTP) + retrofit onto jobs/partners
- [x] Partner endpoints (register, availability, service linkage)
- [x] Jobs endpoints (create, get with timeline)
- [x] FastAPI skeleton + SQLAlchemy models + deploy to Render
