---
paths:
  - "**/*.css"
  - "**/*.scss"
  - "**/*.sass"
  - "**/*.less"
  - "**/*.html"
  - "**/*.tsx"
  - "**/*.jsx"
  - "**/*.vue"
  - "**/*.svelte"
---
> This file extends [common/hooks.md](../common/hooks.md) with web-specific hook recommendations.

# Web Hooks

## Recommended PostToolUse Hooks

Prefer project-local tooling. Do not wire hooks to remote one-off package execution.

### Format on Save

Use the project's existing formatter entrypoint after edits:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "command": "pnpm prettier --write \"$FILE_PATH\"",
        "description": "Format edited frontend files"
      }
    ]
  }
}
```

Equivalent local commands via `yarn prettier` or `npm exec prettier --` are fine when they use repo-owned dependencies.

### Lint Check

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "command": "pnpm eslint --fix \"$FILE_PATH\"",
        "description": "Run ESLint on edited frontend files"
      }
    ]
  }
}
```

### Type Check

Use `--incremental` so re-runs reuse the previous `.tsbuildinfo` (1-3s on unchanged code instead of 30-60s every time). Wrap in `timeout` so a stuck tsc gets reaped by the OS instead of accumulating across edits — this prevents the multi-process buildup that happens when edits fire faster than tsc finishes.

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "command": "timeout 60 pnpm tsc --noEmit --pretty false --incremental --tsBuildInfoFile node_modules/.cache/tsc-hook.tsbuildinfo",
        "description": "Type-check after frontend edits (incremental + timeout-capped)"
      }
    ]
  }
}
```

**Why both flags matter:**
- Without `--incremental`, every edit re-checks the entire program from scratch. On a real Next.js project this stacks fast: edits at 5-10s intervals + 30-60s tsc runs = N concurrent tsc processes.
- Without `timeout`, a tsc that hangs (transitive dep change, type-checker stuck on a recursive type) never exits and orphans when the parent shell does.
- `--tsBuildInfoFile` is required because `--noEmit` normally suppresses the buildinfo write; specifying the path explicitly keeps incremental working.

If you're on Windows without GNU coreutils, swap `timeout 60` for a PowerShell wrapper or rely on a Stop/SessionEnd hook to sweep stale tsc processes.

### CSS Lint

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "command": "pnpm stylelint --fix \"$FILE_PATH\"",
        "description": "Lint edited stylesheets"
      }
    ]
  }
}
```

## PreToolUse Hooks

### Notice Oversized Writes (do not block)

Count **code lines** from the tool input content, not total lines, and **warn instead of
blocking**.

Two reasons this is a notice and not a gate:

1. **Blocking on a line count has a cheap wrong answer.** The fastest way past the gate is
   to move code into a sibling file or delete comments — both make the code worse while
   the number goes green. A notice makes someone look; a gate makes someone comply.
2. **Total lines taxes documentation at the same rate as code.** A file carrying hard-won
   explanation is not a large file. Exclude comment-only and blank lines first.

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Write",
        "command": "node -e \"let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const i=JSON.parse(d);const c=i.tool_input?.content||'';const n=c.split('\\n').filter(l=>!/^\\s*(\\/\\/|#|\\*|$)/.test(l)).length;if(n>400){console.error('[Hook] NOTICE: '+n+' code lines (comments excluded). Over 400 wants a written reason, or a split by responsibility — not a split to buy line budget.')}console.log(d)})\"",
        "description": "Warn (never block) when a write exceeds 400 code lines"
      }
    ]
  }
}
```

The comment pattern above (`//`, `#`, `*`) is a rough multi-language approximation — tighten
it for the language you actually write. The threshold is the "owe a reason" line from
[common/coding-style.md](../common/coding-style.md), not a hard ceiling.

## Stop Hooks

### Final Build Verification

```json
{
  "hooks": {
    "Stop": [
      {
        "command": "pnpm build",
        "description": "Verify the production build at session end"
      }
    ]
  }
}
```

## Ordering

Recommended order:
1. format
2. lint
3. type check
4. build verification
