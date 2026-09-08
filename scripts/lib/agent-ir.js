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
 */
function normalizeTools(value) {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value.map(v => String(v).trim()).filter(Boolean);
  return String(value)
    .split(',')
    .map(v => v.trim())
    .filter(Boolean);
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

  const ir = {
    schema: IR_SCHEMA_CONST,
    id,
    name: typeof raw.name === 'string' ? raw.name : id,
    description: typeof raw.description === 'string' ? raw.description : '',
    model: raw.model,
    tools: normalizeTools(raw.tools),
    body,
    frontmatter: raw,
  };

  // Optional, source-only metadata. Preserved but not emitted by Pi.
  if (raw.color !== undefined) ir.color = String(raw.color);

  // Only emit `model` when it is a recognized tier; otherwise drop the field
  // rather than carry an invalid value into the validated IR.
  if (ir.model !== undefined && !['haiku', 'sonnet', 'opus'].includes(ir.model)) {
    delete ir.model;
  }

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
  if (!fs.existsSync(dir)) return [];
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
  parseAgentFile,
  parseAllAgents,
  splitFrontmatter,
  normalizeTools,
};
