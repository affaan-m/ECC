---
name: cost-tracking
description: Track and report Claude Code token usage, spending, and budgets from the local ECC cost-tracker metrics log. Use when the user asks about costs, spending, usage, tokens, budgets, or cost breakdowns by model, session, or date.
metadata:
  origin: community
---

# Cost Tracking

Use this skill to analyze Claude Code cost and usage history from the metrics log
that ECC's `stop:cost-tracker` hook writes.

## Where the data lives

The tracker appends one JSON object per session-stop to
`~/.claude/metrics/costs.jsonl`. Each row is a **cumulative snapshot for that
session**, so to total spend you take the **latest row per `session_id`** and
sum across sessions — summing every row multiply-counts.

Row schema:

| Field | Meaning |
| --- | --- |
| `timestamp` | ISO timestamp of the snapshot |
| `session_id` | Claude Code session identifier |
| `transcript_path` | Path to the session transcript |
| `model` | Model used |
| `input_tokens` / `output_tokens` | Token counts |
| `cache_write_tokens` / `cache_read_tokens` | Prompt-cache token counts |
| `estimated_cost_usd` | Precomputed cumulative cost in USD for the session |

Prefer `estimated_cost_usd` over hand-calculating pricing — model and cache
prices change, and the tracker is the source of truth.

## When to Use

- The user asks "how much have I spent?", "what did this session cost?", or
  "what is my token usage?"
- The user mentions budgets, spending limits, overruns, or cost controls.
- The user wants a cost breakdown by model, session, or date, or a CSV export.

## How It Works

First verify the log exists (use `node`, not `sqlite3` — the tracker writes
JSONL, and `node` is cross-platform):

```bash
node -e 'const fs=require("fs"),os=require("os"),p=require("path");const f=p.join(os.homedir(),".claude","metrics","costs.jsonl");console.log(fs.existsSync(f)?"cost log found":"cost log not found: "+f)'
```

If the log is missing, do not fabricate usage data. Tell the user that cost
tracking populates after the first session ends with the `stop:cost-tracker`
hook enabled.

## Example — summary, by model, last 7 days

```bash
node -e '
const fs=require("fs"),os=require("os"),path=require("path");
const f=path.join(os.homedir(),".claude","metrics","costs.jsonl");
if(!fs.existsSync(f)){console.log("cost log not found: "+f);process.exit(0);}
const rows=fs.readFileSync(f,"utf8").split(/\r?\n/).filter(Boolean).map(l=>{try{return JSON.parse(l)}catch{return null}}).filter(Boolean);
const bySession=new Map();
for(const r of rows){const k=r.session_id||r.transcript_path||r.timestamp;const p=bySession.get(k);if(!p||String(r.timestamp)>String(p.timestamp))bySession.set(k,r);}
const latest=[...bySession.values()];
const cost=r=>Number(r.estimated_cost_usd)||0, day=r=>String(r.timestamp||"").slice(0,10), sum=a=>a.reduce((s,r)=>s+cost(r),0), f4=n=>"$"+n.toFixed(4);
const today=new Date().toISOString().slice(0,10), yest=new Date(Date.now()-864e5).toISOString().slice(0,10);
console.log("today: "+f4(sum(latest.filter(r=>day(r)===today)))+" | yesterday: "+f4(sum(latest.filter(r=>day(r)===yest)))+" | total: "+f4(sum(latest))+" ("+latest.length+" sessions)");
const m=new Map();for(const r of latest){const k=r.model||"(unknown)";m.set(k,(m.get(k)||0)+cost(r));}
console.log("by model:");[...m.entries()].sort((a,b)=>b[1]-a[1]).forEach(([k,v])=>console.log("  "+f4(v)+"  "+k));
'
```

For a session drilldown or CSV export, iterate the same `latest` set (or the raw
rows for CSV) and print the fields you need.

## Reporting Guidance

When presenting cost data, include today's spend vs yesterday, total across all
sessions, a by-model breakdown, and session count. Format sub-dollar amounts
with four decimals, larger amounts with two.

## Anti-Patterns

- Do not sum every row — they are cumulative per session; reduce to the latest
  row per `session_id` first.
- Do not estimate costs from raw token counts when `estimated_cost_usd` is present.
- Do not assume the log exists without checking.
- Do not hard-code current model pricing in user-facing answers.
- Do not recommend installing unreviewed hooks or plugins that execute arbitrary code.

## Related

- `/cost-report` - Command-form report over the same metrics log.
- `cost-aware-llm-pipeline` - Model-routing and budget-design patterns.
- `token-budget-advisor` - Context and token-budget planning.
- `strategic-compact` - Context compaction to reduce repeated token spend.
