# Sahayak — 100% Working Plan

> Goal: har role ka flow **real backend data** se chale, koi fake fallback / hardcoded price / simulated match na ho.
> Rule: "Done" tabhi jab test + build pass ho aur manually flow verify ho.

---

## Phase 0 — Safety checkpoint
- [x] Uncommitted Phase 2 work ka git checkpoint commit
- [x] Current gaps ka honest audit
- [x] Ye plan file

## Phase 1 — Backend truth layer
- [x] `GET /services` mein `base_price` add karo (mobile/web hardcoded prices hataane ke liye)
- [x] `jobs` mein `start_code` column + migration 008
- [x] Job create par 4-digit start code generate
- [x] `GET /jobs/{id}` mein owner ke liye `start_code`, pickup lat/lng, owner name/phone, service code/name, vehicle_id add
- [x] `POST /jobs/{id}/start` endpoint — partner code verify kare tabhi `in_progress`
- [x] `GET /partners/me/services` add (fleet tab real data ke liye)
- [x] `GET /partners/me/earnings` add (today/week, completed jobs se)
- [x] Idempotency-Key ka real dedup (jobs table unique index + replay)
- [x] Unit tests: services price, start code, job detail visibility, start endpoint, idempotency (440 pass)

## Phase 2 — Mobile owner flow (no simulation)
- [ ] `SEEDED_SUB_SERVICES` hatao; `GET /services` + `base_price` se options banao
- [ ] Quick suggestion prices catalogue se lo, hardcoded ₹199/₹299/₹499 hatao
- [ ] Fake default vehicle (`veh_primary`, `KA-01-MJ-5021`) hatao; no vehicle par request disable + add-vehicle CTA
- [ ] Job create fail ho to error dikhao, **fake match nahi**
- [ ] `notes` ki jagah backend ka `issue_description` bhejo
- [ ] Idempotency-Key generate karke bhejo
- [ ] Created job ka `price_estimate` use karo, local price nahi
- [ ] Matched screen par sirf real partner data; fake "Rescue Van / KA-01-RC-9021 / 234 jobs" hatao
- [ ] Start code backend se lo (local store ka `"4821"` hatao)
- [ ] Owner ko job complete karne ka button na do; status poll se `in_progress`/`completed` auto-update
- [ ] Fake payment pill ("UPI Google Pay ••4032") hatao; "Pay after service"
- [ ] Receipt mein real `price_final`/`price_estimate`, fake ₹50 tax hatao
- [ ] Rating sirf completed job par
- [ ] Manual test: create → match → start → complete → rate

## Phase 3 — Mobile partner flow (no fake online)
- [ ] `BackendPartnerOfferItem` ko nested backend shape se match karo
- [ ] `partnerStats.partner_id` store karo
- [ ] Go Online → `PATCH /partners/{id}/availability`; fail par toggle wapas
- [ ] Online hote hi GPS permission + `POST /partners/{id}/location`; 30s beacon
- [ ] Fake wallet ₹1450 / HDFC ****4812 / 1.5x surge / ₹128.4K / 4.9★ hatao; real stats/earnings dikhao
- [ ] Fake "job_003" offer card hatao; empty state "Waiting for requests"
- [ ] `IncomingOfferScreen`: real `offer.job.*`, no 499/2.5km/KA-01 fallbacks; accept ke liye assignment_id mandatory
- [ ] `ActiveJobScreen`: real coords, owner name/phone, vehicle number; initial step en_route
- [ ] Start code verify `POST /jobs/{id}/start`; galat code par error
- [ ] Complete job par real `price_estimate`/`price_final`; hardcoded 450 hatao
- [ ] Fleet tab: real partner services + catalogue prices; fake "dispatch synced" alert hatao
- [ ] Activity tab: real jobs/earnings; fake 9,840 / 24 rescues / "Tata Nexon EV" hatao
- [ ] Login: fake `usr_<phone>` profile creation hatao; needs-signup/network par honest message
- [ ] Manual test: go online → offer → accept → en route → code → complete

## Phase 4 — Web partner verification (real, not localStorage)
- [ ] Backend: `GET/POST /partners/me/documents` (file upload + list)
- [ ] Backend: `POST /partners/me/documents/{id}/reupload`
- [ ] Backend: `GET /partners/me/profile` (partner + docs + equipment + services)
- [ ] Static uploads mount + size/type validation
- [ ] Web: VerificationStatus ko React Query se real API par shift karo
- [ ] Web: partnerStore/localStorage status hatao (sirf UI preferences ke liye rakho)
- [ ] Web: signup documents actually upload karo
- [ ] Admin partner panel: pending docs list + approve/reject with reason
- [ ] Manual test: upload → admin approve → partner verified

## Phase 5 — Admin ops
- [ ] Live jobs board (`GET /admin/jobs` with filters)
- [ ] Manual dispatch override (`POST /admin/jobs/{id}/assign`)
- [ ] Web admin panel wire karo
- [ ] Manual test: no-match job → admin manually assign

## Phase 6 — Landing / Rule A
- [ ] `ReviewsSection.tsx` fake testimonials delete ya real data se replace
- [ ] Rule A script ko strong karo: `usr_`, hardcoded ₹ amounts, `setTimeout.*matched`, `localStorage` verification patterns pakdo
- [ ] Dono web/mobile Rule A pass

## Phase 7 — Tests, E2E, docs
- [ ] Backend unit suite (413+) green
- [ ] Web vitest green without Node 26 workaround (ya documented workaround)
- [ ] Mobile tests + typecheck green
- [ ] Real backend E2E: owner + partner + admin walkthrough
- [ ] Update ROADMAP/TASKS/CLAUDE/FRONTEND-GUIDE/INVENTORY to truth
- [ ] Final commit

---

## Definition of Done (overall)
1. Owner app se real job create hota hai, real partner match hota hai, code verify hota hai, complete + rating save hoti hai.
2. Partner app ka online/offline aur GPS backend par jaata hai; offer accept/decline real hai.
3. Web partner verification documents backend par upload hote hain aur admin approve karta hai.
4. Kisi bhi screen par fake price, fake ID, fake partner, ya fake status nahi dikhta.
5. Tests/builds green + manual E2E proof.
