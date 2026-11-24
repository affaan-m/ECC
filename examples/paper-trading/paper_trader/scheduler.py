import threading
import time
import math
from datetime import datetime, timezone


def _utc_now():
    return datetime.now(timezone.utc).isoformat()


class Scheduler:
    def __init__(
        self,
        operation,
        interval_seconds,
        max_retries=3,
        retry_base_seconds=1.0,
    ):
        if (
            not math.isfinite(interval_seconds)
            or not math.isfinite(retry_base_seconds)
            or interval_seconds <= 0
            or isinstance(max_retries, bool)
            or not isinstance(max_retries, int)
            or max_retries < 0
            or retry_base_seconds < 0
        ):
            raise ValueError("Invalid scheduler interval or retry configuration")
        self._operation = operation
        self._interval = interval_seconds
        self._max_retries = max_retries
        self._retry_base = retry_base_seconds
        self._lock = threading.Lock()
        self._metrics = {
            "run_count": 0,
            "success_count": 0,
            "failure_count": 0,
            "retry_count": 0,
            "consecutive_failures": 0,
            "last_started_at": None,
            "last_success_at": None,
            "last_error": None,
        }

    def run_once(self):
        with self._lock:
            self._metrics["run_count"] += 1
            self._metrics["last_started_at"] = _utc_now()
        for attempt in range(self._max_retries + 1):
            try:
                self._operation()
                with self._lock:
                    self._metrics["success_count"] += 1
                    self._metrics["consecutive_failures"] = 0
                    self._metrics["last_success_at"] = _utc_now()
                    self._metrics["last_error"] = None
                return True
            except Exception as error:
                with self._lock:
                    self._metrics["last_error"] = type(error).__name__
                if attempt < self._max_retries:
                    with self._lock:
                        self._metrics["retry_count"] += 1
                    time.sleep(min(self._retry_base * (2 ** attempt), 30.0))
                    continue
                with self._lock:
                    self._metrics["failure_count"] += 1
                    self._metrics["consecutive_failures"] += 1
                return False
        return False

    def run_forever(self, stop_event):
        while not stop_event.is_set():
            self.run_once()
            stop_event.wait(self._interval)

    def health(self):
        with self._lock:
            metrics = dict(self._metrics)
        metrics["interval_seconds"] = self._interval
        metrics["max_retries"] = self._max_retries
        metrics["status"] = (
            "starting"
            if metrics["run_count"] == 0
            else "degraded"
            if metrics["consecutive_failures"]
            else "healthy"
        )
        return metrics
