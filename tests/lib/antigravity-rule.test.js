/**
 * Antigravity only attaches workspace rules that declare an activation
 * trigger in frontmatter. Covers the rule adapter used by the antigravity
 * install target.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const { adaptAntigravityRule } = require('../../scripts/lib/install/antigravity-rule');
const { transformInstallContent } = require('../../scripts/lib/install/content-transform');

const REPO_ROOT = path.join(__dirname, '..', '..');

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

function readRule(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

function frontmatterOf(adapted) {
  const match = adapted.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(match, 'adapted rule should start with frontmatter');
  return yaml.load(match[1]);
}

function runTests() {
  console.log('\n=== Testing Antigravity rule adapter ===\n');

  let passed = 0;
  let failed = 0;

  if (test('marks a rule without frontmatter as always_on', () => {
    const source = readRule('rules/common/patterns.md');
    const adapted = adaptAntigravityRule(source, 'rules/common/patterns.md');

    assert.ok(adapted.startsWith('---\ntrigger: always_on\n---\n'));
    assert.strictEqual(adapted.slice('---\ntrigger: always_on\n---\n'.length), source);
  })) passed++; else failed++;

  if (test('maps Claude paths frontmatter to an Antigravity glob trigger', () => {
    const source = readRule('rules/python/coding-style.md');
    const adapted = adaptAntigravityRule(source, 'rules/python/coding-style.md');

    assert.deepStrictEqual(frontmatterOf(adapted), { trigger: 'glob', globs: '**/*.py,**/*.pyi' });
    assert.ok(adapted.endsWith(source.slice(source.indexOf('\n---\n', 3) + '\n---\n'.length)));
  })) passed++; else failed++;

  if (test('accepts a single string path and CRLF line endings', () => {
    const adapted = adaptAntigravityRule('---\r\npaths: "src/**/*.ts"\r\n---\r\n# Rule\r\n');

    assert.strictEqual(adapted, '---\ntrigger: glob\nglobs: "src/**/*.ts"\n---\n# Rule\r\n');
    assert.deepStrictEqual(frontmatterOf(adapted), { trigger: 'glob', globs: 'src/**/*.ts' });
  })) passed++; else failed++;

  if (test('keeps a description and defaults to always_on without paths', () => {
    const adapted = adaptAntigravityRule('---\ndescription: Shared guidance\n---\n# Rule\n');

    assert.strictEqual(
      adapted,
      '---\ntrigger: always_on\ndescription: "Shared guidance"\n---\n# Rule\n'
    );
  })) passed++; else failed++;

  if (test('leaves a rule that already declares a trigger unchanged', () => {
    const source = '---\ntrigger: model_decision\ndescription: Use for APIs\n---\n# Rule\n';

    assert.strictEqual(adaptAntigravityRule(source), source);
    assert.strictEqual(adaptAntigravityRule(adaptAntigravityRule('# Rule\n')), adaptAntigravityRule('# Rule\n'));
  })) passed++; else failed++;

  if (test('passes native glob rules through, including unquoted globs and its own output', () => {
    const native = '---\ntrigger: glob\nglobs: **/*.ts,**/*.tsx\n---\n# Rule\n';
    assert.strictEqual(adaptAntigravityRule(native), native);

    const adapted = adaptAntigravityRule(readRule('rules/python/coding-style.md'));
    assert.strictEqual(adaptAntigravityRule(adapted), adapted);
  })) passed++; else failed++;

  if (test('does not treat an empty or comment-only trigger as native', () => {
    for (const trigger of ['trigger:', 'trigger: # pending', "trigger: ''"]) {
      assert.strictEqual(
        adaptAntigravityRule(`---\n${trigger}\npaths:\n  - "**/*.go"\n---\n# Rule\n`),
        '---\ntrigger: glob\nglobs: "**/*.go"\n---\n# Rule\n',
        trigger
      );
    }
  })) passed++; else failed++;

  if (test('does not treat a blank quoted trigger as native when YAML cannot parse', () => {
    for (const trigger of ["trigger: ''", 'trigger: ""', "trigger: '  '", "trigger: '' # pending"]) {
      assert.throws(
        () => adaptAntigravityRule(`---\n${trigger}\nglobs: **/*.ts\n---\n# Rule\n`),
        { name: 'YAMLException' },
        trigger
      );
    }
    for (const trigger of ["trigger: 'glob'", 'trigger: "glob"', 'trigger: glob # scoped']) {
      const native = `---\n${trigger}\nglobs: **/*.ts\n---\n# Rule\n`;
      assert.strictEqual(adaptAntigravityRule(native), native, trigger);
    }
  })) passed++; else failed++;

  if (test('rejects non-object frontmatter', () => {
    assert.throws(
      () => adaptAntigravityRule('---\n- one\n- two\n---\n# Rule\n', 'rules/x/bad.md'),
      /Cannot adapt Antigravity rule rules\/x\/bad\.md/
    );
  })) passed++; else failed++;

  if (test('is registered as the antigravity-rule-frontmatter install transform', () => {
    const adapted = transformInstallContent(
      { contentTransform: 'antigravity-rule-frontmatter', sourceRelativePath: 'rules/common/testing.md' },
      '# Testing\n'
    );

    assert.strictEqual(adapted, '---\ntrigger: always_on\n---\n# Testing\n');
  })) passed++; else failed++;

  if (test('gives every shipped rule pack file an activation trigger', () => {
    const rulesRoot = path.join(REPO_ROOT, 'rules');
    const packs = fs.readdirSync(rulesRoot, { withFileTypes: true }).filter(entry => entry.isDirectory());
    let checked = 0;

    for (const pack of packs) {
      for (const fileName of fs.readdirSync(path.join(rulesRoot, pack.name))) {
        if (!fileName.endsWith('.md')) continue;
        const relativePath = `rules/${pack.name}/${fileName}`;
        const adapted = adaptAntigravityRule(readRule(relativePath), relativePath);
        const frontmatter = frontmatterOf(adapted);
        assert.ok(
          frontmatter.trigger === 'always_on'
            || (frontmatter.trigger === 'glob' && typeof frontmatter.globs === 'string' && frontmatter.globs.length > 0),
          `${relativePath} has no Antigravity trigger`
        );
        assert.ok(!Object.hasOwn(frontmatter, 'paths'), `${relativePath} still carries Claude paths`);
        checked += 1;
      }
    }

    assert.ok(checked > 0, 'Should check at least one rule');
  })) passed++; else failed++;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
