# One message to paste to Adarsh — 2026-09-27

> **This file exists to be copied and sent, once.** It is not a source of truth —
> `HANDOFF-frontend-contract.md` §10 is. It repeats that section deliberately so the
> message stands on its own without him opening the repo. It is short on purpose: one
> new endpoint, one correction, one thing he cannot build.
>
> **NOT SENT.** I have no channel to Adarsh. Someone has to paste this.
>
> Everything below the line is the message. Paste it whole.

---

**Your partner offer screen is unblocked. `GET /api/v1/partners/me/offers` is live as of today.**

This was the last backend gap in the partner flow. Full detail is in
`HANDOFF-frontend-contract.md` §10 (rewritten today), but here's what you need to start:

## 1. The endpoint

```
GET /api/v1/partners/me/offers
Authorization: Bearer <partner token>
```

`/me`, not `/{partner_id}` — the partner comes from the token, so there's no id to pass.

**200** returns every offer that partner can still answer, newest first:

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
  "meta": { "request_id": "..." }
}
```

`data` is the array itself, same as `GET /vehicles`.

Six things before you design the card:

1. **`data: []` with a 200 is the normal idle state.** A mechanic on shift with nothing
   pending gets an empty array — it's the most common response this endpoint will ever
   give. Don't render an error for it.
2. **`assignment_id` is the whole point.** It's what you POST to
   `/job-assignments/{assignment_id}/respond`. It is NOT the `job_id`.
3. **It's a list.** A partner can hold several offers at once. Don't build single-offer UI.
4. **`distance_at_offer_m` and `estimated_arrival_min` are snapshots**, frozen when the
   engine scored that partner. They are never recomputed on read and will drift as the
   mechanic drives. Label them ("~1.0 km when offered") or recompute from device GPS.
5. **`price_estimate` and `distance_at_offer_m` are JSON strings, not numbers** —
   `Decimal` server-side so nothing rounds in transit. Parse before arithmetic.
6. **Everything inside `job` is nullable except `status` and `requested_at`.**

No push yet (notifications aren't built). Poll it while the partner is on shift — please
**5–10 seconds**, not sub-second, and stop when the app backgrounds or they go off shift.
The query is fast (33–52 ms measured) but the DB connection pool is deliberately small.

## 2. The one thing you can't build, and why

**There is no owner name, owner phone number, `user_id`, or pickup lat/lng in this
response** — so **an offer card cannot have a "call customer" button or a map pin.**

That's a deliberate decision, not a field I forgot. Contact details go to the partner who
has *accepted* the job, not to everyone who was offered it — and the same job gets offered
onward to the next candidate if this one declines, so a phone number here is a phone number
handed to every mechanic the engine considered. An offer is a question; answering "no"
shouldn't cost the customer their number.

What the card gets instead: `pickup_address_text` (the human address string — enough to
decide whether to take the job) and the distance. The phone number and exact coordinates
both arrive from `GET /api/v1/jobs/{job_id}` once they accept, where they're already gated.

If the mechanic flow genuinely needs navigation *before* acceptance, tell me and we'll
talk about it — it's a policy change, not a missing field. Don't work around it client-side.

## 3. One 409 you must handle

The list is a snapshot taken without a lock, on purpose. Between reading it and tapping
Accept, an offer can legitimately disappear — the owner cancelled, the partner already
answered on another device, or it moved on to the next candidate. Accept then returns
**`409 ASSIGNMENT_ALREADY_ANSWERED`**.

Treat it as ordinary traffic, exactly like the status 409s from last week: show "this job
is no longer available", re-read the list, move on. Not an error, not the user's fault.

Also still expect **`409 PARTNER_AT_CAPACITY`** (from my 2026-09-25 message). The list does
*not* hide offers from a mechanic who's already at the 2-job cap — hiding them would make
that 409 look like it came from nowhere.

## 4. Correction to something I told you on the 25th

§4 of my last message said `GET /api/v1/partners/{id}/current-assignment` existed and just
lacked an `assignment_id`. **That was wrong.** There was no such route — `/partners` had no
GET route at all, and the `current_assignment` shape you'd seen is a nested field on the
*owner's* `GET /jobs/{id}`. Sorry if you designed anything against it. Use §10 instead;
that's now the real thing.

## 5. Still waiting on you

Same question as last week, and it's the only one left: **same app with a role switch, or a
separate partner build?** (`UserRole = "owner" | "partner"` in
`mobile/src/types/index.ts:3` suggests role switch — just confirm.)

Every partner endpoint now exists — register, link-auth, availability, location, services,
offers, and the respond/status calls. The backend side of the partner flow is complete end
to end. Nothing is blocked on me.
