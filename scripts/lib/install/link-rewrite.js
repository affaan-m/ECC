'use strict';

const path = require('path');

const posix = path.posix;

// Matches inline markdown links and images: `](target)` / `](target "title")`.
// We deliberately scope to the inline form because that is what skill/rule docs
// use for cross-directory references. Reference-style and autolinks are left
// untouched (they are rare in these files and carry higher false-positive risk).
const INLINE_LINK_PATTERN = /(!?\]\()([^()\s]+)(\s+"[^"]*")?(\))/g;

function toPosix(relativePath) {
  return String(relativePath || '').replace(/\\/g, '/').replace(/^\.\//, '');
}

function stripTrailingSlash(value) {
  return value.length > 1 ? value.replace(/\/+$/, '') : value;
}

// Build file + directory lookup maps from the plan's own file placements.
// `fileMappings` is a list of { sourceRel, destRel } where both are paths
// relative to the repo root and the install root respectively. The directory
// map is derived by walking shared ancestors of each source/dest pair, which is
// exact for prefix-insertion namespacing (e.g. `skills/x` -> `skills/ecc/x`):
// the path suffix below the inserted segment is preserved, so ancestor `k`
// of the source maps to the dest with the matching number of trailing
// segments removed.
function buildInstallIndex(fileMappings) {
  const byFile = new Map();
  const byDir = new Map();

  for (const mapping of fileMappings || []) {
    const sourceRel = toPosix(mapping.sourceRel);
    const destRel = toPosix(mapping.destRel);
    if (!sourceRel || !destRel) {
      continue;
    }

    byFile.set(sourceRel, destRel);

    const sourceParts = sourceRel.split('/');
    const destParts = destRel.split('/');
    // Map every source ancestor directory to its installed counterpart by
    // removing the same count of trailing segments from the dest path.
    for (let depth = 1; depth < sourceParts.length; depth += 1) {
      const trailing = sourceParts.length - depth;
      const destDepth = destParts.length - trailing;
      if (destDepth < 1) {
        continue;
      }
      const sourceDir = sourceParts.slice(0, depth).join('/');
      const destDir = destParts.slice(0, destDepth).join('/');
      // Only record real prefix-insertion mappings (suffix preserved). If a
      // directory resolves to itself (no namespace change) we skip it so the
      // rewriter leaves those links alone.
      if (sourceDir !== destDir) {
        byDir.set(sourceDir, destDir);
      }
    }
  }

  return { byFile, byDir };
}

function isExternalOrAnchor(target) {
  return (
    target === ''
    || target.startsWith('#')
    || target.startsWith('/')
    || target.startsWith('mailto:')
    || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(target) // has a URL scheme (http:, https:, file:, ...)
  );
}

// Resolve `target` (a relative link from `sourceDir`) to its repo-relative
// path, then return the install-relative path it should point to, or null when
// the target is not installed by this plan (leave such links untouched).
function resolveInstalledTarget(target, sourceDir, index) {
  const hadTrailingSlash = target.endsWith('/');
  const resolved = stripTrailingSlash(toPosix(posix.normalize(posix.join(sourceDir, target))));

  // Escapes the repo root (starts with `..`) -> not something we placed.
  if (resolved === '' || resolved === '.' || resolved.startsWith('..')) {
    return null;
  }

  if (!hadTrailingSlash && index.byFile.has(resolved)) {
    return { installed: index.byFile.get(resolved), trailingSlash: false };
  }
  if (index.byDir.has(resolved)) {
    return { installed: index.byDir.get(resolved), trailingSlash: hadTrailingSlash };
  }
  return null;
}

// True when the plan installs `sourceRel` at a different relative path than the
// source (i.e. a namespace segment was injected, e.g. skills/x -> skills/ecc/x).
// Callers use this to keep non-namespaced files on the byte-for-byte copy path.
function isNamespacedSource(sourceRel, index) {
  const normalizedSource = toPosix(sourceRel);
  const installedSource = index && index.byFile.get(normalizedSource);
  return Boolean(installedSource) && installedSource !== normalizedSource;
}

// Rewrite relative links in a single namespaced markdown file so they resolve
// to the file's installed location. Returns the content unchanged when the
// file itself was not namespaced or when no link needs adjustment. Pure: no IO.
function rewriteRelativeLinks(content, options) {
  const { sourceRel, index } = options || {};
  const normalizedSource = toPosix(sourceRel);
  const installedSource = index && index.byFile.get(normalizedSource);

  // Only rewrite when the file's own install path gained/changed a namespace
  // segment. If it lands at the same relative path, every link recomputes to
  // itself, so there is nothing to do.
  if (!installedSource || installedSource === normalizedSource) {
    return content;
  }

  const installedSourceDir = posix.dirname(installedSource);
  const sourceDir = posix.dirname(normalizedSource);
  const lines = String(content).split('\n');
  let inFence = false;

  for (let i = 0; i < lines.length; i += 1) {
    const fenceToggle = /^\s*(```|~~~)/.test(lines[i]);
    if (fenceToggle) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      continue; // never rewrite inside fenced code blocks
    }

    lines[i] = lines[i].replace(
      INLINE_LINK_PATTERN,
      (match, open, target, title, close) => {
        // Preserve any `#fragment` so anchors survive the rewrite.
        const hashIdx = target.indexOf('#');
        const pathPart = hashIdx === -1 ? target : target.slice(0, hashIdx);
        const fragment = hashIdx === -1 ? '' : target.slice(hashIdx);

        if (isExternalOrAnchor(pathPart)) {
          return match;
        }

        const resolution = resolveInstalledTarget(pathPart, sourceDir, index);
        if (!resolution) {
          return match;
        }

        let rewritten = posix.relative(installedSourceDir, resolution.installed);
        if (rewritten === '') {
          rewritten = '.';
        }
        if (resolution.trailingSlash && !rewritten.endsWith('/')) {
          rewritten += '/';
        }
        // If the recomputed link points to the same place as the original
        // (e.g. an intra-namespace `./sibling.md` whose endpoints both shift by
        // the same prefix), keep the original text verbatim - including any
        // leading `./` - so the rewrite stays a strict no-op where it must.
        if (posix.normalize(rewritten) === posix.normalize(pathPart)) {
          return match;
        }
        return `${open}${rewritten}${fragment}${title || ''}${close}`;
      }
    );
  }

  return lines.join('\n');
}

module.exports = {
  buildInstallIndex,
  isNamespacedSource,
  rewriteRelativeLinks,
};
