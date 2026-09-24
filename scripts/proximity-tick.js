#!/usr/bin/env node
'use strict';

/**
 * Proximity tick — the live loop that turns the agent-space distance metric into
 * action: scan the airspace from the control-pane state, then steer/transmit by
 * sending session-to-session messages via `ecc-tui messages send`.
 *
 *   node scripts/proximity-tick.js              # one shot, deliver triggers
 *   node scripts/proximity-tick.js --dry-run    # show what would fire, send nothing
 *   node scripts/proximity-tick.js --watch 30   # re-scan every 30s (dedupes per cooldown)
 *
 * Messages are internal ECC agent-to-agent coordination (the ecc2 `messages`
 * table) — not any external channel.
 */

const { resolveControlPaneConfig, buildControlPaneSnapshot } = require('./lib/control-pane/state');
const { createProximityDispatcher, runProximityTick } = require('./lib/control-pane/proximity');
const { createEccMessageSink } = require('./lib/control-pane/message-sink');

function parseArgs(argv) {
  const args = argv.slice(2);
  const parsed = { watchSec: 0, dryRun: false, json: false, help: false, dbPath: null, stateDbPath: null };
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === '--help' || a === '-h') parsed.help = true;
    else if (a === '--dry-run') parsed.dryRun = true;
    else if (a === '--json') parsed.json = true;
    else if (a === '--watch') {
      const v = Number.parseInt(args[i + 1], 10);
      if (!Number.isInteger(v) || v <= 0) throw new Error('--watch needs a positive seconds value');
      parsed.watchSec = v;
      i += 1;
    } else if (a === '--db') {
      parsed.dbPath = args[i + 1];
      i += 1;
    } else if (a === '--state-db') {
      parsed.stateDbPath = args[i + 1];
      i += 1;
    } else {
      throw new Error(`Unknown argument: ${a}`);
    }
  }
  return parsed;
}

function showHelp() {
  console.log(
    [
      'Usage: node scripts/proximity-tick.js [--watch <seconds>] [--dry-run] [--json] [--db <path>] [--state-db <path>]',
      '',
      'Scan agent proximity from the control-pane state and steer/transmit by sending',
      'internal session-to-session messages. --dry-run sends nothing; --watch loops.'
    ].join('\n')
  );
}

function report(tick, json) {
  if (json) {
    console.log(JSON.stringify(tick, null, 2));
    return;
  }
  const c = tick.counts || {};
  console.log(
    `proximity: ${c.agents ?? 0} agents, ${c.advisories ?? 0} advisories (${c.resolutions ?? 0} resolutions) — ` +
      `dispatched ${tick.result.dispatched}, suppressed ${tick.result.suppressed}, skipped ${tick.result.skipped}` +
      (tick.result.dryRun ? ' [dry-run]' : '')
  );
  for (const adv of tick.advisories.slice(0, 8)) {
    const who = adv.level === 'resolution' ? `${adv.steer} steers (yields to ${adv.hold})` : 'both transmit intent';
    console.log(`  - ${(adv.risk * 100) | 0}% ${adv.level}: ${adv.aLabel || adv.a} <-> ${adv.bLabel || adv.b} => ${who}`);
  }
}

async function main() {
  const opts = parseArgs(process.argv);
  if (opts.help) {
    showHelp();
    return;
  }
  const config = resolveControlPaneConfig(opts);
  const sink = opts.dryRun ? null : createEccMessageSink({});
  const dispatcher = createProximityDispatcher({ sendMessage: sink });
  const buildSnapshot = () =>
    buildControlPaneSnapshot({
      config,
      dbPath: opts.dbPath || config.dbPath,
      stateDbPath: opts.stateDbPath || config.stateDbPath,
      includeProximity: true
    });

  const once = async () => report(await runProximityTick({ buildSnapshot, dispatcher, dryRun: opts.dryRun }), opts.json);

  await once();
  if (opts.watchSec > 0) {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    for (;;) {
      await sleep(opts.watchSec * 1000);
      await once();
    }
  }
}

if (require.main === module) {
  main().catch(err => {
    process.stderr.write(`proximity-tick error: ${err.message}\n`);
    process.exit(1);
  });
}

module.exports = { parseArgs };
