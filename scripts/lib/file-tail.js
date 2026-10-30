'use strict';

const fs = require('fs');

const DEFAULT_TRANSCRIPT_TAIL_BYTES = 256 * 1024;

/** Last `tailBytes` as UTF-8 text; optionally include the raw byte length. Null when unreadable. */
function readFileTail(filePath, tailBytes, options = {}) {
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
  } catch {
    return null;
  }

  try {
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - tailBytes);
    const length = size - start;
    if (length <= 0) {
      return { text: '', truncated: false, ...(options.includeByteLength ? { byteLength: 0 } : {}) };
    }

    const buffer = Buffer.alloc(length);
    const bytesRead = fs.readSync(fd, buffer, 0, length, start);
    return {
      text: buffer.toString('utf8', 0, bytesRead),
      truncated: start > 0,
      ...(options.includeByteLength ? { byteLength: bytesRead } : {})
    };
  } catch {
    return null;
  } finally {
    try {
      fs.closeSync(fd);
    } catch {
      /* ignore */
    }
  }
}

module.exports = { DEFAULT_TRANSCRIPT_TAIL_BYTES, readFileTail };
