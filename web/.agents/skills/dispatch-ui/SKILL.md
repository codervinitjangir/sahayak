---
name: dispatch-ui
description: Guidance and specifications for dispatch-related UI components including the 45-second offer timer, job status timeline, and matching state machines.
---

# Skill: Dispatch UI

## 1. Offer Countdown Timer (Partner UI)
- **Duration**: Exact 45-second countdown window (`OFFER_TIMEOUT_S = 45`).
- **Behavior**:
  - Visual circle or progress bar depleting clockwise.
  - Warning color transition: Teal/Green (>15s) -> Amber (15-5s) -> Red (<5s).
  - On 0s, auto-trigger reject/timeout action or disable Accept button to avoid stale acceptance 409 conflicts.
  - Pair visual countdown with sound or vibrational feedback if supported.

## 2. Job Status Timeline (Owner UI)
- States:
  1. `requested`: Initial booking submitted.
  2. `matching`: Searching and ranking nearby verified partners.
  3. `assigned`: Partner accepted the offer.
  4. `partner_en_route`: Partner is moving to pickup location.
  5. `in_progress`: Partner has reached and started work.
  6. `completed`: Work completed, ready for rating & payment record.
  - Alternates: `cancelled` or `no_match_found` (triggering admin manual dispatch alert).
- UX:
  - Display step-by-step progress nodes with clear labels, timestamps, and icons.
  - Show partner verification badge once assigned.
  - Show ETA clearly marked as "Estimated Arrival Time".

## 3. Real-Time Polling & Invalidation
- Use TanStack Query with exponential or fixed polling intervals:
  - In `matching` state: Poll job status every 3-5 seconds.
  - In `partner_en_route` state: Poll partner position/ETA every 5-10 seconds.
  - In `completed` / `cancelled`: Stop polling.
