'use strict';

const crypto = require('crypto');

const MAX_PURPOSE_BYTES = 240;
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

function buildProposalId(details) {
  const purpose = validatePurpose(details.purpose);
  const terminal = normalizeTerminal(details.terminal);
  if (!/^[a-f0-9]{64}$/.test(details.manifestDigest || '')) {
    throw new Error('consent proposal requires an exact manifest digest');
  }
  const route = Object.fromEntries(['backend', 'tier', 'os', 'arch'].map(field => (
    [field, details.route?.[field] ?? null]
  )));
  const payload = JSON.stringify({
    schema_version: 1,
    flow: details.flow,
    manifest_digest: details.manifestDigest,
    capabilities: details.capabilities || {},
    route,
    purpose,
    terminal,
  });
  return `proposal_${crypto.createHash('sha256').update(payload).digest('hex')}`;
}

function requireMatchingProposal(provided, expected, decision) {
  const proposalId = validateProposalId(provided);
  if (decision !== 'y') return proposalId;
  if (!proposalId) {
    throw new Error('--consent y requires --proposal from the prior consent-required response');
  }
  const left = Buffer.from(proposalId);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) {
    throw new Error('consent proposal no longer matches the sandbox environment; request a new proposal');
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
  buildProposalId,
  buildTier1ConsentPrompt,
  consentProposal,
  normalizeTerminal,
  requireMatchingProposal,
  validateConsent,
  validateProposalId,
  validatePurpose,
};
