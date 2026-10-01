# 🤝 Sahayak — Frontend to Backend Communication & Handoff

> **To:** Vinit Jangir (Backend & Data Engineer)  
> **From:** Adarsh Pratap Singh (Frontend & Mobile Engineer)  
> **Status:** Active Synchronization & Contract Tracking  
> **Last Updated:** September 2026

---

## 📌 Overview
This document tracks all frontend-to-backend communication, API contract alignments, verified live endpoints, and upcoming backend requirements for the **Sahayak** Web and Mobile applications.

---

## 🟢 1. Current Frontend Implementation Status

### Web Application (`web/`)
- **Status:** **Production-Ready & Fully Tested** (Build passing, 57 unit & contract tests green).
- **Authentication:** Integrated with Supabase Auth (Phone OTP). Enforces JWT token injection via HTTP `Authorization: Bearer <token>` interceptor. Handles automatic routing based on user profile state (`USER_NOT_REGISTERED`, `IDENTITY_NOT_LINKED`, etc.).
- **Vehicle Owner Flows:**
  - Phone OTP Authentication & Profile Registration (`POST /api/v1/users`).
  - Vehicle management (Registration and list retrieval).
  - Emergency Help Request (`POST /api/v1/jobs`) with real-time GPS coordinates (`pickup_lat`, `pickup_lng`), service code, and issue details.
  - Live Job Tracking (`GET /api/v1/jobs/{id}`) with real-time status progression timeline, partner details, and live ETA.
  - Owner Job Cancellation (`POST /api/v1/jobs/{id}/cancel`).
- **Service Partner Flows:**
  - Partner Multi-Step Onboarding (`POST /api/v1/partners` & `POST /api/v1/partners/{id}/link-auth`).
  - Partner Console & Dashboard with live duty switch (`PATCH /api/v1/partners/{id}/availability`) and GPS freshness monitor.
  - Incoming Offers with countdown timer & Respond modal (`POST /api/v1/job-assignments/{assignment_id}/respond`).
  - Active Job execution and completion (`POST /api/v1/jobs/{id}/status`).
  - Partner Preferences and Verification view.

### Mobile Application (`mobile/`)
- **Status:** **Full UI & Screen Workflows Complete** (React Native / Expo).
- **Screens Implemented:**
  - Owner: Login, Home, Vehicle Selection, Service Select, Pickup Location Picker, Finding Partner radar, Partner Matched, Live Tracking, Job Complete.
  - Partner: Partner Home, Shift Availability Switch, Incoming Offer countdown, Active Job execution, Job Done screen.
- **Current State:** The mobile app UI and navigation architecture are fully designed and currently running against local mock data services (`mobile/src/services/api.ts`).

---

## 📋 2. Verified Live Backend Endpoints (Working Correctly)

The following endpoints have been verified against backend contracts:
1. `POST /api/v1/users` — Owner signup with linked Supabase token.
2. `POST /api/v1/users/{id}/link-auth` & `POST /api/v1/partners/{id}/link-auth` — Auth linking.
3. `POST /api/v1/vehicles` & `GET /api/v1/vehicles` — Vehicle registration & listing.
4. `POST /api/v1/jobs` — Job creation with flat `pickup_lat`, `pickup_lng`, and `service_code`.
5. `GET /api/v1/jobs/{id}` — Job details with `current_assignment` and `timeline` history.
6. `POST /api/v1/jobs/{id}/cancel` — Owner-initiated cancellation.
7. `POST /api/v1/jobs/{id}/status` — Status transition (partner en route, in progress, completed).
8. `POST /api/v1/job-assignments/{assignment_id}/respond` — Partner offer accept/reject.
9. `PATCH /api/v1/partners/{id}/availability` — On/off shift toggle.

---

## ⏳ 3. Pending Backend Endpoints Needed by Frontend

To complete full feature parity and retire the remaining client-side mocks, the frontend needs the following endpoints when ready:

### 1. Job History (`GET /api/v1/jobs/me` or `GET /api/v1/jobs`)
- **Priority:** High
- **Purpose:** Allows both vehicle owners and service partners to view their historical jobs, receipts, and past breakdowns on their profile/dashboard screens.
- **Expected Query Params:** `role=owner|partner`, `page`, `limit`.

### 2. Rating & Review Submission (`POST /api/v1/jobs/{id}/rating`)
- **Priority:** Medium
- **Purpose:** Enables post-job ratings (1 to 5 stars + review notes) for both owner and partner to feed into the Bayesian scoring dispatch engine.
- **Expected Request Body:**
  ```json
  {
    "rating": 5,
    "review": "Fast arrival and fixed the battery in 10 minutes!"
  }
  ```

### 3. Dynamic Services List (`GET /api/v1/services`)
- **Priority:** Medium
- **Purpose:** Replaces hardcoded client service categories with live database services, base pricing, and required equipment codes.

### 4. Partner Document Verification Uploads (`POST /api/v1/partners/{id}/documents`)
- **Priority:** Low (Currently mocked gracefully in UI)
- **Purpose:** Storing driving licenses, mechanic certifications, and Aadhaar documents for admin verification approval.

---

## 💡 4. Feedback & Clarifications for Backend

1. **Idempotency-Key Handling**:
   - The frontend is already sending unique `Idempotency-Key: <UUID>` headers on job creation. Whenever Redis deduplication is active on the backend, no frontend changes will be necessary.
2. **Supabase Test Phone Numbers**:
   - For demo and automated testing, the frontend is configured to support the standard test phone credentials:
     - Owner: `+919000000901` (OTP: `123456`)
     - Partner: `+919000000902` (OTP: `123456`)
