use anyhow::Result;
use std::future::Future;
use std::time::Duration;
use tokio::time;

use super::manager;
use super::store::StateStore;
use super::SessionState;
use crate::config::Config;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
struct DispatchPassSummary {
    routed: usize,
    deferred: usize,
    leads: usize,
}

/// Background daemon that monitors sessions, handles heartbeats,
/// and cleans up stale resources.
pub async fn run(db: StateStore, cfg: Config) -> Result<()> {
    tracing::info!("ECC daemon started");
    resume_crashed_sessions(&db)?;

    let heartbeat_interval = Duration::from_secs(cfg.heartbeat_interval_secs);
    loop {
        if let Err(e) = check_sessions(&db, &cfg) {
            tracing::error!("Session check failed: {e}");
        }

        if let Err(e) = maybe_run_due_schedules(&db, &cfg).await {
            tracing::error!("Scheduled task dispatch pass failed: {e}");
        }

        if let Err(e) = maybe_run_remote_dispatch(&db, &cfg).await {
            tracing::error!("Remote dispatch pass failed: {e}");
        }

        if let Err(e) = coordinate_backlog_cycle(&db, &cfg).await {
            tracing::error!("Backlog coordination pass failed: {e}");
        }

        if let Err(e) = maybe_auto_merge_ready_worktrees(&db, &cfg).await {
            tracing::error!("Worktree auto-merge pass failed: {e}");
        }

        if let Err(e) = maybe_auto_prune_inactive_worktrees(&db, &cfg).await {
            tracing::error!("Worktree auto-prune pass failed: {e}");
        }

        if let Err(e) = manager::activate_pending_worktree_sessions(&db, &cfg).await {
            tracing::error!("Queued worktree activation pass failed: {e}");
        }

        time::sleep(heartbeat_interval).await;
    }
}

pub fn resume_crashed_sessions(db: &StateStore) -> Result<()> {
    let failed_sessions = resume_crashed_sessions_with(db, |session| {
        let Some(pid) = session.pid else {
            return Ok(false);
        };
        #[cfg(windows)]
        {
            let creation = db.process_creation_time(&session.id, pid)?;
            Ok(super::windows_process::session_process_is_alive(
                pid, creation,
            ))
        }
        #[cfg(not(windows))]
        {
            Ok(pid_is_alive(pid))
        }
    })?;
    if failed_sessions > 0 {
        tracing::warn!("Marked {failed_sessions} crashed sessions as failed during daemon startup");
    }
    Ok(())
}

fn resume_crashed_sessions_with<F>(db: &StateStore, is_pid_alive: F) -> Result<usize>
where
    F: Fn(&super::Session) -> Result<bool>,
{
    let sessions = db.list_sessions()?;
    let mut failed_sessions = 0;

    for session in sessions {
        if session.state != SessionState::Running {
            continue;
        }

        let is_alive = session.pid.is_some() && is_pid_alive(&session)?;
        if is_alive {
            continue;
        }

        tracing::warn!(
            "Session {} was left running with stale pid {:?}; marking it failed",
            session.id,
            session.pid
        );
        db.update_state_and_pid(&session.id, &SessionState::Failed, None)?;
        failed_sessions += 1;
    }

    Ok(failed_sessions)
}

fn check_sessions(db: &StateStore, cfg: &Config) -> Result<()> {
    let _ = manager::enforce_session_heartbeats(db, cfg)?;
    Ok(())
}

async fn maybe_run_due_schedules(db: &StateStore, cfg: &Config) -> Result<usize> {
    let outcomes = manager::run_due_schedules(db, cfg, cfg.max_parallel_sessions).await?;
    if !outcomes.is_empty() {
        tracing::info!("Dispatched {} scheduled task(s)", outcomes.len());
    }
    Ok(outcomes.len())
}

async fn maybe_run_remote_dispatch(db: &StateStore, cfg: &Config) -> Result<usize> {
    let outcomes =
        manager::run_remote_dispatch_requests(db, cfg, cfg.max_parallel_sessions).await?;
    let routed = outcomes
        .iter()
        .filter(|outcome| {
            matches!(
                outcome.action,
                manager::RemoteDispatchAction::SpawnedTopLevel
                    | manager::RemoteDispatchAction::Assigned(_)
            )
        })
        .count();
    if routed > 0 {
        tracing::info!("Dispatched {} remote request(s)", routed);
    }
    Ok(routed)
}

async fn maybe_auto_dispatch(db: &StateStore, cfg: &Config) -> Result<usize> {
    let summary = maybe_auto_dispatch_with_recorder(
        cfg,
        || {
            manager::auto_dispatch_backlog(
                db,
                cfg,
                &cfg.default_agent,
                true,
                cfg.max_parallel_sessions,
            )
        },
        |routed, deferred, leads| db.record_daemon_dispatch_pass(routed, deferred, leads),
    )
    .await?;
    Ok(summary.routed)
}

async fn coordinate_backlog_cycle(db: &StateStore, cfg: &Config) -> Result<()> {
    let activity = db.daemon_activity()?;
    coordinate_backlog_cycle_with(
        cfg,
        &activity,
        || {
            maybe_auto_dispatch_with_recorder(
                cfg,
                || {
                    manager::auto_dispatch_backlog(
                        db,
                        cfg,
                        &cfg.default_agent,
                        true,
                        cfg.max_parallel_sessions,
                    )
                },
                |routed, deferred, leads| db.record_daemon_dispatch_pass(routed, deferred, leads),
            )
        },
        || {
            maybe_auto_rebalance_with_recorder(
                cfg,
                || {
                    manager::rebalance_all_teams(
                        db,
                        cfg,
                        &cfg.default_agent,
                        true,
                        cfg.max_parallel_sessions,
                    )
                },
                |rerouted, leads| db.record_daemon_rebalance_pass(rerouted, leads),
            )
        },
        |routed, leads| db.record_daemon_recovery_dispatch_pass(routed, leads),
    )
    .await?;
    Ok(())
}

async fn coordinate_backlog_cycle_with<DF, DFut, RF, RFut, Rec>(
    _cfg: &Config,
    prior_activity: &super::store::DaemonActivity,
    dispatch: DF,
    rebalance: RF,
    mut record_recovery: Rec,
) -> Result<(DispatchPassSummary, usize, DispatchPassSummary)>
where
    DF: Fn() -> DFut,
    DFut: Future<Output = Result<DispatchPassSummary>>,
    RF: Fn() -> RFut,
    RFut: Future<Output = Result<usize>>,
    Rec: FnMut(usize, usize) -> Result<()>,
{
    if prior_activity.prefers_rebalance_first() {
        let rebalanced = rebalance().await?;
        if prior_activity.dispatch_cooloff_active() && rebalanced == 0 {
            tracing::warn!(
                "Skipping immediate dispatch retry because chronic saturation cooloff is active"
            );
            return Ok((
                DispatchPassSummary::default(),
                rebalanced,
                DispatchPassSummary::default(),
            ));
        }
        let first_dispatch = dispatch().await?;
        if first_dispatch.routed > 0 {
            record_recovery(first_dispatch.routed, first_dispatch.leads)?;
            tracing::info!(
                "Recovered {} deferred task handoff(s) after rebalancing",
                first_dispatch.routed
            );
        }
        return Ok((first_dispatch, rebalanced, DispatchPassSummary::default()));
    }

    let first_dispatch = dispatch().await?;
    if prior_activity.stabilized_after_recovery_at().is_some() && first_dispatch.deferred == 0 {
        tracing::info!(
            "Skipping rebalance because stabilized dispatch cycle has no deferred handoffs"
        );
        return Ok((first_dispatch, 0, DispatchPassSummary::default()));
    }
    let rebalanced = rebalance().await?;
    let recovery_dispatch = if first_dispatch.deferred > 0 && rebalanced > 0 {
        let recovery = dispatch().await?;
        if recovery.routed > 0 {
            record_recovery(recovery.routed, recovery.leads)?;
            tracing::info!(
                "Recovered {} deferred task handoff(s) after rebalancing",
                recovery.routed
            );
        }
        recovery
    } else {
        DispatchPassSummary::default()
    };

    Ok((first_dispatch, rebalanced, recovery_dispatch))
}

async fn maybe_auto_dispatch_with<F, Fut>(cfg: &Config, dispatch: F) -> Result<usize>
where
    F: Fn() -> Fut,
    Fut: Future<Output = Result<Vec<manager::LeadDispatchOutcome>>>,
{
    Ok(
        maybe_auto_dispatch_with_recorder(cfg, dispatch, |_, _, _| Ok(()))
            .await?
            .routed,
    )
}

async fn maybe_auto_dispatch_with_recorder<F, Fut, R>(
    cfg: &Config,
    dispatch: F,
    mut record: R,
) -> Result<DispatchPassSummary>
where
    F: Fn() -> Fut,
    Fut: Future<Output = Result<Vec<manager::LeadDispatchOutcome>>>,
    R: FnMut(usize, usize, usize) -> Result<()>,
{
    if !cfg.auto_dispatch_unread_handoffs {
        return Ok(DispatchPassSummary::default());
    }

    let outcomes = dispatch().await?;
    let routed: usize = outcomes
        .iter()
        .map(|outcome| {
            outcome
                .routed
                .iter()
                .filter(|item| manager::assignment_action_routes_work(item.action))
                .count()
        })
        .sum();
    let deferred: usize = outcomes
        .iter()
        .map(|outcome| {
            outcome
                .routed
                .iter()
                .filter(|item| !manager::assignment_action_routes_work(item.action))
                .count()
        })
        .sum();
    let leads = outcomes.len();
    record(routed, deferred, leads)?;

    if routed > 0 {
        tracing::info!(
            "Auto-dispatched {routed} task handoff(s) across {} lead session(s)",
            leads
        );
    }
    if deferred > 0 {
        tracing::warn!("Deferred {deferred} task handoff(s) because delegate teams were saturated");
    }

    Ok(DispatchPassSummary {
        routed,
        deferred,
        leads,
    })
}

async fn maybe_auto_rebalance(db: &StateStore, cfg: &Config) -> Result<usize> {
    maybe_auto_rebalance_with_recorder(
        cfg,
        || {
            manager::rebalance_all_teams(
                db,
                cfg,
                &cfg.default_agent,
                true,
                cfg.max_parallel_sessions,
            )
        },
        |rerouted, leads| db.record_daemon_rebalance_pass(rerouted, leads),
    )
    .await
}

async fn maybe_auto_rebalance_with<F, Fut>(cfg: &Config, rebalance: F) -> Result<usize>
where
    F: Fn() -> Fut,
    Fut: Future<Output = Result<Vec<manager::LeadRebalanceOutcome>>>,
{
    maybe_auto_rebalance_with_recorder(cfg, rebalance, |_, _| Ok(())).await
}

async fn maybe_auto_rebalance_with_recorder<F, Fut, R>(
    cfg: &Config,
    rebalance: F,
    mut record: R,
) -> Result<usize>
where
    F: Fn() -> Fut,
    Fut: Future<Output = Result<Vec<manager::LeadRebalanceOutcome>>>,
    R: FnMut(usize, usize) -> Result<()>,
{
    if !cfg.auto_dispatch_unread_handoffs {
        return Ok(0);
    }

    let outcomes = rebalance().await?;
    let rerouted: usize = outcomes.iter().map(|outcome| outcome.rerouted.len()).sum();
    record(rerouted, outcomes.len())?;

    if rerouted > 0 {
        tracing::info!(
            "Auto-rebalanced {rerouted} task handoff(s) across {} lead session(s)",
            outcomes.len()
        );
    }

    Ok(rerouted)
}

async fn maybe_auto_merge_ready_worktrees(db: &StateStore, cfg: &Config) -> Result<usize> {
    maybe_auto_merge_ready_worktrees_with_recorder(
        cfg,
        || manager::merge_ready_worktrees(db, true),
        |merged, active, conflicted, dirty, failed| {
            db.record_daemon_auto_merge_pass(merged, active, conflicted, dirty, failed)
        },
    )
    .await
}

async fn maybe_auto_merge_ready_worktrees_with<F, Fut>(cfg: &Config, merge: F) -> Result<usize>
where
    F: Fn() -> Fut,
    Fut: Future<Output = Result<manager::WorktreeBulkMergeOutcome>>,
{
    maybe_auto_merge_ready_worktrees_with_recorder(cfg, merge, |_, _, _, _, _| Ok(())).await
}

async fn maybe_auto_merge_ready_worktrees_with_recorder<F, Fut, R>(
    cfg: &Config,
    merge: F,
    mut record: R,
) -> Result<usize>
where
    F: Fn() -> Fut,
    Fut: Future<Output = Result<manager::WorktreeBulkMergeOutcome>>,
    R: FnMut(usize, usize, usize, usize, usize) -> Result<()>,
{
    if !cfg.auto_merge_ready_worktrees {
        return Ok(0);
    }

    let outcome = merge().await?;
    let merged = outcome.merged.len();
    let active = outcome.active_with_worktree_ids.len();
    let conflicted = outcome.conflicted_session_ids.len();
    let dirty = outcome.dirty_worktree_ids.len();
    let failed = outcome.failures.len();
    record(merged, active, conflicted, dirty, failed)?;

    if merged > 0 {
        tracing::info!("Auto-merged {merged} ready worktree(s)");
    }
    if conflicted > 0 {
        tracing::warn!(
            "Skipped {} conflicted worktree(s) during auto-merge",
            conflicted
        );
    }
    if dirty > 0 {
        tracing::warn!("Skipped {} dirty worktree(s) during auto-merge", dirty);
    }
    if active > 0 {
        tracing::info!("Skipped {active} active worktree(s) during auto-merge");
    }
    if failed > 0 {
        tracing::warn!("Auto-merge failed for {failed} worktree(s)");
    }

    Ok(merged)
}

async fn maybe_auto_prune_inactive_worktrees(db: &StateStore, cfg: &Config) -> Result<usize> {
    maybe_auto_prune_inactive_worktrees_with_recorder(
        || manager::prune_inactive_worktrees(db, cfg),
        |pruned, active| db.record_daemon_auto_prune_pass(pruned, active),
    )
    .await
}

async fn maybe_auto_prune_inactive_worktrees_with<F, Fut>(prune: F) -> Result<usize>
where
    F: Fn() -> Fut,
    Fut: Future<Output = Result<manager::WorktreePruneOutcome>>,
{
    maybe_auto_prune_inactive_worktrees_with_recorder(prune, |_, _| Ok(())).await
}

async fn maybe_auto_prune_inactive_worktrees_with_recorder<F, Fut, R>(
    prune: F,
    mut record: R,
) -> Result<usize>
where
    F: Fn() -> Fut,
    Fut: Future<Output = Result<manager::WorktreePruneOutcome>>,
    R: FnMut(usize, usize) -> Result<()>,
{
    let outcome = prune().await?;
    let pruned = outcome.cleaned_session_ids.len();
    let active = outcome.active_with_worktree_ids.len();
    let retained = outcome.retained_session_ids.len();
    record(pruned, active)?;

    if pruned > 0 {
        tracing::info!("Auto-pruned {pruned} inactive worktree(s)");
    }
    if active > 0 {
        tracing::info!("Skipped {active} active worktree(s) during auto-prune");
    }
    if retained > 0 {
        tracing::info!("Deferred {retained} inactive worktree(s) within retention");
    }

    Ok(pruned)
}

#[cfg(unix)]
fn pid_is_alive(pid: u32) -> bool {
    if pid == 0 {
        return false;
    }

    // SAFETY: kill(pid, 0) probes process existence without delivering a signal.
    let result = unsafe { libc::kill(pid as libc::pid_t, 0) };
    if result == 0 {
        return true;
    }

    matches!(
        std::io::Error::last_os_error().raw_os_error(),
        Some(code) if code == libc::EPERM
    )
}

#[cfg(not(any(unix, windows)))]
fn pid_is_alive(_pid: u32) -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::session::manager::{
        AssignmentAction, InboxDrainOutcome, LeadDispatchOutcome, LeadRebalanceOutcome,
        RebalanceOutcome,
    };
    use crate::session::store::DaemonActivity;
    use crate::session::{Session, SessionMetrics, SessionState};
    use std::path::PathBuf;

    fn temp_db_path() -> PathBuf {
        std::env::temp_dir().join(format!("ecc2-daemon-test-{}.db", uuid::Uuid::new_v4()))
    }

    fn sample_session(id: &str, state: SessionState, pid: Option<u32>) -> Session {
        let now = chrono::Utc::now();
        Session {
            id: id.to_string(),
            task: "Recover crashed worker".to_string(),
            project: "workspace".to_string(),
            task_group: "general".to_string(),
            agent_type: "claude".to_string(),
            working_dir: PathBuf::from("/tmp"),
            state,
            pid,
            worktree: None,
            created_at: now,
            updated_at: now,
            last_heartbeat_at: now,
            metrics: SessionMetrics::default(),
        }
    }

    #[test]
    fn resume_crashed_sessions_marks_dead_running_sessions_failed() -> Result<()> {
        let path = temp_db_path();
        let store = StateStore::open(&path)?;
        store.insert_session(&sample_session(
            "deadbeef",
            SessionState::Running,
            Some(4242),
        ))?;

        resume_crashed_sessions_with(&store, |_| Ok(false))?;

        let session = store
            .get_session("deadbeef")?
            .expect("session should still exist");
        assert_eq!(session.state, SessionState::Failed);
        assert_eq!(session.pid, None);

        let _ = std::fs::remove_file(path);
        Ok(())
    }

    #[test]
    fn resume_crashed_sessions_keeps_live_running_sessions_running() -> Result<()> {
        let path = temp_db_path();
        let store = StateStore::open(&path)?;
        store.insert_session(&sample_session(
            "alive123",
            SessionState::Running,
            Some(7777),
        ))?;

        resume_crashed_sessions_with(&store, |_| Ok(true))?;

        let session = store
            .get_session("alive123")?
            .expect("session should still exist");
        assert_eq!(session.state, SessionState::Running);
        assert_eq!(session.pid, Some(7777));

        let _ = std::fs::remove_file(path);
        Ok(())
    }

    #[cfg(windows)]
    #[test]
    fn resume_crashed_sessions_preserves_current_windows_process() -> Result<()> {
        let path = temp_db_path();
        let store = StateStore::open(&path)?;
        let pid = std::process::id();
        store.insert_session(&sample_session(
            "live-windows",
            SessionState::Running,
            Some(pid),
        ))?;

        resume_crashed_sessions(&store)?;

        let session = store
            .get_session("live-windows")?
            .expect("live session must remain tracked");
        assert_eq!(session.state, SessionState::Running);
        assert_eq!(session.pid, Some(pid));
        drop(store);
        let _ = std::fs::remove_file(path);
        Ok(())
    }

    #[cfg(windows)]
    #[test]
    fn resume_crashed_sessions_rejects_reused_windows_identity() -> Result<()> {
        use std::os::windows::io::AsRawHandle;
        let mut child = std::process::Command::new("cmd")
            .args(["/C", "pause"])
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::null())
            .spawn()?;
        let path = temp_db_path();
        let result = (|| -> Result<()> {
            let creation = unsafe {
                super::super::windows_process::creation_time_from_handle(child.as_raw_handle())
            }?;
            let store = StateStore::open(&path)?;
            store.insert_session(&sample_session("reused", SessionState::Running, None))?;
            store.update_pid_with_creation_time("reused", Some(child.id()), Some(creation + 1))?;
            resume_crashed_sessions(&store)?;
            let session = store.get_session("reused")?.unwrap();
            assert_eq!(session.state, SessionState::Failed);
            assert_eq!(session.pid, None);
            Ok(())
        })();
        let _ = child.kill();
        let _ = child.wait();
        let _ = std::fs::remove_file(path);
        result
    }

    #[tokio::test]
    async fn maybe_auto_dispatch_noops_when_disabled() -> Result<()> {
        let path = temp_db_path();
        let _store = StateStore::open(&path)?;
        let cfg = Config::default();
        let invoked = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let invoked_flag = invoked.clone();

        let routed = maybe_auto_dispatch_with(&cfg, move || {
            let invoked_flag = invoked_flag.clone();
            async move {
                invoked_flag.store(true, std::sync::atomic::Ordering::SeqCst);
                Ok(Vec::new())
            }
        })
        .await?;

        assert_eq!(routed, 0);
        assert!(!invoked.load(std::sync::atomic::Ordering::SeqCst));
        let _ = std::fs::remove_file(path);
        Ok(())
    }

    #[tokio::test]
    async fn maybe_auto_dispatch_reports_total_routed_work() -> Result<()> {
        let path = temp_db_path();
        let _store = StateStore::open(&path)?;
        let mut cfg = Config::default();
        cfg.auto_dispatch_unread_handoffs = true;

        let routed = maybe_auto_dispatch_with(&cfg, || async move {
            Ok(vec![
                LeadDispatchOutcome {
                    lead_session_id: "lead-a".to_string(),
                    unread_count: 2,
                    routed: vec![
                        InboxDrainOutcome {
                            message_id: 1,
                            task: "Task A".to_string(),
                            session_id: "worker-a".to_string(),
                            action: AssignmentAction::Spawned,
                        },
                        InboxDrainOutcome {
                            message_id: 2,
                            task: "Task B".to_string(),
                            session_id: "worker-b".to_string(),
                            action: AssignmentAction::ReusedIdle,
                        },
                    ],
                },
                LeadDispatchOutcome {
                    lead_session_id: "lead-b".to_string(),
                    unread_count: 1,
                    routed: vec![InboxDrainOutcome {
                        message_id: 3,
                        task: "Task C".to_string(),
                        session_id: "worker-c".to_string(),
                        action: AssignmentAction::ReusedActive,
                    }],
                },
            ])
        })
        .await?;

        assert_eq!(routed, 3);
        let _ = std::fs::remove_file(path);
        Ok(())
    }

    #[tokio::test]
    async fn maybe_auto_dispatch_records_latest_pass() -> Result<()> {
        let path = temp_db_path();
        let mut cfg = Config::default();
        cfg.auto_dispatch_unread_handoffs = true;

        let recorded = std::sync::Arc::new(std::sync::Mutex::new(None));
        let recorded_clone = recorded.clone();

        let routed = maybe_auto_dispatch_with_recorder(
            &cfg,
            || async move {
                Ok(vec![LeadDispatchOutcome {
                    lead_session_id: "lead-a".to_string(),
                    unread_count: 3,
                    routed: vec![
                        InboxDrainOutcome {
                            message_id: 1,
                            task: "task-a".to_string(),
                            session_id: "worker-a".to_string(),
                            action: AssignmentAction::Spawned,
                        },
                        InboxDrainOutcome {
                            message_id: 2,
                            task: "task-b".to_string(),
                            session_id: "worker-b".to_string(),
                            action: AssignmentAction::Spawned,
                        },
                    ],
                }])
            },
            move |count, _deferred, leads| {
                *recorded_clone.lock().unwrap() = Some((count, leads));
                Ok(())
            },
        )
        .await?;

        assert_eq!(routed.routed, 2);
        assert_eq!(routed.deferred, 0);
        assert_eq!(*recorded.lock().unwrap(), Some((2, 1)));
        let _ = std::fs::remove_file(path);
        Ok(())
    }

    #[tokio::test]
    async fn coordinate_backlog_cycle_retries_after_rebalance_when_dispatch_deferred() -> Result<()>
    {
        let cfg = Config {
            auto_dispatch_unread_handoffs: true,
            ..Config::default()
        };
        let activity = DaemonActivity::default();
        let calls = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let calls_clone = calls.clone();

        let (first, rebalanced, recovery) = coordinate_backlog_cycle_with(
            &cfg,
            &activity,
            move || {
                let calls_clone = calls_clone.clone();
                async move {
                    let call = calls_clone.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                    Ok(match call {
                        0 => DispatchPassSummary {
                            routed: 0,
                            deferred: 2,
                            leads: 1,
                        },
                        _ => DispatchPassSummary {
                            routed: 2,
                            deferred: 0,
                            leads: 1,
                        },
                    })
                }
            },
            || async move { Ok(1) },
            |_, _| Ok(()),
        )
        .await?;

        assert_eq!(first.deferred, 2);
        assert_eq!(rebalanced, 1);
        assert_eq!(recovery.routed, 2);
        assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst), 2);
        Ok(())
    }

    #[tokio::test]
    async fn coordinate_backlog_cycle_skips_retry_without_rebalance() -> Result<()> {
        let cfg = Config {
            auto_dispatch_unread_handoffs: true,
            ..Config::default()
        };
        let activity = DaemonActivity::default();
        let calls = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let calls_clone = calls.clone();

        let (first, rebalanced, recovery) = coordinate_backlog_cycle_with(
            &cfg,
            &activity,
            move || {
                let calls_clone = calls_clone.clone();
                async move {
                    calls_clone.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                    Ok(DispatchPassSummary {
                        routed: 0,
                        deferred: 2,
                        leads: 1,
                    })
                }
            },
            || async move { Ok(0) },
            |_, _| Ok(()),
        )
        .await?;

        assert_eq!(first.deferred, 2);
        assert_eq!(rebalanced, 0);
        assert_eq!(recovery, DispatchPassSummary::default());
        assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst), 1);
        Ok(())
    }

    #[tokio::test]
    async fn coordinate_backlog_cycle_records_recovery_dispatch_when_it_routes_work() -> Result<()>
    {
        let cfg = Config {
            auto_dispatch_unread_handoffs: true,
            ..Config::default()
        };
        let activity = DaemonActivity::default();
        let recorded = std::sync::Arc::new(std::sync::Mutex::new(None));
        let recorded_clone = recorded.clone();
        let calls = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let calls_clone = calls.clone();

        let (_first, _rebalanced, recovery) = coordinate_backlog_cycle_with(
            &cfg,
            &activity,
            move || {
                let calls_clone = calls_clone.clone();
                async move {
                    let call = calls_clone.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                    Ok(match call {
                        0 => DispatchPassSummary {
                            routed: 0,
                            deferred: 1,
                            leads: 1,
                        },
                        _ => DispatchPassSummary {
                            routed: 2,
                            deferred: 0,
                            leads: 1,
                        },
                    })
                }
            },
            || async move { Ok(1) },
            move |routed, leads| {
                *recorded_clone.lock().unwrap() = Some((routed, leads));
                Ok(())
            },
        )
        .await?;

        assert_eq!(recovery.routed, 2);
        assert_eq!(*recorded.lock().unwrap(), Some((2, 1)));
        Ok(())
    }

    #[tokio::test]
    async fn coordinate_backlog_cycle_rebalances_first_after_unrecovered_deferred_pressure(
    ) -> Result<()> {
        let cfg = Config {
            auto_dispatch_unread_handoffs: true,
            ..Config::default()
        };
        let now = chrono::Utc::now();
        let activity = DaemonActivity {
            last_dispatch_at: Some(now),
            last_dispatch_routed: 0,
            last_dispatch_deferred: 2,
            last_dispatch_leads: 1,
            chronic_saturation_streak: 1,
            last_recovery_dispatch_at: None,
            last_recovery_dispatch_routed: 0,
            last_recovery_dispatch_leads: 0,
            last_rebalance_at: None,
            last_rebalance_rerouted: 0,
            last_rebalance_leads: 0,
            last_auto_merge_at: None,
            last_auto_merge_merged: 0,
            last_auto_merge_active_skipped: 0,
            last_auto_merge_conflicted_skipped: 0,
            last_auto_merge_dirty_skipped: 0,
            last_auto_merge_failed: 0,
            last_auto_prune_at: None,
            last_auto_prune_pruned: 0,
            last_auto_prune_active_skipped: 0,
        };
        let order = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let dispatch_order = order.clone();
        let rebalance_order = order.clone();

        let (first, rebalanced, recovery) = coordinate_backlog_cycle_with(
            &cfg,
            &activity,
            move || {
                let dispatch_order = dispatch_order.clone();
                async move {
                    dispatch_order.lock().unwrap().push("dispatch");
                    Ok(DispatchPassSummary {
                        routed: 1,
                        deferred: 0,
                        leads: 1,
                    })
                }
            },
            move || {
                let rebalance_order = rebalance_order.clone();
                async move {
                    rebalance_order.lock().unwrap().push("rebalance");
                    Ok(1)
                }
            },
            |_, _| Ok(()),
        )
        .await?;

        assert_eq!(*order.lock().unwrap(), vec!["rebalance", "dispatch"]);
        assert_eq!(first.routed, 1);
        assert_eq!(rebalanced, 1);
        assert_eq!(recovery, DispatchPassSummary::default());
        Ok(())
    }

    #[tokio::test]
    async fn coordinate_backlog_cycle_records_recovery_when_rebalance_first_dispatch_routes_work(
    ) -> Result<()> {
        let cfg = Config {
            auto_dispatch_unread_handoffs: true,
            ..Config::default()
        };
        let now = chrono::Utc::now();
        let activity = DaemonActivity {
            last_dispatch_at: Some(now),
            last_dispatch_routed: 0,
            last_dispatch_deferred: 2,
            last_dispatch_leads: 1,
            chronic_saturation_streak: 1,
            last_recovery_dispatch_at: None,
            last_recovery_dispatch_routed: 0,
            last_recovery_dispatch_leads: 0,
            last_rebalance_at: None,
            last_rebalance_rerouted: 0,
            last_rebalance_leads: 0,
            last_auto_merge_at: None,
            last_auto_merge_merged: 0,
            last_auto_merge_active_skipped: 0,
            last_auto_merge_conflicted_skipped: 0,
            last_auto_merge_dirty_skipped: 0,
            last_auto_merge_failed: 0,
            last_auto_prune_at: None,
            last_auto_prune_pruned: 0,
            last_auto_prune_active_skipped: 0,
        };
        let recorded = std::sync::Arc::new(std::sync::Mutex::new(None));
        let recorded_clone = recorded.clone();

        let (first, rebalanced, recovery) = coordinate_backlog_cycle_with(
            &cfg,
            &activity,
            || async move {
                Ok(DispatchPassSummary {
                    routed: 2,
                    deferred: 0,
                    leads: 1,
                })
            },
            || async move { Ok(1) },
            move |routed, leads| {
                *recorded_clone.lock().unwrap() = Some((routed, leads));
                Ok(())
            },
        )
        .await?;

        assert_eq!(first.routed, 2);
        assert_eq!(rebalanced, 1);
        assert_eq!(recovery, DispatchPassSummary::default());
        assert_eq!(*recorded.lock().unwrap(), Some((2, 1)));
        Ok(())
    }

    #[tokio::test]
    async fn coordinate_backlog_cycle_skips_dispatch_during_chronic_cooloff_when_rebalance_does_not_help(
    ) -> Result<()> {
        let cfg = Config {
            auto_dispatch_unread_handoffs: true,
            ..Config::default()
        };
        let now = chrono::Utc::now();
        let activity = DaemonActivity {
            last_dispatch_at: Some(now),
            last_dispatch_routed: 0,
            last_dispatch_deferred: 3,
            last_dispatch_leads: 1,
            chronic_saturation_streak: 1,
            last_recovery_dispatch_at: None,
            last_recovery_dispatch_routed: 0,
            last_recovery_dispatch_leads: 0,
            last_rebalance_at: Some(now - chrono::Duration::seconds(1)),
            last_rebalance_rerouted: 0,
            last_rebalance_leads: 1,
            last_auto_merge_at: None,
            last_auto_merge_merged: 0,
            last_auto_merge_active_skipped: 0,
            last_auto_merge_conflicted_skipped: 0,
            last_auto_merge_dirty_skipped: 0,
            last_auto_merge_failed: 0,
            last_auto_prune_at: None,
            last_auto_prune_pruned: 0,
            last_auto_prune_active_skipped: 0,
        };
        let calls = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let calls_clone = calls.clone();

        let (first, rebalanced, recovery) = coordinate_backlog_cycle_with(
            &cfg,
            &activity,
            move || {
                let calls_clone = calls_clone.clone();
                async move {
                    calls_clone.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                    Ok(DispatchPassSummary {
                        routed: 1,
                        deferred: 0,
                        leads: 1,
                    })
                }
            },
            || async move { Ok(0) },
            |_, _| Ok(()),
        )
        .await?;

        assert_eq!(first, DispatchPassSummary::default());
        assert_eq!(rebalanced, 0);
        assert_eq!(recovery, DispatchPassSummary::default());
        assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst), 0);
        Ok(())
    }

    #[tokio::test]
    async fn coordinate_backlog_cycle_skips_dispatch_when_persistent_saturation_streak_hits_cooloff(
    ) -> Result<()> {
        let cfg = Config {
            auto_dispatch_unread_handoffs: true,
            ..Config::default()
        };
        let now = chrono::Utc::now();
        let activity = DaemonActivity {
            last_dispatch_at: Some(now),
            last_dispatch_routed: 0,
            last_dispatch_deferred: 1,
            last_dispatch_leads: 1,
            chronic_saturation_streak: 3,
            last_recovery_dispatch_at: None,
            last_recovery_dispatch_routed: 0,
            last_recovery_dispatch_leads: 0,
            last_rebalance_at: Some(now - chrono::Duration::seconds(1)),
            last_rebalance_rerouted: 0,
            last_rebalance_leads: 1,
            last_auto_merge_at: None,
            last_auto_merge_merged: 0,
            last_auto_merge_active_skipped: 0,
            last_auto_merge_conflicted_skipped: 0,
            last_auto_merge_dirty_skipped: 0,
            last_auto_merge_failed: 0,
            last_auto_prune_at: None,
            last_auto_prune_pruned: 0,
            last_auto_prune_active_skipped: 0,
        };
        let calls = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let calls_clone = calls.clone();

        let (first, rebalanced, recovery) = coordinate_backlog_cycle_with(
            &cfg,
            &activity,
            move || {
                let calls_clone = calls_clone.clone();
                async move {
                    calls_clone.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                    Ok(DispatchPassSummary {
                        routed: 1,
                        deferred: 0,
                        leads: 1,
                    })
                }
            },
            || async move { Ok(0) },
            |_, _| Ok(()),
        )
        .await?;

        assert_eq!(first, DispatchPassSummary::default());
        assert_eq!(rebalanced, 0);
        assert_eq!(recovery, DispatchPassSummary::default());
        assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst), 0);
        Ok(())
    }

    #[tokio::test]
    async fn coordinate_backlog_cycle_skips_rebalance_when_stabilized_and_dispatch_is_healthy(
    ) -> Result<()> {
        let cfg = Config {
            auto_dispatch_unread_handoffs: true,
            ..Config::default()
        };
        let now = chrono::Utc::now();
        let activity = DaemonActivity {
            last_dispatch_at: Some(now + chrono::Duration::seconds(2)),
            last_dispatch_routed: 2,
            last_dispatch_deferred: 0,
            last_dispatch_leads: 1,
            chronic_saturation_streak: 0,
            last_recovery_dispatch_at: Some(now + chrono::Duration::seconds(1)),
            last_recovery_dispatch_routed: 1,
            last_recovery_dispatch_leads: 1,
            last_rebalance_at: Some(now),
            last_rebalance_rerouted: 1,
            last_rebalance_leads: 1,
            last_auto_merge_at: None,
            last_auto_merge_merged: 0,
            last_auto_merge_active_skipped: 0,
            last_auto_merge_conflicted_skipped: 0,
            last_auto_merge_dirty_skipped: 0,
            last_auto_merge_failed: 0,
            last_auto_prune_at: None,
            last_auto_prune_pruned: 0,
            last_auto_prune_active_skipped: 0,
        };
        let rebalance_calls = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let rebalance_calls_clone = rebalance_calls.clone();

        let (first, rebalanced, recovery) = coordinate_backlog_cycle_with(
            &cfg,
            &activity,
            || async move {
                Ok(DispatchPassSummary {
                    routed: 1,
                    deferred: 0,
                    leads: 1,
                })
            },
            move || {
                let rebalance_calls_clone = rebalance_calls_clone.clone();
                async move {
                    rebalance_calls_clone.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                    Ok(1)
                }
            },
            |_, _| Ok(()),
        )
        .await?;

        assert_eq!(first.routed, 1);
        assert_eq!(rebalanced, 0);
        assert_eq!(recovery, DispatchPassSummary::default());
        assert_eq!(rebalance_calls.load(std::sync::atomic::Ordering::SeqCst), 0);
        Ok(())
    }

    #[tokio::test]
    async fn maybe_auto_rebalance_noops_when_disabled() -> Result<()> {
        let path = temp_db_path();
        let _store = StateStore::open(&path)?;
        let cfg = Config::default();
        let invoked = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let invoked_flag = invoked.clone();

        let rerouted = maybe_auto_rebalance_with(&cfg, move || {
            let invoked_flag = invoked_flag.clone();
            async move {
                invoked_flag.store(true, std::sync::atomic::Ordering::SeqCst);
                Ok(Vec::new())
            }
        })
        .await?;

        assert_eq!(rerouted, 0);
        assert!(!invoked.load(std::sync::atomic::Ordering::SeqCst));
        let _ = std::fs::remove_file(path);
        Ok(())
    }

    #[tokio::test]
    async fn maybe_auto_rebalance_reports_total_rerouted_work() -> Result<()> {
        let path = temp_db_path();
        let _store = StateStore::open(&path)?;
        let mut cfg = Config::default();
        cfg.auto_dispatch_unread_handoffs = true;

        let rerouted = maybe_auto_rebalance_with(&cfg, || async move {
            Ok(vec![
                LeadRebalanceOutcome {
                    lead_session_id: "lead-a".to_string(),
                    rerouted: vec![
                        RebalanceOutcome {
                            from_session_id: "worker-a".to_string(),
                            message_id: 1,
                            task: "Task A".to_string(),
                            session_id: "worker-b".to_string(),
                            action: AssignmentAction::ReusedIdle,
                        },
                        RebalanceOutcome {
                            from_session_id: "worker-a".to_string(),
                            message_id: 2,
                            task: "Task B".to_string(),
                            session_id: "worker-c".to_string(),
                            action: AssignmentAction::Spawned,
                        },
                    ],
                },
                LeadRebalanceOutcome {
                    lead_session_id: "lead-b".to_string(),
                    rerouted: vec![RebalanceOutcome {
                        from_session_id: "worker-d".to_string(),
                        message_id: 3,
                        task: "Task C".to_string(),
                        session_id: "worker-e".to_string(),
                        action: AssignmentAction::ReusedActive,
                    }],
                },
            ])
        })
        .await?;

        assert_eq!(rerouted, 3);
        let _ = std::fs::remove_file(path);
        Ok(())
    }

    #[tokio::test]
    async fn maybe_auto_rebalance_records_latest_pass() -> Result<()> {
        let path = temp_db_path();
        let mut cfg = Config::default();
        cfg.auto_dispatch_unread_handoffs = true;

        let recorded = std::sync::Arc::new(std::sync::Mutex::new(None));
        let recorded_clone = recorded.clone();

        let rerouted = maybe_auto_rebalance_with_recorder(
            &cfg,
            || async move {
                Ok(vec![LeadRebalanceOutcome {
                    lead_session_id: "lead-a".to_string(),
                    rerouted: vec![RebalanceOutcome {
                        from_session_id: "worker-a".to_string(),
                        message_id: 7,
                        task: "task-a".to_string(),
                        session_id: "worker-b".to_string(),
                        action: AssignmentAction::ReusedIdle,
                    }],
                }])
            },
            move |count, leads| {
                *recorded_clone.lock().unwrap() = Some((count, leads));
                Ok(())
            },
        )
        .await?;

        assert_eq!(rerouted, 1);
        assert_eq!(*recorded.lock().unwrap(), Some((1, 1)));
        let _ = std::fs::remove_file(path);
        Ok(())
    }

    #[tokio::test]
    async fn maybe_auto_merge_ready_worktrees_noops_when_disabled() -> Result<()> {
        let mut cfg = Config::default();
        cfg.auto_merge_ready_worktrees = false;

        let invoked = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let invoked_flag = invoked.clone();

        let merged = maybe_auto_merge_ready_worktrees_with(&cfg, move || {
            let invoked_flag = invoked_flag.clone();
            async move {
                invoked_flag.store(true, std::sync::atomic::Ordering::SeqCst);
                Ok(manager::WorktreeBulkMergeOutcome {
                    merged: Vec::new(),
                    rebased: Vec::new(),
                    active_with_worktree_ids: Vec::new(),
                    conflicted_session_ids: Vec::new(),
                    dirty_worktree_ids: Vec::new(),
                    blocked_by_queue_session_ids: Vec::new(),
                    failures: Vec::new(),
                })
            }
        })
        .await?;

        assert_eq!(merged, 0);
        assert!(!invoked.load(std::sync::atomic::Ordering::SeqCst));
        Ok(())
    }

    #[tokio::test]
    async fn maybe_auto_merge_ready_worktrees_merges_ready_worktrees_when_enabled() -> Result<()> {
        let mut cfg = Config::default();
        cfg.auto_merge_ready_worktrees = true;

        let merged = maybe_auto_merge_ready_worktrees_with(&cfg, || async move {
            Ok(manager::WorktreeBulkMergeOutcome {
                merged: vec![
                    manager::WorktreeMergeOutcome {
                        session_id: "worker-a".to_string(),
                        branch: "ecc/worker-a".to_string(),
                        base_branch: "main".to_string(),
                        already_up_to_date: false,
                        cleaned_worktree: true,
                    },
                    manager::WorktreeMergeOutcome {
                        session_id: "worker-b".to_string(),
                        branch: "ecc/worker-b".to_string(),
                        base_branch: "main".to_string(),
                        already_up_to_date: true,
                        cleaned_worktree: true,
                    },
                ],
                rebased: vec![manager::WorktreeRebaseOutcome {
                    session_id: "worker-r".to_string(),
                    branch: "ecc/worker-r".to_string(),
                    base_branch: "main".to_string(),
                    already_up_to_date: false,
                }],
                active_with_worktree_ids: vec!["worker-c".to_string()],
                conflicted_session_ids: vec!["worker-d".to_string()],
                dirty_worktree_ids: vec!["worker-e".to_string()],
                blocked_by_queue_session_ids: vec!["worker-f".to_string()],
                failures: Vec::new(),
            })
        })
        .await?;

        assert_eq!(merged, 2);
        Ok(())
    }

    #[tokio::test]
    async fn maybe_auto_prune_inactive_worktrees_records_pruned_and_active_counts() -> Result<()> {
        let recorded = std::sync::Arc::new(std::sync::Mutex::new(None));
        let recorded_clone = recorded.clone();

        let pruned = maybe_auto_prune_inactive_worktrees_with_recorder(
            || async move {
                Ok(manager::WorktreePruneOutcome {
                    cleaned_session_ids: vec!["stopped-a".to_string(), "stopped-b".to_string()],
                    active_with_worktree_ids: vec!["running-a".to_string()],
                    retained_session_ids: vec!["retained-a".to_string()],
                })
            },
            move |pruned, active| {
                *recorded_clone.lock().unwrap() = Some((pruned, active));
                Ok(())
            },
        )
        .await?;

        assert_eq!(pruned, 2);
        assert_eq!(*recorded.lock().unwrap(), Some((2, 1)));
        Ok(())
    }
}
