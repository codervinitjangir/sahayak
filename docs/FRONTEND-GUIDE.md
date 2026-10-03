# Sahayak — Frontend Guide

**For:** Adarsh (web + mobile)
**Written:** 2026-10-01, against the backend as it actually exists on that date
**Scope:** what to build, how each screen should behave, and what state it has to handle.

---

## How this differs from `HANDOFF-frontend-contract.md`

Two documents, two jobs:

| | `HANDOFF-frontend-contract.md` | **this file** |
|---|---|---|
| Answers | "what exactly does this endpoint send and return?" | "what screens exist, and what does each one do?" |
| Shape | append-only log, one section per change, newest last | a standing picture of the app, rewritten when it drifts |
| Contains | full request/response bodies, field-by-field | screens, states, flows, gaps, build order |

**I have deliberately not repeated any request or response body here.** Where you need the
exact JSON, this file points at a section number in the handoff — `§13.1` means
`HANDOFF-frontend-contract.md` section 13.1. If the two ever disagree, the handoff wins on
field names and this file wins on "which screen calls it".

Both can lag the code. **Everything in this document was checked against the real route files
on 2026-10-01**, including a final pass over every method-and-path pair in §2. The route
inventory in §1.4 is complete: there are exactly 20 routes and nothing else exists.

---

## 0. The two words you need before any of the tables

The data model has one idea in it that is not obvious from the outside, and most of the
confusing parts of the API follow from it.

**A job is the customer's request. An assignment is one attempt to get it served.**

When a driver asks for help, the backend creates a **job**. The job belongs to the customer
for its whole life, and its `status` is the answer to "what is happening with my request".

To get it served, dispatch picks the best available mechanics and creates an **assignment**
row for each one it offers the job to — one row per offer. An assignment belongs to a
*mechanic* and its `status` is the answer to "what did this particular mechanic do about this
particular offer".

So one job can have several assignments over its life: offered to Ramesh (he declines),
offered to Suresh (he accepts). Three assignment rows could exist for one job, and only one
of them represents the mechanic who is actually coming.

This is why:

- **the owner-side screens read job status** and the **partner-side screens read assignment
  status** — they are asking different questions;
- **there is no `job.partner_id`**. The mechanic on a job is "the partner on the assignment
  that is currently `accepted`", which the backend resolves for you and returns as
  `current_assignment` on `GET /jobs/{job_id}`. Don't go looking for a partner field on the
  job;
- **a mechanic declining is not a failure of the job.** The job stays `matching` and moves to
  the next candidate. The owner's screen should not flicker on a decline — they should never
  know it happened.

The two status vocabularies, in plain language:

**Job status** — eight values: it has been `requested`, we are `matching` it to someone, it is
`assigned` to a mechanic, the mechanic is `partner_en_route`, work is `in_progress`, it is
`completed`, it was `cancelled`, or we found nobody (`no_match_found`). §3 has the full table.

**Assignment status** — six values: `offered` to this mechanic, `accepted` by them, `rejected`
by them, `timed_out` (defined but never written — nothing expires offers yet), `completed`
(the job finished on their watch) or `cancelled` (the job was called off while they held it).
Note the asymmetry: `rejected` means *the mechanic said no*, `cancelled` means *someone else
ended it*. They are kept apart on purpose, because acceptance rate is a metric that may one
day affect a mechanic's ranking or pay, and recording a customer's change of mind as a
mechanic's refusal would charge them for a decision that was not theirs.

---

## 1. App structure

### 1.1 Three surfaces

| Surface | Who uses it | Where it lives | State today |
|---|---|---|---|
| **Owner** | the driver who needs help | `web/src/pages/owner/`, `mobile/src/features/jobs` + `tracking` | screens exist; the core ones are wired to real endpoints |
| **Partner** | the mechanic / tow operator | `web/src/pages/partner/`, `mobile/src/features/partner` | screens exist and look finished; **every one of them is talking to a mock** — see §5.2 |
| **Admin** | ops | nothing | **no backend at all.** Zero admin routes exist. Build nothing here yet — see §1.3 |

### 1.2 Legend used throughout

- ✅ **Backed** — a working endpoint exists, verified in the route file today.
- ⚠️ **Partly backed** — the screen can mostly work, but one thing it needs is missing or the
  current client code calls a path that does not exist.
- ❌ **No backend** — needs an endpoint that does not exist. Do not build this screen yet;
  if you need it, ask and I will add the endpoint.

### 1.3 The admin panel: don't start it

There is no `app/api/admin.py`. Not a stub, not an unfinished router — nothing. The `admins`
table exists and is seeded with two rows, and that is the entire extent of it. Admin analytics
endpoints are the **next backend task after this document**, so by the time you'd want to build
against them they'll exist, and they'll arrive with their own handoff section. Until then every
admin screen is ❌ and an admin dashboard built now would be built against nothing.

### 1.4 The complete route inventory

Twenty routes. If a screen needs something not on this list, the screen is ❌.

| Method + path | Who may call it |
|---|---|
| `GET /health` | anyone, no token |
| `POST /api/v1/users` | any valid token |
| `POST /api/v1/users/{user_id}/link-auth` | any valid token |
| `POST /api/v1/vehicles` | owner |
| `GET /api/v1/vehicles` | owner |
| `GET /api/v1/vehicles/{vehicle_id}` | owner |
| `POST /api/v1/jobs` | owner |
| `GET /api/v1/jobs/{job_id}` | owner **or** partner |
| `POST /api/v1/jobs/{job_id}/status` | partner |
| `POST /api/v1/jobs/{job_id}/cancel` | owner |
| `POST /api/v1/jobs/{job_id}/ratings` | owner **or** partner |
| `GET /api/v1/jobs/{job_id}/ratings` | owner **or** partner |
| `POST /api/v1/job-assignments/{assignment_id}/respond` | partner |
| `POST /api/v1/partners` | **no token** — open registration |
| `POST /api/v1/partners/{partner_id}/link-auth` | any valid token |
| `GET /api/v1/partners/me/offers` | partner |
| `PATCH /api/v1/partners/{partner_id}/availability` | partner |
| `POST /api/v1/partners/{partner_id}/location` | partner |
| `POST /api/v1/partners/{partner_id}/services` | partner |
| `GET /api/v1/notifications` | owner **or** partner |
| `GET /api/v1/notifications/unread-count` | owner **or** partner |
| `POST /api/v1/notifications/{notification_id}/read` | owner **or** partner |
| `POST /api/v1/notifications/read-all` | owner **or** partner |

Three things to read off that table:

- **There is no list-my-jobs endpoint.** No `GET /jobs`, no `GET /jobs/me`. You can fetch a job
  by id and nothing else, which means **an owner job-history screen is ❌ today** and the owner
  home screen has to remember its own job ids locally. Both clients already call one anyway:
  `web/src/services/jobs.service.ts:33` calls `GET /jobs` and
  `mobile/src/services/api/jobs.ts:17` calls `GET /jobs/me`. Both are 404s. This is the endpoint
  I'd most expect you to ask for, and it's the cheapest of the three in §5.4.
- **There is no service-catalogue endpoint.** No `GET /services`, no `GET /services/categories`.
  `POST /jobs` takes a `service_code` string, so the picker has to be hardcoded client-side for
  now — the six seeded codes are in §2.3.
- **The partner routes take a `{partner_id}` in the path** even though identity comes from the
  token. The client needs to know its own partner id (you get it from `POST /partners` and from
  `POST /partners/{id}/link-auth`) and store it. A mismatch between path and token is refused.

### 1.5 Screens, by surface

**Owner**

| Screen | Backed? | Notes |
|---|---|---|
| Landing / marketing | ✅ | no API |
| Signup (phone OTP → profile) | ✅ | Supabase client-side + `POST /api/v1/users` |
| Add / list vehicles | ✅ | `POST` + `GET /api/v1/vehicles` |
| Request help | ⚠️ | `POST /api/v1/jobs` works; the service picker has no catalogue endpoint |
| Finding-a-partner / tracking | ✅ | `GET /api/v1/jobs/{job_id}`, polled |
| Cancel a job | ✅ | `POST /api/v1/jobs/{job_id}/cancel` |
| Rate the mechanic | ✅ | `POST`/`GET /api/v1/jobs/{job_id}/ratings` |
| Notification feed + badge | ✅ | all four notification routes — **no frontend at all yet** |
| Job history | ❌ | no list endpoint |
| Payment | ❌ | `payments` table exists, no routes, test-mode stub is backlogged |
| Edit/delete a vehicle | ❌ | only create and read exist |
| Owner profile view/edit | ❌ | no `GET`/`PATCH /users/{id}` |

**Partner**

| Screen | Backed? | Notes |
|---|---|---|
| Partner signup | ✅ | `POST /api/v1/partners` (no token) then link-auth |
| Declare services | ✅ | `POST /api/v1/partners/{partner_id}/services` |
| On/off shift toggle | ✅ | `PATCH /api/v1/partners/{partner_id}/availability` |
| Location reporting | ✅ | `POST /api/v1/partners/{partner_id}/location` — **required**, see §4.1 |
| Offers list | ✅ | `GET /api/v1/partners/me/offers` |
| Accept / decline an offer | ✅ | `POST /api/v1/job-assignments/{assignment_id}/respond` |
| Active job + status steps | ✅ | `GET /api/v1/jobs/{job_id}` + `POST /api/v1/jobs/{job_id}/status` |
| Rate the customer | ✅ | same two rating routes |
| Notification feed + badge | ✅ | **no frontend at all yet**; the bell in `PartnerTopBar.tsx` is decorative |
| Verification status | ⚠️ | `verification_status` comes back from register and link-auth; **there is no endpoint to re-read it**, so a screen that polls it is ❌ |
| Earnings | ❌ | no endpoint, no payments data |
| Trust / performance stats | ❌ | no endpoint |
| Document upload | ❌ | `partner_documents` table exists; routes and the verification workflow are deliberately deferred |

**Admin** — every screen ❌. See §1.3.

---

## 2. Screen by screen

Format for each: **what it shows** → **endpoints** → **loading** → **empty** → **errors**.
Error codes below are taken from `backend/app/utils/errors.py` and from each route's own
declared responses. I have not listed codes an endpoint cannot produce.

Two rules that apply to every screen and are not repeated:

- **Every response is enveloped.** Success is `{"data": ..., "meta": {"request_id"}}`; failure
  is `{"error": {"code", "message", "details"}, "request_id"}`. Read `error.code`, never
  `error.message` — the message is prose and will be reworded (handoff §1).
- **`401 UNAUTHORIZED` is possible on every authenticated call.** Refresh the Supabase token
  and retry once; if it fails again, send them to login. Not repeated per screen.

### 2.1 Owner signup

**Shows** a phone-number field, an OTP field, then name/email.

**Endpoints** — the OTP half is **not ours**: you call Supabase Auth directly from the client
and it gives you a JWT. The backend never issues a token, it only verifies them. Then:

- `POST /api/v1/users` ✅ — creates the owner profile and binds it to the Supabase account in
  one call. Needs the token. Returns the **local user id**, which is a different id from the
  Supabase `sub` — store both.

**Loading** — two distinct spinners, because they fail differently: "sending code", then
"creating your account".

**Empty** — n/a.

**Errors**

| Code | HTTP | Meaning / what to show |
|---|---|---|
| `USER_ALREADY_EXISTS` | 400 | phone or email already registered. Offer "log in instead" rather than an error. |
| `PHONE_MISMATCH` | 400 | the phone in the body isn't the one the token verified. Client bug — you should be sending the verified number, not a re-typed one. |
| `AUTH_ALREADY_LINKED` | 409 | this Supabase account already owns a profile. Same recovery as above: they already have an account. |
| `VALIDATION_ERROR` | 422 | field-level; `details[]` names the field. |

`POST /api/v1/users/{user_id}/link-auth` ✅ exists for the case where a profile was created
without an account (seeded or back-office) and now needs binding. You probably don't need it in
the signup flow.

### 2.2 Vehicles

**Shows** the owner's vehicles as cards, plus an add form (type, make, model, number).

**Endpoints**
- `GET /api/v1/vehicles` ✅ — all of the caller's, newest first
- `POST /api/v1/vehicles` ✅
- `GET /api/v1/vehicles/{vehicle_id}` ✅ — exists, currently unused by any client

**Loading** — skeleton cards.

**Empty** — `200` with an **empty array**, not a 404. A new owner having no vehicles is the
normal state. Render "add your first vehicle" off `data.length === 0`.

**Errors**

| Code | HTTP | What to do |
|---|---|---|
| `VEHICLE_NOT_FOUND` | 404 | also what you get for *someone else's* vehicle — identical response. Don't try to distinguish. |
| `INVALID_VEHICLE_NUMBER` | 400 | registration number failed format validation. Field-level message. |
| `VALIDATION_ERROR` | 422 | includes sending a field the endpoint forbids. |

**Not available:** edit and delete. `web/src/services/vehicles.service.ts` has a `PATCH` at
line 21 and a `DELETE` at line 29; neither route exists. Hide those controls or expect 404s.

### 2.3 Request help

**Shows** service picker → pickup location on a map → vehicle picker → optional description and
photos → confirm.

**Endpoints**
- `POST /api/v1/jobs` ✅ (handoff §2 for the body). Takes `vehicle_id`, `service_code`,
  `pickup_lat`, `pickup_lng`, and optional `pickup_address_text` / `issue_description`.
- `GET /api/v1/vehicles` ✅ for the vehicle picker.
- Service catalogue: ❌ **no endpoint.** `web/src/services/jobs.service.ts` calls `GET /services`
  and `GET /services/categories`; neither exists. **Hardcode these six for now** — they are what
  `db/seed.sql` inserts, and `service_code` is validated against them:

  | `service_code` | Label | Category | Needs tow equipment |
  |---|---|---|---|
  | `flatbed_towing` | Flatbed Towing | towing | yes |
  | `wheel_lift_towing` | Wheel-Lift Towing | towing | yes |
  | `battery_jumpstart` | Battery Jumpstart | mechanical | no |
  | `flat_tyre` | Flat Tyre Support | mechanical | no |
  | `minor_repair` | On-Site Minor Repair | mechanical | no |
  | `fuel_delivery` | Emergency Fuel Delivery | fuel | no |

  The labels above are the exact `name` values from the database, so hardcoding them now won't
  conflict with a `GET /services` later. The last column is `requires_vehicle_equipment` — it's
  a backend concern (whether a mechanic has a truck), you don't need to render it, and it's
  listed only so your hardcoded copy matches the real rows field-for-field.

  Tell me when you want `GET /services` and I'll add it — it's a small endpoint and hardcoding a
  catalogue is the kind of thing that rots quietly.

**Loading** — the submit is the slow one. `POST /jobs` **runs dispatch synchronously**: it
creates the job, moves it to `matching`, scores candidates and writes offers before it responds.
Budget for that. The measured ceiling is ~2 job creations per second per worker, with about
1.2 s of database round trips inside one request, so **a 10-second timeout is too tight**; use
30 s and show "finding you a mechanic" rather than a bare spinner.

**Empty** — n/a. If the owner has no vehicles, this screen can't be reached; route them to 2.2.

**Errors**

| Code | HTTP | What to do |
|---|---|---|
| `INVALID_SERVICE_CODE` | 400 | the picker sent a code that isn't in the table above. Your bug, not theirs — don't surface it raw. |
| `VEHICLE_NOT_FOUND` | 404 | the chosen vehicle isn't theirs or doesn't exist. Re-fetch the vehicle list. |
| `VALIDATION_ERROR` | 422 | out-of-range lat/lng (`-90..90`, `-180..180`) or a forbidden extra field. |

**A `201` does not mean a mechanic was found.** The job may come back as `matching` (offers are
out) or already `no_match_found` (nobody eligible). Read the status off the response and route
accordingly — see §3.

**One thing already in your code that the backend ignores:** `web/src/services/api.ts` generates
and sends an `Idempotency-Key` header on job submission. Nothing on the server reads it — request
idempotency is deliberately deferred. So a double-tap on "confirm" creates **two jobs** today.
Guard it on the client (disable the button on first tap) rather than relying on the header.

### 2.4 Tracking / "finding a partner" (owner)

The most important screen in the app, and the one with the most states.

**Shows** job status, the mechanic's name/phone/rating once there is one, a map, and the
timeline.

**Endpoints**
- `GET /api/v1/jobs/{job_id}` ✅ — returns the job, `current_assignment`, and `timeline`
  (handoff §2.2 and §11 for the shape)

**Loading** — only on first paint. On subsequent polls, update in place; never flash a spinner
over a screen that already has data.

**Polling** — there is no WebSocket and no SSE. Poll this endpoint. It is explicitly built for
it: it uses a **non-locking** read, unlike every mutating path, so polling it cannot block a
mechanic's accept. Roughly 3–5 s while the job is live, stop once status is terminal. (If a
mechanic's live position on the map is what you want, note there is no endpoint for that —
partner location goes into Redis and is only read by the matching engine. A moving marker is ❌.)

**Empty** — n/a; you always have a job id to get here.

**What's in the response and what isn't**

- `current_assignment` is **null until a mechanic accepts.** Everything on it — `partner_name`,
  `partner_phone`, `partner_rating`, `partner_rating_count`, `estimated_arrival_min` — is
  therefore unavailable while the job is `requested` or `matching`. Guard every one of them.
- `partner_rating` is nullable even when the assignment exists, and `.toFixed()` throws on null.
  (`web/src/pages/owner/JobTrackingPage.tsx:183` currently reads `job.partner.rating_avg`, which
  is not a field on this response at all — handoff §12.6 has the mapping.)
- `timeline` is every status change, oldest first, each with `changed_at` and an optional `note`.
  This is what turns "status: matching" into "we've been looking for 90 seconds". It's the only
  place some facts exist — see §3.3.

**Errors**

| Code | HTTP | What to do |
|---|---|---|
| `JOB_NOT_FOUND` | 404 | also what a job belonging to someone else returns. Stop polling, go home. |
| `FORBIDDEN` | 403 | you're neither the owner nor a party to it. Stop polling. Don't log them out. |

### 2.5 Cancel a job (owner)

**Shows** a confirm sheet with an optional free-text reason.

**Endpoints**
- `POST /api/v1/jobs/{job_id}/cancel` ✅ (handoff §7). Body is optional: `{cancellation_reason}`
  or nothing at all.

**When to show the button:** every status *except* `completed` and `cancelled`. That includes
`requested` and `matching` — cancelling while the spinner is still up is the single likeliest
cancellation in the product, so don't gate the button on having a mechanic. It also includes
`no_match_found`, which looks terminal but is not from the owner's side: a request nobody served
is still an open booking the driver needs to clear. §3 has the column.

**Loading** — disable the button; this one is fast.

**Errors**

| Code | HTTP | What to do |
|---|---|---|
| `JOB_ALREADY_TERMINAL` | 409 | already completed or cancelled. **Treat as success** and re-fetch — the usual cause is the mechanic completing it while the sheet was open, or a double-tap. |
| `JOB_NOT_FOUND` | 404 | gone or not theirs. |
| `FORBIDDEN` | 403 | somebody else's job. |
| `VALIDATION_ERROR` | 422 | reason over 500 chars. |

### 2.6 Rate the job (both sides)

Covered in full in handoff §12. The short version for this document:

**Endpoints** — `POST` and `GET /api/v1/jobs/{job_id}/ratings` ✅ (note the **plural**; the
current call in `web/src/services/jobs.service.ts:78` is singular and 404s — §5.1).

**When to show the form:** when `GET` returns `can_rate: true`. Nothing else. Don't re-derive it
from job status and your own role — it's per-side, so the owner's answer and the mechanic's
answer differ on the same job.

**Empty** — a completed job nobody has rated returns `ratings: []` with `can_rate: true`.

**Errors** — `JOB_NOT_RATEABLE` (409, job isn't completed), `RATING_ALREADY_SUBMITTED` (409,
**treat as success** — it comes from a unique constraint, so the rating did land),
`JOB_NOT_FOUND`, `FORBIDDEN`, `VALIDATION_ERROR`.

### 2.7 Notification feed + badge (both sides)

New on 2026-10-01, and there is **no frontend for it at all** on either surface.

**Shows** a bell with an unread dot; tapping it opens a list of events, each deep-linking to its
job.

**Endpoints** — all ✅, all four detailed in handoff §13:
- `GET /api/v1/notifications` — the list (`limit` 1–100, `offset`, `unread_only`)
- `GET /api/v1/notifications/unread-count` — the badge; this is the one to poll
- `POST /api/v1/notifications/{notification_id}/read`
- `POST /api/v1/notifications/read-all`

**Loading** — skeleton rows. The badge should never show a spinner; keep the last known count.

**Empty** — `200` with `items: []`. Normal for a new account.

**Errors** — `NOTIFICATION_NOT_FOUND` (404, on mark-read; covers "not yours" identically —
drop the row and move on), `VALIDATION_ERROR` (422, `limit` out of 1–100).

**Three behaviours that will catch you out:**

- **Nothing is pushed.** `channel` is `in_app` on every row; there is no FCM/APNs/SMS. A
  notification only exists while your app is open and polling. Don't ask for push permission
  against this yet.
- **Opening the feed does not mark anything read.** The badge clears only on an explicit POST.
- **You are never notified of your own action** — the owner gets nothing for their own
  cancellation, the mechanic gets nothing for their own accept. So an optimistic local update
  after your own action will not be duplicated by a notification arriving later.

Branch on `event`, never on `message`. The eight values and their recipients are in handoff
§13.4.

### 2.8 Partner signup, services, shift toggle, location

**Shows** a registration form, a service multi-select, an on/off-shift switch, and (invisibly) a
location reporter.

**Endpoints**
- `POST /api/v1/partners` ✅ — **the only route in the system that takes no token.** A mechanic
  registers before they have an account; the profile lands `verification_status: 'pending'` and
  `is_available: false`, so it can receive nothing until both change. Returns the partner id.
- `POST /api/v1/partners/{partner_id}/link-auth` ✅ — bind the Supabase account afterwards.
- `POST /api/v1/partners/{partner_id}/services` ✅ — the service codes they can perform, from
  the same six in §2.3. **Required before they can be matched** — the skill term of the score is
  a hard filter, not a weight, so a mechanic with no services is eligible for nothing.
- `PATCH /api/v1/partners/{partner_id}/availability` ✅ — on/off shift. Note **PATCH**;
  `web/src/services/partner.service.ts:90` currently POSTs to `/partners/me/availability`, which
  is both the wrong method and a path that doesn't exist.
- `POST /api/v1/partners/{partner_id}/location` ✅ — see §4.1; this is not optional.

**Loading** — ordinary form submits.

**Errors**

| Code | HTTP | What to do |
|---|---|---|
| `PARTNER_ALREADY_EXISTS` | 400 | phone already registered. |
| `INVALID_CATEGORY_CODE` | 400 | `primary_category_code` not one of `towing`/`mechanical`/`fuel`. |
| `INVALID_SERVICE_CODE` | 400 | a service code outside the six. |
| `PARTNER_NOT_FOUND` | 404 | also what you get for a partner id that isn't yours. |
| `AUTH_ALREADY_LINKED` | 409 | this Supabase account already owns a partner profile. |
| `IDENTITY_NOT_LINKED` | 403 | valid token, but no profile is bound to it yet. Means "finish signup", not "log in again" — this is the one 4xx that should route to the link step rather than the login screen. |

**Verification status is write-then-forget today.** You get `verification_status` back from
register and from link-auth, and there is **no endpoint to read it again**. So
`web/src/pages/partner/VerificationStatus.tsx` cannot poll for approval — cache what you were
told at signup. A real verification screen needs `GET /partners/me`, which doesn't exist.

### 2.9 Offers list and active job (partner)

Covered in handoff §10 (offers) and §6 (status transitions). Screen-level:

**Shows** the offers that are still answerable, and once one is accepted, the job with its
status-advance buttons.

**Endpoints**
- `GET /api/v1/partners/me/offers` ✅ — a **list**, newest first, of offers this partner can
  still answer. Note `/me/`, no partner id in the path.
- `POST /api/v1/job-assignments/{assignment_id}/respond` ✅ — `{"action": "accept"}` or
  `{"action": "reject", "rejection_reason": "..."}`.
- `GET /api/v1/jobs/{job_id}` ✅ — the accepted job's detail, same endpoint the owner polls.
- `POST /api/v1/jobs/{job_id}/status` ✅ — advance or cancel.

**Loading** — poll the offers list while on shift; see §4.

**Empty** — `200` with an **empty list**. That is the normal state of an on-shift mechanic with
nothing to do, and it is also what an off-shift or unverified mechanic sees. Your empty state
should say which: if you know they're off shift, say "you're off shift" rather than "no offers".

**Errors**

| Code | HTTP | What to do |
|---|---|---|
| `ASSIGNMENT_NOT_FOUND` | 404 | also what another partner's assignment returns. Drop it from the list. |
| `ASSIGNMENT_ALREADY_ANSWERED` | 409 | already accepted/rejected, or the owner cancelled underneath. **Refresh the list** — do not retry. |
| `PARTNER_AT_CAPACITY` | 409 | they already hold the maximum concurrent jobs. See §4.3. |
| `INVALID_STATUS_TRANSITION` | 409 | the move isn't legal from the job's current status. See §3.2. |
| `PRICE_FINAL_REQUIRED` | 400 | completing a job without `price_final`. |
| `FIELD_NOT_APPLICABLE` | 400 | sending `price_final` on a transition that isn't `completed`, or `cancellation_reason` on one that isn't `cancelled`. Refused, not ignored. |
| `JOB_NOT_FOUND` / `FORBIDDEN` | 404 / 403 | not their job. |

---

## 3. Job status → UI

### 3.1 The table

"Terminal" means the job will never change status again, so you can stop polling.

| Job status | Owner display | Terminal for owner? | Partner display | Owner can cancel? |
|---|---|---|---|---|
| `requested` | "Request received" | no | *not visible* — no assignment exists yet | **yes** |
| `matching` | "Finding a mechanic…" | no | *not visible* — unless they hold an offer, in which case they see it as an offer, not a job | **yes** |
| `assigned` | "Mechanic assigned" + their name/phone | no | "Job accepted — head to the pickup" | **yes** |
| `partner_en_route` | "On the way to you" | no | "You're en route" | **yes** |
| `in_progress` | "Work in progress" | no | "Work started" | **yes** |
| `completed` | "Completed" + rating prompt | **yes** | "Completed" + rate-the-customer prompt | no → `409 JOB_ALREADY_TERMINAL` |
| `cancelled` | "Cancelled" | **yes** | "Cancelled" | no → `409 JOB_ALREADY_TERMINAL` |
| `no_match_found` | "We couldn't find a mechanic" + retry | **effectively, but see below** | *not visible* | **yes** |

**`no_match_found` is the one row that is not what it looks like.** It is terminal in the sense
that nothing will move it on its own — there is no re-dispatch sweep, so a job sitting in
`no_match_found` will sit there forever. But it is **not** terminal for cancellation: the owner
can still cancel it, deliberately, because a request nobody served is still an open booking from
the driver's side and refusing to let them clear it would leave a row they can't get rid of. So:
stop polling, but keep the cancel affordance, and make the primary action "try again" (a new
job) rather than "cancel".

### 3.2 Which transitions a mechanic may actually make

The exact table the backend enforces. Anything not listed is a `409
INVALID_STATUS_TRANSITION` — so don't render a button for it.

| From | Mechanic may move it to |
|---|---|
| `assigned` | `partner_en_route`, `cancelled` |
| `partner_en_route` | `in_progress`, `cancelled` |
| `in_progress` | `completed`, `cancelled` |
| `requested`, `matching`, `no_match_found`, `completed`, `cancelled` | **nothing** |

Three consequences for the partner UI:

- **No skipping.** `assigned → in_progress` is a 409, even though it's a plausible thing for a
  mechanic who arrived before tapping "en route". One button at a time, in order.
- **No going back.** There is no un-complete and no un-cancel. A completed job that can be
  reopened is a completed job whose price and timestamps can be rewritten after the fact.
- The request body only accepts four target statuses at all (`partner_en_route`, `in_progress`,
  `completed`, `cancelled`). Sending `assigned` is a **422**, not a 409 — those are
  server-owned statuses that dispatch writes.

Completing requires `price_final`. Cancelling takes an optional `cancellation_reason`. Sending
either on the wrong transition is a `400 FIELD_NOT_APPLICABLE`, not a silent drop.

### 3.3 `no_match_found` has three causes, and you *can* tell them apart

This is better news than I expected when I started writing this section, so read it carefully
rather than taking the summary.

All three write the same status. They differ only in the `note` on the `job_status_history` row,
and — the part that matters to you — **that note is returned to the client**, verbatim, in
`timeline[].note` on `GET /api/v1/jobs/{job_id}`. The three strings are exact constants in the
backend:

| `note` on the `no_match_found` entry | What actually happened |
|---|---|
| `No available partner within search radius` | genuinely nobody eligible nearby |
| `No remaining partner accepted the job` | mechanics were offered it and all declined |
| `Dispatch unavailable: could not reach the partner location service` | **our infrastructure failed.** Nothing was searched. |

So the honest answer to "can the frontend show the distinction?" is **yes, today, by reading the
note** — and the third row is the one worth distinguishing, because "nobody is available near
you" is a lie when the truth is that our Redis was unreachable. In that case the right copy is
"something went wrong on our side — please try again", and "try again" is likely to work,
whereas in the first case it isn't.

Two caveats, both honest:

- You would be **string-matching on prose written for humans**. The backend treats the third
  string as a constant (the evaluation query matches on its prefix), so it is stable in practice,
  but it is not a contract. Match on the `Dispatch unavailable:` prefix if you build this, and
  **ask me for a real machine-readable field** if it becomes load-bearing — a `reason` code on
  the timeline entry is a small change and the right one.
- **The notification does not carry the distinction.** `job_no_match_found`'s message is the
  same in all three cases, so a feed row can't be coloured by cause; only the job detail can.

While you're in the timeline, the other notes are useful too and follow the same pattern:
`Job created`, `Searching for a partner`, `Partner accepted the job`, and for cancellations
`Cancelled by owner` / `Cancelled by partner` — **with the free-text reason appended after a
colon when one was given.** That's the only place the cancellation reason is readable, and it's
behind the job's own access gate, which is why it's allowed to be there and not in a
notification message.

---

## 4. The dispatch / offer flow

### 4.1 What has to be true before a mechanic gets anything

Four conditions, all of them `AND`, and a mechanic failing any one of them is invisible to
dispatch and has no way to find that out from the API:

1. `verification_status = 'verified'` — set by ops, by hand, today. A `pending` mechanic gets
   nothing.
2. `is_available = true` — the on-shift toggle.
3. At least one service linked, matching the job's `service_code` — the skill term is a **hard
   filter**, not a weight.
4. **A location reported to `POST /api/v1/partners/{partner_id}/location`.** This is
   the one that will bite you. Live position lives in Redis, not Postgres, and the matching
   engine searches by geography — a mechanic who has **never** posted a location is not in the
   search set at all, and no amount of being verified, available and skilled will get them an
   offer.

So the partner app **must** post location on a timer while on shift. Treat it as part of the
shift toggle, not as a separate feature: flip to on-shift → start posting; flip off → stop. A
mechanic sitting on an empty offers list because their app never reported a position is the most
likely "the dispatch is broken" bug report you'll get, and it won't be the dispatch.

**And a stale position is not rejected — it is used.** There is a 300-second staleness threshold
(`MAX_LOCATION_AGE_S`), and today it only writes a warning log: the candidate is still scored,
still ranked and still offered the job. So a mechanic whose app was killed an hour ago, or whose
phone died, looks to dispatch exactly like a mechanic standing still in that spot, and will keep
getting offers routed to where they used to be. Two consequences for the client:

- **keep posting for as long as the toggle is on**, including from the background where the
  platform allows it. Stopping the timer while leaving `is_available = true` is the worst
  available state — the mechanic stays eligible at a frozen position, and the backend will not
  save you from it.
- **flip `is_available` to false on sign-out and on anything that looks like end-of-shift.**
  That is the only signal that actually takes them out of consideration.

### 4.2 What the offer actually contains

Offers come from `GET /api/v1/partners/me/offers` (handoff §10 for the full shape). Per offer
you get: `assignment_id`, `job_id`, `offered_at`, `distance_at_offer_m`,
`estimated_arrival_min`, `assignment_rank`, and a nested `job` with `service_code`,
`service_name`, `vehicle_number`, `pickup_address_text`, `issue_description`, `price_estimate`,
`requested_at` and `status`.

**What is deliberately not there, confirmed against the response model:**

- **No customer name, no phone number, no coordinates.** Contact details are released by the
  *assignment*, not by the role: a mechanic who has been offered a job gets the address text and
  nothing that identifies the person. After they accept, `GET /jobs/{job_id}` gives them the
  rest. So **don't build a "call the customer" button on the offer card** — there's no number in
  the payload to put behind it. It belongs on the active-job screen.
- **No `matching_score` and no `score_components`.** I checked the response model rather than
  assuming: the score fields exist on the assignment row and on an internal dispatch schema,
  and they are **not** on `PartnerOfferItem`. The mechanic cannot see why they were ranked
  where they were, and should not — a visible score is a score people optimise against.
  `assignment_rank` *is* there (1 = best candidate), but I'd leave it off the UI too; it tells a
  mechanic they were second choice, which is true and useless.

### 4.3 Accept and decline: every outcome

One endpoint, `POST /api/v1/job-assignments/{assignment_id}/respond`, with
`{"action": "accept"}` or `{"action": "reject", "rejection_reason": "optional, ≤500 chars"}`.

| Outcome | What you get | What the screen does |
|---|---|---|
| Accept succeeds | `200`, `assignment_status: "accepted"`, `job_status: "assigned"` | go to the active-job screen |
| Decline succeeds | `200`, `assignment_status: "rejected"` | drop the card. The response may carry `next_assignment_id` — that's the job moving on to the next mechanic, **not** something you act on |
| Someone else accepted first | `409 ASSIGNMENT_ALREADY_ANSWERED` | refresh the list, show "this job was taken". Not an error state — it's the normal outcome of losing a race |
| Owner cancelled underneath | `409 ASSIGNMENT_ALREADY_ANSWERED` | same handling. The two are indistinguishable from the outside, on purpose |
| They're already full | `409 PARTNER_AT_CAPACITY` | see below |
| Not their assignment | `404 ASSIGNMENT_NOT_FOUND` | drop the card |

**`PARTNER_AT_CAPACITY` needs care, because from the outside it looks exactly like a decline.**
The cap is on *concurrently active* jobs (currently 2). The offer was legitimately made and the
mechanic legitimately wanted it; they just can't hold another one right now. The wrong UI is an
error toast that reads like a failure. The right UI is "finish or hand off a current job first"
with a link to the active job — and critically, **the assignment is not rejected**, so if they
free up capacity the offer is still answerable. Don't remove the card.

Only jobs that are actually live count against the cap: completing or cancelling a job frees the
slot immediately, so a mechanic can work any number of jobs in a day.

### 4.4 Offers do not expire — build no countdown

**There is no timeout mechanism.** The `timed_out` assignment status exists in the schema and
nothing has ever written it. There is no background worker. An offer a mechanic never answers
stays `offered` **indefinitely**, and the job stays `matching` indefinitely with it.

Three things follow, and the first is the one I most want you to take away:

- **Do not build a countdown ring, a "respond within 30s" label, or an auto-decline.** Every one
  of those implies a server-side deadline that does not exist. The timer would expire, the UI
  would remove the card, and the assignment would still be sitting there `offered` — the job
  silently stuck, with nothing in the system to unstick it.
- An owner can sit in "Finding a mechanic…" forever if the mechanics it reached all ignore it.
  That's a real product hole, it's on the backlog, and it is not something the frontend can
  paper over. What the owner screen *can* do is make cancelling obvious after a while — the
  cancel button is available from `matching`, so after ~60 s of searching, promote it.
- Show `offered_at` as relative age on the offer card ("4 min ago"). That's honest — it's how
  old the offer is — and it does the useful half of what a countdown would do without the lie.

---

## 5. Current gaps

Framed as what's missing, not what's wrong. I checked `web/` and `mobile/` directly for this
section rather than quoting the previous report, and some of it had changed.

### 5.1 Contract mismatches in code right now, with their real status

Every one of these is a path or method in the current frontend that does not exist on the
backend. I read the route files and both client service layers today; these are live, not
historical. **Line numbers are as of 2026-10-01.**

**Web — owner**

| Where | Calls | Status | The real thing |
|---|---|---|---|
| `web/src/services/jobs.service.ts:33` | `GET /jobs` | **still open** | no list endpoint exists |
| `web/src/services/jobs.service.ts:78` | `POST /jobs/{id}/rating` | **still open** | `/ratings`, plural (handoff §12.1) |
| `web/src/services/jobs.service.ts:85` | `GET /services` | **still open** | no endpoint; hardcode §2.3 |
| `web/src/services/jobs.service.ts:92` | `GET /services/categories` | **still open** | no endpoint |
| `web/src/services/users.service.ts:29` | `GET /users/{id}` | **still open** | no endpoint at all |
| `web/src/services/vehicles.service.ts:21` | `PATCH /vehicles/{id}` | **still open** | not built (deferred) |
| `web/src/services/vehicles.service.ts:29` | `DELETE /vehicles/{id}` | **still open** | not built (deferred) |
| `web/src/pages/owner/JobTrackingPage.tsx:175, 179, 183, 198` | `job.partner.name` / `.rating_avg` / `.rating_count` / `.phone` | **unblocked** | there is no `job.partner` object — it's `current_assignment.partner_name` / `.partner_rating` / `.partner_rating_count` / `.partner_phone` (handoff §12.6). All four fields now exist (`partner_rating_count` was added 2026-09-30), so this is a rename, not a blocker. **`.rating_avg.toFixed(1)` on line 183 will throw** — `partner_rating` is nullable |

**Web — partner.** All eight of these sit behind the mock, so they don't fail today; they fail
the moment the mock is off (§5.2).

| Where | Calls | The real thing |
|---|---|---|
| `partner.service.ts:43` | `GET /partners/me/offers/current` | `GET /api/v1/partners/me/offers` — a **list**, not a single current offer |
| `partner.service.ts:51` | `POST /partners/me/offers/{id}/accept` | `POST /api/v1/job-assignments/{assignment_id}/respond` with `{"action":"accept"}` |
| `partner.service.ts:58` | `POST /partners/me/offers/{id}/reject` | same endpoint, `{"action":"reject"}` |
| `partner.service.ts:67` | `GET /partners/me/jobs/active` | no endpoint; track the job id locally and use `GET /jobs/{job_id}` |
| `partner.service.ts:90` | `POST /partners/me/availability` | `PATCH /api/v1/partners/{partner_id}/availability` — different method **and** path |
| `partner.service.ts:99` | `GET /partners/me/earnings?window=` | no endpoint, no payments data behind it |
| `partner.service.ts:106` | `GET /partners/me/stats` | no endpoint |

Note the `offerId` → `assignment_id` change in those first three: the thing the mechanic answers
is an **assignment id**, and you get it from the offers list. There is no separate "offer id".

**Mobile.** Every API call in the app lives in `mobile/src/services/api/jobs.ts` — six calls,
and **four of them are wrong**, which is a bigger gap than the web owner flow has:

| Line | Calls | Status |
|---|---|---|
| `:9` | `POST /jobs` | ✅ correct |
| `:13` | `GET /jobs/{jobId}` | ✅ correct |
| `:17` | `GET /jobs/me` | ❌ no such endpoint |
| `:21` | `PATCH /jobs/{jobId}/cancel` | ❌ **wrong method** — the route is `POST /api/v1/jobs/{job_id}/cancel` |
| `:25` | `PATCH /jobs/{jobId}/accept` | ❌ no such route. Accepting is `POST /api/v1/job-assignments/{assignment_id}/respond` |
| `:29` | `PATCH /jobs/{jobId}/complete` | ❌ no such route. Completing is `POST /api/v1/jobs/{job_id}/status` with `{"status":"completed","price_final":...}` |

The last two are the interesting ones: they assume a mechanic acts on a **job**, when the model
is that a mechanic acts on an **assignment** (§0). That's not a typo to patch — the mobile
partner screens need the assignment id threaded through them. Budget accordingly.

**Fixed and don't redo:** the `mobile/` response-envelope handling (handoff §3) and the missing
`rating_count` field (added 2026-09-30).

### 5.2 The partner surface is complete UI over a mock

This is the single most important thing in this section, and it's not a criticism — the mock was
the right call when there was no partner API.

`web/src/services/partner.service.ts` imports `./partner.mock` and every method short-circuits
to it when `IS_PARTNER_API_MOCK`. The comment on line 19 says the flag unset means "mock in dev,
real in a production build". So:

- in dev, every partner screen works and none of it touches the backend;
- in a production build, the mock is off and **every partner call in §5.1 falls through to a path
  that doesn't exist**, so the whole surface 404s.

The header comment on line 11 — *"The /partners/me/\* endpoints are not built yet, so every call
has two branches"* — was true when it was written and is now the main thing to un-learn. The
partner backend has been complete end-to-end since 2026-09-27: register, link-auth, services,
availability, location, offers, respond, status transitions. The real paths just aren't the ones
the file guessed, because it guessed `/partners/me/*` for everything and the shipped design puts
offer responses under `/job-assignments/{id}/respond` (for the reason in §0 — a mechanic answers
an assignment, not a job).

So the work here is not building screens. It's **repointing eight service functions at the eight
real routes**, two of which also change shape: `getPendingOffer` becomes a list, and
accept/reject collapse into one `respond` call keyed by assignment id. That's why it's first in
§6.

### 5.3 Backend-ready with no frontend consumer at all

Shipped, tested, and nothing calls it:

- **All four notification routes** (2026-10-01) — nothing anywhere, on either surface.
- `POST /api/v1/partners` and `POST /api/v1/partners/{id}/link-auth` — partner signup goes
  through the mock.
- `POST /api/v1/partners/{partner_id}/location` — **nothing reports location.** Per §4.1 this
  means a real mechanic on a real build receives nothing, ever.
- `POST /api/v1/partners/{partner_id}/services` — so no mechanic can be matched on skill.
- `POST /api/v1/job-assignments/{assignment_id}/respond` — the mock intercepts accept/decline.
- `GET /api/v1/partners/me/offers` — the mock intercepts the offers list.
- `GET /api/v1/jobs/{job_id}/ratings` — the write path is called (at the wrong URL); the read
  path, and therefore `can_rate`, is unused.
- `GET /api/v1/vehicles/{vehicle_id}` — the list is used, the single fetch isn't.
- `POST /api/v1/users/{user_id}/link-auth` — not needed in the current signup flow, so this one
  is fine.

### 5.4 Screens with no backend, so don't build them

`GET /services` · job history (no list endpoint) · partner earnings · partner trust/stats ·
partner verification polling (`GET /partners/me`) · document upload · vehicle edit/delete ·
owner profile read/edit · payments · live mechanic position on the map · **everything admin**.

Each of these is "ask and I'll build the endpoint", not "it's broken". `GET /services`,
`GET /partners/me` and a job-list endpoint are the three I'd expect you to want first; none is
more than an hour of backend work. Tell me which and I'll put them in the queue — don't stub
them client-side and let the stub become the spec.

---

## 6. Build order

Sequenced for the frontend specifically, not a restatement of `TASKS.md`. The ordering principle
is: everything needed to demo **owner → dispatch → mechanic → completion** on real endpoints,
before anything that only polishes one end of it.

**1. Repoint the partner service layer at the real routes.** (§5.1, §5.2)
The highest-value frontend work in the project right now, by a wide margin. The screens exist and
the backend has been ready for a week; what's missing is eight URL changes and two shape changes
(a list instead of a single current offer, `respond` instead of accept/reject). Nothing else on
this list demos end-to-end without it, because today the mechanic half of the loop is a mock
talking to itself.

**2. Partner location reporting on the shift toggle.** (§4.1)
Second because without it step 1 appears to be broken. On-shift → post location on a timer;
off-shift → stop. Until this exists, a verified mechanic on a real build gets an empty offers
list forever and there is nothing in the UI to explain why.

**3. The small path fixes on the owner side.** (§5.1)
`/ratings` plural, the hardcoded service catalogue, and removing the four calls that can only
404: `GET /jobs`, `GET /users/{id}`, and the vehicle `PATCH`/`DELETE`. Under an hour, and it
removes the failures most likely to be mistaken for backend bugs during a demo.

**4. Notifications: badge first, then feed.** (§2.7)
Poll `/unread-count` and drive the dot that is already drawn. `PartnerTopBar.tsx:67–73` has the
bell button and an unread dot — and the button has **no `onClick`** while the dot on line 73 is
rendered unconditionally, so every mechanic currently sees a permanently-lit badge that means
nothing. Making it honest is ~20 lines against a finished endpoint; then build the list behind
it. This is the first genuinely new feature on the list rather than reconnection, and it's the
cheapest one available.

**5. Mobile's four broken job calls.** (§5.1)
`GET /jobs/me` and the `PATCH .../cancel` method fix are quick. The other two —
`PATCH /jobs/{id}/accept` and `/complete` — need the assignment id threaded into the partner
screens, because the model is that a mechanic answers an assignment (§0). Do this after the web
partner surface is on real routes, so you're porting a shape you've already proven once rather
than designing it twice.

**6. Owner tracking screen hardening.** (§2.4, §3)
The screen exists and polls the right endpoint; what it lacks is state handling. Rename the
`job.partner.*` reads to `current_assignment.*` (§5.1 — four lines, and line 183 will throw on a
null rating as written), null-guard the whole object for `requested`/`matching`, render all eight
statuses from §3.1, use the timeline for "searching for 90 seconds", promote cancel after a
minute of `matching`, and handle `no_match_found` with the three-cause split from §3.3. This is
where a demo either feels solid or feels like a prototype, and none of it needs a new endpoint.

**7. `can_rate`-driven rating forms on both sides.** (§2.6)
The write path already exists at the wrong URL (fixed in step 3); this is wiring the read so the
form appears exactly when the server says it may. Both sides, since the endpoints are
role-agnostic and the mechanic's side is nearly free once the owner's works.

**8. Partner signup against the real routes.** (§2.8)
Deliberately late. A demo can use a seeded verified mechanic; it cannot use a mocked accept. Note
that `verification_status` can't be polled (§2.8), so cache what signup returned and don't build
a progress screen on it yet.

**9. Stop and ask before anything in §5.4.**
Earnings, stats, job history and the admin panel all need endpoints that don't exist. Admin
analytics is the next backend task, so those screens will have something to build against
shortly — but not today, and a screen built against a stub will encode the stub's shape.

---

## Where to look next

- `HANDOFF-frontend-contract.md` — exact request/response bodies, error codes, and the change
  log. §13 is the newest (notifications).
- `docs/adr/ADR.md` — why the backend works the way it does. The ones that explain behaviour
  you'll see from the client: **ADR-016** (`no_match_found` sharing a status with a dispatch
  outage, §3.3), **ADR-017** (why an offer carries no customer contact details, §4.2),
  **ADR-018** (the rating aggregate), **ADR-019** (notifications, §2.7).
- `TASKS.md` — what's built and what's queued on the backend.

**If a path in this document doesn't work, tell me rather than working around it.** Every
method-and-path pair in §2 was checked against its route decorator on 2026-10-01, but a wrong
path here costs you real time, and I'd rather fix the document than have you build against a
guess.
