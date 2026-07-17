#!/usr/bin/env python3
"""Ask a heterogeneous (non-Claude) model for one review opinion via the Codex SDK.

Reuses the local ChatGPT subscription through the openai-codex SDK, so it does
not spend API credits. It only returns text for the orchestrator to quote
verbatim; it never executes tools or touches files (read-only sandbox).

Usage:
    ask_codex.py --prompt-file <path> [--model <name>] [--role <label>]
"""
import argparse
import sys
import tempfile
from pathlib import Path


def _read_prompt(prompt_file: str) -> str:
    """Read a regular prompt file only from the system temporary directory."""
    candidate = Path(prompt_file).expanduser()
    try:
        resolved = candidate.resolve(strict=True)
        temp_root = Path(tempfile.gettempdir()).resolve(strict=True)
    except OSError as exc:
        raise ValueError(f"failed to resolve prompt file: {exc}") from exc

    if not resolved.is_file():
        raise ValueError("prompt path is not a regular file")
    if not resolved.is_relative_to(temp_root):
        raise ValueError(
            f"prompt file must be inside the system temporary directory ({temp_root})"
        )

    try:
        return resolved.read_text(encoding="utf-8").strip()
    except OSError as exc:
        raise ValueError(f"failed to read prompt file: {exc}") from exc


def main() -> int:
    """Run one read-only Codex review and print only its final response."""
    parser = argparse.ArgumentParser(description="Ask Codex for a heterogeneous review")
    parser.add_argument("--prompt-file", required=True,
                        help="path to the prompt file (avoids shell escaping)")
    parser.add_argument("--model", default=None,
                        help="model name; defaults to the Codex default")
    parser.add_argument("--role", default="", help="role label, for logging only")
    args = parser.parse_args()

    try:
        prompt = _read_prompt(args.prompt_file)
    except ValueError as exc:
        print(f"[ask_codex] {exc}", file=sys.stderr)
        return 2

    if not prompt:
        print("[ask_codex] prompt is empty", file=sys.stderr)
        return 2

    try:
        from openai_codex import Codex, Sandbox
    except ImportError as exc:
        print(f"[ask_codex] openai-codex not installed: {exc}", file=sys.stderr)
        return 3

    try:
        with Codex() as codex:
            thread = codex.thread_start(
                model=args.model,
                sandbox=Sandbox.read_only,  # read-only: it only opines, never edits
            )
            result = thread.run(prompt)
    except Exception as exc:  # network / auth / rate limit
        print(f"[ask_codex] Codex call failed: {exc}", file=sys.stderr)
        return 4

    text = (getattr(result, "final_response", "") or "").strip()
    if not text:
        status = getattr(result, "status", None)
        print(f"[ask_codex] Codex returned no text (status={status})", file=sys.stderr)
        return 5

    sys.stdout.write(text)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
