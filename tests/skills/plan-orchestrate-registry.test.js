#!/usr/bin/env node
/**
 * Registry fixtures for skills/plan-orchestrate/SKILL.md.
 *
 * The skill is a router over the current ECC command surface. These fixtures
 * validate the router's claims against the command registry itself — the
 * command files (frontmatter argument-hint / ## Usage sections, $ARGUMENTS
 * use) and the generated docs/COMMAND-REGISTRY.json:
 *
 *  1. every command the skill names exists in commands/ and in the registry;
 *  2. no retired or legacy-shim command is referenced outside the explicit
 *     prohibition sentence;
 *  3. the scope-carrying allowlist matches commands whose own file documents
 *     a free-form task-description argument, with the argument text quoted
 *     in the skill matching the documented form;
 *  4. the fail-closed set matches commands whose file documents no free-form
 *     argument (re-classify the skill if a command grows one);
 *  5. the fail-closed rule and the BLOCKED marker are actually stated;
 *  6. the agent-chain machinery stays gone — commands own their execution;
 *  7. emitted examples carry the [Plan: ...#step-N] scope marker.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..');
const SKILL_PATH = path.join(REPO_ROOT, 'skills', 'plan-orchestrate', 'SKILL.md');
const REGISTRY_PATH = path.join(REPO_ROOT, 'docs', 'COMMAND-REGISTRY.json');
const COMMANDS_DIR = path.join(REPO_ROOT, 'commands');
const SHIMS_DIR = path.join(REPO_ROOT, 'legacy-command-shims');

function section(markdown, startMarker, endMarker) {
  const start = markdown.indexOf(startMarker);
  assert.ok(start !== -1, `section start not found: ${startMarker}`);
  const bodyStart = start + startMarker.length;
  const end = endMarker ? markdown.indexOf(endMarker, bodyStart) : markdown.length;
  assert.ok(end !== -1, `section end not found: ${endMarker}`);
  return markdown.slice(bodyStart, end);
}

// Documented argument form for a command, derived from its own file:
// frontmatter argument-hint, or the first fenced line under ## Usage that
// starts with the command, or null when the file documents no arguments.
function documentedUsage(commandName) {
  const content = fs.readFileSync(path.join(COMMANDS_DIR, `${commandName}.md`), 'utf8');

  const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (frontmatter) {
    const hint = frontmatter[1].match(/^argument-hint:\s*(.+)$/m);
    if (hint) {
      return {
        kind: 'argument-hint',
        text: hint[1].trim().replace(/^['"]|['"]$/g, ''),
        usesArguments: content.includes('$ARGUMENTS'),
      };
    }
  }

  const lines = content.split(/\r?\n/);
  const usageIndex = lines.findIndex(line => /^## Usage\s*$/.test(line.trim()));
  if (usageIndex !== -1) {
    for (let i = usageIndex + 1; i < lines.length; i += 1) {
      const line = lines[i].trim();
      if (/^##\s/.test(line)) {
        break; // next heading: Usage section ended with no command form
      }
      const withoutBackticks = line.replace(/^`+|`+$/g, '');
      if (withoutBackticks.startsWith(`/${commandName}`) && withoutBackticks.length > commandName.length + 1) {
        return {
          kind: 'usage',
          text: withoutBackticks.slice(commandName.length + 1).trim(),
          usesArguments: content.includes('$ARGUMENTS'),
        };
      }
    }
  }

  return { kind: 'none', text: '', usesArguments: content.includes('$ARGUMENTS') };
}

function run() {
  console.log('plan-orchestrate registry fixtures');

  const markdown = fs.readFileSync(SKILL_PATH, 'utf8');
  const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
  const registryNames = new Set(registry.commands.map(command => command.command));
  const shimNames = fs.existsSync(SHIMS_DIR)
    ? new Set(fs.readdirSync(SHIMS_DIR).filter(f => f.endsWith('.md')).map(f => f.replace(/\.md$/, '')))
    : new Set();

  // --- Parse the skill's own declarations -------------------------------

  const carryingTable = section(markdown, '**Scope-carrying commands**', '**Everything else fails closed.**');
  const carrying = new Map();
  for (const line of carryingTable.split('\n')) {
    const row = line.match(/^\| `\/([a-z][a-z0-9-]*)` \| (.+) \|$/);
    if (row) {
      carrying.set(row[1], row[2].trim());
    }
  }
  assert.ok(carrying.size >= 5, `scope-carrying table parse found ${carrying.size} commands`);

  const failClosedSentence = section(markdown, '**Everything else fails closed.**', 'are never emitted.');
  const failClosed = new Set();
  for (const match of failClosedSentence.matchAll(/`\/([a-z][a-z0-9-]*)`/g)) {
    failClosed.add(match[1]);
  }
  assert.ok(failClosed.size >= 6, `fail-closed sentence parse found ${failClosed.size} commands`);

  const catalogueSection = section(markdown, '## Command catalogue', 'Tag resolution rules:');
  const catalogueCommands = new Set();
  for (const line of catalogueSection.split('\n')) {
    const row = line.match(/^\| `[a-z]+` \|[^|]+\| `\/([a-z][a-z0-9-]*)` \|/);
    if (row) {
      catalogueCommands.add(row[1]);
    }
  }
  assert.ok(catalogueCommands.size >= 10, `catalogue table parse found ${catalogueCommands.size} commands`);

  const overlap = [...carrying.keys()].filter(name => failClosed.has(name));
  assert.deepStrictEqual(overlap, [], 'a command cannot be both scope-carrying and fail-closed');

  const emitCommands = new Set([...carrying.keys(), ...failClosed, ...catalogueCommands]);

  // --- 1. Every named command exists in commands/ and the registry ------

  for (const name of emitCommands) {
    assert.ok(fs.existsSync(path.join(COMMANDS_DIR, `${name}.md`)), `commands/${name}.md does not exist`);
    assert.ok(registryNames.has(name), `/${name} is missing from docs/COMMAND-REGISTRY.json`);
  }
  console.log('  \u2713 every catalogue command exists in commands/ and docs/COMMAND-REGISTRY.json');

  // --- 2. No retired / legacy-shim command outside the prohibition ------

  const PROHIBITION = 'no `legacy-command-shims/` command and no `/orchestrate` or `/ecc:orchestrate` appears in the rendered output';
  assert.ok(markdown.includes(PROHIBITION), 'the retired-command prohibition sentence must stay in the self-check');
  const withoutProhibition = markdown.replace(PROHIBITION, '');
  assert.ok(!/\/orchestrate\b/.test(withoutProhibition), 'skill must not reference /orchestrate outside the prohibition');
  assert.ok(!/\/ecc:orchestrate/.test(withoutProhibition), 'skill must not reference /ecc:orchestrate outside the prohibition');
  for (const name of emitCommands) {
    assert.ok(!shimNames.has(name), `/${name} is a legacy-command-shim and must not be emitted`);
  }
  console.log('  \u2713 no retired or legacy-shim command is referenced as emit-able');

  // --- 3. Scope-carrying claims match the command files ------------------

  for (const [name, quotedArgument] of carrying) {
    const usage = documentedUsage(name);
    assert.notStrictEqual(usage.kind, 'none', `/${name} is listed as scope-carrying but documents no argument form`);
    const normalizedQuoted = quotedArgument.replace(/\\\|/g, '|').trim();
    assert.ok(
      usage.text.includes(normalizedQuoted) || normalizedQuoted.includes(usage.text),
      `/${name}: skill quotes argument "${normalizedQuoted}" but command file documents "${usage.text}"`
    );
    assert.ok(
      usage.kind === 'argument-hint' || usage.usesArguments,
      `/${name} must consume its argument ($ARGUMENTS) or declare argument-hint to be scope-carrying`
    );
  }
  console.log('  \u2713 scope-carrying commands document a free-form argument matching the skill table');

  // --- 4. Fail-closed claims match the command files ---------------------

  for (const name of failClosed) {
    const usage = documentedUsage(name);
    if (usage.kind === 'none') {
      assert.ok(!usage.usesArguments, `/${name} gained $ARGUMENTS — reclassify the skill`);
      continue;
    }
    // Commands with a documented form may only take bracket-optional refs
    // ([pr-number], [path], [pattern]) — never a required <free-form> argument.
    assert.ok(!/<[^>]+>/.test(usage.text), `/${name} gained a required argument (${usage.text}) — reclassify the skill`);
    assert.ok(
      !/description/i.test(usage.text),
      `/${name} argument form now mentions a description — it may carry plan scope; reclassify`
    );
  }
  console.log('  \u2713 fail-closed commands still document no free-form scope-carrying argument');

  // --- 5. Fail-closed rule and BLOCKED marker are stated -----------------

  assert.ok(/fail closed/i.test(markdown), 'fail-closed rule must be stated');
  assert.ok(/cannot carry plan scope/.test(markdown), 'the BLOCKED reason must be stated');
  assert.ok(/excluded from the Batch execution block/.test(markdown), 'blocked steps must be excluded from the Batch block');
  console.log('  \u2713 fail-closed rule and BLOCKED marker are stated');

  // --- 6. Chain machinery stays gone -------------------------------------

  const chainMachinery = /Agent chain catalogue|Chain composition|Default agent chain|\*\*Agent chain\*\*/;
  assert.ok(!chainMachinery.test(markdown), 'agent-chain machinery must stay removed — commands own their execution');
  assert.ok(!/orchestrate custom/i.test(markdown), 'retired orchestrate custom form must stay removed');
  console.log('  \u2713 no agent-chain machinery claims remain');

  // --- 7. Examples: emitted commands carry the marker ---------------------

  const fences = [...markdown.matchAll(/```(?:bash|text)\r?\n([\s\S]*?)```/g)].map(match => match[1]);
  let checked = 0;
  for (const fence of fences) {
    for (const line of fence.split('\n')) {
      const command = line.trim().match(/^\/([a-z][a-z0-9-]*)\b/);
      if (!command) {
        continue;
      }
      checked += 1;
      const name = command[1];
      assert.ok(emitCommands.has(name), `example emits /${name}, which is not in the catalogue`);
      if (carrying.has(name)) {
        assert.ok(line.includes('[Plan:'), `emitted /${name} example must carry the [Plan: ...] scope marker`);
      } else {
        const idx = markdown.indexOf(fence);
        const context = markdown.slice(Math.max(0, idx - 400), idx);
        assert.ok(/BLOCKED|run manually/.test(context), `/${name} appears in a fence without a blocked/manual-use context`);
      }
    }
  }
  assert.ok(checked >= 3, `expected at least 3 command examples, checked ${checked}`);
  console.log(`  \u2713 emitted examples carry the scope marker (${checked} checked)`);

  console.log('  plan-orchestrate registry fixtures passed');
}

try {
  run();
} catch (error) {
  console.log('  \u2717 plan-orchestrate registry fixtures');
  console.log(`    Error: ${error.message}`);
  process.exitCode = 1;
}
