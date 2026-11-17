"""GET /partners/me/reviews: display-name masking and response shaping."""
import uuid
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from app.services import partner_service
from app.services.partner_service import owner_display_name


@pytest.mark.parametrize(
    "full, shown",
    [
        ("Mohana Laxmi", "Mohana L."),
        ("Ravi", "Ravi"),
        ("  ravi kumar sharma ", "ravi S."),
        ("", "Customer"),
        (None, "Customer"),
        ("Deleted user", "Customer"),
    ],
)
def test_owner_display_name_hides_surname(full, shown):
    assert owner_display_name(full) == shown


@pytest.mark.asyncio
async def test_list_my_reviews_shapes_rows_without_contact_details(monkeypatch):
    job_id = uuid.uuid4()
    seen = {}

    async def fake_list(db, partner_id, limit, offset):
        seen.update(partner_id=partner_id, limit=limit, offset=offset)
        return [SimpleNamespace(
            job_id=job_id, service_name="Battery Jumpstart", rating=5, comment="Quick",
            owner_name="Mohana Laxmi", created_at=datetime(2026, 11, 15, tzinfo=timezone.utc),
        )]

    monkeypatch.setattr(partner_service.rating_repository, "list_partner_reviews", fake_list)
    me = SimpleNamespace(local_id=uuid.uuid4())
    out = await partner_service.list_my_reviews(None, me, 20, 0)

    assert seen == {"partner_id": me.local_id, "limit": 20, "offset": 0}
    item = out.items[0]
    assert item.owner_display_name == "Mohana L."
    assert item.rating == 5 and item.service_name == "Battery Jumpstart"
    dumped = item.model_dump()
    assert "phone" not in str(dumped).lower()
    assert "owner_name" not in dumped
