# Plan Canvas PDF export TDD evidence

## User journey

As a Plan Canvas reviewer, I can select **Download PDF** and receive the current
artifact as a real PDF file without sending the plan to an external converter.

## Guarantees

| Guarantee | Evidence | Result |
| --- | --- | --- |
| The Canvas exposes a labeled PDF download action | Server integration test and browser accessibility tree | PASS |
| The browser fetches a PDF, creates a Blob URL, and starts a named download | Generated-client integration test and real Chrome interaction | PASS |
| Only a loopback artifact URL can reach the renderer | `assertLoopbackUrl` tests | PASS |
| Filenames are useful and safe across platforms | `pdfFileName` tests | PASS |
| Incomplete output is never served as a PDF | `%PDF` header and `%%EOF` completion tests | PASS |
| Validation uses the opened file handle | File-descriptor regression test and CodeQL rerun | PASS |
| Renderer state is private and temporary | Fake-process lifecycle test and live process/temp-state inspection | PASS |
| Artifact HTML cannot make outbound export requests | PDF-only CSP and loopback-origin deny-proxy regression tests | PASS |
| Browser renderer concurrency is bounded | Concurrent endpoint test expects HTTP 429 and `Retry-After` | PASS |
| Export adds no cloud converter or npm runtime dependency | Implementation and package diff inspection | PASS |

## Red and green

- RED: the focused server suite produced 30 passes and 2 failures because the
  Canvas had no Download PDF control or PDF endpoint.
- GREEN: renderer unit tests pass 7/7, Plan Canvas server tests pass 35/35,
  and the end-to-end review workflow passes 13/13.
- FULL SUITE: the final review-hardened implementation passes all 4,010
  discovered tests; hosted security reruns are recorded on PR #2894.
- COVERAGE: `npm run coverage` passes 4,003/4,003 with 88.97% statements,
  80.58% branches, 94.22% functions, and 88.97% lines. The Plan Canvas
  module group reaches 96.72% statements and lines, 84.47% branches, and
  95.34% functions.
- BROWSER: Chrome selected Download PDF on the real Sandbox Execution Fabric.
  The request returned HTTP 200, `application/pdf`, and downloaded
  `EXECUTION-FABRIC.pdf` to the browser's download directory.
- DOCUMENT: the downloaded Sandbox PDF is a valid PDF 1.4 document with five
  pages. The ECC 2 to ECC 3 master plan exports as a valid eight-page PDF.
  The HTML release-preview artifact exports as a valid four-page PDF.
  Rendered first-page previews retain headings, body text, tables/code styling,
  and print-safe light colors.

## Runtime contract

The loopback server discovers Google Chrome, Chromium, or Microsoft Edge, or
uses `ECC_PLAN_CANVAS_CHROME_PATH`. It launches the executable without a shell,
with a private temporary profile, a loopback-only artifact URL, an export-only
CSP, and a local deny proxy that allows only the exact Canvas origin. Completion
requires both a `%PDF-` header and `%%EOF` marker read from the already-open file
handle. The renderer is terminated and temporary state is removed before the
response is handed to the browser. Concurrent export attempts fail quickly with
a retryable HTTP 429 response while one renderer is active.

If no renderer exists, the browser receives an actionable local error. Plan
Canvas does not upload the artifact or add a hosted conversion dependency.
