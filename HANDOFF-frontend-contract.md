# Frontend contract handoff — for Adarsh

**Date:** 2026-09-17 (updated same day — auth landed, see §2.5)
**From:** backend (jobs + partner endpoints + auth)
**Read time:** ~5 min. Two things need action, one is just confirmation.

---

## 0. TL;DR

| | Status |
|---|---|
| `web/` envelope handling | **Already correct — no action.** You built it before the backend shipped it. |
| `web/` job payload + types | **Action needed.** 4 changes, listed in §2. They 422 today. |
| `mobile/` envelope + base URL | **Already fixed by backend** (§3). Don't redo it. |
| **Auth — `Authorization: Bearer`** | **New, action needed.** Every call except partner registration now needs a Supabase token. `user_id` is gone from the job body. §2.5. |
| Partner screens | **Nothing exists yet.** Blocks auth. See §4 — this is the one that needs a decision this week. |


---

## 1. The response envelope — confirmation, not a change request

Every backend response is now enveloped.

**Success:**
```json
{ "data": { ... }, "meta": { "request_id": "..." } }
```

**Failure:**
```json
{ "error": { "code": "...", "message": "...", "details": ["..."] }, "request_id": "..." }
```

`error.code` is the stable, machine-readable half — branch on that. `error.message` is written for humans and may be reworded without notice. `details` appears only on 422 validation failures.

`web/src/services/api.ts` and `web/src/types/api.ts` already model this exactly, and every `jobs.service.ts` method already returns `res.data`. **Nothing to change here.** This section exists so you know the shape is now real on the server, not just anticipated.

Every response also carries an `X-Request-ID` header matching `meta.request_id`. If you quote that id in a bug report, the backend can find the exact request in the logs.

---

## 2. `web/` — 4 changes needed

These are yours to make; they sit inside your type model and I did not want to rewrite it out from under you.

### 2.1 `CreateJobPayload` — currently 422s

`web/src/types/jobs.ts:91` and the call site at `web/src/pages/owner/RequestHelpPage.tsx:97`.

```diff
 export interface CreateJobPayload {
   vehicle_id: string;
-  service_id: number;
-  pickup: LocationPoint;
+  service_code: string;
+  pickup_lat: number;
+  pickup_lng: number;
+  pickup_address_text?: string;
   drop_location?: LocationPoint;
   issue_description?: string;
   issue_photo_urls?: string[];
 }
```

There is no `user_id` field — see §2.5. The server takes it from your token.

Call site becomes:

```diff
       const newJob = await createJobMutation.mutateAsync({
         payload: {
           vehicle_id: selectedVehicleId,
-          service_id: selectedServiceId,
-          pickup: pickupLocation,
+          service_code: selectedServiceCode,
+          pickup_lat: pickupLocation.lat,
+          pickup_lng: pickupLocation.lng,
+          pickup_address_text: pickupLocation.address,
           issue_description: issueDescription || undefined,
           issue_photo_urls: photoUrls.length > 0 ? photoUrls : undefined,
         },
         idempotencyKey,
       });
```

**Why codes instead of ids:** a service id is a database detail. `"flat_tyre"` is readable in a log, stable across environments, and doesn't break if the seed data is reloaded in a different order. The PRD was updated to match on 2026-09-17.

**Valid `service_code` values** (these are the whole set right now):
`flatbed_towing`, `wheel_lift_towing`, `battery_jumpstart`, `flat_tyre`, `minor_repair`, `fuel_delivery`

**Why flat lat/lng instead of nested `pickup`:** the server builds a PostGIS point from them directly. Note the coordinate order trap — PostGIS writes `POINT(lng lat)`, longitude first. The backend handles that internally; you just send two named floats and never have to think about it.

### 2.2 `current_assignment` — wrong shape

`web/src/types/jobs.ts:81` types this as the full `JobAssignment` row. `GET /api/v1/jobs/{id}` returns a flattened view instead, joined to the partner:

```ts
export interface CurrentAssignment {
  status: AssignmentStatus;
  partner_id: string | null;
  partner_name: string | null;
  partner_phone: string | null;
  partner_rating: number | null;
  estimated_arrival_min: number | null;
}
```

`null` while the job is still unmatched. The partner fields are independently nullable — an offer can exist before a partner resolves.

Fields you have typed that the endpoint does **not** return: `id`, `job_id`, `offered_at`, `responded_at`, `accepted_at`, `distance_at_offer_m`, `matching_score`, `assignment_rank`, `rejection_reason`, `score_components`, `was_baseline_choice`. The last two don't exist as columns yet at all — they're deferred with the dispatch engine.

### 2.3 `timeline` — new field, not yet typed

`GET /api/v1/jobs/{id}` now returns the full status history, oldest first:

```ts
export interface JobTimelineEntry {
  status: JobStatus;
  changed_at: string;   // ISO 8601
  note: string | null;
}
```

Add `timeline: JobTimelineEntry[]` to `Job`. It always has at least one entry (`"requested"` / `"Job created"`), so `JobTrackingPage` can render a real progress trail instead of a single current-status badge.

### 2.4 Fields `Job` claims that the endpoints don't return

`pickup_location` is **not** in either response — `OwnerHome.tsx:127` reads `job.pickup_location.lat` and will throw. Use `pickup_address_text`, which is returned. If you genuinely need coordinates back on the client, say so and I'll add them; they were left out deliberately because a stranded person's exact position is sensitive and shouldn't travel further than it must.

`service` and `partner` (the nested convenience objects) are also not returned. `service_id` is; there's no `GET /services` yet to resolve it against (see §2.6).

### 2.5 `user_id` is gone from the request body — auth has landed

**Updated 2026-09-17.** This section previously said `POST /api/v1/jobs` took `user_id` in the body as an interim hole. That is no longer true: the Auth module shipped, and `user_id` has been **removed from `JobCreateRequest` entirely**. Sending it now does nothing — Pydantic drops unknown fields — so a client that still sends it will silently create the job against *the token's* user, not the id it sent.

What you need instead, on every call except partner registration:

```
Authorization: Bearer <supabase access token>
```

The token comes from Supabase Auth (phone OTP). The backend does not send OTPs and does not issue tokens; it only verifies them. Get the access token from the Supabase JS client's session and put it on the request.

Responses you should handle:

| Status | `error.code` | What it means for you |
|---|---|---|
| 401 | `UNAUTHORIZED` | No token, malformed token, or expired. Refresh the session and retry once; if it fails again, send them to login. |
| 403 | `IDENTITY_NOT_LINKED` | The token is genuine but no local profile is bound to it. Call the link-auth endpoint (below). Do **not** log the user out — that would loop them. |
| 403 | `FORBIDDEN` | Right kind of account, wrong account — e.g. a partner touching another partner's profile. A bug on the client, not a session problem. |

**Linking a Supabase account to a profile** — once per account, after signup:

```
POST /api/v1/users/{user_id}/link-auth        Authorization: Bearer <token>
POST /api/v1/partners/{partner_id}/link-auth  Authorization: Bearer <token>
```

Returns 200 with `{ id, auth_user_id, ... }`, is idempotent if you re-send the same account, and 409 `AUTH_ALREADY_LINKED` if that profile already belongs to someone else.

⚠️ **Owner signup is still blocked** and this is on me, not you: there is no endpoint that *creates* a `users` row. A brand-new owner can get a valid Supabase token and will then hit 403 `IDENTITY_NOT_LINKED` forever, because there is no profile for link-auth to point at. Partners are fine — `POST /api/v1/partners` creates their profile. Don't build the owner signup screen against a registration endpoint yet; ask me first, it's a backend gap I've flagged and not invented a shape for.

### 2.5b What the two roles can see on `GET /api/v1/jobs/{id}`

The response shape is the same for everyone, but `current_assignment` redacts by caller:

* **The job's owner** and **the assigned partner** get `partner_name`, `partner_phone`, `partner_rating`, `partner_id`.
* **Anyone else** with a valid token gets a `200` with those four fields set to `null`, while `status` and `estimated_arrival_min` stay populated.

So do not assume `partner_name` is present just because `current_assignment` is. Render the contact block conditionally.

### 2.6 Endpoints you call that don't exist yet

`jobs.service.ts` will 404 on all of these. Not bugs on your side — just not built:

- `GET /jobs` (list) and `GET /jobs/me`
- `POST /jobs/{id}/cancel`
- `POST /jobs/{id}/rating`
- `GET /services`, `GET /services/categories`
- `PATCH /jobs/{id}/accept`, `PATCH /jobs/{id}/complete`

Only `POST /api/v1/jobs` and `GET /api/v1/jobs/{id}` are live. Tell me which of these you need first and I'll sequence it.

**Also:** you send an `Idempotency-Key` header on `createJob`. The backend currently **ignores it** — Redis isn't wired up yet. Keep sending it (the contract will honour it later), but be aware that double-tap protection is not real today.

**Good news:** your `JobStatus` union in `types/jobs.ts:1` matches the database CHECK constraint exactly, all eight values. No change needed.

---

## 3. `mobile/` — already fixed, don't redo

Two things were broken by the backend contract change, so the backend fixed them. Both are in the API boundary only; no screens, types, or business logic were touched.

**`mobile/src/services/api/client.ts`** — added envelope unwrapping in the existing response interceptor. Without it, `apiClient.post<Job>(...).then(r => r.data)` returned `{data, meta}` where the call site expected a `Job`. That failure was silent: the generic is asserted rather than validated, so TypeScript stayed quiet and every field read would have come back `undefined` at runtime. Unwrapped centrally so all six call sites in `jobs.ts` stay exactly as you wrote them. Guarded, so a non-enveloped body passes through untouched.

**`mobile/src/constants/index.ts`** — base URL was `http://10.0.2.2:8000` with no version prefix, so every call 404'd. Now `http://10.0.2.2:8000/api/v1` (and the prod branch likewise).

**Also fixed, and this one was pre-existing:** `client.ts:2` imported `"../constants"`, which resolves to `src/services/constants` — a directory that doesn't exist. `npx tsc --noEmit` failed on it. Corrected to `"../../constants"`. Typecheck is clean now. Flagging it because it was in the file already and you'll want to know why that line moved.

Verified against the live backend: create and fetch both deliver payloads (not envelopes) to the call sites, the timeline comes through, and the error envelope stays intact with `error.code` readable on a 404.

**Still yours in mobile —** `mobile/src/types/index.ts:31`, `JobStatus`, does not match the database:

```
mobile has:  pending | assigned | en_route  | in_progress | completed | cancelled
db has:      requested | matching | assigned | partner_en_route | in_progress | completed | cancelled | no_match_found
```

`pending` and `en_route` are not real values; `matching` and `no_match_found` are missing. `JOB_STATUS` in `constants/index.ts:11` has the same drift. Web's version is correct — copy it across. Same for the `Job` interface, which uses `owner_id` / `service_type` / `location` where the API returns `user_id` / `service_id` / `pickup_address_text`.

---

## 4. The partner-frontend gap — needs a decision this week

**There are no partner screens.** Not in `web/`, not in `mobile/`. No partner API module, no partner types, no partner routes. `mobile/src/features/` has `auth`, `jobs`, `profile`, `tracking` — all owner-side.

Meanwhile the backend now has three live partner endpoints:

| Endpoint | Purpose |
|---|---|
| `POST /api/v1/partners` | Register a mechanic (pending verification, off-shift) |
| `PATCH /api/v1/partners/{id}/availability` | Go on / off shift |
| `POST /api/v1/partners/{id}/services` | Declare which services they can perform |

**Why this is time-sensitive.** The build order is locked: **partner endpoints → auth → dispatch.** Auth has now shipped (§2.5) — which changes this from "coming" to "here". Every partner endpoint above except registration requires a Supabase token today, and a partner can only modify their own profile, so there is no longer any way to drive the partner side except by minting tokens in a script. A mechanic and a vehicle owner authenticate into different home screens with different permissions; that surface still doesn't exist on the client.

And dispatch, which comes next, is unusable without it: the matching engine only offers jobs to partners with `is_available = true`, and nothing today can set that flag except an authenticated partner — i.e. nothing in either app.

**What's actually needed — not a full app, just the shape:**

1. Does the partner use the same app with a role switch, or a separate build? (`UserRole = "owner" | "partner"` already exists in `mobile/src/types/index.ts:3`, which suggests role switch — confirm that's still the plan.) **This is the one I need an answer on.** I built the auth endpoints role-agnostic so either answer works, so this is no longer blocking me — but it blocks you, and it blocks dispatch testing.
2. A partner route tree, even if the screens are stubs.
3. Partner login → `POST /api/v1/partners` (open, no token) → `POST /api/v1/partners/{id}/link-auth` (with token). Two calls, once, at signup.
4. An availability toggle. This is the one screen that genuinely blocks dispatch testing.

Service-code selection and the registration form can come later. Documents, equipment upload and the verification workflow are explicitly **not** in scope yet — those endpoints don't exist.

**Answer #1 when you can.** I shipped auth without waiting, so nothing is stalled on my side, but dispatch testing will be.

---

## 5. Reference — error codes live today

| Code | HTTP | Meaning |
|---|---|---|
| `VEHICLE_NOT_FOUND` | 404 | Vehicle missing, or not owned by this user |
| `JOB_NOT_FOUND` | 404 | No job with that id |
| `INVALID_SERVICE_CODE` | 400 | Unknown service code (message names which) |
| `PARTNER_NOT_FOUND` | 404 | No partner with that id |
| `PARTNER_ALREADY_EXISTS` | 400 | Phone number already registered |
| `INVALID_CATEGORY_CODE` | 400 | Unknown `primary_category_code` |
| `VALIDATION_ERROR` | 422 | Malformed body/path; `details[]` names each field |
| `INTERNAL_ERROR` | 500 | Server fault, safe to retry |
| `UNAUTHORIZED` | 401 | Missing, malformed or expired token. Carries `WWW-Authenticate: Bearer`. Refresh the session, retry once, then send to login. |
| `FORBIDDEN` | 403 | Valid session, wrong account or wrong role for this route. A client bug — don't log them out. |
| `IDENTITY_NOT_LINKED` | 403 | Valid Supabase token, but no local profile bound to it. Call link-auth. **Don't** log them out — you'll loop. |
| `AUTH_ALREADY_LINKED` | 409 | That profile already belongs to a different Supabase account. |
| `USER_NOT_FOUND` | 404 | No user with that id (link-auth). |

The 401 message is deliberately vague — "Token has expired." or "Authentication required." and nothing more. The specific reason (bad signature, wrong audience, wrong issuer, non-UUID subject) goes to the server log under `auth_token_rejected`, not to the client. If you need to know why a token was rejected, quote the `X-Request-ID` and I'll read it out of the log.

Valid `primary_category_code` values: `towing`, `mechanical`, `fuel`.

Interactive docs: `http://localhost:8000/docs` with the backend running.



message

Backend auth shipped — two sections of HANDOFF-frontend-contract.md changed, both affect you.

§2.5 — POST /api/v1/jobs no longer takes user_id in the body. It's removed from the
schema entirely, so if you leave it in it gets silently dropped and the job is created
against whoever the token says you are. Every call except POST /api/v1/partners now
needs "Authorization: Bearer <supabase access token>" — grab it off the Supabase JS
session. Two new responses to handle: 403 IDENTITY_NOT_LINKED means the token is fine
but no profile is bound yet — call the link-auth endpoint, do NOT log them out or
you'll loop them. 401 UNAUTHORIZED means refresh once, then send to login.

§4 — your auth work no longer blocks me; I built the endpoints role-agnostic and
shipped without waiting. But it now runs the other way: your partner client blocks
real dispatch testing. Dispatch only offers jobs to partners with is_available=true,
and that flag can only be set by an authenticated partner — which nothing in either
app can be. I'll drive it with scripted tokens meanwhile, so I'm not stalled, but
it won't be tested through a real client until partner screens exist.

Still need an answer on §4 item 1: same app with a role switch, or a separate build?
UserRole = "owner" | "partner" in mobile/src/types/index.ts suggests role switch —
just confirm. An availability toggle is the one screen that genuinely matters.

Nothing about the signing algorithm affects you — you pass the token through untouched.