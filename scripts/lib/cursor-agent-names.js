'use strict';

const path = require('path');

function toCursorAgentFileName(fileName) {
  if (!fileName || fileName.startsWith('ecc-')) {
    return fileName;
  }

  return `ecc-${fileName}`;
}

function toCursorAgentRelativePath(relativePath) {
  const segments = String(relativePath || '').split(/[\\/]+/).filter(Boolean);
  if (segments.length === 0) {
    return relativePath;
  }

  const fileName = segments.pop();
  return path.join(...segments, toCursorAgentFileName(fileName));
}

module.exports = {
  toCursorAgentFileName,
  toCursorAgentRelativePath,
};
