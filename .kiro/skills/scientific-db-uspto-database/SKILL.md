---
name: uspto-database
description: USPTO patent and trademark data workflow for official record lookup, PatentSearch queries, TSDR checks, assignment data, and reproducible IP research logs.
origin: community
---

# USPTO Database

Use this skill when a task needs official United States patent or trademark
records from USPTO systems.

## When to Use

- Searching granted patents or pre-grant publications.
- Checking patent application status, file-wrapper data, assignments, or
  public prosecution history.
- Looking up trademark status, documents, or assignment history.
- Building reproducible prior-art, portfolio, or IP landscape research logs.
- Comparing USPTO records with secondary tools such as Google Patents,
  Lens.org, Semantic Scholar, or company patent pages.

Do not use this skill to give legal advice. Treat it as a data-gathering and
record-verification workflow.

## Source Selection

Prefer official USPTO or USPTO-supported surfaces first:

- Open Data Portal (ODP): current home for migrated USPTO datasets and APIs.
- Patent File Wrapper: public patent application bibliographic data and file
  wrapper records.
- PatentSearch API: PatentsView search API for granted patents and pre-grant
  publication datasets.
- TSDR Data API: trademark status and document retrieval.
- Patent and Trademark Assignment Search: ownership transfer records.
- PTAB data in ODP: Patent Trial and Appeal Board proceedings.

Use secondary sources only as convenience indexes. When the answer matters,
cross-check the official record.

## Authentication and Secrets

Many USPTO API flows require an API key. Store keys in environment variables or
a secret manager, never in committed files or pasted transcripts.

Common environment names:

```bash
export USPTO_API_KEY="..."
export PATENTSVIEW_API_KEY="..."
```

For PatentSearch, send the key with the `X-Api-Key` header. For TSDR, follow
the current USPTO API Manager instructions and rate-limit guidance.

## PatentSearch Workflow

Use PatentSearch for broad patent and pre-grant publication search when the
question is about trends, inventors, assignees, classifications, dates, or
portfolio slices.

Workflow:

1. Identify the endpoint from the current PatentSearch reference or Swagger UI.
2. Build a JSON query with explicit filters.
3. Request only the fields needed for the analysis.
4. Sort and paginate deterministically.
5. Record the endpoint, query body, date, data currency note, and result count.

Python request skeleton:

```python
import os
import requests

API_KEY = os.environ["PATENTSVIEW_API_KEY"]
BASE = "https://search.patentsview.org/api/v1"

payload = {
    "q": {
        "_and": [
            {"patent_date": {"_gte": "2024-01-01"}},
            {"assignees.assignee_organization": {"_text_any": ["Google", "Alphabet"]}},
        ]
    },
    "f": ["patent_id", "patent_title", "patent_date"],
    "s": [{"patent_date": "desc"}],
    "o": {"per_page": 100, "page": 1},
}

response = requests.post(
    f"{BASE}/patent/",
    headers={"X-Api-Key": API_KEY, "Content-Type": "application/json"},
    json=payload,
    timeout=30,
)
response.raise_for_status()
print(response.json())
```

Before reusing a query, verify current endpoint names, field paths, request
parameters, and API-key availability in the live PatentSearch docs.

## Trademark/TSDR Workflow

Use TSDR when the task needs trademark case status, documents, images, owner
history, or prosecution events.

Workflow:

1. Normalize the serial number or registration number.
2. Check the current TSDR API instructions and required API-key header.
3. Fetch status first, then documents only if needed.
4. Respect the lower rate limit for PDF, ZIP, and multi-case downloads.
5. Capture retrieval date and serial/registration identifier in the output.

For large trademark pulls, prefer documented bulk-data flows rather than
screen-scraping public pages.

## File Wrapper and Prosecution History

For application status, transaction history, and prosecution documents:

- Start with ODP Patent File Wrapper search.
- Use exact identifiers when available: application number, publication number,
  patent number, or party name.
- Record whether the record is a granted patent, pre-grant publication, or
  pending application.
- Cross-check document dates and status against the record detail page before
  citing them.

## Assignment Workflow

For patent or trademark ownership:

1. Search official assignment data by patent/application/registration number,
   assignor, assignee, or reel/frame when available.
2. Record conveyance text, execution date, recordation date, and parties.
3. Distinguish assignment records from current legal ownership conclusions.
4. If ownership is material, flag the result for attorney or subject-matter
   review.

## Reproducible Output

Every USPTO research pass should include a log table:

```markdown
| Source | Date searched | Identifier/query | Filters | Results | Notes |
| --- | --- | --- | --- | ---: | --- |
| PatentSearch | 2026-05-11 | `assignee=Alphabet AND date>=2024` | patent endpoint | 118 | API docs checked before run |
| TSDR | 2026-05-11 | `serial=90000000` | status only | 1 | API-key flow, no document bulk pull |
```

For final writeups, separate:

- official record facts
- inferred analysis
- secondary-source convenience matches
- unresolved gaps or records that require legal review

## Review Checklist

- Did you use an official USPTO or USPTO-supported source first?
- Did you verify current endpoint and field names before running code?
- Are API keys kept out of files, shell history, and output logs?
- Does the query log include the date searched and exact request shape?
- Are rate limits respected?
- Are legal conclusions avoided or explicitly escalated?
- Are secondary sources labeled as secondary?

## References

- [USPTO APIs catalog](https://developer.uspto.gov/api-catalog)
- [USPTO Open Data Portal](https://data.uspto.gov/)
- [PatentSearch API reference](https://search.patentsview.org/docs/docs/Search%20API/SearchAPIReference/)
- [PatentSearch API updates](https://search.patentsview.org/docs/)
- [TSDR API bulk download FAQ](https://developer.uspto.gov/faq/tsdr-api-bulk-download)
