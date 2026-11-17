# Sahayak — Future Roadmap (post-MVP)

> Status: **vision / not scheduled.** Nothing here is built. "Coming soon" cards with Notify me (ADR-035): owner home has scheduled, doorstep and pick-up & drop. Partner home has financing, certification and pick-up & drop partner. The current product is
> on-demand roadside dispatch (owner → nearest verified partner). This file covers what
> comes after it, the risks each new service creates, and the order in which to build.
> Each item that gets picked up should get its own ADR before any code is written.

---

## 1. Where we are vs. where we go

| Today (MVP) | Next |
|---|---|
| Emergency, "right now" jobs | **Scheduled** jobs (pick a date and time slot) |
| Partner fixes it on the spot | Partner fixes at the doorstep, **or picks up the vehicle and drops it back** |
| Consumers only (B2C) | **Businesses** (B2B): insurers, fleets, ride-hailing platforms, through a portal and an API |

The dispatch engine, the partner verification, the job state machine and the
status history we already have are the base for all of this. Most new features are new
**job types** plus new **states**, not a new system.

---

## 2. B2C services

### 2.1 Scheduled service (the "Sunday holiday" case)
The owner books a slot ("Sunday 10:00–12:00, home address") rather than "now".

- New `jobs.scheduled_for` + `slot_end`; dispatch runs **T-minus N hours** before the slot,
  not when the job is created.
- Partners publish availability (working hours, days off) so we offer only to partners free in that slot.
- A reminder push 24 h and 1 h before. The partner confirms on the day, and if they don't, we re-dispatch automatically.
- Cancellation window: free until X hours before the slot, then a fee (it protects the partner's time).

### 2.2 Basement / parking-lot breakdown
A puncture or dead battery in a basement or society parking. The vehicle is reachable but there's often no GPS.

- Location = address + **level / pillar / slot number** + an optional photo. GPS alone fails underground.
- A **"gate pass" note** for society security (partner name, vehicle no., ETA), shareable over WhatsApp.
- Job types that really fit here: puncture, jump-start, battery swap, minor electrical. Towing out of a basement is
  usually not possible (height limits), so flag it at booking.

### 2.3 Doorstep repair (mechanic comes home)
The mechanic inspects, quotes and repairs on site.

- **Two-step pricing:** inspection fee (fixed, paid up front) → itemised quote → the owner approves in the app →
  work starts. No work without an approved quote. This is the most common dispute.
- Parts: the partner uploads a photo of the old part and the bill for any part they replace.

### 2.4 Pick-up & drop (mechanic takes the car to the shop)
The highest-value service and also the riskiest. See §3 for all the safeguards.

- New states: `PICKUP_SCHEDULED → VEHICLE_HANDED_OVER → AT_WORKSHOP → REPAIR_IN_PROGRESS →
  READY_FOR_DROP → OUT_FOR_DELIVERY → DELIVERED`. Every transition goes into `job_status_history`.
- Live tracking of the vehicle while it is in transit (the partner's phone location, and later an OBD/GPS tag).

### 2.5 Other services worth adding
Ordered by how well they fit what we already have (verified partners + location dispatch):

| Service | Why it fits | Notes |
|---|---|---|
| **Periodic maintenance at home** (oil, filters, general service) | Same as scheduled doorstep repair | Fixed-price packages by vehicle model |
| **Battery delivery & fitting** | Very common breakdown, a fixed-price product | Partner with battery brands |
| **Fuel delivery** (stuck on empty) | An emergency job type | Legal limits on carrying fuel. Needs a PESO-compliant partner |
| **Tyre replacement at home** | An extension of the puncture job | Inventory held by the partner |
| **Doorstep car wash / detailing** | High frequency, keeps users coming back | Low risk, a good add-on to a scheduled visit |
| **Pre-purchase vehicle inspection** | Used-car buyers pay for a trusted check | Report PDF with photos |
| **PUC / pollution check pickup**, **RTO and insurance-renewal help** | Paperwork people hate | Mostly coordination, not mechanics |
| **Accident assistance** | Tow + photos + insurance claim initiation | The bridge to B2B insurers (§4.1) |
| **EV support** (mobile charging, EV-trained mechanics) | A growing segment that few garages cover | Partner certification flag |
| **Subscription / membership** ("Sahayak Care": X free call-outs a year) | Predictable revenue | Like the AA/RSA plans |
| **Driver-on-demand** (drive the car to the service centre) | For owners who trust a dealer but have no time | Same custody risks as pick-up |

---

## 3. Loopholes & edge cases (pick-up, drop and doorstep)

The core rule: **at every moment, someone is clearly responsible for the vehicle, and we
can prove it.** Each handover is an event with evidence.

### 3.1 Custody chain (prevents "the car was stolen / not returned")
1. **Pre-pickup inspection.** The partner records a guided 360° photo/video in the app (fixed angles), the odometer,
   the fuel level and visible damage. The owner signs off in the app. The data is timestamped and geotagged, and it can't be edited later.
2. **Handover OTP.** The keys change hands only when the owner gives a one-time code to the partner. This is the same
   pattern as the start-job OTP. No OTP, no state change.
3. **Return OTP + post-drop inspection.** The same photos again, compared side by side with the pickup set. The owner
   has a short window (for example 24 h) to raise damage after that.
4. **Live location** of the vehicle/partner while `VEHICLE_HANDED_OVER … DELIVERED`. It alerts when the vehicle goes
   off-route, stops for too long, or the partner goes offline.
5. **Promised return time.** If it's missed, it escalates automatically: a call from ops, then the emergency contact,
   then a police complaint workflow.

### 3.2 Who can do pick-up at all (prevents bad actors)
- Only **"Custody-tier" partners**: police verification certificate, a registered workshop address checked by a site visit,
  GST, a minimum rating, a minimum number of completed jobs, and a **security deposit** held by us.
- Individual driver identity is checked again with a selfie match at pickup (the person who comes is the person who is verified).
- Insurance: a **garage-keeper's liability / transit insurance** policy that covers vehicles in our custody. Partner with
  an insurer. This is what actually pays out if a car is stolen or damaged.

### 3.3 Edge-case table

| Scenario | How we handle it |
|---|---|
| Vehicle not returned on time | Auto-escalation ladder (above). Live location is shared with the owner. The partner is suspended until it's resolved |
| Vehicle stolen while in custody | FIR filed by the partner/us. A claim on the transit insurance. The deposit is forfeited. The partner is permanently banned. The custody evidence supports the claim |
| New damage after the drop | Compare the pickup and drop photos. The partner's liability or insurance pays. Dispute desk with a 48 h SLA |
| Owner claims damage that existed before | The pickup photos the owner signed off settle it |
| Parts swapped (good part replaced with a used one) | Old parts returned to the owner in a bag and photographed. Part serials and bill photo required |
| Extra km / personal use of the car | Odometer at pickup and drop vs. the expected route distance. Location trail |
| Quote inflated after the car is at the shop | Any change to the quote needs fresh owner approval in the app. Work beyond the approved quote isn't paid |
| Owner not home at drop | Reschedule slot. The car stays at the workshop (still insured). Never left on the street |
| Owner refuses to pay after repair | Payment is held in escrow before the drop (see §3.4). The car is released when payment is confirmed |
| Partner no-show for the scheduled slot | Auto re-dispatch. The partner's reliability score drops. Owner compensation credit |
| Fake booking / prank | Inspection fee paid up front. Phone verified. Repeat offenders blocked |
| Society/security blocks entry | The gate-pass note (§2.2). The partner marks "access denied" with a photo, so no-show penalties don't apply |
| Accident during transit | Transit insurance plus the partner's motor policy. The incident is recorded with photos and location |

### 3.4 Money safeguards
- **Escrow:** the owner pays into our account (payment gateway hold). The partner is paid out after `DELIVERED` and
  the dispute window has closed.
- Partner security deposit plus a rolling reserve (hold back a % of payouts for N days).

### 3.5 Trust & product
- An SOS button for both sides throughout the job.
- Masked calling (the number is never exposed). This extends the contact-release rule we already have (ADR-017).
- Two-way ratings, plus a separate "custody reliability" score.

---

## 4. B2B

> **Parked (2026-11-18).** B2B is in this plan only. It is not shown in any panel (the owner-side "For business" card was removed). Revisit it when it can get its own org panel.

All B2B clients share three building blocks:
1. **Organisation accounts.** An `organisations` table, org admins, many users per org, and roles.
2. **Booking channels.** A web **portal** (manual booking) and a **REST API with webhooks** (machine booking).
3. **Billing.** Monthly invoicing with GST and credit terms, not pay per job by card.

### 4.1 Insurance companies
The insurer's customer has an accident or breakdown, and the insurer books the tow or repair with us.

- Booking on behalf of a third party: the insurer creates the job, and the policyholder gets a tracking link by SMS.
- **Claim reference** stored on the job. Photos, location and timestamps are exported as a claim pack (PDF/JSON).
- SLAs per contract (for example "tow at the scene within 45 min in city limits") and SLA reports.
- Network management: the insurer may choose to send repairs only to their **cashless network garages**.

### 4.2 Fleet owners (trucks, delivery vans, buses)
- **Vehicle registry** for the fleet (thousands of vehicles), bulk-uploaded by CSV/API.
- Breakdowns on highways mean heavy-vehicle towing (cranes, flatbeds). This needs `partner_equipment` classes for HCVs.
- **Preventive maintenance scheduling** across the fleet (§2.1 at scale).
- Approval rules: jobs above ₹X need the fleet manager to approve. Cost-centre tagging.
- Dashboards: downtime per vehicle, cost per km, repeat breakdowns.
- Later: telematics integration (the truck reports a fault, and a job is created automatically).

### 4.3 Ride-hailing & mobility platforms (Uber-, Rapido-, Ola-type, rental fleets)
Their drivers break down mid-trip. The platform wants the driver back on the road quickly.

- **API-first integration.** The platform calls `POST /b2b/v1/jobs` with the driver's location and vehicle, and gets
  webhooks for `ACCEPTED`, `EN_ROUTE`, `COMPLETED`.
- The platform pays (billed to them), or the driver pays with platform-negotiated rates.
- Driver-friendly flows: two-wheeler punctures and batteries are the bulk of it, so they need to be quick and cheap.
- White-label option: the "Roadside help" button inside their app, powered by us.

### 4.4 Others to approach
- **Car dealerships / OEM service centres**: pick-up and drop for their service bookings (we supply the drivers and logistics).
- **Car rental and subscription companies** (self-drive): roadside help for their customers.
- **Corporate employee benefit**: roadside cover as a perk.
- **Housing societies / tech parks**: a weekly "service day" where we come on site and handle many cars at once.
- **Credit-card / bank RSA programmes**: they already sell "roadside assistance". We can be the fulfilment partner.

### 4.5 B2B technical requirements
- API keys per organisation (scoped, rotatable), rate limits, **idempotency keys** (today these are deliberately
  deferred in the PRD divergences, and B2B makes them mandatory).
- Signed webhooks with retries.
- Multi-tenant data isolation: an org sees only its own jobs and vehicles.
- Audit log on every B2B action, plus a contract-level SLA engine.
- The privacy rule still holds: a B2B client gets partner details only once the job is assigned.

---

## 4A. More ideas (added 2026-11-17)

### More B2C services
| Idea | What it is | Notes |
|---|---|---|
| **Vehicle health record** | Every job's history, bills and photos in one place per vehicle | "Sahayak verified service history" raises resale value. Builds on `job_status_history` |
| **Highway / trip mode** | The user enters a route before a long trip and sees partner coverage along it | Offline SOS by SMS, since highways often have no data network |
| **Women-safety mode** | Late-night requests prefer female or top-rated partners, with live trip sharing to family and a dedicated helpline | Needs a careful scoring tweak. ADR before touching the dispatch weights |
| **Breakdown prediction / reminders** | Battery age, km driven and service due date trigger reminders | Turns emergency jobs into scheduled ones (§2.1) |
| **Lockout / spare-key service** | Keys locked in the car or lost | Locksmith partner category. Ownership proof (RC) required before unlocking |
| **Used / surplus parts marketplace** | Partners sell genuine leftover stock | Later phase. Needs returns and warranty rules |

### Partner side (grow supply)
- **Partner financing:** loans for a tow truck or tools through an NBFC tie-up. Repayment can be deducted from payouts.
- **Training & certification:** short EV and modern-car courses. Certified partners rank higher for matching jobs.
- **Partner mini-CRM:** their regular customers and reminders inside the app, so they have no reason to go offline (see leakage below).

### More B2B
- **Govt / highway authorities (e.g. NHAI):** a highway-patrol and roadside tie-up.
- **School-bus and ambulance operators:** priority dispatch with a strict SLA.
- **Logistics / delivery apps (Porter-, Delhivery-type):** the same API model as ride-hailing (§4.3) for their delivery riders.
- **Anonymised data insights:** breakdown patterns by area and vehicle model for insurers and OEMs. Aggregated only, never per user, and with consent covered in the privacy policy.

### One more loophole: platform leakage
After the first job, the partner and the customer exchange numbers and deal directly, so we lose the repeat business.
- Masked calling only (extends ADR-017). Numbers are never shown.
- **In-app warranty** (for example 30 days on labour) that applies only to jobs booked through the app.
- Loyalty points or discounts for the owner, and lower commission on repeat in-app jobs for the partner.
- Detection: the same owner and partner pair with jobs dropping off after the first one gets flagged for review.

---

## 5. Suggested phasing

| Phase | Scope | Why this order |
|---|---|---|
| **P1** | Scheduled doorstep jobs (§2.1, §2.3), basement location details (§2.2), maintenance packages, battery/tyre at home | Low custody risk. Uses the current dispatch with a time slot |
| **P2** | B2B portal + org accounts + invoicing; first pilot with **one** fleet or rental company | Revenue. Proves the org model before we open the API |
| **P3** | Public B2B API + webhooks; ride-hailing / insurer integrations | Needs idempotency, API keys and the SLA engine from P2 |
| **P4** | Pick-up & drop with the full custody chain (§3), Custody-tier partners, transit insurance tie-up | Highest risk. Ship it only once insurance and escrow are in place |
| **P5** | Subscriptions, EV support, telematics auto-jobs, white-label | Growth layer on a stable base |

---

## 6. Open questions (decide before each phase)
- Insurance partner for vehicles in custody: who, what cover, what premium per job?
- Escrow: does our payment gateway support marketplace holds/splits (RBI payment-aggregator rules)?
- Fuel delivery: legal feasibility per state.
- B2B pricing: per job, per vehicle per month, or a flat SLA retainer?
- Liability split in partner T&Cs: needs legal review (it ties into the open legal-review item from the redesign).
