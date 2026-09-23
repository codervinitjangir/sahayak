"""
Vehicle endpoints: registration, listing and single fetch.

  POST   /api/v1/vehicles
  GET    /api/v1/vehicles
  GET    /api/v1/vehicles/{vehicle_id}

Handlers stay thin, exactly as in app/api/users.py: FastAPI validates the body,
get_db() supplies the session, app/services/vehicle_service.py does the work.
Responses go through envelope(); failures are rendered in the matching error
envelope by app/middlewares/error_handlers.py.

All three depend on require_user, which resolves the token to a local identity
and then insists it is an owner's. The specification for this task asked for
get_current_identity plus a role check in each handler; require_user *is* that
pair, already written and already used by POST /jobs, and calling it here keeps
the role rule in one place instead of copying an `if identity.role != "user"`
into three handlers where the fourth one to be added would be the one that
forgets it. Same substitution, and same reasoning, as the owner-cancel route in
app/api/jobs.py — see ADR-013.

A mechanic holding a valid partner token gets 403 here, not 401. Vehicles belong
to the owner side of the product: a partner has no vehicle of their own in this
schema, and the tow truck they drive is not modelled here.

Why this module exists at all: POST /jobs has always required a vehicle_id that
the caller owns, and until now nothing could create one. Every job in testing
used a row inserted by hand, which meant the owner-facing happy path had a hole
in the middle of it that no amount of API testing would have found.
"""
import uuid
from typing import List

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import API_V1_PREFIX
from app.config.database import get_db
from app.schemas.common import ApiResponse, ErrorResponse, envelope
from app.schemas.vehicle import VehicleCreateRequest, VehicleItem
from app.services import vehicle_service
from app.services.auth_service import Identity
from app.utils.auth import require_user

_ERROR_RESPONSES = {
    400: {"model": ErrorResponse, "description": "Invalid request"},
    401: {"model": ErrorResponse, "description": "Missing or invalid token"},
    403: {"model": ErrorResponse, "description": "Token valid, action not permitted"},
    404: {"model": ErrorResponse, "description": "Resource not found"},
    422: {"model": ErrorResponse, "description": "Request failed validation"},
    500: {"model": ErrorResponse, "description": "Unexpected server error"},
}

router = APIRouter(
    prefix=f"{API_V1_PREFIX}/vehicles",
    tags=["vehicles"],
    responses=_ERROR_RESPONSES,
)


@router.post(
    "",
    response_model=ApiResponse[VehicleItem],
    status_code=status.HTTP_201_CREATED,
    summary="Register a vehicle",
)
async def register_vehicle(
    payload: VehicleCreateRequest,
    identity: Identity = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[VehicleItem]:
    """Add a vehicle to the caller's account.

    The owner is read from the token. There is no user_id field in the request
    body, and sending one is a 422 rather than a silent no-op — the same rule as
    POST /jobs, made louder because here the field would look plausible.

    The registration number is stored normalised: uppercased, with spaces and
    hyphens removed. Echo back what the response contains rather than what was
    typed, or a client's local copy will disagree with the server's the first
    time someone types a space.

    Returns 400 INVALID_VEHICLE_NUMBER if the number is empty, too long or
    contains anything but letters and digits once normalised. Registering a
    number somebody else already has is *not* refused — see ADR-014.
    """
    vehicle = await vehicle_service.register_vehicle(db, payload, identity.local_id)
    return envelope(vehicle)


@router.get(
    "",
    response_model=ApiResponse[List[VehicleItem]],
    status_code=status.HTTP_200_OK,
    summary="List the caller's vehicles",
)
async def list_vehicles(
    identity: Identity = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[List[VehicleItem]]:
    """Every vehicle registered to the caller, newest first.

    An owner who has not added one yet gets `"data": []` and a 200, not a 404.
    That is the state every user is in between finishing signup and adding their
    first car; a client should render the "add a vehicle" prompt, not an error.

    `data` is the array itself rather than an object wrapping it. The envelope
    already provides `meta`, which is where a page cursor would go if this ever
    needs paginating, so there is nothing a wrapper object would be carrying.
    """
    vehicles = await vehicle_service.list_user_vehicles(db, identity.local_id)
    return envelope(vehicles)


@router.get(
    "/{vehicle_id}",
    response_model=ApiResponse[VehicleItem],
    status_code=status.HTTP_200_OK,
    summary="Get one of the caller's vehicles",
)
async def get_vehicle(
    vehicle_id: uuid.UUID,
    identity: Identity = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[VehicleItem]:
    """Fetch a single vehicle, provided it belongs to the caller.

    A vehicle that does not exist and a vehicle belonging to somebody else both
    return the same 404 VEHICLE_NOT_FOUND, with the same message. Not a 403: a
    403 that appears only for ids that exist would let anyone walking UUIDs
    enumerate the platform's vehicles. Same precedent as GET /jobs/{job_id}.
    """
    vehicle = await vehicle_service.get_user_vehicle(db, vehicle_id, identity.local_id)
    return envelope(vehicle)
