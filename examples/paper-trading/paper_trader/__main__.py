import argparse
import json
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from .config import AppConfig, load_config
from .risk import KillSwitch
from .scheduler import Scheduler
from .service import PaperTradingService


def _arguments():
    parser = argparse.ArgumentParser(
        description="Mock-data-only XAUUSD/XAGUSD paper-trading MVP."
    )
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--once", action="store_true", help="Run one scan cycle and exit.")
    mode.add_argument(
        "--serve", action="store_true", help="Run continuously with a local health endpoint."
    )
    parser.add_argument("--config", help="Path to a JSON configuration file.")
    parser.add_argument(
        "--db",
        help="SQLite journal path; defaults to PAPER_TRADER_DB or the config value.",
    )
    parser.add_argument(
        "--kill-switch-file",
        default=os.environ.get("PAPER_TRADER_KILL_SWITCH_FILE"),
        help="Existing file blocks new entries until removed.",
    )
    parser.add_argument(
        "--health-port",
        type=int,
        default=8765,
        help="Local-only health port used with --serve.",
    )
    return parser.parse_args()


def _load_runtime_config(args):
    config = load_config(args.config)
    if args.db:
        values = config.__dict__.copy()
        values["database_path"] = args.db
        config = AppConfig(**values)
    return config


def _health_handler(service, scheduler):
    class HealthHandler(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path != "/health":
                self.send_error(404)
                return
            payload = service.health_payload(scheduler)
            body = json.dumps(payload, sort_keys=True).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, _format, *_args):
            return

    return HealthHandler


def _serve(service, config, port):
    if not 1 <= port <= 65535:
        raise ValueError("Health port must be between 1 and 65535")
    scheduler = Scheduler(
        service.run_cycle,
        config.scheduler_interval_seconds,
        config.scheduler_max_retries,
        config.scheduler_retry_base_seconds,
    )
    stop_event = threading.Event()
    worker = threading.Thread(
        target=scheduler.run_forever,
        args=(stop_event,),
        name="paper-trading-scheduler",
        daemon=True,
    )
    server = ThreadingHTTPServer(
        ("127.0.0.1", port), _health_handler(service, scheduler)
    )
    worker.start()
    print(f"Paper-only scheduler running; local health endpoint on port {port}.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        stop_event.set()
        server.server_close()
        worker.join(timeout=config.scheduler_interval_seconds + 1)


def main():
    args = _arguments()
    config = _load_runtime_config(args)
    kill_switch = KillSwitch(args.kill_switch_file)
    service = PaperTradingService(config, kill_switch=kill_switch)
    try:
        if args.serve:
            _serve(service, config, args.health_port)
            return 0
        print(json.dumps(service.run_cycle(), sort_keys=True))
        return 0
    finally:
        service.close()


if __name__ == "__main__":
    raise SystemExit(main())
