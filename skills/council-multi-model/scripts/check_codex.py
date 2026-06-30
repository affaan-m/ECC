#!/usr/bin/env python3
"""Preflight: is the heterogeneous (Codex) reviewer usable on this machine?

Prints AVAILABLE and exits 0 when the openai-codex SDK is importable and the
ChatGPT subscription auth is present, so the council-multi-model
heterogeneous-review node can run. Otherwise prints UNAVAILABLE with a reason
and exits non-zero, so the caller cleanly falls back to the plain Claude-only
council and marks the review absent.

Usage:
    check_codex.py            # static check: SDK import + auth file present
    check_codex.py --probe    # also make one tiny live call to confirm it answers
"""
import argparse
import os
import sys
from pathlib import Path


def _auth_present() -> bool:
    """ChatGPT auth file, honoring CODEX_HOME the same way the SDK does."""
    home = os.environ.get("CODEX_HOME")
    base = Path(home) if home else Path.home() / ".codex"
    return (base / "auth.json").is_file()


def main() -> int:
    parser = argparse.ArgumentParser(description="Check Codex SDK availability")
    parser.add_argument(
        "--probe",
        action="store_true",
        help="do one tiny live call, not just a static check",
    )
    args = parser.parse_args()

    try:
        from openai_codex import Codex, Sandbox  # noqa: F401
    except ImportError:
        print("UNAVAILABLE: openai-codex SDK not installed (run scripts/setup.sh)")
        return 3

    if not _auth_present():
        print("UNAVAILABLE: no ChatGPT auth at ~/.codex/auth.json (log in to Codex first)")
        return 4

    if not args.probe:
        print("AVAILABLE: SDK installed and auth present")
        return 0

    try:
        codex = Codex()
        try:
            thread = codex.thread_start(sandbox=Sandbox.read_only)
            result = thread.run("Reply with the single word: ok")
        finally:
            try:
                codex.close()
            except Exception:
                pass
    except Exception as exc:  # network / auth / rate limit
        print(f"UNAVAILABLE: live probe failed ({exc})")
        return 5

    text = (getattr(result, "final_response", "") or "").strip()
    if not text:
        status = getattr(result, "status", None)
        print(f"UNAVAILABLE: live probe returned no text (status={status})")
        return 5

    print("AVAILABLE: live probe answered")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
