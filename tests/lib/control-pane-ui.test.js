/**
 * Tests for the control-pane HTML client in scripts/lib/control-pane/ui.js.
 *
 * The generated page polls /api/snapshot every 15s. Refresh failures must
 * mark the board stale and surface the error — not discard it in an empty catch.
 */

'use strict';

const assert = require('assert');
const vm = require('vm');
const { renderControlPaneHtml } = require('../../scripts/lib/control-pane/ui');

function snapshotPayload(overrides) {
  return {
    knowledge: { query: '', entityCount: 0, results: [] },
    database: { exists: true },
    dbPath: '/tmp/ecc2.db',
    execution: { allowActions: false },
    summary: { totalSessions: 1, runningSessions: 0, unreadMessages: 0, totalTokens: 0 },
    sessions: [],
    workItems: { totalCount: 0, openCount: 0, blockedCount: 0, doneCount: 0, kanban: {}, items: [] },
    connectors: [],
    actions: [],
    ...overrides
  };
}

function jsonResponse(ok, data, status, statusText) {
  return {
    ok,
    status: status === null || status === undefined ? (ok ? 200 : 500) : status,
    statusText: statusText || (ok ? 'OK' : 'Internal Server Error'),
    json: async () => data
  };
}

function summaryWithSessions(totalSessions) {
  return { totalSessions, runningSessions: 0, unreadMessages: 0, totalTokens: 0 };
}

function createDeferredFetch() {
  const pending = [];
  const fetchImpl = () => new Promise((resolve, reject) => {
    pending.push({ resolve, reject });
  });
  return { pending, fetchImpl };
}

function createClassList(owner) {
  const tokens = new Set();
  const sync = () => {
    owner.className = [...tokens].join(' ');
  };
  return {
    add(...names) {
      names.forEach(name => tokens.add(name));
      sync();
    },
    remove(...names) {
      names.forEach(name => tokens.delete(name));
      sync();
    },
    contains(name) {
      return tokens.has(name);
    }
  };
}

function createElement(id) {
  const el = {
    id,
    hidden: id === 'app' || id === 'freshness',
    textContent: '',
    innerHTML: '',
    value: '',
    className: '',
    style: {},
    dataset: {},
    listeners: {},
    addEventListener(type, fn) {
      el.listeners[type] = el.listeners[type] || [];
      el.listeners[type].push(fn);
    },
    click() {
      (el.listeners.click || []).forEach(fn => fn({ preventDefault() {} }));
    }
  };
  el.classList = createClassList(el);
  return el;
}

function extractScript(html) {
  const start = html.indexOf('<script>');
  const end = html.indexOf('</script>', start);
  assert.ok(start >= 0 && end > start, 'control-pane HTML must include an inline script');
  return html.slice(start + '<script>'.length, end);
}

async function flush() {
  for (let i = 0; i < 8; i += 1) {
    await new Promise(resolve => setImmediate(resolve));
  }
}

function mountControlPane(fetchImpl) {
  const html = renderControlPaneHtml();
  const ids = [
    'query-form', 'query', 'refresh', 'metrics', 'db-path', 'sessions',
    'work-item-count', 'work-items', 'knowledge-count', 'knowledge',
    'connector-count', 'connectors', 'action-status', 'actions', 'run-output',
    'app', 'freshness'
  ];
  const elements = Object.fromEntries(ids.map(id => [id, createElement(id)]));
  const shell = createElement('shell');
  shell.classList.add('shell');
  const body = createElement('body');
  const intervals = [];

  const document = {
    hidden: false,
    body,
    querySelector(selector) {
      if (selector === '.shell') return shell;
      if (selector.startsWith('#')) return elements[selector.slice(1)] || null;
      return null;
    },
    querySelectorAll() {
      return [];
    }
  };

  vm.runInNewContext(extractScript(html), {
    document,
    window: {
      location: { href: 'http://127.0.0.1:8765/' },
      addEventListener() {},
      prompt() { return null; }
    },
    fetch: (...args) => fetchImpl(...args),
    setInterval(fn, ms) {
      intervals.push({ fn, ms });
      return intervals.length;
    },
    console: {
      log() {},
      warn() {},
      error() {},
      info() {}
    },
    URL,
    Intl,
    Date,
    Error,
    TypeError,
    encodeURIComponent
  });

  return { html, elements, shell, body, intervals, document };
}

async function test(name, fn) {
  try {
    await fn();
    console.log(`  PASS ${name}`);
    return true;
  } catch (error) {
    console.log(`  FAIL ${name}`);
    console.log(`    Error: ${error.message}`);
    return false;
  }
}

async function runTests() {
  console.log('\n=== Testing control-pane UI refresh errors ===\n');

  let passed = 0;
  let failed = 0;

  if (await test('generated HTML includes a freshness badge and stale styles', async () => {
    const html = renderControlPaneHtml();
    assert.ok(html.includes('id="freshness"'), 'header must expose a freshness badge');
    assert.match(html, /\.is-stale/, 'stylesheet must define a stale/dimmed state');
    assert.match(html, /setInterval\(\(\) => \{/);
    assert.doesNotMatch(
      html,
      /load\(\)\.catch\(\(\) => \{\}\)/,
      'auto-refresh must not swallow errors in an empty catch'
    );
  })) passed++; else failed++;

  if (await test('interval refresh failure marks the pane stale and surfaces the error', async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      if (calls === 1) return jsonResponse(true, snapshotPayload());
      throw new TypeError('Failed to fetch');
    };

    const { elements, body, intervals } = mountControlPane(fetchImpl);
    await flush();

    assert.strictEqual(calls, 1, 'initial load should fetch once');
    assert.strictEqual(elements.app.hidden, true, 'successful load clears the error box');
    assert.ok(!body.classList.contains('is-stale'), 'successful load is not stale');
    assert.strictEqual(elements.freshness.hidden, true, 'freshness badge stays hidden while live');
    assert.match(elements.metrics.innerHTML, /Sessions/, 'initial snapshot remains on screen');

    assert.ok(intervals.length >= 1, 'auto-refresh interval is registered');
    assert.strictEqual(intervals[0].ms, 15000);

    await intervals[0].fn();
    await flush();

    assert.strictEqual(calls, 2, 'interval should attempt another fetch');
    assert.strictEqual(elements.app.hidden, false, 'refresh failure must surface via showError');
    assert.match(elements.app.textContent, /Failed to fetch/);
    assert.ok(body.classList.contains('is-stale'), 'refresh failure must dim/mark the pane stale');
    assert.strictEqual(elements.freshness.hidden, false, 'stale badge must be visible');
    assert.match(elements.freshness.textContent, /stale/i);
    assert.match(elements.freshness.textContent, /last/i);
    assert.match(elements.metrics.innerHTML, /Sessions/, 'last successful snapshot stays visible');
  })) passed++; else failed++;

  if (await test('successful load after a refresh failure clears the stale mark', async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      if (calls === 2) throw new TypeError('Failed to fetch');
      return jsonResponse(true, snapshotPayload({
        summary: { totalSessions: calls === 1 ? 1 : 4, runningSessions: 0, unreadMessages: 0, totalTokens: 0 }
      }));
    };

    const { elements, body, intervals } = mountControlPane(fetchImpl);
    await flush();
    await intervals[0].fn();
    await flush();

    assert.ok(body.classList.contains('is-stale'));
    assert.strictEqual(elements.app.hidden, false);

    await intervals[0].fn();
    await flush();

    assert.strictEqual(calls, 3);
    assert.ok(!body.classList.contains('is-stale'), 'next successful load clears stale');
    assert.strictEqual(elements.freshness.hidden, true, 'stale badge hides after recovery');
    assert.strictEqual(elements.app.hidden, true, 'error box clears after recovery');
    assert.match(elements.metrics.innerHTML, />4</, 'recovered load renders the new snapshot');
  })) passed++; else failed++;

  if (await test('initial load failure still uses showError and does not throw from the interval catch', async () => {
    const fetchImpl = async () => {
      throw new TypeError('Failed to fetch');
    };
    const { elements, body, intervals } = mountControlPane(fetchImpl);
    await flush();

    assert.strictEqual(elements.app.hidden, false);
    assert.match(elements.app.textContent, /Failed to fetch/);
    assert.ok(!body.classList.contains('is-stale'), 'no last-success snapshot means no stale badge yet');

    await intervals[0].fn();
    await flush();
    assert.strictEqual(elements.app.hidden, false, 'interval catch must keep surfacing the error');
  })) passed++; else failed++;

  if (await test('success timestamp is reassigned instead of mutated', async () => {
    const html = renderControlPaneHtml();
    assert.match(html, /let state = \{ query: '', lastSuccessAt: null \}/);
    assert.doesNotMatch(html, /state\.lastSuccessAt\s*=/);
    assert.match(html, /state = \{ \.\.\.state, lastSuccessAt: Date\.now\(\) \}/);
  })) passed++; else failed++;

  if (await test('a superseded in-flight refresh failure does not mark the live pane stale', async () => {
    const { pending, fetchImpl } = createDeferredFetch();
    const { elements, body } = mountControlPane(fetchImpl);

    pending[0].resolve(jsonResponse(true, snapshotPayload({ summary: summaryWithSessions(1) })));
    await flush();
    assert.ok(!body.classList.contains('is-stale'));

    elements.refresh.click();
    elements.refresh.click();
    assert.strictEqual(pending.length, 3, 'initial load plus two overlapping refreshes');

    pending[1].reject(new TypeError('Failed to fetch'));
    await flush();

    assert.ok(!body.classList.contains('is-stale'), 'older failure must not stale the pane while a newer refresh is in flight');
    assert.strictEqual(elements.app.hidden, true, 'older failure must not surface over the newer in-flight refresh');
    assert.match(elements.metrics.innerHTML, />1</);

    pending[2].resolve(jsonResponse(true, snapshotPayload({ summary: summaryWithSessions(4) })));
    await flush();

    assert.ok(!body.classList.contains('is-stale'));
    assert.strictEqual(elements.app.hidden, true);
    assert.match(elements.metrics.innerHTML, />4</);
  })) passed++; else failed++;

  if (await test('a late older snapshot does not overwrite a newer snapshot', async () => {
    const { pending, fetchImpl } = createDeferredFetch();
    const { elements, body } = mountControlPane(fetchImpl);

    pending[0].resolve(jsonResponse(true, snapshotPayload({ summary: summaryWithSessions(1) })));
    await flush();

    elements.refresh.click();
    elements.refresh.click();
    pending[2].resolve(jsonResponse(true, snapshotPayload({ summary: summaryWithSessions(4) })));
    await flush();

    assert.match(elements.metrics.innerHTML, />4</);
    assert.ok(!body.classList.contains('is-stale'));
    const metricsAfterNewer = elements.metrics.innerHTML;

    pending[1].resolve(jsonResponse(true, snapshotPayload({ summary: summaryWithSessions(9) })));
    await flush();

    assert.strictEqual(elements.metrics.innerHTML, metricsAfterNewer, 'older snapshot must not replace the newer render');
    assert.doesNotMatch(elements.metrics.innerHTML, />9</);
    assert.ok(!body.classList.contains('is-stale'));
    assert.strictEqual(elements.freshness.hidden, true);
    assert.strictEqual(elements.app.hidden, true);
  })) passed++; else failed++;

  if (await test('a late older success does not clear a newer refresh error', async () => {
    const { pending, fetchImpl } = createDeferredFetch();
    const { elements, body } = mountControlPane(fetchImpl);

    pending[0].resolve(jsonResponse(true, snapshotPayload({ summary: summaryWithSessions(1) })));
    await flush();

    elements.refresh.click();
    elements.refresh.click();
    pending[2].reject(new TypeError('Failed to fetch'));
    await flush();

    assert.ok(body.classList.contains('is-stale'));
    assert.strictEqual(elements.app.hidden, false);
    assert.match(elements.app.textContent, /Failed to fetch/);
    assert.match(elements.metrics.innerHTML, />1</);
    const freshness = elements.freshness.textContent;
    assert.match(freshness, /stale/i);

    pending[1].resolve(jsonResponse(true, snapshotPayload({ summary: summaryWithSessions(9) })));
    await flush();

    assert.ok(body.classList.contains('is-stale'), 'older success must not clear the newer stale mark');
    assert.strictEqual(elements.app.hidden, false, 'older success must not clear the newer error');
    assert.match(elements.app.textContent, /Failed to fetch/);
    assert.strictEqual(elements.freshness.textContent, freshness, 'older success must not refresh the last-live timestamp');
    assert.match(elements.metrics.innerHTML, />1</);
    assert.doesNotMatch(elements.metrics.innerHTML, />9</);
  })) passed++; else failed++;

  if (await test('a late older failure does not mark a newer snapshot stale', async () => {
    const { pending, fetchImpl } = createDeferredFetch();
    const { elements, body } = mountControlPane(fetchImpl);

    pending[0].resolve(jsonResponse(true, snapshotPayload({ summary: summaryWithSessions(1) })));
    await flush();

    elements.refresh.click();
    elements.refresh.click();
    pending[2].resolve(jsonResponse(true, snapshotPayload({ summary: summaryWithSessions(4) })));
    await flush();

    assert.match(elements.metrics.innerHTML, />4</);
    assert.ok(!body.classList.contains('is-stale'));

    pending[1].reject(new TypeError('Failed to fetch'));
    await flush();

    assert.ok(!body.classList.contains('is-stale'), 'older failure must not mark the newer snapshot stale');
    assert.strictEqual(elements.app.hidden, true, 'older failure must not surface an error over the newer snapshot');
    assert.strictEqual(elements.freshness.hidden, true);
    assert.match(elements.metrics.innerHTML, />4</);
    assert.doesNotMatch(elements.metrics.innerHTML, />1</);
  })) passed++; else failed++;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
