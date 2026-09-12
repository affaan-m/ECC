#!/usr/bin/env node
'use strict';

const { loadContextRegistry } = require('../lib/context-pack-registry');
const { compileContextProfile } = require('../lib/context-profiles');

function validate(repoRoot) {
  const registry = loadContextRegistry({ repoRoot });
  const profiles = ['lean@1', 'full@1'];
  for (const profileId of profiles) {
    for (const target of registry.targets) {
      compileContextProfile({ repoRoot, profileId, target });
    }
  }
  return {
    status: 'success', skillCount: registry.entries.length,
    profileCount: profiles.length, targetCount: registry.targets.length,
    projectionCount: profiles.length * registry.targets.length,
    registryDigest: registry.registryDigest, nativeCertification: 'unobserved',
  };
}

function main(args = process.argv.slice(2)) {
  try {
    for (const arg of args) {
      if (arg !== '--json') throw new Error(`Unknown argument: ${arg}`);
    }
    const result = validate();
    console.log(args.includes('--json') ? JSON.stringify(result, null, 2)
      : `Context profiles valid: ${result.skillCount} skills, ${result.projectionCount} profile/target projections. Native certification: unobserved.`);
    return 0;
  } catch (error) {
    console.error(`Context profile validation failed: ${error.message}`);
    return 1;
  }
}

if (require.main === module) process.exitCode = main();
module.exports = { main, validate };
