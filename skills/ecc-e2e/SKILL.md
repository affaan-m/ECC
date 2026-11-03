---
name: ecc-e2e
description: Write and debug Playwright end-to-end tests, stable locators, isolated fixtures, traces, and CI failures.
---

# Web end-to-end tests

Use the existing browser-test framework and test environment. Prefer locators
based on roles and accessible names, isolate test data, and wait on observable
behavior rather than arbitrary sleeps. Diagnose flakes from traces, network
events, console errors, and timing before changing retries.

Exercise meaningful user journeys and failure paths. Use configured test
accounts and avoid production writes. Browser tooling differs by session: use
only available tools, or run the repository's Playwright CLI if configured.
For fixtures, page objects, browser configuration, artifacts, or CI setup, read
[Playwright patterns](references/playwright.md).
