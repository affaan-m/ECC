'use strict';

const workerThreads = require('worker_threads');
const OriginalWorker = workerThreads.Worker;
let metrics = { active: 0, peak: 0, started: 0, exited: 0, received: 0, disconnected: 0 };
function send(message) {
  if (process.connected) process.send(message, error => { if (error) process.exitCode = 1; });
}
function report() { send({ type: 'workers', ...metrics }); }
workerThreads.Worker = class ObservedWorker extends OriginalWorker {
  constructor(...args) {
    super(...args);
    metrics = {
      ...metrics,
      active: metrics.active + 1,
      started: metrics.started + 1,
      peak: Math.max(metrics.peak, metrics.active + 1)
    };
    report();
    this.once('exit', () => {
      metrics = { ...metrics, active: metrics.active - 1, exited: metrics.exited + 1 };
      report();
    });
  }
};
const { createControlPaneServer } = require('../../../scripts/lib/control-pane/server');

async function main() {
  const app = createControlPaneServer({
    host: '127.0.0.1', port: 0, stateDbPath: process.argv[2],
    dbPath: `${process.argv[2]}.ecc2`, allowActions: process.argv[3] !== 'read-only'
  });
  app.server.prependListener('request', (req, res) => {
    if (req.method === 'POST') {
      metrics = { ...metrics, received: metrics.received + 1 };
      report();
      send({ type: 'mutation-received' });
      res.once('close', () => {
        if (!res.writableFinished) {
          metrics = { ...metrics, disconnected: metrics.disconnected + 1 };
          report();
        }
      });
    }
  });
  let closing;
  let startupFailed = false;
  const close = () => {
    if (!closing) closing = Promise.resolve().then(() => app.close());
    return closing;
  };
  const finish = async () => {
    try { await close(); if (!startupFailed) process.exitCode = 0; }
    catch (error) { console.error(error); process.exitCode = 1; }
    if (process.connected) process.disconnect();
  };
  process.on('disconnect', finish);
  process.on('message', message => { if (message === 'close') finish(); });
  try {
    await app.listen();
    send({ type: 'ready', url: app.url });
  } catch (error) {
    startupFailed = true;
    try { await close(); } catch (_cleanupError) { /* Preserve startup error. */ }
    throw error;
  }

}
process.exitCode = 1;
main().catch(error => {
  console.error(error);
  process.exitCode = 1;
  if (process.connected) process.disconnect();
});
