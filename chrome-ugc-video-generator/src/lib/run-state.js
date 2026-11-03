// Pure helpers for the clip queue. The worker is event-driven (one clip in
// flight, results arrive as messages), so all queue decisions live here where
// they can be tested without Chrome.

export function patchPrompt(job, index, patch) {
  return { ...job, prompts: job.prompts.map(p => (p.index === index ? { ...p, ...patch } : p)) };
}

// The clip to render next: the one explicitly requested (retry) if it is not
// done, otherwise the first prompt that is still pending or failed.
export function nextClip(job) {
  if (!job?.prompts?.length) return null;
  if (job.runOnly) {
    const only = job.prompts.find(p => p.index === job.runOnly);
    return only && only.status !== 'done' ? only : null;
  }
  return job.prompts.find(p => p.status === 'pending' || p.status === 'error') || null;
}

export function inFlight(job) {
  return job?.prompts?.find(p => p.status === 'running') || null;
}

// In API mode a retry must chain from the clip rendered just before it, not
// from whatever finished last.
export function previousInteractionId(job, index) {
  const before = (job.prompts || []).filter(p => p.index < index && p.status === 'done' && p.interactionId);
  return before.length ? before[before.length - 1].interactionId : undefined;
}

export function allDone(job) {
  return Boolean(job?.prompts?.length) && job.prompts.every(p => p.status === 'done');
}

// A job found in "running" state when the worker starts up was interrupted:
// no loop is alive, so whatever was in flight must be re-queued.
export function recoverInterrupted(job) {
  if (job?.status !== 'running') return job;
  const prompts = (job.prompts || []).map(p => (p.status === 'running' ? { ...p, status: 'error', error: 'Interrompido (o Chrome reiniciou a extensão); clique em Gerar para retomar.' } : p));
  return { ...job, prompts, status: 'ready', runOnly: null, stopRequested: false };
}
