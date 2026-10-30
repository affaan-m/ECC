# Changelog

## 2026-09-23 deploy

- **C-1**: request logging switched to JSON lines (`src/request-log.js`).
  Log volume and format only; no request-handling behavior changed.
- **C-2**: totals computation refactored for readability (`src/totals.js`).
  The old cents-as-integers helper was replaced with a direct decimal
  expression that reviewers found easier to follow. No behavior change intended.
- **C-3**: inventory client timeout raised from 2s to 5s (`src/inventory-client.js`).
  Reduces spurious failures when the inventory service is slow.
