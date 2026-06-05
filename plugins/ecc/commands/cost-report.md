---
description: Generate a local Claude Code cost report from a cost-tracker SQLite database.
argument-hint: [csv]
---

# Cost Report

Query the local cost-tracking database and present a spending report by day,
project, tool, and session. This command assumes a cost-tracking hook or plugin
is already writing usage rows to `~/.claude-cost-tracker/usage.db`.

## What This Command Does

1. Check that `sqlite3` is available.
2. Check that `~/.claude-cost-tracker/usage.db` exists.
3. Run aggregate queries against the `usage` table.
4. Present a compact report, or export recent rows as CSV when the argument is
   `csv`.

## Prerequisites

The database must be populated by a local cost tracker. If the file is missing,
tell the user the tracker is not set up and suggest installing or enabling a
trusted Claude Code cost-tracking hook/plugin first.

```bash
test -f ~/.claude-cost-tracker/usage.db && echo "Database found" || echo "Database not found"
```

## Summary Query

```bash
sqlite3 -header -column ~/.claude-cost-tracker/usage.db "
  SELECT
    ROUND(COALESCE(SUM(CASE WHEN date(timestamp) = date('now') THEN cost_usd END), 0), 4) AS today_cost,
    ROUND(COALESCE(SUM(CASE WHEN date(timestamp) = date('now', '-1 day') THEN cost_usd END), 0), 4) AS yesterday_cost,
    ROUND(COALESCE(SUM(cost_usd), 0), 4) AS total_cost,
    COUNT(*) AS total_calls,
    COUNT(DISTINCT session_id) AS sessions
  FROM usage;
"
```

## Project Breakdown

```bash
sqlite3 -header -column ~/.claude-cost-tracker/usage.db "
  SELECT project, ROUND(SUM(cost_usd), 4) AS cost, COUNT(*) AS calls
  FROM usage
  GROUP BY project
  ORDER BY cost DESC;
"
```

## Tool Breakdown

```bash
sqlite3 -header -column ~/.claude-cost-tracker/usage.db "
  SELECT tool_name, ROUND(SUM(cost_usd), 4) AS cost, COUNT(*) AS calls
  FROM usage
  GROUP BY tool_name
  ORDER BY cost DESC;
"
```

## Last Seven Days

```bash
sqlite3 -header -column ~/.claude-cost-tracker/usage.db "
  SELECT date(timestamp) AS date, ROUND(SUM(cost_usd), 4) AS cost, COUNT(*) AS calls
  FROM usage
  GROUP BY date(timestamp)
  ORDER BY date DESC
  LIMIT 7;
"
```

## CSV Export

If the user asks for `/cost-report csv`, export the most recent usage rows with
an explicit column list:

```bash
sqlite3 -csv -header ~/.claude-cost-tracker/usage.db "
  SELECT timestamp, project, tool_name, input_tokens, output_tokens, cost_usd, session_id, model
  FROM usage
  ORDER BY timestamp DESC
  LIMIT 100;
"
```

## Report Format

Format the response as:

1. Summary: today, yesterday, total, calls, sessions.
2. By project: projects ranked by total cost.
3. By tool: tools ranked by total cost.
4. Last seven days: date, cost, call count.

Use four decimal places for sub-dollar amounts. Do not estimate pricing from raw
tokens in this command; rely on the precomputed `cost_usd` values written by the
tracker.

## Source

Salvaged from stale community PR #1304 by `MayurBhavsar`.
