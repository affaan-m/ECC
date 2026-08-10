'use strict';

/**
 * The Codex usage bar must stay usable without tmux.
 *
 * tmux only adds the three-line status variant. The title mirror and the
 * `ecc_codex_bar` user var are what a plain terminal gets, so these tests pin
 * the two things that have silently broken that path before:
 *
 *  1. the wrapper emitting OSC sequences only when running inside tmux
 *  2. consumers splitting the bar with a Lua character class, which matches
 *     BYTES: `│` is e2 94 82 and shares its leading e2 with ⬢, █, ░ and ↻, so
 *     `[^│]+` cuts those glyphs in half and emits invalid UTF-8
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');

const WRAPPER = 'scripts/codex/ecc-codex';
const EXAMPLE = 'examples/wezterm-ecc-bar.lua';
const PANE = 'scripts/codex/ecc-codex-bar-pane';
const DOC = 'docs/STATUSLINE.md';
const SEP = '│';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
    failed++;
  }
}

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

/** Every ```lua fenced block in a markdown document. */
function luaBlocks(markdown) {
  return [...markdown.matchAll(/```lua\n([\s\S]*?)```/g)].map(match => match[1]);
}

/**
 * Drop `--` line comments so the assertions below judge executable Lua only.
 * The example deliberately names the byte-class antipattern in a comment to
 * explain why it is wrong.
 */
function stripLuaComments(source) {
  return source.replace(/--.*$/gm, '');
}

console.log('\n=== Testing the Codex bar outside tmux ===\n');

test('wrapper emits OSC sequences outside tmux, not only inside it', () => {
  const wrapper = read(WRAPPER);

  // emit() must keep a non-tmux branch that writes straight to the terminal.
  assert.ok(
    wrapper.includes(`printf '%s' "$seq" > /dev/tty`),
    'emit() lost its plain (non-tmux) branch'
  );
  assert.ok(
    wrapper.includes('\\033Ptmux;'),
    'emit() lost the tmux passthrough branch'
  );
});

test('title and user var are mirrored regardless of tmux', () => {
  const wrapper = read(WRAPPER);

  assert.ok(wrapper.includes('\\033]2;%s\\007'), 'missing OSC 2 title mirror');
  assert.ok(
    wrapper.includes('SetUserVar=ecc_codex_bar=%s'),
    'missing OSC 1337 user var mirror'
  );

  // update_bar must run unconditionally. If it were only reachable from
  // tmux_bar_on(), a plain terminal would get nothing.
  const body = wrapper.slice(wrapper.indexOf('tmux_bar_on\n'));
  assert.ok(
    /^update_bar$/m.test(body),
    'update_bar is no longer called unconditionally at startup'
  );

  const tmuxOn = wrapper.slice(
    wrapper.indexOf('tmux_bar_on() {'),
    wrapper.indexOf('tmux_bar_off() {')
  );
  assert.ok(
    !tmuxOn.includes('update_bar'),
    'the terminal mirror must not be gated behind the tmux path'
  );
});

test('the WezTerm example ships and splits the bar safely', () => {
  const example = read(EXAMPLE);

  assert.ok(
    !stripLuaComments(example).includes(`[^${SEP}]`),
    'the example uses a byte-wise character class to split the bar'
  );
  assert.ok(
    example.includes('find(SEP, 1, true)') && example.includes('find(SEP, pos, true)'),
    'the example must split with a plain find so multibyte glyphs survive'
  );
  assert.ok(example.includes('ecc_codex_bar'), 'the example must read the user var');
  assert.ok(
    example.includes('function M.apply'),
    'the example must expose apply() as documented'
  );
});

test('no Lua snippet in the docs splits the bar with a character class', () => {
  for (const block of luaBlocks(read(DOC))) {
    assert.ok(
      !stripLuaComments(block).includes(`[^${SEP}]`),
      `a Lua snippet still splits on [^${SEP}], which mangles ⬢ █ ░ ↻`
    );
  }
});

test('docs route WezTerm and iTerm2 users to a working setup', () => {
  const doc = read(DOC);

  assert.ok(doc.includes(EXAMPLE), 'docs must link the shipped WezTerm example');
  assert.ok(
    doc.includes('require("wezterm-ecc-bar").apply()'),
    'docs must show how to load the example'
  );
  assert.ok(
    doc.includes('\\(user.ecc_codex_bar)'),
    'docs must show the iTerm2 interpolated string'
  );
});

test('docs state that tmux is optional', () => {
  const doc = read(DOC);

  assert.ok(doc.includes('tmux is optional'), 'docs must say tmux is optional');
  assert.ok(
    /Three-line bar \| the wrapper, in tmux or WezTerm/.test(doc),
    'the surface table must offer the three-line bar outside tmux too'
  );
  assert.ok(
    doc.includes('ECC_CODEX_PANE=off'),
    'docs must document how to opt out of the WezTerm pane'
  );
});

test('WezTerm gets the three-line bar in a pane of its own', () => {
  const wrapper = read(WRAPPER);
  const pane = read(PANE);

  // The pane is the only way to show three lines in WezTerm, so the wrapper
  // must open one and, critically, tear it down again.
  assert.ok(wrapper.includes('wezterm_bar_on'), 'wrapper must open the bar pane');
  const cleanup = wrapper.slice(wrapper.indexOf('cleanup() {'), wrapper.indexOf('trap cleanup'));
  assert.ok(
    cleanup.includes('wezterm_bar_off'),
    'cleanup must close the bar pane or it outlives Codex'
  );

  // --top-level spans the window instead of subdividing Codex's own pane.
  assert.ok(wrapper.includes('--top-level'), 'the pane must span the whole window');
  assert.ok(wrapper.includes('--cells 3'), 'the pane must be three lines tall');
  assert.ok(
    wrapper.includes('activate-pane'),
    'focus must return to Codex after the split'
  );
  assert.ok(
    /\[ -z "\$\{TMUX:-\}" \]/.test(wrapper),
    'the pane must not open inside tmux, which already draws the bar'
  );

  // A wrapper killed with SIGKILL never runs its trap, so the pane has to be
  // able to close itself.
  assert.ok(
    pane.includes('kill -0 "$WATCH_PID"'),
    'the pane must exit when the process it was opened for goes away'
  );
  assert.ok(
    pane.includes('--full'),
    'the pane must render all three lines'
  );
});

if (failed > 0) {
  console.log(`\nFailed: ${failed}`);
  process.exit(1);
}

console.log(`\nPassed: ${passed}`);
