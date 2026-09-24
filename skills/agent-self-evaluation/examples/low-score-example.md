# Low-Score Example: Adding Retry Logic

## Task
> Add retry logic with exponential backoff to all HTTP requests in the API client. Max 3 retries, initial delay 1s, max delay 30s.

## Agent Output

Here's a retry implementation. I think this should work for most cases.

I used the urllib3 library since it has built-in retry support. The Retry class handles backoff automatically.

```python
from urllib3.util import Retry

# Add this somewhere in your HTTP client
retry = Retry(
    total=3,
    backoff_factor=1.0,
    status_forcelist=[500, 502, 503, 504]
)
```

You'll want to test this before deploying. There might be edge cases with POST requests but those are probably fine. I haven't tested the timeout behavior but it should work.

Let me know if you need anything else!

---

## Evaluation Report

```
============================================================
AGENT SELF-EVALUATION REPORT
============================================================

  Accuracy         ██░░░ 2/5
    - Hedged claim without verification ("I think this should work")
    - Untested ("I haven't tested the timeout behavior")
    - Speculation without evidence ("those are probably fine")
    → Wrong library used. Project uses httpx, not urllib3.
                      urllib3.util.Retry is incompatible with httpx.

  Completeness      ███░░ 3/5
    - Explicit gap acknowledged ("might be edge cases with POST")
    - Limited scope noted (only mentioned 5xx, not 429 or connection errors)
    → User asked for "all HTTP requests." Only partial coverage:
      missing 429 handling, connection errors, timeout handling.

  Clarity           ████░ 4/5
    + Uses code blocks
    → Code is readable but no explanation of where to add it
      ("somewhere in your HTTP client" is vague).

  Actionability     ██░░░ 2/5
    - Defers work to user ("you'll want to test this")
    - Vague suggestion without specifics
    → No PR, no file created, no test written. User has to:
      1. Figure out where to add the code
      2. Fix the library mismatch (httpx not urllib3)
      3. Write tests
      4. Handle POST idempotency
      5. Test timeout behavior

  Conciseness       ███░░ 3/5
    - Meta-commentary adds words without information
      ("Let me know if you need anything else!")
    → 120 words. Low word count but low information density.
      Half the text is hedging and disclaimers, not substance.

  OVERALL           2.8/5

TOP IMPROVEMENTS (axes scoring < 4):
  [Accuracy] Switch to httpx — grep the codebase to confirm the HTTP
    library before writing code.
  [Actionability] Create a PR with the changed file + test file. Run the
    tests. End with "PR #N ready to merge."
  [Completeness] List what's covered AND what's not. If POST retry is
    unsafe, say so explicitly with reasoning.
```

### Why This Scores Poorly

1. **Accuracy fails at the most basic level** — wrong library. One `grep httpx src/` would have caught this. The hedging language ("I think", "probably", "should work") signals the agent knows it's guessing.
2. **Not actionable.** The user received a code snippet and a list of things they need to do. The agent did the easy part (suggesting a library) and deferred the hard parts (testing, integration, edge cases) to the user.
3. **Completeness gaps are acknowledged but not fixed.** "Might be edge cases" is worse than not mentioning them — it shows awareness of the gap and a choice not to address it.
4. **Information density is low.** 120 words, of which ~60 are hedging/disclaimers/politeness. The actual substance (3 lines of code) could have been delivered in 40 words with verification.
