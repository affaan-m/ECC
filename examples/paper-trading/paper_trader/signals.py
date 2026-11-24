import math
import statistics
from dataclasses import dataclass

from .models import Candle, MarketSnapshot, RoleEvidence, Side, Signal


@dataclass(frozen=True)
class SignalRole:
    role_id: str
    domain: str
    feature: str
    threshold: float = 0.12


ROLE_CATALOG = (
    SignalRole("momentum-1", "momentum", "return_1"),
    SignalRole("momentum-3", "momentum", "return_3"),
    SignalRole("momentum-5", "momentum", "return_5"),
    SignalRole("normalized-momentum", "momentum", "normalized_momentum"),
    SignalRole("momentum-persistence", "momentum", "momentum_persistence"),
    SignalRole("sma-trend-5", "trend", "sma_gap_5"),
    SignalRole("sma-trend-10", "trend", "sma_gap_10"),
    SignalRole("ema-trend-5", "trend", "ema_gap_5"),
    SignalRole("ema-trend-10", "trend", "ema_gap_10"),
    SignalRole("higher-highs", "trend", "higher_highs"),
    SignalRole("rsi-reversion", "mean-reversion", "rsi_reversion"),
    SignalRole("bollinger-reversion", "mean-reversion", "bollinger_reversion"),
    SignalRole("stochastic-reversion", "mean-reversion", "stochastic_reversion"),
    SignalRole("zscore-reversion", "mean-reversion", "zscore_reversion"),
    SignalRole("range-breakout-5", "breakout", "range_breakout_5"),
    SignalRole("range-breakout-10", "breakout", "range_breakout_10"),
    SignalRole("close-location", "breakout", "close_location"),
    SignalRole("volatility-expansion", "breakout", "volatility_expansion"),
    SignalRole("volume-confirmation", "volume", "volume_confirmation"),
    SignalRole("obv-momentum", "volume", "obv_momentum"),
    SignalRole("volume-trend", "volume", "volume_trend"),
    SignalRole("atr-adjusted-momentum", "volatility", "atr_adjusted_momentum"),
    SignalRole("range-efficiency", "volatility", "range_efficiency_momentum"),
    SignalRole("volatility-regime", "volatility", "volatility_regime_momentum"),
    SignalRole("spread-adjusted-momentum", "microstructure", "spread_adjusted_momentum"),
    SignalRole("quote-momentum", "microstructure", "quote_momentum"),
    SignalRole("intrabar-flow", "microstructure", "intrabar_flow"),
)

ROLE_IDS = frozenset(role.role_id for role in ROLE_CATALOG)


def _bounded(value):
    return max(-1.0, min(1.0, value))


def _scaled(value, factor):
    return math.tanh(value * factor)


def _mean(values):
    return statistics.fmean(values)


def _features(candles, quote):
    closes = [candle.close for candle in candles]
    highs = [candle.high for candle in candles]
    lows = [candle.low for candle in candles]
    volumes = [candle.volume for candle in candles]
    changes = [
        (closes[index] - closes[index - 1]) / closes[index - 1]
        for index in range(1, len(closes))
    ]
    latest = candles[-1]
    return_1 = changes[-1]
    return_3 = closes[-1] / closes[-4] - 1
    return_5 = closes[-1] / closes[-6] - 1
    recent = closes[-20:]
    recent_mean = _mean(recent)
    recent_std = statistics.pstdev(recent) or 1e-12

    gains = [max(change, 0) for change in changes[-14:]]
    losses = [max(-change, 0) for change in changes[-14:]]
    gain_mean = _mean(gains)
    loss_mean = _mean(losses)
    rsi = 100 if loss_mean == 0 and gain_mean else (
        0 if gain_mean == 0 else 100 - 100 / (1 + gain_mean / loss_mean)
    )

    def range_breakout(window):
        upper = max(highs[-window - 1:-1])
        lower = min(lows[-window - 1:-1])
        return 1.0 if latest.close > upper else -1.0 if latest.close < lower else 0.0

    ranges = [
        (candle.high - candle.low) / candle.close for candle in candles[-16:]
    ]
    average_range = _mean(ranges[:-1]) or 1e-12
    price_range = max(latest.high - latest.low, 1e-12)
    volume_ratio = _mean(volumes[-4:]) / (_mean(volumes[-8:-4]) or 1e-12)
    signed_volumes = [
        (1 if changes[index] > 0 else -1 if changes[index] < 0 else 0)
        * volumes[index + 1]
        for index in range(len(changes) - 10, len(changes))
    ]
    return {
        "return_1": _scaled(return_1, 1200),
        "return_3": _scaled(return_3, 500),
        "return_5": _scaled(return_5, 350),
        "normalized_momentum": _scaled(
            return_5 / (statistics.pstdev(changes[-10:]) or 1e-9), 0.08
        ),
        "momentum_persistence": _mean(
            1 if change > 0 else -1 if change < 0 else 0 for change in changes[-8:]
        ),
        "sma_gap_5": _scaled(closes[-1] / _mean(closes[-5:]) - 1, 500),
        "sma_gap_10": _scaled(closes[-1] / _mean(closes[-10:]) - 1, 350),
        "ema_gap_5": _scaled(closes[-1] / _mean(closes[-5:]) - 1, 500),
        "ema_gap_10": _scaled(closes[-1] / _mean(closes[-10:]) - 1, 350),
        "higher_highs": (
            1.0 if highs[-1] > highs[-2] and lows[-1] > lows[-2]
            else -1.0 if highs[-1] < highs[-2] and lows[-1] < lows[-2]
            else 0.0
        ),
        "rsi_reversion": _bounded((50 - rsi) / 50),
        "bollinger_reversion": _bounded((recent_mean - closes[-1]) / (2 * recent_std)),
        "stochastic_reversion": _bounded(
            (50 - 100 * (closes[-1] - min(lows[-14:])) /
             max(max(highs[-14:]) - min(lows[-14:]), 1e-12)) / 50
        ),
        "zscore_reversion": _bounded((recent_mean - closes[-1]) / (2 * recent_std)),
        "range_breakout_5": range_breakout(5),
        "range_breakout_10": range_breakout(10),
        "close_location": _bounded((2 * latest.close - latest.high - latest.low) / price_range),
        "volatility_expansion": _bounded(
            _scaled(ranges[-1] / average_range - 1, 2) * (1 if return_1 > 0 else -1)
        ),
        "volume_confirmation": _bounded(
            (1 if return_3 > 0 else -1 if return_3 < 0 else 0)
            * _scaled(volume_ratio - 1, 2)
        ),
        "obv_momentum": _bounded(sum(signed_volumes) / (sum(volumes[-10:]) or 1e-12)),
        "volume_trend": _bounded(
            (1 if return_3 > 0 else -1 if return_3 < 0 else 0)
            * _scaled(_mean(volumes[-3:]) / (_mean(volumes[-6:-3]) or 1e-12) - 1, 2)
        ),
        "atr_adjusted_momentum": _scaled(return_1 / average_range, 2),
        "range_efficiency_momentum": _bounded(
            (closes[-1] - closes[-9]) /
            (sum(abs(change) for change in changes[-8:]) * closes[-9] + 1e-12)
        ),
        "volatility_regime_momentum": _bounded(
            _scaled(average_range / (_mean(ranges[-13:-1]) or 1e-12) - 1, 2)
            * (1 if return_3 > 0 else -1 if return_3 < 0 else 0)
        ),
        "spread_adjusted_momentum": _bounded(
            _scaled(return_1, 1200)
            * max(0, 1 - ((quote.ask - quote.bid) / quote.bid) * 5_000)
        ),
        "quote_momentum": _scaled(
            ((quote.bid + quote.ask) / 2) / closes[-1] - 1, 1_000
        ),
        "intrabar_flow": _bounded(
            (latest.close - latest.open) / price_range
        ),
    }


def aggregate_signals(symbol, evidence, min_domains=2, min_confidence=0.2):
    if min_domains < 1:
        raise ValueError("min_domains must be at least one")
    if not 0 <= min_confidence <= 1:
        raise ValueError("min_confidence must be between zero and one")
    if len({item.role_id for item in evidence}) != len(evidence):
        raise ValueError("Each signal role may contribute only once")

    domain_scores = {}
    for item in evidence:
        domain_scores.setdefault(item.domain, []).append(
            item.direction * item.confidence
        )
    independent_scores = [
        _mean(scores)
        for scores in domain_scores.values()
        if any(score != 0 for score in scores)
    ]
    if len(independent_scores) < min_domains:
        return Signal(symbol, Side.HOLD, 0.0, tuple(evidence))

    score = _mean(independent_scores)
    confidence = abs(score)
    if confidence < min_confidence:
        side = Side.HOLD
    else:
        side = Side.BUY if score > 0 else Side.SELL
    return Signal(symbol, side, confidence, tuple(evidence))


class Scanner:
    def __init__(self, enabled_roles=()):
        requested = set(enabled_roles) if enabled_roles else ROLE_IDS
        unknown = requested - ROLE_IDS
        if unknown:
            raise ValueError(f"Unknown scanner roles: {', '.join(sorted(unknown))}")
        self._roles = tuple(role for role in ROLE_CATALOG if role.role_id in requested)

    def scan(self, snapshot: MarketSnapshot):
        signals = []
        quotes = {quote.symbol: quote for quote in snapshot.quotes}
        for symbol, candles in snapshot.candles.items():
            features = _features(candles, quotes[symbol])
            evidence = []
            for role in self._roles:
                value = features[role.feature]
                direction = 1 if value >= role.threshold else (
                    -1 if value <= -role.threshold else 0
                )
                confidence = min(1.0, 0.5 + abs(value) / 2) if direction else 0.0
                evidence.append(
                    RoleEvidence(
                        role.role_id,
                        role.domain,
                        direction,
                        confidence,
                        f"{role.feature}={value:.3f}",
                    )
                )
            signals.append(aggregate_signals(symbol, evidence))
        return tuple(signals)
