---
name: opensource-pipeline
description: "Open-source pipeline: fork, sanitize, and package private projects for safe public release. Chains 3 agents (forker, sanitizer, packager). Triggers: '/opensource', 'open source this', 'make this public', 'prepare for open source'."
origin: ECC
---

# Open-Source Pipeline Skill

Safely open-source any project through a 3-stage pipeline: **Fork** (strip secrets) → **Sanitize** (verify clean) → **Package** (CLAUDE.md + setup.sh + README).

## When to Activate

- User says "open source this project" or "make this public"
- User wants to prepare a private repo for public release
- User needs to strip secrets before pushing to GitHub
- User invokes `/opensource fork`, `/opensource verify`, or `/opensource package`

## Commands

| Command | Action |
|---------|--------|
| `/opensource fork PROJECT` | Full pipeline: fork + sanitize + package |
| `/opensource verify PROJECT` | Run sanitizer on existing repo |
| `/opensource package PROJECT` | Generate CLAUDE.md + setup.sh + README |
| `/opensource list` | Show all staged projects |
| `/opensource status PROJECT` | Show reports for a staged project |

## Protocol

### /opensource fork PROJECT

**Full pipeline — the main workflow.**

#### Step 1: Gather Parameters

Resolve the project path. If PROJECT contains `/`, treat as a path (absolute or relative). Otherwise check: current working directory, `$HOME/PROJECT`, then ask the user.

```
SOURCE_PATH="<resolved absolute path>"
STAGING_PATH="$HOME/opensource-staging/${PROJECT_NAME}"
```

Ask the user:
1. "Which project?" (if not found)
2. "License? (MIT / Apache-2.0 / GPL-3.0 / BSD-3-Clause)"
3. "GitHub org or username?" (default: detect via `gh api user -q .login`)
4. "GitHub repo name?" (default: project name)
5. "Description for README?" (analyze project for suggestion)

#### Step 2: Create Staging Directory

```bash
mkdir -p $HOME/opensource-staging/
```

#### Step 3: Run Forker Agent

Spawn the `opensource-forker` agent:

```
Agent(
  description="Fork {PROJECT} for open-source",
  subagent_type="opensource-forker",
  prompt="""
Fork project for open-source release.

Source: {SOURCE_PATH}
Target: {STAGING_PATH}
License: {chosen_license}

Follow the full forking protocol:
1. Copy files (exclude .git, node_modules, __pycache__, .venv)
2. Strip all secrets and credentials
3. Replace internal references with placeholders
4. Generate .env.example
5. Clean git history
6. Generate FORK_REPORT.md in {STAGING_PATH}/FORK_REPORT.md
"""
)
```

Wait for completion. Read `{STAGING_PATH}/FORK_REPORT.md`.

#### Step 4: Run Sanitizer Agent

Spawn the `opensource-sanitizer` agent:

```
Agent(
  description="Verify {PROJECT} sanitization",
  subagent_type="opensource-sanitizer",
  prompt="""
Verify sanitization of open-source fork.

Project: {STAGING_PATH}
Source (for reference): {SOURCE_PATH}

Run ALL scan categories:
1. Secrets scan (CRITICAL)
2. PII scan (CRITICAL)
3. Internal references scan (CRITICAL)
4. Dangerous files check (CRITICAL)
5. Configuration completeness (WARNING)
6. Git history audit

Generate SANITIZATION_REPORT.md inside {STAGING_PATH}/ with PASS/FAIL verdict.
"""
)
```

Wait for completion. Read `{STAGING_PATH}/SANITIZATION_REPORT.md`.

**If FAIL:** Show findings to user. Ask: "Fix these and re-scan, or abort?"
- If fix: Apply fixes, re-run sanitizer (maximum 3 retry attempts — after 3 FAILs, present all findings and ask user to fix manually)
- If abort: Clean up staging directory

**If PASS or PASS WITH WARNINGS:** Continue to Step 5.

#### Step 5: Run Packager Agent

Spawn the `opensource-packager` agent:

```
Agent(
  description="Package {PROJECT} for open-source",
  subagent_type="opensource-packager",
  prompt="""
Generate open-source packaging for project.

Project: {STAGING_PATH}
License: {chosen_license}
Project name: {PROJECT_NAME}
Description: {description}
GitHub repo: {github_repo}

Generate:
1. CLAUDE.md (commands, architecture, key files)
2. setup.sh (one-command bootstrap, make executable)
3. README.md (or enhance existing)
4. LICENSE
5. CONTRIBUTING.md
6. .github/ISSUE_TEMPLATE/ (bug_report.md, feature_request.md)
"""
)
```

#### Step 6: Final Review

Present to user:
```
Open-Source Fork Ready: {PROJECT_NAME}

Location: {STAGING_PATH}
License: {license}
Files generated:
  - CLAUDE.md
  - setup.sh (executable)
  - README.md
  - LICENSE
  - CONTRIBUTING.md
  - .env.example ({N} variables)

Sanitization: {sanitization_verdict}

Next steps:
  1. Review: cd {STAGING_PATH}
  2. Create repo: gh repo create {github_org}/{github_repo} --public
  3. Push: git remote add origin ... && git push -u origin main

Proceed with GitHub creation? (yes/no/review first)
```

#### Step 7: GitHub Publish (on user approval)

```bash
cd "{STAGING_PATH}"
gh repo create "{github_org}/{github_repo}" --public --source=. --push --description "{description}"
```

---

### /opensource verify PROJECT

Run sanitizer independently. Resolve path: if PROJECT contains `/`, treat as a path. Otherwise check `$HOME/opensource-staging/PROJECT`, then `$HOME/PROJECT`, then current directory.

```
Agent(
  subagent_type="opensource-sanitizer",
  prompt="Verify sanitization of: {resolved_path}. Run all 6 scan categories and generate SANITIZATION_REPORT.md."
)
```

---

### /opensource package PROJECT

Run packager independently. Ask for "License?" and "Description?", then:

```
Agent(
  subagent_type="opensource-packager",
  prompt="Package: {resolved_path} ..."
)
```

---

### /opensource list

```bash
ls -d $HOME/opensource-staging/*/
```

Show each project with pipeline progress (FORK_REPORT.md, SANITIZATION_REPORT.md, CLAUDE.md presence).

---

### /opensource status PROJECT

```bash
cat $HOME/opensource-staging/${PROJECT}/SANITIZATION_REPORT.md
cat $HOME/opensource-staging/${PROJECT}/FORK_REPORT.md
```

## Staging Layout

```
$HOME/opensource-staging/
  my-project/
    FORK_REPORT.md           # From forker agent
    SANITIZATION_REPORT.md   # From sanitizer agent
    CLAUDE.md                # From packager agent
    setup.sh                 # From packager agent
    README.md                # From packager agent
    .env.example             # From forker agent
    ...                      # Sanitized project files
```

## Anti-Patterns

- **Never** push to GitHub without user approval
- **Never** skip the sanitizer — it is the safety gate
- **Never** proceed after a sanitizer FAIL without fixing all critical findings
- **Never** leave `.env`, `*.pem`, or `credentials.json` in the staging directory

## Best Practices

- Always run the full pipeline (fork → sanitize → package) for new releases
- The staging directory persists until explicitly cleaned up — use it for review
- Re-run the sanitizer after any manual fixes before publishing
- Parameterize secrets rather than deleting them — preserve project functionality

## Related Skills

See `security-review` for secret detection patterns used by the sanitizer.
