# PROJECT_LOG.md — Append-Only History

> One meaningful event per line: `## [date] type | summary`.
> Allowed types: init / commit / fix / refactor / cleanup / audit / contract.
> Count event headings rather than physical lines. When the active log exceeds 200 events, review it first; after confirmation, archive old events verbatim and rebuild the local SQLite index from Markdown. The database is not a source of truth and never stores project scheduling.

## [2026-06-09] init | Established the documentation governance spine
## [2026-06-10] cleanup | Removed legacy_parser.py; v1 was replaced by services/parser and recorded in the STATUS deletion zone
## [2026-06-12] refactor | Moved synchronization logic from shell into services/sync.py
## [2026-06-15] audit | services/report.py reached 880 lines and was marked as a P0 decomposition candidate
