# Sahayak: Remaining Work

Written 2026-11-14, after the live end-to-end run (commit `d290dc3`).
Sources: `docs/NEXT-STEPS.md` section 9 (the audit) and the defects found in that run.
Completion figures are my estimate from item counts, not an official measure.

## Where things stand

| Area | State |
|---|---|
| Core flow (login, request, dispatch, accept, decline, cancel, start code, complete, cash payment, rating) | Done. Passed live on web on 2026-11-14 |
| Admin: analytics, partner verification, live jobs board, owner/partner management, audit log | Done |
| Race and concurrency protections | Done. 9 of 10 live harnesses green (see item N1) |
| Launch readiness | About 35-40%. 12 of 35 audit items done, 2 partial |

Verified on 2026-11-14: backend 528 unit tests, web 136, mobile 23, live harnesses as above.
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

### Admin panel (3 of 8 built)

- [ ] Staff accounts and roles (support, ops, finance) with an invite flow. An admin is linked to a login by editing the database today
- [ ] Support inbox and disputes (tied to payments item E)
- [ ] Catalogue and pricing editor (`base_price`, services, categories)
- [ ] Payments back office: collections, commission, payout runs, reconciliation
- [ ] Alerts: no-match rate, partners on duty by zone, stuck jobs
- [ ] Manual reassign on the live jobs board

### Product gaps

- [ ] G3 Partner payouts, tax invoices, refunds and disputes (payments C-E), after the money decision
- [ ] G4 Partner documents and equipment upload with staff review. Towing partners can only be enabled by direct database edit today
- [ ] G6 Hindi and Kannada (English only today)
- [ ] G11 Offline-tolerant request queue for poor highway signal
- [ ] R8 Payments hardening, remainder: payment gateway, signature-checked webhooks, integer paise, duplicate and out-of-order tests. Done so far: server-side amount, partner/admin-only confirm, idempotent confirm

### Engineering hygiene

- [ ] E3 Mobile component tests for the owner flow and partner offer flow
- [ ] E4 Automated end-to-end smoke test against staging (done by hand on 2026-11-14, not automated)
- [ ] E5 Staging and production environments, secrets management, rollback plan
- [ ] E6 Backups and a restore drill (the project database was paused once already)
- [ ] E7 Metrics, alerts and a status page
- [ ] E8 Update `HANDOFF-frontend-contract.md` and `docs/FRONTEND-GUIDE.md` for the redesign, the new endpoints and the new error code `PRICE_FINAL_OUT_OF_RANGE`, and tell Adarsh

### Mobile and web launch items

- [ ] Store assets: screenshots, iOS privacy-nutrition labels, Android data-safety form, listing copy, EAS build profiles and signing
- [ ] Crash and error reporting (Sentry or similar) and analytics, mobile and web
- [ ] Replace stock photographs in the web landing collage (they show people who are not Sahayak partners)
- [ ] SEO basics: sitemap, robots, social preview image
- [ ] Uptime monitoring and error-boundary reporting on web
- [ ] Re-check `npx expo install --check` before each store build

---

## C. Found in the 2026-11-14 live run (not yet fixed)

| # | Item | Detail |
|---|---|---|
| N1 | `check_dispatch_capacity` fails 1 of 49 | "no connection was left checked out: 1 still checked out". Identical on three reruns and on the original code, so it predates today's changes. May be a real pool leak or a harness artifact. Needs its own investigation |
| N2 | Harnesses collide with manual testing | Harnesses reuse test numbers `+919000000901` and `+919000000902`. A harness run deleted the hand-made partner and orphaned the owner profile (the profile pointed at a recreated Supabase user, so `/auth/me` returned 403 and re-registration said the phone was taken). Give the harnesses their own numbers |
| N3 | Cancelled-job page on web | Still shows a Call button and an empty bordered box |
| N4 | Partner sign-up asks for phone and OTP again | The wizard repeats step 1 even when the person is already signed in |
| N5 | Admin console on a 340px screen | Scrolls sideways |
| N6 | Mobile request flow, partner screens, push | Not run in this session. Need real GPS and a device (covered by R5) |
| N7 | Mobile login screen shows raw API text | A failed call showed a bare "Not Found". Map API errors to plain messages |
| N8 | Geolocation denied: no fallback for partners | By design there is no fallback coordinate, and the dashboard now says so. Decide what a partner should do when the browser blocks location |

## D. Fixed on 2026-11-14 (for the record)

Final price now capped (`400 PRICE_FINAL_OUT_OF_RANGE`) with a guarded form field; partner dashboard no longer claims location is shared without a GPS fix; owner gets no partner name, phone or id until the partner accepts (ADR-017); partner code boxes fit narrow screens and accept autofill; `/admin/:tab` requires an admin role; mobile client normalises its API base URL to `/api/v1`.

Evidence: `docs/evidence/mentor-report.html`, `docs/evidence/screenshots/`, `docs/evidence/harness-results.txt`.

## E. Suggested order

1. N2 and N1: they decide whether regression results can be trusted.
2. E8: Adarsh needs the contract changes before he touches the clients again.
3. N3, N4, N7: small UI fixes.
4. R1, R2, R3: no code, long lead time, so start them now.
5. R5 and G2: one device session covers both.
6. E5, E6, E7: staging, backups and monitoring before any real user.
7. G4 and the remaining admin items, then G3 once the money decision is made.
