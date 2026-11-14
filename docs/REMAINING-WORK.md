# Sahayak: Remaining Work

Written 2026-11-14, after the live end-to-end run (commit `d290dc3`).
Sources: `docs/NEXT-STEPS.md` section 9 (the audit) and the defects found in that run.
Completion figures are my estimate from item counts, not an official measure.

**Updated 2026-11-14 (production pass).** Section C is closed except N6. Also done: admin
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

Verified on 2026-11-14 (production pass): backend 596 unit tests, web 145, mobile 27, live harnesses as above.
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
- [ ] G4 Partner documents and equipment upload with staff review. Towing partners can only be enabled by direct database edit today
- [ ] G6 Hindi and Kannada (English only today)
- [ ] G11 Offline-tolerant request queue for poor highway signal
- [ ] R8 Payments hardening, remainder: payment gateway, signature-checked webhooks, integer paise, duplicate and out-of-order tests. Done so far: server-side amount, partner/admin-only confirm, idempotent confirm

### Engineering hygiene

- [ ] E3 Mobile component tests for the owner flow and partner offer flow
- [ ] E4 Automated end-to-end smoke test against staging (done by hand on 2026-11-14, not automated)
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

## F. Not done in the production pass

Each of these is real work, not a quick fix, and none was started:

- Payments back office, gateway, webhooks, integer paise (blocked on G3)
- G4 partner document upload, G6 Hindi and Kannada, G11 offline queue
- E3 mobile component tests, E4 automated staging smoke test (no staging exists)
- Store assets, replacing the stock photographs, social preview image
- Everything in section A

## E. Suggested order

1. R1, R2, R3: no code, long lead time, so start them now. Tell Adarsh about HANDOFF section 19.
2. Create the staging environment and take the first backup (`docs/DEPLOYMENT.md`), then run one restore drill.
3. R5 and G2: one device session covers both, and closes N6.
4. An uptime monitor on `/health` and the web origin, and Sentry for mobile.
5. G4, staff roles, and the pricing editor, each with its own ADR and full regression.
6. G3 once the money decision is made, then the payments back office.
