"""
Unit tests for GET /api/v1/services and its base_price projection.

The catalogue itself is seeded reference data, so the interesting question is not
"did the query run" but "is the number the client shows the same number
POST /jobs will store". Both now read SERVICE_BASE_PRICES, and this file pins
that they actually do — a second hardcoded table in a frontend is what the field
was added to delete.

No database: the repository read is stubbed with ORM-like rows.
"""
import asyncio
from decimal import Decimal

import pytest

from app.api.services import list_services
from app.repositories import service_repository
from app.services.job_service import SERVICE_BASE_PRICES


class FakeService:
    def __init__(self, id: int, code: str, name: str, category_id: int = 1):
        self.id = id
        self.code = code
        self.name = name
        self.category_id = category_id
        self.requires_vehicle_equipment = False


class FakeCategory:
    def __init__(self, code: str, name: str):
        self.code = code
        self.name = name


def _rows():
    return [
        (FakeService(1, "flatbed_towing", "Flatbed Towing"), FakeCategory("towing", "Towing")),
        (FakeService(3, "battery_jumpstart", "Battery Jumpstart"), FakeCategory("mechanical", "Mechanical")),
        # A code the pricing table does not know. It must come back null rather
        # than a guessed number: an invented price is worse than an absent one.
        (FakeService(99, "unpriced_service", "Unpriced"), None),
    ]


@pytest.fixture
def catalog(monkeypatch):
    async def list_services_stub(db):
        return _rows()

    monkeypatch.setattr(service_repository, "list_services", list_services_stub)
    return asyncio.run(list_services(None))["data"]


def test_base_price_matches_what_job_creation_will_store(catalog):
    """One constant, two readers. This is the whole point of the field."""
    prices = {item.code: item.base_price for item in catalog.items}

    assert prices["flatbed_towing"] == SERVICE_BASE_PRICES["flatbed_towing"]
    assert prices["battery_jumpstart"] == SERVICE_BASE_PRICES["battery_jumpstart"]
    assert prices["flatbed_towing"] == Decimal("1499.00")


def test_unknown_service_has_no_invented_price(catalog):
    unpriced = next(item for item in catalog.items if item.code == "unpriced_service")

    assert unpriced.base_price is None


def test_catalog_still_carries_display_fields(catalog):
    """The price addition must not have displaced what the grid renders."""
    flatbed = next(item for item in catalog.items if item.code == "flatbed_towing")

    assert flatbed.name == "Flatbed Towing"
    assert flatbed.category_code == "towing"
    assert flatbed.category_name == "Towing"
    assert catalog.total == 3
