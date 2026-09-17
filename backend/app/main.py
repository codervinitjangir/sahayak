from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.health import router as health_router
from app.api.jobs import router as jobs_router
from app.api.partners import router as partners_router
from app.middlewares.error_handlers import register_error_handlers
from app.middlewares.request_id import RequestIdMiddleware
from app.utils.logging import configure_logging, log_event

configure_logging()


@asynccontextmanager
async def lifespan(app: FastAPI):
    log_event("app_started", outcome="success")
    yield
    log_event("app_stopped", outcome="success")


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

# Include the jobs router (POST /api/v1/jobs, GET /api/v1/jobs/{job_id})
app.include_router(jobs_router)

# Include the partners router (registration, availability, service coverage)
app.include_router(partners_router)
