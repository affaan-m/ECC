'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { getSessionById } = require('../../scripts/lib/session-manager');

for (const [label, filename, query] of [
  ['extensionless filename', '2026-04-01-frontend-session.tmp', '2026-04-01-frontend-session'],
  ['legacy date alias', '2026-04-01-session.tmp', '2026-04-01'],
]) {
  test(`ambiguous exact ${label} and short ID retain modification-time ordering`, t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-session-id-collision-'));
    const sessions = path.join(root, 'session-data');
    fs.mkdirSync(sessions);
    const prior = process.env.ECC_AGENT_DATA_HOME;
    process.env.ECC_AGENT_DATA_HOME = root;
    t.after(() => {
      if (prior === undefined) delete process.env.ECC_AGENT_DATA_HOME;
      else process.env.ECC_AGENT_DATA_HOME = prior;
      fs.rmSync(root, { recursive: true, force: true });
    });

    const shortIdFilename = `2026-04-02-${query}-session.tmp`;
    const baseTime = Date.parse('2026-11-11T12:00:00.000Z');
    const write = (name, age) => {
      const file = path.join(sessions, name);
      fs.writeFileSync(file, `# ${name}\n`);
      const timestamp = new Date(baseTime + age * 1000);
      fs.utimesSync(file, timestamp, timestamp);
    };
    write(filename, 2);
    write(shortIdFilename, 1);

    assert.equal(getSessionById(query, true).filename, filename,
      'Equally exact aliases retain the previous newest-first behavior');
    assert.equal(getSessionById(filename, true).filename, filename,
      'The full .tmp filename selects its own record without ambiguity');

    write(`2026-04-03-${query}-more-session.tmp`, 3);
    assert.equal(getSessionById(query).filename, filename,
      'A newer prefix match must not displace an exact filename or date alias');

    write(shortIdFilename, 4);
    assert.equal(getSessionById(query).filename, shortIdFilename,
      'The newer exact short ID wins when the exact-match timestamps reverse');
    assert.equal(getSessionById(filename).filename, filename);
  });
}
