"""Where a single dispatch actually spends its time.

    python tests/load/profile_dispatch.py

The load test reports what the system does under pressure. This reports *why* it
does it, and it exists because the first smoke run produced a number — 5.4 s
median at an arrival rate of two jobs per second — that is useless without an
attribution. "Slow" is not a finding; "slow because of N sequential round trips
to a database in another region" is.

The spec asks for Redis GEOSEARCH latency isolated from full dispatch latency,
which is one third of the question. The other two thirds are Postgres and the
scoring computation, and all three are separated here:

  * every statement the engine executes is counted and timed by a SQLAlchemy
    event hook, so the Postgres share is measured rather than inferred;
  * the Redis commands are timed the same way, by wrapping the client;
  * whatever is left over after subtracting both is Python — request parsing,
    JWT verification, the scoring loop, serialisation.

It runs the real handler in-process against the real database and the real Redis.
In-process is correct *here*, unlike in the load run: there is no concurrency to
measure, and driving one request through ASGITransport removes the HTTP hop from
a measurement that is about what happens after it.
"""
import asyncio
import json
import sys
import time
from collections import Counter
from pathlib import Path

for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

import httpx  # noqa: E402
import psycopg2  # noqa: E402
from sqlalchemy import event  # noqa: E402

from app.config.settings import get_settings  # noqa: E402

S = get_settings()
CONTEXT_PATH = Path(__file__).resolve().parent / "load-context.json"
REPEATS = 8

# Statements the ORM issues are logged with their parameters stripped; this is
# what makes the per-statement table readable rather than a wall of UUIDs.
def _label(sql: str) -> str:
    flat = " ".join(sql.split())
    return (flat[:88] + "…") if len(flat) > 89 else flat


class SqlProbe:
    """Counts and times every statement on the app's own engine."""

    def __init__(self) -> None:
        self.events: list[tuple[str, float]] = []
        self._t0: dict[int, float] = {}
        self.armed = False

    def install(self, sync_engine) -> None:
        @event.listens_for(sync_engine, "before_cursor_execute")
        def _before(conn, cursor, statement, params, context, executemany):
            if self.armed:
                self._t0[id(cursor)] = time.perf_counter()

        @event.listens_for(sync_engine, "after_cursor_execute")
        def _after(conn, cursor, statement, params, context, executemany):
            if not self.armed:
                return
            start = self._t0.pop(id(cursor), None)
            if start is not None:
                self.events.append((_label(statement), (time.perf_counter() - start) * 1000))

    def reset(self) -> None:
        self.events = []

    @property
    def total_ms(self) -> float:
        return sum(ms for _, ms in self.events)


class RedisProbe:
    """Wraps the real client so every command is timed without changing it.

    A subclass rather than a monkeypatch of the module, so what dispatch talks to
    is a genuine redis.asyncio client with genuine network behaviour — the timing
    is added around execute_command, not in place of it.
    """

    def __init__(self, client):
        self._client = client
        self.events: list[tuple[str, float]] = []
        self.armed = False
        inner = client.execute_command

        async def timed(*args, **kwargs):
            if not self.armed:
                return await inner(*args, **kwargs)
            start = time.perf_counter()
            try:
                return await inner(*args, **kwargs)
            finally:
                self.events.append((str(args[0]), (time.perf_counter() - start) * 1000))

        client.execute_command = timed

    def reset(self) -> None:
        self.events = []

    @property
    def total_ms(self) -> float:
        return sum(ms for _, ms in self.events)


def _total_calls(cur) -> int:
    """Postgres's own tally of statements executed, across the whole database.

    Global rather than per-connection, which is why the profiling loop is the only
    thing allowed to touch the database while it runs — anything else querying at
    the same time would be counted as part of a dispatch.
    """
    cur.execute("SELECT coalesce(sum(calls), 0) FROM pg_stat_statements")
    return int(cur.fetchone()[0])


def percentile(values: list[float], pct: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    k = (len(ordered) - 1) * (pct / 100.0)
    lo, hi = int(k), min(int(k) + 1, len(ordered) - 1)
    return ordered[lo] + (ordered[hi] - ordered[lo]) * (k - lo)


async def main() -> None:
    if not CONTEXT_PATH.exists():
        raise SystemExit("seed first: python tests/load/seed_dispatch_load.py")
    ctx = json.loads(CONTEXT_PATH.read_text(encoding="utf-8"))
    owner = ctx["owners"][0]

    import redis.asyncio as aioredis

    from app.config import redis_client as rc
    from app.config.database import engine
    from app.main import app

    sql = SqlProbe()
    sql.install(engine.sync_engine)

    real = aioredis.Redis.from_url(S.REDIS_URL, decode_responses=True)
    redis_probe = RedisProbe(real)
    rc.set_redis_client(real)

    # --- the bare round trips, for scale ------------------------------------
    dsn = S.DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://")
    conn = psycopg2.connect(dsn)
    conn.autocommit = True
    cur = conn.cursor()
    pg_rtt = []
    for _ in range(20):
        t = time.perf_counter()
        cur.execute("SELECT 1")
        cur.fetchone()
        pg_rtt.append((time.perf_counter() - t) * 1000)
    redis_rtt = []
    for _ in range(20):
        t = time.perf_counter()
        await real.ping()
        redis_rtt.append((time.perf_counter() - t) * 1000)

    print(f"Postgres round trip (SELECT 1)   p50 {percentile(pg_rtt, 50):7.2f} ms")
    print(f"Redis round trip (PING)          p50 {percentile(redis_rtt, 50):7.2f} ms")
    print(f"ratio                            {percentile(pg_rtt, 50) / percentile(redis_rtt, 50):7.0f}x")

    transport = httpx.ASGITransport(app=app)
    wall, sql_ms, redis_ms, sql_n, redis_n = [], [], [], [], []
    statement_tally: Counter = Counter()
    statement_time: Counter = Counter()
    redis_tally: Counter = Counter()

    async with httpx.AsyncClient(transport=transport, base_url="http://profile.test") as c:
        payload = {
            "vehicle_id": owner["vehicle_id"],
            "service_code": ctx["service_code"],
            "pickup_lat": ctx["pickup"]["lat"],
            "pickup_lng": ctx["pickup"]["lng"],
            "issue_description": f"{ctx['job_tag']} profile",
        }
        headers = {"Authorization": f"Bearer {owner['token']}"}

        # One unmeasured request first. It pays for the first pool connection,
        # the first Redis connect and the JWKS fetch that token verification
        # caches — costs no later request pays, and costs that belong in a
        # cold-start note rather than in a per-dispatch average.
        warm = await c.post("/api/v1/jobs", json=payload, headers=headers)
        if warm.status_code != 201:
            raise SystemExit(f"warm-up request failed: {warm.status_code} {warm.text[:300]}")

        print(f"\nProfiling {REPEATS} dispatches...")
        # Postgres's own count of statements executed, taken from the server side
        # rather than the client side. This is the check on the numbers above:
        # SQLAlchemy's cursor-execute hooks cannot see BEGIN, COMMIT, the
        # pool_pre_ping probe, or the driver preparing a statement, and every one
        # of those is a real round trip that the client-side total would hide
        # inside "Python time".
        stat_before = _total_calls(cur)
        for _ in range(REPEATS):
            sql.reset()
            redis_probe.reset()
            sql.armed = redis_probe.armed = True
            t = time.perf_counter()
            r = await c.post("/api/v1/jobs", json=payload, headers=headers)
            elapsed = (time.perf_counter() - t) * 1000
            sql.armed = redis_probe.armed = False
            if r.status_code != 201:
                raise SystemExit(f"request failed: {r.status_code} {r.text[:300]}")
            wall.append(elapsed)
            sql_ms.append(sql.total_ms)
            redis_ms.append(redis_probe.total_ms)
            sql_n.append(len(sql.events))
            redis_n.append(len(redis_probe.events))
            for label, ms in sql.events:
                statement_tally[label] += 1
                statement_time[label] += ms
            for cmd, _ms in redis_probe.events:
                redis_tally[cmd] += 1
        # Read the counter before anything else touches the database, and net off
        # the two snapshot queries themselves.
        stat_after = _total_calls(cur)

    server_side = (stat_after - stat_before - 1) / REPEATS
    med_wall = percentile(wall, 50)
    med_sql = percentile(sql_ms, 50)
    med_redis = percentile(redis_ms, 50)
    other = med_wall - med_sql - med_redis

    print(f"\nOne POST /api/v1/jobs, median of {REPEATS} (handler only, no HTTP hop)")
    print(f"  total                       {med_wall:8.1f} ms")
    print(f"  Postgres  {sum(sql_n)//len(sql_n):>3} statements   {med_sql:8.1f} ms"
          f"   {100 * med_sql / med_wall:5.1f} %")
    print(f"  Redis     {sum(redis_n)//len(redis_n):>3} commands     {med_redis:8.1f} ms"
          f"   {100 * med_redis / med_wall:5.1f} %")
    print(f"  Python (scoring, JWT, serialisation, ORM)"
          f"  {other:6.1f} ms   {100 * other / med_wall:5.1f} %")

    # The reconciliation. If the server counted materially more statements than
    # the client did, the difference is round trips the client-side hooks never
    # saw, and the "Python" line above is really unattributed Postgres time.
    client_side = sum(sql_n) / len(sql_n)
    print(f"\nRound-trip reconciliation")
    print(f"  statements the client timed          {client_side:5.1f}")
    print(f"  statements Postgres counted          {server_side:5.1f}")
    print(f"  unattributed round trips             {server_side - client_side:5.1f}"
          f"   ≈ {(server_side - client_side) * percentile(pg_rtt, 50):6.1f} ms at the measured RTT")

    print("\nRedis commands per dispatch")
    for cmd, n in redis_tally.most_common():
        print(f"  {n / REPEATS:4.1f}x  {cmd}")

    print(f"\nPostgres statements per dispatch (total {sum(sql_n) / REPEATS:.0f})")
    for label, n in statement_tally.most_common(14):
        print(f"  {n / REPEATS:4.1f}x  {statement_time[label] / REPEATS:6.1f} ms  {label}")

    # Clean up the profiling jobs: they are tagged, so purge() finds them, but
    # leaving them would inflate the next run's baseline counts.
    cur.execute(
        "DELETE FROM job_status_history WHERE job_id IN "
        "(SELECT id FROM jobs WHERE issue_description = %(d)s)",
        {"d": f"{ctx['job_tag']} profile"},
    )
    cur.execute(
        "DELETE FROM job_assignments WHERE job_id IN "
        "(SELECT id FROM jobs WHERE issue_description = %(d)s)",
        {"d": f"{ctx['job_tag']} profile"},
    )
    cur.execute("DELETE FROM jobs WHERE issue_description = %(d)s",
                {"d": f"{ctx['job_tag']} profile"})
    print(f"\n  removed {REPEATS + 1} profiling jobs")
    await real.aclose()
    conn.close()


if __name__ == "__main__":
    asyncio.run(main())
