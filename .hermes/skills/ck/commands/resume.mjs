#!/usr/bin/env node
/**
 * ck — Context Keeper v2
 * resume.mjs — full project briefing
 *
 * Usage: node resume.mjs [name|number]
 * stdout: bordered briefing box
 * exit 0: success  exit 1: not found
 */

import { existsSync } from 'fs';
import { resolveContext, renderBriefingBox } from './shared.mjs';

const arg = process.argv[2];
const cwd = process.env.PWD || process.cwd();

const resolved = resolveContext(arg, cwd);
if (!resolved) {
  const hint = arg ? `No project matching "${arg}".` : 'This directory is not registered.';
  console.log(`${hint} Run /ck:init to register it.`);
  process.exit(1);
}

const { context, projectPath } = resolved;

// Attempt to cd to the project path
if (projectPath && projectPath !== cwd) {
  if (existsSync(projectPath)) {
    console.log(`→ cd ${projectPath}`);
  } else {
    console.log(`WARNING Path not found: ${projectPath}`);
  }
}

console.log('');
console.log(renderBriefingBox(context));
