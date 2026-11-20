# Opt-In Second-Opinion Review Boundary (#3174)

External second-opinion reviews MUST follow strict boundary isolation:

- **Opt-in by default**: No external model request is sent unless explicitly requested.
- **No transcripts or secrets**: Never forward complete session transcripts, API keys, tokens, or unrelated project files.
- **Minimal review packet**: Send only the relevant sanitized diff, failing check output, and design question.
- **Default workflows unchanged**: Disabled second-opinion integrations have zero runtime effect.
