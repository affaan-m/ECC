'use strict';

function normalize(items) {
  const merged = new Map();
  for (const item of items) {
    if (!(item.qty > 0)) continue;
    const sku = String(item.sku).trim().toUpperCase();
    merged.set(sku, (merged.get(sku) || 0) + item.qty);
  }
  return merged;
}

function totalUnits(items) {
  return normalize(items).reduce((sum, item) => sum + item.qty, 0);
}

function skus(items) {
  return normalize(items).map(item => item.sku);
}

function restockList(items, minimum) {
  return normalize(items)
    .filter(item => item.qty < minimum)
    .map(item => item.sku);
}

module.exports = { totalUnits, skus, restockList };
