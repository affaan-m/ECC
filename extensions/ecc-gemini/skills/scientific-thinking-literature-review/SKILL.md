---
name: literature-review
description: Systematic literature-review workflow for academic, biomedical, technical, and scientific topics, including search planning, source screening, synthesis, citation checks, and evidence logging.
origin: community
---

# Literature Review

Use this skill when the task is to find, screen, synthesize, and cite a body of
academic or technical literature.

## When to Use

- Building a systematic, scoping, or narrative literature review.
- Synthesizing the state of the art for a research question.
- Finding gaps, contradictions, or future-work directions.
- Preparing citation-backed background sections for papers or reports.
- Comparing evidence across peer-reviewed papers, preprints, patents, and
  technical reports.

## Review Types

- **Narrative review**: broad synthesis; useful for orientation.
- **Scoping review**: maps concepts, methods, and evidence gaps.
- **Systematic review**: predefined protocol, reproducible search, explicit
  screening and exclusion.
- **Meta-analysis**: systematic review plus quantitative effect aggregation.

Ask the user which level of rigor is needed. If unspecified, default to a
scoping review for exploratory work and a systematic review for publication or
clinical claims.

## Workflow

### 1. Define the Question

Convert the prompt into a searchable research question.

For clinical or biomedical work, use PICO:

- Population
- Intervention or exposure
- Comparator
- Outcome

For technical work, use:

- system or domain
- method or intervention
- comparison baseline
- evaluation metric

### 2. Plan the Search

Create a search protocol before collecting sources:

- databases to search
- date range
- languages
- publication types
- inclusion criteria
- exclusion criteria
- exact search strings

Minimum useful database set:

- PubMed for biomedical and life-sciences literature.
- arXiv for CS, math, physics, quantitative biology, and preprints.
- Semantic Scholar or Crossref for broad academic discovery.
- Domain-specific sources when relevant, such as clinical-trial registries,
  patent databases, standards bodies, or official technical docs.

### 3. Search and Log Evidence

Keep a search log that makes the review reproducible:

```markdown
| Database | Date searched | Query | Filters | Results | Export |
| --- | --- | --- | --- | ---: | --- |
| PubMed | 2026-05-11 | `("CRISPR"[tiab] OR "Cas9"[tiab]) AND "sickle cell"[tiab]` | 2020:2026, English | 86 | PMID list |
| arXiv | 2026-05-11 | `CRISPR sickle cell gene editing` | q-bio, 2020:2026 | 9 | BibTeX |
```

Save raw IDs, URLs, DOIs, abstracts, and notes separately from the final prose.

### 4. Deduplicate

Deduplicate in this order:

1. DOI
2. PMID or arXiv ID
3. exact title
4. normalized title plus first author and year

Record how many duplicates were removed.

### 5. Screen Sources

Screen in stages:

1. title
2. abstract
3. full text

For systematic work, record exclusion reasons:

- wrong population
- wrong intervention
- wrong outcome
- not primary research
- duplicate
- unavailable full text
- outside date range

### 6. Extract Data

Use a structured extraction table:

```markdown
| Study | Design | Population/Data | Method | Comparator | Outcome | Key finding | Limitations |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Author Year | RCT/cohort/review/etc. | sample or corpus | method | baseline | measured outcome | result | caveat |
```

For technical papers, include dataset, benchmark, metric, baseline, and
reproducibility notes.

### 7. Synthesize

Group evidence by theme rather than summarizing papers one by one.

Useful synthesis lenses:

- strongest evidence
- conflicting evidence
- methodological weaknesses
- population or dataset limits
- recency and replication
- practical implications
- unanswered questions

Separate claims by confidence:

- **High confidence**: replicated, high-quality evidence across sources.
- **Medium confidence**: plausible but limited by sample, method, or recency.
- **Low confidence**: early, speculative, single-source, or weakly measured.

### 8. Verify Citations

Before finalizing:

- verify DOI, PMID, arXiv ID, or official URL
- check author names and publication year
- do not cite a paper for a claim it does not make
- mark preprints as preprints
- distinguish reviews from primary evidence

## Output Template

```markdown
# Literature Review: <Topic>

Generated: <date>
Review type: <narrative | scoping | systematic | meta-analysis>
Search window: <dates>
Databases: <list>

## Research Question

## Search Strategy

## Inclusion and Exclusion Criteria

## Evidence Summary

## Thematic Synthesis

## Gaps and Limitations

## References

## Search Log
```

## Pitfalls

- Do not treat search snippets as evidence.
- Do not mix preprints, reviews, and primary studies without labeling them.
- Do not omit negative or conflicting findings.
- Do not claim systematic-review rigor without a reproducible protocol.
- Do not use a single database for a broad claim unless the scope is explicitly
  limited to that database.
