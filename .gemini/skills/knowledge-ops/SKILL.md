---
name: knowledge-ops
description: Knowledge base management, ingestion, sync, and retrieval across multiple storage layers (local files, MCP memory, vector stores, Git repos). Use when the user wants to save, organize, sync, deduplicate, or search across their knowledge systems.
origin: ECC
---

# Knowledge Operations

Manage a multi-layered knowledge system for ingesting, organizing, syncing, and retrieving knowledge across multiple stores.

Prefer the live workspace model:
- code work lives in the real cloned repos
- active execution context lives in GitHub, Linear, and repo-local working-context files
- broader human-facing notes can live in a non-repo context/archive folder
- durable cross-machine memory belongs in the knowledge base, not in a shadow repo workspace

## When to Activate

- User wants to save information to their knowledge base
- Ingesting documents, conversations, or data into structured storage
- Syncing knowledge across systems (local files, MCP memory, Supabase, Git repos)
- Deduplicating or organizing existing knowledge
- User says "save this to KB", "sync knowledge", "what do I know about X", "ingest this", "update the knowledge base"
- Any knowledge management task beyond simple memory recall

## Knowledge Architecture

### Layer 1: Active execution truth
- **Sources:** GitHub issues, PRs, discussions, release notes, Linear issues/projects/docs
- **Use for:** the current operational state of the work
- **Rule:** if something affects an active engineering plan, roadmap, rollout, or release, prefer putting it here first

### Layer 2: Claude Code Memory (Quick Access)
- **Path:** `~/.claude/projects/*/memory/`
- **Format:** Markdown files with frontmatter
- **Types:** user preferences, feedback, project context, reference
- **Use for:** quick-access context that persists across conversations
- **Automatically loaded at session start**

### Layer 3: MCP Memory Server (Structured Knowledge Graph)
- **Access:** MCP memory tools (create_entities, create_relations, add_observations, search_nodes)
- **Use for:** Semantic search across all stored memories, relationship mapping
- **Cross-session persistence with queryable graph structure**

### Layer 4: Knowledge base repo / durable document store
- **Use for:** curated durable notes, session exports, synthesized research, operator memory, long-form docs
- **Rule:** this is the preferred durable store for cross-machine context when the content is not repo-owned code

### Layer 5: External Data Store (Supabase, PostgreSQL, etc.)
- **Use for:** Structured data, large document storage, full-text search
- **Good for:** Documents too large for memory files, data needing SQL queries

### Layer 6: Local context/archive folder
- **Use for:** human-facing notes, archived gameplans, local media organization, temporary non-code docs
- **Rule:** writable for information storage, but not a shadow code workspace
- **Do not use for:** active code changes or repo truth that should live upstream

## Ingestion Workflow

When new knowledge needs to be captured:

### 1. Classify
What type of knowledge is it?
- Business decision -> memory file (project type) + MCP memory
- Active roadmap / release / implementation state -> GitHub + Linear first
- Personal preference -> memory file (user/feedback type)
- Reference info -> memory file (reference type) + MCP memory
- Large document -> external data store + summary in memory
- Conversation/session -> knowledge base repo + short summary in memory

### 2. Deduplicate
Check if this knowledge already exists:
- Search memory files for existing entries
- Query MCP memory with relevant terms
- Check whether the information already exists in GitHub or Linear before creating another local note
- Do not create duplicates. Update existing entries instead.

### 3. Store
Write to appropriate layer(s):
- Always update Claude Code memory for quick access
- Use MCP memory for semantic searchability and relationship mapping
- Update GitHub / Linear first when the information changes live project truth
- Commit to the knowledge base repo for durable long-form additions

### 4. Index
Update any relevant indexes or summary files.

## Sync Operations

### Conversation Sync
Periodically sync conversation history into the knowledge base:
- Sources: Claude session files, Codex sessions, other agent sessions
- Destination: knowledge base repo
- Generate a session index for quick browsing
- Commit and push

### Workspace State Sync
Mirror important workspace configuration and scripts to the knowledge base:
- Generate directory maps
- Redact sensitive config before committing
- Track changes over time
- Do not treat the knowledge base or archive folder as the live code workspace

### GitHub / Linear Sync
When the information affects active execution:
- update the relevant GitHub issue, PR, discussion, release notes, or roadmap thread
- attach supporting docs to Linear when the work needs durable planning context
- only mirror a local note afterwards if it still adds value

### Cross-Source Knowledge Sync
Pull knowledge from multiple sources into one place:
- Claude/ChatGPT/Grok conversation exports
- Browser bookmarks
- GitHub activity events
- Write status summary, commit and push

## Memory Patterns

```
# Short-term: current session context
Use TodoWrite for in-session task tracking

# Medium-term: project memory files
Write to ~/.claude/projects/*/memory/ for cross-session recall

# Long-term: GitHub / Linear / KB
Put active execution truth in GitHub + Linear
Put durable synthesized context in the knowledge base repo

# Semantic layer: MCP knowledge graph
Use mcp__memory__create_entities for permanent structured data
Use mcp__memory__create_relations for relationship mapping
Use mcp__memory__add_observations for new facts about known entities
Use mcp__memory__search_nodes to find existing knowledge
```

## Best Practices

- Keep memory files concise. Archive old data rather than letting files grow unbounded.
- Use frontmatter (YAML) for metadata on all knowledge files.
- Deduplicate before storing. Search first, then create or update.
- Prefer one canonical home per fact set. Avoid parallel copies of the same plan across local notes, repo files, and tracker docs.
- Redact sensitive information (API keys, passwords) before committing to Git.
- Use consistent naming conventions for knowledge files (lowercase-kebab-case).
- Tag entries with topics/categories for easier retrieval.

## Quality Gate

Before completing any knowledge operation:
- no duplicate entries created
- sensitive data redacted from any Git-tracked files
- indexes and summaries updated
- appropriate storage layer chosen for the data type
- cross-references added where relevant
