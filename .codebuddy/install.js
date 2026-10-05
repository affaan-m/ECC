#!/usr/bin/env node
/**
 * ECC CodeBuddy Installer (Cross-platform Node.js version)
 * Installs ECC workflows into a CodeBuddy project.
 *
 * Usage:
 *   node install.js              # Install to current directory
 *   node install.js ~            # Install globally to ~/.codebuddy/
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// Platform detection
const isWindows = process.platform === 'win32';

/**
 * Get home directory cross-platform
 */
function getHomeDir() {
  return process.env.USERPROFILE || process.env.HOME || os.homedir();
}

/**
 * Ensure directory exists
 */
function ensureDir(dirPath) {
  try {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  } catch (err) {
    if (err.code !== 'EEXIST') {
      throw err;
    }
  }
}

/**
 * Read lines from a file
 */
function readLines(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return [];
    }
    const content = fs.readFileSync(filePath, 'utf8');
    return content.split('\n').filter(line => line.length > 0);
  } catch {
    return [];
  }
}

/**
 * Check if manifest contains an entry
 */
function manifestHasEntry(manifestPath, entry) {
  const lines = readLines(manifestPath);
  return lines.includes(entry);
}

/**
 * Add entry to manifest
 */
function ensureManifestEntry(manifestPath, entry) {
  try {
    const lines = readLines(manifestPath);
    if (!lines.includes(entry)) {
      const content = lines.join('\n') + (lines.length > 0 ? '\n' : '') + entry + '\n';
      fs.writeFileSync(manifestPath, content, 'utf8');
    }
  } catch (err) {
    console.error(`Error updating manifest: ${err.message}`);
  }
}

/**
 * Copy a file and manage in manifest
 */
function copyManagedFile(sourcePath, targetPath, manifestPath, manifestEntry, makeExecutable = false) {
  const alreadyManaged = manifestHasEntry(manifestPath, manifestEntry);

  // If target file already exists
  if (fs.existsSync(targetPath)) {
    if (alreadyManaged) {
      ensureManifestEntry(manifestPath, manifestEntry);
    }
    return false;
  }

  // Copy the file
  try {
    ensureDir(path.dirname(targetPath));
    fs.copyFileSync(sourcePath, targetPath);

    // Make executable on Unix systems
    if (makeExecutable && !isWindows) {
      fs.chmodSync(targetPath, 0o755);
    }

    ensureManifestEntry(manifestPath, manifestEntry);
    return true;
  } catch (err) {
    console.error(`Error copying ${sourcePath}: ${err.message}`);
    return false;
  }
}

/**
 * Recursively find files in a directory
 */
function findFiles(dir, extension = '') {
  const results = [];
  try {
    if (!fs.existsSync(dir)) {
      return results;
    }

    function walk(currentPath) {
      try {
        const entries = fs.readdirSync(currentPath, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(currentPath, entry.name);
          if (entry.isDirectory()) {
            walk(fullPath);
          } else if (!extension || entry.name.endsWith(extension)) {
            results.push(fullPath);
          }
        }
      } catch {
        // Ignore permission errors
      }
    }

    walk(dir);
  } catch {
    // Ignore errors
  }
  return results.sort();
}

/**
 * Main install function
 */
function doInstall() {
  // Resolve script directory (where this file lives)
  const scriptDir = path.dirname(path.resolve(__filename));
  const repoRoot = path.dirname(scriptDir);
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

  console.log('ECC CodeBuddy Installer');
  console.log('=======================');
  console.log('');
  console.log(`Source:  ${repoRoot}`);
  console.log(`Target:  ${codebuddyFullPath}/`);
  console.log('');

  // Create subdirectories
  const subdirs = ['commands', 'agents', 'skills', 'rules'];
  for (const dir of subdirs) {
    ensureDir(path.join(codebuddyFullPath, dir));
  }

  // Manifest file
  const manifest = path.join(codebuddyFullPath, '.ecc-manifest');
  ensureDir(path.dirname(manifest));

  // Counters
  let commands = 0;
  let agents = 0;
  let skills = 0;
  let rules = 0;

  // Copy commands
  const commandsDir = path.join(repoRoot, 'commands');
  if (fs.existsSync(commandsDir)) {
    const files = findFiles(commandsDir, '.md');
    for (const file of files) {
      if (path.basename(path.dirname(file)) === 'commands') {
        const localName = path.basename(file);
        const targetPath = path.join(codebuddyFullPath, 'commands', localName);
        if (copyManagedFile(file, targetPath, manifest, `commands/${localName}`)) {
          commands += 1;
        }
      }
    }
  }

  // Copy agents
  const agentsDir = path.join(repoRoot, 'agents');
  if (fs.existsSync(agentsDir)) {
    const files = findFiles(agentsDir, '.md');
    for (const file of files) {
      if (path.basename(path.dirname(file)) === 'agents') {
        const localName = path.basename(file);
        const targetPath = path.join(codebuddyFullPath, 'agents', localName);
        if (copyManagedFile(file, targetPath, manifest, `agents/${localName}`)) {
          agents += 1;
        }
      }
    }
  }

  // Copy skills (with subdirectories)
  const skillsDir = path.join(repoRoot, 'skills');
  if (fs.existsSync(skillsDir)) {
    const skillDirs = fs.readdirSync(skillsDir, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name);

    for (const skillName of skillDirs) {
      const sourceSkillDir = path.join(skillsDir, skillName);
      const targetSkillDir = path.join(codebuddyFullPath, 'skills', skillName);
      let skillCopied = false;

      const skillFiles = findFiles(sourceSkillDir);
      for (const sourceFile of skillFiles) {
        const relativePath = path.relative(sourceSkillDir, sourceFile);
        const targetPath = path.join(targetSkillDir, relativePath);
        const manifestEntry = `skills/${skillName}/${relativePath.replace(/\\/g, '/')}`;

        if (copyManagedFile(sourceFile, targetPath, manifest, manifestEntry)) {
          skillCopied = true;
        }
      }

      if (skillCopied) {
        skills += 1;
      }
    }
  }

  // Copy rules (with subdirectories)
  const rulesDir = path.join(repoRoot, 'rules');
  if (fs.existsSync(rulesDir)) {
    const ruleFiles = findFiles(rulesDir);
    for (const ruleFile of ruleFiles) {
      const relativePath = path.relative(rulesDir, ruleFile);
      const targetPath = path.join(codebuddyFullPath, 'rules', relativePath);
      const manifestEntry = `rules/${relativePath.replace(/\\/g, '/')}`;

      if (copyManagedFile(ruleFile, targetPath, manifest, manifestEntry)) {
        rules += 1;
      }
    }
  }

  // Copy README files (skip install/uninstall scripts to avoid broken
  // path references when the copied script runs from the target directory)
  const readmeFiles = ['README.md', 'README.zh-CN.md'];
  for (const readmeFile of readmeFiles) {
    const sourcePath = path.join(scriptDir, readmeFile);
    if (fs.existsSync(sourcePath)) {
      const targetPath = path.join(codebuddyFullPath, readmeFile);
      copyManagedFile(sourcePath, targetPath, manifest, readmeFile);
    }
  }

  // Add manifest itself
  ensureManifestEntry(manifest, '.ecc-manifest');

  // Print summary
  console.log('Installation complete!');
  console.log('');
  console.log('Components installed:');
  console.log(`  Commands:  ${commands}`);
  console.log(`  Agents:    ${agents}`);
  console.log(`  Skills:    ${skills}`);
  console.log(`  Rules:     ${rules}`);
  console.log('');
  console.log(`Directory:   ${path.basename(codebuddyFullPath)}`);
  console.log('');
  console.log('Next steps:');
  console.log('  1. Open your project in CodeBuddy');
  console.log('  2. Type / to see available commands');
  console.log('  3. Enjoy the ECC workflows!');
  console.log('');
  console.log('To uninstall later:');
  console.log(`  cd ${codebuddyFullPath}`);
  console.log('  node uninstall.js');
  console.log('');
}

// Run installer
try {
  doInstall();
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exit(1);
}
