---
name: i18n-sync
description: >
  Context-aware localization workflow for JSON locale files. Detects missing or
  stale translation keys with the locakit CLI, reads how each key is used in the
  codebase to infer real UI context, translates in the project's tone, and writes
  results back with placeholder/glossary validation. No translation API keys —
  the agent itself is the translator. Use when adding locale keys, adding a new
  language, or when the user asks to sync/translate i18n files.
metadata:
  origin: community
---

# i18n Sync

Translate application locale files the way a human localizer would: by looking
at where each string appears in the product, not just the string itself. The
deterministic parts (diffing, lockfile tracking, validation, safe JSON writes)
are delegated to [locakit](https://www.npmjs.com/package/locakit); this skill
supplies the judgment.

## When to Activate

- New keys were added to the source locale and target languages need catching up
- A new target language is being introduced
- Source copy changed and existing translations may be stale
- The user asks to "translate", "localize" or "sync" locale/i18n JSON files
- CI failed on `locakit check`

## Requirements

- `locakit.config.json` in the project root (run `npx locakit init` if absent)
- Locale files matching the config's `files` template, e.g. `locales/{locale}.json`

## Workflow

### 1. Discover pending work

```bash
npx locakit diff --json
```

Returns, per target language, every `missing` and `stale` key with its source
text, plus the project `context` and `glossary` from the config. If empty,
report that locales are in sync and stop.

### 2. Gather real usage context — the step generic tools skip

For each pending key (batch by feature prefix, e.g. `auth.*`):

- Grep the codebase for the key (`t("auth.welcome.title")`, `$t('auth...')`,
  `i18nKey="auth..."` and similar forms).
- Read the surrounding component: is it a button label, a page title, an error
  toast, an aria-label? Length constraints? Sentence or fragment?
- Note interpolated values: what will `{name}` actually contain at runtime?

This is what makes "Home" become the navigation label ("Ana Sayfa" in Turkish),
not the building ("Ev").

### 3. Translate with project tone

Apply, in order of precedence:

1. `glossary` terms from the config — never translate these
2. `context` from the config — product domain, audience, register (formal
   "Sie/siz" vs casual "du/sen"); keep the choice consistent across every key
3. The usage context gathered in step 2 — match UI element type and length
4. Target-language conventions: preserve all placeholders exactly (`{name}`,
   `{{count}}`, `%s`, `$t(...)`); keep HTML/Markdown markup intact; follow the
   language's own punctuation and capitalization rules, not the source's

Language-specific care (examples):

- **Turkish**: avoid apostrophe suffixes after placeholders (`{name}'in` breaks
  when the value's vowel harmony differs) — rephrase to avoid the suffix.
  Dotted capital: `i → İ` (GİRİŞ, not GIRIS).
- **German**: compound nouns can overflow buttons — prefer shorter synonyms for
  UI controls.
- **Right-to-left targets** (ar, he, fa): keep placeholders logically ordered;
  never manually reorder for visual direction.

### 4. Apply and validate

Write the patch as `{ "<lang>": { "<key>": "<translation>" } }` and pipe it in:

```bash
echo '<patch-json>' | npx locakit apply -
npx locakit check
```

`apply` refuses keys that do not exist in the source locale, so a mistyped key
fails loudly instead of polluting files. `check` enforces placeholder parity,
glossary retention and language-specific rules; fix any errors it reports and
re-apply before finishing.

### 5. Report

Summarize per language: how many keys translated, notable tone/terminology
decisions, and any strings flagged for human review (legal text, marketing
slogans, culturally sensitive copy — translate them, but say they deserve a
native speaker's eye).

## Hook Integration (optional)

Trigger a sync reminder whenever the source locale changes:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "command": "node -e \"const p=process.env.CLAUDE_FILE_PATH||'';if(/locales[\\\\/].*\\.json$/.test(p)){console.log('[i18n-sync] Locale file changed — run locakit diff to check for pending translations.')}\"",
        "description": "Remind about pending translations after locale edits"
      }
    ]
  }
}
```

## Out of Scope

- Extracting hardcoded strings into locale files (separate refactoring task)
- Non-JSON formats (gettext .po, .strings) — planned in locakit, not yet supported
- Visual/layout QA of translated UI — see the web testing rules

## Related

- CLI: [locakit on npm](https://www.npmjs.com/package/locakit) — deterministic
  engine (diff/apply/check/lock); this skill is its intelligence layer
- Skills: frontend-patterns (UI copy conventions), seo (localized metadata)
