#!/usr/bin/env node
/**
 * Shared skill enable/disable controls. Mirrors hook-flags.js so the
 * Claude skill listing can be narrowed the same way hooks already are.
 *
 * Controls:
 * - ECC_SKILL_PROFILE=minimal|standard|full (default: standard)
 * - ECC_ENABLED_SKILL_GROUPS=comma,separated,group,ids
 * - ECC_DISABLED_SKILL_GROUPS=comma,separated,group,ids
 * - ECC_DISABLED_SKILLS=comma,separated,skill,ids
 *
 * Claude plugin options are used when their corresponding ECC variable is
 * absent. A managed install can provide ecc/setup.json as the final fallback.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const VALID_SKILL_PROFILES = new Set(['minimal', 'standard', 'full']);

function normalizeId(value) {
  return String(value || '').trim().toLowerCase();
}

function sanitizeDiagnostic(value) {
  return String(value || '')
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b(?:\[[0-9;?]*[A-Za-z]|\][^\x07\x1b]*(?:\x07|\x1b\\)|\([A-Z]|[A-Z])/g, '')
    .replace(/[^\x20-\x7E]/g, '?');
}

function parseSkillGroups(rawValue) {
  if (rawValue === undefined || rawValue === null) return [];
  return String(rawValue)
    .split(',')
    .map(value => normalizeId(value))
    .filter(Boolean);
}

function readManagedSkillConfig(env = process.env) {
  const pluginRoot = String(
    env.CLAUDE_PLUGIN_ROOT || env.ECC_PLUGIN_ROOT || ''
  ).trim();
  const configPath = String(env.ECC_SKILL_CONFIG || '').trim()
    || (pluginRoot ? path.join(pluginRoot, 'ecc', 'setup.json') : '');
  if (!configPath || !fs.existsSync(configPath)) return {};

  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return config?.skills
      && typeof config.skills === 'object'
      && !Array.isArray(config.skills)
      ? config.skills
      : {};
  } catch (error) {
    process.stderr.write(`${sanitizeDiagnostic(
      `Warning: unable to read managed ECC skill config at ${configPath}: ${error.message}`
    )}\n`);
    return {};
  }
}

function firstPresentValue(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return value;
    }
  }
  return undefined;
}

function getSkillProfile(env = process.env, managed = readManagedSkillConfig(env)) {
  const selected = firstPresentValue(
    env.ECC_SKILL_PROFILE,
    env.CLAUDE_PLUGIN_OPTION_SKILL_PROFILE,
    managed.profile
  );
  if (selected === undefined) {
    return 'standard';
  }
  const raw = normalizeId(selected);
  if (!VALID_SKILL_PROFILES.has(raw)) {
    throw new Error(
      `Unknown skill profile: ${sanitizeDiagnostic(selected)}. Expected minimal, standard, or full.`
    );
  }
  return raw;
}

function hasExplicitSkillProfile(env = process.env, managed = readManagedSkillConfig(env)) {
  return firstPresentValue(
    env.ECC_SKILL_PROFILE,
    env.CLAUDE_PLUGIN_OPTION_SKILL_PROFILE,
    managed.profile
  ) !== undefined;
}

function getEnabledSkillGroups(env = process.env) {
  return new Set(parseSkillGroups(env.ECC_ENABLED_SKILL_GROUPS));
}

function getDisabledSkillGroups(env = process.env) {
  return new Set(parseSkillGroups(env.ECC_DISABLED_SKILL_GROUPS));
}

function getDisabledSkillIds(env = process.env) {
  return new Set(parseSkillGroups(env.ECC_DISABLED_SKILLS));
}

module.exports = {
  VALID_SKILL_PROFILES,
  normalizeId,
  parseSkillGroups,
  readManagedSkillConfig,
  getSkillProfile,
  hasExplicitSkillProfile,
  getEnabledSkillGroups,
  getDisabledSkillGroups,
  getDisabledSkillIds,
};
