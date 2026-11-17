'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

const SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'discussion-audit.js');
const page = (nodes, cursor = null) => ({
  nodes, pageInfo: { hasNextPage: cursor !== null, endCursor: cursor },
});
const comment = (id, association = 'NONE', replies = page([])) => ({ id, authorAssociation: association, replies });
const discussion = comments => ({
  id: 'discussion-1', number: 1, title: 'A community question',
  url: 'https://github.com/example/project/discussions/1', updatedAt: '2026-11-17T00:00:00Z',
  authorAssociation: 'NONE', category: { name: 'General', isAnswerable: false }, answer: null, comments,
});
const communityComments = count => Array.from({ length: count }, (_, index) => comment(`comment-${index}`));

function audit(discussions, pages = {}, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-discussion-pages-'));
  const trace = path.join(dir, 'trace.jsonl');
  const fixture = path.join(dir, 'fixture.json');
  const shim = path.join(dir, 'gh-shim.js');
  try {
    fs.writeFileSync(fixture, JSON.stringify({ discussions, pages, ...options }));
    fs.writeFileSync(shim, `
      const fs = require('node:fs');
      const config = JSON.parse(fs.readFileSync(process.env.ECC_DISCUSSION_FIXTURE, 'utf8'));
      const args = process.argv.slice(2);
      const field = name => args.find(arg => arg.startsWith(name + '='))?.slice(name.length + 1);
      const query = field('query') || '';
      const id = field('id');
      const after = field('after');
      fs.appendFileSync(process.env.ECC_DISCUSSION_TRACE, JSON.stringify({ id, after, query }) + '\\n');
      if (process.env.GITHUB_TOKEN) throw new Error('Token must remain excluded');
      let response;
      if (query.includes('discussions(first:')) {
        const nodes = config.discussions;
        // Return only fields requested by the actual client query.
        if (!query.includes('replies(first:')) {
          for (const node of nodes) for (const item of node.comments.nodes) delete item.replies;
        }
        if (!query.includes('pageInfo')) {
          for (const node of nodes) delete node.comments.pageInfo;
        }
        response = { data: { repository: {
          hasDiscussionsEnabled: true, discussions: { totalCount: nodes.length, nodes },
        } } };
      } else if (query.includes('node(id:')) {
        if (!query.includes('pageInfo')) throw new Error('Pagination must request its next cursor');
        if (config.unendingPages) {
          response = { data: { node: { comments: {
            nodes: [], pageInfo: { hasNextPage: true, endCursor: String(Number(after) + 1) },
          } } } };
        } else {
          response = config.pages[id + ':' + after];
          if (!response) throw new Error('Unexpected additional page: ' + id + ':' + after);
        }
      } else if (query.includes('hasDiscussionsEnabled')) {
        response = { data: { repository: { hasDiscussionsEnabled: true } } };
      } else {
        throw new Error('Unexpected query');
      }
      process.stdout.write(JSON.stringify(response));
    `);
    const result = spawnSync(process.execPath, [SCRIPT, '--repo', 'example/project', '--json', '--exit-code'], {
      cwd: dir, encoding: 'utf8', timeout: 30000, windowsHide: true,
      env: {
        ...process.env, ECC_GH_SHIM: shim, ECC_DISCUSSION_FIXTURE: fixture,
        ECC_DISCUSSION_TRACE: trace, GITHUB_TOKEN: 'synthetic-token-must-be-removed',
      },
    });
    assert.ifError(result.error);
    const calls = fs.readFileSync(trace, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    return { code: result.status, report: JSON.parse(result.stdout), calls, stderr: result.stderr };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function assertHandled(result, calls) {
  assert.strictEqual(result.code, 0, result.stderr);
  assert.strictEqual(result.report.ready, true);
  assert.strictEqual(result.report.totals.needingMaintainerTouch, 0);
  assert.strictEqual(result.report.totals.errors, 0);
  assert.strictEqual(result.calls.length, calls);
}

test('a maintainer reply counts as engagement in the actual audit CLI', () => {
  for (const association of ['OWNER', 'MEMBER', 'COLLABORATOR']) {
    const thread = discussion(page([comment('comment-1', 'NONE', page([{ authorAssociation: association }]))]));
    assertHandled(audit([thread]), 2);
  }
});

test('top-level comment pagination discovers a maintainer after the first twenty comments', () => {
  const thread = discussion(page(communityComments(20), 'comments-next'));
  const result = audit([thread], {
    'discussion-1:comments-next': { data: { node: { comments: page([comment('later', 'OWNER')], 'unused-next') } } },
  });
  assertHandled(result, 3);
  assert.strictEqual(result.calls[2].id, 'discussion-1');
  assert.strictEqual(result.calls[2].after, 'comments-next');
});

test('reply pagination discovers a maintainer after the first twenty replies', () => {
  const thread = discussion(page([comment('comment-1', 'NONE', page(communityComments(20), 'replies-next'))]));
  const result = audit([thread], {
    'comment-1:replies-next': { data: { node: { replies: page([{ authorAssociation: 'MEMBER' }], 'unused-next') } } },
  });
  assertHandled(result, 3);
  assert.strictEqual(result.calls[2].id, 'comment-1');
});

test('later comment pages include their replies before declaring a discussion unattended', () => {
  const thread = discussion(page(communityComments(20), 'comments-next'));
  assertHandled(audit([thread], {
    'discussion-1:comments-next': { data: { node: { comments: page([
      comment('later', 'NONE', page([{ authorAssociation: 'COLLABORATOR' }])),
    ]) } } },
  }), 3);
});

test('an already visible maintainer prevents unnecessary pagination', () => {
  const original = discussion(page([
    comment('waiting', 'NONE', page([], 'unread-replies')),
    comment('handled', 'OWNER'),
  ], 'unread-comments'));
  assertHandled(audit([original]), 2);
  assertHandled(audit([{ ...original, authorAssociation: 'MEMBER', comments: page([], 'unread-comments') }]), 2);
  assertHandled(audit([{ ...original, answer: { authorAssociation: 'COLLABORATOR' }, comments: page([], 'unread-comments') }]), 2);
});

test('a fully scanned community-only discussion remains unattended and retains answer checks', () => {
  const thread = {
    ...discussion(page([comment('comment-1', 'NONE', page([], 'replies-next'))], 'comments-next')),
    category: { name: 'Q&A', isAnswerable: true },
  };
  const result = audit([thread], {
    'comment-1:replies-next': { data: { node: { replies: page([{ authorAssociation: 'CONTRIBUTOR' }]) } } },
    'discussion-1:comments-next': { data: { node: { comments: page([comment('later', 'FIRST_TIME_CONTRIBUTOR')]) } } },
  });
  assert.strictEqual(result.code, 2);
  assert.strictEqual(result.report.totals.errors, 0);
  assert.strictEqual(result.report.totals.needingMaintainerTouch, 1);
  assert.strictEqual(result.report.totals.missingAcceptedAnswer, 1);
  assert.strictEqual(result.calls.length, 4);
});

test('incomplete, failed, and repeated-cursor pages report fetch errors', () => {
  const scenarios = [
    { thread: discussion({ nodes: [], pageInfo: { hasNextPage: true, endCursor: null } }), pages: {} },
    { thread: discussion(page([], 'next')), pages: { 'discussion-1:next': { errors: [{ message: 'synthetic query error' }] } } },
    { thread: discussion(page([], 'next')), pages: { 'discussion-1:next': { data: { node: null } } } },
    { thread: discussion(page([], 'next')), pages: { 'discussion-1:next': { data: { node: { comments: page([], 'next') } } } } },
  ];
  for (const { thread, pages } of scenarios) {
    const result = audit([thread], pages);
    assert.strictEqual(result.code, 2);
    assert.strictEqual(result.report.ready, false);
    assert.strictEqual(result.report.totals.errors, 1);
    assert.ok(result.report.checks.some(check => check.id === 'discussion-fetch' && check.status === 'fail'));
  }
});

test('an unending sequence of distinct cursors is stopped by the per-repository page budget', { timeout: 40000 }, () => {
  const result = audit([discussion(page([], '0'))], {}, { unendingPages: true });
  assert.strictEqual(result.code, 2);
  assert.strictEqual(result.report.totals.errors, 1);
  assert.match(result.report.repos[0].error, /pagination.*100|100.*pages/i);
  assert.strictEqual(result.calls.length, 102);
});
