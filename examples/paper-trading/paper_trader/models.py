import math
from dataclasses import dataclass
from enum import Enum
from types import MappingProxyType
from typing import Tuple


SUPPORTED_SYMBOLS = ("XAUUSD", "XAGUSD")


class Side(str, Enum):
    BUY = "buy"
    SELL = "sell"
    HOLD = "hold"

    @property
    def opposite(self):
        if self is Side.BUY:
            return Side.SELL
        if self is Side.SELL:
            return Side.BUY
        return Side.HOLD


@dataclass(frozen=True)
class Candle:
    timestamp: str
    open: float
    high: float
    low: float
    close: float
    volume: float

    def __post_init__(self):
        values = (self.open, self.high, self.low, self.close, self.volume)
        if any(not math.isfinite(value) or value <= 0 for value in values):
            raise ValueError("Candle values must be finite and positive")
        if self.high < max(self.open, self.close, self.low):
            raise ValueError("Candle high is inconsistent")
        if self.low > min(self.open, self.close, self.high):
            raise ValueError("Candle low is inconsistent")


@dataclass(frozen=True)
class Quote:
    symbol: str
    bid: float
    ask: float
    timestamp: str = ""

    def __post_init__(self):
        if self.symbol not in SUPPORTED_SYMBOLS:
            raise ValueError("Only XAUUSD and XAGUSD are supported")
        if (
            not math.isfinite(self.bid)
            or not math.isfinite(self.ask)
            or self.bid <= 0
            or self.ask < self.bid
        ):
            raise ValueError("Quote must have finite positive bid and ask >= bid")


@dataclass(frozen=True)
class MarketSnapshot:
    quotes: Tuple[Quote, ...]
    candles: dict
    timestamp: str

    def __post_init__(self):
        quotes = tuple(self.quotes)
        candles = {
            symbol: tuple(series) for symbol, series in self.candles.items()
        }
        quote_symbols = {quote.symbol for quote in quotes}
        if not quote_symbols or not quote_symbols.issubset(SUPPORTED_SYMBOLS):
            raise ValueError("Snapshot must contain supported symbol quotes")
        if set(candles) != quote_symbols:
            raise ValueError("Snapshot candles must match quote symbols")
        if any(len(series) < 20 for series in candles.values()):
            raise ValueError("At least 20 candles are required per symbol")
        object.__setattr__(self, "quotes", quotes)
        object.__setattr__(self, "candles", MappingProxyType(candles))


@dataclass(frozen=True)
class RoleEvidence:
    role_id: str
    domain: str
    direction: int
    confidence: float
    rationale: str

    def __post_init__(self):
        if self.direction not in (-1, 0, 1):
            raise ValueError("Evidence direction must be -1, 0, or 1")
        if not 0 <= self.confidence <= 1:
            raise ValueError("Evidence confidence must be between 0 and 1")
        if not self.role_id or not self.domain or not self.rationale:
            raise ValueError("Evidence fields must not be empty")


@dataclass(frozen=True)
class Signal:
    symbol: str
    side: Side
    confidence: float
    evidence: Tuple[RoleEvidence, ...]

    def __post_init__(self):
        if self.symbol not in SUPPORTED_SYMBOLS:
            raise ValueError("Only XAUUSD and XAGUSD are supported")
        if not isinstance(self.side, Side):
            raise ValueError("Signal side must be a Side value")
        if not math.isfinite(self.confidence) or not 0 <= self.confidence <= 1:
            raise ValueError("Signal confidence must be finite and between 0 and 1")
        object.__setattr__(self, "evidence", tuple(self.evidence))
