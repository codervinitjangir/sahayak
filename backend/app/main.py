from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.health import router as health_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    print("[+] Sahayak FastAPI backend has booted successfully!")
    yield
    print("[-] Sahayak FastAPI backend shutting down.")


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

# Include the health router
app.include_router(health_router)


@app.on_event("startup")
def on_startup():
    print("[+] Sahayak backend application started.")
