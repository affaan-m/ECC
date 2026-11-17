'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { buildInstallIndex, rewriteRelativeLinks } = require('../../scripts/lib/install/link-rewrite');
const { applyInstallPlan, createManifestInstallPlan } = require('../../scripts/lib/install-executor');

const sourceRel = 'skills/demo/SKILL.md';
const originalLink = '[guide](../../rules/common/style.md)';
const installedLink = '[guide](../../rules/ecc/common/style.md)';
const index = buildInstallIndex([
  { sourceRel, destRel: sourceRel },
  { sourceRel: 'rules/common/style.md', destRel: 'rules/ecc/common/style.md' },
]);
const rewrite = content => rewriteRelativeLinks(content, { sourceRel, index });

test('shorter or different code fences remain literal inside a longer fence', () => {
  for (const marker of ['`', '~']) {
    const other = marker === '`' ? '~' : '`';
    const block = [
      marker.repeat(4) + 'markdown',
      marker.repeat(3),
      originalLink,
      other.repeat(4),
      originalLink,
      marker.repeat(5),
    ].join('\n');
    assert.strictEqual(rewrite(`${block}\n${originalLink}`), `${block}\n${installedLink}`);
  }
});

test('closing fence candidates with text do not expose code links to rewriting', () => {
  for (const marker of ['`', '~']) {
    const block = [marker.repeat(3), marker.repeat(3) + ' still code', originalLink, marker.repeat(3)].join('\n');
    assert.strictEqual(rewrite(`${block}\n${originalLink}`), `${block}\n${installedLink}`);
  }
});

test('indented fences retain CRLF and accept whitespace after a matching close', () => {
  const block = ['  ````markdown', '  ```', originalLink, '   ````` \t'].join('\r\n');
  assert.strictEqual(rewrite(`${block}\r\n${originalLink}\r\n`), `${block}\r\n${installedLink}\r\n`);
});

test('an unmatched opening fence protects the rest of the document', () => {
  const content = ['~~~~markdown', '```', originalLink, '~~~', originalLink].join('\n');
  assert.strictEqual(rewrite(content), content);
});

test('a backtick in the opening info string does not start a code block', () => {
  const content = ['```invalid`info', originalLink].join('\n');
  assert.strictEqual(rewrite(content), ['```invalid`info', installedLink].join('\n'));
});

test('a fence-like inline code span stays literal without hiding later prose', () => {
  const inlineCode = `\`\`\` example\` ${originalLink} \`\`\``;
  assert.strictEqual(rewrite(`${inlineCode}\n${originalLink}`), `${inlineCode}\n${installedLink}`);
});

test('manifest installation preserves nested Markdown examples and rewrites following prose', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-link-fences-'));
  try {
    const sourceRoot = path.join(directory, 'source');
    const homeDir = path.join(directory, 'home');
    const write = (relative, content) => {
      const file = path.join(sourceRoot, relative);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content);
    };
    write('package.json', JSON.stringify({ version: '1.0.0' }));
    write('manifests/install-modules.json', JSON.stringify({
      version: 1,
      modules: [{
        id: 'fixture-core', kind: 'fixture', description: 'Fenced link fixture',
        paths: ['skills/demo', 'rules/common'], targets: ['claude'],
        dependencies: [], defaultInstall: true, cost: 'light', stability: 'stable',
      }],
    }));
    write('manifests/install-profiles.json', JSON.stringify({
      version: 1, profiles: { minimal: { description: 'Fixture', modules: ['fixture-core'] } },
    }));
    const block = ['````markdown', '```', originalLink, '````'].join('\n');
    write(sourceRel, `${block}\n${originalLink}\n`);
    write('rules/common/style.md', '# Style guide\n');
    const plan = createManifestInstallPlan({ sourceRoot, homeDir, target: 'claude', moduleIds: ['fixture-core'], env: {} });
    applyInstallPlan(plan);
    assert.strictEqual(fs.readFileSync(path.join(plan.targetRoot, sourceRel), 'utf8'), `${block}\n${installedLink}\n`);
    assert.strictEqual(fs.readFileSync(path.join(plan.targetRoot, 'rules/ecc/common/style.md'), 'utf8'), '# Style guide\n');
    assert.ok(fs.existsSync(plan.installStatePath));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
