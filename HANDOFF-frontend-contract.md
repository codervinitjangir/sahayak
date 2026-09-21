# Frontend contract handoff — for Adarsh

**Date:** 2026-09-17 · **updated 2026-09-21** — the job lifecycle endpoint landed (§6), so job status now actually advances past `assigned` — your tracking screen changes behaviour with no change on your side
**From:** backend (jobs + partner endpoints + auth + dispatch + owner registration + job lifecycle)
**Read time:** ~7 min. Two things need action, one is just confirmation.

---

## 0. TL;DR

| | Status |
|---|---|
| `web/` envelope handling | **Already correct — no action.** You built it before the backend shipped it. |
| `web/` job payload + types | **Action needed.** 4 changes, listed in §2. They 422 today. |
| `mobile/` envelope + base URL | **Already fixed by backend** (§3). Don't redo it. |
| **Auth — `Authorization: Bearer`** | **New, action needed.** Every call except partner registration now needs a Supabase token. `user_id` is gone from the job body. §2.5. |
| **Owner signup** | **Unblocked — you can build the screen now.** `POST /api/v1/users` exists as of 2026-09-20. One call, not two. §2.5c. |
| `current_assignment` / `timeline` on `GET /jobs/{id}` | **Was a server bug, now fixed.** If you tested before 2026-09-20 and those two fields were never there, that was me, not you. §2.2. |
| Partner screens | **Nothing exists yet.** Blocks auth. See §4 — this is the one that needs a decision this week. |
| **Job status past `assigned`** | **Now real — no action, but retest.** Jobs used to freeze at `assigned` forever because no endpoint could move them. Tracking will now show en-route → in-progress → completed. §6. |


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

Fields you have typed that the endpoint does **not** return: `id`, `job_id`, `offered_at`, `responded_at`, `accepted_at`, `distance_at_offer_m`, `matching_score`, `assignment_rank`, `rejection_reason`, `score_components`, `was_baseline_choice`. The last two now exist as columns (the dispatch engine writes them), but they are dispatch-internal audit data and are deliberately not exposed on this route.

⚠️ **Fixed 2026-09-20, and this one was mine.** `current_assignment` was *never actually reaching you*. The response model didn't declare the field while the service was already passing it, and Pydantic drops undeclared keyword arguments silently — so the server built the object on every request and then threw it away, with a `200` and nothing in the log. Same for `timeline` (§2.3). If you already wrote the tracking screen against this and gave up because the field was permanently `undefined`: it works now, your code was probably right. Requires the backend restarted on or after 2026-09-20.

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

Same caveat as §2.2 — this field was being stripped server-side until 2026-09-20. It arrives now.

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
| 403 | `USER_NOT_REGISTERED` | The token is genuine and there is no profile at all. Send them to the **signup screen** — §2.5c. Do **not** log them out and do **not** re-send an OTP. |
| 403 | `IDENTITY_NOT_LINKED` | The token is genuine and an *unclaimed* profile exists that matches their number. Call the link-auth endpoint (below). Do **not** log the user out — that would loop them. |
| 403 | `FORBIDDEN` | Right kind of account, wrong account — e.g. a partner touching another partner's profile. A bug on the client, not a session problem. |

**These first three are three different remedies, so branch on the code, not the status.** All that separates the two 403s is what the server found: `USER_NOT_REGISTERED` means nothing exists and the fix is registration; `IDENTITY_NOT_LINKED` means something exists and the fix is to claim it. Getting them the wrong way round is a dead end in both directions — sending an unlinked mechanic to owner signup fails with `PARTNER_ALREADY_EXISTS`, and sending a brand-new owner to link-auth fails with `USER_NOT_FOUND`. Neither error tells the user anything they can act on.

**Linking a Supabase account to a profile** — once per account, after signup:

```
POST /api/v1/users/{user_id}/link-auth        Authorization: Bearer <token>
POST /api/v1/partners/{partner_id}/link-auth  Authorization: Bearer <token>
```

Returns 200 with `{ id, auth_user_id, ... }`, is idempotent if you re-send the same account, and 409 `AUTH_ALREADY_LINKED` if that profile already belongs to someone else.

✅ **Owner signup was blocked here until 2026-09-20. It isn't any more** — `POST /api/v1/users` exists, and the section below is the shape. Build the screen.

### 2.5b What the two roles can see on `GET /api/v1/jobs/{id}`

The response shape is the same for everyone, but `current_assignment` redacts by caller:

* **The job's owner** and **the assigned partner** get `partner_name`, `partner_phone`, `partner_rating`, `partner_id`.
* **Anyone else** with a valid token gets a `200` with those four fields set to `null`, while `status` and `estimated_arrival_min` stay populated.

So do not assume `partner_name` is present just because `current_assignment` is. Render the contact block conditionally.

### 2.5c Owner signup — `POST /api/v1/users` (new, 2026-09-20)

**One call, not two.** Unlike partners, an owner does *not* register and then link-auth. The endpoint binds the Supabase account inside the same INSERT, so there is no intermediate state to clean up if the second call never happens.

```
POST /api/v1/users        Authorization: Bearer <supabase access token>
```

The token is required even though no profile exists yet — that's the point: it's how the server learns which Supabase account owns the new profile. Send the session you just got from OTP.

**Request:**
```ts
export interface RegisterUserPayload {
  name: string;            // 1–100 chars
  phone: string;           // E.164, e.g. "+919876543210" — max 15 chars
  email?: string;          // optional, max 150 chars
}
```

**`201` response** (`data`, inside the usual envelope):
```ts
export interface RegisteredUser {
  id: string;              // local user id — the FK every later call needs
  name: string;
  phone: string;
  phone_verified: boolean;
  created_at: string;      // ISO 8601
}
```

`id` is the one field worth storing. It's what `vehicle.user_id` and `job.user_id` point at; the Supabase id is not usable as a foreign key anywhere in this API.

No `auth_user_id` and no `email` come back — you sent both, so echoing them tells you nothing.

**Errors:**

| Status | `error.code` | What it means for you |
|---|---|---|
| 400 | `USER_ALREADY_EXISTS` | That phone (or email) is already registered. **Don't retry.** Either they already have an account — in which case something upstream is wrong, since a returning user's token resolves fine and never reaches this screen — or they typed someone else's number. Show it on the phone field. |
| 400 | `PHONE_MISMATCH` | The number in the body isn't the number the token verified. Pre-fill the phone field from the Supabase session and make it read-only and this is unreachable. |
| 409 | `AUTH_ALREADY_LINKED` | This Supabase account already owns a profile (owner *or* partner). Don't show a form error — re-resolve their identity and route them to their home screen; they're already signed up. |
| 422 | `VALIDATION_ERROR` | Field-level; `details[]` names each one. |

**`phone_verified` is server-owned — you cannot set it, and the value you get back may not be what you expect.** It's `true` only when the access token carries a phone claim matching the number submitted. If the account signed in by email or OAuth, the token has no phone claim, registration still succeeds, and the field comes back **`false`**. That is correct and not an error: it records that the number wasn't *proved*, not that it's wrong or unreachable. So don't render it as "unverified number ⚠️" or block anything on it — treat `false` as unknown. (Also relevant: phone sign-in is currently **disabled** on our Supabase project, so in practice everything you register today comes back `false` until that's switched on.)

**The flow end to end:**

```
Supabase OTP / sign-in  →  access token
        ↓
GET anything authenticated  →  403 USER_NOT_REGISTERED
        ↓
POST /api/v1/users  →  201 { id, ... }        ← store id
        ↓
POST /api/v1/jobs   →  201, job.user_id === that id
```

Once registered, the same token resolves on every route with no further setup — no link-auth, no second token, no refresh needed.

**Keep `POST /api/v1/users/{user_id}/link-auth`** in your API module. It is not deprecated, it is just not part of *this* path: it exists for `users` rows that arrive by seed or data migration, which registration can't create. A client that only ever does normal signup will never call it — but if you get a `403 IDENTITY_NOT_LINKED` (not `USER_NOT_REGISTERED`), that's the case it's for.

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
| `IDENTITY_NOT_LINKED` | 403 | Valid Supabase token, and an **unclaimed** profile matching their number exists. Call link-auth. **Don't** log them out — you'll loop. |
| `USER_NOT_REGISTERED` | 403 | Valid Supabase token, **no profile at all**. Send them to owner signup (§2.5c). **Don't** log them out and don't re-OTP — the token is fine. |
| `AUTH_ALREADY_LINKED` | 409 | That profile already belongs to a different Supabase account — or, on `POST /users`, this account already owns a profile. |
| `USER_ALREADY_EXISTS` | 400 | Phone or email already registered (`POST /users`). |
| `PHONE_MISMATCH` | 400 | The phone in the body isn't the one the token verified (`POST /users`). |
| `USER_NOT_FOUND` | 404 | No user with that id (link-auth). |
| `INVALID_STATUS_TRANSITION` | 409 | The job can't go from where it is to where you asked (§6). Includes any move out of `completed`/`cancelled`. Re-read the job, don't retry. |
| `PRICE_FINAL_REQUIRED` | 400 | `status: "completed"` with no `price_final` (§6). |
| `FIELD_NOT_APPLICABLE` | 400 | A body field that doesn't belong with that status — `price_final` on a non-completion, `cancellation_reason` on a non-cancellation (§6). |

The 401 message is deliberately vague — "Token has expired." or "Authentication required." and nothing more. The specific reason (bad signature, wrong audience, wrong issuer, non-UUID subject) goes to the server log under `auth_token_rejected`, not to the client. If you need to know why a token was rejected, quote the `X-Request-ID` and I'll read it out of the log.

Valid `primary_category_code` values: `towing`, `mechanical`, `fuel`.

Interactive docs: `http://localhost:8000/docs` with the backend running.

---

## 6. Job lifecycle — `POST /api/v1/jobs/{job_id}/status` (new, 2026-09-21)

**Read this even though it's a partner endpoint** — the owner-side tracking screen changes behaviour because of it, and you didn't do anything.

### 6.1 What changed for the owner app: nothing, and everything

Until yesterday there was no way — none, in the whole API — to move a job off `assigned`. Dispatch could create a job, offer it, and record a partner accepting it, and then the status stopped moving forever. If `JobTrackingPage` looked like it was stuck polling a job that never progressed, **it was stuck, and it wasn't your code.** That's two of these in two days; the other was §2.2. Sorry.

So: no contract change on your side. `GET /api/v1/jobs/{id}` is the same shape. But `status` will now walk through `partner_en_route` → `in_progress` → `completed`, `current_assignment.status` will move `accepted` → `completed`, `timeline` will grow to six entries, and `price_final` / `completed_at` will stop being null on finished jobs. If any of your UI assumed `assigned` was effectively terminal, that assumption is now wrong.

**Worth building now:** the three states between `assigned` and `completed` are the whole point of a tracking screen. `timeline[]` gives you `{status, changed_at, note}` per step, in order, which is enough for a progress stepper with timestamps and no extra calls.

### 6.2 The endpoint itself (for whenever the partner client exists)

```
POST /api/v1/jobs/{job_id}/status
Authorization: Bearer <partner's supabase token>
```

```jsonc
// body
{
  "status": "partner_en_route" | "in_progress" | "completed" | "cancelled",
  "price_final": 1250.50,          // required when status="completed", rejected otherwise
  "cancellation_reason": "string"  // optional, ONLY with status="cancelled"
}
```

Returns `200` with `{ job_id, status, price_final, completed_at, cancelled_at, cancellation_reason, assignment_status }` inside the usual envelope. `assignment_status` is the half you can't otherwise see — it's what the partner's job list is filtered on.

**Legal moves.** Anything else is `409`:

```
assigned ──▶ partner_en_route ──▶ in_progress ──▶ completed
    │                │                  │
    └────────────────┴──────────────────┴──▶ cancelled

completed ──▶ ✗        cancelled ──▶ ✗        (terminal, nothing leaves them)
```

You can't request `assigned`, `matching`, `requested` or `no_match_found` at all — those belong to dispatch, and asking for one is a `422` naming the four you can send. A partner can't rewind their own job.

**Errors, and what to do about each:**

| | |
|---|---|
| `404 JOB_NOT_FOUND` | No such job. |
| `403 FORBIDDEN` | You're not the partner on this job — **or** the job id is real but belongs to someone else. Deliberately the same answer for both, so a job's status can't be probed by a stranger sweeping transitions at it. Don't log them out. |
| `409 INVALID_STATUS_TRANSITION` | Re-fetch the job; your local copy is behind. Don't retry the same call. |
| `400 PRICE_FINAL_REQUIRED` | You sent `completed` without a price. |
| `400 FIELD_NOT_APPLICABLE` | You sent a field that doesn't belong with that status. Refused rather than ignored, so "the price was saved" is never a thing you believe wrongly. |
| `422 VALIDATION_ERROR` | Unknown status value, or a negative price. |

Note the ordering: on a **finished** job, the partner who finished it gets `409` (truthful: it's done), anyone else gets `403`. Both are correct, they're just answering different questions.

### 6.3 Two things to not get wrong

**`price_final` is a number in rupees, sent by the partner, and it is final.** There's no edit-after-completion path and no dispute flow. If the pilot needs one, it's a new endpoint and a conversation — don't build a UI that implies the price can be changed.

**Cancellation here is the partner cancelling.** There is currently **no owner-side cancel endpoint** — `POST /api/v1/jobs/{id}/status` is partner-only and an owner calling it gets `403`. If the owner app has a "cancel my booking" button, it has nothing to call yet. Tell me and I'll build it; I deliberately didn't fold owners into this route, because a partner-authenticated endpoint that quietly also accepts owners is the kind of thing nobody notices until it's a permissions bug.




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



message — 2026-09-20

Owner signup is unblocked. §2.5c of HANDOFF-frontend-contract.md is new and has the
full shape; three other sections changed under it.

The short version: POST /api/v1/users, with the Authorization header on it even though
no profile exists yet — that's how the server learns which Supabase account the new
profile belongs to. Body is { name, phone, email? }, you get back 201 with the local
id, and that id is the thing to store: it's what job.user_id and vehicle.user_id point
at. The Supabase id isn't a foreign key anywhere in this API. It's ONE call, not the
register-then-link-auth pair partners do — the account gets bound in the same insert,
so there's no half-finished state to handle if the second call never lands.

One new error code you have to branch on: 403 USER_NOT_REGISTERED. It is NOT the same
as IDENTITY_NOT_LINKED, and please don't collapse them — they have opposite remedies.
USER_NOT_REGISTERED means nothing exists, send them to signup. IDENTITY_NOT_LINKED
means a profile exists unclaimed, call link-auth. Cross them over and both dead-end:
an unlinked mechanic sent to owner signup gets PARTNER_ALREADY_EXISTS, a new owner sent
to link-auth gets USER_NOT_FOUND. Neither 403 should ever log the user out or re-send
an OTP — the token is valid in both cases, and treating it as a login failure loops
them through OTP entry forever with no exit.

phone_verified is server-owned. You can't set it, and it may come back false even on a
perfectly good signup — it's true only when the token carries a phone claim matching
the number you sent. Phone sign-in is disabled on our Supabase project right now, so
in practice everything you register today reads false. Don't render that as a warning
badge and don't gate anything on it; false means "not proved", not "bad number". If
you pre-fill the phone field from the Supabase session and lock it, you'll also never
see the 400 PHONE_MISMATCH.

Separately, and this one's an apology: current_assignment and timeline were never
actually reaching you on GET /jobs/{id}. Response model didn't declare the two fields
while the service was already passing them, and Pydantic drops undeclared kwargs
silently — so the server built both on every single request and binned them, 200, no
log line, nothing to notice. If you built JobTrackingPage against those and gave up
because they were permanently undefined, your code was probably fine. Fixed 2026-09-20,
§2.2 and §2.3. Pull and restart the backend before you retest.

Still open from last time: §4 item 1, same app with a role switch or a separate build.
That's now the only thing on the list that's waiting on you.



message — 2026-09-21

Job status actually moves now. §6 of HANDOFF-frontend-contract.md is new — it's a
partner endpoint, but read it anyway, because your tracking screen behaves differently
from today and you didn't change anything.

Short version: until yesterday nothing in the entire API could move a job off
'assigned'. Dispatch created it, a partner accepted it, and it sat there forever. So
if JobTrackingPage looked like it was polling a job that never progressed — it was,
and that was my gap, not your bug. Second one of these in two days after the
current_assignment thing, so I'd rather say it plainly than let you find it.

Nothing in the contract changed. GET /jobs/{id} is the same shape. What changes is
that status now walks partner_en_route → in_progress → completed, current_assignment
.status goes accepted → completed, timeline grows to six entries, and price_final and
completed_at stop being null on finished jobs. If anything in the UI treated 'assigned'
as the last state, that's now wrong. The three intermediate states are the whole reason
a tracking screen exists, and timeline[] already gives you {status, changed_at, note}
in order — enough for a stepper with timestamps, no extra calls.

One thing I need from you rather than the other way round: there is no owner-side
cancel endpoint. The new route is partner-only and an owner hits 403 on it. If the
owner app has a "cancel my booking" button anywhere, it currently has nothing to call.
Say the word and I'll build it as its own endpoint — I didn't want to quietly let
owners into a partner-authenticated route, because that's a permissions bug waiting to
be discovered later.

Three new error codes in the §5 table: 409 INVALID_STATUS_TRANSITION (re-fetch, don't
retry), 400 PRICE_FINAL_REQUIRED, 400 FIELD_NOT_APPLICABLE.

Still open from last time, and now it's the only thing: §4 item 1 — same app with a
role switch, or a separate build?
