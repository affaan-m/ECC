#!/usr/bin/env node
// ECC community Discord bot — dependency-free (Node 22+ native WebSocket).
// Slash commands: /ecc /help /skill /docs /release
//
// Env: DISCORD_BOT_TOKEN (required), DISCORD_APP_ID (required),
//      ECC_REPO (path to local clone, default ~/GitHub/ECC/everything-claude-code),
//      DISCORD_INVITE (optional, shown in /ecc)
//
// Crash-only design: any gateway close, error, or missed heartbeat ack exits
// the process; the launchd/pm2 supervisor restarts it with a fresh identify.
// Register commands first: node scripts/discord/register-commands.mjs
'use strict';

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const APP_ID = process.env.DISCORD_APP_ID;
if (!TOKEN || !APP_ID) {
  console.error('missing DISCORD_BOT_TOKEN / DISCORD_APP_ID');
  process.exit(1);
}
const REPO = process.env.ECC_REPO || join(homedir(), 'GitHub/ECC/everything-claude-code');
const REPO_URL = 'https://github.com/affaan-m/ECC';
const INVITE = process.env.DISCORD_INVITE || '';
const API = 'https://discord.com/api/v10';

// Strip CR/LF from string args so Discord-payload-controlled values (command
// names, usernames) cannot forge or inject extra log lines (log injection).
const log = (...a) =>
  console.log(new Date().toISOString(), ...a.map(x => (typeof x === 'string' ? x.replace(/[\r\n]+/g, ' ') : x)));

// Interaction ids are Discord snowflakes (numeric) and tokens are a bounded
// URL-safe set. Validate before building the callback URL so a malformed or
// hostile gateway payload cannot inject path segments / alter the request
// target (SSRF). The host is always the fixed API constant.
const SNOWFLAKE_RE = /^[0-9]{1,20}$/;
const INTERACTION_TOKEN_RE = /^[A-Za-z0-9._-]{1,255}$/;

function interactionCallbackUrl(interaction) {
  const id = String(interaction?.id ?? '');
  const token = String(interaction?.token ?? '');
  if (!SNOWFLAKE_RE.test(id) || !INTERACTION_TOKEN_RE.test(token)) {
    throw new Error('invalid interaction id/token');
  }
  return `${API}/interactions/${id}/${token}/callback`;
}

// Clamp a remote-supplied timer interval to a sane range so a hostile/bogus
// heartbeat_interval cannot spin a tight loop or hang the bot (resource
// exhaustion). Discord's real value is ~41250ms.
function clampHeartbeatInterval(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 41250;
  return Math.max(1000, Math.min(n, 600000));
}

// ---------- skill + docs lookup (local clone as the data source) ----------

function parseFrontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const out = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^(\w[\w-]*):\s*(.+)$/);
    if (kv) out[kv[1]] = kv[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

function loadSkills() {
  const dir = join(REPO, 'skills');
  if (!existsSync(dir)) return [];
  const skills = [];
  for (const name of readdirSync(dir)) {
    const md = join(dir, name, 'SKILL.md');
    if (!existsSync(md)) continue;
    try {
      const fm = parseFrontmatter(readFileSync(md, 'utf8'));
      skills.push({ name, description: fm.description || '(no description)' });
    } catch { /* unreadable skill dirs are skipped, not fatal */ }
  }
  return skills;
}

function findSkill(query) {
  const q = query.toLowerCase().trim().replace(/\s+/g, '-');
  const skills = loadSkills();
  const exact = skills.find(s => s.name === q);
  const ranked = exact
    ? [exact, ...skills.filter(s => s !== exact && s.name.includes(q))]
    : skills.filter(s => s.name.includes(q) || s.description.toLowerCase().includes(query.toLowerCase()));
  return ranked.slice(0, 5);
}

function searchDocs(query) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const hits = [];
  const roots = ['docs', 'README.md'];
  const walk = rel => {
    const abs = join(REPO, rel);
    if (!existsSync(abs)) return;
    if (statSync(abs).isDirectory()) {
      for (const f of readdirSync(abs)) walk(join(rel, f));
      return;
    }
    if (!rel.endsWith('.md')) return;
    const nameScore = terms.filter(t => rel.toLowerCase().includes(t)).length;
    let score = nameScore * 3;
    if (nameScore < terms.length) {
      try {
        const head = readFileSync(abs, 'utf8').slice(0, 4000).toLowerCase();
        score += terms.filter(t => head.includes(t)).length;
      } catch { /* skip unreadable */ }
    }
    if (score > 0) hits.push({ rel, score });
  };
  for (const r of roots) walk(r);
  return hits.sort((a, b) => b.score - a.score).slice(0, 5);
}

// ---------- command handlers ----------

const HELP = [
  '**ECC bot commands**',
  '- `/ecc` — what ECC is + all the links',
  '- `/skill name:<query>` — look up an ECC skill',
  '- `/docs query:<terms>` — search the ECC docs',
  '- `/release` — latest ECC release',
  '- `/help` — this message',
].join('\n');

const handlers = {
  ecc: () => [
    '**Everything Claude Code (ECC)** — the agent harness performance system.',
    'Skills, agents, rules, hooks, MCP conventions, and operator workflows that move across Claude Code, Codex, OpenCode, Cursor, Gemini, and Zed.',
    '',
    `- repo: ${REPO_URL}`,
    '- site: https://ecc.tools',
    `- install: \`/plugin marketplace add affaan-m/everything-claude-code\` then \`/plugin install ecc\``,
    INVITE ? `- invite a friend: ${INVITE}` : '',
  ].filter(Boolean).join('\n'),

  help: () => HELP,

  skill: (options) => {
    const query = options.find(o => o.name === 'name')?.value || '';
    const found = findSkill(query);
    if (!found.length) return `no skill matching \`${query}\` — browse all: ${REPO_URL}/tree/main/skills`;
    const [top, ...rest] = found;
    return [
      `**${top.name}** — ${top.description}`,
      `${REPO_URL}/tree/main/skills/${top.name}`,
      rest.length ? `\nalso close: ${rest.map(s => `\`${s.name}\``).join(', ')}` : '',
    ].filter(Boolean).join('\n');
  },

  docs: (options) => {
    const query = options.find(o => o.name === 'query')?.value || '';
    const hits = searchDocs(query);
    if (!hits.length) return `nothing found for \`${query}\` — try ${REPO_URL}/tree/main/docs`;
    return [`**docs matching \`${query}\`:**`, ...hits.map(h => `- ${REPO_URL}/blob/main/${h.rel.replace(/\\/g, '/')}`)].join('\n');
  },

  release: async () => {
    const res = await fetch('https://api.github.com/repos/affaan-m/ECC/releases/latest', {
      headers: { 'User-Agent': 'ecc-discord-bot' },
    });
    if (!res.ok) return `couldn't reach GitHub (${res.status}) — ${REPO_URL}/releases`;
    const r = await res.json();
    return `**${r.name || r.tag_name}**\n${r.html_url}`;
  },
};

async function respond(interaction) {
  const name = interaction.data?.name;
  const handler = handlers[name];
  let url;
  try {
    url = interactionCallbackUrl(interaction);
  } catch (err) {
    log('rejected interaction', err.message);
    return;
  }
  if (!handler) {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 4, data: { content: `unknown command \`${name}\`` } }),
    });
    return;
  }
  try {
    const content = await handler(interaction.data?.options || []);
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 4, data: { content: String(content).slice(0, 1990) } }),
    });
    log('handled', `/${name}`);
  } catch (err) {
    log('handler error', name, err.message);
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 4, data: { content: 'something broke handling that — try again in a minute' } }),
    }).catch(() => {});
  }
}

// ---------- gateway (crash-only: exit on any failure, supervisor restarts) ----------

let seq = null;
let acked = true;

async function main() {
  const gw = await fetch(`${API}/gateway/bot`, { headers: { Authorization: `Bot ${TOKEN}` } }).then(r => r.json());
  if (!gw.url) { console.error('gateway discovery failed:', JSON.stringify(gw).slice(0, 200)); process.exit(1); }
  const ws = new WebSocket(`${gw.url}?v=10&encoding=json`);
  const send = payload => ws.send(JSON.stringify(payload));
  const die = reason => { log('exiting:', reason); process.exit(1); };

  ws.onmessage = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.s) seq = msg.s;
    switch (msg.op) {
      case 10: { // HELLO
        const interval = clampHeartbeatInterval(msg.d.heartbeat_interval);
        setTimeout(() => {
          send({ op: 1, d: seq });
          setInterval(() => {
            if (!acked) die('missed heartbeat ack');
            acked = false;
            send({ op: 1, d: seq });
          }, interval);
        }, interval * Math.random());
        send({ op: 2, d: { token: TOKEN, intents: 1, properties: { os: 'darwin', browser: 'ecc-bot', device: 'ecc-bot' } } });
        break;
      }
      case 11: acked = true; break; // HEARTBEAT_ACK
      case 1: send({ op: 1, d: seq }); break; // server-requested heartbeat
      case 7: die('server requested reconnect'); break;
      case 9: die('invalid session'); break;
      case 0:
        if (msg.t === 'READY') log(`READY as ${msg.d.user.username}#${msg.d.user.discriminator}`);
        if (msg.t === 'INTERACTION_CREATE' && msg.d.type === 2) respond(msg.d);
        break;
      default: break;
    }
  };
  ws.onclose = ev => die(`gateway closed (${ev.code})`);
  ws.onerror = () => die('gateway error');
}

main().catch(err => { console.error('fatal:', err.message); process.exit(1); });
