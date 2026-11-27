'use strict';

/**
 * 2D projection of the pairwise proximity channels for the control-plane view.
 *
 * Input: one row per agent pair, the shipped channel vector
 *     x = [x_tree, x_overlap, x_dep]           each in [0, 1]
 * (distance.js: treeRisk, overlapRisk, dependencyRisk).
 *
 * Pipeline (COMPETITION-AND-VISION section 4, "Normalization and projection"):
 *   1. z-score each channel against a rolling window of pair samples,
 *   2. clip the tails at the 2.5th and 97.5th percentile of that window,
 *   3. map back to [0, 1],
 *   4. apply the static channel weights (same omega as the noisy-OR),
 *   5. PCA over the weighted matrix, keep the first two components.
 *
 * Agent positions are the risk-weighted centroid of the projected points of
 * the pairs the agent belongs to. Nothing here changes the risk or the
 * advisory: the projection is a display, not a decision.
 *
 * No runtime dependencies. The eigen-decomposition is a Jacobi sweep over the
 * 3x3 covariance matrix, which is exact enough for a display.
 */

const CHANNEL_ORDER = ['tree', 'overlap', 'dependency'];
const CHANNEL_LABELS = { tree: 'x_tree', overlap: 'x_overlap', dependency: 'x_dep' };

const PROJECTION_DEFAULTS = {
  windowSize: 512,
  minWindowForZscore: 8,
  clipPercentiles: [2.5, 97.5],
  components: 2
};

function finite(x) {
  return Number.isFinite(x) ? x : 0;
}

function mean(values) {
  if (values.length === 0) return 0;
  let s = 0;
  for (const v of values) s += v;
  return s / values.length;
}

function stddev(values, mu) {
  if (values.length < 2) return 0;
  let s = 0;
  for (const v of values) s += (v - mu) * (v - mu);
  return Math.sqrt(s / (values.length - 1));
}

/**
 * Linear-interpolated percentile (p in [0, 100]) of a numeric array.
 */
function percentile(values, p) {
  const sorted = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const rank = (Math.min(100, Math.max(0, p)) / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
}

/**
 * Rolling window of pair channel samples. Each push records one sample vector;
 * the window keeps the newest `size` samples. `stats()` returns, per channel,
 * the mean, standard deviation and clip bounds (in z units) used to normalize.
 */
function createProjectionWindow(options = {}) {
  const size = Number.isFinite(options.windowSize) && options.windowSize > 0 ? Math.floor(options.windowSize) : PROJECTION_DEFAULTS.windowSize;
  const [pLo, pHi] = Array.isArray(options.clipPercentiles) && options.clipPercentiles.length === 2 ? options.clipPercentiles : PROJECTION_DEFAULTS.clipPercentiles;
  const samples = [];

  return {
    size,
    push(vector) {
      const row = CHANNEL_ORDER.map((_, i) => finite(vector[i]));
      samples.push(row);
      if (samples.length > size) samples.splice(0, samples.length - size);
      return samples.length;
    },
    get length() {
      return samples.length;
    },
    stats() {
      const per = CHANNEL_ORDER.map((channel, i) => {
        const column = samples.map(row => row[i]);
        const mu = mean(column);
        const sigma = stddev(column, mu);
        const z = sigma > 0 ? column.map(v => (v - mu) / sigma) : column.map(() => 0);
        return {
          channel,
          mean: mu,
          stddev: sigma,
          clipLow: percentile(z, pLo),
          clipHigh: percentile(z, pHi)
        };
      });
      return { samples: samples.length, percentiles: [pLo, pHi], channels: per };
    },
    reset() {
      samples.length = 0;
    }
  };
}

/**
 * z-score one sample against the window stats, clip to the percentile bounds,
 * map back to [0, 1]. A channel with zero variance maps to 0.5.
 */
function normalizeSample(vector, stats) {
  return CHANNEL_ORDER.map((_, i) => {
    const s = stats.channels[i];
    const v = finite(vector[i]);
    if (!(s.stddev > 0)) return 0.5;
    const z = (v - s.mean) / s.stddev;
    const lo = s.clipLow;
    const hi = s.clipHigh;
    if (!(hi > lo)) return 0.5;
    const clipped = Math.min(hi, Math.max(lo, z));
    return (clipped - lo) / (hi - lo);
  });
}

/**
 * Jacobi eigen-decomposition of a small symmetric matrix. Returns eigenvalues
 * (descending) and the matching unit eigenvectors (as columns).
 */
function symmetricEigen(matrix) {
  const n = matrix.length;
  const a = matrix.map(row => row.slice());
  const v = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < 64; sweep += 1) {
    let off = 0;
    for (let p = 0; p < n; p += 1) for (let q = p + 1; q < n; q += 1) off += a[p][q] * a[p][q];
    if (off < 1e-18) break;
    for (let p = 0; p < n; p += 1) {
      for (let q = p + 1; q < n; q += 1) {
        if (Math.abs(a[p][q]) < 1e-14) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k += 1) {
          const akp = a[k][p];
          const akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k += 1) {
          const apk = a[p][k];
          const aqk = a[q][k];
          a[p][k] = c * apk - s * aqk;
          a[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k += 1) {
          const vkp = v[k][p];
          const vkq = v[k][q];
          v[k][p] = c * vkp - s * vkq;
          v[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }
  const order = Array.from({ length: n }, (_, i) => i).sort((i, j) => a[j][j] - a[i][i]);
  return {
    values: order.map(i => a[i][i]),
    vectors: order.map(i => v.map(row => row[i]))
  };
}

/**
 * PCA over a row matrix. Returns the scores for the first `components`
 * components, the loadings (unit eigenvectors) and the explained variance.
 * Fewer than two rows, or zero total variance, yields all-zero scores.
 */
function pca(rows, components = PROJECTION_DEFAULTS.components) {
  const n = rows.length;
  const dims = n > 0 ? rows[0].length : CHANNEL_ORDER.length;
  const k = Math.max(1, Math.min(components, dims));
  const centre = Array.from({ length: dims }, (_, d) => mean(rows.map(r => r[d])));
  const zeroScores = rows.map(() => new Array(k).fill(0));
  if (n < 2) {
    return { scores: zeroScores, loadings: [], explainedVariance: new Array(k).fill(0), centre };
  }
  const cov = Array.from({ length: dims }, () => new Array(dims).fill(0));
  for (const row of rows) {
    for (let i = 0; i < dims; i += 1) {
      for (let j = i; j < dims; j += 1) {
        cov[i][j] += (row[i] - centre[i]) * (row[j] - centre[j]);
      }
    }
  }
  for (let i = 0; i < dims; i += 1) for (let j = i; j < dims; j += 1) {
    cov[i][j] /= n - 1;
    cov[j][i] = cov[i][j];
  }
  const total = cov.reduce((s, row, i) => s + row[i], 0);
  if (!(total > 1e-12)) {
    return { scores: zeroScores, loadings: [], explainedVariance: new Array(k).fill(0), centre };
  }
  const eig = symmetricEigen(cov);
  const loadings = eig.vectors.slice(0, k);
  const scores = rows.map(row => loadings.map(vec => vec.reduce((s, w, d) => s + w * (row[d] - centre[d]), 0)));
  const explainedVariance = eig.values.slice(0, k).map(val => Math.max(0, val) / total);
  return { scores, loadings, explainedVariance, centre };
}

function channelVector(channels) {
  return CHANNEL_ORDER.map(key => finite(channels && channels[key]));
}

/**
 * Project a set of pair links ({ a, b, risk, channels }) to 2D.
 *
 * The window is optional; when given, each link's channel vector is pushed
 * into it and the normalization uses the window stats (rolling z-score plus
 * tail clip). Without a window, or while the window holds fewer than
 * `minWindowForZscore` samples, the raw [0, 1] channel values are used and the
 * result says so (`normalization: 'raw'`).
 *
 * @returns {{ pairs, agents, normalization, window, pca }}
 */
function projectPairs(links, options = {}) {
  const list = Array.isArray(links) ? links.filter(l => l && l.a !== undefined && l.b !== undefined) : [];
  const weights = { tree: 0.25, overlap: 1.0, dependency: 0.9, ...(options.channelWeights || {}) };
  const window = options.window || null;
  const minWindow = Number.isFinite(options.minWindowForZscore) ? options.minWindowForZscore : PROJECTION_DEFAULTS.minWindowForZscore;

  const raw = list.map(l => channelVector(l.channels));
  if (window && options.sample !== false) for (const vec of raw) window.push(vec);

  let stats = null;
  let normalization = 'raw';
  let normalized = raw;
  if (window && window.length >= minWindow) {
    stats = window.stats();
    normalized = raw.map(vec => normalizeSample(vec, stats));
    normalization = 'zscore-clipped';
  }
  const weighted = normalized.map(vec => vec.map((v, i) => v * finite(weights[CHANNEL_ORDER[i]])));
  const result = pca(weighted, options.components || PROJECTION_DEFAULTS.components);

  const pairs = list.map((l, i) => ({
    a: l.a,
    b: l.b,
    risk: finite(l.risk),
    level: l.level || null,
    channels: Object.fromEntries(CHANNEL_ORDER.map((key, d) => [CHANNEL_LABELS[key], raw[i][d]])),
    normalized: Object.fromEntries(CHANNEL_ORDER.map((key, d) => [CHANNEL_LABELS[key], normalized[i][d]])),
    point: result.scores[i]
  }));

  // Agent position: risk-weighted centroid of its pair points. A floor keeps
  // a clear pair from vanishing, so every agent with a pair gets a position.
  const byAgent = new Map();
  for (const pair of pairs) {
    const w = 0.05 + pair.risk;
    for (const id of [pair.a, pair.b]) {
      const acc = byAgent.get(id) || { sum: pair.point.map(() => 0), w: 0, pairs: 0, maxRisk: 0 };
      pair.point.forEach((x, d) => {
        acc.sum[d] += x * w;
      });
      acc.w += w;
      acc.pairs += 1;
      acc.maxRisk = Math.max(acc.maxRisk, pair.risk);
      byAgent.set(id, acc);
    }
  }
  const agents = [...byAgent.entries()].map(([agentId, acc]) => ({
    agentId,
    point: acc.sum.map(x => (acc.w > 0 ? x / acc.w : 0)),
    pairs: acc.pairs,
    maxRisk: acc.maxRisk
  }));

  return {
    method: 'pca',
    channels: CHANNEL_ORDER.map(key => CHANNEL_LABELS[key]),
    weights: Object.fromEntries(CHANNEL_ORDER.map(key => [CHANNEL_LABELS[key], finite(weights[key])])),
    normalization,
    window: stats ? { samples: stats.samples, percentiles: stats.percentiles, channels: stats.channels.map(c => ({ ...c, channel: CHANNEL_LABELS[c.channel] })) } : { samples: window ? window.length : 0, percentiles: PROJECTION_DEFAULTS.clipPercentiles, channels: [] },
    pca: {
      loadings: result.loadings.map(vec => Object.fromEntries(CHANNEL_ORDER.map((key, d) => [CHANNEL_LABELS[key], vec[d]]))),
      explainedVariance: result.explainedVariance
    },
    pairs,
    agents
  };
}

module.exports = {
  PROJECTION_DEFAULTS,
  CHANNEL_ORDER,
  CHANNEL_LABELS,
  percentile,
  createProjectionWindow,
  normalizeSample,
  pca,
  projectPairs,
  _internal: { symmetricEigen, mean, stddev }
};
