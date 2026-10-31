#!/usr/bin/env node
'use strict';

const os = require('os');
const path = require('path');
const {
  classifyGrokFixtureUpgrade,
  detectDestFixture,
  isFixtureNecessary,
  probeGrokSupport,
  readFixturePolicy,
} = require('../lib/grok-fixture-upgrade');

function readFlag(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return null;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) return null;
  return value;
}

function main(argv = process.argv.slice(2)) {
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(
      'Usage: check-grok-fixture.js [--repo-root <path>] [--incoming-root <path>] [--grok-home <path>] [--json]\n'
    );
    return;
  }

  const repoRoot = path.resolve(readFlag(argv, '--repo-root') || path.join(__dirname, '..', '..'));
  const incomingRoot = path.resolve(readFlag(argv, '--incoming-root') || repoRoot);
  const grokHome = path.resolve(readFlag(argv, '--grok-home') || path.join(os.homedir(), '.grok'));
  const destPresent = detectDestFixture(grokHome);
  const policy = readFixturePolicy(grokHome);
  const current = probeGrokSupport(repoRoot);
  const incoming = probeGrokSupport(incomingRoot);
  const necessary = isFixtureNecessary({ destPresent, incoming });
  const decision = classifyGrokFixtureUpgrade({
    destPresent,
    policyStatus: policy ? policy.status : null,
    incoming,
    changedPaths: [],
  });

  const report = {
    destPresent,
    necessary,
    policy: policy ? policy.status : null,
    current,
    incoming,
    decision,
    howToRead: {
      necessary: 'true means ~/.grok still depends on the copied-config overlay because incoming ECC has no grok install target and no grok plugin',
      perforated: 'upgrade would touch fixture files without solving Grok — restore overlay after pull',
      solved: 'incoming ECC provides Grok natively or absorbed the overlay — detach the fixture gate',
      passthrough: 'fixture still needed, but this upgrade does not touch fixture paths',
    },
  };

  if (argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }

  process.stdout.write(`Grok fixture necessary: ${necessary ? 'yes' : 'no'}\n`);
  process.stdout.write(`Dest fixture present: ${destPresent ? 'yes' : 'no'}\n`);
  process.stdout.write(`Policy: ${policy ? policy.status : 'none'}\n`);
  process.stdout.write(
    `Incoming: installTarget=${incoming.installTarget} plugin=${incoming.plugin} `
    + `copiedSync=${incoming.copiedSync} mcpHarness=${incoming.mcpHarness}\n`
  );
  process.stdout.write(`Upgrade flow: ${decision.flow} (${decision.reason})\n`);
  if (necessary) {
    process.stdout.write(
      'Keep the copied-config overlay until upstream adds a grok install target or .grok-plugin.\n'
    );
  } else if (destPresent) {
    process.stdout.write(
      'Incoming ECC covers Grok. A solved upgrade can detach this fixture from auto-update.\n'
    );
  } else {
    process.stdout.write('No Grok dest fixture detected. Auto-update will not gate on Grok.\n');
  }
}

module.exports = { main };

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`[ecc-grok-fixture] ERROR: ${error.message}\n`);
    process.exit(1);
  }
}
