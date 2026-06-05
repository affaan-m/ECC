---
name: lead-intelligence
description: AI-native lead intelligence and outreach pipeline. Replaces Apollo, Clay, and ZoomInfo with agent-powered signal scoring, mutual ranking, warm path discovery, source-derived voice modeling, and channel-specific outreach across email, LinkedIn, and X. Use when the user wants to find, qualify, and reach high-value contacts.
origin: ECC
---

# Lead Intelligence

Agent-powered lead intelligence pipeline that finds, scores, and reaches high-value contacts through social graph analysis and warm path discovery.

## When to Activate

- User wants to find leads or prospects in a specific industry
- Building an outreach list for partnerships, sales, or fundraising
- Researching who to reach out to and the best path to reach them
- User says "find leads", "outreach list", "who should I reach out to", "warm intros"
- Needs to score or rank a list of contacts by relevance
- Wants to map mutual connections to find warm introduction paths

## Tool Requirements

### Required
- **Exa MCP** — Deep web search for people, companies, and signals (`web_search_exa`)
- **X API** — Follower/following graph, mutual analysis, recent activity (`X_BEARER_TOKEN`, plus write-context credentials such as `X_CONSUMER_KEY`, `X_CONSUMER_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_TOKEN_SECRET`)

### Optional (enhance results)
- **LinkedIn** — Direct API if available, otherwise browser control for search, profile inspection, and drafting
- **Apollo/Clay API** — For enrichment cross-reference if user has access
- **GitHub MCP** — For developer-centric lead qualification
- **Apple Mail / Mail.app** — Draft cold or warm email without sending automatically
- **Browser control** — For LinkedIn and X when API coverage is missing or constrained

## Pipeline Overview

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐     ┌──────────────┐     ┌─────────────────┐
│ 1. Signal   │────>│ 2. Mutual    │────>│ 3. Warm Path    │────>│ 4. Enrich    │────>│ 5. Outreach     │
│    Scoring  │     │    Ranking   │     │    Discovery    │     │              │     │    Draft        │
└─────────────┘     └──────────────┘     └─────────────────┘     └──────────────┘     └─────────────────┘
```

## Voice Before Outreach

Do not draft outbound from generic sales copy.

Run `brand-voice` first whenever the user's voice matters. Reuse its `VOICE PROFILE` instead of re-deriving style ad hoc inside this skill.

If live X access is available, pull recent original posts before drafting. If not, use supplied examples or the best repo/site material available.

## Stage 1: Signal Scoring

Search for high-signal people in target verticals. Assign a weight to each based on:

| Signal | Weight | Source |
|--------|--------|--------|
| Role/title alignment | 30% | Exa, LinkedIn |
| Industry match | 25% | Exa company search |
| Recent activity on topic | 20% | X API search, Exa |
| Follower count / influence | 10% | X API |
| Location proximity | 10% | Exa, LinkedIn |
| Engagement with your content | 5% | X API interactions |

### Signal Search Approach

```python
# Step 1: Define target parameters
target_verticals = ["prediction markets", "AI tooling", "developer tools"]
target_roles = ["founder", "CEO", "CTO", "VP Engineering", "investor", "partner"]
target_locations = ["San Francisco", "New York", "London", "remote"]

# Step 2: Exa deep search for people
for vertical in target_verticals:
    results = web_search_exa(
        query=f"{vertical} {role} founder CEO",
        category="company",
        numResults=20
    )
    # Score each result

# Step 3: X API search for active voices
x_search = search_recent_tweets(
    query="prediction markets OR AI tooling OR developer tools",
    max_results=100
)
# Extract and score unique authors
```

## Stage 2: Mutual Ranking

For each scored target, analyze the user's social graph to find the warmest path.

### Ranking Model

1. Pull user's X following list and LinkedIn connections
2. For each high-signal target, check for shared connections
3. Apply the `social-graph-ranker` model to score bridge value
4. Rank mutuals by:

| Factor | Weight |
|--------|--------|
| Number of connections to targets | 40% — highest weight, most connections = highest rank |
| Mutual's current role/company | 20% — decision maker vs individual contributor |
| Mutual's location | 15% — same city = easier intro |
| Industry alignment | 15% — same vertical = natural intro |
| Mutual's X handle / LinkedIn | 10% — identifiability for outreach |

Canonical rule:

```text
Use social-graph-ranker when the user wants the graph math itself,
the bridge ranking as a standalone report, or explicit decay-model tuning.
```

Inside this skill, use the same weighted bridge model:

```text
B(m) = Σ_{t ∈ T} w(t) · λ^(d(m,t) - 1)
R(m) = B_ext(m) · (1 + β · engagement(m))
```

Interpretation:
- Tier 1: high `R(m)` and direct bridge paths -> warm intro asks
- Tier 2: medium `R(m)` and one-hop bridge paths -> conditional intro asks
- Tier 3: no viable bridge -> direct cold outreach using the same lead record

### Output Format

```

If the user explicitly wants the ranking engine broken out, the math visualized, or the network scored outside the full lead workflow, run `social-graph-ranker` as a standalone pass first and feed the result back into this pipeline.
MUTUAL RANKING REPORT
=====================

#1  @mutual_handle (Score: 92)
    Name: Jane Smith
    Role: Partner @ Acme Ventures
    Location: San Francisco
    Connections to targets: 7
    Connected to: @target1, @target2, @target3, @target4, @target5, @target6, @target7
    Best intro path: Jane invested in Target1's company

#2  @mutual_handle2 (Score: 85)
    ...
```

## Stage 3: Warm Path Discovery

For each target, find the shortest introduction chain:

```
You ──[follows]──> Mutual A ──[invested in]──> Target Company
You ──[follows]──> Mutual B ──[co-founded with]──> Target Person
You ──[met at]──> Event ──[also attended]──> Target Person
```

### Path Types (ordered by warmth)
1. **Direct mutual** — You both follow/know the same person
2. **Portfolio connection** — Mutual invested in or advises target's company
3. **Co-worker/alumni** — Mutual worked at same company or attended same school
4. **Event overlap** — Both attended same conference/program
5. **Content engagement** — Target engaged with mutual's content or vice versa

## Stage 4: Enrichment

For each qualified lead, pull:

- Full name, current title, company
- Company size, funding stage, recent news
- Recent X posts (last 30 days) — topics, tone, interests
- Mutual interests with user (shared follows, similar content)
- Recent company events (product launch, funding round, hiring)

### Enrichment Sources
- Exa: company data, news, blog posts
- X API: recent tweets, bio, followers
- GitHub: open source contributions (for developer-centric leads)
- LinkedIn (via browser-use): full profile, experience, education

## Stage 5: Outreach Draft

Generate personalized outreach for each lead. The draft should match the source-derived voice profile and the target channel.

### Channel Rules

#### Email

- Use for the highest-value cold outreach, warm intros, investor outreach, and partnership asks
- Default to drafting in Apple Mail / Mail.app when local desktop control is available
- Create drafts first, do not send automatically unless the user explicitly asks
- Subject line should be plain and specific, not clever

#### LinkedIn

- Use when the target is active there, when mutual graph context is stronger on LinkedIn, or when email confidence is low
- Prefer API access if available
- Otherwise use browser control to inspect profiles, recent activity, and draft the message
- Keep it shorter than email and avoid fake professional warmth

#### X

- Use for high-context operator, builder, or investor outreach where public posting behavior matters
- Prefer API access for search, timeline, and engagement analysis
- Fall back to browser control when needed
- DMs and public replies should be much tighter than email and should reference something real from the target's timeline

#### Channel Selection Heuristic

Pick one primary channel in this order:

1. warm intro by email
2. direct email
3. LinkedIn DM
4. X DM or reply

Use multi-channel only when there is a strong reason and the cadence will not feel spammy.

### Warm Intro Request (to mutual)

Goal:

- one clear ask
- one concrete reason this intro makes sense
- easy-to-forward blurb if needed

Avoid:

- overexplaining your company
- social-proof stacking
- sounding like a fundraiser template

### Direct Cold Outreach (to target)

Goal:

- open from something specific and recent
- explain why the fit is real
- make one low-friction ask

Avoid:

- generic admiration
- feature dumping
- broad asks like "would love to connect"
- forced rhetorical questions

### Execution Pattern

For each target, produce:

1. the recommended channel
2. the reason that channel is best
3. the message draft
4. optional follow-up draft
5. if email is the chosen channel and Apple Mail is available, create a draft instead of only returning text

If browser control is available:

- LinkedIn: inspect target profile, recent activity, and mutual context, then draft or prepare the message
- X: inspect recent posts or replies, then draft DM or public reply language

If desktop automation is available:

- Apple Mail: create draft email with subject, body, and recipient

Do not send messages automatically without explicit user approval.

### Anti-Patterns

- generic templates with no personalization
- long paragraphs explaining your whole company
- multiple asks in one message
- fake familiarity without specifics
- bulk-sent messages with visible merge fields
- identical copy reused for email, LinkedIn, and X
- platform-shaped slop instead of the author's actual voice

## Configuration

Users should set these environment variables:

```bash
# Required
export X_BEARER_TOKEN="..."
export X_ACCESS_TOKEN="..."
export X_ACCESS_TOKEN_SECRET="..."
export X_CONSUMER_KEY="..."
export X_CONSUMER_SECRET="..."
export EXA_API_KEY="..."

# Optional
export LINKEDIN_COOKIE="..." # For browser-use LinkedIn access
export APOLLO_API_KEY="..."  # For Apollo enrichment
```

## Agents

This skill includes specialized agents in the `agents/` subdirectory:

- **signal-scorer** — Searches and ranks prospects by relevance signals
- **mutual-mapper** — Maps social graph connections and finds warm paths
- **enrichment-agent** — Pulls detailed profile and company data
- **outreach-drafter** — Generates personalized messages

## Example Usage

```
User: find me the top 20 people in prediction markets I should reach out to

Agent workflow:
1. signal-scorer searches Exa and X for prediction market leaders
2. mutual-mapper checks user's X graph for shared connections
3. enrichment-agent pulls company data and recent activity
4. outreach-drafter generates personalized messages for top ranked leads

Output: Ranked list with warm paths, voice profile summary, and channel-specific outreach drafts or drafts-in-app
```

## Related Skills

- `brand-voice` for canonical voice capture
- `connections-optimizer` for review-first network pruning and expansion before outreach
