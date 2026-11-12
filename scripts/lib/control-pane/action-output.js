'use strict';

const OUTPUT_LIMIT = 20000;

/** Drain an owned child pipe while retaining only the response's output prefix. */
function captureActionOutput(stream) {
  let prefix = '';
  let totalLength = 0;

  // Readable's decoder preserves UTF-8 split across chunks and flushes an
  // incomplete final sequence at EOF. Counts retain the existing UTF-16 units.
  stream.setEncoding('utf8');
  stream.on('data', text => {
    totalLength += text.length;
    if (prefix.length < OUTPUT_LIMIT) {
      prefix += text.slice(0, OUTPUT_LIMIT - prefix.length);
    }
    // Keep consuming after the limit so a full pipe cannot stall the child.
  });

  return () => totalLength > OUTPUT_LIMIT
    ? `${prefix}\n[truncated ${totalLength - OUTPUT_LIMIT} chars]`
    : prefix;
}

module.exports = { captureActionOutput };
