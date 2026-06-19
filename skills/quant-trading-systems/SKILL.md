---
name: quant-trading-systems
description: Rigorous methodology for designing, backtesting, risk-managing, and operating quantitative and algorithmic trading systems. Activate for strategy development, backtest validation, position sizing, drawdown control, and avoiding lookahead/overfitting/survivorship bias. Vendor-neutral and broker-agnostic.
origin: ECC
---

# Quantitative Trading Systems

Discipline for turning a trading idea into a system you can trust with real
capital. The hard part of quant trading is not the strategy — it is proving the
strategy is real and not an artifact of the backtest, then sizing it so a losing
streak cannot ruin the account. This skill encodes the methodology that survives
contact with live markets: data integrity, honest backtesting, explicit risk
limits, and a strategy lifecycle with gates between research and capital.

## When to Activate

Use this skill when the user is:

- Designing or backtesting a trading strategy (equities, futures, FX, crypto, options).
- Asking about position sizing, stop placement, or risk-per-trade.
- Reporting backtest results that look "too good" (high Sharpe, smooth equity curve).
- Optimizing strategy parameters or selecting indicators.
- Building an execution loop, signal pipeline, or paper/live trading harness.
- Reviewing trade logs, drawdown, or performance attribution.
- Mentioning ATR, Sharpe, walk-forward, slippage, lookahead, overfitting, or risk of ruin.

Do **not** use it to give personalized financial advice or to predict prices.
It governs *engineering and statistical rigor*, not market calls.

## Core Concepts

### 1. The strategy lifecycle (gates, not a straight line)

```
idea → hypothesis → in-sample backtest → out-of-sample / walk-forward
     → cost & capacity check → paper trade → small live → scaled live → monitor
```

Each arrow is a **gate**: a result that fails the next test goes back, it does not
advance. Most ideas should die before paper trading. Treat that as the system
working, not failing.

### 2. Data integrity — the source of most fake edges

- **No lookahead bias.** A decision at bar *t* may only use information available
  at the *close of t* (or earlier). Acting on the same bar's close is leakage.
- **No survivorship bias.** Backtest on the universe as it existed historically
  (including delisted/bankrupt names), not today's survivors.
- **Point-in-time data.** Fundamentals, index membership, and restated figures must
  reflect what was known then, not the latest revision.
- **Corporate actions.** Use adjusted prices for splits/dividends, but know which
  series your signals and your fills each require.

### 3. Risk management is the strategy

Edge decides *whether* you make money over time; risk sizing decides *whether you
survive long enough to realize it*. Define, before any live capital:

- **Risk per trade** as a fixed fraction of equity (commonly 0.25%–1%).
- **Max portfolio heat** (sum of open risk) and **max drawdown** kill-switch.
- **Position sizing** derived from the stop distance, not a fixed lot/share count.

### 4. Backtest honesty

A backtest is a hypothesis test, not a sales pitch. It must include realistic
**transaction costs, slippage, and borrow/financing**, and must reserve unseen data.
The number that matters is out-of-sample performance, net of costs.

### 5. Metrics that matter

- **Expectancy** = avg win × win-rate − avg loss × loss-rate (per trade, net of costs).
- **Sharpe / Sortino** — risk-adjusted return; Sortino penalizes only downside.
- **Max drawdown & time-to-recover** — what you must emotionally and financially survive.
- **Profit factor** = gross profit / gross loss.
- Report **distributions**, not just averages — a single fat tail can dominate.

## Code Examples

### Stop-based position sizing (ATR or fixed)

Size from the dollar risk and the per-unit risk, never from a fixed quantity.

```python
def position_size(account_equity, risk_fraction, entry, stop, point_value=1.0):
    """Units to trade so that hitting `stop` loses exactly risk_fraction of equity.

    risk_fraction: e.g. 0.01 for 1% of equity at risk
    point_value:   account-currency value of a 1.0 move in price (contract multiplier)
    """
    if risk_fraction <= 0 or risk_fraction > 0.1:
        raise ValueError("risk_fraction should be a small positive fraction (e.g. 0.01)")
    risk_capital = account_equity * risk_fraction
    risk_per_unit = abs(entry - stop) * point_value
    if risk_per_unit <= 0:
        raise ValueError("stop must differ from entry")
    return risk_capital / risk_per_unit


def atr_stop(entry, atr, atr_multiple=2.0, direction="long"):
    """Volatility-scaled stop: wider in volatile regimes, tighter in calm ones."""
    if direction == "long":
        return entry - atr_multiple * atr
    return entry + atr_multiple * atr
```

Volatility-scaled stops keep dollar risk roughly constant across regimes: when ATR
rises the stop widens and the position shrinks automatically.

### Avoiding lookahead in a vectorized backtest

```python
import pandas as pd

# df has columns: close, sma. Signal: long when close > sma.
signal = (df["close"] > df["sma"]).astype(int)
df["ret"] = df["close"].pct_change()

# WRONG — signal at t multiplies return at t. The close[t] that formed the
# signal is the same close[t] inside ret[t]: you "knew" the bar before trading it.
df["strat_wrong"] = signal * df["ret"]

# RIGHT — you can only act on the *next* bar after the signal forms.
df["position"] = signal.shift(1).fillna(0)
df["strat"] = df["position"] * df["ret"]
```

The single most common backtest bug. If removing the `.shift(1)` barely changes
your results, you probably have leakage somewhere else too.

### Walk-forward splits (out-of-sample by construction)

```python
def walk_forward_splits(n, train_size, test_size, step=None):
    """Yield (train_slice, test_slice) where test always follows train in time."""
    step = step or test_size
    i = 0
    while i + train_size + test_size <= n:
        yield slice(i, i + train_size), slice(i + train_size, i + train_size + test_size)
        i += step
```

Fit/select parameters on `train`, evaluate only on the untouched `test`, roll
forward, and concatenate the test segments into one honest equity curve. Never
tune on the test segment.

### Core performance metrics

```python
import numpy as np

def sharpe(returns, periods_per_year=252, rf=0.0):
    excess = np.asarray(returns) - rf / periods_per_year
    sd = excess.std(ddof=1)
    return 0.0 if sd == 0 else np.sqrt(periods_per_year) * excess.mean() / sd

def max_drawdown(equity_curve):
    eq = np.asarray(equity_curve, dtype=float)
    peak = np.maximum.accumulate(eq)
    return ((eq - peak) / peak).min()   # most-negative value

def expectancy(wins, losses):
    """wins/losses: arrays of positive win sizes and positive loss sizes."""
    n = len(wins) + len(losses)
    if n == 0:
        return 0.0
    p_win = len(wins) / n
    avg_win = np.mean(wins) if len(wins) else 0.0
    avg_loss = np.mean(losses) if len(losses) else 0.0
    return p_win * avg_win - (1 - p_win) * avg_loss
```

### Model transaction costs explicitly

```python
def net_return(gross_return, turnover, cost_per_turn):
    """cost_per_turn = commission + spread/slippage as a fraction of notional."""
    return gross_return - turnover * cost_per_turn
```

A strategy that is profitable before costs and unprofitable after costs is not a
strategy. Test cost sensitivity: if a 1–2× increase in assumed slippage kills the
edge, the edge is too thin to trade.

## Anti-Patterns

- **Lookahead / leakage** — using bar *t*'s close (or any future data) to decide a
  bar-*t* action. Includes peeking at future highs/lows, restated fundamentals, or
  using the full series' mean/std to normalize.
- **Overfitting / curve-fitting** — adding parameters or rules until the backtest is
  beautiful. More knobs ⇒ more ways to fit noise. Prefer few, economically motivated
  parameters and a flat performance surface around them.
- **p-hacking the universe** — testing hundreds of variants and reporting the winner
  without correcting for multiple comparisons. The best of 500 random strategies
  looks great by luck.
- **Ignoring costs and capacity** — zero-slippage backtests, or sizing beyond the
  liquidity the strategy could actually fill.
- **Survivorship bias** — backtesting only on instruments that still exist today.
- **No out-of-sample** — tuning and reporting on the same data.
- **Risk of ruin ignored** — fixed lot sizes, no max-drawdown stop, position sizes
  that let one bad streak end the account. Surviving variance > maximizing the mean.
- **Equity-curve worship** — judging on a single smooth-looking curve instead of the
  return distribution, drawdown depth/duration, and behavior across regimes.

## Best Practices

- State the **hypothesis and the economic rationale** before backtesting — why should
  this edge exist, and who is on the other side?
- Reserve **out-of-sample data** before you start and do not look at it until the end.
- Bake in **realistic costs and slippage**, and run a **cost-sensitivity** sweep.
- Size every position from a **fixed-fractional risk budget** and a defined stop;
  enforce a **max drawdown kill-switch**.
- Prefer **walk-forward / rolling** validation over a single train/test split.
- Keep the parameter count low and check the **neighborhood** of chosen parameters —
  a robust edge survives small parameter changes.
- **Paper trade then trade small** before scaling; live slippage and psychology are
  not in the backtest.
- **Log every trade** with entry/exit reason, size, intended vs. realized fill, and
  reconcile live results against the backtest's expectations.
- Treat **most ideas dying** as the process working.

## Related Skills

`ito-trade-planner`, `prediction-market-risk-review`, `ml-adoption-playbook`,
`security-review` (for credential/key handling in execution bots), `python-patterns`.
