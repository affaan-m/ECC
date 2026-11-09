# P09 → P06 and P07 → P08 integration

Date: 2026-11-04. Parent implementation commit: `3785a7e5`.
This increment extends the existing implementation rather than recreating P00–P05.
All four phases remain in **review**, pending the native acceptance cases below.
No milestone or native parity certification is claimed.

| Phase | Integrated behavior | Evidence |
| --- | --- | --- |
| P09 | Strict tool lists, role-bound read-only reviewers, explicit operator MCP mappings and verified model overrides, projection report | 71-agent installer; malformed/linked config, wildcard and alias rejection; renamed reviewer including `.agent.md` suffix |
| P06 | Deterministic metadata-sequences analysis, review-only candidate writer/cursor and bounded managed worker | Real installed commands and skill-only flows, canonical export, replay, retention, crash before/after atomic rename and cooperative stop |
| P07 | Selective stdio and authless HTTP/SSE configuration, ownership rollback and bounded initialize-only HTTP diagnostics | JSON/live SSE, malformed UTF-8, abort/timeout/output bounds, no redirects/retries/tool calls; Copilot 1.0.105 isolated user HTTP config readback |
| P08 | Explicit external canonical Vault, fixed Copilot MCP bootstrap and selected registration rollback; durable reviewed handoff and scoped recall | Actual canonical CLI and MCP save/search/read/doctor, source-free wrapper and installer dependency closure, recipient checks, incomplete/absent results and worktree/root fixtures |

## Operational boundaries

The P06 backend is explicitly `metadata-sequences`; semantic LLM analysis is
unsupported. Candidates do not become instructions or active skills automatically.
Worker shutdown and candidate writer crash recovery have separate ownership locks;
inspect a dead writer before removing its stale lock.

P07 remote authentication headers and legacy SSE probing remain unsupported.
MCP registration is explicit and separate from installer removal. Rollback removes
only unchanged owned entries; the Vault-specific rollback preserves other managed
servers. The P08 runtime must be installed/configured explicitly, and the server
launch directory and root overrides must be checked in the actual host.

P09 operator assertions about verified tool/model names do not establish native
enforcement. Default incompatible agents retain empty tools. Direct and delegated
reviewer enforcement need authenticated Copilot tests. Windows/macOS worker,
filesystem and host integration remain unexecuted. The existing native acceptance
runbook remains the release gate.

## Verification

Verified on Linux with Node 24.22.1, Python 3.12.14 and Git 2.51.1:

- Complete Copilot selection: **388 passed, 0 failed, 45 files**.
- Shared installer targets: **60 passed, 0 failed**.
- Repository validators and generated inventory/audit checks: passed.
- Targeted ESLint: zero errors; one complexity warning in `invokeMemory`.
- Changed documentation Markdown lint and `git diff --check`: passed.
- Targeted MCP/agent coverage: 98.52% statements/lines, 90.02% branches,
  100% functions. Prior observer coverage: 98.66% lines, 86.4% branches;
  Vault coverage: 96.94% lines, 83.8% branches.
- npm package generation and required bootstrap/policy module presence: passed.

The first aggregate run exposed a reviewer filename-suffix bypass; the role
matcher now includes `.agent.md`, and the corrected full suite passed. Malformed
operator JSON diagnostics were also sanitized to avoid echoing configuration.
Fixture and package results are distinct from native host evidence. No dependency
or lockfile version was changed.

Review assessment (1–5): accuracy 4 (native assertions remain unverified),
completeness 3 (Windows/authenticated acceptance outstanding), clarity 4 (per-phase
boundaries documented), actionability 4 (setup/rollback commands and executable
fixtures supplied), conciseness 4 (detailed evidence kept in project documents).
Average: 3.8. The highest-impact next improvement is recording the native cases;
next, validate remote authentication and host launch cwd. A user expecting full
native certification should agree that the remaining acceptance work is explicit.

## Continue

Continue with P10 using the inventory and these tested adapters. P11 can proceed
from P04 independently. P12/M1 still requires the native platform evidence;
P13 and P14 remain downstream of that gate. Do not repeat P00–P05 implementation
or the already passing fixture work to substitute for missing native evidence.
