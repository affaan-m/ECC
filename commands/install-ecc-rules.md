---
description: Detect the project's tech stack and install only the matching ECC rule directories into .claude/rules/ecc/ (or ~/.claude/rules/ecc/), using ECC's documented manual-copy method.
---

# Install ECC Rules

## Purpose

Install only the ECC rule directories that match this project's actual tech stack, using the manual-copy method documented in `docs/ECC-RULES_README.md` ("Option 2: Manual Installation") — whole directories copied as-is, never flattened.

This command is intentionally narrower than `/project-init`: it does not touch skills, agents, hooks, or platform configs, and it never installs the full `rules/` tree. It exists for users who already have ECC (as a plugin, or via `/project-init`) and only want the rule directories relevant to *this* project's stack, selected explicitly, with no unrelated language rules added to their repo.

## Usage

```
/install-ecc-rules
```

No arguments. The command is fully interactive: it analyzes the project, asks for confirmation before installing anything, and asks how to resolve conflicts with rules that are already installed.

## Workflow

### 1. Clone or update ECC in a temp directory

ECC needs real network access here. **Do not run this step inside a network-isolated sandbox** — if the command-execution tool offers a flag to disable sandboxing, use it for the commands in this step. A `git clone`/`git pull` that fails inside a sandboxed shell (no network egress) does not mean the user has no internet — it means the execution environment itself is isolated. Confirm that before reporting "network failure" to the user.

Likewise, if `~/.gitconfig` (or the `HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY` env vars) points at a local proxy that isn't running (e.g. a SOCKS5 proxy at `127.0.0.1:1080`), the clone/pull will fail even though the user's internet works fine. **Never edit `~/.gitconfig` or any global user config to work around this.** Instead, bypass the proxy scoped to just this command, e.g.:

```bash
git -c http.proxy= -c https.proxy= clone https://github.com/affaan-m/ECC.git /tmp/ECC
# or, if the proxy comes from env vars:
env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY git clone https://github.com/affaan-m/ECC.git /tmp/ECC
```

```bash
if [ -d /tmp/ECC/.git ]; then
  git -C /tmp/ECC pull --ff-only
else
  git clone https://github.com/affaan-m/ECC.git /tmp/ECC
fi
```

**Never `rm -rf /tmp/ECC` to reset the clone before trying to update it** — that's needlessly destructive. If `/tmp/ECC` is already a valid git clone, update it in place. If `git pull --ff-only` fails because history diverged (e.g. the local clone went stale after an upstream force-push), fall back to:

```bash
git -C /tmp/ECC fetch origin
git -C /tmp/ECC reset --hard origin/HEAD
```

This only rewrites the disposable clone in `/tmp/ECC` — it never touches anything in the user's project.

#### Clone/update failure

If `git clone`/`git pull`/`git fetch` fails for any reason (no connectivity, unreachable host, timeout, sandbox blocking network egress, etc.), **stop immediately** and report the error to the user. Do not silently fall back to any other source.

- Before reporting "network failure," check whether the command actually ran with full/non-sandboxed access. If a disable-sandbox option existed and wasn't used, retry with it before concluding it's a connectivity issue.
- Also check whether a proxy (`~/.gitconfig` or `HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY`) points at an unreachable host/port. If so, bypass the proxy scoped to just this command (never edit `~/.gitconfig` or any global config) before concluding it's a real connectivity issue.
- **Never** treat an already-installed copy of ECC — the plugin marketplace clone (`~/.claude/plugins/marketplaces/ecc/rules`), `~/.claude/rules/ecc/`, `.claude/rules/ecc/`, a plugin cache directory, or anything else already on disk — as a substitute for `/tmp/ECC`. Those copies may be outdated, a different version, or incomplete relative to the official repo, and silently substituting them breaks the guarantee that this command always installs from the latest official source.
- **Never** go searching the filesystem for an "alternative source" to route around the network failure on your own initiative.
- Report the exact clone/network error to the user.
- Ask how to proceed, offering only:
  1. Retry (network may have recovered, or rerun with sandbox disabled).
  2. Cancel (no changes made).
  3. If the user explicitly points to a local directory containing an ECC copy to use as the source instead, use that path in place of `/tmp/ECC` for the rest of the flow — but only on the user's explicit instruction, never on your own.
- Do not proceed to any later step (listing rules, stack detection, copying files) until the clone failure is resolved one of these ways.

### 2. List available rule directories

```bash
ls /tmp/ECC/rules/
```

Use this real listing as the source of truth — the set of stacks ECC supports changes over time; do not rely on a hardcoded list.

### 3. Detect the project's stack

Inspect the current project (not `/tmp/ECC`) for stack signals: `package.json`, `go.mod`, `requirements.txt` / `pyproject.toml`, `composer.json`, `Gemfile`, `Package.swift`, `Cargo.toml`, `pom.xml` / `build.gradle`, etc. Cross-reference detected stacks against the directories listed in step 2.

### 4. Detect existing ECC installation scope (global vs. local)

```bash
test -d ~/.claude/rules/ecc && echo "ECC_GLOBAL_PRESENT"
test -d .claude/rules/ecc  && echo "ECC_LOCAL_PRESENT"
```

**Core rule:** `common` may only be offered as a **global** install target if `~/.claude/rules/ecc/` already exists — i.e. there is existing evidence of a global ECC install. Installing `common` globally when the user has only ever used ECC locally in this one project would silently affect every other project on their machine, even ones that never had ECC. Never do this, and never offer it as an option, unless global evidence already exists.

- **If `~/.claude/rules/ecc/` exists** (global ECC already in use): check whether `common` exists in `~/.claude/rules/ecc/common` and/or `.claude/rules/ecc/common`. If it exists in neither, **ask the user** where to install `common` — global or local — and copy it to the chosen destination.
- **If `~/.claude/rules/ecc/` does not exist**: never offer the global option. Check only `.claude/rules/ecc/common`. If missing, silently include `common` in the local copy set — no need to ask, local is the only sensible destination.

### 5. Resolve conflicts with rules already installed locally

For each stack directory the user intends to install, check whether it already exists:

```bash
test -d .claude/rules/ecc/<stack> && echo "ALREADY_INSTALLED:<stack>"
```

If it does, **ask the user** what to do with that entire directory (never at the individual-file level):

| Choice | Action |
|--------|--------|
| Reinstall | `rm -rf .claude/rules/ecc/<stack> && cp -r /tmp/ECC/rules/<stack> .claude/rules/ecc/` |
| Remove | `rm -rf .claude/rules/ecc/<stack>` (nothing copied in its place) |
| Replace | `rm -rf .claude/rules/ecc/<stack> && cp -r /tmp/ECC/rules/<other-stack> .claude/rules/ecc/` (ask which stack replaces it) |
| Expand | Keep the existing directory untouched; copy the new, not-yet-installed stacks alongside it |

### 5.1 Check whether a candidate stack is already available globally

This isn't just about `common` (step 4) — any stack directory can already be installed globally. Before including a candidate stack (step 3) in the selection options, also check whether it already exists in the **global** scope:

```bash
test -d ~/.claude/rules/ecc/<stack> && echo "ALREADY_GLOBAL:<stack>"
```

If a candidate stack already exists globally and does **not** exist locally, it already applies to this project automatically — global rules apply to every project the user works in. Installing it locally too creates a redundant copy.

In that case, **before building the final selection options**, tell the user: "`<stack>` is already installed globally at `~/.claude/rules/ecc/<stack>` and already applies to this project — no need to install it again." Ask what they prefer:

1. **Skip it** (recommended): don't install this stack locally, since the global copy already covers the project.
2. **Install it locally anyway**: only useful if the user wants a project-specific copy (e.g. to customize/pin something different from the global version just for this project).

Drop any stack the user chooses to skip from the candidate set before presenting the Recommended/Minimal options in step 6.

### 6. Present selection options

- **Exactly one matching directory:** show it and ask the user to confirm the install.
- **More than one matching directory:** present two options and list the exact directory names for each:
  - **Option 1 (Recommended):** every directory relevant to the stack (e.g. for Nuxt 4: `nuxt`, `vue`, `typescript`, `web`).
  - **Option 2 (Minimal):** only the primary framework/ecosystem directory (e.g. just `nuxt`).
  - Ask: `1` for Recommended, `2` for Minimal, `3` to cancel.

Resolve any step-5 or step-5.1 conflicts before asking for this final confirmation.

### 7. Execute (only after explicit user confirmation)

```bash
mkdir -p .claude/rules/ecc
# and, only if the user chose global common in step 4:
mkdir -p ~/.claude/rules/ecc
```

Copy each selected directory whole — **never flatten, never use `/*`** — to preserve structure and the relative `../common/` references used by language-specific rule files:

```bash
# Correct:
cp -r /tmp/ECC/rules/typescript .claude/rules/ecc/

# Wrong — never do this:
cp /tmp/ECC/rules/typescript/* .claude/rules/ecc/
```

Then confirm:

```bash
find .claude/rules/ecc -maxdepth 2
```

Do not delete `/tmp/ECC` afterward — it's left in place so the next run can update the clone (step 1) instead of cloning from scratch.

## Output

- The exact list of directories installed (and where — local or global for `common`).
- The exact list of directories removed or replaced, if any conflicts were resolved.
- The final directory tree under `.claude/rules/ecc/` (and `~/.claude/rules/ecc/` if applicable).

## Why this exists alongside `/project-init`

`/project-init` installs the full ECC surface (skills, agents, rules, hooks, platform configs) through the official `scripts/install-plan.js` / `scripts/install-apply.js` manifest tooling. Its `rules-core` module treats `rules/` as a single unit — there is no per-stack selection, so every language's rules get installed regardless of the project's actual stack.

`/install-ecc-rules` fills a narrower, real gap: a user who already has ECC set up (globally, as a plugin, or via `/project-init`) and wants *only* the rule directories that match one specific project, with no unrelated languages copied in and no changes to skills, agents, or hooks. It automates the manual-copy method already documented in `docs/ECC-RULES_README.md` ("Option 2: Manual Installation") instead of introducing a new install mechanism.
