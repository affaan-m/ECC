# ECC Platform Value Loop

ECC 2.0 is moving from a portable harness layer toward a full operator
system. The product direction is three layers:

1. Meta-harness: portable skills, rules, hooks, MCP conventions, release gates,
   evals, and security evidence.
2. Dedicated ECC agent: an agent that directly operates over ECC assets instead
   of only reading them as static instructions.
3. Control pane / agentic IDE: a visible operator surface for sessions, queues,
   skills, memory, evidence, releases, and team workflows.

The control pane is still a release-candidate direction until it is backed by a
reproducible demo. The public claim is:

```text
ECC can be used full-stack as a meta-harness + agent + control pane, or
selectively as the portable harness layer inside the AI coding tools teams
already use.
```

## OSS Platform Thesis

The older open-source infrastructure playbook was distribution first: free
source and generous self-serve access created the default developer vocabulary,
then hosted infrastructure, managed teams, support, and enterprise features
captured value. Databases, app platforms, and edge platforms made this obvious:
developers adopted the free surface, teams standardized on the brand, and the
paid product made the workflow easier to run at scale.

AI-agent infrastructure should follow the same shape, but the hosted value is
not just deployment. The paid or managed surface is:

- team memory and session routing;
- observable queues, handoffs, and agent runs;
- managed evals, release gates, and evidence packs;
- security review, supply-chain findings, and policy enforcement;
- billing, entitlement, sponsor, and partner workflows;
- product-specific integrations that can become reusable ECC skills.

The open repo stays useful on its own. The platform earns value when serious
teams want the same workflows managed, measured, secured, or connected to their
own products.

## Product Integration Contract

External products can build on ECC without becoming ECC-branded products. The
contract is:

| Layer | Product contributes | ECC receives |
| --- | --- | --- |
| Skill pack | Public, non-secret workflows in `skills/*/SKILL.md` | New reusable agent behavior and install surface |
| Gated API | Optional product credentials such as `PRODUCT_API_KEY` | A clear upgrade/request path without leaking secrets |
| Fixtures and docs | Sanitized examples, no private accounts or live keys | Testable public proof instead of claims |
| Eval and risk gates | Advice, safety, data, and execution boundaries | Reusable release discipline and trust surface |
| Case study | A real product workflow that works through ECC | Distribution, sponsors, Pro interest, consulting demand |

Every integration needs:

- a public workflow that works without private credentials;
- a separate gated path for live product data or actions;
- a clear business boundary so billing and ownership are not blurred;
- tests or documented commands proving the integration surface;
- a support route that does not require public secrets or private account data.

## Ito Example

Ito is a separate prediction-market basket product. ECC can still distribute
Ito-shaped skills because the skill workflows are useful without making ECC
Tools an Ito product.

The safe public surface is:

- research market, underlier, venue, and liquidity context;
- compare baskets against a user's own notes, portfolio constraints, or thesis;
- draft non-advisory trade-planning worksheets for manual review;
- visualize market/concept relationships and backtesting outputs when data is
  available;
- use prediction-market signals as one input into broader agent research.

The gated surface is:

- live Ito basket data;
- account-specific state;
- API-backed backtesting or visualization;
- any workflow requiring `ITO_API_KEY`.

The boundary is strict: public ECC skills do not place trades, do not provide investment advice, do not expose private strategy, and do not merge ECC Tools billing with Ito billing.

## Value Loop

The platform loop should be explicit:

1. A product team builds a useful workflow as an ECC skill pack.
2. The public skill pack works with public sources or local user-provided data.
3. Serious users request gated access for live product data or hosted features.
4. Product usage produces new operator patterns, failure modes, and examples.
5. Sanitized patterns become better ECC skills, evals, gates, or docs.
6. ECC gains distribution, maintainers, sponsors, Pro interest, and consulting leads.
7. The product gains adoption because agent users can operate it through an
   already-installed harness.

This is different from enterprise consulting alone. Consulting can fund the
work, but the platform goal is repeatable distribution: every useful product
integration becomes another reason to install ECC, and every serious ECC user
becomes a possible sponsor, Pro user, partner, or integration customer.

## Release Lane

Keep release claims separated:

- `1.10.1`: stable reliability and docs patch for released users.
- `1.11.0`: public OSS workflow-catalog momentum that does not require the
  control pane to be GA.
- `2.0.0-rc.x`: control-pane, dedicated-agent, platform, and release-evidence
  work while the full operator system remains prerelease.

Do not announce ORCA/CONDUCTOR-grade parity, marketplace billing, official
plugin-directory listing, live trading, or native-payments readiness without
fresh evidence and owner approval.
