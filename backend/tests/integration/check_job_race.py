"""Live concurrency check: a partner completing a job while its owner cancels it.

Run it directly — it needs no server process:

    python tests/integration/check_job_race.py

Not named test_*.py on purpose, same as its siblings: pytest must not collect
it, because it writes to the real database and creates real Supabase accounts.

Why this harness exists, and why the other five could not have caught this.
Every check before it drives one request at a time. Sequential calls cannot
reproduce a lost update *even with the bug present* — the first request has
already committed by the time the second reads, so the second correctly sees a
terminal job and returns 409. The suite was green against a real defect, and
would have stayed green forever. Reproducing it needs two requests genuinely in
flight at once, which is what asyncio.gather() below does.

The defect, before the fix: both requests read the job at 'in_progress', both
found their transition legal, and both wrote. The second write won. The
observable result was a job whose status said 'cancelled' while its
completed_at and price_final were set — a row asserting both that the mechanic
finished the work and that the customer called it off, with two history rows
and a 200 on both requests. Nothing logged a warning. See ADR-013.

What each section proves:

  3. The race itself, six times over. The status codes matter less than the
     row: section 3 asserts the job is not self-contradictory, because *that*
     is the shape the bug produced and a status-code-only check would have
     missed it.
  4. That a mutation respects a row lock held by someone else — forced, by
     holding the row from a separate connection and confirming the endpoint
     waits rather than inferring it from timing luck. Note honestly what this
     does *not* prove: it passes against the pre-fix code too, because the
     UPDATE at the end of the transaction always took a row lock implicitly.
     The bug was never that the write skipped the lock; it was that the
     *decision* — "is this transition legal from the current status" — was
     made before the lock was held, so both requests decided yes. Section 3 is
     the discriminating test. Section 4's job is to establish that the lock is
     real, which is what makes section 5 mean anything.
  5. That the polling read really does not take one. Same held lock, and GET
     /jobs/{job_id} must answer immediately. A second connection proves the
     lock is genuinely held first, so "the GET was fast" cannot be explained
     by there being nothing to block on.
  2. That Postgres is in READ COMMITTED. The whole design rests on it: a
     blocked FOR UPDATE re-reads the committed row and answers 409, whereas
     under REPEATABLE READ the same statement aborts with a serialization
     failure and these endpoints have no retry logic to catch it. Asserted
     rather than assumed, against the app's own engine.

Measured discriminating power, 2026-09-23. Against the fixed code: 43/43.
Against the same code with the two service call sites reverted to the
non-locking read and nothing else changed: **23/43**, with the defect
reproducing in 5 of the 6 trials, each one leaving a job row reading
``cancelled`` with ``price_final = 450.00`` and a non-null ``completed_at``,
two terminal history rows, and HTTP 200 on both requests. Recorded because a
concurrency test that has never been shown to fail is a concurrency test
nobody should trust.

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
SERVICE_ID = 3

PICKUP_LAT, PICKUP_LNG = 23.0300, 72.5600
KM_PER_DEG_LAT = 111.32
NEAR_LAT = PICKUP_LAT + 1.0 / KM_PER_DEG_LAT

# Distinct from every other harness's numbers, domain and tag, so two runs can
# never purge each other's rows out from under one another.
QA_DOMAIN = "sahayak-raceqa.invalid"
PARTNER_PHONE = "+919000000951"
JOB_TAG = "RACE-QA"

# Six trials, not one. A single pass can succeed by accident: if the event loop
# happens to run one request to completion before the other's first await, the
# two never overlap and the trial degenerates into the sequential case that
# cannot fail. Six independent jobs make that coincidence unlikely to hold
# throughout, and the winner split is printed so a run that never actually
# raced is visible rather than merely green.
TRIALS = 6

# How long a mutation is given to finish while the row is deliberately locked
# by someone else. It must not finish. The polling GET in section 5 is held to
# the same number, so the two results are directly comparable: one endpoint
# could not get through in this long, the other did.
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
# Database access — used only to verify, to hold locks on purpose, and to
# clean up.
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
        "SELECT status, price_final, completed_at, cancelled_at, cancellation_reason "
        "FROM jobs WHERE id = %(i)s", {"i": job_id},
    ) or {}


def assignments_for(job_id: str) -> list:
    return rows(
        "SELECT id, partner_id, status FROM job_assignments "
        "WHERE job_id = %(i)s ORDER BY offered_at DESC", {"i": job_id},
    )


def history_for(job_id: str) -> list:
    return rows(
        "SELECT status, note, changed_at FROM job_status_history "
        "WHERE job_id = %(i)s ORDER BY changed_at, id", {"i": job_id},
    )


def chain(job_id: str) -> str:
    return " → ".join(h["status"] for h in history_for(job_id))


def purge() -> None:
    """Remove everything this script creates, in foreign-key order.

    Scoped by the QA phone number and the job tag, never by "recent rows" — a
    cleanup that works by timestamp will one day delete something real.
    """
    q = conn.cursor()
    q.execute(
        "DELETE FROM job_assignments WHERE partner_id IN "
        "(SELECT id FROM partners WHERE phone = %(p)s)", {"p": PARTNER_PHONE},
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
        "(SELECT id FROM partners WHERE phone = %(p)s)", {"p": PARTNER_PHONE},
    )
    q.execute("DELETE FROM partners WHERE phone = %(p)s", {"p": PARTNER_PHONE})
    q.execute("UPDATE users SET auth_user_id = NULL WHERE id = %(i)s", {"i": USER_ID})


# --------------------------------------------------------------------------
# Supabase accounts — real tokens, same approach as check_auth_flow.py.
# --------------------------------------------------------------------------
_admin_headers = {"apikey": SEC, "Authorization": f"Bearer {SEC}", "Content-Type": "application/json"}
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
    email = f"raceqa-{label}@{QA_DOMAIN}"
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
# Deliberate lock holding. This is the only place in the suite that opens a
# transaction by hand and leaves it open.
# --------------------------------------------------------------------------
class HeldLock:
    """Hold SELECT ... FOR UPDATE on one job row from outside the app.

    Used as a context manager so the transaction is always rolled back, even if
    an assertion inside the block fails. A leaked lock here would not just fail
    this run: the row would stay locked until the connection dropped, and the
    cleanup DELETE at the end would hang behind it.
    """

    def __init__(self, job_id: str) -> None:
        self.job_id = job_id
        self.conn = None

    def __enter__(self) -> "HeldLock":
        self.conn = psycopg2.connect(dsn)     # autocommit off: we want a txn
        cur = self.conn.cursor()
        cur.execute("SELECT id FROM jobs WHERE id = %(i)s FOR UPDATE",
                    {"i": self.job_id})
        cur.fetchall()
        return self

    def is_genuinely_held(self) -> bool:
        """Confirm from a third connection that the row really is locked.

        Without this, section 5's "the GET came back instantly" would be
        consistent with the lock never having been taken — the test would pass
        for the wrong reason and keep passing if FOR UPDATE were removed from
        this helper. NOWAIT turns "would block" into an immediate error, which
        is exactly the question being asked.
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

    def release(self) -> None:
        if self.conn is not None:
            self.conn.rollback()

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


async def main() -> None:
    global _cleaned

    set_redis_client(fakeredis.aioredis.FakeRedis(decode_responses=True))

    from app.main import app  # noqa: E402  (after the Redis override)

    print("Cleaning up any leftovers from a previous run...")
    purge()
    purge_supabase_accounts()
    baseline = counts()
    print(f"  baseline: {baseline}")

    transport = httpx.ASGITransport(app=app)
    # 30s, not the 5s default: section 4 deliberately leaves a request blocked
    # on a row lock and then releases it, and a client timeout would report
    # that as a failure rather than as the wait it is.
    async with httpx.AsyncClient(transport=transport, base_url="http://race.test",
                                 timeout=30.0) as c:

        # ------------------------------------------------------------------
        section("1. One owner, one verified partner")
        # ------------------------------------------------------------------
        _, owner_token = supabase_identity("owner")
        r = await c.post(f"/api/v1/users/{USER_ID}/link-auth", headers=hdr(owner_token))
        check("owner linked to the test driver", r.status_code == 200,
              f"HTTP {r.status_code} {code_of(r)}")

        _, partner_token = supabase_identity("partner")
        r = await c.post("/api/v1/partners", json={
            "name": "Race QA Mechanic", "phone": PARTNER_PHONE,
            "primary_category_code": "mechanical",
        })
        if r.status_code != 201:
            raise SystemExit(f"partner registration failed: {r.status_code} {r.text[:300]}")
        partner_id = data_of(r)["id"]

        r = await c.post(f"/api/v1/partners/{partner_id}/link-auth", headers=hdr(partner_token))
        if r.status_code != 200:
            raise SystemExit(f"partner link-auth failed: {r.status_code} {r.text[:300]}")

        # Verification has no endpoint yet — that workflow is a separate task —
        # so it is set directly rather than pretended away.
        q = conn.cursor()
        q.execute("UPDATE partners SET verification_status='verified', "
                  "rating_avg=4.6, rating_count=12 WHERE id=%(i)s", {"i": partner_id})

        for path, body in (
            (f"/api/v1/partners/{partner_id}/services", {"service_codes": [SERVICE_CODE]}),
            (f"/api/v1/partners/{partner_id}/location", {"lat": NEAR_LAT, "lng": PICKUP_LNG}),
        ):
            r = await c.post(path, json=body, headers=hdr(partner_token))
            if r.status_code not in (200, 201):
                raise SystemExit(f"{path} failed: {r.status_code} {r.text[:300]}")
        r = await c.patch(f"/api/v1/partners/{partner_id}/availability",
                          json={"is_available": True}, headers=hdr(partner_token))
        if r.status_code != 200:
            raise SystemExit(f"availability failed: {r.status_code} {r.text[:300]}")
        check("partner is verified, located, serviced and available",
              True, f"partner {partner_id[:8]}…")

        # ------------------------------------------------------------------
        section("2. The assumption the whole fix rests on")
        # ------------------------------------------------------------------
        level = await app_isolation_level()
        check("the app's engine runs in READ COMMITTED", level == "read committed",
              f"transaction_isolation = {level!r}")
        print("      (a blocked FOR UPDATE re-reads the committed row under this")
        print("       level and can answer 409; under REPEATABLE READ it would")
        print("       abort with a serialization failure and these endpoints")
        print("       have no retry path for that)")

        # ------------------------------------------------------------------
        section(f"3. The race — {TRIALS} trials, complete vs cancel, fired together")
        # ------------------------------------------------------------------
        winners: dict[str, int] = {"completed": 0, "cancelled": 0}
        race_jobs: list[str] = []

        for trial in range(1, TRIALS + 1):
            job_id = await make_in_progress_job(c, owner_token, partner_token,
                                                partner_id, f"trial-{trial}")
            race_jobs.append(job_id)

            # Both coroutines are created before either is awaited, so gather
            # starts them into the same event-loop tick. Each request gets its
            # own session from get_db and therefore its own connection and its
            # own transaction — without that, they would serialize in the pool
            # instead of at the row lock and this would prove nothing.
            complete = c.post(
                f"/api/v1/jobs/{job_id}/status",
                json={"status": "completed", "price_final": 450.0},
                headers=hdr(partner_token),
            )
            cancel = c.post(
                f"/api/v1/jobs/{job_id}/cancel",
                json={"cancellation_reason": "RACE-QA owner changed their mind"},
                headers=hdr(owner_token),
            )
            (comp_r, comp_e, comp_t), (canc_r, canc_e, canc_t) = await asyncio.gather(
                timed(complete), timed(cancel)
            )

            label = f"trial {trial}"
            if comp_e is not None or canc_e is not None:
                check(f"{label}: both requests returned a response", False,
                      f"complete={comp_e!r} cancel={canc_e!r}")
                continue

            codes = sorted([comp_r.status_code, canc_r.status_code])
            row = job_row(job_id)
            status = row.get("status")
            terminal_history = [h for h in history_for(job_id)
                                if h["status"] in ("completed", "cancelled")]

            check(f"{label}: exactly one won, one got 409", codes == [200, 409],
                  f"complete {comp_r.status_code} ({comp_t * 1000:.0f}ms) / "
                  f"cancel {canc_r.status_code} ({canc_t * 1000:.0f}ms)")

            loser = canc_r if comp_r.status_code == 200 else comp_r
            check(f"{label}: the loser got a real conflict code, not a 500",
                  loser.status_code == 409
                  and code_of(loser) in ("JOB_ALREADY_TERMINAL",
                                         "INVALID_STATUS_TRANSITION"),
                  f"{loser.status_code} {code_of(loser)}")

            # The assertion that would actually have failed before the fix.
            # Status codes alone would not: the bug produced 200 on *both*
            # requests, so a check for "one 409" catches it, but a row that
            # claims both outcomes at once is the unambiguous fingerprint.
            if status == "completed":
                consistent = (row["cancelled_at"] is None
                              and row["cancellation_reason"] is None
                              and row["price_final"] is not None)
                detail = (f"completed, price {row['price_final']}, "
                          f"cancelled_at {row['cancelled_at']}")
            else:
                consistent = (row["completed_at"] is None
                              and row["price_final"] is None
                              and row["cancelled_at"] is not None)
                detail = (f"cancelled, price {row['price_final']}, "
                          f"completed_at {row['completed_at']}")
            check(f"{label}: the job row is not self-contradictory", consistent, detail)

            check(f"{label}: exactly one terminal history row",
                  len(terminal_history) == 1,
                  chain(job_id))

            assignment_states = [a["status"] for a in assignments_for(job_id)]
            check(f"{label}: the assignment agrees with the job",
                  assignment_states == [status],
                  f"job {status} / assignment {assignment_states}")

            if status in winners:
                winners[status] += 1

        print(f"\n  winner split across {TRIALS} trials: "
              f"{winners['completed']} completed, {winners['cancelled']} cancelled")
        if 0 in winners.values():
            print("      (one-sided: the loser still got a correct 409 every time,")
            print("       but scheduling favoured one side throughout — the")
            print("       deterministic proof that the lock is taken at all is")
            print("       section 4, which does not depend on timing)")

        # ------------------------------------------------------------------
        section("4. The mutating path really does wait for the lock")
        # ------------------------------------------------------------------
        job_id = await make_in_progress_job(c, owner_token, partner_token,
                                            partner_id, "lock-wait")
        with HeldLock(job_id) as held:
            check("the row is locked by another transaction",
                  held.is_genuinely_held(), "FOR UPDATE NOWAIT was refused")

            blocked_call = asyncio.create_task(c.post(
                f"/api/v1/jobs/{job_id}/cancel",
                json={"cancellation_reason": "RACE-QA blocked cancel"},
                headers=hdr(owner_token),
            ))
            t0 = time.perf_counter()
            try:
                # shield() so the timeout gives up waiting without cancelling
                # the request — the point is to release the lock and then watch
                # it succeed, which needs the task still alive.
                await asyncio.wait_for(asyncio.shield(blocked_call),
                                       timeout=BLOCK_TIMEOUT_S)
                waited = time.perf_counter() - t0
                check("the cancel blocked on the held row lock", False,
                      f"it completed in {waited * 1000:.0f}ms while the row was locked")
            except asyncio.TimeoutError:
                check("the cancel blocked on the held row lock", True,
                      f"still waiting after {BLOCK_TIMEOUT_S:.1f}s")
                check("and the job was not modified while it waited",
                      job_row(job_id)["status"] == "in_progress",
                      job_row(job_id)["status"])

            held.release()
            r = await blocked_call
            check("releasing the lock let the same request through",
                  r.status_code == 200,
                  f"HTTP {r.status_code} after waiting on the lock")
            check("and it then wrote the cancellation",
                  job_row(job_id)["status"] == "cancelled", chain(job_id))

        # ------------------------------------------------------------------
        section("5. The polling read is still lock-free")
        # ------------------------------------------------------------------
        job_id = await make_in_progress_job(c, owner_token, partner_token,
                                            partner_id, "poll-under-lock")

        # A baseline with nothing held, to have a number to compare against.
        _, _, free_t = await timed(c.get(f"/api/v1/jobs/{job_id}", headers=hdr(owner_token)))

        with HeldLock(job_id) as held:
            check("the row is locked by another transaction",
                  held.is_genuinely_held(), "FOR UPDATE NOWAIT was refused")

            polls = []
            for _ in range(3):
                r, exc, elapsed = await timed(
                    c.get(f"/api/v1/jobs/{job_id}", headers=hdr(owner_token))
                )
                polls.append((r, exc, elapsed))

            check("every poll answered 200 while the row was locked",
                  all(r is not None and r.status_code == 200 for r, _, _ in polls),
                  ", ".join(f"HTTP {r.status_code if r else 'ERR'}" for r, _, _ in polls))

            slowest = max(elapsed for _, _, elapsed in polls)
            # The same threshold the mutation in section 4 failed to beat, so
            # the comparison is direct: one endpoint could not get through in
            # 2s, this one did three times.
            check("and none of them waited on the lock",
                  slowest < BLOCK_TIMEOUT_S,
                  f"slowest poll {slowest * 1000:.0f}ms vs "
                  f"{free_t * 1000:.0f}ms unlocked, "
                  f"vs a mutation still blocked at {BLOCK_TIMEOUT_S * 1000:.0f}ms")

            check("the poll read the committed state, not the locker's view",
                  all(data_of(r).get("status") == "in_progress" for r, _, _ in polls),
                  ", ".join(str(data_of(r).get("status")) for r, _, _ in polls))

        # ------------------------------------------------------------------
        section("6. Cleanup")
        # ------------------------------------------------------------------
        print(f"  {len(race_jobs)} raced jobs plus 2 lock-probe jobs to remove")
        purge()
        purge_supabase_accounts()
        _cleaned = True
        after = counts()
        check("every table is back to its baseline count", after == baseline,
              f"{after}" if after != baseline else "matched")

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


async def make_in_progress_job(c, owner_token, partner_token, partner_id, tag) -> str:
    """Create a job and walk it to 'in_progress' — the only status the race needs.

    ALLOWED_TRANSITIONS does not let a job go from 'assigned' straight to
    'completed'; it has to pass through 'partner_en_route' and 'in_progress'.
    That matters for this harness specifically: 'in_progress' is the one status
    where the partner may legally complete *and* the owner may legally cancel,
    which is precisely what makes the two requests collide instead of one of
    them being refused on its own merits.
    """
    r = await c.post("/api/v1/jobs", json={
        "vehicle_id": VEHICLE_ID, "service_code": SERVICE_CODE,
        "pickup_lat": PICKUP_LAT, "pickup_lng": PICKUP_LNG,
        "pickup_address_text": "Race QA pickup",
        "issue_description": f"{JOB_TAG} {tag}",
    }, headers=hdr(owner_token))
    if r.status_code != 201:
        raise SystemExit(f"job {tag} creation failed: {r.status_code} {r.text[:300]}")
    job_id = data_of(r)["id"]

    offer = one(
        "SELECT id FROM job_assignments WHERE job_id = %(i)s "
        "ORDER BY offered_at DESC LIMIT 1", {"i": job_id},
    )
    if not offer:
        raise SystemExit(f"job {tag} got no offer — dispatch found no candidate")

    r = await c.post(f"/api/v1/job-assignments/{offer['id']}/respond",
                     json={"action": "accept"}, headers=hdr(partner_token))
    if r.status_code != 200:
        raise SystemExit(f"accept for job {tag} failed: {r.status_code} {r.text[:300]}")

    for target in ("partner_en_route", "in_progress"):
        r = await c.post(f"/api/v1/jobs/{job_id}/status", json={"status": target},
                         headers=hdr(partner_token))
        if r.status_code != 200:
            raise SystemExit(
                f"job {tag} could not reach {target}: {r.status_code} {r.text[:300]}"
            )
    return job_id


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except BaseException:
        # Cleanup has to survive a crash, not just a clean finish. Section 6
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
