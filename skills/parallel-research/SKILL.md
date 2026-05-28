---
name: parallel-research
description: Web research, lookups, and citation-backed answers via Parallel's Search MCP (web_search, web_fetch) and direct Task / Deep Research / FindAll REST APIs. Use when the user says "research X", "look up", "find all Y", "what's the latest on", or needs current/sourced answers grounded in the live web.
origin: parallel.ai
---

# Parallel Research

> **Drift-prone skill.** Parallel's tool surface and API parameters evolve. Confirm the exposed MCP tools (`mcp__parallel-search__web_search`, `mcp__parallel-search__web_fetch`) and current REST schema at <https://docs.parallel.ai> before depending on a specific field or processor name.

Citation-backed web research via Parallel — search and URL extraction over MCP, and longer-form Task / Deep Research / FindAll workflows via the REST API.

## When to Activate

- User asks to "research", "look up", "investigate", "find all", or "what's the latest on" any topic
- A claim in the conversation needs a current, sourced citation (news, prices, releases, statuses)
- The user supplies a specific URL and asks "what does this page say" or "summarize this"
- The user wants a list of entities matching a description ("list every Series A AI startup in 2026", "find all roofing companies in Charlotte NC")
- The user asks for an exhaustive / comprehensive report or "deep research" on a topic
- A development task needs background context the agent does not have (e.g. comparing libraries, checking release dates)

Do NOT activate this skill for:

- Questions answerable from the codebase or local files (use `code-explorer` or read directly)
- Library/API usage questions that have a dedicated docs server — prefer `docs-lookup` + Context7 for those
- Anything that doesn't need live web data

## MCP Requirement

Add the **Parallel Search** entry from `mcp-configs/mcp-servers.json` to your `~/.claude.json`:

```json
"parallel-search": {
  "type": "http",
  "url": "https://search.parallel.ai/mcp"
}
```

Anonymous use works out of the box. For higher rate limits or production traffic, add a Bearer header with a key from [platform.parallel.ai](https://platform.parallel.ai):

```json
"parallel-search": {
  "type": "http",
  "url": "https://search.parallel.ai/mcp",
  "headers": { "Authorization": "Bearer YOUR_PARALLEL_API_KEY_HERE" }
}
```

The MCP exposes two tools: `web_search` and `web_fetch`. Both accept an **objective** (natural-language description of what you're trying to answer) plus optional structured fields, and return citation-ready excerpts that fit inside a context window.

## Core Concepts

Parallel exposes four research surfaces. Pick the narrowest one that answers the question.

| Surface | How to call | Latency | When to use |
|---|---|---|---|
| **Search** (MCP `web_search`) | MCP tool call | seconds | First choice for almost any lookup. Objective + queries returns citation-ready excerpts. |
| **Extract** (MCP `web_fetch`) | MCP tool call | seconds | User supplies a specific URL, or you need full-page content from a result. |
| **Task API** | `POST https://api.parallel.ai/v1/tasks/runs` | 30 s – 5 min | Structured extraction or a single-shot multi-step research task with a defined output schema. |
| **Deep Research** | `POST https://api.parallel.ai/v1/tasks/runs` with `processor: pro` or higher | 2 – 30 min | Long-form report with broad sourcing. Use only when the user explicitly asks for "deep", "comprehensive", or "exhaustive" research. |
| **FindAll** | `POST https://api.parallel.ai/v1/findall/runs` | 1 – 10 min | "Find every X that …" — returns a list of entities matching a description. |

**Default to Search.** It is fast, cheap, and citation-ready. Escalate to Task / Deep Research / FindAll only when Search clearly cannot answer.

## Code Examples

### Pattern 1 — Quick lookup (MCP `web_search`)

```
mcp__parallel-search__web_search(
  objective: "Find the latest stable Bun runtime version and its release date",
  search_queries: ["Bun runtime latest release", "Bun changelog 2026"],
  max_results: 5
)
```

Pass an `objective` (full natural-language description, NOT just a keyword) plus 2–4 `search_queries` that supplement it. Excerpts are bounded to ~25,000 chars per call.

### Pattern 2 — Page extraction (MCP `web_fetch`)

```
mcp__parallel-search__web_fetch(
  urls: ["https://docs.parallel.ai/integrations/mcp/search-mcp"],
  objective: "How does the Search MCP handle authentication and rate limits?"
)
```

Pass multiple related URLs in one call with a shared `objective`; the tool returns the parts most relevant to that objective.

### Pattern 3 — Structured Task (direct REST)

When you need a typed output (e.g. company name → CEO, funding, HQ), call the Task API directly. No new install needed — just `curl`.

```bash
PARALLEL_API_KEY="..."  # from platform.parallel.ai
curl -sS https://api.parallel.ai/v1/tasks/runs \
  -H "x-api-key: $PARALLEL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "input": "Anthropic",
    "task_spec": {
      "output_schema": {
        "type": "json",
        "json_schema": {
          "properties": {
            "ceo":            { "type": "string" },
            "headquarters":   { "type": "string" },
            "last_funding":   { "type": "string" }
          },
          "required": ["ceo", "headquarters", "last_funding"]
        }
      }
    },
    "processor": "base"
  }'
```

Poll `GET /v1/tasks/runs/{run_id}` and `GET /v1/tasks/runs/{run_id}/result` for the result.

### Pattern 4 — Deep Research (direct REST)

Same endpoint, higher processor tier. Use only when the user explicitly asks for "deep", "comprehensive", or "exhaustive" research.

```bash
curl -sS https://api.parallel.ai/v1/tasks/runs \
  -H "x-api-key: $PARALLEL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "input": "Compare the open-source agent frameworks released in 2026: capabilities, license, adoption signals",
    "processor": "pro"
  }'
```

Processor tiers run from `base` (seconds, cached web) up through `pro` (minutes) and `ultra` (tens of minutes, multi-source). Match the tier to the depth the user actually asked for — do not default to `ultra`.

### Pattern 5 — FindAll (direct REST)

```bash
curl -sS https://api.parallel.ai/v1/findall/runs \
  -H "x-api-key: $PARALLEL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "input": "AI inference startups that raised a Series A in 2026",
    "max_results": 50
  }'
```

Returns a structured list of entities matching the description, each with a source.

### Optional convenience — parallel-cli

Power users can wrap patterns 3–5 behind `parallel-cli` (a published Python CLI: `pipx install parallel-web`). It is **not** required to use this skill — every pattern above works with `curl` and the MCP tools alone.

## Anti-Patterns

- **Don't invent URLs.** Cite only URLs that actually appeared in tool output. If a fact has no source from the call, label it as uncited or run another query.
- **Don't escalate by default.** A normal "look up X" question should use `web_search`, not the Task API or Deep Research. Deep research is 10–100× slower and more expensive.
- **Don't use `web_fetch` for general queries.** It is for specific URLs the user supplied or that a search step surfaced — not as a discovery tool. Always reach for `web_search` first.
- **Don't paste raw API keys into the chat or commit them.** The `PARALLEL_API_KEY` env var is the only acceptable channel. Anonymous MCP use works for many cases anyway.
- **Don't hammer with one-keyword `search_queries`.** Parallel's objective+queries pattern is designed to replace several keyword searches with one call. Pass a real objective and 2–4 supplementary queries, not five separate single-keyword calls.

## Best Practices

- Lead with the objective. The `objective` field is the part the engine actually uses to rank and synthesize; treat the `search_queries` as keyword hints, not a query list.
- Cite everything. Every claim in the final answer should have a `[Title](url)` link drawn from tool output. End with a `Sources:` section listing each URL used.
- For time-sensitive lookups, add `after_date: "YYYY-MM-DD"` (Search) or use a fresher processor (Task/Deep Research without the `-fast` suffix).
- Save large structured payloads to a file (`-o /tmp/research-NAME.json` if using the CLI, or write the parsed JSON yourself) and reference the file path back to the user — don't flood the conversation with raw JSON.
- For follow-up questions on the same topic, prefer narrower `web_search` calls over restarting a Task or Deep Research run.

## Related Skills

- `exa-search` — Alternative neural search via Exa. Use Parallel for objective-driven multi-query searches; Exa shines for code/people lookups.
- `deep-research` — Multi-step research workflow combining several MCPs. Compatible with Parallel's `web_search`/`web_fetch`.
- `docs-lookup` — Library/framework docs via Context7. Use it for "how do I use library X"; use this skill for everything else web-shaped.
