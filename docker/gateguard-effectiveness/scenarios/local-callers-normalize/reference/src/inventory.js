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
  let sum = 0;
  for (const qty of normalize(items).values()) sum += qty;
  return sum;
}

function skus(items) {
  return [...normalize(items).keys()];
}

function restockList(items, minimum) {
  return [...normalize(items)].filter(([, qty]) => qty < minimum).map(([sku]) => sku);
}

module.exports = { totalUnits, skus, restockList };
