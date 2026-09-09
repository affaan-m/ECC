'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  ensurePrivateDirectory,
  validateStateRoot,
  writeJsonAtomic,
} = require('./session-store');

const MAX_PURPOSE_BYTES = 240;
const PROPOSAL_TTL_MS = 10 * 60 * 1000;
const TERMINAL_ALIASES = new Map([
  ['wezterm', 'wezterm'],
  ['terminal', 'terminal.app'],
  ['terminal.app', 'terminal.app'],
  ['macos-terminal', 'terminal.app'],
]);
const PROPOSAL_ID_PATTERN = /^proposal_[a-f0-9]{64}$/;

function validatePurpose(value) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('--purpose requires a concrete description of the behavior being tested');
  }
  // Consent text must reject every C0 control byte and DEL explicitly.
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(value)) {
    throw new Error('--purpose must not contain control bytes');
  }
  const purpose = value.trim();
  if (Buffer.byteLength(purpose, 'utf8') > MAX_PURPOSE_BYTES) {
    throw new Error(`--purpose must be at most ${MAX_PURPOSE_BYTES} UTF-8 bytes`);
  }
  return purpose;
}

function validateConsent(value) {
  if (value === null || value === undefined) return null;
  if (value !== 'y' && value !== 'n') {
    throw new Error('--consent must be exactly y or n');
  }
  return value;
}

function validateProposalId(value) {
  if (value === null || value === undefined) return null;
  if (!PROPOSAL_ID_PATTERN.test(value)) {
    throw new Error('--proposal must be a proposal ID from a consent-required response');
  }
  return value;
}

function normalizeTerminal(value) {
  const normalized = TERMINAL_ALIASES.get(String(value || '').toLowerCase());
  if (!normalized) {
    throw new Error('--terminal must be wezterm or terminal.app');
  }
  return normalized;
}

function naturalList(values) {
  if (values.length === 1) return values[0];
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(', ')}, and ${values.at(-1)}`;
}

function networkDescription(capabilities) {
  if (capabilities.includes('network:*')) return 'unrestricted network access';
  const domains = capabilities
    .filter(capability => capability.startsWith('network:'))
    .map(capability => capability.slice('network:'.length));
  if (domains.length > 0) return `network access limited to ${domains.join(', ')}`;
  return 'networking disabled';
}

function buildTier1ConsentPrompt(manifest, purpose) {
  const normalizedPurpose = validatePurpose(purpose);
  const capabilities = Array.isArray(manifest?.needs?.capabilities)
    ? manifest.needs.capabilities
    : [];
  const properties = [
    'a clean Linux home',
    'a read-only source mount',
    ...(capabilities.includes('pkg-install') ? ['package installation enabled'] : []),
    networkDescription(capabilities),
  ];
  return `Would you like to launch a Tier 1 rootless Podman sandbox with ${naturalList(properties)}, for testing ${normalizedPurpose}? y/n`;
}

function normalizedProposalDetails(details) {
  const purpose = validatePurpose(details.purpose);
  const terminal = normalizeTerminal(details.terminal);
  if (!/^[a-f0-9]{64}$/.test(details.manifestDigest || '')) {
    throw new Error('consent proposal requires an exact manifest digest');
  }
  const route = Object.fromEntries(['backend', 'tier', 'os', 'arch'].map(field => (
    [field, details.route?.[field] ?? null]
  )));
  return {
    schema_version: 1,
    flow: details.flow,
    manifest_digest: details.manifestDigest,
    capabilities: details.capabilities || {},
    route,
    purpose,
    terminal,
  };
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value).sort().map(key => [key, stableValue(value[key])])
  );
}

function proposalBinding(details) {
  return crypto.createHash('sha256')
    .update(JSON.stringify(stableValue(normalizedProposalDetails(details))))
    .digest('hex');
}

function proposalDirectory(root) {
  const stateRoot = ensurePrivateDirectory(validateStateRoot(root));
  const directory = path.join(stateRoot, '.proposals');
  if (fs.existsSync(directory)) {
    const stat = fs.lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error('Sandbox consent proposal store must be a private directory');
    }
  } else {
    fs.mkdirSync(directory, { mode: 0o700 });
  }
  fs.chmodSync(directory, 0o700);
  return directory;
}

function createConsentProposal(root, details, options = {}) {
  const now = options.now || Date.now();
  const randomBytes = options.randomBytes || crypto.randomBytes;
  const proposalId = `proposal_${randomBytes(32).toString('hex')}`;
  const directory = proposalDirectory(root);
  writeJsonAtomic(path.join(directory, `${proposalId}.json`), {
    schema_version: 1,
    proposal_id: proposalId,
    binding: proposalBinding(details),
    created_at: new Date(now).toISOString(),
    expires_at: new Date(now + PROPOSAL_TTL_MS).toISOString(),
  });
  return proposalId;
}

function readProposal(filePath) {
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64 * 1024) {
    throw new Error('Sandbox consent proposal must be a bounded regular file');
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function consumeConsentProposal(root, provided, details, options = {}) {
  const proposalId = validateProposalId(provided);
  if (!proposalId) {
    throw new Error('--consent y requires --proposal from the prior consent-required response');
  }
  const directory = proposalDirectory(root);
  const source = path.join(directory, `${proposalId}.json`);
  const consuming = path.join(
    directory,
    `.consuming-${proposalId}-${crypto.randomBytes(8).toString('hex')}`
  );
  try {
    fs.renameSync(source, consuming);
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error('consent proposal is unavailable, expired, or already used; request a new proposal');
    }
    throw error;
  }
  try {
    const record = readProposal(consuming);
    const now = options.now || Date.now();
    const validShape = record?.schema_version === 1
      && record.proposal_id === proposalId
      && /^[a-f0-9]{64}$/.test(record.binding || '')
      && Number.isFinite(Date.parse(record.expires_at));
    if (!validShape || Date.parse(record.expires_at) < now) {
      throw new Error('consent proposal is invalid or expired; request a new proposal');
    }
    const expected = proposalBinding(details);
    const left = Buffer.from(record.binding);
    const right = Buffer.from(expected);
    if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) {
      throw new Error('consent proposal no longer matches the sandbox environment; request a new proposal');
    }
  } finally {
    fs.rmSync(consuming, { force: true });
  }
  return proposalId;
}

function consentProposal(manifest, purpose, decision, proposalId) {
  const normalizedPurpose = validatePurpose(purpose);
  const normalizedDecision = validateConsent(decision);
  const prompt = buildTier1ConsentPrompt(manifest, normalizedPurpose);
  if (normalizedDecision !== 'y') {
    return {
      result: normalizedDecision === 'n' ? 'declined' : 'consent-required',
      creates_run: false,
      consent_prompt: prompt,
      proposal_id: proposalId,
      purpose: normalizedPurpose,
    };
  }
  return {
    purpose: normalizedPurpose,
    consent: {
      decision: 'y',
      prompt,
      proposal_id: proposalId,
      granted_at: new Date().toISOString(),
    },
  };
}

module.exports = {
  MAX_PURPOSE_BYTES,
  PROPOSAL_TTL_MS,
  buildTier1ConsentPrompt,
  consentProposal,
  consumeConsentProposal,
  createConsentProposal,
  normalizeTerminal,
  proposalBinding,
  validateConsent,
  validateProposalId,
  validatePurpose,
};
