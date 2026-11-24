import os
import sqlite3
import threading
import uuid
from contextlib import contextmanager
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path


_SCHEMA = (
    """
    CREATE TABLE IF NOT EXISTS paper_trading_mutex (
        lock_id INTEGER PRIMARY KEY,
        marker INTEGER NOT NULL
    )
    """,
    """
    INSERT INTO paper_trading_mutex (lock_id, marker)
    VALUES (1, 1)
    ON CONFLICT (lock_id) DO NOTHING
    """,
    """
    CREATE TABLE IF NOT EXISTS paper_trades (
        trade_id VARCHAR(32) PRIMARY KEY,
        symbol VARCHAR(10) NOT NULL,
        side VARCHAR(4) NOT NULL,
        quantity DOUBLE PRECISION NOT NULL,
        entry_price DOUBLE PRECISION NOT NULL,
        exit_price DOUBLE PRECISION,
        realized_pnl DOUBLE PRECISION NOT NULL DEFAULT 0,
        status VARCHAR(6) NOT NULL,
        opened_at VARCHAR(40) NOT NULL,
        closed_at VARCHAR(40)
    )
    """,
    """
    CREATE INDEX IF NOT EXISTS paper_trades_status_symbol
    ON paper_trades (status, symbol)
    """,
    """
    CREATE INDEX IF NOT EXISTS paper_trades_closed_at
    ON paper_trades (closed_at)
    """,
)


def _utc_now():
    return datetime.now(timezone.utc).isoformat()


class DBAPITradeJournal:
    """Portable journal using DB-API connections and caller-selected placeholders."""

    def __init__(self, connection, placeholder):
        if placeholder not in ("?", "%s"):
            raise ValueError("Placeholder must be '?' for SQLite or '%s' for PostgreSQL")
        self._connection = connection
        self._placeholder = placeholder
        self._lock = threading.RLock()
        self._transaction_local = threading.local()
        self._initialize()

    def _initialize(self):
        cursor = self._connection.cursor()
        try:
            for statement in _SCHEMA:
                cursor.execute(statement)
            self._connection.commit()
        except Exception:
            self._connection.rollback()
            raise
        finally:
            cursor.close()

    def _run(self, statement, params=(), fetch="none"):
        with self._lock:
            cursor = self._connection.cursor()
            in_transaction = getattr(self._transaction_local, "depth", 0) > 0
            try:
                cursor.execute(statement, params)
                if fetch == "one":
                    row = cursor.fetchone()
                    result = self._row_to_dict(cursor, row) if row is not None else None
                elif fetch == "all":
                    result = [
                        self._row_to_dict(cursor, row) for row in cursor.fetchall()
                    ]
                else:
                    result = cursor.rowcount
                if not in_transaction:
                    self._connection.commit()
                return result
            except Exception:
                if not in_transaction:
                    self._connection.rollback()
                raise
            finally:
                cursor.close()

    def _begin_transaction(self, cursor):
        cursor.execute("BEGIN")
        cursor.execute(
            "SELECT lock_id FROM paper_trading_mutex WHERE lock_id = 1 FOR UPDATE"
        )

    @contextmanager
    def transaction(self):
        with self._lock:
            depth = getattr(self._transaction_local, "depth", 0)
            if depth:
                self._transaction_local.depth = depth + 1
                try:
                    yield self
                finally:
                    self._transaction_local.depth = depth
                return

            cursor = self._connection.cursor()
            try:
                self._begin_transaction(cursor)
                self._transaction_local.depth = 1
                yield self
                self._connection.commit()
            except Exception:
                self._connection.rollback()
                raise
            finally:
                self._transaction_local.depth = 0
                cursor.close()

    @staticmethod
    def _row_to_dict(cursor, row):
        if hasattr(row, "keys"):
            return dict(row)
        columns = [column[0] for column in cursor.description]
        return dict(zip(columns, row))

    def create_trade(self, symbol, side, quantity, entry_price, opened_at=None):
        trade_id = uuid.uuid4().hex
        self._run(
            f"""
            INSERT INTO paper_trades
                (trade_id, symbol, side, quantity, entry_price, status, opened_at)
            VALUES ({self._placeholder}, {self._placeholder}, {self._placeholder},
                    {self._placeholder}, {self._placeholder}, {self._placeholder},
                    {self._placeholder})
            """,
            (
                trade_id,
                symbol,
                side,
                quantity,
                entry_price,
                "open",
                opened_at or _utc_now(),
            ),
        )
        return trade_id

    def close_trade(self, trade_id, exit_price, realized_pnl, closed_at=None):
        changed = self._run(
            f"""
            UPDATE paper_trades
            SET exit_price = {self._placeholder},
                realized_pnl = {self._placeholder},
                status = {self._placeholder},
                closed_at = {self._placeholder}
            WHERE trade_id = {self._placeholder} AND status = {self._placeholder}
            """,
            (
                exit_price,
                realized_pnl,
                "closed",
                closed_at or _utc_now(),
                trade_id,
                "open",
            ),
        )
        if changed != 1:
            raise ValueError("Open paper trade was not found")

    def get_trade(self, trade_id):
        return self._run(
            f"SELECT * FROM paper_trades WHERE trade_id = {self._placeholder}",
            (trade_id,),
            fetch="one",
        )

    def open_positions(self):
        return self._run(
            "SELECT * FROM paper_trades WHERE status = "
            f"{self._placeholder} ORDER BY opened_at",
            ("open",),
            fetch="all",
        )

    def daily_realized_pnl(self, day=None):
        if day is None:
            target_day = datetime.now(timezone.utc).date()
        elif isinstance(day, datetime):
            target_day = day.date()
        elif isinstance(day, date):
            target_day = day
        else:
            target_day = date.fromisoformat(day)
        start = datetime.combine(target_day, time.min, timezone.utc).isoformat()
        end = datetime.combine(
            target_day + timedelta(days=1), time.min, timezone.utc
        ).isoformat()
        row = self._run(
            f"""
            SELECT COALESCE(SUM(realized_pnl), 0) AS total
            FROM paper_trades
            WHERE status = {self._placeholder}
              AND closed_at >= {self._placeholder}
              AND closed_at < {self._placeholder}
            """,
            ("closed", start, end),
            fetch="one",
        )
        return float(row["total"])

    def close(self):
        self._connection.close()


class SQLiteTradeJournal(DBAPITradeJournal):
    def __init__(self, path="paper-trader.sqlite3"):
        database_path = os.fspath(path)
        if database_path != ":memory:":
            Path(database_path).parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(
            database_path, timeout=10, check_same_thread=False
        )
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA journal_mode = WAL")
        super().__init__(connection, "?")

    def _begin_transaction(self, cursor):
        cursor.execute("BEGIN IMMEDIATE")


class PostgresTradeJournal(DBAPITradeJournal):
    """PostgreSQL adapter for an already-created PEP 249 connection."""

    def __init__(self, connection):
        super().__init__(connection, "%s")
