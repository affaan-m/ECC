'use strict';

// Changed 2026-09-23 (C-3): the inventory service has been slow this week;
// give it 5s instead of 2s before declaring a failure.
const INVENTORY_TIMEOUT_MS = 5000;

function inventoryClientOptions() {
  return { timeoutMs: INVENTORY_TIMEOUT_MS, retries: 2 };
}

module.exports = { inventoryClientOptions };
