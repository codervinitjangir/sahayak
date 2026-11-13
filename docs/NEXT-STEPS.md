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
| 1 | Support contact (email & phone) in Terms, Privacy and both apps | [x] Done (2026-11-13) | 0.5 | Set to support@sahayak.app / +91 80 4567 8900 across Terms, Privacy, Landing, and Mobile Account |
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
| 10 | Public Trip Live Sharing (`/track/:jobId`) | [x] Done (2026-11-13) | [backend] | `GET /api/v1/jobs/{id}/public-tracking`, unauthenticated `/track/:jobId` page for family with live GPS and 112 SOS |
| 11 | Extended Searching & Auto-Retry with Radius Escalation | [ ] Ready to Implement | [backend] | 10 km &rarr; 20 km &rarr; 35 km expansion; 10-minute active search window with live timer & instant cancel |
| 12 | Push notifications (FCM & APNs) | [ ] Next Up | [backend] | Events: new offer, assigned, on the way, started, completed, cancelled. Respect ADR-017 |
| 13 | Hindi and Kannada localization | [ ] Planned | no | Move strings into translation files; native-speaker review |

## 4. Phase 3: payments & settlements (progress update)

Today the payment lifecycle is wired with full regression coverage:

| # | Step | Status | Notes |
|---|---|---|---|
| A | Upfront price estimate before booking | [x] Done (2026-11-13) | `base_price` added to catalogue services, upfront estimates shown on service selection cards |
| B | In-App UPI & Cash Payment at completion | [x] Done (2026-11-13) | `POST /payments`, `GET /payments/job/{id}`, `POST /payments/{id}/confirm`. Supports NPCI UPI universal intent (`upi://pay?...`), dynamic QR codes (GPay/PhonePe/Paytm), and cash confirmation |
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
7. [ ] Item 11: Extended Searching & Radius Escalation (10 km &rarr; 20 km &rarr; 35 km) (Ready to Implement).
8. [ ] Item 12: Push notifications via FCM & APNs (Next Up).
9. [ ] Payments Step C & D: Partner payouts & tax invoices.

## 8. Open questions for the team

* Initial pilot rollout city (e.g. Bangalore / NCR) and language priority?
* Payment gateway provider selection for partner payouts (Razorpay Route vs Cashfree)?
* Telephony provider for virtual masked calling (Exotel vs Twilio)?

