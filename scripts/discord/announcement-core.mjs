import { createHash } from 'node:crypto';

const DISCORD_DESCRIPTION_LIMIT = 4000;

export function isAnnouncementDiscussion(discussion) {
  return discussion?.category?.name === 'Announcements';
}

export function releaseMarker(tag) {
  const normalized = String(tag || '').trim();
  if (!normalized) throw new Error('release tag is required');
  return `<!-- ecc-release:${normalized} -->`;
}

export function findReleaseDiscussion(discussions, marker) {
  return discussions.find(item => (
    item?.category?.name === 'Announcements'
    && typeof item.body === 'string'
    && item.body.includes(marker)
  )) || null;
}

export function announcementKey({ repository, discussionId }) {
  if (!/^[^/\s]+\/[^/\s]+$/.test(String(repository || ''))) throw new Error('invalid repository');
  if (!/^[A-Za-z0-9_-]+$/.test(String(discussionId || ''))) throw new Error('invalid discussion id');
  return `${repository}:discussion:${discussionId}`;
}

export function buildDiscordPayload({ title, body, url, key }) {
  const discussionId = String(key).split(':').at(-1);
  const footer = `ecc:${discussionId}`;
  const description = String(body || '').trim().slice(0, DISCORD_DESCRIPTION_LIMIT);
  const nonce = `ecc-${createHash('sha256').update(String(key)).digest('hex').slice(0, 16)}`;
  return {
    allowed_mentions: { parse: [] },
    nonce,
    enforce_nonce: true,
    embeds: [{
      title: String(title || 'ECC announcement').trim().slice(0, 256),
      description,
      url: String(url || ''),
      footer: { text: footer },
    }],
  };
}

export function findDiscordReceipt(messages, key) {
  const discussionId = String(key).split(':').at(-1);
  return messages.find(message => message.embeds?.some(embed => embed.footer?.text === `ecc:${discussionId}`)) || null;
}

export function normalizeDiscordWebhookUrl(value) {
  const raw = String(value || '').trim();
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('invalid Discord webhook URL');
  }
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'discord.com' || parsed.port || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('invalid Discord webhook URL');
  }
  if (!/^\/api\/webhooks\/\d{10,25}\/[A-Za-z0-9._-]{20,}$/.test(parsed.pathname)) {
    throw new Error('invalid Discord webhook URL');
  }
  parsed.search = '?wait=true';
  return parsed.toString();
}

export function discussionReceiptMarker(key) {
  return `<!-- ecc-discord-receipt:${createHash('sha256').update(String(key)).digest('hex').slice(0, 32)} -->`;
}

export function findDiscussionReceipt(comments, marker) {
  const trusted = comments.filter(comment => (
    ['github-actions', 'github-actions[bot]'].includes(comment?.author?.login)
    && typeof comment.body === 'string'
    && comment.body.includes(marker)
  ));
  return trusted.find(comment => discussionReceiptStatus(comment) === 'complete') || trusted[0] || null;
}

export function discussionReceiptStatus(comment) {
  const body = String(comment?.body || '');
  if (body.includes('Discord delivery: complete')) return 'complete';
  if (body.includes('Discord delivery: pending')) return 'pending';
  return 'unknown';
}
