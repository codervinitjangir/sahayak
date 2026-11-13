from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.admin import router as admin_router, admin_partners_router, admin_ops_router
from app.api.auth import router as auth_router
from app.api.health import router as health_router
from app.api.job_assignments import router as job_assignments_router
from app.api.jobs import router as jobs_router
from app.api.notifications import router as notifications_router
from app.api.partners import router as partners_router
from app.api.payments import router as payments_router
from app.api.devices import router as devices_router
from app.api.ratings import router as ratings_router
from app.api.services import router as services_router
from app.api.users import router as users_router
from app.api.vehicles import router as vehicles_router
from app.config.redis_client import close_redis
from app.middlewares.error_handlers import register_error_handlers
from app.middlewares.request_id import RequestIdMiddleware
from app.utils.logging import configure_logging, log_event

configure_logging()


@asynccontextmanager
async def lifespan(app: FastAPI):
    log_event("app_started", outcome="success")
    yield
    # Close the Redis pool on the way out. Not strictly required — the process
    # is ending — but an un-awaited connection produces a noisy "Task was
    # destroyed but it is pending" on shutdown, and a clean exit is worth more
    # than the two lines it costs.
    await close_redis()
    log_event("app_stopped", outcome="success")


from app.api.disputes import admin_disputes_router, router as disputes_router

app = FastAPI(
    title="Sahayak API",
    description="Real-Time Emergency Vehicle Assistance & Service Dispatch Platform",
    version="0.1.0",
    lifespan=lifespan
)

# CORS middleware allowing all origins (development only)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Added last, so it sits outermost: every request — including ones CORS or a
# validation error short-circuits — gets a correlation id and an access log line.
app.add_middleware(RequestIdMiddleware)

# Render HTTPException, validation failures and unhandled errors in the
# standard error envelope instead of FastAPI's three different default shapes.
register_error_handlers(app)

# Include the health router (unversioned /health, for container probes)
app.include_router(health_router)

# Include the auth router (GET /api/v1/auth/me). First of the versioned routers
# because it is the first call a client makes after sign-in: every other route
# here needs an identity, and this is the one that reports what the token
# resolves to instead of leaving the client to infer it from a failure.
app.include_router(auth_router)

# Include the jobs router (POST /api/v1/jobs, GET /api/v1/jobs/{job_id})
app.include_router(jobs_router)

# Include the partners router (registration, availability, location, coverage)
app.include_router(partners_router)

# Include the job assignments router (a partner accepting or rejecting an offer)
app.include_router(job_assignments_router)

# Include the users router (owner registration and the auth link)
app.include_router(users_router)

# Include the vehicles router (an owner registering and listing their vehicles)
app.include_router(vehicles_router)

# Include the ratings router (both sides rating a completed job). Registered
# after jobs_router and sharing its /api/v1/jobs prefix: the paths are distinct
# ("/{job_id}/ratings" against "/{job_id}"), so ordering does not change routing
# here, but keeping it adjacent means the two routers that answer under one
# prefix are read together.
app.include_router(ratings_router)

# Include the payments router (UPI, cash orders, payment confirmation)
app.include_router(payments_router)

# Device push tokens (ADR-026).
app.include_router(devices_router)

# Include the notifications router (the in-app feed both sides poll). Its own
# prefix, /api/v1/notifications, shared with nothing.
app.include_router(notifications_router)

# Include the services router (/api/v1/services). Unauthenticated: a seeded
# reference table with no user data, which both frontends need before a token
# exists — see the module docstring for the argument.
app.include_router(services_router)

# Include the admin analytics router (/api/v1/admin/analytics). Last, and under
# its own /admin prefix rather than beside the resource each report reads: the
# three routes return data spanning every job and every partner in the system,
# and keeping the one admin-only surface together in the path means an auth rule
# or a reverse-proxy restriction can be written against the prefix. Every route
# carries Depends(require_admin) individually — see the module docstring for why
# that is not set on the router instead.
app.include_router(admin_router)
app.include_router(admin_partners_router)
app.include_router(admin_ops_router)

# Problem reports and the staff dispute queue (ADR-027)
app.include_router(disputes_router)
app.include_router(admin_disputes_router)

