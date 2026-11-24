import csv
import importlib.util
import subprocess
import sys
from pathlib import Path

import pytest


REPO_ROOT = Path(__file__).resolve().parents[2]
EXAMPLE_DIR = REPO_ROOT / "examples" / "xauusd-paper-trader"
SPEC = importlib.util.spec_from_file_location(
    "paper_trader", EXAMPLE_DIR / "paper_trader.py"
)
paper_trader = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = paper_trader
SPEC.loader.exec_module(paper_trader)

pytestmark = pytest.mark.unit


def bars_from_rows(rows):
    return [
        paper_trader.Bar(timestamp, open_price, high, low, close)
        for timestamp, open_price, high, low, close in rows
    ]


@pytest.fixture
def bars():
    return bars_from_rows([
        ("2026-01-01T00:00:00Z", 10.0, 10.1, 9.9, 10.0),
        ("2026-01-01T00:01:00Z", 9.0, 9.1, 8.9, 9.0),
        ("2026-01-01T00:02:00Z", 8.0, 8.1, 7.9, 8.0),
        ("2026-01-01T00:03:00Z", 9.5, 9.6, 9.4, 9.5),
        ("2026-01-01T00:04:00Z", 10.0, 10.1, 10.0, 10.1),
        ("2026-01-01T00:05:00Z", 10.5, 10.9, 10.4, 10.8),
    ])


@pytest.fixture
def config():
    return paper_trader.BacktestConfig(
        fast_window=1,
        slow_window=3,
        initial_balance=1000.0,
        risk_per_trade=0.01,
        stop_loss_percent=0.01,
        take_profit_percent=0.02,
    )


def test_enters_on_next_bar_open_and_closes_at_end_of_data(bars):
    settings = paper_trader.BacktestConfig(
        fast_window=1,
        slow_window=3,
        initial_balance=1000.0,
        risk_per_trade=0.01,
        stop_loss_percent=0.01,
        take_profit_percent=0.1,
    )

    result = paper_trader.backtest(bars, settings)

    assert len(result.trades) == 1
    trade = result.trades[0]
    assert trade.entry_timestamp == "2026-01-01T00:04:00Z"
    assert trade.entry_price == 10.0
    assert trade.exit_reason == "end_of_data"
    assert trade.exit_price == 10.8
    assert result.final_balance == pytest.approx(1080.0)


def test_stop_loss_wins_when_stop_and_target_both_touch_in_one_bar(bars, config):
    changed_bars = list(bars)
    changed_bars[4] = paper_trader.Bar(
        changed_bars[4].timestamp, 10.0, 10.3, 9.8, 10.1
    )

    result = paper_trader.backtest(changed_bars, config)

    trade = result.trades[0]
    assert trade.exit_reason == "stop_loss"
    assert trade.exit_price == 9.9
    assert result.realized_trade_max_drawdown_percent == pytest.approx(1.0)


def test_downward_crossover_exits_at_the_next_bar_open():
    rows = [
        ("2026-01-01T00:00:00Z", 10.0, 10.1, 9.9, 10.0),
        ("2026-01-01T00:01:00Z", 9.0, 9.1, 8.9, 9.0),
        ("2026-01-01T00:02:00Z", 8.0, 8.1, 7.9, 8.0),
        ("2026-01-01T00:03:00Z", 9.5, 9.6, 9.4, 9.5),
        ("2026-01-01T00:04:00Z", 10.1, 10.2, 10.0, 10.1),
        ("2026-01-01T00:05:00Z", 10.1, 10.3, 10.0, 10.2),
        ("2026-01-01T00:06:00Z", 10.0, 10.1, 9.8, 9.9),
        ("2026-01-01T00:07:00Z", 9.7, 9.8, 9.6, 9.75),
    ]
    settings = paper_trader.BacktestConfig(
        fast_window=1,
        slow_window=3,
        initial_balance=1000.0,
        risk_per_trade=0.01,
        stop_loss_percent=0.1,
        take_profit_percent=0.5,
    )

    result = paper_trader.backtest(bars_from_rows(rows), settings)

    assert len(result.trades) == 1
    trade = result.trades[0]
    assert trade.entry_timestamp == "2026-01-01T00:04:00Z"
    assert trade.exit_timestamp == "2026-01-01T00:07:00Z"
    assert trade.exit_price == 9.7
    assert trade.exit_reason == "moving_average_cross"
    assert result.final_balance == pytest.approx(996.0396039604)


def test_equal_moving_averages_do_not_trigger_rolling_sum_exit():
    closes = [0.2, 0.1, 0.2, 0.3, 0.3, 0.31]
    rows = [
        (
            f"2026-01-01T00:0{index}:00Z",
            close,
            close + 0.001,
            close - 0.001,
            close,
        )
        for index, close in enumerate(closes)
    ]
    settings = paper_trader.BacktestConfig(
        fast_window=1,
        slow_window=2,
        stop_loss_percent=0.1,
        take_profit_percent=0.5,
    )

    result = paper_trader.backtest(bars_from_rows(rows), settings)

    assert len(result.trades) == 1
    assert result.trades[0].exit_reason == "end_of_data"


def test_gap_below_stop_exits_at_the_opening_price():
    rows = [
        ("2026-01-01T00:00:00Z", 10.0, 10.1, 9.9, 10.0),
        ("2026-01-01T00:01:00Z", 9.0, 9.1, 8.9, 9.0),
        ("2026-01-01T00:02:00Z", 8.0, 8.1, 7.9, 8.0),
        ("2026-01-01T00:03:00Z", 9.5, 9.6, 9.4, 9.5),
        ("2026-01-01T00:04:00Z", 10.1, 10.2, 10.0, 10.1),
        ("2026-01-01T00:05:00Z", 9.8, 9.9, 9.7, 9.85),
    ]
    settings = paper_trader.BacktestConfig(
        fast_window=1,
        slow_window=3,
        initial_balance=1000.0,
        risk_per_trade=0.01,
        stop_loss_percent=0.01,
        take_profit_percent=0.5,
    )

    result = paper_trader.backtest(bars_from_rows(rows), settings)

    assert len(result.trades) == 1
    trade = result.trades[0]
    assert trade.exit_timestamp == "2026-01-01T00:05:00Z"
    assert trade.exit_price == 9.8
    assert trade.exit_reason == "stop_loss"
    assert result.final_balance == pytest.approx(970.297029703)


def test_rejects_underflowed_stop_distance(bars, config):
    scaled_bars = [
        paper_trader.Bar(
            bar.timestamp,
            bar.open * 0.01,
            bar.high * 0.01,
            bar.low * 0.01,
            bar.close * 0.01,
        )
        for bar in bars
    ]
    settings = paper_trader.BacktestConfig(
        fast_window=config.fast_window,
        slow_window=config.slow_window,
        initial_balance=config.initial_balance,
        risk_per_trade=config.risk_per_trade,
        stop_loss_percent=5e-324,
        take_profit_percent=config.take_profit_percent,
    )

    with pytest.raises(ValueError, match="computed stop distance"):
        paper_trader.backtest(scaled_bars, settings)


def test_position_size_never_exceeds_account_notional(bars):
    settings = paper_trader.BacktestConfig(
        fast_window=1,
        slow_window=3,
        initial_balance=1000.0,
        risk_per_trade=0.02,
        stop_loss_percent=0.001,
        take_profit_percent=0.1,
    )

    result = paper_trader.backtest(bars, settings)

    trade = result.trades[0]
    assert trade.quantity_ounces * trade.entry_price <= settings.initial_balance
    assert trade.quantity_ounces * trade.entry_price == pytest.approx(1000.0)


def test_rejects_risk_budget_above_two_percent(bars):
    settings = paper_trader.BacktestConfig(
        fast_window=1,
        slow_window=3,
        risk_per_trade=0.0201,
    )

    with pytest.raises(ValueError, match="risk_per_trade"):
        paper_trader.backtest(bars, settings)


def test_csv_requires_valid_ordered_bars(tmp_path):
    path = tmp_path / "bars.csv"
    with path.open("w", newline="", encoding="utf-8") as file:
        writer = csv.writer(file)
        writer.writerow(["timestamp", "open", "high", "low", "close"])
        writer.writerow(["2026-01-02T00:00:00Z", 10, 11, 9, 10])
        writer.writerow(["2026-01-01T00:00:00Z", 10, 11, 9, 10])

    with pytest.raises(ValueError, match="chronological"):
        paper_trader.load_bars(path)


def test_live_mode_is_not_a_supported_cli_option():
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

    assert result.returncode == 2
    assert "unrecognized arguments" in result.stderr


def test_cli_rejects_non_finite_report_values():
    result = subprocess.run(
        [
            sys.executable,
            str(EXAMPLE_DIR / "paper_trader.py"),
            "--csv",
            str(EXAMPLE_DIR / "sample-xauusd.csv"),
            "--fast-window",
            "1",
            "--slow-window",
            "3",
            "--initial-balance",
            "1.79e308",
        ],
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 2
    assert not result.stdout
    assert "not JSON compliant" in result.stderr
