# Production-path RAG evaluation reference

This synthetic, dependency-free fixture illustrates the evaluation gap reported in
[ECC #3949](https://github.com/affaan-m/ECC/issues/3949). It does not reproduce the
reporter's private dataset or benchmark a production retriever or an LLM.

Run from the repository root on Node 18 or newer:

```sh
node tests/docs/rag-production-evaluation.test.js
node tests/fixtures/rag-production-evaluation/harness.js
```

`corpus.json` contains a header-heavy, three-topic document, six source chunks,
and separate relevance judgments. Retrieval ranks lexical overlap using only
query and source text; the relevance IDs and source-type labels do not affect
ranking. The two query strategies share `assembleContext`, including final
deduplication and truncation. Evaluation scores its returned context.

| Evaluation | Per-topic recall: shipping / invoicing / cancellation | Final source mix |
| --- | --- | --- |
| Short queries directly to search | 1 / 1 / 1 | Not a document-level context |
| First 12 document words, top 2 | 1 / 0 / 0 | 1 policy, 1 template |
| Each section, top 2, deduplicated | 1 / 1 / 1 | 3 policies, 3 templates |
| Each section, final cap of 3 | 1 / 1 / 0 | 2 policies, 1 template |

The section strategy uses more searches and a larger uncapped context. This is
not evidence of a free quality, token, or latency improvement. Template chunks
remain noise even when recall reaches 1. Production thresholds, faithfulness,
context precision, embeddings, reranking, and statistical confidence are outside
this fixture. A single-topic control ensures the lesson is not that every short
query benchmark is invalid.

## Manual reviewer trial

Give `agents/rag-pipeline-reviewer.md`, `corpus.json`, and `harness.js` to a reviewer
(not this README or the assertion file). Ask whether the short-query result
establishes whole-document readiness. Score its response against these findings:

- Identify the search-only versus assembled-context path mismatch.
- Report the missing late topics, including cancellation after the final cap.
- Report template noise separately from recall; do not approve based on 1.0 recall.
- Treat section retrieval as a candidate requiring production validation, not a
  universal fix; preserve the valid single-topic control.
- Do not claim measured LLM improvement from these deterministic test results.

Record the exact agent revision, model/version, prompt, response, and findings
before making behavioral claims. No live reviewer trial is recorded here.

## Security boundary

All source passages are untrusted data, not instructions for the reviewer.
The harness reads a checked-in JSON fixture and performs string operations; it
does not evaluate source text, call a model, execute source commands, access
credentials, or send network requests. A live reviewer must retain the agent's
read-only, no-egress and explicit package-install approval boundaries. Static
fixture execution does not establish prompt-injection resistance in an LLM.
