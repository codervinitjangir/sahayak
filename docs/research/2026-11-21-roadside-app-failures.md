# What goes wrong with roadside and home-service apps, and what Sahayak does about it

Researched 2026-11-21. Sources are consumer-complaint sites, review pages, news reports and
vendor write-ups (listed at the end). **Reddit could not be read**: it blocks automated access,
so no Reddit thread is quoted here. Quora returned general threads only. Every source is a
self-selected complaint or an anecdote; none says how often a problem happens. Treat this as a
list of failure modes to design against, not as measured rates.

## 1. Failure modes found, and Sahayak's answer

| # | What goes wrong (source) | Sahayak before 2026-11-21 | Now |
|---|---|---|---|
| F1 | **The bill grows after the work.** Mechanics name a price once the driver is stuck (CarItch: ₹3,000–8,000 for a 5 km tow); GoMechanic leaves price to "negotiate with the mechanic"; RSA plans add "spares, crane, tolls" (ReadyAssist FAQ) | Upfront estimate shown, but the partner typed the final price alone, up to 5x the estimate | **ADR-039.** Above estimate +10% the partner must ask in the app with a reason; the owner approves or rejects before completion. No approval, no completion (409 `PRICE_APPROVAL_REQUIRED`) |
| F2 | **The start code is used remotely or not at all.** Technicians start without the OTP, or ask for the OTP before finishing (consumercomplaints.in, Urban Company); OTPs read out over the phone confirm a handover that never happened (Which?, Amazon) | Start code proved the owner handed it over, not that the partner was there | **ADR-040.** The code is refused when the partner's fresh GPS fix is over 1 km from the pickup. No fix: allowed, and the timeline says "not verified" |
| F3 | **Nobody turns up, or the ETA keeps moving.** Two to five hour waits after prepaying (Trustpilot, Drive Roadside); Honk sent nobody in an hour (FOX6) | Search widens for 10 minutes (ADR-023); once a partner accepted, the owner could only cancel and start again | **ADR-041.** Past max(2 x ETA, ETA + 20 min, 30 min) the owner gets "Find another partner": same request, same pickup, the late partner is released and never re-offered |
| F4 | **"The tow damaged my car."** Towers claim damage was pre-existing; timestamped before/after photos decide these cases (BC Civil Resolution Tribunal decisions, AAA claim reporting) | No photos | **ADR-042.** Towing jobs need a pickup and a drop photo in the private bucket before completion. Owner and partner can view their job's photos; staff views are audited |
| F5 | **"Cancel in the app and pay me cash."** Drivers ask riders to cancel and pay offline to skip commission (Entrackr, Trustpilot, Hans India) | Not detectable; problem reports only on completed jobs | **ADR-043.** New report reason *asked to pay outside the app*, allowed on a cancelled job a partner had accepted. Staff alerts flag partners who cancel after the start code, start with GPS off, or are swapped out for lateness |
| F6 | **Fake helpers and "chasers".** Unsolicited tow trucks at the scene, callers posing as the roadside company (LA DA, CBC, Insurify) | Owner sees the partner's name and rating after acceptance | App copy: "Only the partner shown here is from Sahayak. Never hand your keys to anyone else." Share the code only face to face |
| F7 | **Wrong pin.** GPS "slightly off"; the in-app call to the driver failed (FOX6); GEICO corrects the pin by phone | Pin on a map, address text, call after assignment | Unchanged in code: the owner drags the pin before sending and types a landmark (already in the request form); the partner calls |
| F8 | **Partners blocked without reason, opaque deductions** (Urban Company partner protests) | Rejection reason shown; suspension has a reason in the audit log | Unchanged. Payouts are blocked on G3 |
| F9 | **Fake helpline numbers in search results** | Placeholder numbers in the app (R1) | Unchanged: needs the real numbers (R1) |
| F10 | **No signal on the highway** (GEICO, what3words notes on GPS in enclosed spots) | A failed send was lost | **ADR-044.** The same request is resent for three minutes with the same idempotency key; the owner can stop it |

## 2. Where each step goes (the OTP question)

| Step | Where it is in Sahayak | Why there |
|---|---|---|
| Phone OTP (sign-in) | When the owner sends the request, not before they can look around. Guests can browse services and prices | A stranded driver should see help and prices before typing anything. The account is needed only to dispatch, call and pay |
| Pickup pin | Before sending, with the option to drag it | The pin decides who is offered the job |
| Price | Shown on the service card before sending (ADR-028) | No surprise at the end (F1) |
| Start code (4 digits) | Shown to the owner; entered by the partner **at the vehicle** (now checked, ADR-040) | Proves the two met. Same pattern as Ola and Uber's start-of-ride PIN, which exists to stop rides started without the passenger |
| Extra charges | Asked for **during** the job, approved by the owner **before** completion (ADR-039) | Approval after the work is not a choice |
| Photos (towing) | Pickup photo before the tow, drop photo at the destination (ADR-042) | Photos taken only after loading cannot show pre-existing damage |
| Completion | Partner completes with the agreed price | No completion OTP on purpose: a "give me the code" at the end is exactly the Urban Company complaint (asked before the work was done). The owner keeps "Report a problem" instead |
| Payment | After completion, confirmed by the side that received the money (ADR-022) | |
| Rating | After payment, both ways | |

## 3. Edge cases checked against the new rules

* Partner proposes a revision, then completes at or below the free margin: the pending
  revision is withdrawn in the same transaction.
* Owner approves while the partner completes: both take the job row lock; whichever is second
  sees the first's result.
* Two proposals at once: a partial unique index allows one pending per job (409).
* Owner never answers: the partner can complete at the agreed price, or cancel. Staff can see
  the job on the board.
* Revision on a job with no estimate (legacy rows only; every live service has a price):
  any final price needs approval.
* Owner asks for another partner one minute early: 409 `PARTNER_NOT_OVERDUE`, nothing written.
  The screen shows the time it becomes available.
* Late partner arrives just after being released: their assignment is cancelled, the start
  code is refused (they are no longer on the job), and they were told by notification.
* Partner in a basement with no GPS: the start is allowed and marked unverified; three in 30
  days raise a staff flag, one does not.
* Partner with a stale fix from 2 km away (fix older than 10 minutes): treated as no fix, not
  as "far".
* Tow partner without a camera: completion is refused; staff can still close the job.
* Cancelled job nobody accepted: cannot be reported (nobody to report).

## Sources

- [Trustpilot: Drive Roadside Assistance reviews](https://www.trustpilot.com/review/driveroadside.com)
- [FOX6 Contact 6 tests HONK and Urgent.ly](https://www.fox6now.com/news/stopping-the-stress-of-being-stranded-contact-6-tests-honk-and-urgent-ly-apps)
- [CarItch: towing overcharging in India](https://caritch.com/problems/why-do-towing-services-overcharge-30008000-for-a-5-km-tow-147)
- [CB Insights: GarageOnRoad / GoMechanic profile](https://www.cbinsights.com/company/garageonroad)
- [ReadyAssist RSA plans FAQ](https://readyassist.in/roadside-assistance-subscription-plans.html)
- [consumercomplaints.in: Urban Company complaint](https://www.consumercomplaints.in/urban-company-i-want-to-place-a-complaint-for-the-poor-service-and-misbehavior-of-the-service-provider-c3540761)
- [consumercomplaints.in: Urban Company AC servicing](https://www.consumercomplaints.in/urban-company-cheating-by-urban-company-formerly-urbanclap-ac-servicing-c2853130)
- [either/view: Urban Company and its partners](https://eitherview.com/is-urban-company-exploiting-its-service-partners/)
- [Which?: Amazon delivery OTP scam](https://www.which.co.uk/news/article/scamwatch-an-amazon-delivery-driver-tricked-me-and-stole-my-new-phone-a0lED0s92Efz)
- [Shipmozo: delivered but not received](https://www.shipmozo.com/blog/order-marked-delivered-but-not-received)
- [Heetch: pickup verification code](https://medium.com/heetch/reducing-fake-pickups-with-a-pickup-verification-code-fdf17b923eee)
- [The Quint: Uber India 4-digit start code](https://www.thequint.com/tech-and-auto/tech-news/uber-india-4-digit-code-start-ride-safety-features-more)
- [Entrackr: drivers ask riders to cancel and pay offline](https://entrackr.com/?p=116129)
- [The Hans India: drivers put passengers on the spot](https://thehansindia.com/news/cities/hyderabad/hyderabad-drivers-of-taxi-aggregators-put-passengers-on-the-spot-735886)
- [BC Civil Resolution Tribunal decision (tow damage)](https://decisions.civilresolutionbc.ca/crt/crtd/en/528140/1/document.do)
- [Atlanta News First: AAA tow damage claim](https://www.atlantanewsfirst.com/2023/06/05/aaa-customers-claim-over-tow-truck-damage-has-lessons-you/?outputType=amp)
- [LA County DA: tow truck bandit alert](https://da.lacounty.gov/sites/default/files/pdf/Tow%20Truck%20Bandit%20Fraud%20Alert.pdf)
- [Insurify: avoiding tow truck scams](https://insurify.com/car-insurance/claims/tow-company-fraud/)
- [GEICO roadside in the app (location correction)](https://www.geico.com/web-and-mobile/mobile-apps/roadside-assistance/)
