#!/usr/bin/env node
/**
 * Shared hook enable/disable controls.
 *
 * Controls:
 * - ECC_HOOKS_ENABLED=true|false (default: true)
 * - ECC_HOOK_PROFILE=minimal|standard|strict (default: standard)
 * - ECC_DISABLED_HOOKS=comma,separated,hook,ids
 *
 * Claude plugin options are used when their corresponding ECC variable is
 * absent. A managed install can provide ecc/setup.json as the final fallback.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const VALID_PROFILES = new Set(['minimal', 'standard', 'strict']);

function normalizeId(value) {
  return String(value || '').trim().toLowerCase();
}

function parseBoolean(value, fallback = true) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return fallback;
  }
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function readManagedHookConfig(env = process.env) {
  const pluginRoot = String(
    env.CLAUDE_PLUGIN_ROOT || env.ECC_PLUGIN_ROOT || ''
  ).trim();
  const configPath = String(env.ECC_HOOK_CONFIG || '').trim()
    || (pluginRoot ? path.join(pluginRoot, 'ecc', 'setup.json') : '');
  if (!configPath || !fs.existsSync(configPath)) return {};

  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return config?.hooks
      && typeof config.hooks === 'object'
      && !Array.isArray(config.hooks)
      ? config.hooks
      : {};
  } catch {
    return {};
  }
}

function areHooksEnabled(env = process.env) {
  const managed = readManagedHookConfig(env);
  const raw = env.ECC_HOOKS_ENABLED !== undefined
    ? env.ECC_HOOKS_ENABLED
    : (
      env.CLAUDE_PLUGIN_OPTION_HOOKS_ENABLED !== undefined
        ? env.CLAUDE_PLUGIN_OPTION_HOOKS_ENABLED
        : managed.enabled
    );
  return parseBoolean(raw, true);
}

function getHookProfile(env = process.env) {
  const managed = readManagedHookConfig(env);
  const raw = String(
    env.ECC_HOOK_PROFILE
    || env.CLAUDE_PLUGIN_OPTION_HOOK_PROFILE
    || managed.profile
    || 'standard'
  ).trim().toLowerCase();
  return VALID_PROFILES.has(raw) ? raw : 'standard';
}

function getDisabledHookIds(env = process.env) {
  const raw = String(env.ECC_DISABLED_HOOKS || '');
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

function isDryRun(env = process.env) {
  return env.ECC_DRY_RUN === '1';
}

function isHookEnabled(hookId, options = {}) {
  const env = options.env || process.env;
  if (!areHooksEnabled(env)) {
    return false;
  }

  const id = normalizeId(hookId);
  if (!id) return true;

  const disabled = getDisabledHookIds(env);
  if (disabled.has(id)) {
    return false;
  }

  const profile = getHookProfile(env);
  const allowedProfiles = parseProfiles(options.profiles);
  return allowedProfiles.includes(profile);
}

module.exports = {
  VALID_PROFILES,
  normalizeId,
  parseBoolean,
  readManagedHookConfig,
  areHooksEnabled,
  getHookProfile,
  getDisabledHookIds,
  parseProfiles,
  isHookEnabled,
  isDryRun,
};
