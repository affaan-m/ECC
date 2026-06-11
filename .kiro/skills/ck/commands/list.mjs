#!/usr/bin/env node
/**
 * ck — Context Keeper v2
 * list.mjs — portfolio view of all registered projects
 *
 * Usage: node list.mjs
 * stdout: ASCII table of all projects + prompt to resume
 * exit 0: success  exit 1: no projects
 */

import { readProjects, loadContext, today, renderListTable } from './shared.mjs';

const cwd = process.env.PWD || process.cwd();
const projects = readProjects();
const entries = Object.entries(projects);

if (entries.length === 0) {
  console.log('No projects registered. Run /ck:init to get started.');
  process.exit(1);
}

// Build enriched list sorted alphabetically by contextDir
const enriched = entries
  .map(([path, info]) => {
    const context = loadContext(info.contextDir);
    return {
      name: info.name,
      contextDir: info.contextDir,
      path,
      context,
      lastUpdated: info.lastUpdated,
    };
  })
  .sort((a, b) => a.contextDir.localeCompare(b.contextDir));

const table = renderListTable(enriched, cwd, today());
console.log('');
console.log(table);
console.log('');
console.log('Resume which? (number or name)');
