// Service worker: message router between the side panel, the options page and
// the Gemini content script. Long work happens in script-job.js / clip-runner.js.

import { getSettings, setSettings, getJob, saveJob, emptyJob } from './storage.js';
import { getGoogleToken, signOutGoogle, oauthConfigured } from './auth.js';
import { writeScript, updateScript } from './script-job.js';
import { startRun, requestStop, completeClip, failClip, dispatchNext } from './clip-runner.js';
import { recoverInterrupted, inFlight } from '../lib/run-state.js';

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

// On every worker start-up: a job left "running" with a clip in flight may
// still get its clip:result (the content script keeps waiting), so give it a
// grace period; a job running with nothing in flight simply resumes.
async function recoverOnStartup() {
  const job = await getJob();
  if (job.status !== 'running') return;
  if (!inFlight(job)) {
    await dispatchNext();
    return;
  }
  const timeoutMs = ((await getSettings()).clipTimeoutMinutes || 10) * 60 * 1000;
  if (job.dispatchedAt && Date.now() - job.dispatchedAt < timeoutMs) return;
  await saveJob(recoverInterrupted(job));
}
recoverOnStartup().catch(() => {});

chrome.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name !== 'ugc-keepalive') return;
  // Keeps the worker alive while a clip renders; also re-checks a stale job.
  const job = await getJob();
  const timeoutMs = ((await getSettings()).clipTimeoutMinutes || 10) * 60 * 1000 + 60000;
  if (job.status === 'running' && inFlight(job) && job.dispatchedAt && Date.now() - job.dispatchedAt > timeoutMs) {
    await failClip(inFlight(job).index, 'No answer from the Gemini page within the time limit.');
  }
});

const fromExtensionPage = sender => Boolean(sender.url && sender.url.startsWith(chrome.runtime.getURL('')));
const fromGemini = sender => Boolean(sender.tab && sender.url && sender.url.startsWith('https://gemini.google.com/'));

const panelHandlers = {
  'settings:get': () => getSettings(),
  'settings:set': ({ settings }) => setSettings(settings),
  'auth:status': async () => ({ oauthConfigured: oauthConfigured() }),
  'auth:google': async () => {
    await getGoogleToken({ interactive: true });
    return { ok: true };
  },
  'auth:google:signout': async () => {
    await signOutGoogle();
    return { ok: true };
  },
  'job:get': () => getJob(),
  'job:reset': () => saveJob(emptyJob()),
  'job:writeScript': ({ input }) => writeScript(input),
  'job:updateScript': ({ script }) => updateScript(script),
  'job:run': async () => {
    await startRun();
    return { started: true };
  },
  'job:retryClip': async ({ index }) => {
    await startRun({ only: index });
    return { started: true };
  },
  'job:stop': async () => {
    await requestStop();
    return { ok: true };
  },
  'gemini:probe': async () => {
    const [tab] = await chrome.tabs.query({ url: 'https://gemini.google.com/*' });
    if (!tab) return { error: 'Open gemini.google.com in a tab first.' };
    return chrome.tabs.sendMessage(tab.id, { type: 'gemini:probe' }).catch(err => ({ error: err.message }));
  },
};

const geminiHandlers = {
  'clip:heartbeat': () => ({ ok: true }),
  'clip:result': async ({ index, result }) => {
    await completeClip(index, result || {});
    return { ok: true };
  },
  'clip:error': async ({ index, error }) => {
    await failClip(index, error || 'Unknown error on the Gemini page');
    return { ok: true };
  },
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const type = message?.type;
  const handler = fromExtensionPage(sender) ? panelHandlers[type] : (fromGemini(sender) ? geminiHandlers[type] : null);
  if (!handler) return false;
  Promise.resolve()
    .then(() => handler(message, sender))
    .then(result => sendResponse(result ?? { ok: true }))
    .catch(err => sendResponse({ error: err.message || String(err) }));
  return true;
});
