'use strict';

/** @returns {{ body: string, endIndex: number }} */
function readBacktickSubstitution(source, startIndex) {
  let body = '';
  let endIndex = startIndex + 1;
  while (endIndex < source.length) {
    const inner = source[endIndex];
    if (inner === '\\') {
      const escaped = source[endIndex + 1];
      body = escaped === undefined ? `${body}\\` : `${body}\\${escaped}`;
      endIndex += escaped === undefined ? 1 : 2;
      continue;
    }
    if (inner === '`') break;
    body = `${body}${inner}`;
    endIndex += 1;
  }
  return { body, endIndex };
}

/** @returns {{ body: string, endIndex: number }} */
function readDollarSubstitution(source, startIndex) {
  let body = '';
  let depth = 1;
  let inSingle = false;
  let inDouble = false;
  let endIndex = startIndex + 2;
  while (endIndex < source.length && depth > 0) {
    const inner = source[endIndex];
    if (inner === '\\' && !inSingle) {
      const escaped = source[endIndex + 1];
      body = escaped === undefined ? `${body}\\` : `${body}\\${escaped}`;
      endIndex += escaped === undefined ? 1 : 2;
      continue;
    }
    if (inner === "'" && !inDouble) inSingle = !inSingle;
    else if (inner === '"' && !inSingle) inDouble = !inDouble;
    else if (!inSingle && !inDouble && inner === '(') depth += 1;
    else if (!inSingle && !inDouble && inner === ')') depth -= 1;
    if (depth > 0) body = `${body}${inner}`;
    endIndex += depth > 0 ? 1 : 0;
  }
  return { body, endIndex };
}

/**
 * Iterate over command-substitution bodies, followed by nested bodies.
 * Quote characters in an unquoted heredoc are literal only at the outer level;
 * substitutions still use normal shell quote semantics internally.
 *
 * @param {string} input
 * @param {{ literalOuterQuotes?: boolean }} [options]
 * @returns {Generator<string>}
 */
function* iterateCommandSubstitutions(input, options = {}) {
  const source = String(input || '');
  const literalOuterQuotes = options.literalOuterQuotes === true;
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '\\' && !inSingle) {
      i += 1;
      continue;
    }
    if (!literalOuterQuotes && ch === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (!literalOuterQuotes && ch === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
    if (inSingle) continue;
    const span = ch === '`' ? readBacktickSubstitution(source, i) : null;
    const substitution = ch === '$' && source[i + 1] === '(' ? readDollarSubstitution(source, i) : span;
    if (!substitution) continue;
    i = substitution.endIndex;
    if (!substitution.body.trim()) continue;
    yield substitution.body;
    yield* iterateCommandSubstitutions(substitution.body);
  }
}

/**
 * Extract executable command-substitution bodies from a shell line.
 *
 * @param {string} input
 * @param {{ literalOuterQuotes?: boolean }} [options]
 * @returns {string[]}
 */
function extractCommandSubstitutions(input, options = {}) {
  return [...iterateCommandSubstitutions(input, options)];
}

/**
 * Extract bodies of plain `(...)` subshell groups.
 *
 * Bash treats `(npm run dev)` as a subshell that executes its contents, but
 * the regex-light segment splitters used by our PreToolUse hooks don't peer
 * inside those parens. This helper finds top-level `(...)` groups (skipping
 * `$(...)` command substitutions and backticks, which `extractCommandSubstitutions`
 * already covers) and returns each body, recursing for nested groups.
 *
 * Quote semantics:
 * - Single quotes are literal: `'( ... )'` is a string, not a subshell.
 * - Double quotes are literal *for parens*: `"( ... )"` is a string too —
 *   bash only honors `$( )` inside double quotes, not bare `( )`.
 *
 * @param {string} input
 * @returns {string[]}
 */
function extractSubshellGroups(input) {
  const source = String(input || '');
  const groups = [];
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    const prev = source[i - 1];

    if (ch === '\\' && !inSingle) {
      i += 1;
      continue;
    }

    if (ch === "'" && !inDouble && prev !== '\\') {
      inSingle = !inSingle;
      continue;
    }

    if (ch === '"' && !inSingle && prev !== '\\') {
      inDouble = !inDouble;
      continue;
    }

    if (inSingle || inDouble) {
      continue;
    }

    if (ch === '$' && source[i + 1] === '(') {
      let depth = 1;
      let skipInSingle = false;
      let skipInDouble = false;
      i += 2;
      while (i < source.length && depth > 0) {
        const inner = source[i];
        const innerPrev = source[i - 1];
        if (inner === '\\' && !skipInSingle) {
          i += 2;
          continue;
        }
        if (inner === "'" && !skipInDouble && innerPrev !== '\\') {
          skipInSingle = !skipInSingle;
        } else if (inner === '"' && !skipInSingle && innerPrev !== '\\') {
          skipInDouble = !skipInDouble;
        } else if (!skipInSingle && !skipInDouble) {
          if (inner === '(') depth += 1;
          else if (inner === ')') depth -= 1;
        }
        i += 1;
      }
      i -= 1;
      continue;
    }

    if (ch === '`') {
      i += 1;
      while (i < source.length && source[i] !== '`') {
        if (source[i] === '\\' && i + 1 < source.length) {
          i += 2;
          continue;
        }
        i += 1;
      }
      continue;
    }

    if (ch === '(') {
      let depth = 1;
      let body = '';
      let bodyInSingle = false;
      let bodyInDouble = false;
      i += 1;
      while (i < source.length && depth > 0) {
        const inner = source[i];
        const innerPrev = source[i - 1];
        if (inner === '\\' && !bodyInSingle) {
          body += inner;
          if (i + 1 < source.length) {
            body += source[i + 1];
            i += 2;
          } else {
            // Trailing backslash at end of an unterminated span: advance past
            // it so it is not appended a second time by the fallthrough below.
            i += 1;
          }
          continue;
        }
        if (inner === "'" && !bodyInDouble && innerPrev !== '\\') {
          bodyInSingle = !bodyInSingle;
        } else if (inner === '"' && !bodyInSingle && innerPrev !== '\\') {
          bodyInDouble = !bodyInDouble;
        } else if (!bodyInSingle && !bodyInDouble) {
          if (inner === '(') {
            depth += 1;
          } else if (inner === ')') {
            depth -= 1;
            if (depth === 0) {
              break;
            }
          }
        }
        body += inner;
        i += 1;
      }
      if (body.trim()) {
        groups.push(body);
        groups.push(...extractSubshellGroups(body));
      }
    }
  }

  return groups;
}

/**
 * Extract bodies of `{ ...; }` brace groups.
 *
 * Bash brace groups run their body in the *current* shell (unlike `(...)`,
 * which forks a subshell). Both forms group multiple commands, so for the
 * purposes of destructive-bash and dev-server detection they are equivalent:
 * a `rm -rf` or `npm run dev` inside `{ ...; }` still executes.
 *
 * Recognition rules match bash's own reserved-word semantics:
 * - `{` is a reserved word only when followed by whitespace and preceded by
 *   the line start, whitespace, or a shell operator (`;`, `|`, `&`, `(`).
 *   So `{npm run dev}` is NOT a brace group (single token starting with `{`).
 * - `}` closes the group only when preceded by `;` or whitespace.
 *   So `foo}` inside the body is not a closing brace.
 * - Single quotes are literal; double quotes are also literal for `{`/`}`.
 * - `$(...)`, backticks, and plain `(...)` spans are skipped so we don't
 *   double-extract bodies the sibling extractors already cover.
 *
 * @param {string} input
 * @returns {string[]}
 */
function extractBraceGroups(input) {
  const source = String(input || '');
  const groups = [];
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    const prev = source[i - 1];

    if (ch === '\\' && !inSingle) {
      i += 1;
      continue;
    }

    if (ch === "'" && !inDouble && prev !== '\\') {
      inSingle = !inSingle;
      continue;
    }

    if (ch === '"' && !inSingle && prev !== '\\') {
      inDouble = !inDouble;
      continue;
    }

    if (inSingle || inDouble) {
      continue;
    }

    if (ch === '$' && source[i + 1] === '(') {
      let depth = 1;
      let skipInSingle = false;
      let skipInDouble = false;
      i += 2;
      while (i < source.length && depth > 0) {
        const inner = source[i];
        const innerPrev = source[i - 1];
        if (inner === '\\' && !skipInSingle) {
          i += 2;
          continue;
        }
        if (inner === "'" && !skipInDouble && innerPrev !== '\\') {
          skipInSingle = !skipInSingle;
        } else if (inner === '"' && !skipInSingle && innerPrev !== '\\') {
          skipInDouble = !skipInDouble;
        } else if (!skipInSingle && !skipInDouble) {
          if (inner === '(') depth += 1;
          else if (inner === ')') depth -= 1;
        }
        i += 1;
      }
      i -= 1;
      continue;
    }

    if (ch === '`') {
      i += 1;
      while (i < source.length && source[i] !== '`') {
        if (source[i] === '\\' && i + 1 < source.length) {
          i += 2;
          continue;
        }
        i += 1;
      }
      continue;
    }

    if (ch === '(') {
      let depth = 1;
      let skipInSingle = false;
      let skipInDouble = false;
      i += 1;
      while (i < source.length && depth > 0) {
        const inner = source[i];
        const innerPrev = source[i - 1];
        if (inner === '\\' && !skipInSingle) {
          i += 2;
          continue;
        }
        if (inner === "'" && !skipInDouble && innerPrev !== '\\') {
          skipInSingle = !skipInSingle;
        } else if (inner === '"' && !skipInSingle && innerPrev !== '\\') {
          skipInDouble = !skipInDouble;
        } else if (!skipInSingle && !skipInDouble) {
          if (inner === '(') depth += 1;
          else if (inner === ')') depth -= 1;
        }
        i += 1;
      }
      i -= 1;
      continue;
    }

    if (ch === '{' && /\s/.test(source[i + 1] || '')) {
      const prevIsBoundary = i === 0 || /[\s;|&(]/.test(prev);
      if (!prevIsBoundary) continue;

      let depth = 1;
      let body = '';
      let bodyInSingle = false;
      let bodyInDouble = false;
      i += 1;
      while (i < source.length && depth > 0) {
        const inner = source[i];
        const innerPrev = source[i - 1];
        if (inner === '\\' && !bodyInSingle) {
          body += inner;
          if (i + 1 < source.length) {
            body += source[i + 1];
            i += 2;
          } else {
            // Trailing backslash at end of an unterminated span: advance past
            // it so it is not appended a second time by the fallthrough below.
            i += 1;
          }
          continue;
        }
        if (inner === "'" && !bodyInDouble && innerPrev !== '\\') {
          bodyInSingle = !bodyInSingle;
          body += inner;
          i += 1;
          continue;
        }
        if (inner === '"' && !bodyInSingle && innerPrev !== '\\') {
          bodyInDouble = !bodyInDouble;
          body += inner;
          i += 1;
          continue;
        }
        if (bodyInSingle || bodyInDouble) {
          body += inner;
          i += 1;
          continue;
        }
        // Skip $(...) spans — a quoted `}` or `}`-as-text inside a
        // substitution body must not close the enclosing brace group.
        if (inner === '$' && source[i + 1] === '(') {
          body += inner + source[i + 1];
          let subDepth = 1;
          let subInSingle = false;
          let subInDouble = false;
          i += 2;
          while (i < source.length && subDepth > 0) {
            const c = source[i];
            const p = source[i - 1];
            body += c;
            if (c === '\\' && !subInSingle && i + 1 < source.length) {
              body += source[i + 1];
              i += 2;
              continue;
            }
            if (c === "'" && !subInDouble && p !== '\\') subInSingle = !subInSingle;
            else if (c === '"' && !subInSingle && p !== '\\') subInDouble = !subInDouble;
            else if (!subInSingle && !subInDouble) {
              if (c === '(') subDepth += 1;
              else if (c === ')') subDepth -= 1;
            }
            i += 1;
          }
          continue;
        }
        // Skip backtick spans for the same reason.
        if (inner === '`') {
          body += inner;
          i += 1;
          while (i < source.length && source[i] !== '`') {
            if (source[i] === '\\' && i + 1 < source.length) {
              body += source[i] + source[i + 1];
              i += 2;
              continue;
            }
            body += source[i];
            i += 1;
          }
          if (i < source.length) {
            body += source[i];
            i += 1;
          }
          continue;
        }
        // Skip plain (...) subshell spans for the same reason.
        if (inner === '(') {
          body += inner;
          let subDepth = 1;
          let subInSingle = false;
          let subInDouble = false;
          i += 1;
          while (i < source.length && subDepth > 0) {
            const c = source[i];
            const p = source[i - 1];
            body += c;
            if (c === '\\' && !subInSingle && i + 1 < source.length) {
              body += source[i + 1];
              i += 2;
              continue;
            }
            if (c === "'" && !subInDouble && p !== '\\') subInSingle = !subInSingle;
            else if (c === '"' && !subInSingle && p !== '\\') subInDouble = !subInDouble;
            else if (!subInSingle && !subInDouble) {
              if (c === '(') subDepth += 1;
              else if (c === ')') subDepth -= 1;
            }
            i += 1;
          }
          continue;
        }
        if (inner === '{' && /\s/.test(source[i + 1] || '')) {
          // Match the outer-scan boundary rule for nested `{` so
          // tokens like `foo{` (no boundary, but followed by space
          // via `foo{ bar`) cannot bump nested depth.
          const nestedPrevIsBoundary = /[\s;|&(]/.test(innerPrev);
          if (nestedPrevIsBoundary) depth += 1;
        } else if (inner === '}' && (innerPrev === ';' || /\s/.test(innerPrev))) {
          depth -= 1;
          if (depth === 0) {
            break;
          }
        }
        body += inner;
        i += 1;
      }
      if (body.trim()) {
        groups.push(body);
        groups.push(...extractBraceGroups(body));
      }
    }
  }

  return groups;
}

module.exports = { extractCommandSubstitutions, extractSubshellGroups, extractBraceGroups };
