'use strict';

/**
 * Replay-safe tool calls: declared determinism and effect class per tool,
 * content-addressed fixtures, and fail-closed replay.
 *
 * Framework 4 of the eval-harness set (replay-safe branch and diff, first
 * slices). Modes:
 *   record  call the live implementation, store the response under the
 *           canonical hash of (tool, args);
 *   replay  never call the live implementation; return the stored response
 *           or fail with tool.fixture_missing. Tools declared SE3 or above
 *           fail with tool.effect_forbidden regardless of fixtures.
 *
 * Money-touching or counterparty-facing tools never get permissive replay.
 */

const fs = require('fs');
const path = require('path');

const { canonicalJson, hashValue } = require('./canonical');
const envelope = require('./envelope');

class ReplayError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ReplayError';
    this.code = code;
    Object.assign(this, details);
  }
}

class FixtureStore {
  constructor(dir) {
    this.dir = path.resolve(dir);
    fs.mkdirSync(this.dir, { recursive: true });
  }

  key(tool, args) {
    return hashValue({ tool, args });
  }

  pathFor(key) {
    return path.join(this.dir, `${key}.json`);
  }

  has(tool, args) {
    return fs.existsSync(this.pathFor(this.key(tool, args)));
  }

  put(tool, args, response) {
    const key = this.key(tool, args);
    const record = {
      key,
      tool,
      args_hash: hashValue(args),
      response_hash: hashValue(response),
      response,
    };
    fs.writeFileSync(this.pathFor(key), canonicalJson(record) + '\n', 'utf8');
    return record;
  }

  get(tool, args) {
    const key = this.key(tool, args);
    const filePath = this.pathFor(key);
    if (!fs.existsSync(filePath)) {
      throw new ReplayError('tool.fixture_missing', `no fixture for ${tool} (${key.slice(0, 16)})`, { tool, key });
    }
    let record;
    try {
      record = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (_error) {
      throw new ReplayError('tool.fixture_corrupt', `fixture ${key.slice(0, 16)} is not valid JSON`, { tool, key });
    }
    if (record.tool !== tool || record.args_hash !== hashValue(args)) {
      throw new ReplayError('tool.fixture_mismatch', `fixture ${key.slice(0, 16)} was recorded for different arguments`, { tool, key });
    }
    if (record.response_hash !== hashValue(record.response)) {
      throw new ReplayError('tool.fixture_mismatch', `fixture ${key.slice(0, 16)} response hash does not match its content`, { tool, key });
    }
    return record;
  }
}

/**
 * tools: { name: { effect_class, determinism: 'deterministic'|'nondeterministic', impl(args) } }
 * options: { mode: 'record'|'replay', store: FixtureStore, maxEffectClass: 'SE2', onCall(entry) }
 */
function createReplayer(tools, options = {}) {
  const mode = options.mode || 'replay';
  const store = options.store;
  const maxRank = envelope.effectRank(options.maxEffectClass || 'SE2');
  if (!['record', 'replay'].includes(mode)) {
    throw new ReplayError('replay.bad_mode', `mode must be record or replay, got ${mode}`);
  }
  if (!store) {
    throw new ReplayError('replay.no_store', 'a FixtureStore is required');
  }
  for (const [name, tool] of Object.entries(tools)) {
    if (!envelope.EFFECT_CLASSES.includes(tool.effect_class)) {
      throw new ReplayError('replay.bad_declaration', `tool ${name} must declare an effect_class`);
    }
    if (!['deterministic', 'nondeterministic'].includes(tool.determinism)) {
      throw new ReplayError('replay.bad_declaration', `tool ${name} must declare determinism`);
    }
  }

  const calls = [];
  const emit = (entry) => {
    calls.push(entry);
    if (typeof options.onCall === 'function') {
      options.onCall(entry);
    }
  };

  return {
    mode,
    calls,
    call(name, args = {}) {
      const tool = tools[name];
      if (!tool) {
        throw new ReplayError('tool.unknown', `tool ${name} is not declared`);
      }
      const rank = envelope.effectRank(tool.effect_class);
      if (rank > maxRank) {
        emit({ tool: name, mode, status: 'refused', code: 'tool.effect_forbidden' });
        throw new ReplayError('tool.effect_forbidden', `tool ${name} is ${tool.effect_class}, above the allowed ${options.maxEffectClass || 'SE2'}`, { tool: name });
      }
      if (mode === 'replay') {
        if (rank >= envelope.effectRank('SE3')) {
          emit({ tool: name, mode, status: 'refused', code: 'tool.effect_forbidden' });
          throw new ReplayError('tool.effect_forbidden', `tool ${name} (${tool.effect_class}) can never be replayed`, { tool: name });
        }
        const record = store.get(name, args);
        emit({ tool: name, mode, status: 'replayed', fixture_key: record.key, args_hash: record.args_hash, response_hash: record.response_hash });
        return record.response;
      }
      const response = tool.impl(args);
      const record = store.put(name, args, response);
      emit({ tool: name, mode, status: 'recorded', fixture_key: record.key, args_hash: record.args_hash, response_hash: record.response_hash });
      return response;
    },
  };
}

module.exports = {
  ReplayError,
  FixtureStore,
  createReplayer,
  EFFECT_FENCE_PRELOAD: path.join(__dirname, 'effect-fence.js'),
};
