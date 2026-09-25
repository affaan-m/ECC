#!/usr/bin/env node
/**
 * Fixture tests for scripts/ci/validate-skill-host-compat.js.
 *
 * Uses tmp dirs, not the live catalog.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.join(__dirname, '..', '..');
const validatorPath = path.join(repoRoot, 'scripts', 'ci', 'validate-skill-host-compat.js');

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
    return false;
  }
}

function createRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'skill-host-compat-'));
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function writeSkill(root, skillName, body, options = {}) {
  const tree = options.tree || 'skills';
  const extraFrontmatter = options.frontmatter || {};
  const dir = path.join(root, tree, skillName);
  fs.mkdirSync(dir, { recursive: true });
  const lines = ['---', `name: ${options.name || skillName}`];
  if (options.description !== false) {
    lines.push(`description: ${options.description || `Fixture skill ${skillName}`}`);
  }
  for (const [key, value] of Object.entries(extraFrontmatter)) {
    lines.push(`${key}: ${value}`);
  }
  lines.push('---', '');
  lines.push(body);
  fs.writeFileSync(path.join(dir, 'SKILL.md'), `${lines.join('\n')}\n`);
}

function writeOpenaiYaml(root, skillNames) {
  const dir = path.join(root, 'agents');
  fs.mkdirSync(dir, { recursive: true });
  const body = ['skills:', ...skillNames.map(name => `  - ${name}`)].join('\n');
  fs.writeFileSync(path.join(dir, 'openai.yaml'), `${body}\n`);
}

function runValidator(root, extraArgs = []) {
  return spawnSync('node', [validatorPath, '--root', root, ...extraArgs], {
    encoding: 'utf8',
    cwd: repoRoot,
    timeout: 10000,
  });
}

function checklistBody(title) {
  return [
    `# ${title}`,
    '',
    '## When to Activate',
    '',
    '- Writing or reviewing a skill PR',
    '',
    '## Anti-Patterns',
    '',
    '- Shipping a Codex copy with extra frontmatter keys',
    '',
  ].join('\n');
}

console.log('\n=== Testing validate-skill-host-compat.js ===\n');

let passed = 0;
let failed = 0;

function check(name, fn) {
  if (test(name, fn)) passed += 1;
  else failed += 1;
}

check('exports extractFrontmatter and inspectFrontmatter without running the CLI', () => {
  const skills = require('../../scripts/ci/validate-skills');
  assert.strictEqual(typeof skills.extractFrontmatter, 'function');
  assert.strictEqual(typeof skills.inspectFrontmatter, 'function');
  const fm = skills.extractFrontmatter('---\nname: demo\ndescription: hi\n---\n# Demo\n');
  assert.strictEqual(fm.present, true);
  const inspected = skills.inspectFrontmatter(fm.lines);
  assert.strictEqual(inspected.values.name, 'demo');
});

check('happy: skill with name/description only, no Codex copy required, exits 0', () => {
  const root = createRoot();
  try {
    writeSkill(root, 'portable', checklistBody('Portable'));
    const result = runValidator(root);
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
    assert.ok(result.stdout.includes('Validated host compatibility for 1'));
  } finally {
    cleanup(root);
  }
});

check('happy: Codex copy whose frontmatter is the allowlist only, exits 0', () => {
  const root = createRoot();
  try {
    writeSkill(root, 'portable', checklistBody('Portable'), {
      frontmatter: { origin: 'ECC' },
    });
    writeSkill(root, 'portable', checklistBody('Portable'), {
      tree: '.agents/skills',
    });
    writeOpenaiYaml(root, ['portable']);
    const result = runValidator(root);
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
  } finally {
    cleanup(root);
  }
});

check('fail: bash fence contains ${CLAUDE_SESSION_ID}', () => {
  const root = createRoot();
  try {
    writeSkill(
      root,
      'leaky',
      `${checklistBody('Leaky')}\n## Code Examples\n\n\`\`\`bash\necho "\${CLAUDE_SESSION_ID}"\n\`\`\`\n`
    );
    const result = runValidator(root);
    assert.strictEqual(result.status, 1);
    assert.ok(result.stderr.includes('ERROR:'));
    assert.ok(result.stderr.includes('leaky'));
    assert.ok(result.stderr.includes('${CLAUDE_SESSION_ID}'));
  } finally {
    cleanup(root);
  }
});

check('fail: bash fence contains ${CLAUDE_PROJECT_DIR}', () => {
  const root = createRoot();
  try {
    writeSkill(
      root,
      'proj',
      `${checklistBody('Proj')}\n## Code Examples\n\n\`\`\`bash\ncd "\${CLAUDE_PROJECT_DIR}"\n\`\`\`\n`
    );
    const result = runValidator(root);
    assert.strictEqual(result.status, 1);
    assert.ok(result.stderr.includes('ERROR:'));
    assert.ok(result.stderr.includes('proj'));
    assert.ok(result.stderr.includes('${CLAUDE_PROJECT_DIR}'));
    assert.ok(result.stderr.includes('rewrite to $(pwd) or an explicit path'));
  } finally {
    cleanup(root);
  }
});

check('fail: $CLAUDE_PROJECT_DIR used as a substitution in a bash fence', () => {
  const root = createRoot();
  try {
    writeSkill(
      root,
      'proj',
      `${checklistBody('Proj')}\n## Code Examples\n\n\`\`\`sh\ncd "$CLAUDE_PROJECT_DIR"\n\`\`\`\n`
    );
    const result = runValidator(root);
    assert.strictEqual(result.status, 1);
    assert.ok(result.stderr.includes('$CLAUDE_PROJECT_DIR'));
    assert.ok(result.stderr.includes('rewrite to $(pwd) or an explicit path'));
  } finally {
    cleanup(root);
  }
});

check('bash fence $(pwd) is accepted in place of CLAUDE_PROJECT_DIR', () => {
  const root = createRoot();
  try {
    writeSkill(
      root,
      'proj',
      `${checklistBody('Proj')}\n## Code Examples\n\n\`\`\`bash\ncd "$(pwd)"\n\`\`\`\n`
    );
    const result = runValidator(root);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.ok(!result.stderr.includes('ERROR:'));
    assert.ok(!result.stderr.includes('CLAUDE_PROJECT_DIR'));
  } finally {
    cleanup(root);
  }
});

check('prose mention of CLAUDE_PROJECT_DIR does not fail', () => {
  const root = createRoot();
  try {
    writeSkill(
      root,
      'prose',
      `${checklistBody('Prose')}\nThe project root is \`CLAUDE_PROJECT_DIR\`, then cwd.\n`
    );
    const result = runValidator(root);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.ok(!result.stderr.includes('ERROR:'));
  } finally {
    cleanup(root);
  }
});

check('fail: $ARGUMENTS used as a substitution in a bash fence', () => {
  const root = createRoot();
  try {
    writeSkill(
      root,
      'args',
      `${checklistBody('Args')}\n## Code Examples\n\n\`\`\`bash\necho "$ARGUMENTS"\n\`\`\`\n`
    );
    const result = runValidator(root);
    assert.strictEqual(result.status, 1);
    assert.ok(result.stderr.includes('args'));
    assert.ok(result.stderr.includes('$ARGUMENTS'));
  } finally {
    cleanup(root);
  }
});

check('fail: .agents/skills/foo/SKILL.md has version:', () => {
  const root = createRoot();
  try {
    writeSkill(root, 'foo', checklistBody('Foo'));
    writeSkill(root, 'foo', checklistBody('Foo'), {
      tree: '.agents/skills',
      frontmatter: { version: '1.0.0' },
    });
    const result = runValidator(root);
    assert.strictEqual(result.status, 1);
    assert.ok(result.stderr.includes('version'));
    assert.ok(result.stderr.includes('.agents/skills/foo/SKILL.md'));
  } finally {
    cleanup(root);
  }
});

check('fail: agents/openai.yaml lists foo but .agents/skills/foo/ is missing', () => {
  const root = createRoot();
  try {
    writeSkill(root, 'foo', checklistBody('Foo'));
    writeOpenaiYaml(root, ['foo']);
    const result = runValidator(root);
    assert.strictEqual(result.status, 1);
    assert.ok(result.stderr.includes('agents/openai.yaml lists \'foo\''));
    assert.ok(result.stderr.includes('.agents/skills/foo/'));
  } finally {
    cleanup(root);
  }
});

check('warn-only: missing ## When to Activate exits 0 unless --strict-checklist', () => {
  const root = createRoot();
  try {
    writeSkill(
      root,
      'thin',
      '# Thin\n\n## Anti-Patterns\n\n- Missing activation heading\n'
    );
    const warnResult = runValidator(root);
    assert.strictEqual(warnResult.status, 0, warnResult.stderr);
    assert.ok(warnResult.stderr.includes('WARN:'));
    assert.ok(warnResult.stderr.includes('When to Activate'));

    const strictResult = runValidator(root, ['--strict-checklist']);
    assert.strictEqual(strictResult.status, 1);
    assert.ok(strictResult.stderr.includes('ERROR:'));
  } finally {
    cleanup(root);
  }
});

check('anti-pattern fence still matches when the do-not line wraps', () => {
  const root = createRoot();
  try {
    writeSkill(
      root,
      'wrapped',
      [
        '# Wrapped',
        '',
        '## When to Activate',
        '',
        '- Reviewing a skill PR',
        '',
        '## Anti-Patterns',
        '',
        'Do not put Claude-only substitutions in bash blocks. This fence is the',
        'forbidden pattern:',
        '',
        '```bash',
        'echo "${CLAUDE_SESSION_ID}"',
        '```',
        '',
      ].join('\n')
    );
    const result = runValidator(root);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.ok(!result.stderr.includes('ERROR:'));
  } finally {
    cleanup(root);
  }
});

check('anti-pattern fence that quotes the token as forbidden exits 0', () => {
  const root = createRoot();
  try {
    writeSkill(
      root,
      'quoted',
      [
        '# Quoted',
        '',
        '## When to Activate',
        '',
        '- Reviewing a skill PR',
        '',
        '## Anti-Patterns',
        '',
        'Do not put Claude-only substitutions in bash blocks:',
        '',
        '```bash',
        'echo "${CLAUDE_SESSION_ID}"',
        '```',
        '',
      ].join('\n')
    );
    const result = runValidator(root);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.ok(!result.stderr.includes('ERROR:'));
  } finally {
    cleanup(root);
  }
});

check('empty skills/ tmp root exits 0', () => {
  const root = createRoot();
  try {
    fs.mkdirSync(path.join(root, 'skills'));
    const result = runValidator(root);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.ok(result.stdout.includes('Validated host compatibility for 0'));
  } finally {
    cleanup(root);
  }
});

check('missing skills directory skips with exit 0', () => {
  const root = createRoot();
  try {
    const result = runValidator(root);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.ok(result.stdout.includes('skipping'));
  } finally {
    cleanup(root);
  }
});

check('origin on canonical copy is allowed; origin on Codex copy fails', () => {
  const root = createRoot();
  try {
    writeSkill(root, 'foo', checklistBody('Foo'), { frontmatter: { origin: 'ECC' } });
    writeSkill(root, 'foo', checklistBody('Foo'), {
      tree: '.agents/skills',
      frontmatter: { origin: 'ECC' },
    });
    const result = runValidator(root);
    assert.strictEqual(result.status, 1);
    assert.ok(result.stderr.includes('origin'));
  } finally {
    cleanup(root);
  }
});

check('Cursor copy name mismatch is an error; extra Cursor copies are not required', () => {
  const root = createRoot();
  try {
    writeSkill(root, 'alpha', checklistBody('Alpha'));
    writeSkill(root, 'alpha', checklistBody('Alpha'), {
      tree: '.cursor/skills',
      name: 'beta',
    });
    const result = runValidator(root);
    assert.strictEqual(result.status, 1);
    assert.ok(result.stderr.includes('.cursor/skills/alpha/SKILL.md'));
    assert.ok(result.stderr.includes('does not match directory'));
  } finally {
    cleanup(root);
  }
});

check('--inventory prints JSON counts and exits 0 even with errors', () => {
  const root = createRoot();
  try {
    writeSkill(
      root,
      'leaky',
      `${checklistBody('Leaky')}\n## Code Examples\n\n\`\`\`bash\necho "$CLAUDE_SKILL_DIR"\n\`\`\`\n`
    );
    const result = runValidator(root, ['--inventory']);
    assert.strictEqual(result.status, 0, result.stderr);
    const counts = JSON.parse(result.stdout.trim());
    assert.strictEqual(counts.skillsScanned, 1);
    assert.ok(counts.substitutions >= 1);
    assert.ok(counts.errors >= 1);
  } finally {
    cleanup(root);
  }
});

check('empty-language shebang fence is scanned; markdown fence is not', () => {
  const root = createRoot();
  try {
    writeSkill(
      root,
      'mixed',
      [
        '# Mixed',
        '',
        '## When to Activate',
        '',
        '- Reviewing fences',
        '',
        '## Anti-Patterns',
        '',
        '- Putting substitutions in bash',
        '',
        '```markdown',
        'Parse $ARGUMENTS in a command file, not in a skill bash block.',
        '```',
        '',
        '```',
        '#!/bin/sh',
        'echo "$CLAUDE_PLUGIN_ROOT"',
        '```',
        '',
      ].join('\n')
    );
    const result = runValidator(root);
    assert.strictEqual(result.status, 1);
    assert.ok(result.stderr.includes('$CLAUDE_PLUGIN_ROOT'));
    assert.ok(!result.stderr.includes('$ARGUMENTS'));
  } finally {
    cleanup(root);
  }
});

check('Codex copy name mismatch is an error', () => {
  const root = createRoot();
  try {
    writeSkill(root, 'foo', checklistBody('Foo'));
    writeSkill(root, 'foo', checklistBody('Foo'), {
      tree: '.agents/skills',
      name: 'bar',
    });
    const result = runValidator(root);
    assert.strictEqual(result.status, 1);
    assert.ok(result.stderr.includes('.agents/skills/foo/SKILL.md'));
  } finally {
    cleanup(root);
  }
});

check('--root without a path exits 1', () => {
  const result = spawnSync('node', [validatorPath, '--root'], {
    encoding: 'utf8',
    cwd: repoRoot,
    timeout: 10000,
  });
  assert.strictEqual(result.status, 1);
  assert.ok(result.stderr.includes('--root requires a directory path'));
});

check('canonical name mismatch warns and does not fail', () => {
  const root = createRoot();
  try {
    writeSkill(root, 'foo', checklistBody('Foo'), { name: 'bar' });
    const result = runValidator(root);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.ok(result.stderr.includes('WARN:'));
    assert.ok(result.stderr.includes('does not match directory'));
  } finally {
    cleanup(root);
  }
});

check('missing Anti-Patterns heading warns', () => {
  const root = createRoot();
  try {
    writeSkill(
      root,
      'thin',
      '# Thin\n\n## When to Activate\n\n- Reviewing a skill\n'
    );
    const result = runValidator(root);
    assert.strictEqual(result.status, 0);
    assert.ok(result.stderr.includes('Anti-Patterns'));
  } finally {
    cleanup(root);
  }
});

check('body over 500 lines warns; over 800 stays warn unless --strict-checklist', () => {
  const root = createRoot();
  try {
    const overFive = `${checklistBody('Long')}\n${'line\n'.repeat(500)}`;
    writeSkill(root, 'longish', overFive);
    const warnResult = runValidator(root);
    assert.strictEqual(warnResult.status, 0, warnResult.stderr);
    assert.ok(warnResult.stderr.includes('500'));

    cleanup(root);
    const root2 = createRoot();
    const overEight = `${checklistBody('Huge')}\n${'line\n'.repeat(800)}`;
    writeSkill(root2, 'huge', overEight);
    const hugeWarn = runValidator(root2);
    assert.strictEqual(hugeWarn.status, 0, hugeWarn.stderr);
    assert.ok(hugeWarn.stderr.includes('800'));
    const hugeStrict = runValidator(root2, ['--strict-checklist']);
    assert.strictEqual(hugeStrict.status, 1);
    cleanup(root2);
  } finally {
    if (fs.existsSync(root)) cleanup(root);
  }
});

check('bash fence ${1} is treated as a Claude substitution', () => {
  const root = createRoot();
  try {
    writeSkill(
      root,
      'pos',
      `${checklistBody('Pos')}\n## Code Examples\n\n\`\`\`bash\necho "\${1}"\n\`\`\`\n`
    );
    const result = runValidator(root);
    assert.strictEqual(result.status, 1);
    assert.ok(result.stderr.includes('$1'));
  } finally {
    cleanup(root);
  }
});

check('POSIX VAR=$1 assignment is not a Claude substitution', () => {
  const root = createRoot();
  try {
    writeSkill(
      root,
      'posix',
      `${checklistBody('Posix')}\n## Code Examples\n\n\`\`\`bash\nmove_dir() {\n  SOURCE=$1\n  DEST=$2\n}\n\`\`\`\n`
    );
    const result = runValidator(root);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.ok(!result.stderr.includes('ERROR:'));
  } finally {
    cleanup(root);
  }
});

check('Perl/awk $1 numeric compare is not a Claude substitution', () => {
  const root = createRoot();
  try {
    writeSkill(
      root,
      'cover',
      `${checklistBody('Cover')}\n## Code Examples\n\n\`\`\`bash\nperl -ne 'if (/Total.*?(\\d+)/) { exit 1 if $1 < 80 }'\n\`\`\`\n`
    );
    const result = runValidator(root);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.ok(!result.stderr.includes('ERROR:'));
  } finally {
    cleanup(root);
  }
});

check('echo $1 in a bash fence is treated as a Claude substitution', () => {
  const root = createRoot();
  try {
    writeSkill(
      root,
      'echoone',
      `${checklistBody('Echo')}\n## Code Examples\n\n\`\`\`bash\necho $1\n\`\`\`\n`
    );
    const result = runValidator(root);
    assert.strictEqual(result.status, 1);
    assert.ok(result.stderr.includes('$1'));
  } finally {
    cleanup(root);
  }
});

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
