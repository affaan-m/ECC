#!/usr/bin/env bash
# patch-ecc-session-id.sh — fix ECC hooks reading the wrong session-id env var.
#
# Claude Code exports CLAUDE_CODE_SESSION_ID into hook subprocesses
# (code.claude.com/docs/en/env-vars). Everything-Claude-Code (through v1.10.0)
# reads CLAUDE_SESSION_ID instead, so every hook that keys state by session id
# falls back to 'default' and shares one bucket across all sessions forever.
#
# This patches the INSTALLED copies under ~/.claude only. Never the ECC clone:
# setup_claude.sh's resolve_source runs `git checkout` on it every run, which
# would revert the patch or fail on a dirty tree.
#
# Idempotent: a file that already mentions CLAUDE_CODE_SESSION_ID is skipped,
# because the replacement keeps the old name as a fallback and a second blind
# pass would nest it (CODE_ID || (CODE_ID || ID)).
# shellcheck shell=bash

set -euo pipefail

# ── Constants ────────────────────────────────────────────────────────────────
readonly TAG="ecc-sid"
readonly CLAUDE_HOME="${HOME}/.claude"
readonly BACKUP_DIR="${CLAUDE_HOME}/backups"
readonly OLD_VAR="CLAUDE_SESSION_ID"
readonly NEW_VAR="CLAUDE_CODE_SESSION_ID"

# Directories scanned for hook/lib sources.
readonly SCAN_DIRS=(
  "${CLAUDE_HOME}/scripts"
  "${CLAUDE_HOME}/skills"
)

# JS: process.env.X and bare env.X (session-activity-tracker takes env as a
# parameter). Comments and log strings are deliberately left untouched — they
# carry no behaviour, and rewriting prose is where a blind sed goes wrong.
readonly JS_SUBST='s/\b((?:process\.)?env)\.CLAUDE_SESSION_ID\b/($1.CLAUDE_CODE_SESSION_ID || $1.CLAUDE_SESSION_ID)/g'
readonly JS_COUNT='$c += () = /\b(?:process\.)?env\.CLAUDE_SESSION_ID\b/g; END { print $c + 0 }'

# Bash: ${CLAUDE_SESSION_ID:-DEFAULT} where DEFAULT nests at most one ${...}
# (covers ECC's `${CLAUDE_SESSION_ID:-${PPID:-default}}`). Deeper nesting is
# left alone and reported — balanced-brace rewriting is not worth the risk.
readonly SH_SUBST='s/\$\{CLAUDE_SESSION_ID:-((?:[^{}]|\$\{[^{}]*\})*)\}/\${CLAUDE_CODE_SESSION_ID:-\${CLAUDE_SESSION_ID:-$1}}/g'
readonly SH_COUNT='$c += () = /\$\{CLAUDE_SESSION_ID:-/g; END { print $c + 0 }'

# ── Mutable state ────────────────────────────────────────────────────────────
DRY_RUN=0
VERBOSE=0
STAMP=""
TMP_LAST=""
TMP_FILES=()

N_PATCHED=0
N_OCCURRENCES=0
N_ALREADY=0
N_NO_CODE_REF=0
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
  TMP_LAST="$(mktemp "${TMPDIR:-/tmp}/ecc-sid.XXXXXX${ext}")"
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

Rewrites ${OLD_VAR} reads to ${NEW_VAR} (keeping the old name as a
fallback) in the ECC hooks installed under ${CLAUDE_HOME}.

Scans: ${SCAN_DIRS[*]}
Files: *.js, *.sh
Backups: ${BACKUP_DIR}/

Options:
  --dry-run       Report what would change; write nothing
  --verbose, -v   Print a unified diff per patched file
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

# ── Per-file patching ────────────────────────────────────────────────────────
# Echoes the number of code-level occurrences of $OLD_VAR in a file.
count_refs() {
  local file="$1" ext="$2"
  case "$ext" in
    .js) perl -ne "$JS_COUNT" "$file" ;;
    .sh) perl -ne "$SH_COUNT" "$file" ;;
  esac
}

# Writes the rewritten content of $1 to $3.
transform() {
  local file="$1" ext="$2" out="$3"
  case "$ext" in
    .js) perl -pe "$JS_SUBST" "$file" > "$out" ;;
    .sh) perl -pe "$SH_SUBST" "$file" > "$out" ;;
  esac
}

# Syntax-checks a candidate file. Returns non-zero (and prints why) on failure.
syntax_check() {
  local file="$1" ext="$2"
  case "$ext" in
    .js) node --check "$file" ;;
    .sh) bash -n "$file" ;;
  esac
}

backup_file() {
  local file="$1"
  # Flatten the path relative to $CLAUDE_HOME so hooks/utils.js and
  # lib/utils.js cannot collide in the flat backup directory.
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

  if grep -qF "$NEW_VAR" "$file"; then
    log "skip (already patched): $rel"
    (( N_ALREADY++ )) || true
    return 0
  fi

  local n
  n="$(count_refs "$file" "$ext")"
  if (( n == 0 )); then
    log "skip (doc/comment mention only, no code read): $rel"
    (( N_NO_CODE_REF++ )) || true
    return 0
  fi

  local tmp
  new_tmp "$ext"
  tmp="$TMP_LAST"
  transform "$file" "$ext" "$tmp"

  if cmp -s "$file" "$tmp"; then
    warn "skip (unrecognised \${$OLD_VAR...} form, nothing rewritten): $rel"
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
    log "would patch ($n occurrence(s)): $rel"
  else
    backup_file "$file"
    # Preserve the original mode; hooks are often 0700.
    cat "$tmp" > "$file"
    log "patched ($n occurrence(s)): $rel"
  fi

  (( N_PATCHED++ )) || true
  (( N_OCCURRENCES += n )) || true
  return 0
}

# ── Main ─────────────────────────────────────────────────────────────────────
main() {
  parse_args "$@"
  require_cmd perl node grep diff cmp

  STAMP="$(date +%Y%m%d-%H%M%S)"

  local dirs=() d
  for d in "${SCAN_DIRS[@]}"; do
    [[ -d "$d" ]] && dirs+=("$d") || warn "not found, skipped: $d"
  done
  (( ${#dirs[@]} )) || die "nothing to scan under $CLAUDE_HOME"

  (( DRY_RUN )) && log "DRY RUN — no files will be written"
  log "scanning: ${dirs[*]}"

  local files=() f
  while IFS= read -r -d '' f; do
    grep -qF "$OLD_VAR" "$f" && files+=("$f")
  done < <(find "${dirs[@]}" -type f \( -name '*.js' -o -name '*.sh' \) -print0)

  if (( ${#files[@]} == 0 )); then
    log "no file mentions $OLD_VAR — nothing to do"
    return 0
  fi

  log "${#files[@]} file(s) mention $OLD_VAR"
  for f in "${files[@]}"; do
    patch_file "$f"
  done

  log "─────────────────────────────────────────"
  log "patched:            $N_PATCHED file(s), $N_OCCURRENCES occurrence(s)"
  log "already patched:    $N_ALREADY"
  log "comment-only:       $N_NO_CODE_REF"
  log "failed/unhandled:   $N_FAILED"
  (( N_FAILED == 0 )) || die "$N_FAILED file(s) needed manual attention (see warnings)"
  log "done"
}

main "$@"
