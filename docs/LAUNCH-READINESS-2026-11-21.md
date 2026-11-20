# Can Sahayak go to real users? (checked 2026-11-21)

**Short answer.** A **small closed pilot** (one area, partners you know and have verified,
cash payments, someone on call watching the admin console) is possible once the
"before a pilot" list below is done. Most of that list is accounts, money and paperwork, not code.
A **public launch** (Play Store listing, ads, strangers) is not possible yet: money handling,
gig-worker levies, push notifications on a real device, and a lawyer's review are still open.

The code side is in good shape: 708 backend unit tests, 171 web and 87 mobile tests pass, and
1004 of 1006 live checks across twenty harnesses pass (the two failures come from a leftover manual
test job, P8). Production readiness is held back by hosting, people and law.

## 1. Before a pilot (must)

| # | Item | Who | Why it blocks |
|---|---|---|---|
| P1 | **Paid, always-on backend on Render** | you | The free instance sleeps; the first request after a quiet spell waits for it to wake (the build notes say "wake /health first"). A stranded driver cannot wait for a cold start |
| P2 | **Paid Supabase plan** | you | The free plan has no daily backups and the project was paused once (2026-11-12). A paused database is a dead app |
| P3 | **Commit, push and deploy this work**; on Render set `API_DOCS_ENABLED=false`, `CORS_ALLOWED_ORIGINS` (already listed), `SUPABASE_SECRET_KEY` | you + me | The live API is still the 2026-11-18 build (`/jobs/{id}/safeguards` answers 404). Migrations 0014 and 0015 are already in the production database and are additive, so the old build keeps working until then |
| P4 | Real support number, email and a **named grievance officer** (R1) | you | The Consumer Protection (E-Commerce) Rules, 2020 require the officer's name, designation and contact on the platform. The page now has the section; the name is a placeholder |
| P5 | **Rebuild the APK and run both roles on a phone** (R5) | you + me | Document upload, tow photos, price approval and the no-signal resend have never run on a device |
| P6 | Enough **verified partners in the pilot area**, with documents approved | ops | With too few partners every request ends in "no partner found" |
| P7 | Someone on the admin console during pilot hours | ops | Reports, alerts, reassignments and stuck jobs need a person. Critical alerts can also go to an ops chat channel: set `STAFF_ALERT_WEBHOOK_URL` (ADR-047) |
| P8 | Finish or cancel the leftover manual test job `1123e9be` (en route since 2026-11-20) | you | It shows on the live board and in analytics |
| P9 | A quick lawyer read of `/terms`, `/privacy`, `/delete-account` (R3) | you | Written from product behaviour, not by counsel |

Pilot workaround for push (G2, still open): partners keep the app open while on duty. Offers
arrive by polling (the 60-second offer window allows for that).

## 2. Before a public launch (must)

| # | Item | Notes |
|---|---|---|
| L1 | **G3: decide who holds the money**, then payouts, invoices and refunds | Refunds today are notes in the Reports inbox |
| L2 | **Gig-worker levies in the price** | Code on Social Security, in force from 21 November 2025: the government may require aggregators to pay 1-2% of annual turnover (capped at 5% of payouts to gig workers). Karnataka's Platform Based Gig Workers Act 2025: a welfare fee of 1-5% of each payout, plus registration. The map defaults to Bengaluru, so Karnataka applies from day one there. Ask a CA |
| L3 | **Push notifications on a real device** (G2): `eas init`, FCM and APNs keys | An offer to a partner whose app is closed is lost |
| L4 | **Play Store listing**: Data safety form (location, phone, photos, crash reports), privacy policy URL, **account deletion URL = `/delete-account`** (built today), content rating | Account deletion is now in-app for both roles and on the web (ADR-045), as Play requires |
| L5 | **DPDP Act and Rules 2025** | Rules notified 13 November 2025; the main duties for a company like Sahayak (notice, consent, security, breach reporting, retention, children's data) apply from about **13 May 2027**. Already in place: export and deletion for both owners and partners, document retention (ADR-038), audited staff views, and (added later on 2026-11-21) an itemised privacy notice, a retention schedule and a breach runbook in `docs/DPDP-READINESS.md`. Still to do: lawyer review, one-year log retention, listing the processors, a breach drill |
| L6 | Masked calling or in-app chat (G7) | Phone numbers are shown after assignment; fine for a pilot, a risk at scale |
| L7 | Hindi and Kannada (G6) | Needs a native reviewer; machine translation in an emergency app is a safety issue |
| L8 | Partner location while navigating in another app | The partner app has no background location (`isAndroidBackgroundLocationEnabled: false`). When a partner switches to Google Maps, the owner's tracking freezes and the start check (ADR-040) treats the fix as stale. Adding it needs a foreground service and a Play background-location declaration |
| L9 | Towing damage liability and partner insurance | Photos (ADR-042) settle disputes; somebody still has to pay. A business and insurance decision |
| L10 | A staging environment | Every test so far ran against production data scoped by phone ranges |

## 3. What was checked in this pass, and fixed

| Finding | Fix |
|---|---|
| **Partners could not delete their account.** Google Play requires in-app deletion for every account an app lets people create | `DELETE /partners/me`, mobile Settings, web console Settings (ADR-045). Live harness `check_partner_deletion` 23/23 |
| **Bug: deleting an owner account deleted the shared login.** One number can hold an owner and a partner profile (ADR-034); owner deletion removed the Supabase login, locking the partner profile out | The login is deleted only when no owner, partner or staff row still uses it. Unit test failed on the old code and passes now; the harness checks both directions live |
| Deleted owners kept their push tokens | Removed with the account |
| No public page explaining deletion (Play asks for a web link) | `/delete-account`, linked from the footer and legal pages |
| No grievance officer on the platform | Section in `/terms` with the 48-hour acknowledgement and one-month resolution |
| `/docs` and `/openapi.json` are public on production | `API_DOCS_ENABLED=false` hides them (set it on Render) |
| No browser security headers on API responses | `nosniff`, `DENY` framing, `no-referrer`, and HSTS behind HTTPS |
| CORS on production | Checked: an unknown origin gets no `Access-Control-Allow-Origin` |

Earlier the same day: price approval, start at the pickup, swap a late partner, tow photos,
off-app payment reports, risk alerts, the staff Reports tab, document-expiry reminders and the
no-signal resend (ADR-039 to ADR-044). See `docs/research/2026-11-21-roadside-app-failures.md`.

## 4. Feature inventory (what a pilot user gets)

Owner: phone sign-in at the moment of sending, vehicles, request with pin and landmark, price
before sending, live matching with a widening search, partner name, rating and ETA, start code,
price-change approval, "find another partner" when late, cash payment confirmation, receipt,
rating, trip sharing, SOS and 112, report a problem (also on cancelled jobs), data export,
account deletion.

Partner: sign-up with documents, staff verification, duty switch, offers with a 60-second
countdown, accept or decline, navigation hand-off, start code at the vehicle, ask the owner for a
higher price, tow photos, completion, earnings, reviews, document-expiry reminders, account
deletion, owner and partner profile on one number.

Staff: analytics, live job board, reassign and cancel, partner verification with document review,
owners and partners management, pricing editor, staff roles and invites, alerts (including the new
partner-risk alerts), Reports inbox, append-only audit log.

## 5. Business notes from the competitor research

See `docs/research/2026-11-21-competitors.md`. In short: roadside help is rare for any one
driver, so a consumer-only app pays to acquire customers again and again. The companies still
standing (ReadyAssist, HONK) sell mainly through insurers, carmakers, fleets and subscriptions.
Plan a fleet or insurer account after G3.
