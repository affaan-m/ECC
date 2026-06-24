'use strict';

/**
 * Postgres client wrapper.
 * Uses the `pg` package. Set DATABASE_URL in environment.
 * All queries go through parameterized statements — no string interpolation.
 */

let pool = null;

function getPool() {
  if (!pool) {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL environment variable is required');
    }
    // Lazy require so tests that don't touch DB don't need pg installed
    const { Pool } = require('pg'); // eslint-disable-line global-require
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
    });

    pool.on('error', (err) => {
      process.stderr.write(`[DB] Unexpected pool error: ${err.message}\n`);
    });
  }
  return pool;
}

/**
 * Execute a parameterized query.
 * @param {string} text - SQL with $1, $2 placeholders
 * @param {Array} params - Query parameters
 */
async function query(text, params = []) {
  const client = getPool();
  const start = Date.now();
  const result = await client.query(text, params);
  const duration = Date.now() - start;
  if (duration > 1000) {
    process.stderr.write(`[DB] Slow query (${duration}ms): ${text.slice(0, 100)}\n`);
  }
  return result;
}

/**
 * Run multiple queries in a single transaction.
 * @param {Function} fn - async (client) => result
 */
async function transaction(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function close() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

module.exports = { query, transaction, close };
