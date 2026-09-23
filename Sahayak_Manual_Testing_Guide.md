# Sahayak — Manual Testing Guide (cURL & Postman)

A complete, copy-paste-ready guide to test every backend feature built so far using **Postman** or **cURL**. Use this for your own sanity checks and for demoing to your mentor without needing to read code.

---

## ⚙️ Base URL & Environment Setup

### 1. URLs
* **Local:** `http://localhost:8000/api/v1` *(Note: `/health` is unversioned at `http://localhost:8000/health`)*
* **Deployed (Render):** `https://sahayak-backend-1zzq.onrender.com/api/v1`

> ⚠️ **Note for Demo:** Local backend connects 100% to Supabase PostgreSQL pooler. If demoing locally, run:
> ```bash
> cd backend
> uvicorn app.main:app --reload --port 8000
> ```

---

### 2. Postman Environment Setup (Do This Once)
In Postman, create an Environment named **"Sahayak Local"** (or click the eye icon in top right → **Add**):

| Variable Name | Initial Value | Description |
| :--- | :--- | :--- |
| `base_url` | `http://localhost:8000/api/v1` | Base API prefix |
| `health_url` | `http://localhost:8000/health` | Health endpoint (unversioned) |
| `token` | *(leave empty)* | Vehicle Owner JWT (auto-saved) |
| `partner_token` | *(leave empty)* | Partner/Mechanic JWT (auto-saved) |
| `vehicle_id` | *(leave empty)* | Registered vehicle UUID (auto-saved) |
| `partner_id` | *(leave empty)* | Registered partner UUID (auto-saved) |
| `job_id` | *(leave empty)* | Created job UUID (auto-saved) |
| `assignment_id` | *(leave empty)* | Job assignment UUID (auto-saved) |

---

## 0. Getting Test JWTs (Auth Setup)

Real endpoints require a Supabase-issued JWT. To get tokens without sending real SMS:

1. **Supabase Dashboard** → your project → **Authentication → Providers → Phone** → Ensure Phone is enabled.
2. Under **Test phone numbers**, add:
   * `+919000000901` with OTP `123456` (For Vehicle Owner)
   * `+919000000902` with OTP `123456` (For Partner / Mechanic)

### Step 0A: Request & Verify OTP for Owner (saves `{{token}}`)

#### In Postman:
1. **Request OTP (Owner):**
   * **Method:** `POST`
   * **URL:** `https://pefyozsahazextxkmhdh.supabase.co/auth/v1/otp`
   * **Headers:**
     * `apikey`: `sb_publishable_52jyLfGSh_bGPgFS_rbmCg_2HHi_MA9`
     * `Content-Type`: `application/json`
   * **Body (raw JSON):**
     ```json
     {
       "phone": "+919000000901"
     }
     ```
2. **Verify OTP (Owner):**
   * **Method:** `POST`
   * **URL:** `https://pefyozsahazextxkmhdh.supabase.co/auth/v1/verify`
   * **Headers:**
     * `apikey`: `sb_publishable_52jyLfGSh_bGPgFS_rbmCg_2HHi_MA9`
     * `Content-Type`: `application/json`
   * **Body (raw JSON):**
     ```json
     {
       "phone": "+919000000901",
       "token": "123456",
       "type": "sms"
     }
     ```
   * **Scripts / Tests Tab (Auto-save token):**
     ```javascript
     const res = pm.response.json();
     if (res.access_token) {
         pm.environment.set("token", res.access_token);
         console.log("Saved Owner Token:", res.access_token);
     }
     ```

#### cURL Equivalent:
```bash
curl -X POST 'https://pefyozsahazextxkmhdh.supabase.co/auth/v1/verify' \
  -H 'apikey: sb_publishable_52jyLfGSh_bGPgFS_rbmCg_2HHi_MA9' \
  -H 'Content-Type: application/json' \
  -d '{"phone": "+919000000901", "token": "123456", "type": "sms"}'
# Save the access_token:
export TOKEN="<paste_access_token_here>"
```

---

### Step 0B: Request & Verify OTP for Partner (saves `{{partner_token}}`)

#### In Postman:
1. Repeat verify with `phone`: `"+919000000902"`, `token`: `"123456"`.
2. **Scripts / Tests Tab:**
   ```javascript
   const res = pm.response.json();
   if (res.access_token) {
       pm.environment.set("partner_token", res.access_token);
       console.log("Saved Partner Token:", res.access_token);
   }
   ```

#### cURL Equivalent:
```bash
export PARTNER_TOKEN="<paste_partner_access_token_here>"
```

---

## 1. Health Check

Verifies server liveness and PostgreSQL database connectivity.

### In Postman:
* **Method:** `GET`
* **URL:** `{{health_url}}` *(i.e. `http://localhost:8000/health`)*
* **Headers:** None needed
* **Body:** None
* **Expected Response:** `200 OK`
  ```json
  {
    "data": {
      "status": "ok",
      "database": "connected"
    },
    "meta": {
      "request_id": "ab90a9e1-..."
    }
  }
  ```

### cURL:
```bash
curl http://localhost:8000/health
```

---

## 2. User Registration

Registers a vehicle owner and binds their account with Supabase JWT.

### In Postman:
* **Method:** `POST`
* **URL:** `{{base_url}}/users`
* **Headers:**
  * `Authorization`: `Bearer {{token}}`
  * `Content-Type`: `application/json`
* **Body (raw JSON):**
  ```json
  {
    "name": "Test Owner",
    "phone": "+919000000901",
    "email": "test@example.com"
  }
  ```
* **Scripts / Tests Tab:**
  ```javascript
  const res = pm.response.json();
  if (res.data && res.data.id) {
      pm.environment.set("user_id", res.data.id);
  }
  ```
* **Expected Response:** `201 Created`
  ```json
  {
    "data": {
      "id": "75e138ea-...",
      "name": "Test Owner",
      "phone": "+919000000901",
      "phone_verified": true,
      "created_at": "..."
    }
  }
  ```

**Duplicate Check:** Send the exact same request again.
* **Expected:** `400 Bad Request` with `error.code: "USER_ALREADY_EXISTS"`.

### cURL:
```bash
curl -X POST $BASE/users \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "Test Owner", "phone": "+919000000901", "email": "test@example.com"}'
```

---

## 3. Vehicle Registration (Owner-side)

Registers the owner's vehicle (vehicle is automatically linked to the authenticated user from their JWT).

### Step 3A: Register Vehicle

#### In Postman:
* **Method:** `POST`
* **URL:** `{{base_url}}/vehicles`
* **Headers:**
  * `Authorization`: `Bearer {{token}}`
  * `Content-Type`: `application/json`
* **Body (raw JSON):**
  ```json
  {
    "vehicle_type": "four_wheeler",
    "make": "Maruti",
    "model": "Swift",
    "vehicle_number": "KA01AB1234"
  }
  ```
* **Scripts / Tests Tab:**
  ```javascript
  const res = pm.response.json();
  if (res.data && res.data.id) {
      pm.environment.set("vehicle_id", res.data.id);
      console.log("Saved vehicle_id:", res.data.id);
  }
  ```
* **Expected Response:** `201 Created`
  ```json
  {
    "data": {
      "id": "4c1c0c88-...",
      "vehicle_type": "four_wheeler",
      "make": "Maruti",
      "model": "Swift",
      "vehicle_number": "KA01AB1234",
      "created_at": "..."
    }
  }
  ```

#### cURL:
```bash
curl -X POST $BASE/vehicles \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"vehicle_type": "four_wheeler", "make": "Maruti", "model": "Swift", "vehicle_number": "KA01AB1234"}'
```

---

### Step 3B: List My Vehicles

#### In Postman:
* **Method:** `GET`
* **URL:** `{{base_url}}/vehicles`
* **Headers:**
  * `Authorization`: `Bearer {{token}}`
* **Body:** None
* **Expected Response:** `200 OK` (Array containing the vehicle registered above)

#### cURL:
```bash
curl $BASE/vehicles -H "Authorization: Bearer $TOKEN"
```

---

## 4. Partner Registration & Setup (Mechanic-side)

### Step 4A: Register Partner (Signup)
*No authentication required for initial onboarding.*

#### In Postman:
* **Method:** `POST`
* **URL:** `{{base_url}}/partners`
* **Headers:**
  * `Content-Type`: `application/json`
* **Body (raw JSON):**
  ```json
  {
    "name": "Raj Auto Services",
    "phone": "+919000000902",
    "primary_category_code": "mechanical"
  }
  ```
* **Scripts / Tests Tab:**
  ```javascript
  const res = pm.response.json();
  if (res.data && res.data.id) {
      pm.environment.set("partner_id", res.data.id);
      console.log("Saved partner_id:", res.data.id);
  }
  ```
* **Expected Response:** `201 Created`, `verification_status: "pending"`, `is_available: false`.

#### cURL:
```bash
curl -X POST $BASE/partners \
  -H "Content-Type: application/json" \
  -d '{"name": "Raj Auto Services", "phone": "+919000000902", "primary_category_code": "mechanical"}'
```

---

### Step 4B: Link Partner Auth Account
Binds the Supabase account of the mechanic to their profile.

#### In Postman:
* **Method:** `POST`
* **URL:** `{{base_url}}/partners/{{partner_id}}/link-auth`
* **Headers:**
  * `Authorization`: `Bearer {{partner_token}}`
* **Body:** None
* **Expected Response:** `200 OK`

#### cURL:
```bash
curl -X POST $BASE/partners/$PARTNER_ID/link-auth \
  -H "Authorization: Bearer $PARTNER_TOKEN"
```

---

### ⚠️ Step 4C: Verify Partner in Database (CRITICAL for Dispatch)
> **Why this is required:** The scoring & dispatch engine deliberately filters out unverified mechanics (`WHERE verification_status = 'verified'`) to protect stranded drivers. Since partner document verification is done by internal ops, verify this test partner in Supabase SQL Editor:

```sql
UPDATE partners SET verification_status = 'verified' WHERE id = '<paste_partner_id_here>';
```
*(If testing locally via Python or psql, run the update query above).*

---

### Step 4D: Link Services Offered

#### In Postman:
* **Method:** `POST`
* **URL:** `{{base_url}}/partners/{{partner_id}}/services`
* **Headers:**
  * `Authorization`: `Bearer {{partner_token}}`
  * `Content-Type`: `application/json`
* **Body (raw JSON):**
  ```json
  {
    "service_codes": ["battery_jumpstart", "flat_tyre"]
  }
  ```
* **Expected Response:** `200 OK` with both services listed.

#### cURL:
```bash
curl -X POST $BASE/partners/$PARTNER_ID/services \
  -H "Authorization: Bearer $PARTNER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"service_codes": ["battery_jumpstart", "flat_tyre"]}'
```

---

### Step 4E: Toggle Availability (Go Online)

#### In Postman:
* **Method:** `PATCH`
* **URL:** `{{base_url}}/partners/{{partner_id}}/availability`
* **Headers:**
  * `Authorization`: `Bearer {{partner_token}}`
  * `Content-Type`: `application/json`
* **Body (raw JSON):**
  ```json
  {
    "is_available": true
  }
  ```
* **Expected Response:** `200 OK`, `is_available: true`.

#### cURL:
```bash
curl -X PATCH $BASE/partners/$PARTNER_ID/availability \
  -H "Authorization: Bearer $PARTNER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"is_available": true}'
```

---

### Step 4F: Update Live Location (Writes to Redis)

#### In Postman:
* **Method:** `POST`
* **URL:** `{{base_url}}/partners/{{partner_id}}/location`
* **Headers:**
  * `Authorization`: `Bearer {{partner_token}}`
  * `Content-Type`: `application/json`
* **Body (raw JSON):**
  ```json
  {
    "lat": 12.9716,
    "lng": 77.5946
  }
  ```
* **Expected Response:** `200 OK`, `partner_id` and timestamp returned. *(Data is saved directly in Redis geospatial key `sahayak:partner_locations`).*

#### cURL:
```bash
curl -X POST $BASE/partners/$PARTNER_ID/location \
  -H "Authorization: Bearer $PARTNER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"lat": 12.9716, "lng": 77.5946}'
```

---

## 5. Create a Job (Auto-Triggers Dispatch & Scoring Engine)

### Step 5A: Raise Assistance Request

#### In Postman:
* **Method:** `POST`
* **URL:** `{{base_url}}/jobs`
* **Headers:**
  * `Authorization`: `Bearer {{token}}`
  * `Content-Type`: `application/json`
* **Body (raw JSON):**
  ```json
  {
    "vehicle_id": "{{vehicle_id}}",
    "service_code": "battery_jumpstart",
    "pickup_lat": 12.9720,
    "pickup_lng": 77.5950,
    "pickup_address_text": "MG Road, Bengaluru",
    "issue_description": "Car battery drained completely"
  }
  ```
* **Scripts / Tests Tab:**
  ```javascript
  const res = pm.response.json();
  if (res.data && res.data.id) {
      pm.environment.set("job_id", res.data.id);
      console.log("Saved job_id:", res.data.id);
  }
  ```
* **Expected Response:** `201 Created`

#### cURL:
```bash
curl -X POST $BASE/jobs \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "vehicle_id": "'"$VEHICLE_ID"'",
    "service_code": "battery_jumpstart",
    "pickup_lat": 12.9720,
    "pickup_lng": 77.5950,
    "pickup_address_text": "MG Road, Bengaluru",
    "issue_description": "Car battery drained completely"
  }'
```

---

### Step 5B: Check Job Details & Confirm Auto-Dispatch

#### In Postman:
* **Method:** `GET`
* **URL:** `{{base_url}}/jobs/{{job_id}}`
* **Headers:**
  * `Authorization`: `Bearer {{token}}`
* **Body:** None
* **Scripts / Tests Tab:**
  ```javascript
  const res = pm.response.json();
  if (res.data && res.data.current_assignment) {
      pm.environment.set("assignment_id", res.data.current_assignment.id);
      console.log("Saved assignment_id:", res.data.current_assignment.id);
  }
  ```
* **Expected Response:** `200 OK`
  * `status`: `"matching"`
  * `current_assignment`: Not null! Shows status `"offered"`, partner details (`name`, `phone`, `rating`), and `assignment_rank: 1`.
  * `timeline`: Includes both `"requested"` and `"matching"`.

#### cURL:
```bash
curl $BASE/jobs/$JOB_ID -H "Authorization: Bearer $TOKEN"
```

---

## 6. Partner Responds to Offer (Accept or Reject)

### In Postman:
* **Method:** `POST`
* **URL:** `{{base_url}}/job-assignments/{{assignment_id}}/respond`
* **Headers:**
  * `Authorization`: `Bearer {{partner_token}}`
  * `Content-Type`: `application/json`
* **Body (raw JSON):**
  ```json
  {
    "action": "accept"
  }
  ```
* **Expected Response:** `200 OK`
  * `assignment_status`: `"accepted"`
  * `job_status`: `"assigned"`

*(Note: If you send `{"action": "reject", "rejection_reason": "Too far"}`, the engine automatically searches for and offers the job to the Rank-2 next-best partner!)*

### cURL:
```bash
curl -X POST $BASE/job-assignments/$ASSIGNMENT_ID/respond \
  -H "Authorization: Bearer $PARTNER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action": "accept"}'
```

---

## 7. Job Lifecycle Transitions (Partner-side)

The legal status flow enforced by the state machine is:
$$\mathbf{assigned} \longrightarrow \mathbf{partner\_en\_route} \longrightarrow \mathbf{in\_progress} \longrightarrow \mathbf{completed}$$

### Step 7A: Partner En Route
* **Method:** `POST`
* **URL:** `{{base_url}}/jobs/{{job_id}}/status`
* **Headers:** `Authorization: Bearer {{partner_token}}`, `Content-Type: application/json`
* **Body (raw JSON):**
  ```json
  {
    "status": "partner_en_route"
  }
  ```
* **Expected:** `200 OK`

### Step 7B: In Progress (Mechanic reached & started repair)
* **Method:** `POST`
* **URL:** `{{base_url}}/jobs/{{job_id}}/status`
* **Headers:** `Authorization: Bearer {{partner_token}}`, `Content-Type: application/json`
* **Body (raw JSON):**
  ```json
  {
    "status": "in_progress"
  }
  ```
* **Expected:** `200 OK`

### Step 7C: Job Completed
* **Method:** `POST`
* **URL:** `{{base_url}}/jobs/{{job_id}}/status`
* **Headers:** `Authorization: Bearer {{partner_token}}`, `Content-Type: application/json`
* **Body (raw JSON):** *(price_final is mandatory on completion)*
  ```json
  {
    "status": "completed",
    "price_final": 350.00
  }
  ```
* **Expected:** `200 OK`, `completed_at` is stamped, `price_final: 350.00`.

---

## 8. Owner-side Cancellation

If the driver finds help before completion:

### In Postman:
* **Method:** `POST`
* **URL:** `{{base_url}}/jobs/{{job_id}}/cancel`
* **Headers:**
  * `Authorization`: `Bearer {{token}}`
  * `Content-Type`: `application/json`
* **Body (raw JSON):**
  ```json
  {
    "cancellation_reason": "Found alternative assistance"
  }
  ```
* **Expected Response:** `200 OK`, `status: "cancelled"`.

---

## 9. Security & Error Handling (Demo These to Impress Your Mentor)

### 9A: Unauthorized (No Bearer Token)
* **Method:** `GET`
* **URL:** `{{base_url}}/jobs/{{job_id}}`
* **Headers:** (Remove Authorization header)
* **Expected:** `401 Unauthorized` with `WWW-Authenticate: Bearer`.

### 9B: Malformed Token
* **Method:** `GET`
* **URL:** `{{base_url}}/jobs/{{job_id}}`
* **Headers:** `Authorization: Bearer invalid.garbage.token`
* **Expected:** `401 Unauthorized`.

### 9C: Role-Based Access Control Violation (Partner cannot register vehicle)
* **Method:** `POST`
* **URL:** `{{base_url}}/vehicles`
* **Headers:** `Authorization: Bearer {{partner_token}}`
* **Expected:** `403 Forbidden` *(Only vehicle owners can register vehicles)*.

### 9D: State Machine Violation (Skipping steps)
* Try jumping from `assigned` straight to `completed`:
* **Expected:** `409 Conflict` with error code `INVALID_STATUS_TRANSITION`.

### 9E: Terminal State Protection
* Try changing status on an already `completed` or `cancelled` job:
* **Expected:** `409 Conflict` with error code `JOB_ALREADY_TERMINAL`.

---

## 📁 Recommended Postman Collection Hierarchy

```text
Sahayak API Collection
├── 0. Auth Setup
│   ├── Request OTP (Owner)
│   ├── Verify OTP (Owner) — [Sets {{token}}]
│   ├── Request OTP (Partner)
│   └── Verify OTP (Partner) — [Sets {{partner_token}}]
├── 1. Health
│   └── Liveness & DB Check
├── 2. Users
│   └── Register User — [Sets {{user_id}}]
├── 3. Vehicles
│   ├── Register Vehicle — [Sets {{vehicle_id}}]
│   └── List My Vehicles
├── 4. Partners
│   ├── Register Partner — [Sets {{partner_id}}]
│   ├── Link Auth
│   ├── Link Services
│   ├── Toggle Availability (Online)
│   └── Update GPS Location (Redis)
├── 5. Jobs & Dispatch
│   ├── Create Job (Auto-Dispatch) — [Sets {{job_id}}]
│   └── Get Job Details — [Sets {{assignment_id}}]
├── 6. Assignment Flow
│   └── Partner Respond (Accept / Reject)
├── 7. Job Lifecycle
│   ├── Status: Partner En Route
│   ├── Status: In Progress
│   └── Status: Completed (with price_final)
├── 8. Cancellation
│   └── Cancel Job (Owner)
└── 9. Security & Guardrail Tests
    ├── 401 Missing Token
    ├── 401 Malformed Token
    ├── 403 Role Violation (Partner registering vehicle)
    └── 409 Invalid Status Transition
```
