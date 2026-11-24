import csv
import importlib.util
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
EXAMPLE_DIR = REPO_ROOT / "examples" / "xauusd-paper-trader"
SPEC = importlib.util.spec_from_file_location(
    "paper_trader", EXAMPLE_DIR / "paper_trader.py"
)
paper_trader = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = paper_trader
SPEC.loader.exec_module(paper_trader)


def bars_from_rows(rows):
    return [
        paper_trader.Bar(timestamp, open_price, high, low, close)
        for timestamp, open_price, high, low, close in rows
    ]


class PaperTraderTests(unittest.TestCase):
    def setUp(self):
        self.bars = bars_from_rows([
            ("2026-01-01T00:00:00Z", 10.0, 10.1, 9.9, 10.0),
            ("2026-01-01T00:01:00Z", 9.0, 9.1, 8.9, 9.0),
            ("2026-01-01T00:02:00Z", 8.0, 8.1, 7.9, 8.0),
            ("2026-01-01T00:03:00Z", 9.5, 9.6, 9.4, 9.5),
            ("2026-01-01T00:04:00Z", 10.0, 10.1, 10.0, 10.1),
            ("2026-01-01T00:05:00Z", 10.5, 10.9, 10.4, 10.8),
        ])
        self.config = paper_trader.BacktestConfig(
            fast_window=1,
            slow_window=3,
            initial_balance=1000.0,
            risk_per_trade=0.01,
            stop_loss_percent=0.01,
            take_profit_percent=0.02,
        )

    def test_enters_on_next_bar_open_and_closes_at_end_of_data(self):
        config = paper_trader.BacktestConfig(
            fast_window=1,
            slow_window=3,
            initial_balance=1000.0,
            risk_per_trade=0.01,
            stop_loss_percent=0.01,
            take_profit_percent=0.1,
        )
        result = paper_trader.backtest(self.bars, config)

        self.assertEqual(len(result.trades), 1)
        trade = result.trades[0]
        self.assertEqual(trade.entry_timestamp, "2026-01-01T00:04:00Z")
        self.assertEqual(trade.entry_price, 10.0)
        self.assertEqual(trade.exit_reason, "end_of_data")
        self.assertEqual(trade.exit_price, 10.8)
        self.assertAlmostEqual(result.final_balance, 1080.0)

    def test_stop_loss_wins_when_stop_and_target_both_touch_in_one_bar(self):
        bars = list(self.bars)
        bars[4] = paper_trader.Bar(
            bars[4].timestamp, 10.0, 10.3, 9.8, 10.1
        )
        result = paper_trader.backtest(bars, self.config)

        trade = result.trades[0]
        self.assertEqual(trade.exit_reason, "stop_loss")
        self.assertEqual(trade.exit_price, 9.9)
        self.assertAlmostEqual(result.realized_trade_max_drawdown_percent, 1.0)

    def test_downward_crossover_exits_at_the_next_bar_open(self):
        bars = bars_from_rows([
            ("2026-01-01T00:00:00Z", 10.0, 10.1, 9.9, 10.0),
            ("2026-01-01T00:01:00Z", 9.0, 9.1, 8.9, 9.0),
            ("2026-01-01T00:02:00Z", 8.0, 8.1, 7.9, 8.0),
            ("2026-01-01T00:03:00Z", 9.5, 9.6, 9.4, 9.5),
            ("2026-01-01T00:04:00Z", 10.1, 10.2, 10.0, 10.1),
            ("2026-01-01T00:05:00Z", 10.1, 10.3, 10.0, 10.2),
            ("2026-01-01T00:06:00Z", 10.0, 10.1, 9.8, 9.9),
            ("2026-01-01T00:07:00Z", 9.7, 9.8, 9.6, 9.75),
        ])
        config = paper_trader.BacktestConfig(
            fast_window=1,
            slow_window=3,
            initial_balance=1000.0,
            risk_per_trade=0.01,
            stop_loss_percent=0.1,
            take_profit_percent=0.5,
        )

        result = paper_trader.backtest(bars, config)

        self.assertEqual(len(result.trades), 1)
        trade = result.trades[0]
        self.assertEqual(trade.entry_timestamp, "2026-01-01T00:04:00Z")
        self.assertEqual(trade.exit_timestamp, "2026-01-01T00:07:00Z")
        self.assertEqual(trade.exit_price, 9.7)
        self.assertEqual(trade.exit_reason, "moving_average_cross")
        self.assertAlmostEqual(result.final_balance, 996.0396039604)

    def test_gap_below_stop_exits_at_the_opening_price(self):
        bars = bars_from_rows([
            ("2026-01-01T00:00:00Z", 10.0, 10.1, 9.9, 10.0),
            ("2026-01-01T00:01:00Z", 9.0, 9.1, 8.9, 9.0),
            ("2026-01-01T00:02:00Z", 8.0, 8.1, 7.9, 8.0),
            ("2026-01-01T00:03:00Z", 9.5, 9.6, 9.4, 9.5),
            ("2026-01-01T00:04:00Z", 10.1, 10.2, 10.0, 10.1),
            ("2026-01-01T00:05:00Z", 9.8, 9.9, 9.7, 9.85),
        ])
        config = paper_trader.BacktestConfig(
            fast_window=1,
            slow_window=3,
            initial_balance=1000.0,
            risk_per_trade=0.01,
            stop_loss_percent=0.01,
            take_profit_percent=0.5,
        )

        result = paper_trader.backtest(bars, config)

        self.assertEqual(len(result.trades), 1)
        trade = result.trades[0]
        self.assertEqual(trade.exit_timestamp, "2026-01-01T00:05:00Z")
        self.assertEqual(trade.exit_price, 9.8)
        self.assertEqual(trade.exit_reason, "stop_loss")
        self.assertAlmostEqual(result.final_balance, 970.297029703)

    def test_position_size_never_exceeds_account_notional(self):
        config = paper_trader.BacktestConfig(
            fast_window=1,
            slow_window=3,
            initial_balance=1000.0,
            risk_per_trade=0.02,
            stop_loss_percent=0.001,
            take_profit_percent=0.1,
        )
        result = paper_trader.backtest(self.bars, config)

        trade = result.trades[0]
        self.assertLessEqual(
            trade.quantity_ounces * trade.entry_price,
            config.initial_balance,
        )
        self.assertAlmostEqual(trade.quantity_ounces * trade.entry_price, 1000.0)

    def test_rejects_risk_budget_above_two_percent(self):
        config = paper_trader.BacktestConfig(
            fast_window=1,
            slow_window=3,
            risk_per_trade=0.0201,
        )

        with self.assertRaisesRegex(ValueError, "risk_per_trade"):
            paper_trader.backtest(self.bars, config)

    def test_csv_requires_valid_ordered_bars(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "bars.csv"
            with path.open("w", newline="", encoding="utf-8") as file:
                writer = csv.writer(file)
                writer.writerow(["timestamp", "open", "high", "low", "close"])
                writer.writerow(["2026-01-02T00:00:00Z", 10, 11, 9, 10])
                writer.writerow(["2026-01-01T00:00:00Z", 10, 11, 9, 10])

            with self.assertRaisesRegex(ValueError, "chronological"):
                paper_trader.load_bars(path)

    def test_live_mode_is_not_a_supported_cli_option(self):
        result = subprocess.run(
            [
                sys.executable,
                str(EXAMPLE_DIR / "paper_trader.py"),
                "--csv",
                str(EXAMPLE_DIR / "sample-xauusd.csv"),
                "--mode",
                "live",
            ],
            capture_output=True,
            text=True,
            check=False,
        )

        self.assertEqual(result.returncode, 2)
        self.assertIn("unrecognized arguments", result.stderr)


if __name__ == "__main__":
    unittest.main()
