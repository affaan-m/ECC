# Copilot observer supervision decision

Status: implemented for Linux subprocess fixtures; native Windows/macOS approval
pending. Date: 2026-11-03. Scope: explicit P06 metadata backend only.

The observer must not inherit an interactive coding agent's tool surface, run
an unrestricted provider subprocess, activate learned rules or install a daemon.
The available capture contains minimized tool/session/outcome metadata, so it
cannot support claims about semantic user corrections or exact command fixes.

Choose a built-in import-free deterministic analyzer for an explicitly selected
`metadata-sequences` backend. A trusted writer validates fixed candidate
templates and writes a versioned pending snapshot. Existing canonical import,
keyword clustering and evolution remain separate explicit operations. This
preserves a meaningful small observation-to-candidate path without pretending
that metadata establishes a reliable preference.

Choose a fixed detached Node worker launched only by the operator. It owns an
exclusive directory, child claim and random token, uses bounded run count and
monotonic lifetime, and checks a cooperative cancellation file. No OS signal is
sent to a potentially reused PID. A dead registered PID plus the matching token
is necessary for explicit stale-lock recovery. Unknown startup ownership needs
manual inspection. Failure metadata contains no raw observation or model text.

An OS scheduled task/service was considered but would introduce installation,
credentials and platform-specific lifecycle beyond the explicit start request.
A Bash daemon does not provide native Windows behavior. An unrestricted CLI
agent would violate the analysis privilege boundary. Those options are not
silently substituted when the fixed worker fails.

Consequences: no automatic startup, arbitrary backend execution, model cost or
active instinct mutation. Shutdown is cooperative between bounded analyses;
abrupt process death can leave an inspectable lock. This is not arbitrary-code
sandboxing or proof of native Windows process survival. Certifying other OSes,
adding external semantic backends or changing the supervisor requires its own
native evidence and review before those capabilities can be marked verified.
