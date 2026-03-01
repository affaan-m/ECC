# Eval Command

Manage eval-driven development workflow.

## Usage

`/eval [define|check|report|list] [feature-name]`

## Define Evals

`/eval define feature-name`

Create a new eval definition:

1. Create `.claude/evals/feature-name.md` with template:

```markdown
## EVAL: feature-name
Created: $(date)

### Capability Evals
- [ ] [Description of capability 1]
- [ ] [Description of capability 2]

### Regression Evals
- [ ] [Existing behavior 1 still works]
- [ ] [Existing behavior 2 still works]

### Success Criteria
- pass@3 > 90% for capability evals
- pass^3 = 100% for regression evals
```

1. Prompt user to fill in specific criteria

## Check Evals

`/eval check feature-name`

Run evals for a feature:

1. Read eval definition from `.claude/evals/feature-name.md`
2. For each capability eval:
   - Attempt to verify criterion
   - Record PASS/FAIL
   - Log attempt in `.claude/evals/feature-name.log`
3. For each regression eval:
   - Run relevant tests
   - Compare against baseline
   - Record PASS/FAIL
4. Report current status:

```text
EVAL CHECK: feature-name
========================
Capability: X/Y passing
Regression: X/Y passing
Status: IN PROGRESS / READY
```

## Report Evals

`/eval report feature-name`

Generate comprehensive eval report:

```text
EVAL REPORT: feature-name
=========================
Generated: $(date)

CAPABILITY EVALS
----------------
[eval-1]: PASS (pass@1)
[eval-2]: PASS (pass@2) - required retry
[eval-3]: FAIL - see notes

REGRESSION EVALS
----------------
[test-1]: PASS
[test-2]: PASS
[test-3]: PASS

METRICS
-------
Capability pass@1: 67%
Capability pass@3: 100%
Regression pass^3: 100%

NOTES
-----
[Any issues, edge cases, or observations]

RECOMMENDATION
--------------
[SHIP / NEEDS WORK / BLOCKED]
```

## List Evals

`/eval list`

Show all eval definitions:

```text
EVAL DEFINITIONS
================
feature-auth      [3/5 passing] IN PROGRESS
feature-search    [5/5 passing] READY
feature-export    [0/4 passing] NOT STARTED
```

## Arguments

$ARGUMENTS:

- `define <name>` - Create new eval definition
- `check <name>` - Run and check evals
- `report <name>` - Generate full report
- `list` - Show all evals
- `clean` - Remove old eval logs (keeps last 10 runs)
