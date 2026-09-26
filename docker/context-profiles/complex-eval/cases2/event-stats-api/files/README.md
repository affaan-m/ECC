# event-stats

Analytics endpoint over an in-memory event log (300,000 events, generated
deterministically by `src/data.js`).

## API

`GET /stats?type=<t>&from=<ms>&to=<ms>` returns JSON:

```json
{ "type": "click", "from": 1754000000000, "to": 1756592000000,
  "count": 1234, "sum": 56789, "avg": 46.02,
  "p50": 123, "p95": 456, "p99": 789, "min": 1, "max": 50000 }
```

Semantics (all pinned; follow them exactly):

- `from`/`to` are millisecond timestamps, **inclusive**, and optional
  (absent means unbounded). Non-numeric bounds, or `from > to`, are `400`.
- Only events of the given `type` within `[from, to]` are included.
- `sum` is the exact integer sum of `value`s.
- `avg` is `sum / count` rounded **half-up to two decimals**.
- Percentiles use the **nearest-rank** method: sort values ascending, take the
  value at 1-based rank `ceil(p / 100 * count)`. No interpolation.
- If no events match (including an unknown `type`), return `200` with
  `count: 0, sum: 0` and `avg`, `p50`, `p95`, `p99`, `min`, `max` all `null`.
- The response echoes the effective `from`/`to` (`null` when unbounded).

## Performance requirement

The endpoint must stay fast at this data size: **2,000 mixed queries complete
in under 6 seconds** on this machine (the reference does it in ~1.5s).
Precompute whatever you need at startup; per-query work must not scan the
whole log.

## Module contract

- `src/app.js` is CommonJS and exports `createApp()` returning an
  `http.Server` that is not yet listening.
- `node src/index.js <port>` starts the service.
- No external dependencies. Run the tests with `npm test`.
