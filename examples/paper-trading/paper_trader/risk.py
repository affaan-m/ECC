import math
import threading
from pathlib import Path

from .config import RiskLimits
from .models import SUPPORTED_SYMBOLS


class KillSwitch:
    """Process-local stop with an optional operator-controlled marker file."""

    def __init__(self, marker_path=None):
        self._marker_path = Path(marker_path) if marker_path else None
        self._engaged = False
        self._lock = threading.Lock()

    @property
    def engaged_state(self):
        with self._lock:
            return self._engaged or bool(
                self._marker_path and self._marker_path.exists()
            )

    def engage(self):
        with self._lock:
            self._engaged = True

    def release(self):
        with self._lock:
            self._engaged = False


class RiskManager:
    def __init__(self, limits: RiskLimits, kill_switch: KillSwitch):
        self._limits = limits
        self._kill_switch = kill_switch
        self._daily_pnl = 0.0
        self._lock = threading.Lock()

    @property
    def kill_switch(self):
        return self._kill_switch

    @property
    def daily_pnl(self):
        with self._lock:
            return self._daily_pnl

    def set_daily_pnl(self, daily_pnl):
        if not math.isfinite(float(daily_pnl)):
            raise ValueError("Daily P&L must be finite")
        with self._lock:
            self._daily_pnl = float(daily_pnl)

    def allow_entry(self, symbol, quantity, price, open_positions, mark_prices=None):
        if self._kill_switch.engaged_state:
            return False, "kill switch engaged"
        if symbol not in SUPPORTED_SYMBOLS:
            return False, "unsupported symbol"
        if (
            not math.isfinite(quantity)
            or quantity <= 0
            or quantity > self._limits.max_order_quantity
        ):
            return False, "order quantity exceeds configured cap"
        if not math.isfinite(price) or price <= 0:
            return False, "order price must be positive"
        if self.daily_pnl <= -self._limits.max_daily_loss_usd:
            return False, "daily loss cap reached"
        if len(open_positions) >= self._limits.max_concurrent_positions:
            return False, "maximum concurrent positions reached"
        if any(position["symbol"] == symbol for position in open_positions):
            return False, "position already open for symbol; averaging and hedging disabled"
        notional = quantity * price
        if notional > self._limits.max_position_notional_usd:
            return False, "position notional cap exceeded"
        marks = mark_prices or {}
        open_notional = 0.0
        for position in open_positions:
            mark = float(marks.get(position["symbol"], position["entry_price"]))
            if not math.isfinite(mark) or mark <= 0:
                return False, "open position mark price is invalid"
            open_notional += float(position["quantity"]) * mark
        if open_notional + notional > self._limits.max_total_notional_usd:
            return False, "total notional cap exceeded"
        return True, "risk checks passed"
