import math
from datetime import datetime, timedelta, timezone
from typing import Protocol

from .models import Candle, MarketSnapshot, Quote, SUPPORTED_SYMBOLS


class MarketDataProvider(Protocol):
    def get_snapshot(self) -> MarketSnapshot:
        """Return validated quotes and candles for the supported symbols."""


class MockMarketDataProvider:
    """Deterministic synthetic data; this provider never makes network calls."""

    def get_snapshot(self):
        now = datetime.now(timezone.utc)
        quotes = (
            Quote("XAUUSD", 2_650.00, 2_650.50, now.isoformat()),
            Quote("XAGUSD", 31.00, 31.03, now.isoformat()),
        )
        candles = {
            quote.symbol: self._candles(
                quote.symbol, quote.bid, now
            )
            for quote in quotes
        }
        return MarketSnapshot(quotes, candles, now.isoformat())

    @staticmethod
    def _candles(symbol, base, now):
        step = 0.025 if symbol == "XAUUSD" else 0.004
        points = []
        for index in range(32):
            wave = math.sin(index / 2.5) * step * 2
            close = base - step * (31 - index) + wave
            open_price = close - step * math.cos(index)
            high = max(open_price, close) + step
            low = min(open_price, close) - step
            points.append(
                Candle(
                    (now - timedelta(minutes=5 * (31 - index))).isoformat(),
                    open_price,
                    high,
                    low,
                    close,
                    100 + (index % 7) * 5,
                )
            )
        return tuple(points)


class TradingViewMarketDataProvider:
    """Reserved integration point; no scraping or unofficial endpoints."""

    def get_snapshot(self):
        raise NotImplementedError(
            "No TradingView market-data API is bundled. Add only an authorized "
            "official integration with its licensing and data terms reviewed."
        )


class FutureBrokerMarketDataProvider:
    """Reserved market-data interface for a separately reviewed provider."""

    def get_snapshot(self):
        raise NotImplementedError(
            "Broker market-data integrations are not enabled in this paper-only MVP."
        )


def validate_snapshot(snapshot):
    if not isinstance(snapshot, MarketSnapshot):
        raise TypeError("Market-data provider returned an invalid snapshot")
    symbols = {quote.symbol for quote in snapshot.quotes}
    if symbols != set(SUPPORTED_SYMBOLS):
        raise ValueError("Provider must supply both supported symbols")
    return snapshot
