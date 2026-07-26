---
name: analyst-ops
description: Evidence-first analyst operations workflow for metric definitions, source-backed numbers, decision readouts, and chart integrity.
metadata:
  origin: ECC
---

# Analyst Ops

Use this when the user is preparing, reviewing, or pressure-testing an analytical readout for business, product, finance, operations, people, or go-to-market decisions.

This is not a generic reporting template. The purpose is to keep analytical work traceable: no number ships unless the source, definition, denominator, grain, and time window are clear.

## Skill Stack

Pull these ECC-native skills into the workflow when relevant:

- `research-ops` when external facts, public datasets, or current market evidence matter
- `market-research` when the analysis supports a market, competitor, investor, or category decision
- `verification-loop` when the readout must pass an explicit evidence and consistency check
- `dashboard-builder` when the output becomes a reusable dashboard or metric surface
- `data-scraper-agent` when source collection needs repeatable extraction from pages or files
- `knowledge-ops` when definitions or decisions should be captured for future reuse

## When to Use

- user asks for a business, product, ops, HR, procurement, or sales analysis
- user has a report, chart, dashboard, spreadsheet, or executive readout to verify
- the answer includes metrics, percentages, rates, rankings, forecasts, segments, or benchmarks
- the task requires turning messy evidence into a recommendation

## Guardrails

- do not present a number without a named source
- define each metric before interpreting it
- state denominator, grain, time window, and snapshot timestamp when available
- separate fact, inference, assumption, and recommendation
- do not imply causation from correlation without a defensible causal design
- do not blend cohorts, currencies, regions, or time windows without labeling the blend
- do not hide missing data, exclusions, filters, or sample-size limits
- do not use charts that distort scale, baseline, or uncertainty

## Workflow

### 1. Pin the decision

Start by naming what the analysis is meant to change:

- decision owner
- decision date or cadence
- options being compared
- cost of being wrong
- required confidence level

If the user only asks for "analysis", infer the likely decision and label it as an assumption.

### 2. Build the metric contract

For every important metric, capture:

- name
- definition
- numerator
- denominator
- grain
- time window
- source
- freshness or snapshot timestamp
- known exclusions

If any field is missing, mark the metric as provisional before using it in a recommendation.

### 3. Classify the evidence

Separate the readout into:

- sourced facts
- calculated facts
- assumptions
- inferences
- recommendations

Do not let a recommendation inherit the certainty of the facts underneath it.

### 4. Check comparisons and segments

Before comparing two numbers, verify:

- same metric definition
- same denominator
- same grain
- same time window
- same currency or unit
- comparable cohorts or segments

If they are not comparable, explain the mismatch instead of forcing the comparison.

### 5. Review chart integrity

For every chart or table, check:

- axis baseline and scale
- sort order
- labels and units
- sample size or row count
- treatment of missing values
- whether uncertainty or volatility should be shown
- whether the visual claim matches the underlying data

### 6. End with decision-grade output

Deliver a readout that makes the next action clearer:

- answer
- evidence
- caveats
- confidence
- recommended next step
- one follow-up analysis that would most reduce uncertainty

## Output Format

```text
DECISION
- owner / decision / date

METRIC CONTRACT
- metric
- definition
- source
- denominator / grain / time window
- freshness

FINDINGS
- fact
- inference
- caveat

RECOMMENDATION
- action
- confidence
- risk if wrong

FOLLOW-UP
- highest-value missing evidence
```

## Pitfalls

- treating dashboard labels as definitions
- using percentages without denominators
- comparing a weekly rate to a monthly count
- using trailing averages without saying the window
- presenting a filtered segment as the whole population
- ignoring survivorship bias, seasonality, or channel mix
- making a chart persuasive before making it truthful

## Verification

- every important number has a named source
- every key metric has a definition and denominator
- facts, assumptions, inferences, and recommendations are separated
- comparisons use compatible grain, time window, and population
- chart claims match their axes, labels, and underlying data
