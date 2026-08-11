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

  if (test('README marks the available native path as default and warns against stacked installs', () => {
    assert.ok(
      readme.includes('### Pick one path only'),
      'README should surface a top-level install decision section'
    );
    assert.ok(
      readme.includes('**Recommended today for Claude Code:** use the [native plugin commands above]'),
      'README should name the currently available native plugin path as the default'
    );
    assert.ok(
      readme.includes('**Coming in 2.2.0:** guided setup'),
      'README should gate guided setup behind the unpublished 2.2.0 release'
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

  if (test('README leads with native Claude setup while the guided path is gated', () => {
    const nativeIndex = readme.indexOf('## Install with Claude Code');
    const overviewIndex = readme.indexOf('\n# ECC\n');
    const guidedIndex = readme.indexOf('### Guided setup (coming in 2.2.0)');

    assert.ok(
      nativeIndex > -1 && nativeIndex < overviewIndex && guidedIndex > overviewIndex,
      'README should put the available Claude plugin install above the product overview and unreleased guided path'
    );
    assert.ok(
      readme.includes('Do not run the guided commands in this section until npm publishes 2.2.0'),
      'README should explicitly prevent users from running the unreleased commands'
    );
    assert.ok(
      readme.includes('installs, updates, or safely moves `ecc@ecc`'),
      'README should explain that rerunning guided setup reconciles existing installs'
    );
    assert.ok(
      readme.includes('Claude Code owns these built-in commands'),
      'README should distinguish provider-owned slash behavior from ECC setup behavior'
    );
    assert.ok(
      readme.includes('`/ecc:configure-ecc`'),
      'README should document the installed namespaced reconfiguration skill'
    );
    assert.ok(
      readme.includes('available only after the plugin is installed'),
      'README should not imply the namespaced skill can perform a first install'
    );
    assert.ok(
      readme.includes('currently configures the Claude Code plugin'),
      'README should not imply that the current setup wizard installs every ECC harness'
    );
  })) passed++; else failed++;

  if (test('README documents modern package-runner alternatives', () => {
    assert.ok(readme.includes('pnpm dlx ecc-universal setup'));
    assert.ok(readme.includes('yarn dlx ecc-universal setup'));
    assert.ok(readme.includes('bunx ecc-universal setup'));
    assert.ok(
      readme.includes('Yarn Classic 1 does not provide `yarn dlx`'),
      'README should not advertise the modern Yarn command to Yarn Classic users'
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
      readme.includes('npx ecc-universal consult "security reviews" --target claude'),
      'README should document the packaged consult command'
    );
    assert.ok(
      readme.includes('It returns matching components, related profiles, and preview/install commands.'),
      'README should explain what consult returns'
    );
  })) passed++; else failed++;

  if (test('README never invokes the unrelated ecc npm package', () => {
    assert.ok(
      !/\bnpx ecc\s/.test(readme),
      'README one-shot commands should use the published ecc-universal package name'
    );
  })) passed++; else failed++;

  if (test('README gives the native guided Codex and managed Kimi dry-run paths', () => {
    assert.ok(
      readme.includes('npx ecc-universal install --guided --harness codex --dry-run'),
      'README should verify Codex through the native guided reconciler'
    );
    assert.ok(
      !readme.includes('npx ecc-universal install --profile core --target codex --dry-run'),
      'README should not present the legacy managed Codex adapter as the native lifecycle'
    );
    assert.ok(
      readme.includes('npx ecc-universal install --profile core --target kimi --dry-run')
    );
    for (const target of ['cursor', 'gemini', 'opencode', 'codebuddy', 'joycode', 'qwen', 'zed', 'hermes', 'openclaw']) {
      assert.ok(readme.includes(`\`${target}\``), `README should name the ${target} target`);
    }
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
