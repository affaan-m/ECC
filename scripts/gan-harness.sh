#!/bin/bash
# gan-harness.sh — GAN-Style Generator-Evaluator Harness Orchestrator
#
# Inspired by Anthropic's "Harness Design for Long-Running Application Development"
# https://www.anthropic.com/engineering/harness-design-long-running-apps
#
# Usage:
#   ./scripts/gan-harness.sh "Build a music streaming dashboard"
#   GAN_MAX_ITERATIONS=10 GAN_PASS_THRESHOLD=8.0 ./scripts/gan-harness.sh "Build a Kanban board"
#
# Environment Variables:
#   GAN_MAX_ITERATIONS  — Max generator-evaluator cycles (default: 15)
#   GAN_PASS_THRESHOLD  — Weighted score to pass, 1-10 (default: 7.0)
#   GAN_PLANNER_MODEL   — Model for planner (default: sonnet)
#   GAN_GENERATOR_MODEL — Model for generator (default: sonnet)
#   GAN_EVALUATOR_MODEL — Model for evaluator (default: sonnet)
#   GAN_DEV_SERVER_PORT — Port for live app (default: 3000)
#   GAN_DEV_SERVER_CMD  — Command to start dev server (default: "npm run dev")
#   GAN_PROJECT_DIR     — Working directory (default: current dir)
#   GAN_SKIP_PLANNER    — Set to "true" to skip planner phase
#   GAN_EVAL_MODE       — playwright, screenshot, or code-only (default: playwright)
#                        playwright requires a connected MCP server named "playwright"

set -euo pipefail

# ─── Configuration ───────────────────────────────────────────────────────────

BRIEF="${1:?Usage: ./scripts/gan-harness.sh \"description of what to build\"}"
MAX_ITERATIONS="${GAN_MAX_ITERATIONS:-15}"
PASS_THRESHOLD="${GAN_PASS_THRESHOLD:-7.0}"
PLANNER_MODEL="${GAN_PLANNER_MODEL:-sonnet}"
GENERATOR_MODEL="${GAN_GENERATOR_MODEL:-sonnet}"
EVALUATOR_MODEL="${GAN_EVALUATOR_MODEL:-sonnet}"
DEV_PORT="${GAN_DEV_SERVER_PORT:-3000}"
DEV_CMD="${GAN_DEV_SERVER_CMD:-npm run dev}"
PROJECT_DIR="${GAN_PROJECT_DIR:-.}"
SKIP_PLANNER="${GAN_SKIP_PLANNER:-false}"
EVAL_MODE="${GAN_EVAL_MODE:-playwright}"

HARNESS_DIR="${PROJECT_DIR}/gan-harness"
FEEDBACK_DIR="${HARNESS_DIR}/feedback"
SCREENSHOTS_DIR="${HARNESS_DIR}/screenshots"
START_TIME=$(date +%s)

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m'

# ─── Helpers ─────────────────────────────────────────────────────────────────

log()    { echo -e "${BLUE}[GAN-HARNESS]${NC} $*"; }
ok()     { echo -e "${GREEN}[✓]${NC} $*"; }
warn()   { echo -e "${YELLOW}[WARN]${NC} $*"; }
fail()   { echo -e "${RED}[✗]${NC} $*"; }
phase()  { echo -e "\n${PURPLE}═══════════════════════════════════════════════${NC}"; echo -e "${PURPLE}  $*${NC}"; echo -e "${PURPLE}═══════════════════════════════════════════════${NC}\n"; }

extract_score() {
  # Extract the TOTAL weighted score from a feedback file
  local file="$1"
  awk '
    /\*\*TOTAL\*\*/ {
      total_line = $0
      total = ""
      while (match(total_line, /[0-9]+[.][0-9]+/)) {
        total = substr(total_line, RSTART, RLENGTH)
        total_line = substr(total_line, RSTART + RLENGTH)
      }
      if (total != "") {
        print total
        found = 1
        exit
      }
    }
    /Verdict:/ && /[Ss]core[[:space:]]*[:=]?[[:space:]]*[0-9]+[.][0-9]+/ {
      verdict = $0
      sub(/^.*[Ss]core[[:space:]]*[:=]?[[:space:]]*/, "", verdict)
      if (match(verdict, /^[0-9]+[.][0-9]+/)) {
        verdict = substr(verdict, RSTART, RLENGTH)
      } else {
        verdict = ""
      }
    }
    END {
      if (!found) print (verdict != "" ? verdict : "0.0")
    }
  ' "$file" 2>/dev/null
}

score_passes() {
  local score="$1"
  local threshold="$2"
  awk -v s="$score" -v t="$threshold" 'BEGIN { exit !(s >= t) }'
}

playwright_mcp_is_connected() {
  local status
  local status_value
  local check_mark
  local heavy_check_mark
  status=$(NO_COLOR=1 claude mcp get playwright 2>/dev/null) || return 1
  status_value=$(printf '%s\n' "$status" | awk '
    /^[[:space:]]*Status:[[:space:]]*/ {
      sub(/^[[:space:]]*Status:[[:space:]]*/, "")
      sub(/[[:space:]]*$/, "")
      print
      exit
    }
  ')
  check_mark=$(printf '\342\234\223')
  heavy_check_mark=$(printf '\342\234\224')

  [ "$status_value" = "$check_mark Connected" ] || \
    [ "$status_value" = "$heavy_check_mark Connected" ]
}

evaluator_tools_for_mode() {
  local base_tools="Read,Write,Bash,Grep,Glob"
  local playwright_tools="mcp__playwright__browser_navigate,mcp__playwright__browser_click,mcp__playwright__browser_take_screenshot,mcp__playwright__browser_snapshot,mcp__playwright__browser_type,mcp__playwright__browser_fill_form"

  if [ "$1" = "playwright" ]; then
    printf '%s,%s\n' "$base_tools" "$playwright_tools"
  else
    printf '%s\n' "$base_tools"
  fi
}

elapsed() {
  local now=$(date +%s)
  local diff=$((now - START_TIME))
  printf '%dh %dm %ds' $((diff/3600)) $((diff%3600/60)) $((diff%60))
}

# ─── Setup ───────────────────────────────────────────────────────────────────

case "$EVAL_MODE" in
  playwright)
    if ! playwright_mcp_is_connected; then
      fail "GAN_EVAL_MODE=playwright requires a connected MCP server named 'playwright'."
      fail "Run 'claude mcp get playwright' to inspect its status, or choose GAN_EVAL_MODE=screenshot or code-only."
      exit 1
    fi
    ;;
  screenshot|code-only)
    ;;
  *)
    fail "Unsupported GAN_EVAL_MODE. Expected playwright, screenshot, or code-only."
    exit 1
    ;;
esac

EVALUATOR_TOOLS=$(evaluator_tools_for_mode "$EVAL_MODE")

phase "GAN-STYLE HARNESS — Setup"

log "Brief: ${CYAN}${BRIEF}${NC}"
log "Max iterations: $MAX_ITERATIONS"
log "Pass threshold: $PASS_THRESHOLD"
log "Models: Planner=$PLANNER_MODEL, Generator=$GENERATOR_MODEL, Evaluator=$EVALUATOR_MODEL"
log "Eval mode: $EVAL_MODE"
log "Project dir: $PROJECT_DIR"

mkdir -p "$FEEDBACK_DIR" "$SCREENSHOTS_DIR"

# Initialize git if needed
if [ ! -d "${PROJECT_DIR}/.git" ]; then
  git -C "$PROJECT_DIR" init
  ok "Initialized git repository"
fi

# Write config
cat > "${HARNESS_DIR}/config.json" << EOF
{
  "brief": "$BRIEF",
  "maxIterations": $MAX_ITERATIONS,
  "passThreshold": $PASS_THRESHOLD,
  "models": {
    "planner": "$PLANNER_MODEL",
    "generator": "$GENERATOR_MODEL",
    "evaluator": "$EVALUATOR_MODEL"
  },
  "evalMode": "$EVAL_MODE",
  "devServerPort": $DEV_PORT,
  "startedAt": "$(date -Iseconds)"
}
EOF

ok "Harness directory created: $HARNESS_DIR"

# ─── Phase 1: Planning ──────────────────────────────────────────────────────

if [ "$SKIP_PLANNER" = "true" ] && [ -f "${HARNESS_DIR}/spec.md" ]; then
  phase "PHASE 1: Planning — SKIPPED (spec.md exists)"
else
  phase "PHASE 1: Planning"
  log "Launching Planner agent (model: $PLANNER_MODEL)..."

  claude -p --model "$PLANNER_MODEL" \
    "You are the Planner in a GAN-style harness. Read the agent definition in agents/gan-planner.md for your full instructions.

Your brief: \"$BRIEF\"

Create two files:
1. gan-harness/spec.md — Full product specification
2. gan-harness/eval-rubric.md — Evaluation criteria for the Evaluator

Be ambitious. Push for 12-16 features. Specify exact colors, fonts, and layouts. Don't be generic." \
    2>&1 | tee "${HARNESS_DIR}/planner-output.log"

  if [ -f "${HARNESS_DIR}/spec.md" ]; then
    ok "Spec generated: $(wc -l < "${HARNESS_DIR}/spec.md") lines"
  else
    fail "Planner did not produce spec.md!"
    exit 1
  fi
fi

# ─── Phase 2: Generator-Evaluator Loop ──────────────────────────────────────

phase "PHASE 2: Generator-Evaluator Loop"

SCORES=()
PREV_SCORE="0.0"
PLATEAU_COUNT=0

for (( i=1; i<=MAX_ITERATIONS; i++ )); do
  echo ""
  log "━━━ Iteration $i / $MAX_ITERATIONS ━━━"

  # ── GENERATE ──
  echo -e "${GREEN}>> GENERATOR (iteration $i)${NC}"

  FEEDBACK_CONTEXT=""
  if [ $i -gt 1 ] && [ -f "${FEEDBACK_DIR}/feedback-$(printf '%03d' $((i-1))).md" ]; then
    FEEDBACK_CONTEXT="IMPORTANT: Read and address ALL issues in gan-harness/feedback/feedback-$(printf '%03d' $((i-1))).md before doing anything else."
  fi

  claude -p --model "$GENERATOR_MODEL" \
    "You are the Generator in a GAN-style harness. Read agents/gan-generator.md for full instructions.

Iteration: $i
$FEEDBACK_CONTEXT

Read gan-harness/spec.md for the product specification.
Build/improve the application. Ensure the dev server runs on port $DEV_PORT.
Commit your changes with message: 'iteration-$(printf '%03d' $i): [describe what you did]'
Update gan-harness/generator-state.md." \
    2>&1 | tee "${HARNESS_DIR}/generator-${i}.log"

  ok "Generator completed iteration $i"

  # ── EVALUATE ──
  echo -e "${RED}>> EVALUATOR (iteration $i)${NC}"

  if [ "$EVAL_MODE" = "playwright" ] && ! playwright_mcp_is_connected; then
    fail "The Playwright MCP server disconnected before evaluator iteration $i."
    fail "Run 'claude mcp get playwright' to inspect its status, then retry the harness."
    exit 1
  fi

  claude -p --model "$EVALUATOR_MODEL" \
    --allowedTools "$EVALUATOR_TOOLS" \
    "You are the Evaluator in a GAN-style harness. Read agents/gan-evaluator.md for full instructions.

Iteration: $i
Eval mode: $EVAL_MODE
Dev server: http://localhost:$DEV_PORT

1. Read gan-harness/eval-rubric.md for scoring criteria
2. Read gan-harness/spec.md for feature requirements
3. Read gan-harness/generator-state.md for what was built
4. Test the live application (mode: $EVAL_MODE)
5. Score against the rubric (1-10 per criterion)
6. Write detailed feedback to gan-harness/feedback/feedback-$(printf '%03d' $i).md

Be RUTHLESSLY strict. A 7 means genuinely good, not 'good for AI.'
Include the weighted TOTAL score in the format: | **TOTAL** | | | **X.X** |" \
    2>&1 | tee "${HARNESS_DIR}/evaluator-${i}.log"

  FEEDBACK_FILE="${FEEDBACK_DIR}/feedback-$(printf '%03d' $i).md"

  if [ -f "$FEEDBACK_FILE" ]; then
    SCORE=$(extract_score "$FEEDBACK_FILE")
    SCORES+=("$SCORE")
    ok "Evaluator completed. Score: ${CYAN}${SCORE}${NC} / 10.0 (threshold: $PASS_THRESHOLD)"
  else
    warn "Evaluator did not produce feedback file. Assuming score 0.0"
    SCORE="0.0"
    SCORES+=("0.0")
  fi

  # ── CHECK PASS ──
  if score_passes "$SCORE" "$PASS_THRESHOLD"; then
    echo ""
    ok "PASSED at iteration $i with score $SCORE (threshold: $PASS_THRESHOLD)"
    break
  fi

  # ── CHECK PLATEAU ──
  SCORE_DIFF=$(awk -v s="$SCORE" -v p="$PREV_SCORE" 'BEGIN { printf "%.1f", s - p }')
  if [ $i -ge 3 ] && awk -v d="$SCORE_DIFF" 'BEGIN { exit !(d <= 0.2) }'; then
    PLATEAU_COUNT=$((PLATEAU_COUNT + 1))
  else
    PLATEAU_COUNT=0
  fi

  if [ $PLATEAU_COUNT -ge 2 ]; then
    warn "Score plateau detected (no improvement for 2 iterations). Stopping early."
    break
  fi

  PREV_SCORE="$SCORE"
done

# ─── Phase 3: Summary ───────────────────────────────────────────────────────

phase "PHASE 3: Build Report"

NUM_ITERATIONS=${#SCORES[@]}
if [ "$NUM_ITERATIONS" -gt 0 ]; then
  FINAL_SCORE="${SCORES[$((NUM_ITERATIONS - 1))]}"
else
  FINAL_SCORE="0.0"
fi
ELAPSED=$(elapsed)

# Build score progression table
SCORE_TABLE="| Iter | Score |\n|------|-------|\n"
for (( j=0; j<${#SCORES[@]}; j++ )); do
  SCORE_TABLE+="| $((j+1)) | ${SCORES[$j]} |\n"
done

# Write report
cat > "${HARNESS_DIR}/build-report.md" << EOF
# GAN Harness Build Report

**Brief:** $BRIEF
**Result:** $(score_passes "$FINAL_SCORE" "$PASS_THRESHOLD" && echo "PASS" || echo "FAIL")
**Iterations:** $NUM_ITERATIONS / $MAX_ITERATIONS
**Final Score:** $FINAL_SCORE / 10.0 (threshold: $PASS_THRESHOLD)
**Elapsed:** $ELAPSED

## Score Progression

$(echo -e "$SCORE_TABLE")

## Configuration

- Planner model: $PLANNER_MODEL
- Generator model: $GENERATOR_MODEL
- Evaluator model: $EVALUATOR_MODEL
- Eval mode: $EVAL_MODE
- Pass threshold: $PASS_THRESHOLD

## Files

- \`gan-harness/spec.md\` — Product specification
- \`gan-harness/eval-rubric.md\` — Evaluation rubric
- \`gan-harness/feedback/\` — All evaluation feedback ($NUM_ITERATIONS files)
- \`gan-harness/generator-state.md\` — Final generator state
- \`gan-harness/build-report.md\` — This report
EOF

ok "Report written to ${HARNESS_DIR}/build-report.md"

echo ""
log "━━━ Final Results ━━━"
if score_passes "$FINAL_SCORE" "$PASS_THRESHOLD"; then
  echo -e "${GREEN}  Result:     PASS${NC}"
else
  echo -e "${RED}  Result:     FAIL${NC}"
fi
echo -e "  Score:      ${CYAN}${FINAL_SCORE}${NC} / 10.0"
echo -e "  Iterations: ${NUM_ITERATIONS} / ${MAX_ITERATIONS}"
echo -e "  Elapsed:    ${ELAPSED}"
echo ""

log "Done! Review the build at http://localhost:$DEV_PORT"
