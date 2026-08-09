#!/usr/bin/env node
'use strict';

import {
  announcementKey,
  buildDiscordPayload,
  discussionReceiptMarker,
  discussionReceiptStatus,
  findDiscussionReceipt,
  findDiscordReceipt,
  findReleaseDiscussion,
  normalizeDiscordWebhookUrl,
  releaseMarker,
} from './announcement-core.mjs';

const env = process.env;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function request(url, options = {}, attempts = 3) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const response = await fetch(url, options);
    if (response.status !== 429 || attempt === attempts) return response;
    const data = await response.json().catch(() => ({}));
    await sleep(Math.min(Number(data.retry_after || 1) * 1000 + 250, 10_000));
  }
  throw new Error('request retry budget exhausted');
}

async function githubGraphql(query, variables) {
  const response = await request('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  if (!response.ok) throw new Error(`GitHub GraphQL request failed (${response.status})`);
  const payload = await response.json();
  if (payload.errors) throw new Error('GitHub GraphQL returned errors');
  return payload.data;
}

async function releaseFromGitHub() {
  const [owner, repo] = env.GITHUB_REPOSITORY.split('/');
  const tag = env.RELEASE_TAG || env.GITHUB_REF_NAME;
  const response = await request(`https://api.github.com/repos/${owner}/${repo}/releases/tags/${encodeURIComponent(tag)}`, {
    headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' },
  });
  if (!response.ok) throw new Error(`release lookup failed (${response.status})`);
  return response.json();
}

async function createOrFindReleaseDiscussion() {
  const release = await releaseFromGitHub();
  const [owner, name] = env.GITHUB_REPOSITORY.split('/');
  const marker = releaseMarker(release.tag_name);
  const data = await githubGraphql(
    `query($owner:String!,$name:String!){repository(owner:$owner,name:$name){id discussionCategories(first:25){nodes{id name}}}}`,
    { owner, name },
  );
  const repository = data.repository;
  let cursor = null;
  let existing = null;
  for (let page = 0; page < 50 && !existing; page += 1) {
    const pageData = await githubGraphql(
      `query($owner:String!,$name:String!,$after:String){repository(owner:$owner,name:$name){discussions(first:100,after:$after,orderBy:{field:CREATED_AT,direction:DESC}){nodes{id title body url category{name}} pageInfo{hasNextPage endCursor}}}}`,
      { owner, name, after: cursor },
    );
    const discussions = pageData.repository.discussions;
    existing = findReleaseDiscussion(discussions.nodes, marker);
    if (!discussions.pageInfo.hasNextPage) break;
    cursor = discussions.pageInfo.endCursor;
  }
  if (existing) return existing;
  const category = repository.discussionCategories.nodes.find(item => item.name === 'Announcements');
  if (!category) throw new Error('Announcements discussion category is required');
  const title = `${release.name || release.tag_name} release`;
  const body = [marker, release.body || '', `Release: ${release.html_url}`].filter(Boolean).join('\n\n');
  const created = await githubGraphql(
    `mutation($repo:ID!,$cat:ID!,$title:String!,$body:String!){createDiscussion(input:{repositoryId:$repo,categoryId:$cat,title:$title,body:$body}){discussion{id title body url category{name}}}}`,
    { repo: repository.id, cat: category.id, title, body },
  );
  return created.createDiscussion.discussion;
}

function discussionFromEnvironment() {
  if (env.DISCUSSION_CATEGORY !== 'Announcements') throw new Error('discussion is not an Announcement');
  return {
    id: env.DISCUSSION_ID,
    title: env.DISCUSSION_TITLE,
    body: env.DISCUSSION_BODY,
    url: env.DISCUSSION_URL,
  };
}

async function discussionFromGitHub() {
  if (!/^\d+$/.test(env.DISCUSSION_NUMBER || '')) throw new Error('discussion number is invalid');
  const response = await request(`https://api.github.com/repos/${env.GITHUB_REPOSITORY}/discussions/${env.DISCUSSION_NUMBER}`, {
    headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' },
  });
  if (!response.ok) throw new Error(`discussion lookup failed (${response.status})`);
  const discussion = await response.json();
  if (discussion.category?.name !== 'Announcements') throw new Error('discussion is not an Announcement');
  return { id: discussion.node_id, title: discussion.title, body: discussion.body, url: discussion.html_url };
}

async function findReceiptComment(discussionId, marker) {
  let cursor = null;
  for (let page = 0; page < 50; page += 1) {
    const data = await githubGraphql(
      `query($id:ID!,$after:String){node(id:$id){... on Discussion{comments(first:100,after:$after){nodes{id body author{login}} pageInfo{hasNextPage endCursor}}}}}`,
      { id: discussionId, after: cursor },
    );
    const comments = data.node?.comments;
    if (!comments) throw new Error('discussion receipt lookup failed');
    const receipt = findDiscussionReceipt(comments.nodes, marker);
    if (receipt) return receipt;
    if (!comments.pageInfo.hasNextPage) return null;
    cursor = comments.pageInfo.endCursor;
  }
  throw new Error('discussion receipt lookup exceeded page budget');
}

async function addReceiptComment(discussionId, body) {
  const data = await githubGraphql(
    `mutation($id:ID!,$body:String!){addDiscussionComment(input:{discussionId:$id,body:$body}){comment{id}}}`,
    { id: discussionId, body },
  );
  return data.addDiscussionComment.comment.id;
}

async function updateReceiptComment(commentId, body) {
  await githubGraphql(
    `mutation($id:ID!,$body:String!){updateDiscussionComment(input:{commentId:$id,body:$body}){comment{id}}}`,
    { id: commentId, body },
  );
}

async function deleteReceiptComment(commentId) {
  await githubGraphql(
    `mutation($id:ID!){deleteDiscussionComment(input:{id:$id}){clientMutationId}}`,
    { id: commentId },
  );
}

async function discord(method, path, body) {
  const response = await request(`https://discord.com/api/v10${path}`, {
    method,
    headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) throw new Error(`Discord request failed (${response.status})`);
  return response.status === 204 ? null : response.json();
}

async function deliver(discussion) {
  const key = announcementKey({ repository: env.GITHUB_REPOSITORY, discussionId: discussion.id });
  if (env.DISCORD_ANNOUNCE_WEBHOOK_URL) {
    if (!env.GITHUB_TOKEN) throw new Error('GitHub receipt configuration is missing');
    const webhookUrl = normalizeDiscordWebhookUrl(env.DISCORD_ANNOUNCE_WEBHOOK_URL);
    const marker = discussionReceiptMarker(key);
    const existingReceipt = await findReceiptComment(discussion.id, marker);
    if (existingReceipt) {
      if (discussionReceiptStatus(existingReceipt) === 'complete') {
        console.log('announcement already delivered');
        return;
      }
      throw new Error('announcement has a pending receipt; inspect Discord before clearing it');
    }
    const claimId = await addReceiptComment(discussion.id, `${marker}\n\nDiscord delivery: pending.`);
    const payload = buildDiscordPayload({ title: discussion.title, body: discussion.body, url: discussion.url, key });
    delete payload.nonce;
    delete payload.enforce_nonce;
    const response = await request(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      await deleteReceiptComment(claimId);
      throw new Error(`Discord webhook request failed (${response.status})`);
    }
    const message = await response.json();
    await updateReceiptComment(claimId, `${marker}\n\nDiscord delivery: complete (message ${message.id}).`);
    console.log('announcement delivered by channel webhook');
    return;
  }
  if (!env.DISCORD_BOT_TOKEN || !/^\d{10,25}$/.test(env.DISCORD_ANNOUNCE_CHANNEL_ID || '')) {
    throw new Error('Discord announcement credentials are missing or invalid');
  }
  const recent = await discord('GET', `/channels/${env.DISCORD_ANNOUNCE_CHANNEL_ID}/messages?limit=100`);
  const receipt = findDiscordReceipt(recent, key);
  if (receipt) {
    await discord('PUT', `/channels/${env.DISCORD_ANNOUNCE_CHANNEL_ID}/pins/${receipt.id}`);
    console.log('announcement already delivered; pin verified');
    return;
  }
  const message = await discord('POST', `/channels/${env.DISCORD_ANNOUNCE_CHANNEL_ID}/messages`, buildDiscordPayload({
    title: discussion.title,
    body: discussion.body,
    url: discussion.url,
    key,
  }));
  await discord('PUT', `/channels/${env.DISCORD_ANNOUNCE_CHANNEL_ID}/pins/${message.id}`);
  console.log('announcement delivered and pinned');
}

async function main() {
  if (!env.GITHUB_REPOSITORY) throw new Error('GitHub repository configuration is missing');
  if ((env.ANNOUNCEMENT_KIND === 'release' || env.ANNOUNCEMENT_KIND === 'manual') && !env.GITHUB_TOKEN) throw new Error('GitHub configuration is missing');
  const discussion = env.ANNOUNCEMENT_KIND === 'release'
    ? await createOrFindReleaseDiscussion()
    : env.ANNOUNCEMENT_KIND === 'manual'
      ? await discussionFromGitHub()
      : discussionFromEnvironment();
  await deliver(discussion);
}

main().catch(error => {
  console.error(`release-announce failed: ${error.message}`);
  process.exitCode = 1;
});
