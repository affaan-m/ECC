#!/usr/bin/env node
/**
 * Guards the OpenCode v2 plugin contract.
 *
 * OpenCode 2.x rejects a plugin whose default export is a bare function
 * ("Plugin must export a default definition with an id and an effect or setup
 * function"), which is exactly the v1 contract ECC shipped. The v1
 * implementation therefore lives beside the entry point (not in it) and the
 * entry point is a definition object.
 *
 * These assertions are static on purpose: they catch the shape regressing
 * without booting an OpenCode server, which CI cannot do.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const repoRoot = path.resolve(__dirname, '..');
const entryPath = path.join(repoRoot, '.opencode', 'plugins', 'ecc-hooks.ts');
const barrelPath = path.join(repoRoot, '.opencode', 'plugins', 'index.ts');
const v1ImplPath = path.join(repoRoot, '.opencode', 'plugins-v1', 'ecc-hooks.ts');

const read = (file) => fs.readFileSync(file, 'utf8');

test('.opencode/plugins/ecc-hooks.ts exports a v2 plugin definition', () => {
  const source = read(entryPath);
  assert.match(
    source,
    /export default \{\s*\n\s*id: "ecc-hooks",\s*\n\s*setup:/,
    'Entry point must default-export { id: "ecc-hooks", setup }'
  );
  assert.doesNotMatch(
    source,
    /export default ECCHooksPlugin/,
    'Entry point must not default-export the v1 function'
  );
});

test('.opencode/plugins/ecc-hooks.ts never uses the internal effect path', () => {
  const source = read(entryPath);
  // `effect` satisfies the schema but is the internal Effect-TS path: a plain
  // async function there never settles, which wedges location activation.
  assert.doesNotMatch(source, /^\s*effect:/m, 'Use setup(ctx), not effect(ctx)');
});

test('.opencode/plugins/ecc-hooks.ts registers the mapped v2 hook points', () => {
  const source = read(entryPath);
  for (const point of ['execute.before', 'execute.after']) {
    assert.ok(
      source.includes(`ctx.tool.hook("${point}"`),
      `Expected a ctx.tool.hook("${point}") registration`
    );
  }
  assert.ok(
    source.includes('ctx.session.hook("context"'),
    'Expected a ctx.session.hook("context") registration for session.created'
  );
  assert.ok(
    source.includes('hooks["file.edited"]'),
    'Expected file.edited to be derived from execute.after'
  );
});

test('.opencode/plugins/ecc-hooks.ts imports the v1 implementation from outside the plugin dir', () => {
  const source = read(entryPath);
  assert.ok(
    source.includes('"../plugins-v1/ecc-hooks.ts"'),
    'Entry point must import the v1 implementation from ../plugins-v1/'
  );
  assert.ok(
    fs.existsSync(v1ImplPath),
    'Expected .opencode/plugins-v1/ecc-hooks.ts to hold the v1 implementation'
  );
});

test('the v1 implementation is kept intact and out of the discovery path', () => {
  const source = read(v1ImplPath);
  assert.match(
    source,
    /export default ECCHooksPlugin/,
    'The v1 implementation must still default-export its function unchanged'
  );
  assert.match(
    source,
    /export const ECCHooksPlugin: ECCHooksPluginFn/,
    'The v1 implementation must still export ECCHooksPlugin by name'
  );
  // OpenCode discovers .ts files directly under .opencode/plugins/ only, so a
  // sibling directory keeps the v1 file from being loaded and rejected.
  assert.ok(
    !fs.readdirSync(path.join(repoRoot, '.opencode', 'plugins')).includes('ecc-hooks.v1.ts'),
    'The v1 implementation must not sit inside the discovered plugins directory'
  );
});

test('.opencode/plugins/index.ts barrel is a v2-valid inert definition', () => {
  const source = read(barrelPath);
  assert.match(source, /export default \{\s*\n\s*id: "ecc-barrel",\s*\n\s*setup:/);
  assert.doesNotMatch(source, /export default async \(\) => \(\{\}\)/);
});

test('.opencode/plugins/ecc-hooks.ts maps the event-driven hooks onto ctx.event.subscribe', () => {
  const source = read(entryPath);
  // ctx.event.subscribe() is an async iterable. Passing a callback registers
  // nothing and delivers nothing, so the loop form is asserted, not a call form.
  assert.match(source, /for await \(const event of stream\)/, 'Expected an async-iteration event loop');
  assert.match(
    source,
    /"session\.execution\.succeeded": "session\.idle"/,
    'session.idle must map to the session.execution.succeeded event'
  );
  assert.match(
    source,
    /"session\.deleted": "session\.deleted"/,
    'session.deleted must map to the session.deleted event'
  );
});

test('.opencode/plugins/ecc-hooks.ts de-duplicates events across locations', () => {
  const source = read(entryPath);
  // Every activated location gets its own adapter instance and receives the
  // whole process-wide event stream, so one event would otherwise be handled
  // once per location.
  assert.match(source, /__eccSeenEvents/, 'Expected a process-global seen-event set');
  assert.match(source, /seenEvents\.has\(eventId\)/, 'Expected per-event-id de-duplication');
});

test('.opencode/plugins/ecc-hooks.ts maps shell.env and permission.ask onto their v2 hook points', () => {
  const source = read(entryPath);
  // The v2 names are not the v1 names: shell.env -> "create.before",
  // permission.ask -> "evaluate". Both were confirmed firing on 2.0.32.
  assert.match(source, /ctx\.shell\.hook\("create\.before"/, 'shell.env must register on create.before');
  assert.match(source, /ctx\.permission\.hook\("evaluate"/, 'permission.ask must register on evaluate');
  // ECC's shell.env replaces output.env instead of mutating it, so the merge
  // must be copied back onto the event's own env object.
  assert.match(source, /Object\.assign\(event\.env, output\.env\)/, 'shell env merge must be copied back');
  // A permission hook may only ever tighten: the adapter writes a denial and
  // otherwise leaves the resolved effect alone.
  assert.match(source, /event\.effect = "deny"/, 'Expected an explicit denial write-back');
});

test('.opencode/plugins/ecc-hooks.ts registers ECC custom tools in the v2 shape', () => {
  const source = read(entryPath);
  assert.match(source, /await ctx\.tool\.transform\(/, 'Expected a synchronous tool transform');
  assert.match(source, /options: \{ codemode: true \}/, 'Tools need the codemode option to reach the model');
  assert.match(source, /return \{ content: typeof out === "string"/, 'v2 tool executors must return { content }');
  for (const name of ['"changed-files"', '"dependency-analyzer"']) {
    assert.ok(source.includes(`name: ${name}`), `Expected ${name} to be registered`);
  }
});
