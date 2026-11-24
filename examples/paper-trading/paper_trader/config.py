import json
import math
import os
from dataclasses import dataclass, field
from types import MappingProxyType


@dataclass(frozen=True)
class RiskLimits:
    max_order_quantity: float = 1.0
    max_position_notional_usd: float = 5_000.0
    max_total_notional_usd: float = 10_000.0
    max_daily_loss_usd: float = 250.0
    max_concurrent_positions: int = 2

    def __post_init__(self):
        positive = (
            self.max_order_quantity,
            self.max_position_notional_usd,
            self.max_total_notional_usd,
            self.max_daily_loss_usd,
        )
        if any(not math.isfinite(value) or value <= 0 for value in positive):
            raise ValueError("Risk limits must be finite positive values")
        if (
            isinstance(self.max_concurrent_positions, bool)
            or not isinstance(self.max_concurrent_positions, int)
            or self.max_concurrent_positions < 1
        ):
            raise ValueError("max_concurrent_positions must be at least one")


@dataclass(frozen=True)
class AppConfig:
    scheduler_interval_seconds: float = 60.0
    scheduler_max_retries: int = 3
    scheduler_retry_base_seconds: float = 1.0
    base_quantity_by_symbol: dict = field(
        default_factory=lambda: {"XAUUSD": 0.1, "XAGUSD": 1.0}
    )
    risk_limits: RiskLimits = field(default_factory=RiskLimits)
    enabled_roles: tuple = ()
    auto_paper_execute: bool = True
    database_path: str = "paper-trader.sqlite3"

    def __post_init__(self):
        if (
            not math.isfinite(self.scheduler_interval_seconds)
            or self.scheduler_interval_seconds <= 0
        ):
            raise ValueError("scheduler_interval_seconds must be positive")
        if (
            isinstance(self.scheduler_max_retries, bool)
            or not isinstance(self.scheduler_max_retries, int)
            or self.scheduler_max_retries < 0
        ):
            raise ValueError("scheduler_max_retries cannot be negative")
        if (
            not math.isfinite(self.scheduler_retry_base_seconds)
            or self.scheduler_retry_base_seconds < 0
        ):
            raise ValueError("scheduler_retry_base_seconds cannot be negative")
        if not isinstance(self.database_path, str) or not self.database_path:
            raise ValueError("database_path must not be empty")
        quantities = dict(self.base_quantity_by_symbol)
        if set(quantities) != {"XAUUSD", "XAGUSD"}:
            raise ValueError("Base quantities must define XAUUSD and XAGUSD")
        if any(
            isinstance(quantity, bool)
            or not isinstance(quantity, (int, float))
            or not math.isfinite(quantity)
            or quantity <= 0
            for quantity in quantities.values()
        ):
            raise ValueError("Base quantities must be finite positive values")
        if not isinstance(self.auto_paper_execute, bool):
            raise ValueError("auto_paper_execute must be a boolean")
        if any(not isinstance(role, str) for role in self.enabled_roles):
            raise ValueError("enabled_roles must contain role IDs")
        object.__setattr__(
            self, "base_quantity_by_symbol", MappingProxyType(quantities)
        )
        object.__setattr__(self, "enabled_roles", tuple(self.enabled_roles))


def load_config(path=None):
    config_path = path or os.environ.get("PAPER_TRADER_CONFIG")
    if not config_path:
        return AppConfig(database_path=os.environ.get(
            "PAPER_TRADER_DB", "paper-trader.sqlite3"
        ))

    with open(config_path, encoding="utf-8") as config_file:
        raw = json.load(config_file)
    if not isinstance(raw, dict):
        raise ValueError("Configuration must be a JSON object")

    allowed = {
        "scheduler_interval_seconds",
        "scheduler_max_retries",
        "scheduler_retry_base_seconds",
        "base_quantity_by_symbol",
        "risk_limits",
        "enabled_roles",
        "auto_paper_execute",
        "database_path",
    }
    unknown = set(raw) - allowed
    if unknown:
        raise ValueError(f"Unknown configuration keys: {', '.join(sorted(unknown))}")

    limits_raw = raw.get("risk_limits", {})
    if not isinstance(limits_raw, dict):
        raise ValueError("risk_limits must be a JSON object")
    risk_limits = RiskLimits(**limits_raw)
    enabled_roles = raw.get("enabled_roles", ())
    if not isinstance(enabled_roles, list) or any(
        not isinstance(role, str) for role in enabled_roles
    ):
        raise ValueError("enabled_roles must be a list of role IDs")
    quantities = raw.get(
        "base_quantity_by_symbol", {"XAUUSD": 0.1, "XAGUSD": 1.0}
    )
    if not isinstance(quantities, dict):
        raise ValueError("base_quantity_by_symbol must be a JSON object")

    return AppConfig(
        scheduler_interval_seconds=raw.get("scheduler_interval_seconds", 60.0),
        scheduler_max_retries=raw.get("scheduler_max_retries", 3),
        scheduler_retry_base_seconds=raw.get("scheduler_retry_base_seconds", 1.0),
        base_quantity_by_symbol=quantities,
        risk_limits=risk_limits,
        enabled_roles=tuple(enabled_roles),
        auto_paper_execute=raw.get("auto_paper_execute", True),
        database_path=raw.get(
            "database_path", os.environ.get("PAPER_TRADER_DB", "paper-trader.sqlite3")
        ),
    )
