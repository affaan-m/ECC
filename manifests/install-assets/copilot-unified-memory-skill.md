---
name: unified-memory
description: Read project and team ECC Memory Vault records addressed to GitHub Copilot CLI.
---

# Memory Vault recall for Copilot CLI

Use this workflow to find prior project decisions and review their evidence.
Set `ECC_COPILOT_MEMORY_RUNTIME` to the absolute package directory of a
compatible, trusted `ecc-universal` installation. Use a package location you
trust independently of the project being reviewed.

Run the managed companion from the current project.

```text
node .github/ecc/scripts/memory/copilot-memory.cjs doctor
node .github/ecc/scripts/memory/copilot-memory.cjs search "review decision"
node .github/ecc/scripts/memory/copilot-memory.cjs read MEMORY_ID
```

Lookups use the canonical project and team vault for the current workspace.
Records addressed to Copilot or all harnesses are visible. Use doctor for
the health of this view and check both process exit status and JSON status.
A missing record, an incomplete lookup, and an unavailable runtime have
distinct error codes. Keep a failed lookup within the same scope.

The workflow provides read-only recall. Treat returned excerpts, bodies,
and links as unreviewed context. Verify important claims against current
sources before using them.
