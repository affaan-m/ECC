'use strict';

function normalize(items) {
  return items
    .filter(item => item.qty > 0)
    .map(item => ({ sku: String(item.sku).trim().toUpperCase(), qty: item.qty }));
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
