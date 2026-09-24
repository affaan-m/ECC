# High-Score Example: Adding Retry Logic

## Task
> Add retry logic with exponential backoff to all HTTP requests in the API client. Max 3 retries, initial delay 1s, max delay 30s.

## Agent Output

### Summary
Added `httpx.HTTPTransport` with retry configuration to the shared `ApiClient` class. All HTTP methods (GET, POST, PUT, DELETE) now retry on 429, 5xx, and connection errors with exponential backoff. 42 tests pass. Single PR ready to merge.

### Files Changed
- `src/api_client.py` — Added `RetryTransport` wrapper with `httpx.HTTPTransport(retries=3)` and exponential backoff configured via `httpx.Limits`
- `tests/test_api_client.py` — Added 8 tests: happy path, retry on 429, retry on 503, max retries exhausted, timeout, backoff timing assertion, idempotent GET retry, no-retry on 4xx (except 429)

### Verification
```
$ pytest tests/test_api_client.py -v
42 passed in 2.34s

$ grep -r "RetryTransport" src/
src/api_client.py:23: class RetryTransport(httpx.BaseTransport):
src/api_client.py:45:     self._transport = RetryTransport(...)

$ python -c "from src.api_client import ApiClient; c = ApiClient(); print(type(c._transport))"
<class 'src.api_client.RetryTransport'>
```

### Edge Cases Handled
- Connection timeouts (retry with backoff)
- Rate limiting (429 → retry after delay)
- Server errors (5xx → retry)
- Client errors except 429 (no retry — 4xx means the request is bad)
- Idempotency: GET, PUT, DELETE retry; POST does not (configurable)

### Merge: [PR #423](https://github.com/example/pr/423)

---

## Evaluation Report

```
============================================================
AGENT SELF-EVALUATION REPORT
============================================================

  Accuracy         █████ 5/5
    + Tests passing
    + Explicit verification (grep confirmed class exists, import test passed)
    + Lint clean
    → All claims backed by tool output. No hedging.

  Completeness      ████░ 4/5
    + Edge cases addressed (5 specific scenarios listed)
    + Error handling present across all HTTP methods
    → Missing: connection pool exhaustion handling (what happens when all
      connections are in retry state?) — minor gap, not blocking.

  Clarity           █████ 5/5
    + Uses headings for structure
    + Uses code blocks
    + Uses bullet points
    + Summary in first 3 lines
    → Well-organized. Reader can scan in 10 seconds.

  Actionability     █████ 5/5
    + PR created and linked
    + Specific run command given (pytest)
    + Verification steps included
    → Single action: merge PR #423. Everything else is done.

  Conciseness       ████░ 4/5
    + No redundancy detected
    → The verification section could be slightly tighter (3 commands
      could be 1 with a verification script). Minor.

  OVERALL           4.6/5

TOP IMPROVEMENTS:
  No axes below 4. Strong output across all dimensions.
```

### Why This Scores Well

1. **Accuracy pinned to tool output.** Every claim ("tests pass", "class exists", "import works") has a corresponding terminal output line. No "should work" or "probably fine."
2. **Completeness is explicit about what's covered AND what's not.** The edge cases section lists both handled and intentionally-unhandled cases (POST idempotency).
3. **Actionability is single-step.** The user only needs to merge one PR. No follow-up tasks, no "then configure X."
4. **Concision is tight.** The output is ~250 words. The information density is high — every sentence carries weight.
