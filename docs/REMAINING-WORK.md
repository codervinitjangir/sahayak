# Sahayak: Remaining Work

Written 2026-11-14, after the live end-to-end run (commit `d290dc3`).
Sources: `docs/NEXT-STEPS.md` section 9 (the audit) and the defects found in that run.
Completion figures are my estimate from item counts, not an official measure.

**Updated 2026-11-14 (second pass): pricing editor, staff roles and invites, and manual reassign are built (ADR-028, 029, 030).** Earlier the same day (production pass): Section C is closed except N6. Also done: admin
alerts, configurable CORS, a root error boundary, robots and sitemap, the contract docs (E8),
and a deployment, rollback and backup runbook (`docs/DEPLOYMENT.md`). Nothing in section A
has moved: those items need a person. See section F for what this pass did not do.

## Where things stand

| Area | State |
|---|---|
| Core flow (login, request, dispatch, accept, decline, cancel, start code, complete, cash payment, rating) | Done. Passed live on web on 2026-11-14 |
| Admin: analytics, partner verification, live jobs board, owner/partner management, audit log | Done |
| Race and concurrency protections | Done. 17 of 17 live harnesses green, 906 checks (N1 closed) |
| Launch readiness | About 45%. Code hygiene moved; every section A item is still open |

Verified on 2026-11-14 (third pass): backend 598 unit tests, web 145, mobile 39 (12 component); live harnesses not re-run in the third pass. Earlier: live harnesses as above.
Not verified: any physical phone (mobile was run through its web target only).

---

## A. Needs a person, not code

| # | Item | Why it matters |
|---|---|---|
| R1 | Replace placeholder contact details (`support@sahayak.app`, `+91 80 4567 8900`, `sahayak.app` and `api.sahayak.app`) in Terms, Privacy, landing footer, mobile Account, mobile `SafetyActions`, `constants/index.ts` | A stranded driver calling a number that does not ring is worse than no number |
| R2 | Rotate the Google Maps key committed in `mobile/app.json` (still in git history). Restrict the new key to the package name and bundle id | Quota theft |
| R3 | Lawyer review of `/terms` and `/privacy` | Drafted from product behaviour, not by counsel |
| R5 | Device run, both roles, on a physical Android and an iPhone: request, match, start code, pay, complete, rate | Native maps, GPS accuracy, SMS autofill, `tel:` and share sheets were only ever checked in a browser |
| G2 | Finish push notifications: `cd mobile && eas init`, upload FCM and APNs keys in EAS credentials, then a device test | Server and app wiring are done; this step needs your accounts |
| G3 | Decide who holds the money, then get CA sign-off | Blocks payouts, tax invoices, refunds and disputes |
| G5 | Provider contract for a real vehicle registration check | Today: normalise and de-duplicate only |
| G7 | Provider contract for masked calling or in-app chat | Numbers are shown after assignment |
| - | Real UPI ID and support values (part of R1) | Needed before payments go live |

## B. Code still to build

### Admin panel (7 of 8 built)

- [x] Staff accounts and roles (super admin, ops, support, finance) with a one-time invite bound to the invitee's verified number (ADR-029). Web: Staff tab and `/staff/join`. The first super admin is still set by SQL
- [ ] Support inbox and disputes (tied to payments item E)
- [x] Pricing editor: `services.base_price` is a column staff can change, audited (ADR-028). Web: Pricing tab. Service names, codes and categories are still migration-only
- [ ] Payments back office: collections, commission, payout runs, reconciliation
- [x] Alerts: stuck jobs, no-match rate, partners on duty (`GET /admin/alerts`, shown above the Jobs board). Not by zone: zone cover lives in Redis and is not judged. Nobody is notified; staff must have the board open
- [x] Manual reassign on the live jobs board (ADR-030). Staff do not pick the next partner; the scoring does

### Product gaps

- [ ] G3 Partner payouts, tax invoices, refunds and disputes (payments C-E), after the money decision
- [ ] G4 Partner documents and equipment upload with staff review (waiting on three decisions, section E). Towing partners can only be enabled by direct database edit today
- [ ] G6 Hindi and Kannada (English only today)
- [ ] G11 Offline-tolerant request queue for poor highway signal
- [ ] R8 Payments hardening, remainder: payment gateway, signature-checked webhooks, integer paise, duplicate and out-of-order tests. Done so far: server-side amount, partner/admin-only confirm, idempotent confirm

### Engineering hygiene

- [x] E3 Mobile component tests (2026-11-14, third pass): `mobile/tests/components/`, rendered through react-native-web in jsdom. Partner offer: 8 tests (accept, decline, each error code, no invented offer). Owner request: 4 tests (sends only with pin, service and vehicle; idempotency key; failed send). Not native rendering: maps, GPS and gestures still need R5
- [~] E4 `backend/tests/smoke/smoke_e2e.py` drives one job from request to rating over real HTTP with two Supabase test numbers. **Not yet seen passing**: run locally it signed the owner number in and then Supabase refused the partner test number (HTTP 403), so everything after sign-in is unverified. It needs the two test numbers set up as its docstring says
- [~] E5 Runbook written (`docs/DEPLOYMENT.md`: environments, secrets, release checklist, rollback). CORS is now configuration (`CORS_ALLOWED_ORIGINS`) and `backend/.dockerignore` keeps `.env` out of the image. No staging environment exists yet: that needs accounts
- [~] E6 `scripts/restore_db.sh` added (refuses to target the live database). No backup schedule and no drill has been run
- [~] E7 Admin alerts endpoint only. No uptime monitor, log alerting or status page
- [x] E8 `HANDOFF-frontend-contract.md` section 19 and a changes table in `docs/FRONTEND-GUIDE.md`. **Adarsh has not been told**: that is yours to do

### Mobile and web launch items

- [ ] Store assets: screenshots, iOS privacy-nutrition labels, Android data-safety form, listing copy, EAS build profiles and signing
- [~] Crash and error reporting: web has a root error boundary that can POST crashes to `VITE_ERROR_REPORT_URL` (unset by default). Mobile has none. Sentry and analytics need an account
- [ ] Replace stock photographs in the web landing collage (they show people who are not Sahayak partners)
- [~] SEO basics: `robots.txt` and `sitemap.xml` added with the placeholder domain (R1). No social preview image
- [ ] Uptime monitoring on web (the error boundary is done, see above)
- [ ] Re-check `npx expo install --check` before each store build

---

## C. Found in the 2026-11-14 live run

| # | Item | State |
|---|---|---|
| N1 | `check_dispatch_capacity` 48 of 49 | **Not a leak.** A push delivery (ADR-026) runs after commit and borrows a pooled connection; the check sometimes read the pool while one was in flight. Reproduced, then green on every run once the harness waits for deliveries (`push_service.drain()`, also called on shutdown). ADR-026 amended. Open risk noted there: deliveries are unbounded and share a 3+2 pool |
| N2 | Harnesses collide with manual testing | **Fixed.** `+91900000090x` is reserved for manual testing. `check_user_registration` moved to 88x, `check_dispatch_flow` to 89x. Three other overlaps between harnesses removed (vehicle 84x, job race 861, admin partners 862) |
| N3 | Cancelled-job page on web | **Fixed.** No Call button on a cancelled or completed job; the box says the request was cancelled. Type-checked, not looked at in a browser with a real cancelled job |
| N4 | Partner sign-up asks for phone and OTP again | **Fixed.** A signed-in person starts at "About you". Unit test added |
| N5 | Admin console on a 340px screen | **Fixed.** Checked in a browser at 340px: no sideways page scroll on any of the seven tabs. Checked with empty tables (no backend running), not with rows |
| N6 | Mobile request flow, partner screens, push | Open. Needs a device (R5) |
| N7 | Mobile login screen shows raw API text | **Fixed.** `friendlyMessage()` in `mobile/src/services/identity.ts`, 4 tests |
| N8 | Geolocation denied: no fallback for partners | **Decided and built.** Still no fallback coordinate. A blocked browser now gets instructions to allow location for the site, or to use the mobile app |

Also found in this pass: two jobs are sitting in a live status in the shared database
(`1cadc5c7`, `fb907e38`). The new alerts endpoint flags them as stuck. They look like leftovers
from the manual run; I did not delete them.

## D. Fixed on 2026-11-14 (for the record)

Final price now capped (`400 PRICE_FINAL_OUT_OF_RANGE`) with a guarded form field; partner dashboard no longer claims location is shared without a GPS fix; owner gets no partner name, phone or id until the partner accepts (ADR-017); partner code boxes fit narrow screens and accept autofill; `/admin/:tab` requires an admin role; mobile client normalises its API base URL to `/api/v1`.

Evidence: `docs/evidence/mentor-report.html`, `docs/evidence/screenshots/`, `docs/evidence/harness-results.txt`.

## E. Not started, and what each one is waiting for

Recorded 2026-11-14 at the end of the second pass. None of these has any code yet.

| Item | What it is waiting for | First step when picked up |
|---|---|---|
| G4 Partner document upload and staff review | Three decisions from you: (1) OK to create a private storage bucket in the Supabase project; (2) which documents are required per category (licence, ID, vehicle RC, tow equipment proof); (3) how long identity documents are kept and who may view them | An ADR, then signed upload URLs from the backend, a review queue beside partner verification, and expiry reminders. Auth and privacy: full regression |
| G6 Hindi and Kannada | A native speaker to review each language. Machine-only translation of emergency instructions is not acceptable | Move every string in web and mobile into translation files (English first, no behaviour change), then add the two languages |
| G11 Offline-tolerant request queue | A physical device: it cannot be verified in a browser | Mobile only. Queue the request locally with its idempotency key and send when signal returns; the backend already de-duplicates on that key |
| Payments back office, gateway, webhooks, integer paise | G3: who holds the money, and CA sign-off | Blocked until then |
| Store assets, real photographs for the landing collage, social preview image | Your material | No code |
| Everything in section A | A person | See section A |

## F. Loose ends from the second pass

- **Smoke test not yet seen passing.** `backend/tests/smoke/smoke_e2e.py` signed the owner test number in, then Supabase refused the partner number `+919000000902` with HTTP 403. Check that both numbers are listed under Authentication > Phone > Test phone numbers with the OTP the guide gives, that the partner account still exists and is verified (a harness run deleted the hand-made one earlier, see N2), then run it again.
- **Adarsh has not been told** about `HANDOFF-frontend-contract.md` sections 19 to 19.4. Two changes can break a client that assumes otherwise: an owner's job can go from assigned back to matching, and a partner with only an offer no longer receives owner details from `GET /jobs/{id}`.
- **Staff roles now gate writes.** Changing prices and recording a refund need finance or super admin; partner verification and owner suspension need ops or super admin. The one linked admin today is a super admin. The unlinked `ops` row has no sign-in.
- **Two stale live jobs** in the shared database (`1cadc5c7`, `fb907e38`) are still there and show as stuck on the alerts line. Cancel them from the Jobs board or leave them; I did not touch them.
- [x] **Push deliveries bounded** (third pass): one at a time, backlog capped at 500, overflow logged as `push_dropped` (ADR-026 amendment 2).
- **Committed in the third pass** along with E3: the `@expo/ngrok` dev dependency (it shared `mobile/package.json`). Still not committed: `mobile/expo-qr.png`, `.claude/`. Nothing is pushed.

## G. Next steps, in order

1. Tell Adarsh about HANDOFF section 19 to 19.4.
2. R1, R2, R3: real contact details and UPI ID, rotate the Maps key, lawyer review. No code, long lead time.
3. Fix the two smoke-test numbers and get `smoke_e2e.py` passing once.
4. Create the staging environment, take the first backup and run one restore drill (`docs/DEPLOYMENT.md`).
5. R5 and G2 in one device session; that also closes N6.
6. An uptime monitor on `/health` and the web origin, and crash reporting for mobile.
7. Answer the three G4 questions in section E, then build G4.
8. G6 once a reviewer is available, then G11 on a device.
9. G3 when the money decision is made, then the payments back office.
