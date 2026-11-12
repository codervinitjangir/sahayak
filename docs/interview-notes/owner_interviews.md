# Qualitative Field Research: Stranded Vehicle Owners in Bengaluru

**Project:** Sahayak — Real-Time Emergency Vehicle Assistance Platform  
**Research Dates:** September – October 2026  
**Location Focus:** Bengaluru High-Traffic & Transit Corridors  
**Methodology:** In-depth qualitative owner interviews, post-breakdown incident retrospectives, and simulated emergency response usability walk-throughs.

---

## Executive Summary & Research Objectives

Vehicle breakdown is not an ordinary e-commerce transaction; it is an acute, high-stress crisis involving personal safety, vulnerability on dark roads, financial exploitation anxiety, and urgent time pressure. 

To ensure Sahayak's mobile and web interfaces provide genuine psychological reassurance alongside rapid technical dispatch, we conducted 6 detailed interviews with car and two-wheeler owners who experienced breakdowns across Bengaluru over the past 6 months.

### Key Hypotheses Validated:
1. **The Anxiety Matrix:** The #1 driver of stress during a breakdown is not the repair cost—it is *uncertainty*. Owners demand live GPS location tracking of the en route mechanic and continuous ETA reassurance.
2. **Transparent Upfront Pricing:** 100% of interviewed owners cited fear of extortionate roadside pricing (e.g., being quoted ₹500 over the phone, then demanded ₹3,000 once the car is on the hook).
3. **Identity Verification & Safe Handoff:** Female drivers and night-time commuters require verified technician credentials, vehicle number matching, and a physical start code (OTP) before handing over keys or allowing work to begin.

---

## Detailed Owner Case Studies

### Interview 1: Priya Ramanathan — Senior Software Engineer
- **Vehicle:** Hyundai Creta (2022 Petrol AT)
- **Incident Location:** Electronic City Elevated Tollway, near Kudlu Gate exit
- **Time of Breakdown:** 11:15 PM, Weekday
- **Incident:** Right-rear blowout while returning from office campus

#### The Experience:
> *"It was pitch dark on the flyover shoulder with trucks whizzing past at 80 km/h. My tyre shredded and the rim was scraping. Calling random Google search numbers gave me busy tones or people saying 'Send ₹2,000 advance on Google Pay first'. I was terrified to step out of my locked car."*

- **Emotional State:** Severe panic, acute fear of physical vulnerability.
- **Critical Feature Demands:**
  - One-tap SOS Emergency button that alerts family with exact GPS pin.
  - Verified technician photo, police-cleared KYC badge, and real-time vehicle map tracking.
- **Architectural Impact on Sahayak:**
  - Floating Emergency SOS button accessible on every screen (`OwnerHelpFlowScreen` and `HomeScreen`).
  - Partner Identity card displaying photo, rating, verified badge, and live moving vehicle marker on `StreetVectorCanvas`.

---

### Interview 2: Karthik Balasubramanian — IT Operations & Motorcyclist
- **Vehicle:** Royal Enfield Classic 350
- **Incident Location:** Koramangala 80ft Road, Sony World Signal
- **Time of Breakdown:** 8:30 PM during heavy monsoon downpour
- **Incident:** Snapped clutch cable in bumper-to-bumper waterlogged traffic

#### The Experience:
> *"Water was up to the exhaust pipe. A local roadside towing guy pulled up and claimed he had to tow my bike 2 km to his shed and demanded ₹1,800 just for loading it. When I refused, he argued aggressively. I ended up pushing the 195 kg motorcycle in the rain for 1.5 km."*

- **Emotional State:** Frustration, anger at predatory pricing.
- **Critical Feature Demands:**
  - Guaranteed upfront binding price that cannot be inflated on-site.
  - Sub-service breakdown (e.g., distinguish a ₹150 cable swap from an expensive towing job).
- **Architectural Impact on Sahayak:**
  - Upfront pricing engine (`price_estimate` stored in PostgreSQL `jobs` table at creation).
  - Explicit sub-service selector (`SEEDED_SUB_SERVICES` with itemized prices).

---

### Interview 3: Deepa & Arvind Nair — Family Traveling with 2-Year-Old
- **Vehicle:** Maruti Suzuki Ertiga (2020 Smart Hybrid)
- **Incident Location:** Hebbal Flyover Junction (NH 44 Airport Expressway)
- **Time of Breakdown:** 5:30 AM, Sunday morning
- **Incident:** Radiator coolant leak, temperature gauge redlined with family en route to Kempegowda International Airport

#### The Experience:
> *"We had our 2-year-old in the back seat and our flight to Kochi was in 2.5 hours. We could not wait for an insurance company call center that takes 45 minutes to 'process a ticket'. We needed a flatbed tow truck immediately and confirmation that our luggage and family could travel safely."*

- **Emotional State:** High urgency, time-critical family pressure.
- **Critical Feature Demands:**
  - Hyper-rapid dispatch (< 30 seconds matching).
  - Accurate countdown ETA (e.g., "Technician arriving in 6 minutes").
- **Architectural Impact on Sahayak:**
  - 15-second radial auction dispatch with automated cascading.
  - Live animated pulsating ETA pill (`Arriving in X min · Y km away`).

---

### Interview 4: Mohammed Zeeshan — Quick-Commerce Delivery Courier
- **Vehicle:** TVS Jupiter 110cc Scooter
- **Incident Location:** 100 Feet Road, Indiranagar
- **Time of Breakdown:** 11:45 PM, Saturday Night
- **Incident:** Battery completely discharged after continuous stop-start deliveries

#### The Experience:
> *"I had 3 delivery orders in my bag. Every minute my scooter sat dead, I was losing ratings and pay. Traditional car RSA apps charge ₹800–1,200 which is more than my entire day's earnings. I only needed a 12V jumpstart or a temporary battery swap."*

- **Emotional State:** Economic panic, livelihood under threat.
- **Critical Feature Demands:**
  - Dedicated two-wheeler tiered pricing (affordable jumpstart under ₹350).
  - Flexible UPI QR payment (PhonePe, GPay, Paytm) with zero cash requirement.
- **Architectural Impact on Sahayak:**
  - Vehicle classification toggle (`two-wheeler` vs `four-wheeler`) adjusting service price baselines.
  - Seamless digital UPI payment receipts in `ActivityView`.

---

### Interview 5: Dr. Sandhya Hegde — Emergency Physician
- **Vehicle:** Honda City (2021)
- **Incident Location:** Victoria Hospital Basement Parking Level -2, Kalasipalya
- **Time of Breakdown:** 2:15 PM
- **Incident:** Key fob battery died and central locking failed with key locked inside, basement had zero 4G cell coverage

#### The Experience:
> *"I had an emergency shift at 3 PM. In the basement, my phone had zero Airtel signal. Most mobile apps just show an infinite loading spinner and fail silently without telling you that the network dropped."*

- **Emotional State:** Extreme professional stress, helplessness.
- **Critical Feature Demands:**
  - Offline-resilient UI with graceful offline notices.
  - Clear emergency desk phone numbers (1800-SAHAYAK) reachable via landline or hospital Wi-Fi.
- **Architectural Impact on Sahayak:**
  - Static 24/7 Helpline Card with one-touch dialer (`1800-SAHAYAK`) in `ActivityView`.
  - Offline simulation fallbacks and network retry resilience in `useJobStore` and `client.ts`.

---

### Interview 6: Vikramaditya Roy — Retired PSU Director (EV Owner)
- **Vehicle:** Tata Nexon EV (2023)
- **Incident Location:** Whitefield Outer Ring Road near Marathahalli Bridge
- **Time of Breakdown:** 4:00 PM, Weekday
- **Incident:** High-voltage system fault warning; vehicle went into neutral limp mode

#### The Experience:
> *"With an Electric Vehicle, you cannot just let any local mechanic hook a chain and tow it on its drive wheels, or the permanent magnet motor will generate back-EMF and fry the ₹6 lakh battery pack. I needed to be 100% sure the operator was dispatching a flatbed carrier, not a regular winch."*

- **Emotional State:** High financial caution, fear of catastrophic vehicle damage.
- **Critical Feature Demands:**
  - Explicit towing method selection (Flatbed Tilt-Deck vs Wheel-Lift).
  - Verification that the dispatched partner has flatbed capabilities.
- **Architectural Impact on Sahayak:**
  - Explicit Flatbed Towing (`tow_01`) service card with diagrammatic truck icon and payload capacity notes.
  - Partner service capability tags verified by ops before partner receives towing offers.

---

## Synthesis: Design Rules Derived From Owner Fieldwork

| Owner Need | Field Pain Point | Sahayak UX / Architectural Solution |
|---|---|---|
| **Immediate Reassurance** | "Is anyone actually coming?" | Live radar search animation -> Assigned Driver card with photo, phone, and moving marker |
| **Pricing Predictability** | Fear of roadside extortion | Pre-calculated `price_estimate` shown on service card before order placement |
| **Physical Safety** | Unverified strangers approaching car | Dominant 4-Digit Start Code (OTP) preventing unauthorized individuals from touching vehicle |
| **Emergency Helpdesk** | Inability to use app in basement | 24/7 Toll-Free SOS Call Desk (`1800-724-2925`) prominently displayed |
| **Post-Service Closure** | No proof of repair or billing | Automated digital receipt with GST breakdown and star rating + feedback tags |
