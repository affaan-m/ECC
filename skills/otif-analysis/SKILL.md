---
name: otif-analysis
description: >
  Audit delivery performance from order-level data: compute the OTIF metric
  ladder from the tolerant reported KPI down to strict on-time-in-full, expose
  the definition choices that quietly inflate on-time numbers (date anchor,
  tolerance window, partial shipments, cancellations), find where lateness
  concentrates, and reconcile the headline number against raw rows. Use for
  OTIF, on-time delivery, service level, late orders, delivery performance
  reviews, or "customers complain but our on-time score is high".
metadata:
  origin: ECC
---

# OTIF Analysis

Most companies don't have a delivery problem *and* a measurement problem — they have a measurement problem that hides the delivery problem. Before recommending any operational fix, establish the honest number and show which definition choices inflate the reported one.

## When to Activate

- computing or auditing on-time delivery, OTIF, or service-level KPIs
- order-level delivery data is available (requested/promised/actual dates)
- "customers complain but our on-time is 95%+"
- preparing delivery performance for a management review or customer QBR
- drafting delivery metrics for a contract or SLA

## Required Data

Order-level rows with: `order_id`, `requested_delivery_date` (what the customer asked for), `promised_delivery_date` (what was confirmed), `actual_delivery_date`, completeness info (lines or quantities ordered vs delivered), and a status/cancelled flag. Useful cuts: carrier, region, customer, product family.

If `requested_delivery_date` is missing, say so explicitly: only the promised-date rungs are computable and the analysis cannot see sales padding. Recommend capturing the requested date going forward.

## Core Workflow

1. **Validate before computing.** Count duplicated rows; flag impossible dates (actual before order date); count cancelled orders and state how they will be treated. Report these counts in the output — an audit that silently cleans data is not an audit.
2. **Compute the metric ladder** on the same population, strictest last (table below). Present it with the delta and the cause of each drop.
3. **Decompose the gap.** For the dimension with the largest spread (carrier, region, month, customer), show OTIF per segment and name the concentrated driver, not just the average.
4. **Analyze the tail, not the mean.** Report the share of orders 4+ days late and the worst decile — those are the orders customers remember.
5. **Reconcile before reporting.** Recompute the headline OTIF once more directly from raw rows and confirm it matches. If it does not, stop and find out why.

## The Metric Ladder

| Rung | Definition | What changes |
|------|------------|--------------|
| 1 | Promised date, +N-day tolerance | The typically reported KPI |
| 2 | Promised date, strict | Tolerance window removed |
| 3 | *Requested* date, strict | Sales padding vs customer request exposed |
| 4 | **OTIF** — requested date AND order complete | Partial shipments counted; in-full is judged at order level (9-of-10 lines is one incomplete order, not 90% on-time) |
| 5 | OTIF with cancellations in the denominator | Cancelled orders stop hiding |

## Code Example

```python
import pandas as pd

df = pd.read_csv(
    "orders.csv",
    parse_dates=["requested_delivery_date", "promised_delivery_date", "actual_delivery_date"],
)
d = df[df.status == "delivered"]
late_prom = (d.actual_delivery_date - d.promised_delivery_date).dt.days
late_req = (d.actual_delivery_date - d.requested_delivery_date).dt.days
in_full = d.lines_delivered_complete >= d.lines_total

ladder = {
    "1 promised +3d (reported)": (late_prom <= 3).mean(),
    "2 promised, strict": (late_prom <= 0).mean(),
    "3 requested, strict": (late_req <= 0).mean(),
    "4 OTIF (requested + in-full)": ((late_req <= 0) & in_full).mean(),
    "5 OTIF incl. cancellations": ((late_req <= 0) & in_full).sum() / len(df),
}
print({k: f"{v:.1%}" for k, v in ladder.items()})
```

## Anti-Patterns

- **Anchoring to the promised date without disclosure.** It hides sales padding; compute average (promised − requested) days and quantify the KPI effect.
- **Tolerance windows as dashboard defaults.** Tolerance is a contract term; if used, publish it next to the number. Every extra day buys free KPI points.
- **Line-level averaging.** Overstates performance versus order-level in-full; the customer's production line is still stopped.
- **Silently excluding cancellations.** Orders that quietly leave the denominator flatter the metric — show rung 5.
- **Reporting the mean lateness.** An average of 0.5 days can hide a 5% tail of week-late orders; show the distribution share above a threshold.
- **Shipping a percentage without its definition footnote.** An unlabeled "94% on-time" is a rumor, not a metric.

## Output Format

1. The ladder table (definition, result %, delta, cause of drop)
2. Three finding sentences, each: what moved / where it concentrates / what decision it needs
3. A definitions footnote stating anchor date, tolerance, in-full rule and cancellation treatment — so the number cannot be misread

Reference implementation with reproducible numbers and charts: <https://github.com/gulmezeren2-byte/otif-analytics>

## Related Skills

- `inventory-demand-planning` — forecasting and stock policies, once delivery measurement is honest
- `logistics-exception-management` — handling the individual freight exceptions the ladder surfaces
