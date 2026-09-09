'use strict';

function routeKey(route) {
  return `${route.backend}:${route.tier}:${route.os}:${route.arch}`;
}

function isRoutable(route) {
  return route && route.result === 'routable' && typeof route.backend === 'string';
}

function activeMs(entry) {
  const value = entry.active_total_ms ?? entry.performance?.active_total_ms;
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function cleanupPassed(entry) {
  return entry.cleanup?.pass === true || entry.cleanup_pass === true;
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function collectHistory(routes, history = []) {
  const eligible = new Map(routes.map(route => [route.backend, route]));
  const samples = new Map();
  const ignored = {};
  const explanations = [];

  const ignore = (reason) => {
    ignored[reason] = (ignored[reason] || 0) + 1;
  };

  for (const entry of history || []) {
    if (!eligible.has(entry.backend)) {
      if (entry.backend) explanations.push(`ignored history for unavailable backend ${entry.backend}`);
      ignore('unavailable-backend');
      continue;
    }
    if (entry.execution_mode !== 'real') {
      ignore('mock-history');
      continue;
    }
    if (!cleanupPassed(entry)) {
      ignore('cleanup-incomplete');
      continue;
    }
    if (entry.result !== 'pass') {
      ignore('non-passing-history');
      continue;
    }
    const elapsed = activeMs(entry);
    if (elapsed === null) {
      ignore('missing-active-total');
      continue;
    }
    const route = eligible.get(entry.backend);
    if (
      entry.os && entry.os !== route.os
      || entry.arch && entry.arch !== route.arch
      || Number.isInteger(entry.tier) && entry.tier !== route.tier
    ) {
      ignore('target-mismatch');
      continue;
    }
    const key = route.backend;
    samples.set(key, [...(samples.get(key) || []), elapsed]);
  }

  return { samples, ignored, explanations };
}

function explainRouteRanking(routes, history = []) {
  const routable = (routes || []).filter(isRoutable);
  const collected = collectHistory(routable, history);
  return {
    backends: [...collected.samples.keys()].sort(),
    ignored_reasons: Object.fromEntries(
      Object.entries(collected.ignored)
        .filter(([reason]) => reason !== 'unavailable-backend')
        .sort(([left], [right]) => left.localeCompare(right))
    ),
    unavailable_history: collected.ignored['unavailable-backend'] || 0,
  };
}

function rankEligibleRoutes(_manifest, routes, options = {}) {
  const routable = (routes || []).filter(isRoutable);
  const ignoredRoutes = (routes || []).length - routable.length;
  const deterministic = routable.map((route, index) => ({ ...route, deterministic_index: index }));
  const collected = collectHistory(deterministic, options.history || []);
  const scored = deterministic.map(route => {
    const values = collected.samples.get(route.backend) || [];
    return {
      ...route,
      score: values.length > 0 ? median(values) : null,
      history_samples: values.length,
    };
  });
  const hasUsableHistory = scored.some(route => route.score !== null);
  const ranked = hasUsableHistory
    ? [...scored].sort((left, right) => {
      if (left.score === null && right.score === null) {
        return left.deterministic_index - right.deterministic_index;
      }
      if (left.score === null) return 1;
      if (right.score === null) return -1;
      return (left.score - right.score) || (left.deterministic_index - right.deterministic_index);
    })
    : scored;

  const explanations = [...new Set(collected.explanations)];
  if (!hasUsableHistory) {
    explanations.unshift('no eligible real cleanup-complete history; preserving deterministic router order');
  } else {
    ranked.forEach((route, index) => {
      const prior = scored[index];
      if (prior && prior.backend !== route.backend) {
        explanations.push(`ranked ${route.backend} before ${prior.backend} using static eligible route history`);
      }
    });
  }

  return {
    schema_version: 1,
    mode: hasUsableHistory ? 'shadow' : 'deterministic',
    selected: ranked[0] || null,
    routes: ranked,
    ignored_routes: ignoredRoutes,
    ignored_history: collected.ignored,
    explanations,
  };
}

module.exports = {
  collectHistory,
  explainRouteRanking,
  rankEligibleRoutes,
  routeKey,
};
