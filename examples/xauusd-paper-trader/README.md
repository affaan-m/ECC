# XAUUSD paper-trading example

This is a deterministic moving-average crossover **simulation** using local
OHLC CSV data. It is not an AI price-prediction model, not financial advice,
and does not promise or imply profitability.

## Safety and scope

- Paper/backtest only: there is no broker integration, account login, network
  market-data request, credential handling, or live order-placement code.
- The program only reads the CSV path you provide and prints a JSON report.
  `--mode live` is intentionally unsupported.
- The strategy is long-only, caps each position at 1x simulated account equity,
  and rejects a per-trade risk budget over 2%.
- Risk controls are not guarantees. Gaps can produce losses larger than the
  configured stop; this simulation does not model spread, commissions,
  slippage, financing, or broker-specific XAUUSD contract sizes.

## Run

Requires Python 3.9+ and no third-party packages. The included CSV is synthetic
and only demonstrates the input format:

```sh
python3 examples/xauusd-paper-trader/paper_trader.py \
  --csv examples/xauusd-paper-trader/sample-xauusd.csv \
  --fast-window 1 \
  --slow-window 3
```

For your own data, provide a local CSV with `timestamp,open,high,low,close`
columns. Prices are interpreted as USD per troy ounce. Timestamps must be
strictly increasing ISO 8601 values and use a consistent timezone convention.
No market data is downloaded.

Options:

| Option | Default | Meaning |
| --- | ---: | --- |
| `--fast-window` | `5` | Fast simple-moving-average period |
| `--slow-window` | `20` | Slow simple-moving-average period; must exceed the fast period |
| `--initial-balance` | `10000` | Starting simulated USD balance |
| `--risk-per-trade` | `0.01` | Risk budget as a balance fraction, capped at `0.02` |
| `--stop-loss-percent` | `0.01` | Stop distance from entry as a fraction |
| `--take-profit-percent` | `0.02` | Target distance from entry as a fraction |

Signals are evaluated at bar close and entered or exited at the next bar open.
The position size is the smaller of the configured risk budget divided by the
stop distance and the size permitted by the 1x account-equity cap. If a bar
touches both the stop and target, the simulator conservatively assumes the stop
was hit first. Any remaining open position is closed at the final bar's close.
The reported drawdown uses realized closed-trade balances only; it excludes
unrealized intrabar and open-position drawdown.

## Tests

```sh
python3 -m unittest discover -s tests/examples -p 'test_xauusd_paper_trader.py'
```
