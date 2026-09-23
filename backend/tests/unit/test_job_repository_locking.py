"""The two job reads, pinned by the SQL they actually emit.

There are two ways to read a job row in this codebase and the difference
between them is one clause that does not appear anywhere in a response body,
a status code, or a log line. get_job_by_id_for_update() must emit
``FOR UPDATE``, because that clause is the entire mechanism preventing a
partner's completion and an owner's cancellation from overwriting each other.
get_job_by_id() must *not*, because it serves the polled GET /jobs/{job_id} and
a row lock there would make every status poll queue behind every mutation of
the same job.

Both halves are asserted, in both directions, for the same reason: the
plausible future edits are "delete the clause that looks redundant" and "add
the clause that looks safer", and each one silently breaks a different
guarantee. See ADR-013.

These tests compile the statement rather than run it, so they need no database.
The live proof that the lock is genuinely taken and genuinely not taken —
timing a mutation and a poll against a held lock — is
tests/integration/check_job_race.py sections 4 and 5. This file is the fast
guard; that one is the real evidence.
"""
import asyncio
import uuid

from sqlalchemy.dialects import postgresql

from app.repositories import job_repository


class _CapturingSession:
    """Just enough AsyncSession to capture the statement and hand back nothing.

    A real session is not needed and would not help: the question here is what
    SQL was built, not what the database did with it.
    """

    def __init__(self) -> None:
        self.statement = None

    async def execute(self, statement, *_args, **_kwargs):
        self.statement = statement
        return _EmptyResult()


class _EmptyResult:
    def scalar_one_or_none(self):
        return None


def sql_for(read) -> str:
    """Run one of the repository reads and return the SQL it compiled to."""
    session = _CapturingSession()
    asyncio.run(read(session, uuid.uuid4()))
    assert session.statement is not None, "the read issued no statement at all"
    return str(session.statement.compile(dialect=postgresql.dialect())).upper()


class TestTheLockingRead:
    def test_it_asks_postgres_for_a_row_lock(self):
        assert "FOR UPDATE" in sql_for(job_repository.get_job_by_id_for_update)

    def test_it_is_not_a_share_lock(self):
        """FOR SHARE would let two cancellations read the same row at once.

        Two transactions can both hold a share lock, so both would pass the
        terminal-state check and both would proceed to write — the original
        bug, with a lock in front of it for reassurance.
        """
        assert "FOR SHARE" not in sql_for(job_repository.get_job_by_id_for_update)

    def test_it_does_not_skip_locked_rows(self):
        """SKIP LOCKED would turn a contended job into a spurious 404.

        It is the right clause for a queue worker claiming the next free item
        and the wrong one here: the row is not interchangeable, it is *this*
        job, and "someone else is mid-write" must become a 409, never "no such
        job".
        """
        assert "SKIP LOCKED" not in sql_for(job_repository.get_job_by_id_for_update)

    def test_it_does_not_return_immediately_on_contention(self):
        """NOWAIT would surface contention as a 500 instead of waiting ~ms.

        The second request is meant to block briefly, then re-read and answer
        409. NOWAIT makes it raise instead, which the service maps to
        InternalError — the user-visible symptom being a server error on a
        perfectly ordinary double-tap.
        """
        assert "NOWAIT" not in sql_for(job_repository.get_job_by_id_for_update)


class TestThePollingRead:
    def test_it_takes_no_lock_of_any_kind(self):
        """The one that must stay cheap.

        GET /jobs/{job_id} is polled for the whole life of a job by every
        tracking screen watching it. Adding a lock here would be invisible in
        every test that checks status codes and would serialize every poll
        against every mutation of the same job.
        """
        sql = sql_for(job_repository.get_job_by_id)
        assert "FOR UPDATE" not in sql
        assert "FOR SHARE" not in sql

    def test_both_reads_select_the_same_row_by_primary_key(self):
        """The locking variant is the same query plus a clause, not a new one.

        If the two ever disagree about *which* row they fetch, the endpoints
        would be locking one job and deciding about another.
        """
        locked = sql_for(job_repository.get_job_by_id_for_update)
        plain = sql_for(job_repository.get_job_by_id)
        assert "JOBS.ID = " in plain
        assert "JOBS.ID = " in locked
        assert locked.replace(" FOR UPDATE", "").strip() == plain.strip()
