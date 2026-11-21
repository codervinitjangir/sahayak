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

Verified on 2026-11-20: backend 661 unit tests, web 162, mobile 76; live harnesses: see section H.
Physical device: the owner and partner flows ran on one Android phone (2026-11-15 to 11-18). No iPhone yet. The 2026-11-20 additions (document upload, crash reporting) need a new APK build and have not run on a phone.

---

## A. Needs a person, not code

| # | Item | Why it matters |
|---|---|---|
| R1 | Replace placeholder contact details (`support@sahayak.app`, `+91 92505 43490 (real, set 2026-11-15)`, `sahayak.app` and `api.sahayak.app`) in Terms, Privacy, landing footer, mobile Account, mobile `SafetyActions`, `constants/index.ts` | A stranded driver calling a number that does not ring is worse than no number |
| R2 | Rotate the Google Maps key committed in `mobile/app.json` (still in git history). Restrict the new key to the package name and bundle id | Quota theft |
| R3 | Lawyer review of `/terms` and `/privacy` | Drafted from product behaviour, not by counsel |
| R5 | Device run, both roles, on a physical Android and an iPhone: request, match, start code, pay, complete, rate | Native maps, GPS accuracy, SMS autofill, `tel:` and share sheets were only ever checked in a browser |
| G2 | Finish push notifications: `cd mobile && eas init`, upload FCM and APNs keys in EAS credentials, then a device test | Server and app wiring are done; this step needs your accounts |
| G3 | Decide who holds the money, then get CA sign-off | Blocks payouts, tax invoices, refunds and disputes |
| G5 | Provider contract for a real vehicle registration check | Today: normalise and de-duplicate only |
| G7 | Provider contract for masked calling or in-app chat | Numbers are shown after assignment |
| - | Real UPI ID and support values (part of R1) | Needed before payments go live |

## B. Code still to build

### Admin panel (8 of 8 built)

- [x] Staff accounts and roles (super admin, ops, support, finance) with a one-time invite bound to the invitee's verified number (ADR-029). Web: Staff tab and `/staff/join`. The first super admin is still set by SQL
- [x] Support inbox for disputes (2026-11-21): web Reports tab, with resolve, record a refund, or reject. Price history and audited tow photos are shown. Moving money waits on G3
- [x] Pricing editor: `services.base_price` is a column staff can change, audited (ADR-028). Web: Pricing tab. Service names, codes and categories are still migration-only
- [ ] Payments back office: collections, commission, payout runs, reconciliation
- [x] Alerts: stuck jobs, no-match rate, partners on duty (`GET /admin/alerts`, shown above the Jobs board). Not by zone: zone cover lives in Redis and is not judged. Nobody is notified; staff must have the board open
- [x] Manual reassign on the live jobs board (ADR-030). Staff do not pick the next partner; the scoring does

### Product gaps

- [ ] G3 Partner payouts, tax invoices, refunds and disputes (payments C-E), after the money decision
- [x] G4 Partner documents with staff review (2026-11-20, ADR-038): private bucket, licence + photo ID (+ tow RC and equipment photo for towing), verify blocked until approved, tow equipment verified from the documents, 90-day retention after rejection. Expiry reminders added 2026-11-21 (ADR-038 amendment). An expired document still does not un-verify the partner
- [ ] G6 Hindi and Kannada (English only today)
- [~] G11 Poor highway signal: resend for three minutes with the same key (2026-11-21, ADR-044). There is deliberately no queue that persists after the app closes. Not tried on a device
- [ ] R8 Payments hardening, remainder: payment gateway, signature-checked webhooks, integer paise, duplicate and out-of-order tests. Done so far: server-side amount, partner/admin-only confirm, idempotent confirm

### Engineering hygiene

- [x] E3 Mobile component tests (2026-11-14, third pass): `mobile/tests/components/`, rendered through react-native-web in jsdom. Partner offer: 8 tests (accept, decline, each error code, no invented offer). Owner request: 4 tests (sends only with pin, service and vehicle; idempotency key; failed send). Not native rendering: maps, GPS and gestures still need R5
- [~] E4 `backend/tests/smoke/smoke_e2e.py` drives one job from request to rating over real HTTP with two Supabase test numbers. **Not yet seen passing**: run locally it signed the owner number in and then Supabase refused the partner test number (HTTP 403), so everything after sign-in is unverified. It needs the two test numbers set up as its docstring says
- [~] E5 Runbook written (`docs/DEPLOYMENT.md`: environments, secrets, release checklist, rollback). CORS is now configuration (`CORS_ALLOWED_ORIGINS`) and `backend/.dockerignore` keeps `.env` out of the image. No staging environment exists yet: that needs accounts
- [~] E6 `scripts/restore_db.sh` added (refuses to target the live database). No backup schedule and no drill has been run
- [~] E7 Admin alerts endpoint, plus `.github/workflows/uptime.yml` checking `/health` (database included) every 10 min (ADR-037; set repo variable `WEB_URL` to check the web origin too). It starts once pushed. No log alerting or status page
- [x] E8 `HANDOFF-frontend-contract.md` section 19 and a changes table in `docs/FRONTEND-GUIDE.md`. **Adarsh has not been told**: that is yours to do

### Mobile and web launch items

- [ ] Store assets: screenshots, iOS privacy-nutrition labels, Android data-safety form, listing copy, EAS build profiles and signing
- [x] Crash reporting (2026-11-20, ADR-037): web and mobile post to `POST /api/v1/client-errors`, logged as `client_error` on the server; no vendor needed. Sentry and analytics remain optional
- [ ] Replace stock photographs in the web landing collage (they show people who are not Sahayak partners)
- [~] SEO basics: `robots.txt` and `sitemap.xml` added with the placeholder domain (R1). No social preview image
- [~] Uptime monitoring: the workflow is written (E7); set `WEB_URL` once the web is deployed
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
| G6 Hindi and Kannada | A native speaker to review each language. Machine-only translation of emergency instructions is not acceptable | Move every string in web and mobile into translation files (English first, no behaviour change), then add the two languages |
| G11 Offline-tolerant request queue | A physical device: it cannot be verified in a browser | Mobile only. Queue the request locally with its idempotency key and send when signal returns; the backend already de-duplicates on that key |
| Payments back office, gateway, webhooks, integer paise | G3: who holds the money, and CA sign-off | Blocked until then |
| Store assets, real photographs for the landing collage, social preview image | Your material | No code |
| Everything in section A | A person | See section A |

## F. Loose ends from the second pass

- **Smoke test not yet seen passing.** Re-checked 2026-11-20: both accounts exist, are linked, and the partner is verified; `+919000000901` signs in with OTP 123456 but `+919000000902` gets `otp_expired`, because its test OTP is `654321`, not 123456 (verified signing in, 2026-11-20). The smoke test used one OTP for both numbers; it now takes `SMOKE_PARTNER_OTP=654321`. Run it against staging once one exists. Earlier: `backend/tests/smoke/smoke_e2e.py` signed the owner test number in, then Supabase refused the partner number `+919000000902` with HTTP 403. Check that both numbers are listed under Authentication > Phone > Test phone numbers with the OTP the guide gives, that the partner account still exists and is verified (a harness run deleted the hand-made one earlier, see N2), then run it again.
- **Adarsh has not been told** about `HANDOFF-frontend-contract.md` sections 19 to 19.4. Two changes can break a client that assumes otherwise: an owner's job can go from assigned back to matching, and a partner with only an offer no longer receives owner details from `GET /jobs/{id}`.
- **Staff roles now gate writes.** Changing prices and recording a refund need finance or super admin; partner verification and owner suspension need ops or super admin. The one linked admin today is a super admin. The unlinked `ops` row has no sign-in.
- [x] **Two stale live jobs** (`1cadc5c7`, `fb907e38`, stuck in `requested` since 2026-09-15) cancelled on 2026-11-20 through the new worker path (ADR-036). Jobs stuck in `requested` now cancel themselves after 5 min; ended `no_match_found` searches leave the live board after an hour.
- [x] **Push deliveries bounded** (third pass): one at a time, backlog capped at 500, overflow logged as `push_dropped` (ADR-026 amendment 2).
- **Committed in the third pass** along with E3: the `@expo/ngrok` dev dependency (it shared `mobile/package.json`). Still not committed: `mobile/expo-qr.png`, `.claude/`. Nothing is pushed.

- **Timeline order under lock waits (found 2026-11-17).** `job_status_history.changed_at` defaults to `now()`, the transaction start, so a cancel that waited on the job lock behind an accept sorts before it (`matching → cancelled → assigned`, final state correct). `check_dispatch_race` fails its two timeline checks in some runs on old and new code alike. **Fixed 2026-11-17:** `create_status_history_row` now writes `changed_at = clock_timestamp()` (time of the write), no migration; unit test `test_history_rows_are_stamped_at_write_time_not_transaction_start` failed on the old code.
- [x] **Dispatch worker (ADR-032, 2026-11-17):** offers time out after 60 s and searches keep widening without the owner's app. Regression 619 unit, 18 of 18 harnesses (933 checks).

## G. Next steps, in order

1. Tell Adarsh about HANDOFF sections 19 to 23.
2. R1, R2, R3: real contact details and UPI ID, rotate the Maps key, lawyer review. No code, long lead time.
3. Fix the two smoke-test numbers and get `smoke_e2e.py` passing once.
4. Create the staging environment, take the first backup and run one restore drill (`docs/DEPLOYMENT.md`).
5. R5 and G2 in one device session; that also closes N6.
6. An uptime monitor on `/health` and the web origin, and crash reporting for mobile.
7. Rebuild the APK (document upload needs the new image-picker native module) and test G4 on a phone.
8. G6 once a reviewer is available, then G11 on a device.
9. G3 when the money decision is made, then the payments back office.

## H. 2026-11-20 pass: abandoned jobs, crash reporting, uptime, partner documents

Built: ADR-036 (worker cancels jobs stuck in `requested`; old `no_match_found` leaves the live board), ADR-037 (`POST /client-errors` from both apps; `uptime.yml`), ADR-038 (G4 partner documents, private bucket `partner-documents`, migration `0013` applied to production). HANDOFF section 23.

Regression: backend 661 unit, web 162, mobile 76, all passing. Live: 971 of 973 checks across nineteen harnesses (new: `check_partner_documents` 33). The two failures are in `check_admin_analytics` (98/100): it counts live work across the whole database, and a real job (`1123e9be`, partner `+919000000902`, en route since 13:15 UTC on 11-20) was live during the run. Not a code regression. Re-run once that job is finished. `check_notifications` first refused to start because of the two `job_expired` rows from cancelling the stale jobs (removed). Then it failed its event-vocabulary check until `job_expired` was added to it. 79/79 after that.

Still open from this pass:
- **Rebuild the APK.** Document upload uses `expo-image-picker` (a new native module) and crash reporting is new JS. The APK from 2026-11-18 has neither. No phone was connected on 11-20.
- Smoke test: partner OTP is `654321` (`SMOKE_PARTNER_OTP`); not yet run, since it should target staging, not production.
- **Push to GitHub** so `uptime.yml` and Render pick up this work. Nothing is committed yet.
- Render must have `SUPABASE_SECRET_KEY` set, or document upload answers 503.
- R2: maps no longer use a key (ADR-031), but the old key in git history should still be deleted in Google Cloud.


## I. 2026-11-21 pass: trust and safety (what goes wrong with apps like this)

Research: `docs/research/2026-11-21-roadside-app-failures.md`. It covers failure modes F1 to F10, where each step goes (phone OTP, start code, extra charges, photos) and the edge cases. Reddit blocks automated reading, so none of its threads are quoted.

Built: ADR-039 (price changes above estimate + 10% need the owner's approval before completion), ADR-040 (the start code is refused more than 1 km from the pickup), ADR-041 (the owner can ask for another partner once the first is overdue), ADR-042 (pickup and drop photos for towing), ADR-043 (an "asked to pay outside the app" report on cancelled jobs, plus four partner-risk alerts), ADR-044 (no signal: resend for three minutes), the ADR-038 amendment (document expiry reminders), and the admin **Reports** tab (support inbox for disputes). Migration `0014` was applied to production. HANDOFF section 24.

Regression: backend 698 unit, web 167, mobile 85, all passing; ruff clean. Live, re-run after the change: job_lifecycle 88, payments_and_sharing 29, ratings 44, notifications 79, job_cancellation 54, partner_documents 33, admin_ops 72, all passing. The rest passed earlier in the pass: token_rules 30, job_race 43, dispatch_race 69, partner_offers 28, dispatch_flow 50, dispatch_capacity 49, vehicle_registration 54, admin_partners 20, dispatch_worker 28. admin_analytics is still 98/100 because of the same real job (`1123e9be`, partner_en_route since 11-20 13:15 UTC); finish or cancel it and re-run. Not run: auth_flow and user_registration (they need uvicorn:8010).

Still open from this pass:
- **Rebuild the APK** and try the tow photos, the resend banner and price approval on a phone. None has been run on a device.
- Web has no owner "Report a problem" screen (mobile does). Refunds stay a note only until G3.
- The 1 km start radius, the 10% margin and the overdue rule are first guesses. Check them against real jobs after launch.


## J. 2026-11-21 second pass: launch readiness and competitors

Asked: "can real users use it, are there apps like this, why did some shut down". Answers:
`docs/LAUNCH-READINESS-2026-11-21.md` (verdict: a closed pilot after list P1-P9, not a public
launch yet) and `docs/research/2026-11-21-competitors.md` (ReadyAssist, GoMechanic, Urban Company,
HONK, Urgently, Wrench; shutdowns Autto.in, Taskbob, Doormint, Homejoy; lessons).

Built: ADR-045 (partner account deletion in app, web and API; the **shared-login bug** fixed, where
deleting an owner deleted the login a partner profile still used), ADR-046 (security headers; `API_DOCS_ENABLED`),
the public `/delete-account` page, the grievance-officer section in Terms, push tokens removed on owner
deletion. Migration `0015` applied to production. HANDOFF section 25.

Regression after this pass: backend 708 unit, web 171, mobile 87, ruff clean. Live: all twenty
harnesses run (auth_flow 77 and user_registration 36 with uvicorn up), 1004 of 1006 checks pass; the
two failures are admin_analytics counting the real job `1123e9be` again (section H). New harness:
`check_partner_deletion` 23.

New items for section A (need a person):
- **P1/P2: paid Render instance (no sleeping) and paid Supabase plan (backups, no pausing).** Pilot blockers.
- Set `API_DOCS_ENABLED=false` on Render.
- Appoint and name a grievance officer (part of R1); the Terms show a placeholder.
- Gig-worker levies (Code on Social Security 1-2% of turnover; Karnataka welfare fee 1-5% of payouts): ask a CA and price them in.

New product gaps (code, later): partner background location while navigating in another app (needs a
Play declaration); fleet or insurer accounts (B2B channel, after G3); DPDP consent notice in the Rules'
format and a breach runbook (duties apply from about May 2027).

## K. 2026-11-21 third pass: the small code items from PLAN section 2.3A

Built: partner data export (`GET /partners/me/export`, ADR-045 amendment; mobile and web "Download
my data"); web owner "Report a problem" (parity with mobile, ADR-043 endpoints); staff alert
webhook (ADR-047, `STAFF_ALERT_WEBHOOK_URL`, `STAFF_ALERT_REPEAT_MIN`); itemised privacy notice
(`PRIVACY_ITEMS`), "Your rights", Terms 18+; `docs/DPDP-READINESS.md` (retention schedule, breach
runbook, to-do before May 2027). HANDOFF section 26. No migration.

Regression after this pass: backend 715 unit, web 177, mobile 88, ruff clean, both typechecks clean.
Live: all twenty harnesses, 1013 of 1015 checks pass (auth_flow 77 and user_registration 36 with
uvicorn up; check_partner_deletion now 32). The two failures are again admin_analytics counting the
real job `1123e9be` (section H).

New items for section A (need a person):
- Create a Slack, Google Chat or Discord incoming webhook for the ops channel and set
  `STAFF_ALERT_WEBHOOK_URL` on Render; leave it blank and nothing is sent.
- Lawyer review of the new privacy table and `docs/DPDP-READINESS.md` (part of R3).

## L. 2026-11-21 fourth pass: the large code items from PLAN section 2.3A

Built (HANDOFF section 27):
- Zone supply gaps on the staff board (ADR-048).
- Partner location during an accepted job through an Android foreground service (ADR-049; **not yet run on a phone**).
- Scheduled jobs in two-hour India-time slots (ADR-050, alembic/0016).
- Sahayak Care memberships granted by staff, with call-outs counted from jobs and **no billing** (ADR-051, alembic/0017).
- Translation groundwork with i18next, English only, covering the booking flow and Care (ADR-052).

Both migrations are already applied to production (Supabase MCP). Apply them to staging with `backend/tools/apply_migration.py` before the next staging test. The privacy table now lists the booked time, location during a job while another app is open, and the Care membership.

Regression after this pass:
- Backend: 746 unit, ruff clean.
- Clients: web 190, mobile 107, both typechecks clean, web build clean.
- Live: all twenty-two harnesses, 1065 of 1067 checks. New are `check_scheduled_jobs` (26, `+91900000083x`) and `check_care` (26, `+91900000079x`); auth_flow 77 and user_registration 36 ran with uvicorn up.
- The two failures are again admin_analytics counting the real job `1123e9be` (section H).
- `check_notifications` needed `scheduled_job_starting` in its list of events that other harnesses write. This was a harness expectation, not a code bug.

New items for section A (need a person):
- Rebuild the APK (`expo-task-manager` is native) and test job location on a real phone, including one with an aggressive battery saver. Then fill the Play Console foreground-service declaration (`FOREGROUND_SERVICE_LOCATION`) with a short video.
- Decide what a covered job costs once billing exists: zero, a cap, or call-out free with parts paid (ADR-051, waits on G3).
- Hindi copy from a translator, then add `hi.json`, device-language detection and a plural check on Android (ADR-052).

