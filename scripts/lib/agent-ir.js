#!/usr/bin/env node
'use strict';

/**
 * ECC Agent IR — parser.
 *
 * Reads ECC's canonical agent files (Claude frontmatter markdown) and emits
 * harness-neutral IR objects validated against `schemas/agent.schema.json`.
 *
 * Design constraints:
 *   - Deterministic: stable key order, no ambient state.
 *   - Lossless: the raw frontmatter is retained so emitters can round-trip.
 *   - Strict: invalid model tiers and non-string tool entries are rejected,
 *     never silently coerced or dropped.
 *   - No shell, no network, no new dependencies (uses `js-yaml` + `ajv`,
 *     which are already in `package.json`).
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const Ajv = require('ajv');

const AGENTS_DIR = path.join(__dirname, '..', '..', 'agents');
const SCHEMA_PATH = path.join(__dirname, '..', '..', 'schemas', 'agent.schema.json');

const IR_SCHEMA_CONST = 'ecc.agent-ir.v1';
const VALID_MODELS = ['haiku', 'sonnet', 'opus'];

let _ajv = null;
function ajv() {
  if (!_ajv) {
    _ajv = new Ajv({ allErrors: true, strict: false });
    const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
    _ajv.addSchema(schema, IR_SCHEMA_CONST);
  }
  return _ajv;
}

/** Split frontmatter + body, tolerating UTF-8 BOM and LF/CRLF. */
function splitFrontmatter(content) {
  const clean = content.replace(/^\uFEFF/, '');
  const match = clean.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return { frontmatter: null, body: null };
  }
  return { frontmatter: match[1], body: match[2] || '' };
}

/**
 * Normalize a frontmatter `tools` value to a string[].
 * Claude agents use comma-separated strings (e.g. `Read, Grep, Glob`).
 * Non-string scalars and non-string array entries are rejected.
 */
function normalizeTools(value, filename) {
  if (value === null || value === undefined) return [];

  const entries = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : null;

  if (entries === null) {
    throw new Error(`${filename}: tools must be a comma-separated string or a list of strings`);
  }

  const tools = [];
  for (const entry of entries) {
    if (typeof entry !== 'string') {
      throw new Error(`${filename}: tools must contain only strings`);
    }
    const trimmed = entry.trim();
    if (trimmed) tools.push(trimmed);
  }
  return tools;
}

/** Parse one agent file into an IR object (throws on malformed input). */
function parseAgentFile(filePath) {
  const filename = path.basename(filePath);
  const id = filename.replace(/\.md$/, '');

  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    throw new Error(`${filename}: cannot read: ${err.message}`);
  }

  const { frontmatter, body } = splitFrontmatter(content);
  if (frontmatter === null) {
    throw new Error(`${filename}: missing frontmatter (expected leading --- block)`);
  }

  let raw;
  try {
    raw = yaml.load(frontmatter);
  } catch (err) {
    throw new Error(`${filename}: invalid YAML frontmatter: ${err.message}`);
  }
  if (!raw || typeof raw !== 'object') {
    throw new Error(`${filename}: frontmatter must be a YAML mapping`);
  }

  const model = raw.model;
  if (model !== undefined && !VALID_MODELS.includes(model)) {
    throw new Error(`${filename}: invalid model tier '${model}' (expected haiku, sonnet, or opus)`);
  }

  const ir = {
    schema: IR_SCHEMA_CONST,
    id,
    name: typeof raw.name === 'string' ? raw.name : id,
    description: typeof raw.description === 'string' ? raw.description : '',
    tools: normalizeTools(raw.tools, filename),
    body,
    frontmatter: raw,
    ...(model !== undefined ? { model } : {}),
    ...(raw.color !== undefined ? { color: String(raw.color) } : {}),
  };

  validateIr(ir, filename);
  return ir;
}

function validateIr(ir, filename) {
  const validate = ajv().getSchema(IR_SCHEMA_CONST);
  const ok = validate(ir);
  if (!ok) {
    const detail = (validate.errors || []).map(e => `${e.instancePath} ${e.message}`).join('; ');
    throw new Error(`${filename}: IR validation failed: ${detail}`);
  }
}

/** Parse every agent under `agents/`, sorted for determinism. */
function parseAllAgents(dir = AGENTS_DIR) {
  if (!fs.existsSync(dir)) {
    throw new Error(`agents directory not found: ${dir}`);
  }
  const files = fs
    .readdirSync(dir)
    .filter(f => f.endsWith('.md'))
    .sort();
  return files.map(f => parseAgentFile(path.join(dir, f)));
}

module.exports = {
  AGENTS_DIR,
  SCHEMA_PATH,
  IR_SCHEMA_CONST,
  VALID_MODELS,
  parseAgentFile,
  parseAllAgents,
  splitFrontmatter,
  normalizeTools,
};
