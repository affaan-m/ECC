'use strict';

const crypto = require('crypto');
const { stableStringify } = require('../context-profile-support');

function deliveryFingerprint(items, endSession) {
  return crypto.createHash('sha256').update(stableStringify({ items, endSession: Boolean(endSession) })).digest('hex');
}

// A retry carries the original immutable snapshot, not a newer preview that
// happens to contain some of the same edit IDs. This is local UI transport
// state, separate from ECC execution evidence and canonical task state.
function deliveryClientJs() {
  return String.raw`  function validDelivery(value) {
    return value && typeof value.id === 'string' && /^[a-f0-9]{32}$/.test(value.id) && ['edits', 'finish'].includes(value.kind)
      && typeof value.snapshotHash === 'string' && /^[a-f0-9]{64}$/.test(value.snapshotHash)
      && value.item && value.item.kind === value.kind && typeof value.item.html === 'string' && value.item.html.length <= 6 * 1024 * 1024
      && Array.isArray(value.item.edits) && value.item.edits.length <= 500;
  }
  let pendingDelivery = validDelivery(stored.pendingDelivery) ? stored.pendingDelivery : null;
  if (pendingDelivery && boot.uiDeliveries && boot.uiDeliveries[pendingDelivery.id]) {
    const accepted = new Set(boot.uiDeliveries[pendingDelivery.id].editIds || []);
    edits = edits.filter(edit => !accepted.has(edit.id));
    pendingDelivery = null;
    writeStore({ pendingDelivery: null, edits });
  }
  if (pendingDelivery) deliveryRequest = 'retry-' + pendingDelivery.id;
  async function prepareDelivery(kind, item, sourceRevision) {
    if (pendingDelivery) {
      if (pendingDelivery.kind !== kind) throw new Error('Retry the previous delivery before starting another one.');
      return pendingDelivery;
    }
    const id = crypto.randomUUID().replace(/-/g, '');
    let record;
    try {
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(item.html));
      const snapshotHash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
      record = { id, kind, item, snapshotHash, sourceRevision };
      sessionStorage.setItem(STORE, JSON.stringify(Object.assign(readStore(), { pendingDelivery: record })));
    } catch (_error) {
      throw Object.assign(new Error('Could not preserve a retryable snapshot in browser storage. Your changes remain in the preview.'), { definitive: true });
    }
    pendingDelivery = record;
    return record;
  }
  function clearDelivery() {
    pendingDelivery = null;
    writeStore({ pendingDelivery: null });
  }
`;
}

module.exports = { deliveryClientJs, deliveryFingerprint };
