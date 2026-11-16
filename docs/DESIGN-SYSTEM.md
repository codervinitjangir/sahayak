# Sahayak Design System & Product Decisions

Status: adopted 2026-11-13. Applies to `web/` and `mobile/`. Supersedes the
Blinkit-derived mobile palette (`#F8CB46` yellow / `#0C831F` green, Poppins) and the
"warm paper" landing palette (Fraunces, `#F6F1E6`).

Why this exists: the mobile app reproduced another company's brand (name, palette,
component names, layout idioms) and the landing page reused another company's copy.
That cannot ship. Every token below is original to Sahayak and shared by both clients.

## 1. Research summary (what we learned, what we did with it)

| Source | Finding | Decision |
|---|---|---|
| Agero, *Best practices for roadside digital intake* | Tell people up front what they'll need; finish in one session; confirm each action and say what happens next; "no surprises"; sub-2s loads | Request flow is 3 steps max; every state names its next step; skeletons not spinners |
| Algoworks, *Reimagining AAA's digital roadside experience* | Pain points: login friction, geolocation failures, unclear confirmation, no ETA visibility | Location first, manual address fallback, explicit "Request received" screen, milestone tracker |
| Liveops, *Dispatch to resolution* | Customers follow milestones: placed → assigned → en route → on scene → complete | `JobTimeline` maps 1:1 to backend statuses |
| Daily Dot / FOX6 hands-on tests (Honk, Urgent.ly vs AAA) | Pay-per-use apps win on live tracking and ETA; reliability and partner-awareness are the complaints | Tracking screen is the hero of the product; partner states are honest ("not on shift") |
| Uber Design, *Partner-centric experience*; Rapido captain earnings rebuild; Namma Yatri decision-time study | Partner UI is glanceable, one-handed, decision in seconds; earnings is a first-class screen | Offer card = one decision, big Accept/Decline; earnings tab; no clutter on the offer |
| WCAG 2.2 SC 2.5.8 / 1.4.3, Apple HIG, Material | Min 24px target (AA), 44pt iOS / 48dp Android; 4.5:1 text contrast | Every control ≥ 48px tall on mobile, ≥ 44px on web; all text pairs verified ≥ 4.5:1 |

Not adopted on purpose: membership plans, coupons, tips, tax invoices, payment-method
screens, upfront price quotes. The backend has none of them, and the project's Rule A
forbids UI for data that does not exist. They are in the backlog (section 7).

## 2. Brand

* **Name / voice:** Sahayak ("helper"). Calm, direct, specific. No exclamation marks in
  emergencies. Say what happens next.
* **Mark:** a map pin with a plus-cross cut out of it (help, at a place). Defined once as
  SVG: `web/public/favicon.svg`, `mobile/src/components/brand/LogoMark.tsx`.
* **Personality:** dependable utility, not a consumer-grocery sugar rush. Neutral surfaces,
  one confident teal, red only when something is urgent.

## 3. Tokens (single source for both platforms)

### Colour

| Token | Hex | Use |
|---|---|---|
| `brand-50` | `#F0FDFA` | tinted backgrounds |
| `brand-100` | `#CCFBF1` | selected rows, chips |
| `brand-600` | `#0D9488` | hover on dark |
| `brand-700` | `#0F766E` | **primary action**, links, active tab |
| `brand-800` | `#115E59` | pressed |
| `brand-900` | `#134E4A` | dark hero surfaces |
| `ink` | `#0F172A` | primary text (15.4:1 on white) |
| `ink-soft` | `#475569` | secondary text (7.6:1) |
| `ink-muted` | `#64748B` | captions only (4.8:1) |
| `line` | `#E2E8F0` | borders, dividers |
| `canvas` | `#F6F8FA` | app background |
| `surface` | `#FFFFFF` | cards, sheets |
| `emergency-600` | `#DC2626` | SOS / destructive primary |
| `emergency-700` | `#B91C1C` | danger text (6.5:1) |
| `success-700` | `#15803D` | completed, verified |
| `warning-700` | `#B45309` | matching, pending |
| `info-700` | `#0369A1` | in progress, informational |

Status is never colour-only: every status chip carries an icon and a word.

### Typography

Inter everywhere (web via Google Fonts, mobile via `@expo-google-fonts/inter`). Poppins
and Fraunces are removed. Numerals are tabular for ETAs, prices and OTP.

| Role | Size / weight |
|---|---|
| Display | 32 / 700, tight tracking |
| Title | 22 / 700 |
| Heading | 18 / 600 |
| Body | 16 / 400 (never below 16 on mobile body) |
| Label | 14 / 600 |
| Caption | 12 / 500 |

### Space, radius, elevation

* 4-pt grid: 4 8 12 16 20 24 32 40 48.
* Radius: controls 12, cards 16, sheets 24 (top), pills 999.
* Elevation: two levels only. `card` = 1px border + no shadow; `float` = soft shadow for
  sheets and map controls. No gradients on surfaces; one subtle gradient allowed on the
  brand hero.

### Motion

150–250 ms ease-out for state changes; no looping decoration except the "searching" pulse
on the matching screen. Honour `prefers-reduced-motion` / `AccessibilityInfo`.

## 4. Component inventory

Both platforms expose the same vocabulary: `Button` (primary / secondary / danger / ghost,
sizes md / lg), `Card`, `Badge`, `StatusChip`, `Input`, `Field`, `Sheet` / `Modal`,
`Skeleton`, `EmptyState`, `ErrorState`, `Timeline`, `StarRating`, `Toast`, `ListRow`,
`SectionHeader`, `LogoMark`. Web keeps them in `web/src/components/ui`, mobile in
`mobile/src/components/ui`.

## 5. Information architecture

**Owner (mobile tabs):** Home · Services · Activity · Account (notifications from the header bell).
**Owner (web):** Home · Request help · History (top nav; bottom bar under 640 px).
**Partner (mobile):** Home (shift toggle, offers, active job, standing) · Earnings · Account.
**Partner (web console):** Dashboard · Offers · Preferences · Verification · Settings.
**Admin (web):** Overview · Dispatch · Matching · Partners.

## 6. Features: shipped vs. rejected, with reasons

Shipped now (all backed by existing endpoints or purely client-side):

1. **Emergency-first request**: location → service → vehicle → confirm. (`POST /jobs`)
2. **"What happened?" helper**: plain-language symptoms mapped to catalogue services.
3. **Live job tracker** with milestone timeline and polling. (`GET /jobs/{id}`)
4. **Safety strip**: one-tap call to **112** (India's single emergency number) and
   **Share my location** (native share sheet with a maps link). No backend needed.
5. **Contact release after assignment** (ADR-017): call button appears only when the
   backend releases the partner's number.
6. **Cancel with reason, rate after completion, job history, notifications.**
7. **Vehicles**: list and add (backend has no edit/delete; UI doesn't pretend).
8. **Partner shift toggle, offers with relative age (no countdown), accept/decline with
   reason, start-code job start, complete with final price, earnings, stats, services,
   verification status.**
9. **Navigate** (partner): deep-link to the maps app for the pickup. Client-side.
10. **Admin analytics + partner verification queue.**

Rejected (would require invented data): coupons, tipping, tax invoices, saved payment
methods, "for you" carousels, fake ETAs, partner counts, review quotes.

## 7. Backlog (needs backend, not for this release)

Payments/UPI and receipts · upfront price estimates · live partner location on the owner
map · masked calling or in-app chat · push notifications (FCM/APNs) · share-trip link
with a trusted contact · vehicle edit/delete · profile edit · partner document upload ·
Hindi and Kannada localisation · dark theme · membership plans.

## 8. Accessibility checklist (release gate)

* Contrast ≥ 4.5:1 text, ≥ 3:1 UI boundaries.
* Touch targets ≥ 48 dp mobile, ≥ 44 px web.
* Status = icon + text + colour.
* Visible focus ring (`2px brand-700`, offset 2) on web; `accessibilityRole` / `Label` on
  every pressable in mobile.
* Text scales with system font size; layouts wrap instead of clipping.
* `prefers-reduced-motion` respected.

## 2026-11-17 visual refresh (supersedes the colour/type/radius values above)

User-directed restyle after a monochrome car-rental reference. Product, features and
copy rules are unchanged; only the look moved:

* **Primary is ink `#111111`** (was teal). `brand-*` tokens now map to the grey ramp
  `#F1F2F4 / #E4E6EA / #D4D7DC / #3A3D44 / #24262B / #111111 / #000000 / #141518`.
  Canvas `#EEF0F3`. Red stays reserved for SOS/destructive.
* **Font: Urbanist** (regular + medium lead), Inter kept as fallback on web.
* **Radius:** controls/buttons are pills, cards 24, sheets 32. Cards are borderless white on the grey canvas.
* **Screen template (mobile):** `components/ui/ScreenHero` — dark hero with rounded bottom
  corners, centred title, greeting, optional frosted `HeroPill`. Every tab shell uses it.
  `TabBar` is a floating frosted pill of round icon buttons, active = black circle;
  pad scroll content by `TAB_BAR_SPACE`.
