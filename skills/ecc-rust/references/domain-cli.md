# Rust CLI constraints

Adapted from `bol/domain-cli`.

Keep machine-readable output on stdout and diagnostics on stderr. Preserve existing exit-code contracts and handle broken pipes appropriately for pipeline use. Do not inject banners, progress animation, or explanatory text into structured output.

Make configuration precedence explicit, commonly CLI flags, then environment, then a configuration file, then defaults. Preserve provenance when an invalid value needs a useful error. Parse paths as platform paths rather than requiring UTF-8 unnecessarily; avoid passing user values through a shell.

Use the project's parser/TUI stack and supported terminal behavior. Signal handling should request shutdown and let the resource owner finish cleanup. An interrupted operation must have a defined partial-output policy.

Integration tests should exercise process exit status, stdout/stderr separation, paths with spaces, malformed arguments, missing configuration, and interrupted writes when relevant.
