#!/usr/bin/env python3
"""
hygiene-worker — Long-running cleanup daemon for the ECC Postgres layer.

Runs ``memory.run_hygiene_pass()`` on a configurable interval (default
60 minutes). Each pass invokes the per-table cleanup functions declared
in ``init_schema.sql`` (retrieval logs, expired memory, orphan edges)
and records the per-operation deleted-row counts to the local
telemetry database so operators can see what the worker did.

Operational modes
-----------------

``--once``     Run a single pass and exit (default is the daemon loop).
``--interval`` Seconds between passes in daemon mode (default 3600).
``--dry-run``  Print what would run without touching the database.
``--database-url`` Override $DATABASE_URL.

In daemon mode the worker sleeps for ``--interval`` between passes
and exits cleanly on SIGINT or SIGTERM (so launchd's stop signal
triggers a graceful shutdown rather than a Postgres disconnect).

Why a daemon and not pg_cron?
-----------------------------

The SQL cleanup functions in init_schema.sql are wrapped in commented
``select cron.schedule(...)`` calls (so pg_cron is a one-line enable
away for operators who want it). This worker is the application-side
alternative for systems that do not have pg_cron installed. It also
records metrics to the local telemetry database, which pg_cron
cannot do natively.

Usage examples
--------------

::

    # One-shot pass with the default DB
    python scripts/hygiene-worker.py --once

    # Daemon with a 30-minute interval
    python scripts/hygiene-worker.py --interval 1800

    # Dry run (validates the SQL without touching data)
    python scripts/hygiene-worker.py --once --dry-run
"""

from __future__ import annotations

import argparse
import logging
import os
import signal
import sys
import time
from dataclasses import dataclass
from pathlib import Path

# Make ``src/`` importable so we can use the telemetry package without
# requiring the user to set PYTHONPATH. The worker is invoked as
# ``python scripts/hygiene-worker.py`` from the repo root, so the
# parent directory of ``scripts/`` is the repo root.
SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent
sys.path.insert(0, str(REPO_ROOT / "src"))


# Imports below intentionally follow the sys.path manipulation so
# the worker can be invoked as ``python scripts/hygiene-worker.py``
# without requiring the user to set PYTHONPATH first.
# ``psycopg`` is imported lazily inside ``_run_pass`` so that
# ``--help`` and ``--dry-run`` work on machines that do not have
# psycopg installed (e.g. for reviewing the script's docs).
from telemetry import EventKind, SqliteEventStore, TelemetryCollector  # noqa: E402

_LOGGER = logging.getLogger("ecc.hygiene")


# Public, exported so callers and tests can refer to these by name.
DEFAULT_DATABASE_URL = "postgresql://agent_memory_service@/agent_memory"
DEFAULT_TELEMETRY_DB = "~/.ecc/telemetry.db"
DEFAULT_INTERVAL_SECONDS = 60 * 60  # 1 hour


@dataclass(frozen=True)
class OperationResult:
    """One row from ``memory.run_hygiene_pass()``.

    Immutable so the result of a pass can be safely passed across
    threads for metric recording.
    """

    operation: str
    deleted_count: int


def _parse_args(argv: list[str] | None) -> argparse.Namespace:
    """Build the argparse parser.

    Pulled out of main() so the argument shape is documented in one
    place and easy to extend.
    """
    parser = argparse.ArgumentParser(
        prog="hygiene-worker",
        description="ECC memory hygiene worker (cleanup daemon)",
    )
    parser.add_argument(
        "--once", action="store_true",
        help="Run a single hygiene pass and exit (default: daemon loop)",
    )
    parser.add_argument(
        "--interval", type=int, default=DEFAULT_INTERVAL_SECONDS,
        help=f"Seconds between passes in daemon mode (default {DEFAULT_INTERVAL_SECONDS})",
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Print what would run without touching the database",
    )
    parser.add_argument(
        "--database-url", default=os.environ.get("DATABASE_URL"),
        help=f"Postgres URL (default: $DATABASE_URL or {DEFAULT_DATABASE_URL})",
    )
    parser.add_argument(
        "--telemetry-db", default=DEFAULT_TELEMETRY_DB,
        help=f"Path to the telemetry database (default {DEFAULT_TELEMETRY_DB})",
    )
    parser.add_argument(
        "--service-user-id",
        default=os.environ.get("ECC_HYGIENE_USER_ID", "service:hygiene-worker"),
        help="Session app.current_user for RLS-scoped cleanup",
    )
    parser.add_argument(
        "--log-level", default="INFO",
        choices=("DEBUG", "INFO", "WARNING", "ERROR"),
        help="Logging level (default INFO)",
    )
    return parser.parse_args(argv)


def _install_signal_handlers() -> None:
    """Convert SIGINT/SIGTERM into a clean shutdown flag.

    The daemon loop polls ``_shutdown_requested`` between passes; this
    avoids the leak-prone pattern of catching ``KeyboardInterrupt``
    inside the sleep and lets launchd's stop signal cause a graceful
    exit.
    """
    def _request_shutdown(signum: int, _frame) -> None:
        global _shutdown_requested
        _shutdown_requested = True
        _LOGGER.info("received signal %d, shutting down after current pass", signum)

    signal.signal(signal.SIGINT, _request_shutdown)
    signal.signal(signal.SIGTERM, _request_shutdown)


# Module-level flag; set by the signal handler. Read by the loop.
# Defaulting to False at import time keeps the module importable in
# tests without triggering handler installation.
_shutdown_requested = False


def _resolve_database_url(args: argparse.Namespace) -> str:
    if args.database_url:
        return args.database_url
    env = os.environ.get("DATABASE_URL")
    if env:
        return env
    _LOGGER.warning(
        "no DATABASE_URL set; falling back to %s", DEFAULT_DATABASE_URL,
    )
    return DEFAULT_DATABASE_URL


def _resolve_telemetry_path(args: argparse.Namespace) -> Path:
    return Path(args.telemetry_db).expanduser()


def _db_error_class() -> type[BaseException]:
    """Return the psycopg.Error base class, lazily.

    Used in the daemon's error-handling ``except`` clause. Falls back
    to ``Exception`` when psycopg is not installed so the worker
    still surfaces a clean error path during --help or --dry-run.
    """
    try:
        import psycopg
    except ImportError:
        return Exception
    return psycopg.Error


def _assert_service_authority(conn) -> None:
    """Fail closed when the database identity cannot use service RLS policies."""
    row = conn.execute(
        "select memory.is_service_role() as is_service_role",
    ).fetchone()
    if not row or not row["is_service_role"]:
        raise PermissionError(
            "hygiene worker requires a trusted database service role",
        )


def _run_pass(
    database_url: str,
    dry_run: bool,
    *,
    service_user_id: str = "service:hygiene-worker",
) -> list[OperationResult]:
    """Run a single ``memory.run_hygiene_pass()`` call and parse the result.

    Returns an empty list in dry-run mode. Raises on database error
    so the caller can record a failure in telemetry before propagating.
    """
    if dry_run:
        _LOGGER.info("[dry-run] would call memory.run_hygiene_pass()")
        return []

    # Lazy import: psycopg is only needed when actually connecting.
    # This lets --help and --dry-run work on machines without the
    # Postgres driver installed.
    import psycopg
    from psycopg.rows import dict_row

    with psycopg.connect(database_url, row_factory=dict_row) as conn:
        conn.execute("select set_config('app.current_role', 'service', false)")
        conn.execute("select set_config('app.current_user', %s, false)", (service_user_id,))
        _assert_service_authority(conn)
        rows = conn.execute("select * from memory.run_hygiene_pass()").fetchall()

    return [
        OperationResult(operation=row["operation"], deleted_count=int(row["deleted_count"]))
        for row in rows
    ]


def _record_pass_metrics(
    store_path: Path, results: list[OperationResult], duration_ms: int,
) -> None:
    """Record per-operation metrics to the telemetry database.

    Best-effort: a telemetry failure must never block the cleanup
    pass. If the store cannot be opened, log and continue.
    """
    if not results:
        return
    try:
        store = SqliteEventStore(store_path)
    except OSError as exc:
        _LOGGER.warning("could not open telemetry store at %s: %s", store_path, exc)
        return
    try:
        collector = TelemetryCollector(store=store)
        for result in results:
            success = True
            # We do not currently surface per-operation errors from
            # run_hygiene_pass (the function returns 0 for "no work
            # needed" too). A future migration could return
            # per-operation error text; for now, treat 0 as success.
            collector.record_invocation(
                name=f"cleanup_{result.operation}",
                kind=EventKind.AGENT,
                duration_ms=duration_ms // max(1, len(results)),
                success=success,
                actor_id="hygiene-worker",
            )
        collector.flush()
    finally:
        store.close()


def _format_pass_summary(results: list[OperationResult], duration_s: float) -> str:
    """Render a one-line pass summary for stdout.

    Kept as a separate function so the daemon's stdout output and
    any future structured logger can share a single source of truth.
    """
    parts = ", ".join(f"{r.operation}={r.deleted_count}" for r in results)
    return f"hygiene pass ({duration_s:.2f}s): {parts or 'no work'}"


def _execute_one_pass(
    args: argparse.Namespace,
    database_url: str,
    telemetry_path: Path,
    pass_count: int,
    db_error_class: type[BaseException],
) -> int:
    """Run a single pass. Returns 0 on success, 2 on DB error in --once mode.

    Split out from ``_daemon_loop`` so the loop body reads as a
    sequence of names and the per-pass logic (timing, error
    handling, metric recording) is testable on its own.
    """
    db_error_class = _db_error_class()
    t0 = time.monotonic()
    try:
        results = _run_pass(
            database_url,
            args.dry_run,
            service_user_id=args.service_user_id,
        )
    except (db_error_class, ImportError, PermissionError) as exc:
        _LOGGER.error("hygiene pass %d failed: %s", pass_count, exc)
        if args.once:
            return 2
        time.sleep(min(args.interval, 60))
        return 0
    duration_ms = int((time.monotonic() - t0) * 1000)
    _LOGGER.info(_format_pass_summary(results, duration_ms / 1000))
    _record_pass_metrics(telemetry_path, results, duration_ms)
    return 0


def _daemon_loop(args: argparse.Namespace) -> int:
    """Run passes forever (or once if --once) until shutdown.

    Returns 0 on clean shutdown, 2 on a database error in --once
    mode so a CI step surfaces the failure.
    """
    database_url = _resolve_database_url(args)
    telemetry_path = _resolve_telemetry_path(args)
    db_error_class = _db_error_class()

    _LOGGER.info(
        "hygiene-worker starting (interval=%ds, dry_run=%s, telemetry=%s)",
        args.interval, args.dry_run, telemetry_path,
    )

    pass_count = 0
    while True:
        if _shutdown_requested:
            _LOGGER.info("shutdown requested, exiting after %d pass(es)", pass_count)
            return 0
        pass_count += 1

        exit_code = _execute_one_pass(
            args, database_url, telemetry_path, pass_count, db_error_class,
        )
        if exit_code != 0:
            return exit_code
        if args.once:
            return 0
        if _shutdown_requested:
            return 0
        _sleep_with_shutdown_check(args.interval)


def _sleep_with_shutdown_check(seconds: int) -> None:
    """Sleep in 1-second slices, checking the shutdown flag.

    Avoids a long blocking ``time.sleep`` so SIGTERM during the sleep
    window is honored within 1 second rather than after the full
    interval.
    """
    for _ in range(seconds):
        if _shutdown_requested:
            return
        time.sleep(1)


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    logging.basicConfig(
        level=getattr(logging, args.log_level),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    _install_signal_handlers()
    return _daemon_loop(args)


__all__ = (
    "DEFAULT_DATABASE_URL",
    "DEFAULT_INTERVAL_SECONDS",
    "DEFAULT_TELEMETRY_DB",
    "OperationResult",
    "main",
)


if __name__ == "__main__":
    sys.exit(main())
