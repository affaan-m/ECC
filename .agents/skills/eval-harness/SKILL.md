---
name: eval-harness
description: Define and run capability and regression evaluations for Codex tasks. Use when specifying success criteria, measuring reliability, or comparing baseline and candidate behavior.
allowed-tools: Read, Write, Edit, Bash, Grep, Glob
license: MIT
---

# Eval Harness Skill

Use eval-driven development (EDD) to define expected behavior and measure changes in Codex or project workflows.

## When to Activate

- Setting up eval-driven development (EDD) for AI-assisted workflows
- Defining pass/fail criteria for agent task completion
- Measuring agent reliability with pass@k metrics
- Creating regression test suites for prompt or agent changes
- Benchmarking agent performance across model versions

## Philosophy

Eval-Driven Development treats evals as the "unit tests of AI development":
- Define expected behavior BEFORE implementation
- Run evals continuously during development
- Track regressions with each change
- Use pass@k metrics for reliability measurement

## Eval Types

### Capability Evals
Test whether the workflow can meet a new requirement.
```markdown
[CAPABILITY EVAL: feature-name]
Task: Description of what the agent should accomplish
Success Criteria:
  - [ ] Criterion 1
  - [ ] Criterion 2
  - [ ] Criterion 3
Expected Output: Description of expected result
```

### Regression Evals
Ensure changes don't break existing functionality:
```markdown
[REGRESSION EVAL: feature-name]
Baseline: SHA or checkpoint name
Tests:
  - existing-test-1: PASS/FAIL
  - existing-test-2: PASS/FAIL
  - existing-test-3: PASS/FAIL
Result: X/Y passed (previously Y/Y)
```

## Grader Types

### 1. Code-Based Grader
Prefer deterministic checks for requirements that can be expressed as assertions. Use the project's available tools to check the relevant files, run targeted tests, or verify a build. Preserve command exit statuses and each grader outcome.

### 2. Model-Based Grader
Use an available, authorized model grader for open-ended outputs. Give it the same rubric and synthetic fixture for the baseline and candidate.
```markdown
[MODEL GRADER PROMPT]
Evaluate the following code change:
1. Does it solve the stated problem?
2. Is it well-structured?
3. Are edge cases handled?
4. Is error handling appropriate?

Score: 1-5 (1=poor, 5=excellent)
Reasoning: [explanation]
```

### 3. Human Grader
Flag for manual review:
```markdown
[HUMAN REVIEW REQUIRED]
Change: Description of what changed
Reason: Why human review is needed
Risk Level: LOW/MEDIUM/HIGH
```

## Metrics

### pass@k
"At least one success in k attempts"
- pass@1: First attempt success rate
- pass@3: Success within 3 attempts
- Typical target: pass@3 > 90%

### pass^k
"All k trials succeed"
- Higher bar for reliability
- pass^3: 3 consecutive successes
- Use for critical paths

## Eval Workflow

### 1. Define (Before Coding)

Use synthetic fixtures. Record the fixtures, grader, expected outcomes, and success thresholds before running the baseline.

```markdown
## EVAL DEFINITION: feature-xyz

### Capability Evals
1. Can create new user account
2. Can validate email format
3. Can hash password securely

### Regression Evals
1. Existing login still works
2. Session management unchanged
3. Logout flow intact

### Success Metrics
- pass@3 > 90% for capability evals
- pass^3 = 100% for regression evals
```

### 2. Implement
Write code to pass the defined evals.

### 3. Evaluate

Find the existing local evaluation command in the project's documentation, scripts, or task configuration. Inspect its scope and run the applicable cases from the project directory. Compare the baseline and candidate with the same fixtures, rubric, configuration, and trial budget.

If the evaluator is unavailable or refuses to run, record the reason. Use available focused checks where appropriate and label their results separately. Respect the evaluator's isolation controls and distinguish static inspection from a candidate run.

### 4. Report
```markdown
EVAL REPORT: feature-xyz
Baseline: [revision or checkpoint]
Candidate: [revision or working-tree change]
Evaluator and configuration: [local command, grader, fixture set]
Capability results: [baseline and candidate outcomes]
Regression results: [baseline and candidate outcomes]
Trials and metrics: [counts and pass@k or pass^k where measured]
Missing or skipped checks: [reason and scope]
Evidence: [project-relative report or relevant output]
```

## Project Evidence

Follow the project's existing conventions for definitions, fixtures, baselines, and reports. If it has no eval storage convention, include the scoped report in the task output or the requested project artifact. Record only the evidence needed to reproduce the result. Keep credentials, private data, and unrelated session logs out of fixtures and reports.

## Best Practices

1. **Define evals BEFORE coding** - Forces clear thinking about success criteria
2. **Run evals frequently** - Catch regressions early
3. **Track pass@k over time** - Monitor reliability trends
4. **Use code graders when possible** - Deterministic > probabilistic
5. **Human review for security** - Never fully automate security checks
6. **Keep evals fast** - Slow evals don't get run
7. **Version evals with code** - Evals are first-class artifacts

## Example: Adding Authentication

```markdown
## EVAL: add-authentication

### Phase 1: Define (10 min)
Capability Evals:
- [ ] User can register with email/password
- [ ] User can login with valid credentials
- [ ] Invalid credentials rejected with proper error
- [ ] Sessions persist across page reloads
- [ ] Logout clears session

Regression Evals:
- [ ] Public routes still accessible
- [ ] API responses unchanged
- [ ] Database schema compatible

### Phase 2: Implement (varies)
[Write code]

### Phase 3: Evaluate
Use synthetic accounts in the local test environment.
Run the same available authentication checks against both revisions.

### Phase 4: Report
Record per-case baseline and candidate results, including missing checks.
Report reliability metrics only when they were measured.
```
