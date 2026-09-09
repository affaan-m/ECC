'use strict';

const crypto = require('crypto');

const LOGICAL_ENV_REF = /^env:[A-Z_][A-Z0-9_]*$/;
const PRODUCTION_LOGICAL_REF = /^(?:broker|vault|secret-manager):\/\/[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const ENV_NAME = /^[A-Z_][A-Z0-9_]*$/;
const DEFAULT_MAX_TTL_MS = 15 * 60 * 1000;
const TIER_TWO_BACKENDS = new Set(['lume', 'lima', 'tart']);

function nowIso(now) {
  return new Date(now).toISOString();
}

function deny(reason) {
  return {
    status: 'denied',
    reason,
    environment: {},
    receipts: [],
  };
}

function arrayIncludesAll(values = [], required = []) {
  const set = new Set(values);
  return required.every(value => set.has(value));
}

function normalizeStringArray(value, name) {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || item.length === 0)) {
    throw new Error(`${name} must be a non-empty string array`);
  }
  return [...value];
}

function validateGrantShape(grant) {
  if (!grant || typeof grant !== 'object' || Array.isArray(grant)) {
    throw new Error('credential grants must be objects');
  }
  if (!isLogicalCredentialRef(grant.logical_ref)) {
    throw new Error('credential grants must use logical credential refs such as env:NPM_TOKEN, broker://name, vault://name, or secret-manager://name');
  }
  if (!ENV_NAME.test(grant.expose_as || '')) {
    throw new Error('credential expose_as must be an environment variable name');
  }
  normalizeStringArray(grant.backends, 'credential backends');
  normalizeStringArray(grant.trust, 'credential trust');
  normalizeStringArray(grant.scopes, 'credential scopes');
  normalizeStringArray(grant.capabilities, 'credential capabilities');
  normalizeStringArray(grant.network, 'credential network policy');
  if (typeof grant.provider !== 'string' || grant.provider.length === 0) {
    throw new Error('credential provider must be a non-empty string');
  }
  if (typeof grant.audience !== 'string' || grant.audience.length === 0) {
    throw new Error('credential audience must be a non-empty string');
  }
  if (!Number.isInteger(grant.ttl_ms) || grant.ttl_ms < 1 || grant.ttl_ms > DEFAULT_MAX_TTL_MS) {
    throw new Error(`credential ttl_ms must be between 1 and ${DEFAULT_MAX_TTL_MS}`);
  }
}

function isTestEnvironmentRef(ref) {
  return LOGICAL_ENV_REF.test(ref || '');
}

function isProductionCredentialRef(ref) {
  return PRODUCTION_LOGICAL_REF.test(ref || '');
}

function isLogicalCredentialRef(ref) {
  return isTestEnvironmentRef(ref) || isProductionCredentialRef(ref);
}

function createEnvironmentSourceProvider(options = {}) {
  const sourceEnv = { ...(options.env || {}) };
  const allowedRefs = options.allowed_refs ? new Set(options.allowed_refs) : null;
  const audiences = options.audiences ? new Set(options.audiences) : null;
  const scopes = options.scopes ? new Set(options.scopes) : null;
  return {
    name: 'environment-source-test',
    available: options.enabled === true,
    kind: 'test-only',
    resolve(grant) {
      if (options.enabled !== true) return { ok: false, reason: 'provider unavailable' };
      if (!isTestEnvironmentRef(grant.logical_ref)) {
        return { ok: false, reason: 'environment-source test provider only resolves env: credential refs' };
      }
      if (allowedRefs && !allowedRefs.has(grant.logical_ref)) {
        return { ok: false, reason: 'credential ref is not registered with provider' };
      }
      if (audiences && !audiences.has(grant.audience)) {
        return { ok: false, reason: 'credential audience is not allowed by provider' };
      }
      if (scopes && !arrayIncludesAll([...scopes], grant.scopes)) {
        return { ok: false, reason: 'credential scope is not allowed by provider' };
      }
      const envName = grant.logical_ref.slice('env:'.length);
      if (!Object.prototype.hasOwnProperty.call(sourceEnv, envName)) {
        return { ok: false, reason: 'credential source is unavailable' };
      }
      return { ok: true, value: String(sourceEnv[envName]) };
    },
  };
}

function createExactValueRedactor() {
  const values = new Set();
  return {
    add(value) {
      const text = String(value || '');
      if (text.length > 0) values.add(text);
    },
    redact(text) {
      let output = String(text || '');
      for (const value of values) {
        output = output.split(value).join('[REDACTED]');
      }
      return output;
    },
    size() {
      return values.size;
    },
  };
}

class CredentialBroker {
  constructor(options = {}) {
    this.now = options.now || (() => Date.now());
    this.providers = new Map();
    this.leases = new Map();
    this.redactor = options.redactor || createExactValueRedactor();
    for (const provider of options.providers || []) {
      if (provider?.name) this.providers.set(provider.name, provider);
    }
  }

  validateGrantContext(grant, manifest, route) {
    try {
      validateGrantShape(grant);
    } catch (error) {
      if (/logical credential refs/.test(error.message)) throw error;
      return error.message;
    }
    const capabilities = manifest?.needs?.capabilities || [];
    const trust = manifest?.needs?.trust;
    if (!grant.backends.includes(route?.backend)) return 'credential backend is not allowed';
    if (!grant.trust.includes(trust)) return 'credential trust level is not allowed';
    if (!arrayIncludesAll(capabilities, grant.capabilities)) {
      return 'credential capability requirement is not declared by manifest';
    }
    if (!arrayIncludesAll(capabilities, grant.network)) {
      return 'credential network policy is not declared by manifest';
    }
    if (
      (route?.tier === 2 || TIER_TWO_BACKENDS.has(route?.backend))
      && grant.allow_tier2 !== true
    ) {
      return 'Tier 2 credential exposure must be explicitly allowed by the grant';
    }
    return null;
  }

  issueLease(request = {}) {
    const grants = Array.isArray(request.grants) ? request.grants : [];
    if (grants.length === 0) return deny('no credential grants requested');
    const environment = {};
    const receipts = [];
    const plannedLeases = [];
    for (const grant of grants) {
      const contextError = this.validateGrantContext(grant, request.manifest, request.route);
      if (contextError) return deny(contextError);
      const provider = this.providers.get(grant.provider);
      if (!provider || provider.available !== true || typeof provider.resolve !== 'function') {
        return deny(`credential provider unavailable: ${grant.provider}`);
      }
      if (isTestEnvironmentRef(grant.logical_ref) && provider.kind !== 'test-only') {
        return deny('env: credential refs require a test-only provider');
      }
      if (isProductionCredentialRef(grant.logical_ref) && provider.kind === 'test-only') {
        return deny('production credential refs require a production credential provider');
      }
      const resolved = provider.resolve(grant);
      if (!resolved?.ok) return deny(resolved?.reason || 'credential provider denied request');
      const issuedAt = this.now();
      const receipt = {
        schema_version: 1,
        lease_id: `cred_${crypto.randomBytes(12).toString('hex')}`,
        provider: grant.provider,
        logical_ref: grant.logical_ref,
        expose_as: grant.expose_as,
        audience: grant.audience,
        scopes: [...grant.scopes],
        backend: request.route.backend,
        tier: request.route.tier,
        trust: request.manifest.needs.trust,
        issued_at: nowIso(issuedAt),
        expires_at: nowIso(issuedAt + grant.ttl_ms),
      };
      plannedLeases.push({
        receipt,
        value: resolved.value,
        expires_ms: issuedAt + grant.ttl_ms,
        revoked: false,
      });
      environment[grant.expose_as] = resolved.value;
      receipts.push(receipt);
    }
    for (const lease of plannedLeases) {
      this.leases.set(lease.receipt.lease_id, lease);
      this.redactor.add(lease.value);
    }
    return {
      status: 'issued',
      environment,
      receipt: receipts[0],
      receipts,
      redactor: this.redactor,
    };
  }

  resolveLease(leaseId) {
    const lease = this.leases.get(leaseId);
    if (!lease || lease.revoked) return null;
    const expired = this.now() >= lease.expires_ms;
    if (expired) return { receipt: lease.receipt, expired: true };
    return {
      receipt: lease.receipt,
      value: lease.value,
      expired: false,
    };
  }

  revokeLease(leaseId) {
    const lease = this.leases.get(leaseId);
    if (!lease) return { revoked: false };
    lease.revoked = true;
    this.leases.delete(leaseId);
    return { revoked: true, lease_id: leaseId };
  }

  activeLeases() {
    return [...this.leases.values()].filter(lease => (
      !lease.revoked && this.now() < lease.expires_ms
    )).map(lease => ({ ...lease.receipt }));
  }
}

module.exports = {
  CredentialBroker,
  createEnvironmentSourceProvider,
  createExactValueRedactor,
};
