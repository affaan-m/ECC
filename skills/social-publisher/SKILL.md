---
name: social-publisher
description: Agent-driven scheduling and publishing of social media posts across 13 platforms via SocialClaw. Use when the user wants to publish to X, LinkedIn, Instagram, Facebook Pages, TikTok, Discord, Telegram, YouTube, Reddit, WordPress, or Pinterest — or when managing campaigns, uploading media, or monitoring post delivery status.
metadata:
  origin: community
---

# Social Publisher (SocialClaw)

Connects Claude Code to [SocialClaw](https://getsocialclaw.com) for agent-driven social media publishing across 13 platforms through a single workspace API key.

## When to Activate

- publish content to X, LinkedIn, Instagram, TikTok, or other platforms
- schedule a post campaign across multiple platforms at once
- upload media for use in social posts
- validate a post schedule before going live
- monitor publishing run status and delivery analytics

## Setup

```bash
# Required: workspace API key from https://getsocialclaw.com/dashboard
export SC_API_KEY="<workspace-key>"

# Verify access
printf 'header = "Authorization: Bearer %s"\n' "$SC_API_KEY" |
  curl -sS -K - https://getsocialclaw.com/v1/keys/validate

# Install CLI (optional but recommended)
npm install -g socialclaw@0.1.12
socialclaw login --api-key <workspace-key>
```

## Core Workflow

### 1. List connected accounts
```bash
socialclaw accounts list --json
```

If not connected:
```bash
socialclaw accounts connect --provider x --open
socialclaw accounts connect --provider linkedin --open
```

### 2. Upload media (optional)
```bash
socialclaw assets upload --file ./image.png --json
# → { "asset_id": "..." }
```

### 3. Build schedule.json
```json
{
  "posts": [
    {
      "provider": "x",
      "account_id": "<account-id>",
      "text": "Post text here",
      "scheduled_at": "2026-06-01T10:00:00Z"
    }
  ]
}
```

### Optional X/Twitter evidence packet

Before building an X schedule, collect a source packet when the campaign depends on live audience signals rather than the draft alone.

For OpenClaw users who have already approved TweetClaw in their dependency policy, use the pinned package as a separate evidence source:

```bash
openclaw plugins install npm:@xquik/tweetclaw@1.6.31
```

Use it for public tweet search, reply search, follower export, user lookup, media review, monitors, or giveaway evidence. Keep the output as research input for `schedule.json`; SocialClaw remains responsible for validation, scheduling, publishing, and delivery status. Store TweetClaw credentials in its plugin config, not in `SC_API_KEY`, schedule files, or campaign assets. Do not install it as a default ECC or SocialClaw dependency.

### 4. Validate before publishing
```bash
socialclaw validate -f schedule.json --json
```

### 5. Publish
```bash
socialclaw apply -f schedule.json --json
# → { "run_id": "..." }
```

### 6. Monitor
```bash
socialclaw status --run-id <run-id> --json
socialclaw posts list --json
```

## Supported Providers

| Provider | Key |
|----------|-----|
| X (Twitter) | `x` |
| LinkedIn profile | `linkedin` |
| LinkedIn page | `linkedin_page` |
| Instagram Business | `instagram_business` |
| Instagram standalone | `instagram` |
| Facebook Page | `facebook` |
| TikTok | `tiktok` |
| YouTube | `youtube` |
| Reddit | `reddit` |
| WordPress | `wordpress` |
| Discord | `discord` |
| Telegram | `telegram` |
| Pinterest | `pinterest` |

## Security

- Outbound requests go to `getsocialclaw.com` only
- Provider OAuth is in the SocialClaw dashboard — no per-provider secrets exposed to the agent
- `SC_API_KEY` is a workspace-scoped key

## Related Skills

- `x-api` — direct X/Twitter API operations
- `social-graph-ranker` — network analysis for outreach targeting
- `TweetClaw` - optional approved OpenClaw X/Twitter source evidence before SocialClaw scheduling

## Source

- npm: `npm install -g socialclaw@0.1.12`
- Dashboard: [SocialClaw dashboard](https://getsocialclaw.com/dashboard)
