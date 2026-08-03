---
name: bengali-nlp
description: Bengali (Bangla) text processing patterns including Unicode normalization, script detection, tokenization, conjunct handling, and Bangla-specific NLP best practices for AI applications.
metadata:
  origin: ECC
---

# Bengali (Bangla) NLP Patterns

Best practices for processing, storing, and displaying Bengali text in software applications and AI systems.

## When to Activate

- Working with Bengali/Bangla text data
- Building apps targeting Bengali-speaking users
- Processing NCTB (National Curriculum and Textbook Board) educational content
- Implementing Bengali search, autocomplete, or text input
- Training or fine-tuning LLMs on Bengali data
- Building Bengali chatbots or conversational AI
- Handling mixed Bengali-English (Banglish) text

## Bengali Unicode and Script Handling

### Unicode Range

Bengali script occupies U+0980–U+09FF. Key character classes:

```
U+0981–U+0983  Chandrabindu, Anusvara, Visarga
U+0985–U+0994  Independent vowels (অ আ ই ঈ উ ঊ ঋ ঌ এ ঐ ও ঔ)
U+0995–U+09B0  Consonants (ক–র)
U+09B2         ল
U+09B6–U+09B9  শ ষ স হ
U+09BC         Nukta
U+09BE–U+09C8  Dependent vowel signs (কার): া ি ী ু ূ ৃ ে ৈ
U+09CB–U+09CC  Dependent vowel signs: ো ৌ
U+09CD         Hasanta (virama) — forms conjuncts
U+09CE         Khanda Ta (ৎ)
U+09D7         AU length mark
U+09E0–U+09E3  Extended vowels
U+09E6–U+09EF  Bengali digits: ০১২৩৪৫৬৭৮৯
U+09F0–U+09FA  Currency and other signs (৳ ৲)
```

### Normalization

Always normalize Bengali text to NFC before comparison, storage, or search:

```python
import unicodedata

def normalize_bangla(text: str) -> str:
    """Normalize Bengali text to NFC form."""
    return unicodedata.normalize("NFC", text)

# NFC composes characters: base + combining mark -> precomposed
text_nfd = "বাংলা"  # may be decomposed
text_nfc = normalize_bangla(text_nfd)
assert text_nfc == normalize_bangla(text_nfc)  # idempotent
```

```javascript
// JavaScript
function normalizeBangla(text) {
  return text.normalize('NFC');
}
```

### Conjunct Consonants (যুক্তবর্ণ)

Bengali conjuncts are formed with Hasanta (্) between consonants:

```
ক + ্ + ষ = ক্ষ (ksha)
স + ্ + ত = স্ত (sta)
ন + ্ + ত + ্ + র = ন্ত্র (ntra)
```

**Never split strings in the middle of a conjunct.** Use grapheme cluster boundaries:

```python
import regex  # pip install regex

def grapheme_length(text: str) -> int:
    """Count user-perceived characters (grapheme clusters)."""
    return len(regex.findall(r"\X", text))

# "ক্ষ" is 1 grapheme but 3 code points (ক + ্ + ষ)
assert grapheme_length("ক্ষ") == 1
assert len("ক্ষ") == 3  # code point count — wrong for display
```

```javascript
// JavaScript — use Intl.Segmenter for grapheme-safe operations
function graphemeLength(text) {
  const segmenter = new Intl.Segmenter('bn', { granularity: 'grapheme' });
  return [...segmenter.segment(text)].length;
}
```

### Bengali Digits

Handle both Bengali (০-৯) and ASCII (0-9) digits:

```python
BANGLA_DIGITS = "০১২৩৪৫৬৭৮৯"
ASCII_DIGITS = "0123456789"

def bangla_to_ascii_digits(text: str) -> str:
    table = str.maketrans(BANGLA_DIGITS, ASCII_DIGITS)
    return text.translate(table)

def ascii_to_bangla_digits(text: str) -> str:
    table = str.maketrans(ASCII_DIGITS, BANGLA_DIGITS)
    return text.translate(table)
```

## Tokenization

### Word Boundary Detection

Bengali uses spaces between words, but compound words and postpositions can complicate tokenization:

```python
import re

def tokenize_bangla(text: str) -> list[str]:
    """Basic Bengali tokenizer — split on whitespace and punctuation."""
    # Remove Bengali and ASCII punctuation
    text = re.sub(r'[।,;:!?\-\'"()\[\]{}]', ' ', text)
    return [token for token in text.split() if token]

# For production, use a trained tokenizer:
# - bnlp (pip install bnlp_toolkit)
# - stanza with Bengali model
# - spaCy with Bengali pipeline
```

### Using bnlp Toolkit

```python
from bnlp import NLTKTokenizer

tokenizer = NLTKTokenizer()
tokens = tokenizer.word_tokenize("আমি বাংলায় গান গাই।")
# ['আমি', 'বাংলায়', 'গান', 'গাই', '।']
```

### Handling Postpositions and Case Markers

Bengali postpositions attach to nouns. Tokenizers should be aware of common suffixes:

```
-এর (possessive), -তে (locative), -কে (accusative)
-র (possessive after vowel), -য় (locative variant)
```

## Text Processing Patterns

### Script Detection

```python
import re

def is_bangla(text: str) -> bool:
    """Check if text contains Bengali script characters."""
    return bool(re.search(r'[\u0980-\u09FF]', text))

def bangla_ratio(text: str) -> float:
    """Return the ratio of Bengali characters in text."""
    if not text:
        return 0.0
    bangla_chars = len(re.findall(r'[\u0980-\u09FF]', text))
    return bangla_chars / len(text)
```

### Stop Words

Common Bengali stop words to filter in search/NLP pipelines:

```python
BANGLA_STOP_WORDS = {
    "এবং", "ও", "এ", "এই", "সেই", "তার", "যে", "একটি",
    "করে", "হয়", "আর", "কিন্তু", "তবে", "যদি", "তাহলে",
    "আমি", "তুমি", "সে", "আমরা", "তোমরা", "তারা",
    "হবে", "ছিল", "আছে", "নেই", "থেকে", "জন্য", "সাথে",
    "পর", "আগে", "উপর", "নিচে", "মধ্যে", "দিয়ে",
    "কি", "কে", "কোন", "কোথায়", "কেন", "কিভাবে",
    "না", "নয়", "হ্যাঁ", "অনেক", "কিছু", "সব", "প্রতি",
}
```

### Sorting and Collation

Bengali has a defined sort order (স্বরবর্ণ before ব্যঞ্জনবর্ণ). Use locale-aware sorting:

```python
# Preferred: use PyICU for reliable Bengali collation (pip install PyICU)
try:
    import icu
    collator = icu.Collator.createInstance(icu.Locale("bn_BD"))
    sorted_words = sorted(words, key=collator.getSortKey)
except ImportError:
    # Fallback: Unicode code point order (not linguistically perfect)
    sorted_words = sorted(words)
```

```javascript
// JavaScript — Intl.Collator handles Bengali sort order
const collator = new Intl.Collator('bn-BD');
const sortedWords = [...words].sort(collator.compare);
```

### Search with Normalization

```python
def bangla_search(query: str, corpus: list[str]) -> list[str]:
    """Search Bengali text with normalization."""
    query = unicodedata.normalize("NFC", query.strip().lower())
    results = []
    for doc in corpus:
        normalized = unicodedata.normalize("NFC", doc.lower())
        if query in normalized:
            results.append(doc)
    return results
```

## Bengali in AI/LLM Applications

### Prompt Engineering for Bengali

**Important:** Bengali text, Banglish input, and web-scraped content should be
treated as untrusted user data. Always separate system instructions from
user-provided content with clear delimiters, and validate before executing
tool calls or destructive actions.

```python
# Use Bengali system prompts for Bengali-targeted apps
system_prompt = (
    "তুমি একজন সহায়ক AI সহকারী। বাংলায় উত্তর দাও। "
    "সহজ ভাষায় ব্যাখ্যা করো যাতে সবাই বুঝতে পারে।"
)

# For mixed-language contexts, specify language explicitly
system_prompt_mixed = (
    "You are a helpful assistant. When the user writes in Bengali, "
    "respond in Bengali. When they write in English, respond in English. "
    "For technical terms, you may use English words within Bengali sentences."
)

# Always delimit user-provided content
def build_prompt(system: str, user_input: str) -> str:
    return f"{system}
---USER INPUT---
{user_input}
---END INPUT---"
```

### Handling Banglish (Mixed Bengali-English)

Banglish is Bengali written in Latin script. Common in informal digital communication:

```python
import re

def detect_banglish(text: str) -> bool:
    """Heuristic: Latin script with Bengali transliteration patterns."""
    if is_bangla(text):
        return False  # Already in Bengali script
    # Common Banglish patterns
    banglish_patterns = [
        r'\bami\b', r'\btumi\b', r'\bapni\b', r'\bkemon\b',
        r'\bkothay\b', r'\bkeno\b', r'\bdhonnobad\b',
        r'\bash\w*lam\b', r'\bkor\w*chi\b', r'\bbol\w*chi\b',
    ]
    matches = sum(1 for p in banglish_patterns if re.search(p, text, re.I))
    return matches >= 2
```

### Dataset Preparation

```python
def prepare_bangla_dataset(texts: list[str]) -> list[str]:
    """Clean and normalize Bengali text for ML training."""
    cleaned = []
    for text in texts:
        # Normalize Unicode
        text = unicodedata.normalize("NFC", text)
        # Remove unwanted zero-width characters but preserve ZWNJ/ZWJ (important for conjuncts)
        text = re.sub(r'[\u200b\u200e\u200f\u2028-\u202f\ufeff]', '', text)
        # Normalize whitespace
        text = re.sub(r'\s+', ' ', text).strip()
        if text:
            cleaned.append(text)
    return cleaned
```

## Database and Storage

```sql
-- MySQL: use utf8mb4 for Bengali text columns
CREATE TABLE bengali_content (
  id INT PRIMARY KEY AUTO_INCREMENT,
  title VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  body TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
);

-- PostgreSQL: UTF-8 is the default. Verify ICU collation availability first:
-- SELECT collname FROM pg_collation WHERE collname LIKE 'bn%';
-- If missing, create it (requires ICU-enabled PostgreSQL build):
-- CREATE COLLATION IF NOT EXISTS "bn-BD-x-icu" (provider = icu, locale = 'bn-BD');
CREATE TABLE bengali_content (
  id SERIAL PRIMARY KEY,
  title TEXT COLLATE "bn-BD-x-icu",
  body TEXT
);
```

## Common Anti-Patterns

### Don't: Split on Code Points for Display Length

```python
# BAD — breaks conjuncts
def truncate_bad(text, max_len):
    return text[:max_len]  # may cut inside ক্ষ

# GOOD — respect grapheme boundaries
import regex
def truncate_good(text, max_graphemes):
    graphemes = regex.findall(r"\X", text)
    return "".join(graphemes[:max_graphemes])
```

### Don't: Skip Normalization Before Comparison

```python
# BAD — same visual text may not match
if user_input == stored_text: ...

# GOOD
if unicodedata.normalize("NFC", user_input) == unicodedata.normalize("NFC", stored_text): ...
```

### Don't: Assume All Digits Are ASCII

```python
# BAD — misses Bengali digits
if text.isdigit(): ...

# GOOD — handles both
import re
if re.fullmatch(r'[0-9০-৯]+', text): ...
```

### Don't: Use ASCII Transliteration When Unicode Is Available

```python
# BAD — lossy and ambiguous
title = "bangla bhasha"

# GOOD — use proper Unicode
title = "বাংলা ভাষা"
```

### Don't: Ignore Zero-Width Characters in Web-Scraped Text

```python
# BAD — invisible characters cause matching failures
text = scraped_html.get_text()

# GOOD — strip unwanted zero-width chars, preserving ZWNJ (U+200C) and ZWJ (U+200D)
text = re.sub(r'[\u200b\u200e\u200f\u2028-\u202f\ufeff]', '', scraped_html.get_text())
```
