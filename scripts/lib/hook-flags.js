#!/usr/bin/env node
/**
 * Shared hook enable/disable controls.
 *
 * Controls:
 * - ECC_HOOK_PROFILE=minimal|standard|strict (default: standard)
 * - ECC_DISABLED_HOOKS=comma,separated,hook,ids
 */

'use strict';

const VALID_PROFILES = new Set(['minimal', 'standard', 'strict']);

function normalizeId(value) {
  return String(value || '').trim().toLowerCase();
}

function getHookProfile() {
  const raw = String(process.env.ECC_HOOK_PROFILE || 'standard').trim().toLowerCase();
  return VALID_PROFILES.has(raw) ? raw : 'standard';
}

function getDisabledHookIds() {
  const raw = String(process.env.ECC_DISABLED_HOOKS || '');
  if (!raw.trim()) return new Set();

  return new Set(
    raw
      .split(',')
      .map(v => normalizeId(v))
      .filter(Boolean)
  );
}

function parseProfiles(rawProfiles, fallback = ['standard', 'strict']) {
  if (!rawProfiles) return [...fallback];

  if (Array.isArray(rawProfiles)) {
    const parsed = rawProfiles
      .map(v => String(v || '').trim().toLowerCase())
      .filter(v => VALID_PROFILES.has(v));
    return parsed.length > 0 ? parsed : [...fallback];
  }

  const parsed = String(rawProfiles)
    .split(',')
    .map(v => v.trim().toLowerCase())
    .filter(v => VALID_PROFILES.has(v));

  return parsed.length > 0 ? parsed : [...fallback];
}

function isDryRun() {
  return process.env.ECC_DRY_RUN === '1';
}

function isHookEnabled(hookId, options = {}) {
  const id = normalizeId(hookId);
  if (!id) return true;

  const disabled = getDisabledHookIds();
  if (disabled.has(id)) {
    return false;
  }

  const profile = getHookProfile();
  const allowedProfiles = parseProfiles(options.profiles);
  return allowedProfiles.includes(profile);
}

module.exports = {
  VALID_PROFILES,
  normalizeId,
  getHookProfile,
  getDisabledHookIds,
  parseProfiles,
  isHookEnabled,
  isDryRun,
};
