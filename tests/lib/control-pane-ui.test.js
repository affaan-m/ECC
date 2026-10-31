/**
 * Tests for the browser script the local ECC2 control pane serves.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { buildControlPaneSnapshot } = require('../../scripts/lib/control-pane/state');
const { renderControlPaneHtml } = require('../../scripts/lib/control-pane/ui');
const pages = new Set();
async function test(name, fn) {
  let failed = false;
  let failure;
  try { await fn(); } catch (error) { failed = true; failure = error; }
  finally {
    for (const page of pages) {
      try { await page.dispose(); } catch (error) {
        if (!failed) { failed = true; failure = error; }
      }
    }
    pages.clear();
  }
  if (failed) {
    console.log(`  FAIL ${name}`);
    console.log(`    Error: ${failure?.message ?? String(failure)}`);
    return false;
  }
  console.log(`  PASS ${name}`);
  return true;
}
function inlineScript(html) {
  const start = html.indexOf('<script>') + '<script>'.length;
  return html.slice(start, html.lastIndexOf('</script>'));
}
// The page's clock. The page shows times with toLocaleString, which follows
// the locale's calendar (a Thai locale counts Buddhist years), so a test
// compares against the same call on this instant.
const NOW = new Date(2026, 8, 25, 10, 30);

class PageDate extends Date {
  constructor(...args) {
    super(...(args.length > 0 ? args : [NOW.getTime()]));
  }
}

// Runs the page script against a stand-in for the few browser APIs it uses:
// elements looked up by selector, fetch, a fixed clock, and a setInterval
// whose callback the test fires itself. While `hold` is set, a fetch waits in
// `pending` until the test settles it, with the page's snapshot or another one.
// With `hold`, the first load is held too. Listeners are kept per element, so a
// test can press a button. Every request is recorded, and `page.script` holds
// the page's own functions, such as the runAction a Run button calls.
function openPage(snapshot, { hold = false } = {}) {
  const elements = new Map();
  const element = selector => {
    if (!elements.has(selector)) {
      elements.set(selector, {
        hidden: selector === '#app',
        textContent: '',
        innerHTML: '',
        value: '',
        dataset: {},
        listeners: {},
        addEventListener(type, listener) {
          this.listeners[type] = listener;
        }
      });
    }
    return elements.get(selector);
  };
  const page = { online: true, hold, pending: [], requests: [], refresh: null, element, now: NOW,
    timers: new Map(), timerCalls: [], clearCalls: [], tick: 0, ignoreAbort: false };
  let timerId = 0;
  class FakeAbortController {
    constructor() {
      const listeners = new Set();
      this.signal = { aborted: false, listeners,
        addEventListener: (_type, callback) => listeners.add(callback),
        removeEventListener: (_type, callback) => listeners.delete(callback) };
      this.aborts = 0;
    }
    abort() {
      this.aborts++;
      if (this.signal.aborted) return;
      this.signal.aborted = true;
      for (const listener of this.signal.listeners) listener();
    }
  }
  page.fireTimer = id => {
    const timer = page.timers.get(id);
    assert.ok(timer, 'Expected a pending deadline');
    page.timers.delete(id);
    timer.callback();
  };
  page.advance = ms => {
    page.tick += ms;
    for (const [id, timer] of [...page.timers]) if (timer.at <= page.tick) page.fireTimer(id);
  };
  page.dispose = async () => {
    await settle();
    for (const request of page.requests) request.reply.fail(new Error('Fixture disposed'));
    await settle();
    const remaining = page.timers.size;
    page.timers.clear();
    assert.strictEqual(remaining, 0, 'Every load must remove its deadline after fixture settlement');
    assert.ok(page.requests.every(request => request.reply.settled), 'All fake requests must settle');
    assert.ok(page.requests.every(request => !request.options.signal || request.options.signal.listeners.size === 0), 'Fake abort listeners must be removed');
  };
  pages.add(page);
  class Clock extends PageDate {
    constructor(...args) {
      super(...(args.length > 0 ? args : [page.now.getTime()]));
    }
  }
  page.script = {
    document: { hidden: false, querySelector: element, querySelectorAll: () => [] },
    window: { location: { href: 'http://127.0.0.1:8765/' } },
    URL,
    Intl,
    Date: Clock,
    console,
    AbortController: FakeAbortController,
    setTimeout: (callback, ms) => {
      const id = ++timerId;
      page.timerCalls.push({ id, ms });
      page.timers.set(id, { callback, at: page.tick + ms });
      return id;
    },
    clearTimeout: id => { page.clearCalls.push(id); page.timers.delete(id); },
    fetch: (url, options = {}) =>
      new Promise((resolve, reject) => {
        let bodyResolve;
        let bodyReject;
        let headers = false;
        let queuedBody;
        const reply = { settled: false, ignoreAbort: page.ignoreAbort };
        const finish = () => {
          reply.settled = true;
          options.signal?.removeEventListener('abort', onAbort);
        };
        const onAbort = () => {
          if (!reply.ignoreAbort) reply.fail(new Error('Synthetic AbortError'));
        };
        reply.respond = response => {
          if (reply.settled || headers) return;
          headers = true;
          resolve({ ...response, json: async () => {
            try { return await response.json(); } finally { finish(); }
          } });
        };
        reply.headers = () => reply.respond({ ok: true, status: 200, json: () => new Promise((accept, refuse) => {
          bodyResolve = accept; bodyReject = refuse;
          if (queuedBody) (queuedBody.error ? refuse : accept)(queuedBody.error || queuedBody.data);
        }) });
        reply.succeed = (data = snapshot) => {
          if (reply.settled) return;
          if (!headers) reply.respond({ ok: true, status: 200, statusText: 'OK', json: async () => data });
          else if (bodyResolve) bodyResolve(data);
          else queuedBody = { data };
        };
        reply.fail = (error = new TypeError('Failed to fetch')) => {
          if (reply.settled) return;
          if (!headers) { finish(); reject(error); }
          else if (bodyReject) bodyReject(error);
          else queuedBody = { error };
        };
        page.requests.push({ url: String(url), options, reply });
        options.signal?.addEventListener('abort', onAbort);
        if (page.hold) page.pending.push(reply);
        else if (page.online) reply.succeed();
        else reply.fail();
      }),
    setInterval: (callback, ms) => {
      page.intervalMs = ms;
      page.refresh = callback;
    }
  };
  vm.createContext(page.script);
  vm.runInContext(inlineScript(renderControlPaneHtml()), page.script);
  page.state = () => JSON.parse(vm.runInContext('JSON.stringify({ loadedAt: loadedAt && loadedAt.getTime(), shownLoad, loadsStarted, newestFinished, query: state.query, shownQuery: state.shownQuery, allowActions: state.allowActions, active: typeof snapshotsInFlight === "undefined" ? null : snapshotsInFlight })', page.script));
  return page;
}

const settle = () => new Promise(resolve => setImmediate(resolve));

async function isolatedSnapshot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-control-pane-ui-'));
  try {
    // Explicit config and both database paths keep this UI test away from
    // user config, parent-directory config, and the default state store.
    return JSON.parse(JSON.stringify(await buildControlPaneSnapshot({
      config: {},
      dbPath: path.join(root, 'missing-ecc2.db'),
      stateDbPath: path.join(root, 'missing-state.db'),
      repoRoot: root,
      cwd: root,
      env: { HOME: root, USERPROFILE: root },
      query: ''
    })));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function displayedBoard(page) {
  const fields = {
    '#query': 'value',
    '#db-path': 'textContent',
    '#action-status': 'textContent',
    '#metrics': 'innerHTML',
    '#sessions': 'innerHTML',
    '#work-item-count': 'textContent',
    '#work-items': 'innerHTML',
    '#knowledge-count': 'textContent',
    '#knowledge': 'innerHTML',
    '#connector-count': 'textContent',
    '#connectors': 'innerHTML',
    '#actions': 'innerHTML'
  };
  return Object.fromEntries(Object.entries(fields).map(([selector, field]) => [selector, page.element(selector)[field]]));
}

async function runTests() {
  console.log('\n=== Testing control-pane UI ===\n');

  let passed = 0;
  let failed = 0;

  const snapshot = await isolatedSnapshot();
  // The original ordering cases below explicitly dispatch load(true) where
  // overlap is intentional. Automatic interval coalescing is tested separately.

  if (
    await test('a failed live refresh is reported, and cleared by the next one that succeeds', async () => {
      const page = openPage(snapshot);
      await settle();
      assert.strictEqual(page.element('#app').hidden, true, 'the first load succeeds');

      page.online = false;
      page.refresh();
      await settle();
      const box = page.element('#app');
      assert.strictEqual(box.hidden, false, 'the failure is shown');
      assert.match(box.textContent, /Live refresh failed\. The data below is from /);
      assert.ok(box.textContent.includes(NOW.toLocaleString()), 'the time of the data includes its date');
      assert.match(box.textContent, /Failed to fetch/);

      page.online = true;
      page.refresh();
      await settle();
      assert.strictEqual(page.element('#app').hidden, true, 'a successful refresh clears it');
    })
  )
    passed++;
  else failed++;

  if (
    await test('a refresh that fails after a newer load succeeded is not reported', async () => {
      const page = openPage(snapshot);
      await settle();

      page.hold = true;
      page.script.load(true);
      page.hold = false;
      page.script.load(true);
      await settle();
      page.pending[0].fail();
      await settle();
      assert.strictEqual(page.element('#app').hidden, true, 'the newer data is not marked as stale');
    })
  )
    passed++;
  else failed++;

  if (
    await test('a failed refresh stays off the board while newer data is shown and another refresh runs', async () => {
      const page = openPage(snapshot);
      await settle();

      page.hold = true;
      page.script.load(true);
      page.script.load(true);
      page.script.load(true);
      page.pending[1].succeed();
      await settle();
      page.pending[0].fail();
      await settle();
      assert.strictEqual(page.element('#app').hidden, true, 'the board shows data from a load that started after the failed one');
    })
  )
    passed++;
  else failed++;

  if (
    await test('a refresh that fails after an older one succeeded is reported', async () => {
      const page = openPage(snapshot);
      await settle();

      page.hold = true;
      page.script.load(true);
      page.script.load(true);
      page.pending[0].succeed();
      await settle();
      page.pending[1].fail();
      await settle();
      const box = page.element('#app');
      assert.strictEqual(box.hidden, false, 'the latest refresh failed, so the board is not live');
      assert.match(box.textContent, /Live refresh failed\. The data below is from /);
    })
  )
    passed++;
  else failed++;

  if (
    await test('an older refresh that succeeds after a newer one failed leaves the failure up', async () => {
      const page = openPage(snapshot);
      await settle();

      page.hold = true;
      page.script.load(true);
      page.script.load(true);
      page.pending[1].fail();
      await settle();
      page.pending[0].succeed();
      await settle();
      const box = page.element('#app');
      assert.strictEqual(box.hidden, false, 'no load that started after the failed one has succeeded');
      assert.match(box.textContent, /Live refresh failed\. The data below is from /);
    })
  )
    passed++;
  else failed++;

  if (
    await test('an older response that arrives after a newer one does not replace its data', async () => {
      const page = openPage(snapshot);
      await settle();
      const answer = query => ({ ...snapshot, knowledge: { ...snapshot.knowledge, query } });

      page.hold = true;
      page.script.load(true);
      page.script.load(true);
      page.pending[1].succeed(answer('newer'));
      await settle();
      page.pending[0].succeed(answer('older'));
      await settle();
      assert.strictEqual(page.element('#query').value, 'newer');
    })
  )
    passed++;
  else failed++;

  if (
    await test('the first snapshot still shows when a live refresh fails before it arrives', async () => {
      const page = openPage(snapshot, { hold: true });
      const answer = query => ({ ...snapshot, knowledge: { ...snapshot.knowledge, query } });

      page.script.load(true);
      page.pending[1].fail();
      await settle();
      page.pending[0].succeed(answer('first'));
      await settle();
      assert.strictEqual(page.element('#query').value, 'first', 'the pane is not left empty');
      const box = page.element('#app');
      assert.strictEqual(box.hidden, false, 'the newer failure stays up');
      assert.match(box.textContent, /Live refresh failed\. The data below is from /);
    })
  )
    passed++;
  else failed++;

  if (
    await test('a manual refresh that fails after a newer load succeeded is not shown', async () => {
      const page = openPage(snapshot);
      await settle();

      page.hold = true;
      page.element('#refresh').listeners.click();
      page.script.load(true);
      page.pending[1].succeed();
      await settle();
      page.pending[0].fail();
      await settle();
      assert.strictEqual(page.element('#app').hidden, true, 'the newer success decides the board');
    })
  )
    passed++;
  else failed++;

  if (
    await test('an older load that succeeds after a newer manual refresh failed leaves the failure up', async () => {
      const page = openPage(snapshot);
      await settle();

      page.hold = true;
      page.script.load(true);
      page.element('#refresh').listeners.click();
      page.pending[1].fail();
      await settle();
      page.pending[0].succeed();
      await settle();
      const box = page.element('#app');
      assert.strictEqual(box.hidden, false, 'the newer failure decides the board');
      assert.match(box.textContent, /Failed to fetch/);
    })
  )
    passed++;
  else failed++;

  if (
    await test('a snapshot that cannot be shown fails its load, and older data can still take the board', async () => {
      const page = openPage(snapshot);
      await settle();
      const answer = query => ({ ...snapshot, knowledge: { ...snapshot.knowledge, query } });
      // The session table cannot list harnesses stored as an object.
      const unshowable = {
        ...answer('newer'),
        sessions: [{ id: 'session-1', state: 'running', detectedHarnesses: { claude: true } }]
      };

      page.hold = true;
      page.script.load(true);
      page.script.load(true);
      page.pending[1].succeed(unshowable);
      await settle();
      const box = page.element('#app');
      assert.strictEqual(box.hidden, false, 'the newer load failed');
      assert.match(box.textContent, /Live refresh failed\. The data below is from /);
      page.pending[0].succeed(answer('older'));
      await settle();
      assert.strictEqual(page.element('#query').value, 'older', 'the older snapshot is shown');
      assert.strictEqual(box.hidden, false, 'the newer failure stays up');
    })
  )
    passed++;
  else failed++;

  if (
    await test('Run acts on the query whose results are on the board', async () => {
      const page = openPage(snapshot);
      await settle();
      const answer = query => ({ ...snapshot, knowledge: { ...snapshot.knowledge, query } });
      const search = query => {
        page.element('#query').value = query;
        page.element('#query-form').listeners.submit({ preventDefault() {} });
      };

      page.hold = true;
      search('older');
      search('newer');
      page.pending[1].fail();
      await settle();
      page.pending[0].succeed(answer('older'));
      await settle();
      page.hold = false;
      await page.script.runAction('recall-knowledge');
      const run = page.requests.find(request => request.options.method === 'POST');
      assert.strictEqual(run.url, '/api/actions/recall-knowledge');
      assert.deepStrictEqual(JSON.parse(run.options.body), { query: 'older' }, 'the recall shown on the board');
    })
  )
    passed++;
  else failed++;

  for (const [brokenSection, allowActions] of [
    ['connectors', true], ['connectors', false], ['actions', true], ['actions', false]
  ]) {
    if (
      await test(`a late ${brokenSection} failure preserves the board with actions ${allowActions ? 'enabled' : 'disabled'}`, async () => {
        const original = {
          ...snapshot,
          knowledge: { ...snapshot.knowledge, query: 'prior', entityCount: 1,
            results: [{ entity: { name: 'prior result', entityType: 'note' }, score: 1 }] },
          execution: { allowActions },
          workItems: { ...snapshot.workItems, items: [{ id: 'prior-item', title: 'prior work' }] }
        };
        const page = openPage(original, { hold: true });
        // Finish the initial request, then establish the matching request query.
        page.pending[0].succeed(original);
        await settle();
        page.element('#query').value = 'prior';
        page.element('#query-form').listeners.submit({ preventDefault() {} });
        page.pending[1].succeed(original);
        await settle();
        const before = displayedBoard(page);
        page.now = new Date(NOW.getTime() + 60_000);
        page.script.load(true);
        const invalid = {
          ...original,
          dbPath: 'new-database', database: { exists: true },
          execution: { allowActions: !allowActions },
          summary: { ...snapshot.summary, totalSessions: 99 },
          sessions: [{ id: 'new-session', state: 'running' }],
          workItems: { ...snapshot.workItems, items: [{ id: 'new-item', title: 'new work' }] },
          knowledge: { ...original.knowledge, query: 'new', entityCount: 2,
            results: [{ entity: { name: 'new result', entityType: 'note' }, score: 2 }] },
          connectors: [{ name: 'new connector', kind: 'test' }],
          actions: [{ id: 'new-action', label: 'new action', executable: true }],
          [brokenSection]: brokenSection === 'actions' ? {} : [null]
        };
        page.pending[2].succeed(invalid);
        await settle();
        assert.deepStrictEqual(displayedBoard(page), before, 'a failed snapshot changes no displayed section');
        const error = page.element('#app');
        assert.strictEqual(error.hidden, false);
        assert.ok(error.textContent.includes(NOW.toLocaleString()), 'the failure retains the prior successful snapshot time');
        assert.ok(!error.textContent.includes(page.now.toLocaleString()), 'the failed snapshot has no successful timestamp');

        // Failed refreshes neither enable nor disable the prior work-item controls.
        page.script.window.eccMoveItem('prior-item', 'ready');
        const move = page.requests.find(request => request.url === '/api/work-items/prior-item/move');
        assert.strictEqual(Boolean(move), allowActions, 'work-item permission still matches the prior board');
        const run = page.script.runAction('recall-knowledge');
        const request = page.requests.find(request => request.url === '/api/actions/recall-knowledge');
        assert.deepStrictEqual(JSON.parse(request.options.body), { query: 'prior' });
        // Fail both fake action responses; no subsequent snapshot is requested.
        page.pending.slice(3).forEach(reply => reply.fail());
        await run;
        await settle();
      })
    ) passed++;
    else failed++;
  }

  if (
    await test('an older empty-query response stays empty while a newer query is pending', async () => {
      const page = openPage(snapshot, { hold: true });
      page.element('#query').value = 'new request';
      page.element('#query-form').listeners.submit({ preventDefault() {} });
      page.pending[0].succeed(snapshot);
      await settle();
      assert.strictEqual(page.element('#query').value, '', 'the completed empty query is not replaced by the pending query');
      const run = page.script.runAction('recall-knowledge');
      const request = page.requests.find(item => item.options.method === 'POST');
      assert.deepStrictEqual(JSON.parse(request.options.body), { query: '' });
      page.pending[1].fail();
      page.pending[2].fail();
      await run;
      await settle();
    })
  ) passed++;
  else failed++;


  const answer = (query, allowActions = false) => ({
    ...snapshot, knowledge: { ...snapshot.knowledge, query }, execution: { allowActions },
  });
  const search = (page, query) => {
    page.element('#query').value = query;
    page.element('#query-form').listeners.submit({ preventDefault() {} });
  };
  const deadlineTests = [
    ['actual intervals coalesce a stalled request, then timeout and recover', async () => {
      const page = openPage(snapshot);
      await settle();
      const before = displayedBoard(page);
      const accepted = page.state().loadedAt;
      page.hold = true;
      page.refresh();
      const request = page.requests[1];
      for (let i = 0; i < 4; i++) page.refresh();
      assert.strictEqual(page.requests.length, 2, 'Only one automatic load may be active');
      assert.strictEqual(page.state().active, 1);
      assert.strictEqual(page.intervalMs, 15000);
      assert.strictEqual(page.timerCalls.at(-1).ms, 10000);
      page.advance(9999);
      await settle();
      assert.strictEqual(page.element('#app').hidden, true);
      assert.strictEqual(request.options.signal.aborted, false);
      page.advance(1);
      await settle();
      assert.strictEqual(request.options.signal.aborted, true);
      assert.strictEqual(page.state().active, 0);
      assert.strictEqual(page.timers.size, 0);
      assert.deepStrictEqual(displayedBoard(page), before);
      assert.strictEqual(page.state().loadedAt, accepted);
      assert.match(page.element('#app').textContent, /Live refresh failed[\s\S]*Snapshot request timed out after 10 seconds/);
      assert.ok(page.element('#app').textContent.includes(NOW.toLocaleString()));
      page.hold = false;
      page.now = new Date(NOW.getTime() + 60_000);
      page.refresh();
      await settle();
      assert.strictEqual(page.requests.length, 3);
      assert.strictEqual(page.element('#app').hidden, true);
      assert.strictEqual(page.state().loadedAt, page.now.getTime());
      assert.strictEqual(page.timers.size, 0);
    }],
    ['one total deadline includes headers and a stalled JSON body', async () => {
      const page = openPage(snapshot);
      await settle();
      const before = displayedBoard(page);
      page.hold = true;
      page.refresh();
      page.advance(4000);
      page.pending[0].headers();
      await settle();
      page.advance(5999);
      await settle();
      assert.strictEqual(page.element('#app').hidden, true);
      page.advance(1);
      await settle();
      assert.match(page.element('#app').textContent, /Snapshot request timed out after 10 seconds/);
      assert.doesNotMatch(page.element('#app').textContent, /Synthetic AbortError/);
      assert.deepStrictEqual(displayedBoard(page), before);
      assert.strictEqual(page.requests[1].options.signal.aborted, true);
      assert.strictEqual(page.state().active, 0);
    }],
    ['expired header response cannot overwrite a newer accepted query or permission', async () => {
      const page = openPage(snapshot);
      await settle();
      page.hold = true; page.ignoreAbort = true;
      page.refresh();
      const late = page.pending[0];
      page.advance(10000);
      await settle();
      search(page, 'new query');
      page.pending[1].succeed(answer('new query', true));
      await settle();
      const before = displayedBoard(page);
      const state = page.state();
      late.succeed(answer('expired query', false));
      await settle();
      assert.deepStrictEqual(displayedBoard(page), before);
      assert.deepStrictEqual(page.state(), state);
      assert.strictEqual(page.element('#app').hidden, true);
    }],
    ['expired body response cannot overwrite a newer failure or release its active counter twice', async () => {
      const page = openPage(snapshot);
      await settle();
      page.hold = true; page.ignoreAbort = true;
      page.refresh();
      const late = page.pending[0];
      late.headers();
      await settle();
      page.advance(10000);
      await settle();
      page.refresh();
      page.pending[1].fail(new Error('Newer failure'));
      await settle();
      const failure = page.element('#app').textContent;
      const before = displayedBoard(page);
      page.refresh(); // Another load remains active while the expired loser finishes.
      late.succeed(answer('expired query', true));
      await settle();
      assert.deepStrictEqual(displayedBoard(page), before);
      assert.strictEqual(page.element('#app').textContent, failure);
      assert.strictEqual(page.state().active, 1);
      page.refresh();
      assert.strictEqual(page.requests.length, 4, 'Late completion must not reopen the automatic dispatch gate');
      page.pending[2].succeed();
      await settle();
      assert.strictEqual(page.state().active, 0);
    }],
    ['expired late fetch rejection stays handled and preserves the newer outcome', async () => {
      const page = openPage(snapshot);
      await settle();
      page.hold = true; page.ignoreAbort = true;
      page.refresh();
      const late = page.pending[0];
      page.advance(10000);
      await settle();
      page.refresh();
      page.pending[1].succeed();
      await settle();
      const state = page.state();
      late.fail(new Error('Late ignored abort rejection'));
      await settle();
      assert.deepStrictEqual(page.state(), state);
      assert.strictEqual(page.element('#app').hidden, true);
    }],
    ['initial timeout is visible without an invented last-good timestamp', async () => {
      const page = openPage(snapshot, { hold: true });
      page.refresh();
      assert.strictEqual(page.requests.length, 1, 'Initial load also suppresses automatic dispatch');
      page.advance(10000);
      await settle();
      assert.strictEqual(page.element('#app').hidden, false);
      assert.match(page.element('#app').textContent, /Snapshot request timed out/);
      assert.doesNotMatch(page.element('#app').textContent, /data below is from/);
      assert.strictEqual(page.state().loadedAt, null);
      page.hold = false;
      page.refresh();
      await settle();
      assert.strictEqual(page.element('#app').hidden, true);
      assert.strictEqual(page.state().loadedAt, NOW.getTime());
    }],
    ['manual and query loads may overlap a poll while actual intervals remain suppressed', async () => {
      const page = openPage(snapshot);
      await settle();
      page.hold = true;
      page.refresh();
      page.element('#refresh').listeners.click();
      search(page, 'query');
      assert.strictEqual(page.requests.length, 4);
      assert.strictEqual(page.state().active, 3);
      page.pending[1].succeed();
      await settle();
      assert.strictEqual(page.state().active, 2);
      page.refresh();
      assert.strictEqual(page.requests.length, 4);
      page.pending[2].succeed(answer('query'));
      await settle();
      assert.strictEqual(page.state().active, 1);
      page.advance(10000);
      await settle();
      assert.strictEqual(page.state().active, 0);
      assert.strictEqual(page.element('#app').hidden, true, 'Older timeout does not overrule newer success');
      page.refresh();
      assert.strictEqual(page.requests.length, 5);
    }],
    ['newer manual timeout remains visible when an older valid load supplies fallback data', async () => {
      const page = openPage(snapshot);
      await settle();
      page.hold = true;
      search(page, 'older');
      search(page, 'newer');
      // Adversarial completion order: fire only the newer timer, not wall time.
      page.fireTimer(page.timerCalls.at(-1).id);
      await settle();
      page.pending[0].succeed(answer('older', true));
      await settle();
      assert.strictEqual(page.element('#query').value, 'older');
      assert.strictEqual(page.state().shownQuery, 'older');
      assert.strictEqual(page.state().allowActions, true);
      assert.match(page.element('#app').textContent, /Snapshot request timed out/);
      assert.doesNotMatch(page.element('#app').textContent, /Live refresh failed/);
      assert.strictEqual(page.state().active, 0);
    }],
    ['hidden interval leaves existing failure intact until a visible successful refresh', async () => {
      const page = openPage(snapshot);
      await settle();
      page.online = false;
      page.refresh();
      await settle();
      const failure = page.element('#app').textContent;
      page.script.document.hidden = true;
      page.refresh();
      assert.strictEqual(page.requests.length, 2);
      assert.strictEqual(page.element('#app').textContent, failure);
      page.script.document.hidden = false; page.online = true;
      page.refresh();
      await settle();
      assert.strictEqual(page.element('#app').hidden, true);
    }],
    ['action POST remains unbounded by snapshot timers and its reload gets a deadline', async () => {
      const page = openPage(snapshot);
      await settle();
      page.hold = true;
      const action = page.script.runAction('recall-knowledge');
      assert.strictEqual(page.requests[1].options.method, 'POST');
      assert.strictEqual(page.requests[1].options.signal, undefined);
      assert.strictEqual(page.timers.size, 0);
      page.advance(10000);
      assert.strictEqual(page.pending[0].settled, false);
      page.pending[0].succeed({ ok: true });
      await settle();
      assert.match(page.requests[2].url, /\/api\/snapshot/);
      assert.ok(page.requests[2].options.signal);
      assert.strictEqual(page.timers.size, 1);
      page.pending[1].succeed();
      await action;
      assert.strictEqual(page.timers.size, 0);
    }],
  ];
  for (const route of ['HTTP failure', 'invalid JSON', 'malformed late section', 'fetch setup', 'controller setup', 'URL setup', 'timer setup']) {
    deadlineTests.push([`${route} releases its timer and active counter for the next interval`, async () => {
      const page = openPage(snapshot);
      await settle();
      page.hold = true;
      const key = { 'fetch setup': 'fetch', 'controller setup': 'AbortController', 'URL setup': 'URL', 'timer setup': 'setTimeout' }[route];
      const original = page.script[key];
      if (key) page.script[key] = function () { throw new Error(route); };
      page.refresh();
      if (route === 'HTTP failure') page.pending[0].respond({ ok: false, json: async () => ({ error: route }) });
      if (route === 'invalid JSON') page.pending[0].respond({ ok: true, json: async () => { throw new Error(route); } });
      if (route === 'malformed late section') page.pending[0].succeed({ ...snapshot, actions: {} });
      await settle();
      assert.strictEqual(page.element('#app').hidden, false);
      assert.strictEqual(page.state().active, 0);
      assert.strictEqual(page.timers.size, 0);
      if (key) page.script[key] = original;
      page.hold = false;
      const count = page.requests.length;
      page.refresh();
      await settle();
      assert.strictEqual(page.requests.length, count + 1);
      assert.strictEqual(page.element('#app').hidden, true);
      assert.strictEqual(page.state().active, 0);
    }]);
  }
  for (const [name, check] of deadlineTests) {
    if (await test(name, check)) passed++;
    else failed++;
  }
  assert.strictEqual(pages.size, 0, 'Every fake page and its pending requests were disposed');

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
