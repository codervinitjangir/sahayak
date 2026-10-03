# Frontend contract handoff — for Adarsh

**Date:** 2026-09-17 · **updated 2026-09-22** — owners can cancel their own bookings now (§7). This is an owner-app endpoint and it's the one thing in here that needs code from you.
**From:** backend (jobs + partner endpoints + auth + dispatch + owner registration + job lifecycle + owner cancellation)
**Read time:** ~8 min. Two things need action, one is just confirmation.

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
| **Owner cancel button** | **New, action needed — this one's yours.** `POST /api/v1/jobs/{id}/cancel` exists as of 2026-09-22. Optional body, and `assignment_status` in the response decides what the confirmation screen says. §7. |
| **`409 PARTNER_AT_CAPACITY` on accept** | **New, 2026-09-25 — action needed on the partner side when you build it.** A full mechanic's accept is now refused, and the refusal must not look like "offer gone". §11.1. |
| **Partner offer screen** | **Unblocked, 2026-09-27.** `GET /api/v1/partners/me/offers` now exists — this was the last backend gap in the partner flow, and it's where `assignment_id` comes from. Shape is decided; build against §10. No owner phone or map pin on an offer card (ADR-017). |
| **`no_match_found` with no offers** | **Confirm only.** Already legal, now more frequent. If your job screen renders an empty offers list without crashing or spinning forever, you're done. §11.2. |
| **Ratings** | **New, 2026-09-29 — one-character fix in `web/`.** `POST /api/v1/jobs/{id}/ratings` is live, two-way. Your `submitRating()` posts to `/rating` (singular) and 404s; the body is already right. Branch the form on `can_rate` from the `GET`, not on your own rules. §12. |


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
  partner_rating_count: number | null;   // added 2026-09-30 — see §12.6
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

* **The job's owner** and **the assigned partner** get `partner_name`, `partner_phone`, `partner_rating`, `partner_rating_count`, `partner_id`.
* **Anyone else** with a valid token gets a `200` with those five fields set to `null`, while `status` and `estimated_arrival_min` stay populated.

So do not assume `partner_name` is present just because `current_assignment` is. Render the contact block conditionally.

**Updated 2026-09-30:** `partner_rating_count` was added to this gate, not beside it — the list above is enforced by a unit test that iterates the gated field names (`backend/tests/unit/test_job_detail_contact_gate.py`), so a future partner field added outside the gate fails the suite rather than quietly leaking. The server also skips the partner lookup entirely for a non-privileged caller rather than fetching the row and nulling the fields afterwards.

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

**Updated 2026-09-29.** Three entries have come off this list since it was written — cancel shipped on the 22nd, the vehicle endpoints on the 23rd, and ratings on the 29th — so read the live set first:

- `POST /api/v1/jobs`, `GET /api/v1/jobs/{id}` — §2.1, §2.5b
- `POST /api/v1/users`, `POST /api/v1/users/{id}/link-auth` — owner signup, §2.5c
- `POST /api/v1/jobs/{id}/status` — partner lifecycle, §6
- `POST /api/v1/jobs/{id}/cancel` — owner cancel, §7
- `POST /api/v1/vehicles`, `GET /api/v1/vehicles`, `GET /api/v1/vehicles/{id}` — §8
- `POST /api/v1/job-assignments/{assignment_id}/respond` — partner accepts or rejects an offer
- `GET /api/v1/partners/me/offers` — partner offer list, §10
- `POST` and `GET /api/v1/jobs/{id}/ratings` — §12
- the partner endpoints in §4

`jobs.service.ts` will still 404 on these. Not bugs on your side — just not built:

- `GET /jobs` (list) and `GET /jobs/me`
- `POST /jobs/{id}/rating` — **singular, and this one is now a typo rather than a gap.** The route shipped as `/ratings`. §12.1.
- `GET /services`, `GET /services/categories`
- `PATCH /jobs/{id}/accept`, `PATCH /jobs/{id}/complete` — note these two are superseded, not pending. Acceptance is `POST /api/v1/job-assignments/{assignment_id}/respond` with `{"action": "accept"}` — keyed on the **assignment** id, not the job id, because what a partner answers is a specific offer. Completion is `POST /api/v1/jobs/{id}/status`, §6.
- `PATCH`/`DELETE` on a vehicle — §8.6

Tell me which of the remaining ones you need first and I'll sequence it.

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

Meanwhile the backend now has six live partner endpoints:

| Endpoint | Purpose |
|---|---|
| `POST /api/v1/partners` | Register a mechanic (pending verification, off-shift) |
| `POST /api/v1/partners/{id}/link-auth` | Bind a Supabase account to the profile, once, at signup |
| `PATCH /api/v1/partners/{id}/availability` | Go on / off shift |
| `POST /api/v1/partners/{id}/location` | Report current position (Redis only, no DB write) |
| `POST /api/v1/partners/{id}/services` | Declare which services they can perform |
| `GET /api/v1/partners/me/offers` | **New 2026-09-27** — outstanding offers, with the `assignment_id` needed to answer them. §10 |

**Update 2026-09-27: question #2 below is closed, #1 is still open.** The offers-endpoint
shape is decided and shipped (§10), so the partner flow has no remaining backend gap:
register → link-auth → go available → poll offers → accept/reject → move the job through
its statuses are all live endpoints. The role-switch question is the only one left, and
it is still yours.

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
| `VEHICLE_NOT_FOUND` | 404 | Vehicle missing, **or** not owned by this user — deliberately the same response for both, on `GET /vehicles/{id}` and on `POST /jobs`. Don't try to tell them apart (§8.5). |
| `INVALID_VEHICLE_NUMBER` | 400 | Registration number is empty, under 4 or over 20 characters after normalisation, or contains something that isn't an ASCII letter or digit (§8.2). The message is user-showable. |
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
| `JOB_ALREADY_TERMINAL` | 409 | Owner tried to cancel a job that's already `completed` or `cancelled` (§7). Not the same as `INVALID_STATUS_TRANSITION` — different remedy: stop showing the cancel button, don't retry with another value. |
| `JOB_NOT_RATEABLE` | 409 | Rating a job that isn't `completed` (§12). Cancelled counts — there was no service to judge. Don't show the rating form until `can_rate` is true. |
| `RATING_ALREADY_SUBMITTED` | 409 | This side of this job has already been rated (§12). Usually a double-tap. Treat it as success on the client — their rating is stored — and re-read the ratings list. |

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

**Cancellation here is the partner cancelling.** The owner-side cancel endpoint now exists — see **§7**, built 2026-09-22 — and it is a *different route*. `POST /api/v1/jobs/{id}/status` stays partner-only; an owner calling it still gets `403`. Don't point the owner app's cancel button at this one.

**The timeline note text changed on this endpoint (2026-09-22).** A partner cancellation used to write `note: "car started"` — whatever they typed. It now writes `note: "Cancelled by partner: car started"`, and with no reason given it writes `"Cancelled by partner"` instead of `null`. Reason: `job_status_history` has no actor column, and now that both roles can write a `cancelled` row, an unprefixed note makes the two indistinguishable. If you render `timeline[].note` raw you'll just see a longer string, which is fine. If you were *parsing* it, or displaying it under a label that already says who did it, you now have "Cancelled by partner: Cancelled by partner". Owner cancellations read `"Cancelled by owner: ..."` symmetrically. This is a stopgap — a proper `changed_by_role` field is coming, and when it does the prefix stays for the old rows.




---

## 7. Owner cancellation — `POST /api/v1/jobs/{job_id}/cancel` (new, 2026-09-22)

**This is yours.** It's the endpoint the §6.3 note asked you about — I built it rather than waiting for the answer, because a booking flow with no cancel button is a product gap and you'd have hit it the first time anyone tested the owner app end to end.

### 7.1 The call

```
POST /api/v1/jobs/{job_id}/cancel
Authorization: Bearer <supabase access token>     # owner's token
```

**Body is optional.** All of these are valid:

```jsonc
// nothing at all — no body, no Content-Type
// or:
{}
// or:
{ "cancellation_reason": "car started on its own" }   // ≤ 500 chars
```

There is **no `status` field** and sending one is a `422`, naming `status` as the offending field. That's deliberate: an owner has exactly one thing they can do to a live job, and a field that doesn't exist can't be abused into posting `"completed"` from a customer's phone. If you've been reading §6 and reached for `{ "status": "cancelled" }` by muscle memory, that's the mistake this catches.

`cancellation_reason` is optional and I'd leave it optional in the UI too — a mandatory reason box on a screen someone's tapping through at the roadside produces a column full of "x", which is worse than nulls because it looks like data. A few preset chips ("found another option", "problem solved itself", "waited too long") plus a free-text field would actually be useful, if you want it.

**200 response:**

```jsonc
{
  "data": {
    "id": "5167850b-a7c4-4417-ae56-db3da708ce8d",
    "status": "cancelled",
    "assignment_status": "cancelled",       // or null — see below
    "cancelled_at": "2026-09-22T11:59:20.418Z",
    "cancellation_reason": "car started on its own"
  },
  "meta": { "request_id": "..." }
}
```

`200`, not `201` or `204`: it changes an existing job, and you need the body — specifically `assignment_status`.

### 7.2 `assignment_status` is the field that decides your confirmation screen

- **`null`** — nobody had been offered this job yet. Say *"Your booking is cancelled."* and nothing more.
- **`"cancelled"`** — a partner was on the hook and has been released. Say *"Your booking is cancelled. We've let the mechanic know."*

Getting this backwards renders a mechanic who never existed, or silently drops the one who was already driving toward them. It's the only field on the response you can't derive from anything else.

It is never `"rejected"`. That value means *the partner was asked and said no* and it feeds their acceptance rate — a customer's decision must never land there. If you're building any partner-side screen later, treat `'cancelled'` on an assignment as neither an acceptance nor a refusal.

### 7.3 It works from every status the owner can actually see

Including the ones the partner endpoint can't touch:

| Job status when they tap cancel | Works? | What happens |
|---|---|---|
| `requested` | yes | No assignment exists. `assignment_status: null`. |
| `matching` | yes | Outstanding offer is withdrawn; the partner can no longer accept it. |
| `no_match_found` | yes | Nobody came. Still cancellable — see below. |
| `assigned` | yes | Accepted partner released, freed for other jobs. |
| `partner_en_route` | yes | Same. No cancellation fee logic exists — flag it if the pilot needs one. |
| `in_progress` | yes | Same. No price is written. |
| `completed` | **no** | `409 JOB_ALREADY_TERMINAL` |
| `cancelled` | **no** | `409 JOB_ALREADY_TERMINAL` |

**Show the cancel button on the first six, hide it on the last two.** That's the whole rule.

`no_match_found` deserves a note because it's the odd one. Partner-side it's a dead end — nobody was ever assigned, so no partner can move it. Owner-side it's still an open request: nobody came, the driver called a tow truck, and the app is showing them a live booking they can't clear. So they can cancel it. If your UI treats `no_match_found` as an end state and hides the cancel button, that's the one case where you'd strand someone.

### 7.4 Errors

| | |
|---|---|
| `401 UNAUTHORIZED` | No/expired token. Refresh once, then login. |
| `403 FORBIDDEN` | Not your job, **or** a partner token. Message is deliberately vague — *"This job belongs to a different account"* — and won't tell you the job's status. Don't log them out. |
| `404 JOB_NOT_FOUND` | Unknown id. |
| `409 JOB_ALREADY_TERMINAL` | Already finished or already cancelled. **Re-fetch the job and hide the button — do not retry.** |
| `422 VALIDATION_ERROR` | You sent `status`, or a reason over 500 chars. |

On the double-tap case: a second cancel on an already-cancelled job is a `409`, not a courteous `200`. I'd rather you see the double-submit than have me hide it — disable the button on the first tap and you'll never get one. The original `cancellation_reason` is not overwritten by the second attempt.

One thing that looks like a bug and isn't: a **stranger** cancelling a **completed** job gets `403`, not `409`. Authorisation is checked before state, so the error code can't be used to probe what state someone else's jobs are in. It means you can't infer "that job is finished" from a 403 — and you shouldn't be asking about jobs that aren't yours anyway.

### 7.5 What it does behind the scenes, in case it matters to you

One transaction: job goes to `cancelled` with `cancelled_at` off the database clock, any open assignment (`offered` *or* `accepted`) closes as `cancelled`, and a `job_status_history` row lands reading `"Cancelled by owner"` or `"Cancelled by owner: <reason>"`. So `GET /jobs/{id}` immediately after reflects all of it, and `timeline[]` gains a final entry — your stepper needs a terminal-cancelled rendering, which it may not have today.

A cancelled job never gets a `price_final` and never gets a `completed_at`. If any owner-app screen reads `price_final` to mean "the job is over", use `status` instead.

Verified against the real database: 54 assertions in `backend/tests/integration/check_job_cancellation.py`, including that a partner's capacity actually goes back down after an owner cancels — measured through the real dispatch query, not a count written by the test.
---

## 8. Vehicles — register, list, fetch (new, 2026-09-23)

**This is the section that unblocks your `createJob` flow properly.** Up to now `vehicle_id` was a field you had to supply with nothing to supply it from — every job I tested was against a vehicle row I put in the database by hand. There is now a real way for an owner to get one, so the owner path is complete end to end for the first time: signup → add vehicle → request help → get matched.

### 8.1 The three calls

All three need `Authorization: Bearer <supabase access token>` and all three are **owner-only** — a partner token gets `403 FORBIDDEN`.

```
POST   /api/v1/vehicles          -> 201, the created vehicle
GET    /api/v1/vehicles          -> 200, array of the caller's vehicles
GET    /api/v1/vehicles/{id}     -> 200, one vehicle
```

**Register:**

```ts
POST /api/v1/vehicles
{
  vehicle_type: "two_wheeler" | "four_wheeler",   // required
  make?: string,                                   // optional, max 50
  model?: string,                                  // optional, max 50
  vehicle_number: string                           // required
}
```

**Do not send `user_id`.** It isn't a field on the schema and the schema is `extra="forbid"`, so sending it is a `422` that names the field rather than a silent no-op. The owner comes from the token, always. This is the same rule as `POST /api/v1/jobs` (§2.5), enforced harder — a vehicle silently registered against the wrong account is worse than a job, because it persists.

**Response shape, identical for all three** (the list wraps it in an array):

```ts
interface Vehicle {
  id: string;                    // uuid — this is your vehicle_id for createJob
  vehicle_type: string | null;
  make: string | null;
  model: string | null;
  vehicle_number: string;
  created_at: string;            // ISO 8601
}
```

Inside the usual envelope: `{ data: Vehicle, meta: { request_id } }`, and `{ data: Vehicle[], meta: {...} }` for the list.

There's no `user_id` in the response. All three calls are already scoped to the caller's token, so it could only ever echo back the id of the account asking.

### 8.2 The registration number rule — send it as typed, display what comes back

The server normalises `vehicle_number`: uppercase, whitespace and dashes removed. `"ka 01 ab 1234"`, `"KA-01-AB-1234"` and `"KA01AB1234"` all store and return as `KA01AB1234`.

**Don't normalise on the client.** Send exactly what the user typed and render the `vehicle_number` the response gives you back. Two implementations of that rule will drift, and mine is the one the database and the job snapshot agree with. If you normalise locally and I change the rule — adding another separator, say — your stored strings and mine stop matching for the same physical car.

What is **not** validated: the format. No regex, no state-series check. Indian plate formats vary too much by state, vehicle class and era (the BH series alone breaks the common `XX 00 XX 0000` assumption), and refusing a real plate on a real car at the roadside is a worse failure than storing an odd string. So don't add a format mask to the input field either — a mask is the same false-rejection problem moved to the client, where it's harder for me to fix.

What **is** rejected, all as `400 INVALID_VEHICLE_NUMBER`:

- fewer than 4 characters after normalisation
- more than 20 characters after normalisation
- anything that isn't a plain ASCII letter or digit once separators are stripped — so `KA01/AB/1234` is refused, and so is a plate with a Cyrillic `А` pasted in from somewhere, which looks identical to a Latin `A` and would otherwise become an invisible duplicate

Length is measured **after** normalisation, so `"K A 0 1 A B 1 2 3 4"` is fine.

### 8.3 Registration numbers are not unique — this matters for your UI

Two accounts can each register the same `vehicle_number`. So can one account, twice. There is no `VEHICLE_ALREADY_EXISTS` error and there will not be one; it's a deliberate decision (ADR-014), not a gap waiting to be closed.

Reasoning, because it affects what you build: a `UNIQUE` constraint means the first person to typo their plate as someone else's permanently locks the real owner out, with an error they can do nothing about. Genuine duplicate and fraud cases are an admin-review problem with both accounts' history in view, not something to refuse at insert time.

**What that means for you:** if you want to stop an owner adding the same car twice, do it as a client-side confirmation prompt — *"You already have a vehicle with this number. Add it anyway?"* — checked against the list you already fetched. Don't expect a 409, and don't build error handling for one. And nothing on the client should use `vehicle_number` as a key, a cache id, or a lookup — it isn't unique today, not merely "might not be later".

### 8.4 An empty list is `200 []`, not a 404

An owner with no vehicles gets `200` and an empty array. That's the state every user is in between finishing signup and adding their first car — the most ordinary moment in the product — so render "add your first vehicle", not an error screen.

### 8.5 Someone else's vehicle is a 404, not a 403

`GET /api/v1/vehicles/{id}` returns `404 VEHICLE_NOT_FOUND` when the vehicle doesn't exist **and** when it exists but belongs to another account. Same status, same code, same message — deliberately indistinguishable, so the endpoint can't be used to test whether a vehicle id is real. Same rule as `GET /api/v1/jobs/{id}` (§2.5b).

So don't write client logic that tries to tell those two apart, and don't treat a 404 on a vehicle you just listed as "deleted" — treat it as "not available to you" and re-fetch the list.

`POST /api/v1/jobs` behaves the same way: creating a job against a `vehicle_id` that isn't yours is `404 VEHICLE_NOT_FOUND`, not 403.

### 8.6 What's not built

No `PATCH` and no `DELETE` on vehicles yet. Deletion is genuinely harder than it looks — `jobs.vehicle_id` points at the row and a job keeps a snapshot of the plate precisely so history stays truthful — so it'll be a soft delete when it lands. If the owner app needs an edit screen, tell me and I'll sequence it; until then, treat the vehicle list as append-only.

Verified against the real database: 54 assertions in `backend/tests/integration/check_vehicle_registration.py`, including the whole chain — register owner → register vehicle → create job → dispatch offers it to a mechanic — driven entirely over HTTP with nothing inserted by hand.

---

## 9. Two people acting on the same job at once — the 409s are now real (2026-09-23)

Nothing in this section changes a request or a response shape. No new endpoint, no new error code, no new field. It is here because a 409 you were already told to handle just became something that can actually happen to a real user, where before it could be raced past.

### 9.1 What changed on the server

`POST /jobs/{job_id}/cancel` (owner) and `POST /jobs/{job_id}/status` (partner) now lock the job row while they decide whether the change is allowed. Before today, if the owner hit cancel at the same moment the mechanic hit "complete", **both calls returned 200** and the job ended up in a state that contradicted itself — marked cancelled but carrying a final price and a completion time, or marked completed with a cancellation time on it. Both clients were told they had won.

Now exactly one of them wins and the other gets a 409 telling it the truth.

### 9.2 What you have to do about it

Treat a 409 on either of those two calls as **"your screen is out of date"**, not as **"something went wrong"**. The right handler is: re-fetch `GET /api/v1/jobs/{job_id}`, render whatever it actually says, and tell the user plainly what happened.

- **Owner app, cancel button → `409 JOB_ALREADY_TERMINAL`.** The mechanic finished the job while the confirmation dialog was open. Re-fetch, and show the completion — including `price_final`, because the owner is being charged for work that genuinely got done. An error toast here is the wrong thing entirely: nothing failed, and the most expensive possible outcome is an owner who thinks their cancellation worked and is then billed.
- **Partner app, when it exists, completing a job → `409 INVALID_STATUS_TRANSITION`.** The owner cancelled while the mechanic was tapping. Re-fetch, and show "this job was cancelled by the customer" — not "couldn't save, try again", which invites a retry that will fail identically forever.

Both codes were already in §5 and §7.4; this is just the first time they can arrive from a race rather than from a stale screen.

### 9.3 Is this likely?

Not on most jobs — it needs two people acting inside the same fraction of a second. But it is not exotic either, and two ordinary situations produce it: a mechanic marking a job complete while the owner, who has been waiting and watching, gives up and cancels; and a double-tap on a slow connection where the first tap is still in flight. Both are more likely during the Month 2 pilot than in normal use, because that is exactly when people are impatient and the network is bad.

### 9.4 Polling is unaffected — measured, not assumed

`GET /api/v1/jobs/{job_id}` deliberately does **not** take the lock. Poll it exactly as often as you do today; nothing needs to change and nothing will slow down. This was worth proving rather than asserting, so it was measured: while a job row was held locked, three concurrent polls all answered normally in well under a second, while a write to the same job could not get through at all for two full seconds. If the tracking screen's polls had started queueing behind every status update, the map would have frozen for the exact duration of each update — so the read was kept free on purpose.

The one thing not to do is start polling *faster* to reduce the race window. It does not shrink it — the window is now closed on the server — and it would just add load.

Verified by 43 assertions against the real database (`backend/tests/integration/check_job_race.py`), firing both calls simultaneously at six separate jobs and confirming exactly one wins each time, with both 409 paths observed live.

### 9.5 Same thing on the partner side — answering an offer (added 2026-09-23)

The third race of this class is now closed too, on `POST /api/v1/job-assignments/{assignment_id}/respond` — note that path is keyed on the **assignment** id, not the job id. Again: no request or response shape changed, and no new error code. What changed is the meaning of an existing one.

**`409 ASSIGNMENT_ALREADY_ANSWERED` on an accept now has a second cause.** It used to mean only "this offer is already settled" — you accepted it twice, or it was rejected, or it timed out. It can now also mean **"the customer cancelled the job while your offer was still open"**. You cannot tell the two apart from the response, and that is deliberate: the alternative was returning a different code depending on which of two near-simultaneous database writes landed first, which would have made your error handling depend on millisecond timing.

So handle it as one case, and handle it as **"this offer is gone"**, not **"that didn't save"**:

- Re-fetch the partner's offer list rather than retrying the accept. The retry will fail identically forever.
- Show something like **"This job is no longer available — the customer cancelled it"** or simply remove the card with "no longer available". Do not show "try again", and do not leave the mechanic looking at a job they think they are on their way to.
- The `message` field on the error is safe to show if you want detail; it names the job's actual status.

Before this fix, that accept returned **200** and the mechanic was committed to a job the customer had already called off — they would have driven to it. Twice in testing it returned a **500** instead, from a database deadlock; that is also gone.

**One behavioural note on reject.** `next_assignment_id` in the reject response can be `null` in one new situation: the job was cancelled in the moment between your rejection being saved and the server looking for the next mechanic. Your rejection is still recorded and still correct — there is just no longer a job to pass on. `null` already meant "nobody else to offer it to", so no code change is needed; just don't treat it as a failure of the reject.

**Nothing to do for the availability toggle or the offer list.** Reads are unaffected, same as §9.4 — poll them exactly as you do now.

Verified by 69 assertions against the real database and 17 unit tests (`backend/tests/integration/check_dispatch_race.py`, `backend/tests/unit/test_dispatch_locking.py`).






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



message — 2026-09-22

Owner cancellation is built. §7 of HANDOFF-frontend-contract.md is new and it needs code
from you — it's the first thing in a while that's genuinely an owner-app task rather than
me telling you something changed underneath you.

You never answered the question from yesterday about whether you wanted it, and I built it
anyway rather than sitting on it. A booking flow with no cancel button isn't an edge case,
and if it was missing you'd have found out during a pilot booking instead of now.

POST /api/v1/jobs/{job_id}/cancel with the owner's token. Body is optional — a bare POST
works, {} works, { "cancellation_reason": "..." } works, 500 chars max. There is no status
field and sending one is a 422; if you've been reading §6 and reach for
{ "status": "cancelled" } out of habit, that's the mistake it's there to catch.

The one field you can't derive from anything else is assignment_status on the response.
null means nobody had been offered the job yet — say "your booking is cancelled" and stop.
"cancelled" means a partner was on the hook and has been released — say "we've let the
mechanic know". Backwards, and you either invent a mechanic who never existed or silently
drop the one already driving toward them.

Show the cancel button on requested, matching, no_match_found, assigned, partner_en_route
and in_progress. Hide it on completed and cancelled, which return 409 JOB_ALREADY_TERMINAL
— re-fetch and hide, don't retry. no_match_found is the one I'd expect a UI to get wrong:
it looks like an end state, and it is for the partner, but for the driver it's an unserved
request still sitting there as a live booking. Nobody came, they called a tow truck, and
they need to be able to clear it.

Two things that'll look like bugs and aren't. A stranger cancelling a *completed* job gets
403, not 409 — authorisation is checked before state, so the error code can't be used to
probe what state other people's jobs are in. And a second tap on cancel gets a 409 rather
than a polite 200; disable the button on the first tap and you'll never see it, but I'd
rather surface a double-submit than hide one.

One thing that affects the partner side of §6 and is my change, not yours: timeline notes
on a cancellation now carry the actor. A partner cancelling used to write note: "car
started"; it now writes "Cancelled by partner: car started", and "Cancelled by partner"
where there's no reason instead of null. Owner cancellations read "Cancelled by owner: ..."
the same way. Reason is that job_status_history has no actor column, and now that both
roles can write a cancelled row, a bare note makes the two indistinguishable — which is
the single most useful thing to know about a cancellation. If you render note raw you just
get a longer string. If you display it under a label that already says who cancelled,
you'll get "Cancelled by partner: Cancelled by partner". It's a stopgap; a real
changed_by_role field is on the list.

Your stepper also needs a terminal-cancelled rendering now, which I don't think it has —
timeline[] can end on cancelled from six different statuses, including before any partner
appears, so the "waiting for mechanic" step may never have completed.

54 assertions against the real database, including that a partner's capacity actually goes
back down after an owner cancels.

Still open, and still the only thing waiting on you: §4 item 1 — same app with a role
switch, or a separate build? Third time asking. The availability toggle is the one screen
that genuinely blocks real dispatch testing.


message — 2026-09-23

Vehicle registration is live. This is the one that actually unblocks your createJob
screen — §8 of HANDOFF-frontend-contract.md is new.

Until today vehicle_id was a field you had to fill with nothing to fill it from; every
job I'd tested used a row I'd inserted into the database by hand. Three endpoints now:
POST /api/v1/vehicles, GET /api/v1/vehicles, GET /api/v1/vehicles/{id}. Owner-only,
Bearer token on all three, response is { id, vehicle_type, make, model, vehicle_number,
created_at } and the id is your vehicle_id.

Four things worth reading before you build the screen:

1. Send the registration number exactly as the user typed it, and display the
vehicle_number the response gives back. The server normalises it — uppercase, spaces
and dashes stripped — so "ka 01 ab 1234" and "KA-01-AB-1234" both come back
"KA01AB1234". Don't normalise locally and don't put a format mask on the input:
Indian plate formats vary enough by state and vehicle class that a mask will refuse a
real plate on a real car, and that failure lands on someone stuck at the roadside.

2. Registration numbers are NOT unique. Two accounts can register the same string,
and so can one account twice. There's no 409 for it and there won't be — a UNIQUE
constraint means the first person to typo their plate as someone else's locks the real
owner out permanently. If you want to prevent a double-add, do it as a confirmation
prompt against the list you already have. And don't use vehicle_number as a key or
cache id anywhere.

3. An owner with no vehicles gets 200 and [], not a 404. Render "add your first
vehicle", not an error — it's the state every user is in right after signup.

4. Someone else's vehicle is 404 VEHICLE_NOT_FOUND, identical to a vehicle that
doesn't exist. Same rule as GET /jobs/{id}. POST /jobs does the same if the
vehicle_id isn't yours.

No PATCH or DELETE on vehicles yet — treat the list as append-only. Say the word if
the owner app needs an edit screen and I'll sequence it.

Also corrected two stale things in the doc while I was in there: §2.6 was still
telling you POST /jobs/{id}/cancel didn't exist (it shipped on the 22nd, §7), and it
listed PATCH /jobs/{id}/accept as pending when it's actually superseded — partner
acceptance is POST /api/v1/job-assignments/{assignment_id}/respond, keyed on the
assignment id rather than the job id.

Still open, still the only thing waiting on me from you: §4 item 1 — same app with a
role switch, or a separate build? Fourth time asking. The partner availability toggle
is the one screen that genuinely blocks testing dispatch through a real client rather
than a script.


follow-up message — 2026-09-23 (send after the vehicles one above, or with it; separate topic)

One behaviour change that isn't a contract change, so nothing you've built breaks —
but it makes a 409 you were already handling actually reachable. §9 of
HANDOFF-frontend-contract.md is new and short.

Until today, if the owner tapped cancel at the same instant the mechanic tapped
complete, both calls returned 200 and the job ended up contradicting itself — marked
cancelled but carrying a final price and a completion time, or the reverse. Both
clients were told they'd won. The server now locks the job while it decides, so
exactly one wins and the other gets a truthful 409.

What that means for you, and it's one rule: a 409 on POST /jobs/{id}/cancel or
POST /jobs/{id}/status means "your screen is out of date", not "something failed".
Re-fetch GET /api/v1/jobs/{id} and render what it actually says.

Concretely, on the owner app: cancel returning 409 JOB_ALREADY_TERMINAL means the
mechanic finished while your confirmation dialog was open. Re-fetch and show the
completion, price_final included, because the owner is being charged for work that
really happened. Please don't show an error toast there — nothing failed, and the
bad outcome is an owner who believes the cancellation worked and then sees a bill.
Same shape on the partner side whenever that client exists: 409 on completing means
the customer cancelled, so show that rather than "couldn't save, try again", which
invites a retry that will fail the same way forever.

Rare, but not exotic — it needs two people inside the same fraction of a second,
which is a mechanic finishing while an impatient owner gives up, or a double-tap on
a bad connection. Both are likelier during the pilot than in normal use.

Polling is unaffected and I measured it rather than assuming: GET /jobs/{id}
deliberately doesn't take the lock, so poll exactly as often as you do now. With a
job row held locked, three concurrent polls all came back in well under a second
while a write to the same job couldn't get through for two full seconds. If the
reads had started queueing behind writes, the tracking map would have frozen for the
length of every status update. One thing not to do: don't poll faster to shrink the
race window — it's closed server-side now, so that would only add load.

43 assertions against the real database, firing both calls simultaneously at six
separate jobs. Worth mentioning how that was checked, because a concurrency test that
has never failed proves nothing: I reverted the fix and re-ran first, and it dropped
to 23 of 43 with the bug reproducing in 5 of 6 trials. Sequential calls can't
reproduce it at all even with the bug present — which is why five green test suites
sat next to it for two days without noticing.

---

## 10. Listing a partner's offers — `GET /api/v1/partners/me/offers` (gap found 2026-09-24, **shipped 2026-09-27**)

**Read this section top to bottom if you are building the partner offer screen — it is
the endpoint that makes that screen possible.** The gap described below is closed; I've
kept the description because it explains why the response looks the way it does.

### What was broken

To answer an offer you call
`POST /api/v1/job-assignments/{assignment_id}/respond`. Until 2026-09-27 there was no way
for a partner client to learn its `assignment_id`:

- the `/partners` router had **no GET route at all** — every route on it was a POST or a
  PATCH;
- `CurrentAssignmentResponse` (which carries `partner_id`, `partner_name`,
  `partner_phone`, ETA) is not an endpoint. It is a nested field on `GET /jobs/{id}`,
  which is the **owner's** view of who is coming to them — a partner cannot read it, and
  it carries no `assignment_id` anyway;
- there was no "list my offers" endpoint at all.

My load-test harness worked around it by reading the ids straight out of Postgres, which
a real app obviously can't do.

### The shipped endpoint

```
GET /api/v1/partners/me/offers
Authorization: Bearer <partner token>
```

`/me`, not `/{partner_id}` — the partner is read from the token, so there is no id in the
URL to pass and none to get wrong. `/api/v1/partners/{someone_else}/offers` does not
exist and won't.

**200** — every offer this partner can still answer, **newest first**:

```json
{
  "data": [
    {
      "assignment_id": "05080fbe-2174-4c27-88e9-586b2a9c312a",
      "job_id": "bffbec91-3810-4681-9557-ace3c88caa2b",
      "offered_at": "2026-09-27T11:03:30.784705Z",
      "distance_at_offer_m": "988.74",
      "estimated_arrival_min": 4,
      "assignment_rank": 1,
      "job": {
        "status": "matching",
        "service_code": "battery_jumpstart",
        "service_name": "Battery Jumpstart",
        "vehicle_number": "GJ01AB1234",
        "pickup_address_text": "Outer Ring Rd, near Marathahalli bridge",
        "issue_description": "Battery dead, car won't start",
        "price_estimate": "450.00",
        "requested_at": "2026-09-27T11:03:29.101422Z"
      }
    }
  ],
  "meta": { "request_id": "8d26eb65-ae63-426e-ab41-9e9ff83c3f2a" }
}
```

`data` is the array itself (same shape as `GET /vehicles`), not an object wrapping one.

Six things worth knowing before you design the card:

1. **`data: []` with a 200 is the normal idle state, not an error.** A mechanic on shift
   with no work pending gets an empty array. Don't render an error screen for it — that
   is the single most common state this endpoint will ever return.
2. **`assignment_id` is the field the screen exists for.** It is what you POST to
   `/job-assignments/{assignment_id}/respond`. `job_id` is *not* interchangeable with it.
3. **It's a list, deliberately.** A partner can hold several outstanding offers at once,
   so there is no "the" current assignment. Don't build a single-offer UI.
4. **`distance_at_offer_m` and `estimated_arrival_min` are snapshots, not live values.**
   They were computed when the engine scored this partner and are never recomputed on
   read — they will drift as the mechanic drives. Label them accordingly ("~1.0 km when
   offered") or recompute client-side from the device's own GPS.
5. **`price_estimate` and `distance_at_offer_m` are JSON strings, not numbers** — they're
   `Decimal` on the server and serialise as strings so nothing rounds in transit. Parse
   before you do arithmetic.
6. **`service_code`, `service_name`, `vehicle_number`, `pickup_address_text`,
   `issue_description` and `price_estimate` are all nullable.** Only `status` and
   `requested_at` are guaranteed inside `job`. Don't `.toUpperCase()` a nullable.

### What is NOT in the response, and won't be

**No owner name, no owner phone number, no `user_id`, and no pickup lat/lng.** This is
deliberate, not an oversight, and it is not a field I can add on request — see
`docs/adr/ADR.md` ADR-017 for the full reasoning. The short version: contact details are
released to the *assigned* partner, and a partner holding an offer hasn't accepted yet.
An offer is a question, and answering "no" must not cost the customer their phone number
— especially since the same job is then offered onward to the next candidate.

So: **the offer card cannot have a "call customer" button or a map pin.** It shows
`pickup_address_text` (the human string — enough to decide whether to take the job) plus
the distance. Both the phone number and the exact coordinates arrive from
`GET /api/v1/jobs/{job_id}` *after* the partner accepts, where they're already gated.

If the mechanic-side design needs turn-by-turn navigation before acceptance, raise it
with me rather than working around it — it's a policy change, not a missing field.

### Errors, and the one you must handle

| Status | Code | When |
|---|---|---|
| 401 | `UNAUTHORIZED` | no token, or an invalid/expired one |
| 403 | `FORBIDDEN` | a valid token that isn't a partner's (e.g. an owner's) |
| 403 | `IDENTITY_NOT_LINKED` | a verified Supabase account not yet bound to a partner profile |

**The important one is a 409 on the *next* call, not on this one.** This list is a
snapshot taken without a row lock (deliberately — see ADR-015; a lock here would queue
every polling app against the accepts it exists to produce). So between reading the list
and tapping Accept, the offer can legitimately go away:

- the owner cancelled the job, or
- this partner already answered it on another device, or
- the offer was re-assigned onward.

`POST /job-assignments/{assignment_id}/respond` then returns
**`409 ASSIGNMENT_ALREADY_ANSWERED`**. Treat that as ordinary traffic, exactly like the
status-transition 409s in §9: show "this job is no longer available", re-read
`/partners/me/offers`, and move on. It is not a bug and not worth an error toast that
blames the user.

**One more 409 to expect: `PARTNER_AT_CAPACITY`.** The list does *not* filter by
capacity, so a partner already holding `MAX_CONCURRENT_JOBS = 2` active jobs still sees
their outstanding offers. That's intentional — hiding them would make the 409 arrive from
nowhere, and the cap can only be enforced correctly at accept time under the lock. See
§11 for that code.

### Polling

There's no push yet (notifications are a scheduled backlog item, not built). Poll this
endpoint while the partner is on shift. It's a single indexed query with no lock and no
transaction — it measured **33–52 ms** server-side in the live harness — but the shared
connection pool is small (5 per worker against a 15-connection Supavisor cap), so please
poll on the order of **5–10 seconds**, not sub-second, and stop polling when the app is
backgrounded or the partner goes off shift.

### Correction to something I told you earlier

An earlier version of this section, and of `adarsh-send-2026-09-25.md` §4, said
`GET /api/v1/partners/{id}/current-assignment` existed and merely lacked an
`assignment_id`. **That was wrong** — there was no such route, and no GET route on
`/partners` at all. Both documents are now corrected. If you designed anything against
that endpoint, it never existed; use the one above.

### Historical note on capacity (now resolved)

The original version of this section warned that holding several offers was *unbounded*:
`MAX_CONCURRENT_JOBS = 2` was checked when picking who to offer a job to and never
re-checked on accept, so a partner offered five jobs could accept all five. I found it
under load (one partner held 4 against a cap of 2). **The re-check landed 2026-09-25** —
accepting past the cap now returns `409 PARTNER_AT_CAPACITY`. See §11. Full measurement
context: `docs/load-test-dispatch-concurrency.md` §7.1.


---

## 11. Two new responses on the partner side, and one on the owner side (added 2026-09-25)

Both of the bugs the load test found (§7.1, §7.2 of the load-test doc) are fixed. One adds a
new error code you have to handle; the other adds no new code at all but makes a state you
may not have expected show up more often. No request shape changed. No response shape
changed.

### 11.1 `409 PARTNER_AT_CAPACITY` — accept can now be refused because the mechanic is full

**Where:** `POST /api/v1/job-assignments/{assignment_id}/respond` with `{"action": "accept"}`.

```
409  {
  "error": {
    "code": "PARTNER_AT_CAPACITY",
    "message": "You are already working the maximum number of jobs (2). This job has been
                offered to another partner."
  }
}
```

**What it means.** The mechanic already holds 2 active jobs (`assigned`,
`partner_en_route` or `in_progress`), and the cap is 2. It is not an error in their app and
not a failed save — it is the platform refusing to overload them.

**How to handle it — and this is the part that differs from every other 409 you handle:**

- **Do not** show "try again". The retry will fail identically until one of their current
  jobs finishes.
- **Do not** remove the offer card and tell them the job is gone. *The offer is still
  `'offered'`.* We deliberately do not mark it rejected — being full is not declining, and
  we are not charging a mechanic's acceptance rate for a limit we imposed. If they finish a
  job in the next few minutes, that same `assignment_id` may become acceptable.
- **Do** show the `message` (it names the cap) or your own copy along the lines of *"You're
  at your job limit — finish a job to take this one."*
- **Do** expect the customer's side to have moved on: we re-offer the job to the next
  candidate immediately, so in practice the card will usually turn into
  `ASSIGNMENT_ALREADY_ANSWERED` on the next tap, once someone else has taken it. Both are
  409s; they are not interchangeable, so branch on `code`, never on the status alone.

**Why it is its own code and not `ASSIGNMENT_ALREADY_ANSWERED`.** The remedies are
opposite. `ASSIGNMENT_ALREADY_ANSWERED` means *this offer is gone, stop showing it*.
`PARTNER_AT_CAPACITY` means *you are full, this offer may work later*. Folding them together
would have forced you to guess which one you had.

**Why it is a 409 and not a 403.** Nothing is wrong with the mechanic's permissions. The
request conflicts with the current state of the world, and it will succeed unchanged once
that state changes — which is exactly what 409 means, and matches how §9's 409s already
behave.

**A repeat tap is safe.** If the mechanic taps a stale offer card again, they get the same
409 and *no* additional job gets re-dispatched — there is a guard for that. You do not need
to debounce it to protect the backend, though debouncing is still nicer for them.

### 11.2 `no_match_found` with zero assignments is a legitimate state to render

**Where:** `GET /api/v1/jobs/{id}` and the owner's job list, right after `POST /api/v1/jobs`.

An owner can now see a job go from `requested` to **`no_match_found`** within a second or
two of creating it, having never been offered to anybody — `assignments` empty, no offers,
no history beyond the two rows. This was always possible (it is what happens when no mechanic
within 10 km offers that service), but it will now also happen when our partner-location
store is unreachable, which is the case the load test caught leaving jobs invisible.

**What you have to do:** nothing new, as long as your job-detail screen does not assume that
a `no_match_found` job has at least one assignment to show. If it renders an empty offers
list, you are already correct. If it crashes, or shows a spinner forever waiting for an
offer that never comes, that is the bug to fix.

**Copy suggestion, same for both causes:** *"We couldn't find a mechanic for this request."*
plus the two actions the owner actually has — **cancel**, or **request again**.
`no_match_found` is deliberately *not* terminal: cancel works from it, and re-requesting is
a fresh `POST /api/v1/jobs`.

**What you should not surface:** the distinction between "nobody was available" and "our
location service was down". The reason is recorded server-side in `job_status_history.note`
(prefix `Dispatch unavailable:`) so that our evaluation numbers don't count an outage as a
legitimate "no mechanics nearby". It is not in the API response, and an owner staring at a
broken-down car does not benefit from the difference — the action available to them is the
same either way. If you ever need it for an admin screen, say so and I will expose it
explicitly rather than have you parse a note.

### 11.3 What did not change

- `POST /api/v1/jobs` still returns **201** even when dispatch fails outright. It was
  measured at 782 ms with the location store hard-timing-out on every call. Keep treating a
  201 as "the job exists"; keep reading `status` from the body rather than assuming
  `matching`.
- Reject is unchanged, including `next_assignment_id: null`.
- Availability toggle, offer reads and polling are unchanged (§9.4 still holds).
- No new status values, so nothing new to add to your status→label map.

Verified by 49 assertions against the real database and 21 unit tests
(`backend/tests/integration/check_dispatch_capacity.py`,
`backend/tests/unit/test_dispatch_capacity.py`), including a control run with both fixes
reverted that reproduces the original defects — 12 accepts landing on a cap of 2, and a job
left silently in `requested`.

---

## 12. Ratings — `POST` and `GET /api/v1/jobs/{job_id}/ratings` (new, 2026-09-29)

Two-way: the owner rates the mechanic, the mechanic rates the owner. **Same two endpoints for
both roles** — no partner-specific route. The server works out which side you are from your
token.

There is one thing in `web/` that this breaks, and one field you should branch on. Both are
below.

### 12.1 The one change needed in `web/` — the path is plural

`web/src/services/jobs.service.ts:78` posts to:

```
POST /jobs/${jobId}/rating
```

The shipped route is `/ratings`. Singular 404s. One character:

```ts
// web/src/services/jobs.service.ts — submitRating()
- await apiClient<void>(`/jobs/${jobId}/rating`, {
+ await apiClient<void>(`/jobs/${jobId}/ratings`, {
```

**Your request body is already correct** — `{ rating, comment }` is exactly what the endpoint
wants, so nothing else in that function changes. Worth saying explicitly because this was a
call into a route that did not exist at all until today; it was never returning 200, so if
you have a `.catch()` swallowing it, that's why it looked fine.

The return type is not `void`, though — you get the stored rating back (§12.3), which is what
you want for rendering it without a re-fetch.

### 12.2 `POST` — submit one side's rating

```
POST /api/v1/jobs/{job_id}/ratings
Authorization: Bearer <supabase access token>

{
  "rating": 5,                              // required, whole number 1-5
  "comment": "Arrived in 12 minutes, sorted it on the spot."   // optional
}
```

`201` with the stored row:

```json
{
  "data": {
    "id": "6b1f...",
    "job_id": "9a3c...",
    "rated_by": "user",
    "rating": 5,
    "comment": "Arrived in 12 minutes, sorted it on the spot.",
    "created_at": "2026-09-29T11:42:08.317Z"
  },
  "meta": { "request_id": "..." }
}
```

Three things about the body:

- **Do not send `rated_by`.** It isn't optional-and-ignored, it's `extra="forbid"` → **422**.
  Same rule as `JobStatusUpdateRequest` and `VehicleCreateRequest` (§2.5). `rated_by` says
  which side of the transaction is speaking, which is an identity claim, so it comes from the
  token. If the body could carry it, an owner could post the mechanic's review of themselves
  and use up the one slot the mechanic had to reply.
- **Do not send `job_id`.** It's in the path, and 422 for the same reason.
- `rating` is an integer. `4.5` is a 422, not a rounded 4 — the column has a `CHECK` for whole
  stars, so a half-star UI has nothing to store.
- A whitespace-only `comment` is stored as `null`, so an untouched textarea and an omitted
  field come back identically. You don't need to strip it yourself.

### 12.3 `GET` — every rating on a job, plus whether to show the form

```
GET /api/v1/jobs/{job_id}/ratings
```

`200`:

```json
{
  "data": {
    "job_id": "9a3c...",
    "job_status": "completed",
    "ratings": [
      { "id": "6b1f...", "job_id": "9a3c...", "rated_by": "user",
        "rating": 5, "comment": "Sorted it on the spot.",
        "created_at": "2026-09-29T11:42:08.317Z" },
      { "id": "7c2e...", "job_id": "9a3c...", "rated_by": "partner",
        "rating": 4, "comment": null,
        "created_at": "2026-09-29T11:48:55.002Z" }
    ],
    "can_rate": false
  },
  "meta": { "request_id": "..." }
}
```

- `ratings` is a **list, 0 to 2 entries**, not a pair of named fields. Each item names its own
  direction via `rated_by`: `"user"` is the owner's verdict on the mechanic, `"partner"` is
  the mechanic's verdict on the owner. Read the direction off the item; don't rely on array
  order.
- **Both parties see both ratings**, including the one written about them. Deliberate: with
  exactly two participants, hiding the author changes nothing — each side already knows who
  the other is — and it means a disagreement about a job is a conversation about the same
  facts.
- Neither party's name or id is in a rating item. If you want to label them, you already know
  who the two participants are from the job.

### 12.4 `can_rate` is the field you branch on — don't re-derive it

Show the rating form when `can_rate` is `true`. Nothing else.

It is computed server-side on purpose, from the same rule that decides whether to *accept* a
rating. To re-derive it in the client you would have to know that the job must be `completed`,
that each side gets exactly one rating, and which side you are. Those three facts drift the
moment one of them changes on the server, and the way it fails is a form that submits into a
409.

`can_rate` is **per side, not per job**: after the owner rates, the owner's `GET` says
`false` and the mechanic's `GET` on the same job still says `true`. Two clients reading the
same endpoint correctly get different answers, so don't cache it across roles or treat it as
part of the job.

### 12.5 Errors

| Code | HTTP | What to do |
|---|---|---|
| `JOB_NOT_FOUND` | 404 | Also what you get for a job that isn't yours — same as everywhere else (§8.5). Don't try to tell them apart. |
| `FORBIDDEN` | 403 | You're a party to nothing on this job. For a mechanic this also covers "someone else took it". Client bug — don't log them out. |
| `JOB_NOT_RATEABLE` | 409 | The job isn't `completed`. Don't retry; you shouldn't have shown the form — `can_rate` was `false`. Cancelled jobs are included: there was no service to judge. |
| `RATING_ALREADY_SUBMITTED` | 409 | This side already rated this job. **Treat it as success** — their rating is stored — and re-read the list. It's almost always a double-tap on a slow connection. |
| `VALIDATION_ERROR` | 422 | `rating` out of 1-5 or non-integer, comment over 1000 chars, or a forbidden field (`rated_by`, `job_id`). `details[]` names it. |

`RATING_ALREADY_SUBMITTED` deserves the emphasis. It comes from a unique constraint, not from
a pre-check, which is what makes it correct under a double-tap: both requests get past any
check you could do first, and without the constraint the second would be a 500. So when you
see it, the user's rating did land — show the thank-you screen, not an error.

### 12.6 What this does on the server, and what it doesn't

Worth knowing because one part of it is visible to you and one part is not:

- **Visible, and it changes a field you already receive:** an owner's rating now moves
  `partners.rating_avg`, which is what `current_assignment.partner_rating` on
  `GET /jobs/{id}` has always been reading. That field has been returning **`0.0` for every
  mechanic since the system started**, because nothing could write the column — so if you ever
  looked at it and assumed the endpoint was stubbed, it wasn't, the number was just genuinely
  zero. From today it's a real average. It's a `Decimal` serialised as a JSON number with one
  decimal place (`4.5`), nullable, and withheld along with name and phone when the caller isn't
  the owner or the assigned partner (§2.5b).
- **Also visible:** the same column feeds the matching algorithm's rating term. Until today
  every mechanic scored identically on that dimension and matching was effectively distance +
  load + skill only. Ratings are now load-bearing rather than decorative (ADR-018 for the full
  story, including the trigger that was supposed to maintain this and never could).
- **Not built, and not coming soon:** there is no owner-side aggregate. A mechanic's rating of
  an owner is stored and returned by the `GET` above, but `users` has no `rating_avg` column
  and nothing reads it. So don't build a "your rating as a customer" display — there's no
  number behind it yet.
- **One thing in your code will throw, and it's adjacent enough to mention:**
  `web/src/pages/owner/JobTrackingPage.tsx:183` reads `job.partner.rating_avg.toFixed(1)` and
  `job.partner.rating_count`. There is no `job.partner` on the response — it's
  `job.current_assignment`, with flat `partner_*` fields, which is §2.2's point and unchanged
  by this task. Mapped across: `rating_avg` → `current_assignment.partner_rating`, and
  `rating_count` → `current_assignment.partner_rating_count` — **added 2026-09-30, after this
  section was first written.** When I flagged it here the count had no equivalent on this
  endpoint and `★ 4.5 (12 jobs)` could not be rendered; it now can. Both fields sit inside the
  same contact gate as name and phone (§2.5b), so both are `null` for a caller who is neither
  the owner nor the assigned partner, and both are `null` before a partner is assigned. Guard
  `.toFixed()` accordingly — it throws on `null`, and `partner_rating` is nullable for those
  two reasons independent of anything you do.
- **Why the count is worth rendering rather than dropping** (the reason I offered it rather
  than just deleting the line): the rating that drives matching is Bayesian-smoothed toward a
  3.5 prior, so `4.9` from two jobs and `4.9` from two hundred are very different claims and
  the average alone cannot tell them apart. A brand-new mechanic reads `null`/`0`, not a bad
  score. Showing the sample size is the difference between a number a user can calibrate and
  one they have to trust blindly.

### 12.7 Verified by

43 unit tests (`backend/tests/unit/test_rating_service.py`) and **44 of 44** live assertions
against the real database and real Supabase tokens
(`backend/tests/integration/check_ratings.py`), plus a control run that restores the old
broken behaviour and fails on exactly the aggregate assertions.

---

## 13. Notifications — the in-app feed (new, 2026-10-01)

Four endpoints. **Both roles use all four** — there is no owner feed route and partner feed
route, the token decides whose rows come back. Same pattern as ratings (§12).

```
GET  /api/v1/notifications                        the feed, newest first
GET  /api/v1/notifications/unread-count           just the badge
POST /api/v1/notifications/{notification_id}/read mark one read
POST /api/v1/notifications/read-all               clear the badge
```

Nothing creates a notification. There is no `POST /notifications` and there will not be — the
server writes them inside the transactions that change a job's status, so a client cannot
assert that something happened. Read-only apart from marking read.

**Nothing in `web/` or `mobile/` calls any of this today** — I grepped both for a request to
`/notifications` and there is none, so this section is new surface rather than a correction and
has no "one change needed" subsection like §12.1.

One thing I did find, and it's the natural place to start: `web/src/pages/partner/components/PartnerTopBar.tsx:67`
already renders the bell. It has **no `onClick`**, and the unread dot on line 73 is rendered
unconditionally — so every partner currently sees a permanently-lit notification badge that
means nothing. Those two lines are now backable by a real number (§13.2) and a real list
(§13.1). There is no equivalent bell on the owner side yet.

### 13.1 `GET /api/v1/notifications` — the feed

```
GET /api/v1/notifications?limit=20&offset=0&unread_only=false
Authorization: Bearer <supabase access token>
```

| Param | Default | Rules |
|---|---|---|
| `limit` | `20` | 1–100. Outside that range is a **422**, not a clamp. |
| `offset` | `0` | ≥ 0. |
| `unread_only` | `false` | Filters the rows. Changes `total`, never `unread_count` — see below. |

`200`:

```json
{
  "data": {
    "items": [
      { "id": "e41a...", "event": "job_completed",
        "message": "Your request has been completed.",
        "job_id": "9a3c...", "is_read": false,
        "sent_at": "2026-10-01T09:14:22.108Z" },
      { "id": "c07b...", "event": "job_accepted",
        "message": "A partner has accepted your request.",
        "job_id": "9a3c...", "is_read": true,
        "sent_at": "2026-10-01T08:51:03.994Z" }
    ],
    "unread_count": 3,
    "total": 11,
    "limit": 20,
    "offset": 0,
    "has_more": false
  },
  "meta": { "request_id": "..." }
}
```

Five things worth stating because each one decides a line of your code:

- **An empty feed is `200` with `items: []`**, not a 404. That's the ordinary state of a new
  account, so render the empty state off `items.length === 0` and never off a status code.
- **`unread_count` is over the whole feed, not the page.** Returned here *as well as* on its
  own endpoint so that opening the list is one request instead of two. It does **not** respond
  to `unread_only` — if it did, the badge would change as the user toggled a filter, which is
  the one thing a badge must not do.
- **`total` does** respond to `unread_only`. So with the filter on, `total` is the unread count
  *after* filtering and `unread_count` is the same number by coincidence; with it off they
  differ. Page off `total`/`has_more`, badge off `unread_count`, and don't cross the two.
- **`has_more`** is `offset + items.length < total`, precomputed. Use it rather than doing that
  arithmetic — it stays right if the paging model ever changes.
- **No `recipient_type` / `recipient_id` on an item.** Every row in the response is addressed
  to you, which is the only way it could be in the response, so the address would be a field
  you'd have to ignore. Don't go looking for it.

Ordering is `sent_at DESC, id DESC`. The second part matters to you in one case: the server
writes all of a cancellation's notifications in one transaction, and `now()` is transaction
start time, so two rows can share `sent_at` **to the microsecond**. The tie-break on `id` is
what stops offset paging from showing you one of them twice and skipping the other. You don't
have to do anything about this, but if you build client-side dedupe keyed on `sent_at`, it
will be wrong.

### 13.2 `GET /api/v1/notifications/unread-count` — the badge

```json
{ "data": { "unread_count": 3 }, "meta": { "request_id": "..." } }
```

This is the one to poll on a timer. It's served from a partial index over unread rows only, so
its cost tracks unread mail rather than feed size — it does not get slower as a user's history
grows, which `GET /notifications` does. **30–60s is a sane interval**; see §13.7 on why
polling is the only option right now.

### 13.3 Marking read — both calls return the same shape

```
POST /api/v1/notifications/{notification_id}/read     no body
POST /api/v1/notifications/read-all                   no body
```

Both `200` with:

```json
{ "data": { "updated": 1, "unread_count": 2 }, "meta": { "request_id": "..." } }
```

- **`updated: 0` is success, not a conflict.** A notification that was already read returns
  `200 { updated: 0 }`, not a 409. Your intent — "this should be read" — holds either way, and
  the overwhelmingly common cause of a repeat is a retry after a dropped response on a phone
  network. So don't show an error on `updated: 0`; the state is what you asked for.
- **`unread_count` in the response is the badge afterwards**, so you never need a follow-up
  call to `/unread-count` after marking something read. Use it directly.
- `read-all` always returns `unread_count: 0` — that's what the call guarantees, so it's
  returned rather than re-queried. `updated` is how many rows it actually changed, which is `0`
  for an account with nothing unread.
- Neither call is scoped to the current page or filter. `read-all` means all.
- **POST, not PATCH**, on both. No body on either — don't send `{}` with a JSON content type
  and expect it to be ignored; send nothing.

### 13.4 The `event` values — this is what you branch on

Eight, and the list is closed today. `message` is prose and **will** be reworded (and
eventually translated), so never match on it.

| `event` | Who receives it | When |
|---|---|---|
| `job_offered` | **partner** | Dispatch offered them this job. Pair it with §10's offer list. |
| `job_accepted` | owner | A partner took the job (`status` → `assigned`). |
| `job_partner_en_route` | owner | Partner started driving. |
| `job_in_progress` | owner | Partner started work. |
| `job_completed` | owner | Job done. Good moment to surface the rating form (§12.4). |
| `job_cancelled_by_owner` | **partner** | The owner called it off on a job this partner held. |
| `job_cancelled_by_partner` | owner | The partner dropped the job. |
| `job_no_match_found` | owner | Dispatch found nobody. See §13.5 on the two causes. |

Two things to read off that table rather than assume:

- **You are never notified of your own action.** The owner does not get a notification for
  their own cancellation; the partner does not get one for their own accept. So a feed is a log
  of what the *other* party did, and an optimistic local update after your own action is not
  going to be duplicated by a notification arriving later.
- **`cancelled` is two events, not one.** `job_cancelled_by_owner` and
  `job_cancelled_by_partner` are separate because the recipient differs, the wording differs,
  and a client needs to render them differently — one is news about someone else's decision,
  the other is the consequence of your own role's job being dropped. Collapsing them would have
  forced you to re-derive which happened from your own role.

**`message` contains no names, no phone numbers, no coordinates, no addresses, no prices and
nothing the user typed.** Not an oversight — a stored string cannot be re-gated, and the
contact-release rules in §2.5b / ADR-017 decide at *read time* who may see a mechanic's name
and number. "Ramesh is on the way" baked into a TEXT column would sit outside that gate
forever. If you want a name in the notification row, fetch it from `GET /jobs/{job_id}` using
the item's `job_id` — that's the endpoint that does the gating, and it'll return `null` for a
caller who isn't entitled.

`job_id` is nullable. It's non-null on all eight events today, but the column is nullable
because account-level notifications (verification approved, payout settled) will not be about a
job. Guard the deep-link, don't assume it.

### 13.5 Errors

| Code | HTTP | What to do |
|---|---|---|
| `NOTIFICATION_NOT_FOUND` | 404 | On `/{id}/read`. Covers both "no such notification" and "it's someone else's" — **identical response, don't try to tell them apart** (principle 6, same as §8.5). Drop the row from your list and move on; it isn't a retry. |
| `UNAUTHORIZED` | 401 | Missing/expired/invalid token. Refresh and retry once, as everywhere else. |
| `VALIDATION_ERROR` | 422 | `limit` outside 1–100, negative `offset`, or a non-UUID `notification_id`. `details[]` names the field. |

There is no 403 on any of these four routes and no 409 on either mark-read. Nothing else can
come back.

`job_no_match_found` is worth one note here even though it isn't an error code: it has **two
genuinely different causes** — nobody was available within range, or the dispatch
infrastructure (Redis location store) was unreachable. They are distinguishable on the server
via the `job_status_history` note (ADR-016), and **not distinguishable by you today** — the
notification, the job status and the job response are identical in both cases. So the honest
copy for this event is "we couldn't find a partner — try again", which is right for both, not
"nobody is available nearby", which is a lie in the second case. If you want the split, it
needs an endpoint that doesn't exist yet; say so and I'll add it.

### 13.6 What I'd build, in order

Not a spec, just the sequencing that gets the most out of this for the least work:

1. **The badge.** Poll `/unread-count` on a timer and drive the dot that
   `PartnerTopBar.tsx:73` already renders unconditionally — that's a one-line condition on a
   number you now have, and it turns a decorative dot into a true one. ~20 lines total, and it
   is the only part of this feature that changes what a user does: it's what makes them open
   the app.
2. **The feed list** on a bell tap: one `GET /notifications` call, `event` → icon + copy,
   `job_id` → deep-link into the existing tracking screen. Mark read on tap, using the
   `unread_count` in the mark-read response to update the badge without a second call.
3. **`read-all`** behind a "mark all read" affordance. Cheap, and without it a badge the user
   can't clear is a permanent irritant.
4. **Partner-side `job_offered` handling last**, because it overlaps §10's offer list — a
   partner polling `/partners/me/offers` already sees the offer. The notification's value on
   that side is the badge when the offers screen *isn't* open.

### 13.7 What not to build — four things this feature does not do

Each of these would be reasonable to assume from the word "notifications", and each is wrong
today:

- **Nothing is pushed.** No FCM, no APNs, no SMS. `channel` is `'in_app'` on every row, which
  is why no row claims a delivery that didn't happen. So a notification only exists while your
  app is open and polling — do not build an onboarding flow asking for push permission against
  this, there's nothing on the other end of it yet.
- **There is no real-time transport.** No WebSocket, no SSE. Latency is your poll interval,
  which is why the badge endpoint is separate and cheap.
- **Do not auto-mark-read on feed open.** Opening `GET /notifications` changes nothing — the
  badge is cleared only by an explicit call. That's deliberate (a feed render is not a read),
  but it means the badge stays lit until you call one of the two POSTs.
- **`job_offered` still has no expiry, so build no countdown.** This is the same flag as §10:
  an offer the partner never answers sits indefinitely, and a timer ring implying a deadline
  would be inventing a deadline. Unchanged by this task.

### 13.8 Verified by

52 unit tests (40 in `backend/tests/unit/test_notification_service.py` for the recipient rule
and the vocabulary, 12 across the lifecycle and cancellation files proving the writer is
actually wired at each seam) and **79 of 79** live assertions against the real database and
real Supabase tokens (`backend/tests/integration/check_notifications.py`), including two
accounts' feeds read after a single event — which is the only way to prove "the owner was told
and the partner wasn't".

The control run (`--reverted`) removes the actor check so the rule always answers "the owner",
and scores **71 of 79**: all eight failures are the owner's-cancellation branch, i.e. the
mechanic driving to a cancelled job is never told. Full regression after the change: 307 unit
tests, 646 live assertions across thirteen harnesses, all green.

---

## 14. Admin analytics — three read-only reports (new, 2026-10-03)

Three endpoints, all `GET`, all admin-only, all read-only. They exist for an internal ops
dashboard and for the final evaluation; there is nothing here a customer or a partner app
should ever call, and nothing that returns a single job or a single person's data.

If you are not building an admin surface, the one thing in this section that may still matter
to you is **§14.6, the `notes[]` array** — it is a response-shape pattern we may reuse — and
`INVALID_DATE_RANGE` in §14.7, which is a new entry in the shared error registry.

### 14.1 The three routes

```
GET /api/v1/admin/analytics/overview     job funnel, conversion, current roster, time-to-work
GET /api/v1/admin/analytics/dispatch     dispatch latency, offer outcomes, no-match split
GET /api/v1/admin/analytics/matching     weighted scoring vs nearest-partner baseline
```

Every one takes the same two optional query parameters:

| Param  | Type               | Notes                                         |
|--------|--------------------|-----------------------------------------------|
| `from` | ISO 8601 timestamp | inclusive lower bound on `jobs.requested_at`  |
| `to`   | ISO 8601 timestamp | **exclusive** upper bound                     |

Both optional, independently. Omitting both reports over all time. The window is half-open on
purpose — two adjacent windows built this way partition the jobs between them, with nothing
counted twice and nothing dropped, which a closed upper bound would not give you. Send
timezone-aware timestamps; a naive one is read as UTC.

### 14.2 Who can call them

**`admin` role only.** Not an owner, not a partner, not "a logged-in user with a flag".

- no token → `401 UNAUTHORIZED`
- a valid owner's token → `403 FORBIDDEN`
- a valid partner's token → `403 FORBIDDEN`
- a valid token for an account linked to nothing → `403 USER_NOT_REGISTERED`

**There is no endpoint that makes someone an admin, and there is not going to be one.** No
`POST /api/v1/admins`, no admin `link-auth`. An admin is a row in our `admins` table with a
Supabase `sub` written into it by hand, in SQL, by someone who already has database access.
That absence is deliberate — see ADR-020 — so if you are building an admin login screen, the
flow is: the person signs in with Supabase exactly like anyone else, and either their account
is already attached to an `admins` row or all three routes answer 403. There is nothing for
the UI to do about a 403 here except say so; retrying, re-linking or re-registering will not
change it.

### 14.3 `/overview`

```json
{
  "data": {
    "window": {
      "requested_from": "2026-10-03T11:31:17.966692Z",
      "requested_to": null,
      "first_job_at": "2026-10-03T11:31:18.447695Z",
      "last_job_at": "2026-10-03T11:31:46.923629Z"
    },
    "jobs": {
      "total": 9, "requested": 0, "matching": 0, "assigned": 1,
      "partner_en_route": 1, "in_progress": 1, "completed": 2,
      "cancelled": 1, "no_match_found": 2
    },
    "conversion": { "completed": 2, "total": 9, "still_open": 4, "rate": 0.2222 },
    "partners": {
      "partners_total": 2, "verified": 2, "available_now": 2, "dispatchable_now": 2,
      "busy_now": 2, "live_assignments": 3,
      "rated": 0, "ratings_total": 0, "mean_rating": null
    },
    "work_started": {
      "count": 3, "mean": 0.42, "min": 0.21, "p50": 0.4, "p95": 0.6,
      "max": 0.64, "unit": "minutes"
    },
    "eta_accuracy": null,
    "notes": [ { "code": "...", "detail": "..." } ]
  },
  "meta": { "request_id": "..." }
}
```

Four things to read carefully before rendering any of it:

**The eight status counts sum to `jobs.total`.** Safe to draw as a funnel or a stacked bar
without a residual bucket.

**`conversion.rate` is `completed / total` over the whole window, and it is a floor, not a
success rate.** `still_open` counts only jobs that can still reach `completed`
(`requested`, `matching`, `assigned`, `partner_en_route`, `in_progress`). `cancelled` and
`no_match_found` are terminal, so they sit in the denominator as settled outcomes rather than
being counted as in-flight. If you want "of the jobs that finished, how many succeeded", you
have the numbers to compute it — but it is not this field, so do not label this field that way.

**`partners` ignores the window entirely.** `is_available` is a current flag and `rating_avg`
a running aggregate; the table holds no history, so there is no honest way to report the roster
as it stood last Tuesday. When you send a window you will get the
`PARTNER_ROSTER_IS_CURRENT_NOT_HISTORICAL` note, and the block should be labelled "as of now"
in the UI even when the rest of the page says "last 7 days". `mean_rating` is `null` when
nobody in the system has been rated, not `0`.

**`eta_accuracy` is always `null` right now, and `work_started` is not arrival time.**
`work_started` measures from the partner accepting to the job entering `in_progress`, which is
the transition out of `partner_en_route`. There is no `arrived` status and no arrival
timestamp anywhere in the system, so this includes however long the mechanic spent between
pulling up and starting work. It is a floor on travel time. Label it "time to work starting",
not "arrival time" or "ETA" — and if you shorten it, shorten it to something still true.
Note that `count` is every job that *ever* reached `in_progress`, including jobs that have
since completed; it is not a count of jobs currently in progress.

### 14.4 `/dispatch`

```json
{
  "data": {
    "window": { "requested_from": "...", "requested_to": null,
                "first_job_at": null, "last_job_at": null },
    "dispatch_latency": { "count": 7, "mean": 1.111, "min": 0.83, "p50": 1.08,
                          "p95": 1.4, "max": 1.52, "unit": "seconds" },
    "offers": {
      "total": 8, "accepted": 5, "declined": 1, "unanswered": 2,
      "jobs_offered": 7, "partners_offered": 2,
      "acceptance_rate_of_answered": 0.8333,
      "acceptance_rate_of_all": 0.625
    },
    "offers_before_acceptance": {
      "accepted_offers": 5, "mean_rank": 1.0,
      "at_rank_1": 5, "at_rank_2": 0, "at_rank_3_or_worse": 0, "worst_rank": 1
    },
    "no_match": {
      "total": 2, "genuine": 1, "dispatch_unavailable": 1, "jobs_in_window": 9,
      "rate": 0.125, "rate_including_outages": 0.2222
    },
    "notes": [ "..." ]
  }
}
```

**`accepted + declined + unanswered == total`, always.** An offer's outcome is read from
timestamps (`accepted_at`, `responded_at`), not from `job_assignments.status`, so an offer
keeps its outcome after the job it belongs to has been completed or cancelled. This matters
more than it sounds: `status` is overwritten when a job ends, so a count taken from it would
lose history in proportion to how much work actually got finished.

**Quote `acceptance_rate_of_answered`.** There is no offer timeout in the system — an
unanswered offer is still open and will stay open indefinitely, so it is not a refusal.
`acceptance_rate_of_all` treats every unopened offer as a decline and is therefore a floor.
Both ship together and the `UNANSWERED_OFFERS_HAVE_NO_EXPIRY` note names the gap; if you only
have room for one number on a card, use `_of_answered` and put `unanswered` next to it.

**`no_match.rate` deliberately excludes our own outages from both sides of the division.**
A job reaches `no_match_found` either because nobody was available (`genuine`) or because the
partner location service could not be reached (`dispatch_unavailable`) — both share the status
by design and are separated by the timeline note (ADR-016). A job whose dispatch never ran is
not evidence about partner supply in either direction, so it is removed from the numerator
*and* the denominator: in the sample above `rate` is `1/8`, not `1/9`.
`rate_including_outages` is published beside it so the choice is checkable. If
`dispatch_unavailable > 0`, that is an infrastructure incident and worth surfacing as one,
separately from supply.

`jobs_offered` is 7 while `total` is 8 because one job received two offers (a decline produced
a second), and two jobs received none at all (the two that ended `no_match_found`).

### 14.5 `/matching` — the one the evaluation rests on

```json
{
  "data": {
    "window": { "...": "..." },
    "divergence": { "first_offers": 7, "diverged": 1,
                    "agreed_with_nearest": 6, "rate": 0.1429 },
    "weighted_diverged": {
      "offers": 1, "answered": 1, "accepted": 1, "acceptance_rate": 1.0,
      "mean_matching_score": 0.8553, "mean_distance_score": 0.7883,
      "mean_load_score": 1.0, "mean_skill_score": 1.0, "mean_rating_score": 0.7
    },
    "also_nearest": { "offers": 6, "mean_distance_score": 0.8823,
                      "...": "same shape as weighted_diverged" },
    "attribution": {
      "diverged_offers": 1,
      "deltas": { "distance_score": -0.094, "load_score": 0.0833,
                  "skill_score": 0.0, "rating_score": 0.0 },
      "stddev": { "distance_score": 0.041, "load_score": 0.189,
                  "skill_score": 0.0, "rating_score": 0.0 },
      "eligible_components": ["load_score"],
      "constant_components": ["skill_score", "rating_score"],
      "driver": "load_score"
    },
    "notes": [ "..." ]
  }
}
```

`divergence.rate` is the headline: **how often weighted scoring picked somebody other than the
nearest eligible partner.** `diverged + agreed_with_nearest == first_offers`.

**Every number here is restricted to the first offer of each job** (`assignment_rank = 1`),
which is why `first_offers` (7) is less than `/dispatch`'s `offers.total` (8). On a later
offer, "was the baseline choice" means "also the nearest of those *still* eligible" — a
different question over a smaller candidate set — so mixing ranks would compare the strategy
against a baseline that changes definition partway through the sample. The `FIRST_OFFERS_ONLY`
note says this in the payload. Do not compute a divergence rate against `offers.total`
yourself; it would be wrong, and lower.

**`attribution.driver` names the component that paid for overriding distance.** Two
restrictions, both also stated in the response:

- A component that took the same value for every decision in the window appears in
  `constant_components` and can never be the `driver`, whatever its mean. `skill_score` is
  constant **by construction** — skill is a hard filter applied before scoring, so every
  ranked candidate matches and the term is always `1.0`. `rating_score` is constant in any
  window where no partner had been rated. Attribution over a constant column produces a
  number that is noise with a confident name on it.
- `driver` is a difference of *group means* — diverged picks versus agreed picks — not a
  per-job comparison against the partner who was actually passed over. We store
  `score_components` for the partner who got the offer and never for the runner-up, so there
  is no row to subtract. `ATTRIBUTION_IS_GROUP_MEANS_NOT_COUNTERFACTUAL` says so.

`driver` can be `null` (no divergence in the window, or nothing varied). Render that as
"not determinable", not as "distance".

### 14.6 `notes[]` — the caveats travel with the numbers

Every one of the three responses carries `notes: [{ "code": "...", "detail": "..." }]`. This
is not decoration and it is not a debug field: these endpoints produce numbers that end up in
documents, and the limits on a number belong attached to it rather than in a doc somebody may
not have read. **Render them.** A collapsed "3 notes" affordance next to the figures is
enough; dropping them is not.

`code` is stable and safe to branch on. `detail` is a full sentence meant to be shown to a
human as-is. The nine current codes:

| Code | Appears on | Means |
|------|-----------|-------|
| `ETA_ACCURACY_NOT_COMPUTABLE` | overview (always) | `eta_accuracy` is null because nothing has ever written an arrival estimate. Cites the count from your window. |
| `WORK_STARTED_IS_NOT_ARRIVAL` | overview, when `work_started.count > 0` | What `work_started` measures, and that it is a floor on travel time. |
| `PARTNER_ROSTER_IS_CURRENT_NOT_HISTORICAL` | overview, only when a window was sent | The `partners` block is as-of-now and ignored your window. |
| `UNANSWERED_OFFERS_HAVE_NO_EXPIRY` | dispatch, when `unanswered > 0` | Those offers are still open, not refusals. Quote `_of_answered`. |
| `OUTAGE_JOBS_EXCLUDED_FROM_NO_MATCH_RATE` | dispatch, when `dispatch_unavailable > 0` | How many jobs left both sides of `rate`, and why. |
| `FIRST_OFFERS_ONLY` | matching (always) | Everything is `assignment_rank = 1`. |
| `CONSTANT_COMPONENTS_CANNOT_ATTRIBUTE` | matching, when any component was constant | Which components cannot have separated candidates, and why. |
| `ATTRIBUTION_IS_GROUP_MEANS_NOT_COUNTERFACTUAL` | matching, when `diverged > 0` | What `driver` is and is not. |
| `SAMPLE_TOO_SMALL_FOR_PERCENTILES` | any, under the threshold | The mean is usable; `p50`/`p95` describe the sample, not the system. |

Codes may be added later. The nine above will not change meaning, so a dashboard that renders
a specific caveat for one of them can rely on it. A `code` you do not recognise should still
be displayed using its `detail` — do not filter to a known list.

`SAMPLE_TOO_SMALL_FOR_PERCENTILES` will be present on essentially every pilot-sized window.
When it is, suppress `p50` and `p95` in the UI or mark them, and show the mean.

### 14.7 `INVALID_DATE_RANGE` — one new error code

| Code | HTTP | When |
|------|------|------|
| `INVALID_DATE_RANGE` | 400 | `from` is later than `to` |

New entry in the shared registry, so it is available to any future endpoint taking a date
range — not analytics-specific.

`from == to` is **not** an error: the window is half-open, so it is an empty range somebody
asked for deliberately, and it answers `200` with zeros that mean what they say. Only strict
inversion is refused. A date picker that can produce a backwards range should catch it before
the request, but handle the 400 anyway.

An unparseable timestamp is `422 VALIDATION_ERROR` from the usual validation layer, not
`INVALID_DATE_RANGE`.

### 14.8 Nothing changed for you

No existing response shape, status code or error code was modified by this work. If you are
not building an admin surface, the only reasons to read this section are the `notes[]` pattern
(§14.6) and the new registry entry (§14.7).

### 14.9 Verified by

47 unit tests (`backend/tests/unit/test_admin_analytics_service.py`) and **99 of 99** live
assertions against the real database and real Supabase tokens
(`backend/tests/integration/check_admin_analytics.py`). The harness drives nine jobs through
the real endpoints — offered, declined, re-offered, accepted, completed, cancelled, unmatched
— and then asks the three reports to describe what happened, with one of the nine being an
injected location-service outage so the shipped failure path writes its own timeline note
rather than the test seeding it.

The divergence in §14.5 is arranged, not hoped for: one partner 0.99 km from the pickup
holding a live job, another 2.12 km away and free, so weighted scoring has to pick the further
one. The harness asserts `was_baseline_choice = false`, that `load_score` is the only
component that varied, and that `driver == "load_score"` rather than `distance_score` — the
component that was overridden is not the component that paid for it.

The control run (`--reverted`) swaps the offer classification back to reading
`job_assignments.status`, and scores **94 of 99**: all five failures are the two sections that
depend on it — the three outcomes stop summing to the total, `accepted` drops from 5 to 3,
`unanswered` from 2 to 1, and both acceptance rates move. Everything else still passes, which
is the point: the defect isolates to the one column it lives in.

Two shipping-blocker SQL bugs were found and fixed while writing that harness, both of which
had all three endpoints returning 500 on every call while the 47 unit tests were green. See
ADR-021's implementation note — the short version is that asyncpg PREPAREs before binding, so
a parameter in raw SQL needs an explicit `CAST`, and the same SQL run through psycopg2 does
not reproduce the failure.

Full regression after the change: **371 unit/api tests** and **745 live assertions across
fourteen harnesses**, all green, database verified back to baseline.
