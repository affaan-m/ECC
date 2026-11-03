// Small helpers for the TikTok publishing block shown at the end of a job.

export const MAX_CAPTION_LENGTH = 2200;

export function formatHashtags(tags = []) {
  return tags
    .map(t => String(t).trim().replace(/^#/, '').replace(/[^\p{L}\p{N}_]/gu, ''))
    .filter(Boolean)
    .map(t => `#${t}`)
    .join(' ');
}

export function buildCaption(tiktok = {}) {
  const caption = (tiktok.caption || '').trim();
  const tags = formatHashtags(tiktok.hashtags || []);
  const full = [caption, tags].filter(Boolean).join('\n\n');
  return full.length > MAX_CAPTION_LENGTH ? `${full.slice(0, MAX_CAPTION_LENGTH - 1)}…` : full;
}

export function clipFileName(jobTitle, index, ext = 'mp4') {
  const base = String(jobTitle || 'ugc').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'ugc';
  return `${base}-clip-${String(index).padStart(2, '0')}.${ext}`;
}
