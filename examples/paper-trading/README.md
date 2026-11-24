# XAUUSD/XAGUSD paper-trading MVP

This standalone Python example scans **synthetic mock data only** and writes simulated fills to a local journal. It does not connect to a broker, TradingView, or the internet; it has no credential fields or live-order path. Signals are research/demo output, not financial advice, and do not imply profitable outcomes.

## Requirements and run

Python 3.9 or newer; no third-party packages are required.

```sh
cd examples/paper-trading
python3 -m unittest discover -s tests -v
python3 -m paper_trader --once
python3 -m paper_trader --serve
```

`--once` prints one scan and paper-execution cycle. `--serve` repeats on the configured interval and exposes scheduler health at `http://127.0.0.1:8765/health` (local machine only). Stop it with Ctrl-C.

The SQLite database defaults to `paper-trader.sqlite3` in the current directory. Set `PAPER_TRADER_DB` or use `--db /path/to/journal.sqlite3` to choose another local path. Set `PAPER_TRADER_CONFIG` or pass `--config config.example.json` to load settings. An existing file passed with `--kill-switch-file` (or `PAPER_TRADER_KILL_SWITCH_FILE`) blocks new entries; remove that marker to release it. Closing an open paper position remains allowed while the switch is engaged.

## Scanner and journal

The scanner runs 27 configurable role rules in-process across momentum, trend, mean-reversion, breakout, volume, volatility, and microstructure domains. It first averages evidence within each domain, then gives independent domains equal weight, so many correlated roles cannot outvote independent evidence by count alone. It emits `hold` unless enough independent domains agree above the confidence threshold. These deterministic rules are illustrative, not validated trading strategies.

`MarketDataProvider` is the input boundary. `MockMarketDataProvider` supplies deterministic synthetic candles and quotes. `TradingViewMarketDataProvider` and `FutureBrokerMarketDataProvider` are intentionally unimplemented hooks: do not scrape TradingView or add a provider without confirming its official API, licensing, data rights, and privacy implications. No broker execution adapter is included.

`SQLiteTradeJournal` is the runnable backend. Its schema uses SQL types supported by SQLite and PostgreSQL; `PostgresTradeJournal` accepts an already-created DB-API connection with `%s` placeholders for an integration that supplies its own reviewed connection setup. PostgreSQL transactions set `READ COMMITTED` before taking the mutex so concurrent entry checks see committed positions after waiting. The included CLI always selects SQLite.

## Paper-only controls

- Per-order quantity, per-position notional, aggregate notional, daily loss, and concurrent-position caps are checked before entries.
- Entry reads, risk checks, and journal writes are serialized by the database across concurrent runners.
- Daily loss includes realized P&L for the current UTC day and marked P&L for open positions using current quotes. Entries fail closed when any open position lacks a mark quote.
- Only one open position per symbol is allowed, preventing averaging down and hedging.
- The kill switch blocks all new entries; it does not prevent closing a paper position.
- Buys fill at the quote ask and sells at the bid. Closing uses the corresponding opposite quote side. Fees, slippage, liquidity, and market impact are not modeled.
- The scheduler retries failed cycles with bounded, shutdown-interruptible exponential backoff, logs final failures locally, and exposes run, success, failure, retry, and last-error-type metrics.

## Configuration

`config.example.json` documents supported, non-secret settings. Unknown keys are rejected. The mock provider is fixed in the CLI; the config cannot select a live data or execution provider.
