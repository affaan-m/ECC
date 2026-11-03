// Finds or opens the gemini.google.com tab and makes sure the content script
// is listening before a clip is dispatched to it.

const GEMINI_URL = 'https://gemini.google.com/app';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitForLoad(tabId, timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === 'complete') return tab;
    await sleep(300);
  }
  throw new Error('Gemini tab took too long to load.');
}

async function ping(tabId) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      const reply = await chrome.tabs.sendMessage(tabId, { type: 'gemini:ping' });
      if (reply?.ok) return true;
    } catch {
      // Content script not ready yet.
    }
    await sleep(700);
  }
  return false;
}

async function existingTab(preferredId) {
  if (preferredId) {
    try {
      const tab = await chrome.tabs.get(preferredId);
      if (tab?.url?.startsWith('https://gemini.google.com/')) return tab;
    } catch {
      // Closed.
    }
  }
  const [tab] = await chrome.tabs.query({ url: 'https://gemini.google.com/*' });
  return tab || null;
}

export async function ensureGeminiTab(preferredId) {
  let tab = await existingTab(preferredId);
  if (!tab) {
    tab = await chrome.tabs.create({ url: GEMINI_URL, active: true });
    await sleep(500);
  }
  tab = await waitForLoad(tab.id);
  if (!tab.url?.startsWith('https://gemini.google.com/')) {
    throw new Error('The Gemini tab left gemini.google.com (sign in to Google first, then try again).');
  }
  if (!(await ping(tab.id))) {
    throw new Error('Gemini page is not responding: reload gemini.google.com and try again.');
  }
  await chrome.tabs.update(tab.id, { active: true }).catch(() => {});
  return tab;
}
