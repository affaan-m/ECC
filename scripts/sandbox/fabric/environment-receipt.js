'use strict';

const crypto = require('crypto');

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const SHA256_REF_PATTERN = /^sha256:[a-f0-9]{64}$/;
const CREDENTIAL_LEASE_ID_PATTERN = /^cred_[a-f0-9]{24,64}$/;
const LOGICAL_CREDENTIAL_REF_PATTERN = /^(?:env:[A-Z_][A-Z0-9_]*|(?:broker|vault|secret-manager):\/\/[A-Za-z0-9][A-Za-z0-9._/-]*)$/;
const ENV_NAME_PATTERN = /^[A-Z_][A-Z0-9_]*$/;
const TIMESTAMP_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{3})?Z$/;

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => (
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    )).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function digestObject(value) {
  return sha256(canonicalJson(value));
}

function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function normalizeDigest(value, label) {
  const raw = String(value || '').toLowerCase();
  if (SHA256_REF_PATTERN.test(raw)) return raw;
  if (SHA256_PATTERN.test(raw)) return raw;
  throw new Error(`${label} must be a sha256 digest`);
}

function requireString(value, label, pattern = null) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  if (pattern && !pattern.test(value)) throw new Error(`${label} is invalid`);
  return value;
}

function normalizeStringArray(value, label) {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || item.length === 0)) {
    throw new Error(`${label} must be an array of non-empty strings`);
  }
  if (new Set(value).size !== value.length) throw new Error(`${label} must not contain duplicates`);
  return Object.freeze([...value]);
}

function normalizeBackend(backend = {}) {
  const input = requireObject(backend, 'backend receipt input');
  const digest = input.image_digest || input.snapshot_digest || input.seed_digest || input.digest;
  if (!digest) throw new Error('backend receipt input requires a digest-bound image, snapshot, or seed digest');
  return Object.freeze({
    ...input,
    digest: normalizeDigest(digest, 'backend digest'),
  });
}

function normalizeWorkspace(workspace = {}) {
  const input = requireObject(workspace, 'workspace receipt input');
  const mode = input.mode || 'source';
  if (!['source', 'worktree', 'snapshot'].includes(mode)) {
    throw new Error(`unsupported workspace receipt mode: ${mode}`);
  }
  const normalized = { ...input, mode };
  if (input.source_digest) {
    normalized.source_digest = normalizeDigest(input.source_digest, 'workspace source digest');
  }
  if (input.patch_digest) {
    normalized.patch_digest = normalizeDigest(input.patch_digest, 'workspace patch digest');
  }
  return Object.freeze(normalized);
}

function normalizeCredentials(credentials = {}) {
  const grants = Array.isArray(credentials.grants) ? credentials.grants : [];
  return Object.freeze({
    grants: Object.freeze(grants.map(grant => {
      const input = requireObject(grant, 'credential grant');
      if (
        input.digest !== undefined
        || input.value_digest !== undefined
        || input.value_sha256 !== undefined
        || input.secret_digest !== undefined
      ) {
        throw new Error('credential receipt must not contain secret or value digests');
      }
      if (!CREDENTIAL_LEASE_ID_PATTERN.test(String(input.lease_id || ''))) {
        throw new Error('credential lease_id is invalid');
      }
      if (input.schema_version !== undefined && input.schema_version !== 1) {
        throw new Error('credential receipt schema_version must be 1');
      }
      const tier = input.tier;
      if (!Number.isInteger(tier) || tier < 0 || tier > 3) throw new Error('credential tier is invalid');
      return Object.freeze({
        schema_version: 1,
        lease_id: input.lease_id,
        provider: requireString(input.provider, 'credential provider', /^[A-Za-z0-9._:-]{1,120}$/),
        logical_ref: requireString(input.logical_ref, 'credential logical_ref', LOGICAL_CREDENTIAL_REF_PATTERN),
        expose_as: requireString(input.expose_as, 'credential expose_as', ENV_NAME_PATTERN),
        audience: requireString(input.audience, 'credential audience', /^[A-Za-z0-9._:/@*-]{1,240}$/),
        scopes: normalizeStringArray(input.scopes, 'credential scopes'),
        backend: requireString(input.backend, 'credential backend', /^[A-Za-z0-9._:-]{1,120}$/),
        tier,
        trust: requireString(input.trust, 'credential trust', /^(?:first-party|untrusted)$/),
        issued_at: requireString(input.issued_at, 'credential issued_at', TIMESTAMP_PATTERN),
        expires_at: requireString(input.expires_at, 'credential expires_at', TIMESTAMP_PATTERN),
      });
    })),
  });
}

function stableRoute(route) {
  const input = requireObject(route, 'route receipt input');
  return Object.freeze({
    os: input.os,
    arch: input.arch,
    backend: input.backend,
    tier: input.tier,
    rule: input.rule || null,
  });
}

function buildEnvironmentReceipt(options = {}) {
  const manifest = requireObject(options.manifest, 'manifest receipt input');
  const route = stableRoute(options.route);
  const inputs = Object.freeze({
    manifest: Object.freeze({
      digest: digestObject(manifest),
      name: manifest.name || null,
      needs: manifest.needs,
      resources: manifest.resources,
      report: manifest.report,
    }),
    route,
    backend: normalizeBackend(options.backend),
    workspace: normalizeWorkspace(options.workspace || { mode: 'source' }),
    credentials: normalizeCredentials(options.credentials || {}),
  });
  const digest = digestObject(inputs);
  return Object.freeze({
    schema_version: 1,
    state: 'quarantine',
    digest,
    cache_key: environmentCacheKey({ digest }),
    created_at: options.createdAt || new Date().toISOString(),
    inputs,
  });
}

function environmentCacheKey(receipt) {
  const digest = normalizeDigest(receipt?.digest, 'environment receipt digest');
  return `env_${digest}`;
}

module.exports = {
  buildEnvironmentReceipt,
  canonicalJson,
  digestObject,
  environmentCacheKey,
  normalizeDigest,
  sha256,
};
