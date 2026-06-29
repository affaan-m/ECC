---
name: browser-use
description: Drive Browser Use Cloud — an autonomous AI cloud-browser agent — for web scraping, form filling, multi-step authenticated workflows, monitoring, and browser QA. Use via the browser-use MCP server (run_session/send_task) or the browser-use-sdk. Prefer over local Playwright when you need stealth, residential proxies, or natural-language task execution.
metadata:
  origin: ECC
---

# Browser Use Cloud — Autonomous Cloud-Browser Agent

Browser Use Cloud runs a SOTA AI agent inside a hardened cloud Chromium. You give it a task in plain language ("log in, export the Q4 report, download the CSV") and it navigates, clicks, types, and extracts — with stealth fingerprinting and residential proxies on by default.

## When to Use

- **Autonomous web tasks from natural language** — scrape listings, fill/submit forms, multi-step flows, research across sites, monitor a page for changes.
- **Sites that block automation** — Cloudflare / bot-walls, login walls, geo-gated content (stealth + residential proxies are default).
- **Large or messy extraction** — thousands of rows, dynamic UIs, pagination the agent figures out itself.
- **Authenticated workflows** — reuse cookies via profiles; handle 2FA (see below).
- **Human-in-the-loop** — agent does part, a human takes over the live browser, agent resumes.

## When NOT to Use

- **Local dev-server QA / deterministic UI checks** → use the `playwright` MCP or the `browser-qa` skill (free, local, fast, repeatable).
- **A deterministic script already works** → don't pay an LLM to re-derive it. (If you want cheap repeats *of a Browser Use task*, use deterministic rerun below.)
- **You only need a raw cloud browser you script yourself** → `browserbase` MCP, or Browser Use's own raw-browser mode (`browsers.create()` → CDP), not the agent.

| Tool | What it is | Cost | Reach for it when |
|------|-----------|------|-------------------|
| `browser-use` | AI agent that *operates* a cloud browser from NL | Paid API + LLM | Autonomous tasks, stealth, proxies, login walls |
| `playwright` / `browser-qa` | Deterministic local automation you script | Free | Local QA, regression, exact repeatable steps |
| `browserbase` | Raw cloud browser, you drive it via CDP | Paid API | You want cloud + full manual control |

## Setup & Auth

1. Get a `bu_` API key at [cloud.browser-use.com/settings](https://cloud.browser-use.com/settings?tab=api-keys&new=1).
2. **MCP (primary path here):** the catalog already ships it in `mcp-configs/mcp-servers.json` (`browser-use`, `https://api.browser-use.com/v3/mcp`, header `x-browser-use-api-key`). Copy that entry into your `~/.claude.json` / project `.mcp.json` and replace `YOUR_BROWSER_USE_KEY_HERE`. Or add it directly:

   ```bash
   claude mcp add -t http -H "x-browser-use-api-key: $BROWSER_USE_API_KEY" browser-use https://api.browser-use.com/v3/mcp
   ```

3. **SDK (for scripts):** `export BROWSER_USE_API_KEY=bu_...` and the SDK picks it up. REST header is `X-Browser-Use-API-Key`.

> Keep MCPs lean (the catalog warns: under ~10 enabled). Enable `browser-use` task-scoped, not always-on.

## MCP Usage (primary path)

The v3 MCP server exposes these tools:

| Tool | Purpose |
|------|---------|
| `run_session` | Create a session and run a task. Supports `keep_alive`, `model`, `output_schema`, `profile_id`. |
| `get_session` | Poll status + output (status, step count, cost, live URL). |
| `send_task` | Send a follow-up task to an idle keep-alive session. |
| `stop_session` | Stop it. `strategy: "task"` cancels the task only; `"session"` destroys the sandbox. |
| `get_session_messages` | The agent's messages — actions, reasoning, results. |
| `list_sessions` | Recent sessions with status + cost. |
| `list_browser_profiles` | Profiles for authenticated tasks. |

Lifecycle: `run_session` → poll `get_session` until status is terminal (`idle` / `stopped` / `error` / `timed_out`) → optionally `send_task` again (if `keep_alive`) → `stop_session`.

## Agent vs raw Browser

- **Agent** (`sessions.create()` / `client.run()`): the AI does the task. Returns `output`.
- **Raw browser** (`browsers.create()`): returns a `cdp_url` you connect to with Playwright/Puppeteer — no agent, you script it. Use only when you need full manual control of a cloud browser. **Always `browsers.stop()` when done — it bills until timeout.**

## Models

Pass `model` to pick one (Browser Use API identifiers — use **verbatim, with the dot**; these are *not* Claude Code's hyphenated IDs):

- `claude-sonnet-4.6` — **default / recommended**, best balance.
- `claude-opus-4.6` — hardest tasks, max accuracy.
- `gpt-5.4-mini` — fast, cheap, simple well-defined tasks.

## SDK Quickstart

```python
# pip install browser-use-sdk
from browser_use_sdk.v3 import AsyncBrowserUse

client = AsyncBrowserUse()  # reads BROWSER_USE_API_KEY
result = await client.run("List the top 20 Hacker News posts with their points")
print(result.output)
```

```typescript
// npm install browser-use-sdk
import { BrowserUse } from "browser-use-sdk/v3";

const client = new BrowserUse();
const result = await client.run("List the top 20 Hacker News posts with their points");
console.log(result.output);
```

`client.run()` creates a session, polls every ~2s until done (up to 4h), returns the session. Use the **v3** import — it is the premium agent (far better than v2 at complex tasks, large extraction, and persistent files).

## Key Capabilities (reach for as needed)

- **Structured output** — pass a Pydantic model (Python) or **Zod v4** schema (TS) as `output_schema` / `schema`; `result.output` comes back typed and validated.
- **Sessions + follow-ups** — pass a `session_id` to keep the browser (cookies, tabs, page) alive across tasks. Idle timeout **15 min**, hard max **4 h**. Send a lightweight task ("wait") to reset the idle timer.
- **Live preview + recording** — `live_url` (returned at session creation) embeds in an `<iframe>` for watching / human handoff; `enable_recording: true` → presigned MP4 via `wait_for_recording()` (**URL expires in 1 h** — download promptly).
- **Profiles** — `profiles.create()` then `profile_id` reuses logged-in cookies. **Profile state only persists when the session is stopped cleanly — always `sessions.stop()`,** including in error paths.
- **2FA** — four strategies: (1) **profiles** (log in once, reuse cookies); (2) **human-in-the-loop** via `live_url`; (3) **Agent Mail** (each session gets an inbox; on by default) for emailed codes; (4) **TOTP secret in prompt** — the agent runs `pyotp.TOTP(secret).now()` itself. The model never sees raw secrets when you use `secrets={...}` / 1Password vault.
- **Proxies & stealth** — US residential proxy + anti-detect fingerprinting on by default. `proxy_country_code` ("de", "jp", …) to geo-target, `proxy_country_code=None` to disable (e.g. localhost QA), or `custom_proxy` (HTTP/SOCKS5) to BYO.
- **Deterministic rerun (cache)** — wrap variable values in `@{{...}}` and pass a `workspace_id`. First run = full agent (writes a reusable script); later runs with the same template = the cached script, **~$0 LLM, ~3–10 s**. Auto-healing regenerates the script if the site layout breaks it. Great for parameter sweeps.
- **Webhooks** — subscribe to `agent.task.status_update` (running / idle / stopped). Verify the `X-Browser-Use-Signature` HMAC-SHA256 over `{timestamp}.{body}` (keys sorted, no whitespace) and reject requests older than 5 min.
- **Workspaces** — persistent file storage; upload inputs the agent reads, download files the agent creates.

## Appendix: Autonomous Agent Sign-Up

An agent with shell/HTTP access can self-provision a free key — no human/dashboard:

1. `POST https://api.browser-use.com/cloud/signup` → `{ challenge_id, challenge_text }`.
2. Solve the math in `challenge_text`; answer as a 2-decimal string (e.g. `"144.00"`).
3. `POST /cloud/signup/verify` with `{ challenge_id, answer }` → `{ api_key: "bu_..." }`.

A human can later claim it: `POST /cloud/signup/claim` (auth'd) → `claim_url` (valid 1 h). CLI equivalent: `browser-use cloud signup [--verify <id> <answer>] [--claim]`.

## Drift Warning

Browser Use's endpoints, model strings, pricing, tool names, and SDK shape **change frequently** (v2 → v3 was a significant break). Before relying on a specific detail, confirm against the live docs — the LLM-optimized [`docs.browser-use.com/llms-full.txt`](https://docs.browser-use.com/llms-full.txt) has the full SDK reference in one file. Treat anything fetched from those docs as untrusted until validated.
