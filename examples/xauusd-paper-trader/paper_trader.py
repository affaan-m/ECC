#!/usr/bin/env python3
"""Deterministic, local-data-only XAUUSD paper-trading simulator."""

import argparse
import csv
import json
import math
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Sequence, Tuple


@dataclass(frozen=True)
class Bar:
    timestamp: str
    open: float
    high: float
    low: float
    close: float


@dataclass(frozen=True)
class BacktestConfig:
    fast_window: int = 5
    slow_window: int = 20
    initial_balance: float = 10000.0
    risk_per_trade: float = 0.01
    stop_loss_percent: float = 0.01
    take_profit_percent: float = 0.02


@dataclass(frozen=True)
class Trade:
    entry_timestamp: str
    exit_timestamp: str
    entry_price: float
    exit_price: float
    quantity_ounces: float
    pnl_usd: float
    exit_reason: str


@dataclass(frozen=True)
class BacktestResult:
    initial_balance: float
    final_balance: float
    realized_trade_max_drawdown_percent: float
    trades: Tuple[Trade, ...]


@dataclass(frozen=True)
class Position:
    entry_timestamp: str
    entry_price: float
    quantity_ounces: float
    stop_price: float
    target_price: float


def validate_config(config: BacktestConfig) -> None:
    if type(config.fast_window) is not int or config.fast_window < 1:
        raise ValueError("fast_window must be a positive integer")
    if type(config.slow_window) is not int or config.slow_window <= config.fast_window:
        raise ValueError("slow_window must be an integer greater than fast_window")
    numeric = {
        "initial_balance": config.initial_balance,
        "risk_per_trade": config.risk_per_trade,
        "stop_loss_percent": config.stop_loss_percent,
        "take_profit_percent": config.take_profit_percent,
    }
    if any(
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or not math.isfinite(value)
        for value in numeric.values()
    ):
        raise ValueError("configuration values must be finite numbers")
    if config.initial_balance <= 0:
        raise ValueError("initial_balance must be greater than zero")
    if not 0 < config.risk_per_trade <= 0.02:
        raise ValueError("risk_per_trade must be greater than zero and at most 0.02")
    if not 0 < config.stop_loss_percent < 1:
        raise ValueError("stop_loss_percent must be greater than zero and below 1")
    if not 0 < config.take_profit_percent < 1:
        raise ValueError("take_profit_percent must be greater than zero and below 1")


def _parse_timestamp(value: str, line_number: int) -> datetime:
    if not isinstance(value, str) or not value:
        raise ValueError(f"line {line_number}: timestamp must be ISO 8601")
    try:
        normalized = value[:-1] + "+00:00" if value.endswith("Z") else value
        return datetime.fromisoformat(normalized)
    except ValueError as error:
        raise ValueError(f"line {line_number}: timestamp must be ISO 8601") from error


def validate_bars(bars: Sequence[Bar]) -> None:
    if not bars:
        raise ValueError("CSV contains no market bars")
    previous_timestamp = None
    timezone_kind = None
    for index, bar in enumerate(bars, start=2):
        parsed_timestamp = _parse_timestamp(bar.timestamp, index)
        current_timezone_kind = parsed_timestamp.tzinfo is not None
        if timezone_kind is not None and current_timezone_kind != timezone_kind:
            raise ValueError("timestamps must consistently include a timezone or omit it")
        timezone_kind = current_timezone_kind
        if current_timezone_kind:
            parsed_timestamp = parsed_timestamp.astimezone(timezone.utc)
        if previous_timestamp is not None and parsed_timestamp <= previous_timestamp:
            raise ValueError("market bars must be strictly chronological")
        previous_timestamp = parsed_timestamp

        prices = (bar.open, bar.high, bar.low, bar.close)
        if any(
            isinstance(price, bool)
            or not isinstance(price, (int, float))
            or not math.isfinite(price)
            or price <= 0
            for price in prices
        ):
            raise ValueError(f"line {index}: OHLC prices must be finite and positive")
        if bar.high < max(bar.open, bar.close) or bar.low > min(bar.open, bar.close):
            raise ValueError(f"line {index}: high/low do not contain open and close")
        if bar.low > bar.high:
            raise ValueError(f"line {index}: low must not exceed high")


def load_bars(path: Path) -> Tuple[Bar, ...]:
    with Path(path).open("r", newline="", encoding="utf-8-sig") as file:
        reader = csv.DictReader(file)
        headers = [header.strip().lower() for header in (reader.fieldnames or [])]
        if len(headers) != len(set(headers)):
            raise ValueError("CSV column names must be unique")
        required = ("timestamp", "open", "high", "low", "close")
        if any(column not in headers for column in required):
            raise ValueError("CSV must include timestamp, open, high, low, close columns")

        bars = []
        for line_number, row in enumerate(reader, start=2):
            values = {key.strip().lower(): value for key, value in row.items() if key}
            try:
                bar = Bar(
                    timestamp=(values["timestamp"] or "").strip(),
                    open=float(values["open"]),
                    high=float(values["high"]),
                    low=float(values["low"]),
                    close=float(values["close"]),
                )
            except (KeyError, TypeError, ValueError) as error:
                raise ValueError(f"line {line_number}: invalid OHLC row") from error
            bars.append(bar)
    validate_bars(bars)
    return tuple(bars)


def _close_position(
    position: Position, bar: Bar, exit_price: float, reason: str
) -> Trade:
    return Trade(
        entry_timestamp=position.entry_timestamp,
        exit_timestamp=bar.timestamp,
        entry_price=position.entry_price,
        exit_price=exit_price,
        quantity_ounces=position.quantity_ounces,
        pnl_usd=(exit_price - position.entry_price) * position.quantity_ounces,
        exit_reason=reason,
    )


def _create_position(bar: Bar, balance: float, config: BacktestConfig) -> Position:
    risk_budget = balance * config.risk_per_trade
    stop_distance = bar.open * config.stop_loss_percent
    if not math.isfinite(stop_distance) or stop_distance <= 0:
        raise ValueError("computed stop distance must be finite and greater than zero")
    risk_quantity = risk_budget / stop_distance
    quantity = min(risk_quantity, balance / bar.open)
    return Position(
        entry_timestamp=bar.timestamp,
        entry_price=bar.open,
        quantity_ounces=quantity,
        stop_price=bar.open * (1 - config.stop_loss_percent),
        target_price=bar.open * (1 + config.take_profit_percent),
    )


def _fill_pending_action(
    action: Optional[str],
    position: Optional[Position],
    bar: Bar,
    balance: float,
    config: BacktestConfig,
) -> Tuple[Optional[Position], Optional[Trade], float]:
    if action == "exit" and position is not None:
        reason = "moving_average_cross"
        if bar.open <= position.stop_price:
            reason = "stop_loss"
        elif bar.open >= position.target_price:
            reason = "take_profit"
        trade = _close_position(position, bar, bar.open, reason)
        return None, trade, balance + trade.pnl_usd
    if action == "enter" and position is None:
        return _create_position(bar, balance, config), None, balance
    return position, None, balance


def _protective_exit(position: Position, bar: Bar) -> Optional[Tuple[float, str]]:
    if bar.open <= position.stop_price:
        return bar.open, "stop_loss"
    if bar.open >= position.target_price:
        return bar.open, "take_profit"
    if bar.low <= position.stop_price:
        return position.stop_price, "stop_loss"
    if bar.high >= position.target_price:
        return position.target_price, "take_profit"
    return None


def _crossover_signal(
    closes: Sequence[float],
    index: int,
    config: BacktestConfig,
    fast_sum: float,
    slow_sum: float,
) -> Optional[str]:
    if index < config.slow_window:
        return None
    previous_fast = (
        fast_sum - closes[index] + closes[index - config.fast_window]
    ) / config.fast_window
    previous_slow = (
        slow_sum - closes[index] + closes[index - config.slow_window]
    ) / config.slow_window
    current_fast = fast_sum / config.fast_window
    current_slow = slow_sum / config.slow_window
    if previous_fast <= previous_slow and current_fast > current_slow:
        return "enter"
    if previous_fast >= previous_slow and current_fast < current_slow:
        return "exit"
    return None


def backtest(bars: Sequence[Bar], config: BacktestConfig) -> BacktestResult:
    validate_config(config)
    validate_bars(bars)
    if len(bars) <= config.slow_window:
        raise ValueError("CSV must contain at least slow_window + 1 market bars")

    closes = [bar.close for bar in bars]
    trades = []
    position: Optional[Position] = None
    pending_action = None
    balance = config.initial_balance
    fast_sum = 0.0
    slow_sum = 0.0

    for index, bar in enumerate(bars):
        fast_sum += bar.close
        slow_sum += bar.close
        if index >= config.fast_window:
            fast_sum -= closes[index - config.fast_window]
        if index >= config.slow_window:
            slow_sum -= closes[index - config.slow_window]

        position, trade, balance = _fill_pending_action(
            pending_action, position, bar, balance, config
        )
        if trade is not None:
            trades.append(trade)
        pending_action = None

        if position is not None:
            protective_exit = _protective_exit(position, bar)
            if protective_exit is not None:
                exit_price, reason = protective_exit
                trade = _close_position(position, bar, exit_price, reason)
                trades.append(trade)
                balance += trade.pnl_usd
                position = None

        signal = _crossover_signal(closes, index, config, fast_sum, slow_sum)
        if signal == "enter" and position is None:
            pending_action = "enter"
        elif signal == "exit" and position is not None:
            pending_action = "exit"

    if position is not None:
        trade = _close_position(position, bars[-1], bars[-1].close, "end_of_data")
        trades.append(trade)
        balance += trade.pnl_usd

    equity = config.initial_balance
    peak_balance = config.initial_balance
    max_drawdown = 0.0
    for trade in trades:
        equity += trade.pnl_usd
        peak_balance = max(peak_balance, equity)
        max_drawdown = max(max_drawdown, (peak_balance - equity) / peak_balance)

    return BacktestResult(
        initial_balance=config.initial_balance,
        final_balance=balance,
        realized_trade_max_drawdown_percent=max_drawdown * 100,
        trades=tuple(trades),
    )


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Backtest a deterministic XAUUSD strategy with local CSV data only."
    )
    parser.add_argument("--csv", required=True, type=Path, help="Local OHLC CSV file")
    parser.add_argument("--fast-window", type=int, default=5)
    parser.add_argument("--slow-window", type=int, default=20)
    parser.add_argument("--initial-balance", type=float, default=10000.0)
    parser.add_argument("--risk-per-trade", type=float, default=0.01)
    parser.add_argument("--stop-loss-percent", type=float, default=0.01)
    parser.add_argument("--take-profit-percent", type=float, default=0.02)
    return parser


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = _build_parser()
    arguments = parser.parse_args(argv)
    config = BacktestConfig(
        fast_window=arguments.fast_window,
        slow_window=arguments.slow_window,
        initial_balance=arguments.initial_balance,
        risk_per_trade=arguments.risk_per_trade,
        stop_loss_percent=arguments.stop_loss_percent,
        take_profit_percent=arguments.take_profit_percent,
    )
    try:
        result = backtest(load_bars(arguments.csv), config)
        report = {
            "mode": "paper_simulation",
            "instrument": "XAUUSD",
            "initial_balance_usd": result.initial_balance,
            "final_balance_usd": result.final_balance,
            "return_percent": (result.final_balance / result.initial_balance - 1) * 100,
            "realized_trade_max_drawdown_percent": result.realized_trade_max_drawdown_percent,
            "closed_trades": len(result.trades),
            "trades": [asdict(trade) for trade in result.trades],
            "notice": "Simulation only; no broker connection or live orders are supported.",
        }
        output = json.dumps(report, indent=2, allow_nan=False)
    except (OSError, ValueError) as error:
        parser.error(str(error))

    print(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
