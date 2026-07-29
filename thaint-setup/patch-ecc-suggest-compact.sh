#!/usr/bin/env bash
# patch-ecc-suggest-compact.sh — re-add the [Delegation] nudge to ECC's
# suggest-compact hook after every setup_claude.sh run.
#
# WHY: ~/.claude/scripts/hooks/suggest-compact.js is ECC-managed
# (install-state.json: kind "copy-file", module "hooks-runtime", ownership
# "managed"). scripts/lib/install/apply.js copies it with a bare
# fs.copyFileSync — no existence check, no merge, no backup; only
# settings.json gets merge treatment. So every setup_claude.sh run wipes any
# local edit to that file. This re-applies the one edit we care about: a
# second nudge on the same tool-call counter, telling the session to hand the
# next task to a subagent/fork (CLAUDE.md §7).
#
# Patches the INSTALLED copy under ~/.claude only. Never the ECC clone:
# setup_claude.sh's resolve_source runs `git checkout` on it every run, which
# would revert the patch or fail on a dirty tree.
#
# Idempotent: a file that already mentions [Delegation] is skipped.
#
# ECC's own [StrategicCompact] nudges go to stderr via log() and therefore reach
# neither the model nor the transcript — a known v1.10.0 bug (fixed upstream in
# v2.0.0). Left unfixed on purpose; the inserted block documents why.
#
# ANCHOR IS VERSION-SPECIFIC (ECC v1.10.0 shape). The anchor requires the
# StrategicCompact interval block to report via a bare log(...) call and to be
# the last statement before main()'s process.exit(0). Newer ECC rewrites of
# this hook (the ~10 KB context-size version) collect messages into a
# `messages` array and emit them as hookSpecificOutput.additionalContext JSON
# — the anchor does NOT match there, and this script fails loudly instead of
# writing something half-right. That failure is intentional: on that version
# the nudge has to be re-authored as a `messages.push(...)` line, because a
# bare log() only reaches the debug log, not the model.
#
# Testing on a throwaway copy: override HOME, e.g.
#   mkdir -p /tmp/t/.claude/scripts/hooks && cp <src> /tmp/t/.claude/scripts/hooks/
#   HOME=/tmp/t bash patch-ecc-suggest-compact.sh --verbose
# shellcheck shell=bash

set -euo pipefail

# ── Constants ────────────────────────────────────────────────────────────────
readonly TAG="ecc-delegation"
readonly CLAUDE_HOME="${HOME}/.claude"
readonly BACKUP_DIR="${CLAUDE_HOME}/backups"
readonly TARGET="${CLAUDE_HOME}/scripts/hooks/suggest-compact.js"

# Idempotence marker: present iff the nudge is already in the file.
readonly MARKER='[Delegation]'

# Anchor: the StrategicCompact interval block (which proves `count`,
# `threshold` and `log` are all in scope and that log() is the reporting
# mechanism) immediately followed by main()'s `process.exit(0);` and main()'s
# closing brace. $1 = anchor block, $2 = the exit + closing brace.
readonly ANCHOR_RE='(^  if \(count > threshold && \(count - threshold\) % 25 === 0\) \{\n    log\(`\[StrategicCompact\] \$\{count\} tool calls[^\n]*\n  \}\n)(\n  process\.exit\(0\);\n\}\n)'

# ── Mutable state ────────────────────────────────────────────────────────────
DRY_RUN=0
VERBOSE=0
STAMP=""
BLOCK=""
TMP_LAST=""
TMP_FILES=()

N_PATCHED=0
N_ALREADY=0
N_FAILED=0

# ── Cleanup ──────────────────────────────────────────────────────────────────
cleanup() {
  (( ${#TMP_FILES[@]} == 0 )) && return 0
  local f
  for f in "${TMP_FILES[@]}"; do
    [[ -n "$f" && -e "$f" ]] && rm -f "$f"
  done
  return 0
}
trap cleanup EXIT

# Sets TMP_LAST rather than echoing the path: called through $(...) the
# TMP_FILES append would happen in a subshell and the EXIT trap in this shell
# would never see it, leaving the temp file behind on every run.
new_tmp() {
  local ext="${1:-}"
  TMP_LAST="$(mktemp "${TMPDIR:-/tmp}/ecc-delegation.XXXXXX${ext}")"
  TMP_FILES+=("$TMP_LAST")
}

# ── Logging ──────────────────────────────────────────────────────────────────
log()  { printf '[%s] %s\n' "$TAG" "$*"; }
warn() { printf '[%s] warn: %s\n' "$TAG" "$*" >&2; }
die()  { printf '[%s] error: %s\n' "$TAG" "$*" >&2; exit 1; }

require_cmd() {
  local c
  for c in "$@"; do
    command -v "$c" >/dev/null || die "required command missing: $c"
  done
}

# ── Usage / args ─────────────────────────────────────────────────────────────
usage() {
  cat <<EOF
Usage: $0 [--dry-run] [--verbose]

Re-inserts the "${MARKER}" nudge into the ECC suggest-compact hook installed
at ${TARGET}, which setup_claude.sh overwrites on every run.

Idempotent: skipped if the file already contains "${MARKER}".
Backups: ${BACKUP_DIR}/

The anchor targets ECC v1.10.0's hook shape (bare log() calls, exit at the end
of main()). On a newer ECC rewrite that batches messages into
hookSpecificOutput JSON the anchor will not match and this exits non-zero —
re-author the nudge by hand there, as a messages.push(...) line.

Options:
  --dry-run       Report what would change; write nothing
  --verbose, -v   Print a unified diff of the patch
  -h, --help      Show this help
EOF
}

parse_args() {
  while (( $# )); do
    case "$1" in
      --dry-run)    DRY_RUN=1; shift ;;
      --verbose|-v) VERBOSE=1; shift ;;
      -h|--help)    usage; exit 0 ;;
      *)            die "unknown arg: $1 (try --help)" ;;
    esac
  done
}

# ── Patch payload ────────────────────────────────────────────────────────────
# Leading blank line separates it from the StrategicCompact block; the anchor's
# $2 supplies the blank line before process.exit(0).
block_source() {
  cat <<'EOF'

  // Same counter also signals "this session is carrying a lot of work" — the
  // condition under which the next task belongs in a subagent/fork. CLAUDE.md §7.
  //
  // Emitted as hookSpecificOutput.additionalContext on stdout, not via log():
  // a PreToolUse hook's stderr is only surfaced in the debug log when the hook
  // exits 0, so a log() nudge never reaches the model that has to act on it.
  //
  // The two [StrategicCompact] nudges above still report via log() — i.e.
  // stderr — which a PreToolUse hook that exits 0 surfaces in neither the model
  // context nor the transcript, so nobody ever sees them. That is an ECC v1.10.0
  // bug; upstream fixed it in v2.0.0 by collecting every message and emitting a
  // single additionalContext payload. Deliberately not fixed here: rewriting
  // upstream's own lines would widen this patch's anchor and make it brittler.
  if (count === threshold || (count > threshold && (count - threshold) % 25 === 0)) {
    const payload = JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        additionalContext: `[Delegation] ${count} tool calls - hand the next task to a subagent/fork`
      }
    });
    // Gate the exit on the write callback: process.exit() discards a stdout
    // write that has not drained yet (stdout is an async pipe under the hook
    // runner), which would silently drop the payload. Returning here keeps
    // this the only exit on this path.
    process.stdout.write(`${payload}\n`, () => process.exit(0));
    return;
  }
EOF
}

# ── Per-file patching ────────────────────────────────────────────────────────
# Writes the rewritten content of $1 to $2. Non-zero if the anchor is missing.
transform() {
  local file="$1" out="$2"
  # Passed through the environment, not the perl source: the payload has
  # backticks and ${...} that would need double escaping inline. (Separate env
  # names because ANCHOR_RE is readonly and cannot be re-assigned per-command.)
  BLOCK="$BLOCK" ANCHOR="$ANCHOR_RE" perl -0777 -ne '
    my $n = s/$ENV{ANCHOR}/$1$ENV{BLOCK}$2/m;
    exit 3 unless $n == 1;
    print;
  ' "$file" > "$out"
}

# Syntax-checks a candidate file. Returns non-zero (and prints why) on failure.
syntax_check() {
  local file="$1" ext="$2"
  case "$ext" in
    .js) node --check "$file" ;;
    .sh) bash -n "$file" ;;
    *)   die "no syntax checker for '$ext'" ;;
  esac
}

backup_file() {
  local file="$1"
  # Flatten the path relative to $CLAUDE_HOME so same-named files in different
  # directories cannot collide in the flat backup directory.
  local rel="${file#"${CLAUDE_HOME}"/}"
  local out="${BACKUP_DIR}/${rel//\//_}.bak-${STAMP}-$$"
  mkdir -p "$BACKUP_DIR"
  cp "$file" "$out"
  log "  backup: ${out#"${CLAUDE_HOME}"/}"
}

patch_file() {
  local file="$1"
  local ext=".${file##*.}"
  local rel="${file#"${CLAUDE_HOME}"/}"

  if grep -qF "$MARKER" "$file"; then
    log "skip (already patched): $rel"
    (( N_ALREADY++ )) || true
    return 0
  fi

  local tmp
  new_tmp "$ext"
  tmp="$TMP_LAST"
  if ! transform "$file" "$tmp"; then
    warn "anchor not found in $rel — the nudge is NOT installed."
    warn "  Expected ECC v1.10.0's shape: the StrategicCompact interval block"
    warn "  reporting via log(...), directly before main()'s process.exit(0)."
    warn "  ECC has most likely rewritten this hook; re-author the nudge by"
    warn "  hand (see the header of $0) and update the anchor."
    (( N_FAILED++ )) || true
    return 0
  fi

  # Validate BEFORE touching the original — a broken hook fails silently.
  local check_out
  if ! check_out="$(syntax_check "$tmp" "$ext" 2>&1)"; then
    warn "skip (syntax check failed after rewrite): $rel"
    printf '%s\n' "$check_out" >&2
    (( N_FAILED++ )) || true
    return 0
  fi

  if (( VERBOSE )); then
    diff -u "$file" "$tmp" | sed "s|^|[$TAG] |" || true
  fi

  if (( DRY_RUN )); then
    log "would patch: $rel"
  else
    backup_file "$file"
    # Preserve the original inode and mode; hooks are often 0700.
    cat "$tmp" > "$file"
    log "patched: $rel"
  fi

  (( N_PATCHED++ )) || true
  return 0
}

# ── Main ─────────────────────────────────────────────────────────────────────
main() {
  parse_args "$@"
  require_cmd perl node grep diff

  STAMP="$(date +%Y%m%d-%H%M%S)"
  BLOCK="$(block_source)"$'\n'

  [[ -f "$TARGET" ]] || die "target not found: $TARGET (run install_hooks_runtime first)"

  (( DRY_RUN )) && log "DRY RUN — no files will be written"

  patch_file "$TARGET"

  log "─────────────────────────────────────────"
  log "patched:            $N_PATCHED"
  log "already patched:    $N_ALREADY"
  log "failed/unhandled:   $N_FAILED"
  (( N_FAILED == 0 )) || die "$N_FAILED file(s) needed manual attention (see warnings)"
  log "done"
}

main "$@"
