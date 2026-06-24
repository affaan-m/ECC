#!/usr/bin/env node
// Posts a published GitHub release to the Discord #announcements channel,
// pins it, and cross-posts to GitHub Discussions (Announcements category).
// Dependency-free (Node 18+ fetch). Runs from the release-announce workflow.
'use strict';

const {
  DISCORD_BOT_TOKEN,
  DISCORD_ANNOUNCE_CHANNEL_ID,
  RELEASE_NAME,
  RELEASE_TAG,
  RELEASE_URL,
  RELEASE_BODY,
  GITHUB_TOKEN,
  GITHUB_REPOSITORY,
} = process.env;

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function discord(method, path, body) {
  const res = await fetch(`https://discord.com/api/v10${path}`, {
    method,
    headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 429) {
    const j = await res.json().catch(() => ({ retry_after: 1 }));
    await sleep((j.retry_after || 1) * 1000 + 250);
    return discord(method, path, body);
  }
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.status === 204 ? null : res.json();
}

function buildMessage() {
  const title = (RELEASE_NAME && RELEASE_NAME.trim()) || RELEASE_TAG || 'New release';
  const body = (RELEASE_BODY || '').trim();
  // Discord message cap is 2000 chars; leave room for header + link.
  const maxBody = 1600;
  const trimmed = body.length > maxBody ? `${body.slice(0, maxBody)}\n...` : body;
  const parts = [`# ${title} is out`, ''];
  if (trimmed) parts.push(trimmed, '');
  if (RELEASE_URL) parts.push(`full release notes: ${RELEASE_URL}`);
  return parts.join('\n');
}

async function postAndPinToDiscord() {
  if (!DISCORD_BOT_TOKEN || !DISCORD_ANNOUNCE_CHANNEL_ID) {
    console.log('skip discord: missing DISCORD_BOT_TOKEN / DISCORD_ANNOUNCE_CHANNEL_ID');
    return;
  }
  const msg = await discord('POST', `/channels/${DISCORD_ANNOUNCE_CHANNEL_ID}/messages`, { content: buildMessage() });
  console.log('posted release to #announcements:', msg.id);
  try {
    await discord('PUT', `/channels/${DISCORD_ANNOUNCE_CHANNEL_ID}/pins/${msg.id}`);
    console.log('pinned announcement');
  } catch (e) {
    console.log('pin skipped:', e.message);
  }
}

async function graphql(query, variables) {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const j = await res.json();
  if (j.errors) throw new Error(JSON.stringify(j.errors).slice(0, 300));
  return j.data;
}

async function crossPostToDiscussions() {
  if (!GITHUB_TOKEN || !GITHUB_REPOSITORY) {
    console.log('skip discussions: missing GITHUB_TOKEN / GITHUB_REPOSITORY');
    return;
  }
  const [owner, name] = GITHUB_REPOSITORY.split('/');
  try {
    const data = await graphql(
      `query($owner:String!,$name:String!){repository(owner:$owner,name:$name){id discussionCategories(first:25){nodes{id name}}}}`,
      { owner, name }
    );
    const repo = data.repository;
    const cat = repo.discussionCategories.nodes.find(c => /announcement/i.test(c.name))
      || repo.discussionCategories.nodes[0];
    if (!cat) { console.log('skip discussions: no category found'); return; }
    const title = `${(RELEASE_NAME && RELEASE_NAME.trim()) || RELEASE_TAG} release`;
    const bodyParts = [(RELEASE_BODY || '').trim(), '', RELEASE_URL ? `Release: ${RELEASE_URL}` : ''].filter(Boolean);
    const created = await graphql(
      `mutation($repo:ID!,$cat:ID!,$title:String!,$body:String!){createDiscussion(input:{repositoryId:$repo,categoryId:$cat,title:$title,body:$body}){discussion{url}}}`,
      { repo: repo.id, cat: cat.id, title, body: bodyParts.join('\n') || title }
    );
    console.log('created discussion:', created.createDiscussion.discussion.url);
  } catch (e) {
    console.log('discussions cross-post skipped:', e.message);
  }
}

async function main() {
  await postAndPinToDiscord();
  await crossPostToDiscussions();
  console.log('release-announce done');
}

main().catch(e => { console.error('release-announce FAILED:', e.message); process.exit(1); });
