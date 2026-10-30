# Incident notes

## INC-201 — duplicate refunds (2026-06-14)

Customers saw two refunds for one order. Traced to the storefront retrying the
refund call after a gateway timeout. Asked the storefront team to retry less
aggressively. Closed.

## INC-214 — duplicate refunds, again (2026-07-29)

Same shape as INC-201: a retried refund call landed twice. Reminded the
storefront team about backoff. Closed.

## INC-227 — duplicate refunds, third time (2026-09-03)

Same shape as INC-201 and INC-214. Third time this quarter. Support is
escalating refund-credit requests faster than we can explain them.
