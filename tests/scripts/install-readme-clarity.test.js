/**
 * Regression coverage for install/uninstall clarity in README.md.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const README = path.join(__dirname, '..', '..', 'README.md');
const RULES_README = path.join(__dirname, '..', '..', 'rules', 'README.md');

function test(name, fn) {
  try {
    fn();
    console.log(`  \u2713 ${name}`);
    return true;
  } catch (error) {
    console.log(`  \u2717 ${name}`);
    console.log(`    Error: ${error.message}`);
    return false;
  }
}

function runTests() {
  console.log('\n=== Testing install README clarity ===\n');

  let passed = 0;
  let failed = 0;

  const readme = fs.readFileSync(README, 'utf8');
  const rulesReadme = fs.readFileSync(RULES_README, 'utf8');

  if (test('README marks one default path and warns against stacked installs', () => {
    assert.ok(
      readme.includes('### Pick one path only'),
      'README should surface a top-level install decision section'
    );
    assert.ok(
      readme.includes('**Recommended default:** install the Claude Code plugin'),
      'README should name the recommended default install path'
    );
    assert.ok(
      readme.includes('**Do not stack install methods.**'),
      'README should explicitly warn against stacking install methods'
    );
    assert.ok(
      readme.includes('If you choose this path, stop there. Do not also run `/plugin install`.'),
      'README should tell manual-install users not to continue layering installs'
    );
  })) passed++; else failed++;

  if (test('README documents reset and uninstall flow', () => {
    assert.ok(
      readme.includes('### Reset / Uninstall ECC'),
      'README should have a visible reset/uninstall section'
    );
    assert.ok(
      readme.includes('node scripts/uninstall.js --dry-run'),
      'README should document dry-run uninstall'
    );
    assert.ok(
      readme.includes('node scripts/ecc.js list-installed'),
      'README should document install-state inspection before reinstalling'
    );
    assert.ok(
      readme.includes('node scripts/ecc.js doctor'),
      'README should document doctor before reinstalling'
    );
    assert.ok(
      readme.includes('ECC only removes files recorded in its install-state.'),
      'README should explain uninstall safety boundaries'
    );
  })) passed++; else failed++;

  if (test('README documents low-context no-hooks install path', () => {
    assert.ok(
      readme.includes('### Low-context / no-hooks path'),
      'README should surface a low-context no-hooks install option near Quick Start'
    );
    assert.ok(
      readme.includes('./install.sh --profile minimal --target claude'),
      'README should document the shell minimal profile command'
    );
    assert.ok(
      readme.includes('npx ecc-install --profile minimal --target claude'),
      'README should document the npx minimal profile command'
    );
    assert.ok(
      readme.includes('--profile core --without baseline:hooks --target claude'),
      'README should document the hook opt-out path for the core profile'
    );
    assert.ok(
      readme.includes('This profile intentionally excludes `hooks-runtime`.'),
      'README should state that the minimal profile excludes hooks'
    );
  })) passed++; else failed++;

  if (test('README documents consult-based component discovery', () => {
    assert.ok(
      readme.includes('### Find the right components first'),
      'README should surface component discovery before install steps'
    );
    assert.ok(
      readme.includes('npx ecc consult "security reviews" --target claude'),
      'README should document the packaged consult command'
    );
    assert.ok(
      readme.includes('It returns matching components, related profiles, and preview/install commands.'),
      'README should explain what consult returns'
    );
  })) passed++; else failed++;

  if (test('README documents Cursor agent namespace and loading caveat', () => {
    assert.ok(
      readme.includes('`.cursor/agents/ecc-*.md`'),
      'README should document the Cursor agent namespace'
    );
    assert.ok(
      readme.includes('Cursor-native loading behavior can vary by Cursor build.'),
      'README should avoid overclaiming Cursor agent loading semantics'
    );
    assert.ok(
      readme.includes('ECC does not install root `AGENTS.md` into `.cursor/`.'),
      'README should explain why root AGENTS.md is not copied into Cursor context'
    );
  })) passed++; else failed++;

  if (test('README explains plugin-path cleanup and rules scoping', () => {
    assert.ok(
      readme.includes('remove the plugin from Claude Code'),
      'README should tell plugin users how to start cleanup'
    );
    assert.ok(
      readme.includes('Start with `rules/common` plus one language or framework pack you actually use.'),
      'README should steer users away from copying every rules directory'
    );
    assert.ok(
      readme.includes('~/.claude/rules/ecc/'),
      'README should steer plugin-path rules into an ECC-owned namespace'
    );
  })) passed++; else failed++;

  if (test('rules README mirrors ECC namespaced install path', () => {
    assert.ok(
      rulesReadme.includes('mkdir -p ~/.claude/rules/ecc'),
      'rules README should create the ECC-owned user-level rules namespace'
    );
    assert.ok(
      rulesReadme.includes('cp -r rules/common ~/.claude/rules/ecc/'),
      'rules README should copy common rules under ~/.claude/rules/ecc/'
    );
    assert.ok(
      rulesReadme.includes('cp -r rules/typescript ~/.claude/rules/ecc/'),
      'rules README should copy language rules under ~/.claude/rules/ecc/'
    );
    assert.ok(
      rulesReadme.includes('mkdir -p .claude/rules/ecc'),
      'rules README should document the project-local ECC namespace'
    );
    assert.ok(
      !rulesReadme.includes('~/.claude/rules/typescript'),
      'rules README should not recommend flat user-level rule destinations'
    );
  })) passed++; else failed++;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
