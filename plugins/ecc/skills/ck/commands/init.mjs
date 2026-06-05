#!/usr/bin/env node
/**
 * ck — Context Keeper v2
 * init.mjs — auto-detect project info and output JSON for Claude to confirm
 *
 * Usage: node init.mjs
 * stdout: JSON with auto-detected project info
 * exit 0: success  exit 1: error
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, basename } from 'path';
import { readProjects } from './shared.mjs';

const cwd = process.env.PWD || process.cwd();
const projects = readProjects();

const output = {
  path: cwd,
  name: null,
  description: null,
  stack: [],
  goal: null,
  constraints: [],
  repo: null,
  alreadyRegistered: !!projects[cwd],
};

function readFile(filename) {
  const p = resolve(cwd, filename);
  if (!existsSync(p)) return null;
  try { return readFileSync(p, 'utf8'); } catch { return null; }
}

function extractSection(md, heading) {
  const re = new RegExp(`## ${heading}\\n([\\s\\S]*?)(?=\\n## |$)`);
  const m = md.match(re);
  return m ? m[1].trim() : null;
}

// ── package.json ──────────────────────────────────────────────────────────────
const pkg = readFile('package.json');
if (pkg) {
  try {
    const parsed = JSON.parse(pkg);
    if (parsed.name && !output.name) output.name = parsed.name;
    if (parsed.description && !output.description) output.description = parsed.description;

    // Detect stack from dependencies
    const deps = Object.keys({ ...(parsed.dependencies || {}), ...(parsed.devDependencies || {}) });
    const stackMap = {
      next: 'Next.js', react: 'React', vue: 'Vue', svelte: 'Svelte', astro: 'Astro',
      express: 'Express', fastify: 'Fastify', hono: 'Hono', nestjs: 'NestJS',
      typescript: 'TypeScript', prisma: 'Prisma', drizzle: 'Drizzle',
      '@neondatabase/serverless': 'Neon', '@upstash/redis': 'Upstash Redis',
      '@clerk/nextjs': 'Clerk', stripe: 'Stripe', tailwindcss: 'Tailwind CSS',
    };
    for (const [dep, label] of Object.entries(stackMap)) {
      if (deps.includes(dep) && !output.stack.includes(label)) {
        output.stack.push(label);
      }
    }
    if (deps.includes('typescript') || existsSync(resolve(cwd, 'tsconfig.json'))) {
      if (!output.stack.includes('TypeScript')) output.stack.push('TypeScript');
    }
  } catch { /* malformed package.json */ }
}

// ── go.mod ────────────────────────────────────────────────────────────────────
const goMod = readFile('go.mod');
if (goMod) {
  if (!output.stack.includes('Go')) output.stack.push('Go');
  const modName = goMod.match(/^module\s+(\S+)/m)?.[1];
  if (modName && !output.name) output.name = modName.split('/').pop();
}

// ── Cargo.toml ────────────────────────────────────────────────────────────────
const cargo = readFile('Cargo.toml');
if (cargo) {
  if (!output.stack.includes('Rust')) output.stack.push('Rust');
  const crateName = cargo.match(/^name\s*=\s*"(.+?)"/m)?.[1];
  if (crateName && !output.name) output.name = crateName;
}

// ── pyproject.toml ────────────────────────────────────────────────────────────
const pyproject = readFile('pyproject.toml');
if (pyproject) {
  if (!output.stack.includes('Python')) output.stack.push('Python');
  const pyName = pyproject.match(/^name\s*=\s*"(.+?)"/m)?.[1];
  if (pyName && !output.name) output.name = pyName;
}

// ── .git/config (repo URL) ────────────────────────────────────────────────────
const gitConfig = readFile('.git/config');
if (gitConfig) {
  const repoMatch = gitConfig.match(/url\s*=\s*(.+)/);
  if (repoMatch) output.repo = repoMatch[1].trim();
}

// ── CLAUDE.md ─────────────────────────────────────────────────────────────────
const claudeMd = readFile('CLAUDE.md');
if (claudeMd) {
  const goal = extractSection(claudeMd, 'Current Goal');
  if (goal && !output.goal) output.goal = goal.split('\n')[0].trim();

  const doNot = extractSection(claudeMd, 'Do Not Do');
  if (doNot) {
    const bullets = doNot.split('\n')
      .filter(l => /^[-*]\s+/.test(l))
      .map(l => l.replace(/^[-*]\s+/, '').trim());
    output.constraints = bullets;
  }

  const stack = extractSection(claudeMd, 'Tech Stack');
  if (stack && output.stack.length === 0) {
    output.stack = stack.split(/[,\n]/).map(s => s.replace(/^[-*]\s+/, '').trim()).filter(Boolean);
  }

  // Description from first section or "What This Is"
  const whatItIs = extractSection(claudeMd, 'What This Is') || extractSection(claudeMd, 'About');
  if (whatItIs && !output.description) output.description = whatItIs.split('\n')[0].trim();
}

// ── README.md (description fallback) ─────────────────────────────────────────
const readme = readFile('README.md');
if (readme && !output.description) {
  // First non-header, non-badge, non-empty paragraph
  const lines = readme.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('!') && !trimmed.startsWith('>') && !trimmed.startsWith('[') && trimmed !== '---' && trimmed !== '___') {
      output.description = trimmed.slice(0, 120);
      break;
    }
  }
}

// ── Name fallback: directory name ─────────────────────────────────────────────
if (!output.name) {
  output.name = basename(cwd).toLowerCase().replace(/\s+/g, '-');
}

console.log(JSON.stringify(output, null, 2));
