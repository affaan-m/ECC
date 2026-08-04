use anyhow::{Context, Result};
use rusqlite::{Connection, OptionalExtension};
use std::path::Path;

use super::model::{
    FleetBlocker, FleetEvent, FleetFeatureRecord, FleetLifecycleState, FleetRecord, ParsedManifest,
    VerificationCheck,
};

pub struct FleetStore<'connection> {
    connection: &'connection Connection,
}

impl<'connection> FleetStore<'connection> {
    pub fn new(connection: &'connection Connection) -> Self {
        Self { connection }
    }

    pub fn create(
        &self,
        parsed: &ParsedManifest,
        repo_root: &str,
        base_oid: &str,
        blockers: &[FleetBlocker],
    ) -> Result<FleetRecord> {
        validate_create_identity(repo_root, base_oid)?;
        self.connection
            .execute_batch("BEGIN IMMEDIATE")
            .context("begin Feature Fleet create transaction")?;
        let result = self.create_in_transaction(parsed, repo_root, base_oid, blockers);
        match result {
            Ok(record) => {
                if let Err(error) = self.connection.execute_batch("COMMIT") {
                    let _ = self.connection.execute_batch("ROLLBACK");
                    Err(error).context("commit Feature Fleet create transaction")
                } else {
                    Ok(record)
                }
            }
            Err(error) => {
                let _ = self.connection.execute_batch("ROLLBACK");
                Err(error)
            }
        }
    }

    pub fn get(&self, fleet_id: &str) -> Result<Option<FleetRecord>> {
        let fleet = self
            .connection
            .query_row(
                "SELECT id, title, repo_root, base_branch, base_oid, manifest_digest,
                        revision, lifecycle_state, blockers_json, created_at, updated_at
                 FROM feature_fleets
                 WHERE id = ?1",
                [fleet_id],
                |row| {
                    Ok(FleetRecord {
                        id: row.get(0)?,
                        title: row.get(1)?,
                        repo_root: row.get(2)?,
                        base_branch: row.get(3)?,
                        base_oid: row.get(4)?,
                        manifest_digest: row.get(5)?,
                        revision: row.get(6)?,
                        lifecycle_state: lifecycle_column(row.get(7)?)?,
                        blockers: json_column(&row.get::<_, String>(8)?)?,
                        features: Vec::new(),
                        created_at: row.get(9)?,
                        updated_at: row.get(10)?,
                    })
                },
            )
            .optional()?;

        fleet
            .map(|record| {
                let features = self.features(&record.id)?;
                Ok(FleetRecord { features, ..record })
            })
            .transpose()
    }

    pub fn events(&self, fleet_id: &str) -> Result<Vec<FleetEvent>> {
        let mut statement = self.connection.prepare(
            "SELECT id, fleet_id, fleet_revision, event_kind, entity_kind,
                    entity_id, payload_json, created_at
             FROM fleet_events
             WHERE fleet_id = ?1
             ORDER BY id",
        )?;
        let events = statement
            .query_map([fleet_id], |row| {
                let payload_json: String = row.get(6)?;
                let payload = serde_json::from_str(&payload_json).map_err(|error| {
                    rusqlite::Error::FromSqlConversionFailure(
                        payload_json.len(),
                        rusqlite::types::Type::Text,
                        Box::new(error),
                    )
                })?;
                Ok(FleetEvent {
                    id: row.get(0)?,
                    fleet_id: row.get(1)?,
                    fleet_revision: row.get(2)?,
                    event_kind: row.get(3)?,
                    entity_kind: row.get(4)?,
                    entity_id: row.get(5)?,
                    payload,
                    created_at: row.get(7)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(events)
    }

    fn create_in_transaction(
        &self,
        parsed: &ParsedManifest,
        repo_root: &str,
        base_oid: &str,
        blockers: &[FleetBlocker],
    ) -> Result<FleetRecord> {
        if let Some(existing) = self.get(&parsed.manifest.id)? {
            if existing.manifest_digest == parsed.digest
                && existing.repo_root == repo_root
                && existing.base_oid == base_oid
                && existing.base_branch == parsed.manifest.base_branch
            {
                return Ok(existing);
            }
            anyhow::bail!(
                "Fleet {} already exists with a different manifest, repository, or base",
                parsed.manifest.id
            );
        }

        let now = chrono::Utc::now().to_rfc3339();
        let manifest_json =
            serde_json::to_string(&parsed.manifest).context("serialize fleet manifest")?;
        let blockers_json = serde_json::to_string(blockers).context("serialize fleet blockers")?;
        self.connection.execute(
            "INSERT INTO feature_fleets(
                id, schema_version, title, repo_root, base_branch, base_oid,
                manifest_digest, manifest_json, revision, lifecycle_state, blockers_json,
                created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 1, 'planned', ?9, ?10, ?10)",
            rusqlite::params![
                parsed.manifest.id,
                parsed.manifest.schema,
                parsed.manifest.title,
                repo_root,
                parsed.manifest.base_branch,
                base_oid,
                parsed.digest,
                manifest_json,
                blockers_json,
                now
            ],
        )?;

        for feature in &parsed.manifest.features {
            self.connection.execute(
                "INSERT INTO fleet_features(
                    fleet_id, feature_id, title, task, dependencies_json, owns_json,
                    contracts_json, checks_json, lifecycle_state, blockers_json,
                    created_at, updated_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'planned', '[]', ?9, ?9)",
                rusqlite::params![
                    parsed.manifest.id,
                    feature.id,
                    feature.title,
                    feature.task,
                    serde_json::to_string(&feature.depends_on)?,
                    serde_json::to_string(&feature.owns)?,
                    serde_json::to_string(&feature.contracts)?,
                    serde_json::to_string(&feature.checks)?,
                    now
                ],
            )?;
        }

        let event_payload = serde_json::json!({
            "base_branch": parsed.manifest.base_branch,
            "base_oid": base_oid,
            "manifest_digest": parsed.digest,
            "feature_count": parsed.manifest.features.len(),
            "blocker_count": blockers.len(),
        });
        self.connection.execute(
            "INSERT INTO fleet_events(
                fleet_id, fleet_revision, event_kind, entity_kind, entity_id,
                payload_json, created_at
             ) VALUES (?1, 1, 'fleet.created', 'fleet', ?1, ?2, ?3)",
            rusqlite::params![
                parsed.manifest.id,
                serde_json::to_string(&event_payload)?,
                now
            ],
        )?;

        self.get(&parsed.manifest.id)?
            .context("created fleet was not readable")
    }

    fn features(&self, fleet_id: &str) -> Result<Vec<FleetFeatureRecord>> {
        let mut statement = self.connection.prepare(
            "SELECT feature_id, title, task, dependencies_json, owns_json,
                    contracts_json, checks_json, lifecycle_state, blockers_json
             FROM fleet_features
             WHERE fleet_id = ?1
             ORDER BY feature_id",
        )?;
        let features = statement
            .query_map([fleet_id], |row| {
                let dependencies_json: String = row.get(3)?;
                let owns_json: String = row.get(4)?;
                let contracts_json: String = row.get(5)?;
                let checks_json: String = row.get(6)?;
                Ok(FleetFeatureRecord {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    task: row.get(2)?,
                    depends_on: json_column(&dependencies_json)?,
                    owns: json_column(&owns_json)?,
                    contracts: json_column(&contracts_json)?,
                    checks: json_column::<Vec<VerificationCheck>>(&checks_json)?,
                    lifecycle_state: lifecycle_column(row.get(7)?)?,
                    blockers: json_column(&row.get::<_, String>(8)?)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(features)
    }
}

fn lifecycle_column(value: String) -> rusqlite::Result<FleetLifecycleState> {
    value.parse().map_err(|error: anyhow::Error| {
        rusqlite::Error::FromSqlConversionFailure(
            value.len(),
            rusqlite::types::Type::Text,
            Box::new(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                error.to_string(),
            )),
        )
    })
}

fn json_column<T>(value: &str) -> rusqlite::Result<T>
where
    T: serde::de::DeserializeOwned,
{
    serde_json::from_str(value).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(
            value.len(),
            rusqlite::types::Type::Text,
            Box::new(error),
        )
    })
}

fn validate_create_identity(repo_root: &str, base_oid: &str) -> Result<()> {
    if !Path::new(repo_root).is_absolute() {
        anyhow::bail!("Fleet repository root must be absolute: {repo_root}");
    }
    if !matches!(base_oid.len(), 40 | 64)
        || !base_oid
            .chars()
            .all(|character| character.is_ascii_hexdigit())
    {
        anyhow::bail!("Fleet base OID must be a full 40- or 64-character object ID");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::FleetStore;
    use crate::feature_fleet::manifest::parse_manifest_text;
    use crate::feature_fleet::manifest::tests::valid_manifest;
    use crate::feature_fleet::model::{FleetBlocker, FleetBlockerKind};
    use crate::session::migrations::run_all;
    use rusqlite::Connection;

    #[test]
    fn creates_and_loads_fleet_with_event_atomically() {
        let connection = Connection::open_in_memory().expect("database");
        run_all(&connection, || Ok(())).expect("migrations");
        let store = FleetStore::new(&connection);
        let manifest = parse_manifest_text(valid_manifest(), "toml").expect("manifest");
        let blockers = vec![FleetBlocker {
            kind: FleetBlockerKind::Collision,
            code: "path_overlap".to_string(),
            entity_ids: vec!["auth-api".to_string(), "onboarding-ui".to_string()],
            summary: "declared paths overlap".to_string(),
            required_resolution_action: "serialize_or_revise_ownership".to_string(),
        }];

        let created = store
            .create(
                &manifest,
                "/repo",
                "1111111111111111111111111111111111111111",
                &blockers,
            )
            .expect("create fleet");
        let loaded = store
            .get("onboarding-v2")
            .expect("load fleet")
            .expect("fleet exists");

        assert_eq!(created.id, "onboarding-v2");
        assert_eq!(loaded.manifest_digest, manifest.digest);
        assert_eq!(loaded.features.len(), 2);
        assert_eq!(loaded.blockers, blockers);
        assert_eq!(
            loaded.lifecycle_state,
            crate::feature_fleet::model::FleetLifecycleState::Planned
        );
        assert_eq!(store.events("onboarding-v2").expect("events").len(), 1);
    }

    #[test]
    fn duplicate_create_is_idempotent_only_for_same_identity() {
        let connection = Connection::open_in_memory().expect("database");
        run_all(&connection, || Ok(())).expect("migrations");
        let store = FleetStore::new(&connection);
        let manifest = parse_manifest_text(valid_manifest(), "toml").expect("manifest");

        let first = store
            .create(
                &manifest,
                "/repo",
                "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                &[],
            )
            .expect("first create");
        let repeated = store
            .create(
                &manifest,
                "/repo",
                "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                &[],
            )
            .expect("idempotent create");
        assert_eq!(first, repeated);

        let error = store
            .create(
                &manifest,
                "/repo",
                "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                &[],
            )
            .expect_err("different base rejected");
        assert!(error.to_string().contains("already exists"));
    }
}
