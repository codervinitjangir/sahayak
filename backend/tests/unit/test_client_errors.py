"""ADR-037: client crash reports go to the server log, not to a vendor.

POST /api/v1/client-errors is unauthenticated (an app that crashed may have no
session), rate-limited per address, bounded in size, and stores nothing. What
it logs carries no identifier: no user id, no token, no query string.
"""
from fastapi.testclient import TestClient

from app.api import client_errors
from app.main import app


def _client(monkeypatch, logged, limit_calls=None):
    async def no_limit(bucket, caller, limit):
        if limit_calls is not None:
            limit_calls.append((bucket, limit))

    monkeypatch.setattr(client_errors.rate_limit, "check", no_limit)
    monkeypatch.setattr(client_errors, "log_event", lambda event, **kw: logged.append((event, kw)))
    return TestClient(app)


def test_a_report_is_logged_and_accepted(monkeypatch):
    logged, limits = [], []
    r = _client(monkeypatch, logged, limits).post("/api/v1/client-errors", json={
        "platform": "android", "message": "TypeError: x is undefined",
        "stack": "at Foo", "path": "/jobs/abc?token=SECRET", "app_version": "1.0.3",
    })
    assert r.status_code == 202
    assert r.json()["data"] == {"accepted": True}
    assert limits == [("client-errors", client_errors.REPORTS_PER_MINUTE)]
    (event, kw), = logged
    assert event == "client_error"
    assert kw["platform"] == "android" and kw["path"] == "/jobs/abc"
    assert "SECRET" not in repr(kw), "a query string can carry a share token"


def test_oversized_or_unknown_fields_are_refused(monkeypatch):
    c = _client(monkeypatch, [])
    assert c.post("/api/v1/client-errors", json={"platform": "web", "message": "x" * 2001}).status_code == 422
    assert c.post("/api/v1/client-errors", json={"platform": "web", "message": "m", "user_id": "u"}).status_code == 422
    assert c.post("/api/v1/client-errors", json={"platform": "desktop", "message": "m"}).status_code == 422
