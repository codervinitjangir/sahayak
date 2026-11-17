"""Schemas for the identity-resolution endpoint.

Separate from app/schemas/user.py because what this describes is not a user. It
is the answer to "which of our three tables does this token resolve to", and a
partner or an admin gets the same shape back as an owner does.
"""
import uuid
from typing import List, Literal

from pydantic import BaseModel, ConfigDict


class IdentityResponse(BaseModel):
    """Who the bearer of this token is, in terms the client can route on.

    Two fields, and the narrowness is the design. A client calls this to answer
    one question — "where do I send this person next" — and that question needs
    the role and the local id and nothing else. Name, phone and email are
    deliberately absent: the caller either supplied them at registration or can
    read them from the resource endpoints, and a profile read that returns
    contact details is a different endpoint with a different privacy argument
    (ADR-017). An identity probe should not be the widest-reading route in the
    API.

    `role` is "user" | "partner" | "admin", matching Identity.role rather than
    renaming it at the boundary — the frontend and the backend logs should use
    the same word for the same thing.

    This endpoint cannot return "not registered". That case is a 403 with
    USER_NOT_REGISTERED or IDENTITY_NOT_LINKED, raised by resolve_identity
    before a handler runs, and the distinction between those two codes is the
    whole reason a client needs this call (ADR-011). Collapsing them into a
    nullable field here would throw away the information the endpoint exists to
    deliver.
    """

    role: Literal["user", "partner", "admin"]
    id: uuid.UUID
    # Every profile this login owns; more than one means the client can offer a
    # switch and send X-Sahayak-Profile to choose (ADR-034).
    profiles: List[Literal["user", "partner", "admin"]] = []

    model_config = ConfigDict(from_attributes=True)
