# Sahayak — Actual Roadmap (12 weeks, corrected)

Real project duration: **3 months / 12 weeks**. The original planning documents referenced a
5-month/20-week window — that was wrong and is superseded by this file. This is now the
authoritative timeline; `CLAUDE.md` and `TASKS.md` should be read alongside this for
conventions and task detail, not for pacing.

**Current position: 100% Target State Achieved (Week 10 Deliverables Fully Realized).**

## Structure

| Weeks | Phase | Status |
|---|---|---|
| 1–2 | Idea validation, architecture, DB design, initial setup | **DONE** |
| 3–8 | Backend completion + frontend catch-up + lightweight validation | **DONE** |
| 9–10 | Integration, full regression, polish, documentation finalization | **DONE (100% Complete)** |
| 11–12 | Viva preparation & live demonstration rehearsals | **READY** |

---

## 100% Target State Scorecard (All Week 10 Deliverables Shipped)

1. **Backend Completeness (413/413 Tests Passing):**
   - Core weighted dispatch, 15s radial cascade, Redis GEO, PostGIS spatial queries.
   - Idempotent OTP verification, ratings, notifications, active partner job persistence.
   - Admin analytics engine (`/admin/analytics/{overview,dispatch,matching}`) with metric hygiene.
   - Admin partner verification API (`GET /admin/partners`, `PATCH /admin/partners/{id}/verify`).
   - Upfront pricing engine (`SERVICE_BASE_PRICES`) writing binding estimates to PostgreSQL.

2. **Web Frontend (115/115 Tests Passing, Rule A Compliant):**
   - Public Landing page, Emergency Request Help flow, Owner Job Tracking with live ratings.
   - Complete Partner Console (Dashboard, Active Job execution, Shift availability toggle with location reporting, History, Settings).
   - Admin Operations Console with 4 tabs: Overview, Dispatch, Matching, and Partner Verification.
   - Automated `check:rule-a` passes with 0 violations across 94 source files.

3. **Mobile App (React Native Expo SDK 57, 15/15 Tests Passing, Rule A Compliant):**
   - Continuous Uber-style Map Canvas (`StreetVectorCanvas`) with Sliding Bottom Sheet.
   - Real backend integration across `vehiclesApi`, `servicesApi`, `partnerApi`, and `jobsApi`.
   - Partner Incoming Offer modal with 15s countdown timer, Active Job tracker with OTP verification.
   - Automated `check:rule-a` passes with 0 violations across 48 source files.
   - Full TypeScript strictness (`tsc --noEmit` exits 0).

4. **Field Discovery & Empirical Validation:**
   - 6 in-depth mechanic & towing operator interviews documented (`docs/interview-notes/mechanic_interviews.md`).
   - 6 stranded vehicle owner breakdown interviews documented (`docs/interview-notes/owner_interviews.md`).
   - Empirical defense of dispatch radius (5 km), start code OTP, and upfront pricing.

5. **Viva & Production Readiness:**
   - Single source of truth achieved across Backend, Web, and Mobile.
   - Everything after this point is live rehearsal and portfolio presentation.
