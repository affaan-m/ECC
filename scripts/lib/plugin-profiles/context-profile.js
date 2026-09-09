/**
 * The context-profile binding seam.
 *
 * A carrier's context surface has to come from somewhere. The intended
 * source is ECC's canonical, versioned context-profile registry — the thing
 * `lean@1` and `full@1` name. That registry is not published, so nothing in
 * this repository can bind to it.
 *
 * What this file does NOT do is invent a second one. Defining profile ids
 * here with their own semantics would create a parallel contract that has to
 * be reconciled later, and every carrier generated in the meantime would be
 * indistinguishable from a canonically-bound one.
 *
 * Instead this is the single, visible seam:
 *
 * - TODAY it projects ECC's install-profile ids
 *   (`manifests/install-profiles.json`) onto a context surface. Install
 *   profiles are an installer concept; using them here is a projection, not
 *   an equivalence, and the registry field says so.
 * - The registry is reported as the literal string
 *   `install-profiles@unbound`, and `contextProfileDigest` is null. Both
 *   travel into the receipt, so no carrier can be mistaken for one bound to
 *   the canonical registry.
 * - WHEN the canonical registry is published, binding to it is a change to
 *   this file and to the receipt schema. Nothing else in plugin-profiles
 *   reads the surface from anywhere else: `resolvePluginProfilePlan` calls
 *   `resolveContextProfile` and nothing else to obtain it.
 *
 * That is the whole point of the seam — the port is one file, and the
 * absence of a binding is on the record rather than papered over.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { listChildDirectories, listMarkdownFiles } = require('./fs-utils');

// The literal recorded in every receipt until the canonical registry exists.
// It is deliberately ugly: it should be impossible to read a receipt and
// think a carrier was bound to a real context-profile registry.
const UNBOUND_REGISTRY = 'install-profiles@unbound';
const PROJECTION_SOURCE = 'manifests/install-profiles.json';

/**
 * Resolve a context-profile id to the exact selected surface.
 *
 * @param {string|null} id Requested profile id, or null for a custom
 *   module/component selection.
 * @param {object} context Resolution context.
 * @param {Array<object>} context.selectedModules Modules from the install plan.
 * @param {string} context.repoRoot Absolute repository root.
 * @param {Function} context.expand Surface expansion for those modules.
 * @returns {{id: string|null, registry: string, contextProfileDigest: null, surface: {skills: Array<string>, agents: Array<string>, commands: Array<string>}, source: string, expansion: object}}
 */
function resolveContextProfile(id, context) {
  const { selectedModules, expand } = context;
  const expansion = expand(selectedModules);

  return {
    id: id || null,
    // Literal until bound. Never derived, never made to look versioned.
    registry: UNBOUND_REGISTRY,
    // Null until bound. A digest here would imply a registry to digest.
    contextProfileDigest: null,
    surface: {
      skills: [...expansion.skillDirs].sort(),
      agents: [...expansion.agentFiles].sort(),
      commands: [...expansion.commandFiles].sort(),
    },
    source: PROJECTION_SOURCE,
    // The full accumulator, so the plan can also read runtime and held paths
    // without reaching around this seam for the surface.
    expansion,
  };
}

/**
 * The receipt block describing where a carrier's surface came from.
 *
 * @param {object} contextProfile Result of resolveContextProfile.
 * @returns {{id: string|null, registry: string, digest: null, source: string}}
 */
function buildContextProfileReceipt(contextProfile) {
  return {
    id: contextProfile.id,
    registry: contextProfile.registry,
    digest: contextProfile.contextProfileDigest,
    source: contextProfile.source,
  };
}

/**
 * List the install-profile ids this projection currently offers.
 *
 * @param {string} repoRoot Absolute repository root.
 * @returns {Array<string>} Sorted profile ids.
 */
function listProjectedProfileIds(repoRoot) {
  const manifestPath = path.join(repoRoot, ...PROJECTION_SOURCE.split('/'));
  if (!fs.existsSync(manifestPath)) {
    return [];
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  return Object.keys(manifest.profiles || {}).sort();
}

module.exports = {
  UNBOUND_REGISTRY,
  PROJECTION_SOURCE,
  resolveContextProfile,
  buildContextProfileReceipt,
  listProjectedProfileIds,
  // Re-exported so a future binding can enumerate the repo surface without
  // plan.js reaching past this seam.
  listChildDirectories,
  listMarkdownFiles,
};
