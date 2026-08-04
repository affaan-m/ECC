use anyhow::{Context, Result};
use rusqlite::Connection;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

pub const LATEST_SCHEMA_VERSION: i64 = 2;

const BASELINE_PAYLOAD: &str = "ecc-state-store-legacy-baseline-v1";
const FLEET_SCHEMA_SQL: &str = r#"
CREATE TABLE feature_fleets (
    id TEXT PRIMARY KEY,
    schema_version TEXT NOT NULL,
    title TEXT NOT NULL,
    repo_root TEXT NOT NULL,
    base_branch TEXT NOT NULL,
    base_oid TEXT NOT NULL,
    manifest_digest TEXT NOT NULL,
    manifest_json TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0),
    lifecycle_state TEXT NOT NULL DEFAULT 'planned'
        CHECK(lifecycle_state IN ('planned', 'running', 'reviewing', 'integrating', 'completed', 'failed')),
    blockers_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE fleet_features (
    fleet_id TEXT NOT NULL REFERENCES feature_fleets(id) ON DELETE CASCADE,
    feature_id TEXT NOT NULL,
    title TEXT NOT NULL,
    task TEXT NOT NULL,
    dependencies_json TEXT NOT NULL DEFAULT '[]',
    owns_json TEXT NOT NULL DEFAULT '[]',
    contracts_json TEXT NOT NULL DEFAULT '[]',
    checks_json TEXT NOT NULL DEFAULT '[]',
    lifecycle_state TEXT NOT NULL DEFAULT 'planned'
        CHECK(lifecycle_state IN ('planned', 'running', 'reviewing', 'integrating', 'completed', 'failed')),
    blockers_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (fleet_id, feature_id)
);

CREATE TABLE fleet_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fleet_id TEXT NOT NULL REFERENCES feature_fleets(id) ON DELETE CASCADE,
    fleet_revision INTEGER NOT NULL,
    event_kind TEXT NOT NULL,
    entity_kind TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    payload_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
);

CREATE INDEX idx_fleet_features_state
    ON fleet_features(fleet_id, lifecycle_state, feature_id);
CREATE INDEX idx_fleet_events_revision
    ON fleet_events(fleet_id, fleet_revision, id);
"#;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct AppliedMigration {
    pub version: i64,
    pub name: String,
    pub checksum: String,
    pub applied_at: String,
}

#[derive(Debug, Clone, Copy)]
struct MigrationSpec {
    version: i64,
    name: &'static str,
    payload: &'static str,
}

const MIGRATIONS: [MigrationSpec; 2] = [
    MigrationSpec {
        version: 1,
        name: "legacy_schema_baseline",
        payload: BASELINE_PAYLOAD,
    },
    MigrationSpec {
        version: 2,
        name: "feature_fleet_planning_v1",
        payload: FLEET_SCHEMA_SQL,
    },
];

// Applied migrations are immutable: never rewrite a name or payload after merge.
// Schema changes must append the next contiguous version.
pub fn run_all<F>(connection: &Connection, apply_legacy_baseline: F) -> Result<()>
where
    F: FnOnce() -> Result<()>,
{
    bootstrap(connection)?;
    connection
        .execute_batch("BEGIN IMMEDIATE")
        .context("begin schema migration transaction")?;

    let result = apply_pending(connection, apply_legacy_baseline).and_then(|_| {
        connection
            .execute_batch("COMMIT")
            .context("commit schema migration transaction")
    });
    if let Err(error) = result {
        let _ = connection.execute_batch("ROLLBACK");
        anyhow::bail!("schema migration failed: {error:#}");
    }
    Ok(())
}

pub fn applied_migrations(connection: &Connection) -> Result<Vec<AppliedMigration>> {
    bootstrap(connection)?;
    let mut statement = connection.prepare(
        "SELECT version, name, checksum, applied_at
         FROM schema_migrations
         ORDER BY version",
    )?;
    let migrations = statement
        .query_map([], |row| {
            Ok(AppliedMigration {
                version: row.get(0)?,
                name: row.get(1)?,
                checksum: row.get(2)?,
                applied_at: row.get(3)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(migrations)
}

fn bootstrap(connection: &Connection) -> Result<()> {
    connection.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            checksum TEXT NOT NULL,
            applied_at TEXT NOT NULL
        );",
    )?;
    Ok(())
}

fn applied_by_version(connection: &Connection) -> Result<BTreeMap<i64, AppliedMigration>> {
    Ok(applied_migrations(connection)?
        .into_iter()
        .map(|migration| (migration.version, migration))
        .collect())
}

fn validate_existing(existing: &BTreeMap<i64, AppliedMigration>) -> Result<()> {
    if let Some(version) = existing.keys().next_back() {
        if *version > LATEST_SCHEMA_VERSION {
            anyhow::bail!(
                "Database schema version {version} is newer than supported version {LATEST_SCHEMA_VERSION}"
            );
        }
    }

    for version in existing.keys() {
        if !MIGRATIONS
            .iter()
            .any(|migration| migration.version == *version)
        {
            anyhow::bail!("Unknown database migration version {version}");
        }
    }
    for (index, version) in existing.keys().enumerate() {
        let expected = index as i64 + 1;
        if *version != expected {
            anyhow::bail!(
                "Database migration history is not contiguous: expected version {expected}, found {version}"
            );
        }
    }

    for migration in MIGRATIONS {
        let Some(applied) = existing.get(&migration.version) else {
            continue;
        };
        let expected_checksum = migration_checksum(migration);
        if applied.name != migration.name || applied.checksum != expected_checksum {
            anyhow::bail!(
                "Migration {} checksum or name mismatch; database may be modified",
                migration.version
            );
        }
    }
    Ok(())
}

fn apply_pending<F>(connection: &Connection, apply_legacy_baseline: F) -> Result<()>
where
    F: FnOnce() -> Result<()>,
{
    let existing = applied_by_version(connection)?;
    validate_existing(&existing)?;
    let mut legacy = Some(apply_legacy_baseline);

    for migration in MIGRATIONS {
        if existing.contains_key(&migration.version) {
            continue;
        }
        if migration.version == 1 {
            legacy
                .take()
                .context("legacy baseline migration callback unavailable")?()
            .with_context(|| format!("apply migration {}", migration.name))?;
        } else {
            connection
                .execute_batch(migration.payload)
                .with_context(|| format!("apply migration {}", migration.name))?;
        }
        connection
            .execute(
                "INSERT INTO schema_migrations(version, name, checksum, applied_at)
                 VALUES (?1, ?2, ?3, ?4)",
                rusqlite::params![
                    migration.version,
                    migration.name,
                    migration_checksum(migration),
                    chrono::Utc::now().to_rfc3339()
                ],
            )
            .with_context(|| format!("record migration {}", migration.version))?;
    }
    Ok(())
}

fn migration_checksum(migration: MigrationSpec) -> String {
    let content = format!(
        "{}\n{}\n{}",
        migration.version, migration.name, migration.payload
    );
    Sha256::digest(content.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{
        applied_migrations, migration_checksum, run_all, LATEST_SCHEMA_VERSION, MIGRATIONS,
    };
    use rusqlite::Connection;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Arc, Barrier};
    use std::time::Duration;

    #[test]
    fn migrations_are_numbered_and_idempotent() {
        let connection = Connection::open_in_memory().expect("database");
        run_all(&connection, || Ok(())).expect("first migration pass");
        run_all(&connection, || panic!("applied migration must not rerun"))
            .expect("second migration pass");

        let applied = applied_migrations(&connection).expect("applied migrations");
        assert_eq!(
            applied
                .iter()
                .map(|entry| entry.version)
                .collect::<Vec<_>>(),
            (1..=LATEST_SCHEMA_VERSION).collect::<Vec<_>>()
        );
    }

    #[test]
    fn simultaneous_processes_apply_the_baseline_once() {
        let db_path =
            std::env::temp_dir().join(format!("ecc2-migration-race-{}.db", uuid::Uuid::new_v4()));
        let barrier = Arc::new(Barrier::new(2));
        let baseline_runs = Arc::new(AtomicUsize::new(0));
        let handles = (0..2)
            .map(|_| {
                let db_path = db_path.clone();
                let barrier = Arc::clone(&barrier);
                let baseline_runs = Arc::clone(&baseline_runs);
                std::thread::spawn(move || -> anyhow::Result<()> {
                    let connection = Connection::open(db_path)?;
                    connection.busy_timeout(Duration::from_secs(5))?;
                    barrier.wait();
                    run_all(&connection, || {
                        baseline_runs.fetch_add(1, Ordering::SeqCst);
                        connection
                            .execute("CREATE TABLE IF NOT EXISTS legacy_marker(id INTEGER)", [])?;
                        Ok(())
                    })
                })
            })
            .collect::<Vec<_>>();

        for handle in handles {
            handle
                .join()
                .expect("migration thread should not panic")
                .expect("migration process should succeed");
        }
        assert_eq!(baseline_runs.load(Ordering::SeqCst), 1);

        let connection = Connection::open(&db_path).expect("database");
        assert_eq!(
            applied_migrations(&connection).expect("migrations").len(),
            LATEST_SCHEMA_VERSION as usize
        );
        drop(connection);
        let _ = std::fs::remove_file(db_path);
    }

    #[test]
    fn rejects_checksum_mismatch_and_newer_database() {
        let connection = Connection::open_in_memory().expect("database");
        run_all(&connection, || Ok(())).expect("migrations");
        connection
            .execute(
                "UPDATE schema_migrations SET checksum = 'tampered' WHERE version = 1",
                [],
            )
            .expect("tamper checksum");
        let error = run_all(&connection, || Ok(())).expect_err("checksum mismatch");
        assert!(error.to_string().contains("checksum"));

        let newer = Connection::open_in_memory().expect("database");
        run_all(&newer, || Ok(())).expect("migrations");
        newer
            .execute(
                "INSERT INTO schema_migrations(version, name, checksum, applied_at)
                 VALUES (?1, 'future', 'future', '2026-01-01T00:00:00Z')",
                [LATEST_SCHEMA_VERSION + 1],
            )
            .expect("future migration");
        let error = run_all(&newer, || Ok(())).expect_err("newer database rejected");
        assert!(error.to_string().contains("newer"));
    }

    #[test]
    fn rejects_unknown_historical_migration() {
        let connection = Connection::open_in_memory().expect("database");
        connection
            .execute_batch(
                "CREATE TABLE schema_migrations (
                    version INTEGER PRIMARY KEY,
                    name TEXT NOT NULL,
                    checksum TEXT NOT NULL,
                    applied_at TEXT NOT NULL
                );
                INSERT INTO schema_migrations(version, name, checksum, applied_at)
                VALUES (0, 'unknown', 'unknown', '2026-01-01T00:00:00Z');",
            )
            .expect("unknown migration");

        let error = run_all(&connection, || Ok(())).expect_err("unknown migration rejected");
        assert!(error.to_string().contains("Unknown database migration"));
    }

    #[test]
    fn rejects_a_gap_in_migration_history() {
        let connection = Connection::open_in_memory().expect("database");
        let migration = MIGRATIONS[1];
        connection
            .execute_batch(
                "CREATE TABLE schema_migrations (
                    version INTEGER PRIMARY KEY,
                    name TEXT NOT NULL,
                    checksum TEXT NOT NULL,
                    applied_at TEXT NOT NULL
                );",
            )
            .expect("migration table");
        connection
            .execute(
                "INSERT INTO schema_migrations(version, name, checksum, applied_at)
                 VALUES (?1, ?2, ?3, '2026-01-01T00:00:00Z')",
                rusqlite::params![
                    migration.version,
                    migration.name,
                    migration_checksum(migration)
                ],
            )
            .expect("out-of-order migration");

        let error = run_all(&connection, || Ok(())).expect_err("migration gap rejected");
        assert!(error.to_string().contains("not contiguous"));
    }

    #[test]
    fn failed_migration_rolls_back_schema_and_version_record() {
        let connection = Connection::open_in_memory().expect("database");
        let error = run_all(&connection, || {
            connection.execute("CREATE TABLE should_rollback(id INTEGER)", [])?;
            anyhow::bail!("injected migration failure")
        })
        .expect_err("migration should fail");

        assert!(error.to_string().contains("injected migration failure"));
        let table_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'should_rollback'",
                [],
                |row| row.get(0),
            )
            .expect("table lookup");
        assert_eq!(table_count, 0);
    }

    #[test]
    fn database_keeps_blockers_orthogonal_to_lifecycle() {
        let connection = Connection::open_in_memory().expect("database");
        run_all(&connection, || Ok(())).expect("migrations");

        let error = connection
            .execute(
                "INSERT INTO feature_fleets(
                    id, schema_version, title, repo_root, base_branch, base_oid,
                    manifest_digest, manifest_json, lifecycle_state, created_at, updated_at
                 ) VALUES (
                    'fleet', 'ecc.feature-fleet.v1', 'Fleet', '/repo', 'main',
                    '1111111111111111111111111111111111111111', 'digest', '{}',
                    'blocked', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
                 )",
                [],
            )
            .expect_err("blocked is not a lifecycle state");
        assert!(error.to_string().contains("CHECK constraint failed"));
    }
}
