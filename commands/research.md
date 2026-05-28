---
description: Web research with citation-backed answers via Parallel — uses the parallel-search MCP for fast lookups and escalates to Task / Deep Research / FindAll APIs when warranted.
---

# Research

Web research grounded in the live web, with every claim cited.

## Usage

```
/research <topic or question>
```

Examples:

```
/research newest stable Bun runtime version
/research compare open-source agent frameworks released in 2026
/research find all AI inference startups that raised a Series A in 2026
/research summarize https://docs.parallel.ai/integrations/mcp/search-mcp
```

## Workflow

1. **Classify the request.** Decide whether the question needs Search, URL extraction, a structured Task, Deep Research, or FindAll. See `skills/parallel-research/SKILL.md` for the decision table.
2. **Dispatch to the agent.** Hand the topic to `agents/parallel-researcher.md`, which runs the appropriate Parallel surface and synthesizes a citation-backed answer (`agent: parallel-researcher`).
3. **Return the answer.** Inline `[Title](url)` citations for every claim, followed by a `Sources:` section listing every URL.

For Task / Deep Research / FindAll runs that take minutes, the command immediately prints the `run_id`, the monitoring URL, and the expected latency for the chosen processor tier so the user can keep working while results come in.

## Requirements

- The **Parallel Search** MCP server (`parallel-search` in `mcp-configs/mcp-servers.json`) configured in `~/.claude.json`. Anonymous use works; a `PARALLEL_API_KEY` Bearer header unlocks higher rate limits.
- For Task / Deep Research / FindAll: a `PARALLEL_API_KEY` env var (from [platform.parallel.ai](https://platform.parallel.ai)).

## Output

```
<one-sentence headline answer>

<details, every fact cited inline>

Sources:
- [Title](url) (date)
- [Title](url)
```

For background runs:

```
Kicked off Parallel <Task|Deep Research|FindAll>.

- run_id: <id>
- monitoring URL: <url>
- expected latency: <range>
```
