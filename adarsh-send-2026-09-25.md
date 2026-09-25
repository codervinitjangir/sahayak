# One message to paste to Adarsh — 2026-09-25

> **This file exists to be copied and sent, once.** It is not a source of truth — 
> `HANDOFF-frontend-contract.md` is. It deliberately repeats content from §10 and §11 of that 
> doc so the message stands on its own without him opening the repo. Delete or ignore this 
> file after sending; if the contract changes again, update HANDOFF and write a fresh one.
>
> Everything below the line is the message. Paste it whole.

---

Hi Adarsh — backend contract update. This covers **everything since the 23rd**, in one go, because I let three separate updates stack up instead of sending each one. That's on me: you've been building against a contract that moved four times without you being told. Nothing below breaks code you've already written — no request shape changed, no response shape changed — but two things are new and one needs a decision from you.

Full detail is in `HANDOFF-frontend-contract.md` (repo root), sections 10 and 11. Short version:

---

## 1. NEW ERROR CODE — `409 PARTNER_AT_CAPACITY`

On `POST /api/v1/job-assignments/{assignment_id}/respond` with `{"action": "accept"}`.

```
409  {
  "error": {
    "code": "PARTNER_AT_CAPACITY",
    "message": "You are already working the maximum number of jobs (2). This job has been offered to another partner."
  }
}
```

A mechanic who already holds 2 active jobs can no longer accept a third. Until today they could — that was a real bug I found under load (one partner holding 4 against a cap of 2). It's fixed now, which means **accept can fail**, where before it always succeeded.

**Handle it differently from every other 409 you handle:**

- **Don't** show "try again" — it will fail identically until one of their jobs finishes.
- **Don't** remove the offer card. The offer is still `'offered'` on our side. Being full isn't declining, and we're not charging their acceptance rate for a limit we imposed. If they finish a job soon, that same `assignment_id` may become acceptable again.
- **Do** show the message (it names the cap), or your own copy: *"You're at your job limit — finish a job to take this one."*
- **Do** expect the next tap on that card to return `ASSIGNMENT_ALREADY_ANSWERED` instead, because we immediately re-offer the job to the next mechanic. **Both are 409s and they mean opposite things** — `ASSIGNMENT_ALREADY_ANSWERED` = this offer is gone, stop showing it; `PARTNER_AT_CAPACITY` = you're full, it may work later. **Branch on `error.code`, never on the status code alone.**

Repeat taps are safe — same 409, and nothing extra gets re-dispatched. There's a guard.

## 2. `no_match_found` WITH ZERO ASSIGNMENTS — render it, don't crash on it

On `GET /api/v1/jobs/{id}` and the owner's job list.

An owner can now see a job go `requested` → `no_match_found` within a second or two of creating it, **having never been offered to anyone**: `assignments` empty, no offers. This was always possible (nobody within 10 km offering that service), but it now also covers the case where our partner-location store is unreachable — previously those jobs just sat in `requested` forever with no signal to anyone, which was the second bug the load test found.

**What you need to do:** nothing, *if* your job-detail screen already handles a `no_match_found` job with an empty offers list. If it crashes, or spins forever waiting for an offer that never arrives, that's the fix.

**Copy suggestion:** *"We couldn't find a mechanic for this request."* plus the two actions the owner actually has — **cancel**, or **request again**. `no_match_found` is deliberately **not** terminal: cancel works from it, and re-requesting is a fresh `POST /api/v1/jobs`.

Don't try to distinguish "nobody available" from "our service was down" — we record the cause server-side but deliberately don't expose it, because the owner's available action is identical either way. If you want it for an admin screen later, ask and I'll expose it properly rather than have you parse a note field.

## 3. WHAT DID NOT CHANGE (so you don't go looking)

- `POST /api/v1/jobs` still returns **201** even when dispatch fails completely. Measured at 782 ms with the location store hard-timing-out on every call. Keep treating 201 as "the job exists", and keep reading `status` from the response body rather than assuming `matching`.
- Reject is unchanged, including `next_assignment_id: null`.
- Availability toggle, offer reads, and polling: unchanged.
- **No new status values.** Nothing to add to your status→label map.

## 4. A GAP THAT BLOCKS YOUR PARTNER OFFER SCREEN — and it's my change to make, not yours

Before you build a partner offer screen, know that **there is currently no way for a partner client to learn its `assignment_id`** — which is the one thing you need to answer an offer:

- `GET /api/v1/partners/{id}/current-assignment` returns `partner_id` but **not** `assignment_id`
- there's no "list my offers" endpoint at all

So the path from "I've been offered a job" to "here's the id to accept it with" is broken. My load-test harness cheated by reading ids out of Postgres, which a real app obviously can't do. **Please don't work around this client-side.** What I'd build:

```
GET /api/v1/partners/me/offers  →  200 { data: [ { assignment_id, job_id,
                                                   distance_at_offer_m,
                                                   offered_at, job: {...} } ] }
```

A list, not a single value, because a partner can hold several outstanding offers at once. Tell me if you'd rather have a different shape and I'll build that instead — but tell me before you start the screen, not after.

## 5. THE DECISION I STILL NEED FROM YOU

**Partner frontend: same app with a role switch, or a separate build?**

This has been open since the 20th and it's now the thing holding up partner-side work. `UserRole = "owner" | "partner"` already exists in `mobile/src/types/index.ts`, which suggests role switch — but I don't want to assume. Auth shipped role-agnostic so the backend doesn't care either way; every partner-side flow I've verified has been through scripted tokens, never a real client.

An answer in one line is enough.

---

**Verification, for what it's worth:** both fixes above are covered by 49 assertions against the real database and 21 unit tests, including a control run with the fixes reverted that reproduces the original bugs (12 accepts landing on a cap of 2, and a job left silently in `requested`). Full backend suite is at 197 unit tests and 492 live assertions, all green.

Sorry again for batching four updates into one message. Ping me on anything above that's ambiguous — especially §4 and §5, which need answers rather than just reading.
