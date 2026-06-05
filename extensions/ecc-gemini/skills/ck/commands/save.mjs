#!/usr/bin/env node
/**
 * ck — Context Keeper v2
 * save.mjs — write session data to context.json, regenerate CONTEXT.md,
 *             and write a native memory entry.
 *
 * Usage (regular save):
 *   echo '<json>' | node save.mjs
 *   JSON schema: { summary, leftOff, nextSteps[], decisions[{what,why}], blockers[], goal? }
 *
 * Usage (init — first registration):
 *   echo '<json>' | node save.mjs --init
 *   JSON schema: { name, path, description, stack[], goal, constraints[], repo? }
 *
 * stdout: confirmation message
 * exit 0: success  exit 1: error
 */

import { readFileSync, mkdirSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import {
  readProjects, writeProjects, loadContext, saveContext,
  today, shortId, gitSummary, nativeMemoryDir,
  CURRENT_SESSION,
} from './shared.mjs';

const isInit = process.argv.includes('--init');
const cwd    = process.env.PWD || process.cwd();

// ── Read JSON from stdin ──────────────────────────────────────────────────────
let input;
try {
  const raw = readFileSync(0, 'utf8').trim();
  if (!raw) throw new Error('empty stdin');
  input = JSON.parse(raw);
} catch (e) {
  console.error(`ck save: invalid JSON on stdin — ${e.message}`);
  console.log('Expected schema (save):  {"summary":"...","leftOff":"...","nextSteps":["..."],"decisions":[{"what":"...","why":"..."}],"blockers":["..."]}');
  console.log('Expected schema (--init): {"name":"...","path":"...","description":"...","stack":["..."],"goal":"...","constraints":["..."]}');
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// INIT MODE: first-time project registration
// ─────────────────────────────────────────────────────────────────────────────
if (isInit) {
  const { name, path: projectPath, description, stack, goal, constraints, repo } = input;

  if (!name || !projectPath) {
    console.log('ck init: name and path are required.');
    process.exit(1);
  }

  const projects = readProjects();

  // Derive contextDir (lowercase, spaces→dashes, deduplicate)
  let contextDir = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  let suffix = 2;
  const existingDirs = Object.values(projects).map(p => p.contextDir);
  while (existingDirs.includes(contextDir) && projects[projectPath]?.contextDir !== contextDir) {
    contextDir = `${contextDir.replace(/-\d+$/, '')}-${suffix++}`;
  }

  const context = {
    version: 2,
    name: contextDir,
    displayName: name,
    path: projectPath,
    description: description || null,
    stack: Array.isArray(stack) ? stack : (stack ? [stack] : []),
    goal: goal || null,
    constraints: Array.isArray(constraints) ? constraints : [],
    repo: repo || null,
    createdAt: today(),
    sessions: [],
  };

  saveContext(contextDir, context);

  // Update projects.json
  projects[projectPath] = {
    name,
    contextDir,
    lastUpdated: today(),
  };
  writeProjects(projects);

  console.log(`✓ Project '${name}' registered.`);
  console.log(`  Use /ck:save to save session state and /ck:resume to reload it next time.`);
  process.exit(0);
}

// ─────────────────────────────────────────────────────────────────────────────
// SAVE MODE: record a session
// ─────────────────────────────────────────────────────────────────────────────
const projects = readProjects();
const projectEntry = projects[cwd];

if (!projectEntry) {
  console.log("This project isn't registered yet. Run /ck:init first.");
  process.exit(1);
}

const { contextDir } = projectEntry;
let context = loadContext(contextDir);

if (!context) {
  console.log(`ck: context.json not found for '${contextDir}'. The install may be corrupted.`);
  process.exit(1);
}

// Get session ID from current-session.json
let sessionId;
try {
  const sess = JSON.parse(readFileSync(CURRENT_SESSION, 'utf8'));
  sessionId = sess.sessionId || shortId();
} catch {
  sessionId = shortId();
}

// Check for duplicate (re-save of same session)
const existingIdx = context.sessions.findIndex(s => s.id === sessionId);

const { summary, leftOff, nextSteps, decisions, blockers, goal } = input;

// Capture git activity since the last session
const lastSessionDate = context.sessions?.[context.sessions.length - 1]?.date;
const gitActivity = gitSummary(cwd, lastSessionDate);

const session = {
  id: sessionId,
  date: today(),
  summary: summary || 'Session saved',
  leftOff: leftOff || null,
  nextSteps: Array.isArray(nextSteps) ? nextSteps : (nextSteps ? [nextSteps] : []),
  decisions: Array.isArray(decisions) ? decisions : [],
  blockers: Array.isArray(blockers) ? blockers.filter(Boolean) : [],
  ...(gitActivity ? { gitActivity } : {}),
};

if (existingIdx >= 0) {
  // Update existing session (re-save)
  context.sessions[existingIdx] = session;
} else {
  context.sessions.push(session);
}

// Update goal if provided
if (goal && goal !== context.goal) {
  context.goal = goal;
}

// Save context.json + regenerate CONTEXT.md
saveContext(contextDir, context);

// Update projects.json timestamp
projects[cwd].lastUpdated = today();
writeProjects(projects);

// ── Write to native memory ────────────────────────────────────────────────────
try {
  const memDir = nativeMemoryDir(cwd);
  mkdirSync(memDir, { recursive: true });

  const memFile = resolve(memDir, `ck_${today()}_${sessionId.slice(0, 8)}.md`);
  const decisionsBlock = session.decisions.length
    ? session.decisions.map(d => `- **${d.what}**: ${d.why || ''}`).join('\n')
    : '- None this session';
  const nextBlock = session.nextSteps.length
    ? session.nextSteps.map((s, i) => `${i + 1}. ${s}`).join('\n')
    : '- None recorded';
  const blockersBlock = session.blockers.length
    ? session.blockers.map(b => `- ${b}`).join('\n')
    : '- None';

  const memContent = [
    `---`,
    `name: Session ${today()} — ${session.summary}`,
    `description: Key decisions and outcomes from ck session ${sessionId.slice(0, 8)}`,
    `type: project`,
    `source: ck`,
    `sessionId: ${sessionId}`,
    `---`,
    ``,
    `# Session: ${session.summary}`,
    ``,
    `## Decisions`,
    decisionsBlock,
    ``,
    `## Left Off`,
    session.leftOff || '—',
    ``,
    `## Next Steps`,
    nextBlock,
    ``,
    `## Blockers`,
    blockersBlock,
    ``,
    ...(gitActivity ? [`## Git Activity`, gitActivity, ``] : []),
  ].join('\n');

  writeFileSync(memFile, memContent, 'utf8');
} catch (e) {
  // Non-fatal — native memory write failure should not block the save
  process.stderr.write(`ck: warning — could not write native memory entry: ${e.message}\n`);
}

console.log(`✓ Saved. Session: ${sessionId.slice(0, 8)}`);
if (gitActivity) console.log(`  Git: ${gitActivity}`);
console.log(`  See you next time.`);
