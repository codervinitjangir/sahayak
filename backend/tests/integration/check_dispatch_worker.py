"""Live check for the dispatch worker (ADR-032): offer timeouts and server-side escalation.

Run it directly — it needs no server process:

    python tests/integration/check_dispatch_worker.py

Not named test_*.py on purpose, like its siblings: it writes to the real
database and creates real Supabase accounts.

What it proves, against real Postgres row locks:

  2. A stale offer is timed out by a sweep and the job goes to the next partner;
     the timed-out partner can no longer accept it.
  3. A young offer is not touched.
  4. When the last partner times out, the job lands in 'no_match_found'.
  5. The search then widens without the owner's app calling anything: a sweep
     finds a partner 15 km out once the job is in the 20 km tier.
  6. Accept racing the worker's timeout, TRIALS times: exactly one wins, never both.
  7. The same race made deterministic: the worker's write is committed while the
     accept is blocked on the job lock, and the accept must then refuse (409).
     Before ADR-032's re-read under the lock, this accept went through on a
     timed-out offer.

**Scoped to this harness's own rows.** sweep_once reads its work lists from the
whole shared database. The two list reads are wrapped so the real queries run
(and are checked to include this run's ids), then filtered to this run's jobs,
so a run never times out or re-dispatches anybody else's job.

Number range 81x (see the harness phone-range note), tag DWRK-QA.
"""
import asyncio
import sys
import time
import uuid
from pathlib import Path
from typing import Optional

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
TEST_DRIVER_PHONE = "+919000000001"
VEHICLE_ID = "4c1c0c88-1d14-44d2-b21d-eba9d38c7453"
SERVICE_CODE = "battery_jumpstart"

PICKUP_LAT, PICKUP_LNG = 23.0300, 72.5600
KM_PER_DEG_LAT = 111.32
KM_PER_DEG_LNG = 111.32 * 0.9205

QA_DOMAIN = "sahayak-dispatchworkerqa.invalid"
PHONE_PREFIX = "+91900000081"
JOB_TAG = "DWRK-QA"
TRIALS = 6

# alpha and beta sit 1 km out, inside the first 10 km tier. gamma is 15 km out:
# reachable only once a search widens to the 20 km tier.
LABELS = ("alpha", "beta", "gamma")
PARTNER_PHONES = {label: PHONE_PREFIX + str(i + 1) for i, label in enumerate(LABELS)}
OFFSETS_KM = {"alpha": (0.7, 0.7), "beta": (-0.7, 0.7), "gamma": (15.0, 0.0)}

_results: list[tuple[bool, str, str]] = []
_cleaned = False


def check(label: str, condition: bool, detail: str = "") -> None:
    _results.append((bool(condition), label, detail))
    print(f"  [{'PASS' if condition else 'FAIL'}] {label}" + (f"  — {detail}" if detail else ""))


def section(title: str) -> None:
    print(f"\n{title}\n" + "-" * len(title))


def latlng(offset_km):
    north_km, east_km = offset_km
    return PICKUP_LAT + north_km / KM_PER_DEG_LAT, PICKUP_LNG + east_km / KM_PER_DEG_LNG


dsn = S.DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://")
conn = psycopg2.connect(dsn)
conn.autocommit = True

TABLES = ("users", "vehicles", "partners", "partner_services", "jobs",
          "job_status_history", "job_assignments", "notifications")


def counts() -> dict:
    q = conn.cursor()
    return {t: (q.execute(f"SELECT count(*) FROM {t}"), q.fetchone()[0])[1] for t in TABLES}


def rows(sql: str, params=None) -> list:
    q = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    q.execute(sql, params or {})
    return q.fetchall()


def one(sql: str, params=None):
    r = rows(sql, params)
    return r[0] if r else None


def run_sql(sql: str, params=None) -> None:
    conn.cursor().execute(sql, params or {})


def offers_for(job_id: str) -> list:
    return rows("SELECT id, partner_id, status, assignment_rank, responded_at "
                "FROM job_assignments WHERE job_id = %(i)s ORDER BY assignment_rank", {"i": job_id})


def job_status(job_id: str) -> Optional[str]:
    return (one("SELECT status FROM jobs WHERE id = %(i)s", {"i": job_id}) or {}).get("status")


def purge() -> None:
    """Remove everything this script creates, in foreign-key order, by tag and phone prefix."""
    tag = {"tag": JOB_TAG + "%"}
    pp = {"p": PHONE_PREFIX + "%"}
    jobs = "(SELECT id FROM jobs WHERE issue_description LIKE %(tag)s)"
    ours = "(SELECT id FROM partners WHERE phone LIKE %(p)s)"
    run_sql(f"DELETE FROM notifications WHERE job_id IN {jobs}", tag)
    run_sql(f"DELETE FROM notifications WHERE recipient_type = 'partner' AND recipient_id IN {ours}", pp)
    run_sql(f"DELETE FROM job_assignments WHERE partner_id IN {ours}", pp)
    run_sql(f"DELETE FROM job_status_history WHERE job_id IN {jobs}", tag)
    run_sql(f"DELETE FROM job_assignments WHERE job_id IN {jobs}", tag)
    run_sql("DELETE FROM jobs WHERE issue_description LIKE %(tag)s", tag)
    run_sql(f"DELETE FROM partner_services WHERE partner_id IN {ours}", pp)
    run_sql("DELETE FROM partners WHERE phone LIKE %(p)s", pp)
    run_sql("UPDATE users SET auth_user_id = NULL WHERE id = %(i)s", {"i": USER_ID})


_admin_headers = {"apikey": SEC, "Authorization": f"Bearer {SEC}", "Content-Type": "application/json"}
_supa = httpx.Client(base_url=SUPA, timeout=60.0)


def _supa_call(method: str, url: str, attempts: int = 3, **kwargs) -> httpx.Response:
    last: Exception | None = None
    for attempt in range(attempts):
        try:
            return _supa.request(method, url, **kwargs)
        except httpx.TransportError as exc:
            last = exc
            print(f"  ! Supabase {method} {url} timed out (attempt {attempt + 1}/{attempts}), retrying")
    raise SystemExit(f"Supabase unreachable after {attempts} attempts: {last}")


def _all_supabase_users() -> list:
    r = _supa_call("GET", "/auth/v1/admin/users", headers=_admin_headers, params={"per_page": 200})
    if r.status_code != 200:
        print(f"  ! could not list Supabase users: {r.status_code} {r.text[:120]}")
        return []
    return r.json().get("users", [])


def purge_supabase_accounts() -> None:
    for u in _all_supabase_users():
        if (u.get("email") or "").endswith("@" + QA_DOMAIN):
            _supa_call("DELETE", f"/auth/v1/admin/users/{u['id']}", headers=_admin_headers)


def supabase_identity(label: str, phone: str) -> str:
    """Create a real Supabase account carrying `phone` and sign in; returns the token."""
    for u in _all_supabase_users():          # reclaim a number a crashed run left taken
        if (u.get("phone") or "").lstrip("+") == phone.lstrip("+"):
            _supa_call("DELETE", f"/auth/v1/admin/users/{u['id']}", headers=_admin_headers)
    email = f"dwrkqa-{label}@{QA_DOMAIN}"
    password = "Qa!" + uuid.uuid4().hex[:20]
    r = _supa_call("POST", "/auth/v1/admin/users", headers=_admin_headers, json={
        "email": email, "password": password, "email_confirm": True,
        "phone": phone, "phone_confirm": True})
    if r.status_code not in (200, 201):
        raise SystemExit(f"could not create {email}: {r.status_code} {r.text[:300]}")
    r = _supa_call("POST", "/auth/v1/token", params={"grant_type": "password"},
                   headers={"apikey": PUB, "Content-Type": "application/json"},
                   json={"email": email, "password": password})
    if r.status_code != 200:
        raise SystemExit(f"could not sign in as {email}: {r.status_code} {r.text[:300]}")
    return r.json()["access_token"]


def hdr(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def code_of(r: httpx.Response) -> str:
    try:
        return r.json().get("error", {}).get("code", "?")
    except Exception:       # noqa: BLE001
        return "?"


def data_of(r: httpx.Response):
    try:
        return r.json().get("data")
    except Exception:       # noqa: BLE001
        return None


partners: dict[str, dict] = {}
our_jobs: set[str] = set()


def only_available(*labels: str) -> None:
    run_sql("UPDATE partners SET is_available = (id = ANY(%(ids)s::uuid[])) WHERE phone LIKE %(p)s",
            {"ids": [partners[label]["id"] for label in labels], "p": PHONE_PREFIX + "%"})


def label_of(partner_id) -> str:
    for label, p in partners.items():
        if p["id"] == str(partner_id):
            return label
    return f"?{str(partner_id)[:8]}"


def backdate_offer(assignment_id, seconds: int) -> None:
    run_sql("UPDATE job_assignments SET offered_at = now() - make_interval(secs => %(s)s) "
            "WHERE id = %(i)s", {"s": seconds, "i": str(assignment_id)})


async def create_job(c, owner_token: str, tag: str) -> str:
    r = await c.post("/api/v1/jobs", json={
        "vehicle_id": VEHICLE_ID, "service_code": SERVICE_CODE,
        "pickup_lat": PICKUP_LAT, "pickup_lng": PICKUP_LNG,
        "pickup_address_text": "Dispatch worker QA pickup, SG Highway",
        "issue_description": f"{JOB_TAG} {tag}",
    }, headers=hdr(owner_token))
    if r.status_code != 201:
        raise SystemExit(f"job {tag} creation failed: {r.status_code} {r.text[:300]}")
    job_id = data_of(r)["id"]
    our_jobs.add(job_id)
    return job_id


def live_offer(job_id: str):
    live = [o for o in offers_for(job_id) if o["status"] == "offered"]
    return live[0] if len(live) == 1 else None


async def accept(c, label: str, assignment_id) -> httpx.Response:
    return await c.post(f"/api/v1/job-assignments/{assignment_id}/respond",
                        json={"action": "accept"}, headers=hdr(partners[label]["token"]))


async def main() -> None:                          # noqa: C901 - one linear script
    global _cleaned
    set_redis_client(fakeredis.aioredis.FakeRedis(decode_responses=True))

    from app.main import app                                  # noqa: E402
    from app.config.database import AsyncSessionLocal          # noqa: E402
    from app.repositories import dispatch_repository           # noqa: E402
    from app.services import dispatch_service, dispatch_worker, push_service  # noqa: E402

    # Scope the sweep to this run's jobs (see the module docstring), and record
    # what the real queries returned so the harness can check they found us.
    seen = {"offers": set(), "jobs": set()}
    real_offers, real_jobs = dispatch_repository.get_expired_offer_ids, dispatch_repository.get_searchable_job_ids

    async def scoped_offers(db, **kw):
        ids = await real_offers(db, **kw)
        mine = [i for i in ids if str((one("SELECT job_id FROM job_assignments WHERE id=%(i)s",
                                           {"i": str(i)}) or {}).get("job_id")) in our_jobs]
        seen["offers"].update(str(i) for i in mine)
        return mine

    async def scoped_jobs(db, **kw):
        mine = [i for i in await real_jobs(db, **kw) if str(i) in our_jobs]
        seen["jobs"].update(str(i) for i in mine)
        return mine

    dispatch_repository.get_expired_offer_ids = scoped_offers
    dispatch_repository.get_searchable_job_ids = scoped_jobs

    print("Cleaning up any leftovers from a previous run...")
    purge()
    purge_supabase_accounts()
    baseline = counts()
    print(f"  baseline: {baseline}")

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://dwrk.test", timeout=60.0) as c:

        section("1. One owner, three verified partners")
        owner_token = supabase_identity("owner", TEST_DRIVER_PHONE)
        r = await c.post(f"/api/v1/users/{USER_ID}/link-auth", headers=hdr(owner_token))
        check("owner linked to the test driver", r.status_code == 200, f"HTTP {r.status_code} {code_of(r)}")

        for label in LABELS:
            token = supabase_identity(label, PARTNER_PHONES[label])
            r = await c.post("/api/v1/partners", json={
                "name": f"Dispatch Worker QA {label}", "phone": PARTNER_PHONES[label],
                "primary_category_code": "mechanical"})
            if r.status_code != 201:
                raise SystemExit(f"{label} registration failed: {r.status_code} {r.text[:300]}")
            pid = data_of(r)["id"]
            r = await c.post(f"/api/v1/partners/{pid}/link-auth", headers=hdr(token))
            if r.status_code != 200:
                raise SystemExit(f"{label} link-auth failed: {r.status_code} {r.text[:300]}")
            run_sql("UPDATE partners SET verification_status='verified', rating_avg=4.6, "
                    "rating_count=12 WHERE id=%(i)s", {"i": pid})
            lat, lng = latlng(OFFSETS_KM[label])
            for path, body in ((f"/api/v1/partners/{pid}/services", {"service_codes": [SERVICE_CODE]}),
                               (f"/api/v1/partners/{pid}/location", {"lat": lat, "lng": lng})):
                r = await c.post(path, json=body, headers=hdr(token))
                if r.status_code not in (200, 201):
                    raise SystemExit(f"{path} failed: {r.status_code} {r.text[:300]}")
            partners[label] = {"id": pid, "token": token}
        check("three partners are verified, located and serviced", len(partners) == 3)

        section("2. A stale offer is timed out and the job goes to the next partner")
        only_available("alpha", "beta")
        job = await create_job(c, owner_token, "timeout")
        first = live_offer(job)
        check("the job was offered to one partner", first is not None, str(offers_for(job)))
        first_label = label_of(first["partner_id"])
        other = "beta" if first_label == "alpha" else "alpha"

        backdate_offer(first["id"], dispatch_service.OFFER_TTL_S + 5)
        res = await dispatch_worker.sweep_once(AsyncSessionLocal)
        check("the real expired-offer query found this offer", str(first["id"]) in seen["offers"])
        after = offers_for(job)
        by_rank = {o["assignment_rank"]: o for o in after}
        check("rank 1 is 'timed_out' with responded_at set",
              by_rank.get(1, {}).get("status") == "timed_out" and by_rank[1]["responded_at"] is not None,
              str(by_rank.get(1, {}).get("status")))
        check(f"rank 2 is a live offer to {other}",
              by_rank.get(2, {}).get("status") == "offered" and label_of(by_rank[2]["partner_id"]) == other,
              f"{by_rank.get(2, {}).get('status')} → {label_of(by_rank.get(2, {}).get('partner_id'))}")
        check("the job is still 'matching'", job_status(job) == "matching", str(job_status(job)))
        check("the sweep reports one re-offer", res.reoffered == 1 and not res.errors, str(res))

        r = await c.get("/api/v1/partners/me/offers", headers=hdr(partners[first_label]["token"]))
        check(f"{first_label}'s offer list no longer shows it", data_of(r) == [], repr(data_of(r))[:80])
        r = await accept(c, first_label, first["id"])
        check(f"{first_label} accepting the timed-out offer gets 409 ASSIGNMENT_ALREADY_ANSWERED",
              r.status_code == 409 and code_of(r) == "ASSIGNMENT_ALREADY_ANSWERED",
              f"HTTP {r.status_code} {code_of(r)}")

        section("3. A young offer is left alone")
        res = await dispatch_worker.sweep_once(AsyncSessionLocal)
        check("rank 2 is still 'offered' after another sweep",
              {o["assignment_rank"]: o["status"] for o in offers_for(job)}.get(2) == "offered")
        check("nothing was re-offered", res.reoffered == 0, str(res))

        section("4. The last partner timing out moves the job to 'no_match_found'")
        backdate_offer(by_rank[2]["id"], dispatch_service.OFFER_TTL_S + 5)
        await dispatch_worker.sweep_once(AsyncSessionLocal)
        check("rank 2 is 'timed_out'",
              {o["assignment_rank"]: o["status"] for o in offers_for(job)}.get(2) == "timed_out")
        check("the job is 'no_match_found'", job_status(job) == "no_match_found", str(job_status(job)))
        note = one("SELECT note FROM job_status_history WHERE job_id=%(i)s AND status='no_match_found' "
                   "ORDER BY changed_at DESC LIMIT 1", {"i": job})
        check("its history says nobody remaining accepted",
              (note or {}).get("note") == "No remaining partner accepted the job", str(note))

        # The real analytics query, windowed to this one job's requested_at, so
        # the shared database's other rows cannot leak in. Before the timed_out
        # bucket both timeouts read as partner declines (responded_at is set).
        from datetime import timedelta
        from app.repositories import analytics_repository   # noqa: E402
        req = one("SELECT requested_at FROM jobs WHERE id=%(i)s", {"i": job})["requested_at"]
        async with AsyncSessionLocal() as db:
            oc = await analytics_repository.offer_outcomes(
                db, from_ts=req, to_ts=req + timedelta(microseconds=1))
        check("analytics counts both as timed out, none as declined",
              (oc["offers_total"], oc["timed_out"], oc["declined"], oc["accepted"], oc["unanswered"])
              == (2, 2, 0, 0, 0), str(dict(oc)))

        section("5. The search widens with no call from the owner's app")
        only_available("gamma")
        res = await dispatch_worker.sweep_once(AsyncSessionLocal)
        check("inside 2 minutes the 10 km search does not reach gamma (15 km)",
              job_status(job) == "no_match_found" and res.jobs_rescued == 0, str(job_status(job)))
        run_sql("UPDATE jobs SET requested_at = now() - interval '180 seconds' WHERE id=%(i)s", {"i": job})
        res = await dispatch_worker.sweep_once(AsyncSessionLocal)
        check("the real searchable-job query found this job", job in seen["jobs"])
        g = {o["assignment_rank"]: o for o in offers_for(job)}.get(3, {})
        check("at 3 minutes a sweep offers it to gamma at rank 3",
              g.get("status") == "offered" and label_of(g.get("partner_id")) == "gamma",
              f"{g.get('status')} → {label_of(g.get('partner_id'))}")
        check("the job is back in 'matching'", job_status(job) == "matching", str(job_status(job)))
        note = one("SELECT note FROM job_status_history WHERE job_id=%(i)s AND status='matching' "
                   "ORDER BY changed_at DESC LIMIT 1", {"i": job})
        check("its history says the search widened to 20 km",
              (note or {}).get("note") == "Search widened to 20 km", str(note))
        r = await c.post(f"/api/v1/jobs/{job}/cancel", json={}, headers=hdr(owner_token))
        check("owner can still cancel it", r.status_code == 200, f"HTTP {r.status_code} {code_of(r)}")

        section(f"6. Accept racing the timeout, {TRIALS} trials: exactly one wins")
        only_available("alpha")
        wins = {"accept": 0, "timeout": 0}
        bad: list[str] = []
        for t in range(TRIALS):
            job = await create_job(c, owner_token, f"race-{t}")
            offer = live_offer(job)
            backdate_offer(offer["id"], dispatch_service.OFFER_TTL_S + 5)

            # Staggered start, so both orderings occur: early trials let the
            # timeout get ahead, later ones give the accept a head start.
            delay = t * 0.06

            async def expire():
                await asyncio.sleep(delay)
                async with AsyncSessionLocal() as db:
                    return await dispatch_service.expire_offer(db, offer["id"])

            r, _ = await asyncio.gather(accept(c, "alpha", offer["id"]), expire())
            a = one("SELECT status FROM job_assignments WHERE id=%(i)s", {"i": str(offer["id"])})["status"]
            st = job_status(job)
            accepted_rows = [o for o in offers_for(job) if o["status"] == "accepted"]
            if r.status_code == 200 and a == "accepted" and st == "assigned" and len(accepted_rows) == 1:
                wins["accept"] += 1
            elif (r.status_code == 409 and a == "timed_out" and st == "no_match_found"
                  and not accepted_rows):
                wins["timeout"] += 1
            else:
                bad.append(f"trial {t}: HTTP {r.status_code} {code_of(r)}, offer {a}, job {st}, "
                           f"{len(accepted_rows)} accepted")
            await c.post(f"/api/v1/jobs/{job}/cancel", json={}, headers=hdr(owner_token))
        check("every trial ended in exactly one consistent outcome", not bad, "; ".join(bad) or str(wins))

        section("7. The race made deterministic: timeout commits while the accept waits on the lock")
        job = await create_job(c, owner_token, "lock-hold")
        offer = live_offer(job)
        holder = psycopg2.connect(dsn)          # autocommit off: one open transaction
        hq = holder.cursor()
        hq.execute("SELECT id FROM jobs WHERE id = %(i)s FOR UPDATE", {"i": job})
        started = time.perf_counter()
        task = asyncio.create_task(accept(c, "alpha", offer["id"]))
        await asyncio.sleep(1.5)
        check("the accept is blocked on the job's row lock", not task.done())
        hq.execute("UPDATE job_assignments SET status='timed_out', responded_at=now() WHERE id=%(i)s",
                   {"i": str(offer["id"])})
        holder.commit()
        holder.close()
        r = await task
        check("the accept waited for the lock", time.perf_counter() - started >= 1.4)
        check("after the lock it refuses with 409 ASSIGNMENT_ALREADY_ANSWERED",
              r.status_code == 409 and code_of(r) == "ASSIGNMENT_ALREADY_ANSWERED",
              f"HTTP {r.status_code} {code_of(r)}")
        check("nothing was accepted and the job is not assigned",
              not [o for o in offers_for(job) if o["status"] == "accepted"] and job_status(job) == "matching",
              f"job {job_status(job)}")
        await c.post(f"/api/v1/jobs/{job}/cancel", json={}, headers=hdr(owner_token))

    await push_service.drain()
    section("8. Cleanup")
    purge()
    purge_supabase_accounts()
    _cleaned = True
    after = counts()
    check("every table is back to its baseline", after == baseline,
          f"{after}" if after != baseline else "unchanged")


def summarise() -> int:
    passed = sum(1 for ok, _, _ in _results if ok)
    failed = [(label, detail) for ok, label, detail in _results if not ok]
    print(f"\n{'=' * 70}\n{passed}/{len(_results)} checks passed")
    for label, detail in failed:
        print(f"  - {label}" + (f"  ({detail})" if detail else ""))
    print("=" * 70)
    return 1 if failed else 0


if __name__ == "__main__":
    try:
        asyncio.run(main())
    finally:
        if not _cleaned:
            print("\n! run did not finish — purging anyway")
            try:
                purge()
                purge_supabase_accounts()
            except Exception as exc:      # noqa: BLE001
                print(f"  ! cleanup failed: {type(exc).__name__}")
    sys.exit(summarise())
