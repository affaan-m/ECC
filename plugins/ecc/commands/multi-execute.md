---
description: Execute a multi-model implementation plan while preserving Claude as the only filesystem writer.
---

# Execute - Multi-Model Collaborative Execution

Multi-model collaborative execution - Get prototype from plan → Claude refactors and implements → Multi-model audit and delivery.

$ARGUMENTS

---

## Core Protocols

- **Language Protocol**: Use **English** when interacting with tools/models, communicate with user in their language
- **Code Sovereignty**: External models have **zero filesystem write access**, all modifications by Claude
- **Dirty Prototype Refactoring**: Treat Codex/Gemini Unified Diff as "dirty prototype", must refactor to production-grade code
- **Stop-Loss Mechanism**: Do not proceed to next phase until current phase output is validated
- **Prerequisite**: Only execute after user explicitly replies "Y" to `/ccg:plan` output (if missing, must confirm first)

---

## Multi-Model Call Specification

**Call Syntax** (parallel: use `run_in_background: true`):

```
# Resume session call (recommended) - Implementation Prototype
Bash({
  command: "~/.claude/bin/codeagent-wrapper {{LITE_MODE_FLAG}}--backend <codex|gemini> {{GEMINI_MODEL_FLAG}}resume <SESSION_ID> - \"$PWD\" <<'EOF'
ROLE_FILE: <role prompt path>
<TASK>
Requirement: <task description>
Context: <plan content + target files>
</TASK>
OUTPUT: Unified Diff Patch ONLY. Strictly prohibit any actual modifications.
EOF",
  run_in_background: true,
  timeout: 3600000,
  description: "Brief description"
})

# New session call - Implementation Prototype
Bash({
  command: "~/.claude/bin/codeagent-wrapper {{LITE_MODE_FLAG}}--backend <codex|gemini> {{GEMINI_MODEL_FLAG}}- \"$PWD\" <<'EOF'
ROLE_FILE: <role prompt path>
<TASK>
Requirement: <task description>
Context: <plan content + target files>
</TASK>
OUTPUT: Unified Diff Patch ONLY. Strictly prohibit any actual modifications.
EOF",
  run_in_background: true,
  timeout: 3600000,
  description: "Brief description"
})
```

**Audit Call Syntax** (Code Review / Audit):

```
Bash({
  command: "~/.claude/bin/codeagent-wrapper {{LITE_MODE_FLAG}}--backend <codex|gemini> {{GEMINI_MODEL_FLAG}}resume <SESSION_ID> - \"$PWD\" <<'EOF'
ROLE_FILE: <role prompt path>
<TASK>
Scope: Audit the final code changes.
Inputs:
- The applied patch (git diff / final unified diff)
- The touched files (relevant excerpts if needed)
Constraints:
- Do NOT modify any files.
- Do NOT output tool commands that assume filesystem access.
</TASK>
OUTPUT:
1) A prioritized list of issues (severity, file, rationale)
2) Concrete fixes; if code changes are needed, include a Unified Diff Patch in a fenced code block.
EOF",
  run_in_background: true,
  timeout: 3600000,
  description: "Brief description"
})
```

**Model Parameter Notes**:
- `{{GEMINI_MODEL_FLAG}}`: When using `--backend gemini`, replace with `--gemini-model gemini-3-pro-preview` (note trailing space); use empty string for codex

**Role Prompts**:

| Phase | Codex | Gemini |
|-------|-------|--------|
| Implementation | `~/.claude/.ccg/prompts/codex/architect.md` | `~/.claude/.ccg/prompts/gemini/frontend.md` |
| Review | `~/.claude/.ccg/prompts/codex/reviewer.md` | `~/.claude/.ccg/prompts/gemini/reviewer.md` |

**Session Reuse**: If `/ccg:plan` provided SESSION_ID, use `resume <SESSION_ID>` to reuse context.

**Wait for Background Tasks** (max timeout 600000ms = 10 minutes):

```
TaskOutput({ task_id: "<task_id>", block: true, timeout: 600000 })
```

**IMPORTANT**:
- Must specify `timeout: 600000`, otherwise default 30 seconds will cause premature timeout
- If still incomplete after 10 minutes, continue polling with `TaskOutput`, **NEVER kill the process**
- If waiting is skipped due to timeout, **MUST call `AskUserQuestion` to ask user whether to continue waiting or kill task**

---

## Execution Workflow

**Execute Task**: $ARGUMENTS

### Phase 0: Read Plan

`[Mode: Prepare]`

1. **Identify Input Type**:
   - Plan file path (e.g., `.claude/plan/xxx.md`)
   - Direct task description

2. **Read Plan Content**:
   - If plan file path provided, read and parse
   - Extract: task type, implementation steps, key files, SESSION_ID

3. **Pre-Execution Confirmation**:
   - If input is "direct task description" or plan missing `SESSION_ID` / key files: confirm with user first
   - If cannot confirm user replied "Y" to plan: must confirm again before proceeding

4. **Task Type Routing**:

   | Task Type | Detection | Route |
   |-----------|-----------|-------|
   | **Frontend** | Pages, components, UI, styles, layout | Gemini |
   | **Backend** | API, interfaces, database, logic, algorithms | Codex |
   | **Fullstack** | Contains both frontend and backend | Codex ∥ Gemini parallel |

---

### Phase 1: Quick Context Retrieval

`[Mode: Retrieval]`

**If ace-tool MCP is available**, use it for quick context retrieval:

Based on "Key Files" list in plan, call `mcp__ace-tool__search_context`:

```
mcp__ace-tool__search_context({
  query: "<semantic query based on plan content, including key files, modules, function names>",
  project_root_path: "$PWD"
})
```

**Retrieval Strategy**:
- Extract target paths from plan's "Key Files" table
- Build semantic query covering: entry files, dependency modules, related type definitions
- If results insufficient, add 1-2 recursive retrievals

**If ace-tool MCP is NOT available**, use Claude Code built-in tools as fallback:
1. **Glob**: Find target files from plan's "Key Files" table (e.g., `Glob("src/components/**/*.tsx")`)
2. **Grep**: Search for key symbols, function names, type definitions across the codebase
3. **Read**: Read the discovered files to gather complete context
4. **Task (Explore agent)**: For broader exploration, use `Task` with `subagent_type: "Explore"`

**After Retrieval**:
- Organize retrieved code snippets
- Confirm complete context for implementation
- Proceed to Phase 3

---

### Phase 3: Prototype Acquisition

`[Mode: Prototype]`

**Route Based on Task Type**:

#### Route A: Frontend/UI/Styles → Gemini

**Limit**: Context < 32k tokens

1. Call Gemini (use `~/.claude/.ccg/prompts/gemini/frontend.md`)
2. Input: Plan content + retrieved context + target files
3. OUTPUT: `Unified Diff Patch ONLY. Strictly prohibit any actual modifications.`
4. **Gemini is frontend design authority, its CSS/React/Vue prototype is the final visual baseline**
5. **WARNING**: Ignore Gemini's backend logic suggestions
6. If plan contains `GEMINI_SESSION`: prefer `resume <GEMINI_SESSION>`

#### Route B: Backend/Logic/Algorithms → Codex

1. Call Codex (use `~/.claude/.ccg/prompts/codex/architect.md`)
2. Input: Plan content + retrieved context + target files
3. OUTPUT: `Unified Diff Patch ONLY. Strictly prohibit any actual modifications.`
4. **Codex is backend logic authority, leverage its logical reasoning and debug capabilities**
5. If plan contains `CODEX_SESSION`: prefer `resume <CODEX_SESSION>`

#### Route C: Fullstack → Parallel Calls

1. **Parallel Calls** (`run_in_background: true`):
   - Gemini: Handle frontend part
   - Codex: Handle backend part
2. Wait for both models' complete results with `TaskOutput`
3. Each uses corresponding `SESSION_ID` from plan for `resume` (create new session if missing)

**Follow the `IMPORTANT` instructions in `Multi-Model Call Specification` above**

---

### Phase 4: Code Implementation

`[Mode: Implement]`

**Claude as Code Sovereign executes the following steps**:

1. **Read Diff**: Parse Unified Diff Patch returned by Codex/Gemini

2. **Mental Sandbox**:
   - Simulate applying Diff to target files
   - Check logical consistency
   - Identify potential conflicts or side effects

3. **Refactor and Clean**:
   - Refactor "dirty prototype" to **highly readable, maintainable, enterprise-grade code**
   - Remove redundant code
   - Ensure compliance with project's existing code standards
   - **Do not generate comments/docs unless necessary**, code should be self-explanatory

4. **Minimal Scope**:
   - Changes limited to requirement scope only
   - **Mandatory review** for side effects
   - Make targeted corrections

5. **Apply Changes**:
   - Use Edit/Write tools to execute actual modifications
   - **Only modify necessary code**, never affect user's other existing functionality

6. **Self-Verification** (strongly recommended):
   - Run project's existing lint / typecheck / tests (prioritize minimal related scope)
   - If failed: fix regressions first, then proceed to Phase 5

---

### Phase 5: Audit and Delivery

`[Mode: Audit]`

#### 5.1 Automatic Audit

**After changes take effect, MUST immediately parallel call** Codex and Gemini for Code Review:

1. **Codex Review** (`run_in_background: true`):
   - ROLE_FILE: `~/.claude/.ccg/prompts/codex/reviewer.md`
   - Input: Changed Diff + target files
   - Focus: Security, performance, error handling, logic correctness

2. **Gemini Review** (`run_in_background: true`):
   - ROLE_FILE: `~/.claude/.ccg/prompts/gemini/reviewer.md`
   - Input: Changed Diff + target files
   - Focus: Accessibility, design consistency, user experience

Wait for both models' complete review results with `TaskOutput`. Prefer reusing Phase 3 sessions (`resume <SESSION_ID>`) for context consistency.

#### 5.2 Integrate and Fix

1. Synthesize Codex + Gemini review feedback
2. Weigh by trust rules: Backend follows Codex, Frontend follows Gemini
3. Execute necessary fixes
4. Repeat Phase 5.1 as needed (until risk is acceptable)

#### 5.3 Delivery Confirmation

After audit passes, report to user:

```markdown
## Execution Complete

### Change Summary
| File | Operation | Description |
|------|-----------|-------------|
| path/to/file.ts | Modified | Description |

### Audit Results
- Codex: <Passed/Found N issues>
- Gemini: <Passed/Found N issues>

### Recommendations
1. [ ] <Suggested test steps>
2. [ ] <Suggested verification steps>
```

---

## Key Rules

1. **Code Sovereignty** – All file modifications by Claude, external models have zero write access
2. **Dirty Prototype Refactoring** – Codex/Gemini output treated as draft, must refactor
3. **Trust Rules** – Backend follows Codex, Frontend follows Gemini
4. **Minimal Changes** – Only modify necessary code, no side effects
5. **Mandatory Audit** – Must perform multi-model Code Review after changes

---

## Usage

```bash
# Execute plan file
/ccg:execute .claude/plan/feature-name.md

# Execute task directly (for plans already discussed in context)
/ccg:execute implement user authentication based on previous plan
```

---

## Relationship with /ccg:plan

1. `/ccg:plan` generates plan + SESSION_ID
2. User confirms with "Y"
3. `/ccg:execute` reads plan, reuses SESSION_ID, executes implementation
