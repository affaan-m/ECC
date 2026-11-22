'use strict';

const fs = require('fs');
const path = require('path');
const {
  getFallbackSessionRecordingPath,
  normalizeClaudeHistorySession,
  persistCanonicalSnapshot,
} = require('../../../scripts/lib/session-adapters/canonical-session');

const [recordingDir, gateDir, title] = process.argv.slice(2);
const snapshot = normalizeClaudeHistorySession({
  shortId: 'shared-recording',
  sessionPath: '/fixture/session.tmp',
  metadata: { title },
}, { type: 'claude-history', value: 'shared-recording' });
const options = { recordingDir, loadStateStoreImpl: () => null };
const recordingPath = getFallbackSessionRecordingPath(snapshot, options);
const originalRead = fs.readFileSync;

// Pause after a real recording read. The parent attempts a second write while
// this process still holds the old history; no database or writer is mocked.
fs.readFileSync = function (filename, ...args) {
  const result = originalRead.call(this, filename, ...args);
  if (filename === recordingPath) {
    fs.writeFileSync(path.join(gateDir, 'read'), '');
    const deadline = performance.now() + 10000;
    const sleeper = new Int32Array(new SharedArrayBuffer(4));
    while (!fs.existsSync(path.join(gateDir, 'release'))) {
      if (performance.now() >= deadline) throw new Error('Recording writer was not released');
      Atomics.wait(sleeper, 0, 0, 10);
    }
  }
  return result;
};

try {
  persistCanonicalSnapshot(snapshot, options);
} finally {
  fs.readFileSync = originalRead;
}
