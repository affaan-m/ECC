/**
 * The local marketplace projection: a `.claude-plugin/marketplace.json` that
 * lists the generated carriers under an output root so `claude plugin
 * marketplace add <outRoot>` can see them.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { DEFAULT_MARKETPLACE_NAME } = require('./constants');
const { readJson, listChildDirectories } = require('./fs-utils');

/**
 * Scan outRoot for generated plugin directories and (re)write the local
 * marketplace manifest. Staging and parked directories are dot-prefixed
 * and never listed.
 *
 * @param {object} [options] Options.
 * @param {string} options.outRoot Marketplace root to scan and write.
 * @param {string} [options.marketplaceName] Marketplace name (default: ecc-profiles).
 * @returns {{manifestPath: string, marketplace: object}} Written manifest.
 */
function writeMarketplaceManifest(options = {}) {
  const outRoot = options.outRoot;
  if (!outRoot) {
    throw new Error('writeMarketplaceManifest requires outRoot');
  }
  const marketplaceName = options.marketplaceName || DEFAULT_MARKETPLACE_NAME;

  const plugins = [];
  for (const dirName of listChildDirectories(outRoot)) {
    if (dirName.startsWith('.')) {
      continue;
    }
    const manifestPath = path.join(outRoot, dirName, '.claude-plugin', 'plugin.json');
    if (!fs.existsSync(manifestPath)) {
      continue;
    }
    const manifest = readJson(manifestPath, `${dirName}/.claude-plugin/plugin.json`);
    plugins.push({
      name: manifest.name,
      source: `./${dirName}`,
      description: manifest.description,
      version: manifest.version,
      ...(manifest.license ? { license: manifest.license } : {}),
      category: 'workflow',
    });
  }

  const marketplace = {
    name: marketplaceName,
    owner: { name: 'Generated locally by ecc plugin-profiles' },
    metadata: {
      description: 'Generated ECC profile plugins - slim per-project alternatives to the full ecc plugin',
    },
    plugins,
  };

  const manifestDir = path.join(outRoot, '.claude-plugin');
  fs.mkdirSync(manifestDir, { recursive: true });
  const manifestPath = path.join(manifestDir, 'marketplace.json');
  fs.writeFileSync(manifestPath, `${JSON.stringify(marketplace, null, 2)}\n`);

  return { manifestPath, marketplace };
}

module.exports = { writeMarketplaceManifest };
