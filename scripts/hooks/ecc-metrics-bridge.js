#!/usr/bin/env node
/**
 * ECC Metrics Bridge — PostToolUse hook
 *
 * Maintains a running session aggregate in /tmp/ecc-metrics-{session}.json.
 * This bridge file is read by ecc-statusline.js and ecc-context-monitor.js,
 * avoiding the need to scan large JSONL logs on every invocation.
 */

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { sanitizeSessionId, readBridge, writeBridgeAtomic } = require('../lib/session-bridge');
const {
  readSessionCostSnapshot,
  warnSessionCostSnapshotFailure
} = require('../lib/session-cost-snapshot');
const { getClaudeDir } = require('../lib/utils');

const MAX_STDIN = 1024 * 1024;
const MAX_FILES_TRACKED = 200;
const RECENT_TOOLS_SIZE = 5;
const HASH_INPUT_LIMIT = 2048;
const WARNING_CACHE_PREFIX = 'ecc-metrics-cost-warnings-';

function stableStringify(value, depth = 0) {
  if (depth > 4) return '[depth-limit]';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(item => stableStringify(item, depth + 1)).join(',')}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map(key => `${JSON.stringify(key)}:${stableStringify(value[key], depth + 1)}`)
    .join(',')}}`;
}

/**
 * Hash tool call for loop detection.
 * Uses tool name + a key parameter when available, otherwise a stable input digest.
 */
function hashToolCall(toolName, toolInput) {
  const name = String(toolName || '');
  let key = '';
  if (name === 'Bash') {
    // Hash the FULL command (digest, not a prefix slice): taking the first
    // 160 chars collided distinct long commands that share a common prefix
    // (heredocs, long one-liners), so consecutive DIFFERENT Bash calls looked
    // like a stuck loop and triggered false LOOP WARNINGs.
    key = crypto.createHash('sha256').update(String(toolInput?.command || '')).digest('hex');
  } else if (/^(Edit|MultiEdit|Write|NotebookEdit)$/.test(name)) {
    // Fingerprint the actual change, not just the path. Hashing on file_path
    // alone made every distinct edit to the same file collide, so a few normal
    // edits to one file looked like a stuck loop. Include the edit content so
    // different edits to the same file hash differently.
    // Hash the FULL serialized payload (truncate the digest, not the input):
    // slicing the serialized string to HASH_INPUT_LIMIT first would collapse
    // large edits that share their first N chars, reviving the same false-loop
    // collision for big Write/edit payloads.
    key = crypto
      .createHash('sha256')
      .update(
        stableStringify({
          file_path: toolInput?.file_path,
          old_string: toolInput?.old_string,
          new_string: toolInput?.new_string,
          content: toolInput?.content,
          edits: toolInput?.edits
        })
      )
      .digest('hex');
  } else if (toolInput?.file_path) {
    key = String(toolInput.file_path);
  } else {
    key = stableStringify(toolInput || {}).slice(0, HASH_INPUT_LIMIT);
  }
  return crypto.createHash('sha256').update(`${name}:${key}`).digest('hex').slice(0, 8);
}

/**
 * Extract modified file paths from tool input.
 */
function extractFilePaths(toolName, toolInput) {
  const paths = [];
  if (!toolInput || typeof toolInput !== 'object') return paths;

  const fp = toolInput.file_path;
  if (fp && typeof fp === 'string') paths.push(fp);

  const edits = toolInput.edits;
  if (Array.isArray(edits)) {
    for (const edit of edits) {
      if (edit?.file_path && typeof edit.file_path === 'string') {
        paths.push(edit.file_path);
      }
    }
  }

  return paths;
}

function getCostWarningCachePath(costsPath) {
  const hash = crypto.createHash('sha256').update(costsPath).digest('hex').slice(0, 16);
  return path.join(os.tmpdir(), `${WARNING_CACHE_PREFIX}${hash}.json`);
}

function readCostWarningCache(cachePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeCostWarningIfChanged(kind, costsPath, signature, message) {
  const cachePath = getCostWarningCachePath(costsPath);
  const cache = readCostWarningCache(cachePath);
  if (cache[kind] === signature) return;

  process.stderr.write(message);
  try {
    const next = { ...cache, [kind]: signature };
    const tmp = `${cachePath}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(next), 'utf8');
    fs.renameSync(tmp, cachePath);
  } catch {
    // Warning-cache persistence is best effort; never block hook execution.
  }
}

/**
 * Read cumulative cost for a session.
 *
 * The Stop hook publishes an atomic per-session cursor snapshot, so a stable
 * PostToolUse path reads O(1) metadata and newly appended data is O(delta)
 * instead of reparsing unbounded history.
 * Older ECC installations and damaged/missing snapshots remain compatible:
 * they fall back to scanning costs.jsonl for the last cumulative row.
 *
 * The fallback deliberately scans the whole file. A fixed tail window loses
 * sessions whose newest row has been pushed back by other sessions.
 */
function readSessionCost(sessionId) {
  let costsPath = path.join('metrics', 'costs.jsonl');
  try {
    const metricsDir = path.join(getClaudeDir(), 'metrics');
    costsPath = path.join(metricsDir, 'costs.jsonl');
    const snapshotResult = readSessionCostSnapshot(metricsDir, sessionId);
    if (snapshotResult.malformed > 0) {
      writeCostWarningIfChanged(
        'malformed',
        costsPath,
        `${snapshotResult.malformed}:${snapshotResult.malformedSignature}`,
        `[ecc-metrics-bridge] skipped ${snapshotResult.malformed} malformed line(s) in ${costsPath}\n`
      );
    }
    if (snapshotResult.invalid > 0) {
      writeCostWarningIfChanged(
        'invalid-row',
        costsPath,
        `${snapshotResult.invalid}:${snapshotResult.invalidSignature}`,
        `[ecc-metrics-bridge] skipped ${snapshotResult.invalid} invalid cumulative row(s) for ${sessionId} in ${costsPath}\n`
      );
    }
    if (snapshotResult.snapshotError) {
      warnSessionCostSnapshotFailure(
        'repair',
        metricsDir,
        sessionId,
        snapshotResult.snapshotError
      );
    }
    const row = snapshotResult.row;
    return row
      ? { totalCost: row.estimated_cost_usd, totalIn: row.input_tokens, totalOut: row.output_tokens }
      : { totalCost: 0, totalIn: 0, totalOut: 0 };
  } catch (err) {
    // ENOENT is the common case (no Stop event has fired yet this session)
    // and is not actually a failure — stay silent on it. Anything else
    // (permission, EISDIR, malformed read) deserves a breadcrumb because
    // the bridge will silently report zero cost otherwise.
    if (err && err.code !== 'ENOENT') {
      writeCostWarningIfChanged(
        'read-error',
        costsPath,
        `${err.code || err.name || 'error'}:${err.message || String(err)}`,
        `[ecc-metrics-bridge] failing open after ${err.name || 'error'} reading ${costsPath}: ${err.message || String(err)}\n`
      );
    }
    return { totalCost: 0, totalIn: 0, totalOut: 0 };
  }
}

/**
 * @param {string} rawInput - Raw JSON string from stdin
 * @returns {string} Pass-through
 */
function run(rawInput) {
  try {
    const input = rawInput.trim() ? JSON.parse(rawInput) : {};
    const toolName = String(input.tool_name || '');
    const toolInput = input.tool_input || {};

    const sessionId = sanitizeSessionId(input.session_id) || sanitizeSessionId(process.env.ECC_SESSION_ID) || sanitizeSessionId(process.env.CLAUDE_SESSION_ID);

    if (!sessionId) return rawInput;

    const now = new Date().toISOString();
    const bridge = readBridge(sessionId) || {
      session_id: sessionId,
      total_cost_usd: 0,
      total_input_tokens: 0,
      total_output_tokens: 0,
      tool_count: 0,
      files_modified_count: 0,
      files_modified: [],
      recent_tools: [],
      first_timestamp: now,
      last_timestamp: now,
      context_remaining_pct: null
    };

    // Increment tool count
    bridge.tool_count = (bridge.tool_count || 0) + 1;
    bridge.last_timestamp = now;
    if (!bridge.first_timestamp) bridge.first_timestamp = now;

    // Track modified files (Write/Edit/MultiEdit only)
    const isWriteOp = /^(Write|Edit|MultiEdit)$/i.test(toolName);
    if (isWriteOp) {
      const newPaths = extractFilePaths(toolName, toolInput);
      const existing = new Set(bridge.files_modified || []);
      for (const p of newPaths) {
        if (existing.size < MAX_FILES_TRACKED && !existing.has(p)) {
          existing.add(p);
        }
      }
      bridge.files_modified = [...existing];
      bridge.files_modified_count = existing.size;
    }

    // Ring buffer for loop detection
    const recent = bridge.recent_tools || [];
    recent.push({ tool: toolName, hash: hashToolCall(toolName, toolInput) });
    if (recent.length > RECENT_TOOLS_SIZE) recent.shift();
    bridge.recent_tools = recent;

    // Use the O(1) session snapshot, with JSONL compatibility fallback.
    const costs = readSessionCost(sessionId);
    bridge.total_cost_usd = Math.round(costs.totalCost * 1e6) / 1e6;
    bridge.total_input_tokens = costs.totalIn;
    bridge.total_output_tokens = costs.totalOut;

    writeBridgeAtomic(sessionId, bridge);
  } catch {
    // Never block tool execution
  }

  return rawInput;
}

if (require.main === module) {
  let data = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    if (data.length < MAX_STDIN) data += chunk.substring(0, MAX_STDIN - data.length);
  });
  process.stdin.on('end', () => {
    process.stdout.write(run(data));
    process.exit(0);
  });
}

module.exports = { run, hashToolCall, extractFilePaths, readSessionCost, stableStringify };
