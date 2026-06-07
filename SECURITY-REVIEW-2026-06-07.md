# ECC Security Review — 2026-06-07

**Scope:** Full codebase — `src/llm/` (Python), `scripts/hooks/` (JS), `scripts/ci/` (JS), `scripts/lib/install*` (JS), `scripts/lib/shell-*` (JS), MCP configs, install entrypoints
**Reviewed:** 19 Python files, 46 hook scripts, 13 CI scripts, 25+ install/core scripts, 2 MCP configs, 2 shell parsers, 2 install entrypoints
**Result:** 0 CRITICAL · 5 HIGH · 12 MEDIUM · 9 LOW

---

## Executive Summary

The ECC codebase demonstrates **strong security hygiene overall**. Key positives:

- ✅ No hardcoded secrets anywhere
- ✅ `spawnSync`/`execFileSync` with argument arrays (never string `exec()`) in hooks
- ✅ Path traversal guards on hook/plugin script loading
- ✅ 1MB stdin size limits on all hooks
- ✅ Frozen dataclasses for core Python types (immutability enforced)
- ✅ Secret redaction in logging hooks
- ✅ Atomic file writes (tmp + rename pattern)
- ✅ Windows `.cmd` CVE-2024-27980 mitigation awareness
- ✅ No `eval()`/`exec()`/`pickle`/`yaml.load()` in Python
- ✅ Language name validation pattern (`/^[a-zA-Z0-9_-]+$/`) prevents path traversal

The **most actionable** findings are the unpinned MCP package versions (H1), `shell: true` with MCP server name injection (H2), and `fs.rmSync` without path containment (M9).

---

## 🟠 HIGH Findings (5)

### H1: MCP Config — Unpinned Package Versions with `npx -y`
**File:** `mcp-configs/mcp-servers.json` (lines 31, 36, 51, 99, 104)
**Issue:** Several MCP server entries use `@latest` or no version pin with `npx -y` (auto-install + execute):
- `@upstash/context7-mcp@latest`
- `@magicuidesign/mcp@latest`
- `@supabase/mcp-server-supabase@latest`
- `@modelcontextprotocol/server-memory` (no version)
- `@modelcontextprotocol/server-sequential-thinking` (no version)

A compromised npm package at `@latest` executes arbitrary code with full user privileges. The root `.mcp.json` correctly pins versions — this template does not.
**Fix:** Pin all packages to exact versions. Consider integrity hashes.

### H2: `mcp-health-check.js` — Shell Injection via MCP Server Name
**File:** `scripts/hooks/mcp-health-check.js` (lines 516-540)
**Issue:** `reconnectCommand()` reads a shell command from `ECC_MCP_RECONNECT_{SERVER}` env var, performs `{server}` template substitution with `serverName` from parsed MCP config, then passes it to `spawnSync(command, { shell: true })`. A malicious MCP server name (from poisoned `.claude.json`) can inject shell metacharacters.
**Fix:** Validate `serverName` against `[a-zA-Z0-9_-]` before substitution, or split command into executable+args.

### H3: MCP Config Poisoning via Deep Merge
**File:** `scripts/lib/install/apply.js` (lines 125-142), `scripts/lib/install-targets/cursor-project.js` (lines 131-136)
**Issue:** The Cursor target installer merges `.mcp.json` into user's `.cursor/mcp.json` via `deepMergeJson`. If ECC's `.mcp.json` is compromised (repo attack, PR poisoning), it silently injects arbitrary MCP servers into all downstream users' IDE configs.
**Fix:** Log exactly which MCP servers are added. Consider per-server consent or a manifest diff display.

### H4: `post-edit-format.js` / `stop-format-typecheck.js` — `shell: true` with Incomplete Path Sanitization
**Files:** `scripts/hooks/post-edit-format.js` (lines 56-67), `scripts/hooks/stop-format-typecheck.js` (lines 64-69)
**Issue:** When the formatter binary is a `.cmd` file on Windows, `shell: true` is used with file paths from hook input. The `UNSAFE_PATH_CHARS` regexes differ between files and neither covers all cmd.exe injection vectors (`\r`, double-quote escape, `%VARIABLE%` expansion).
**Fix:** Use a strict path allowlist (`[a-zA-Z0-9/\\._-]`) or use `cross-spawn` to avoid `shell: true`.

### H5: `insaits-security-wrapper.js` — `shell: true` for `.cmd`/`.bat` Python Shims
**File:** `scripts/hooks/insaits-security-wrapper.js` (lines 49-68)
**Issue:** Windows `.cmd`/`.bat` Python shim detection triggers `shell: true` with `WINDOWS_SHELL_UNSAFE_PATH_CHARS` guard. The guard misses spaces-in-paths and some `%VARIABLE%` expansion patterns.
**Fix:** Enclose both binary and script path in double quotes for cmd.exe, or prefer `.exe` binaries (code already has fallback ordering).

---

## 🟡 MEDIUM Findings (12)

### M1: Unvalidated LLM-Controlled Tool Arguments
**File:** `src/llm/tools/executor.py` (line 51)
`func(**tool_call.arguments)` — no argument validation before `**kwargs` unpacking from LLM response. A registered tool accepting dangerous params (paths, commands) has no schema gate.
**Fix:** Validate arguments against `ToolDefinition.parameters` schema before execution.

### M2: Error Messages Leak Internal Details
**Files:** `src/llm/tools/executor.py:57`, `src/llm/providers/claude.py:100-108`, `openai.py:108-116`, `astraflow.py:113-121`, `ollama.py:95-103`
Raw `str(e)` propagated to callers — can expose API endpoints, partial keys, stack traces.
**Fix:** Log full details server-side, return generic messages to callers.

### M3: SSRF Risk in Ollama Provider
**File:** `src/llm/providers/ollama.py` (lines 25, 59, 71-73)
`OLLAMA_BASE_URL` env var used without URL validation. `urllib.request.urlopen` supports `file:///`, `ftp://`, and internal IPs.
**Fix:** Restrict to `http://`/`https://` protocols. Reject private IP ranges for non-localhost.

### M4: Environment Variable Injection via Config Write
**File:** `src/llm/cli/selector.py` (lines 76-81)
User-supplied `provider` and `model` values written to `.llm.env` without sanitization. Newlines allow injecting additional env vars that `resolver.py` will parse.
**Fix:** Validate values match `[a-zA-Z0-9._-]`. Reject newlines and `=`.

### M5: Command Injection via Crafted Project Directory Name
**File:** `scripts/hooks/auto-tmux-dev.js` (lines 46-72)
`cmd` from `tool_input.command` embedded in shell strings. Mitigated by `devServerRegex` gate but trust assumption should be documented.

### M6: Incomplete Secret Redaction in Logging
**File:** `scripts/hooks/post-bash-command-log.js` (lines 22-33)
Misses: `GITHUB_TOKEN=`, `GH_TOKEN=`, Slack tokens (`xoxb-`/`xoxp-`), Azure/GCP tokens, URL-embedded credentials (`https://user:pass@host`).
**Fix:** Add patterns for common CI/cloud tokens and URL-embedded credentials.

### M7: Audit Log Written to CWD (Multi-User Risk)
**File:** `scripts/hooks/insaits-security-monitor.py` (line 88)
`.insaits_audit_session.jsonl` written to CWD. On shared systems, other users can read tool names and anomaly details.
**Fix:** Write to user-private directory (`~/.claude/insaits/`).

### M8: Environment Passthrough to Child Processes
**File:** `scripts/ecc.js` (lines 193-201)
`env: process.env` passes all environment secrets (GitHub tokens, AWS keys) to child scripts.
**Fix:** Filter `process.env` to only necessary variables.

### M9: `fs.rmSync` with `recursive: true` on State-File Paths
**File:** `scripts/lib/install-lifecycle.js` (lines 356, 372, 407, 450, 1170)
`destinationPath` from install-state JSON (user-writable) is passed to `fs.rmSync({ recursive: true, force: true })`. Schema only validates "non-empty string" — no path containment check.
**Fix:** Validate `path.resolve(destinationPath).startsWith(path.resolve(targetRoot) + path.sep)` before deletion.

### M10: Recursive File Operations Without Symlink Checks
**Files:** `scripts/lib/install-executor.js` (lines 94-118), `scripts/lib/install-targets/helpers.js` (lines 61-83)
`readdirSync` traversal doesn't check for symlinks. A symlink to `~/.ssh/id_rsa` could be copied to install targets as "managed files."
**Fix:** Add `entry.isSymbolicLink()` checks.

### M11: `npm install --no-audit` Without Integrity
**Files:** `install.sh` (lines 18-21), `install.ps1` (lines 38-49)
Auto-runs `npm install --no-audit` without lockfile enforcement. `--no-audit` suppresses vulnerability warnings. `postinstall` scripts execute freely.
**Fix:** Use `npm ci` (lockfile-exact), remove `--no-audit`, consider `--ignore-scripts`.

### M12: Shell Parser Recursion Without Depth Limit
**Files:** `scripts/lib/shell-substitution.js`, `scripts/lib/shell-split.js`
`extractCommandSubstitutions`, `extractSubshellGroups`, `extractBraceGroups` recurse on their own output. Deep nesting like `$($($($($(...)))))` causes proportional blowup.
**Fix:** Add recursion depth cap (e.g., 10 levels).

---

## 🟢 LOW Findings (9)

| # | Finding | File | Notes |
|---|---------|------|-------|
| L1 | No HTTPS enforcement for remote Ollama URLs | `providers/ollama.py:73` | Plain HTTP for localhost is typical, but remote should enforce TLS |
| L2 | CWD-relative `.llm.env` can be hijacked | `providers/resolver.py:34-46` | Use absolute path for config resolution |
| L3 | No input validation on provider constructor params | All `providers/*.py` | Basic URL format validation recommended |
| L4 | No token budget on ReActAgent loop (denial-of-wallet) | `tools/executor.py:65-116` | 10 iterations × full API calls with no cost cap |
| L5 | No size limits on JSON parsing of API responses | Multiple providers | JSON bomb risk (DoS, not RCE) |
| L6 | `GATEGUARD_STATE_DIR` env without path traversal check | `gateguard-fact-force.js:35` | Add `..` segment rejection |
| L7 | Placeholder secrets in MCP template | `mcp-configs/mcp-servers.json` | Add pre-flight `YOUR_*_HERE` rejection |
| L8 | Error messages leak internal filesystem paths | Multiple install scripts | Use relative paths in user-facing errors |
| L9 | `CLAUDE_RULES_DIR` env allows target override | `install-executor.js:500` | Validate resolves within home directory |

---

## Recommendations Priority

### Immediate (Fix Before Release)
1. **Pin all MCP package versions** in `mcp-configs/mcp-servers.json` (H1)
2. **Validate MCP server names** in `mcp-health-check.js` reconnect command (H2)
3. **Add path containment check** before `fs.rmSync` in `install-lifecycle.js` (M9)

### Short-Term (Next Sprint)
4. Unify and harden `UNSAFE_PATH_CHARS` across all hooks using `shell: true` (H4, H5)
5. Add symlink checks in recursive file operations (M10)
6. Use `npm ci` instead of `npm install --no-audit` in install scripts (M11)
7. Add tool argument schema validation in `executor.py` (M1)
8. Expand secret redaction patterns in `post-bash-command-log.js` (M6)

### Backlog
9. SSRF mitigation in Ollama provider (M3)
10. Shell parser recursion depth limit (M12)
11. Error message sanitization across providers (M2)
12. Env var filtering for child processes (M8)

---

## Methodology

- **Static analysis** of all source files (Python + JavaScript)
- **Pattern scanning** for: `exec(`, `eval(`, `shell: true`, hardcoded secrets, `child_process`, `subprocess`, `pickle`, `yaml.load`, `innerHTML`, `dangerouslySetInnerHTML`, `fs.rmSync`, `process.env` passthrough
- **OWASP Top 10** cross-reference (Injection, Broken Auth, Sensitive Data, XXE, BAC, Misconfiguration, XSS, Deserialization, Known Vulns, Logging)
- **Supply chain analysis** of MCP configs, install flows, and dependency handling
- **Trust boundary analysis** of hook inputs, env vars, file paths, and LLM responses
