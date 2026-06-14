# Everything Codex Compatibility Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `ecc@ecc` and `everything-codex@ecc` self-contained Codex plugin bundles that work after Codex copies them into its plugin cache.

**Architecture:** Keep the repo marketplace and two plugin identities, but bundle Codex runtime content inside each plugin root. Manifests use only `./...` paths, while tests compare bundled files with `.agents/skills`, root `.mcp.json`, and root assets to prevent drift.

**Tech Stack:** Node.js assertion tests, JSON plugin manifests, Markdown docs, npm pack dry-run validation.

---

## File Structure

- Modify `plugins/ecc/.codex-plugin/plugin.json`: point to `./skills/`, `./.mcp.json`, and `./assets/...`.
- Modify `plugins/everything-codex/.codex-plugin/plugin.json`: same self-contained paths with alias identity.
- Create/update `plugins/ecc/skills/`: copy of `.agents/skills/`.
- Create/update `plugins/everything-codex/skills/`: copy of `.agents/skills/`.
- Create/update `plugins/ecc/.mcp.json` and `plugins/everything-codex/.mcp.json`: copies of root `.mcp.json`.
- Create/update plugin `assets/` folders: copies of `assets/ecc-icon.svg` and `assets/hero.png`.
- Modify `tests/plugin-manifest.test.js`: assert self-contained paths, bundled skill parity, MCP parity, asset parity, and supported plugin docs.
- Modify `tests/scripts/npm-publish-surface.test.js`: assert npm pack includes bundled runtime files.
- Modify `README.md`, `.codex-plugin/README.md`, and plugin READMEs: describe supported self-contained Codex plugin mode.

---

### Task 1: Red Tests

- [x] **Step 1: Add manifest parity assertions**

Add helper assertions in `tests/plugin-manifest.test.js` that require marketplace plugin manifests to use `./skills/`, `./.mcp.json`, and `./assets/...`.

- [x] **Step 2: Add bundled content assertions**

Assert each plugin's bundled `skills/` mirrors `.agents/skills`, each skill includes `agents/openai.yaml`, bundled `.mcp.json` matches the root file, and bundled assets match root assets.

- [x] **Step 3: Add docs and npm pack assertions**

Assert docs no longer call Codex plugin mode experimental or fragile, and `npm pack --dry-run --json` includes plugin-local `.mcp.json`, assets, and sample skill files.

- [x] **Step 4: Verify red**

Run:

```bash
node tests/plugin-manifest.test.js
node tests/scripts/npm-publish-surface.test.js
```

Expected: fail on parent-relative manifest paths, missing bundled files, and outdated docs.

---

### Task 2: Self-Contained Bundles

- [x] **Step 1: Update plugin manifests**

Set both marketplace plugin manifests to:

```json
"skills": "./skills/",
"mcpServers": "./.mcp.json",
"interface": {
  "composerIcon": "./assets/ecc-icon.svg",
  "logo": "./assets/hero.png"
}
```

- [x] **Step 2: Bundle runtime content**

Copy `.agents/skills/`, root `.mcp.json`, and root presentation assets into both `plugins/ecc/` and `plugins/everything-codex/`.

- [x] **Step 3: Update user-facing docs**

Update README and plugin docs to explain the self-contained cache-safe layout and keep manual sync as optional global setup.

---

### Task 3: Verification

- [ ] **Step 1: Run focused manifest tests**

```bash
node tests/plugin-manifest.test.js
```

- [ ] **Step 2: Run npm publish surface tests**

```bash
node tests/scripts/npm-publish-surface.test.js
```

- [ ] **Step 3: Run plugin validator**

```bash
python3 <codex-home>/skills/.system/plugin-creator/scripts/validate_plugin.py plugins/ecc
python3 <codex-home>/skills/.system/plugin-creator/scripts/validate_plugin.py plugins/everything-codex
```

- [ ] **Step 4: Run full repository tests**

```bash
npm test
```
