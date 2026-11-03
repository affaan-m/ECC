// Step 2 of a job: render clips one at a time. The runner is event-driven so it
// survives the MV3 worker being suspended: it dispatches one clip, the content
// script answers right away, and the real result arrives later as a
// 'clip:result' / 'clip:error' message that wakes the worker and triggers the
// next dispatch. In API mode the render is a sequence of short fetches instead.

import { wrapForGeminiApp, mergeSelectors } from '../lib/gemini-app.js';
import { omniGenerateClip } from '../lib/llm/omni-video.js';
import { clipFileName } from '../lib/tiktok.js';
import { nextClip, inFlight, previousInteractionId, allDone, patchPrompt } from '../lib/run-state.js';
import { getSettings, getJob, saveJob, withLog } from './storage.js';
import { resolveGeminiAuth } from './auth.js';
import { downloadClip, downloadedSince } from './downloads.js';
import { ensureGeminiTab } from './gemini-tab.js';

const KEEPALIVE = 'ugc-keepalive';
let dispatching = false;

function referenceImages(job) {
  const imgs = [];
  if (job.input?.reference) imgs.push({ mimeType: job.input.reference.mimeType, base64: job.input.reference.base64 });
  else if (job.anchorFrame) imgs.push(job.anchorFrame);
  return imgs.slice(0, 3);
}

function selectorOverrides(settings) {
  if (!settings.selectorOverrides) return { selectors: null, error: '' };
  try {
    const merged = mergeSelectors(JSON.parse(settings.selectorOverrides));
    const plain = Object.fromEntries(Object.entries(merged).map(([k, v]) => [k, v instanceof RegExp ? v.source : v]));
    return { selectors: plain, error: '' };
  } catch (err) {
    return { selectors: null, error: `Selector overrides ignored: ${err.message}` };
  }
}

async function dispatchInApp(job, item, settings) {
  const tab = await ensureGeminiTab(job.geminiTabId);
  const { selectors, error } = selectorOverrides(settings);
  if (error) job = withLog(job, error);
  const message = {
    type: 'gemini:generateClip',
    index: item.index,
    fileName: clipFileName(job.script?.title, item.index),
    prompt: wrapForGeminiApp(item.prompt, { index: item.index, total: job.prompts.length, seconds: item.seconds, sameConversation: settings.conversationMode === 'same' }),
    images: referenceImages(job),
    newChat: item.index === 1 || settings.conversationMode === 'new',
    timeoutMs: (Number(settings.clipTimeoutMinutes) || 10) * 60 * 1000,
    wantAnchor: !job.input?.reference && !job.anchorFrame,
    selectors,
  };
  const ack = await chrome.tabs.sendMessage(tab.id, message);
  if (ack?.error) throw new Error(ack.error);
  return saveJob({ ...job, geminiTabId: tab.id, dispatchedAt: Date.now() });
}

async function renderViaApi(job, item, settings) {
  const auth = await resolveGeminiAuth(settings);
  const previous = settings.conversationMode === 'same' ? previousInteractionId(job, item.index) : undefined;
  const result = await omniGenerateClip({
    auth,
    prompt: item.prompt,
    images: previous ? [] : referenceImages(job),
    aspect: '9:16',
    resolution: settings.omniResolution || '1080p',
    previousInteractionId: previous,
    maxWaitMs: (Number(settings.clipTimeoutMinutes) || 10) * 60 * 1000,
  });
  const headers = auth.accessToken ? [{ name: 'Authorization', value: `Bearer ${auth.accessToken}` }] : [];
  if (auth.accessToken && auth.projectId) headers.push({ name: 'x-goog-user-project', value: auth.projectId });
  const downloadId = await downloadClip({ url: result.downloadUrl, title: job.script?.title, index: item.index, headers });
  return { videoUrl: '', interactionId: result.interactionId, downloadId, downloadedByPage: false };
}

async function finishRun(job) {
  await chrome.alarms.clear(KEEPALIVE);
  const done = allDone(job);
  return saveJob(withLog({ ...job, status: done ? 'done' : 'ready', runOnly: null, stopRequested: false }, done ? 'All clips rendered.' : 'Batch finished.'));
}

// Renders the next clip in the queue. Returns once the clip is dispatched (app
// mode) or finished (api mode). Safe to call repeatedly: it is a no-op while a
// clip is in flight or another dispatch is running.
export async function dispatchNext() {
  if (dispatching) return;
  dispatching = true;
  try {
    let job = await getJob();
    if (job.status !== 'running' || inFlight(job)) return;
    if (job.stopRequested) {
      await chrome.alarms.clear(KEEPALIVE);
      await saveJob(withLog({ ...job, status: 'stopped', runOnly: null, stopRequested: false }, 'Stopped by user.'));
      return;
    }
    const item = nextClip(job);
    if (!item) {
      await finishRun(job);
      return;
    }
    const settings = await getSettings();
    job = await saveJob(withLog(patchPrompt(job, item.index, { status: 'running', error: '' }), `Clip ${item.index}: rendering (${settings.renderMode}).`));
    try {
      if (settings.renderMode === 'api') {
        const reply = await renderViaApi(job, item, settings);
        dispatching = false;
        await completeClip(item.index, reply);
      } else {
        await dispatchInApp(job, item, settings);
      }
    } catch (err) {
      await failClip(item.index, err.message);
    }
  } finally {
    dispatching = false;
  }
}

export async function startRun({ only = null } = {}) {
  const job = await getJob();
  if (!job.prompts?.length) throw new Error('Write the script first');
  if (job.status === 'running') throw new Error('A clip is already being rendered; wait or press Stop.');
  await chrome.alarms.create(KEEPALIVE, { periodInMinutes: 0.5 });
  const queued = only ? patchPrompt(job, only, { status: 'pending', error: '' }) : job;
  await saveJob({ ...queued, status: 'running', error: '', runOnly: only, stopRequested: false });
  await dispatchNext();
}

export async function requestStop() {
  const job = await getJob();
  if (job.status !== 'running') return;
  await saveJob(withLog({ ...job, stopRequested: true }, 'Stop requested; finishing the current clip.'));
}

const httpsUrl = url => (/^https:/.test(url || '') ? url : '');

// Makes sure the clip ended up on disk: the page may have saved it already;
// otherwise the worker downloads the https URL itself.
async function resolveDownload(job, index, reply) {
  if (reply.downloadId) return { downloadId: reply.downloadId, saved: true, job };
  if (reply.downloadedByPage || (await downloadedSince(job.dispatchedAt))) return { downloadId: null, saved: true, job };
  if (!httpsUrl(reply.videoUrl)) return { downloadId: null, saved: false, job };
  try {
    const downloadId = await downloadClip({ url: reply.videoUrl, title: job.script?.title, index });
    return { downloadId, saved: true, job };
  } catch (err) {
    return { downloadId: null, saved: false, job: withLog(job, `Clip ${index}: download failed (${err.message}); link kept.`) };
  }
}

// Called when the content script reports a rendered clip (or by the API path).
export async function completeClip(index, reply) {
  const current = await getJob();
  const item = current.prompts?.find(p => p.index === index);
  if (!item || item.status !== 'running') return;
  const { downloadId, saved, job } = await resolveDownload(current, index, reply);
  const patched = patchPrompt(job, index, {
    status: 'done',
    videoUrl: httpsUrl(reply.videoUrl),
    interactionId: reply.interactionId || null,
    downloadId,
    downloadedByPage: saved,
  });
  const needsAnchor = !patched.input?.reference && !patched.anchorFrame;
  const anchorFrame = needsAnchor && reply.anchorFrame ? reply.anchorFrame : patched.anchorFrame;
  await saveJob(withLog({ ...patched, anchorFrame }, `Clip ${index}: done${saved ? ', saved' : ''}.`));
  await dispatchNext();
}

export async function failClip(index, message) {
  const job = await getJob();
  await chrome.alarms.clear(KEEPALIVE);
  await saveJob(withLog(patchPrompt({ ...job, status: 'error', error: message, runOnly: null, stopRequested: false }, index, { status: 'error', error: message }), `Clip ${index}: ${message}`));
}
