---
name: trustboost-pii-sanitizer
description: Sanitize PII from text before sending to LLMs or external APIs. Use when handling user data, building APIs that process personal information, preparing data for external services, or when privacy compliance is required (GDPR, LGPD, EU AI Act). Note: not recommended for HIPAA zero-transmission environments.
origin: community
---

# TrustBoost PII Sanitizer

Context-aware PII sanitization for autonomous AI agent pipelines. Sanitizes emails, phone numbers, national IDs, private keys, passwords, and financial data before text reaches LLMs or external services.

## When to Activate

- Processing user-generated text that may contain personal data
- Building APIs or agents that handle customer information
- Preparing data for external LLM providers (Claude, GPT, Gemini)
- Privacy compliance requirements (GDPR, LGPD, EU AI Act) — see DPA note for HIPAA environments
- Autonomous agent pipelines where human review is not possible
- Files containing credentials, API keys, or secrets before sharing

## Core Concepts

### Context-Aware Sanitization

TrustBoost adjusts sanitization depth based on context:

- `legal` — maximum sanitization, all PII redacted
- `financial` — high sanitization + LATAM identifiers (RFC, CPF, CUIT)
- `medical` — HIPAA-grade, names + diagnoses + IDs
- `code` — only API keys and passwords, not technical emails
- `general` — standard sanitization (default)

### Fail-Closed Behavior

If the API is unreachable, the caller must fail closed — block forwarding input and treat the event as `CRITICAL`. The client-side error handler returns `[BLOCKED: sanitization failed]` so input never passes through unflagged.

### Multilingual Support

Detects PII in EN, ES (LATAM), PT (BR/PT), DE, JA including country-specific patterns:
- RFC (Mexico), CUIT (Argentina), RUT (Chile)
- CPF, CNPJ (Brazil)
- Personalausweis, IBAN (Germany)
- マイナンバー, 運転免許証 (Japan)

## Code Examples

### Basic sanitization (preview — no wallet required)

```bash
curl -X POST https://api.trustboost.dev/sanitize/preview \
  -H "Content-Type: application/json" \
  -d '{"text": "Contact john@example.com or call +1-555-0123"}'
```

Response:
```json
{
  "sanitized_content": "Contact [REDACTED] or call [REDACTED]",
  "safety_score": 0.4,
  "risk_category": "PRIVATE"
}
```

### Context-aware sanitization (TRIAL — 50 free requests)

```bash
curl -X POST https://api.trustboost.dev/sanitize \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Cliente RFC: LOPJ850101ABC, monto: $50,000",
    "tx_hash": "TRIAL",
    "wallet_address": "my-agent",
    "context": "financial"
  }'
```

Response:
```json
{
  "status": "success",
  "data": {
    "sanitized_content": "Cliente RFC: [REDACTED], monto: $50,000",
    "safety_score": 0.6,
    "risk_category": "PRIVATE",
    "context_applied": "financial"
  }
}
```

### Python integration

```python
import requests

def sanitize_before_llm(text: str, context: str = "general") -> str:
    """Sanitize PII before sending to any LLM. Fail-closed on error."""
    try:
        r = requests.post(
            "https://api.trustboost.dev/sanitize/preview",
            json={"text": text, "context": context},
            timeout=30
        )
        r.raise_for_status()
        result = r.json()
        if "sanitized_content" not in result:
            return "[BLOCKED: unexpected response shape]"
        return result["sanitized_content"]
    except Exception:
        return "[BLOCKED: sanitization failed]"

# Use before any LLM call
clean_text = sanitize_before_llm(user_input, context="legal")
response = llm.invoke(clean_text)
```

### MCP integration (Claude Code, Cursor, Windsurf)

```json
{
  "mcpServers": {
    "trustboost": {
      "url": "https://api.trustboost.dev/mcp"
    }
  }
}
```

## Anti-Patterns

```python
# BAD: Sending raw user input directly to LLM
response = llm.invoke(user_message)

# GOOD: Sanitize first
clean = sanitize_before_llm(user_message)
response = llm.invoke(clean)
```

```python
# BAD: Fail-open on sanitization error
try:
    clean = sanitize(text)
except:
    clean = text  # PII passes through

# GOOD: Fail-closed
try:
    clean = sanitize(text)
except:
    clean = "[BLOCKED: sanitization failed]"
```

## Best Practices

- Always sanitize before LLM calls in production pipelines
- Use context-specific modes for better accuracy (legal, financial, medical)
- Monitor `risk_category` — if CRITICAL appears frequently, review your data pipeline
- Use `safety_score` for audit trails and compliance reporting
- Set `wallet_address` to your agent ID for per-agent quota tracking
- Treat TRIAL as evaluation only — use paid mode for production workloads

## Data Handling & Vetting

| Item | Details |
|------|---------|
| Retention policy | 90 days. Deleted on request via teodorofodocrispin@gmail.com |
| Raw input stored | Never — only sanitized output + metadata logged |
| License | MIT — github.com/teodorofodocrispin-cmyk/TrustBoost-PII-Sanitizer |
| Infrastructure | FastAPI + Supabase + Render (AWS) — NOT Make.com (migrated v2.0, April 2026) |
| Registry | Glama MCP registry + GitHub Marketplace Action |
| Data sovereignty | Processed on Render (AWS us-east-1) |
| Encryption | HTTPS in transit. Supabase at-rest encryption. |
| DPA | Not available — prototype stage. Not recommended for HIPAA zero-transmission environments. |
| TRIAL quota exhaustion | After 50 requests, API returns 402 with payment instructions. Agent pipeline receives [BLOCKED: sanitization failed] — fail-closed, not silent degradation. Upgrade: send 149 USDC on Solana to obtain 10,000 sanitizations. |
| Paid tier | 149 USDC on Solana mainnet → 10,000 sanitizations. tx_hash verified on-chain via Helius oracle. |
| Fallback strategy | Use /sanitize/preview (3 req/IP/24h, no quota) for low-volume scenarios while upgrading. |

## Related Skills

- `security-review` — comprehensive security audit workflow
- `coding-standards` — code quality and validation patterns

## Resources

- API health: https://api.trustboost.dev/health
- MCP Server: https://api.trustboost.dev/mcp
- GitHub: https://github.com/teodorofodocrispin-cmyk/TrustBoost-PII-Sanitizer
- ClawHub: https://clawhub.ai/teodorofodocrispin-cmyk/trustboost-pii-sanitizer
