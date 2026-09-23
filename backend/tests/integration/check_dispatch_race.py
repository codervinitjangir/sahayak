"""Live concurrency check: a partner answering an offer while its owner cancels.

Run it directly — it needs no server process:

    python tests/integration/check_dispatch_race.py

Not named test_*.py on purpose, same as its siblings: pytest must not collect
it, because it writes to the real database and creates real Supabase accounts.

This is the third race of the same class, and the sibling of
check_job_race.py. That one covered the two *job* mutations (partner completes
vs owner cancels). This one covers the two *dispatch* mutations:

    POST /api/v1/job-assignments/{id}/respond   (accept, or reject)
    POST /api/v1/jobs/{job_id}/cancel           (owner)

The defect, before the fix. respond_to_assignment() read the job through the
lock-free get_job_by_id() and then never checked its status at all. An owner
cancelling at the same moment as a partner accepted produced: the cancel
commits (job 'cancelled', assignment 'cancelled', a 'cancelled' history row),
and then the accept — which had read a live job before any lock existed — wrote
'accepted' over the closed assignment and 'assigned' over the cancelled job.
HTTP 200 on both. The row left behind said status 'assigned' with a non-null
cancelled_at and a cancellation_reason: a job simultaneously cancelled by its
customer and assigned to a mechanic, who now believes they are on their way to
work nobody wants done. See ADR-015.

**What "exactly one wins" actually means here, which is not what it looks
like.** It is tempting to expect "either the job ends cancelled, or it ends
assigned with the cancel refused". The second half cannot happen, and should
not: cancelling an *assigned* job is legal and intended — a driver is allowed
to change their mind after a mechanic has accepted, and ALLOWED_TRANSITIONS
carries assigned -> cancelled deliberately. So there are two correct outcomes
and they differ only in ordering, not in final state:

  A. the cancel commits first — the accept is refused with
     409 ASSIGNMENT_ALREADY_ANSWERED, and the history reads
     requested -> matching -> cancelled.
  B. the accept commits first — it gets 200, the cancel then legally cancels
     an assigned job, and the history reads
     requested -> matching -> assigned -> cancelled.

Either way the job ends 'cancelled' with its assignment 'cancelled'. So the
invariant this harness asserts is not a pair of status codes — status codes
cannot discriminate, because outcome B is two 200s and so was the bug. It is:

    **a committed cancellation is never overwritten.**
    'cancelled' is the last word in the history, and a job whose cancelled_at
    is set reads 'cancelled'.

What each section does:

  2. Asserts READ COMMITTED against the app's own engine. The whole design
     rests on it: a blocked FOR UPDATE re-reads the committed row and can
     answer 409, where REPEATABLE READ aborts with a serialization failure
     these endpoints have no retry path for.
  3. The race itself, fired with asyncio.gather(), TRIALS times.
  4. The same bug reproduced **deterministically**, without relying on
     scheduling luck — the strongest section here, and the one that made the
     control run meaningful. See its comment block.
  5. The second half of the same endpoint: the re-dispatch after a rejection,
     with the cancellation injected into the exact window it opens. Also
     deterministic.
  6. That the sequential (non-racing) cases still answer exactly as they did
     before the change — the pre-existing assignment guard was never wrong,
     only incomplete.
  7. That nothing deadlocked, measured from pg_stat_database rather than
     asserted from the lock-ordering argument.

The database is real and every assertion about outcome is made against
Postgres, not against the API's own response body. Tokens are real Supabase
tokens. Redis is fakeredis, the single substitution, for the reasons set out at
the top of check_dispatch_flow.py.

Cleanup runs at both ends, survives a crash, and the run FAILS if the table
counts do not return to their baseline.
"""
import asyncio
import sys
import time
import uuid
from pathlib import Path

# Windows consoles default to cp1252, which cannot encode the arrows below, and
# a UnicodeEncodeError from a print() would abort the run *between* the
# assertions and the cleanup — leaving QA rows in the database.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

import fakeredis.aioredis  # noqa: E402
import httpx  # noqa: E402
import psycopg2  # noqa: E402
import psycopg2.extras  # noqa: E402

from app.config.redis_client import set_redis_client  # noqa: E402
from app.config.settings import get_settings  # noqa: E402

S = get_settings()
SUPA = S.SUPABASE_URL.rstrip("/")
SEC = S.SUPABASE_SECRET_KEY
PUB = S.SUPABASE_PUBLISHABLE_KEY

USER_ID = "75e138ea-e39a-48da-8717-f4287099ddcc"      # Test Driver QA
VEHICLE_ID = "4c1c0c88-1d14-44d2-b21d-eba9d38c7453"   # their Maruti Swift

SERVICE_CODE = "battery_jumpstart"   # requires_vehicle_equipment = False

PICKUP_LAT, PICKUP_LNG = 23.0300, 72.5600
KM_PER_DEG_LAT = 111.32
NEAR_LAT = PICKUP_LAT + 1.0 / KM_PER_DEG_LAT     # ~1 km away
FAR_LAT = PICKUP_LAT + 4.0 / KM_PER_DEG_LAT      # ~4 km away, still in radius

# Distinct from every other harness's numbers, domain and tag, so two runs can
# never purge each other's rows out from under one another. Two partners, not
# one: section 5 needs a *second* candidate to exist, or the re-dispatch it is
# testing would end in 'no_match_found' for an uninteresting reason.
QA_DOMAIN = "sahayak-dispatchraceqa.invalid"
PHONE_PREFIX = "+91900000096"
PARTNER_PHONES = {"near": PHONE_PREFIX + "1", "far": PHONE_PREFIX + "2"}
JOB_TAG = "DRACE-QA"

# Six trials, not one. A single pass can succeed by accident: if the event loop
# happens to run one request to completion before the other's first await, the
# two never overlap and the trial degenerates into the sequential case that
# cannot fail. Six independent jobs make that coincidence unlikely to hold
# throughout, and the outcome split is printed so a run that never actually
# raced is visible rather than merely green.
TRIALS = 6

# How long a request is given to finish while the row is deliberately locked by
# someone else. It must not finish.
BLOCK_TIMEOUT_S = 2.0

_results: list[tuple[bool, str, str]] = []
_cleaned = False


def check(label: str, condition: bool, detail: str = "") -> None:
    _results.append((bool(condition), label, detail))
    mark = "PASS" if condition else "FAIL"
    print(f"  [{mark}] {label}" + (f"  — {detail}" if detail else ""))


def section(title: str) -> None:
    print(f"\n{title}\n" + "-" * len(title))


# --------------------------------------------------------------------------
# Database access — used only to verify, to hold locks on purpose, to inject
# one cancellation at a controlled moment, and to clean up.
# --------------------------------------------------------------------------
dsn = S.DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://")
conn = psycopg2.connect(dsn)
conn.autocommit = True

TABLES = (
    "users", "vehicles", "partners", "partner_services",
    "jobs", "job_status_history", "job_assignments",
)


def counts() -> dict:
    q = conn.cursor()
    return {t: (q.execute(f"SELECT count(*) FROM {t}"), q.fetchone()[0])[1] for t in TABLES}


def rows(sql: str, params=None) -> list:
    q = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    q.execute(sql, params or {})
    return q.fetchall()


def one(sql: str, params=None):
    result = rows(sql, params)
    return result[0] if result else None


def job_row(job_id: str) -> dict:
    return one(
        "SELECT status, cancelled_at, cancellation_reason, price_final, completed_at "
        "FROM jobs WHERE id = %(i)s", {"i": job_id},
    ) or {}


def assignments_for(job_id: str) -> list:
    return rows(
        "SELECT id, partner_id, status, assignment_rank FROM job_assignments "
        "WHERE job_id = %(i)s ORDER BY assignment_rank", {"i": job_id},
    )


def history_for(job_id: str) -> list:
    return rows(
        "SELECT status, note, changed_at FROM job_status_history "
        "WHERE job_id = %(i)s ORDER BY changed_at, id", {"i": job_id},
    )


def chain(job_id: str) -> str:
    return " → ".join(str(h["status"]) for h in history_for(job_id))


def deadlock_count() -> int:
    """Postgres' own count of deadlocks detected in this database.

    Turns section 7 from a restatement of the lock-ordering argument into a
    measurement. It cannot prove no deadlock is *possible* — only the ordering
    argument does that — but a nonzero delta would refute it outright.
    """
    return one("SELECT deadlocks FROM pg_stat_database "
               "WHERE datname = current_database()")["deadlocks"]


def exclusive_locks_on_jobs() -> int:
    return one(
        "SELECT count(*) AS n FROM pg_locks l JOIN pg_class c ON c.oid = l.relation "
        "WHERE c.relname = 'jobs' AND l.mode LIKE '%%Exclusive%%' AND l.granted"
    )["n"]


def cancel_outside_the_app(job_id: str, *, close_assignments: bool) -> None:
    """Commit an owner cancellation from outside the application.

    Used by sections 4 and 5 to land a cancellation inside a window that is too
    narrow to hit reliably with real concurrency. It writes exactly what
    job_service.cancel_job_by_owner() writes — status, cancelled_at, reason, a
    history row, and (optionally) the open assignments — so the state the
    endpoint under test then encounters is a state the product can really
    produce, not a synthetic one.

    close_assignments=False is deliberate in section 4; see the comment there.
    """
    q = conn.cursor()
    q.execute(
        "UPDATE jobs SET status = 'cancelled', cancelled_at = now(), "
        "cancellation_reason = %(r)s WHERE id = %(i)s",
        {"i": job_id, "r": f"{JOB_TAG} injected owner cancellation"},
    )
    q.execute(
        "INSERT INTO job_status_history (id, job_id, status, note) "
        "VALUES (gen_random_uuid(), %(i)s, 'cancelled', %(n)s)",
        {"i": job_id, "n": f"Cancelled by owner: {JOB_TAG} injected"},
    )
    if close_assignments:
        q.execute(
            "UPDATE job_assignments SET status = 'cancelled' "
            "WHERE job_id = %(i)s AND status IN ('offered', 'accepted')",
            {"i": job_id},
        )


def purge() -> None:
    """Remove everything this script creates, in foreign-key order.

    Scoped by the QA phone prefix and the job tag, never by "recent rows" — a
    cleanup that works by timestamp will one day delete something real.
    """
    q = conn.cursor()
    q.execute(
        "DELETE FROM job_assignments WHERE partner_id IN "
        "(SELECT id FROM partners WHERE phone LIKE %(p)s)", {"p": PHONE_PREFIX + "%"},
    )
    q.execute(
        "DELETE FROM job_status_history WHERE job_id IN "
        "(SELECT id FROM jobs WHERE issue_description LIKE %(tag)s)", {"tag": JOB_TAG + "%"},
    )
    q.execute(
        "DELETE FROM job_assignments WHERE job_id IN "
        "(SELECT id FROM jobs WHERE issue_description LIKE %(tag)s)", {"tag": JOB_TAG + "%"},
    )
    q.execute("DELETE FROM jobs WHERE issue_description LIKE %(tag)s", {"tag": JOB_TAG + "%"})
    q.execute(
        "DELETE FROM partner_services WHERE partner_id IN "
        "(SELECT id FROM partners WHERE phone LIKE %(p)s)", {"p": PHONE_PREFIX + "%"},
    )
    q.execute("DELETE FROM partners WHERE phone LIKE %(p)s", {"p": PHONE_PREFIX + "%"})
    q.execute("UPDATE users SET auth_user_id = NULL WHERE id = %(i)s", {"i": USER_ID})


# --------------------------------------------------------------------------
# Supabase accounts — real tokens, same approach as check_auth_flow.py.
# --------------------------------------------------------------------------
_admin_headers = {"apikey": SEC, "Authorization": f"Bearer {SEC}",
                  "Content-Type": "application/json"}
_supa = httpx.Client(base_url=SUPA, timeout=60.0)


def _supa_call(method: str, url: str, attempts: int = 3, **kwargs) -> httpx.Response:
    """Call Supabase, retrying a *transport* failure but never a rejection.

    Supabase is over the public internet and a read timeout here is weather,
    not a result. Only httpx.TransportError is retried: a 4xx is an answer, and
    retrying an answer turns a real failure into a slower real failure.
    """
    last: Exception | None = None
    for attempt in range(attempts):
        try:
            return _supa.request(method, url, **kwargs)
        except httpx.TransportError as exc:
            last = exc
            print(f"  ! Supabase {method} {url} timed out "
                  f"(attempt {attempt + 1}/{attempts}), retrying")
    raise SystemExit(f"Supabase unreachable after {attempts} attempts: {last}")


def purge_supabase_accounts() -> None:
    r = _supa_call("GET", "/auth/v1/admin/users", headers=_admin_headers,
                   params={"per_page": 200})
    if r.status_code != 200:
        print(f"  ! could not list Supabase users: {r.status_code} {r.text[:120]}")
        return
    for u in r.json().get("users", []):
        if (u.get("email") or "").endswith("@" + QA_DOMAIN):
            _supa_call("DELETE", f"/auth/v1/admin/users/{u['id']}", headers=_admin_headers)


def supabase_identity(label: str) -> tuple[str, str]:
    """Create a real Supabase account and sign in. Returns (auth_user_id, token)."""
    email = f"draceqa-{label}@{QA_DOMAIN}"
    password = "Qa!" + uuid.uuid4().hex[:20]
    r = _supa_call(
        "POST", "/auth/v1/admin/users", headers=_admin_headers,
        json={"email": email, "password": password, "email_confirm": True},
    )
    if r.status_code not in (200, 201):
        raise SystemExit(f"could not create {email}: {r.status_code} {r.text[:300]}")
    uid = r.json()["id"]

    r = _supa_call(
        "POST", "/auth/v1/token", params={"grant_type": "password"},
        headers={"apikey": PUB, "Content-Type": "application/json"},
        json={"email": email, "password": password},
    )
    if r.status_code != 200:
        raise SystemExit(f"could not sign in as {email}: {r.status_code} {r.text[:300]}")
    return uid, r.json()["access_token"]


def hdr(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def code_of(r: httpx.Response) -> str:
    try:
        return r.json().get("error", {}).get("code", "?")
    except Exception:       # noqa: BLE001
        return "?"


def data_of(r: httpx.Response) -> dict:
    try:
        return r.json().get("data") or {}
    except Exception:       # noqa: BLE001
        return {}


# --------------------------------------------------------------------------
# Deliberate lock holding, and one deliberate commit from inside it.
# --------------------------------------------------------------------------
class HeldLock:
    """Hold SELECT ... FOR UPDATE on one job row from outside the app.

    Used as a context manager so the transaction is always ended, even if an
    assertion inside the block fails. A leaked lock here would not just fail
    this run: the row would stay locked until the connection dropped, and the
    cleanup DELETE at the end would hang behind it.

    Unlike check_job_race.py's version this one can *commit* — section 4 needs
    to change the row while a blocked request is queued behind it, and a
    rollback would release the lock without the request ever seeing anything
    new to react to.
    """

    def __init__(self, job_id: str) -> None:
        self.job_id = job_id
        self.conn = None

    def __enter__(self) -> "HeldLock":
        self.conn = psycopg2.connect(dsn)     # autocommit off: we want a txn
        cur = self.conn.cursor()
        cur.execute("SELECT id FROM jobs WHERE id = %(i)s FOR UPDATE", {"i": self.job_id})
        cur.fetchall()
        return self

    def is_genuinely_held(self) -> bool:
        """Confirm from a third connection that the row really is locked.

        Without this, "the request blocked" would be consistent with the lock
        never having been taken and the request having been slow for some other
        reason. NOWAIT turns "would block" into an immediate error, which is
        exactly the question being asked.
        """
        probe = psycopg2.connect(dsn)
        try:
            cur = probe.cursor()
            try:
                cur.execute("SELECT id FROM jobs WHERE id = %(i)s FOR UPDATE NOWAIT",
                            {"i": self.job_id})
                cur.fetchall()
                return False          # got the lock, so nobody was holding it
            except psycopg2.errors.LockNotAvailable:
                return True
            finally:
                probe.rollback()
        finally:
            probe.close()

    def cancel_the_job_and_commit(self) -> None:
        """Cancel the locked job in this same transaction, then commit.

        This is the whole trick of section 4: the write lands while another
        request is already queued on the row lock, so the moment the lock is
        released that request is looking at a job that changed underneath it.
        No timing luck involved.
        """
        cur = self.conn.cursor()
        cur.execute(
            "UPDATE jobs SET status = 'cancelled', cancelled_at = now(), "
            "cancellation_reason = %(r)s WHERE id = %(i)s",
            {"i": self.job_id, "r": f"{JOB_TAG} cancelled while holding the lock"},
        )
        cur.execute(
            "INSERT INTO job_status_history (id, job_id, status, note) "
            "VALUES (gen_random_uuid(), %(i)s, 'cancelled', %(n)s)",
            {"i": self.job_id, "n": f"Cancelled by owner: {JOB_TAG} under lock"},
        )
        self.conn.commit()

    def __exit__(self, *_exc) -> None:
        if self.conn is not None:
            try:
                self.conn.rollback()
            finally:
                self.conn.close()
            self.conn = None


async def timed(coro) -> tuple:
    """Await a request, returning (response, exception, seconds).

    Exceptions are captured rather than raised so that one request blowing up
    cannot hide what the other one did — which, in a race, is the half of the
    evidence that matters.
    """
    t0 = time.perf_counter()
    try:
        return await coro, None, time.perf_counter() - t0
    except Exception as exc:     # noqa: BLE001
        return None, exc, time.perf_counter() - t0


async def app_isolation_level() -> str:
    """Ask the application's own engine what isolation level it runs at.

    Deliberately not asked over the psycopg2 connection above: that one has
    different settings and would answer for the harness rather than for the
    code under test.
    """
    from sqlalchemy import text

    from app.config.database import AsyncSessionLocal

    async with AsyncSessionLocal() as db:
        result = await db.execute(text("SELECT current_setting('transaction_isolation')"))
        return str(result.scalar_one())


async def make_offered_job(c, owner_token, tag) -> tuple[str, dict]:
    """Create a job and return (job_id, its rank-1 offer row).

    Stops at 'offered' — no accept. That is the state this harness races
    against, and it is the only state a live offer can exist in: dispatch_job()
    commits the move to 'matching' before the offer row is written.

    Which partner gets rank 1 is decided by the scoring, not by this script, so
    the offer row is read back from the database rather than assumed.
    """
    r = await c.post("/api/v1/jobs", json={
        "vehicle_id": VEHICLE_ID, "service_code": SERVICE_CODE,
        "pickup_lat": PICKUP_LAT, "pickup_lng": PICKUP_LNG,
        "pickup_address_text": "Dispatch race QA pickup",
        "issue_description": f"{JOB_TAG} {tag}",
    }, headers=hdr(owner_token))
    if r.status_code != 201:
        raise SystemExit(f"job {tag} creation failed: {r.status_code} {r.text[:300]}")
    job_id = data_of(r)["id"]

    offers = assignments_for(job_id)
    if len(offers) != 1 or offers[0]["status"] != "offered":
        raise SystemExit(
            f"job {tag}: expected exactly one 'offered' assignment, got {offers}"
        )
    if job_row(job_id)["status"] != "matching":
        raise SystemExit(f"job {tag}: expected status 'matching', "
                         f"got {job_row(job_id)['status']!r}")
    return job_id, offers[0]


async def main() -> None:
    global _cleaned

    set_redis_client(fakeredis.aioredis.FakeRedis(decode_responses=True))

    from app.main import app            # noqa: E402  (after the Redis override)
    from app.services import dispatch_service   # noqa: E402

    print("Cleaning up any leftovers from a previous run...")
    purge()
    purge_supabase_accounts()
    baseline = counts()
    deadlocks_before = deadlock_count()
    print(f"  baseline: {baseline}")
    print(f"  deadlocks recorded in this database so far: {deadlocks_before}")

    transport = httpx.ASGITransport(app=app)
    # 30s, not the 5s default: sections 4 and 5 deliberately leave a request
    # blocked on a row lock and then release it, and a client timeout would
    # report that as a failure rather than as the wait it is.
    async with httpx.AsyncClient(transport=transport, base_url="http://drace.test",
                                 timeout=30.0) as c:

        # ------------------------------------------------------------------
        section("1. One owner, two verified partners")
        # ------------------------------------------------------------------
        _, owner_token = supabase_identity("owner")
        r = await c.post(f"/api/v1/users/{USER_ID}/link-auth", headers=hdr(owner_token))
        check("owner linked to the test driver", r.status_code == 200,
              f"HTTP {r.status_code} {code_of(r)}")

        partners: dict[str, dict] = {}
        for label, lat in (("near", NEAR_LAT), ("far", FAR_LAT)):
            _, token = supabase_identity(label)
            r = await c.post("/api/v1/partners", json={
                "name": f"Dispatch Race QA {label}", "phone": PARTNER_PHONES[label],
                "primary_category_code": "mechanical",
            })
            if r.status_code != 201:
                raise SystemExit(f"{label} partner registration failed: "
                                 f"{r.status_code} {r.text[:300]}")
            pid = data_of(r)["id"]

            r = await c.post(f"/api/v1/partners/{pid}/link-auth", headers=hdr(token))
            if r.status_code != 200:
                raise SystemExit(f"{label} link-auth failed: {r.status_code} {r.text[:300]}")

            # Verification has no endpoint yet — that workflow is a separate
            # task — so it is set directly rather than pretended away.
            q = conn.cursor()
            q.execute("UPDATE partners SET verification_status='verified', "
                      "rating_avg=4.6, rating_count=12 WHERE id=%(i)s", {"i": pid})

            for path, body in (
                (f"/api/v1/partners/{pid}/services", {"service_codes": [SERVICE_CODE]}),
                (f"/api/v1/partners/{pid}/location", {"lat": lat, "lng": PICKUP_LNG}),
            ):
                r = await c.post(path, json=body, headers=hdr(token))
                if r.status_code not in (200, 201):
                    raise SystemExit(f"{path} failed: {r.status_code} {r.text[:300]}")
            r = await c.patch(f"/api/v1/partners/{pid}/availability",
                              json={"is_available": True}, headers=hdr(token))
            if r.status_code != 200:
                raise SystemExit(f"{label} availability failed: "
                                 f"{r.status_code} {r.text[:300]}")
            partners[label] = {"id": pid, "token": token}

        by_id = {p["id"]: p for p in partners.values()}
        check("two partners are verified, located, serviced and available",
              len(by_id) == 2,
              f"{partners['near']['id'][:8]}… ~1km, {partners['far']['id'][:8]}… ~4km")

        # ------------------------------------------------------------------
        section("2. The assumption the whole fix rests on")
        # ------------------------------------------------------------------
        level = await app_isolation_level()
        check("the app's engine runs in READ COMMITTED", level == "read committed",
              f"transaction_isolation = {level!r}")
        print("      (a blocked FOR UPDATE re-reads the committed row under this")
        print("       level and can answer 409; under REPEATABLE READ it would")
        print("       abort with a serialization failure and this endpoint has")
        print("       no retry path for that)")

        # ------------------------------------------------------------------
        section(f"3. The race — {TRIALS} trials, accept vs owner-cancel, fired together")
        # ------------------------------------------------------------------
        outcomes = {"cancel_first": 0, "accept_first": 0}

        for trial in range(1, TRIALS + 1):
            job_id, offer = await make_offered_job(c, owner_token, f"trial-{trial}")
            partner_token = by_id[str(offer["partner_id"])]["token"]

            # Both coroutines are created before either is awaited, so gather
            # starts them into the same event-loop tick. Each request gets its
            # own session from get_db and therefore its own connection and its
            # own transaction — without that, they would serialize in the pool
            # instead of at the row lock and this would prove nothing.
            accept = c.post(
                f"/api/v1/job-assignments/{offer['id']}/respond",
                json={"action": "accept"},
                headers=hdr(partner_token),
            )
            cancel = c.post(
                f"/api/v1/jobs/{job_id}/cancel",
                json={"cancellation_reason": f"{JOB_TAG} owner changed their mind"},
                headers=hdr(owner_token),
            )
            (acc_r, acc_e, acc_t), (can_r, can_e, can_t) = await asyncio.gather(
                timed(accept), timed(cancel)
            )

            label = f"trial {trial}"
            if acc_e is not None or can_e is not None:
                check(f"{label}: both requests returned a response", False,
                      f"accept={acc_e!r} cancel={can_e!r}")
                continue

            row = job_row(job_id)
            status = row.get("status")
            states = [a["status"] for a in assignments_for(job_id)]
            hist = [h["status"] for h in history_for(job_id)]

            # The owner's cancellation is never refused here. 'assigned' is not
            # terminal, so whichever order the two land in, the cancel is legal
            # — which is exactly why status codes cannot discriminate this bug
            # and the row has to be asserted instead.
            check(f"{label}: the owner's cancellation succeeded",
                  can_r.status_code == 200,
                  f"HTTP {can_r.status_code} {code_of(can_r)} ({can_t * 1000:.0f}ms)")

            check(f"{label}: the accept either won cleanly or was refused with 409",
                  acc_r.status_code == 200
                  or (acc_r.status_code == 409
                      and code_of(acc_r) == "ASSIGNMENT_ALREADY_ANSWERED"),
                  f"HTTP {acc_r.status_code} {code_of(acc_r)} ({acc_t * 1000:.0f}ms)")

            # THE assertion. Before the fix this is what failed: the accept
            # wrote 'assigned' over a committed 'cancelled', leaving a job that
            # claimed both. Status codes did not catch it — the bug returned
            # 200 on both requests, and so does the legitimate accept-first
            # ordering.
            check(f"{label}: the committed cancellation was not overwritten",
                  status == "cancelled" and row["cancelled_at"] is not None,
                  f"status {status}, cancelled_at {row['cancelled_at']}, "
                  f"reason {row['cancellation_reason']!r}")

            check(f"{label}: 'cancelled' is the last word in the timeline",
                  hist and hist[-1] == "cancelled", chain(job_id))

            check(f"{label}: the assignment agrees with the job",
                  states == ["cancelled"],
                  f"job {status} / assignments {states}")

            check(f"{label}: no extra offer was made",
                  len(states) == 1, f"{len(states)} assignment rows")

            if acc_r.status_code == 200:
                outcomes["accept_first"] += 1
                check(f"{label}: an accept that won is recorded in the timeline",
                      "assigned" in hist and hist.index("assigned") < hist.index("cancelled"),
                      chain(job_id))
            else:
                outcomes["cancel_first"] += 1
                check(f"{label}: a refused accept wrote nothing",
                      "assigned" not in hist, chain(job_id))

        print(f"\n  outcome split across {TRIALS} trials: "
              f"{outcomes['cancel_first']} cancel-first (accept refused 409), "
              f"{outcomes['accept_first']} accept-first (both 200)")
        if 0 in outcomes.values():
            print("      (one-sided: scheduling favoured one ordering throughout.")
            print("       Section 4 is the deterministic proof and does not")
            print("       depend on which side wins here.)")

        # ------------------------------------------------------------------
        section("4. The same bug, reproduced deterministically")
        # ------------------------------------------------------------------
        # Section 3 needs the two requests to overlap, which is a matter of
        # scheduling luck. This section removes the luck entirely:
        #
        #   1. hold the job row with FOR UPDATE from a separate connection;
        #   2. fire the accept — post-fix its *first* act is to take that same
        #      lock, so it queues instead of deciding;
        #   3. cancel the job inside the holding transaction and commit,
        #      releasing the lock;
        #   4. the accept now acquires the lock, re-reads the row it was
        #      blocked on (READ COMMITTED), and must refuse.
        #
        # Only the job is cancelled here — the assignment is deliberately left
        # 'offered'. A real owner cancel closes it too, and then the
        # pre-existing `assignment.status != 'offered'` guard could be what
        # answers. Leaving it open removes that possibility, so a pass isolates
        # the new post-lock job-status check and nothing else. The realistic
        # both-rows cancellation is what section 3 exercises.
        job_id, offer = await make_offered_job(c, owner_token, "deterministic")
        partner_token = by_id[str(offer["partner_id"])]["token"]

        with HeldLock(job_id) as held:
            check("the job row is locked by another transaction",
                  held.is_genuinely_held(), "FOR UPDATE NOWAIT was refused")

            blocked = asyncio.create_task(c.post(
                f"/api/v1/job-assignments/{offer['id']}/respond",
                json={"action": "accept"},
                headers=hdr(partner_token),
            ))
            t0 = time.perf_counter()
            try:
                # shield() so the timeout gives up waiting without cancelling
                # the request — the point is to change the row and then watch
                # the request react, which needs the task still alive.
                await asyncio.wait_for(asyncio.shield(blocked), timeout=BLOCK_TIMEOUT_S)
                waited = time.perf_counter() - t0
                check("the accept blocked on the held row lock", False,
                      f"it completed in {waited * 1000:.0f}ms while the row was locked")
            except asyncio.TimeoutError:
                check("the accept blocked on the held row lock", True,
                      f"still waiting after {BLOCK_TIMEOUT_S:.1f}s")
                check("and it had written nothing while it waited",
                      assignments_for(job_id)[0]["status"] == "offered"
                      and job_row(job_id)["status"] == "matching",
                      f"job {job_row(job_id)['status']}, "
                      f"assignment {assignments_for(job_id)[0]['status']}")

            # The cancellation lands while the accept is queued behind it.
            held.cancel_the_job_and_commit()
            check("the job was cancelled while the accept waited",
                  job_row(job_id)["status"] == "cancelled", chain(job_id))

            r = await blocked
            check("the unblocked accept refused the cancelled job",
                  r.status_code == 409
                  and code_of(r) == "ASSIGNMENT_ALREADY_ANSWERED",
                  f"HTTP {r.status_code} {code_of(r)}")
            check("and it wrote nothing at all",
                  job_row(job_id)["status"] == "cancelled"
                  and assignments_for(job_id)[0]["status"] == "offered"
                  and "assigned" not in [h["status"] for h in history_for(job_id)],
                  f"job {job_row(job_id)['status']}, "
                  f"assignment {assignments_for(job_id)[0]['status']}, "
                  f"timeline {chain(job_id)}")

        # ------------------------------------------------------------------
        section("5. The other half of the same endpoint — the re-dispatch")
        # ------------------------------------------------------------------
        # _reject() commits before calling _offer_next(), deliberately, so a
        # failing candidate search cannot lose the partner's recorded "no".
        # That commit releases the lock taken in respond_to_assignment(), and
        # the window it opens is the same bug: a cancellation landing in it
        # would otherwise get a fresh 'offered' row against a cancelled job, or
        # 'no_match_found' written over 'cancelled'.
        #
        # The window is a Redis round trip wide — against fakeredis, microseconds
        # — so asyncio.gather() would almost never land in it. The cancellation
        # is injected into it instead, by wrapping find_candidates(): the wrap
        # fires only for the target job and only on the call that passes
        # exclude_partner_ids (dispatch_job passes none, _offer_next always
        # passes at least the rejecting partner), which pins it to exactly the
        # one moment of interest.
        job_id, offer = await make_offered_job(c, owner_token, "reject-window")
        rejecting_token = by_id[str(offer["partner_id"])]["token"]

        original_find = dispatch_service.find_candidates
        injected = {"fired": False}

        async def cancelling_find(db, job, exclude_partner_ids=None):
            result = await original_find(db, job, exclude_partner_ids=exclude_partner_ids)
            if (str(job.id) == job_id and exclude_partner_ids
                    and not injected["fired"]):
                injected["fired"] = True
                cancel_outside_the_app(job_id, close_assignments=True)
            return result

        dispatch_service.find_candidates = cancelling_find
        try:
            r = await c.post(
                f"/api/v1/job-assignments/{offer['id']}/respond",
                json={"action": "reject", "rejection_reason": f"{JOB_TAG} busy"},
                headers=hdr(rejecting_token),
            )
        finally:
            dispatch_service.find_candidates = original_find

        check("the cancellation was injected into the re-dispatch window",
              injected["fired"], "find_candidates wrapper fired once")
        check("the rejection itself still succeeded",
              r.status_code == 200, f"HTTP {r.status_code} {code_of(r)}")

        states = [a["status"] for a in assignments_for(job_id)]
        hist = [h["status"] for h in history_for(job_id)]
        check("the re-dispatch was abandoned, not completed",
              len(states) == 1 and states[0] == "rejected",
              f"{len(states)} assignment rows: {states}")
        check("no new offer was made against a cancelled job",
              "offered" not in states, f"{states}")
        check("the cancellation was not overwritten by the re-dispatch",
              job_row(job_id)["status"] == "cancelled"
              and "no_match_found" not in hist,
              f"status {job_row(job_id)['status']}, timeline {chain(job_id)}")
        check("and the response still reported no next offer",
              data_of(r).get("next_assignment_id") is None,
              f"next_assignment_id = {data_of(r).get('next_assignment_id')!r}, "
              f"job_status = {data_of(r).get('job_status')!r}")

        # ------------------------------------------------------------------
        section("6. The sequential cases answer exactly as they did before")
        # ------------------------------------------------------------------
        # This change was about the race window, not about the pre-existing
        # guard being wrong. These are the non-racing paths, and none of their
        # answers should have moved.
        job_id, offer = await make_offered_job(c, owner_token, "sequential-cancel")
        partner_token = by_id[str(offer["partner_id"])]["token"]

        r = await c.post(f"/api/v1/jobs/{job_id}/cancel",
                         json={"cancellation_reason": f"{JOB_TAG} sequential"},
                         headers=hdr(owner_token))
        check("an owner can cancel a job that is still only offered",
              r.status_code == 200, f"HTTP {r.status_code} {code_of(r)}")
        check("cancelling closed the open offer",
              [a["status"] for a in assignments_for(job_id)] == ["cancelled"],
              f"{[a['status'] for a in assignments_for(job_id)]}")

        r = await c.post(f"/api/v1/job-assignments/{offer['id']}/respond",
                         json={"action": "accept"}, headers=hdr(partner_token))
        check("accepting afterwards is refused on the assignment's own status",
              r.status_code == 409 and code_of(r) == "ASSIGNMENT_ALREADY_ANSWERED",
              f"HTTP {r.status_code} {code_of(r)}")
        check("and the job is still cancelled",
              job_row(job_id)["status"] == "cancelled", chain(job_id))

        job_id, offer = await make_offered_job(c, owner_token, "sequential-accept")
        partner_token = by_id[str(offer["partner_id"])]["token"]

        r = await c.post(f"/api/v1/job-assignments/{offer['id']}/respond",
                         json={"action": "accept"}, headers=hdr(partner_token))
        check("the ordinary accept still works", r.status_code == 200,
              f"HTTP {r.status_code} {code_of(r)}")
        check("and it assigned the job",
              job_row(job_id)["status"] == "assigned"
              and [a["status"] for a in assignments_for(job_id)] == ["accepted"],
              chain(job_id))

        r = await c.post(f"/api/v1/job-assignments/{offer['id']}/respond",
                         json={"action": "accept"}, headers=hdr(partner_token))
        check("a second tap on the same offer is still 409",
              r.status_code == 409 and code_of(r) == "ASSIGNMENT_ALREADY_ANSWERED",
              f"HTTP {r.status_code} {code_of(r)}")

        job_id, offer = await make_offered_job(c, owner_token, "sequential-intruder")
        stranger = partners[
            "far" if str(offer["partner_id"]) == partners["near"]["id"] else "near"
        ]["token"]
        r = await c.post(f"/api/v1/job-assignments/{offer['id']}/respond",
                         json={"action": "accept"}, headers=hdr(stranger))
        check("another partner's offer is still 403, not 409",
              r.status_code == 403, f"HTTP {r.status_code} {code_of(r)}")
        check("and the refused call left the offer untouched",
              assignments_for(job_id)[0]["status"] == "offered"
              and job_row(job_id)["status"] == "matching",
              f"job {job_row(job_id)['status']}, "
              f"assignment {assignments_for(job_id)[0]['status']}")

        # ------------------------------------------------------------------
        section("7. Lock ordering — nothing deadlocked")
        # ------------------------------------------------------------------
        # The argument is structural: cancel_job_by_owner, transition_job_status
        # and respond_to_assignment all take the jobs row first and only then
        # write job_assignments, and none of them locks a second row while
        # holding the first, so there is no cycle to form. That argument is in
        # ADR-015. This is the measurement that would refute it.
        deadlocks_after = deadlock_count()
        check("Postgres detected no deadlock during this run",
              deadlocks_after == deadlocks_before,
              f"pg_stat_database.deadlocks {deadlocks_before} → {deadlocks_after}")
        print("      (evidence, not proof — the proof is the lock ordering")
        print("       argument in ADR-015. A nonzero delta would refute it.)")

        # ------------------------------------------------------------------
        section("8. Cleanup")
        # ------------------------------------------------------------------
        purge()
        purge_supabase_accounts()
        _cleaned = True
        after = counts()
        check("every table is back to its baseline count", after == baseline,
              f"{after}" if after != baseline else "matched")
        check("no exclusive lock was left behind on jobs",
              exclusive_locks_on_jobs() == 0,
              f"{exclusive_locks_on_jobs()} granted exclusive locks")

    # ----------------------------------------------------------------------
    passed = sum(1 for ok, _, _ in _results if ok)
    total = len(_results)
    print(f"\n{'=' * 64}\n{passed}/{total} checks passed")
    if passed != total:
        print("\nFailures:")
        for ok, label, detail in _results:
            if not ok:
                print(f"  - {label}" + (f"  ({detail})" if detail else ""))
        raise SystemExit(1)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except BaseException:
        # Cleanup has to survive a crash, not just a clean finish. Section 8
        # runs inside main(), so anything that escapes before it — a network
        # timeout to Supabase, a KeyboardInterrupt — would otherwise leave QA
        # rows behind. The next run's opening purge would tidy them, but its
        # *baseline* is measured after that purge and before its own writes, so
        # the leftovers would silently become part of the expected state.
        # Purging here keeps the baseline meaningful.
        #
        # Guarded by _cleaned so a run that finished and merely *failed* some
        # checks does not re-purge and claim it died.
        if not _cleaned:
            print("\n! run did not finish — cleaning up before exiting")
            try:
                purge()
                purge_supabase_accounts()
            except Exception as cleanup_error:      # noqa: BLE001
                print(f"  ! cleanup itself failed: {cleanup_error}")
        raise
    finally:
        conn.close()
