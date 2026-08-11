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
const PANE = 'scripts/codex/ecc-codex-bar-pane';
const DOC = 'docs/STATUSLINE.md';

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

console.log('\n=== Testing the Codex bar outside tmux ===\n');

test('the redundant surfaces are gone, not merely undocumented', () => {
  const wrapper = read(WRAPPER);
  const doc = read(DOC);

  // The bar now owns three rows everywhere, so the title and user-var copies
  // were duplicate information, and the tab-bar Lua example duplicated them
  // again in one line.
  assert.ok(!wrapper.includes('SetUserVar'), 'the user-var mirror must be gone');
  assert.ok(!/\\033\]2;/.test(wrapper), 'the window-title mirror must be gone');
  assert.ok(
    !fs.existsSync(path.join(repoRoot, 'examples/wezterm-ecc-bar.lua')),
    'the tab-bar Lua example must be gone'
  );
  assert.ok(
    !doc.includes('user.ecc_codex_bar'),
    'docs must not still advertise the iTerm2 user var'
  );

  // ECC must no longer write Codex's native widget line: it renders the same
  // information directly under the composer, stacked against the ECC bar.
  assert.ok(
    !fs.existsSync(path.join(repoRoot, 'scripts/lib/codex-status-line.js')),
    'the native status_line writer must be gone'
  );
  for (const f of ['scripts/codex/setup-codex-bar.js', 'scripts/lib/multi-harness-setup.js']) {
    assert.ok(
      !read(f).includes('codex-status-line'),
      `${f} must not configure Codex's native status_line`
    );
  }
});

test('docs give every terminal a home for the three lines', () => {
  const doc = read(DOC);

  assert.ok(doc.includes('none of them need tmux'), 'docs must say tmux is optional');
  for (const row of [
    /\| tmux \| three lines of the session's status area \|/,
    /\| WezTerm \| a three-row pane across the bottom of the window \|/,
    /\| Terminal\.app and other VT100 terminals \| the bottom three rows/,
  ]) {
    assert.ok(row.test(doc), `the surface table is missing a row: ${row}`);
  }
  assert.ok(doc.includes('ECC_CODEX_REGION=off'), 'docs must document the region opt-out');
  assert.ok(doc.includes('ECC_CODEX_PANE=off'), 'docs must document the pane opt-out');
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

test('plain terminals get the three lines in reserved bottom rows', () => {
  const wrapper = read(WRAPPER);
  const doc = read(DOC);

  // DECSTBM is what stops Codex scrolling over the bar. Without the margins
  // this degrades to painting three lines that the next redraw eats.
  assert.ok(
    /\\033\[1;%dr/.test(wrapper),
    'the wrapper must set DECSTBM scroll margins to reserve the rows'
  );
  assert.ok(
    wrapper.includes('\\033[r'),
    'the margins must be released on exit or the shell inherits them'
  );
  // DECSC/DECRC keep Codex's cursor where Codex left it.
  assert.ok(
    wrapper.includes('\\0337') && wrapper.includes('\\0338'),
    'repaints must save and restore the cursor'
  );
  assert.ok(
    wrapper.includes('stty size'),
    'height must come from the tty, not $LINES, which tput trusts and gets wrong'
  );

  // The region is the fallback: it must not fight tmux or the WezTerm pane.
  const guard = wrapper.slice(wrapper.indexOf('in_plain_terminal() {'));
  assert.ok(
    guard.includes('[ -z "${TMUX:-}" ]') && guard.includes('[ -z "$WEZTERM_BAR_PANE" ]'),
    'the reserved region must yield to tmux and to the WezTerm pane'
  );
  // Codex resets the scroll margins when it starts. The reservation only
  // survives because it is re-asserted on a one second cadence, not once per
  // refresh interval, which left the bar missing for up to 15 seconds.
  const loop = wrapper.slice(wrapper.indexOf('if [ "$REGION_ACTIVE" = 1 ]; then'));
  assert.ok(/\n {6}sleep 1\n/.test(loop), 'the region must repaint every second');
  assert.ok(
    loop.includes('tick % INTERVAL'),
    'rendering must stay on the slow interval so node is not spawned every second'
  );

  const cleanup = wrapper.slice(wrapper.indexOf('cleanup() {'), wrapper.indexOf('trap cleanup'));
  assert.ok(cleanup.includes('region_off'), 'cleanup must release the reserved rows');

  assert.ok(doc.includes('ECC_CODEX_REGION=off'), 'docs must document the opt-out');
});

test('the bar pane never scrolls itself', () => {
  const pane = read(PANE);

  // A newline on the last row of the pane scrolls it, which duplicated line 1
  // into the scrollback on every refresh.
  assert.ok(
    !/printf '%s\\033\[K\\n'/.test(pane),
    'the pane must not end its rows with a newline'
  );
  assert.ok(
    /\\033\[1;1H/.test(pane),
    'the pane must address rows absolutely'
  );
  assert.ok(
    pane.includes('\\033[?1049h'),
    'the pane should use the alternate screen so nothing reaches scrollback'
  );
  assert.ok(
    pane.includes('stty size'),
    'pane height must come from the tty, not $LINES'
  );
});

if (failed > 0) {
  console.log(`\nFailed: ${failed}`);
  process.exit(1);
}

console.log(`\nPassed: ${passed}`);
