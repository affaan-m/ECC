from dataclasses import asdict

from .config import AppConfig
from .execution import PaperExecutionEngine
from .journal import SQLiteTradeJournal
from .market_data import MockMarketDataProvider, validate_snapshot
from .risk import KillSwitch, RiskManager
from .signals import Scanner


class PaperTradingService:
    def __init__(
        self,
        config: AppConfig,
        provider=None,
        journal=None,
        kill_switch=None,
    ):
        self.config = config
        self.provider = provider or MockMarketDataProvider()
        self.journal = journal or SQLiteTradeJournal(config.database_path)
        self.kill_switch = kill_switch or KillSwitch()
        self.risk_manager = RiskManager(config.risk_limits, self.kill_switch)
        self.scanner = Scanner(config.enabled_roles)
        self.execution = PaperExecutionEngine(self.journal, self.risk_manager)

    def run_cycle(self):
        snapshot = validate_snapshot(self.provider.get_snapshot())
        self.execution.update_daily_pnl(snapshot.quotes)
        signals = self.scanner.scan(snapshot)
        quote_map = {quote.symbol: quote for quote in snapshot.quotes}
        results = []
        for signal in signals:
            fill = None
            rejection = None
            if (
                self.config.auto_paper_execute
                and signal.side.value != "hold"
                and signal.confidence >= 0.2
            ):
                fill = self.execution.execute(
                    signal,
                    quote_map[signal.symbol],
                    self.config.base_quantity_by_symbol[signal.symbol],
                    snapshot.quotes,
                )
                rejection = self.execution.last_rejection
            results.append(
                {
                    "symbol": signal.symbol,
                    "side": signal.side.value,
                    "confidence": signal.confidence,
                    "evidence": [asdict(item) for item in signal.evidence],
                    "fill": asdict(fill) if fill else None,
                    "risk_rejection": rejection,
                }
            )
        return {
            "mode": "paper",
            "provider": type(self.provider).__name__,
            "timestamp": snapshot.timestamp,
            "daily_pnl_usd": round(self.risk_manager.daily_pnl, 4),
            "signals": results,
        }

    def health_payload(self, scheduler):
        metrics = scheduler.health()
        if self.kill_switch.engaged_state:
            status = "halted"
        else:
            status = metrics["status"]
        return {
            "status": status,
            "mode": "paper",
            "provider": type(self.provider).__name__,
            "kill_switch_engaged": self.kill_switch.engaged_state,
            "scheduler": metrics,
        }

    def close(self):
        self.journal.close()
