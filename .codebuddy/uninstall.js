#!/usr/bin/env node
/**
 * ECC CodeBuddy Uninstaller (Cross-platform Node.js version)
 * Uninstalls ECC workflows from a CodeBuddy project.
 *
 * Usage:
 *   node uninstall.js              # Uninstall from current directory
 *   node uninstall.js ~            # Uninstall globally from ~/.codebuddy/
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');

/**
 * Get home directory cross-platform
 */
function getHomeDir() {
  return process.env.USERPROFILE || process.env.HOME || os.homedir();
}

/**
 * Resolve a path to its canonical form
 */
function resolvePath(filePath) {
  try {
    return fs.realpathSync(filePath);
  } catch {
    // If realpath fails, return the path as-is
    return path.resolve(filePath);
  }
}

/**
 * Check if a manifest entry is valid (security check)
 */
function isValidManifestEntry(entry) {
  // Reject empty, absolute paths, parent directory references
  if (!entry || entry.length === 0) return false;
  if (entry.startsWith('/')) return false;
  if (entry.startsWith('~')) return false;
  if (entry.includes('/../') || entry.includes('/..')) return false;
  if (entry.startsWith('../') || entry.startsWith('..\\')) return false;
  if (entry === '..' || entry === '...' || entry.includes('\\..\\')||entry.includes('/..')) return false;

  return true;
}

/**
 * Read lines from manifest file
 */
function readManifest(manifestPath) {
  try {
    if (!fs.existsSync(manifestPath)) {
      return [];
    }
    const content = fs.readFileSync(manifestPath, 'utf8');
    return content.split('\n').filter(line => line.length > 0);
  } catch {
    return [];
  }
}

/**
 * Recursively find empty directories
 */
function findEmptyDirs(dirPath) {
  const emptyDirs = [];

  function walkDirs(currentPath) {
    try {
      const entries = fs.readdirSync(currentPath, { withFileTypes: true });
      const subdirs = entries.filter(e => e.isDirectory());

      for (const subdir of subdirs) {
        const subdirPath = path.join(currentPath, subdir.name);
        walkDirs(subdirPath);
      }

      // Check if directory is now empty
      try {
        const remaining = fs.readdirSync(currentPath);
        if (remaining.length === 0 && currentPath !== dirPath) {
          emptyDirs.push(currentPath);
        }
      } catch {
        // Directory might have been deleted
      }
    } catch {
      // Ignore errors
    }
  }

  walkDirs(dirPath);
  return emptyDirs.sort().reverse(); // Sort in reverse for removal
}

/**
 * Prompt user for confirmation
 */
async function promptConfirm(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question(question, (answer) => {
      rl.close();
      resolve(/^[yY]$/.test(answer));
    });
  });
}

/**
 * Main uninstall function
 */
async function doUninstall() {
  const codebuddyDirName = '.codebuddy';

  // Parse arguments
  let targetDir = process.cwd();
  if (process.argv.length > 2) {
    const arg = process.argv[2];
    if (arg === '~' || arg === getHomeDir()) {
      targetDir = getHomeDir();
    } else {
      targetDir = path.resolve(arg);
    }
  }

  // Determine codebuddy full path
  let codebuddyFullPath;
  const baseName = path.basename(targetDir);

  if (baseName === codebuddyDirName) {
    codebuddyFullPath = targetDir;
  } else {
    codebuddyFullPath = path.join(targetDir, codebuddyDirName);
  }

  console.log('ECC CodeBuddy Uninstaller');
  console.log('==========================');
  console.log('');
  console.log(`Target:  ${codebuddyFullPath}/`);
  console.log('');

  // Check if codebuddy directory exists
  if (!fs.existsSync(codebuddyFullPath)) {
    console.error(`Error: ${codebuddyDirName} directory not found at ${targetDir}`);
    process.exit(1);
  }

  const codebuddyRootResolved = resolvePath(codebuddyFullPath);
  const manifest = path.join(codebuddyFullPath, '.ecc-manifest');

  // Handle missing manifest
  if (!fs.existsSync(manifest)) {
    console.log('Warning: No manifest file found (.ecc-manifest)');
    console.log('');
    console.log('This could mean:');
    console.log('  1. ECC was installed with an older version without manifest support');
    console.log('  2. The manifest file was manually deleted');
    console.log('');

    const confirmed = await promptConfirm(`Do you want to remove the entire ${codebuddyDirName} directory? (y/N) `);
    if (!confirmed) {
      console.log('Uninstall cancelled.');
      process.exit(0);
    }

    try {
      fs.rmSync(codebuddyFullPath, { recursive: true, force: true });
      console.log('Uninstall complete!');
      console.log('');
      console.log(`Removed: ${codebuddyFullPath}/`);
    } catch (err) {
      console.error(`Error removing directory: ${err.message}`);
      process.exit(1);
    }
    return;
  }

  console.log('Found manifest file - will only remove files installed by ECC');
  console.log('');

  const confirmed = await promptConfirm(`Are you sure you want to uninstall ECC from ${codebuddyDirName}? (y/N) `);
  if (!confirmed) {
    console.log('Uninstall cancelled.');
    process.exit(0);
  }

  // Read manifest and remove files
  const manifestLines = readManifest(manifest);
  let removed = 0;
  let skipped = 0;

  for (const filePath of manifestLines) {
    if (!filePath || filePath.length === 0) continue;

    if (!isValidManifestEntry(filePath)) {
      console.log(`Skipped: ${filePath} (invalid manifest entry)`);
      skipped += 1;
      continue;
    }

    const fullPath = path.join(codebuddyFullPath, filePath);

    // Security check: use path.relative() to ensure the manifest entry
    // resolves inside the codebuddy directory. This is stricter than
    // startsWith and correctly handles edge-cases with symlinks.
    const relative = path.relative(codebuddyRootResolved, path.resolve(fullPath));
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      console.log(`Skipped: ${filePath} (outside target directory)`);
      skipped += 1;
      continue;
    }

    try {
      const stats = fs.lstatSync(fullPath);

      if (stats.isFile() || stats.isSymbolicLink()) {
        fs.unlinkSync(fullPath);
        console.log(`Removed: ${filePath}`);
        removed += 1;
      } else if (stats.isDirectory()) {
        try {
          const files = fs.readdirSync(fullPath);
          if (files.length === 0) {
            fs.rmdirSync(fullPath);
            console.log(`Removed: ${filePath}/`);
            removed += 1;
          } else {
            console.log(`Skipped: ${filePath}/ (not empty - contains user files)`);
            skipped += 1;
          }
        } catch {
          console.log(`Skipped: ${filePath}/ (not empty - contains user files)`);
          skipped += 1;
        }
      }
    } catch {
      skipped += 1;
    }
  }

  // Remove empty directories
  const emptyDirs = findEmptyDirs(codebuddyFullPath);
  for (const emptyDir of emptyDirs) {
    try {
      fs.rmdirSync(emptyDir);
      const relativePath = path.relative(codebuddyFullPath, emptyDir);
      console.log(`Removed: ${relativePath}/`);
      removed += 1;
    } catch {
      // Directory might not be empty anymore
    }
  }

  // Try to remove main codebuddy directory if empty
  try {
    const files = fs.readdirSync(codebuddyFullPath);
    if (files.length === 0) {
      fs.rmdirSync(codebuddyFullPath);
      console.log(`Removed: ${codebuddyDirName}/`);
      removed += 1;
    }
  } catch {
    // Directory not empty
  }

  // Print summary
  console.log('');
  console.log('Uninstall complete!');
  console.log('');
  console.log('Summary:');
  console.log(`  Removed: ${removed} items`);
  console.log(`  Skipped: ${skipped} items (not found or user-modified)`);
  console.log('');

  if (fs.existsSync(codebuddyFullPath)) {
    console.log(`Note: ${codebuddyDirName} directory still exists (contains user-added files)`);
  }
}

// Run uninstaller
doUninstall().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exit(1);
});
