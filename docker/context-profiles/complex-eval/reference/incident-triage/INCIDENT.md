# Incident 2026-09-24: order totals off by one cent

## Root cause

**C-2** — the totals refactor in `src/totals.js`.

The refactor replaced integer-cent arithmetic with a decimal discount factor
(`priceCents * quantity * (1 - discountPercent / 100)`). Decimal factors such
as 0.7 or 0.93 have no exact binary floating-point representation, so for
line amounts whose exact discounted value lands precisely on a half-cent
boundary (e.g. 165 cents at 30% off = 115.5), the float result lands just
below the boundary and `Math.round` rounds down instead of half-up. Every
affected order is undercharged by exactly one cent, matching the finance
findings in `evidence/incident.txt`.

## Evidence

- `evidence/incident.txt`: every flagged order is off by exactly one cent in the
  store's favor, and all of them appeared after the 2026-09-23 deploy.
- C-1 (logging) and C-3 (inventory timeout) cannot change totals; C-2 touched
  the totals computation itself.

## Fix

`src/totals.js` now computes line discounts with exact integer arithmetic:
`floor((priceCents * quantity * (100 - discountPercent) + 50) / 100)`, which
rounds half-up on exact cent boundaries with no floating-point error.
