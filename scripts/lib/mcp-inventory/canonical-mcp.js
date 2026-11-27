'use strict';

const MCP_SCHEMA_VERSION = 'ecc.mcp.v1';

// Env keys whose values are almost always secrets. Used only to flag a server
// as carrying credentials; values are NEVER copied into the canonical record.
const SECRET_KEY_PATTERN = /(token|secret|key|password|passwd|auth|credential|api[_-]?key|access[_-]?key|private)/i;

const REDACTED = '***';

// Known secret value prefixes (provider API keys) plus a high-entropy fallback.
const SECRET_VALUE_PATTERNS = [
  /^sk-[A-Za-z0-9_-]{16,}$/i,            // OpenAI / Anthropic (sk-ant-...)
  /^ghp_[A-Za-z0-9]{16,}$/,             // GitHub PAT (classic)
  /^github_pat_[A-Za-z0-9_]{16,}$/,     // GitHub PAT (fine-grained)
  /^gh[oprs]_[A-Za-z0-9]{16,}$/,        // other GitHub tokens
  /^sm_[A-Za-z0-9_-]{16,}$/,            // Supermemory
  /^AIza[A-Za-z0-9_-]{16,}$/,           // Google API key
  /^xox[baprs]-[A-Za-z0-9-]{10,}$/,     // Slack
  /^(pb|sk|pk|rk)_(live|test)_[A-Za-z0-9]{12,}$/i // Stripe / PostBridge-style
];

// A CLI flag whose following value is a secret (e.g. --modelApiKey sk-...).
const SECRET_FLAG_PATTERN = /(^|[-_])(api[-_]?key|apikey|token|secret|password|passwd|auth|credential|access[-_]?key|private[-_]?key)$/i;

function looksLikeSecretValue(value) {
  if (typeof value !== 'string') {
    return false;
  }

  if (SECRET_VALUE_PATTERNS.some(pattern => pattern.test(value))) {
    return true;
  }

  // High-entropy fallback: a long opaque token (letters AND digits, no path or
  // package separators) is almost certainly a credential, not a flag value.
  return value.length >= 32
    && /^[A-Za-z0-9_+/=.-]+$/.test(value)
    && /[A-Za-z]/.test(value)
    && /[0-9]/.test(value)
    && !value.includes('/')
    && !value.includes('@');
}

// Redact secret values from a command arg vector: any token that looks like a
// credential, or any token that immediately follows a secret-named flag. The
// flag names themselves are preserved so the command shape stays legible.
function redactArgs(args) {
  const list = Array.isArray(args) ? args : [];
  const result = [];

  for (let index = 0; index < list.length; index += 1) {
    const current = list[index];
    if (typeof current !== 'string') {
      continue;
    }

    // Inline form: --flag=secret
    const inlineMatch = current.match(/^(--?[A-Za-z0-9_-]+)=(.+)$/);
    if (inlineMatch && (SECRET_FLAG_PATTERN.test(inlineMatch[1].replace(/^--?/, '')) || looksLikeSecretValue(inlineMatch[2]))) {
      result.push(`${inlineMatch[1]}=${REDACTED}`);
      continue;
    }

    const previous = index > 0 ? list[index - 1] : null;
    const followsSecretFlag = typeof previous === 'string'
      && /^--?[A-Za-z0-9_-]+$/.test(previous)
      && SECRET_FLAG_PATTERN.test(previous.replace(/^--?/, ''));

    if (followsSecretFlag || looksLikeSecretValue(current)) {
      result.push(REDACTED);
      continue;
    }

    result.push(current);
  }

  return result;
}

// Redact embedded credentials in a server URL (userinfo + token query params).
function redactUrl(url) {
  if (typeof url !== 'string' || url.length === 0) {
    return url;
  }

  let safe = url.replace(/\/\/[^/@]+@/, `//${REDACTED}@`);
  safe = safe.replace(/([?&](?:token|key|api[_-]?key|access[_-]?token|secret)=)[^&]+/gi, `$1${REDACTED}`);
  return safe;
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function asStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(item => typeof item === 'string');
}

// Normalize a transport label across harnesses:
//   Claude:   type "stdio" | "http" | "sse"
//   OpenCode: type "local" (stdio) | "remote" (http/sse)
//   Codex:    no type; presence of url => http, else stdio
function normalizeTransport(rawType, { url } = {}) {
  const type = typeof rawType === 'string' ? rawType.toLowerCase() : '';

  if (type === 'http' || type === 'streamable-http' || type === 'streamable_http') {
    return 'http';
  }

  if (type === 'sse') {
    return 'sse';
  }

  if (type === 'stdio' || type === 'local') {
    return 'stdio';
  }

  if (type === 'remote') {
    return url ? 'http' : 'stdio';
  }

  return url ? 'http' : 'stdio';
}

// Extract env KEY names only (never values). Flags whether any key looks secret.
function summarizeEnv(env) {
  if (!isObject(env)) {
    return { envKeys: [], hasSecrets: false };
  }

  const envKeys = Object.keys(env).sort();
  const hasSecrets = envKeys.some(key => SECRET_KEY_PATTERN.test(key));
  return { envKeys, hasSecrets };
}

// A stable identity for de-duplication across harnesses. Two server configs
// with the same transport + command + args + url collapse to one logical
// server even if their names differ slightly.
function buildSignature({ transport, command, args, url }) {
  if (transport === 'http' || transport === 'sse') {
    return `${transport}:${url || ''}`;
  }

  const argString = asStringArray(args).join(' ');
  return `stdio:${[command, argString].filter(Boolean).join(' ')}`.trim();
}

// Normalize a single raw server entry (from any reader) to ecc.mcp.v1 shape.
// rawServer fields the readers already pre-split: name, type, command, args,
// url, env, enabled, source { harness, scope, configPath }.
function normalizeServerEntry(rawServer) {
  const name = asNonEmptyString(rawServer.name) || 'unknown';
  const command = asNonEmptyString(rawServer.command);
  const rawUrl = asNonEmptyString(rawServer.url);
  const rawArgs = asStringArray(rawServer.args);
  const transport = normalizeTransport(rawServer.type, { url: rawUrl });
  const { envKeys, hasSecrets } = summarizeEnv(rawServer.env);

  // Secrets can hide in args (e.g. --modelApiKey sk-...) and URLs, not just
  // env. Redact before anything is stored or hashed into the signature.
  const args = redactArgs(rawArgs);
  const url = redactUrl(rawUrl);
  const argsCarrySecret = rawArgs.length !== args.length
    || rawArgs.some((value, index) => value !== args[index]);
  const urlCarriesSecret = rawUrl !== url;

  const source = isObject(rawServer.source) ? rawServer.source : {};

  return {
    name,
    transport,
    command: transport === 'stdio' ? command : null,
    args: transport === 'stdio' ? args : [],
    url: transport === 'stdio' ? null : url,
    envKeys,
    hasSecrets: hasSecrets || argsCarrySecret || urlCarriesSecret,
    enabled: rawServer.enabled === false ? false : true,
    signature: buildSignature({ transport, command, args, url }),
    sources: [{
      harness: asNonEmptyString(source.harness) || 'unknown',
      scope: asNonEmptyString(source.scope) || 'user',
      configPath: asNonEmptyString(source.configPath) || null
    }]
  };
}

// Merge many per-harness server records into a deduplicated inventory keyed by
// logical server name. Records that share a name are merged; their sources are
// concatenated and their signatures compared for drift.
function mergeServers(serverRecords) {
  const byName = new Map();

  for (const record of serverRecords) {
    const existing = byName.get(record.name);
    if (!existing) {
      byName.set(record.name, {
        ...record,
        signatures: [record.signature],
        sources: [...record.sources]
      });
      continue;
    }

    existing.sources.push(...record.sources);
    existing.signatures.push(record.signature);
    existing.hasSecrets = existing.hasSecrets || record.hasSecrets;
    // Union of env keys observed across harnesses.
    existing.envKeys = Array.from(new Set([...existing.envKeys, ...record.envKeys])).sort();
  }

  return Array.from(byName.values()).map(server => {
    const uniqueSignatures = Array.from(new Set(server.signatures));
    const { signatures: _signatures, ...rest } = server;
    return {
      ...rest,
      harnessCount: server.sources.length,
      consistent: uniqueSignatures.length <= 1
    };
  });
}

function buildFragmentation(mergedServers) {
  return mergedServers
    .filter(server => server.harnessCount > 1)
    .map(server => ({
      name: server.name,
      harnessCount: server.harnessCount,
      harnesses: server.sources.map(source => source.harness),
      consistent: server.consistent
    }))
    .sort((a, b) => b.harnessCount - a.harnessCount || a.name.localeCompare(b.name));
}

function buildInventory(serverRecords) {
  const merged = mergeServers(serverRecords).sort((a, b) => a.name.localeCompare(b.name));
  const fragmentation = buildFragmentation(merged);
  const harnesses = new Set();
  let serversWithSecrets = 0;

  for (const server of merged) {
    server.sources.forEach(source => harnesses.add(source.harness));
    if (server.hasSecrets) {
      serversWithSecrets += 1;
    }
  }

  return {
    schemaVersion: MCP_SCHEMA_VERSION,
    servers: merged,
    fragmentation,
    aggregates: {
      serverCount: merged.length,
      harnessCount: harnesses.size,
      duplicateServerCount: fragmentation.length,
      inconsistentServerCount: fragmentation.filter(item => !item.consistent).length,
      serversWithSecrets
    }
  };
}

module.exports = {
  MCP_SCHEMA_VERSION,
  SECRET_KEY_PATTERN,
  REDACTED,
  looksLikeSecretValue,
  redactArgs,
  redactUrl,
  normalizeTransport,
  summarizeEnv,
  buildSignature,
  normalizeServerEntry,
  mergeServers,
  buildFragmentation,
  buildInventory
};
