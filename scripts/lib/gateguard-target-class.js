'use strict';

const fs = require('fs');
const path = require('path');

const WINDOWS_PATH_PATTERN = /^[a-z]:[\\/]|^\\\\/i;

/** Canonical checked-state key for a target. */
function canonicalPathKey(filePath, data) {
  try {
    const target = resolveTargetPath(filePath, data);
    if (!target) return filePath;
    const key = target.resolved.replace(/\\/g, '/');
    return target.isWin ? key.toLowerCase() : key;
  } catch (_) {
    return filePath;
  }
}

/** Resolve a target to the file the tool will touch. */
// see docs/gateguard/design-notes.md#target-resolution
function resolveTargetPath(filePath, data) {
  const base = (data && data.cwd) || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  if (typeof base !== 'string' || typeof filePath !== 'string') return null;
  const isWin = WINDOWS_PATH_PATTERN.test(base) || WINDOWS_PATH_PATTERN.test(filePath);
  const paths = isWin ? path.win32 : path.posix;
  if (!paths.isAbsolute(base)) return null;
  return { resolved: paths.resolve(base, filePath), isWin };
}

// --- Target classes ---

const INSTRUCTION_BASENAMES = new Set([
  'claude.md',
  'agents.md',
  'agent.md',
  'gemini.md',
  'skill.md',
  'copilot-instructions.md',
  '.cursorrules',
  '.windsurfrules'
]);
const INSTRUCTION_ANYWHERE_EXTS = new Set(['.mdc']);
const INSTRUCTION_DIRS = new Set(['.claude', 'agents', 'commands', 'skills', 'rules', 'hooks', '.cursor', '.codex', '.opencode']);
const INSTRUCTION_EXTS = new Set(['.md', '.mdx', '.txt']);
const TEST_DIRS = new Set(['tests', 'test', '__tests__']);
const TEST_BASENAME_PATTERN = /\.(test|spec)\.|^test_.*\.py$|_test\.(py|go)$/;
const PROSE_EXTS = new Set(['.md', '.mdx', '.txt', '.rst', '.adoc']);
const CONFIG_EXTS = new Set(['.json', '.jsonc', '.yaml', '.yml', '.toml', '.ini']);
const ENV_BASENAME_PATTERN = /^\.env($|\.)/;
const CODE_EXTS = new Set(['.ts', '.js', '.mjs', '.cjs', '.py', '.go', '.rs', '.java', '.rb']);

/** Classify a path; first match wins: instruction, test, prose, config, code (the fallback). */
function classifyTarget(filePath) {
  try {
    const normalized = String(filePath || '').replace(/\\/g, '/').toLowerCase();
    const segments = normalized.split('/').filter(Boolean);
    const base = segments.pop() || '';
    const ext = path.posix.extname(base);
    if (INSTRUCTION_BASENAMES.has(base) || INSTRUCTION_ANYWHERE_EXTS.has(ext)) return 'instruction';
    if (INSTRUCTION_EXTS.has(ext) && segments.some(segment => INSTRUCTION_DIRS.has(segment))) return 'instruction';
    if (ext === '.md' && base.includes('instructions') && segments.includes('.github')) return 'instruction';
    if (TEST_BASENAME_PATTERN.test(base) || segments.some(segment => TEST_DIRS.has(segment))) return 'test';
    if (PROSE_EXTS.has(ext)) return 'prose';
    if (CONFIG_EXTS.has(ext) || (ENV_BASENAME_PATTERN.test(base) && !CODE_EXTS.has(ext))) return 'config';
    return 'code';
  } catch (_) {
    return 'code';
  }
}

const WORKTREE_PREFIX_PATTERN = /^\.claude\/worktrees\/([^/]+)\//;

function isHostPathStyle(isWin) {
  return isWin === (process.platform === 'win32');
}

function foldKey(nativePath, isWin) {
  const key = nativePath.replace(/\\/g, '/');
  return isWin ? key.toLowerCase() : key;
}

function canonicalProjectRoot(data) {
  const root = process.env.CLAUDE_PROJECT_DIR || (data && data.cwd) || process.cwd();
  if (typeof root !== 'string') return null;
  const isWin = WINDOWS_PATH_PATTERN.test(root);
  const paths = isWin ? path.win32 : path.posix;
  if (!paths.isAbsolute(root)) return null;
  const native = paths.resolve(root);
  return { key: foldKey(native, isWin), native, isWin };
}

// see docs/gateguard/design-notes.md#worktree-prefix
function isRealWorktree(rootNative, isWin, name) {
  if (!isHostPathStyle(isWin)) return false;
  const paths = isWin ? path.win32 : path.posix;
  return fs.existsSync(paths.join(rootNative, '.claude', 'worktrees', name, '.git'));
}

const STREAM_MARKER = '::$';

// see docs/gateguard/design-notes.md#windows-name-normalization
function normalizeWindowsSegments(classPath, isWin) {
  const segments = classPath.split('/');
  const last = segments.length - 1;
  return segments
    .map((segment, index) => {
      if (!isWin && !segment.includes(STREAM_MARKER)) return segment;
      let name = segment;
      const colon = name.indexOf(':');
      if (index === last && colon > 0) name = name.slice(0, colon);
      name = name.replace(/[. ]+$/, '');
      return name || segment;
    })
    .join('/');
}

function projectRelativeClassPath(key, root, isWin) {
  const target = isWin ? key.toLowerCase() : key;
  const rootKey = isWin ? root.key.toLowerCase() : root.key;
  const prefix = rootKey.endsWith('/') ? rootKey : `${rootKey}/`;
  if (!target.startsWith(prefix)) return null;
  let relative = key.slice(prefix.length);
  const worktree = relative.match(WORKTREE_PREFIX_PATTERN);
  if (worktree && isRealWorktree(root.native, root.isWin, worktree[1])) relative = relative.slice(worktree[0].length);
  return normalizeWindowsSegments(relative, isWin);
}

/** Project-relative path a target is classified by. */
function classPathFor(filePath, data) {
  try {
    const key = canonicalPathKey(filePath, data);
    const root = canonicalProjectRoot(data);
    const isWin = Boolean(root && root.isWin) || WINDOWS_PATH_PATTERN.test(key);
    if (!root) return normalizeWindowsSegments(key, isWin);
    const relative = projectRelativeClassPath(key, root, isWin);
    return relative === null ? normalizeWindowsSegments(key, isWin) : relative;
  } catch (_) {
    return filePath;
  }
}

/** Class of a hook target, judged on its project-relative path. */
function classifyTargetFor(filePath, data) {
  return classifyTarget(classPathFor(filePath, data));
}

const SEARCH_THE_TREE = '(search the tree — Glob/Grep, or find/grep via Bash)';
const QUOTE_INSTRUCTION = "Quote the user's current instruction verbatim";

const QUESTION_TEXT = Object.freeze({
  importers: `List ALL files that import/require this file ${SEARCH_THE_TREE}`,
  'public-api': 'List the public functions/classes affected by this change',
  'local-callers': `List the call sites in this file or its module that rely on the changed behaviour ${SEARCH_THE_TREE}`,
  callers: 'Name the file(s) and line(s) that will call this new file',
  'no-duplicate': `Confirm no existing file serves the same purpose ${SEARCH_THE_TREE}`,
  'data-schema':
    'If this file reads/writes data files, show field names, structure, and date format (use redacted or synthetic values, not raw production data)',
  loader: 'Name the harness/loader that reads this file (Claude Code, Codex, Cursor, OpenCode, …) and when it loads it',
  'behaviour-change': 'Describe what agent behaviour changes as a result',
  'no-duplicate-instruction': `Confirm no existing instruction, skill, or agent file already covers this ${SEARCH_THE_TREE}`,
  'under-test': 'Name what behaviour is under test and which module/function it exercises',
  'existing-tests': `Name the existing test file(s) covering this module, or confirm none exist ${SEARCH_THE_TREE}`,
  supersedes: `Name any existing doc this supersedes or duplicates ${SEARCH_THE_TREE}`,
  'linked-from': 'State where it will be linked or referenced from',
  'why-new-file': 'Explain why a new file rather than editing an existing one',
  references: `List other docs or code that reference the section being changed ${SEARCH_THE_TREE}`,
  'corrects-or-adds': 'State what the change corrects or adds',
  'config-reader': 'Name which process/tool reads this file and when',
  'config-effect': 'Describe the effect of the change',
  'no-plaintext-secrets': 'Confirm no secrets or credentials are being written in plain text',
  'quote-instruction': QUOTE_INSTRUCTION
});

const CLASS_QUESTION_IDS = {
  instruction: () => ['loader', 'behaviour-change', 'no-duplicate-instruction'],
  test: () => ['under-test', 'existing-tests'],
  prose: isWrite => (isWrite ? ['supersedes', 'linked-from', 'why-new-file'] : ['references', 'corrects-or-adds']),
  config: () => ['config-reader', 'config-effect', 'no-plaintext-secrets']
};

const CLASS_QUESTIONS = Object.fromEntries(
  Object.entries(CLASS_QUESTION_IDS).map(([cls, ids]) => [cls, isWrite => ids(isWrite).map(id => QUESTION_TEXT[id])])
);

// see docs/gateguard/change-profile.md#questions-from-the-change-profile
function codeQuestionIds(isWrite, profile) {
  const known = Boolean(profile) && profile.known === true;
  const surface = !known || profile.touchesPublicSurface !== false;
  const data = !known || profile.touchesData !== false;
  const opening = isWrite ? ['callers', 'no-duplicate'] : surface ? ['importers', 'public-api'] : ['local-callers'];
  return data ? [...opening, 'data-schema'] : opening;
}

/** True when a class's questions depend on the change profile. */
function questionsUseProfile(cls) {
  return !Object.hasOwn(CLASS_QUESTION_IDS, cls);
}

/** Stable ids of the first-touch questions for a class, action and change profile. */
function questionIdsFor(cls, isWrite, profile) {
  const ids = Object.hasOwn(CLASS_QUESTION_IDS, cls) ? CLASS_QUESTION_IDS[cls](Boolean(isWrite)) : codeQuestionIds(Boolean(isWrite), profile);
  return [...ids, 'quote-instruction'];
}

/** Question text for an id from `questionIdsFor`. */
function questionText(id) {
  return Object.hasOwn(QUESTION_TEXT, id) ? QUESTION_TEXT[id] : '';
}

const CODE_CONDENSED_HINT =
  "briefly state importers/callers, affected API, data schemas if any, and the user's verbatim instruction, then retry.";

const CONDENSED_PHRASES = Object.freeze({
  importers: 'the files that import this file',
  'public-api': 'the public functions/classes affected',
  'local-callers': 'the call sites in this file or its module that rely on the change',
  callers: 'the file(s) and line(s) that will call it',
  'no-duplicate': 'that no existing file serves the same purpose',
  'data-schema': 'the data schemas it reads or writes',
  'quote-instruction': "the user's verbatim instruction"
});

/** Condensed-hint phrase for a code question id, or '' when it has none. */
function condensedQuestionPhrase(id) {
  return Object.hasOwn(CONDENSED_PHRASES, id) ? CONDENSED_PHRASES[id] : '';
}

function joinPhrases(phrases) {
  if (phrases.length <= 2) return phrases.join(' and ');
  return `${phrases.slice(0, -1).join(', ')}, and ${phrases[phrases.length - 1]}`;
}

const CLASS_CONDENSED_HINTS = {
  instruction: () =>
    "briefly state which harness loads this file, the agent behaviour it changes, that no existing instruction file covers it, and the user's verbatim instruction, then retry.",
  test: () =>
    "briefly state the behaviour and module under test, existing test files for it (or none), and the user's verbatim instruction, then retry.",
  prose: isWrite =>
    isWrite
      ? "briefly state what this supersedes, where it is linked from, and the user's verbatim instruction, then retry."
      : "briefly state what references the changed section, what the change corrects or adds, and the user's verbatim instruction, then retry.",
  config: () =>
    "briefly state which process reads this file, the effect of the change, that no secrets are written in plain text, and the user's verbatim instruction, then retry."
};

/** One-line condensed hint matching `questionIdsFor`. */
function condensedHintFor(cls, isWrite, profile) {
  if (Object.hasOwn(CLASS_CONDENSED_HINTS, cls)) return CLASS_CONDENSED_HINTS[cls](Boolean(isWrite));
  if (!isWrite && !(profile && profile.known === true)) return CODE_CONDENSED_HINT;
  const phrases = questionIdsFor(cls, isWrite, profile).map(condensedQuestionPhrase).filter(Boolean);
  return `briefly state ${joinPhrases(phrases)}, then retry.`;
}

// --- Sensitive targets ---
// see docs/gateguard/design-notes.md#sensitive-targets

const SENSITIVE_EXTS = new Set(['.pem', '.key', '.p12', '.pfx']);
const SENSITIVE_BASENAME_PATTERN = /^(\.env($|\.)|id_rsa|id_ed25519|id_ecdsa|id_dsa|\.netrc$|\.pgpass$|credentials|secrets\.)/;
const SENSITIVE_SEGMENTS = new Set(['auth', 'authn', 'authz', 'security', 'secrets', 'payment', 'payments', 'billing', 'migrations']);
const SENSITIVE_PREFIX = '.github/workflows/';

/** True for a sensitive class path; any error or non-string input is sensitive. */
function isSensitiveTarget(classPath) {
  try {
    if (typeof classPath !== 'string' || !classPath) return true;
    const normalized = classPath.replace(/\\/g, '/').toLowerCase();
    const segments = normalized.split('/').filter(Boolean);
    const base = segments[segments.length - 1] || '';
    if (SENSITIVE_BASENAME_PATTERN.test(base) || SENSITIVE_EXTS.has(path.posix.extname(base))) return true;
    if (segments.some(segment => SENSITIVE_SEGMENTS.has(segment))) return true;
    return `/${segments.join('/')}`.includes(`/${SENSITIVE_PREFIX}`);
  } catch (_) {
    return true;
  }
}

/** Sensitive on the lexical or the real (symlink-resolved) path; any error is sensitive. */
function isSensitiveTargetFor(filePath, data) {
  try {
    if (typeof filePath !== 'string' || !filePath) return true;
    if (isSensitiveTarget(classPathFor(filePath, data))) return true;
    return isSensitiveRealTarget(filePath, data);
  } catch (_) {
    return true;
  }
}

function isSensitiveRealTarget(filePath, data) {
  const target = resolveTargetPath(filePath, data);
  if (!target || !isHostPathStyle(target.isWin)) return false;
  const paths = target.isWin ? path.win32 : path.posix;
  const real = realTargetPath(target.resolved, paths);
  if (!real) return true;
  const realKey = foldKey(real, target.isWin);
  if (realKey === foldKey(target.resolved, target.isWin)) return false;
  const root = canonicalProjectRoot(data);
  if (root && root.isWin === target.isWin) {
    const realRoot = realpathOfNearestAncestor(root.native, paths);
    if (!realRoot) return true;
    const realRootInfo = { ...root, key: foldKey(realRoot, target.isWin), native: realRoot };
    const realClassPath = projectRelativeClassPath(realKey, realRootInfo, target.isWin);
    if (realClassPath !== null) return isSensitiveTarget(realClassPath);
  }
  return isSensitiveTarget(normalizeWindowsSegments(realKey, target.isWin));
}

// --- Hard-linked targets ---
// see docs/gateguard/design-notes.md#hard-linked-targets

const MISSING_TARGET_CODES = new Set(['ENOENT', 'ENOTDIR']);

function hasOtherLinks(stat) {
  return !stat.isDirectory() && stat.nlink > 1;
}

/** True when the target file has more than one hard link; a stat error other than a missing file counts as linked. */
function isHardLinkedTargetFor(filePath, data) {
  try {
    const target = resolveTargetPath(filePath, data);
    if (!target) return true;
    if (!isHostPathStyle(target.isWin)) return false;
    const stat = fs.lstatSync(target.resolved);
    if (!stat.isSymbolicLink()) return hasOtherLinks(stat);
    return hasOtherLinks(fs.statSync(target.resolved));
  } catch (error) {
    return !(error && MISSING_TARGET_CODES.has(error.code));
  }
}

// --- Sibling collapse eligibility ---
// see docs/gateguard/design-notes.md#sibling-collapse

const COLLAPSIBLE_CLASSES = new Set(['code', 'test', 'prose']);
const SHORT_NAME_PATTERN = /~\d/;

function isCollapsibleClassPath(classPath, cls) {
  if (!COLLAPSIBLE_CLASSES.has(cls)) return false;
  const segments = String(classPath).toLowerCase().split('/').filter(Boolean);
  if (segments.length === 0) return false;
  return !segments.some(segment => segment.startsWith('.') || SHORT_NAME_PATTERN.test(segment));
}

/** Lexical collapse screen; `collapseGateDir` adds the real-directory screen. */
function isCollapsibleTarget(filePath, data, cls) {
  return isCollapsibleClassPath(classPathFor(filePath, data), cls);
}

function realpathOfNearestAncestor(nativePath, paths) {
  const realpath = fs.realpathSync.native || fs.realpathSync;
  const missing = [];
  let current = nativePath;
  for (;;) {
    try {
      const real = realpath(current);
      if (!fs.statSync(real).isDirectory()) return null;
      return missing.length > 0 ? paths.join(real, ...missing.reverse()) : real;
    } catch (error) {
      if (!error || error.code !== 'ENOENT' || !isMissingEntry(current)) return null;
      const parent = paths.dirname(current);
      if (parent === current) return null;
      missing.push(paths.basename(current));
      current = parent;
    }
  }
}

function realTargetPath(resolved, paths) {
  const realpath = fs.realpathSync.native || fs.realpathSync;
  try {
    return realpath(resolved);
  } catch (error) {
    if (!error || error.code !== 'ENOENT' || !isMissingEntry(resolved)) return null;
  }
  const realDir = realpathOfNearestAncestor(paths.dirname(resolved), paths);
  return realDir ? paths.join(realDir, paths.basename(resolved)) : null;
}

function isMissingEntry(nativePath) {
  try {
    fs.lstatSync(nativePath);
    return false;
  } catch (error) {
    return Boolean(error) && error.code === 'ENOENT';
  }
}

/** Real directory a new file's sibling gate is keyed by, or null when it may not collapse. */
function collapseGateDir(filePath, data, cls) {
  try {
    if (!isCollapsibleTarget(filePath, data, cls)) return null;
    const target = resolveTargetPath(filePath, data);
    if (!target || !isHostPathStyle(target.isWin)) return null;
    const paths = target.isWin ? path.win32 : path.posix;
    const lexicalDir = paths.dirname(target.resolved);
    const realDir = realpathOfNearestAncestor(lexicalDir, paths);
    if (!realDir) return null;
    const realKey = foldKey(realDir, target.isWin);
    if (realKey === foldKey(lexicalDir, target.isWin)) return realKey;
    const root = canonicalProjectRoot(data);
    if (!root || root.isWin !== target.isWin) return null;
    const realRoot = realpathOfNearestAncestor(root.native, paths);
    if (!realRoot) return null;
    const realTargetKey = foldKey(paths.join(realDir, paths.basename(target.resolved)), target.isWin);
    const realClassPath = projectRelativeClassPath(realTargetKey, { ...root, key: foldKey(realRoot, target.isWin), native: realRoot }, target.isWin);
    if (realClassPath === null || classifyTarget(realClassPath) !== cls) return null;
    if (isSensitiveTarget(realClassPath)) return null;
    return isCollapsibleClassPath(realClassPath, cls) ? realKey : null;
  } catch (_) {
    return null;
  }
}

module.exports = {
  questionsUseProfile,
  WINDOWS_PATH_PATTERN,
  COLLAPSIBLE_CLASSES,
  CLASS_QUESTIONS,
  CLASS_CONDENSED_HINTS,
  QUOTE_INSTRUCTION,
  questionIdsFor,
  questionText,
  condensedHintFor,
  condensedQuestionPhrase,
  resolveTargetPath,
  canonicalPathKey,
  classifyTarget,
  classPathFor,
  classifyTargetFor,
  isCollapsibleTarget,
  collapseGateDir,
  isSensitiveTarget,
  isSensitiveTargetFor,
  isHardLinkedTargetFor
};
