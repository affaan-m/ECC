'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const initSqlJs = require('sql.js');
const toml = require('@iarna/toml');

const { buildControlPaneActions } = require('./actions');

const SNAPSHOT_SCHEMA_VERSION = 'ecc.control-pane.snapshot.v1';

function homeDir(env = process.env) {
  return env.HOME || env.USERPROFILE || os.homedir() || '.';
}

function defaultDbPath(env = process.env) {
  return path.join(homeDir(env), '.claude', 'ecc2.db');
}

function defaultConfigPaths(cwd = process.cwd(), env = process.env) {
  const home = homeDir(env);
  const paths = [
    path.join(home, 'Library', 'Application Support', 'ecc2', 'config.toml'),
    path.join(home, '.config', 'ecc2', 'config.toml'),
    path.join(home, '.claude', 'ecc2.toml'),
  ];

  let current = path.resolve(cwd);
  while (current && current !== path.dirname(current)) {
    paths.push(path.join(current, '.claude', 'ecc2.toml'));
    paths.push(path.join(current, 'ecc2.toml'));
    current = path.dirname(current);
  }

  return Array.from(new Set(paths));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function deepMerge(base, override) {
  const merged = { ...base };
  for (const [key, value] of Object.entries(override || {})) {
    if (isPlainObject(value) && isPlainObject(merged[key])) {
      merged[key] = deepMerge(merged[key], value);
    } else {
      merged[key] = value;
    }
  }
  return merged;
}

function toCamelCase(value) {
  return String(value).replace(/_([a-z])/g, (_, char) => char.toUpperCase());
}

function normalizeObjectKeys(value) {
  if (Array.isArray(value)) return value.map(normalizeObjectKeys);
  if (!isPlainObject(value)) return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [toCamelCase(key), normalizeObjectKeys(item)])
  );
}

function normalizeMemoryConnectors(connectors = {}) {
  return Object.fromEntries(
    Object.entries(connectors || {})
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, connector]) => [name, normalizeObjectKeys(connector)])
  );
}

function normalizeConfig(rawConfig = {}, options = {}) {
  const { memory_connectors: snakeMemoryConnectors, memoryConnectors, ...rest } = rawConfig;
  const normalized = normalizeObjectKeys(rest);
  const connectorConfig = memoryConnectors || snakeMemoryConnectors || normalized.memoryConnectors;
  return {
    dbPath: options.dbPath || normalized.dbPath || defaultDbPath(options.env),
    memoryConnectors: normalizeMemoryConnectors(connectorConfig),
  };
}

function readTomlConfig(configPath) {
  const raw = fs.readFileSync(configPath, 'utf8');
  return toml.parse(raw);
}

function resolveControlPaneConfig(options = {}) {
  const env = options.env || process.env;
  const cwd = options.cwd || process.cwd();
  const configPaths = options.configPath
    ? [path.resolve(options.configPath)]
    : defaultConfigPaths(cwd, env);
  let merged = {};

  for (const configPath of configPaths) {
    if (fs.existsSync(configPath)) {
      merged = deepMerge(merged, readTomlConfig(configPath));
    }
  }

  return {
    ...normalizeConfig(merged, {
      env,
      dbPath: options.dbPath || env.ECC2_DB_PATH || null,
    }),
    configPaths: configPaths.filter(configPath => fs.existsSync(configPath)),
  };
}

async function openSqlDatabase(dbPath) {
  if (!dbPath || !fs.existsSync(dbPath)) return null;
  const SQL = await initSqlJs();
  const buffer = fs.readFileSync(dbPath);
  return new SQL.Database(buffer);
}

function execRows(db, sql, params = []) {
  const stmt = db.prepare(sql);
  try {
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    return rows;
  } finally {
    stmt.free();
  }
}

function tableExists(db, tableName) {
  const rows = execRows(
    db,
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1",
    [tableName]
  );
  return rows.length > 0;
}

function parseJson(value, fallback) {
  if (typeof value !== 'string' || value.trim() === '') return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeSession(row, unreadMessages) {
  const id = String(row.id || '');
  return {
    id,
    task: String(row.task || ''),
    project: String(row.project || ''),
    taskGroup: String(row.task_group || ''),
    agentType: String(row.agent_type || ''),
    harness: String(row.harness || 'unknown'),
    detectedHarnesses: parseJson(row.detected_harnesses_json, []),
    workingDir: String(row.working_dir || '.'),
    state: String(row.state || 'pending'),
    pid: row.pid === null || row.pid === undefined ? null : toNumber(row.pid),
    worktree: row.worktree_path
      ? {
          path: String(row.worktree_path),
          branch: row.worktree_branch ? String(row.worktree_branch) : null,
          base: row.worktree_base ? String(row.worktree_base) : null,
        }
      : null,
    metrics: {
      inputTokens: toNumber(row.input_tokens),
      outputTokens: toNumber(row.output_tokens),
      tokensUsed: toNumber(row.tokens_used),
      toolCalls: toNumber(row.tool_calls),
      filesChanged: toNumber(row.files_changed),
      durationSecs: toNumber(row.duration_secs),
      costUsd: toNumber(row.cost_usd),
    },
    unreadMessages: unreadMessages.get(id) || 0,
    createdAt: String(row.created_at || ''),
    updatedAt: String(row.updated_at || ''),
    lastHeartbeatAt: String(row.last_heartbeat_at || ''),
  };
}

function readUnreadMessageCounts(db) {
  if (!tableExists(db, 'messages')) return new Map();
  return new Map(
    execRows(
      db,
      'SELECT to_session, COUNT(*) AS unread_count FROM messages WHERE read = 0 GROUP BY to_session'
    ).map(row => [String(row.to_session), toNumber(row.unread_count)])
  );
}

function readSessions(db) {
  if (!tableExists(db, 'sessions')) return [];
  const unreadMessages = readUnreadMessageCounts(db);
  return execRows(
    db,
    `SELECT *
     FROM sessions
     ORDER BY updated_at DESC, created_at DESC, id ASC
     LIMIT 100`
  ).map(row => normalizeSession(row, unreadMessages));
}

function summarizeSessions(sessions) {
  const summary = {
    totalSessions: sessions.length,
    runningSessions: 0,
    pendingSessions: 0,
    idleSessions: 0,
    failedSessions: 0,
    stoppedSessions: 0,
    completedSessions: 0,
    unreadMessages: 0,
    activeWorktrees: 0,
    totalTokens: 0,
    totalCostUsd: 0,
  };

  for (const session of sessions) {
    if (session.state === 'running') summary.runningSessions += 1;
    if (session.state === 'pending') summary.pendingSessions += 1;
    if (session.state === 'idle') summary.idleSessions += 1;
    if (session.state === 'failed') summary.failedSessions += 1;
    if (session.state === 'stopped') summary.stoppedSessions += 1;
    if (session.state === 'completed') summary.completedSessions += 1;
    if (session.worktree) summary.activeWorktrees += 1;
    summary.unreadMessages += session.unreadMessages;
    summary.totalTokens += session.metrics.tokensUsed;
    summary.totalCostUsd += session.metrics.costUsd;
  }

  summary.totalCostUsd = Number(summary.totalCostUsd.toFixed(6));
  return summary;
}

function readEntities(db) {
  if (!tableExists(db, 'context_graph_entities')) return [];
  return execRows(
    db,
    `SELECT *
     FROM context_graph_entities
     ORDER BY updated_at DESC, id DESC
     LIMIT 500`
  ).map(row => ({
    id: toNumber(row.id),
    sessionId: row.session_id ? String(row.session_id) : null,
    entityType: String(row.entity_type || ''),
    name: String(row.name || ''),
    path: row.path ? String(row.path) : null,
    summary: String(row.summary || ''),
    metadata: parseJson(row.metadata_json, {}),
    createdAt: String(row.created_at || ''),
    updatedAt: String(row.updated_at || ''),
  }));
}

function readObservations(db) {
  if (!tableExists(db, 'context_graph_observations')) return [];
  return execRows(
    db,
    `SELECT *
     FROM context_graph_observations
     ORDER BY created_at DESC, id DESC
     LIMIT 1000`
  ).map(row => ({
    id: toNumber(row.id),
    sessionId: row.session_id ? String(row.session_id) : null,
    entityId: toNumber(row.entity_id),
    observationType: String(row.observation_type || ''),
    priority: toNumber(row.priority, 1),
    pinned: toNumber(row.pinned) === 1,
    summary: String(row.summary || ''),
    details: parseJson(row.details_json, {}),
    createdAt: String(row.created_at || ''),
  }));
}

function readRelationCounts(db) {
  if (!tableExists(db, 'context_graph_relations')) return new Map();
  const rows = execRows(
    db,
    `SELECT entity_id, SUM(relation_count) AS relation_count
     FROM (
       SELECT from_entity_id AS entity_id, COUNT(*) AS relation_count
       FROM context_graph_relations
       GROUP BY from_entity_id
       UNION ALL
       SELECT to_entity_id AS entity_id, COUNT(*) AS relation_count
       FROM context_graph_relations
       GROUP BY to_entity_id
     )
     GROUP BY entity_id`
  );
  return new Map(rows.map(row => [toNumber(row.entity_id), toNumber(row.relation_count)]));
}

function tokenize(value) {
  return String(value || '')
    .toLowerCase()
    .split(/[^a-z0-9_.-]+/g)
    .map(token => token.trim())
    .filter(token => token.length >= 2);
}

function scoreEntity(entity, observations, relationCount, queryTerms) {
  const observationText = observations.map(observation => observation.summary).join(' ');
  const metadataText = Object.entries(entity.metadata || {})
    .map(([key, value]) => `${key} ${value}`)
    .join(' ');
  const haystacks = [
    { text: entity.name, weight: 12 },
    { text: entity.entityType, weight: 5 },
    { text: entity.path || '', weight: 6 },
    { text: entity.summary, weight: 8 },
    { text: metadataText, weight: 5 },
    { text: observationText, weight: 10 },
  ].map(item => ({ ...item, text: item.text.toLowerCase() }));
  const matchedTerms = [];
  let score = 0;

  for (const term of queryTerms) {
    let matched = false;
    for (const haystack of haystacks) {
      if (haystack.text.includes(term)) {
        score += haystack.weight;
        matched = true;
      }
    }
    if (matched) matchedTerms.push(term);
  }

  const maxPriority = observations.reduce(
    (highest, observation) => Math.max(highest, observation.priority),
    0
  );
  const hasPinnedObservation = observations.some(observation => observation.pinned);
  score += Math.min(relationCount, 8);
  score += maxPriority * 3;
  if (hasPinnedObservation) score += 8;

  return {
    score,
    matchedTerms,
    observationCount: observations.length,
    relationCount,
    maxObservationPriority: maxPriority,
    hasPinnedObservation,
  };
}

function recallKnowledgeEntries({ entities, observations, relationCounts, query, limit = 12 }) {
  const queryTerms = Array.from(new Set(tokenize(query)));
  const observationsByEntity = new Map();
  for (const observation of observations) {
    const bucket = observationsByEntity.get(observation.entityId) || [];
    bucket.push(observation);
    observationsByEntity.set(observation.entityId, bucket);
  }

  return entities
    .map(entity => {
      const entityObservations = observationsByEntity.get(entity.id) || [];
      const score = queryTerms.length > 0
        ? scoreEntity(entity, entityObservations, relationCounts.get(entity.id) || 0, queryTerms)
        : {
            score: entityObservations.some(observation => observation.pinned) ? 10 : 1,
            matchedTerms: [],
            observationCount: entityObservations.length,
            relationCount: relationCounts.get(entity.id) || 0,
            maxObservationPriority: entityObservations.reduce(
              (highest, observation) => Math.max(highest, observation.priority),
              0
            ),
            hasPinnedObservation: entityObservations.some(observation => observation.pinned),
          };
      return {
        entity,
        ...score,
        latestObservation: entityObservations[0] || null,
      };
    })
    .filter(entry => queryTerms.length === 0 || entry.matchedTerms.length > 0)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return String(right.entity.updatedAt).localeCompare(String(left.entity.updatedAt));
    })
    .slice(0, Math.max(1, Math.min(Number(limit) || 12, 50)));
}

function readConnectorCheckpointRows(db) {
  if (!tableExists(db, 'context_graph_connector_checkpoints')) return [];
  return execRows(
    db,
    `SELECT connector_name, COUNT(*) AS synced_sources, MAX(updated_at) AS last_synced_at
     FROM context_graph_connector_checkpoints
     GROUP BY connector_name`
  );
}

function connectorStatus(config, db) {
  const checkpoints = new Map(
    (db ? readConnectorCheckpointRows(db) : []).map(row => [
      String(row.connector_name),
      {
        syncedSources: toNumber(row.synced_sources),
        lastSyncedAt: row.last_synced_at ? String(row.last_synced_at) : null,
      },
    ])
  );

  return Object.entries(config.memoryConnectors || {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, connector]) => {
      const checkpoint = checkpoints.get(name) || { syncedSources: 0, lastSyncedAt: null };
      return {
        name,
        kind: connector.kind || 'unknown',
        path: connector.path || null,
        recurse: Boolean(connector.recurse),
        defaultEntityType: connector.defaultEntityType || null,
        defaultObservationType: connector.defaultObservationType || null,
        includeSafeValues: Boolean(connector.includeSafeValues),
        syncedSources: checkpoint.syncedSources,
        lastSyncedAt: checkpoint.lastSyncedAt,
      };
    });
}

async function buildControlPaneSnapshot(options = {}) {
  const repoRoot = path.resolve(options.repoRoot || path.join(__dirname, '..', '..', '..'));
  const config = options.config
    ? normalizeConfig(options.config, {
        env: options.env || process.env,
        dbPath: options.dbPath || options.config.dbPath || null,
      })
    : resolveControlPaneConfig(options);
  const dbPath = options.dbPath || config.dbPath;
  const query = String(options.query || '').trim();
  const limit = Math.max(1, Math.min(Number.parseInt(String(options.limit || 12), 10) || 12, 50));
  const generatedAt = new Date().toISOString();
  const base = {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    generatedAt,
    repoRoot,
    dbPath,
    database: {
      exists: Boolean(dbPath && fs.existsSync(dbPath)),
    },
    config: {
      configPaths: config.configPaths || [],
      memoryConnectorCount: Object.keys(config.memoryConnectors || {}).length,
    },
    execution: {
      allowActions: options.allowActions !== false,
    },
    summary: summarizeSessions([]),
    sessions: [],
    knowledge: {
      query,
      entityCount: 0,
      observationCount: 0,
      results: [],
    },
    connectors: connectorStatus(config, null),
    actions: buildControlPaneActions({ repoRoot, query, limit }),
  };

  const db = await openSqlDatabase(dbPath);
  if (!db) {
    return base;
  }

  try {
    const sessions = readSessions(db);
    const entities = readEntities(db);
    const observations = readObservations(db);
    const relationCounts = readRelationCounts(db);
    return {
      ...base,
      summary: summarizeSessions(sessions),
      sessions,
      knowledge: {
        query,
        entityCount: entities.length,
        observationCount: observations.length,
        results: recallKnowledgeEntries({
          entities,
          observations,
          relationCounts,
          query,
          limit,
        }),
      },
      connectors: connectorStatus(config, db),
    };
  } finally {
    db.close();
  }
}

module.exports = {
  SNAPSHOT_SCHEMA_VERSION,
  buildControlPaneSnapshot,
  defaultConfigPaths,
  recallKnowledgeEntries,
  resolveControlPaneConfig,
};
