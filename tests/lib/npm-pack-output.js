function isPackEntry(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function getNpmPackEntry(output, packageName) {
  if (Array.isArray(output)) {
    return output.find(isPackEntry);
  }

  if (!isPackEntry(output)) {
    return undefined;
  }

  if (isPackEntry(output[packageName])) {
    return output[packageName];
  }

  return Object.values(output).find(isPackEntry);
}

module.exports = { getNpmPackEntry };
