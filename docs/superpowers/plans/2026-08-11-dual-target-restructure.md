# Dual-Target Restructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the repo into a target-neutral `content/` tree with `targets/claude/` and `targets/codex/` adapters, so `install.sh --target claude|codex|all` installs shared content to both `~/.claude` and `~/.codex`.

**Architecture:** All markdown/config content moves to `content/` (single source of truth). Thin dispatcher `scripts/install.sh` routes to per-target installers under `targets/`. Shared bash helpers live in `scripts/lib/common.sh`. The Codex adapter generates `AGENTS.md` (global instructions + rules index), copies rules to `~/.codex/instructions/`, copies skills, and merges MCP servers into `config.toml` via a tomlkit script.

**Tech Stack:** Bash (installers), Node.js built-in `assert`/`spawnSync` (tests, matching existing `tests/` style), Python + tomlkit via `uv run` (TOML merge), jq (hooks merge, unchanged).

**Spec:** `docs/superpowers/specs/2026-08-11-dual-target-restructure-design.md`

## Global Constraints

- Code, commits, PRs in English; conventional commit format (`<type>: <description>`); every commit ends with trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- All bash scripts: `#!/usr/bin/env bash` + `set -euo pipefail`.
- **Never use `((var++))`** — with `set -e` it exits the script when var is 0. Use `var=$((var + 1))`.
- jq filters containing `$item`/`$key` must be stored in a single-line bash variable (see `JQ_MERGE_HOOKS` in current `scripts/install.sh:156`) — multiline single-quoted filters inside `$()` break in jq 1.7.
- `~/.codex/config.toml` holds user state (project trust levels, model, plugins). **Never overwrite it wholesale; never touch keys outside `[mcp_servers.*]`.**
- Hook runtime scripts (`scripts/node/`, `scripts/python/`) do **not** move — hook configs reference `${CLAUDE_PLUGIN_ROOT}/scripts/{lang}/hooks/...` relative to repo root. Only markdown/config content moves to `content/`.
- Run the full suite with `node tests/run-all.js` (from repo root). Markdown changes must pass `npx markdownlint <file>`.
- All moves via `git mv` to preserve history.
- Do not add a `hooks` field to `.claude-plugin/plugin.json` (enforced by `tests/hooks/hooks.test.js`; see `.claude-plugin/PLUGIN_SCHEMA_NOTES.md`).
- Work happens on branch `refactor/dual-target-restructure` in the worktree `.claude/worktrees/dual-target-restructure/`. All paths below are relative to that worktree root.
- Known branch-internal transition: after Task 3 and before Task 6, `--target all` does not install Codex AGENTS.md (the old inline Codex block is removed in Task 3; the Codex target lands in Task 6). This is acceptable mid-branch; the branch merges only when all tasks are done.

---

### Task 1: Extract shared helpers into `scripts/lib/common.sh`

Pure refactor. Behavior of `install.sh`/`uninstall.sh` must be byte-identical (verified by dry-run snapshot diff).

**Files:**

- Create: `scripts/lib/common.sh`
- Modify: `scripts/install.sh`
- Modify: `scripts/uninstall.sh`

**Interfaces:**

- Consumes: nothing (first task).
- Produces: `scripts/lib/common.sh` exposing — variables `CLAUDE_DIR`, `CODEX_DIR`, `CATEGORIES`, colors (`RED GREEN YELLOW CYAN NC`), counters `copied skipped removed not_found`; functions `log_copy log_skip log_dry log_info log_warn log_rm log_not_found`, `codex_agents_label`, `codex_is_available`, `discover_languages`, `copy_file`, `copy_file_subst`, `copy_dir`, `remove_file`, `remove_dir`, `cleanup_empty_dir`. Callers must set `REPO_ROOT` before sourcing, and define `FORCE`/`DRY_RUN` before calling copy/remove functions. `discover_languages` scans `${CONTENT_ROOT:-$REPO_ROOT}` so it works both before (Task 1) and after (Task 2) the content move.

- [ ] **Step 1: Capture baseline dry-run snapshots**

```bash
cd /home/appleparan/src/everything-claude-code/.claude/worktrees/dual-target-restructure
bash scripts/install.sh -n common node python rust typescript > /tmp/claude-1000/-home-appleparan-src-everything-claude-code/7d06f97f-da37-4425-9a0b-dfc10ceccf53/scratchpad/install-before.txt
bash scripts/uninstall.sh -n common node python rust typescript > /tmp/claude-1000/-home-appleparan-src-everything-claude-code/7d06f97f-da37-4425-9a0b-dfc10ceccf53/scratchpad/uninstall-before.txt
```

- [ ] **Step 2: Create `scripts/lib/common.sh`**

Move these blocks verbatim out of `scripts/install.sh` and `scripts/uninstall.sh` (they are duplicated between the two — keep one copy):

- From `install.sh`: lines 6–15 (dirs, `CATEGORIES`, colors), 21–35 (`discover_languages`), 70–86 (log fns + codex helpers), 89–153 (`copy_file`, `copy_file_subst`, `copy_dir`).
- From `uninstall.sh`: lines 67–70 (`log_rm`, `log_dry`, `log_info`, `log_not_found` — merge with install's log fns, keep both `log_dry` variants unified: install's takes 2 args, uninstall's takes 1; rename uninstall's to `log_dry_rm`), 85–143 (`remove_file`, `remove_dir`, `cleanup_empty_dir`).
- Initialize all four counters at the top: `copied=0 skipped=0 removed=0 not_found=0`.
- In `discover_languages`, change `local cat_dir="${REPO_ROOT}/${cat}"` to `local cat_dir="${CONTENT_ROOT:-$REPO_ROOT}/${cat}"`.

Header of the new file:

```bash
#!/usr/bin/env bash
# Shared helpers for install/uninstall scripts.
# Callers must set REPO_ROOT before sourcing, and FORCE/DRY_RUN before
# calling copy_*/remove_* functions.
```

- [ ] **Step 3: Source it from both scripts**

In `install.sh` and `uninstall.sh`, replace the moved blocks with:

```bash
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"
```

Update 1-arg `log_dry` call sites to `log_dry_rm`: inside `remove_file`/`remove_dir` (now in `common.sh`, old uninstall.sh lines 90 and 115) and the remaining inline use at old uninstall.sh line 335 (`log_dry "settings.json (hooks key only)"`).

- [ ] **Step 4: Verify parity and tests**

```bash
bash scripts/install.sh -n common node python rust typescript > /tmp/claude-1000/-home-appleparan-src-everything-claude-code/7d06f97f-da37-4425-9a0b-dfc10ceccf53/scratchpad/install-after.txt
bash scripts/uninstall.sh -n common node python rust typescript > /tmp/claude-1000/-home-appleparan-src-everything-claude-code/7d06f97f-da37-4425-9a0b-dfc10ceccf53/scratchpad/uninstall-after.txt
diff /tmp/claude-1000/-home-appleparan-src-everything-claude-code/7d06f97f-da37-4425-9a0b-dfc10ceccf53/scratchpad/install-before.txt /tmp/claude-1000/-home-appleparan-src-everything-claude-code/7d06f97f-da37-4425-9a0b-dfc10ceccf53/scratchpad/install-after.txt
diff /tmp/claude-1000/-home-appleparan-src-everything-claude-code/7d06f97f-da37-4425-9a0b-dfc10ceccf53/scratchpad/uninstall-before.txt /tmp/claude-1000/-home-appleparan-src-everything-claude-code/7d06f97f-da37-4425-9a0b-dfc10ceccf53/scratchpad/uninstall-after.txt
node tests/run-all.js
```

Expected: both diffs empty, all tests pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/common.sh scripts/install.sh scripts/uninstall.sh
git commit -m "refactor: extract shared install helpers into scripts/lib/common.sh"
```

---

### Task 2: Move content into `content/` and update all path references

One atomic commit: the tree moves and every reference follows. The repo must be fully green at the end of this task.

**Files:**

- Move (git mv): `global/CLAUDE.md` → `content/instructions/global.md`; `agents/` → `content/agents/`; `skills/` → `content/skills/`; `commands/` → `content/commands/`; `rules/` → `content/rules/`; `hooks/` → `content/hooks/`; `mcp-configs/mcp-servers.json` → `content/mcp/servers.json`
- Modify: `scripts/install.sh`, `scripts/uninstall.sh`, `scripts/lib/common.sh`, `scripts/node/ci/validate-hooks.js:10`, `tests/hooks/hooks.test.js:157,172`, `.claude-plugin/plugin.json`, `.github/workflows/ci.yml:158`
- Modify (after grep sweep): any other file matching the old paths

**Interfaces:**

- Consumes: `common.sh` from Task 1 (`CONTENT_ROOT` support in `discover_languages`).
- Produces: `content/` layout exactly as in the spec; `CONTENT_ROOT="${REPO_ROOT}/content"` defined in `common.sh` and used by all installers.

- [ ] **Step 1: Move the tree**

```bash
mkdir -p content/instructions content/mcp
git mv global/CLAUDE.md content/instructions/global.md
git mv agents content/agents
git mv skills content/skills
git mv commands content/commands
git mv rules content/rules
git mv hooks content/hooks
git mv mcp-configs/mcp-servers.json content/mcp/servers.json
rmdir global mcp-configs
```

- [ ] **Step 2: Update `scripts/lib/common.sh`**

Add after the `REPO_ROOT` expectation comment:

```bash
CONTENT_ROOT="${REPO_ROOT}/content"
```

- [ ] **Step 3: Update `scripts/install.sh` paths**

- `global_claude="${REPO_ROOT}/global/CLAUDE.md"` → `global_claude="${CONTENT_ROOT}/instructions/global.md"`; its label strings `"global/CLAUDE.md"` → `"content/instructions/global.md"`.
- Category loop: `src_dir="${REPO_ROOT}/${category}/${lang}"` → `src_dir="${CONTENT_ROOT}/${category}/${lang}"`.
- Hooks collection: `${REPO_ROOT}/hooks/${lang}/hooks.json` and `global-hooks.json` and `project-hooks.json` → `${CONTENT_ROOT}/hooks/${lang}/...`; label strings `"hooks/${lang}/..."` → `"content/hooks/${lang}/..."`.
- Hook scripts / libs (`${REPO_ROOT}/scripts/${lang}/...`) stay unchanged.

- [ ] **Step 4: Update `scripts/uninstall.sh` paths**

Same substitutions as Step 3 (global, categories, hooks existence checks at lines 197, 217, 319–320, 351).

- [ ] **Step 5: Update JS references**

- `scripts/node/ci/validate-hooks.js:10`: `'../../../hooks/common/hooks.json'` → `'../../../content/hooks/common/hooks.json'`.
- `tests/hooks/hooks.test.js:157`: `path.join(__dirname, '..', '..', 'hooks', 'common', 'hooks.json')` → `path.join(__dirname, '..', '..', 'content', 'hooks', 'common', 'hooks.json')`; line 172 same for `'hooks', 'node', 'global-hooks.json'`.

- [ ] **Step 6: Update `.claude-plugin/plugin.json`**

Prefix every entry with `./content/` (keep arrays, keep explicit agent file paths, no `hooks` field):

- `"commands": ["./content/commands/"]`
- `"skills": ["./content/skills/"]`
- `"agents"`: all 19 entries `./agents/...` → `./content/agents/...`

- [ ] **Step 7: Update CI workflow globs**

`.github/workflows/ci.yml:158`:

```yaml
        run: npx markdownlint "content/agents/**/*.md" "content/skills/**/*.md" "content/commands/**/*.md" "content/rules/**/*.md"
```

- [ ] **Step 8: Grep sweep for stragglers**

```bash
grep -rn "global/CLAUDE\|mcp-configs\|\"\./agents\|\"\./skills\|\"\./commands\|'\.\./\.\./hooks'\|\.\./\.\./\.\./hooks" \
  --include="*.js" --include="*.json" --include="*.yml" --include="*.sh" --include="*.md" . \
  | grep -v node_modules | grep -v "^\./\.claude/" | grep -v docs/superpowers
```

Fix every hit (README.md/CONTRIBUTING.md hits: update the path strings only here; full docs rewrite is Task 8). Check `tests/ci/no-personal-paths.test.js` and `tests/integration/hooks.test.js` for scanned-directory lists and update `agents`/`skills`/... roots to `content/...` if present.

- [ ] **Step 9: Verify**

```bash
node tests/run-all.js
bash scripts/install.sh -n common node python rust typescript
bash scripts/uninstall.sh -n common node python rust typescript
```

Expected: tests pass; dry-run output identical to Task 1 snapshots except labels now read `content/...`.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "refactor: move shared content into target-neutral content/ tree"
```

---

### Task 3: Dispatcher + `targets/claude/install.sh`

**Files:**

- Create: `targets/claude/install.sh` (relocated Claude logic)
- Modify: `scripts/install.sh` (becomes thin dispatcher)
- Test: `tests/scripts/install-dispatcher.test.js`
- Modify: `tests/run-all.js` (add the new test file to `testFiles`)

**Interfaces:**

- Consumes: `scripts/lib/common.sh` (Task 1), `content/` layout (Task 2).
- Produces: `scripts/install.sh [-f|-n|-l|-h] [--target claude|codex|all] <language>...` (default `all`); `targets/claude/install.sh` runnable standalone with the same flags minus `--target`. Task 6 plugs `targets/codex/install.sh` into the `codex`/`all` branches.

- [ ] **Step 1: Write the failing test**

Create `tests/scripts/install-dispatcher.test.js`:

```javascript
#!/usr/bin/env node
/**
 * Tests for scripts/install.sh --target dispatch.
 */
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');

const repoRoot = path.join(__dirname, '..', '..');
const installSh = path.join(repoRoot, 'scripts', 'install.sh');

function run(args, envOverrides = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-dispatch-'));
  const env = {
    ...process.env,
    HOME: home,
    PATH: '/usr/bin:/bin',
    ...envOverrides
  };
  delete env.CODEX_HOME;
  Object.assign(env, envOverrides);
  const res = spawnSync('bash', [installSh, ...args], { env, encoding: 'utf8' });
  return { ...res, home };
}

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    passed += 1;
  } catch (err) {
    console.error(`  FAIL  ${name}: ${err.message}`);
    failed += 1;
  }
}

test('--target claude dry-run installs CLAUDE.md, no AGENTS.md', () => {
  const res = run(['-n', '--target', 'claude', 'common']);
  assert.strictEqual(res.status, 0, res.stderr);
  assert.ok(res.stdout.includes('CLAUDE.md'), 'expected CLAUDE.md in output');
  assert.ok(!res.stdout.includes('AGENTS.md'), 'AGENTS.md must not appear for claude target');
});

test('unknown --target fails with error', () => {
  const res = run(['-n', '--target', 'bogus', 'common']);
  assert.notStrictEqual(res.status, 0);
  assert.ok((res.stdout + res.stderr).includes('Unknown target'), 'expected Unknown target error');
});

test('default target all without codex skips codex with INFO', () => {
  const res = run(['-n', 'common']);
  assert.strictEqual(res.status, 0, res.stderr);
  assert.ok(res.stdout.includes('CLAUDE.md'));
  assert.ok(res.stdout.includes('Codex not detected'), 'expected skip message');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/scripts/install-dispatcher.test.js`
Expected: FAIL — current `install.sh` rejects `--target` as an unknown argument/language.

- [ ] **Step 3: Create `targets/claude/install.sh`**

`git mv scripts/install.sh targets/claude/install.sh`, then inside it:

- `SCRIPT_DIR` stays; change `REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"` → `REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"`.
- `source "${SCRIPT_DIR}/lib/common.sh"` → `source "${REPO_ROOT}/scripts/lib/common.sh"`.
- Delete the Codex block (the `if codex_is_available; then ... fi` around the AGENTS.md copy) — replaced in Task 6 by the codex target. Keep everything else identical.
- Update `usage()` first line to `Install Claude Code configuration files to ~/.claude/` (unchanged text is fine) and drop nothing else.

- [ ] **Step 4: Write the new dispatcher `scripts/install.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
source "${REPO_ROOT}/scripts/lib/common.sh"

TARGET="all"
PASS_ARGS=()
while [[ $# -gt 0 ]]; do
    case "$1" in
        --target)   TARGET="${2:?--target requires a value}"; shift 2 ;;
        --target=*) TARGET="${1#--target=}"; shift ;;
        *)          PASS_ARGS+=("$1"); shift ;;
    esac
done

case "$TARGET" in
    claude) exec "${REPO_ROOT}/targets/claude/install.sh" "${PASS_ARGS[@]:-}" ;;
    codex)  exec "${REPO_ROOT}/targets/codex/install.sh" "${PASS_ARGS[@]:-}" ;;
    all)
        "${REPO_ROOT}/targets/claude/install.sh" "${PASS_ARGS[@]:-}"
        if codex_is_available; then
            "${REPO_ROOT}/targets/codex/install.sh" "${PASS_ARGS[@]:-}"
        else
            log_info "Codex not detected; skipping codex target"
        fi
        ;;
    *)
        echo -e "${RED}Error: Unknown target '${TARGET}' (expected claude, codex, or all)${NC}"
        exit 1
        ;;
esac
```

Until Task 6 lands, guard the codex branches so the dispatcher stays functional:
in the `codex` case, and inside the `all` case's `if codex_is_available`, check
`[[ -x "${REPO_ROOT}/targets/codex/install.sh" ]]` first and `log_info "codex target not yet implemented"` otherwise. Task 6 removes the guard.

Note on `"${PASS_ARGS[@]:-}"`: with `set -u` and an empty array, bash 4 errors on `"${PASS_ARGS[@]}"` — the `:-` fallback avoids that while passing empty args through, and the claude installer already errors cleanly on a missing language argument.

- [ ] **Step 5: Run tests**

Run: `node tests/scripts/install-dispatcher.test.js` — Expected: PASS (3/3).
Add `'scripts/install-dispatcher.test.js'` to `testFiles` in `tests/run-all.js`, then run `node tests/run-all.js` — Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add scripts/install.sh targets/claude/install.sh tests/scripts/install-dispatcher.test.js tests/run-all.js
git commit -m "feat: add --target dispatcher and relocate Claude installer to targets/claude"
```

---

### Task 4: `targets/codex/build-agents-md.sh` (AGENTS.md generator)

**Files:**

- Create: `targets/codex/build-agents-md.sh`
- Test: `tests/scripts/codex-adapter.test.js` (started here, extended in Tasks 5–6)
- Modify: `tests/run-all.js`

**Interfaces:**

- Consumes: `content/instructions/global.md`, `content/rules/{lang}/*.md`.
- Produces: `build-agents-md.sh <dest-label> <lang>...` — writes generated AGENTS.md to **stdout**: the full body of `global.md`, then a `## Rules Index` section with one bullet per rules file, formatted `- \`<dest-label>/<filename>\` — <first H1 title> (<lang>)`. Task 6's installer redirects stdout into `~/.codex/AGENTS.md`.

- [ ] **Step 1: Write the failing test**

Create `tests/scripts/codex-adapter.test.js`:

```javascript
#!/usr/bin/env node
/**
 * Tests for the Codex adapter scripts under targets/codex/.
 */
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');

const repoRoot = path.join(__dirname, '..', '..');
const buildAgents = path.join(repoRoot, 'targets', 'codex', 'build-agents-md.sh');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    passed += 1;
  } catch (err) {
    console.error(`  FAIL  ${name}: ${err.message}`);
    failed += 1;
  }
}

test('build-agents-md emits global body plus rules index', () => {
  const res = spawnSync('bash', [buildAgents, '~/.codex/instructions', 'common', 'python'], {
    encoding: 'utf8'
  });
  assert.strictEqual(res.status, 0, res.stderr);
  const globalMd = fs.readFileSync(
    path.join(repoRoot, 'content', 'instructions', 'global.md'), 'utf8');
  const firstLine = globalMd.split('\n').find((l) => l.trim().length > 0);
  assert.ok(res.stdout.includes(firstLine), 'global.md body must be included');
  assert.ok(res.stdout.includes('## Rules Index'), 'index heading missing');
  assert.ok(res.stdout.includes('~/.codex/instructions/coding-style.md'),
    'common rule entry missing');
  assert.ok(res.stdout.includes('~/.codex/instructions/python-coding-style.md'),
    'python rule entry missing');
  assert.ok(!res.stdout.includes('instructions/node-coding-style.md'),
    'unselected language must not appear');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/scripts/codex-adapter.test.js`
Expected: FAIL — `build-agents-md.sh` does not exist (spawn status non-zero).

- [ ] **Step 3: Implement `targets/codex/build-agents-md.sh`**

```bash
#!/usr/bin/env bash
# Generate Codex AGENTS.md on stdout: the global instructions followed by an
# index of rules files installed under <dest-label>.
# Usage: build-agents-md.sh <dest-label> <lang>...
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CONTENT_ROOT="${REPO_ROOT}/content"

DEST_LABEL="${1:?usage: build-agents-md.sh <dest-label> <lang>...}"
shift

cat "${CONTENT_ROOT}/instructions/global.md"

echo ""
echo "## Rules Index"
echo ""
echo "Detailed rules are installed alongside this file."
echo "Read the matching file before working in that area:"
echo ""

for lang in "$@"; do
    rules_dir="${CONTENT_ROOT}/rules/${lang}"
    [[ -d "$rules_dir" ]] || continue
    for f in "$rules_dir"/*.md; do
        [[ -f "$f" ]] || continue
        name=$(basename "$f")
        title=$(grep -m1 '^# ' "$f" | sed 's/^# //' || true)
        echo "- \`${DEST_LABEL}/${name}\` — ${title:-$name} (${lang})"
    done
done
```

Then `chmod +x targets/codex/build-agents-md.sh`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/scripts/codex-adapter.test.js` — Expected: PASS.
Add `'scripts/codex-adapter.test.js'` to `testFiles` in `tests/run-all.js`; run `node tests/run-all.js` — Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add targets/codex/build-agents-md.sh tests/scripts/codex-adapter.test.js tests/run-all.js
git commit -m "feat: add Codex AGENTS.md generator with rules index"
```

---

### Task 5: `targets/codex/merge-mcp.py` (config.toml MCP merge)

**Files:**

- Create: `targets/codex/merge-mcp.py`
- Test: extend `tests/scripts/codex-adapter.test.js`

**Interfaces:**

- Consumes: `content/mcp/servers.json` (shape: `{"mcpServers": {"<name>": {"command": str, "args": [...], "env": {...}, "description": str}}}`).
- Produces: CLI `merge-mcp.py --config <config.toml> --servers <servers.json> [--force] [--dry-run]`. Adds missing `[mcp_servers.<name>]` tables (keys `command`, `args`, `env` only — `description` is intentionally dropped; Codex config does not define it). Existing server names are skipped unless `--force`. Prints `ADD`/`SKIP`/`BACKUP` lines. Creates `config.toml.bak.<epoch>` before writing. Never touches other keys; preserves comments/formatting via tomlkit. Exit 0 on success.

- [ ] **Step 1: Write the failing tests**

Append to `tests/scripts/codex-adapter.test.js` (before the final summary lines):

```javascript
const mergeMcp = path.join(repoRoot, 'targets', 'codex', 'merge-mcp.py');
const hasUv = spawnSync('uv', ['--version'], { encoding: 'utf8' }).status === 0;

function runMerge(configText, extraArgs = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-mcp-'));
  const config = path.join(dir, 'config.toml');
  if (configText !== null) fs.writeFileSync(config, configText);
  const servers = path.join(repoRoot, 'content', 'mcp', 'servers.json');
  const res = spawnSync(
    'uv',
    ['run', '--with', 'tomlkit', 'python3', mergeMcp,
      '--config', config, '--servers', servers, ...extraArgs],
    { encoding: 'utf8' }
  );
  return { res, dir, config };
}

if (!hasUv) {
  console.log('  SKIP  merge-mcp tests (uv not available)');
} else {
  test('merge-mcp adds servers to a fresh config', () => {
    const { res, config } = runMerge(null);
    assert.strictEqual(res.status, 0, res.stderr);
    const out = fs.readFileSync(config, 'utf8');
    assert.ok(out.includes('[mcp_servers.chrome-devtools]'));
    assert.ok(out.includes('command = "npx"'));
    assert.ok(!out.includes('description'), 'description key must be dropped');
  });

  test('merge-mcp preserves user keys and existing servers, and backs up', () => {
    const user = 'model = "gpt-5.6-sol"\n\n[mcp_servers.custom]\ncommand = "mytool"\n';
    const { res, dir, config } = runMerge(user);
    assert.strictEqual(res.status, 0, res.stderr);
    const out = fs.readFileSync(config, 'utf8');
    assert.ok(out.includes('model = "gpt-5.6-sol"'), 'user key lost');
    assert.ok(out.includes('[mcp_servers.custom]'), 'user server lost');
    assert.ok(out.includes('[mcp_servers.chrome-devtools]'), 'new server missing');
    const backups = fs.readdirSync(dir).filter((f) => f.includes('.bak.'));
    assert.strictEqual(backups.length, 1, 'expected exactly one backup');
  });

  test('merge-mcp is idempotent (second run skips, no new backup)', () => {
    const { res, dir, config } = runMerge(null);
    assert.strictEqual(res.status, 0, res.stderr);
    const before = fs.readFileSync(config, 'utf8');
    const servers = path.join(repoRoot, 'content', 'mcp', 'servers.json');
    const res2 = spawnSync(
      'uv',
      ['run', '--with', 'tomlkit', 'python3', mergeMcp,
        '--config', config, '--servers', servers],
      { encoding: 'utf8' }
    );
    assert.strictEqual(res2.status, 0, res2.stderr);
    assert.ok(res2.stdout.includes('SKIP'), 'expected SKIP on second run');
    assert.strictEqual(fs.readFileSync(config, 'utf8'), before, 'file changed on no-op run');
    const backups = fs.readdirSync(dir).filter((f) => f.includes('.bak.'));
    assert.strictEqual(backups.length, 1, 'no-op run must not create a backup');
  });
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node tests/scripts/codex-adapter.test.js`
Expected: the three new merge-mcp tests FAIL (script missing); the Task 4 test still passes.

- [ ] **Step 3: Implement `targets/codex/merge-mcp.py`**

```python
#!/usr/bin/env python3
"""Merge MCP server definitions into a Codex config.toml.

Only ``[mcp_servers.*]`` tables are touched. All other keys, comments, and
formatting are preserved via tomlkit. A timestamped backup is written before
any modification. Run via ``uv run --with tomlkit python3 merge-mcp.py ...``.
"""

import argparse
import json
import shutil
import sys
import time
from pathlib import Path

import tomlkit

COPIED_KEYS = ('command', 'args', 'env')


def main() -> int:
    """Merge servers.json entries into config.toml and report actions."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', required=True, type=Path)
    parser.add_argument('--servers', required=True, type=Path)
    parser.add_argument('--force', action='store_true')
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()

    servers = json.loads(args.servers.read_text())['mcpServers']
    doc = (
        tomlkit.parse(args.config.read_text())
        if args.config.exists()
        else tomlkit.document()
    )
    if 'mcp_servers' not in doc:
        doc['mcp_servers'] = tomlkit.table(True)
    table = doc['mcp_servers']

    added = []
    for name, spec in servers.items():
        if name in table and not args.force:
            print(f'SKIP mcp_servers.{name} (exists; use --force to overwrite)')
            continue
        entry = tomlkit.table()
        for key in COPIED_KEYS:
            if spec.get(key):
                entry[key] = spec[key]
        table[name] = entry
        added.append(name)
        print(f'ADD  mcp_servers.{name}')

    if args.dry_run or not added:
        return 0

    if args.config.exists():
        backup = args.config.with_name(f'{args.config.name}.bak.{int(time.time())}')
        shutil.copy2(args.config, backup)
        print(f'BACKUP {backup}')
    args.config.parent.mkdir(parents=True, exist_ok=True)
    args.config.write_text(tomlkit.dumps(doc))
    return 0


if __name__ == '__main__':
    sys.exit(main())
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node tests/scripts/codex-adapter.test.js` — Expected: PASS (4 tests, or 1 + SKIP note if uv is unavailable).
Run: `node tests/run-all.js` — Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add targets/codex/merge-mcp.py tests/scripts/codex-adapter.test.js
git commit -m "feat: add tomlkit-based MCP server merge for Codex config.toml"
```

---

### Task 6: `targets/codex/install.sh` + dispatcher wiring

**Files:**

- Create: `targets/codex/install.sh`
- Modify: `scripts/install.sh` (remove the Task 3 not-yet-implemented guards)
- Test: extend `tests/scripts/install-dispatcher.test.js`

**Interfaces:**

- Consumes: `common.sh` helpers; `build-agents-md.sh` (Task 4, stdout contract); `merge-mcp.py` (Task 5 CLI); `content/rules`, `content/skills`, `content/mcp/servers.json`.
- Produces: `targets/codex/install.sh [-f|-n|-l|-h] <language>...` which: (1) errors with exit 1 if Codex is not detected; (2) copies selected `content/rules/{lang}/*.md` → `$CODEX_DIR/instructions/` (flat); (3) generates `$CODEX_DIR/AGENTS.md` (skip if exists unless `-f`, like `copy_file`); (4) copies `content/skills/{lang}/<skill>/` → `$CODEX_DIR/skills/<skill>/` unchanged (Codex reads SKILL.md; unknown frontmatter keys are ignored); (5) merges MCP servers via `uv run --with tomlkit` (warn and skip when `uv` is missing, matching the repo's toolchain-guard pattern).

- [ ] **Step 1: Write the failing tests**

Append to `tests/scripts/install-dispatcher.test.js` (before the summary lines):

```javascript
test('--target codex dry-run plans AGENTS.md, instructions, and skills', () => {
  const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-codex-'));
  const res = run(['-n', '--target', 'codex', 'common', 'python'],
    { CODEX_HOME: codexHome });
  assert.strictEqual(res.status, 0, res.stderr);
  assert.ok(res.stdout.includes('AGENTS.md'), 'AGENTS.md missing from plan');
  assert.ok(res.stdout.includes('instructions/coding-style.md'), 'rules copy missing');
  assert.ok(res.stdout.includes('skills/git-commit-msg'), 'skill copy missing');
});

test('--target codex without codex fails', () => {
  const res = run(['-n', '--target', 'codex', 'common']);
  assert.notStrictEqual(res.status, 0);
  assert.ok((res.stdout + res.stderr).includes('Codex not detected'));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node tests/scripts/install-dispatcher.test.js`
Expected: the two new tests FAIL (codex target guard prints "not yet implemented" / missing script); earlier tests still pass.

- [ ] **Step 3: Implement `targets/codex/install.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
source "${REPO_ROOT}/scripts/lib/common.sh"

usage() {
    cat <<EOF
Usage: $(basename "$0") [OPTIONS] <language>...

Install shared configuration into Codex (\$CODEX_HOME or ~/.codex):
  AGENTS.md          Global instructions + rules index (generated)
  instructions/      Rules files, read on demand via the index
  skills/            Skill folders (invoked via \$skill-name)
  config.toml        [mcp_servers.*] entries merged (backup created)

Options:
  -f    Force overwrite existing files / MCP entries
  -n    Dry run
  -l    List available languages and exit
  -h    Show this help
EOF
}

FORCE=false
DRY_RUN=false
while getopts "fnlh" opt; do
    case $opt in
        f) FORCE=true ;;
        n) DRY_RUN=true ;;
        l) discover_languages; exit 0 ;;
        h) usage; exit 0 ;;
        *) usage; exit 1 ;;
    esac
done
shift $((OPTIND - 1))

if [[ $# -eq 0 ]]; then
    echo -e "${RED}Error: At least one language must be specified${NC}"
    usage
    exit 1
fi
LANGUAGES=("$@")

AVAILABLE_LANGS=$(discover_languages)
for lang in "${LANGUAGES[@]}"; do
    if ! echo "$AVAILABLE_LANGS" | grep -qx "$lang"; then
        echo -e "${RED}Error: Unknown language '${lang}'${NC}"
        exit 1
    fi
done

if ! codex_is_available; then
    echo -e "${RED}Error: Codex not detected (set CODEX_HOME, create ~/.codex, or install codex)${NC}"
    exit 1
fi

if [[ -n "${CODEX_HOME:-}" ]]; then
    DEST_LABEL="$CODEX_DIR"
else
    DEST_LABEL="~/.codex"
fi

if $DRY_RUN; then
    echo -e "${CYAN}Dry run: showing what would be installed${NC}"
fi
echo -e "Installing: ${GREEN}${LANGUAGES[*]}${NC} → ${DEST_LABEL}/"
echo ""

$DRY_RUN || mkdir -p "$CODEX_DIR/instructions" "$CODEX_DIR/skills"

# 1. Rules → instructions/
echo -e "${CYAN}[instructions]${NC}"
for lang in "${LANGUAGES[@]}"; do
    rules_dir="${CONTENT_ROOT}/rules/${lang}"
    [[ -d "$rules_dir" ]] || continue
    for f in "$rules_dir"/*.md; do
        [[ -f "$f" ]] || continue
        name=$(basename "$f")
        copy_file "$f" "${CODEX_DIR}/instructions/${name}" \
            "content/rules/${lang}/${name}" "instructions/${name}"
    done
done
echo ""

# 2. AGENTS.md (generated: global instructions + rules index)
echo -e "${CYAN}[global]${NC}"
agents_tmp=$(mktemp)
trap 'rm -f "$agents_tmp"' EXIT
"${SCRIPT_DIR}/build-agents-md.sh" "${DEST_LABEL}/instructions" "${LANGUAGES[@]}" > "$agents_tmp"
copy_file "$agents_tmp" "${CODEX_DIR}/AGENTS.md" \
    "content/instructions/global.md (+rules index)" "AGENTS.md"
echo ""

# 3. Skills
echo -e "${CYAN}[skills]${NC}"
for lang in "${LANGUAGES[@]}"; do
    skills_dir="${CONTENT_ROOT}/skills/${lang}"
    [[ -d "$skills_dir" ]] || continue
    for skill_dir in "$skills_dir"/*/; do
        [[ -d "$skill_dir" ]] || continue
        skill_name=$(basename "$skill_dir")
        [[ "$skill_name" == .* ]] && continue
        copy_dir "$skill_dir" "${CODEX_DIR}/skills/${skill_name}" \
            "content/skills/${lang}/${skill_name}/" "skills/${skill_name}/"
    done
done
echo ""

# 4. MCP servers → config.toml (key-scoped merge, backup created)
echo -e "${CYAN}[mcp]${NC}"
if command -v uv &>/dev/null; then
    merge_args=(--config "${CODEX_DIR}/config.toml" --servers "${CONTENT_ROOT}/mcp/servers.json")
    $FORCE && merge_args+=(--force)
    $DRY_RUN && merge_args+=(--dry-run)
    uv run --with tomlkit python3 "${SCRIPT_DIR}/merge-mcp.py" "${merge_args[@]}" \
        | sed 's/^/  /'
else
    log_warn "uv not found; skipping MCP merge into config.toml"
    log_warn "Add servers from content/mcp/servers.json manually"
fi

echo ""
echo "────────────────────────────────"
if $DRY_RUN; then
    echo -e "Would copy: ${GREEN}${copied}${NC} items"
else
    echo -e "Copied: ${GREEN}${copied}${NC}, Skipped: ${YELLOW}${skipped}${NC}"
    echo ""
    echo -e "${CYAN}Restart Codex, then verify skill discovery with \$skill-name.${NC}"
fi
```

`chmod +x targets/codex/install.sh`. Remove the "not yet implemented" guards from `scripts/install.sh` (Task 3 Step 4 note).

- [ ] **Step 4: Run tests to verify they pass**

Run: `node tests/scripts/install-dispatcher.test.js` — Expected: PASS (5 tests).
Run: `node tests/run-all.js` — Expected: all pass.

- [ ] **Step 5: Manual smoke test against real Codex (this machine)**

```bash
bash scripts/install.sh -n --target codex common python node
```

Expected: dry-run plan lists instructions, AGENTS.md, skills, and MCP `SKIP mcp_servers.chrome-devtools` (already present in the real config.toml). **Dry run only — do not run a real install during implementation.**

- [ ] **Step 6: Commit**

```bash
git add targets/codex/install.sh scripts/install.sh tests/scripts/install-dispatcher.test.js
git commit -m "feat: add Codex install target (AGENTS.md, instructions, skills, MCP merge)"
```

---

### Task 7: Uninstall dispatcher + per-target uninstallers

**Files:**

- Create: `targets/claude/uninstall.sh` (relocated logic), `targets/codex/uninstall.sh`
- Modify: `scripts/uninstall.sh` (becomes dispatcher, same shape as install dispatcher)
- Test: extend `tests/scripts/install-dispatcher.test.js`

**Interfaces:**

- Consumes: `common.sh` remove helpers; content layout.
- Produces: `scripts/uninstall.sh [-n|-l|-h] [--target claude|codex|all] <language>...`. Codex uninstaller removes only files this repo installs: `instructions/<name>.md` for each `content/rules/{lang}/*.md`, `skills/<name>/` for each content skill, and `AGENTS.md`. **config.toml is left untouched** — it prints an INFO listing the `[mcp_servers.*]` names from `servers.json` for manual removal (user state must never be auto-edited on uninstall).

- [ ] **Step 1: Write the failing test**

Append to `tests/scripts/install-dispatcher.test.js`:

```javascript
test('uninstall --target codex dry-run plans removals but not config.toml', () => {
  const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-codex-un-'));
  const uninstallSh = path.join(repoRoot, 'scripts', 'uninstall.sh');
  const env = { ...process.env, HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-h-')), CODEX_HOME: codexHome, PATH: '/usr/bin:/bin' };
  const res = spawnSync('bash', [uninstallSh, '-n', '--target', 'codex', 'common'], { env, encoding: 'utf8' });
  assert.strictEqual(res.status, 0, res.stderr);
  assert.ok(res.stdout.includes('AGENTS.md'));
  assert.ok(res.stdout.includes('instructions/coding-style.md'));
  assert.ok(res.stdout.includes('mcp_servers'), 'expected manual-removal INFO for MCP');
  assert.ok(!res.stdout.includes('RM') || !res.stdout.includes('config.toml'),
    'config.toml must never be removed');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/scripts/install-dispatcher.test.js`
Expected: new test FAILS (`--target` unknown to current uninstall.sh).

- [ ] **Step 3: Split the uninstaller**

- `git mv scripts/uninstall.sh targets/claude/uninstall.sh`; fix `REPO_ROOT` (`../..`) and `source "${REPO_ROOT}/scripts/lib/common.sh"`; delete the Codex AGENTS.md block (lines 202–208 of the old file).
- New `scripts/uninstall.sh` dispatcher: copy the Task 3 dispatcher verbatim, replacing `install.sh` with `uninstall.sh` in the three exec/run lines and `log_info "Codex not detected; skipping codex target"` unchanged.

- [ ] **Step 4: Implement `targets/codex/uninstall.sh`**

Same skeleton as `targets/codex/install.sh` (flags `-n|-l|-h`, language validation, `codex_is_available` check, `DEST_LABEL`), with the body:

```bash
echo -e "${CYAN}[instructions]${NC}"
for lang in "${LANGUAGES[@]}"; do
    rules_dir="${CONTENT_ROOT}/rules/${lang}"
    [[ -d "$rules_dir" ]] || continue
    for f in "$rules_dir"/*.md; do
        [[ -f "$f" ]] || continue
        name=$(basename "$f")
        remove_file "${CODEX_DIR}/instructions/${name}" "instructions/${name}"
    done
done
cleanup_empty_dir "${CODEX_DIR}/instructions" "instructions/"
echo ""

echo -e "${CYAN}[global]${NC}"
remove_file "${CODEX_DIR}/AGENTS.md" "AGENTS.md"
echo ""

echo -e "${CYAN}[skills]${NC}"
for lang in "${LANGUAGES[@]}"; do
    skills_dir="${CONTENT_ROOT}/skills/${lang}"
    [[ -d "$skills_dir" ]] || continue
    for skill_dir in "$skills_dir"/*/; do
        [[ -d "$skill_dir" ]] || continue
        skill_name=$(basename "$skill_dir")
        [[ "$skill_name" == .* ]] && continue
        remove_dir "${CODEX_DIR}/skills/${skill_name}" "skills/${skill_name}/"
    done
done
cleanup_empty_dir "${CODEX_DIR}/skills" "skills/"
echo ""

echo -e "${CYAN}[mcp]${NC}"
log_info "config.toml is user state and is left untouched."
if command -v jq &>/dev/null; then
    while IFS= read -r name; do
        log_info "remove [mcp_servers.${name}] from ${DEST_LABEL}/config.toml manually if unwanted"
    done < <(jq -r '.mcpServers | keys[]' "${CONTENT_ROOT}/mcp/servers.json")
fi
```

Finish with the summary block (`removed`/`not_found`) copied from the claude uninstaller's tail.

- [ ] **Step 5: Run tests**

Run: `node tests/scripts/install-dispatcher.test.js` — Expected: PASS (6 tests).
Run: `node tests/run-all.js` — Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add scripts/uninstall.sh targets/claude/uninstall.sh targets/codex/uninstall.sh tests/scripts/install-dispatcher.test.js
git commit -m "feat: add --target dispatch to uninstall with Codex uninstaller"
```

---

### Task 8: Documentation, manifest notes, and final sweep

**Files:**

- Modify: `README.md`, `CONTRIBUTING.md`, `.claude-plugin/PLUGIN_SCHEMA_NOTES.md`
- Verify: `.claude-plugin/plugin.json`, `schemas/`, `examples/`, `.github/workflows/`

**Interfaces:**

- Consumes: everything above.
- Produces: docs describing the final layout and CLI.

- [ ] **Step 1: Update README.md**

- Replace the repo-structure section (directory listing) with the new `content/` + `targets/` + `scripts/` layout from the spec.
- Replace manual-install instructions with:

```bash
# Install for both Claude Code and Codex (Codex skipped if not detected)
./scripts/install.sh python common

# Claude Code only / Codex only
./scripts/install.sh --target claude python common
./scripts/install.sh --target codex python common
```

- Add a short "Codex support" section: what gets installed where (AGENTS.md + instructions/ + skills/ + config.toml MCP merge with backup), and the manual verification step: *restart Codex, run `$skill-name` (e.g. `$git-commit-msg`) to confirm skill discovery, confirm AGENTS.md is loaded.*

- [ ] **Step 2: Update CONTRIBUTING.md**

Update any contribution paths (`agents/` → `content/agents/`, etc.) and mention that new shared content lands in `content/` while target-specific install logic lands in `targets/<target>/`.

- [ ] **Step 3: Append to `.claude-plugin/PLUGIN_SCHEMA_NOTES.md`**

Add a dated note: component paths now point into `./content/...`; agents remain explicit file paths; `hooks` field still must not be added; `content/hooks/common/hooks.json` is NOT at the auto-load path `hooks/hooks.json`, so plugin hook auto-loading behavior is unchanged by the move.

- [ ] **Step 4: Validate plugin manifest**

Run: `claude plugin validate .claude-plugin/plugin.json` (if the CLI subcommand is unavailable in this environment, state so in the PR body and rely on the path checks in `tests/hooks/hooks.test.js`).

- [ ] **Step 5: Final sweep and full gate**

```bash
grep -rn "mcp-configs\|global/CLAUDE\|\"\./agents\|\"\./skills\|\"\./commands" \
  --include="*.md" --include="*.js" --include="*.json" --include="*.yml" --include="*.sh" . \
  | grep -v node_modules | grep -v "^\./\.claude/" | grep -v docs/superpowers | grep -v the-longform | grep -v the-shortform
node tests/run-all.js
npx markdownlint README.md CONTRIBUTING.md .claude-plugin/PLUGIN_SCHEMA_NOTES.md
npx eslint tests/scripts/install-dispatcher.test.js tests/scripts/codex-adapter.test.js
bash scripts/install.sh -n common node python rust typescript
bash scripts/uninstall.sh -n --target all common node python rust typescript
```

Expected: no stale references (the two guide files are upstream-authored prose and may keep old paths), all tests/lint pass, dry runs show the full dual-target plan.

- [ ] **Step 6: Commit**

```bash
git add README.md CONTRIBUTING.md .claude-plugin/PLUGIN_SCHEMA_NOTES.md
git commit -m "docs: document dual-target layout and --target install flow"
```

---

## Completion

After all tasks: run the full gate one more time (`node tests/run-all.js`), then follow `superpowers:finishing-a-development-branch`. Get explicit user confirmation before creating the PR (per user's git workflow rules). The PR body should include the verification results and the manual Codex verification checklist (restart Codex → `$skill-name` discovery → AGENTS.md loaded → `config.toml` diff review).
