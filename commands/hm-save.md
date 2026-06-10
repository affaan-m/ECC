---
description: Save a memory to the Bezalel pipeline — MemoryService (Qdrant), wiki log, Ruflo, and Langfuse trace in one command.
---

# hm-save

Capture a decision, learning, or context to the full Bezalel memory pipeline:

1. Append to MEMORY.md
2. Semantic store in MemoryService (Qdrant, dedup, auto-importance)
3. Wiki log update (`~/wiki/log.md`)
4. Ruflo `.swarm` SQLite store
5. Langfuse observability trace

## Usage

```
/hm-save <text> [--tags tag1,tag2] [--importance 0.8] [--source human|agent|router]
```

## Examples

```
/hm-save "Decided to use Kimi K2 as default router model — cost 10x lower than Sonnet" --tags routing,decision
/hm-save "ForgeSec gate must always check KEV list before allowing low-priority security tasks" --tags security,forgesec --importance 0.9
/hm-save "Memory consolidation runs every Sunday — set up cron job" --tags memory,ops
```

## What it does

```bash
python -m bezalel.commands.hm_save "$ARGUMENTS"
```

When invoked as a Claude Code slash command, Claude will:
1. Parse the text and optional flags from `$ARGUMENTS`
2. Run the full pipeline via `bezalel/commands/hm_save.py`
3. Report each step's status (ok / skipped / error)

## Pipeline diagram

```
/hm-save "text"
    │
    ├─→ MEMORY.md (append)
    ├─→ MemoryService.add_memory() → Qdrant (dedup cosine≥0.93, importance scoring)
    ├─→ wiki/log.md (daily entry)
    ├─→ .swarm/memory.db (Ruflo SQLite)
    └─→ Langfuse trace (if LANGFUSE_PUBLIC_KEY set)
```

## Requirements

- `pip install qdrant-client sentence-transformers` for vector storage
- `LANGFUSE_PUBLIC_KEY` + `LANGFUSE_SECRET_KEY` env vars for tracing
- Qdrant running locally (`docker run -p 6333:6333 qdrant/qdrant`) or set `QDRANT_URL`
