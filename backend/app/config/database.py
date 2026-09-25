from typing import AsyncGenerator
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase
from app.config.settings import get_settings

settings = get_settings()

# Create async engine with pool pre-ping.
#
# **pool_size / max_overflow are set deliberately, and the number is a deployment
# constraint rather than a performance tuning knob.**
#
# The connection to Postgres is not direct: it goes through Supabase's Supavisor
# pooler in *session* mode, which allows **15 client connections in total, shared
# across every process that connects with these credentials** — this app, a
# second worker, a migration script, a psql window, all of them. SQLAlchemy's
# defaults are 5 + 10 overflow = 15, i.e. one worker of this app can fill the
# entire pooler on its own, leaving zero headroom for anything else. The dispatch
# load test measured exactly that: the pooler answered with an immediate 500
# (`asyncpg ... (EMAXCONNSESSION) max clients reached in session mode`) the moment
# a second process wanted a connection. See docs/load-test-dispatch-concurrency.md.
#
# 3 + 2 = 5 per worker leaves room for three workers plus operational access,
# which is what makes a second Render worker a graceful slowdown instead of a
# hard failure. It is *not* a claim that 5 is enough for production traffic —
# **this app must run as a single worker until the transaction-mode pooling
# migration is done**, which is tracked as future scope (it requires
# `statement_cache_size=0` for asyncpg, because transaction mode cannot keep
# server-side prepared statements across a pooled connection).
#
# What it costs: a sixth concurrent DB-using request waits at the pool rather
# than opening a connection, up to `pool_timeout` (30 s default). That ceiling
# was never approached by normal single-worker usage — see the pool-headroom
# measurement in the load-test report — so this trades throughput the app was
# not using for failure headroom it did not have.
engine = create_async_engine(
    settings.ASYNC_DATABASE_URL,
    echo=False,
    future=True,
    pool_pre_ping=True,
    pool_size=3,
    max_overflow=2,
)

# Async sessionmaker factory
AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False
)


class Base(DeclarativeBase):
    """SQLAlchemy 2.0 Base declarative class for all models."""
    pass


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """
    FastAPI dependency yielding an async database session.
    Automatically handles session lifecycle and cleanup.
    """
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()
