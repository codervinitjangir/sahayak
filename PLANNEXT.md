# Sahayak: what is left before production

Written 2026-11-14, after `main` reached `fdd162d`. Each item says **who** can do it:
**You** (needs an account, a decision, money or a person) or **Code** (can be built here).
Detail and history live in `docs/NEXT-STEPS.md` §9 and `docs/adr/ADR.md`.

---

## 1. Blockers — the app must not go live without these

| # | Item | Who | Why it blocks |
|---|---|---|---|
| B1 | Replace the revoked Supabase secret key in `backend/.env` (and in the hosting env) | You | Account deletion can't remove logins, and 7 live test suites can't run |
| B2 | Rerun the 7 blocked live suites (`dispatch_race`, `notifications`, `partner_offers`, `ratings`, `vehicle_registration`, `auth_flow`, `user_registration`) | Code, after B1 | Dispatch, auth and payment changes from 13–14 Nov aren't fully proven yet |
| B3 | Real support phone, email and UPI ID. Today `+91 80 4567 8900`, `support@sahayak.app` and `sahayak.dispatch@upi` are placeholders | You | A stranded driver calling a dead number; payments going to an account you don't own |
| B4 | Set `SHARE_LINK_SECRET` in production | You | Without it, rotating the Supabase key breaks every share link already sent |
| B5 | Rotate and restrict the Google Maps key (the old one is in git history) | You | Quota theft |
| B6 | Lawyer review of `/terms` and `/privacy`, including account deletion and data retention (ADR-025) | You | Drafted from product behaviour, not by counsel |
| B7 | Full test on a real Android phone and iPhone, both roles: request → match → start code → pay → complete → rate | You (Code fixes what breaks) | Maps, GPS, SMS autofill, call and share sheets were only checked in a browser |
| B8 | Production environment: hosting for the backend (Render) and web, managed Redis, production Supabase project, environment variables, HTTPS domain | You + Code | Today everything runs on a dev machine and a dev Supabase project |
| B9 | Database backups and a tested restore | You | The project database was paused once already |
| B10 | Generate the UPI QR code in the app instead of sending the payment link to `api.qrserver.com` | Code | Payment details go to a third-party site |

## 2. Needed soon after launch

### Product
| # | Item | Who |
|---|---|---|
| P1 | Finish push on the phone: install `expo-notifications`, `eas init`, upload FCM/APNs keys, register the token after sign-in (server side is done, ADR-026) | You (accounts) + Code |
| P2 | Partner payouts, commission and settlement (payments C) | You decide how money is held + CA sign-off, then Code |
| P3 | Receipts and GST invoices (payments D) | You (GST details) + Code |
| P4 | Refunds and disputes: owner "report a problem", admin resolution queue (payments E) | You decide policy, then Code |
| P5 | Real payment gateway (Razorpay/Cashfree) with signed webhooks; today the partner confirms by hand (ADR-022) | You (merchant account) + Code |
| P6 | Partner document and equipment upload with staff review (tow partners can't be enabled without it) | Code (needs a storage bucket) |
| P7 | Masked calling or in-app chat so phone numbers stay private | You (Exotel/Twilio contract) + Code |
| P8 | Real vehicle registration check (VAHAN/Parivahan) | You (API access) + Code |
| P9 | Hindi and Kannada | Code + a native-speaker review |
| P10 | Partner account deletion (waits on P2, since payouts may still be owed) | Code |
| P11 | Remove or wire up the mobile "Notification preferences" switches (they save nothing today) | Code |
| P12 | Offline request queue for poor highway signal | Code |

### Admin panel
| # | Item | Who |
|---|---|---|
| A1 | Reassign a stuck job to a different partner | Code |
| A2 | Staff roles (ops / support / finance) and an admin invite flow; today every admin can do everything and is added by editing the database | Code |
| A3 | Catalogue and pricing editor (services, `base_price`) | Code |
| A4 | Alerts: stuck jobs, high no-match rate, partners on duty by area | Code |
| A5 | Support inbox and disputes (with P4) | Code, after policy |
| A6 | Payments back office: collections, commission, payout runs, reconciliation (with P2) | Code, after P2 |

## 3. Engineering and operations

| # | Item | Who |
|---|---|---|
| E1 | Check the new CI runs on GitHub pass (first run was the 14 Nov push) | You look, Code fixes |
| E2 | Staging environment with an end-to-end smoke test (sign in with a test number, request, accept, complete) | Code + You (accounts) |
| E3 | Crash and error reporting (Sentry or similar) on web, mobile and backend | You (account) + Code |
| E4 | Metrics, alerts and uptime monitoring / status page | You + Code |
| E5 | Load test against production-sized infrastructure (measured ceiling today: about 2 job creations/s per worker, 15 shared DB connections) | Code |
| E6 | Secrets management and a written rollback plan | You + Code |
| E7 | Mobile component tests for the owner request flow and partner offer flow | Code |
| E8 | Tell Adarsh about the contract changes (`HANDOFF-frontend-contract.md` §17.4–17.8) and update `docs/FRONTEND-GUIDE.md` | You + Code |

## 4. Store and launch

| # | Item | Who |
|---|---|---|
| S1 | EAS build profiles, signing keys, app icons and splash checked | You + Code |
| S2 | Store listings: screenshots, description, iOS privacy labels, Android data-safety form | You |
| S3 | Replace the stock photos of people on the landing page | You |
| S4 | SEO basics: sitemap, robots.txt, social preview image | Code |
| S5 | Decide the pilot city and the first language | You |
| S6 | Recruit and verify the first partners in that city | You |

---

## Suggested order

1. **This week:** B1, B3, B4, B5 (all yours), then B2 and B10 (code).
2. **Next:** B8 + B9 (production setup), E1–E3, then B7 (real phones).
3. **Before inviting real users:** B6 (lawyer), P1 (push), A1–A3.
4. **After the pilot starts:** P2–P5 (money), P6, A4–A6, the rest.
