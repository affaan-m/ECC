'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const {
  hasExplicitCommitAttributionPreference,
  withCommitAttributionDisabled,
} = require('../claude-commit-attribution');
const { readInstallState, writeInstallState } = require('../install-state');
const {
  assertHookConsentReady,
  disableOpenCodeHookPluginRegistration,
  getDisabledOpenCodePluginContent,
  getRecordedHookConsent,
  getOpenCodeActivationPathKind,
  getOpenCodeSourceActivationKind,
  planMaterializesHookRuntime,
  shouldDisableOpenCodeHooks,
} = require('./hook-consent');
const {
  getClaudeSettingsPath,
  mergeManagedHooks,
  readSettings,
  runWithSettingsLock,
  uninstallManagedHooks,
  updateSettingsAtomic,
  validateManagedHooks,
  validateRecordedManagedHooks,
} = require('./claude-settings');
const { filterMcpConfig, parseDisabledMcpServers } = require('../mcp-config');
const { assertWithinTrustedRoot } = require('../path-safety');
const {
  assertSafeClaudeSkillOperation,
  prepareClaudeSkillMigration,
  removeLegacyClaudeSkillFiles,
} = require('./claude-skill-migration');
const { cleanupLegacyAntigravityInstall } = require('./antigravity-legacy-migration');
const {
  assertNoNewUserOwnedFile,
  prepareUserOwnedFileGuard,
  preserveUnwrittenFiles,
} = require('./ownership-guard');
const { cleanupLegacyOpencodeInstall, getLegacyLocationForPlan, inspectLegacyOpencodeState,
  verifyManagedLegacyFile } = require('./opencode-legacy-migration');
const { writeFileNoFollow } = require('./guarded-write');
const { withOpenCodeInstallLocks } = require('./opencode-install-lock');
const {
  completeExcludedPathsReconciliation,
  prepareExcludedPathsReconciliation,
} = require('./excluded-paths-reconciliation');
const { buildInstallIndex, rewriteRelativeLinks } = require('./link-rewrite');
const { adaptAntigravityAgent } = require('./antigravity-agent');

function isMarkdownPath(filePath) {
  return /\.(md|mdx|markdown)$/i.test(String(filePath || ''));
}

function transformInstallContent(operation, content) {
  if (!operation.contentTransform) {
    return content;
  }
  if (operation.contentTransform === 'antigravity-agent-frontmatter') {
    return adaptAntigravityAgent(content, operation.sourceRelativePath);
  }
  if (operation.contentTransform === 'opencode-disable-ecc-hooks') {
    return disableOpenCodeHookPluginRegistration(content, operation.sourceRelativePath);
  }
  if (operation.contentTransform === 'opencode-disable-plugin-entrypoint') {
    return getDisabledOpenCodePluginContent();
  }
  throw new Error(`Unknown install content transform: ${operation.contentTransform}`);
}

// Map every copy-file operation to { sourceRel, destRel } so relative links in
// namespaced markdown can be rewritten to the file's actual installed location
// (issue #2340). Returns null when the plan lacks the data needed to do so.
function buildLinkIndexForPlan(plan) {
  if (!plan || !plan.targetRoot || !Array.isArray(plan.operations)) {
    return null;
  }
  const mappings = [];
  for (const operation of plan.operations) {
    if (operation.kind === 'copy-file' && operation.sourceRelativePath) {
      mappings.push({
        sourceRel: operation.sourceRelativePath,
        destRel: path.relative(plan.targetRoot, operation.destinationPath),
      });
    }
  }
  return buildInstallIndex(mappings);
}

function readJsonObject(filePath, label) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    const wrappedError = new Error(`Failed to parse ${label} at ${filePath}: ${error.message}`);
    wrappedError.code = error.code;
    throw wrappedError;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Invalid ${label} at ${filePath}: expected a JSON object`);
  }

  return parsed;
}

function readOptionalJsonObject(filePath, label) {
  try {
    return readJsonObject(filePath, label);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {};
    }
    throw error;
  }
}

function readInstalledFileNoFollow(plan, operation) {
  assertSafeInstallOperation(plan, operation);
  assertSafeClaudeSkillOperation(plan, operation);
  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0);
  let descriptor;
  try {
    descriptor = fs.openSync(operation.destinationPath, flags);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }

  try {
    const openedStat = fs.fstatSync(descriptor, { bigint: true });
    const finalPathStat = fs.lstatSync(operation.destinationPath, { bigint: true });
    if (finalPathStat.isSymbolicLink() || !finalPathStat.isFile()) {
      return null;
    }
    const identityMatches = openedStat.ino === finalPathStat.ino
      && (!openedStat.dev || !finalPathStat.dev || openedStat.dev === finalPathStat.dev);
    if (!openedStat.isFile() || !identityMatches) {
      throw new Error(
        `Refusing to hash changed install destination: ${operation.destinationPath}`
      );
    }
    // Revalidate the full path after opening. The descriptor pins the file so
    // the digest and metadata refer to the same object.
    assertSafeInstallOperation(plan, operation);
    assertSafeClaudeSkillOperation(plan, operation);
    return fs.readFileSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function stateWithContentDigests(state, plan) {
  const currentDestinations = new Set((plan.operations || [])
    .filter(operation => operation.destinationPath)
    .map(operation => {
      const resolved = path.resolve(operation.destinationPath);
      return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    }));
  return {
    ...state,
    operations: (state.operations || []).map(operation => {
      if (!operation.destinationPath) {
        return { ...operation };
      }
      const resolved = path.resolve(operation.destinationPath);
      const destinationKey = process.platform === 'win32'
        ? resolved.toLowerCase()
        : resolved;
      if (!currentDestinations.has(destinationKey)) {
        return { ...operation };
      }
      const installedContent = readInstalledFileNoFollow(plan, operation);
      if (installedContent === null) {
        return { ...operation };
      }
      return {
        ...operation,
        contentSha256: crypto.createHash('sha256')
          .update(installedContent)
          .digest('hex'),
      };
    }),
  };
}

function cloneJsonValue(value) {
  if (value === undefined) {
    return undefined;
  }

  return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function deepMergeJson(baseValue, patchValue) {
  if (!isPlainObject(baseValue) || !isPlainObject(patchValue)) {
    return cloneJsonValue(patchValue);
  }

  const merged = { ...baseValue };
  for (const [key, value] of Object.entries(patchValue)) {
    if (isPlainObject(value) && isPlainObject(merged[key])) {
      merged[key] = deepMergeJson(merged[key], value);
    } else {
      merged[key] = cloneJsonValue(value);
    }
  }
  return merged;
}

function formatJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function shouldSetClaudeCommitAttributionPreference(plan) {
  if (!plan?.adapter || !['claude', 'claude-project'].includes(plan.adapter.target)) {
    return false;
  }

  return plan.operations.some(operation => {
    if (typeof operation?.destinationPath !== 'string') {
      return false;
    }
    const relativePath = path.relative(plan.targetRoot, operation.destinationPath);
    return relativePath && !relativePath.startsWith(`docs${path.sep}`) && relativePath !== 'docs';
  });
}

function writeClaudeCommitAttributionPreference(settingsPath, options = {}) {
  let settings;
  try {
    settings = readSettings(settingsPath);
  } catch (_error) {
    // Unreadable or malformed settings belong to the user; leave them untouched.
    return false;
  }

  if (hasExplicitCommitAttributionPreference(settings)) {
    return false;
  }

  let changed = false;
  updateSettingsAtomic(settingsPath, latestSettings => {
    if (hasExplicitCommitAttributionPreference(latestSettings)) {
      return { settings: latestSettings };
    }
    changed = true;
    return { settings: withCommitAttributionDisabled(latestSettings) };
  }, options);
  return changed;
}

function isMcpConfigPath(filePath) {
  const basename = path.basename(String(filePath || ''));
  return basename === '.mcp.json' || basename === 'mcp.json';
}

function assertSafeInstallOperation(plan, operation) {
  if (!operation || typeof operation.destinationPath !== 'string') {
    throw new Error('Refusing to apply install operation: missing destination path.');
  }

  const targetRoot = plan && plan.targetRoot;
  assertWithinTrustedRoot(operation.destinationPath, targetRoot, 'install ECC file');

  const resolvedRoot = path.resolve(targetRoot);
  const resolvedTarget = path.resolve(operation.destinationPath);
  const relativePath = path.relative(resolvedRoot, resolvedTarget);
  const segments = relativePath ? relativePath.split(path.sep) : [];
  for (const segmentIndex of Array.from({ length: segments.length + 1 }, (_value, index) => index)) {
    const currentPath = segmentIndex === 0
      ? resolvedRoot
      : path.join(resolvedRoot, ...segments.slice(0, segmentIndex));
    try {
      const stats = fs.lstatSync(currentPath);
      if (stats.isSymbolicLink()) {
        throw new Error(
          `Refusing to install ECC file through symlinked path: '${currentPath}'.`
        );
      }
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        break;
      }
      throw error;
    }
  }
}

function readPreviousInstallState(plan) {
  if (!fs.existsSync(plan.installStatePath)) {
    return null;
  }
  return readInstallState(plan.installStatePath);
}

function comparablePath(filePath) {
  const resolved = path.resolve(filePath);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function getOpenCodeActivationKind(plan, operation) {
  const relative = operation.destinationPath
    ? path.relative(plan.targetRoot, operation.destinationPath).split(path.sep).join('/').toLowerCase()
    : '';
  return getOpenCodeActivationPathKind(relative) || getOpenCodeSourceActivationKind(operation);
}

function readOpenCodeAliasForAttribution(plan, destinationPath) {
  try {
    const operation = { destinationPath };
    assertSafeInstallOperation(plan, operation);
    if (!fs.lstatSync(destinationPath).isFile()) return null;
    return readInstalledFileNoFollow(plan, operation);
  } catch {
    // Optional, unrecorded aliases have no ECC ownership until their bytes
    // prove it. Never follow an unsafe path or relax recorded/planned guards.
    return null;
  }
}

// Finite, exact public ECC entrypoint history reachable from d3b8a3e908904e242ed2dbe66af62cca71131419.
// Refusal evidence only: matching bytes never grant ownership or permission to
// adopt, rewrite or delete an unrecorded file. Unknown modified/compiled variants
// are not covered. No history lookup or plugin execution occurs at runtime.
const LEGACY_OPENCODE_PLUGIN_DIGESTS = Object.freeze([
  // a0600a00fbe3a193a44584ad55800ce82cec62af:.opencode/plugins/index.ts (blob 3a98f0ba6510d436cc9cf3e2161f8f69771d968a)
  '7dd2d255da5d4344eb38ca93cf1765e425b0c01943f6e45428614662ebee0d4b',
  // a0600a00fbe3a193a44584ad55800ce82cec62af:.opencode/plugins/ecc-hooks.ts (blob bf06c03f8ff6bdd835c5266921758a6db85152bf)
  '5db9b59434af0d5971538f0176779733b8146d7a71fbd9055ae0183c26754068',
  // 91ba9b4cf6c47c8130829004f8bb64762a76ccbb:.opencode/plugins/ecc-hooks.ts (blob 4aabde61203d4473e04d5a10803b0560b8c596e4)
  'c683b9321d8b5fbc6889b1740f4583c4f94c84554ee97e2072f61de45c661bda',
  // 1a8beb71c5282ddfe77c72ab0290961a820e3d89:.opencode/plugins/ecc-hooks.ts (blob 69b59727e552991a79c196aab8ec128173329d9a)
  '1e890ce162325c9d7c579b0716383b6c297179edb78084c4b59cc8bf766ceb71',
  // e65f12bf7ea474a6f5ac96991a251673f474b445:.opencode/plugins/index.ts (blob c1e17a1595403080490fcec6820c1485bb6afba9)
  '965c5fac76ce0c3ceb3836814f5eb9ede8c9db50373a508c734f949cb321a21a',
  // e65f12bf7ea474a6f5ac96991a251673f474b445:.opencode/plugins/ecc-hooks.ts (blob 54881ad868c276ff0d50cc83d8ae938464ad02da)
  '5c043b84693a654fffe4b407e87411b28c9af8b92f5ef49a03caab7b27f03102',
  // 2cdc218c45a81ce46035832b13bf68d91137301e:.opencode/plugins/ecc-hooks.ts (blob d496e61a538131ff6f33b2e6d941544e3d94c5d8)
  '73692e599d271bbb9b7aac59f97e193518af2b5db3a3505af0376c8d8657220a',
  // 5929d246946eeb5d147612ba06d60c575c5a4e21:.opencode/plugins/ecc-hooks.ts (blob 472f80f5ae9500fa9a0a7885b6ce4dc4b409d3d6)
  'd7a410380ed2e0bcb613110b2810221d03a8944e50766bc7a4db2eb1b44446b6',
  // ca185ef5f7667078a1e70a763bd3a9c71c48acf0:.opencode/plugins/ecc-hooks.ts (blob 22b1132f0964bd4ba5c1a4ad1bafa605de99eb6a)
  '0345093b34e537d350c5b5aa0296511f558aa767e5104fb5ef05069013f3b5b6',
  // 28e53a0bc10e286f68b53bb1e3b3f049021e57b9:.opencode/plugins/ecc-hooks.ts (blob 47265c0ebd031168d8e3a18f30036864338cd22c)
  'e20ecd53714b1fd55baeff796c6f4538ebd4bae71ca1e791b2b8e29575061846',
  // 591ab5cbd3f2f65860ea91c226e410b1502c8e2e:.opencode/plugins/ecc-hooks.ts (blob 49124c255003eb5517178a8ecad7dd453303df33)
  'b9c22c76ae2464c9410963579ee5ff49003e4d79e32b69c228539ae7b15f5104',
  // 6f452d48d258b39f4f6e1171b7ca18c6f7f61ad5:.opencode/plugins/ecc-hooks.ts (blob 6336081e97c4345f02adfdc0b9ad9e27dccdec04)
  'c7122565cf97b896cc3da9009bf06daca7513b3e9ba7448c26b8872591dbf3f7',
  // 3a08b0c7a85bda69ee9922a103e077a04d538150:.opencode/plugins/ecc-hooks.ts (blob bad6a4cecf2270a7d8a919daeb6541c94a810c48)
  'e438603c13206365068b400063df0af98bd587842b80f09b97fe57f7ddef56e0',
  // 29edd57708bee26f16363c16a28fec7f6b09f53f:.opencode/plugins/ecc-hooks.ts (blob 05792ce9ae86a785b746bdb843572e4b5bc93130)
  '6a9063b2f67334a78d269d53f95679c33d6d126260f8e5fc7cc941fea9b903e8',
  // 8141f6904f14fa8a83131e1cb5b6507d687e25bb:.opencode/plugins/ecc-hooks.ts (blob 606bcb7c59aa5e459d2093ffb9cf9208d1184c30)
  'a198b640fd1faf1c75e96909eabf4ae24899de127b2447490eed813766013836',
  // 6d613f67dd24189a8bb7fb1a2f5e535957f46a58:.opencode/plugins/index.ts (blob ca58596901d816147ac4eff525f1a885d36bd094)
  'e89aaa309b7a0578bb69af4a2425744fcf14c2556cd34a1036bbcba448a0b517',
  // 6d613f67dd24189a8bb7fb1a2f5e535957f46a58:.opencode/plugins/ecc-hooks.ts (blob 31cfa8ac31ac3cbc5c51b4b275017ef18b8f9033)
  'd66a43e43ef9669589de593e8f94e750ee11d3c75cb5fe79e81636ef738c3e45',
  // affbd334858368518c5baf5f84f74034dea1ea6f:.opencode/plugins/ecc-hooks.ts (blob ff8628b5fd47181cbee54367dc4e32e5392cde1a)
  '4874a12639fd58da59a54fe5b2461c0ddd2eeca6770111615caa402ff0e95693',
  // 0a87323eda77ee412fa3a3bf028a577536966505:.opencode/plugins/ecc-hooks.ts (blob fa96b805685e3c3e6f86535debca5ab8a5bea1ef)
  '4e2330f340e074208cd323c1a833667032ce8db4febc4eaeda354bc49cb58bc4',
  // a0a1eda8fc4828e58dc8aabcec4e25f9ef038a0a:.opencode/plugins/ecc-hooks.ts (blob 51bde010b4d426676b52ffc9567b1da80f4ca510)
  'ca9abadee5d072121677168752fb4f3b16ce9fc7eb55a3c9c7f517377e0bf69b',
  // 05acc275307a09eea89080619a35d7dbd20b128b:.opencode/plugins/ecc-hooks.ts (blob 9e4ab3fcd50f6610cfdfa5a7d0d71c2374f65745)
  '96998990d6aac0b9535ab6ab60a0be1c284ffcca7e4ba04f1cfa0e67409a8146',
  // a2b3cc1600e9cab58147ef01c03f9889b5a8cc86:.opencode/plugins/ecc-hooks.ts (blob 58a209283f70efe1dbfef5d78b4d72764c67f027)
  '0697bfed6e6ad887443a32810e83adb5316d2c9c0490b98f9fcb6ea52bea84e3',
  // 0c7deb26a344db095c04a213eba5634d4ccce030:.opencode/plugins/ecc-hooks.ts (blob 9193bb412920a1f1d5af98fda0a66d1e3295f46f)
  'd666a94e9d0ccbcfdeffd59b624938cd44706571eec3771974c57fdbe28577c1',
  // 48b883d7412914b04c8b185d9a82685b105d1734:.opencode/plugins/ecc-hooks.ts (blob 3053314750a61dbcdb06a9cca39492304457f582)
  '16fe21ca801a613a0ae2fc1f8dd5c8474138dc31c75ea35cd8695884397f1f15',
  // d70bab85e33af7a03b78c70dba7a7ce3b01d1b17:.opencode/plugins/ecc-hooks.ts (blob 1f158d7999f5f100e386587a94a90a08d512e278)
  '0354270a5fc26809d0795ecc7eef1dee91de4905d58f26d5828d43af24767b96',
  // 0e9f613fd196f6d4157765b17d39c2c42ebbf564:.opencode/plugins/ecc-hooks.ts (blob 50d23bfde3607832446fda26b25a3ed3e527e5d1)
  '513190b6c935dac472efd11818b20d7f2479ec1f7be06ef7f4d241c2493ad9e3',
  // 6d440c036df2c1b2fec957627d1202c3708e0627:.opencode/plugins/index.ts (blob d19a91f1a686d6ed060d08eddeb5aa05a4be6b75)
  'e42c733adb177f84cea813663aa34c7868dbaa98c96950d0ef91cd211b8aa169',
  // 6d440c036df2c1b2fec957627d1202c3708e0627:.opencode/plugins/ecc-hooks.ts (blob b64ffae7ce10cab9e5ed9b04cec23d62db9036e7)
  '503ea491cbeadff5bf59b936a75bff65caaf1d71e47a953a9b9b790be780efef',
]);

function knownOpenCodePluginDigests(plan) {
  // Historical refusal fingerprints do not depend on a current source checkout.
  const digests = new Set(LEGACY_OPENCODE_PLUGIN_DIGESTS);
  if (typeof plan.sourceRoot !== 'string' || !path.isAbsolute(plan.sourceRoot)) return digests;
  const sourcePlan = { ...plan, targetRoot: plan.sourceRoot };
  for (const directory of ['.opencode/plugins', '.opencode/dist/plugins']) {
    for (const name of ['ecc-hooks', 'index']) {
      for (const extension of ['ts', 'js', 'mjs', 'cjs']) {
        const content = readOpenCodeAliasForAttribution(sourcePlan,
          path.join(plan.sourceRoot, directory, `${name}.${extension}`));
        if (content !== null) digests.add(crypto.createHash('sha256').update(content).digest('hex'));
      }
    }
  }
  return digests;
}

function openCodeActivationCandidates(plan, previousOperations) {
  const candidates = new Map();
  for (const operation of [...previousOperations, ...plan.operations]) {
    if (getOpenCodeActivationKind(plan, operation) && operation.destinationPath) {
      candidates.set(comparablePath(operation.destinationPath), operation);
    }
  }
  // Old installs can leave unrecorded aliases, but names such as index.js
  // are also used by unrelated plugins. Attribute only exact ECC artifacts.
  const knownDigests = knownOpenCodePluginDigests(plan);
  for (const name of ['ecc-hooks', 'index']) {
    for (const extension of ['ts', 'js', 'mjs', 'cjs']) {
      const destinationPath = path.join(plan.targetRoot, 'plugins', `${name}.${extension}`);
      const key = comparablePath(destinationPath);
      if (!candidates.has(key)) {
        const content = readOpenCodeAliasForAttribution(plan, destinationPath);
        const digest = content === null ? null : crypto.createHash('sha256').update(content).digest('hex');
        if (knownDigests.has(digest)) {
          candidates.set(key, {
            sourceRelativePath: `.opencode/plugins/${name}.${extension}`,
            destinationPath,
          });
        }
      }
    }
  }
  return candidates;
}

function activationIsInactive(kind, operation, content) {
  if (kind === 'plugin') {
    return content.toString('utf8') === getDisabledOpenCodePluginContent();
  }
  const text = content.toString('utf8');
  // Validate first so malformed JSON retains its source context.
  disableOpenCodeHookPluginRegistration(text, operation.sourceRelativePath || operation.destinationPath);
  const config = JSON.parse(text);
  return !Array.isArray(config.plugin) || !config.plugin.includes('./plugins');
}

function assertOpenCodeHookDeactivationReady(plan, options = {}) {
  if (!shouldDisableOpenCodeHooks(plan)) {
    return new Map();
  }
  assertSafeInstallOperation(plan, { destinationPath: plan.installStatePath });
  const previousState = readPreviousInstallState(plan);
  if (previousState && (
    previousState.target.id !== plan.adapter.id
    || comparablePath(previousState.target.root) !== comparablePath(plan.targetRoot)
    || comparablePath(previousState.target.installStatePath) !== comparablePath(plan.installStatePath)
  )) {
    throw new Error('Refusing OpenCode hook deactivation: install-state target mismatch.');
  }
  const previous = new Map(((previousState && previousState.operations) || [])
    .filter(operation => operation.ownership === 'managed' && operation.destinationPath)
    .map(operation => [comparablePath(operation.destinationPath), operation]));
  const desired = new Map(plan.operations.filter(operation => getOpenCodeActivationKind(plan, operation))
    .map(operation => [comparablePath(operation.destinationPath), operation]));
  const snapshot = new Map();
  for (const [key, operation] of openCodeActivationCandidates(plan, [...previous.values(), ...(options.legacyOperations || [])])) {
    const kind = getOpenCodeActivationKind(plan, operation);
    if (kind === 'package') {
      throw new Error(`Unsupported OpenCode package metadata deactivation: ${operation.destinationPath}`);
    }
    const expectedTransform = kind === 'plugin'
      ? 'opencode-disable-plugin-entrypoint' : 'opencode-disable-ecc-hooks';
    const replacement = desired.get(key);
    // Validate planned activation even when its destination does not yet exist.
    // Recorded operations may name an unrelated source or use render-template.
    if (replacement && (replacement.kind !== 'copy-file'
      || replacement.contentTransform !== expectedTransform)) {
      throw new Error(`Refusing OpenCode hook deactivation: unsupported activation operation at ${operation.destinationPath}`);
    }
    const content = readInstalledFileNoFollow(plan, operation);
    if (content === null && fs.existsSync(operation.destinationPath)) {
      throw new Error(`Refusing OpenCode hook deactivation: non-file activation at ${operation.destinationPath}`);
    }
    const digest = content === null ? null : crypto.createHash('sha256').update(content).digest('hex');
    snapshot.set(key, digest);
    if (content === null) continue;
    const inactive = activationIsInactive(kind, operation, content);
    if (options.requireInactive) {
      if (!inactive) {
        throw new Error(`OpenCode hook activation remains active at ${operation.destinationPath}`);
      }
      continue;
    }
    const recorded = previous.get(key);
    if (inactive && (kind === 'plugin' || options.allowVerifiedLegacyRemoval || !recorded)) continue;
    if (options.allowVerifiedLegacyRemoval && recorded) {
      const verified = verifyManagedLegacyFile(recorded, {
        targetRoot: plan.targetRoot, installStatePath: plan.installStatePath,
      }, plan.sourceRoot);
      if (verified.destinationPath && verified.digest === digest) continue;
    }
    if (!replacement || replacement.kind !== 'copy-file'
      || replacement.contentTransform !== expectedTransform
      || !recorded || recorded.contentSha256 !== digest) {
      throw new Error(`Refusing OpenCode hook deactivation: user-owned, modified, unverifiable or stale activation at ${operation.destinationPath}`);
    }
  }
  return snapshot;
}

function assertOpenCodeActivationUnchanged(plan, operation, snapshot) {
  const key = comparablePath(operation.destinationPath);
  if (!snapshot.has(key)) return;
  const content = readInstalledFileNoFollow(plan, operation);
  const digest = content === null ? null : crypto.createHash('sha256').update(content).digest('hex');
  if (digest !== snapshot.get(key)) {
    throw new Error(`Refusing OpenCode hook deactivation: activation changed after preflight at ${operation.destinationPath}`);
  }
}

function getOpenCodeActivationWriteOptions(operation, snapshot) {
  const key = comparablePath(operation.destinationPath);
  if (!snapshot.has(key)) return {};
  const digest = snapshot.get(key);
  return { expectedContent: Object.freeze(digest === null
    ? { kind: 'absent' } : { kind: 'sha256', digest }) };
}

function getOpenCodeInstallRoots(plan) {
  const roots = [plan.targetRoot];
  const legacy = getLegacyLocationForPlan(plan);
  const inspection = inspectLegacyOpencodeState(legacy);
  if (inspection.status === 'unreadable') throw new Error(inspection.error);
  if (inspection.status === 'valid') roots.push(legacy.targetRoot);
  return roots;
}

function inspectLegacyOpenCodeDeactivation(plan) {
  const location = getLegacyLocationForPlan(plan);
  if (!location || comparablePath(location.targetRoot) === comparablePath(plan.targetRoot)) return null;
  const inspection = inspectLegacyOpencodeState(location);
  if (inspection.status === 'unreadable') throw new Error(inspection.error);
  if (inspection.status !== 'valid') return null;
  const legacyPlan = { ...plan, ...location, operations: [] };
  assertOpenCodeHookDeactivationReady(legacyPlan, { allowVerifiedLegacyRemoval: true });
  return { plan: legacyPlan, operations: inspection.state.operations.filter(operation => operation.ownership === 'managed') };
}

function assertOpenCodeLeaseCoverage(plan, lease) {
  if (plan.adapter?.target !== 'opencode') return;
  // Reuse checks opaque ownership without acquiring extra roots out of order.
  withOpenCodeInstallLocks(getOpenCodeInstallRoots(plan), () => {}, lease);
}

function findPreviousManagedHooks(previousState, plan, operation) {
  if (
    !previousState
    || previousState.target.id !== plan.adapter.id
    || comparablePath(previousState.target.root) !== comparablePath(plan.targetRoot)
    || comparablePath(previousState.target.installStatePath) !== comparablePath(plan.installStatePath)
  ) {
    return null;
  }

  const previousOperation = (previousState.operations || []).find(candidate => (
    candidate.kind === operation.kind
    && comparablePath(candidate.destinationPath) === comparablePath(operation.destinationPath)
  ));
  if (!previousOperation || !previousOperation.managedHooks) {
    return null;
  }

  return validateRecordedManagedHooks(
    previousOperation.managedHooks,
    'previous managed hooks'
  );
}

function preflightClaudeSettingsOperations(plan) {
  const settingsOperations = plan.operations.filter(operation => (
    operation.kind === 'update-claude-settings'
    || operation.kind === 'remove-claude-settings-hooks'
  ));
  if (settingsOperations.length === 0) {
    return new Map();
  }

  const previousState = readPreviousInstallState(plan);
  return new Map(settingsOperations.map(operation => {
    assertSafeInstallOperation(plan, operation);
    const managedHooks = validateManagedHooks(operation.managedHooks);
    const settings = readSettings(operation.destinationPath);
    const previousManagedHooks = findPreviousManagedHooks(previousState, plan, operation);
    if (operation.kind === 'remove-claude-settings-hooks') {
      const removal = uninstallManagedHooks(settings, managedHooks);
      if (removal.retained.length > 0) {
        throw new Error(
          `Refusing to disable modified Claude hooks in ${operation.destinationPath}; `
          + 'run the ECC uninstaller to review retained entries.'
        );
      }
    } else {
      mergeManagedHooks(settings, managedHooks, { previousManagedHooks });
    }
    return [operation, { managedHooks, previousManagedHooks }];
  }));
}

function prepareHookConsentMigration(plan, migration) {
  if (shouldDisableOpenCodeHooks(plan) && migration.requiresBridgeState) {
    const previousState = readPreviousInstallState(plan);
    if (previousState) {
      const previousConsent = getRecordedHookConsent(previousState);
      return {
        ...migration,
        // A checkpoint is not a completed consent transition. On failure,
        // retain the previous decision until every activation is inactive.
        bridgeState: {
          ...migration.bridgeState,
          request: { ...migration.bridgeState.request, hookConsent: previousConsent },
          resolution: {
            ...migration.bridgeState.resolution,
            selectedModules: previousConsent === 'enabled'
              ? [...new Set([...migration.bridgeState.resolution.selectedModules, 'hooks-runtime'])]
              : migration.bridgeState.resolution.selectedModules,
          },
        },
      };
    }
  }
  if (plan.hookConsent !== 'declined') {
    return migration;
  }
  const previousState = readPreviousInstallState(plan);
  if (!previousState) {
    return migration;
  }

  const removals = (previousState.operations || [])
    .filter(operation => operation.kind === 'update-claude-settings')
    .map(operation => ({
      ...operation,
      kind: 'remove-claude-settings-hooks',
      strategy: 'remove-hook-ids',
      scaffoldOnly: false,
    }));
  if (removals.length === 0) {
    return migration;
  }
  const removalDestinations = new Set(removals.map(operation => comparablePath(
    operation.destinationPath
  )));
  return {
    ...migration,
    // Disable hooks only after every ordinary install operation succeeds so a
    // partial reinstall cannot silently revoke working hooks before failing.
    appliedOperations: [...migration.appliedOperations, ...removals],
    finalState: {
      ...migration.finalState,
      operations: migration.finalState.operations.filter(operation => !(
        operation.kind === 'update-claude-settings'
        && removalDestinations.has(comparablePath(operation.destinationPath))
      )),
    },
    bridgeState: {
      ...migration.bridgeState,
      request: {
        ...migration.bridgeState.request,
        hookConsent: 'enabled',
      },
      resolution: {
        ...migration.bridgeState.resolution,
        selectedModules: [...new Set([
          ...migration.bridgeState.resolution.selectedModules,
          'hooks-runtime',
        ])],
      },
    },
    requiresBridgeState: true,
  };
}

function previewInstallPlan(plan) {
  assertOpenCodeHookDeactivationReady(plan);
  const migration = prepareHookConsentMigration(
    plan,
    prepareUserOwnedFileGuard(plan, prepareClaudeSkillMigration(plan))
  );
  const appliedPlan = {
    ...plan,
    operations: migration.appliedOperations,
  };
  preflightClaudeSettingsOperations(appliedPlan);
  const hookConsentWarnings = planMaterializesHookRuntime(plan) && plan.hookConsent !== 'enabled'
    ? ['Applying this plan requires an explicit hook decision: --enable-hooks or --no-hooks.']
    : [];
  return {
    ...plan,
    statePreview: migration.finalState,
    plannedOperations: [...plan.operations],
    operations: migration.appliedOperations,
    skippedOperations: migration.skippedOperations,
    warnings: [
      ...(Array.isArray(plan.warnings) ? plan.warnings : []),
      ...migration.warnings,
      ...hookConsentWarnings,
    ],
    applied: false,
  };
}

function applyInstallPlan(plan, dependencies = {}) {
  assertHookConsentReady(plan);
  if (plan.adapter?.target === 'opencode') {
    assertSafeInstallOperation(plan, { destinationPath: plan.installStatePath });
    return withOpenCodeInstallLocks(
      getOpenCodeInstallRoots(plan),
      lease => applyInstallPlanLocked(plan, { ...dependencies, opencodeLease: lease }, false),
      dependencies.opencodeLease
    );
  }
  const isClaudeManualTarget = plan.adapter
    && (plan.adapter.target === 'claude' || plan.adapter.target === 'claude-project');
  const settingsPathToLock = isClaudeManualTarget
    ? getClaudeSettingsPath(plan.targetRoot)
    : null;
  if (settingsPathToLock) {
    assertSafeInstallOperation(plan, { destinationPath: settingsPathToLock });
  }
  return settingsPathToLock
    ? runWithSettingsLock(
      settingsPathToLock,
      () => applyInstallPlanLocked(plan, dependencies, true)
    )
    : applyInstallPlanLocked(plan, dependencies, false);
}

function applyInstallPlanLocked(plan, dependencies = {}, settingsLockHeld = false) {
  const persistInstallState = dependencies.writeInstallState || writeInstallState;
  const beforeInstallStateRead = dependencies.beforeInstallStateRead;
  const beforeOperationWrite = dependencies.beforeOperationWrite;
  const beforeInstallStateWrite = dependencies.beforeInstallStateWrite;
  if (typeof beforeInstallStateRead === 'function') {
    beforeInstallStateRead({ plan });
  }
  assertOpenCodeLeaseCoverage(plan, dependencies.opencodeLease);
  const legacyActivation = inspectLegacyOpenCodeDeactivation(plan);
  const activationSnapshot = assertOpenCodeHookDeactivationReady(plan);
  const migration = prepareExcludedPathsReconciliation(
    plan,
    prepareHookConsentMigration(
      plan,
      prepareUserOwnedFileGuard(plan, prepareClaudeSkillMigration(plan))
    )
  );
  const appliedPlan = {
    ...plan,
    operations: migration.appliedOperations,
  };
  const preparedClaudeSettings = preflightClaudeSettingsOperations(appliedPlan);
  const disabledServers = parseDisabledMcpServers(process.env.ECC_DISABLED_MCPS);
  const linkIndex = buildLinkIndexForPlan(appliedPlan);
  const hasLegacyMigration = migration.legacyOperationsToRemove.length > 0;
  const hookRemovalCount = appliedPlan.operations.filter(operation => (
    operation.kind === 'remove-claude-settings-hooks'
  )).length;
  let completedHookRemovalCount = 0;
  const writtenDestinations = new Set();
    if (migration.requiresBridgeState) {
      // Own every operation that may be written during a flat-skill migration
      // before the first copy. A later failure is retryable and uninstall can
      // clean the entire partial install, including non-skill files. During
      // legacy migration the bridge also retains the prior managed operations.
      if (typeof beforeInstallStateWrite === 'function') {
        beforeInstallStateWrite({ plan: appliedPlan, state: migration.bridgeState });
      }
      persistInstallState(plan.installStatePath, migration.bridgeState);
    }

    let finalState;
    try {
      for (const operation of appliedPlan.operations) {
      assertSafeInstallOperation(appliedPlan, operation);
      assertSafeClaudeSkillOperation(appliedPlan, operation);
      fs.mkdirSync(path.dirname(operation.destinationPath), { recursive: true });
      // Recheck directories that were absent during the first validation. This
      // narrows the symlink-swap window around mkdirSync, but path checks cannot
      // eliminate a later TOCTOU race before the file write.
      assertSafeInstallOperation(appliedPlan, operation);
      assertSafeClaudeSkillOperation(appliedPlan, operation);
      if (typeof beforeOperationWrite === 'function') {
        beforeOperationWrite({ plan: appliedPlan, operation });
      }
      assertNoNewUserOwnedFile(migration, operation, appliedPlan);
      assertOpenCodeActivationUnchanged(appliedPlan, operation, activationSnapshot);

      if (
        operation.kind === 'update-claude-settings'
        || operation.kind === 'remove-claude-settings-hooks'
      ) {
        // Re-read at the write boundary so unrelated settings added after
        // planning are preserved. A same-ID change still fails closed.
        const prepared = preparedClaudeSettings.get(operation);
        assertSafeInstallOperation(appliedPlan, operation);
        updateSettingsAtomic(operation.destinationPath, latestSettings => {
          const merged = operation.kind === 'remove-claude-settings-hooks'
            ? uninstallManagedHooks(latestSettings, prepared.managedHooks)
            : mergeManagedHooks(latestSettings, prepared.managedHooks, {
              previousManagedHooks: prepared.previousManagedHooks,
            });
          if (
            operation.kind === 'remove-claude-settings-hooks'
            && merged.retained.length > 0
          ) {
            throw new Error(
              `Refusing to disable modified Claude hooks in ${operation.destinationPath}; `
              + 'run the ECC uninstaller to review retained entries.'
            );
          }
          return merged;
        }, {
          lockHeld: settingsLockHeld,
          beforeCommit() {
            assertSafeInstallOperation(appliedPlan, operation);
          },
        });
        writtenDestinations.add(operation.destinationPath);
        if (operation.kind === 'remove-claude-settings-hooks') {
          completedHookRemovalCount += 1;
        }
        continue;
      }

      if (operation.kind === 'merge-json') {
        const payload = cloneJsonValue(operation.mergePayload);
        if (payload === undefined) {
          throw new Error(`Missing merge payload for ${operation.destinationPath}`);
        }

        const filteredPayload = (
          isMcpConfigPath(operation.destinationPath) && disabledServers.length > 0
        )
          ? filterMcpConfig(payload, disabledServers).config
          : payload;

        const currentValue = readOptionalJsonObject(
          operation.destinationPath,
          'existing JSON config'
        );
        const mergedValue = deepMergeJson(currentValue, filteredPayload);
        fs.writeFileSync(operation.destinationPath, formatJson(mergedValue), 'utf8');
        writtenDestinations.add(operation.destinationPath);
        continue;
      }

      if (operation.kind === 'copy-file' && isMcpConfigPath(operation.destinationPath) && disabledServers.length > 0) {
        const sourceConfig = readJsonObject(operation.sourcePath, 'MCP config');
        const filteredConfig = filterMcpConfig(sourceConfig, disabledServers).config;
        fs.writeFileSync(operation.destinationPath, formatJson(filteredConfig), 'utf8');
        writtenDestinations.add(operation.destinationPath);
        continue;
      }

      // Declared transforms are part of the install contract and always apply.
      // Markdown link rewriting is additive when the plan has a usable index.
      const needsLinkRewrite = Boolean(
        linkIndex
        && operation.sourceRelativePath
        && isMarkdownPath(operation.destinationPath)
      );
      if (operation.kind === 'copy-file' && (operation.contentTransform || needsLinkRewrite)) {
        const transformed = transformInstallContent(
          operation,
          fs.readFileSync(operation.sourcePath, 'utf8')
        );
        const installedContent = needsLinkRewrite
          ? rewriteRelativeLinks(transformed, {
            sourceRel: operation.sourceRelativePath,
            index: linkIndex,
          })
          : transformed;
        const writeOptions = getOpenCodeActivationWriteOptions(operation, activationSnapshot);
        if (writeOptions.expectedContent) {
          writeFileNoFollow(operation.destinationPath, installedContent, {
            ...writeOptions,
            action: 'install OpenCode activation',
            validateDestination(destinationPath) {
              assertSafeInstallOperation(appliedPlan, { destinationPath });
              assertSafeClaudeSkillOperation(appliedPlan, { destinationPath });
              return destinationPath;
            },
          });
        } else {
          fs.writeFileSync(operation.destinationPath, installedContent, 'utf8');
        }
        writtenDestinations.add(operation.destinationPath);
        continue;
      }

      fs.copyFileSync(operation.sourcePath, operation.destinationPath);
      writtenDestinations.add(operation.destinationPath);
      }

      if (hasLegacyMigration) {
        removeLegacyClaudeSkillFiles(migration, plan.targetRoot);
      }

      if (shouldSetClaudeCommitAttributionPreference(appliedPlan)) {
        writeClaudeCommitAttributionPreference(
          getClaudeSettingsPath(plan.targetRoot),
          { lockHeld: settingsLockHeld }
        );
      }

      // Include preserved user configs omitted from the write plan: they must
      // still be inactive before we record a completed install.
      assertOpenCodeHookDeactivationReady(plan, { requireInactive: true });
      finalState = stateWithContentDigests(migration.finalState, appliedPlan);
      if (typeof beforeInstallStateWrite === 'function') {
        beforeInstallStateWrite({ plan: appliedPlan, state: finalState });
      }
      persistInstallState(plan.installStatePath, finalState);
    } catch (error) {
      if (migration.requiresBridgeState) {
        try {
          // The bridge was committed before any writes. Refresh it with hashes of
          // files that now exist so uninstall can remove only bytes this attempt
          // actually installed while preserving user changes.
          persistInstallState(
            plan.installStatePath,
            stateWithContentDigests(
              preserveUnwrittenFiles(
                hookRemovalCount > 0 && completedHookRemovalCount === hookRemovalCount
                  ? migration.finalState
                  : migration.bridgeState,
                migration,
                writtenDestinations
              ),
              {
                ...appliedPlan,
                operations: appliedPlan.operations.filter(operation => (
                  writtenDestinations.has(operation.destinationPath)
                )),
              }
            )
          );
        } catch (checkpointError) {
          throw new Error(
            `${error.message} Install-state checkpoint also failed: ${checkpointError.message}`,
            { cause: error }
          );
        }
      }
      throw error;
    }
    let antigravityMigrationWarnings = [];
  try {
    const antigravityMigration = cleanupLegacyAntigravityInstall(appliedPlan);
    if (antigravityMigration.detected && !antigravityMigration.complete) {
      antigravityMigrationWarnings = [
        'Legacy Antigravity migration is incomplete. ECC preserved modified, unverifiable, or unmanaged content under .agent; review and move anything you want to keep, then rerun the Antigravity install.',
        ...(Array.isArray(antigravityMigration.warnings) ? antigravityMigration.warnings : []),
      ];
    }
  } catch (error) {
    antigravityMigrationWarnings = [
      `Legacy Antigravity cleanup did not finish: ${error.message}. Content under .agent was preserved; remove it manually or rerun the Antigravity install.`,
    ];
  }

  assertOpenCodeLeaseCoverage(appliedPlan, dependencies.opencodeLease);
  // Recheck removable bytes after canonical writes, before legacy cleanup.
  inspectLegacyOpenCodeDeactivation(appliedPlan);
  let opencodeMigrationWarnings = [];
  try {
    const opencodeMigration = cleanupLegacyOpencodeInstall(appliedPlan);
    if (opencodeMigration.detected && !opencodeMigration.complete) {
      opencodeMigrationWarnings = [
        'Legacy OpenCode migration is incomplete. ECC preserved modified or unverifiable managed content under ~/.opencode; review it and rerun the OpenCode install.',
        ...(Array.isArray(opencodeMigration.warnings) ? opencodeMigration.warnings : []),
      ];
    }
  } catch (error) {
    opencodeMigrationWarnings = [
      `Legacy OpenCode cleanup did not finish: ${error.message}. Content under ~/.opencode was preserved; rerun the OpenCode install or review it manually.`,
    ];
  }

  if (legacyActivation) {
    assertOpenCodeHookDeactivationReady(legacyActivation.plan, {
      requireInactive: true, legacyOperations: legacyActivation.operations,
    });
  }

  let excludedPathsRemoved = [];
  let excludedPathsWarnings = [];
  try {
    const excludedReconciliation = completeExcludedPathsReconciliation(migration, appliedPlan);
    excludedPathsRemoved = excludedReconciliation.removedPaths;
    excludedPathsWarnings = excludedReconciliation.warnings;
  } catch (error) {
    excludedPathsWarnings = [
      `Excluded-paths reconciliation did not finish: ${error.message}. Previously managed files under excluded source paths were preserved; remove them manually or rerun the install.`,
    ];
  }

    return {
      ...plan,
      statePreview: finalState,
      plannedOperations: [...plan.operations],
      operations: migration.appliedOperations,
      skippedOperations: migration.skippedOperations,
      reconciledExcludedPaths: excludedPathsRemoved,
      warnings: [
        ...(Array.isArray(plan.warnings) ? plan.warnings : []),
        ...migration.warnings,
        ...antigravityMigrationWarnings,
        ...opencodeMigrationWarnings,
        ...excludedPathsWarnings,
      ],
      applied: true,
    };
}

module.exports = {
  applyInstallPlan,
  assertOpenCodeActivationUnchanged,
  assertOpenCodeLeaseCoverage,
  assertOpenCodeHookDeactivationReady,
  getOpenCodeActivationKind,
  getOpenCodeActivationWriteOptions,
  getOpenCodeInstallRoots,
  assertSafeInstallOperation,
  prepareHookConsentMigration,
  previewInstallPlan,
};
