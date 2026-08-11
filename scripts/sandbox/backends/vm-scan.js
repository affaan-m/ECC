'use strict';

const MAX_SCAN_ITEMS = 1_000;

const SCAN_COMMANDS = {
  linux: "LC_ALL=C /usr/bin/find /etc /home /opt /usr/local -xdev \\( -type f -o -type l \\) -printf '%p\\t%s\\t%T@\\t%m\\n' 2>/dev/null | LC_ALL=C /usr/bin/sort",
  // DECISION: Skip volatile per-user Library trees that macOS populates on
  // first boot, but scan LaunchAgents separately so service installs remain
  // visible. The rest of each home still captures tool installs and dotfiles.
  macos: "{ LC_ALL=C /usr/bin/find -x /Applications /Library /opt /usr/local \\( -type f -o -type l \\) -exec /usr/bin/stat -f '%N%t%z%t%m%t%p' {} +; for home in /Users/*; do [ -d \"$home\" ] || continue; LC_ALL=C /usr/bin/find -x \"$home\" -path \"$home/Library\" -prune -o \\( -type f -o -type l \\) -exec /usr/bin/stat -f '%N%t%z%t%m%t%p' {} +; if [ -d \"$home/Library/LaunchAgents\" ]; then LC_ALL=C /usr/bin/find -x \"$home/Library/LaunchAgents\" \\( -type f -o -type l \\) -exec /usr/bin/stat -f '%N%t%z%t%m%t%p' {} +; fi; done; } 2>/dev/null | LC_ALL=C /usr/bin/sort",
};

function uniqueSorted(values) {
  return [...new Set(values)].sort();
}

function bounded(values) {
  const sorted = uniqueSorted(values);
  return { values: sorted.slice(0, MAX_SCAN_ITEMS), truncated: sorted.length > MAX_SCAN_ITEMS };
}

function parseScan(output) {
  const entries = new Map();
  let malformed = false;
  for (const line of String(output || '').split(/\r?\n/)) {
    if (!line) continue;
    const fields = line.split('\t');
    const filePath = fields.shift();
    if (!filePath?.startsWith('/') || fields.length !== 3 || filePath.length > 4_096) {
      malformed = true;
      continue;
    }
    entries.set(filePath, fields.join('\t'));
  }
  return { entries, malformed };
}

function scanInstallDiff(beforeOutput, afterOutput, guestOs) {
  const before = parseScan(beforeOutput);
  const after = parseScan(afterOutput);
  const addedPaths = [];
  const changedPaths = [];
  const deletedPaths = [];
  for (const [filePath, signature] of after.entries) {
    if (!before.entries.has(filePath)) addedPaths.push(filePath);
    else if (before.entries.get(filePath) !== signature) changedPaths.push(filePath);
  }
  for (const filePath of before.entries.keys()) {
    if (!after.entries.has(filePath)) deletedPaths.push(filePath);
  }

  const touched = uniqueSorted([...addedPaths, ...changedPaths, ...deletedPaths]);
  const present = uniqueSorted([...addedPaths, ...changedPaths]);
  const added = bounded(addedPaths);
  const changed = bounded(changedPaths);
  const deleted = bounded(deletedPaths);
  const pathChanges = bounded(touched.filter(filePath => (
    /^\/(?:usr\/)?local\/bin\//.test(filePath)
    || /^\/opt\/homebrew\/bin\//.test(filePath)
    || /^\/(?:home|Users)\/[^/]+\/\.local\/bin\//.test(filePath)
  )));
  const services = bounded(present.filter(filePath => (
    guestOs === 'macos'
      ? /\/(?:Library\/LaunchDaemons|Library\/LaunchAgents)\//.test(filePath)
      : /\/(?:systemd\/system|init\.d|rc\.d)\//.test(filePath)
  )));
  const dotfiles = bounded(touched.flatMap(filePath => {
    const match = filePath.match(/^(\/(?:home|Users)\/[^/]+\/\.[^/]+)(?:\/|$)/);
    return match ? [match[1]] : [];
  }));
  const truncated = [added, changed, deleted, pathChanges, services, dotfiles]
    .some(entry => entry.truncated);

  return {
    diff: {
      method: 'scan',
      // A bounded path scan is deliberately best-effort rather than a complete
      // block-device or package-database diff.
      complete: false,
      files_added: added.values,
      files_changed: changed.values,
      files_deleted: deleted.values,
      path_changes: pathChanges.values,
      services_registered: services.values,
      dotfiles_touched: dotfiles.values,
    },
    malformed: before.malformed || after.malformed,
    truncated,
  };
}

module.exports = {
  MAX_SCAN_ITEMS,
  SCAN_COMMANDS,
  parseScan,
  scanInstallDiff,
};
