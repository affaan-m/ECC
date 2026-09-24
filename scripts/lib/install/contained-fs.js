const fs = require('fs');
const path = require('path');
const { assertWithinTrustedRoot } = require('../path-safety');
const { mergeHooksMetadata, metadataPathFor } = require('../hooks-config');
const { assertClaudeSettingsPath } = require('./claude-settings');

function getManagedDestination(
  destinationPath,
  trustedRoot,
  action,
  { allowFinalSymlink = false } = {}
) {
  if (!destinationPath || typeof destinationPath !== 'string') {
    throw new Error(`Refusing to ${action}: missing destination path.`);
  }

  const canonicalRoot = assertWithinTrustedRoot(trustedRoot, trustedRoot, action);
  const resolvedDestination = path.resolve(destinationPath);
  const canonicalParent = assertWithinTrustedRoot(
    path.dirname(resolvedDestination),
    canonicalRoot,
    action
  );
  const managedPath = path.join(canonicalParent, path.basename(resolvedDestination));
  let stat = null;

  try {
    stat = fs.lstatSync(managedPath);
  } catch (error) {
    if (!error || (error.code !== 'ENOENT' && error.code !== 'ENOTDIR')) {
      throw error;
    }
  }

  if (stat && stat.isSymbolicLink() && !allowFinalSymlink) {
    const error = new Error(
      `Refusing to ${action}: managed destination is a final symlink.`
    );
    error.code = 'ECC_FINAL_DESTINATION_SYMLINK';
    throw error;
  }

  return {
    canonicalRoot,
    exists: stat !== null,
    isFinalSymlink: Boolean(stat && stat.isSymbolicLink()),
    managedPath
  };
}

function ensureContainedParentDir(destinationPath, trustedRoot, action) {
  const initialDestination = getManagedDestination(
    destinationPath,
    trustedRoot,
    action
  );
  const { canonicalRoot, managedPath } = initialDestination;
  const canonicalParent = path.dirname(managedPath);
  const relativeParent = path.relative(canonicalRoot, canonicalParent);
  const pathSegments = relativeParent
    ? relativeParent.split(path.sep).filter(Boolean)
    : [];
  let currentPath = canonicalRoot;

  for (const segment of pathSegments) {
    const validatedParent = assertWithinTrustedRoot(currentPath, canonicalRoot, action);
    const nextPath = path.join(validatedParent, segment);
    try {
      fs.mkdirSync(nextPath);
    } catch (error) {
      if (!error || error.code !== 'EEXIST') {
        throw error;
      }
    }

    const validatedNext = assertWithinTrustedRoot(nextPath, canonicalRoot, action);
    const nextStat = fs.lstatSync(validatedNext);
    if (!nextStat.isDirectory() || nextStat.isSymbolicLink()) {
      throw new Error(`Refusing to ${action}: destination parent is not a trusted directory.`);
    }
    currentPath = validatedNext;
  }

  return getManagedDestination(managedPath, canonicalRoot, action).managedPath;
}

function prepareContainedWriteDestination(destinationPath, trustedRoot, action) {
  return ensureContainedParentDir(destinationPath, trustedRoot, action);
}

function getContainedExistingPath(
  destinationPath,
  trustedRoot,
  action,
  { allowFinalSymlink = false } = {}
) {
  const initialDestination = getManagedDestination(
    destinationPath,
    trustedRoot,
    action,
    { allowFinalSymlink }
  );
  const followsToExistingPath = fs.existsSync(initialDestination.managedPath);
  if (!followsToExistingPath && !initialDestination.isFinalSymlink) {
    return null;
  }

  const finalDestination = getManagedDestination(
    initialDestination.managedPath,
    trustedRoot,
    action,
    { allowFinalSymlink }
  );
  return finalDestination.exists ? finalDestination.managedPath : null;
}

function hasSameFileIdentity(leftStat, rightStat) {
  return leftStat.dev === rightStat.dev && leftStat.ino === rightStat.ino;
}

function createChangedDestinationError(action) {
  return new Error(
    `Refusing to ${action}: managed destination changed during the write.`
  );
}

function getStableParentStat(filePath, action) {
  const parentStat = fs.lstatSync(path.dirname(filePath));
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) {
    throw createChangedDestinationError(action);
  }
  return parentStat;
}

function assertPinnedWriteDestination(
  filePath,
  fileDescriptor,
  expectedParentStat,
  trustedRoot,
  action
) {
  const liveDestination = getManagedDestination(filePath, trustedRoot, action);
  if (path.resolve(liveDestination.managedPath) !== path.resolve(filePath)) {
    throw createChangedDestinationError(action);
  }

  const liveParentStat = getStableParentStat(filePath, action);
  if (!hasSameFileIdentity(expectedParentStat, liveParentStat)) {
    throw createChangedDestinationError(action);
  }

  const descriptorStat = fs.fstatSync(fileDescriptor);
  const livePathStat = fs.lstatSync(liveDestination.managedPath);
  if (
    !descriptorStat.isFile()
    || !livePathStat.isFile()
    || livePathStat.isSymbolicLink()
    || !hasSameFileIdentity(descriptorStat, livePathStat)
  ) {
    throw createChangedDestinationError(action);
  }
}

function writeFileNoFollow(filePath, content, mode, trustedRoot, action) {
  const expectedParentStat = getStableParentStat(filePath, action);
  const flags = fs.constants.O_WRONLY
    | fs.constants.O_CREAT
    | (fs.constants.O_NOFOLLOW || 0);
  const fileDescriptor = fs.openSync(filePath, flags, mode);

  try {
    assertPinnedWriteDestination(
      filePath,
      fileDescriptor,
      expectedParentStat,
      trustedRoot,
      action
    );
    fs.ftruncateSync(fileDescriptor, 0);
    fs.writeFileSync(fileDescriptor, content);
    if (mode !== undefined) {
      fs.fchmodSync(fileDescriptor, mode);
    }
  } finally {
    fs.closeSync(fileDescriptor);
  }
}

function readFileWithMetadataNoFollow(filePath, encoding) {
  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0);
  const fileDescriptor = fs.openSync(filePath, flags);

  try {
    const stat = fs.fstatSync(fileDescriptor);
    if (!stat.isFile()) {
      throw new Error(`Refusing to read non-file path: ${filePath}`);
    }
    return {
      content: fs.readFileSync(fileDescriptor, encoding),
      mode: stat.mode,
    };
  } finally {
    fs.closeSync(fileDescriptor);
  }
}

function readFileNoFollow(filePath, encoding) {
  return readFileWithMetadataNoFollow(filePath, encoding).content;
}

function readJsonNoFollow(filePath) {
  return JSON.parse(readFileNoFollow(filePath, 'utf8'));
}

function readHooksConfigNoFollow(hooksPath) {
  const hooksConfig = readJsonNoFollow(hooksPath);
  const metadataPath = metadataPathFor(hooksPath);
  if (!fs.existsSync(metadataPath)) {
    return hooksConfig;
  }
  return mergeHooksMetadata(hooksConfig, readJsonNoFollow(metadataPath), hooksPath);
}

function assertClaudeSettingsDestination(operation, trustedRoot, target = null) {
  if (target && target !== 'claude' && target !== 'claude-project') {
    throw new Error('Refusing to manage Claude hooks for a non-Claude target.');
  }
  assertClaudeSettingsPath(operation.destinationPath, trustedRoot);
}

function writeContainedFile(destinationPath, content, trustedRoot, action, mode) {
  const preparedDestination = prepareContainedWriteDestination(destinationPath, trustedRoot, action);
  const finalDestination = getManagedDestination(
    preparedDestination,
    trustedRoot,
    action
  ).managedPath;
  writeFileNoFollow(
    finalDestination,
    content,
    mode,
    trustedRoot,
    action
  );
  return finalDestination;
}

function copyContainedFile(sourcePath, destinationPath, trustedRoot, action) {
  const source = readFileWithMetadataNoFollow(sourcePath);
  return writeContainedFile(
    destinationPath,
    source.content,
    trustedRoot,
    action,
    source.mode & 0o777
  );
}

function removeContainedPath(destinationPath, trustedRoot, action, options = {}) {
  const existingDestination = getContainedExistingPath(
    destinationPath,
    trustedRoot,
    action,
    { allowFinalSymlink: true }
  );
  if (!existingDestination) {
    return null;
  }

  const managedDestination = getManagedDestination(
    existingDestination,
    trustedRoot,
    action,
    { allowFinalSymlink: true }
  );
  const finalDestination = managedDestination.managedPath;
  const expectedStat = fs.lstatSync(finalDestination, { bigint: true });
  const quarantineDir = fs.mkdtempSync(path.join(
    path.dirname(managedDestination.canonicalRoot),
    '.ecc-remove-'
  ));
  const quarantinePath = path.join(quarantineDir, path.basename(finalDestination));

  try {
    fs.renameSync(finalDestination, quarantinePath);
  } catch (error) {
    fs.rmdirSync(quarantineDir);
    throw error;
  }

  const quarantinedStat = fs.lstatSync(quarantinePath, { bigint: true });
  if (!hasSameFileIdentity(expectedStat, quarantinedStat)) {
    try {
      fs.renameSync(quarantinePath, finalDestination);
      fs.rmdirSync(quarantineDir);
    } catch (_restoreError) {
      throw new Error(
        `Refusing to ${action}: managed destination changed before removal; replacement preserved at ${quarantinePath}.`
      );
    }
    throw createChangedDestinationError(action);
  }

  if (quarantinedStat.isDirectory() && !options.recursive) {
    fs.rmdirSync(quarantinePath);
  } else {
    fs.rmSync(quarantinePath, options);
  }
  fs.rmdirSync(quarantineDir);
  return finalDestination;
}

function cleanupEmptyParentDirs(filePath, stopAt) {
  const trustedStopAt = assertWithinTrustedRoot(stopAt, stopAt, 'clean up');
  const trustedFilePath = assertWithinTrustedRoot(filePath, trustedStopAt, 'clean up');
  let currentPath = path.dirname(trustedFilePath);

  while (currentPath) {
    const relativePath = path.relative(trustedStopAt, currentPath);
    const isContained = relativePath !== '..'
      && !relativePath.startsWith(`..${path.sep}`)
      && !path.isAbsolute(relativePath);
    if (!isContained || relativePath === '') {
      break;
    }

    let validatedPath = assertWithinTrustedRoot(currentPath, trustedStopAt, 'clean up');
    if (!fs.existsSync(validatedPath)) {
      currentPath = path.dirname(validatedPath);
      continue;
    }

    validatedPath = assertWithinTrustedRoot(validatedPath, trustedStopAt, 'clean up');
    const stat = fs.lstatSync(validatedPath);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      break;
    }

    validatedPath = assertWithinTrustedRoot(validatedPath, trustedStopAt, 'clean up');
    if (fs.readdirSync(validatedPath).length > 0) {
      break;
    }

    const finalPath = assertWithinTrustedRoot(validatedPath, trustedStopAt, 'clean up');
    const removedPath = removeContainedPath(finalPath, trustedStopAt, 'clean up');
    if (!removedPath) break;
    currentPath = path.dirname(removedPath);
  }
}

module.exports = {
  assertClaudeSettingsDestination,
  assertPinnedWriteDestination,
  cleanupEmptyParentDirs,
  copyContainedFile,
  createChangedDestinationError,
  ensureContainedParentDir,
  getContainedExistingPath,
  getManagedDestination,
  getStableParentStat,
  hasSameFileIdentity,
  prepareContainedWriteDestination,
  readFileNoFollow,
  readFileWithMetadataNoFollow,
  readHooksConfigNoFollow,
  readJsonNoFollow,
  removeContainedPath,
  writeContainedFile,
  writeFileNoFollow,
};
