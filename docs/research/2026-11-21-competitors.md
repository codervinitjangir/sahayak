# Apps like Sahayak: who is running, who shut down, and why

Researched 2026-11-21 with web search. Reddit blocks automated reading, so no Reddit
threads are used. Revenue and funding figures come from secondary databases (Tracxn,
Inc42, TheKredible) that disagree with each other. Treat them as rough sizes, not
audited numbers. Where a claim could not be verified it says so.

## 1. Who is in this market

| Company | Model | Status (Nov 2026) | What it tells us |
|---|---|---|---|
| **ReadyAssist** (Bengaluru) | Roadside help for cars and two-wheelers. Sold mostly as **subscription plans and through OEMs, insurers and fleets**, plus one-time fees. Claims a 24/7 network across about 19,100 PIN codes | Running. About $6-7M raised. FY24 revenue about ₹12 Cr against about ₹23 Cr expenses (TheKredible), so still loss-making | The closest Indian match to Sahayak. Even the leader, after about ten years, is small and not yet profitable. Most of its volume comes through businesses, not app downloads |
| **GoMechanic** (Gurugram) | Car servicing through partner garages, now also a roadside-repair network with app and helpline | Survived a collapse. In January 2023 it admitted inflated revenue and fictitious garages, laid off 70% of staff, fell from a $285M to about a $30M valuation, and was sold to a Lifelong-led consortium in March 2023. The Delhi EOW filed an FIR against the founders in October 2023 | "Growth at all costs" with garages it could not verify. Sahayak's staff document check (ADR-038) and audit log are the opposite of this |
| **Pitstop** (Bengaluru) | Doorstep car servicing. Bought MotorWhiz in 2018, last raised in 2021 | No shutdown found; no recent news either | Doorstep servicing is a slow, steady business, not a blitz |
| **Urban Company** | Home services marketplace with trained, vetted partners and fixed prices | Listed in September 2025. FY25 profit was mostly a one-time ₹211 Cr tax credit; adjusted EBITDA only about ₹11 Cr on ₹1,144 Cr revenue | The playbook that worked: control quality (training, kits, fixed prices), and treat partner acquisition cost as the main expense. Even this took more than ten years to turn a thin operating profit |
| **HONK** (US) | Roadside dispatch app; most volume is **white-label for insurers** (Farmers, Branch, Vault), OEMs and fleets. Merged with CurbsideSOS after a Frontenac deal | Running | The US consumer app became a back-end for insurers. Roadside help is an insurer's most common customer touchpoint |
| **Urgently** (US, Nasdaq: ULY) | Roadside platform for OEMs and insurers | In distress. Nasdaq listing notice in March 2025, Q2 2025 revenue down 8% year on year, analyst notes describe little cash against a large debt | Having enterprise customers is not enough if they leave: revenue fell as they churned |
| **Wrench / YourMechanic** (US) | Mobile mechanics, upfront prices. Wrench bought YourMechanic in June 2022 | Running; many complaints about fees, refunds and quality on BBB and Trustpilot | Upfront pricing builds trust, but complaints about refunds and quality never stop. A disputes desk is part of the product, not an extra |
| Insurer and OEM roadside (TVS Auto Assist, Europ Assistance, Allianz Partners, carmaker programmes) | Sold with the insurance policy or the car | Search returned no usable data on these | They are the default way most Indian drivers get roadside help. A PolicyBazaar figure says 60% of motor insurance buyers also want roadside cover |

## 2. Who shut down, and why

| Company | What happened | Cause |
|---|---|---|
| **Autto.in** (doorstep car service, 2018) | Shut down within days of deciding | High burn, customers who come back only every **10-12 months**, mechanics resigning under the workload after a fast expansion |
| **Taskbob, Doormint, Tooler** (home services, 2016-2017) | Shut down | Could not raise follow-on money; refunds, rework and failed bookings ate the margin; a dozen near-identical startups arrived at once |
| **Housejoy** | Survived only by reshaping itself repeatedly | Short runway after 2015; materials cost about 30% of spend |
| **Zimmber, EasyFix** | Acquired (Quikr) | Consolidation, not growth |
| **Homejoy** (US, 2015) | Shut down | Bought customers with discounts who did not come back; legal pressure over worker classification |
| **BeepKart** (Bengaluru two-wheeler marketplace) | Shut down after merger attempts failed | Funding winter |

## 3. What this means for Sahayak (the reverse engineering)

1. **A breakdown is a rare event.** A driver needs roadside help once or twice a year, so an
   app-only consumer business pays acquisition cost again for almost every job (Autto.in's
   10-12 month return cycle). The survivors sell through someone who already has the driver:
   insurers, carmakers, fleets, and subscriptions (ReadyAssist, HONK, Urgently).
   **Do next:** a B2B entry point. Fleet or insurer accounts that create jobs for their drivers
   and get billed monthly. The job model (owner, vehicle, job, assignment) already fits; what is
   missing is an organisation account and invoicing, which wait on G3 (who holds the money).
2. **Partner supply decides everything.** Urban Company's real cost is partner acquisition;
   Autto.in died when mechanics quit. Sahayak already scores on acceptance and rating, verifies
   documents, and shows earnings. **Do next:** partner payouts (G3) and a minimum-earnings view
   per shift, before scaling. A city with too few partners gets "no partner found", and that
   owner does not come back.
3. **Verify supply, never fake it.** GoMechanic's collapse started with fictitious garages and
   inflated numbers. Sahayak shows no invented counts (rule A in both apps), verifies partners by
   document, and audits staff actions. Keep it that way under investor pressure.
4. **Disputes and refunds are core work.** Every complaint site has refund and quality disputes.
   Sahayak now has price approval (ADR-039), tow photos (ADR-042) and a staff Reports inbox. Refunds
   that move money still wait on G3.
5. **Fixed prices win trust.** Urban Company and YourMechanic both lead with upfront prices.
   Sahayak shows the price before sending (ADR-028) and caps changes without approval at +10%
   (ADR-039).
6. **Do not grow faster than the checks.** Autto.in and GoMechanic both broke while expanding.
   Launch one area, with enough verified partners to answer within the ETA, then widen.
7. **Gig-worker law now costs money.** From 21 November 2025 the Code on Social Security lets
   the government require aggregators to pay 1-2% of turnover into a fund for gig workers (capped
   at 5% of what is paid to them). Karnataka's 2025 Act adds a welfare fee of 1-5% of each payout.
   This belongs in pricing from day one. See `docs/LAUNCH-READINESS-2026-11-21.md`.

## 4. Feature comparison (from public information)

| Feature | ReadyAssist | GoMechanic RSA | Urban Company | HONK | Sahayak |
|---|---|---|---|---|---|
| App request with live tracking | Yes | Yes | Yes (home) | Yes | Yes |
| Price before booking | Plans plus per-service | Not clearly | Yes | Yes | Yes (ADR-028) |
| Partner verification | Claimed | Was faked (2023) | Yes, with training | Yes | Documents plus staff review (ADR-038) |
| Extra charges need customer approval | Not stated | No ("negotiate with mechanic") | Fixed rate card | Not stated | Yes (ADR-039) |
| Start code at the vehicle | Not stated | Not stated | OTP (complaints of misuse) | Not stated | Yes, plus GPS check (ADR-040) |
| Swap a late partner | Not stated | Not stated | Not stated | Not stated | Yes (ADR-041) |
| Tow damage photos | Not stated | Not stated | n/a | Not stated | Yes (ADR-042) |
| Subscription or insurer channel | **Yes (main channel)** | Partly | Plus membership | **Yes (main channel)** | **No** (gap, item 1 above) |
| Two-wheeler support | Yes | Cars only | n/a | Cars | Vehicle types exist; services are car-focused |
| Hindi or regional languages | Not checked | Multilingual helpline | Yes | n/a | **No** (needs a native reviewer) |

## Sources

- [Tracxn: ReadyAssist](https://tracxn.com/d/companies/readyassist/__qoCfBZn_QHQ0PS5q4hWf-SaH1Nd4aelgrkME9SGRHss)
- [Inc42: ReadyAssist funding](https://inc42.com/company/readyassist/funding/)
- [TheKredible: ReadyAssist](https://thekredible.com/company/readyassist/overview)
- [Mobility Outlook: ReadyAssist and AI](https://www.mobilityoutlook.com/features/with-ai-in-action-readyassist-transforms-roadside-help/)
- [TechCrunch: GoMechanic cuts 70% of jobs](https://techcrunch.com/2023/01/18/sequoia-india-backed-gomechanic-faces-severe-trouble/)
- [TechCrunch: GoMechanic acquired by Lifelong-led consortium](https://techcrunch.com/2023/03/28/distressed-indian-startup-gomechanic-acquired-by-lifelong-group-led-consortium)
- [Business Today: GoMechanic boom to bust](https://www.businesstoday.in/amp/entrepreneurship/story/gomechanic-might-stay-afloat-but-its-boom-to-bust-cycle-is-a-cautionary-tale-for-startups-374484-2023-03-23)
- [Inc42: GoMechanic EOW FIR](https://inc42.com/?p=422104)
- [Autocar Pro: GoMechanic roadside network](https://www.autocarpro.in/news/gomechanic-expands-roadside-repair-services-across-india-131824)
- [Inc42: Pitstop acquires MotorWhiz](https://inc42.com/buzz/ushering-synergy-in-car-services-pitstop-announces-acquisition-of-motorwhiz)
- [YourStory: Urban Company first full-year profit](https://yourstory.com/2025/06/urban-company-first-full-year-profit-revenue-jumps-38-ipo)
- [Angel One: Urban Company profit from tax credit](https://www.angelone.in/news/ipos/ipo-bound-urban-company-posts-profit-thanks-to-211-crore-deferred-tax-credit)
- [TechCrunch: HONK and Farmers](https://techcrunch.com/?p=1500171)
- [Coverager: HONK combines with CurbsideSOS](https://coverager.com/honk-combines-with-curbsidesos-following-frontenac-deal/)
- [Urgently Q1 2025 results](https://www.barchart.com/story/news/32379430/urgently-announces-first-quarter-2025-financial-results)
- [Fleet Maintenance: Wrench acquires YourMechanic](https://www.fleetmaintenance.com/in-the-bay/diagnostic-and-repair/press-release/21269915/wrench-inc-wrench-acquires-mobile-vehicle-repair-network-yourmechanic)
- [Failory: Autto.in](https://www.failory.com/interview/autto-in)
- [Inc42: Taskbob shuts down](https://inc42.com/flash-feed/taskbob-shutdown/)
- [The Morning Context: how Housejoy got lost](https://www.themorningcontext.com/internet/how-housejoy-got-lost)
- [TechCrunch: why Homejoy failed](https://techcrunch.com/2015/07/31/why-homejoy-failed-and-the-future-of-the-on-demand-economy)
- [StartupTalky: BeepKart shuts](https://startuptalky.com/news/stellaris-backed-beepkart-shuts-operations/)
- [Financial Express: Speed is of the essence (RSA demand)](https://magzter.com/stories/newspaper/Financial-Express-Ahmedabad/SPEED-IS-OF-THE-ESSENCE)
