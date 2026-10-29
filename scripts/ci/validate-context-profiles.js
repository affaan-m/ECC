#!/usr/bin/env node
'use strict';

const { loadContextRegistry, loadSkillTriggers } = require('../lib/context-pack-registry');
const { compileContextProfile } = require('../lib/context-profiles');
const { digestObject } = require('../lib/context-profile-support');

function validate(repoRoot) {
  const registry = loadContextRegistry({ repoRoot });
  const { triggers, manifest } = loadSkillTriggers({ repoRoot });
  const known = new Set(registry.entries.map(entry => entry.id));
  const unknown = Object.keys(triggers).filter(id => !known.has(id));
  if (unknown.length) throw new Error(`Skill triggers reference unknown skills: ${unknown.slice(0, 3).join(', ')}`);
  if (manifest && manifest.registryDigest && manifest.registryDigest !== registry.registryDigest) {
    throw new Error('Skill triggers manifest is stale: regenerate with scripts/dev/generate-skill-triggers.js');
  }
  if (manifest && manifest.triggersDigest && digestObject(triggers) !== manifest.triggersDigest) {
    throw new Error('Skill triggers digest mismatch: manifest was edited without updating triggersDigest');
  }
  for (const list of Object.values(triggers)) {
    for (const phrase of list) {
      if (phrase.length > 80) throw new Error(`Skill trigger exceeds 80 characters: ${phrase.slice(0, 40)}`);
    }
  }
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
    triggerCoverage: { skills: manifest ? manifest.coverage.skills : 0, withTriggers: Object.keys(triggers).length },
  };
}

function main(args = process.argv.slice(2)) {
  try {
    for (const arg of args) {
      if (arg !== '--json') throw new Error(`Unknown argument: ${arg}`);
    }
    const result = validate();
    console.log(args.includes('--json') ? JSON.stringify(result, null, 2)
      : `Context profiles valid: ${result.skillCount} skills, ${result.projectionCount} profile/target projections, triggers ${result.triggerCoverage.withTriggers}/${result.triggerCoverage.skills || result.skillCount}. Native certification: unobserved.`);
    return 0;
  } catch (error) {
    console.error(`Context profile validation failed: ${error.message}`);
    return 1;
  }
}

if (require.main === module) process.exitCode = main();
module.exports = { main, validate };
