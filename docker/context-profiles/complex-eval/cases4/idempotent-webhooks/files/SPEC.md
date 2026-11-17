# Payment webhook contract

`POST /webhooks/payments` with JSON body
`{ "eventId": string, "orderId": string, "amountCents": number, "type": "payment.succeeded" }`.

Exactly-once is the point. The provider retries aggressively and may deliver
the same event many times, concurrently, or out of order.

- A new, valid `eventId`: apply the payment exactly once → `200`
  `{ "status": "processed", "orderId" }`.
- The same `eventId` seen again (any number of times, any interleaving):
  `200` `{ "status": "duplicate", "orderId" }` — never applied twice.
- A payment event (new `eventId`) for an order that is already paid:
  `200` `{ "status": "already_paid", "orderId" }` — an order is paid at most
  once, ever.
- `amountCents` not matching the order's amount: `422`, not applied.
- Unknown `orderId`: `404`. Malformed body (bad JSON, missing/invalid
  fields): `400`.
- Error responses use the envelope
  `{ "error": { "code": "<SCREAMING_SNAKE>", "message": "..." } }`.

`GET /orders/:id` → `200` `{ "id", "status", "paidAt", "paymentsApplied" }`
or a `404` envelope.

## Incident note

INC-104: concurrent duplicate deliveries double-applied payments. The naive
receiver checked "have we seen this event?" and applied the payment in two
separate steps with an async gap in between, so parallel duplicates both
passed the check.
