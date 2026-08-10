'use strict';

const assert = require('assert');
const { version: ECC_VERSION } = require('../../package.json');

const {
  renderTerminalWelcome,
  showTerminalWelcome,
} = require('../../scripts/lib/terminal-welcome');

const OFFICIAL_LINKS = Object.freeze({
  github: 'https://github.com/affaan-m/ECC',
  discord: 'https://discord.gg/36yGMHGFbR',
  documentation: 'https://github.com/affaan-m/ECC#readme',
  githubApp: 'https://github.com/apps/ecc-tools',
});

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
    failed += 1;
  }
}

function createOutput(isTTY = true) {
  const writes = [];
  return {
    isTTY,
    writes,
    write(value) {
      writes.push(value);
    },
  };
}

console.log('\n=== Terminal welcome tests ===\n');

test('renders the cfonts block ECC wordmark with a welcome, version, and boxed links', () => {
  const welcome = renderTerminalWelcome({ color: false });
  const lines = welcome.split('\n');
  const boxTop = lines.findIndex(line => line.startsWith('  ╭'));
  const boxBottom = lines.findIndex(line => line.startsWith('  ╰'));

  assert.match(welcome, /███████╗\s+██████╗\s+██████╗/);
  assert.match(welcome, /╚══════╝\s+╚═════╝\s+╚═════╝/);
  assert.strictEqual(welcome.includes('◕'), false);
  assert.strictEqual(welcome.includes('ᴗ'), false);
  assert.match(welcome, /Welcome to ECC!/);
  assert.ok(welcome.includes(`v${ECC_VERSION}`));
  assert.ok(boxTop > 0);
  assert.ok(boxBottom > boxTop);
  assert.ok(lines.slice(boxTop + 1, boxBottom).every(line => /^ {2}│ .* │$/.test(line)));
  assert.strictEqual(lines[boxTop].length, lines[boxBottom].length);
  assert.ok(welcome.includes(`GitHub:        ${OFFICIAL_LINKS.github}`));
  assert.ok(welcome.includes(`Discord:       ${OFFICIAL_LINKS.discord}`));
  assert.ok(welcome.includes(`Documentation: ${OFFICIAL_LINKS.documentation}`));
  assert.ok(welcome.includes(`GitHub App:     ${OFFICIAL_LINKS.githubApp}`));
  assert.strictEqual(welcome.includes('\x1b['), false);
});

test('renders an explicitly verified installed version when provided', () => {
  const welcome = renderTerminalWelcome({ color: false, version: '2.1.0' });

  assert.ok(welcome.includes('v2.1.0'));
  assert.strictEqual(welcome.includes(`v${ECC_VERSION}`), ECC_VERSION === '2.1.0');
});

test('rejects unsafe installed-version text before terminal rendering', () => {
  assert.throws(
    () => renderTerminalWelcome({ color: false, version: '2.1.0\u001b[31m' }),
    /Invalid ECC version/
  );
});

test('colors the ECC wordmark from muted orange to dark baby blue', () => {
  const welcome = renderTerminalWelcome({ color: true });
  const orange = '\x1b[38;2;215;151;107m';
  const blue = '\x1b[38;2;100;131;160m';
  const dimVersion = `\x1b[2mv${ECC_VERSION}\x1b[0m`;

  assert.ok(welcome.includes(orange));
  assert.ok(welcome.includes(blue));
  assert.ok(welcome.includes(dimVersion));
  assert.ok(welcome.includes(`\n\x1b[1G  ${dimVersion}`));
  assert.ok(welcome.indexOf(orange) < welcome.indexOf(blue));
});

test('uses terminal color only when NO_COLOR is absent', () => {
  const coloredOutput = createOutput();
  const plainOutput = createOutput();

  showTerminalWelcome({
    action: 'installed',
    env: {},
    interactive: true,
    output: coloredOutput,
  });
  showTerminalWelcome({
    action: 'installed',
    env: { NO_COLOR: '' },
    interactive: true,
    output: plainOutput,
  });

  assert.strictEqual(coloredOutput.writes.join('').includes('\x1b['), true);
  assert.strictEqual(plainOutput.writes.join('').includes('\x1b['), false);
});

test('shows accurate copy after each verified interactive outcome', () => {
  const expectedMessages = {
    installed: 'Welcome to ECC!',
    updated: 'ECC is updated — thank you for using ECC!',
    migrated: 'ECC is configured — thank you for using ECC!',
    resumed: 'ECC is configured — thank you for using ECC!',
    'already-migrated': 'ECC is configured — thank you for using ECC!',
  };
  for (const [action, expectedMessage] of Object.entries(expectedMessages)) {
    const output = createOutput();
    const shown = showTerminalWelcome({
      action,
      env: { NO_COLOR: '1' },
      interactive: true,
      output,
    });

    assert.strictEqual(shown, true);
    assert.ok(output.writes.join('').includes(expectedMessage));
  }
});

test('stays quiet for cancellation, dry-runs, JSON, failures, and non-TTY output', () => {
  const cases = [
    { action: 'cancelled', interactive: true },
    { action: 'would-install', dryRun: true, interactive: true },
    { action: 'installed', interactive: true, json: true },
    { action: 'failed', interactive: true },
    { action: 'installed', interactive: false },
  ];

  for (const options of cases) {
    const output = createOutput(options.interactive !== false);
    const shown = showTerminalWelcome({
      env: {},
      output,
      ...options,
    });

    assert.strictEqual(shown, false);
    assert.deepStrictEqual(output.writes, []);
  }
});

test('stays quiet when the output stream itself is not a TTY', () => {
  const output = createOutput(false);
  const shown = showTerminalWelcome({
    action: 'installed',
    env: {},
    interactive: true,
    output,
  });

  assert.strictEqual(shown, false);
  assert.deepStrictEqual(output.writes, []);
});

console.log(`\nResults: Passed: ${passed}, Failed: ${failed}\n`);
if (failed > 0) process.exit(1);
