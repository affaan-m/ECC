import json
import tempfile
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from paper_trader.config import RiskLimits, load_config
from paper_trader.execution import PaperExecutionEngine
from paper_trader.journal import SQLiteTradeJournal
from paper_trader.market_data import Quote
from paper_trader.models import RoleEvidence, Side, Signal
from paper_trader.risk import KillSwitch, RiskManager
from paper_trader.scheduler import Scheduler
from paper_trader.signals import (
    ROLE_CATALOG,
    Scanner,
    _features,
    aggregate_signals,
)


class SignalAggregationTests(unittest.TestCase):
    def test_role_votes_are_collapsed_by_independent_domain(self):
        evidence = [
            RoleEvidence(f"trend-{index}", "trend", 1, 0.9, "positive trend")
            for index in range(20)
        ] + [
            RoleEvidence("momentum", "momentum", -1, 0.8, "negative momentum"),
            RoleEvidence("volatility", "volatility", -1, 0.8, "negative volatility"),
        ]

        signal = aggregate_signals("XAUUSD", evidence, min_domains=2)

        self.assertEqual(signal.side, Side.SELL)
        self.assertIn("momentum", {item.domain for item in signal.evidence})

    def test_insufficient_independent_domains_produce_hold(self):
        evidence = [
            RoleEvidence(f"trend-{index}", "trend", 1, 0.9, "positive trend")
            for index in range(27)
        ]

        signal = aggregate_signals("XAGUSD", evidence, min_domains=2)

        self.assertEqual(signal.side, Side.HOLD)

    def test_canceled_domain_does_not_count_as_supporting_another_domain(self):
        evidence = [
            RoleEvidence("trend-up", "trend", 1, 1.0, "positive trend"),
            RoleEvidence("trend-down", "trend", -1, 1.0, "negative trend"),
            RoleEvidence("momentum-up", "momentum", 1, 0.9, "positive momentum"),
        ]

        signal = aggregate_signals("XAUUSD", evidence, min_domains=2)

        self.assertEqual(signal.side, Side.HOLD)

    def test_domain_disagreement_does_not_trigger_a_trade(self):
        evidence = [
            RoleEvidence("bullish", "momentum", 1, 1.0, "positive momentum"),
            RoleEvidence("bearish", "trend", -1, 0.56, "negative trend"),
        ]

        signal = aggregate_signals("XAUUSD", evidence, min_domains=2)

        self.assertEqual(signal.side, Side.HOLD)

    def test_equal_opposing_domain_scores_cancel_to_hold(self):
        evidence = [
            RoleEvidence("bullish", "momentum", 1, 1.0, "positive momentum"),
            RoleEvidence("bearish", "trend", -1, 1.0, "negative trend"),
        ]

        signal = aggregate_signals("XAUUSD", evidence, min_domains=2)

        self.assertEqual(signal.side, Side.HOLD)


class RiskLimitTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.journal = SQLiteTradeJournal(Path(self.temp_dir.name) / "trades.sqlite3")
        self.addCleanup(self.journal.close)
        self.kill_switch = KillSwitch()
        self.risk = RiskManager(
            RiskLimits(
                max_order_quantity=2,
                max_position_notional_usd=5_000,
                max_daily_loss_usd=100,
                max_concurrent_positions=1,
            ),
            self.kill_switch,
        )
        self.engine = PaperExecutionEngine(self.journal, self.risk)
        self.quote = Quote("XAUUSD", bid=2_000, ask=2_001)

    def test_rejects_order_above_position_cap(self):
        fill = self.engine.execute(
            Signal("XAUUSD", Side.BUY, 0.9, ()), self.quote, quantity=3
        )

        self.assertIsNone(fill)
        self.assertEqual(self.journal.open_positions(), [])

    def test_rejects_order_above_usd_notional_cap(self):
        limited_risk = RiskManager(
            RiskLimits(
                max_order_quantity=2,
                max_position_notional_usd=1_000,
                max_total_notional_usd=5_000,
                max_daily_loss_usd=100,
                max_concurrent_positions=1,
            ),
            self.kill_switch,
        )
        limited_engine = PaperExecutionEngine(self.journal, limited_risk)

        fill = limited_engine.execute(
            Signal("XAUUSD", Side.BUY, 0.9, ()), self.quote, quantity=1
        )

        self.assertIsNone(fill)
        self.assertEqual(limited_engine.last_rejection, "position notional cap exceeded")

    def test_rejects_order_after_daily_loss_cap(self):
        opened = self.engine.execute(
            Signal("XAUUSD", Side.BUY, 0.9, ()), self.quote, quantity=1
        )
        self.engine.close_position(
            opened.trade_id, Quote("XAUUSD", bid=1_800, ask=1_801)
        )

        fill = self.engine.execute(
            Signal("XAGUSD", Side.BUY, 0.9, ()),
            Quote("XAGUSD", bid=25, ask=25.1),
            quantity=1,
        )

        self.assertIsNone(fill)
        self.assertEqual(self.risk.daily_pnl, -201)

    def test_rejects_second_concurrent_position_and_same_symbol_add(self):
        self.assertIsNotNone(
            self.engine.execute(
                Signal("XAUUSD", Side.BUY, 0.9, ()), self.quote, quantity=1
            )
        )
        same_symbol_add = self.engine.execute(
            Signal("XAUUSD", Side.BUY, 0.9, ()), self.quote, quantity=1
        )
        other_symbol = self.engine.execute(
            Signal("XAGUSD", Side.BUY, 0.9, ()),
            Quote("XAGUSD", bid=25, ask=25.1),
            quantity=1,
            market_quotes=(self.quote, Quote("XAGUSD", bid=25, ask=25.1)),
        )

        self.assertIsNone(same_symbol_add)
        self.assertIsNone(other_symbol)
        self.assertEqual(len(self.journal.open_positions()), 1)

    def test_kill_switch_blocks_new_entries_but_allows_closing(self):
        self.kill_switch.engage()

        blocked = self.engine.execute(
            Signal("XAUUSD", Side.BUY, 0.9, ()), self.quote, quantity=1
        )
        self.assertIsNone(blocked)

        self.kill_switch.release()
        opened = self.engine.execute(
            Signal("XAUUSD", Side.BUY, 0.9, ()), self.quote, quantity=1
        )
        self.kill_switch.engage()
        closed = self.engine.close_position(opened.trade_id, self.quote)

        self.assertIsNotNone(closed)
        self.assertEqual(self.journal.open_positions(), [])

    def test_unrealized_loss_counts_toward_daily_loss_cap(self):
        self.risk = RiskManager(
            RiskLimits(
                max_order_quantity=2,
                max_position_notional_usd=5_000,
                max_total_notional_usd=10_000,
                max_daily_loss_usd=100,
                max_concurrent_positions=2,
            ),
            self.kill_switch,
        )
        self.engine = PaperExecutionEngine(self.journal, self.risk)
        self.engine.execute(
            Signal("XAUUSD", Side.BUY, 0.9, ()), self.quote, quantity=1
        )

        self.engine.update_daily_pnl([Quote("XAUUSD", bid=1_800, ask=1_801)])
        silver_quote = Quote("XAGUSD", bid=25, ask=25.1)
        blocked = self.engine.execute(
            Signal("XAGUSD", Side.BUY, 0.9, ()),
            silver_quote,
            quantity=1,
            market_quotes=(Quote("XAUUSD", bid=1_800, ask=1_801), silver_quote),
        )

        self.assertIsNone(blocked)
        self.assertEqual(self.risk.daily_pnl, -201)

    def test_rejects_entry_when_open_position_mark_quote_is_missing(self):
        self.engine.execute(
            Signal("XAUUSD", Side.BUY, 0.9, ()), self.quote, quantity=1
        )
        self.risk = RiskManager(
            RiskLimits(
                max_order_quantity=2,
                max_position_notional_usd=5_000,
                max_total_notional_usd=10_000,
                max_daily_loss_usd=100,
                max_concurrent_positions=2,
            ),
            self.kill_switch,
        )
        self.engine = PaperExecutionEngine(self.journal, self.risk)

        fill = self.engine.execute(
            Signal("XAGUSD", Side.BUY, 0.9, ()),
            Quote("XAGUSD", bid=25, ask=25.1),
            quantity=1,
        )

        self.assertIsNone(fill)
        self.assertIn("XAUUSD", self.engine.last_rejection)


class PaperFillTests(unittest.TestCase):
    def test_buy_fills_at_ask_and_close_marks_realized_loss(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            journal = SQLiteTradeJournal(Path(temp_dir) / "trades.sqlite3")
            self.addCleanup(journal.close)
            engine = PaperExecutionEngine(
                journal,
                RiskManager(
                    RiskLimits(
                        max_order_quantity=1,
                        max_position_notional_usd=5_000,
                        max_daily_loss_usd=100,
                        max_concurrent_positions=1,
                    ),
                    KillSwitch(),
                ),
            )
            quote = Quote("XAUUSD", bid=2_000, ask=2_001)
            entry = engine.execute(
                Signal("XAUUSD", Side.BUY, 0.9, ()), quote, quantity=1
            )

            self.assertEqual(entry.fill_price, 2_001)
            closed = engine.close_position(
                entry.trade_id, Quote("XAUUSD", bid=1_999, ask=2_000)
            )

            self.assertEqual(closed.fill_price, 1_999)
            trade = journal.get_trade(entry.trade_id)
            self.assertEqual(trade["realized_pnl"], -2)
            self.assertEqual(trade["status"], "closed")

    def test_daily_realized_pnl_excludes_the_following_utc_day(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            journal = SQLiteTradeJournal(Path(temp_dir) / "trades.sqlite3")
            self.addCleanup(journal.close)
            first = journal.create_trade(
                "XAGUSD", "buy", 1, 25, "2026-11-23T23:00:00+00:00"
            )
            second = journal.create_trade(
                "XAGUSD", "buy", 1, 25, "2026-11-24T00:00:00+00:00"
            )
            journal.close_trade(
                first, 15, -10, "2026-11-23T23:59:59+00:00"
            )
            journal.close_trade(
                second, 55, 30, "2026-11-24T00:01:00+00:00"
            )

            self.assertEqual(journal.daily_realized_pnl("2026-11-23"), -10)


class ScannerAndSchedulerTests(unittest.TestCase):
    def test_scanner_uses_27_in_process_roles(self):
        from paper_trader.market_data import MockMarketDataProvider

        self.assertEqual(len(ROLE_CATALOG), 27)
        signals = Scanner().scan(MockMarketDataProvider().get_snapshot())

        self.assertEqual({signal.symbol for signal in signals}, {"XAUUSD", "XAGUSD"})

    def test_scheduler_retries_failures_and_tracks_health(self):
        attempts = []

        def flaky_operation():
            attempts.append(True)
            if len(attempts) < 3:
                raise RuntimeError("temporary provider failure")
            return "ok"

        scheduler = Scheduler(
            flaky_operation,
            interval_seconds=60,
            max_retries=2,
            retry_base_seconds=0,
        )

        self.assertTrue(scheduler.run_once())
        self.assertEqual(len(attempts), 3)
        metrics = scheduler.health()
        self.assertEqual(metrics["retry_count"], 2)
        self.assertEqual(metrics["consecutive_failures"], 0)
        self.assertEqual(metrics["status"], "healthy")

    def test_scheduler_health_is_degraded_during_retry_backoff(self):
        first_failure = threading.Event()
        attempts = []

        def flaky_operation():
            attempts.append(True)
            if len(attempts) == 1:
                first_failure.set()
                raise RuntimeError("temporary failure")

        scheduler = Scheduler(
            flaky_operation,
            interval_seconds=60,
            max_retries=1,
            retry_base_seconds=2,
        )
        worker = threading.Thread(target=scheduler.run_once, daemon=True)
        worker.start()
        self.assertTrue(first_failure.wait(timeout=1))
        deadline = time.monotonic() + 1
        while scheduler.health()["last_error"] is None and time.monotonic() < deadline:
            threading.Event().wait(0.005)

        self.assertEqual(scheduler.health()["status"], "degraded")
        worker.join(timeout=3)

    def test_scheduler_shutdown_interrupts_retry_backoff(self):
        first_failure = threading.Event()
        stop_event = threading.Event()
        attempts = []

        def failing_operation():
            attempts.append(True)
            first_failure.set()
            raise RuntimeError("temporary failure")

        scheduler = Scheduler(
            failing_operation,
            interval_seconds=60,
            max_retries=2,
            retry_base_seconds=10,
        )
        result = []
        worker = threading.Thread(
            target=lambda: result.append(scheduler.run_once(stop_event)),
            daemon=True,
        )
        worker.start()
        self.assertTrue(first_failure.wait(timeout=1))
        deadline = time.monotonic() + 1
        while scheduler.health()["last_error"] is None and time.monotonic() < deadline:
            threading.Event().wait(0.005)
        stop_event.set()
        worker.join(timeout=1)

        self.assertFalse(worker.is_alive())
        self.assertEqual(attempts, [True])
        self.assertEqual(result, [False])
        self.assertEqual(scheduler.health()["failure_count"], 1)

    def test_failed_scheduler_run_logs_exception_context(self):
        def failing_operation():
            raise RuntimeError("database unavailable")

        scheduler = Scheduler(
            failing_operation,
            interval_seconds=60,
            max_retries=0,
            retry_base_seconds=0,
        )

        with self.assertLogs("paper_trader.scheduler", level="ERROR") as captured:
            self.assertFalse(scheduler.run_once())

        self.assertIn("failed after 1 attempt", captured.output[0])
        self.assertIn("database unavailable", captured.output[0])

    def test_partial_config_keeps_default_scanner_roles(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            config_path = Path(temp_dir) / "config.json"
            config_path.write_text(
                json.dumps({"scheduler_interval_seconds": 10}),
                encoding="utf-8",
            )

            config = load_config(config_path)

        self.assertEqual(config.scheduler_interval_seconds, 10)
        self.assertEqual(len(Scanner(config.enabled_roles)._roles), 27)

    def test_ema_features_are_not_duplicate_sma_features(self):
        from paper_trader.market_data import MockMarketDataProvider

        snapshot = MockMarketDataProvider().get_snapshot()
        quote = snapshot.quotes[0]
        features = _features(snapshot.candles[quote.symbol], quote)

        self.assertNotEqual(features["ema_gap_5"], features["sma_gap_5"])
        self.assertNotEqual(features["ema_gap_10"], features["sma_gap_10"])


class AtomicEntryTests(unittest.TestCase):
    def test_concurrent_entries_cannot_exceed_position_limit(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            database = Path(temp_dir) / "trades.sqlite3"

            class DelayedJournal(SQLiteTradeJournal):
                def open_positions(self):
                    positions = super().open_positions()
                    time.sleep(0.05)
                    return positions

            journals = [DelayedJournal(database), DelayedJournal(database)]
            self.addCleanup(journals[0].close)
            self.addCleanup(journals[1].close)
            engines = [
                PaperExecutionEngine(
                    journal,
                    RiskManager(
                        RiskLimits(
                            max_order_quantity=1,
                            max_position_notional_usd=5_000,
                            max_total_notional_usd=2_010,
                            max_daily_loss_usd=100,
                            max_concurrent_positions=1,
                        ),
                        KillSwitch(),
                    ),
                )
                for journal in journals
            ]
            orders = (
                (
                    Signal("XAUUSD", Side.BUY, 0.9, ()),
                    Quote("XAUUSD", bid=2_000, ask=2_001),
                ),
                (
                    Signal("XAGUSD", Side.BUY, 0.9, ()),
                    Quote("XAGUSD", bid=25, ask=25.1),
                ),
            )
            start = threading.Barrier(2)

            def place(engine, order):
                start.wait()
                signal, quote = order
                return engine.execute(
                    signal,
                    quote,
                    quantity=1,
                    market_quotes=tuple(item[1] for item in orders),
                )

            with ThreadPoolExecutor(max_workers=2) as workers:
                fills = list(
                    workers.map(
                        lambda pair: place(*pair),
                        zip(engines, orders),
                    )
                )

            self.assertEqual(sum(fill is not None for fill in fills), 1)
            open_positions = journals[0].open_positions()
            self.assertEqual(len(open_positions), 1)
            self.assertLessEqual(
                sum(
                    position["quantity"] * position["entry_price"]
                    for position in open_positions
                ),
                2_010,
            )


if __name__ == "__main__":
    unittest.main()
