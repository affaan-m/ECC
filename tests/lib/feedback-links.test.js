'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { FEEDBACK_ROUTES, exitFeedbackLines, getFeedbackPayload, problemReportLines } = require('../../scripts/lib/feedback-links');

const ISSUE_TEMPLATE_DIR = path.join(__dirname, '..', '..', '.github', 'ISSUE_TEMPLATE');
const ISSUES_NEW_URL = 'https://github.com/affaan-m/ECC/issues/new';

test('every route is a new-issue URL on the ECC repository with only a template query', () => {
  assert.deepEqual(Object.keys(FEEDBACK_ROUTES).sort(), ['feature', 'feedback', 'problem']);
  for (const [name, route] of Object.entries(FEEDBACK_ROUTES)) {
    const parsed = new URL(route);
    assert.equal(parsed.protocol, 'https:', `${name} protocol`);
    assert.equal(parsed.hostname, 'github.com', `${name} host`);
    assert.equal(parsed.pathname, '/affaan-m/ECC/issues/new', `${name} path`);
    assert.equal(parsed.username, '', `${name} username`);
    assert.equal(parsed.password, '', `${name} password`);
    assert.equal(parsed.hash, '', `${name} hash`);
    assert.deepEqual([...parsed.searchParams.keys()], ['template'], `${name} query keys`);
  }
});

test('every route points at an issue template that exists in the repository', () => {
  for (const [name, route] of Object.entries(FEEDBACK_ROUTES)) {
    const template = new URL(route).searchParams.get('template');
    assert.match(template, /^[a-z-]+\.yml$/, `${name} template name`);
    assert.ok(fs.existsSync(path.join(ISSUE_TEMPLATE_DIR, template)), `${name} route names ${template}, which is not in .github/ISSUE_TEMPLATE`);
  }
});

test('each route maps to the intended template', () => {
  assert.equal(FEEDBACK_ROUTES.problem, `${ISSUES_NEW_URL}?template=install-problem.yml`);
  assert.equal(FEEDBACK_ROUTES.feedback, `${ISSUES_NEW_URL}?template=quick-feedback.yml`);
  assert.equal(FEEDBACK_ROUTES.feature, `${ISSUES_NEW_URL}?template=feature-request.yml`);
});

test('the route table is frozen', () => {
  assert.ok(Object.isFrozen(FEEDBACK_ROUTES));
  assert.throws(() => {
    FEEDBACK_ROUTES.problem = 'https://example.invalid/';
  }, TypeError);
  assert.throws(() => {
    FEEDBACK_ROUTES.extra = 'https://example.invalid/';
  }, TypeError);
  assert.equal(FEEDBACK_ROUTES.problem, `${ISSUES_NEW_URL}?template=install-problem.yml`);
});

test('the payload declares the public schema and no diagnostics upload', () => {
  assert.deepEqual(getFeedbackPayload(), {
    schemaVersion: 'ecc.feedback.v1',
    privacy: 'public-github',
    diagnosticsUploaded: false,
    routes: { ...FEEDBACK_ROUTES }
  });
});

test('the payload survives a JSON round trip unchanged', () => {
  const payload = getFeedbackPayload();
  assert.deepEqual(JSON.parse(JSON.stringify(payload)), payload);
});

test('each payload is a fresh copy so a caller cannot alter the route table', () => {
  const first = getFeedbackPayload();
  const second = getFeedbackPayload();
  assert.notEqual(first, second);
  assert.notEqual(first.routes, second.routes);
  assert.deepEqual(first, second);

  first.routes.problem = 'https://example.invalid/';
  first.diagnosticsUploaded = true;
  assert.equal(getFeedbackPayload().routes.problem, FEEDBACK_ROUTES.problem);
  assert.equal(getFeedbackPayload().diagnosticsUploaded, false);
});

test('problem report lines carry the problem route and the redaction warning', () => {
  const lines = problemReportLines();
  assert.equal(lines.length, 3);
  assert.match(lines[0], /public GitHub issue/);
  assert.equal(lines[1], FEEDBACK_ROUTES.problem);
  assert.match(lines[2], /does not upload diagnostics/);
  assert.match(lines[2], /Redact paths, repository names, prompts, and secrets/);
});

test('exit feedback lines carry the feedback route and promise not to block uninstall', () => {
  const lines = exitFeedbackLines();
  assert.equal(lines.length, 3);
  assert.match(lines[0], /public GitHub issue/);
  assert.equal(lines[1], FEEDBACK_ROUTES.feedback);
  assert.match(lines[2], /does not upload diagnostics/);
  assert.match(lines[2], /block uninstall/);
});

test('every line is a single printable line, so join("\\n") output stays well formed', () => {
  for (const line of [...problemReportLines(), ...exitFeedbackLines()]) {
    assert.equal(typeof line, 'string');
    assert.ok(line.length > 0);
    // eslint-disable-next-line no-control-regex
    assert.doesNotMatch(line, /[\x00-\x1f\x7f]/);
    assert.equal(line, line.trim());
  }
});

test('line arrays are rebuilt per call', () => {
  const lines = problemReportLines();
  lines[1] = 'tampered';
  assert.equal(problemReportLines()[1], FEEDBACK_ROUTES.problem);
  assert.notEqual(exitFeedbackLines(), exitFeedbackLines());
});
