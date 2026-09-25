"""Live check: the concurrency cap is enforced at accept, and a Redis outage is visible.

Run it directly — it needs no server process:

    python tests/integration/check_dispatch_capacity.py

Add --reverted to run the **control**, described at the bottom of this docstring.

Not named test_*.py on purpose, same as its siblings: pytest must not collect
it, because it writes to the real database and creates real Supabase accounts.

This harness covers the two defects the dispatch load test of 2026-09-24
surfaced. They are unrelated in mechanism and share a file only because they
share a cause — dispatch doing something once and never looking again.

-- Bug 1: MAX_CONCURRENT_JOBS was not enforced at accept -------------------

get_eligible_partners() filters candidates on "fewer than MAX_CONCURRENT_JOBS
active jobs", and that filter was the only enforcement. But an 'offered'
assignment costs no capacity (ADR-008 counts accepted assignments against live
jobs, not offers), so a partner sitting at one active job stays eligible and can
collect any number of simultaneous offers. Nothing looked at the number again
when they answered. The load test found a partner holding **four** active jobs
against a cap of two, and the first breach at only four job creations per
second — so this was a missing check, not a narrow race.

The fix is dispatch_service._require_capacity(): count again under a lock on the
*partner* row, and refuse with 409 PARTNER_AT_CAPACITY. Sections 2-7 are about
it. Section 2 is worth reading first — it establishes the precondition the whole
bug rests on, which is easy to disbelieve until you see it.

**Why the partner row and not the job row.** respond_to_assignment() already
holds a FOR UPDATE on the job (ADR-015). That lock cannot order two accepts by
one partner for two *different* jobs: two different job rows, so neither
transaction waits, both count the same pre-accept number, both commit, and the
cap is breached by two transactions that each saw a legal state. The partner row
is the only row those two have in common. Section 6 is that exact race.

-- Bug 2: jobs stranded in 'requested' when Redis does not answer ----------

Job creation triggers dispatch inside a guard, so that a dispatch fault cannot
fail a POST that genuinely succeeded. The guard also left the job where it was:
'requested', no assignment, no history beyond "Job created", and no background
worker to come back for it — because there is no background worker. The load
test produced these at about 0.08 %. The driver's app showed a live job and
would have gone on showing it forever.

The fix is dispatch_service.mark_dispatch_unavailable(), called from
job_service._try_dispatch for DispatchUnavailableError only. The job moves to
'no_match_found' with a distinguishing note. Section 8 is that, including the
part that must NOT change: the POST still returns 201, promptly. See ADR-016 for
why the status is shared with "nobody available" while the cause stays
separable.

-- What this harness asserts against ---------------------------------------

Postgres, not the API's own response body, and with its own hand-written copy of
the active-job count query. A test that asked the code under test whether the
code under test was right would pass for the wrong reason.

Tokens are real Supabase tokens. Redis is fakeredis — the single substitution,
for the reasons at the top of check_dispatch_flow.py — which is also what makes
section 8 possible: the outage is injected by replacing the client dispatch
fetches, so the real `except RedisError` handler runs.

Partner availability is set with SQL rather than through
PATCH /partners/{id}/availability. It is the lever that decides who is eligible,
so it is used here as scaffolding to make each section's offer go to a known
partner; the endpoint itself is covered by check_dispatch_flow.py.

-- The control run ---------------------------------------------------------

    python tests/integration/check_dispatch_capacity.py --reverted

must FAIL, and it is the only thing that makes a green run mean anything. It
neuters exactly the two functions this task added — _require_capacity becomes a
no-op and mark_dispatch_unavailable returns False without writing — which
restores the previous behaviour precisely, because in both cases the entire fix
is that one call. Everything else, including the lock ordering and the
re-dispatch, is untouched.

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
import redis.exceptions as redis_exceptions  # noqa: E402

from app.config.redis_client import set_redis_client  # noqa: E402
from app.config.settings import get_settings  # noqa: E402
from app.repositories.dispatch_repository import MAX_CONCURRENT_JOBS  # noqa: E402

S = get_settings()
SUPA = S.SUPABASE_URL.rstrip("/")
SEC = S.SUPABASE_SECRET_KEY
PUB = S.SUPABASE_PUBLISHABLE_KEY

# The control run. See the docstring: this must fail.
REVERTED = "--reverted" in sys.argv

USER_ID = "75e138ea-e39a-48da-8717-f4287099ddcc"      # Test Driver QA
VEHICLE_ID = "4c1c0c88-1d14-44d2-b21d-eba9d38c7453"   # their Maruti Swift

SERVICE_CODE = "battery_jumpstart"   # requires_vehicle_equipment = False

PICKUP_LAT, PICKUP_LNG = 23.0300, 72.5600
KM_PER_DEG_LAT = 111.32
# cos(23°) ≈ 0.9205, so a degree of longitude is shorter here than a degree of
# latitude. Getting this wrong would not error — it would put a partner
# somewhere else and quietly change which one wins.
KM_PER_DEG_LNG = 111.32 * 0.9205

# Distinct from every other harness's numbers, domain and tag, so two runs can
# never purge each other's rows out from under one another. 096x belongs to
# check_dispatch_race.py and 095x to check_dispatch_flow.py.
QA_DOMAIN = "sahayak-dispatchcapacityqa.invalid"
PHONE_PREFIX = "+91900000097"
JOB_TAG = "DCAP-QA"

# Eight partners, and every one of them is load-bearing:
#   alpha   — fills to the cap and is then refused (sections 3, 4)
#   beta    — receives alpha's re-dispatch and accepts below the cap (section 5)
#   delta   — sits at exactly MAX_CONCURRENT_JOBS - 1 for the race (section 6)
#   epsilon — somewhere for the losing accept's re-dispatch to go (section 6)
#   f1..f4  — the fleet for the scaled-down calibration run (section 7)
# Separate partners rather than reused ones so each section starts from a state
# it set itself, and a failure in one does not cascade into the next.
NAMED = ("alpha", "beta", "delta", "epsilon")
FLEET = ("f1", "f2", "f3", "f4")
LABELS = NAMED + FLEET
PARTNER_PHONES = {label: PHONE_PREFIX + str(i + 1) for i, label in enumerate(LABELS)}

# The fleet sits at the four compass points ~1 km out, and section 7's jobs cycle
# through the same four points, so each job has a different nearest partner and
# the offers spread instead of all landing on one mechanic. Distance is 40 % of
# the score; ratings are set identical, so distance and load are what decide.
FLEET_OFFSETS_KM = {
    "f1": (1.0, 0.0),
    "f2": (-1.0, 0.0),
    "f3": (0.0, 1.0),
    "f4": (0.0, -1.0),
}
# The named partners sit ~1 km out too, spread apart so they are all comfortably
# inside MAX_RADIUS_M (10 km) and none of them is co-located with the fleet.
NAMED_OFFSETS_KM = {
    "alpha": (0.7, 0.7),
    "beta": (-0.7, 0.7),
    "delta": (0.7, -0.7),
    "epsilon": (-0.7, -0.7),
}

# Section 7's size. Twelve jobs over four partners with a cap of two means at
# least four accepts must be refused, so the section cannot pass without
# exercising the check — a scenario that never reaches the cap would be green
# and worthless.
FLEET_JOBS = 12
FLEET_ROUNDS = 4

# How long POST /jobs is allowed to take while the location store is timing out.
# Generous on purpose: the assertion is that the guard does not turn a dead
# dependency into a hung request, not that the request is fast.
PROMPT_S = 8.0

_results: list[tuple[bool, str, str]] = []
_cleaned = False


def check(label: str, condition: bool, detail: str = "") -> None:
    _results.append((bool(condition), label, detail))
    mark = "PASS" if condition else "FAIL"
    print(f"  [{mark}] {label}" + (f"  — {detail}" if detail else ""))


def section(title: str) -> None:
    print(f"\n{title}\n" + "-" * len(title))


def latlng(offset_km: tuple[float, float]) -> tuple[float, float]:
    north_km, east_km = offset_km
    return (PICKUP_LAT + north_km / KM_PER_DEG_LAT,
            PICKUP_LNG + east_km / KM_PER_DEG_LNG)


# --------------------------------------------------------------------------
# Database access — used only to verify, to set availability, and to clean up.
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
    return one("SELECT status, cancelled_at FROM jobs WHERE id = %(i)s", {"i": job_id}) or {}


def offers_for(job_id: str) -> list:
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


def active_count(partner_id: str) -> int:
    """This harness's own count of a partner's live workload.

    Written out here rather than imported from dispatch_repository on purpose.
    The claim under test is "the number never exceeds MAX_CONCURRENT_JOBS", and
    asking the code under test to count it would make the test agree with the
    implementation by construction — including if the implementation's own
    definition of "active" were the thing that was wrong.

    Mirrors ACTIVE_ASSIGNMENT_STATUSES x ACTIVE_JOB_STATUSES deliberately: an
    accepted assignment whose job has not finished.
    """
    return one(
        "SELECT count(*) AS n FROM job_assignments a "
        "  JOIN jobs j ON j.id = a.job_id "
        " WHERE a.partner_id = %(p)s "
        "   AND a.status = 'accepted' "
        "   AND j.status IN ('assigned', 'partner_en_route', 'in_progress')",
        {"p": partner_id},
    )["n"]


def over_cap_partners() -> list:
    """Every QA partner holding more active jobs than the cap allows.

    The load test's headline finding, expressed as a query. It returned rows.
    """
    return rows(
        "SELECT p.id, p.name, count(*) AS active FROM partners p "
        "  JOIN job_assignments a ON a.partner_id = p.id "
        "  JOIN jobs j ON j.id = a.job_id "
        " WHERE p.phone LIKE %(ph)s "
        "   AND a.status = 'accepted' "
        "   AND j.status IN ('assigned', 'partner_en_route', 'in_progress') "
        " GROUP BY p.id, p.name HAVING count(*) > %(cap)s",
        {"ph": PHONE_PREFIX + "%", "cap": MAX_CONCURRENT_JOBS},
    )


def deadlock_count() -> int:
    """Postgres' own count of deadlocks detected in this database.

    Section 9 adds a third table to the lock order (jobs → partners →
    job_assignments), which is exactly the kind of change that introduces a
    cycle. The ordering argument in ADR-015 is the proof; this is the
    measurement that would refute it.
    """
    return one("SELECT deadlocks FROM pg_stat_database "
               "WHERE datname = current_database()")["deadlocks"]


def exclusive_locks_on(table: str) -> int:
    return one(
        "SELECT count(*) AS n FROM pg_locks l JOIN pg_class c ON c.oid = l.relation "
        "WHERE c.relname = %(t)s AND l.mode LIKE '%%Exclusive%%' AND l.granted",
        {"t": table},
    )["n"]


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

    Supabase is over the public internet and a read timeout here is weather, not
    a result. Only httpx.TransportError is retried: a 4xx is an answer, and
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
    email = f"dcapqa-{label}@{QA_DOMAIN}"
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
# The injected outage, and the pool watcher.
# --------------------------------------------------------------------------
class DeadRedis:
    """A location store that accepts calls and never answers them.

    Section 8 swaps this in for the client find_candidates() fetches, rather
    than mocking find_candidates itself, so the code actually exercised is the
    real `except redis_exceptions.RedisError` handler and the real
    DispatchUnavailableError it raises. A mock one level higher would have
    proved that the handler's *caller* works while skipping the handler.

    TimeoutError rather than ConnectionError because that is what the load test
    saw, and because it is the harder case: a connection refused is instant,
    a timeout is the one that also threatens the promptness of the POST.
    """

    def __getattr__(self, name: str):
        async def _timeout(*_args, **_kwargs):
            raise redis_exceptions.TimeoutError(
                f"{JOB_TAG} injected: location store did not answer ({name})"
            )
        return _timeout


class PoolWatch:
    """Sample the SQLAlchemy pool's checked-out count while the harness runs.

    The pool was cut from 5+10 to 3+2 in this same task, on the grounds that
    single-worker usage never came close to five concurrent connections. That
    was an assumption, and the instruction was to confirm it rather than assert
    it — so it is measured here, separately for the sequential sections and for
    the concurrent ones, and printed either way.
    """

    def __init__(self) -> None:
        from app.config.database import engine
        self._pool = getattr(engine, "pool", None) or engine.sync_engine.pool
        self.peak = 0
        self._stop = asyncio.Event()
        self._task: asyncio.Task | None = None

    @property
    def capacity(self) -> int:
        return self._pool.size() + self._pool._max_overflow

    def start(self) -> None:
        self._task = asyncio.create_task(self._run())

    async def _run(self) -> None:
        while not self._stop.is_set():
            self.peak = max(self.peak, self._pool.checkedout())
            await asyncio.sleep(0.01)

    def take(self) -> int:
        """Read the peak since the last take() and reset it."""
        peak, self.peak = self.peak, self._pool.checkedout()
        return peak

    async def stop(self) -> None:
        self._stop.set()
        if self._task is not None:
            await self._task

    def checked_out(self) -> int:
        return self._pool.checkedout()


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


# --------------------------------------------------------------------------
# Fixtures built through the API, except availability. See the docstring.
# --------------------------------------------------------------------------
partners: dict[str, dict] = {}


def only_available(*labels: str) -> None:
    """Make exactly these QA partners available, and no others.

    This is the lever that decides which partner an offer reaches, and it is the
    reason every section below can name the partner it expects. Scoped to the QA
    phone prefix so it cannot touch a real partner row.
    """
    ids = [partners[label]["id"] for label in labels]
    q = conn.cursor()
    q.execute(
        "UPDATE partners SET is_available = (id = ANY(%(ids)s::uuid[])) "
        "WHERE phone LIKE %(p)s",
        {"ids": ids, "p": PHONE_PREFIX + "%"},
    )


def label_of(partner_id) -> str:
    for label, p in partners.items():
        if p["id"] == str(partner_id):
            return label
    return f"?{str(partner_id)[:8]}"


async def create_job(c, owner_token: str, tag: str,
                     offset_km: tuple[float, float] = (0.0, 0.0)) -> httpx.Response:
    lat, lng = latlng(offset_km)
    return await c.post("/api/v1/jobs", json={
        "vehicle_id": VEHICLE_ID, "service_code": SERVICE_CODE,
        "pickup_lat": lat, "pickup_lng": lng,
        "pickup_address_text": "Dispatch capacity QA pickup",
        "issue_description": f"{JOB_TAG} {tag}",
    }, headers=hdr(owner_token))


async def offered_job(c, owner_token: str, tag: str, expect: str,
                      offset_km: tuple[float, float] = (0.0, 0.0)) -> tuple[str, dict]:
    """Create a job, assert it was offered to `expect`, and return (job_id, offer).

    Raises rather than check()s on a surprise: every section downstream assumes
    the offer went where availability was pointed, and continuing with a
    mis-targeted offer would produce failures that look like the bug under test.
    """
    r = await create_job(c, owner_token, tag, offset_km)
    if r.status_code != 201:
        raise SystemExit(f"job {tag} creation failed: {r.status_code} {r.text[:300]}")
    job_id = data_of(r)["id"]

    live = [o for o in offers_for(job_id) if o["status"] == "offered"]
    if len(live) != 1:
        raise SystemExit(f"job {tag}: expected one live offer, got {offers_for(job_id)}")
    if label_of(live[0]["partner_id"]) != expect:
        raise SystemExit(f"job {tag}: expected the offer to reach {expect}, "
                         f"it reached {label_of(live[0]['partner_id'])}")
    return job_id, live[0]


async def respond(c, offer_id, label: str, action: str = "accept") -> httpx.Response:
    body: dict = {"action": action}
    if action == "reject":
        body["rejection_reason"] = f"{JOB_TAG} declined"
    return await c.post(f"/api/v1/job-assignments/{offer_id}/respond",
                        json=body, headers=hdr(partners[label]["token"]))


async def main() -> None:                          # noqa: C901 - one linear script
    global _cleaned

    set_redis_client(fakeredis.aioredis.FakeRedis(decode_responses=True))

    from app.main import app                    # noqa: E402  (after the Redis override)
    from app.services import dispatch_service   # noqa: E402

    if REVERTED:
        # The control. Both fixes are a single call each, so removing the call
        # is a faithful revert — see the docstring.
        async def _no_capacity_check(db, assignment, job, started):
            return None

        async def _no_unavailable_record(db, job_id):
            return False

        dispatch_service._require_capacity = _no_capacity_check
        dispatch_service.mark_dispatch_unavailable = _no_unavailable_record
        print("*** CONTROL RUN: the capacity check and the outage record are "
              "disabled. This run must FAIL. ***")

    print("Cleaning up any leftovers from a previous run...")
    purge()
    purge_supabase_accounts()
    baseline = counts()
    deadlocks_before = deadlock_count()
    print(f"  baseline: {baseline}")
    print(f"  deadlocks recorded in this database so far: {deadlocks_before}")
    print(f"  MAX_CONCURRENT_JOBS = {MAX_CONCURRENT_JOBS}")

    watch = PoolWatch()
    watch.start()
    print(f"  connection pool capacity: {watch.capacity} "
          f"(size {watch._pool.size()} + overflow {watch._pool._max_overflow})")

    transport = httpx.ASGITransport(app=app)
    # 60s: section 7 fires a dozen requests at a pool of five, so some of them
    # legitimately queue. A client timeout would report that wait as a failure.
    async with httpx.AsyncClient(transport=transport, base_url="http://dcap.test",
                                 timeout=60.0) as c:

        # ------------------------------------------------------------------
        section("1. One owner, eight verified partners")
        # ------------------------------------------------------------------
        _, owner_token = supabase_identity("owner")
        r = await c.post(f"/api/v1/users/{USER_ID}/link-auth", headers=hdr(owner_token))
        check("owner linked to the test driver", r.status_code == 200,
              f"HTTP {r.status_code} {code_of(r)}")

        offsets = {**NAMED_OFFSETS_KM, **FLEET_OFFSETS_KM}
        for label in LABELS:
            _, token = supabase_identity(label)
            r = await c.post("/api/v1/partners", json={
                "name": f"Dispatch Capacity QA {label}",
                "phone": PARTNER_PHONES[label],
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
            # task — so it is set directly rather than pretended away. Ratings
            # are set identical across the fleet so that distance and load are
            # the only things the score can differ on.
            q = conn.cursor()
            q.execute("UPDATE partners SET verification_status='verified', "
                      "rating_avg=4.6, rating_count=12 WHERE id=%(i)s", {"i": pid})

            lat, lng = latlng(offsets[label])
            for path, body in (
                (f"/api/v1/partners/{pid}/services", {"service_codes": [SERVICE_CODE]}),
                (f"/api/v1/partners/{pid}/location", {"lat": lat, "lng": lng}),
            ):
                r = await c.post(path, json=body, headers=hdr(token))
                if r.status_code not in (200, 201):
                    raise SystemExit(f"{path} failed: {r.status_code} {r.text[:300]}")
            partners[label] = {"id": pid, "token": token}

        check("eight partners are verified, located and serviced",
              len(partners) == len(LABELS),
              ", ".join(f"{label} {partners[label]['id'][:8]}…" for label in LABELS))

        # ------------------------------------------------------------------
        section("2. The precondition — an offer costs no capacity")
        # ------------------------------------------------------------------
        # This is the fact that makes bug 1 possible, and it is easier to
        # disbelieve than to check. ADR-008 counts *accepted* assignments
        # against live jobs, so a partner holding one active job and any number
        # of outstanding offers still passes the eligibility filter. The filter
        # was the only enforcement there was.
        only_available("alpha")

        job1, offer1 = await offered_job(c, owner_token, "alpha-first", "alpha")
        r = await respond(c, offer1["id"], "alpha")
        check("alpha accepted their first job", r.status_code == 200,
              f"HTTP {r.status_code} {code_of(r)}")
        check("alpha is holding one active job",
              active_count(partners["alpha"]["id"]) == 1,
              f"active_count = {active_count(partners['alpha']['id'])}")

        job2, offer2 = await offered_job(c, owner_token, "alpha-second", "alpha")
        job3, offer3 = await offered_job(c, owner_token, "alpha-third", "alpha")
        check(f"alpha was offered two more jobs while at 1 of {MAX_CONCURRENT_JOBS}",
              True, "both reached alpha — an 'offered' row costs no capacity")
        check("and alpha's active count has not moved",
              active_count(partners["alpha"]["id"]) == 1,
              f"active_count = {active_count(partners['alpha']['id'])}, "
              f"2 offers outstanding")

        r = await respond(c, offer2["id"], "alpha")
        check("alpha accepted the second, reaching the cap", r.status_code == 200,
              f"HTTP {r.status_code} {code_of(r)}")
        check(f"alpha is now at exactly {MAX_CONCURRENT_JOBS} active jobs",
              active_count(partners["alpha"]["id"]) == MAX_CONCURRENT_JOBS,
              f"active_count = {active_count(partners['alpha']['id'])}")
        check("and the third offer is still live, waiting to be answered",
              [o["status"] for o in offers_for(job3)] == ["offered"],
              f"job3 offers {[o['status'] for o in offers_for(job3)]}, "
              f"job3 status {job_row(job3)['status']}")
        print("      (this is the state the load test found: a partner at the cap")
        print("       holding a live offer that nothing was going to re-check)")

        # ------------------------------------------------------------------
        section("3. Bug 1 — the accept at capacity is refused, and the job moves on")
        # ------------------------------------------------------------------
        only_available("alpha", "beta")

        r = await respond(c, offer3["id"], "alpha")
        check("the accept was refused with 409 PARTNER_AT_CAPACITY",
              r.status_code == 409 and code_of(r) == "PARTNER_AT_CAPACITY",
              f"HTTP {r.status_code} {code_of(r)}")
        check(f"alpha is still at {MAX_CONCURRENT_JOBS}, not over it",
              active_count(partners["alpha"]["id"]) == MAX_CONCURRENT_JOBS,
              f"active_count = {active_count(partners['alpha']['id'])}")

        job3_offers = offers_for(job3)
        alpha_offer = next((o for o in job3_offers
                            if str(o["partner_id"]) == partners["alpha"]["id"]), None)
        check("the refused offer was left 'offered', not 'rejected'",
              alpha_offer is not None and alpha_offer["status"] == "offered",
              f"alpha's offer is {alpha_offer['status'] if alpha_offer else 'missing'!r}")
        print("      (being full is not declining — writing 'rejected' would")
        print("       charge a mechanic's acceptance rate for our own cap)")

        redispatched = [o for o in job3_offers
                        if str(o["partner_id"]) != partners["alpha"]["id"]]
        check("the job was re-dispatched to the next candidate",
              len(redispatched) == 1
              and label_of(redispatched[0]["partner_id"]) == "beta"
              and redispatched[0]["status"] == "offered",
              f"{[(label_of(o['partner_id']), o['assignment_rank'], o['status']) for o in job3_offers]}")
        check("the job is still being matched, not failed",
              job_row(job3)["status"] == "matching", chain(job3))
        print("      (from the driver's side this is indistinguishable from")
        print("       the partner having declined, which is the intent)")

        # ------------------------------------------------------------------
        section("4. The rank guard — a second tap does not re-dispatch again")
        # ------------------------------------------------------------------
        # A consequence of leaving the offer 'offered': the partner's app keeps
        # showing it, so it will be tapped again. Without the rank guard every
        # tap would fire another _offer_next(), walking the candidate pool to
        # exhaustion and finally dropping the job into 'no_match_found' while
        # several partners were still holding live offers for it. Not in the
        # original spec; found by reasoning about what the surviving offer does.
        before = len(offers_for(job3))
        r = await respond(c, offer3["id"], "alpha")
        after = offers_for(job3)
        check("a second tap is refused the same way",
              r.status_code == 409 and code_of(r) == "PARTNER_AT_CAPACITY",
              f"HTTP {r.status_code} {code_of(r)}")
        check("and it made no further offer",
              len(after) == before,
              f"{before} offer rows before, {len(after)} after")
        check("so the refusal is idempotent",
              job_row(job3)["status"] == "matching"
              and sum(1 for o in after if o["status"] == "offered") == 2,
              f"job {job_row(job3)['status']}, "
              f"{[(label_of(o['partner_id']), o['status']) for o in after]}")

        # ------------------------------------------------------------------
        section("5. Regression — a partner below the cap still accepts normally")
        # ------------------------------------------------------------------
        beta_offer = next((o for o in offers_for(job3)
                           if str(o["partner_id"]) == partners["beta"]["id"]), None)
        if beta_offer is None:
            check("beta has an offer to accept", False,
                  "no re-dispatched offer exists, so this section cannot run")
        else:
            r = await respond(c, beta_offer["id"], "beta")
            check("beta's accept succeeded", r.status_code == 200,
                  f"HTTP {r.status_code} {code_of(r)}")
            check("the job is assigned to beta",
                  job_row(job3)["status"] == "assigned"
                  and active_count(partners["beta"]["id"]) == 1,
                  f"job {job_row(job3)['status']}, "
                  f"beta active_count {active_count(partners['beta']['id'])}")
            check("the timeline reads requested → matching → assigned",
                  [h["status"] for h in history_for(job3)]
                  == ["requested", "matching", "assigned"], chain(job3))

            # The documented consequence of leaving the refused offer open: the
            # job outran it, and alpha now gets the same answer any partner gets
            # when a job is accepted out from under their offer.
            r = await respond(c, offer3["id"], "alpha")
            check("alpha's surviving offer now answers ASSIGNMENT_ALREADY_ANSWERED",
                  r.status_code == 409 and code_of(r) == "ASSIGNMENT_ALREADY_ANSWERED",
                  f"HTTP {r.status_code} {code_of(r)}")
            check("and the assignment to beta was not disturbed",
                  job_row(job3)["status"] == "assigned"
                  and sorted(o["status"] for o in offers_for(job3))
                  == ["accepted", "offered"],
                  f"{[(label_of(o['partner_id']), o['status']) for o in offers_for(job3)]}")

        # A clean below-cap accept, with no refusal anywhere near it, so the
        # ordinary path is proven on its own and not only as a by-product.
        only_available("epsilon")
        job4, offer4 = await offered_job(c, owner_token, "plain-accept", "epsilon")
        r = await respond(c, offer4["id"], "epsilon")
        check("an ordinary accept by an idle partner is untouched",
              r.status_code == 200 and job_row(job4)["status"] == "assigned",
              f"HTTP {r.status_code} {code_of(r)}, job {job_row(job4)['status']}")
        check("and rejection still works and still re-dispatches",
              True, "covered next")

        sequential_peak = watch.take()

        # ------------------------------------------------------------------
        section(f"6. The race — two accepts at {MAX_CONCURRENT_JOBS - 1} active jobs")
        # ------------------------------------------------------------------
        # The half of bug 1 that the job lock cannot fix. Two offers to one
        # partner for two *different* jobs: two different job rows, so neither
        # transaction waits for the other, both count the same pre-accept
        # number, both commit, cap breached. The partner row is the only row
        # they share, which is why lock_partner_for_update() exists.
        only_available("delta")
        jobA, offerA = await offered_job(c, owner_token, "delta-first", "delta")
        r = await respond(c, offerA["id"], "delta")
        check(f"delta is at {MAX_CONCURRENT_JOBS - 1} active jobs",
              r.status_code == 200
              and active_count(partners["delta"]["id"]) == MAX_CONCURRENT_JOBS - 1,
              f"active_count = {active_count(partners['delta']['id'])}")

        jobB, offerB = await offered_job(c, owner_token, "race-b", "delta")
        jobC, offerC = await offered_job(c, owner_token, "race-c", "delta")
        only_available("delta", "epsilon")

        # Both coroutines are created before either is awaited, so gather starts
        # them in the same event-loop tick. Each request gets its own session
        # from get_db, and therefore its own connection and its own
        # transaction — without that they would serialize in the pool instead
        # of at the row lock, and this would prove nothing.
        (rb, eb, tb), (rc, ec, tc) = await asyncio.gather(
            timed(respond(c, offerB["id"], "delta")),
            timed(respond(c, offerC["id"], "delta")),
        )
        if eb is not None or ec is not None:
            check("both accepts returned a response", False, f"B={eb!r} C={ec!r}")
        else:
            statuses = sorted([rb.status_code, rc.status_code])
            codes = {rb.status_code: code_of(rb), rc.status_code: code_of(rc)}
            check("exactly one of the two accepts succeeded",
                  statuses == [200, 409],
                  f"B HTTP {rb.status_code} {code_of(rb)} ({tb * 1000:.0f}ms), "
                  f"C HTTP {rc.status_code} {code_of(rc)} ({tc * 1000:.0f}ms)")
            check("and the loser was refused for capacity, not for anything else",
                  codes.get(409) == "PARTNER_AT_CAPACITY",
                  f"409 carried {codes.get(409)!r}")

        # THE assertion. Both requests returning 200 was the bug, and the
        # status codes alone cannot tell that from the legal orderings — the row
        # is what has to be asserted.
        check(f"delta holds exactly {MAX_CONCURRENT_JOBS} active jobs, not "
              f"{MAX_CONCURRENT_JOBS + 1}",
              active_count(partners["delta"]["id"]) == MAX_CONCURRENT_JOBS,
              f"active_count = {active_count(partners['delta']['id'])}")
        check("no QA partner is over the cap",
              not over_cap_partners(),
              f"{[(row['name'], row['active']) for row in over_cap_partners()]}")

        race_peak = watch.take()

        # ------------------------------------------------------------------
        section(f"7. Scaled-down calibration run — {FLEET_JOBS} jobs, four partners")
        # ------------------------------------------------------------------
        # The load test's own scenario, shrunk: jobs created in a burst so every
        # offer is made while the fleet is idle, then all the accepts fired
        # concurrently. That ordering is the point — it is what lets one partner
        # collect more offers than they are allowed to hold, which is how the
        # original report found a partner on four active jobs at a creation rate
        # of only four per second.
        only_available(*FLEET)
        fleet_ids = {partners[label]["id"] for label in FLEET}

        created = await asyncio.gather(*[
            timed(create_job(c, owner_token, f"fleet-{i:02d}",
                             FLEET_OFFSETS_KM[FLEET[i % len(FLEET)]]))
            for i in range(FLEET_JOBS)
        ])
        fleet_jobs = [data_of(r)["id"] for r, e, _ in created
                      if e is None and r.status_code == 201]
        check(f"all {FLEET_JOBS} jobs were created",
              len(fleet_jobs) == FLEET_JOBS,
              f"{len(fleet_jobs)} of {FLEET_JOBS}; "
              f"slowest {max(t for _, _, t in created):.2f}s")

        offered_now = [o for j in fleet_jobs for o in offers_for(j)
                       if o["status"] == "offered"]
        spread: dict[str, int] = {}
        for o in offered_now:
            spread[label_of(o["partner_id"])] = spread.get(label_of(o["partner_id"]), 0) + 1
        check("every job produced a live offer", len(offered_now) == len(fleet_jobs),
              f"offers per partner: {spread}")

        outcomes = {"accepted": 0, "at_capacity": 0, "already_answered": 0, "other": 0}
        for round_no in range(1, FLEET_ROUNDS + 1):
            live = [(o["id"], label_of(o["partner_id"]))
                    for j in fleet_jobs for o in offers_for(j)
                    if o["status"] == "offered" and str(o["partner_id"]) in fleet_ids]
            if not live:
                break
            answers = await asyncio.gather(*[
                timed(respond(c, offer_id, label)) for offer_id, label in live
            ])
            tally = {"accepted": 0, "at_capacity": 0, "already_answered": 0, "other": 0}
            for resp, exc, _ in answers:
                if exc is not None or resp is None:
                    tally["other"] += 1
                elif resp.status_code == 200:
                    tally["accepted"] += 1
                elif code_of(resp) == "PARTNER_AT_CAPACITY":
                    tally["at_capacity"] += 1
                elif code_of(resp) == "ASSIGNMENT_ALREADY_ANSWERED":
                    tally["already_answered"] += 1
                else:
                    tally["other"] += 1
            for key, value in tally.items():
                outcomes[key] += value
            print(f"      round {round_no}: {len(live)} accepts fired → {tally}")
            # An over-cap partner at any point in the run is a failure, not just
            # at the end — a breach that a later completion tidied away would
            # still have put a real mechanic on three jobs.
            if over_cap_partners():
                break

        check("no accept failed for an unexpected reason", outcomes["other"] == 0,
              f"{outcomes}")
        check("the cap was actually reached during the run",
              outcomes["at_capacity"] > 0,
              f"{outcomes['at_capacity']} accepts refused at capacity "
              f"(a run that never reached the cap would prove nothing)")
        breaches = over_cap_partners()
        check(f"no partner ended the run over {MAX_CONCURRENT_JOBS} active jobs",
              not breaches,
              f"{[(row['name'], row['active']) for row in breaches]}"
              if breaches else
              " / ".join(f"{label}={active_count(partners[label]['id'])}"
                         for label in FLEET))
        print("      (the original load test's query over this same shape")
        print("       returned a partner holding four active jobs)")

        fleet_peak = watch.take()

        # ------------------------------------------------------------------
        section("8. Bug 2 — a location-store outage stops being invisible")
        # ------------------------------------------------------------------
        # Injected at the client, so the real RedisError handler in
        # find_candidates() runs and raises the real DispatchUnavailableError
        # that job_service._try_dispatch now catches by type.
        only_available("epsilon")
        original_get_redis = dispatch_service.get_redis
        dispatch_service.get_redis = lambda: DeadRedis()
        try:
            r, exc, elapsed = await timed(create_job(c, owner_token, "redis-outage"))
        finally:
            dispatch_service.get_redis = original_get_redis

        if exc is not None or r is None:
            check("job creation survived the outage", False, f"{exc!r}")
        else:
            check("POST /jobs still returned 201 during the outage",
                  r.status_code == 201, f"HTTP {r.status_code} {code_of(r)}")
            check("and it returned promptly, without retrying the dead dependency",
                  elapsed < PROMPT_S, f"{elapsed * 1000:.0f}ms (limit {PROMPT_S:.0f}s)")

            outage_job = data_of(r).get("id")
            if not outage_job:
                check("the created job is identifiable", False, f"{data_of(r)}")
            else:
                row = job_row(outage_job)
                check("the job did not stay invisible in 'requested'",
                      row.get("status") == "no_match_found",
                      f"status {row.get('status')!r}")
                check("and the 201 body already told the driver so",
                      data_of(r).get("status") == "no_match_found",
                      f"response status {data_of(r).get('status')!r}")

                notes = [h["note"] for h in history_for(outage_job)
                         if h["status"] == "no_match_found"]
                check("the timeline says why, distinguishably from 'nobody nearby'",
                      any((n or "").startswith("Dispatch unavailable:") for n in notes),
                      f"notes {notes}")
                check("no offer was invented for a search that never ran",
                      offers_for(outage_job) == [], f"{offers_for(outage_job)}")
                print("      (ADR-016: the status is shared because the driver's")
                print("       situation is identical; the note is what the")
                print("       evaluation query splits coverage on)")

        # And the other half of bug 2's spec: normal dispatch is unaffected.
        job5, offer5 = await offered_job(c, owner_token, "after-outage", "epsilon")
        check("normal dispatch is completely unaffected afterwards",
              job_row(job5)["status"] == "matching" and offer5["assignment_rank"] == 1,
              f"job {job_row(job5)['status']}, "
              f"offer to {label_of(offer5['partner_id'])} rank {offer5['assignment_rank']}")
        r = await respond(c, offer5["id"], "epsilon", action="reject")
        check("and so is rejection, including its re-dispatch",
              r.status_code == 200
              and data_of(r).get("job_status") in ("matching", "no_match_found"),
              f"HTTP {r.status_code} {code_of(r)}, "
              f"next_assignment_id={data_of(r).get('next_assignment_id')!r}, "
              f"job_status={data_of(r).get('job_status')!r}")

        # ------------------------------------------------------------------
        section("9. Lock ordering — nothing deadlocked")
        # ------------------------------------------------------------------
        # This task added a third table to the order: jobs → partners →
        # job_assignments. The argument that it is acyclic is that nothing in
        # the codebase locks partners before jobs, and the only FOR UPDATE on
        # partners is the one added here. That argument lives in ADR-015; this
        # is the measurement that would refute it.
        deadlocks_after = deadlock_count()
        check("Postgres detected no deadlock during this run",
              deadlocks_after == deadlocks_before,
              f"pg_stat_database.deadlocks {deadlocks_before} → {deadlocks_after}")
        print("      (evidence, not proof — the proof is the lock ordering")
        print("       argument in ADR-015. A nonzero delta would refute it.)")

        # ------------------------------------------------------------------
        section("10. Connection pool — measured, not assumed")
        # ------------------------------------------------------------------
        # The pool was cut from 5+10 to 3+2 in this task. The stated
        # justification was that single-worker usage never approaches five
        # concurrent connections; these are the numbers rather than the claim.
        await watch.stop()
        print(f"      sequential sections (1-5):        peak {sequential_peak} "
              f"of {watch.capacity} checked out")
        print(f"      the two-way race (6):             peak {race_peak} "
              f"of {watch.capacity} checked out")
        print(f"      the {FLEET_JOBS}-job burst (7):             peak {fleet_peak} "
              f"of {watch.capacity} checked out")
        check("the sequential path stays well inside the smaller pool",
              sequential_peak <= 2,
              f"peak {sequential_peak} of {watch.capacity} — the regression suite "
              f"is sequential, so this is the number that matters for it")
        check("the concurrent sections fit without exhausting the pool",
              max(race_peak, fleet_peak) <= watch.capacity,
              f"peak {max(race_peak, fleet_peak)} of {watch.capacity}; "
              f"a burst larger than the pool queues at pool_timeout rather than "
              f"failing")
        check("no connection was left checked out", watch.checked_out() == 0,
              f"{watch.checked_out()} still checked out")

        # ------------------------------------------------------------------
        section("11. Cleanup")
        # ------------------------------------------------------------------
        purge()
        purge_supabase_accounts()
        _cleaned = True
        after = counts()
        check("every table is back to its baseline count", after == baseline,
              f"{after}" if after != baseline else "matched")
        for table in ("jobs", "partners"):
            check(f"no exclusive lock was left behind on {table}",
                  exclusive_locks_on(table) == 0,
                  f"{exclusive_locks_on(table)} granted exclusive locks")

    # ----------------------------------------------------------------------
    passed = sum(1 for ok, _, _ in _results if ok)
    total = len(_results)
    print(f"\n{'=' * 64}\n{passed}/{total} checks passed")
    if passed != total:
        print("\nFailures:")
        for ok, label, detail in _results:
            if not ok:
                print(f"  - {label}" + (f"  ({detail})" if detail else ""))
        if REVERTED:
            print("\nThis was the CONTROL run — these failures are the point.")
            print("They are what the fix removes.")
        raise SystemExit(1)
    if REVERTED:
        print("\n! CONTROL RUN PASSED — that is itself a failure. The assertions")
        print("  above do not depend on the code this task added.")
        raise SystemExit(1)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except BaseException:
        # Cleanup has to survive a crash, not just a clean finish. Section 11
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
