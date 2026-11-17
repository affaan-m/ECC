'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { getSessionById } = require('../../scripts/lib/session-manager');

/** Run a synchronous lookup against isolated canonical and legacy session files. */
function withSessions(records, run) {
  const dataHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-session-lookup-'));
  const previous = process.env.ECC_AGENT_DATA_HOME;
  try {
    process.env.ECC_AGENT_DATA_HOME = dataHome;
    for (const record of records) {
      const directory = path.join(dataHome, record.legacy ? 'sessions' : 'session-data');
      fs.mkdirSync(directory, { recursive: true });
      const file = path.join(directory, record.filename);
      fs.writeFileSync(file, record.content || `# ${record.filename}\n`);
      fs.utimesSync(file, record.mtime, record.mtime);
    }
    run();
  } finally {
    if (previous === undefined) delete process.env.ECC_AGENT_DATA_HOME;
    else process.env.ECC_AGENT_DATA_HOME = previous;
    fs.rmSync(dataHome, { recursive: true, force: true });
  }
}

test('explicit lookup kinds disambiguate exact aliases while auto retains recency and content', () => {
  for (const [query, filename, legacy] of [
    ['2026-03-10-frontend-session', '2026-03-10-frontend-session.tmp', false],
    ['2026-03-09', '2026-03-09-session.tmp', true]
  ]) {
    for (const [filenameTime, idTime] of [[1000, 2000], [2000, 1000]]) {
      const filenameSession = { filename, legacy, mtime: filenameTime, content: '# Filename session\n' };
      const idSession = { filename: `2026-03-11-${query}-session.tmp`, mtime: idTime, content: '# ID session\n' };
      const prefixSession = { filename: `2026-03-12-${query}-more-session.tmp`, mtime: 3000 };
      withSessions([filenameSession, idSession, prefixSession], () => {
        const newestExact = filenameTime > idTime ? filenameSession : idSession;
        for (const options of [undefined, { matchBy: 'auto' }]) {
          const automatic = getSessionById(query, true, options);
          assert.equal(automatic.filename, newestExact.filename);
          assert.equal(automatic.content, newestExact.content);
        }
        const byId = getSessionById(query, true, { matchBy: 'id' });
        assert.equal(byId.filename, idSession.filename);
        assert.equal(byId.content, idSession.content);
        assert.equal(byId.metadata.title, 'ID session');
        const byFilename = getSessionById(` ${filename.slice(0, -4)} `, true, { matchBy: 'filename' });
        assert.equal(byFilename.filename, filenameSession.filename);
        assert.equal(byFilename.content, filenameSession.content);
        assert.equal(byFilename.metadata.title, 'Filename session');
        assert.equal(getSessionById(filename, true).content, filenameSession.content);
      });
    }
  }
});

test('explicit modes retain legacy date aliases without falling back to another lookup type', () => {
  const current = '2026-03-10-frontend-session.tmp';
  const legacy = '2026-03-09-session.tmp';
  withSessions([
    { filename: current, mtime: 2000 },
    { filename: legacy, mtime: 1000, legacy: true }
  ], () => {
    assert.equal(getSessionById('front', false, { matchBy: 'id' }).filename, current);
    assert.equal(getSessionById('frontend', false, { matchBy: 'filename' }), null);
    assert.equal(getSessionById(current, false, { matchBy: 'id' }), null);
    assert.equal(getSessionById('2026-03-09').filename, legacy);
    assert.equal(getSessionById('2026-03-09', false, { matchBy: 'id' }).filename, legacy);
    assert.equal(getSessionById('2026-03-09', false, { matchBy: 'filename' }), null);
    assert.equal(getSessionById('2026-03-09-session', false, { matchBy: 'filename' }).filename, legacy);
  });
});

test('invalid lookup modes return null instead of selecting an unrelated session', () => {
  withSessions([{ filename: '2026-03-10-frontend-session.tmp', mtime: 1000 }], () => {
    for (const matchBy of ['', 'Filename', 'other', null, false, 0]) {
      assert.equal(getSessionById('frontend', true, { matchBy }), null);
    }
    for (const options of [null, [], 'id']) {
      assert.equal(getSessionById('frontend', true, options), null);
    }
  });
});
