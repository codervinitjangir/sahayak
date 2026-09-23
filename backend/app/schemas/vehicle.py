import uuid
from datetime import datetime
from typing import Optional, Literal
from pydantic import BaseModel, ConfigDict, Field


class VehicleBase(BaseModel):
    vehicle_type: Optional[Literal["two_wheeler", "four_wheeler"]] = None
    make: Optional[str] = None
    model: Optional[str] = None
    vehicle_number: str


class VehicleCreate(VehicleBase):
    user_id: Optional[uuid.UUID] = None


class VehicleUpdate(BaseModel):
    vehicle_type: Optional[Literal["two_wheeler", "four_wheeler"]] = None
    make: Optional[str] = None
    model: Optional[str] = None
    vehicle_number: Optional[str] = None


class VehicleResponse(VehicleBase):
    id: uuid.UUID
    user_id: Optional[uuid.UUID] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class VehicleCreateRequest(BaseModel):
    """Inbound payload for POST /vehicles — what an owner registers.

    Deliberately narrower than VehicleCreate above, which carries user_id. The
    owner is taken from the caller's verified token, exactly as in POST /jobs, so
    there is no field here for it at all. `extra="forbid"` is what makes that
    refusal visible: a client that sends user_id gets a 422 naming the field
    rather than a 201 whose body quietly disagrees with what it asked for.
    Silently dropping it is how a client comes to believe it works.

    vehicle_type is required here although `vehicles.vehicle_type` is nullable.
    A vehicle with no class is not useful to dispatch — a two-wheeler and a car
    need different equipment and different quotes — and the column stays nullable
    only because rows predating this endpoint exist. Tightening at the API and
    leaving the column alone is the reversible direction: it costs no migration
    and no backfill, and a later decision to relax it breaks no stored row. See
    ADR-014.

    vehicle_number allows 32 characters against a 20-character column on purpose.
    What gets stored is the *normalised* number, which is shorter than what a
    human types — "KA 01 AB 1234" is 13 characters on the way in and 10 on the
    way to Postgres. Validating the raw input against 20 would reject a plate
    that fits comfortably once the separators are gone. The real ceiling is
    enforced after normalisation, in register_vehicle.
    """

    model_config = ConfigDict(extra="forbid")

    vehicle_type: Literal["two_wheeler", "four_wheeler"]
    make: Optional[str] = Field(default=None, max_length=50)
    model: Optional[str] = Field(default=None, max_length=50)
    vehicle_number: str = Field(
        ...,
        min_length=1,
        max_length=32,
        description=(
            "Registration number. Stored uppercased with spaces and hyphens "
            "removed, so 'ka 01 ab 1234' and 'KA01AB1234' are the same vehicle."
        ),
        examples=["KA01AB1234"],
    )


class VehicleItem(BaseModel):
    """One vehicle as its owner sees it.

    Used by all three vehicle endpoints — the 201 from registration, each element
    of the list, and the single fetch. One model rather than three because the
    resource genuinely is the same object in all three places, and a client that
    can parse one should not need a second parser for the others.

    user_id is omitted deliberately, not by oversight. All three responses are
    already scoped to the caller by their token, so echoing the owner id back
    tells them only what they themselves proved. Same reasoning as
    UserRegistrationResponse omitting auth_user_id.

    vehicle_type is a plain Optional[str] here rather than the Literal used on
    the way in, and that asymmetry is the point. Inbound, the Literal is a
    validation rule we want. Outbound, it would be a *liability*: a row written
    before this endpoint existed can hold NULL or any value the CHECK constraint
    allows, and a Literal would turn reading such a row into a 500 from response
    validation — the API refusing to show a user their own data because it
    disapproves of it. Requests are the place to be strict; responses have to be
    able to describe what is actually stored.
    """

    id: uuid.UUID
    vehicle_type: Optional[str] = None
    make: Optional[str] = None
    model: Optional[str] = None
    vehicle_number: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
