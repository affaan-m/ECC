pub mod cli;
mod collision;
mod manifest;
mod model;
mod report;
mod scheduler;
mod store;

use anyhow::{Context, Result};
use std::path::{Path, PathBuf};
use std::process::Command;

use crate::session::store::StateStore;

use self::collision::declared_collisions;
use self::manifest::parse_manifest_path;
use self::model::{FleetBlocker, FleetBlockerKind, FleetPlan, FleetRecord, FleetStatusReport};
use self::scheduler::build_schedule;
use self::store::FleetStore;

pub fn plan(manifest_path: &Path) -> Result<FleetPlan> {
    let parsed = parse_manifest_path(manifest_path)?;
    let schedule = build_schedule(&parsed.manifest)?;
    let collisions = declared_collisions(&parsed.manifest)?;
    Ok(FleetPlan {
        experimental: true,
        manifest: parsed.manifest,
        manifest_digest: parsed.digest,
        schedule,
        collisions,
    })
}

pub fn create(db: &StateStore, manifest_path: &Path) -> Result<FleetRecord> {
    let parsed = parse_manifest_path(manifest_path)?;
    build_schedule(&parsed.manifest)?;
    let mut blockers = declared_collisions(&parsed.manifest)?
        .into_iter()
        .map(|collision| FleetBlocker {
            kind: FleetBlockerKind::Collision,
            code: collision.kind,
            entity_ids: vec![collision.left_feature, collision.right_feature],
            summary: collision.detail,
            required_resolution_action: collision.required_action,
        })
        .collect::<Vec<_>>();
    let (repo_root, base_oid) = resolve_repository_base(&parsed.manifest.base_branch)?;
    if repository_has_uncommitted_changes(&repo_root)? {
        blockers.push(FleetBlocker {
            kind: FleetBlockerKind::Git,
            code: "repository_dirty".to_string(),
            entity_ids: Vec::new(),
            summary: "Repository has uncommitted, untracked, or dirty-submodule changes that are not included in the pinned base OID".to_string(),
            required_resolution_action:
                "commit_or_stash_changes_then_create_a_new_fleet_revision_before_launch"
                    .to_string(),
        });
    }
    let repo_root = repo_root
        .to_str()
        .context("Feature Fleet repository root must be valid UTF-8")?;
    FleetStore::new(db.connection()).create(&parsed, repo_root, &base_oid, &blockers)
}

fn repository_has_uncommitted_changes(repo_root: &Path) -> Result<bool> {
    Ok(!git_stdout(
        repo_root,
        &[
            "status",
            "--porcelain=v1",
            "--untracked-files=all",
            "--ignore-submodules=none",
        ],
    )?
    .is_empty())
}

pub fn status(db: &StateStore, fleet_id: &str) -> Result<FleetStatusReport> {
    let store = FleetStore::new(db.connection());
    let fleet = store
        .get(fleet_id)?
        .with_context(|| format!("Feature Fleet not found: {fleet_id}"))?;
    let events = store.events(fleet_id)?;
    Ok(FleetStatusReport {
        experimental: true,
        fleet,
        events,
    })
}

fn resolve_repository_base(base_branch: &str) -> Result<(PathBuf, String)> {
    let working_directory =
        std::env::current_dir().context("Failed to resolve current working directory")?;
    let repo_root = git_stdout(&working_directory, &["rev-parse", "--show-toplevel"])
        .context("Feature Fleet create must run inside a Git repository")?;
    let repo_root = PathBuf::from(repo_root)
        .canonicalize()
        .context("Failed to canonicalize repository root")?;
    let commit_ref = format!("{base_branch}^{{commit}}");
    let base_oid = git_stdout(
        &repo_root,
        &["rev-parse", "--verify", "--end-of-options", &commit_ref],
    )
    .with_context(|| format!("Failed to resolve fleet base branch {base_branch}"))?;
    if !matches!(base_oid.len(), 40 | 64)
        || !base_oid
            .chars()
            .all(|character| character.is_ascii_hexdigit())
    {
        anyhow::bail!("Git returned an invalid full object ID for {base_branch}");
    }
    Ok((repo_root, base_oid))
}

fn git_stdout(working_directory: &Path, args: &[&str]) -> Result<String> {
    let mut command = Command::new("git");
    command.current_dir(working_directory).args(args);
    for variable in [
        "GIT_DIR",
        "GIT_WORK_TREE",
        "GIT_INDEX_FILE",
        "GIT_COMMON_DIR",
        "GIT_PREFIX",
    ] {
        command.env_remove(variable);
    }
    let output = command.output().context("Failed to execute git")?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        anyhow::bail!(
            "git {} failed{}",
            args.join(" "),
            if stderr.is_empty() {
                String::new()
            } else {
                format!(": {stderr}")
            }
        );
    }
    String::from_utf8(output.stdout)
        .context("git output was not UTF-8")
        .map(|value| value.trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::{create, git_stdout, status};
    use crate::feature_fleet::manifest::tests::valid_manifest;
    use crate::session::store::StateStore;
    use crate::test_support::CurrentDirGuard;
    use anyhow::Result;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::process::Command;

    struct TestDir(PathBuf);

    impl TestDir {
        fn new() -> Result<Self> {
            let path =
                std::env::temp_dir().join(format!("ecc2-feature-fleet-{}", uuid::Uuid::new_v4()));
            fs::create_dir_all(&path)?;
            Ok(Self(path))
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn create_pins_the_resolved_base_oid() -> Result<()> {
        let test_dir = TestDir::new()?;
        git(test_dir.path(), &["init", "-b", "main"])?;
        fs::write(test_dir.path().join("README.md"), "first\n")?;
        git(test_dir.path(), &["add", "README.md"])?;
        git(
            test_dir.path(),
            &[
                "-c",
                "user.name=ECC Test",
                "-c",
                "user.email=ecc@example.invalid",
                "commit",
                "-m",
                "first",
            ],
        )?;
        let expected_oid = git_stdout(test_dir.path(), &["rev-parse", "main"])?;
        let manifest_path = test_dir.path().join("fleet.toml");
        fs::write(&manifest_path, valid_manifest())?;
        let db = StateStore::open(&test_dir.path().join("state.db"))?;
        let _current_dir = CurrentDirGuard::enter(test_dir.path())?;

        let created = create(&db, &manifest_path)?;
        assert_eq!(created.base_oid, expected_oid);
        assert!(created.blockers.iter().any(|blocker| {
            blocker.kind == crate::feature_fleet::model::FleetBlockerKind::Git
                && blocker.code == "repository_dirty"
                && blocker.required_resolution_action
                    == "commit_or_stash_changes_then_create_a_new_fleet_revision_before_launch"
        }));

        fs::write(test_dir.path().join("README.md"), "second\n")?;
        git(test_dir.path(), &["add", "README.md"])?;
        git(
            test_dir.path(),
            &[
                "-c",
                "user.name=ECC Test",
                "-c",
                "user.email=ecc@example.invalid",
                "commit",
                "-m",
                "second",
            ],
        )?;

        let current_oid = git_stdout(test_dir.path(), &["rev-parse", "main"])?;
        assert_ne!(created.base_oid, current_oid);
        assert_eq!(status(&db, "onboarding-v2")?.fleet.base_oid, expected_oid);
        Ok(())
    }

    #[test]
    fn create_has_no_git_blocker_for_a_clean_repository() -> Result<()> {
        let test_dir = TestDir::new()?;
        let repo = test_dir.path().join("repo");
        fs::create_dir(&repo)?;
        git(&repo, &["init", "-b", "main"])?;
        fs::write(repo.join("README.md"), "first\n")?;
        git(&repo, &["add", "README.md"])?;
        git(
            &repo,
            &[
                "-c",
                "user.name=ECC Test",
                "-c",
                "user.email=ecc@example.invalid",
                "commit",
                "-m",
                "first",
            ],
        )?;
        let manifest_path = test_dir.path().join("fleet.toml");
        fs::write(&manifest_path, valid_manifest())?;
        let db = StateStore::open(&test_dir.path().join("state.db"))?;
        let _current_dir = CurrentDirGuard::enter(&repo)?;

        let created = create(&db, &manifest_path)?;

        assert!(!created
            .blockers
            .iter()
            .any(|blocker| blocker.code == "repository_dirty"));
        Ok(())
    }

    fn git(working_directory: &Path, args: &[&str]) -> Result<()> {
        let output = Command::new("git")
            .current_dir(working_directory)
            .args(args)
            .output()?;
        if !output.status.success() {
            anyhow::bail!(
                "git {} failed: {}",
                args.join(" "),
                String::from_utf8_lossy(&output.stderr).trim()
            );
        }
        Ok(())
    }
}
