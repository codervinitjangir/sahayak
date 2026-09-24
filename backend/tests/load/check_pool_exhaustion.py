"""Confirm what a pool-exhaustion failure looks like in the logs.

The spike run produced 5630 requests that never returned a response, logged only
as `error_type: "TimeoutError"`. Three different libraries in this stack raise an
exception whose class name is exactly "TimeoutError" — SQLAlchemy's pool checkout,
redis-py, and asyncio itself — so the log line alone cannot say which one fired,
and the report should not guess.

Two of the three can be eliminated by reasoning: a Redis timeout is caught in the
dispatch path and answered with a 201 (the run produced exactly one of those, and
it is visible as `dispatch_location_store_unavailable`), so a Redis timeout never
reaches the unhandled-exception handler. That leaves the pool.

This script confirms the remaining candidate positively rather than by elimination:
it exhausts a deliberately tiny pool against the same database and prints the class
name and message that SQLAlchemy actually raises. A one-connection pool is used
instead of the app's own so that the check costs one connection rather than
fifteen, and cannot itself disturb a measured run.
"""
import asyncio
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

import redis.exceptions  # noqa: E402
import sqlalchemy.exc  # noqa: E402
from sqlalchemy import text  # noqa: E402
from sqlalchemy.ext.asyncio import create_async_engine  # noqa: E402

from app.config.database import engine as app_engine  # noqa: E402
from app.config.settings import get_settings  # noqa: E402

S = get_settings()


def say(*a):
    print(*a, flush=True)


async def main() -> None:
    say("class names that all serialise to error_type 'TimeoutError':")
    for exc in (sqlalchemy.exc.TimeoutError, redis.exceptions.TimeoutError,
                asyncio.TimeoutError):
        say(f"  {exc.__module__}.{exc.__qualname__:<14} -> {exc.__name__!r}")

    pool = app_engine.pool
    say(f"\nthe application's own pool ({type(pool).__name__})")
    say(f"  pool_size      {pool.size()}")
    say(f"  max_overflow   {pool._max_overflow}")
    say(f"  pool_timeout   {pool._timeout} s")
    say(f"  => capacity    {pool.size() + pool._max_overflow} concurrent connections")

    probe = create_async_engine(
        S.ASYNC_DATABASE_URL, pool_size=1, max_overflow=0, pool_timeout=5,
    )
    try:
        async with probe.connect() as held:
            await held.execute(text("SELECT 1"))
            say("\nholding the probe pool's only connection; asking for a second...")
            start = time.perf_counter()
            try:
                async with probe.connect() as c:
                    await c.execute(text("SELECT 1"))
                say("  ! it succeeded — the pool did not behave as configured")
            except Exception as exc:
                say(f"  raised after {time.perf_counter() - start:.1f} s "
                    f"(pool_timeout was 5 s)")
                say(f"  type(exc).__name__ = {type(exc).__name__!r}"
                    f"   <-- exactly what the server log records")
                say(f"  message: {str(exc).splitlines()[0][:150]}")
    finally:
        await probe.dispose()
        await app_engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
