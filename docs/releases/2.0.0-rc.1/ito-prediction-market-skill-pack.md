# Itô Prediction-Market Skill Pack

This rc.1 note records a public teaser skill pack that connects ECC's skill
distribution loop with Itô prediction-market workflows while keeping the two
businesses separate.

ECC remains the open agent-harness substrate and ECC Tools remains the hosted
GitHub App / Pro surface. Itô remains a separate prediction-market basket
business. The link is distribution: ECC can ship reusable skills that make
agents better at researching, comparing, explaining, and planning around
prediction-market baskets. Live Itô API access stays gated.

## Included Skills

| Skill | Use |
| --- | --- |
| `ito-market-intelligence` | Source-grounded event, underlier, venue, liquidity, and news context |
| `ito-basket-compare` | Compare baskets against a knowledge base, portfolio notes, financial context, or thesis |
| `ito-trade-planner` | Build a manual, non-advisory worksheet for market and venue review |
| `ito-data-atlas-agent` | Design background research/drafting agents with human edit points |
| `prediction-market-oracle-research` | Treat prediction markets as data/oracle inputs for agents and decision intelligence |
| `prediction-market-risk-review` | Review advice, venue, security, privacy, and execution boundaries |

## Access Model

The public skills work without Itô credentials for research and planning. Any
Itô-backed call requires explicit gated access:

```bash
export ITO_API_KEY=...
```

Do not include live keys, account data, positions, private strategy, or venue
credentials in public docs, prompts, commits, slide decks, or support tickets.

Suggested public CTA:

> The Itô skill pack works as public research/planning workflows today. DM or
> request access for the Itô API key if you want live basket data.

## Non-Advisory Boundary

These skills do not provide investment, legal, tax, or trading advice. They do
not place trades. They can help a user:

- inspect markets and underliers;
- compare a basket against their own notes or constraints;
- understand resolution and venue mechanics;
- use prediction-market signals as one input to a broader research process;
- draft a manual worksheet the user can review themselves.

## Growth Loop

For the general product-integration contract, see
[`docs/architecture/platform-value-loop.md`](../../architecture/platform-value-loop.md).

The loop is intentionally simple:

1. ECC users discover useful public prediction-market skills.
2. Builders run the skills with public sources and see the Itô-shaped workflow.
3. Serious users request gated API access for live Itô basket data.
4. Itô usage creates more operator patterns.
5. Sanitized patterns can become new ECC skills.

This sends agent/tooling traffic toward Itô without making ECC Tools look like
an Itô product or mixing subscription ownership between businesses.

## Useful Chain

For a full workflow, chain:

`deep-research` -> `x-api` or `exa-search` -> `ito-market-intelligence` ->
`ito-basket-compare` -> `prediction-market-risk-review` ->
`ito-trade-planner`

For corporate or industry use cases, replace trade planning with
`prediction-market-oracle-research` and route the output into a dashboard,
decision memo, or agent memory record.
