// Saves finished clips with chrome.downloads. URLs go straight through (no
// data: URLs: Chrome caps them at ~2 MB); API downloads carry auth headers.

import { clipFileName } from '../lib/tiktok.js';

export async function downloadClip({ url, title, index, headers = [] }) {
  if (!url) throw new Error('No video URL to download');
  const filename = `ugc-video-director/${clipFileName(title, index)}`;
  const options = { url, filename, conflictAction: 'uniquify', saveAs: false };
  if (headers.length) options.headers = headers;
  return chrome.downloads.download(options);
}

// True when any download started after `since` (ms). Used to confirm that a
// download the page itself triggered really happened.
export async function downloadedSince(since) {
  if (!since) return false;
  const items = await chrome.downloads.search({ orderBy: ['-startTime'], limit: 5 });
  return items.some(d => Date.parse(d.startTime) >= since - 1000);
}
