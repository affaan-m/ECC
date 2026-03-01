---
name: instinct-export
description: Export instincts for sharing with teammates or other projects
command: /instinct-export
---

# Instinct Export Command

Exports instincts to a shareable format. Perfect for:

- Sharing with teammates
- Transferring to a new machine
- Contributing to project conventions

## Usage

```bash
/instinct-export                           # Export all personal instincts
/instinct-export --domain testing          # Export only testing instincts
/instinct-export --min-confidence 0.7      # Only export high-confidence instincts
/instinct-export --output team-instincts.yaml
```

## What to Do

1. Read instincts from `~/.claude/homunculus/instincts/personal/`
2. Filter based on flags
3. Strip sensitive information:
   - Remove session IDs
   - Remove file paths (keep only patterns)
   - Remove timestamps older than "last week"
4. Generate export file

## Output Format

Creates a YAML file:

```yaml
# Instincts Export
# Generated: 2025-01-22
# Source: personal
# Count: 12 instincts

version: "2.0"
exported_by: "continuous-learning-v2"
export_date: "2025-01-22T10:30:00Z"

instincts:
  - id: prefer-functional-style
    trigger: "when writing new functions"
    action: "Use functional patterns over classes"
    confidence: 0.8
    domain: code-style
    observations: 8

  - id: test-first-workflow
    trigger: "when adding new functionality"
    action: "Write test first, then implementation"
    confidence: 0.9
    domain: testing
    observations: 12

  - id: grep-before-edit
    trigger: "when modifying code"
    action: "Search with Grep, confirm with Read, then Edit"
    confidence: 0.7
    domain: workflow
    observations: 6
```

## Privacy Considerations

Exports include:

- ✅ Trigger patterns
- ✅ Actions
- ✅ Confidence scores
- ✅ Domains
- ✅ Observation counts

Exports do NOT include:

- ❌ Actual code snippets
- ❌ File paths
- ❌ Session transcripts
- ❌ Personal identifiers

## Flags

- `--domain <name>`: Export only specified domain
- `--min-confidence <n>`: Minimum confidence threshold (default: 0.3)
- `--output <file>`: Output file path (default: instincts-export-YYYYMMDD.yaml)
- `--format <yaml|json|md>`: Output format (default: yaml)
- `--include-evidence`: Include evidence text (default: excluded)
