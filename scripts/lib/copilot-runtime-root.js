'use strict';

// Only the operator environment selects executable ECC code. Project-local
// install state and recalled memories are never executable-root authorities.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function resolveCheckout(env = process.env) {
  const selected = env.ECC_COPILOT_CHECKOUT_ROOT;
  const pin = env.ECC_COPILOT_CHECKOUT_COMMIT;
  if (typeof selected !== 'string' || !path.isAbsolute(selected) || selected.includes('\0')
    || typeof pin !== 'string' || !/^[a-f0-9]{40}$/.test(pin)) {
    throw new Error('Set an absolute ECC_COPILOT_CHECKOUT_ROOT and full lowercase ECC_COPILOT_CHECKOUT_COMMIT for a reviewed ECC checkout.');
  }
  const root = fs.realpathSync(selected);
  const marker = path.join(root, 'package.json');
  const stat = fs.lstatSync(marker);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 256 * 1024
    || JSON.parse(fs.readFileSync(marker, 'utf8')).name !== 'ecc-universal') throw new Error('Selected runtime is not an ECC checkout.');
  const cleanEnv = Object.fromEntries(Object.entries(env).filter(([key]) => !key.startsWith('GIT_')));
  const readGit = args => {
    const result = spawnSync('git', ['-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', '-C', root, ...args], {
      encoding: 'utf8', env: cleanEnv, shell: false, timeout: 5000, maxBuffer: 1024 * 1024, windowsHide: true,
    });
    if (result.error || result.status !== 0) throw new Error('Cannot verify the selected ECC checkout.');
    return result.stdout.trim();
  };
  if (fs.realpathSync(readGit(['rev-parse', '--show-toplevel'])) !== root
    || readGit(['rev-parse', '--verify', 'HEAD']) !== pin
    || readGit(['status', '--porcelain=v1', '--untracked-files=no'])) throw new Error('ECC checkout must match its reviewed commit and have a clean tracked working tree.');
  return root;
}

module.exports = { resolveCheckout };
