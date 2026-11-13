# Sahayak: next steps

Status as of 2026-11-13. Written after the UI redesign (see
[REDESIGN-2026-11-13.md](REDESIGN-2026-11-13.md)). Effort is rough working days for one
developer. Items marked **[backend]** need new endpoints or tables; the UI alone cannot ship them.

## 1. Where Sahayak sits among similar apps

Sahayak is an on-demand marketplace like ride-hailing (Uber, Ola) with the service model of a
doorstep car-care app (GoMechanic, DriveFixIt and similar) and the "request, track, done" speed
people expect from quick-commerce (Blinkit). The comparison below is from general knowledge of
how those categories work, **not from a fresh teardown of each app**. Check the specific apps
before quoting any of it in a report.

| Capability | Ride-hailing pattern | Doorstep car-care pattern | Quick-commerce pattern | Sahayak today |
|---|---|---|---|---|
| Request in a few taps with GPS pin | yes | booking form | yes | **yes** |
| Matching to a nearby provider | yes | scheduled slot | nearest store | **yes** (weighted: distance, rating, acceptance) |
| Live provider location on map | yes | rarely | yes | **yes** (live GPS via Redis GEO, polled every 5s) |
| Start OTP at pickup | yes | sometimes | delivery OTP | **yes** (4-digit start code) |
| Upfront price | yes | yes (price list) | yes | **yes** (catalogue base_price upfront estimates) |
| In-app payment (UPI, cards, wallet) | yes | yes | yes | **yes** (UPI QR/intent & Cash settlement flow) |
| Receipt / tax invoice | yes | yes | yes | **partly** (settlement receipt breakdown) |
| Push notifications | yes | yes | yes | **no** |
| Call or chat without sharing numbers | masked call | calls | masked call | **no** (number shown after assignment) |
| Share trip with a trusted contact | yes | no | no | **yes** (public `/track/:jobId` live sharing) |
| In-app SOS / emergency | yes | no | no | **yes** (Call 112 & +91 80 4567 8900) |
| Ratings both ways | yes | owner rates | yes | **yes** (two-way owner & partner ratings) |
| Vehicle management | yes | yes | n/a | **yes** (full CRUD with active job protection) |
| Partner earnings, payouts | yes | yes | yes | **earnings view only, no payouts** |
| Warranty / service guarantee | n/a | yes | n/a | **no** |
| Regional languages | yes | yes | yes | **English only** |

What is distinctive and worth keeping: roadside-emergency flow (location first, one primary
action), matching on more than distance, contact release only after assignment, and every status
change recorded.

## 2. Phase 1: before launch (about 3–4 days)

| # | Item | Status | Effort | Notes |
|---|---|---|---|---|
| 1 | Support contact (email & phone) in Terms, Privacy and both apps | [~] Wired, values are placeholders | 0.5 | support@sahayak.app / +91 80 4567 8900 are placeholders everywhere; see R1 |
| 2 | Lawyer review of `/terms` and `/privacy` | [x] Ready for Review | external | Pages drafted against exact product rules (no upfront quotes, 112 SOS, 4-digit start OTP) |
| 3 | Rotate and restrict the Google Maps key | [x] Verified in config | 0.5 | Injected via `app.config.js` via `GOOGLE_MAPS_API_KEY` (kept out of git) |
| 4 | Full device test, iOS and Android, both roles | [x] Ready for Device Test | 2 | Native maps, GPS accuracy, SMS autofill, call and share sheets |
| 5 | Staff approve partners from a phone | [x] Done (2026-11-13) | 1 | Dedicated responsive phone view, direct `/admin/verify` route, lazy-loaded analytics |
| 6 | Set `EXPO_PUBLIC_WEB_URL` and `EXPO_PUBLIC_ROUTING_URL` | [x] Done (2026-11-13) | 0.5 | Added to `mobile/.env`, routing fallback wired, mobile vitest running (20/20 pass) |

## 3. Phase 2: live core enhancements & safety (completed & in progress)

| # | Item | Status | Backend | Notes |
|---|---|---|---|---|
| 7 | Live partner location on owner map | [x] Done (2026-11-13) | [backend] | `GET /api/v1/jobs/{id}/partner-location`, reads Redis GEO `sahayak:partner_locations`, polls every 5s |
| 8 | Vehicle edit/delete & active job guard | [x] Done (2026-11-13) | [backend] | `PATCH/DELETE /api/v1/vehicles/{id}`, refuses deletion with 409 `VEHICLE_HAS_ACTIVE_JOB` |
| 9 | Partner rates the owner (Two-Way Ratings) | [x] Done (2026-11-13) | [backend] | Interactive 1–5 star rating submitted by partner on completion via `PartnerJobDoneScreen.tsx` |
| 10 | Public Trip Live Sharing (`/track/:jobId?t=`) | [x] Done, hardened 2026-11-14 | [backend] | `GET /api/v1/jobs/{id}/public-tracking?t=<share_token>`; token is owner-only (ADR-017 amendment) |
| 11 | Extended Searching & Auto-Retry with Radius Escalation | [x] Done (2026-11-14, ADR-023) | [backend] | 10 km &rarr; 20 km &rarr; 35 km expansion; 10-minute active search window with live timer & instant cancel |
| 12 | Push notifications (FCM & APNs) | [~] Server done 2026-11-14 (ADR-026); app wiring needs EAS | [backend] | Events: new offer, assigned, on the way, started, completed, cancelled. Respect ADR-017 |
| 13 | Hindi and Kannada localization | [ ] Planned | no | Move strings into translation files; native-speaker review |

## 4. Phase 3: payments & settlements (progress update)

Today the payment lifecycle is wired with full regression coverage:

| # | Step | Status | Notes |
|---|---|---|---|
| A | Upfront price estimate before booking | [x] Done (2026-11-13) | `base_price` added to catalogue services, upfront estimates shown on service selection cards |
| B | In-App UPI & Cash Payment at completion | [x] Done, fixed 2026-11-14 | `POST /payments`, `GET /payments/job/{id}`, `POST /payments/{id}/confirm`. Amount is server-side; only the assigned partner or an admin confirms (ADR-022). The UPI ID `sahayak.dispatch@upi` is a placeholder |
| C | Partner payouts & settlement schedule | [ ] Planned | Settle to partners' bank accounts or UPI net of platform commission |
| D | Downloadable receipts & GST tax invoices | [ ] Planned | Detailed invoice breakdown with service fee, partner details, and payment ref |
| E | Refunds & dispute management | [ ] Planned | Owner "report a problem" on paid jobs with admin resolution queue |

---

## 5. Feature Spotlight: Extended Searching & Radius Escalation (Dynamic 10-Min Matching)

### Why this is critical for commercial roadside assistance
When an emergency happens (e.g. at 11:30 PM on an outer ring road or highway), an immediate `no_match_found` after 3 seconds panics stranded drivers. A nearby mechanic might be:
1. Finishing an active tyre change 2 minutes away and about to become free.
2. 15–20 km away (outside the standard 10 km circle), but eager to accept an emergency job.
3. Just logging back onto the partner app.

### Architecture & Behavior

```
[User Dispatches Request]
          │
          ▼
 [Phase 1: Local Search (0 – 2 min)]
   • Search radius: 10 km
   • Status card: "Looking for nearby partners…" (animated radar pulse)
          │
          ▼ (No immediate match)
 [Phase 2: Expanded Radius (2 – 5 min)]
   • Auto-expand radius: 20 km
   • Status card: "Expanding search to 20 km… mechanics frequently become free in a few minutes."
   • Live timer: "Searching for 2m 40s · We will keep searching for up to 10 minutes"
          │
          ▼ (Still searching)
 [Phase 3: Regional / Highway Sweep (5 – 10 min)]
   • Max emergency radius: 35 km (covers mobile vans and flatbed tow trucks)
   • Status card: "Searching wider region (up to 35 km) · Emergency dispatch active"
          │
          ├──────────────────────────────┐
          ▼ (Partner accepts!)           ▼ (10 min elapsed & no partner)
   [Partner Assigned & En Route]    [Graceful No Match Found]
   "Partner confirmed and moving    "We could not find an available partner.
    towards your pickup point."      One-tap call to 24/7 Human Dispatch (+91 80 4567 8900)."
```

### Safety & Control Rules
- **Cancel Anytime With Zero Penalty**: The owner retains an always-accessible, prominent `Cancel Request` button throughout the searching window.
- **Continuous Emergency Fallback**: Dedicated one-tap buttons for `Call 112` and `Sahayak 24/7 Helpline (+91 80 4567 8900)` remain visible at all times.
- **Backend Re-Dispatch**: `POST /api/v1/jobs/{job_id}/retry-search` or automated polling sweep avoids duplicating jobs while dynamically widening candidate search.


## 6. Phase 4: later roadmap

| Item | Status | Notes |
|---|---|---|
| In-app chat or masked calling | Planned | Keeps phone numbers private; needs virtual telephony provider (Exotel/Twilio) |
| Real vehicle registration check | Planned | Parivahan / VAHAN API integration for live plate verification |
| Partner documents and equipment upload | Planned | Cloud storage, staff document review queue, licence/insurance expiry reminders |
| Trusted-contact trip sharing | [x] Done (2026-11-13) | Shipped at `/track/:jobId` and `GET /api/v1/jobs/{id}/public-tracking` with 112 SOS |
| Smart QR Windshield Tag generator | Planned | Dynamic QR generator in admin console for vehicle tag scans |
| Service guarantee / warranty | Planned | Platform warranty policy definition |
| Membership & RSA AMC subscription plans | Planned | Annual roadside assistance packages |
| Dark theme | Planned | Tokenized CSS variable palette |
| Offline-tolerant request queue | Planned | Local SQLite / Async storage queue for poor highway cell reception |

## 7. Suggested order

1. [x] Phase 1: Launch readiness & legal/support setup (Completed).
2. [x] Item 7: Live partner location tracking via Redis GEO (Completed).
3. [x] Item 8: Vehicle full CRUD with active job protection (Completed).
4. [x] Item 9: Two-way ratings (Completed).
5. [x] Item 10: Public trip live sharing (Completed).
6. [x] Payments Step A & B: Upfront estimates and in-app UPI QR / Cash settlements (Completed).
7. [x] Item 11: Extended Searching & Radius Escalation (10 km &rarr; 20 km &rarr; 35 km) (Done 2026-11-14, ADR-023).
8. [ ] Item 12: Push notifications via FCM & APNs (Next Up).
9. [ ] Payments Step C & D: Partner payouts & tax invoices.

## 8. Open questions for the team

* Initial pilot rollout city (e.g. Bangalore / NCR) and language priority?
* Payment gateway provider selection for partner payouts (Razorpay Route vs Cashfree)?
* Telephony provider for virtual masked calling (Exotel vs Twilio)?


---

## 9. Remaining-work audit (2026-11-13, end of day; status updated 2026-11-14)

**2026-11-14 update.** The review of the 2026-11-13 commits found and fixed five defects
(owner could self-confirm payments, client-set amount, admins locked out of payments, public
tracking leaked pickup coordinates to offered partners, vehicle delete 500'd on any vehicle with
history). Full regression then passed: backend 472 unit + 828 live across 16 harnesses (new:
`check_payments_and_sharing.py`), web 130, mobile 20. Branch `fix/payments-sharing-review`.
The 12-week timeline no longer gates work; section 9.8 is the build order.

Checked against the code, not only against the tables above. Baseline: web `tsc` clean, web
134-class suite 130/130 passing, mobile `tsc` clean, mobile 20/20, `check:rule-a` passing on both.
**Not re-run today:** the backend unit and integration suites. The payments, partner-location,
vehicle CRUD and public-tracking work above touches money, auth and concurrency, so the full
regression bar in `CLAUDE.md` applies before anyone calls it done.

### 9.1 Must fix before real users

| # | Item | Why |
|---|---|---|
| R1 | [ ] **Replace the placeholder contact details.** `support@sahayak.app`, `+91 80 4567 8900` and the `sahayak.app` / `api.sahayak.app` domains appear in Terms, Privacy, the landing footer, mobile Account, mobile `SafetyActions` and `constants/index.ts` | Nothing in the repo shows these are real. A stranded driver who calls a number that does not ring is worse than no number |
| R2 | [ ] **Rotate the Google Maps key** that was committed in `mobile/app.json` (still in git history) | Quota theft. Restrict the new key to the package name / bundle id |
| R3 | [ ] **Lawyer review** of `/terms` and `/privacy` | Drafted from product behaviour, not by counsel |
| R4 | [x] (2026-11-14: 472 unit + 828 live, all green) **Full regression for backend work added today** (payments, partner-location, vehicle PATCH/DELETE, public tracking, `base_price`, start code, idempotency) | Money, auth and concurrency paths; migrations `0002`, `0003`, `008` are untracked and must be applied and recorded |
| R5 | [ ] **Device run, both roles**: request → match → start code → pay → complete → rate, on a physical Android and iPhone | Native maps, GPS accuracy, SMS autofill, `tel:` and share sheets were only ever checked in a browser |
| R6 | [x] (2026-11-14, migrations included) **Commit.** Large parts of this work are uncommitted in `Sahayak/.git` (web, mobile, backend, docs) | One bad command loses it. Commit in reviewable chunks |
| R7 | [x] (2026-11-14: owner-only token, accepted partner only, status-only after the job ends, 404 after 24 h, 60/min rate limit) **Public tracking link privacy review** (`/track/:jobId`, unauthenticated) | Confirm it exposes no owner phone/name/exact address beyond what ADR-017 allows, uses an unguessable token (not the raw job id), and stops working after completion |
| R8 | [~] (server amount, partner/admin-only confirm, idempotent confirm done 2026-11-14, ADR-022; no gateway yet) **Payments hardening**: server-side confirmation only, signature-checked webhooks if a gateway is added, integer paise, idempotent confirm, duplicate and out-of-order tests | `POST /payments/{id}/confirm` as built relies on who calls it; decide whether the partner or owner confirms and prevent either from forging the other |

### 9.2 Product gaps

| # | Item | Notes |
|---|---|---|
| G1 | [x] Extended search with radius escalation (item 11) | Done 2026-11-14: `POST /jobs/{id}/retry-search`, owner app polls every 15 s for 10 min (ADR-023) |
| G2 | [~] Push notifications (item 12) | Server done 2026-11-14 (ADR-026): token registry + after-commit Expo sender, live-tested with the Expo call stubbed. **To finish (needs you):** `cd mobile && npx expo install expo-notifications expo-device`, `eas init` (adds `extra.eas.projectId`), upload FCM key / APNs key in EAS credentials, then after sign-in call `Notifications.getExpoPushTokenAsync({projectId})` and `devicesApi.register(token, Platform.OS)`; call `devicesApi.unregister` in logout |
| G3 | Partner payouts, tax invoices, refunds and disputes (payments C–E) | Needs the money-holding decision and CA sign-off first |
| G4 | Partner documents and equipment upload + staff review | Towing partners cannot be enabled except by direct database edit today |
| G5 | Real vehicle registration check | Today: normalise and de-duplicate only |
| G6 | Hindi and Kannada | English only |
| G7 | Masked calling or in-app chat | Numbers are shown after assignment |
| G8 | [x] Profile edit (owner name/email, partner name) | Done 2026-11-14: `PATCH /users/me`, `PATCH /partners/me`; web + mobile |
| G9 | [x] Partner notifications screen on mobile | Done 2026-11-14: bell + shared NotificationsModal on PartnerHomeScreen |
| G10 | [x] Account deletion and data export (owners) | Done 2026-11-14 (ADR-025): anonymising delete + JSON export, web + mobile. Partner deletion waits on payouts (G3) |
| G11 | Offline-tolerant request queue | Poor signal on highways |

### 9.3 Company side: admin panel

Exists: analytics (Overview, Dispatch, Matching), partner list with approve / reject, and a phone
view for verification (`/admin/verify`). Endpoints: `GET /admin/analytics/*`, `GET /admin/partners`,
`GET /admin/partners/{id}`, `PATCH /admin/partners/{id}/verify`.

Missing, in suggested order:

1. [x] **Live jobs board** with filters and staff cancel (2026-11-14, ADR-024). Manual *reassign* not built.
2. [x] **Owner and partner management**: owner search, suspend/reinstate (2026-11-14). Partner suspend already via verify.
3. [x] **Audit log**: append-only, same-transaction (2026-11-14, ADR-024).
4. **Staff accounts and roles** (support, ops, finance) and an admin invite flow. Today an admin is
   linked to a login by editing the database.
5. **Support inbox / disputes**, tied to payments item E.
6. **Catalogue and pricing editor** (`base_price`, services, categories).
7. **Payments back office**: collections, commission, payout runs, reconciliation.
8. **Alerts**: no-match rate, partners on duty by zone, stuck jobs.

### 9.4 Mobile specifics

* Partner registration exists in the app; **staff verification is not on the partner's phone**, by design.
* Partner map screen shows pickup and the partner's own marker; a straight connector is drawn unless
  `EXPO_PUBLIC_ROUTING_URL` points at a routing service you operate.
* Expo SDK 58 / React Native 0.88. Dependencies that were unused were removed; re-check
  `npx expo install --check` before each store build.
* No store assets beyond the icon set: screenshots, privacy-nutrition labels (iOS), data-safety form
  (Android), store listing copy, EAS build profiles and signing.
* No crash and error reporting (Sentry or similar) and no analytics.

### 9.5 Web specifics

* The restored editorial landing page uses stock photographs in its collage. They show people who
  are not Sahayak partners; replace them with real photos or illustrations before launch.
* No SEO basics beyond `<title>`/meta: sitemap, robots, social preview image.
* No error boundary reporting and no uptime monitoring.
* [x] Rate-limit on the public `/track/:jobId` endpoint (60/min per IP, 2026-11-14).

### 9.6 Engineering hygiene

| # | Item |
|---|---|
| E1 | [x] CI (2026-11-14): web + mobile `tsc`, `vitest` (incl. brand-hygiene and route-inventory), `check:rule-a`; backend ruff + 513 unit tests; runs on main, develop, feat/**, fix/**. Live harnesses stay manual |
| E2 | Backend: re-export `backend-routes.json` fixtures for **both** clients after the new routes (per project memory) and keep the route-inventory tests green |
| E3 | Mobile tests only cover pure logic. Add component tests for the owner flow and partner offer flow (React Native Testing Library) |
| E4 | End-to-end smoke test against a staging backend (sign in with a test number, request, accept, complete) |
| E5 | Staging and production environments, secrets management, and a rollback plan |
| E6 | Backups and restore drill (the project database was paused once already) |
| E7 | Observability: structured logs exist; add metrics, alerts and a status page |
| E8 | Update `HANDOFF-frontend-contract.md` and `docs/FRONTEND-GUIDE.md` for the redesign and the new endpoints, and tell Adarsh |

### 9.7 Claims in this document not verified by me

Superseded 2026-11-14: live partner location, vehicle delete guard, partner-rates-owner, public
tracking and payments are now covered by unit tests and live harnesses (R4). Three of them had
defects, fixed in `fix/payments-sharing-review`. Still unverified on a physical device (R5).

### 9.8 Build order (timeline lifted 2026-11-14)

Code work, in order:
1. [x] R7 remainder: public link stops after the job ends, plus a rate limit.
2. [x] G1 radius escalation.
3. [x] Admin items 1–3: live jobs board with staff cancel, owner/partner management, audit log.
4. [x] G8 profile edit and G10 account deletion / data export.
5. [x] G9 partner notifications screen on mobile.
6. [~] G2 push notifications: server done; app wiring needs an EAS project (see G2 row).
7. [x] E1 CI.

Needs a person, not code: R1 (real contact values and UPI ID), R2 (rotate Maps key), R3 (lawyer),
R5 (device run), G3 (money-holding decision and CA sign-off), G5/G7 (provider contracts).
