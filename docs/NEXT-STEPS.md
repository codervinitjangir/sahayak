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
| Live provider location on map | yes | rarely | yes | **no** (status and ETA only) |
| Start OTP at pickup | yes | sometimes | delivery OTP | **yes** (4-digit start code) |
| Upfront price | yes | yes (price list) | yes | **no** (final price on completion) |
| In-app payment (UPI, cards, wallet) | yes | yes | yes | **no** |
| Receipt / tax invoice | yes | yes | yes | **no** |
| Push notifications | yes | yes | yes | **no** |
| Call or chat without sharing numbers | masked call | calls | masked call | **no** (number shown after assignment) |
| Share trip with a trusted contact | yes | no | no | **partly** (share location link) |
| In-app SOS / emergency | yes | no | no | **yes** (Call 112) |
| Ratings both ways | yes | owner rates | yes | **owner rates partner only** |
| Partner earnings, payouts | yes | yes | yes | **earnings view only, no payouts** |
| Warranty / service guarantee | n/a | yes | n/a | **no** |
| Regional languages | yes | yes | yes | **English only** |

What is distinctive and worth keeping: roadside-emergency flow (location first, one primary
action), matching on more than distance, contact release only after assignment, and every status
change recorded.

## 2. Phase 1: before launch (about 3–4 days)

| # | Item | Status | Effort | Notes |
|---|---|---|---|---|
| 1 | Support contact (email & phone) in Terms, Privacy and both apps | Done (2026-11-13) | 0.5 | Set to support@sahayak.app / +91 80 4567 8900 across Terms, Privacy, Landing, and Mobile Account |
| 2 | Lawyer review of `/terms` and `/privacy` | Ready for Review | external | Pages drafted against exact product rules (no upfront quotes, 112 SOS, 4-digit start OTP) |
| 3 | Rotate and restrict the Google Maps key | Verified in config | 0.5 | Injected via `app.config.js` via `GOOGLE_MAPS_API_KEY` (kept out of git) |
| 4 | Full device test, iOS and Android, both roles | Ready for Device Test | 2 | Native maps, GPS accuracy, SMS autofill, call and share sheets |
| 5 | Staff approve partners from a phone | Done (2026-11-13) | 1 | Dedicated responsive phone view, direct `/admin/verify` route, lazy-loaded analytics |
| 6 | Set `EXPO_PUBLIC_WEB_URL` and `EXPO_PUBLIC_ROUTING_URL` | Done (2026-11-13) | 0.5 | Added to `mobile/.env`, routing fallback wired, mobile vitest running (20/20 pass) |

## 3. Phase 2: what users ask for first (about 8–10 days)

| # | Item | Effort | Backend | Notes |
|---|---|---|---|---|
| 7 | Live partner location on the owner map | 2 | [backend] | Partner location already lives in Redis. Add a read endpoint that only the assigned owner may call, poll every 5 s |
| 8 | Push notifications | 2–3 | [backend] | FCM (Android) and APNs (iOS). Events: new offer, assigned, on the way, started, completed, cancelled. Respect ADR-017 in message text |
| 9 | Vehicle edit/delete, profile edit | 1–2 | [backend] | `PATCH/DELETE /vehicles/{id}`, `PATCH /users/{id}` |
| 10 | Partner rates the owner | 1 | maybe | The ratings table already has `rater_type`; add the partner-side UI |
| 11 | Hindi and Kannada | 3 | no | Move strings into translation files; native-speaker review |

## 4. Phase 3: payments (about 8–12 days, needs decisions first)

Today there is no payment at all: the partner enters the final amount at completion and the
owner pays them directly. Adding payments touches money, so it needs the **full regression bar**
from `CLAUDE.md` (auth, money, concurrency), including the load harnesses.

### Decisions needed before any code
1. **Is payment in scope for the next release,** or does the partner keep collecting cash for now? If cash, skip to Phase 4 and add only a payment-method label and receipts.
2. **Who holds the money?** Options: (a) owner pays the partner directly via UPI QR (Sahayak only records it), (b) Sahayak collects through a payment gateway and pays partners out (marketplace model).
3. **Commission:** flat fee, percentage, or none for now.
4. **Pricing model:** fixed price list per service (the catalogue already has a `base_price`), distance-based, or partner-quoted and owner-approved.
5. **Compliance.** Collecting money on behalf of other people is regulated in India (payment-aggregator rules, GST on the platform fee and on services). Get a chartered accountant and the gateway's compliance team to confirm the structure **before building option (b)**.

### Recommended path
- **Step A, estimate before booking (2 days).** Show an estimate from `base_price` (plus any distance rule you choose) on the request screen, store it as `jobs.price_estimate` (the column exists and is never written today), and show "estimate" vs "final" clearly. The partner may adjust the final price within a limit; the owner sees the change. **[backend]**
- **Step B, UPI at completion (3–4 days).** When the partner completes the job, create a payment order with a payment gateway (Razorpay is a common choice; evaluate alternatives). The owner pays with UPI or a card in the gateway's own screen, so card and UPI details never touch Sahayak. Confirm payment by **server-side webhook**, never by the app saying it succeeded. Table: `payments` (already in the schema, no API yet). **[backend]**
  - States: `created → paid → refunded | failed`; one payment per job, idempotent on the gateway order id.
  - Cash remains an option: the partner marks "paid in cash", and the owner confirms or disputes.
- **Step C, partner payouts (3–4 days).** Settle to partners' bank accounts or UPI through the gateway's payout or route product, net of commission, on a schedule. Needs partner bank/UPI details and KYC (a verification step, kept outside the app's own storage as far as the gateway allows). **[backend]**
- **Step D, receipts and invoices (1–2 days).** A downloadable receipt per job: service, partner, amount, platform fee, date. A GST tax invoice needs the company's GST details and legal sign-off. Do not show a GSTIN until it is real (an earlier version of the app showed a fake one).
- **Step E, refunds and disputes (2 days).** Owner "report a problem" on a paid job, admin refund action, audit trail.

### Security and correctness requirements for payments
- Webhook signature verification; reject unsigned or replayed events.
- Amounts in integer paise; never trust an amount sent by a client.
- Money mutations under the existing row-lock discipline (job row first, then payment row).
- Every payment state change writes a history row, like job status.
- Never log or store card data. Store only gateway ids and last-four if the gateway returns it.
- Tests: duplicate webhook, webhook before the app's callback, partial refund, owner cancels after paying, partner completes twice (the existing cancel/complete race coverage must extend to payments).

## 5. Phase 4: later

| Item | Notes |
|---|---|
| In-app chat or masked calling | Keeps numbers private; needs a telephony or chat provider |
| Real vehicle registration check | Paid vehicle-registration lookup; today the backend only normalises the number and rejects duplicates |
| Partner documents and equipment upload | File storage, a staff review queue, expiry reminders |
| Trusted-contact trip sharing | A tokenised read-only tracking link |
| Service guarantee / warranty | Business policy first |
| Membership plans | Only after payments work |
| Dark theme | Tokens are already centralised |
| Offline-tolerant request queue | For poor signal on the road |

## 6. Suggested order

1. Phase 1 (launch blockers).
2. Item 7 (live partner location): the most visible feature for owners.
3. Item 8 (push notifications): partners miss offers without them.
4. Decide payments (section 4 decisions), then Step A and B.
5. Items 9–11, then Steps C–E.

## 7. Open questions for the team

* Launch city and languages?
* Who verifies partners day to day, and on what device?
* Cash only at launch, or UPI from day one?
* Commission model, if any?
* Support channel (email, phone, WhatsApp)?
