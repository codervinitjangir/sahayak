# Sahayak (सहायक) — Frontend-Backend API Contract

**Version:** 1.2.0  
**Updated:** September 2026  
**Scope:** Mobile App (React Native / Expo), Web App, and Backend FastAPI Services

---

## 1. Global Specifications

### 1.1 Base URLs
- **Local Dev:** `http://<LAN-IP>:8000/api/v1`
- **Headers Required:**
  ```http
  Authorization: Bearer <SUPABASE_JWT_TOKEN>
  Content-Type: application/json
  Accept: application/json
  X-Request-ID: <UUID-v4> (optional, returned in all responses)
  ```

### 1.2 Response Envelope

All API endpoints strictly follow the unified response envelope.

#### Success Envelope (`200 OK`, `201 Created`):
```json
{
  "data": { ... },
  "meta": {
    "request_id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
    "timestamp": "2026-09-21T18:00:00Z"
  }
}
```

#### Error Envelope (`4xx`, `5xx`):
```json
{
  "error": {
    "code": "INVALID_STATUS_TRANSITION",
    "message": "Cannot advance job status from completed to partner_en_route.",
    "details": ["Optional array of field-level validation errors"]
  },
  "request_id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d"
}
```

---

## 2. Authentication & User Profile

### 2.1 Owner Signup
- **Endpoint:** `POST /api/v1/users`
- **Auth:** Requires `Authorization: Bearer <token>` (Supabase account link is automatic)
- **Request Body:**
  ```json
  {
    "name": "Adarsh Sharma",
    "phone": "+919876543210",
    "email": "adarsh@example.com"
  }
  ```
- **Response `201 Created`:**
  ```json
  {
    "data": {
      "id": "usr_01HXYZ123456",
      "name": "Adarsh Sharma",
      "phone": "+919876543210",
      "email": "adarsh@example.com",
      "role": "owner",
      "phone_verified": false
    }
  }
  ```

### 2.2 Partner Auth & Registration
- **Partner Registration:** `POST /api/v1/partners/register`
- **Link Auth Identity:** `POST /api/v1/partners/link-auth`

---

## 3. Job Management (Owner Flow)

### 3.1 Create Roadside Assistance Job
- **Endpoint:** `POST /api/v1/jobs`
- **Auth:** Required (`user_id` extracted from JWT)
- **Valid Service Codes:**
  - `flatbed_towing`
  - `wheel_lift_towing`
  - `battery_jumpstart`
  - `flat_tyre`
  - `minor_repair`
  - `fuel_delivery`
- **Request Body:**
  ```json
  {
    "vehicle_id": "veh_01HABC987654",
    "service_code": "flat_tyre",
    "pickup_lat": 28.6139,
    "pickup_lng": 77.2090,
    "pickup_address_text": "Connaught Place, New Delhi",
    "issue_description": "Front left tyre punctured, no spare available",
    "issue_photo_urls": ["https://storage.sahayak.in/issues/photo1.jpg"]
  }
  ```
- **Response `201 Created`:**
  ```json
  {
    "data": {
      "id": "job_01H1234567890",
      "status": "requested",
      "service_code": "flat_tyre",
      "pickup_lat": 28.6139,
      "pickup_lng": 77.2090,
      "created_at": "2026-09-21T18:05:00Z"
    }
  }
  ```

### 3.2 Get Job by ID (Live Tracking)
- **Endpoint:** `GET /api/v1/jobs/{id}`
- **Response `200 OK`:**
  ```json
  {
    "data": {
      "id": "job_01H1234567890",
      "status": "partner_en_route",
      "service_code": "flat_tyre",
      "pickup_lat": 28.6139,
      "pickup_lng": 77.2090,
      "pickup_address_text": "Connaught Place, New Delhi",
      "price_final": null,
      "completed_at": null,
      "cancelled_at": null,
      "current_assignment": {
        "assignment_id": "asg_01H456789",
        "partner_id": "prt_01H888999",
        "partner_name": "Rajesh Kumar",
        "partner_phone": "+919812345678",
        "partner_rating": 4.9,
        "partner_lat": 28.6190,
        "partner_lng": 77.2140,
        "status": "accepted",
        "eta_minutes": 8
      },
      "timeline": [
        { "status": "requested", "changed_at": "2026-09-21T18:05:00Z" },
        { "status": "matching", "changed_at": "2026-09-21T18:05:02Z" },
        { "status": "assigned", "changed_at": "2026-09-21T18:05:30Z" },
        { "status": "partner_en_route", "changed_at": "2026-09-21T18:06:00Z" }
      ]
    }
  }
  ```

---

## 4. Partner Job Lifecycle & State Transitions

### 4.1 Update Job Status
- **Endpoint:** `POST /api/v1/jobs/{id}/status`
- **Auth:** Requires Partner Token (Caller must be the assigned partner)
- **Request Body:**
  ```jsonc
  {
    "status": "partner_en_route" | "in_progress" | "completed" | "cancelled",
    "price_final": 499.00,           // REQUIRED when status="completed", rejected otherwise
    "cancellation_reason": "string"   // OPTIONAL, ONLY permitted when status="cancelled"
  }
  ```

### 4.2 Legal State Machine
```
requested ──▶ matching ──▶ assigned ──▶ partner_en_route ──▶ in_progress ──▶ completed (Terminal)
   │             │             │                │                  │
   └─────────────┴─────────────┴────────────────┴──────────────────┴──▶ cancelled (Terminal)
```

- Status `matching` and `assigned` are controlled by the Dispatch Engine.
- Status `partner_en_route`, `in_progress`, `completed`, and `cancelled` are updated by the assigned Partner.

---

## 5. Error Codes & Client Handling

| HTTP Status | Error Code | Description | Client Action |
|---|---|---|---|
| `401` | `UNAUTHORIZED` | Expired or missing Bearer token | Refresh Supabase session or redirect to Login |
| `403` | `USER_NOT_REGISTERED` | Supabase auth valid, but no user profile exists | Redirect to Owner Signup screen |
| `403` | `IDENTITY_NOT_LINKED` | Partner account exists but auth identity not linked | Call `POST /partners/link-auth` |
| `403` | `FORBIDDEN` | Caller is not assigned to this job | Keep user logged in, display permission alert |
| `404` | `JOB_NOT_FOUND` | Job ID does not exist | Show error message and redirect to Home |
| `409` | `INVALID_STATUS_TRANSITION` | Job state has already moved forward | Re-fetch job details, do not retry same request |
| `400` | `PRICE_FINAL_REQUIRED` | `completed` status sent without `price_final` | Prompt partner for final bill amount |
| `400` | `FIELD_NOT_APPLICABLE` | Sent `price_final` on non-completed status | Strip extraneous fields before calling endpoint |
| `422` | `VALIDATION_ERROR` | Schema validation failed | Check payload formatting and field types |

---

## 6. Mobile Application Role Architecture

- **Single Binary / Universal App:** Customer/Vehicle Owner and Service Partner flows reside in the same React Native (Expo) app.
- **Role Switch:** A toggle in the top-right corner of the login screen allows switching between **Customer / Owner** and **Partner / Mechanic** modes.
- **Persistent State:** Role and session are persisted via Zustand (`authStore.ts`).
