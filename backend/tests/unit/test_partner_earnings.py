"""
Unit tests for the partner's earnings and coverage reads.

The SQL aggregate itself is proved against real Postgres by the integration
harness. What is worth pinning here is the boundary between the repository and
the response model, because both halves have a failure mode that looks fine:

  * the calendar windows. "Today" means today in Bengaluru, not UTC. A partner
    finishing at 00:30 IST would otherwise see the job vanish from today's
    total at 05:30 their time.
  * the mapping of service rows to base_price. The price must come from the
    same constant POST /jobs uses; a missing entry must be null, not zero and
    not a guess.

No database: the repository reads are stubbed.
"""
import asyncio
import uuid
from datetime import timezone
from decimal import Decimal
from zoneinfo import ZoneInfo

import pytest

from app.repositories import partner_repository
from app.services import partner_service
from app.services.auth_service import Identity

PARTNER_ID = uuid.UUID("77777777-7777-7777-7777-777777777777")
IST = ZoneInfo("Asia/Kolkata")


def _identity() -> Identity:
    return Identity(
        auth_user_id=uuid.UUID("88888888-8888-8888-8888-888888888888"),
        role="partner",
        local_id=PARTNER_ID,
    )


class TestEarnings:
    @pytest.fixture
    def captured(self, monkeypatch):
        state = {}

        async def get_partner_earnings(db, partner_id, today_start, week_start):
            state["partner_id"] = partner_id
            state["today_start"] = today_start
            state["week_start"] = week_start
            return {
                "partner_id": partner_id,
                "today_amount": Decimal("1200.00"),
                "today_jobs": 2,
                "week_amount": Decimal("5400.00"),
                "week_jobs": 7,
                "lifetime_amount": Decimal("24800.00"),
                "lifetime_jobs": 31,
            }

        monkeypatch.setattr(
            partner_repository, "get_partner_earnings", get_partner_earnings
        )
        result = asyncio.run(
            partner_service.get_partner_earnings(None, _identity())
        )
        return state, result

    def test_amounts_pass_through_unchanged(self, captured):
        _, result = captured

        assert result.partner_id == PARTNER_ID
        assert result.currency == "INR"
        assert result.today_amount == Decimal("1200.00")
        assert result.today_jobs == 2
        assert result.week_amount == Decimal("5400.00")
        assert result.lifetime_jobs == 31

    def test_today_window_starts_at_ist_midnight(self, captured):
        state, _ = captured
        local = state["today_start"].astimezone(IST)

        assert (local.hour, local.minute, local.second, local.microsecond) == (0, 0, 0, 0)
        assert state["today_start"].tzinfo == timezone.utc

    def test_week_window_starts_on_monday_ist(self, captured):
        state, _ = captured
        local = state["week_start"].astimezone(IST)

        assert local.weekday() == 0
        assert (local.hour, local.minute, local.second) == (0, 0, 0)
        assert local <= state["today_start"].astimezone(IST)


class TestPartnerServices:
    def test_services_carry_the_same_base_price_as_the_catalogue(self, monkeypatch):
        async def get_partner_services(db, partner_id):
            class Row:
                def __init__(self, id, code, name):
                    self.id = id
                    self.code = code
                    self.name = name

            return [
                Row(1, "flatbed_towing", "Flatbed Towing"),
                Row(99, "unpriced_service", "Unpriced"),
            ]

        monkeypatch.setattr(
            partner_repository, "get_partner_services", get_partner_services
        )

        result = asyncio.run(
            partner_service.get_partner_services(None, _identity())
        )

        assert result.partner_id == PARTNER_ID
        assert [s.code for s in result.services] == [
            "flatbed_towing",
            "unpriced_service",
        ]
        assert result.services[0].base_price == Decimal("1499.00")
        assert result.services[1].base_price is None

    def test_empty_coverage_is_a_list_not_an_error(self, monkeypatch):
        """A pre-verification partner has declared nothing yet."""

        async def get_partner_services(db, partner_id):
            return []

        monkeypatch.setattr(
            partner_repository, "get_partner_services", get_partner_services
        )

        result = asyncio.run(
            partner_service.get_partner_services(None, _identity())
        )

        assert result.services == []
