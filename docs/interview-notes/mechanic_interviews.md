# Qualitative Field Research: Bangalore Roadside Mechanics & Towing Operators

**Project:** Sahayak — Real-Time Emergency Vehicle Assistance Platform  
**Research Dates:** September – October 2026  
**Location Focus:** Greater Bengaluru Urban Clusters (High-Breakdown Corridors)  
**Methodology:** Semi-structured in-person field interviews, workshop observational shadowing, and ride-alongs with mobile breakdown vans.

---

## Executive Summary & Research Objectives

To design a dispatch platform that mechanics actually open, trust, and keep online, we conducted 6 in-depth qualitative interviews across Bengaluru's primary vehicular arteries.

### Key Hypotheses Validated:
1. **Aggregator Distrust:** Roadside mechanics refuse traditional ride-hailing/delivery platforms that take 25–30% cuts or withhold earnings for 14 days. A platform with zero-to-low commission and instant daily settlements gets immediate adoption.
2. **Safety & False Dispatches:** Independent mechanics operating at night fear false call-outs, stranded highway robbery, and unpaid diagnostic trips. The 4-digit verbal start code (OTP) and GPS audit trails are non-negotiable trust primitives.
3. **Hyper-Local Radius Constraints:** A mechanic on a scooter cannot travel 10 km for a ₹200 puncture repair. Dispatch matching must strictly honor travel distance and hyper-local proximity (≤ 3–5 km).

---

## Detailed Field Interviews

### Interview 1: Ramesh Kumar — Heavy Towing & Flatbed Specialist
- **Location:** Indiranagar 100ft Road / Old Madras Road Cluster
- **Equipment:** Tata 407 Tilt-Deck Flatbed + Mahindra Bolero Wheel-Lift Tow Truck
- **Operating Hours:** 24/7 on-call
- **Experience:** 14 years in commercial vehicle recovery

#### Operational Realities:
> *"When a car breaks down on the Indiranagar flyover or Old Airport Road at 6 PM, every minute of delay causes a 2-kilometer traffic backup. Traffic police scream at the driver, and the driver screams at us."*

- **Current Pain Points:**
  - Traditional tow aggregators quote customers ₹1,200 but pay the tow truck driver ₹700, withholding the remainder for 15–30 days.
  - Customers frequently misreport vehicle condition (e.g., booked for a normal tow, but the axle is broken or the car is stuck in gear in an underground basement where a flatbed cannot enter).
- **Platform Features Demanded:**
  - Upfront vehicle specifications (Make, Model, Underground parking vs Surface street).
  - Toll and heavy recovery transparent fare computation.
- **Architectural Impact on Sahayak:**
  - Categorization of Towing into *Flatbed* (`tow_01`) and *Wheel-Lift* (`tow_02`).
  - Upfront vehicle type capture in owner assistance request flow.

---

### Interview 2: Suresh Manjunath — Mobile Puncture & Tubeless Tyre Van
- **Location:** Hebbal Flyover Junction / Airport Expressway (NH 44)
- **Equipment:** Modified Maruti Omni mobile workshop with compressed air tank, tyre changer, hydraulic jack
- **Operating Hours:** 7:00 PM – 5:00 AM (Night Owl Shift)
- **Experience:** 8 years operating mobile puncture units

#### Operational Realities:
> *"The stretch between Hebbal and Yelahanka has cars speeding at 100 km/h. If I am changing a right-side tyre on the expressway shoulder at 2 AM, it is a life-or-death situation. I need exact GPS coordinates, not 'near the big tree'."*

- **Current Pain Points:**
  - Customers give vague landmark descriptions over phone calls while panicking.
  - High rate of cancellations after the mechanic has already driven 4 km, because another passing tow truck or local mechanic stopped first.
- **Platform Features Demanded:**
  - Live GPS pin navigation directly to the breakdown spot.
  - Cancellation fee protection if customer cancels after mechanic is en route (> 3 mins).
- **Architectural Impact on Sahayak:**
  - Real-time Redis GEO coordinates tracking with PostGIS distance calculation.
  - `cancellation_reason` logging with audit trail on both owner and partner portals.

---

### Interview 3: Ravi Shankar — Battery Jumpstart & Auto-Electrician
- **Location:** Koramangala 80ft Road / Sony World Signal
- **Equipment:** Hero Splendor with 12V 100Ah booster pack, heavy-duty jumper cables, digital multimeter & battery load tester
- **Operating Hours:** 8:00 AM – 10:00 PM
- **Experience:** 11 years auto-electrical repair

#### Operational Realities:
> *"80% of customers think their battery is dead, but half the time it's a blown main fuse, faulty starter motor, or rat-chewed wiring harness. When we arrive and find it's not just a jumpstart, customers accuse us of overcharging."*

- **Current Pain Points:**
  - Pricing disputes when secondary issues emerge on-site.
  - Digital payments: Customers often don't have cash and UPI network issues occur in basement parkings.
- **Platform Features Demanded:**
  - Transparent itemized service catalog with baseline diagnostic fee.
  - Digital start verification code so work cannot be disputed later.
- **Architectural Impact on Sahayak:**
  - Implemented upfront `SERVICE_BASE_PRICES` with clear diagnostic vs repair breakdowns.
  - 4-digit dominant Start Code (OTP) required before status can transition to `in_progress`.

---

### Interview 4: Manpreet Singh — Multi-Brand Workshop Owner
- **Location:** Whitefield ITPL Main Road / Hoodi Junction
- **Equipment:** 5 hydraulic repair bays, 2 breakdown recovery motorcycles, 1 emergency rescue van
- **Operating Hours:** 9:00 AM – 8:00 PM
- **Experience:** 18 years multi-brand automobile servicing

#### Operational Realities:
> *"Between 12 PM and 4 PM, my workshop bays have downtime. If I can dispatch my junior technicians to nearby breakdowns in ITPL or Kadugodi within 3 km, that transforms dead labor hours into high-margin revenue."*

- **Current Pain Points:**
  - Spends ₹30,000/month on Google Ads with 70% junk/spam leads.
  - Technicians often forget paperwork or fail to record customer feedback.
- **Platform Features Demanded:**
  - Instant online/offline shift toggle so technicians only receive offers when free.
  - Automated customer rating and digital GST invoice generation.
- **Architectural Impact on Sahayak:**
  - Single-click Online/Offline shift toggle (`is_active` state in `partners` table).
  - Automated GST-compliant digital invoice generation in `ActivityView` and `JobCompleteScreen`.

---

### Interview 5: Anand Swamy — Two-Wheeler Breakdown Specialist
- **Location:** HSR Layout Sector 1 / Silk Board Junction
- **Equipment:** Tool backpack on TVS Apache with spare tubes, clutch cables, spark plugs, chain link tools
- **Operating Hours:** 7:00 AM – 11:00 PM
- **Experience:** 6 years servicing two-wheelers

#### Operational Realities:
> *"If an app sends me an alert for an Activa breakdown 8 kilometers away in BTM 2nd Stage during peak evening traffic, it will take me 45 minutes to reach. The customer will be furious and I will earn ₹150 for an hour and a half of work."*

- **Current Pain Points:**
  - Algorithmic dispatchers that ignore Bangalore traffic congestion and dispatch purely by Euclidean straight-line distance.
- **Platform Features Demanded:**
  - Strict dispatch radius clamping (maximum 3.5 to 5 km).
  - Clear service request preview (vehicle model, problem summary, estimated payout) before acceptance.
- **Architectural Impact on Sahayak:**
  - 15-second rich incoming offer modal displaying distance, estimated payout, and vehicle model.
  - Radial PostGIS bounding with weighted scoring favoring closer partners.

---

### Interview 6: Venkatesh Murthy — Heavy Highway Rescue & Lockout Specialist
- **Location:** Electronic City Phase 1 / NICE Road Junction
- **Equipment:** Eicher recovery truck with electric winch, hydraulic wheel dolly, professional lockout pick set
- **Operating Hours:** 24/7
- **Experience:** 16 years highway recovery

#### Operational Realities:
> *"On NICE Road or the Elevated Expressway, the highway authority will impound any stationary vehicle within 20 minutes to prevent rear-end collisions. We need instant dispatch without 5-minute phone verification delays."*

- **Current Pain Points:**
  - Delayed dispatch systems that waste crucial golden-hour rescue time.
  - Unclear lockout liability (confirming the person requesting unlock actually owns the car).
- **Platform Features Demanded:**
  - Zero-latency automated matching engine.
  - License plate and registered owner verification on job offer screen.
- **Architectural Impact on Sahayak:**
  - Redis pub/sub and WebSocket real-time dispatch with automated 15-second cascade timeout.
  - Vehicle plate and make/model displayed upfront on `IncomingOfferScreen`.

---

## Synthesis: Design Rules Derived From Partner Fieldwork

| Field Finding | Mechanic Need | Sahayak Architectural Implementation |
|---|---|---|
| Aggregator fee anxiety | Zero surprise deductions | Transparent fixed payout displayed on `IncomingOfferScreen` |
| Safety & disputed work | Proof of arrival and customer authorization | 4-Digit OTP Start Code before mechanic turns a single wrench |
| Traffic & distance fatigue | Hyper-local radius adherence | PostGIS ST_DWithin query restricted to 5 km radial catchment |
| Downtime optimization | Work on my own schedule | Toggle shift status with instant Redis GEO unindexing on offline |
| Professional identity | Legitimate business credentials | Admin Partner Verification workflow (`admin_partners_router`) |
