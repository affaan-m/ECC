from dataclasses import dataclass

from .journal import _utc_now
from .models import Quote, Side, Signal
from .risk import RiskManager


class MissingMarkQuoteError(ValueError):
    pass


@dataclass(frozen=True)
class PaperFill:
    trade_id: str
    symbol: str
    side: Side
    quantity: float
    fill_price: float
    status: str
    realized_pnl: float = 0.0


class PaperExecutionEngine:
    def __init__(self, journal, risk_manager: RiskManager):
        self._journal = journal
        self._risk_manager = risk_manager
        self._last_rejection = None

    @property
    def last_rejection(self):
        return self._last_rejection

    def update_daily_pnl(self, quotes):
        quote_map = {quote.symbol: quote for quote in quotes}
        pnl = self._journal.daily_realized_pnl()
        positions = self._journal.open_positions()
        missing_symbols = sorted(
            {position["symbol"] for position in positions} - set(quote_map)
        )
        if missing_symbols:
            raise MissingMarkQuoteError(
                f"Missing current quote for open position: {', '.join(missing_symbols)}"
            )
        for position in positions:
            quote = quote_map.get(position["symbol"])
            entry = float(position["entry_price"])
            quantity = float(position["quantity"])
            if position["side"] == Side.BUY.value:
                pnl += (quote.bid - entry) * quantity
            else:
                pnl += (entry - quote.ask) * quantity
        self._risk_manager.set_daily_pnl(pnl)

    def execute(self, signal: Signal, quote: Quote, quantity: float, market_quotes=None):
        self._last_rejection = None
        if signal.symbol != quote.symbol:
            raise ValueError("Signal and quote symbols must match")
        if signal.side is Side.HOLD:
            self._last_rejection = "scanner returned hold"
            return None

        market_quotes = tuple(market_quotes) if market_quotes is not None else ()
        if not any(item.symbol == quote.symbol for item in market_quotes):
            market_quotes += (quote,)

        with self._journal.transaction():
            open_positions = self._journal.open_positions()
            existing = next(
                (
                    position
                    for position in open_positions
                    if position["symbol"] == signal.symbol
                ),
                None,
            )
            if existing and existing["side"] != signal.side.value:
                return self.close_position(existing["trade_id"], quote)

            try:
                self.update_daily_pnl(market_quotes)
            except MissingMarkQuoteError as error:
                self._last_rejection = str(error)
                return None
            fill_price = quote.ask if signal.side is Side.BUY else quote.bid
            mark_prices = {
                item.symbol: (item.bid + item.ask) / 2 for item in market_quotes
            }
            allowed, reason = self._risk_manager.allow_entry(
                signal.symbol,
                quantity,
                fill_price,
                open_positions,
                mark_prices,
            )
            if not allowed:
                self._last_rejection = reason
                return None

            trade_id = self._journal.create_trade(
                signal.symbol,
                signal.side.value,
                quantity,
                fill_price,
                _utc_now(),
            )
            self.update_daily_pnl(market_quotes)
            return PaperFill(
                trade_id, signal.symbol, signal.side, quantity, fill_price, "open"
            )

    def close_position(self, trade_id, quote):
        with self._journal.transaction():
            position = self._journal.get_trade(trade_id)
            if not position or position["status"] != "open":
                raise ValueError("Open paper position was not found")
            if position["symbol"] != quote.symbol:
                raise ValueError("Quote symbol does not match open paper position")

            entry = float(position["entry_price"])
            quantity = float(position["quantity"])
            entry_side = Side(position["side"])
            fill_price = quote.bid if entry_side is Side.BUY else quote.ask
            realized_pnl = (
                (fill_price - entry) * quantity
                if entry_side is Side.BUY
                else (entry - fill_price) * quantity
            )
            self._journal.close_trade(
                trade_id, fill_price, realized_pnl, _utc_now()
            )
            return PaperFill(
                trade_id,
                position["symbol"],
                entry_side.opposite,
                quantity,
                fill_price,
                "closed",
                realized_pnl,
            )
