import sqlite3
from datetime import datetime
from pathlib import Path

from cartoon_pipeline.utc import UTC


class PublicationLedger:
    """SQLite idempotency ledger; unresolved attempts are never retried silently."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS publications (
                    episode_id TEXT NOT NULL,
                    platform TEXT NOT NULL,
                    status TEXT NOT NULL,
                    remote_id TEXT,
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY (episode_id, platform)
                )
                """
            )

    def reserve(self, episode_id: str, platform: str) -> str:
        now = datetime.now(UTC).isoformat()
        with self._connect() as connection:
            row = connection.execute(
                "SELECT status FROM publications WHERE episode_id = ? AND platform = ?",
                (episode_id, platform),
            ).fetchone()
            if row:
                status = row[0]
                if status in {"published", "submitted"}:
                    return "already_published"
                if status == "failed":
                    connection.execute(
                        """
                        UPDATE publications
                        SET status = 'in_progress', updated_at = ?
                        WHERE episode_id = ? AND platform = ? AND status = 'failed'
                        """,
                        (now, episode_id, platform),
                    )
                    return "reserved"
                raise RuntimeError(
                    f"Previous {platform} attempt requires reconciliation before retry"
                )
            connection.execute(
                """
                INSERT INTO publications (episode_id, platform, status, updated_at)
                VALUES (?, ?, 'in_progress', ?)
                """,
                (episode_id, platform, now),
            )
        return "reserved"

    def complete(self, episode_id: str, platform: str, remote_id: str, status: str) -> None:
        if status not in {"published", "submitted"}:
            raise ValueError("Completion status must be published or submitted")
        with self._connect() as connection:
            cursor = connection.execute(
                """
                UPDATE publications
                SET status = ?, remote_id = ?, updated_at = ?
                WHERE episode_id = ? AND platform = ? AND status = 'in_progress'
                """,
                (
                    status,
                    remote_id,
                    datetime.now(UTC).isoformat(),
                    episode_id,
                    platform,
                ),
            )
            if cursor.rowcount != 1:
                raise RuntimeError("Publication ledger state changed unexpectedly")

    def mark_retryable_failure(self, episode_id: str, platform: str) -> None:
        with self._connect() as connection:
            cursor = connection.execute(
                """
                UPDATE publications
                SET status = 'failed', updated_at = ?
                WHERE episode_id = ? AND platform = ? AND status = 'in_progress'
                """,
                (datetime.now(UTC).isoformat(), episode_id, platform),
            )
            if cursor.rowcount != 1:
                raise RuntimeError("Publication ledger state changed unexpectedly")

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path, timeout=30)
        connection.execute("PRAGMA busy_timeout = 30000")
        return connection
