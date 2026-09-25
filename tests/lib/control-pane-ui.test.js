/**
 * Tests for the browser script the local ECC2 control pane serves.
 */

const assert = require('assert');
const path = require('path');
const vm = require('vm');

const { buildControlPaneSnapshot } = require('../../scripts/lib/control-pane/state');
const { renderControlPaneHtml } = require('../../scripts/lib/control-pane/ui');

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
  const page = { online: true, hold, pending: [], requests: [], refresh: null, element };
  page.script = {
    document: { hidden: false, querySelector: element, querySelectorAll: () => [] },
    window: { location: { href: 'http://127.0.0.1:8765/' } },
    URL,
    Intl,
    Date: PageDate,
    console,
    fetch: (url, options = {}) =>
      new Promise((resolve, reject) => {
        page.requests = [...page.requests, { url: String(url), options }];
        const reply = {
          succeed: (data = snapshot) => resolve({ ok: true, status: 200, statusText: 'OK', json: async () => data }),
          fail: () => reject(new TypeError('Failed to fetch'))
        };
        if (page.hold) page.pending = [...page.pending, reply];
        else if (page.online) reply.succeed();
        else reply.fail();
      }),
    setInterval: callback => {
      page.refresh = callback;
    }
  };
  vm.runInNewContext(inlineScript(renderControlPaneHtml()), page.script);
  return page;
}

const settle = () => new Promise(resolve => setImmediate(resolve));

async function runTests() {
  console.log('\n=== Testing control-pane UI ===\n');

  let passed = 0;
  let failed = 0;

  const snapshot = JSON.parse(
    JSON.stringify(
      await buildControlPaneSnapshot({
        dbPath: path.join(__dirname, 'no-such-ecc2.db'),
        repoRoot: path.join(__dirname, '..', '..'),
        query: ''
      })
    )
  );

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
      page.refresh();
      page.hold = false;
      page.refresh();
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
      page.refresh();
      page.refresh();
      page.refresh();
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
      page.refresh();
      page.refresh();
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
      page.refresh();
      page.refresh();
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
      page.refresh();
      page.refresh();
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

      page.refresh();
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
      page.refresh();
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
      page.refresh();
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
      page.refresh();
      page.refresh();
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

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
