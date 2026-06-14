# Everything Codex Compatibility Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `everything-codex` as a Codex-branded plugin entry while preserving the current `ecc` plugin entry and release surface.

**Architecture:** Add a second thin plugin target under `plugins/everything-codex/` that reuses root `skills/`, `.mcp.json`, and assets via parent-relative paths. Append a second marketplace entry and update release/package/test/docs surfaces so both Codex entries stay synchronized.

**Tech Stack:** Node.js tests with `assert`, JSON plugin manifests, Bash release automation, Markdown docs.

---

## File Structure

- Create `plugins/everything-codex/.codex-plugin/plugin.json`: Codex manifest for the alias entry.
- Create `plugins/everything-codex/README.md`: Alias entry docs and Codex fragility warning.
- Modify `.agents/plugins/marketplace.json`: Append the `everything-codex` marketplace entry.
- Modify `package.json`: Include `plugins/everything-codex/` in the npm package surface.
- Modify `scripts/release.sh`: Update both Codex marketplace entries and the new alias manifest on release.
- Modify `tests/plugin-manifest.test.js`: Add failing tests for the alias marketplace entry and manifest.
- Modify `tests/scripts/npm-publish-surface.test.js`: Add failing tests for npm-pack inclusion.
- Modify `.codex-plugin/README.md`: Document the dual Codex entries.
- Modify `README.md`: Document the Codex-branded alias in the Codex marketplace section.

---

### Task 1: Marketplace and Alias Manifest Tests

**Files:**
- Modify: `tests/plugin-manifest.test.js`
- Test: `tests/plugin-manifest.test.js`

- [ ] **Step 1: Write failing tests**

Add these helper constants after `const marketplacePluginManifest = ...`:

```js
const everythingCodexMarketplacePluginManifestPath = path.join(repoRoot, 'plugins', 'everything-codex', '.codex-plugin', 'plugin.json');
const everythingCodexMarketplacePluginManifest = loadJsonObject(
  everythingCodexMarketplacePluginManifestPath,
  'plugins/everything-codex/.codex-plugin/plugin.json'
);
```

Add these tests after `marketplace.json plugin version matches package.json`:

```js
test('marketplace.json exposes the Everything Codex alias entry', () => {
  const alias = marketplace.plugins.find((plugin) => plugin && plugin.name === 'everything-codex');
  assert.ok(alias, 'Expected marketplace to expose everything-codex alias entry');
  assert.strictEqual(alias.version, expectedVersion);
  assert.deepStrictEqual(alias.source, {
    source: 'local',
    path: './plugins/everything-codex',
  });
  assert.deepStrictEqual(alias.policy, {
    installation: 'AVAILABLE',
    authentication: 'ON_INSTALL',
  });
  assert.strictEqual(alias.category, 'Productivity');
});
```

Add these tests after the existing `plugins/ecc README documents the upstream Codex fragility` test:

```js
console.log('\n=== plugins/everything-codex Codex marketplace plugin folder ===\n');

test('plugins/everything-codex manifest uses the Codex alias identity', () => {
  assert.strictEqual(everythingCodexMarketplacePluginManifest.name, 'everything-codex');
  assert.strictEqual(everythingCodexMarketplacePluginManifest.interface.displayName, 'Everything Codex');
});

test('plugins/everything-codex manifest version matches package.json and marketplace entry', () => {
  const alias = marketplace.plugins.find((plugin) => plugin && plugin.name === 'everything-codex');
  assert.ok(alias, 'Expected marketplace everything-codex entry');
  assert.strictEqual(everythingCodexMarketplacePluginManifest.version, expectedVersion);
  assert.strictEqual(alias.version, everythingCodexMarketplacePluginManifest.version);
});

test('plugins/everything-codex manifest reuses root skills and MCP config without vendoring', () => {
  const pluginDir = path.dirname(path.dirname(everythingCodexMarketplacePluginManifestPath));

  const skillsTarget = path.resolve(pluginDir, everythingCodexMarketplacePluginManifest.skills);
  assert.strictEqual(skillsTarget, path.join(repoRoot, 'skills'), `skills ref must resolve to the root skills/ directory, got: ${everythingCodexMarketplacePluginManifest.skills}`);
  assert.ok(fs.existsSync(skillsTarget), 'Root skills/ directory missing');

  const mcpTarget = path.resolve(pluginDir, everythingCodexMarketplacePluginManifest.mcpServers);
  assert.strictEqual(mcpTarget, path.join(repoRoot, '.mcp.json'), `mcpServers ref must resolve to the root .mcp.json, got: ${everythingCodexMarketplacePluginManifest.mcpServers}`);
  assert.ok(fs.existsSync(mcpTarget), 'Root .mcp.json missing');

  assert.ok(!fs.existsSync(path.join(pluginDir, 'skills')), 'plugins/everything-codex must not vendor a second skills/ copy');
  assert.ok(!fs.existsSync(path.join(pluginDir, '.mcp.json')), 'plugins/everything-codex must not vendor a second .mcp.json');
});

test('plugins/everything-codex manifest interface assets resolve to root assets', () => {
  const pluginDir = path.dirname(path.dirname(everythingCodexMarketplacePluginManifestPath));

  for (const ref of [everythingCodexMarketplacePluginManifest.interface.composerIcon, everythingCodexMarketplacePluginManifest.interface.logo]) {
    const target = path.resolve(pluginDir, ref);
    assert.ok(target.startsWith(path.join(repoRoot, 'assets') + path.sep), `Asset ref must resolve under root assets/: ${ref}`);
    assert.ok(fs.existsSync(target), `Asset ref target missing: ${ref}`);
  }
});

test('plugins/everything-codex README documents the upstream Codex fragility', () => {
  const readmePath = path.join(repoRoot, 'plugins', 'everything-codex', 'README.md');
  assert.ok(fs.existsSync(readmePath), 'Expected plugins/everything-codex/README.md');
  const source = fs.readFileSync(readmePath, 'utf8');
  assert.ok(source.includes('openai/codex'), 'plugins/everything-codex README must link the upstream Codex discovery issue');
  assert.ok(source.includes('sync-ecc-to-codex.sh'), 'plugins/everything-codex README must point at the supported manual sync flow');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node tests/plugin-manifest.test.js
```

Expected: FAIL because `plugins/everything-codex/.codex-plugin/plugin.json` does not exist or the marketplace alias entry is missing.

- [ ] **Step 3: Commit failing tests if desired**

Do not commit unless the project convention for this change wants a red commit. Keep the red state visible in terminal output before implementation.

---

### Task 2: Implement Alias Manifest and Marketplace Entry

**Files:**
- Create: `plugins/everything-codex/.codex-plugin/plugin.json`
- Create: `plugins/everything-codex/README.md`
- Modify: `.agents/plugins/marketplace.json`
- Test: `tests/plugin-manifest.test.js`

- [ ] **Step 1: Add the alias manifest**

Create `plugins/everything-codex/.codex-plugin/plugin.json`:

```json
{
  "name": "everything-codex",
  "version": "2.0.0",
  "description": "Codex-branded entry for ECC workflows: shared skills, production-ready MCP configs, and selective-install-aligned conventions for TDD, security scanning, code review, and autonomous development.",
  "author": {
    "name": "Affaan Mustafa",
    "email": "me@affaanmustafa.com",
    "url": "https://x.com/affaanmustafa"
  },
  "homepage": "https://ecc.tools",
  "repository": "https://github.com/affaan-m/ECC",
  "license": "MIT",
  "keywords": ["codex", "agents", "skills", "tdd", "code-review", "security", "workflow", "automation"],
  "skills": "../../skills/",
  "mcpServers": "../../.mcp.json",
  "interface": {
    "displayName": "Everything Codex",
    "shortDescription": "Codex-branded ECC skills plus MCP configs for TDD, security, code review, and autonomous development.",
    "longDescription": "Everything Codex is the Codex-branded entry for ECC, a harness-native operator system for Codex and adjacent agent harnesses. It packages reusable skills, MCP configs, TDD workflows, security scanning, code review, architecture decisions, operator workflows, and release gates in one installable plugin.",
    "developerName": "Affaan Mustafa",
    "category": "Coding",
    "capabilities": ["Interactive", "Read", "Write"],
    "websiteURL": "https://ecc.tools",
    "privacyPolicyURL": "https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement",
    "termsOfServiceURL": "https://docs.github.com/en/site-policy/github-terms/github-terms-of-service",
    "brandColor": "#E07856",
    "composerIcon": "../../assets/ecc-icon.svg",
    "logo": "../../assets/hero.png",
    "screenshots": [],
    "defaultPrompt": [
      "Use the tdd-workflow skill to write tests before implementation.",
      "Use the security-review skill to scan for OWASP Top 10 vulnerabilities.",
      "Use the verification-loop skill to verify correctness before shipping changes."
    ]
  }
}
```

- [ ] **Step 2: Add the alias README**

Create `plugins/everything-codex/README.md`:

```md
# plugins/everything-codex — Codex-Branded ECC Plugin Target

This directory is a Codex-branded alias for the ECC repo-marketplace plugin.
It lets Codex show an `everything-codex` entry while the original `ecc` entry
remains available for existing installs and short tool namespaces.

## Single source of truth

No skill or MCP content is vendored here. `.codex-plugin/plugin.json`
references the canonical root content with parent-relative paths:

| Manifest field | Resolves to |
|---|---|
| `skills` | `skills/` at the repo root |
| `mcpServers` | `.mcp.json` at the repo root |
| `interface.composerIcon` / `interface.logo` | `assets/` at the repo root |

Keep this manifest version in sync with `package.json`, `.codex-plugin/plugin.json`,
and `plugins/ecc/.codex-plugin/plugin.json`.

## Current Codex plugin-mode status

With this layout, `codex plugin marketplace add affaan-m/ECC` discovers and
installs `everything-codex@ecc` alongside `ecc@ecc`. Runtime skill loading from
repo marketplaces is still unreliable upstream — Codex copies only the plugin
folder into its install cache, and local/personal marketplace plugins are not
always exposed at runtime (see [openai/codex#26037](https://github.com/openai/codex/issues/26037)
and [affaan-m/ECC#2128](https://github.com/affaan-m/ECC/issues/2128)).

Until the upstream discovery issues settle, the supported Codex path is the
manual sync flow documented in the README:

```bash
npm install && bash scripts/sync-ecc-to-codex.sh
```
```

- [ ] **Step 3: Append the marketplace entry**

Update `.agents/plugins/marketplace.json` so `plugins` contains the existing `ecc` object followed by:

```json
{
  "name": "everything-codex",
  "version": "2.0.0",
  "source": {
    "source": "local",
    "path": "./plugins/everything-codex"
  },
  "policy": {
    "installation": "AVAILABLE",
    "authentication": "ON_INSTALL"
  },
  "category": "Productivity"
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
node tests/plugin-manifest.test.js
```

Expected: PASS for plugin manifest tests.

---

### Task 3: Release and NPM Package Surface

**Files:**
- Modify: `package.json`
- Modify: `tests/scripts/npm-publish-surface.test.js`
- Modify: `scripts/release.sh`
- Test: `tests/scripts/npm-publish-surface.test.js`
- Test: `tests/plugin-manifest.test.js`

- [ ] **Step 1: Write failing npm surface test**

In `tests/scripts/npm-publish-surface.test.js`, add `"plugins/everything-codex"` to `extraPaths` after `"plugins/ecc"`, and add `"plugins/everything-codex/.codex-plugin/plugin.json"` to the required pack paths after `"plugins/ecc/.codex-plugin/plugin.json"`.

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node tests/scripts/npm-publish-surface.test.js
```

Expected: FAIL because `package.json` does not yet include `plugins/everything-codex/`.

- [ ] **Step 3: Add package surface**

In `package.json`, add this entry after `"plugins/ecc/"`:

```json
"plugins/everything-codex/",
```

- [ ] **Step 4: Write failing release script assertions**

In `tests/plugin-manifest.test.js`, add a release script source constant near other path constants:

```js
const releaseScriptPath = path.join(repoRoot, 'scripts', 'release.sh');
```

Add this test near the Codex plugin tests:

```js
test('release.sh updates both Codex marketplace plugin manifests', () => {
  const source = fs.readFileSync(releaseScriptPath, 'utf8');
  assert.ok(source.includes('CODEX_EVERYTHING_CODEX_PLUGIN_JSON="plugins/everything-codex/.codex-plugin/plugin.json"'), 'Expected release.sh to track the Everything Codex manifest');
  assert.ok(source.includes('update_version "$CODEX_EVERYTHING_CODEX_PLUGIN_JSON"'), 'Expected release.sh to update the Everything Codex manifest version');
  assert.ok(source.includes('entry.name === "ecc" || entry.name === "everything-codex"'), 'Expected release.sh to update both Codex marketplace entry versions');
});
```

- [ ] **Step 5: Run test to verify it fails**

Run:

```bash
node tests/plugin-manifest.test.js
```

Expected: FAIL because `scripts/release.sh` does not yet reference the new manifest or both marketplace entries.

- [ ] **Step 6: Update release script**

In `scripts/release.sh`, add:

```bash
CODEX_EVERYTHING_CODEX_PLUGIN_JSON="plugins/everything-codex/.codex-plugin/plugin.json"
```

Include `$CODEX_EVERYTHING_CODEX_PLUGIN_JSON` in the existence-check loop and final `git add`.

Replace the marketplace update body so it updates both entries:

```js
    const plugins = marketplace.plugins.filter(entry => entry && (entry.name === "ecc" || entry.name === "everything-codex"));
    const names = new Set(plugins.map(entry => entry.name));
    for (const name of ["ecc", "everything-codex"]) {
      if (!names.has(name)) {
        console.error(`Error: could not find ${name} plugin entry in ${file}`);
        process.exit(1);
      }
    }
    for (const plugin of plugins) {
      plugin.version = version;
    }
```

Add the new manifest version update after the existing `CODEX_MARKETPLACE_PLUGIN_JSON` update:

```bash
update_version "$CODEX_EVERYTHING_CODEX_PLUGIN_JSON" "s|\"version\": *\"[^\"]*\"|\"version\": \"$VERSION\"|"
```

- [ ] **Step 7: Run tests to verify they pass**

Run:

```bash
node tests/plugin-manifest.test.js
node tests/scripts/npm-publish-surface.test.js
```

Expected: both PASS.

---

### Task 4: Documentation and Final Verification

**Files:**
- Modify: `.codex-plugin/README.md`
- Modify: `README.md`
- Test: `tests/plugin-manifest.test.js`
- Test: `tests/scripts/npm-publish-surface.test.js`
- Test: `tests/run-all.js`

- [ ] **Step 1: Update `.codex-plugin/README.md`**

Replace the sentence beginning `The marketplace entry points at` with:

```md
The marketplace exposes two local Codex entries: `ecc` for the stable short
slug and `everything-codex` for the Codex-branded alias. Both entries point at
concrete plugin subdirectories under `plugins/` — Codex does not discover
plugins whose local marketplace `source.path` is the marketplace root (`./`),
so each entry must target a concrete plugin subdirectory (see
[#2128](https://github.com/affaan-m/ECC/issues/2128)).
```

Replace `install or enable `ecc` from the plugin directory` with:

```md
install or enable `ecc` or `everything-codex` from the plugin directory.
```

Add this sentence after the official directory paragraph:

```md
`everything-codex` is an alias entry for Codex presentation; `ecc` remains the
canonical short slug for existing installs and release compatibility.
```

- [ ] **Step 2: Update `README.md` Codex marketplace section**

Replace the paragraph beginning `The repo also exposes a Codex repo-scoped marketplace` with:

```md
The repo also exposes a Codex repo-scoped marketplace (`.agents/plugins/marketplace.json`) with two entries: `ecc` for the stable short slug and `everything-codex` as the Codex-branded alias. Both entries point at concrete plugin folders under `plugins/` — Codex does not discover plugins whose local marketplace `source.path` is the repository root (`./`), so each entry must target a concrete plugin subdirectory:
```

Update the command comment to:

```bash
codex plugin marketplace add affaan-m/ECC
codex plugin list   # ecc@ecc and everything-codex@ecc should appear
```

- [ ] **Step 3: Run focused tests**

Run:

```bash
node tests/plugin-manifest.test.js
node tests/scripts/npm-publish-surface.test.js
```

Expected: both PASS.

- [ ] **Step 4: Run full test suite**

Run:

```bash
node tests/run-all.js
```

Expected: PASS.

- [ ] **Step 5: Review diff**

Run:

```bash
git diff -- .agents/plugins/marketplace.json package.json scripts/release.sh tests/plugin-manifest.test.js tests/scripts/npm-publish-surface.test.js .codex-plugin/README.md README.md plugins/everything-codex
```

Expected: only the compatibility-layer changes described in this plan.

- [ ] **Step 6: Commit implementation**

Run:

```bash
git add .agents/plugins/marketplace.json package.json scripts/release.sh tests/plugin-manifest.test.js tests/scripts/npm-publish-surface.test.js .codex-plugin/README.md README.md plugins/everything-codex docs/superpowers/plans/2026-06-14-everything-codex-compat.md
git commit -m "feat: add everything codex plugin alias"
```
