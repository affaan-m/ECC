---
name: repo-scan
description: Cross-stack source code asset audit — classifies every file, detects embedded third-party libraries, and delivers actionable four-level verdicts per module with interactive HTML reports. Use when an unfamiliar or inherited repository needs a file-level audit of what each module is and what third-party code it embeds.
metadata:
  origin: community
---

# repo-scan

> Every ecosystem has its own dependency manager, but no tool looks across C++, Android, iOS, and Web to tell you: how much code is actually yours, what's third-party, and what's dead weight.

## When to Use

- Taking over a large legacy codebase and need a structural overview
- Before major refactoring — identify what's core, what's duplicate, what's dead
- Auditing third-party dependencies embedded directly in source (not declared in package managers)
- Preparing architecture decision records for monorepo reorganization

## Installation

```bash
# Clone first so the pinned commit can be reviewed before installation
REPO_SCAN_COMMIT=2742664ebcad1450c208eda0ae45d3c17fad5dd8
REPO_SCAN_TMP="$(mktemp -d)"
REPO_SCAN_INSTALL_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/skills/repo-scan"
trap 'rm -rf "$REPO_SCAN_TMP"' EXIT

git clone --filter=blob:none --no-checkout \
  https://github.com/haibindev/repo-scan.git "$REPO_SCAN_TMP/source"
git -C "$REPO_SCAN_TMP/source" checkout --detach "$REPO_SCAN_COMMIT"

# Review "$REPO_SCAN_TMP/source", then install tracked files without .git metadata
mkdir -p "$REPO_SCAN_INSTALL_DIR"
git -C "$REPO_SCAN_TMP/source" archive HEAD | tar -xf - -C "$REPO_SCAN_INSTALL_DIR"
```

> Review the source before installing any agent skill.

## Core Capabilities

| Capability | Description |
|---|---|
| **Cross-stack scanning** | C/C++, Java/Android, iOS (OC/Swift), Web (TS/JS/Vue) in one pass |
| **File classification** | Every file tagged as project code, third-party, or build artifact |
| **Library detection** | 50+ known libraries (FFmpeg, Boost, OpenSSL…) with version extraction |
| **Four-level verdicts** | Core Asset / Extract & Merge / Rebuild / Deprecate |
| **HTML reports** | Interactive dark-theme pages with drill-down navigation |
| **Monorepo support** | Hierarchical scanning with summary + sub-project reports |

## Analysis Depth Levels

| Level | Files Read | Use Case |
|---|---|---|
| `fast` | 1-2 per module | Quick inventory of huge directories |
| `standard` | 2-5 per module | Default audit with full dependency + architecture checks |
| `deep` | 5-10 per module | Adds thread safety, memory management, API consistency |
| `full` | All files | Pre-merge comprehensive review |

## How It Works

1. **Classify the repo surface**: enumerate files, then tag each as project code, embedded third-party code, or build artifact.
2. **Detect embedded libraries**: inspect directory names, headers, license files, and version markers to identify bundled dependencies and likely versions.
3. **Score each module**: group files by module or subsystem, then assign one of the four verdicts based on ownership, duplication, and maintenance cost.
4. **Highlight structural risks**: call out dead-weight artifacts, duplicated wrappers, outdated vendored code, and modules that should be extracted, rebuilt, or deprecated.
5. **Produce the report**: return a concise summary plus the interactive HTML output with per-module drill-down so the audit can be reviewed asynchronously.

## Examples

On a 50,000-file C++ monorepo:
- Found FFmpeg 2.x (2015 vintage) still in production
- Discovered the same SDK wrapper duplicated 3 times
- Identified 636 MB of committed Debug/ipch/obj build artifacts
- Classified: 3 MB project code vs 596 MB third-party

## Best Practices

- Start with `standard` depth for first-time audits
- Use `fast` for monorepos with 100+ modules to get a quick inventory
- Run `deep` incrementally on modules flagged for refactoring
- Review the cross-module analysis for duplicate detection across sub-projects

## Links

- [GitHub Repository](https://github.com/haibindev/repo-scan)
