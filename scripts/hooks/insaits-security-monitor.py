#!/usr/bin/env python3
"""
InsAIts Security Monitor -- PreToolUse Hook for Claude Code
============================================================

Real-time security monitoring for Claude Code tool inputs.
Detects credential exposure, prompt injection, behavioral anomalies,
hallucination chains, and 20+ other anomaly types -- runs 100% locally.

Writes audit events to .insaits_audit_session.jsonl for forensic tracing.

Setup:
  pip install insa-its
  export ECC_ENABLE_INSAITS=1

  Add to .claude/settings.json:
  {
    "hooks": {
      "PreToolUse": [
        {
          "matcher": "Bash|Write|Edit|MultiEdit",
          "hooks": [
            {
              "type": "command",
              "command": "node scripts/hooks/insaits-security-wrapper.js"
            }
          ]
        }
      ]
    }
  }

How it works:
  Claude Code passes tool input as JSON on stdin.
  This script runs InsAIts anomaly detection on the content.
  Exit code 0 = clean (pass through).
  Exit code 2 = critical issue found (blocks tool execution).
  Stderr output = non-blocking warning shown to Claude.

Environment variables:
  INSAITS_DEV_MODE   Set to "true" to enable dev mode (no API key needed).
                     Defaults to "false" (strict mode).
  INSAITS_MODEL      LLM model identifier for fingerprinting. Default: claude-opus.
  INSAITS_FAIL_MODE  "open" (default) = continue on SDK errors.
                     "closed" = block tool execution on SDK errors.
  INSAITS_VERBOSE    Set to any value to enable debug logging.

Detections include:
  - Credential exposure (API keys, tokens, passwords)
  - Prompt injection patterns
  - Hallucination indicators (phantom citations, fact contradictions)
  - Behavioral anomalies (context loss, semantic drift)
  - Tool description divergence
  - Shorthand emergence / jargon drift

All processing is local -- no data leaves your machine.

Author: Cristi Bogdan -- YuyAI (https://github.com/Nomadu27/InsAIts)
License: Apache 2.0
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import sys
import time
from typing import Any, Dict, List, Tuple

# Configure logging to stderr so it does not interfere with stdout protocol
logging.basicConfig(
    stream=sys.stderr,
    format="[InsAIts] %(message)s",
    level=logging.DEBUG if os.environ.get("INSAITS_VERBOSE") else logging.WARNING,
)
log = logging.getLogger("insaits-hook")

# Try importing InsAIts SDK
try:
    from insa_its import insAItsMonitor
    INSAITS_AVAILABLE: bool = True
except ImportError:
    INSAITS_AVAILABLE = False

# --- Constants ---
AUDIT_FILE: str = ".insaits_audit_session.jsonl"
MIN_CONTENT_LENGTH: int = 10
MAX_SCAN_LENGTH: int = 4000
DEFAULT_MODEL: str = "claude-opus"
BLOCKING_SEVERITIES: frozenset = frozenset({"CRITICAL"})


def extract_content(data: Dict[str, Any]) -> Tuple[str, str]:
    """Extract inspectable text from a Claude Code tool input payload.

    Returns:
        A (text, context) tuple where *text* is the content to scan and
        *context* is a short label for the audit log.
    """
    tool_name: str = data.get("tool_name", "")
    tool_input: Dict[str, Any] = data.get("tool_input", {})

    text: str = ""
    context: str = ""

    if tool_name in ("Write", "Edit", "MultiEdit"):
        text = tool_input.get("content", "") or tool_input.get("new_string", "")
        context = "file:" + str(tool_input.get("file_path", ""))[:80]
    elif tool_name == "Bash":
        # PreToolUse: the tool hasn't executed yet, inspect the command
        command: str = str(tool_input.get("command", ""))
        text = command
        context = "bash:" + command[:80]
    elif "content" in data:
        content: Any = data["content"]
        if isinstance(content, list):
            text = "\n".join(
                b.get("text", "") for b in content if b.get("type") == "text"
            )
        elif isinstance(content, str):
            text = content
        context = str(data.get("task", ""))

    return text, context


def write_audit(event: Dict[str, Any]) -> None:
    """Append an audit event to the JSONL audit log.

    Creates a new dict to avoid mutating the caller's *event*.
    """
    try:
        enriched: Dict[str, Any] = {
            **event,
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
        enriched["hash"] = hashlib.sha256(
            json.dumps(enriched, sort_keys=True).encode()
        ).hexdigest()[:16]
        with open(AUDIT_FILE, "a", encoding="utf-8") as f:
            f.write(json.dumps(enriched) + "\n")
    except OSError as exc:
        log.warning("Failed to write audit log %s: %s", AUDIT_FILE, exc)


def get_anomaly_attr(anomaly: Any, key: str, default: str = "") -> str:
    """Get a field from an anomaly that may be a dict or an object.

    The SDK's ``send_message()`` returns anomalies as dicts, while
    other code paths may return dataclass/object instances.  This
    helper handles both transparently.
    """
    if isinstance(anomaly, dict):
        return str(anomaly.get(key, default))
    return str(getattr(anomaly, key, default))


def format_feedback(anomalies: List[Any]) -> str:
    """Format detected anomalies as feedback for Claude Code.

    Returns:
        A human-readable multi-line string describing each finding.
    """
    lines: List[str] = [
        "== InsAIts Security Monitor -- Issues Detected ==",
        "",
    ]
    for i, a in enumerate(anomalies, 1):
        sev: str = get_anomaly_attr(a, "severity", "MEDIUM")
        atype: str = get_anomaly_attr(a, "type", "UNKNOWN")
        detail: str = get_anomaly_attr(a, "details", "")
        lines.extend([
            f"{i}. [{sev}] {atype}",
            f"   {detail[:120]}",
            "",
        ])
    lines.extend([
        "-" * 56,
        "Fix the issues above before continuing.",
        "Audit log: " + AUDIT_FILE,
    ])
    return "\n".join(lines)


def main() -> None:
    """Entry point for the Claude Code PreToolUse hook."""
    raw: str = sys.stdin.read().strip()
    if not raw:
        sys.exit(0)

    try:
        data: Dict[str, Any] = json.loads(raw)
    except json.JSONDecodeError:
        data = {"content": raw}

    text, context = extract_content(data)

    # Skip very short content (e.g. "OK", empty bash results)
    if len(text.strip()) < MIN_CONTENT_LENGTH:
        sys.exit(0)

    if not INSAITS_AVAILABLE:
        log.warning("Not installed. Run: pip install insa-its")
        sys.exit(0)

    # Wrap SDK calls so an internal error does not crash the hook
    try:
        monitor: insAItsMonitor = insAItsMonitor(
            session_name="claude-code-hook",
            dev_mode=os.environ.get(
                "INSAITS_DEV_MODE", "false"
            ).lower() in ("1", "true", "yes"),
        )
        result: Dict[str, Any] = monitor.send_message(
            text=text[:MAX_SCAN_LENGTH],
            sender_id="claude-code",
            llm_id=os.environ.get("INSAITS_MODEL", DEFAULT_MODEL),
        )
    except Exception as exc:  # Broad catch intentional: unknown SDK internals
        fail_mode: str = os.environ.get("INSAITS_FAIL_MODE", "open").lower()
        if fail_mode == "closed":
            sys.stdout.write(
                f"InsAIts SDK error ({type(exc).__name__}); "
                "blocking execution to avoid unscanned input.\n"
            )
            sys.exit(2)
        log.warning(
            "SDK error (%s), skipping security scan: %s",
            type(exc).__name__, exc,
        )
        sys.exit(0)

    anomalies: List[Any] = result.get("anomalies", [])

    # Write audit event regardless of findings
    write_audit({
        "tool": data.get("tool_name", "unknown"),
        "context": context,
        "anomaly_count": len(anomalies),
        "anomaly_types": [get_anomaly_attr(a, "type") for a in anomalies],
        "text_length": len(text),
    })

    if not anomalies:
        log.debug("Clean -- no anomalies detected.")
        sys.exit(0)

    # Determine maximum severity
    has_critical: bool = any(
        get_anomaly_attr(a, "severity").upper() in BLOCKING_SEVERITIES
        for a in anomalies
    )

    feedback: str = format_feedback(anomalies)

    if has_critical:
        # stdout feedback -> Claude Code shows to the model
        sys.stdout.write(feedback + "\n")
        sys.exit(2)  # PreToolUse exit 2 = block tool execution
    else:
        # Non-critical: warn via stderr (non-blocking)
        log.warning("\n%s", feedback)
        sys.exit(0)


if __name__ == "__main__":
    main()
