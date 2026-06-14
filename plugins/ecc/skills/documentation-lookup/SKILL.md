---
name: documentation-lookup
description: Use up-to-date library and framework docs via Context7 MCP instead of training data. Activates for setup questions, API references, code examples, or when the user names a framework (e.g. React, Next.js, Prisma).
---

# Documentation Lookup (Context7)

When the user asks about libraries, frameworks, or APIs, fetch current documentation via the Context7 MCP (tools `resolve-library-id` and `query-docs`) instead of relying on training data.

## Core Concepts

- **Context7**: MCP server that exposes live documentation; use it instead of training data for libraries and APIs.
- **resolve-library-id**: Returns Context7-compatible library IDs (e.g. `/vercel/next.js`) from a library name and query.
- **query-docs**: Fetches documentation and code snippets for a given library ID and question. Always call resolve-library-id first to get a valid library ID.

## When to use

Activate when the user:

- Asks setup or configuration questions (e.g. "How do I configure Next.js middleware?")
- Requests code that depends on a library ("Write a Prisma query for...")
- Needs API or reference information ("What are the Supabase auth methods?")
- Mentions specific frameworks or libraries (React, Vue, Svelte, Express, Tailwind, Prisma, Supabase, etc.)

Use this skill whenever the request depends on accurate, up-to-date behavior of a library, framework, or API. Applies across harnesses that have the Context7 MCP configured (e.g. Claude Code, Cursor, Codex).

## How it works

### Step 1: Resolve the Library ID

Call the **resolve-library-id** MCP tool with:

- **libraryName**: The library or product name taken from the user's question (e.g. `Next.js`, `Prisma`, `Supabase`).
- **query**: The user's full question. This improves relevance ranking of results.

You must obtain a Context7-compatible library ID (format `/org/project` or `/org/project/version`) before querying docs. Do not call query-docs without a valid library ID from this step.

### Step 2: Select the Best Match

From the resolution results, choose one result using:

- **Name match**: Prefer exact or closest match to what the user asked for.
- **Benchmark score**: Higher scores indicate better documentation quality (100 is highest).
- **Source reputation**: Prefer High or Medium reputation when available.
- **Version**: If the user specified a version (e.g. "React 19", "Next.js 15"), prefer a version-specific library ID if listed (e.g. `/org/project/v1.2.0`).

### Step 3: Fetch the Documentation

Call the **query-docs** MCP tool with:

- **libraryId**: The selected Context7 library ID from Step 2 (e.g. `/vercel/next.js`).
- **query**: The user's specific question or task. Be specific to get relevant snippets.

Limit: do not call query-docs (or resolve-library-id) more than 3 times per question. If the answer is unclear after 3 calls, state the uncertainty and use the best information you have rather than guessing.

### Step 4: Use the Documentation

- Answer the user's question using the fetched, current information.
- Include relevant code examples from the docs when helpful.
- Cite the library or version when it matters (e.g. "In Next.js 15...").

## Examples

### Example: Next.js middleware

1. Call **resolve-library-id** with `libraryName: "Next.js"`, `query: "How do I set up Next.js middleware?"`.
2. From results, pick the best match (e.g. `/vercel/next.js`) by name and benchmark score.
3. Call **query-docs** with `libraryId: "/vercel/next.js"`, `query: "How do I set up Next.js middleware?"`.
4. Use the returned snippets and text to answer; include a minimal `middleware.ts` example from the docs if relevant.

### Example: Prisma query

1. Call **resolve-library-id** with `libraryName: "Prisma"`, `query: "How do I query with relations?"`.
2. Select the official Prisma library ID (e.g. `/prisma/prisma`).
3. Call **query-docs** with that `libraryId` and the query.
4. Return the Prisma Client pattern (e.g. `include` or `select`) with a short code snippet from the docs.

### Example: Supabase auth methods

1. Call **resolve-library-id** with `libraryName: "Supabase"`, `query: "What are the auth methods?"`.
2. Pick the Supabase docs library ID.
3. Call **query-docs**; summarize the auth methods and show minimal examples from the fetched docs.

## Best Practices

- **Be specific**: Use the user's full question as the query where possible for better relevance.
- **Version awareness**: When users mention versions, use version-specific library IDs from the resolve step when available.
- **Prefer official sources**: When multiple matches exist, prefer official or primary packages over community forks.
- **No sensitive data**: Redact API keys, passwords, tokens, and other secrets from any query sent to Context7. Treat the user's question as potentially containing secrets before passing it to resolve-library-id or query-docs.
