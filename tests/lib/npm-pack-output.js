function isPackEntry(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function getNpmPackEntry(output, packageName) {
  const matchesPackage = value => (
    isPackEntry(value) && value.name === packageName
  );

  if (Array.isArray(output)) {
    return output.find(matchesPackage);
  }

  if (!isPackEntry(output)) {
    return undefined;
  }

  if (matchesPackage(output[packageName])) {
    return output[packageName];
  }

  return Object.values(output).find(matchesPackage);
}

module.exports = { getNpmPackEntry };
