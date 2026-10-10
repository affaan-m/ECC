'use strict';

const NAME = /^[a-z0-9][a-z0-9-]*$/;
const USAGE = 'usage: snippet <add|get|list|remove|search|export|import>\n';
const ADD_USAGE = 'usage: add <name> [--tags t1,t2] <text...>\n';

const ok = (stdout = '') => ({ code: 0, stdout, stderr: '' });
const fail = (code, stderr) => ({ code, stdout: '', stderr });

function snippetsOf(state) {
  if (!state.snippets || typeof state.snippets !== 'object') state.snippets = {};
  return state.snippets;
}

function sortedNames(snippets, filter) {
  return Object.keys(snippets).filter(filter).sort();
}

function run(argv, state) {
  try {
    const snippets = snippetsOf(state);
    const [command, ...args] = argv;

    if (command === 'add') {
      let tags = [];
      let rest = args;
      const tagIndex = args.indexOf('--tags');
      const name = args[0];
      if (tagIndex !== -1) {
        if (tagIndex < 1 || !args[tagIndex + 1]) return fail(2, ADD_USAGE);
        tags = args[tagIndex + 1].split(',').filter(Boolean);
        rest = [args[0], ...args.slice(tagIndex + 2)];
      }
      const text = rest.slice(1).join(' ');
      if (!name || !text) return fail(2, ADD_USAGE);
      if (!NAME.test(name)) return fail(2, `error: invalid snippet name '${name}'\n`);
      if (snippets[name]) return fail(1, `error: snippet '${name}' already exists\n`);
      snippets[name] = { text, tags: [...tags].sort() };
      return ok(`created ${name}\n`);
    }

    if (command === 'get') {
      const snippet = snippets[args[0]];
      if (!snippet) return fail(2, `error: no snippet named '${args[0]}'\n`);
      return ok(`${snippet.text}\n`);
    }

    if (command === 'remove') {
      const snippet = snippets[args[0]];
      if (!snippet) return fail(2, `error: no snippet named '${args[0]}'\n`);
      delete snippets[args[0]];
      return ok(`removed ${args[0]}\n`);
    }

    if (command === 'list') {
      const tagIndex = args.indexOf('--tag');
      const tag = tagIndex !== -1 ? args[tagIndex + 1] : null;
      const names = sortedNames(snippets, name => tag === null || snippets[name].tags.includes(tag));
      return ok(names.length ? `${names.join('\n')}\n` : 'no snippets\n');
    }

    if (command === 'search') {
      const term = (args[0] || '').toLowerCase();
      const names = sortedNames(snippets, name =>
        name.toLowerCase().includes(term) || snippets[name].text.toLowerCase().includes(term));
      return ok(names.length ? `${names.join('\n')}\n` : 'no matches\n');
    }

    if (command === 'export') {
      const out = { snippets: {} };
      for (const name of sortedNames(snippets, () => true)) {
        out.snippets[name] = { text: snippets[name].text, tags: [...snippets[name].tags].sort() };
      }
      return ok(`${JSON.stringify(out)}\n`);
    }

    if (command === 'import') {
      let parsed;
      try { parsed = JSON.parse(args[0]); } catch { return fail(1, 'error: invalid JSON\n'); }
      const incoming = parsed && typeof parsed === 'object' ? parsed.snippets : null;
      if (!incoming || typeof incoming !== 'object') return fail(1, 'error: invalid JSON\n');
      let imported = 0;
      let skipped = 0;
      for (const [name, value] of Object.entries(incoming)) {
        if (snippets[name]) { skipped++; continue; }
        snippets[name] = { text: value.text, tags: [...(value.tags || [])].sort() };
        imported++;
      }
      return ok(`imported ${imported}, skipped ${skipped}\n`);
    }

    return fail(2, USAGE);
  } catch {
    return fail(2, USAGE);
  }
}

module.exports = { run };
