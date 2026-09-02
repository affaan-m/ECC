/**
 * Regression coverage for install/uninstall clarity in README.md.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const README = path.join(__dirname, '..', '..', 'README.md');
const RULES_README = path.join(__dirname, '..', '..', 'rules', 'README.md');
const CODEX_AGENTS = path.join(__dirname, '..', '..', '.codex', 'AGENTS.md');

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
  const codexAgents = fs.readFileSync(CODEX_AGENTS, 'utf8');

  if (test('README marks one default path and warns against stacked installs', () => {
    assert.ok(
      readme.includes('### Pick one path only'),
      'README should surface a top-level install decision section'
    );
    assert.ok(
      readme.includes('**Recommended default:** run the guided Claude plugin setup'),
      'README should name guided setup as the recommended default install path'
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

  if (test('README leads with the idempotent guided plugin setup path', () => {
    const topClaudeSectionIndex = readme.indexOf('## Install with Claude Code');
    const topGuidedCommandIndex = readme.indexOf('npx ecc-universal setup', topClaudeSectionIndex);
    const nativePluginCommandIndex = readme.indexOf('/plugin marketplace add', topClaudeSectionIndex);
    const installSectionIndex = readme.indexOf('## Install ECC');
    const guidedCommandIndex = readme.indexOf('npx ecc-universal setup', installSectionIndex);
    const claudeDetailsIndex = readme.indexOf('### Claude Code details', installSectionIndex);

    assert.ok(
      topGuidedCommandIndex > topClaudeSectionIndex
      && topGuidedCommandIndex < nativePluginCommandIndex,
      'README should lead its public install surface with the canonical package command'
    );
    assert.ok(
      guidedCommandIndex > installSectionIndex,
      'README should lead new users to the package-name setup command'
    );
    assert.ok(
      guidedCommandIndex < claudeDetailsIndex,
      'README should show the recommended universal command before provider-specific details'
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
    for (const command of [
      'npx ecc-universal list-installed',
      'npx ecc-universal doctor',
      'npx ecc-universal repair',
      'npx ecc-universal uninstall --dry-run',
    ]) {
      assert.ok(
        readme.includes(command),
        `README should document the package-runner lifecycle command: ${command}`
      );
    }
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
      readme.includes('npx ecc-universal install --profile minimal --target claude'),
      'README should document the published universal-package minimal profile command'
    );
    assert.ok(
      !/^\s*npx ecc-install\b/m.test(readme),
      'README code examples must not invoke the unpublished ecc-install package'
    );
    assert.ok(
      readme.includes('--profile core --without baseline:hooks --target claude'),
      'README should document the hook opt-out path for the core profile'
    );
    assert.ok(
      readme.includes('./install.sh --profile core --no-hooks --target claude'),
      'README should document the explicit no-hooks consent path for the core profile'
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

  if (test('README describes the post-release universal install contract', () => {
    assert.ok(
      readme.includes('Node.js 18 or newer'),
      'README should state the runtime required by ecc-universal'
    );
    assert.ok(
      !readme.includes('During registry propagation'),
      'README should not retain the temporary 2.1 registry fallback after 2.2 is live'
    );
    assert.ok(
      !/codex[^\n]*(?:marketplace|plugin)[^\n]*(?:experimental|unreliable)/i.test(readme),
      'README should not contradict the supported native Codex install guidance'
    );
    assert.ok(
      readme.includes('| Skills | Native installed set | Native plugin set |'),
      'README capability map should describe the native Codex skill set'
    );
    assert.ok(
      readme.includes('| ECC hooks | Native plugin hooks | Native reviewed subset with explicit trust |'),
      'README capability map should describe the native Codex hook subset'
    );
    assert.ok(
      readme.includes("Codex's narrower native hook set is supplemented"),
      'README architecture notes should preserve the native Codex hook subset boundary'
    );
    assert.ok(
      !readme.includes("Codex's lack of hooks"),
      'README should not deny the shipped native Codex hook subset'
    );
    assert.ok(
      readme.includes("# Recommended current install: add ECC's native plugin from the repo marketplace"),
      'README Codex detail should lead with the native plugin install'
    );
    assert.ok(
      readme.includes('Legacy copied-configuration compatibility is still available'),
      'README Codex detail should label the sync path as compatibility-only'
    );
    assert.ok(
      !readme.includes('# Automatic setup: sync ECC assets'),
      'README should not present the legacy Codex sync as the primary setup'
    );
    assert.ok(
      codexAgents.includes('Reviewed native subset with explicit trust in `/hooks`'),
      'Packaged Codex guidance should describe the shipped trusted hook subset'
    );
    assert.ok(
      !/not yet supported|codex lacks hooks|security without hooks/i.test(codexAgents),
      'Packaged Codex guidance should not deny native hook support'
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
