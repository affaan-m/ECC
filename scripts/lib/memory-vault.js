'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { assertWithinTrustedRoot, realpathNearestExisting } = require('./path-safety');
const {
  MAX_BODY_BYTES,
  MAX_DOCUMENT_BYTES,
  MEMORY_KINDS,
  MEMORY_SCHEMA_VERSION,
  MEMORY_SCOPES,
  MEMORY_STATUSES,
  MEMORY_TRUST_STATES,
  asNonEmptyString,
  decodeUtf8,
  findPotentialSecrets,
  hasUnsafeControlCharacters,
  normalizeMemory,
  parseMemoryDocument,
  serializeMemoryDocument,
  uniqueStrings,
  validateEnum,
  validateMemoryId,
  validateSlug,
} = require('./memory-vault-format');

const DEFAULT_RECALL_SCOPES = Object.freeze(['project', 'team']);

const MAX_FILES = 5000;
const MAX_SCAN_BYTES = 16 * 1024 * 1024;
const MAX_DIAGNOSTICS = 100;
const MAX_QUERY_CHARS = 500;
const MAX_RESULTS = 100;
const PROJECT_MEMORY_GITIGNORE = '*\n!.gitignore\n';

const VAULT_ROOT_BOUNDARIES = Symbol('vaultRootBoundaries');

function findNearestProjectRoot(cwd) {
  let current = path.resolve(cwd);
  while (true) {
    if (fs.existsSync(path.join(current, '.git'))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return path.resolve(cwd);
    }
    current = parent;
  }
}

function resolveOverride(value, cwd) {
  return path.resolve(cwd, asNonEmptyString(value, 'memory root override', 4096));
}

function resolveVaultRoots(options = {}) {
  const cwd = path.resolve(options.cwd || process.cwd());
  const env = options.env || process.env;
  const homeDir = path.resolve(
    options.homeDir || env.HOME || env.USERPROFILE || os.homedir()
  );
  const projectRoot = findNearestProjectRoot(cwd);
  const projectVault = env.ECC_MEMORY_PROJECT_ROOT
    ? resolveOverride(env.ECC_MEMORY_PROJECT_ROOT, cwd)
    : path.join(projectRoot, '.ecc', 'memory');
  const userVault = env.ECC_MEMORY_USER_ROOT
    ? resolveOverride(env.ECC_MEMORY_USER_ROOT, cwd)
    : path.join(homeDir, '.ecc', 'memory');

  const roots = {
    project: path.join(projectVault, 'project'),
    team: path.join(projectVault, 'team'),
    user: userVault,
  };
  Object.defineProperty(roots, VAULT_ROOT_BOUNDARIES, {
    value: Object.freeze({
      project: env.ECC_MEMORY_PROJECT_ROOT
        ? realpathNearestExisting(projectVault)
        : projectRoot,
      team: env.ECC_MEMORY_PROJECT_ROOT
        ? realpathNearestExisting(projectVault)
        : projectRoot,
      user: env.ECC_MEMORY_USER_ROOT
        ? realpathNearestExisting(userVault)
        : homeDir,
    }),
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return Object.freeze(roots);
}

function assertMemoryRootSafe(roots, scope) {
  if (!roots || typeof roots !== 'object' || Array.isArray(roots)) {
    throw new Error('Memory roots must include a trusted boundary policy.');
  }
  const root = roots[scope];
  if (typeof root !== 'string' || root.length === 0) {
    throw new Error(`No memory root is configured for scope "${scope}".`);
  }
  const boundary = roots[VAULT_ROOT_BOUNDARIES]?.[scope];
  if (typeof boundary !== 'string' || boundary.length === 0) {
    throw new Error(`No trusted boundary policy is configured for memory scope "${scope}".`);
  }
  assertWithinTrustedRoot(root, boundary, 'access memory through a symlink');
  if (fs.existsSync(root) && (fs.lstatSync(root).isSymbolicLink() || fs.existsSync(`${root}.symlink.json`))) {
    throw new Error(`Refusing to access memory through symlink root: ${root}`);
  }
  return root;
}

function assertMemoryDirectorySafe(directory, root) {
  assertWithinTrustedRoot(directory, root, 'access memory directory');
  if (fs.existsSync(directory) && (fs.lstatSync(directory).isSymbolicLink() || fs.existsSync(`${directory}.symlink.json`))) {
    throw new Error(`Refusing to access memory through symlink directory: ${directory}`);
  }
  return directory;
}

function sameFileIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function readRegularTextFile(filePath, options = {}) {
  const label = options.label || 'file';
  const maxBytes = options.maxBytes || MAX_DOCUMENT_BYTES;
  if (options.trustedRoot) {
    assertWithinTrustedRoot(filePath, options.trustedRoot, `read ${label}`);
  }

  // Emulated symlink marker handling: if an emulation metadata file exists,
  // treat the target as a symbolic link to preserve the security semantics on
  // platforms that cannot create real symlinks.
  try {
    if (fs.existsSync(`${filePath}.symlink.json`)) {
      throw new Error(`${label} must remain a regular, non-symlink file (symbolic link detected).`);
    }
  } catch (e) {
    // ignore stat errors and continue — open will handle them
  }

  const flags = fs.constants.O_RDONLY
    | (fs.constants.O_NOFOLLOW || 0)
    | (fs.constants.O_NONBLOCK || 0);
  const descriptor = fs.openSync(filePath, flags);
  try {
    const opened = fs.fstatSync(descriptor);
    if (!opened.isFile()) {
      throw new Error(`${label} must be a regular, non-symlink file.`);
    }
    const after = fs.lstatSync(filePath);
    if (
      after.isSymbolicLink()
      || !after.isFile()
      || !sameFileIdentity(after, opened)
    ) {
      throw new Error(`${label} must remain a regular, non-symlink file while it is opened.`);
    }
    if (options.trustedRoot) {
      assertWithinTrustedRoot(filePath, options.trustedRoot, `read ${label}`);
    }
    if (opened.size > maxBytes) {
      throw new Error(`${label} is too large (${opened.size} bytes).`);
    }

    const chunks = [];
    let total = 0;
    while (total <= maxBytes) {
      const buffer = Buffer.alloc(Math.min(64 * 1024, maxBytes + 1 - total));
      const bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      chunks.push(buffer.subarray(0, bytesRead));
      total += bytesRead;
    }
    if (total > maxBytes) {
      throw new Error(`${label} is too large (maximum ${maxBytes} bytes).`);
    }
    return decodeUtf8(Buffer.concat(chunks, total), label);
  } finally {
    fs.closeSync(descriptor);
  }
}

function writeCreateOnlyTextFile(filePath, content, trustedRoot) {
  assertWithinTrustedRoot(filePath, trustedRoot, 'write memory');
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.ecc-memory-${process.pid}-${crypto.randomUUID()}.tmp`
  );
  const flags = fs.constants.O_WRONLY
    | fs.constants.O_CREAT
    | fs.constants.O_EXCL
    | (fs.constants.O_NOFOLLOW || 0);
  let descriptor;
  let operationError;
  let cleanupError;
  try {
    descriptor = fs.openSync(temporaryPath, flags, 0o600);
    const opened = fs.fstatSync(descriptor);
    const after = fs.lstatSync(temporaryPath);
    assertWithinTrustedRoot(temporaryPath, trustedRoot, 'write memory');
    if (
      !opened.isFile()
      || after.isSymbolicLink()
      || !after.isFile()
      || !sameFileIdentity(after, opened)
    ) {
      throw new Error('Memory destination changed while it was being created.');
    }
    fs.writeFileSync(descriptor, content, 'utf8');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    assertWithinTrustedRoot(filePath, trustedRoot, 'write memory');
    fs.linkSync(temporaryPath, filePath);
  } catch (error) {
    operationError = error;
  } finally {
    if (descriptor !== undefined) {
      try {
        fs.closeSync(descriptor);
      } catch (error) {
        cleanupError = error;
      }
    }
    try {
      fs.unlinkSync(temporaryPath);
    } catch (error) {
      if (!error || error.code !== 'ENOENT') cleanupError = cleanupError || error;
    }
  }
  if (operationError) throw operationError;
  if (cleanupError) throw cleanupError;
}

function ensureProjectScopeIgnored(roots, scope) {
  if (scope !== 'project') return;
  const root = roots.project;
  const ignorePath = path.join(root, '.gitignore');
  try {
    writeCreateOnlyTextFile(ignorePath, PROJECT_MEMORY_GITIGNORE, root);
  } catch (error) {
    if (!error || error.code !== 'EEXIST') throw error;
    const existing = readRegularTextFile(ignorePath, {
      label: 'project memory .gitignore',
      maxBytes: MAX_DOCUMENT_BYTES,
      trustedRoot: root,
    });
    if (existing !== PROJECT_MEMORY_GITIGNORE) {
      throw new Error(
        'Project memory .gitignore does not contain the required fail-closed rules.'
      );
    }
  }
}

function normalizeScopes(scopes = MEMORY_SCOPES) {
  const values = Array.isArray(scopes) ? scopes : [scopes];
  return uniqueStrings(values, {
    label: 'scopes',
    limit: MEMORY_SCOPES.length,
    validator: value => validateEnum(value, MEMORY_SCOPES, 'memory scope'),
  });
}

function initializeVault(options = {}) {
  const roots = options.roots || resolveVaultRoots(options);
  const scopes = normalizeScopes(options.scopes || DEFAULT_RECALL_SCOPES);
  const directories = scopes.flatMap(scope => {
    const root = assertMemoryRootSafe(roots, scope);
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    ensureProjectScopeIgnored(roots, scope);
    return MEMORY_KINDS.map(kind => {
      const directory = path.join(root, `${kind}s`);
      assertMemoryDirectorySafe(directory, root);
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
      return directory;
    });
  });
  return { scopes, roots, directories };
}

function defaultMemoryId(now = new Date()) {
  const day = now.toISOString().slice(0, 10).replace(/-/g, '');
  const random = crypto.randomUUID().replace(/-/g, '').slice(0, 20);
  return `mem_${day}_${random}`;
}

function normalizeSaveInput(input, options) {
  const now = options.now ? options.now() : new Date().toISOString();
  const id = input.id || (
    options.idFactory ? options.idFactory() : defaultMemoryId(new Date(now))
  );
  return normalizeMemory({
    schema: MEMORY_SCHEMA_VERSION,
    id,
    title: input.title,
    kind: input.kind || 'note',
    scope: input.scope || 'project',
    trust: 'unreviewed',
    status: 'active',
    sourceHarness: input.sourceHarness || 'unknown',
    targetHarnesses: input.targetHarnesses || ['all'],
    tags: input.tags || [],
    links: input.links || [],
    createdAt: now,
    updatedAt: now,
    body: input.body || '',
  });
}

function saveMemory(input, options = {}) {
  const roots = options.roots || resolveVaultRoots(options);
  const memory = normalizeSaveInput(input || {}, options);
  const secretKinds = findPotentialSecrets(JSON.stringify(memory));
  if (secretKinds.length > 0) {
    throw new Error(`Refusing to save memory containing a suspected secret (${secretKinds.join(', ')}).`);
  }

  const root = assertMemoryRootSafe(roots, memory.scope);
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  ensureProjectScopeIgnored(roots, memory.scope);
  const directory = path.join(root, `${memory.kind}s`);
  assertMemoryDirectorySafe(directory, root);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const destination = path.join(directory, `${memory.id}.md`);

  try {
    writeCreateOnlyTextFile(destination, serializeMemoryDocument(memory), root);
  } catch (error) {
    if (error && error.code === 'EEXIST') {
      throw new Error(`Memory ${memory.id} already exists; writes are create-only.`);
    }
    throw error;
  }
  return { memory, path: destination };
}

function walkMemoryRoot(root, maxEntries = MAX_FILES) {
  if (!root || !fs.existsSync(root)) {
    return {
      paths: [],
      skippedSymlinks: [],
      skippedSymlinkCount: 0,
      truncated: false,
      visitedCount: 0,
    };
  }

  const paths = [];
  const skippedSymlinks = [];
  let skippedSymlinkCount = 0;
  let visitedCount = 0;
  let truncated = false;

  const walk = (directory, depth) => {
    if (depth > 8 || visitedCount >= maxEntries) {
      truncated = true;
      return;
    }
    const handle = fs.opendirSync(directory);
    const entries = [];
    try {
      while (entries.length < maxEntries - visitedCount) {
        const entry = handle.readSync();
        if (!entry) break;
        entries.push(entry);
      }
      if (handle.readSync() !== null) truncated = true;
    } finally {
      handle.closeSync();
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (visitedCount >= maxEntries) {
        truncated = true;
        break;
      }
      visitedCount += 1;
      const entryPath = path.join(directory, entry.name);
      // Treat actual symbolic links and emulated symlinks (created by
      // createSymlinkOrEmulation) as skipped symlinks for the purpose of
      // directory traversal.
      if (entry.isSymbolicLink() || fs.existsSync(`${entryPath}.symlink.json`)) {
        skippedSymlinkCount += 1;
        if (skippedSymlinks.length < MAX_DIAGNOSTICS) {
          skippedSymlinks.push(entryPath);
        }
        continue;
      }

      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        walk(entryPath, depth + 1);
        continue;
      }
      const include = entry.isFile()
        && entry.name.endsWith('.md')
        && !entry.name.startsWith('.');
      if (include) paths.push(entryPath);
    }
  };

  walk(root, 0);
  return {
    paths,
    skippedSymlinks,
    skippedSymlinkCount,
    truncated,
    visitedCount,
  };
}

function vaultRelativePath(scope, root, filePath) {
  const relative = path.relative(root, filePath).split(path.sep).join('/');
  return `${scope}:${relative}`;
}

function assertMemoryMatchesLocation(memory, scope, root, filePath) {
  const [kindDirectory] = path.relative(root, filePath).split(path.sep);
  if (memory.scope !== scope || kindDirectory !== `${memory.kind}s`) {
    const error = new Error('Memory metadata does not match its vault location.');
    error.code = 'ECC_MEMORY_LOCATION_MISMATCH';
    throw error;
  }
}

function publicMemoryFileError(error) {
  if (error?.code === 'ECC_MEMORY_SECRET') {
    return { code: 'suspected-secret', message: 'Memory document was quarantined.' };
  }
  if (error?.code === 'ECC_MEMORY_LOCATION_MISMATCH') {
    return {
      code: 'location-mismatch',
      message: 'Memory metadata does not match its vault location.',
    };
  }
  return {
    code: 'invalid-document',
    message: 'Memory document is invalid or unreadable.',
  };
}

function readMemoryFiles(options = {}) {
  const roots = options.roots || resolveVaultRoots(options);
  const scopes = normalizeScopes(options.scopes || DEFAULT_RECALL_SCOPES);
  const entries = [];
  const invalidFiles = [];
  const skippedSymlinks = [];
  let invalidFileCount = 0;
  let skippedSymlinkCount = 0;
  let visitedCount = 0;
  let scannedBytes = 0;
  let truncated = false;

  for (const scope of scopes) {
    if (visitedCount >= MAX_FILES || scannedBytes >= MAX_SCAN_BYTES) {
      truncated = true;
      break;
    }
    const root = assertMemoryRootSafe(roots, scope);
    const walked = walkMemoryRoot(root, MAX_FILES - visitedCount);
    visitedCount += walked.visitedCount;
    truncated = truncated || walked.truncated;
    skippedSymlinkCount += walked.skippedSymlinkCount;
    for (const skippedPath of walked.skippedSymlinks) {
      if (skippedSymlinks.length >= MAX_DIAGNOSTICS) break;
      skippedSymlinks.push(vaultRelativePath(scope, root, skippedPath));
    }

    for (const filePath of walked.paths) {
      if (scannedBytes >= MAX_SCAN_BYTES) {
        truncated = true;
        break;
      }
      try {
        const source = readRegularTextFile(filePath, {
          label: 'memory document',
          maxBytes: MAX_DOCUMENT_BYTES,
          trustedRoot: root,
        });
        const sourceBytes = Buffer.byteLength(source, 'utf8');
        if (scannedBytes + sourceBytes > MAX_SCAN_BYTES) {
          truncated = true;
          break;
        }
        scannedBytes += sourceBytes;
        const memory = parseMemoryDocument(source, filePath);
        assertMemoryMatchesLocation(memory, scope, root, filePath);
        if (findPotentialSecrets(JSON.stringify(memory)).length > 0) {
          const error = new Error('Memory contains a suspected secret.');
          error.code = 'ECC_MEMORY_SECRET';
          throw error;
        }
        entries.push({
          memory,
          path: vaultRelativePath(scope, root, filePath),
        });
      } catch (error) {
        invalidFileCount += 1;
        if (invalidFiles.length < MAX_DIAGNOSTICS) {
          invalidFiles.push({
            path: vaultRelativePath(scope, root, filePath),
            ...publicMemoryFileError(error),
          });
        }
      }
    }
  }

  return {
    entries,
    invalidFiles,
    invalidFileCount,
    skippedSymlinks,
    skippedSymlinkCount,
    scannedBytes,
    truncated,
    diagnosticsTruncated: invalidFileCount > invalidFiles.length
      || skippedSymlinkCount > skippedSymlinks.length,
  };
}

function tokenize(value) {
  return String(value || '').toLowerCase().match(/[\p{L}\p{N}_-]+/gu) || [];
}

function countOccurrences(haystack, needle) {
  if (!needle) return 0;
  let count = 0;
  let offset = 0;
  while (count < 8) {
    const index = haystack.indexOf(needle, offset);
    if (index < 0) break;
    count += 1;
    offset = index + needle.length;
  }
  return count;
}

function scoreMemory(memory, query) {
  const normalizedQuery = query.toLowerCase();
  const tokens = Array.from(new Set(tokenize(query)));
  const title = memory.title.toLowerCase();
  const body = memory.body.toLowerCase();
  const tags = memory.tags.map(tag => tag.toLowerCase());
  const metadata = [
    memory.kind,
    memory.scope,
    memory.sourceHarness,
    ...memory.targetHarnesses,
  ].join(' ').toLowerCase();

  const phraseScore = normalizedQuery && title.includes(normalizedQuery)
    ? 20
    : normalizedQuery && body.includes(normalizedQuery) ? 5 : 0;
  return tokens.reduce((score, token) => (
    score
      + (title.includes(token) ? 8 : 0)
      + (tags.includes(token) ? 6 : 0)
      + (metadata.includes(token) ? 3 : 0)
      + Math.min(countOccurrences(body, token), 5)
  ), phraseScore);
}

function buildExcerpt(body, query, maxChars = 240) {
  const normalized = String(body || '').replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxChars) return normalized;
  const tokens = tokenize(query);
  const lower = normalized.toLowerCase();
  const matchIndex = tokens.reduce((best, token) => {
    const index = lower.indexOf(token);
    if (index < 0) return best;
    return best < 0 ? index : Math.min(best, index);
  }, -1);
  const start = Math.max(0, (matchIndex < 0 ? 0 : matchIndex) - 60);
  const prefix = start > 0 ? '…' : '';
  const suffix = start + maxChars < normalized.length ? '…' : '';
  return `${prefix}${normalized.slice(start, start + maxChars)}${suffix}`;
}

function summarizeMemory(memory) {
  return Object.fromEntries(
    Object.entries(memory).filter(([key]) => key !== 'body')
  );
}

function searchMemories(query, options = {}) {
  const normalizedQuery = typeof query === 'string' ? query.trim() : '';
  if (normalizedQuery.length > MAX_QUERY_CHARS) {
    throw new Error(`memory search query is too long (maximum ${MAX_QUERY_CHARS} characters).`);
  }
  if (hasUnsafeControlCharacters(normalizedQuery)) {
    throw new Error('memory search query must not contain control characters.');
  }

  const kinds = options.kinds
    ? uniqueStrings(options.kinds, {
      label: 'kinds',
      limit: MEMORY_KINDS.length,
      validator: value => validateEnum(value, MEMORY_KINDS, 'memory kind'),
    })
    : null;
  const trust = options.trust
    ? validateEnum(options.trust, MEMORY_TRUST_STATES, 'memory trust')
    : null;
  const targetHarness = options.targetHarness
    ? validateSlug(options.targetHarness, 'target harness')
    : null;
  const limit = Math.max(1, Math.min(Number(options.limit) || 20, MAX_RESULTS));
  const loaded = readMemoryFiles({ ...options, scopes: options.scopes || options.scope });

  const results = loaded.entries
    .filter(({ memory }) => memory.status === 'active')
    .filter(({ memory }) => !kinds || kinds.includes(memory.kind))
    .filter(({ memory }) => !trust || memory.trust === trust)
    .filter(({ memory }) => (
      !targetHarness
      || memory.targetHarnesses.includes('all')
      || memory.targetHarnesses.includes(targetHarness)
    ))
    .map(entry => ({
      ...entry,
      score: normalizedQuery ? scoreMemory(entry.memory, normalizedQuery) : 0,
      excerpt: buildExcerpt(entry.memory.body, normalizedQuery),
    }))
    .filter(result => normalizedQuery.length === 0 || result.score > 0)
    .sort((left, right) => (
      right.score - left.score
      || right.memory.updatedAt.localeCompare(left.memory.updatedAt)
      || left.memory.id.localeCompare(right.memory.id)
    ))
    .slice(0, limit)
    .map(result => ({
      memory: summarizeMemory(result.memory),
      score: result.score,
      excerpt: result.excerpt,
    }));

  return {
    results,
    diagnostics: {
      invalidFiles: loaded.invalidFiles,
      invalidFileCount: loaded.invalidFileCount,
      skippedSymlinks: loaded.skippedSymlinks,
      skippedSymlinkCount: loaded.skippedSymlinkCount,
      scannedBytes: loaded.scannedBytes,
      truncated: loaded.truncated,
      diagnosticsTruncated: loaded.diagnosticsTruncated,
    },
  };
}

function readMemoryById(id, options = {}) {
  const memoryId = validateMemoryId(id);
  const targetHarness = options.targetHarness
    ? validateSlug(options.targetHarness, 'target harness')
    : null;
  const loaded = readMemoryFiles(options);
  const matches = loaded.entries
    .filter(entry => entry.memory.id === memoryId)
    .filter(entry => (
      !targetHarness
      || entry.memory.targetHarnesses.includes('all')
      || entry.memory.targetHarnesses.includes(targetHarness)
    ));
  if (matches.length === 0) {
    throw new Error(`Memory ${memoryId} was not found.`);
  }
  if (matches.length > 1) {
    throw new Error(`Memory ${memoryId} is duplicated in ${matches.length} files.`);
  }
  const allBacklinks = loaded.entries
    .filter(entry => entry.memory.links.includes(memoryId))
    .filter(entry => entry.memory.status === 'active')
    .map(entry => entry.memory)
    .filter(memory => (
      !targetHarness
      || memory.targetHarnesses.includes('all')
      || memory.targetHarnesses.includes(targetHarness)
    ))
    .sort((left, right) => left.id.localeCompare(right.id));
  const backlinks = allBacklinks
    .slice(0, MAX_RESULTS)
    .map(summarizeMemory);
  return {
    ...matches[0],
    backlinks,
    backlinksTruncated: allBacklinks.length > backlinks.length,
  };
}

function doctorMemoryVault(options = {}) {
  const loaded = readMemoryFiles(options);
  const targetHarness = options.targetHarness
    ? validateSlug(options.targetHarness, 'target harness')
    : null;
  const visibleEntries = loaded.entries.filter(entry => (
    !targetHarness
    || entry.memory.targetHarnesses.includes('all')
    || entry.memory.targetHarnesses.includes(targetHarness)
  ));
  const byId = new Map();
  for (const entry of visibleEntries) {
    const paths = byId.get(entry.memory.id) || [];
    paths.push(entry.path);
    byId.set(entry.memory.id, paths);
  }
  const allDuplicateIds = Array.from(byId.entries())
    .filter(([, paths]) => paths.length > 1)
    .map(([id, paths]) => ({ id, paths }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const duplicateIds = allDuplicateIds.slice(0, MAX_DIAGNOSTICS);
  const knownIds = new Set(byId.keys());
  const allBrokenLinks = [];
  let brokenLinkCount = 0;
  for (const entry of visibleEntries) {
    for (const targetId of entry.memory.links) {
      if (!knownIds.has(targetId)) {
        brokenLinkCount += 1;
        if (allBrokenLinks.length < MAX_DIAGNOSTICS) {
          allBrokenLinks.push({
            sourceId: entry.memory.id,
            targetId,
            path: entry.path,
          });
        }
      }
    }
  }
  const brokenLinks = [...allBrokenLinks]
    .sort((left, right) => left.sourceId.localeCompare(right.sourceId));
  const ok = loaded.invalidFileCount === 0
    && allDuplicateIds.length === 0
    && brokenLinkCount === 0
    && loaded.skippedSymlinkCount === 0
    && !loaded.truncated;

  return {
    schemaVersion: 'ecc.memory.doctor.v1',
    ok,
    memoryCount: visibleEntries.length,
    invalidFiles: loaded.invalidFiles,
    invalidFileCount: loaded.invalidFileCount,
    duplicateIds,
    duplicateIdCount: allDuplicateIds.length,
    brokenLinks,
    brokenLinkCount,
    skippedSymlinks: loaded.skippedSymlinks,
    skippedSymlinkCount: loaded.skippedSymlinkCount,
    scannedBytes: loaded.scannedBytes,
    truncated: loaded.truncated,
    diagnosticsTruncated: loaded.diagnosticsTruncated
      || allDuplicateIds.length > duplicateIds.length
      || brokenLinkCount > brokenLinks.length,
  };
}

function createSymlinkOrEmulation(target, linkPath) {
  // Try a real symlink first; fallback to an emulation when the platform
  // does not permit symlink creation (Windows without dev mode).
  try {
    fs.symlinkSync(target, linkPath);
    return { emulated: false };
  } catch (err) {
    // On Windows creating symlinks often fails with EPERM. Fall back to
    // emulating the symlink by copying the target (file or directory) and
    // writing a small metadata file so callers can detect the emulation.
    try {
      const stat = fs.statSync(target);
      if (stat.isDirectory()) {
        // replicate directory contents
        fs.mkdirSync(linkPath, { recursive: true });
        if (fs.cpSync) {
          fs.cpSync(target, linkPath, { recursive: true });
        } else {
          // fallback: naive copy (file-only) — try to copy children
          const entries = fs.readdirSync(target, { withFileTypes: true });
          for (const entry of entries) {
            const src = path.join(target, entry.name);
            const dest = path.join(linkPath, entry.name);
            if (entry.isDirectory()) {
              fs.mkdirSync(dest, { recursive: true });
            }
            fs.copyFileSync(src, dest);
          }
        }
        const meta = { emulated: true, target: path.resolve(target), isDirectory: true };
        try { fs.writeFileSync(`${linkPath}.symlink.json`, JSON.stringify(meta), 'utf8'); } catch (werr) {}
        return { emulated: true };
      }

      // file target
      // Rather than copy arbitrary files (which breaks Node module resolution
      // when the copied file is executed from a temp bin directory), create a
      // small wrapper that spawns the original target. This preserves the
      // module resolution path while emulating a symlink-like entry point.
      const wrapper = `#!/usr/bin/env node\n` +
        `const cp = require('child_process');\n` +
        `const child = cp.spawn(process.execPath, [${JSON.stringify(path.resolve(target))}].concat(process.argv.slice(2)), { stdio: 'inherit' });\n` +
        `child.on('exit', code => process.exit(code));\n`;
      try {
        fs.writeFileSync(linkPath, wrapper, { encoding: 'utf8', mode: 0o755 });
      } catch (writeErr) {
        // Last-resort fallback to copy the file if writing the wrapper fails.
        fs.copyFileSync(target, linkPath);
      }
      const meta = { emulated: true, target: path.resolve(target), isDirectory: false };
      try { fs.writeFileSync(`${linkPath}.symlink.json`, JSON.stringify(meta), 'utf8'); } catch (werr) {}
      return { emulated: true };
    } catch (copyErr) {
      // rethrow the original symlink error if copy fails too
      throw err;
    }
  }
}

module.exports = {
  DEFAULT_RECALL_SCOPES,
  MAX_BODY_BYTES,
  MAX_DIAGNOSTICS,
  MAX_DOCUMENT_BYTES,
  MAX_FILES,
  MAX_QUERY_CHARS,
  MAX_RESULTS,
  MAX_SCAN_BYTES,
  MEMORY_KINDS,
  MEMORY_SCHEMA_VERSION,
  MEMORY_SCOPES,
  MEMORY_STATUSES,
  MEMORY_TRUST_STATES,
  defaultMemoryId,
  decodeUtf8,
  doctorMemoryVault,
  findPotentialSecrets,
  findNearestProjectRoot,
  initializeVault,
  normalizeMemory,
  parseMemoryDocument,
  readRegularTextFile,
  readMemoryById,
  readMemoryFiles,
  resolveVaultRoots,
  saveMemory,
  scoreMemory,
  searchMemories,
  serializeMemoryDocument,
  tokenize,
  createSymlinkOrEmulation,
};
