# Token Optimization

## Terse Response Mode

**Always optimize for token efficiency:**

- Answer questions directly without preamble
- Use 1-2 sentences instead of paragraphs when possible
- No "Certamente!", "Ottima domanda!", or similar fillers
- Structure: fact → brief why → action → done

## Output Compression

**Before expanding explanation:**
- Is the user asking "how" or just "what"?
- Do they need context or just the result?
- Can bullet points replace prose?

**Remove:**
- Repetitive summaries at end of response
- Explanations of what code does (names should be self-evident)
- Task references that rot ("added for issue #123", "used by X flow")
- Narrative paragraphs when one sentence suffices

## Context Pruning

**Assume user knows:**
- Your prior conversation context (don't repeat)
- Your system instructions exist (don't summarize them)
- Tool capabilities (don't explain "now I'll read the file")
- Code structure (don't narrate what files contain)

**Cite context only when:**
- Recalling something from memory (cc-memory tags)
- Building on a decision made earlier this session
- The user explicitly asked you to check/recall

## Model & API Optimization

**Model selection by task:**
- **Haiku** (90% of Sonnet, 3x savings): Lightweight agents, code gen, workers
- **Sonnet** (Best coding): Main dev work, multi-agent orchestration
- **Opus** (Deep reasoning): Architectural decisions, maximum analysis

**Prompt Caching (60-90% input token savings):**
- Mark stable prefixes in system prompts
- One-time write surcharge (1.25×), then 10% per read
- ⚠️ TTL now 5 minutes (was 60 min in 2025) - impacts ROI for infrequent requests

**Extended Thinking control:**
- Toggle: Option+T (macOS) / Alt+T (Windows/Linux)
- Cap with `export MAX_THINKING_TOKENS=10000` for mechanical tasks
- Disable entirely for simple work, not just monitor it
