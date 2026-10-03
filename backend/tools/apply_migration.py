"""Apply one numbered SQL migration from db/migrations/ to the live database.

    python tools/apply_migration.py 007_admin_auth.sql
    python tools/apply_migration.py 007_admin_auth.sql --dry-run

Why this exists rather than `psql -f`: there is no psql on this machine, and
every previous migration was applied by pasting it into an ad-hoc script that
was then deleted. That is fine exactly once; by the seventh migration it is a
step nobody can reproduce. psycopg2 is already a dependency (every live harness
uses it) and, unlike asyncpg, it can execute a multi-statement block in one go —
which matters, because a migration is written as one block and splitting it on
semicolons would break the first function body or dollar-quoted string anybody
adds.

The whole file runs inside **one transaction**. If statement four fails,
statements one to three are rolled back and the migration is still unapplied,
rather than half-applied with no record of which half. This is the one place
where autocommit — the idiom the harnesses use — would be actively wrong.

Nothing here checks whether a migration has already run; there is no
schema_migrations table in this project and inventing one as a side effect of an
unrelated task would be the wrong place for it. Re-running is safe because
`db/migrations/README.md` requires every statement to be idempotent, and this
script verifies nothing about that — it is the author's job, and the way to
check it is to run the migration twice, which this script makes cheap.
"""
import sys
from pathlib import Path

for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import psycopg2  # noqa: E402

from app.config.settings import get_settings  # noqa: E402

MIGRATIONS = Path(__file__).resolve().parents[2] / "db" / "migrations"


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    dry_run = "--dry-run" in sys.argv

    if len(args) != 1:
        print(__doc__)
        return 2

    path = MIGRATIONS / args[0]
    if not path.is_file():
        print(f"FAIL  no such migration: {path}")
        return 2

    sql = path.read_text(encoding="utf-8")

    # The DSN carries the database password. Never print it — print the host and
    # the password's length, which is enough to tell "wrong database" and
    # "empty password" apart without putting the secret in a terminal
    # scrollback, a screenshot or a report.
    settings = get_settings()
    dsn = settings.DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://")
    host = dsn.rsplit("@", 1)[-1]
    secret_len = len(dsn.split("://", 1)[1].split("@", 1)[0].split(":", 1)[-1])
    print(f"      target    {host}  (password: {secret_len} chars, not shown)")
    print(f"      migration {path.name}  ({len(sql)} chars, "
          f"{sum(1 for ln in sql.splitlines() if ln.strip() and not ln.strip().startswith('--'))} "
          f"non-comment lines)")

    if dry_run:
        print("      --dry-run: not executed")
        return 0

    conn = psycopg2.connect(dsn)
    try:
        conn.autocommit = False          # deliberate; see the module docstring
        with conn.cursor() as cur:
            cur.execute(sql)
        conn.commit()
    except Exception as exc:
        conn.rollback()
        print(f"FAIL  rolled back: {type(exc).__name__}: {exc}")
        return 1
    finally:
        conn.close()

    print(f"OK    {path.name} applied and committed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
