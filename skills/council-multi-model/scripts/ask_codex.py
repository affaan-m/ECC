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


def main() -> int:
    parser = argparse.ArgumentParser(description="Ask Codex for a heterogeneous review")
    parser.add_argument("--prompt-file", required=True,
                        help="path to the prompt file (avoids shell escaping)")
    parser.add_argument("--model", default=None,
                        help="model name; defaults to the Codex default")
    parser.add_argument("--role", default="", help="role label, for logging only")
    args = parser.parse_args()

    try:
        with open(args.prompt_file, "r", encoding="utf-8") as fh:
            prompt = fh.read().strip()
    except OSError as exc:
        print(f"[ask_codex] failed to read prompt file: {exc}", file=sys.stderr)
        return 2

    if not prompt:
        print("[ask_codex] prompt is empty", file=sys.stderr)
        return 2

    try:
        from openai_codex import Codex, Sandbox
    except ImportError as exc:
        print(f"[ask_codex] openai-codex not installed: {exc}", file=sys.stderr)
        return 3

    codex = Codex()
    try:
        thread = codex.thread_start(
            model=args.model,
            sandbox=Sandbox.read_only,  # read-only: it only opines, never edits
        )
        result = thread.run(prompt)
    except Exception as exc:  # network / auth / rate limit
        print(f"[ask_codex] Codex call failed: {exc}", file=sys.stderr)
        return 4
    finally:
        try:
            codex.close()
        except Exception:
            pass

    text = (result.final_response or "").strip()
    if not text:
        print(f"[ask_codex] Codex returned no text (status={result.status})", file=sys.stderr)
        return 5

    sys.stdout.write(text)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
