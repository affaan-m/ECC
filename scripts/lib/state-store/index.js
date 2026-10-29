'use strict';

const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const initSqlJs = require('sql.js');
const { withStateStoreLock, recordCleanupError } = require('./file-lock');

const { applyMigrations, getAppliedMigrations } = require('./migrations');
const { createQueryApi } = require('./queries');
const { assertValidEntity, validateEntity } = require('./schema');
const {
  buildInstallStateStoreRecord,
  projectInstallState,
  reconcileCurrentInstallState,
  reconcileInstallStateProjections,
  removeInstallStateProjection,
  summarizeProjectedInstallHealth,
} = require('./install-state-projection');

const DEFAULT_STATE_STORE_RELATIVE_PATH = path.join('.claude', 'ecc', 'state.db');
const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;

function stateStorePathError(targetPath, detail) {
  return new Error(`Unsafe state-store path '${targetPath}': ${detail}`);
}

function lstatIfPresent(targetPath, options) {
  try {
    return fs.lstatSync(targetPath, options);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

function isAllowedPlatformSymlink(targetPath, stats) {
  if (process.platform !== 'darwin' || !stats || stats.uid !== 0) {
    return false;
  }

  const allowedTargets = new Map([
    ['/var', '/private/var'],
    ['/tmp', '/private/tmp'],
    ['/etc', '/private/etc'],
  ]);
  const expectedTarget = allowedTargets.get(targetPath);
  if (!expectedTarget) {
    return false;
  }

  try {
    return fs.realpathSync(targetPath) === expectedTarget;
  } catch (_error) {
    return false;
  }
}

function assertNotSymlink(targetPath, stats) {
  if (stats && stats.isSymbolicLink()) {
    if (isAllowedPlatformSymlink(targetPath, stats)) {
      return;
    }
    throw stateStorePathError(targetPath, 'a symlink is not allowed');
  }
}

function ensurePrivateDirectory(directoryPath) {
  const absolutePath = path.resolve(directoryPath);
  const parsed = path.parse(absolutePath);
  const segments = absolutePath.slice(parsed.root.length).split(path.sep).filter(Boolean);
  let currentPath = parsed.root;

  for (const segment of segments) {
    currentPath = path.join(currentPath, segment);
    let stats = lstatIfPresent(currentPath);
    assertNotSymlink(currentPath, stats);

    if (!stats) {
      try {
        fs.mkdirSync(currentPath, { mode: PRIVATE_DIRECTORY_MODE });
      } catch (error) {
        if (!error || error.code !== 'EEXIST') {
          throw error;
        }
      }
      stats = fs.lstatSync(currentPath);
      assertNotSymlink(currentPath, stats);
    }

    if (!stats.isDirectory() && !isAllowedPlatformSymlink(currentPath, stats)) {
      throw stateStorePathError(currentPath, 'an intermediate component is not a directory');
    }
  }

  return absolutePath;
}

function assertSafeDatabaseFile(dbPath, options) {
  const stats = lstatIfPresent(dbPath, options);
  assertNotSymlink(dbPath, stats);
  if (stats && !stats.isFile()) {
    throw stateStorePathError(dbPath, 'database path is not a regular file');
  }
  return stats;
}

function readDatabaseFile(dbPath) {
  assertSafeDatabaseFile(dbPath);
  const noFollow = fs.constants.O_NOFOLLOW || 0;
  const fileDescriptor = fs.openSync(dbPath, fs.constants.O_RDONLY | noFollow);
  try {
    const stats = fs.fstatSync(fileDescriptor, { bigint: true });
    if (!stats.isFile()) {
      throw stateStorePathError(dbPath, 'database path is not a regular file');
    }
    return { bytes: fs.readFileSync(fileDescriptor), identity: stats };
  } finally {
    fs.closeSync(fileDescriptor);
  }
}

function sameDatabaseSnapshot(left, right) {
  if (!left || !right || left.ino !== right.ino) return false;
  // Windows path stats can omit the device reported by the open descriptor.
  const sameDevice = left.dev === right.dev
    || (process.platform === 'win32' && (left.dev === 0n || right.dev === 0n));
  return sameDevice && left.size === right.size
    && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
}

function syncDirectory(directoryPath) {
  if (process.platform === 'win32') {
    return;
  }

  let fileDescriptor;
  try {
    fileDescriptor = fs.openSync(directoryPath, fs.constants.O_RDONLY);
    fs.fsyncSync(fileDescriptor);
  } catch (_error) {
    // Some filesystems do not permit directory fsync. The file was still
    // atomically replaced and fsynced before this durability best effort.
  } finally {
    if (fileDescriptor !== undefined) {
      fs.closeSync(fileDescriptor);
    }
  }
}

function writeDatabaseFileAtomic(dbPath, data) {
  const directoryPath = ensurePrivateDirectory(path.dirname(dbPath));
  assertSafeDatabaseFile(dbPath);
  const temporaryPath = path.join(
    directoryPath,
    `.${path.basename(dbPath)}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`
  );
  const noFollow = fs.constants.O_NOFOLLOW || 0;
  const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | noFollow;
  let fileDescriptor;

  try {
    fileDescriptor = fs.openSync(temporaryPath, flags, PRIVATE_FILE_MODE);
    fs.writeFileSync(fileDescriptor, data);
    fs.fchmodSync(fileDescriptor, PRIVATE_FILE_MODE);
    fs.fsyncSync(fileDescriptor);
    fs.closeSync(fileDescriptor);
    fileDescriptor = undefined;

    // A final-path symlink is never followed. If one appeared after this
    // check, rename replaces the link itself rather than its target.
    assertSafeDatabaseFile(dbPath);
    fs.renameSync(temporaryPath, dbPath);
    syncDirectory(directoryPath);
  } finally {
    if (fileDescriptor !== undefined) {
      fs.closeSync(fileDescriptor);
    }
    try {
      fs.unlinkSync(temporaryPath);
    } catch (error) {
      if (!error || error.code !== 'ENOENT') {
        // Preserve the original persistence result. The temporary file is
        // private, exclusively created, and never used as canonical state.
      }
    }
  }
}

function resolveStateStorePath(options = {}) {
  if (options.dbPath) {
    if (options.dbPath === ':memory:') {
      return options.dbPath;
    }
    return path.resolve(options.dbPath);
  }

  const homeDir = options.homeDir || process.env.HOME || os.homedir();
  return path.join(homeDir, DEFAULT_STATE_STORE_RELATIVE_PATH);
}

/**
 * Wraps a sql.js Database with a better-sqlite3-compatible API surface so
 * that the rest of the state-store code (migrations.js, queries.js) can
 * operate without knowing which driver is in use.
 *
 * IMPORTANT: sql.js db.export() implicitly ends any active transaction, so
 * we must defer all disk writes until after the transaction commits.
 */
function wrapSqlJsDatabase(SQL, dbPath, trustedReads = new WeakSet()) {
  let rawDb = null;
  let closed = false;
  let inSnapshot = false;
  let dirty = false;
  let inTransaction = false;
  let needsSnapshotComparison = false;
  let snapshotBytes = null;
  let readCacheIdentity = null;
  let cacheableSnapshot = false;

  function reload() {
    const cachedIdentity = readCacheIdentity;
    readCacheIdentity = null;
    if (dbPath === ':memory:' && rawDb) return;
    const current = dbPath !== ':memory:' ? assertSafeDatabaseFile(dbPath, { bigint: true }) : null;
    if (rawDb && sameDatabaseSnapshot(cachedIdentity, current)) return cachedIdentity;
    const snapshot = current ? readDatabaseFile(dbPath) : null;
    const bytes = snapshot ? snapshot.bytes : undefined;
    // sql.js can use its input buffer as writable backing storage.
    const originalBytes = bytes ? Buffer.from(bytes) : null;
    const latest = new SQL.Database(bytes);
    try {
      latest.run('PRAGMA foreign_keys = ON');
      if (rawDb) {
        const previous = rawDb;
        rawDb = null;
        try { previous.close(); }
        catch (error) { closed = true; throw error; }
      }
    } catch (error) {
      // The replacement is not adopted until both initialization and the old
      // handle's close succeed. Never reuse an uncertain previous handle.
      try { latest.close(); } catch (closeError) { recordCleanupError(error, 'closeError', closeError); }
      throw error;
    }
    rawDb = latest;
    snapshotBytes = originalBytes;
    return snapshot && snapshot.identity;
  }

  // Hold one lock from reload through commit. Nested statements and public
  // query methods reuse the snapshot, including a transaction's reads.
  function withSnapshot(callback) {
    if (closed) throw new Error('State store is closed');
    if (inSnapshot) return callback();
    const execute = () => {
      const identity = reload();
      inSnapshot = true;
      dirty = false;
      needsSnapshotComparison = false;
      cacheableSnapshot = true;
      try {
        const result = callback();
        if (result && typeof result.then === 'function') {
          throw new Error('State-store operations must be synchronous');
        }
        if ((dirty || needsSnapshotComparison) && dbPath !== ':memory:') {
          // Prepared get/all statements and PRAGMAs can also write. Compare
          // database bytes instead of guessing from SQL syntax, while keeping
          // read-only queries from rewriting the file. Export only here:
          // exporting inside a transaction would implicitly end it before
          // our commit/rollback boundary.
          const data = Buffer.from(rawDb.export());
          if (dirty || !snapshotBytes || !data.equals(snapshotBytes)) {
            writeDatabaseFileAtomic(dbPath, data);
          }
        }
        // Only a successful snapshot of trusted SELECTs can retain its handle.
        // Export and generic SQL may reset connection settings or alter state;
        // those paths must reload before the next operation, even on failure.
        if (cacheableSnapshot && !dirty && !needsSnapshotComparison) readCacheIdentity = identity;
        return result;
      } finally {
        inSnapshot = false;
        dirty = false;
        needsSnapshotComparison = false;
        cacheableSnapshot = false;
      }
    };
    try {
      return dbPath === ':memory:' ? execute() : withStateStoreLock(dbPath, execute);
    } catch (error) {
      readCacheIdentity = null;
      throw error;
    }
  }

  function query(sql, positionalArgs, firstOnly, trustedRead) {
    return withSnapshot(() => {
      if (!trustedRead) needsSnapshotComparison = true;
      const stmt = rawDb.prepare(sql);
      try {
        if (positionalArgs.length === 1 && typeof positionalArgs[0] !== 'object') {
          stmt.bind([positionalArgs[0]]);
        } else if (positionalArgs.length > 1) {
          stmt.bind(positionalArgs);
        }
        if (firstOnly) return stmt.step() ? stmt.getAsObject() : null;
        const rows = [];
        while (stmt.step()) rows.push(stmt.getAsObject());
        return rows;
      } finally {
        stmt.free();
      }
    });
  }

  function runStatement(sql, namedParams) {
    return withSnapshot(() => {
      needsSnapshotComparison = true;
      const stmt = rawDb.prepare(sql);
      try {
        if (namedParams && typeof namedParams === 'object' && !Array.isArray(namedParams)) {
          stmt.bind(Object.fromEntries(Object.entries(namedParams)
            .map(([key, value]) => [`@${key}`, value === undefined ? null : value])));
        }
        stmt.step();
        dirty = true;
      } finally {
        stmt.free();
      }
    });
  }

  function transact(fn, args) {
    if (inTransaction) throw new Error('Nested state-store transactions are not supported');
    cacheableSnapshot = false;
    rawDb.run('BEGIN');
    inTransaction = true;
    const previouslyDirty = dirty;
    try {
      const result = fn(...args);
      if (result && typeof result.then === 'function') {
        throw new Error('State-store transactions must be synchronous');
      }
      rawDb.run('COMMIT');
      return result;
    } catch (error) {
      try {
        rawDb.run('ROLLBACK');
      } catch (rollbackError) {
        // Never reuse an uncertain transaction, including an in-memory store.
        closed = true;
        try { rawDb.close(); } catch (closeError) { recordCleanupError(error, 'closeError', closeError); }
        rawDb = null;
        recordCleanupError(error, 'rollbackError', rollbackError);
      }
      dirty = previouslyDirty;
      throw error;
    } finally {
      inTransaction = false;
    }
  }

  const db = {
    withSnapshot,
    exec(sql) {
      return withSnapshot(() => {
        needsSnapshotComparison = true;
        rawDb.run(sql);
        dirty = true;
      });
    },

    pragma(pragmaStr) {
      return withSnapshot(() => {
        needsSnapshotComparison = true;
        rawDb.run(`PRAGMA ${pragmaStr}`);
      });
    },

    prepare(sql) {
      const statement = {
        all(...positionalArgs) {
          return query(sql, positionalArgs, false, trustedReads.has(statement));
        },

        get(...positionalArgs) {
          return query(sql, positionalArgs, true, trustedReads.has(statement));
        },

        run(namedParams) {
          return runStatement(sql, namedParams);
        },
      };
      return statement;
    },

    transaction(fn) {
      return (...args) => withSnapshot(() => transact(fn, args));
    },

    close() {
      if (inSnapshot) throw new Error('Cannot close a state store during an operation');
      if (closed) return;
      closed = true;
      readCacheIdentity = null;
      if (rawDb) rawDb.close();
    },
  };

  return db;
}

function openDatabase(SQL, dbPath, trustedReads) {
  if (dbPath !== ':memory:') {
    ensurePrivateDirectory(path.dirname(dbPath));
  }

  return wrapSqlJsDatabase(SQL, dbPath, trustedReads);
}

async function createStateStore(options = {}) {
  const dbPath = resolveStateStorePath(options);
  const SQL = await initSqlJs();
  const trustedReads = new WeakSet();
  const db = openDatabase(SQL, dbPath, trustedReads);
  let appliedMigrations;
  try {
    appliedMigrations = db.withSnapshot(() => applyMigrations(db));
  } catch (error) {
    try { db.close(); } catch (closeError) { recordCleanupError(error, 'closeError', closeError); }
    throw error;
  }
  const queryApi = createQueryApi(db, {
    prepareRead(sql) {
      const statement = db.prepare(sql);
      trustedReads.add(statement);
      return statement;
    },
  });
  const synchronizedQueries = Object.fromEntries(Object.entries(queryApi)
    .map(([name, query]) => [name, (...args) => db.withSnapshot(() => query(...args))]));

  return {
    dbPath,
    close() {
      db.close();
    },
    getAppliedMigrations() {
      return db.withSnapshot(() => getAppliedMigrations(db));
    },
    validateEntity,
    assertValidEntity,
    ...synchronizedQueries,
    _database: db,
    _migrations: appliedMigrations,
  };
}

module.exports = {
  DEFAULT_STATE_STORE_RELATIVE_PATH,
  buildInstallStateStoreRecord,
  createStateStore,
  projectInstallState,
  reconcileCurrentInstallState,
  reconcileInstallStateProjections,
  removeInstallStateProjection,
  resolveStateStorePath,
  summarizeProjectedInstallHealth,
};
