'use strict';

const express = require('express');
const router = express.Router();
const db = require('../lib/db');
const cache = require('../lib/cache-manager');
const { PROVIDERS } = require('../lib/providers');

// GET /api/stats - totals for dashboard
router.get('/stats', (req, res) => {
  const totals = db.getTotals();
  const cacheStats = cache.stats();
  res.json({ ...totals, cacheEntries: cacheStats.entries, cacheTotalHits: cacheStats.totalHits });
});

// GET /api/recent - last N requests
router.get('/recent', (req, res) => {
  const n = Math.min(parseInt(req.query.n || '50', 10), 500);
  res.json(db.getRecent(n));
});

// GET /api/orgs - per-org savings
router.get('/orgs', (req, res) => {
  res.json(db.getOrgs());
});

// GET /api/timeseries - hourly buckets
router.get('/timeseries', (req, res) => {
  const hours = Math.min(parseInt(req.query.hours || '24', 10), 168);
  res.json(db.getTimeSeries(hours));
});

// GET /api/providers - supported providers and models
router.get('/providers', (req, res) => {
  const summary = Object.entries(PROVIDERS).map(([id, p]) => ({
    id, name: p.name, models: Object.keys(p.models)
  }));
  res.json(summary);
});

module.exports = router;
