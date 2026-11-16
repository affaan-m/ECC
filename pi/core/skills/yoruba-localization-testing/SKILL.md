---
name: yoruba-localization-testing
description: Test Yoruba (yo) and English bilingual interfaces for tone marks, underdots, Unicode normalization, translation fallback, and accessibility.
origin: ECC
---

# Yoruba Localization Testing

Use this skill when implementing or reviewing **Yoruba–English** interfaces. It targets correctness of Yoruba typography, message handling, and user experience, rather than providing automatically approved translations. It complements `i18n-sync` (message parity) and `accessibility` (assistive technology support).

## When to Activate

- Building web or mobile interfaces with `yo` or `en` locale options.
- Fixing misplaced, removed, or corrupted Yoruba diacritics in text, input, search, storage, or exports.
- Reviewing English fallbacks, language selection, localization regression tests, and screen-reader language metadata.
- Evaluating an AI-generated Yoruba translation before it is released to users.

## Core Concepts

- Yoruba includes distinct letters `ẹ`, `ọ`, `ṣ` and tone-marked vowels such as `á`, `à`, `ẹ́`, and `ọ̀`. Tone and underdot differences can change meaning.
- Store and transmit text in UTF-8. Normalize to NFC for canonical comparisons or consistent storage, but **do not** strip tones or underdots from the visible text.
- Prefer BCP 47 language tags `yo` and `en`. Set the screen-reader language for Yoruba text (for example, `lang="yo"` on web content), and verify the assistive technology's actual language support.
- Do not replace human review with machine translation. Require fluent Yoruba review for meaning, naturalness, tone, terminology, and dialect-sensitive content.
- A missing translation may fall back visibly to English. Never silently fabricate strings for legal, medical, safety, or financial content.
- Placeholders and message keys are code contracts: do not translate identifiers or remove interpolation fields.

## Implementation Workflow

1. Audit visible interface strings and extract them to stable locale keys.
2. Define `en` and `yo` dictionaries with explicit missing-key fallback; document which translation keys require review.
3. Preserve Unicode composition, punctuation, placeholders, screen-reader language tags, and user-entered spelling.
4. Validate locale switching without losing entered form values or navigation position.
5. Test canonical Unicode equivalence, distinct tone-marked letters, JSON/API/database round trips, and missing translations.
6. Check actual fonts, mobile layouts, keyboard support, and screen readers; seek fluent Yoruba approval before declaring localization complete.

## Code Examples

See [`examples/localization.mjs`](examples/localization.mjs) for a runnable, dependency-free implementation. Example strings are **illustrative**, not a substitute for native-speaker review.

```javascript
import { translate, sameNormalizedText } from './examples/localization.mjs';

translate('yo', 'welcome'); // 'Ẹ káàbọ̀'
translate('yo', 'logout');  // 'Log out' (English fallback)
sameNormalizedText('ẹ́', 'ẹ\u0301'); // true: canonically equivalent
sameNormalizedText('ẹ', 'e');      // false: different Yoruba letters
```

A web component can use `<span lang="yo">Ẹ káàbọ̀</span>` to identify the language without altering the source text. Use your platform's equivalent language metadata on mobile.

### Run Regression Tests

From the ECC repository root:

```sh
node skills/yoruba-localization-testing/examples/localization.test.mjs
```

The test file covers six independent cases: Yoruba text, English, fallback, Unicode normalization, distinguishing tone/underdot differences, and JSON round trips. It uses only Node built-ins (Node 18+).

## Anti-Patterns

- `text.normalize('NFD').replace(/\p{M}/gu, '')` for display text: this destroys information.
- Replacing `ẹ` with `e`, `ọ` with `o`, or `ṣ` with `s`.
- Assuming Yoruba speakers want a Yoruba-only UI, or translating programming identifiers.
- Shipping auto-generated Yoruba wording without review by a competent speaker.
- Marking localization complete after tests pass without checking font glyphs and assistive technologies.

## Best Practices

- Keep translation fixtures in UTF-8 source files under version control.
- Verify `Intl` locale behavior in target browsers/runtimes rather than assuming every environment supports `yo` equally.
- Make locale switching reversible, clearly labeled, and keyboard accessible.
- Provide a way to report problematic translations and record review status.
- Test mixed English/Yoruba sentences and longer content on real devices.

## Related Skills

- `i18n-sync` — locale keys and translation parity.
- `accessibility` — screen readers and accessible interactions.
- `frontend-patterns` — web UI patterns.
- `tdd-workflow` — regression-driven implementation.
