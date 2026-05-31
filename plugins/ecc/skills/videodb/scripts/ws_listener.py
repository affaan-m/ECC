#!/usr/bin/env python3
"""
WebSocket event listener for VideoDB with auto-reconnect and graceful shutdown.

Usage:
  python scripts/ws_listener.py [OPTIONS] [output_dir]

Arguments:
  output_dir  Directory for output files (default: XDG_STATE_HOME/videodb or ~/.local/state/videodb)

Options:
  --clear     Clear the events file before starting (use when starting a new session)

Output files:
  <output_dir>/videodb_events.jsonl  - All WebSocket events (JSONL format)
  <output_dir>/videodb_ws_id         - WebSocket connection ID
  <output_dir>/videodb_ws_pid        - Process ID for easy termination

Output (first line, for parsing):
  WS_ID=<connection_id>

Examples:
  python scripts/ws_listener.py &                                 # Run in background
  python scripts/ws_listener.py --clear                           # Clear events and start fresh
  python scripts/ws_listener.py --clear /tmp/mydir                # Custom dir with clear
  kill "$(cat ~/.local/state/videodb/videodb_ws_pid)"             # Stop the listener
"""
import os
import sys
import json
import signal
import asyncio
import logging
import contextlib
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
load_dotenv()

import videodb
from videodb.exceptions import AuthenticationError

# Retry config
MAX_RETRIES = 10
INITIAL_BACKOFF = 1  # seconds
MAX_BACKOFF = 60     # seconds

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] %(message)s",
    datefmt="%H:%M:%S",
)
LOGGER = logging.getLogger(__name__)

# Parse arguments
RETRYABLE_ERRORS = (ConnectionError, TimeoutError)


def default_output_dir() -> Path:
    """Return a private per-user state directory for listener artifacts."""
    xdg_state_home = os.environ.get("XDG_STATE_HOME")
    if xdg_state_home:
        return Path(xdg_state_home) / "videodb"
    return Path.home() / ".local" / "state" / "videodb"


def ensure_private_dir(path: Path) -> Path:
    """Create the listener state directory with private permissions."""
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    try:
        path.chmod(0o700)
    except OSError:
        pass
    return path


def parse_args() -> tuple[bool, Path]:
    clear = False
    output_dir: str | None = None
    
    args = sys.argv[1:]
    for arg in args:
        if arg == "--clear":
            clear = True
        elif arg.startswith("-"):
            raise SystemExit(f"Unknown flag: {arg}")
        elif not arg.startswith("-"):
            output_dir = arg
    
    if output_dir is None:
        events_dir = os.environ.get("VIDEODB_EVENTS_DIR")
        if events_dir:
            return clear, ensure_private_dir(Path(events_dir))
        return clear, ensure_private_dir(default_output_dir())

    return clear, ensure_private_dir(Path(output_dir))

CLEAR_EVENTS, OUTPUT_DIR = parse_args()
EVENTS_FILE = OUTPUT_DIR / "videodb_events.jsonl"
WS_ID_FILE = OUTPUT_DIR / "videodb_ws_id"
PID_FILE = OUTPUT_DIR / "videodb_ws_pid"

# Track if this is the first connection (for clearing events)
_first_connection = True


def log(msg: str):
    """Log with timestamp."""
    LOGGER.info("%s", msg)


def append_event(event: dict):
    """Append event to JSONL file with timestamps."""
    now = datetime.now(timezone.utc)
    event["ts"] = now.isoformat()
    event["unix_ts"] = now.timestamp()
    with EVENTS_FILE.open("a", encoding="utf-8") as f:
        f.write(json.dumps(event) + "\n")


def write_pid():
    """Write PID file for easy process management."""
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True, mode=0o700)
    PID_FILE.write_text(str(os.getpid()))


def cleanup_pid():
    """Remove PID file on exit."""
    try:
        PID_FILE.unlink(missing_ok=True)
    except OSError as exc:
        LOGGER.debug("Failed to remove PID file %s: %s", PID_FILE, exc)


def is_fatal_error(exc: Exception) -> bool:
    """Return True when retrying would hide a permanent configuration error."""
    if isinstance(exc, (AuthenticationError, PermissionError)):
        return True
    status = getattr(exc, "status_code", None)
    if status in {401, 403}:
        return True
    message = str(exc).lower()
    return "401" in message or "403" in message or "auth" in message


async def listen_with_retry():
    """Main listen loop with auto-reconnect and exponential backoff."""
    global _first_connection
    
    retry_count = 0
    backoff = INITIAL_BACKOFF
    
    while retry_count < MAX_RETRIES:
        try:
            conn = videodb.connect()
            ws_wrapper = conn.connect_websocket()
            ws = await ws_wrapper.connect()
            ws_id = ws.connection_id
        except asyncio.CancelledError:
            log("Shutdown requested")
            raise
        except Exception as e:
            if is_fatal_error(e):
                log(f"Fatal configuration error: {e}")
                raise
            if not isinstance(e, RETRYABLE_ERRORS):
                raise
            retry_count += 1
            log(f"Connection error: {e}")
            
            if retry_count >= MAX_RETRIES:
                log(f"Max retries ({MAX_RETRIES}) exceeded, exiting")
                break
            
            log(f"Reconnecting in {backoff}s (attempt {retry_count}/{MAX_RETRIES})...")
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, MAX_BACKOFF)
            continue

        OUTPUT_DIR.mkdir(parents=True, exist_ok=True, mode=0o700)

        if _first_connection and CLEAR_EVENTS:
            EVENTS_FILE.unlink(missing_ok=True)
            log("Cleared events file")
        _first_connection = False

        WS_ID_FILE.write_text(ws_id)

        if retry_count == 0:
            print(f"WS_ID={ws_id}", flush=True)
        log(f"Connected (ws_id={ws_id})")

        retry_count = 0
        backoff = INITIAL_BACKOFF

        receiver = ws.receive().__aiter__()
        while True:
            try:
                msg = await anext(receiver)
            except StopAsyncIteration:
                log("Connection closed by server")
                break
            except asyncio.CancelledError:
                log("Shutdown requested")
                raise
            except Exception as e:
                if is_fatal_error(e):
                    log(f"Fatal configuration error: {e}")
                    raise
                if not isinstance(e, RETRYABLE_ERRORS):
                    raise
                retry_count += 1
                log(f"Connection error: {e}")

                if retry_count >= MAX_RETRIES:
                    log(f"Max retries ({MAX_RETRIES}) exceeded, exiting")
                    return

                log(f"Reconnecting in {backoff}s (attempt {retry_count}/{MAX_RETRIES})...")
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, MAX_BACKOFF)
                break

            append_event(msg)
            channel = msg.get("channel", msg.get("event", "unknown"))
            text = msg.get("data", {}).get("text", "")
            if text:
                print(f"[{channel}] {text[:80]}", flush=True)


async def main_async():
    """Async main with signal handling."""
    loop = asyncio.get_running_loop()
    shutdown_event = asyncio.Event()
    
    def handle_signal():
        log("Received shutdown signal")
        shutdown_event.set()
    
    # Register signal handlers
    for sig in (signal.SIGINT, signal.SIGTERM):
        with contextlib.suppress(NotImplementedError):
            loop.add_signal_handler(sig, handle_signal)
    
    # Run listener with cancellation support
    listen_task = asyncio.create_task(listen_with_retry())
    shutdown_task = asyncio.create_task(shutdown_event.wait())
    
    _done, pending = await asyncio.wait(
        [listen_task, shutdown_task],
        return_when=asyncio.FIRST_COMPLETED,
    )

    if listen_task.done():
        await listen_task
    
    # Cancel remaining tasks
    for task in pending:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass

    for sig in (signal.SIGINT, signal.SIGTERM):
        with contextlib.suppress(NotImplementedError):
            loop.remove_signal_handler(sig)
    
    log("Shutdown complete")


def main():
    write_pid()
    try:
        asyncio.run(main_async())
    finally:
        cleanup_pid()


if __name__ == "__main__":
    main()
