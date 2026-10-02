'use strict';

const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const initSqlJs = require('sql.js');

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

function lstatIfPresent(targetPath) {
  try {
    return fs.lstatSync(targetPath);
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

function assertSafeDatabaseFile(dbPath) {
  const stats = lstatIfPresent(dbPath);
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
    const stats = fs.fstatSync(fileDescriptor);
    if (!stats.isFile()) {
      throw stateStorePathError(dbPath, 'database path is not a regular file');
    }
    return fs.readFileSync(fileDescriptor);
  } finally {
    fs.closeSync(fileDescriptor);
  }
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
function wrapSqlJsDatabase(rawDb, dbPath) {
  let inTransaction = false;

  function saveToDisk() {
    if (dbPath === ':memory:' || inTransaction) {
      return;
    }
    const data = rawDb.export();
    const buffer = Buffer.from(data);
    writeDatabaseFileAtomic(dbPath, buffer);
  }

  const db = {
    exec(sql) {
      rawDb.run(sql);
      saveToDisk();
    },

    pragma(pragmaStr) {
      try {
        rawDb.run(`PRAGMA ${pragmaStr}`);
      } catch (_error) {
        // Ignore unsupported pragmas (e.g. WAL for in-memory databases).
      }
    },

    prepare(sql) {
      return {
        all(...positionalArgs) {
          const stmt = rawDb.prepare(sql);
          if (positionalArgs.length === 1 && typeof positionalArgs[0] !== 'object') {
            stmt.bind([positionalArgs[0]]);
          } else if (positionalArgs.length > 1) {
            stmt.bind(positionalArgs);
          }

          const rows = [];
          while (stmt.step()) {
            rows.push(stmt.getAsObject());
          }
          stmt.free();
          return rows;
        },

        get(...positionalArgs) {
          const stmt = rawDb.prepare(sql);
          if (positionalArgs.length === 1 && typeof positionalArgs[0] !== 'object') {
            stmt.bind([positionalArgs[0]]);
          } else if (positionalArgs.length > 1) {
            stmt.bind(positionalArgs);
          }

          let row = null;
          if (stmt.step()) {
            row = stmt.getAsObject();
          }
          stmt.free();
          return row;
        },

        run(namedParams) {
          const stmt = rawDb.prepare(sql);
          if (namedParams && typeof namedParams === 'object' && !Array.isArray(namedParams)) {
            const sqlJsParams = {};
            for (const [key, value] of Object.entries(namedParams)) {
              sqlJsParams[`@${key}`] = value === undefined ? null : value;
            }
            stmt.bind(sqlJsParams);
          }
          stmt.step();
          stmt.free();
          saveToDisk();
        },
      };
    },

    transaction(fn) {
      return (...args) => {
        rawDb.run('BEGIN');
        inTransaction = true;
        try {
          const result = fn(...args);
          rawDb.run('COMMIT');
          inTransaction = false;
          saveToDisk();
          return result;
        } catch (error) {
          try {
            rawDb.run('ROLLBACK');
          } catch (_rollbackError) {
            // Transaction may already be rolled back.
          }
          inTransaction = false;
          throw error;
        }
      };
    },

    close() {
      saveToDisk();
      rawDb.close();
    },
  };

  return db;
}

async function openDatabase(SQL, dbPath) {
  if (dbPath !== ':memory:') {
    ensurePrivateDirectory(path.dirname(dbPath));
  }

  let rawDb;
  if (dbPath !== ':memory:' && assertSafeDatabaseFile(dbPath)) {
    const fileBuffer = readDatabaseFile(dbPath);
    rawDb = new SQL.Database(fileBuffer);
  } else {
    rawDb = new SQL.Database();
  }

  const db = wrapSqlJsDatabase(rawDb, dbPath);
  db.pragma('foreign_keys = ON');
  try {
    db.pragma('journal_mode = WAL');
  } catch (_error) {
    // Some SQLite environments reject WAL for in-memory or readonly contexts.
  }
  return db;
}

async function createStateStore(options = {}) {
  const dbPath = resolveStateStorePath(options);
  const SQL = await initSqlJs();
  const db = await openDatabase(SQL, dbPath);
  const appliedMigrations = applyMigrations(db);
  const queryApi = createQueryApi(db);

  return {
    dbPath,
    close() {
      db.close();
    },
    getAppliedMigrations() {
      return getAppliedMigrations(db);
    },
    validateEntity,
    assertValidEntity,
    ...queryApi,
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
