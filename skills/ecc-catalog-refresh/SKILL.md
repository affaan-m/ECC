---
name: ecc-catalog-refresh
description: Rebuild the ECC Query Builder catalog after pulling ECC updates or adding new skills. Scans all skill, command, and agent files, extracts keywords automatically, and writes a fresh catalog.json with full coverage.
origin: ECC
---

# ECC Catalog Refresh

Keeps the ECC Query Builder catalog in sync with the local ECC repo. Run this after any ECC update so the routing engine knows about new skills, renamed agents, or added commands.

## When to Activate

- After `git pull` on the ECC repo
- After adding or modifying a skill file
- When `query_ecc_catalog` returns no matches for something that should exist
- When the catalog feels stale or out of date
- User says "refresh the catalog", "rebuild the catalog", or "update ECC"

## How It Works

The catalog builder scans three directories in the ECC repo:

1. `skills/` — reads each `SKILL.md`, extracts frontmatter (`name`, `description`) and the "When to Activate" section bullets
2. `commands/` — reads each `.md` file, extracts frontmatter `description` and the H1 heading
3. `agents/` — reads each `.md` file, extracts frontmatter `name` and `description`

Keywords are auto-extracted from all of the above using a stop-word-filtered tokeniser. Multi-word phrases from "When to Activate" bullets are preserved as phrase keywords (e.g. "react components", "database migration"). Each entry gets up to 25 keywords.

## Step 1: Use the MCP Tool (Preferred)

Call the `rebuild_catalog` MCP tool directly — no terminal needed:

```
rebuild_catalog
```

This triggers the catalog builder, rescans the entire ECC repo, and writes a fresh `catalog.json`. It returns a summary:

```
Catalog rebuilt from C:/Users/Asus/OneDrive/Documents/ECC
Commands : 79
Agents   : 63
Skills   : 249
```

## Step 2: CLI Fallback

If the MCP is unavailable, run from the query builder directory:

```bash
cd C:/Users/Asus/OneDrive/Documents/ecc-query-builder
npm run build-catalog
```

## Step 3: Verify

After rebuilding, confirm the new skill or command appears in routing:

```
query_ecc_catalog("test query related to what you just added")
```

Check that the expected skill appears in the results.

## Key Paths

| Thing | Path |
|-------|------|
| ECC repo | `C:/Users/Asus/OneDrive/Documents/ECC` |
| Query Builder | `C:/Users/Asus/OneDrive/Documents/ecc-query-builder` |
| Catalog file | `C:/Users/Asus/OneDrive/Documents/ecc-query-builder/catalog.json` |
| Catalog builder | `C:/Users/Asus/OneDrive/Documents/ecc-query-builder/scripts/catalog-builder.js` |

## Notes

- The rebuild is non-destructive — it replaces `catalog.json` entirely from source, so manually added entries via `add_to_ecc_catalog` will be overwritten. Add those back after a rebuild if needed.
- Any skill folder without a `SKILL.md` is silently skipped.
- Malformed frontmatter is skipped gracefully — the rest of the catalog still builds.
