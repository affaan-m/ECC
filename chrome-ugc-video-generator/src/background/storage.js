// chrome.storage.local wrappers. Settings and the single active job live here
// so the side panel, options page and worker share one source of truth.

export const DEFAULT_SETTINGS = Object.freeze({
  provider: 'app',
  appModel: '',
  geminiModel: 'gemini-4-argon',
  geminiApiKey: '',
  projectId: '',
  openaiApiKey: '',
  openaiModel: 'gpt-5',
  renderMode: 'app',
  conversationMode: 'same',
  omniResolution: '1080p',
  clipTimeoutMinutes: 10,
  selectorOverrides: '',
  language: 'pt-BR',
});

export async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...(settings || {}) };
}

export async function setSettings(patch) {
  const current = await getSettings();
  const next = { ...current, ...patch };
  await chrome.storage.local.set({ settings: next });
  return next;
}

export function emptyJob() {
  return {
    id: `job-${Date.now()}`,
    status: 'idle',
    error: '',
    input: null,
    script: null,
    prompts: [],
    anchorFrame: null,
    geminiTabId: null,
    runOnly: null,
    stopRequested: false,
    dispatchedAt: 0,
    log: [],
  };
}

export async function getJob() {
  const { job } = await chrome.storage.local.get('job');
  return job || emptyJob();
}

export async function saveJob(job) {
  await chrome.storage.local.set({ job });
  chrome.runtime.sendMessage({ type: 'job:changed', job }).catch(() => {});
  return job;
}

export function withLog(job, line) {
  const stamp = new Date().toISOString().slice(11, 19);
  const log = [...job.log, `${stamp} ${line}`].slice(-200);
  return { ...job, log };
}
