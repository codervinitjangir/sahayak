"""
Unit tests for GET /api/v1/auth/me — the identity probe a client calls first.

Three things are worth pinning here, and none of them needs a database:

  1. The route is actually mounted. FastAPI 0.138 defers router inclusion, so
     importing the module and seeing the decorator proves nothing about whether
     the path answers — only the generated schema does. A new router that was
     never passed to include_router is a silent 404, and the symptom shows up in
     the frontend rather than here.
  2. The response carries the role and the local id and nothing else. This is a
     privacy assertion, not a shape assertion: the endpoint is reachable by every
     signed-in account on the platform, so any field that creeps into it later is
     a field exposed to all of them. A test that names the exact key set fails
     when someone adds `phone` for convenience.
  3. The handler reports the role it was handed, for all three roles. An owner
     asking "who am I" and getting "partner" would route them into the wrong half
     of the app with a valid token, which is the kind of bug that looks like a
     frontend fault for a day.

What is deliberately *not* here: the two 403s. USER_NOT_REGISTERED and
IDENTITY_NOT_LINKED are raised by resolve_identity against real rows, and the
frontend's entire sign-in routing hangs off which one it gets. Mocking the
lookups to assert a code this module does not raise would test the mock.
check_auth_flow.py drives both with real Supabase accounts instead.
"""
import asyncio
import uuid

from app.api.auth import read_me
from app.main import app
from app.schemas.auth import IdentityResponse
from app.services.auth_service import Identity

AUTH_ID = uuid.UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
LOCAL_ID = uuid.UUID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")


def _identity(role: str) -> Identity:
    return Identity(auth_user_id=AUTH_ID, role=role, local_id=LOCAL_ID)


# ---------------------------------------------------------------- 1. mounted


def test_route_is_mounted_under_the_versioned_prefix():
    """The generated schema is the only proof the router was included."""
    paths = app.openapi()["paths"]
    assert "/api/v1/auth/me" in paths, (
        "GET /api/v1/auth/me is missing from the OpenAPI schema, which means "
        "auth_router was never passed to include_router — the path 404s"
    )
    assert "get" in paths["/api/v1/auth/me"]


def test_route_is_not_restricted_to_one_role():
    """A client calls this because it does not yet know its role.

    Pinned against a future refactor that 'tightens' the dependency to
    require_user: that would 403 every mechanic and admin on the one endpoint
    whose job is to tell them what they are.
    """
    import inspect

    sig = inspect.signature(read_me)
    dependency = sig.parameters["identity"].default.dependency
    assert dependency.__name__ == "get_current_identity", (
        f"read_me depends on {dependency.__name__}; a require_* wrapper here "
        "would refuse exactly the callers that need this route"
    )


# ------------------------------------------------------------- 2. no leakage


def test_response_carries_role_and_id_and_nothing_else():
    body = IdentityResponse(role="user", id=LOCAL_ID).model_dump()
    assert set(body) == {"role", "id", "profiles"}, (
        f"IdentityResponse exposes {sorted(body)}. Every signed-in account on "
        "the platform can read this route, so a field added here is a field "
        "published to all of them — see ADR-017 on contact details."
    )


def test_response_omits_the_supabase_id_the_caller_already_holds():
    """auth_user_id is the caller's own Supabase id — echoing it back tells them
    nothing they did not send, and it is the id every log line keys on."""
    assert "auth_user_id" not in IdentityResponse.model_fields


# ----------------------------------------------------------------- 3. roles


def test_handler_reports_each_role_unchanged():
    for role in ("user", "partner", "admin"):
        response = asyncio.run(read_me(identity=_identity(role)))
        assert response["data"].role == role, (
            f"a {role} token resolved to role={response['data'].role!r}; the "
            "frontend routes on this value and would send them to the wrong app"
        )
        assert response["data"].id == LOCAL_ID


def test_handler_returns_the_local_id_not_the_auth_id():
    """The whole point of the call: the client knows its Supabase id already and
    needs ours, which is the foreign key every later route hangs off."""
    response = asyncio.run(read_me(identity=_identity("user")))
    assert response["data"].id == LOCAL_ID
    assert response["data"].id != AUTH_ID


def test_handler_wraps_the_payload_in_the_standard_envelope():
    response = asyncio.run(read_me(identity=_identity("partner")))
    assert set(response) == {"data", "meta"}
    assert "request_id" in response["meta"]
    assert isinstance(response["data"], IdentityResponse)
