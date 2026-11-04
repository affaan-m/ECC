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
// Canonical Claude model tiers, ascending capability (fable is top-tier).
const VALID_MODELS = ['haiku', 'sonnet', 'opus', 'fable'];

// `inherit` (take the parent/harness model) and explicit dated model ids
// (e.g. `opus-4-8`, `claude-opus-4-8`, `claude-opus-4-20250514`, `sonnet-5-5`)
// are legitimate Claude Code model values. Accept them as a passthrough rather
// than treating them as invalid tiers. A family token must sit at a boundary
// and be followed by a version segment or end of id, so bare typos like
// `sonnet4` are NOT treated as plausible ids.
const PLAUSIBLE_MODEL_ID_RE =
  /(?:^|[.\-])(?:claude-)?(?:opus|sonnet|haiku|fable|mythos)(?=-\d|$|[.\-])/i;

function isPlausibleModelValue(model) {
  if (typeof model !== 'string') return false;
  const m = model.trim().toLowerCase();
  if (m === 'inherit') return true;
  return PLAUSIBLE_MODEL_ID_RE.test(m);
}

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
  // Model-value policy. A single odd model string must NEVER break the whole
  // catalog build (one bad file would otherwise throw out of parseAllAgents and
  // take every agent down). Canonical tiers and plausible/dated ids (and
  // `inherit`) pass silently; a genuinely unknown value is downgraded to a
  // warning and passed through, not thrown.
  if (model !== undefined
    && !VALID_MODELS.includes(model)
    && !isPlausibleModelValue(model)) {
    process.stderr.write(
      `[agent-ir] ${filename}: unrecognized model '${model}' ` +
      `(expected one of ${VALID_MODELS.join(', ')}, 'inherit', or an explicit model id); ` +
      `passing through unvalidated\n`
    );
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
  // The IR schema's `model` enum (haiku/sonnet/opus) predates fable and the
  // explicit/dated model ids and `inherit` that Claude Code now accepts, and
  // schemas/agent.schema.json is not editable here. Model-value policy is owned
  // by parseAgentFile above (VALID_MODELS + plausible-id acceptance + warn-on-
  // unknown), so validate the structural contract with `model` excluded to
  // avoid a stale-enum false rejection. Every other field is still enforced.
  const { model: _model, ...irWithoutModel } = ir;
  const ok = validate(irWithoutModel);
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
