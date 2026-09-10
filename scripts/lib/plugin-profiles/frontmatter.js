/**
 * Minimal YAML frontmatter reading for catalog listing entries.
 *
 * The generator only needs `name` and `description`, and must run with no
 * npm dependencies inside a generated carrier, so this parses the two
 * fields directly rather than pulling in a YAML library.
 */

'use strict';

/**
 * Collect the raw lines of a block scalar body, stopping at the next
 * top-level key.
 *
 * @param {Array<string>} lines Frontmatter lines.
 * @param {number} startIndex Index of the `description:` line.
 * @returns {Array<string>} Trimmed body lines, trailing blanks removed.
 */
function readBlockScalarBody(lines, startIndex) {
  const body = [];
  for (let i = startIndex + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === '') {
      body.push('');
      continue;
    }
    if (!/^\s/.test(line)) {
      break;
    }
    body.push(line.trim());
  }
  while (body.length > 0 && body[body.length - 1] === '') {
    body.pop();
  }
  return body;
}

/**
 * Join block-scalar body lines with folded (`>`) or literal (`|`) semantics.
 *
 * @param {Array<string>} body Body lines.
 * @param {boolean} isFolded Whether the indicator was `>`.
 * @returns {string} Joined text.
 */
function joinBlockScalar(body, isFolded) {
  let description = '';
  for (const line of body) {
    if (line === '') {
      description += '\n';
    } else if (description === '' || description.endsWith('\n')) {
      description += line;
    } else {
      description += isFolded ? ` ${line}` : `\n${line}`;
    }
  }
  return description.trim();
}

/**
 * Read frontmatter and its `description:` without a YAML dependency.
 *
 * Handles inline scalars, quoted scalars, and block scalars (`>`, `>-`, `|`,
 * `|-`, and the `+` keep variants). 16 catalog skills use `>-`; reading
 * only the first line yields the literal indicator instead of the text.
 *
 * @param {string} source Full file contents.
 * @returns {{raw: string, name: string, description: string}} Parsed fields.
 */
function parseFrontmatter(source) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source);
  if (!match) {
    return { raw: '', name: '', description: '' };
  }

  const lines = match[1].split(/\r?\n/);
  const nameLine = lines.find(line => /^name:/.test(line));
  const name = nameLine ? nameLine.slice('name:'.length).trim().replace(/^["']|["']$/g, '') : '';

  const startIndex = lines.findIndex(line => /^description:/.test(line));
  if (startIndex === -1) {
    return { raw: match[0], name, description: '' };
  }

  const inline = lines[startIndex].slice('description:'.length).trim();
  const blockScalar = /^([>|])([-+]?)$/.exec(inline);
  if (!blockScalar) {
    return { raw: match[0], name, description: inline.replace(/^["']|["']$/g, '') };
  }

  const body = readBlockScalarBody(lines, startIndex);
  return { raw: match[0], name, description: joinBlockScalar(body, blockScalar[1] === '>') };
}

module.exports = { parseFrontmatter };
