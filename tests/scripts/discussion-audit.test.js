/**
 * Tests for scripts/discussion-audit.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'discussion-audit.js');
const {
  DISCUSSION_ENABLED_QUERY,
  DISCUSSION_QUERY
} = require(path.join(__dirname, '..', '..', 'scripts', 'lib', 'github-discussions'));

function createTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanup(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
}

function discussionGhKey(owner, name, first = 100) {
  return `api graphql -f owner=${owner} -f name=${name} -F first=${first} -f query=${DISCUSSION_QUERY}`;
}

function discussionEnabledGhKey(owner, name) {
  return `api graphql -f owner=${owner} -f name=${name} -f query=${DISCUSSION_ENABLED_QUERY}`;
}

function writeGhShim(rootDir, responses) {
  const shimPath = path.join(rootDir, 'gh-shim.js');
  fs.writeFileSync(shimPath, `
const responses = ${JSON.stringify(responses)};
const args = process.argv.slice(2);
const key = args.join(' ');
if (process.env.GITHUB_TOKEN) {
  console.error('GITHUB_TOKEN should be unset by default');
  process.exit(42);
}
if (!Object.prototype.hasOwnProperty.call(responses, key)) {
  console.error('Unexpected gh args: ' + key);
  process.exit(3);
}
process.stdout.write(JSON.stringify(responses[key]));
`);
  return shimPath;
}

function run(args = [], options = {}) {
  const env = {
    ...process.env,
    ...(options.env || {})
  };

  return execFileSync('node', [SCRIPT, ...args], {
    cwd: options.cwd || path.join(__dirname, '..', '..'),
    env,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 10000
  });
}

function runProcess(args = [], options = {}) {
  const env = {
    ...process.env,
    ...(options.env || {})
  };

  return spawnSync('node', [SCRIPT, ...args], {
    cwd: options.cwd || path.join(__dirname, '..', '..'),
    env,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 10000
  });
}

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS ${name}`);
    return true;
  } catch (error) {
    console.log(`  FAIL ${name}`);
    console.log(`    Error: ${error.message}`);
    return false;
  }
}

function runTests() {
  console.log('\n=== Testing discussion-audit.js ===\n');

  let passed = 0;
  let failed = 0;

  if (test('passes when discussions have maintainer touch and accepted answers', () => {
    const rootDir = createTempDir('discussion-audit-pass-');

    try {
      const shimPath = writeGhShim(rootDir, {
        [discussionEnabledGhKey('affaan-m', 'ECC')]: {
          data: { repository: { hasDiscussionsEnabled: true } }
        },
        [discussionGhKey('affaan-m', 'ECC')]: {
          data: {
            repository: {
              hasDiscussionsEnabled: true,
              discussions: {
                totalCount: 2,
                nodes: [
                  {
                    number: 1923,
                    title: 'Does Continuous Learning v2 work with VS Code Claude Code?',
                    url: 'https://github.com/example/discussions/1923',
                    updatedAt: '2026-05-15T19:08:52Z',
                    authorAssociation: 'NONE',
                    category: { name: 'Q&A', isAnswerable: true },
                    answer: { url: 'https://github.com/example/discussions/1923#discussioncomment-1', authorAssociation: 'OWNER' },
                    comments: { nodes: [] }
                  },
                  {
                    number: 73,
                    title: 'Compacting during workflow',
                    url: 'https://github.com/example/discussions/73',
                    updatedAt: '2026-05-15T00:00:00Z',
                    authorAssociation: 'NONE',
                    category: { name: 'General', isAnswerable: false },
                    answer: null,
                    comments: { nodes: [{ authorAssociation: 'MEMBER' }] }
                  }
                ]
              }
            }
          }
        }
      });

      const parsed = JSON.parse(run([
        '--json',
        '--repo',
        'affaan-m/ECC'
      ], {
        cwd: rootDir,
        env: {
          ECC_GH_SHIM: shimPath,
          GITHUB_TOKEN: 'must-be-removed'
        }
      }));

      assert.strictEqual(parsed.ready, true);
      assert.strictEqual(parsed.totals.needingMaintainerTouch, 0);
      assert.strictEqual(parsed.totals.missingAcceptedAnswer, 0);
      assert.ok(parsed.checks.some(check => check.id === 'discussion-accepted-answers' && check.status === 'pass'));
    } finally {
      cleanup(rootDir);
    }
  })) passed++; else failed++;

  if (test('fails when Q&A lacks accepted answer and maintainer touch', () => {
    const rootDir = createTempDir('discussion-audit-fail-');

    try {
      const shimPath = writeGhShim(rootDir, {
        [discussionEnabledGhKey('affaan-m', 'ECC')]: {
          data: { repository: { hasDiscussionsEnabled: true } }
        },
        [discussionGhKey('affaan-m', 'ECC')]: {
          data: {
            repository: {
              hasDiscussionsEnabled: true,
              discussions: {
                totalCount: 1,
                nodes: [
                  {
                    number: 1239,
                    title: 'Losing context',
                    url: 'https://github.com/example/discussions/1239',
                    updatedAt: '2026-05-15T00:00:00Z',
                    authorAssociation: 'NONE',
                    category: { name: 'Q&A', isAnswerable: true },
                    answer: null,
                    comments: { nodes: [] }
                  }
                ]
              }
            }
          }
        }
      });

      const result = runProcess([
        '--json',
        '--repo',
        'affaan-m/ECC',
        '--exit-code'
      ], {
        cwd: rootDir,
        env: { ECC_GH_SHIM: shimPath }
      });
      const parsed = JSON.parse(result.stdout);

      assert.strictEqual(result.status, 2);
      assert.strictEqual(parsed.ready, false);
      assert.strictEqual(parsed.totals.needingMaintainerTouch, 1);
      assert.strictEqual(parsed.totals.missingAcceptedAnswer, 1);
      assert.ok(parsed.top_actions.some(action => action.id === 'discussion-maintainer-touch'));
      assert.ok(parsed.top_actions.some(action => action.id === 'discussion-accepted-answers'));
    } finally {
      cleanup(rootDir);
    }
  })) passed++; else failed++;

  if (test('writes markdown output as a durable operator artifact', () => {
    const rootDir = createTempDir('discussion-audit-markdown-');
    const outputPath = path.join(rootDir, 'artifacts', 'discussion-audit.md');

    try {
      const shimPath = writeGhShim(rootDir, {
        [discussionEnabledGhKey('affaan-m', 'ECC')]: {
          data: { repository: { hasDiscussionsEnabled: true } }
        },
        [discussionGhKey('affaan-m', 'ECC')]: {
          data: {
            repository: {
              hasDiscussionsEnabled: true,
              discussions: { totalCount: 0, nodes: [] }
            }
          }
        }
      });
      const stdout = run([
        '--markdown',
        '--write',
        outputPath,
        '--repo',
        'affaan-m/ECC'
      ], {
        cwd: rootDir,
        env: { ECC_GH_SHIM: shimPath }
      });
      const written = fs.readFileSync(outputPath, 'utf8');

      assert.strictEqual(stdout, written);
      assert.ok(written.includes('# ECC Discussion Audit'));
      assert.ok(written.includes('Answerable discussions missing accepted answer'));
      assert.ok(written.includes('- none'));
    } finally {
      cleanup(rootDir);
    }
  })) passed++; else failed++;

  if (test('passes without heavy query when discussions are disabled', () => {
    const rootDir = createTempDir('discussion-audit-disabled-');

    try {
      const shimPath = writeGhShim(rootDir, {
        [discussionEnabledGhKey('ECC-Tools', 'ECC-website')]: {
          data: { repository: { hasDiscussionsEnabled: false } }
        }
      });

      const parsed = JSON.parse(run([
        '--json',
        '--repo',
        'ECC-Tools/ECC-website'
      ], {
        cwd: rootDir,
        env: { ECC_GH_SHIM: shimPath }
      }));

      assert.strictEqual(parsed.ready, true);
      assert.strictEqual(parsed.repos[0].discussions.enabled, false);
      assert.strictEqual(parsed.totals.totalDiscussions, 0);
      assert.strictEqual(parsed.totals.errors, 0);
    } finally {
      cleanup(rootDir);
    }
  })) passed++; else failed++;

  if (test('cli help and invalid args exit cleanly', () => {
    const help = runProcess(['--help']);
    assert.strictEqual(help.status, 0);
    assert.ok(help.stdout.includes('Usage: node scripts/discussion-audit.js'));

    const invalid = runProcess(['--format', 'xml']);
    assert.strictEqual(invalid.status, 1);
    assert.ok(invalid.stderr.includes('Invalid format'));
  })) passed++; else failed++;

  console.log(`\nPassed: ${passed}`);
  console.log(`Failed: ${failed}`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
