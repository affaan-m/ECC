# order-service

Computes order totals for the checkout service.

## Pricing rules

An order is `{ "lines": [{ "priceCents": number, "quantity": number }], "discountPercent": number }`.

- All prices are integer cents. There is no such thing as a fraction of a cent
  in an order total.
- The discount applies per line: `lineCents = priceCents * quantity * (100 - discountPercent) / 100`,
  rounded **half-up** to the nearest cent (0.5 rounds up).
- The order total is the sum of the rounded line totals, in integer cents.

`src/totals.js` is CommonJS and exports `computeOrderTotal(order)` returning the
total in integer cents. Run the tests with `npm test`.

## Operations

- `CHANGELOG.md` records what shipped in each deploy.
- `evidence/incident.txt` holds the finance team's findings for the current incident.
