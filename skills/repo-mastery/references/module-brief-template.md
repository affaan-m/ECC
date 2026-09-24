# Module Brief Template — Pre-extracted Source Snippets

> **Read in**: Phase 3, **for large repos** (or when the user asks to save tokens). Before learning a module, write a brief that pre-extracts the module's **key source snippets + evidence locations**, so later turns don't re-Read the source repeatedly. Absorbed from docs-to-course's `module-brief-template.md` (it pre-extracts commands/config; we pre-extract source).

## Why it saves tokens

To explain a knowledge point well, you usually need 2–4 key source snippets. Re-reading whole files every turn burns tokens repeatedly. **Pre-extraction** condenses "what this code does" into the brief; the tutor quotes the brief and only Reads source when the brief lacks detail.

> **Feeds the source walk**: the pre-extracted snippets in `briefs/` feed the chapter's source walk — the key fragment (3-15 lines) directly, and the full `<details>` source when the slice is within the brief's 20-line cap. For longer slices the tutor Reads the wider range from the repo (located via `code-map.json`), so the full source is never truncated.

## When to write a brief

- Large repos (Phase 0 judgment): one brief per module before learning it.
- Small/medium repos: worth it when a module has lots of source or a long call chain.
- Keep the brief at `.learning/briefs/`; reuse it in later review sessions.

## Brief template

Write to `<repo>/.learning/briefs/<module>.md`:

```md
# Module Brief — <module title> (<module_id>)

**Evidence locations**
- Top-level dir / core file: <path>
- Entry function: <file>:<line>

## Teaching arc
- One-line "why care" (practical payoff)
- The key mental model (one core picture the user should leave with)
- Key-implementation highlights of this module (if any)

## Knowledge point → evidence map (core)
| Knowledge point | type | snippet (file:line) | one-line note |
|---|---|---|---|
| kp01-01 | procedure | `src/main.py:42-58` | the launch entry, responsible for… |
| kp01-02 | concept | `src/pipeline.py:120-160` | RAG retrieval main chain |

## Pre-extracted snippets (verbatim, with file:line)
> Only include snippets needed to teach the points; each ≤ 20 lines. Longer → split or write "see <file>:<range> to expand".

### Snippet A — Launch flow (src/main.py:42-58)
```python
<verbatim source>
```
**Note**: what this does, why this order, where it's easy to go wrong.

### Snippet B — RAG main chain (src/pipeline.py:120-160)
```python
<verbatim source>
```
**Note**: …

## Pitfalls / traps
- Where the user is likely to get stuck (anticipate via error types: structural/deviation/application/metacognitive)

## Neighboring module handoff
- Previous module covers: …
- Next module covers: …

## Feynman follow-ups for this module (design type)
- Why not approach B? → evidence-backed answer: …
```

## Iron rules

- **Snippets must be verbatim**: copy the source unchanged, with `file:line`. Keep notes separate from source; never mix.
- **Less is more**: only pre-extract what's needed to teach the points. Snippets over 20 lines get a location (`file:line`) in the brief, not the full text.
- **The brief is an evidence cache, not the authority**: if learning reveals the brief is unclear, go back to source, verify, and update the brief.
