/**
 * Tests for the OpenCode V2 plugin loader contract.
 *
 * OpenCode v2 validates every plugin module before running it: the default export
 * must be an object with an `id` and an `effect` or `setup` function
 * (packages/core/src/plugin/module.ts). A factory default export, which is what a
 * V1 plugin used, fails at startup with
 *
 *   PluginModule.LoadError: Plugin must export a default definition with an id and
 *   an effect or setup function. (cause: SchemaError(Expected object at ["default"]))
 *
 * so a declined-hooks install still printed the same error as the V1 plugin did
 * (issue #3537). These tests pin the contract on the payload ECC generates itself.
 *
 * Run with: node tests/opencode-plugin-loader-contract.test.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const { getDisabledOpenCodePluginContent } = require('../scripts/lib/install/hook-consent');

/** Loads generated plugin source the way the OpenCode loader does: import it. */
async function loadPluginModule(source) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-plugin-contract-'));
  try {
    fs.writeFileSync(path.join(dir, 'plugin.mjs'), source);
    return await import(pathToFileURL(path.join(dir, 'plugin.mjs')).href);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Mirrors the loader schema: { default: { id, effect } | { id, setup } }. */
function assertV2PluginDefinition(namespace, label) {
  const definition = namespace.default;
  assert.ok(
    definition && typeof definition === 'object',
    `${label}: default export must be an object, got ${typeof definition}`
  );
  assert.strictEqual(typeof definition.id, 'string', `${label}: default export needs a string id`);
  assert.ok(
    typeof definition.effect === 'function' || typeof definition.setup === 'function',
    `${label}: default export needs an effect or setup function`
  );
}

async function main() {
  let passed = 0;
  let failed = 0;

  const check = async (name, fn) => {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passed += 1;
    } catch (err) {
      console.log(`  ✗ ${name}`);
      console.log(`    Error: ${err.message}`);
      failed += 1;
    }
  };

  const stub = getDisabledOpenCodePluginContent();
  const stubModule = await loadPluginModule(stub);

  await check('declined-hooks stub satisfies the V2 loader schema', () => {
    assertV2PluginDefinition(stubModule, 'disabled OpenCode plugin stub');
  });

  await check('the stub check still rejects a V1 factory default export', async () => {
    const v1 = await loadPluginModule('export default async () => ({});\n');
    assert.throws(() => assertV2PluginDefinition(v1, 'V1 factory'), /default export must be an object/);
  });

  await check('the stub does not import the module it replaces', () => {
    assert.ok(!/^\s*import\s/m.test(stub), 'stub must stay free of imports');
  });

  // The same check applies to every shipped plugin entrypoint once a V2 entrypoint
  // lands (.opencode/plugins/*.ts is scanned independently in home installs).
  // See issue #3537 and the API ports in #3536 and #3224.

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main();