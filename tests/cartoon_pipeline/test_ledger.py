from __future__ import annotations

import sqlite3
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier

import pytest

from cartoon_pipeline.ledger import PublicationLedger


class _Cursor:
    def __init__(self, row: tuple[str] | None = None, rowcount: int = 0) -> None:
        self.row = row
        self.rowcount = rowcount

    def fetchone(self) -> tuple[str] | None:
        return self.row


class _Connection:
    def __enter__(self) -> _Connection:
        return self

    def __exit__(self, *args: object) -> None:
        return None

    def execute(self, query: str, parameters: tuple = ()) -> _Cursor:
        if query.lstrip().startswith("SELECT status"):
            return _Cursor(("failed",))
        if query.lstrip().startswith("UPDATE"):
            return _Cursor(rowcount=0)
        return _Cursor()


def test_failed_retry_requires_successful_conditional_reservation(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    ledger = PublicationLedger(tmp_path / "ledger.sqlite3")
    monkeypatch.setattr(ledger, "_connect", lambda: _Connection())

    with pytest.raises(RuntimeError, match="reconciliation"):
        ledger.reserve("2026-11-23", "youtube")


def test_concurrent_failed_retries_only_grant_one_reservation(
    tmp_path: Path,
) -> None:
    ledger = PublicationLedger(tmp_path / "ledger.sqlite3")
    ledger.reserve("2026-11-23", "youtube")
    ledger.mark_retryable_failure("2026-11-23", "youtube")
    barrier = Barrier(2)

    def reserve() -> str | RuntimeError:
        barrier.wait(timeout=5)
        try:
            return ledger.reserve("2026-11-23", "youtube")
        except RuntimeError as exc:
            return exc

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(lambda _: reserve(), range(2)))

    assert results.count("reserved") == 1
    assert sum(isinstance(result, RuntimeError) for result in results) == 1


def test_ledger_closes_connections_after_transactions(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    original_connect = sqlite3.connect
    connections: list[sqlite3.Connection] = []

    def tracking_connect(*args, **kwargs) -> sqlite3.Connection:
        connection = original_connect(*args, **kwargs)
        connections.append(connection)
        return connection

    monkeypatch.setattr("cartoon_pipeline.ledger.sqlite3.connect", tracking_connect)
    ledger = PublicationLedger(tmp_path / "ledger.sqlite3")

    ledger.reserve("2026-11-23", "youtube")
    ledger.mark_retryable_failure("2026-11-23", "youtube")

    assert len(connections) == 3
    for connection in connections:
        with pytest.raises(sqlite3.ProgrammingError, match="closed"):
            connection.execute("SELECT 1")
