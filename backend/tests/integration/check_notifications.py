"""Live check: the in-app notification feed, and who each notification is for.

Run it directly — it needs no server process:

    python tests/integration/check_notifications.py

Add --reverted to run the **control**, described at the bottom of this docstring.

Not named test_*.py on purpose, same as its siblings: pytest must not collect it,
because it writes to the real database and creates real Supabase accounts.

-- What is actually under test ---------------------------------------------

Two things, and only the second one is hard.

The first is the four read endpoints: an empty feed, a page, a badge, a
mark-read, a mark-all-read, and the 404 that a notification belonging to
somebody else produces. Sections 2, 6, 7, 8, 9 and 10.

The second is **who gets told what**, which is the whole of ADR-019 and cannot be
tested anywhere but here. The writer is called from inside four other services'
transactions; every unit test of it substitutes the session, so no unit test can
show that a real status change against real Postgres actually leaves a row in
somebody's feed. And the rule it implements — notify the party that is *not* the
actor — is invisible from any single party's point of view. Proving it needs both
feeds read after the same event, which is what sections 3, 4, 5, 11 and 12 do:

  * 3  an offer reaches the partner, and the owner's feed is still empty —
       which is also the only live proof that 'requested' and 'matching' are
       silent, since the owner's client would otherwise see two rows appear for
       a button press it is still rendering the response to.
  * 4  the accept reaches the owner, and the *accepting partner* hears nothing
       about their own accept.
  * 5  each lifecycle step reaches the owner, in order, one row per step — the
       same property `job_status_history` has, one table over.
  * 11 an owner's cancellation reaches the partner. This is the only seam in the
       system where a partner is the recipient, and it is the one the control run
       below attacks.
  * 12 a partner's cancellation reaches the owner, under a *different* event name
       from the owner's own — `job_cancelled_by_partner`, not a shared
       'job_cancelled' both sides would have to re-derive their half of.

Section 13 is the privacy assertion: no message in either feed contains anybody's
name, phone number, address or any digit at all. A notification message is a
stored string that nothing re-gates, so ADR-017's contact rules cannot reach it —
the only safe version is one with nothing in it to leak.

Section 6 manufactures a `sent_at` tie in SQL before paging. That is not a
contrived case: `now()` is transaction start time, so every notification written
by one cancellation of a job with two open offers shares a timestamp to the
microsecond. Under `ORDER BY sent_at DESC` alone, two pages of such a feed can
show one row twice and never show another.

-- The control run ---------------------------------------------------------

    python tests/integration/check_notifications.py --reverted

must FAIL. It changes exactly one thing: `recipients_for` loses its actor check
and always answers `("user",)`. That is the version somebody writes when they
read "the owner is the one who needs to know about their job" and stop there, and
it is not obviously wrong — it is right for the accept, right for every lifecycle
step, and right for a partner's cancellation. It is wrong for precisely one
event, the owner's own cancellation, where it sends the owner a notification
about the button they just pressed and leaves the mechanic holding a job that no
longer exists.

So the control passes every endpoint assertion, passes sections 3, 4, 5 and 12,
and fails section 11 and the counts that depend on it. The defect is isolated to
the one branch it lives in, which is the point: a control that deleted the routes
would fail everything and prove only that the routes exist.

Redis is fakeredis, the single substitution, for the reasons at the top of
check_dispatch_flow.py. Partner availability is set with SQL, as scaffolding, so
each job's offer reaches a known partner.

Cleanup runs at both ends, survives a crash, and the run FAILS if the table
counts do not return to their baseline.
"""
import asyncio
import sys
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

REVERTED = "--reverted" in sys.argv

USER_ID = "75e138ea-e39a-48da-8717-f4287099ddcc"      # Test Driver QA
VEHICLE_ID = "4c1c0c88-1d14-44d2-b21d-eba9d38c7453"   # their Maruti Swift

SERVICE_CODE = "battery_jumpstart"   # requires_vehicle_equipment = False

PICKUP_LAT, PICKUP_LNG = 23.0300, 72.5600
KM_PER_DEG_LAT = 111.32
KM_PER_DEG_LNG = 111.32 * 0.9205    # cos(23°) ≈ 0.9205

# Distinct from every other harness's numbers, domain and tag, so two runs can
# never purge each other's rows out from under one another. 099x belongs to
# check_ratings.py, 098x to check_partner_offers.py, 097x to
# check_dispatch_capacity.py, 096x to check_dispatch_race.py, 090x to
# check_dispatch_flow.py, 0801 to the load harness.
QA_DOMAIN = "sahayak-notifqa.invalid"
PHONE_PREFIX = "+91900000095"
JOB_TAG = "NOTIF-QA"

# alpha is offered and accepts every job. beta is never made available, so beta
# is never offered anything: beta exists to prove that a verified partner holding
# a valid token has an *empty* feed, which is the difference between "scoped to
# the caller" and "returns notifications".
LABELS = ("alpha", "beta")
PARTNER_PHONES = {label: PHONE_PREFIX + str(i + 1) for i, label in enumerate(LABELS)}
OFFSETS_KM = {"alpha": (0.7, 0.7), "beta": (-0.7, 0.7)}

# The names and numbers section 13 scans the message text for. Kept as one list
# so a future field cannot be added to the fixtures and forgotten here.
PII_NEEDLES: list[str] = []

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
    "jobs", "job_status_history", "job_assignments", "ratings", "notifications",
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


def purge() -> None:
    """Remove everything this script creates, in foreign-key order.

    Scoped by the QA phone prefix and the job tag, never by "recent rows" — a
    cleanup that works by timestamp will one day delete something real.

    notifications goes first, and is scoped **by job_id rather than by
    recipient**. The owner's rows are addressed to the shared Test Driver QA
    user, whose id is not this harness's to filter on; their tie to this run is
    the job they are about. notifications.job_id references jobs(id) with no
    ON DELETE, so deleting jobs first fails on the constraint and leaves the run
    half-cleaned.
    """
    q = conn.cursor()
    q.execute(
        "DELETE FROM notifications WHERE job_id IN "
        "(SELECT id FROM jobs WHERE issue_description LIKE %(tag)s)", {"tag": JOB_TAG + "%"},
    )
    # Belt and braces: a notification this namespace's partners received with no
    # job attached could not be produced by any code path today, but the column
    # is nullable and a future one could, and it would be invisible to the filter
    # above.
    q.execute(
        "DELETE FROM notifications WHERE recipient_type = 'partner' AND recipient_id IN "
        "(SELECT id FROM partners WHERE phone LIKE %(p)s)", {"p": PHONE_PREFIX + "%"},
    )
    q.execute(
        "DELETE FROM ratings WHERE job_id IN "
        "(SELECT id FROM jobs WHERE issue_description LIKE %(tag)s)", {"tag": JOB_TAG + "%"},
    )
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
    """Call Supabase, retrying a *transport* failure but never a rejection."""
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
    email = f"notifqa-{label}@{QA_DOMAIN}"
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


def data_of(r: httpx.Response):
    try:
        return r.json().get("data")
    except Exception:       # noqa: BLE001
        return None


partners: dict[str, dict] = {}
owner_token = ""


def only_available(*labels: str) -> None:
    ids = [partners[label]["id"] for label in labels]
    q = conn.cursor()
    q.execute(
        "UPDATE partners SET is_available = (id = ANY(%(ids)s::uuid[])) "
        "WHERE phone LIKE %(p)s",
        {"ids": ids, "p": PHONE_PREFIX + "%"},
    )


# --------------------------------------------------------------------------
# Feed helpers. Every read goes through the endpoint, never through SQL: the
# point of most of this file is that the *scoping* works, and a SQL read would
# be asserting on rows the endpoint might never return.
# --------------------------------------------------------------------------
async def feed(c, token: str, **params) -> dict:
    r = await c.get("/api/v1/notifications", params=params or None, headers=hdr(token))
    if r.status_code != 200:
        raise SystemExit(f"feed read failed: {r.status_code} {r.text[:300]}")
    return data_of(r)


async def badge(c, token: str) -> int:
    r = await c.get("/api/v1/notifications/unread-count", headers=hdr(token))
    if r.status_code != 200:
        raise SystemExit(f"badge read failed: {r.status_code} {r.text[:300]}")
    return data_of(r)["unread_count"]


def events(body: dict) -> list[str]:
    return [item["event"] for item in body["items"]]


async def job_created(c, tag: str) -> str:
    r = await c.post("/api/v1/jobs", json={
        "vehicle_id": VEHICLE_ID, "service_code": SERVICE_CODE,
        "pickup_lat": PICKUP_LAT, "pickup_lng": PICKUP_LNG,
        "pickup_address_text": "Notifications QA pickup, Outer Ring Rd",
        "issue_description": f"{JOB_TAG} {tag}",
    }, headers=hdr(owner_token))
    if r.status_code != 201:
        raise SystemExit(f"job {tag} creation failed: {r.status_code} {r.text[:300]}")
    return data_of(r)["id"]


def live_offer(job_id: str, label: str) -> dict:
    offer = one("SELECT id, partner_id FROM job_assignments "
                "WHERE job_id = %(i)s AND status = 'offered'", {"i": job_id})
    if offer is None or str(offer["partner_id"]) != partners[label]["id"]:
        raise SystemExit(f"expected a live offer to {label} on {job_id}, got {offer}")
    return offer


async def accepted_job(c, tag: str) -> str:
    """Create a job and have alpha accept it. Scaffolding, not an assertion."""
    job_id = await job_created(c, tag)
    offer = live_offer(job_id, "alpha")
    r = await c.post(f"/api/v1/job-assignments/{offer['id']}/respond",
                     json={"action": "accept"}, headers=hdr(partners["alpha"]["token"]))
    if r.status_code != 200:
        raise SystemExit(f"job {tag} accept failed: {r.status_code} {r.text[:300]}")
    return job_id


async def step(c, job_id: str, status: str, price: float | None = None) -> httpx.Response:
    body: dict = {"status": status}
    if price is not None:
        body["price_final"] = price
    return await c.post(f"/api/v1/jobs/{job_id}/status", json=body,
                        headers=hdr(partners["alpha"]["token"]))


# --------------------------------------------------------------------------
# The control: the recipient rule with its actor check removed.
# --------------------------------------------------------------------------
def actor_blind_recipients(status, *, actor_role):
    """"The owner is the one who cares about their job" — and nothing else.

    Identical to notification_service.recipients_for except that the
    `actor_role == "user"` branch is gone. Correct for the accept, for every
    lifecycle step and for a partner's cancellation; wrong for exactly one event,
    the owner's own cancellation, which it routes back to the owner and away from
    the mechanic who is still holding the job.
    """
    from app.services.notification_service import SILENT_STATUSES
    if status in SILENT_STATUSES:
        return ()
    return ("user",)


def require_a_clean_feed() -> None:
    """Refuse to start if the shared owner already has notifications.

    This harness is the only one whose assertions depend on another harness
    having cleaned up. Sections 2 to 12 read the Test Driver QA user's feed and
    count rows in it, and that user is shared by every harness that creates a
    job — so any of them that dies mid-run leaves notifications addressed to
    *this* harness's owner, and `purge()` cannot remove them, because its scope
    is this namespace's jobs and those rows belong to somebody else's.

    Without this guard the result is eighteen failing assertions about feeds
    being the wrong length, none of which names the cause. That is the failure
    mode worth spending ten lines to avoid: a run that reports a defect in the
    code when what it actually found was a dirty database. It happened once —
    check_dispatch_capacity.py hit a network stall, left five no-match jobs
    behind, and this file blamed the notification writer.

    Fails with SystemExit rather than a recorded check: there is nothing to
    report a pass or a fail about, because no assertion has run yet.
    """
    stale = rows(
        "SELECT recipient_type, event, count(*) AS n FROM notifications "
        "WHERE (recipient_type = 'user' AND recipient_id = %(u)s) "
        "   OR (recipient_type = 'partner' AND recipient_id IN "
        "       (SELECT id FROM partners WHERE phone LIKE %(p)s)) "
        "GROUP BY 1, 2 ORDER BY 3 DESC",
        {"u": USER_ID, "p": PHONE_PREFIX + "%"},
    )
    if not stale:
        return
    detail = ", ".join(f"{r['n']}x {r['event']} -> {r['recipient_type']}" for r in stale)
    raise SystemExit(
        "\nThis run was not started: the shared QA owner already has "
        f"notifications ({detail}).\n"
        "They are not this harness's — purge() removes everything tied to a "
        f"'{JOB_TAG}' job — so another harness left them behind, most likely by "
        "dying mid-run.\n"
        "Find the jobs they point at and delete those jobs; the cascade added by "
        "migration 006 takes the notifications with them:\n"
        "    SELECT DISTINCT j.id, j.status, j.issue_description\n"
        "      FROM jobs j JOIN notifications n ON n.job_id = j.id;\n"
    )


async def main() -> None:                          # noqa: C901 - one linear script
    global _cleaned, owner_token

    set_redis_client(fakeredis.aioredis.FakeRedis(decode_responses=True))

    if REVERTED:
        from app.services import notification_service      # noqa: E402
        notification_service.recipients_for = actor_blind_recipients
        print("*** CONTROL RUN: the recipient rule has lost its actor check and "
              "always answers the owner. This run must FAIL — on section 11 and "
              "the counts downstream of it, and nowhere else. ***")

    from app.main import app                    # noqa: E402  (after the Redis override)

    print("Cleaning up any leftovers from a previous run...")
    purge()
    purge_supabase_accounts()
    baseline = counts()
    print(f"  baseline: {baseline}")
    require_a_clean_feed()

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://notif.test",
                                 timeout=60.0) as c:

        # ------------------------------------------------------------------
        section("1. One owner, two verified partners")
        # ------------------------------------------------------------------
        _, owner_token = supabase_identity("owner")
        r = await c.post(f"/api/v1/users/{USER_ID}/link-auth", headers=hdr(owner_token))
        check("owner linked to the test driver", r.status_code == 200,
              f"HTTP {r.status_code} {code_of(r)}")

        owner_row = one("SELECT name, phone FROM users WHERE id = %(i)s", {"i": USER_ID})
        PII_NEEDLES.extend([owner_row["name"], owner_row["phone"]])

        for label in LABELS:
            _, token = supabase_identity(label)
            name = f"Notif QA {label}"
            r = await c.post("/api/v1/partners", json={
                "name": name,
                "phone": PARTNER_PHONES[label],
                "primary_category_code": "mechanical",
            })
            if r.status_code != 201:
                raise SystemExit(f"{label} partner registration failed: "
                                 f"{r.status_code} {r.text[:300]}")
            pid = data_of(r)["id"]
            PII_NEEDLES.extend([name, PARTNER_PHONES[label]])

            r = await c.post(f"/api/v1/partners/{pid}/link-auth", headers=hdr(token))
            if r.status_code != 200:
                raise SystemExit(f"{label} link-auth failed: {r.status_code} {r.text[:300]}")

            q = conn.cursor()
            q.execute("UPDATE partners SET verification_status='verified' WHERE id=%(i)s",
                      {"i": pid})

            lat, lng = latlng(OFFSETS_KM[label])
            for path, body in (
                (f"/api/v1/partners/{pid}/services", {"service_codes": [SERVICE_CODE]}),
                (f"/api/v1/partners/{pid}/location", {"lat": lat, "lng": lng}),
            ):
                r = await c.post(path, json=body, headers=hdr(token))
                if r.status_code not in (200, 201):
                    raise SystemExit(f"{path} failed: {r.status_code} {r.text[:300]}")
            partners[label] = {"id": pid, "token": token}

        only_available("alpha")

        # ------------------------------------------------------------------
        section("2. A feed nothing has happened to is empty, not missing")
        # ------------------------------------------------------------------
        body = await feed(c, owner_token)
        check("owner's feed is 200 with items: []",
              body["items"] == [] and body["total"] == 0,
              f"total={body['total']}")
        check("an empty feed reports has_more false", body["has_more"] is False,
              f"has_more={body['has_more']}")
        check("owner's badge is 0", await badge(c, owner_token) == 0)

        body = await feed(c, partners["beta"]["token"])
        check("a verified partner who has never been offered anything is also empty",
              body["items"] == [] and body["total"] == 0, f"total={body['total']}")

        # ------------------------------------------------------------------
        section("3. An offer notifies the partner — and the owner hears nothing")
        # ------------------------------------------------------------------
        job_a = await job_created(c, "job-a")
        live_offer(job_a, "alpha")

        body = await feed(c, partners["alpha"]["token"])
        check("alpha was told about the offer", events(body) == ["job_offered"],
              f"{events(body)}")
        check("alpha's badge is 1", await badge(c, partners["alpha"]["token"]) == 1)
        check("the notification is tied to the job", body["items"][0]["job_id"] == job_a)
        check("it arrives unread", body["items"][0]["is_read"] is False)

        # The live proof that 'requested' and 'matching' are silent. Both were
        # written to job_status_history a moment ago; neither produced mail.
        owner_body = await feed(c, owner_token)
        check("the owner's own request produced no notification for the owner",
              owner_body["items"] == [], f"{events(owner_body)}")
        history = rows("SELECT status FROM job_status_history WHERE job_id = %(i)s "
                       "ORDER BY changed_at", {"i": job_a})
        check("...even though both statuses did reach job_status_history",
              [h["status"] for h in history] == ["requested", "matching"],
              f"{[h['status'] for h in history]}")

        body = await feed(c, partners["beta"]["token"])
        check("beta, who was not offered it, still has an empty feed",
              body["items"] == [], f"{events(body)}")

        # ------------------------------------------------------------------
        section("4. The accept notifies the owner, not the partner who accepted")
        # ------------------------------------------------------------------
        offer = live_offer(job_a, "alpha")
        r = await c.post(f"/api/v1/job-assignments/{offer['id']}/respond",
                         json={"action": "accept"}, headers=hdr(partners["alpha"]["token"]))
        check("alpha accepts the offer", r.status_code == 200,
              f"HTTP {r.status_code} {code_of(r)}")

        owner_body = await feed(c, owner_token)
        check("the owner was told a partner accepted",
              events(owner_body) == ["job_accepted"], f"{events(owner_body)}")
        check("owner's badge is 1", await badge(c, owner_token) == 1)

        alpha_body = await feed(c, partners["alpha"]["token"])
        check("alpha was not told about their own accept",
              events(alpha_body) == ["job_offered"], f"{events(alpha_body)}")

        # ------------------------------------------------------------------
        section("5. One notification per lifecycle step, newest first")
        # ------------------------------------------------------------------
        for status, price in (("partner_en_route", None), ("in_progress", None),
                              ("completed", 500)):
            r = await step(c, job_a, status, price)
            check(f"alpha moves the job to {status}", r.status_code == 200,
                  f"HTTP {r.status_code} {code_of(r)}")

        owner_body = await feed(c, owner_token)
        check("the owner has exactly four notifications for this job",
              owner_body["total"] == 4, f"total={owner_body['total']}")
        check("newest first, one per transition",
              events(owner_body) == ["job_completed", "job_in_progress",
                                     "job_partner_en_route", "job_accepted"],
              f"{events(owner_body)}")
        check("one notification per history row, excluding the two silent ones",
              owner_body["total"] == len(rows(
                  "SELECT 1 FROM job_status_history WHERE job_id = %(i)s "
                  "AND status NOT IN ('requested','matching')", {"i": job_a})),
              f"{owner_body['total']}")

        alpha_body = await feed(c, partners["alpha"]["token"])
        check("alpha heard nothing about any of their own four moves",
              events(alpha_body) == ["job_offered"], f"{events(alpha_body)}")

        # ------------------------------------------------------------------
        section("6. Paging a feed whose rows share a timestamp")
        # ------------------------------------------------------------------
        # Manufactured, and not contrived: cancel_job_by_owner writes one row per
        # open assignment inside one transaction, and now() is transaction start
        # time, so those rows are already tied to the microsecond. Forcing the
        # tie here lets four rows exercise it instead of needing a job with two
        # live offers.
        q = conn.cursor()
        q.execute(
            "UPDATE notifications SET sent_at = (SELECT min(sent_at) FROM notifications "
            "WHERE job_id = %(i)s) WHERE job_id = %(i)s AND recipient_type = 'user'",
            {"i": job_a},
        )
        tied = rows("SELECT DISTINCT sent_at FROM notifications WHERE job_id = %(i)s "
                    "AND recipient_type = 'user'", {"i": job_a})
        check("all four owner rows now share one sent_at", len(tied) == 1,
              f"{len(tied)} distinct timestamp(s)")

        page1 = await feed(c, owner_token, limit=2, offset=0)
        page2 = await feed(c, owner_token, limit=2, offset=2)
        page3 = await feed(c, owner_token, limit=2, offset=4)
        ids1 = [i["id"] for i in page1["items"]]
        ids2 = [i["id"] for i in page2["items"]]

        check("two pages of two", len(ids1) == 2 and len(ids2) == 2,
              f"{len(ids1)}+{len(ids2)}")
        check("the pages do not overlap", set(ids1).isdisjoint(ids2))
        check("and between them they cover the whole feed",
              len(set(ids1) | set(ids2)) == 4, f"{len(set(ids1) | set(ids2))} distinct")
        check("has_more is true on the first page and false on the second",
              page1["has_more"] is True and page2["has_more"] is False,
              f"{page1['has_more']}/{page2['has_more']}")
        check("a page past the end is empty, not an error",
              page3["items"] == [] and page3["has_more"] is False)
        check("limit and offset are echoed back",
              page2["limit"] == 2 and page2["offset"] == 2)
        check("every page reports the same total", page1["total"] == page2["total"] == 4,
              f"{page1['total']}/{page2['total']}")

        r = await c.get("/api/v1/notifications", params={"limit": 101},
                        headers=hdr(owner_token))
        check("a limit above the cap is refused with 422", r.status_code == 422,
              f"HTTP {r.status_code}")

        # ------------------------------------------------------------------
        section("7. Marking one read")
        # ------------------------------------------------------------------
        target = page1["items"][0]["id"]
        r = await c.post(f"/api/v1/notifications/{target}/read", headers=hdr(owner_token))
        result = data_of(r) or {}
        check("mark-read is 200 with updated: 1",
              r.status_code == 200 and result.get("updated") == 1,
              f"HTTP {r.status_code} updated={result.get('updated')}")
        check("and returns the new badge, 3", result.get("unread_count") == 3,
              f"{result.get('unread_count')}")
        check("the badge endpoint agrees", await badge(c, owner_token) == 3)

        r = await c.post(f"/api/v1/notifications/{target}/read", headers=hdr(owner_token))
        result = data_of(r) or {}
        check("marking it again is 200 with updated: 0, not a 409",
              r.status_code == 200 and result.get("updated") == 0,
              f"HTTP {r.status_code} updated={result.get('updated')}")
        check("and the badge has not moved", result.get("unread_count") == 3,
              f"{result.get('unread_count')}")

        body = await feed(c, owner_token, limit=100)
        read_flags = {i["id"]: i["is_read"] for i in body["items"]}
        check("exactly one row reads as read",
              sum(1 for v in read_flags.values() if v) == 1,
              f"{sum(1 for v in read_flags.values() if v)} read")
        check("and it is the one that was marked", read_flags.get(target) is True)

        # ------------------------------------------------------------------
        section("8. A notification that is not yours does not exist")
        # ------------------------------------------------------------------
        r = await c.post(f"/api/v1/notifications/{target}/read",
                         headers=hdr(partners["alpha"]["token"]))
        check("alpha marking the owner's notification read is 404",
              r.status_code == 404 and code_of(r) == "NOTIFICATION_NOT_FOUND",
              f"HTTP {r.status_code} {code_of(r)}")

        r = await c.post(f"/api/v1/notifications/{uuid.uuid4()}/read",
                         headers=hdr(partners["alpha"]["token"]))
        check("an id belonging to nobody is the same 404, same code",
              r.status_code == 404 and code_of(r) == "NOTIFICATION_NOT_FOUND",
              f"HTTP {r.status_code} {code_of(r)}")

        check("the owner's row is still unread-or-read as the owner left it",
              one("SELECT is_read FROM notifications WHERE id = %(i)s",
                  {"i": target})["is_read"] is True)

        r = await c.get("/api/v1/notifications")
        check("no token is 401", r.status_code == 401, f"HTTP {r.status_code}")
        r = await c.get("/api/v1/notifications/unread-count",
                        headers={"Authorization": "Bearer not-a-jwt"})
        check("a junk token is 401", r.status_code == 401, f"HTTP {r.status_code}")

        # ------------------------------------------------------------------
        section("9. unread_only filters the page, never the badge")
        # ------------------------------------------------------------------
        filtered = await feed(c, owner_token, limit=100, unread_only=True)
        check("unread_only drops the read row from total", filtered["total"] == 3,
              f"total={filtered['total']}")
        check("every row it returns is unread",
              all(i["is_read"] is False for i in filtered["items"]))
        check("the badge is the same number either way", filtered["unread_count"] == 3,
              f"{filtered['unread_count']}")
        unfiltered = await feed(c, owner_token, limit=100)
        check("...while the unfiltered total still counts all four",
              unfiltered["total"] == 4 and unfiltered["unread_count"] == 3,
              f"total={unfiltered['total']} unread={unfiltered['unread_count']}")

        # ------------------------------------------------------------------
        section("10. Marking everything read")
        # ------------------------------------------------------------------
        r = await c.post("/api/v1/notifications/read-all", headers=hdr(owner_token))
        result = data_of(r) or {}
        check("read-all is 200 and changed the three unread rows",
              r.status_code == 200 and result.get("updated") == 3,
              f"HTTP {r.status_code} updated={result.get('updated')}")
        check("and reports a zero badge", result.get("unread_count") == 0,
              f"{result.get('unread_count')}")
        check("the badge endpoint agrees", await badge(c, owner_token) == 0)

        r = await c.post("/api/v1/notifications/read-all", headers=hdr(owner_token))
        result = data_of(r) or {}
        check("a second read-all is a 200 with updated: 0",
              r.status_code == 200 and result.get("updated") == 0,
              f"HTTP {r.status_code} updated={result.get('updated')}")

        body = await feed(c, owner_token, limit=100, unread_only=True)
        check("nothing unread is left to page", body["items"] == [] and body["total"] == 0,
              f"total={body['total']}")
        check("read-all did not touch alpha's feed",
              await badge(c, partners["alpha"]["token"]) == 1,
              f"{await badge(c, partners['alpha']['token'])}")

        # ------------------------------------------------------------------
        section("11. An owner's cancellation notifies the partner")
        # ------------------------------------------------------------------
        # The only seam where a partner is the recipient, and the one the control
        # run attacks. alpha's feed grows by two here: the offer, then the news
        # that the job they accepted is off.
        job_b = await accepted_job(c, "job-b")
        alpha_before = events(await feed(c, partners["alpha"]["token"], limit=100))
        alpha_badge_before = await badge(c, partners["alpha"]["token"])
        # Snapshot rather than arithmetic. The owner's badge is 1 here — job-b's
        # accept, from a moment ago — and what section 11 is about is that the
        # cancellation does not add to it. Asserting an absolute number would be
        # asserting my own count of the preceding sections.
        owner_before = events(await feed(c, owner_token, limit=100))
        owner_badge_before = await badge(c, owner_token)

        r = await c.post(f"/api/v1/jobs/{job_b}/cancel",
                         json={"cancellation_reason": "found a friend with cables"},
                         headers=hdr(owner_token))
        check("the owner cancels the job", r.status_code == 200,
              f"HTTP {r.status_code} {code_of(r)}")

        alpha_after = await feed(c, partners["alpha"]["token"], limit=100)
        check("alpha was told the owner cancelled",
              events(alpha_after)[0] == "job_cancelled_by_owner",
              f"newest={events(alpha_after)[:1]}")
        check("exactly one new row for alpha",
              len(events(alpha_after)) == len(alpha_before) + 1,
              f"{len(alpha_before)} -> {len(events(alpha_after))}")
        check("it names the cancelled job", alpha_after["items"][0]["job_id"] == job_b)
        check("alpha's badge went up by exactly one",
              await badge(c, partners["alpha"]["token"]) == alpha_badge_before + 1,
              f"{alpha_badge_before} -> {await badge(c, partners['alpha']['token'])}")

        owner_after = await feed(c, owner_token, limit=100)
        check("the owner was NOT told about their own cancellation",
              "job_cancelled_by_owner" not in events(owner_after),
              f"{events(owner_after)[:2]}")
        check("the owner's feed did not change at all",
              events(owner_after) == owner_before,
              f"{len(owner_before)} -> {len(events(owner_after))}")
        check("and the cancellation added nothing to the owner's badge",
              await badge(c, owner_token) == owner_badge_before,
              f"{owner_badge_before} -> {await badge(c, owner_token)}")

        check("no cancellation notification was addressed to the owner",
              one("SELECT count(*) AS n FROM notifications WHERE job_id = %(i)s "
                  "AND recipient_type = 'user'", {"i": job_b})["n"] == 1,
              "1 expected: the accept, and nothing else")

        # ------------------------------------------------------------------
        section("12. A partner's cancellation notifies the owner, under its own name")
        # ------------------------------------------------------------------
        job_c = await accepted_job(c, "job-c")
        r = await step(c, job_c, "cancelled")
        check("alpha cancels a job they had accepted", r.status_code == 200,
              f"HTTP {r.status_code} {code_of(r)}")

        owner_body = await feed(c, owner_token, limit=100)
        check("the owner was told, and told which side did it",
              events(owner_body)[0] == "job_cancelled_by_partner",
              f"newest={events(owner_body)[:1]}")
        check("the two cancellations do not share one event name",
              "job_cancelled_by_owner" not in events(owner_body),
              f"{events(owner_body)[:3]}")
        check("alpha heard nothing about their own cancellation",
              events(await feed(c, partners["alpha"]["token"], limit=100))[0]
              == "job_offered",
              "newest should still be job-c's offer")

        # ------------------------------------------------------------------
        section("13. No message carries a name, a number or an address")
        # ------------------------------------------------------------------
        # A notification message is a stored string, and nothing re-gates a
        # stored string. ADR-017 decides at read time who may see a mechanic's
        # name and number; text baked in at write time sits outside that gate
        # permanently, and would still be sitting there if the rules tightened.
        all_messages = [
            row["message"]
            for row in rows(
                "SELECT message FROM notifications WHERE job_id IN "
                "(SELECT id FROM jobs WHERE issue_description LIKE %(tag)s)",
                {"tag": JOB_TAG + "%"},
            )
        ]
        check("every notification written by this run has a message",
              all_messages and all(m for m in all_messages),
              f"{len(all_messages)} row(s)")

        leaked = [n for n in PII_NEEDLES
                  if any(n and n in (m or "") for m in all_messages)]
        check("no message contains an owner or partner name or phone number",
              leaked == [], f"leaked: {leaked}")

        with_digits = [m for m in all_messages if any(ch.isdigit() for ch in m)]
        check("no message contains a digit at all",
              with_digits == [], f"{with_digits[:2]}")

        for needle in ("Outer Ring", "23.03", "72.56"):
            check(f"no message contains {needle!r}",
                  not any(needle in (m or "") for m in all_messages))

        # The stronger version of the same property: the cancellation reason the
        # owner typed in section 11 is stored on the job, where the gated
        # GET /jobs/{id} decides who reads it. It must not have been copied.
        check("the owner's free-text cancellation reason was not copied into a message",
              not any("cables" in (m or "") for m in all_messages))

        # ------------------------------------------------------------------
        section("14. Every event written came from the vocabulary")
        # ------------------------------------------------------------------
        # The event column has no CHECK constraint on purpose (migration 005), so
        # this stands in for one over everything this run produced.
        from app.services.notification_service import NOTIFICATION_EVENTS
        written = {row["event"] for row in rows(
            "SELECT DISTINCT event FROM notifications WHERE job_id IN "
            "(SELECT id FROM jobs WHERE issue_description LIKE %(tag)s)",
            {"tag": JOB_TAG + "%"})}
        check("no unknown event reached the column",
              written <= set(NOTIFICATION_EVENTS),
              f"unknown: {sorted(written - set(NOTIFICATION_EVENTS))}")
        # Seven of the eight defined events, by name. The absent one is
        # job_no_match_found, which needs a job nobody is eligible for —
        # check_dispatch_flow.py's territory, and it would mean making both
        # partners unavailable in the middle of this run.
        expected = {
            "job_offered", "job_accepted", "job_partner_en_route", "job_in_progress",
            "job_completed", "job_cancelled_by_owner", "job_cancelled_by_partner",
        }
        check("this run exercised seven of the eight defined events, by name",
              written == expected,
              f"missing {sorted(expected - written)}, extra {sorted(written - expected)}")
        check("the eighth is job_no_match_found, and nothing here claimed it",
              set(NOTIFICATION_EVENTS) - written == {"job_no_match_found"},
              f"{sorted(set(NOTIFICATION_EVENTS) - written)}")

        channels = {row["channel"] for row in rows(
            "SELECT DISTINCT channel FROM notifications WHERE job_id IN "
            "(SELECT id FROM jobs WHERE issue_description LIKE %(tag)s)",
            {"tag": JOB_TAG + "%"})}
        check("everything was written on the in_app channel and nothing claims "
              "a delivery that never happened", channels == {"in_app"}, f"{channels}")

    # ----------------------------------------------------------------------
    section("15. Cleanup")
    # ----------------------------------------------------------------------
    purge()
    purge_supabase_accounts()
    _cleaned = True
    after = counts()
    check("every table is back to its baseline", after == baseline,
          f"{after}" if after != baseline else "unchanged")


def summarise() -> int:
    passed = sum(1 for ok, _, _ in _results if ok)
    failed = [(label, detail) for ok, label, detail in _results if not ok]
    print(f"\n{'=' * 70}")
    print(f"{passed}/{len(_results)} checks passed")
    if failed:
        print("\nFailed:")
        for label, detail in failed:
            print(f"  - {label}" + (f"  ({detail})" if detail else ""))
    if REVERTED:
        print("\nControl run: failures above are the expected result. A control "
              "run that passes means this harness is not testing the recipient rule.")
    print("=" * 70)
    return 1 if failed else 0


if __name__ == "__main__":
    try:
        asyncio.run(main())
    finally:
        # Cleanup runs even if an assertion raised or a request blew up: an
        # escaped exception that skips the purge leaves QA rows behind and
        # silently redefines "baseline" for every later run.
        if not _cleaned:
            print("\n! run did not finish — purging anyway")
            try:
                purge()
                purge_supabase_accounts()
            except Exception as exc:      # noqa: BLE001
                print(f"  ! cleanup failed: {type(exc).__name__}")
    sys.exit(summarise())
