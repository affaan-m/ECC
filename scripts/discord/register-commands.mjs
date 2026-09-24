#!/usr/bin/env node
// Registers the ECC bot's guild slash commands (bulk overwrite, instant).
// Env: DISCORD_BOT_TOKEN, DISCORD_APP_ID, DISCORD_GUILD_ID
'use strict';

const { DISCORD_BOT_TOKEN: TOKEN, DISCORD_APP_ID: APP_ID, DISCORD_GUILD_ID: GUILD } = process.env;
if (!TOKEN || !APP_ID || !GUILD) {
  console.error('missing DISCORD_BOT_TOKEN / DISCORD_APP_ID / DISCORD_GUILD_ID');
  process.exit(1);
}

const COMMANDS = [
  { name: 'ecc', description: 'What ECC is + all the links' },
  { name: 'help', description: 'List ECC bot commands' },
  {
    name: 'skill',
    description: 'Look up an ECC skill by name',
    options: [{ type: 3, name: 'name', description: 'skill name or keyword', required: true }],
  },
  {
    name: 'docs',
    description: 'Search the ECC docs',
    options: [{ type: 3, name: 'query', description: 'search terms', required: true }],
  },
  { name: 'release', description: 'Latest ECC release' },
];

const res = await fetch(`https://discord.com/api/v10/applications/${APP_ID}/guilds/${GUILD}/commands`, {
  method: 'PUT',
  headers: { Authorization: `Bot ${TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(COMMANDS),
});
if (!res.ok) {
  console.error('registration failed:', res.status, (await res.text()).slice(0, 300));
  process.exit(1);
}
const registered = await res.json();
console.log('registered:', registered.map(c => `/${c.name}`).join(' '));
