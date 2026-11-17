---
name: skill-stocktake
description: "Use when auditing Claude skills and commands for quality. Supports Quick Scan (changed skills only) and Full Stocktake modes with sequential subagent batch evaluation."
metadata:
  origin: ECC
---

# skill-stocktake

Slash command (`/skill-stocktake`) that audits all Claude skills and commands using a quality checklist + AI holistic judgment. Supports two modes: Quick Scan for recently changed skills, and Full Stocktake for a complete review.

## Scope

The command targets the following paths **relative to the directory where it is invoked**:

| Path | Description |
|------|-------------|
| `~/.claude/skills/` | Global skills (all projects) |
| `{cwd}/.claude/skills/` | Project-level skills (if the directory exists) |

**At the start of Phase 1, the command explicitly lists which paths were found and scanned.**

Directories named `.trash` are excluded from both scan modes: archived skills are not part of the live inventory. If an older `results.json` contains `.trash` entries, start a new Full Stocktake using the cache initialization below before resuming Quick Scan. An ordinary save merges entries and does not remove archived records.

### Targeting a specific project

To include project-level skills, run from that project's root directory:

```bash
cd ~/path/to/my-project
/skill-stocktake
```

If the project has no `.claude/skills/` directory, only global skills and commands are evaluated.

## Modes

| Mode | Trigger | Duration |
|------|---------|---------|
| Quick Scan | `results.json` exists (default) | 5–10 min |
| Full Stocktake | `results.json` absent, or `/skill-stocktake full` | 20–30 min |

The shell scripts require Bash, Node.js, and `jq` on `PATH`.

**Results cache:** `~/.claude/skills/skill-stocktake/results.json`

## Quick Scan Flow

Re-evaluate only skills that have changed since the last run (5–10 min).

1. Read `~/.claude/skills/skill-stocktake/results.json`
2. Run: `bash ~/.claude/skills/skill-stocktake/scripts/quick-diff.sh \
         ~/.claude/skills/skill-stocktake/results.json`
   (Project dir is auto-detected from `$PWD/.claude/skills`; pass it explicitly only if needed)
3. If output is `[]`: report "No changes since last run." and stop
4. Re-evaluate only those changed files using the same Phase 2 criteria
5. Carry forward unchanged skills from previous results
6. Output only the diff
7. Run: `bash ~/.claude/skills/skill-stocktake/scripts/save-results.sh \
         ~/.claude/skills/skill-stocktake/results.json <<< "$EVAL_RESULTS"`

## Full Stocktake Flow

### Phase 1 — Inventory

Run this entire block in **one Bash invocation**. It prints the inventory for the agent and initializes a new full run only when there is no unfinished run to resume:

```bash
(
  set -euo pipefail
  SCAN_JSON=$(bash ~/.claude/skills/skill-stocktake/scripts/scan.sh)
  printf '%s\n' "$SCAN_JSON"
  RESULTS_JSON=~/.claude/skills/skill-stocktake/results.json

  CACHE_STATUS=""
  if [[ -f "$RESULTS_JSON" ]]; then
    CACHE_STATUS=$(jq -r '.batch_progress.status // ""' "$RESULTS_JSON")
  fi
  if [[ "$CACHE_STATUS" == "in_progress" ]]; then
    RESUMED_RESULTS=$(jq --slurpfile saved "$RESULTS_JSON" '
      . as $inventory | $saved[0]
      | .skills = (.skills | to_entries
        | map(.key = (.value.path // .key))
        | map(select(. as $entry
          | $entry.value.mtime != null
            and any($inventory.skills[];
              .path == $entry.key and .mtime == $entry.value.mtime)))
        | from_entries)
      | .mode = "full"
      | .batch_progress = {
          total: ($inventory.skills | length),
          evaluated: (.skills | length), status: "in_progress"
        }
    ' <<< "$SCAN_JSON")
    bash ~/.claude/skills/skill-stocktake/scripts/save-results.sh \
      "$RESULTS_JSON" --replace <<< "$RESUMED_RESULTS"
  else
    INITIAL_RESULTS=$(printf '%s\n' "$SCAN_JSON" | jq '{
      mode: "full", skills: {},
      batch_progress: {total: (.skills | length), evaluated: 0, status: "in_progress"}
    }')
    bash ~/.claude/skills/skill-stocktake/scripts/save-results.sh \
      "$RESULTS_JSON" --replace <<< "$INITIAL_RESULTS"
  fi
)
```

The script enumerates skill files, extracts frontmatter, and collects UTC mtimes.
Project dir is auto-detected from `$PWD/.claude/skills`; pass it explicitly only if needed.
Present the scan summary and inventory table from the script output:

```
Scanning:
  ✓ ~/.claude/skills/         (17 files)
  ✗ {cwd}/.claude/skills/    (not found — global skills only)
```

| Skill | 7d use | 30d use | Description |
|-------|--------|---------|-------------|

Usage counts come from the optional `~/.claude/observations.jsonl` file (overridable with `SKILL_STOCKTAKE_OBSERVATIONS`), which Claude Code does not create by default. When the file is absent, `use_7d` and `use_30d` are JSON `null`; display them as **unmeasured** in inventory and summary tables. A numeric `0` means the file exists but contains no matching Read observations in that window. Missing usage data is never evidence for retiring a skill.

`--replace` writes a complete cache snapshot. A new run starts with an empty evaluation; a resumed run instead keeps a saved evaluation only when its path is still live and its saved, non-null mtime matches the fresh inventory. Changed skills and entries without an mtime require re-evaluation. It removes archived/deleted entries and refreshes the progress counts even when no new batch remains. Existing name-keyed entries are normalized using their saved `path`. Never use the empty initialization payload for a resume. Later chunks, completion updates, and Quick Scans must omit `--replace` so they merge into the current run instead of losing earlier results.

### Phase 2 — Quality Evaluation

Launch an Agent tool subagent (**general-purpose agent**) with the actual JSON emitted by Phase 1 and the checklist below. Copy the inventory values into the prompt itself; shell variables do not carry over into Agent calls. Include the full inventory for overlap checks and explicitly identify the paths in the current batch to evaluate. Do not send literal inventory or checklist placeholders.

The subagent reads each assigned skill, applies the checklist, and returns a JSON object with a `skills` map keyed by the inventory path. Each entry includes its `path`, scanned `mtime`, `verdict`, and self-contained `reason`. Use the same path keys across all batches so merging results cannot overwrite a different skill with the same name.

**Chunk guidance:** Process ~20 skills per subagent invocation to keep context manageable. After each chunk, wrap its returned `skills` map with `mode: "full"` and `batch_progress: {total, evaluated, status: "in_progress"}`. Set `total` to the inventory size and `evaluated` to the cumulative number of distinct evaluated paths, including saved batches. Assign this JSON to `CHUNK_RESULTS` and run the following command in the **same Bash invocation as that assignment**:

```bash
bash ~/.claude/skills/skill-stocktake/scripts/save-results.sh \
  ~/.claude/skills/skill-stocktake/results.json <<< "$CHUNK_RESULTS"
```

After all skills are evaluated, persist completion before proceeding to Phase 3:

```bash
(
  set -euo pipefail
  RESULTS_JSON=~/.claude/skills/skill-stocktake/results.json
  COMPLETED_RESULTS=$(jq -e '
    if (.skills | length) == .batch_progress.total then
      {skills: {}, mode: "full", batch_progress: (.batch_progress + {
        evaluated: (.skills | length), status: "completed"
      })}
    else error("Inventory still has unevaluated skills") end
  ' "$RESULTS_JSON")
  bash ~/.claude/skills/skill-stocktake/scripts/save-results.sh \
    "$RESULTS_JSON" <<< "$COMPLETED_RESULTS"
)
```

**Resume detection:** If `status: "in_progress"` is found on startup, run Phase 1 to reconcile the saved results with the fresh inventory, then evaluate only paths absent from the reconciled `skills` map. If none remain, persist completion immediately. Completed evaluations are preserved only for surviving paths with matching, non-null mtimes; new or changed skills and entries without an mtime require evaluation.

Each skill is evaluated against this checklist:

```
- [ ] Content overlap with other skills checked
- [ ] Overlap with MEMORY.md / CLAUDE.md checked
- [ ] Freshness of technical references verified (use WebSearch if tool names / CLI flags / APIs are present)
- [ ] Usage frequency considered when measured; missing observations marked unmeasured, not treated as zero
```

Verdict criteria:

| Verdict | Meaning |
|---------|---------|
| Keep | Useful and current |
| Improve | Worth keeping, but specific improvements needed |
| Update | Referenced technology is outdated (verify with WebSearch) |
| Retire | Low quality, stale, or cost-asymmetric |
| Merge into [X] | Substantial overlap with another skill; name the merge target |

Evaluation is **holistic AI judgment** — not a numeric rubric. Guiding dimensions:
- **Actionability**: code examples, commands, or steps that let you act immediately
- **Scope fit**: name, trigger, and content are aligned; not too broad or narrow
- **Uniqueness**: value not replaceable by MEMORY.md / CLAUDE.md / another skill
- **Currency**: technical references work in the current environment

**Reason quality requirements** — the `reason` field must be self-contained and decision-enabling:
- Do NOT write "unchanged" alone — always restate the core evidence
- For **Retire**: state (1) what specific defect was found, (2) what covers the same need instead
  - Bad: `"Superseded"`
  - Good: `"disable-model-invocation: true already set; superseded by continuous-learning-v2 which covers all the same patterns plus confidence scoring. No unique content remains."`
- For **Merge**: name the target and describe what content to integrate
  - Bad: `"Overlaps with X"`
  - Good: `"42-line thin content; Step 4 of chatlog-to-article already covers the same workflow. Integrate the 'article angle' tip as a note in that skill."`
- For **Improve**: describe the specific change needed (what section, what action, target size if relevant)
  - Bad: `"Too long"`
  - Good: `"276 lines; Section 'Framework Comparison' (L80–140) duplicates ai-era-architecture-principles; delete it to reach ~150 lines."`
- For **Keep** (mtime-only change in Quick Scan): restate the original verdict rationale, do not write "unchanged"
  - Bad: `"Unchanged"`
  - Good: `"mtime updated but content unchanged. Unique Python reference explicitly imported by rules/python/; no overlap found."`

### Phase 3 — Summary Table

| Skill | 7d use | Verdict | Reason |
|-------|--------|---------|--------|

### Phase 4 — Consolidation

1. **Retire / Merge**: present detailed justification per file before confirming with user:
   - What specific problem was found (overlap, staleness, broken references, etc.)
   - What alternative covers the same functionality (for Retire: which existing skill/rule; for Merge: the target file and what content to integrate)
   - Impact of removal (any dependent skills, MEMORY.md references, or workflows affected)
2. **Improve**: present specific improvement suggestions with rationale:
   - What to change and why (e.g., "trim 430→200 lines because sections X/Y duplicate python-patterns")
   - User decides whether to act
3. **Update**: present updated content with sources checked
4. Check MEMORY.md line count; propose compression if >100 lines

## Results File Schema

`~/.claude/skills/skill-stocktake/results.json`:

**`evaluated_at`**: Must be set to the actual UTC time of evaluation completion.
Obtain via Bash: `date -u +%Y-%m-%dT%H:%M:%SZ`. Never use a date-only approximation like `T00:00:00Z`.

```json
{
  "evaluated_at": "2026-02-21T10:00:00Z",
  "mode": "full",
  "batch_progress": {
    "total": 80,
    "evaluated": 80,
    "status": "completed"
  },
  "skills": {
    "~/.claude/skills/skill-name/SKILL.md": {
      "path": "~/.claude/skills/skill-name/SKILL.md",
      "verdict": "Keep",
      "reason": "Concrete, actionable, unique value for X workflow",
      "mtime": "2026-01-15T08:30:00Z"
    }
  }
}
```

## Notes

- Evaluation is blind: the same checklist applies to all skills regardless of origin (ECC, self-authored, auto-extracted)
- Archive / delete operations always require explicit user confirmation
- No verdict branching by skill origin
