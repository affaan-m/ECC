use anyhow::{Context, Result};
use chrono::Utc;
use cron::Schedule as CronSchedule;
use serde::Serialize;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::fmt;
use std::fs::OpenOptions;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::str::FromStr;
use tokio::process::Command;

use super::output::SessionOutputStore;
use super::runtime::capture_command_output;
use super::store::StateStore;
use super::{
    default_project_label, default_task_group_label, normalize_group_label, HarnessKind,
    RemoteDispatchKind, ScheduledTask, Session, SessionAgentProfile, SessionGrouping,
    SessionHarnessInfo, SessionMetrics, SessionState,
};
use crate::comms::{self, MessageType, TaskPriority};
use crate::config::Config;
use crate::observability::{log_tool_call, ToolCallEvent, ToolLogEntry, ToolLogPage, ToolLogger};
use crate::worktree;

pub async fn create_session(
    db: &StateStore,
    cfg: &Config,
    task: &str,
    agent_type: &str,
    use_worktree: bool,
) -> Result<String> {
    create_session_with_profile_and_grouping(
        db,
        cfg,
        task,
        agent_type,
        use_worktree,
        None,
        SessionGrouping::default(),
    )
    .await
}

pub async fn create_session_with_grouping(
    db: &StateStore,
    cfg: &Config,
    task: &str,
    agent_type: &str,
    use_worktree: bool,
    grouping: SessionGrouping,
) -> Result<String> {
    create_session_with_profile_and_grouping(
        db,
        cfg,
        task,
        agent_type,
        use_worktree,
        None,
        grouping,
    )
    .await
}

pub async fn create_session_with_profile_and_grouping(
    db: &StateStore,
    cfg: &Config,
    task: &str,
    agent_type: &str,
    use_worktree: bool,
    profile_name: Option<&str>,
    grouping: SessionGrouping,
) -> Result<String> {
    let repo_root =
        std::env::current_dir().context("Failed to resolve current working directory")?;
    queue_session_in_dir(
        db,
        cfg,
        task,
        agent_type,
        use_worktree,
        &repo_root,
        profile_name,
        None,
        grouping,
    )
    .await
}

pub async fn create_session_from_source_with_profile_and_grouping(
    db: &StateStore,
    cfg: &Config,
    task: &str,
    agent_type: &str,
    use_worktree: bool,
    profile_name: Option<&str>,
    source_session_id: &str,
    grouping: SessionGrouping,
) -> Result<String> {
    let repo_root =
        std::env::current_dir().context("Failed to resolve current working directory")?;
    queue_session_in_dir(
        db,
        cfg,
        task,
        agent_type,
        use_worktree,
        &repo_root,
        profile_name,
        Some(source_session_id),
        grouping,
    )
    .await
}

async fn run_due_schedules_with_runner_program(
    db: &StateStore,
    cfg: &Config,
    limit: usize,
    runner_program: &Path,
) -> Result<Vec<ScheduledRunOutcome>> {
    let now = Utc::now();
    let schedules = db.list_due_scheduled_tasks(now, limit)?;
    let mut outcomes = Vec::new();

    for schedule in schedules {
        let grouping = SessionGrouping {
            project: normalize_group_label(&schedule.project),
            task_group: normalize_group_label(&schedule.task_group),
        };
        let session_id = queue_session_in_dir_with_runner_program(
            db,
            cfg,
            &schedule.task,
            &schedule.agent_type,
            schedule.use_worktree,
            &schedule.working_dir,
            runner_program,
            schedule.profile_name.as_deref(),
            None,
            grouping,
        )
        .await?;
        let next_run_at = next_schedule_run_at(&schedule.cron_expr, now)?;
        db.record_scheduled_task_run(schedule.id, now, next_run_at)?;
        outcomes.push(ScheduledRunOutcome {
            schedule_id: schedule.id,
            session_id,
            task: schedule.task,
            cron_expr: schedule.cron_expr,
            next_run_at,
        });
    }

    Ok(outcomes)
}

pub fn list_sessions(db: &StateStore) -> Result<Vec<Session>> {
    db.list_sessions()
}

pub fn get_status(db: &StateStore, cfg: &Config, id: &str) -> Result<SessionStatus> {
    let session = resolve_session(db, id)?;
    let session_id = session.id.clone();
    Ok(SessionStatus {
        harness: db
            .get_session_harness_info(&session_id)?
            .unwrap_or_else(|| {
                SessionHarnessInfo::detect(&session.agent_type, &session.working_dir)
            })
            .with_config_detection(cfg, &session.working_dir),
        profile: db.get_session_profile(&session_id)?,
        session,
        parent_session: db.latest_task_handoff_source(&session_id)?,
        delegated_children: db.delegated_children(&session_id, 5)?,
    })
}

pub fn get_team_status(db: &StateStore, id: &str, depth: usize) -> Result<TeamStatus> {
    let root = resolve_session(db, id)?;
    let handoff_backlog = db
        .unread_task_handoff_targets(db.list_sessions()?.len().max(1))?
        .into_iter()
        .collect();
    let mut visited = HashSet::new();
    visited.insert(root.id.clone());

    let mut descendants = Vec::new();
    collect_delegation_descendants(
        db,
        &root.id,
        depth,
        1,
        &handoff_backlog,
        &mut visited,
        &mut descendants,
    )?;

    Ok(TeamStatus {
        root,
        handoff_backlog,
        descendants,
    })
}

pub fn create_scheduled_task(
    db: &StateStore,
    cfg: &Config,
    cron_expr: &str,
    task: &str,
    agent_type: &str,
    profile_name: Option<&str>,
    use_worktree: bool,
    grouping: SessionGrouping,
) -> Result<ScheduledTask> {
    let working_dir =
        std::env::current_dir().context("Failed to resolve current working directory")?;
    let project = grouping
        .project
        .as_deref()
        .and_then(normalize_group_label)
        .unwrap_or_else(|| default_project_label(&working_dir));
    let task_group = grouping
        .task_group
        .as_deref()
        .and_then(normalize_group_label)
        .unwrap_or_else(|| default_task_group_label(task));
    let agent_type = HarnessKind::canonical_agent_type(agent_type);

    if let Some(profile_name) = profile_name {
        cfg.resolve_agent_profile(profile_name)?;
    }

    let next_run_at = next_schedule_run_at(cron_expr, Utc::now())?;
    db.insert_scheduled_task(
        cron_expr,
        task,
        &agent_type,
        profile_name,
        &working_dir,
        &project,
        &task_group,
        use_worktree,
        next_run_at,
    )
}

pub fn list_scheduled_tasks(db: &StateStore) -> Result<Vec<ScheduledTask>> {
    db.list_scheduled_tasks()
}

pub fn delete_scheduled_task(db: &StateStore, schedule_id: i64) -> Result<bool> {
    Ok(db.delete_scheduled_task(schedule_id)? > 0)
}

#[allow(clippy::too_many_arguments)]
pub fn create_remote_dispatch_request(
    db: &StateStore,
    cfg: &Config,
    task: &str,
    target_session_id: Option<&str>,
    priority: TaskPriority,
    agent_type: &str,
    profile_name: Option<&str>,
    use_worktree: bool,
    grouping: SessionGrouping,
    source: &str,
    requester: Option<&str>,
) -> Result<super::RemoteDispatchRequest> {
    let working_dir =
        std::env::current_dir().context("Failed to resolve current working directory")?;
    create_remote_dispatch_request_inner(
        db,
        cfg,
        RemoteDispatchKind::Standard,
        &working_dir,
        task,
        None,
        target_session_id,
        priority,
        agent_type,
        profile_name,
        use_worktree,
        grouping,
        source,
        requester,
    )
}

#[allow(clippy::too_many_arguments)]
pub fn create_computer_use_remote_dispatch_request(
    db: &StateStore,
    cfg: &Config,
    goal: &str,
    target_url: Option<&str>,
    context: Option<&str>,
    target_session_id: Option<&str>,
    priority: TaskPriority,
    agent_type_override: Option<&str>,
    profile_name_override: Option<&str>,
    use_worktree_override: Option<bool>,
    grouping: SessionGrouping,
    source: &str,
    requester: Option<&str>,
) -> Result<super::RemoteDispatchRequest> {
    let working_dir =
        std::env::current_dir().context("Failed to resolve current working directory")?;
    create_computer_use_remote_dispatch_request_in_dir(
        db,
        cfg,
        &working_dir,
        goal,
        target_url,
        context,
        target_session_id,
        priority,
        agent_type_override,
        profile_name_override,
        use_worktree_override,
        grouping,
        source,
        requester,
    )
}

#[allow(clippy::too_many_arguments)]
fn create_computer_use_remote_dispatch_request_in_dir(
    db: &StateStore,
    cfg: &Config,
    working_dir: &Path,
    goal: &str,
    target_url: Option<&str>,
    context: Option<&str>,
    target_session_id: Option<&str>,
    priority: TaskPriority,
    agent_type_override: Option<&str>,
    profile_name_override: Option<&str>,
    use_worktree_override: Option<bool>,
    grouping: SessionGrouping,
    source: &str,
    requester: Option<&str>,
) -> Result<super::RemoteDispatchRequest> {
    let defaults = cfg.computer_use_dispatch_defaults();
    let task = render_computer_use_task(goal, target_url, context);
    let agent_type = agent_type_override.unwrap_or(&defaults.agent);
    let profile_name = profile_name_override.or(defaults.profile.as_deref());
    let use_worktree = use_worktree_override.unwrap_or(defaults.use_worktree);
    let grouping = SessionGrouping {
        project: grouping.project.or(defaults.project),
        task_group: grouping
            .task_group
            .or(defaults.task_group)
            .or_else(|| Some(default_task_group_label(goal))),
    };

    create_remote_dispatch_request_inner(
        db,
        cfg,
        RemoteDispatchKind::ComputerUse,
        working_dir,
        &task,
        target_url,
        target_session_id,
        priority,
        agent_type,
        profile_name,
        use_worktree,
        grouping,
        source,
        requester,
    )
}

#[allow(clippy::too_many_arguments)]
fn create_remote_dispatch_request_inner(
    db: &StateStore,
    cfg: &Config,
    request_kind: RemoteDispatchKind,
    working_dir: &Path,
    task: &str,
    target_url: Option<&str>,
    target_session_id: Option<&str>,
    priority: TaskPriority,
    agent_type: &str,
    profile_name: Option<&str>,
    use_worktree: bool,
    grouping: SessionGrouping,
    source: &str,
    requester: Option<&str>,
) -> Result<super::RemoteDispatchRequest> {
    let project = grouping
        .project
        .as_deref()
        .and_then(normalize_group_label)
        .unwrap_or_else(|| default_project_label(&working_dir));
    let task_group = grouping
        .task_group
        .as_deref()
        .and_then(normalize_group_label)
        .unwrap_or_else(|| default_task_group_label(task));
    let agent_type = HarnessKind::canonical_agent_type(agent_type);

    if let Some(profile_name) = profile_name {
        cfg.resolve_agent_profile(profile_name)?;
    }
    if let Some(target_session_id) = target_session_id {
        let _ = resolve_session(db, target_session_id)?;
    }

    db.insert_remote_dispatch_request(
        request_kind,
        target_session_id,
        task,
        target_url,
        priority,
        &agent_type,
        profile_name,
        &working_dir,
        &project,
        &task_group,
        use_worktree,
        source,
        requester,
    )
}

fn render_computer_use_task(goal: &str, target_url: Option<&str>, context: Option<&str>) -> String {
    let mut lines = vec![
        "Computer-use task.".to_string(),
        format!("Goal: {}", goal.trim()),
    ];
    if let Some(target_url) = target_url.map(str::trim).filter(|value| !value.is_empty()) {
        lines.push(format!("Target URL: {target_url}"));
    }
    if let Some(context) = context.map(str::trim).filter(|value| !value.is_empty()) {
        lines.push(format!("Context: {context}"));
    }
    lines.push(
        "Use browser or computer-use tools directly when available, and report blockers clearly if auth, approvals, or local-device access prevent completion."
            .to_string(),
    );
    lines.join("\n")
}

pub fn list_remote_dispatch_requests(
    db: &StateStore,
    include_processed: bool,
    limit: usize,
) -> Result<Vec<super::RemoteDispatchRequest>> {
    db.list_remote_dispatch_requests(include_processed, limit)
}

pub async fn run_due_schedules(
    db: &StateStore,
    cfg: &Config,
    limit: usize,
) -> Result<Vec<ScheduledRunOutcome>> {
    let runner_program =
        std::env::current_exe().context("Failed to resolve ECC executable path")?;
    run_due_schedules_with_runner_program(db, cfg, limit, &runner_program).await
}

pub async fn run_remote_dispatch_requests(
    db: &StateStore,
    cfg: &Config,
    limit: usize,
) -> Result<Vec<RemoteDispatchOutcome>> {
    let requests = db.list_pending_remote_dispatch_requests(limit)?;
    let runner_program =
        std::env::current_exe().context("Failed to resolve ECC executable path")?;
    run_remote_dispatch_requests_with_runner_program(db, cfg, requests, &runner_program).await
}

async fn run_remote_dispatch_requests_with_runner_program(
    db: &StateStore,
    cfg: &Config,
    requests: Vec<super::RemoteDispatchRequest>,
    runner_program: &Path,
) -> Result<Vec<RemoteDispatchOutcome>> {
    let mut outcomes = Vec::new();

    for request in requests {
        let grouping = SessionGrouping {
            project: normalize_group_label(&request.project),
            task_group: normalize_group_label(&request.task_group),
        };

        let outcome = if let Some(target_session_id) = request.target_session_id.as_deref() {
            match assign_session_in_dir_with_runner_program(
                db,
                cfg,
                target_session_id,
                &request.task,
                &request.agent_type,
                request.use_worktree,
                &request.working_dir,
                &runner_program,
                request.profile_name.as_deref(),
                grouping,
            )
            .await
            {
                Ok(assignment) if assignment.action == AssignmentAction::DeferredSaturated => {
                    RemoteDispatchOutcome {
                        request_id: request.id,
                        task: request.task.clone(),
                        priority: request.priority,
                        target_session_id: request.target_session_id.clone(),
                        session_id: None,
                        action: RemoteDispatchAction::DeferredSaturated,
                    }
                }
                Ok(assignment) => {
                    db.record_remote_dispatch_success(
                        request.id,
                        Some(&assignment.session_id),
                        Some(assignment.action.label()),
                    )?;
                    RemoteDispatchOutcome {
                        request_id: request.id,
                        task: request.task.clone(),
                        priority: request.priority,
                        target_session_id: request.target_session_id.clone(),
                        session_id: Some(assignment.session_id),
                        action: RemoteDispatchAction::Assigned(assignment.action),
                    }
                }
                Err(error) => {
                    db.record_remote_dispatch_failure(request.id, &error.to_string())?;
                    RemoteDispatchOutcome {
                        request_id: request.id,
                        task: request.task.clone(),
                        priority: request.priority,
                        target_session_id: request.target_session_id.clone(),
                        session_id: None,
                        action: RemoteDispatchAction::Failed(error.to_string()),
                    }
                }
            }
        } else {
            match queue_session_in_dir_with_runner_program(
                db,
                cfg,
                &request.task,
                &request.agent_type,
                request.use_worktree,
                &request.working_dir,
                &runner_program,
                request.profile_name.as_deref(),
                None,
                grouping,
            )
            .await
            {
                Ok(session_id) => {
                    db.record_remote_dispatch_success(
                        request.id,
                        Some(&session_id),
                        Some("spawned_top_level"),
                    )?;
                    RemoteDispatchOutcome {
                        request_id: request.id,
                        task: request.task.clone(),
                        priority: request.priority,
                        target_session_id: None,
                        session_id: Some(session_id),
                        action: RemoteDispatchAction::SpawnedTopLevel,
                    }
                }
                Err(error) => {
                    db.record_remote_dispatch_failure(request.id, &error.to_string())?;
                    RemoteDispatchOutcome {
                        request_id: request.id,
                        task: request.task.clone(),
                        priority: request.priority,
                        target_session_id: None,
                        session_id: None,
                        action: RemoteDispatchAction::Failed(error.to_string()),
                    }
                }
            }
        };

        outcomes.push(outcome);
    }

    Ok(outcomes)
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct TemplateLaunchStepOutcome {
    pub step_name: String,
    pub session_id: String,
    pub task: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct TemplateLaunchOutcome {
    pub template_name: String,
    pub step_count: usize,
    pub anchor_session_id: Option<String>,
    pub created: Vec<TemplateLaunchStepOutcome>,
}

pub async fn launch_orchestration_template(
    db: &StateStore,
    cfg: &Config,
    template_name: &str,
    source_session_id: Option<&str>,
    task: Option<&str>,
    variables: BTreeMap<String, String>,
) -> Result<TemplateLaunchOutcome> {
    let repo_root =
        std::env::current_dir().context("Failed to resolve current working directory")?;
    let runner_program =
        std::env::current_exe().context("Failed to resolve ECC executable path")?;
    let source_session = source_session_id
        .map(|id| resolve_session(db, id))
        .transpose()?;
    let vars = build_template_variables(&repo_root, source_session.as_ref(), task, variables);
    let template = cfg.resolve_orchestration_template(template_name, &vars)?;
    let live_sessions = db
        .list_sessions()?
        .into_iter()
        .filter(|session| {
            matches!(
                session.state,
                SessionState::Pending
                    | SessionState::Running
                    | SessionState::Idle
                    | SessionState::Stale
            )
        })
        .count();
    let available_slots = cfg.max_parallel_sessions.saturating_sub(live_sessions);
    if template.steps.len() > available_slots {
        anyhow::bail!(
            "template {template_name} requires {} session slots but only {available_slots} available",
            template.steps.len()
        );
    }

    let default_profile = cfg
        .default_agent_profile
        .as_deref()
        .map(|name| cfg.resolve_agent_profile(name))
        .transpose()?;
    let base_grouping = SessionGrouping {
        project: Some(
            source_session
                .as_ref()
                .map(|session| session.project.clone())
                .unwrap_or_else(|| default_project_label(&repo_root)),
        ),
        task_group: Some(
            source_session
                .as_ref()
                .map(|session| session.task_group.clone())
                .or_else(|| task.map(default_task_group_label))
                .unwrap_or_else(|| template_name.replace(['_', '-'], " ")),
        ),
    };

    let mut created = Vec::with_capacity(template.steps.len());
    let mut anchor_session_id = source_session.as_ref().map(|session| session.id.clone());
    let mut created_anchor_id: Option<String> = None;

    for step in template.steps {
        let profile = match step.profile.as_deref() {
            Some(name) => Some(cfg.resolve_agent_profile(name)?),
            None if step.agent.is_some() => None,
            None => default_profile.clone(),
        };
        let agent = step
            .agent
            .as_deref()
            .unwrap_or(&cfg.default_agent)
            .to_string();
        let grouping = SessionGrouping {
            project: step
                .project
                .clone()
                .or_else(|| base_grouping.project.clone()),
            task_group: step
                .task_group
                .clone()
                .or_else(|| base_grouping.task_group.clone()),
        };
        let session_id = queue_session_with_resolved_profile_and_runner_program(
            db,
            cfg,
            &step.task,
            &agent,
            step.worktree,
            &repo_root,
            &runner_program,
            profile,
            grouping,
        )
        .await?;

        if let Some(parent_id) = anchor_session_id.as_deref() {
            let parent = resolve_session(db, parent_id)?;
            send_task_handoff(
                db,
                &parent,
                &session_id,
                &step.task,
                &format!("template {} | {}", template_name, step.name),
            )?;
        } else {
            created_anchor_id = Some(session_id.clone());
            anchor_session_id = Some(session_id.clone());
        }

        if created_anchor_id.is_none() {
            created_anchor_id = Some(session_id.clone());
        }

        created.push(TemplateLaunchStepOutcome {
            step_name: step.name,
            session_id,
            task: step.task,
        });
    }

    Ok(TemplateLaunchOutcome {
        template_name: template_name.to_string(),
        step_count: created.len(),
        anchor_session_id: source_session
            .as_ref()
            .map(|session| session.id.clone())
            .or(created_anchor_id),
        created,
    })
}

pub(crate) fn build_template_variables(
    repo_root: &Path,
    source_session: Option<&Session>,
    task: Option<&str>,
    mut variables: BTreeMap<String, String>,
) -> BTreeMap<String, String> {
    if let Some(source) = source_session {
        variables
            .entry("source_task".to_string())
            .or_insert_with(|| source.task.clone());
        variables
            .entry("source_project".to_string())
            .or_insert_with(|| source.project.clone());
        variables
            .entry("source_task_group".to_string())
            .or_insert_with(|| source.task_group.clone());
        variables
            .entry("source_agent".to_string())
            .or_insert_with(|| source.agent_type.clone());
    }

    let effective_task = task
        .map(ToOwned::to_owned)
        .or_else(|| source_session.map(|session| session.task.clone()));
    if let Some(task) = effective_task {
        variables.entry("task".to_string()).or_insert(task.clone());
        variables
            .entry("task_group".to_string())
            .or_insert_with(|| default_task_group_label(&task));
    }

    variables.entry("project".to_string()).or_insert_with(|| {
        source_session
            .map(|session| session.project.clone())
            .unwrap_or_else(|| default_project_label(repo_root))
    });
    variables
        .entry("cwd".to_string())
        .or_insert_with(|| repo_root.display().to_string());

    variables
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct HeartbeatEnforcementOutcome {
    pub stale_sessions: Vec<String>,
    pub auto_terminated_sessions: Vec<String>,
}

pub fn enforce_session_heartbeats(
    db: &StateStore,
    cfg: &Config,
) -> Result<HeartbeatEnforcementOutcome> {
    enforce_session_heartbeats_with(db, cfg, kill_process)
}

fn enforce_session_heartbeats_with<F>(
    db: &StateStore,
    cfg: &Config,
    terminate_pid: F,
) -> Result<HeartbeatEnforcementOutcome>
where
    F: Fn(u32) -> Result<()>,
{
    let timeout = chrono::Duration::seconds(cfg.session_timeout_secs as i64);
    let now = chrono::Utc::now();
    let mut outcome = HeartbeatEnforcementOutcome::default();

    for session in db.list_sessions()? {
        if !matches!(session.state, SessionState::Running | SessionState::Stale) {
            continue;
        }

        if now.signed_duration_since(session.last_heartbeat_at) <= timeout {
            continue;
        }

        if cfg.auto_terminate_stale_sessions {
            if let Some(pid) = session.pid {
                let _ = terminate_pid(pid);
            }
            db.update_state_and_pid(&session.id, &SessionState::Failed, None)?;
            outcome.auto_terminated_sessions.push(session.id);
            continue;
        }

        if session.state != SessionState::Stale {
            db.update_state(&session.id, &SessionState::Stale)?;
            outcome.stale_sessions.push(session.id);
        }
    }

    Ok(outcome)
}

pub async fn assign_session(
    db: &StateStore,
    cfg: &Config,
    lead_id: &str,
    task: &str,
    agent_type: &str,
    use_worktree: bool,
) -> Result<AssignmentOutcome> {
    assign_session_with_profile_and_grouping(
        db,
        cfg,
        lead_id,
        task,
        agent_type,
        use_worktree,
        None,
        SessionGrouping::default(),
    )
    .await
}

pub async fn assign_session_with_grouping(
    db: &StateStore,
    cfg: &Config,
    lead_id: &str,
    task: &str,
    agent_type: &str,
    use_worktree: bool,
    grouping: SessionGrouping,
) -> Result<AssignmentOutcome> {
    assign_session_with_profile_and_grouping(
        db,
        cfg,
        lead_id,
        task,
        agent_type,
        use_worktree,
        None,
        grouping,
    )
    .await
}

pub async fn assign_session_with_profile_and_grouping(
    db: &StateStore,
    cfg: &Config,
    lead_id: &str,
    task: &str,
    agent_type: &str,
    use_worktree: bool,
    profile_name: Option<&str>,
    grouping: SessionGrouping,
) -> Result<AssignmentOutcome> {
    let repo_root =
        std::env::current_dir().context("Failed to resolve current working directory")?;
    assign_session_in_dir_with_runner_program(
        db,
        cfg,
        lead_id,
        task,
        agent_type,
        use_worktree,
        &repo_root,
        &std::env::current_exe().context("Failed to resolve ECC executable path")?,
        profile_name,
        grouping,
    )
    .await
}

pub async fn drain_inbox(
    db: &StateStore,
    cfg: &Config,
    lead_id: &str,
    agent_type: &str,
    use_worktree: bool,
    limit: usize,
) -> Result<Vec<InboxDrainOutcome>> {
    let runner_program =
        std::env::current_exe().context("Failed to resolve ECC executable path")?;
    let lead = resolve_session(db, lead_id)?;
    let repo_root = lead.working_dir.clone();
    let messages = db.unread_task_handoffs_for_session(&lead.id, limit)?;
    let mut outcomes = Vec::new();

    for message in messages {
        let task =
            parse_task_handoff_task(&message.content).unwrap_or_else(|| message.content.clone());

        let outcome = assign_session_in_dir_with_runner_program(
            db,
            cfg,
            &lead.id,
            &task,
            agent_type,
            use_worktree,
            &repo_root,
            &runner_program,
            None,
            SessionGrouping::default(),
        )
        .await?;

        if assignment_action_routes_work(outcome.action) {
            let _ = db.mark_message_read(message.id)?;
        }
        outcomes.push(InboxDrainOutcome {
            message_id: message.id,
            task,
            session_id: outcome.session_id,
            action: outcome.action,
        });
    }

    Ok(outcomes)
}

pub async fn auto_dispatch_backlog(
    db: &StateStore,
    cfg: &Config,
    agent_type: &str,
    use_worktree: bool,
    lead_limit: usize,
) -> Result<Vec<LeadDispatchOutcome>> {
    let targets = db.unread_task_handoff_targets(lead_limit)?;
    let mut outcomes = Vec::new();

    for (lead_id, unread_count) in targets {
        let routed = drain_inbox(
            db,
            cfg,
            &lead_id,
            agent_type,
            use_worktree,
            cfg.auto_dispatch_limit_per_session,
        )
        .await?;

        if !routed.is_empty() {
            outcomes.push(LeadDispatchOutcome {
                lead_session_id: lead_id,
                unread_count,
                routed,
            });
        }
    }

    Ok(outcomes)
}

pub async fn rebalance_all_teams(
    db: &StateStore,
    cfg: &Config,
    agent_type: &str,
    use_worktree: bool,
    lead_limit: usize,
) -> Result<Vec<LeadRebalanceOutcome>> {
    let sessions = db.list_sessions()?;
    let mut outcomes = Vec::new();

    for session in sessions
        .into_iter()
        .filter(|session| {
            matches!(
                session.state,
                SessionState::Running | SessionState::Pending | SessionState::Idle
            )
        })
        .take(lead_limit)
    {
        let rerouted = rebalance_team_backlog(
            db,
            cfg,
            &session.id,
            agent_type,
            use_worktree,
            cfg.auto_dispatch_limit_per_session,
        )
        .await?;

        if !rerouted.is_empty() {
            outcomes.push(LeadRebalanceOutcome {
                lead_session_id: session.id,
                rerouted,
            });
        }
    }

    Ok(outcomes)
}

pub async fn coordinate_backlog(
    db: &StateStore,
    cfg: &Config,
    agent_type: &str,
    use_worktree: bool,
    lead_limit: usize,
) -> Result<CoordinateBacklogOutcome> {
    let dispatched = auto_dispatch_backlog(db, cfg, agent_type, use_worktree, lead_limit).await?;
    let rebalanced = rebalance_all_teams(db, cfg, agent_type, use_worktree, lead_limit).await?;
    let remaining_targets = db.unread_task_handoff_targets(db.list_sessions()?.len().max(1))?;
    let pressure = summarize_backlog_pressure(db, cfg, agent_type, &remaining_targets)?;
    let remaining_backlog_sessions = remaining_targets.len();
    let remaining_backlog_messages = remaining_targets
        .iter()
        .map(|(_, unread_count)| *unread_count)
        .sum();

    Ok(CoordinateBacklogOutcome {
        dispatched,
        rebalanced,
        remaining_backlog_sessions,
        remaining_backlog_messages,
        remaining_absorbable_sessions: pressure.absorbable_sessions,
        remaining_saturated_sessions: pressure.saturated_sessions,
    })
}

pub async fn rebalance_team_backlog(
    db: &StateStore,
    cfg: &Config,
    lead_id: &str,
    agent_type: &str,
    use_worktree: bool,
    limit: usize,
) -> Result<Vec<RebalanceOutcome>> {
    let runner_program =
        std::env::current_exe().context("Failed to resolve ECC executable path")?;
    let lead = resolve_session(db, lead_id)?;
    let repo_root = lead.working_dir.clone();
    let mut outcomes = Vec::new();

    if limit == 0 {
        return Ok(outcomes);
    }

    let delegates = direct_delegate_sessions(db, cfg, &lead, agent_type)?;
    let unread_counts = db.unread_message_counts()?;
    let team_has_capacity = delegates.len() < cfg.max_parallel_sessions;

    for delegate in &delegates {
        if outcomes.len() >= limit {
            break;
        }

        let unread_count = unread_counts.get(&delegate.id).copied().unwrap_or(0);
        if unread_count <= 1 {
            continue;
        }

        let has_clear_idle_elsewhere = delegates.iter().any(|candidate| {
            candidate.id != delegate.id
                && candidate.state == SessionState::Idle
                && unread_counts.get(&candidate.id).copied().unwrap_or(0) == 0
        });

        if !has_clear_idle_elsewhere && !team_has_capacity {
            continue;
        }

        let message_budget = limit.saturating_sub(outcomes.len());
        let messages = db.unread_task_handoffs_for_session(&delegate.id, message_budget)?;

        for message in messages {
            if outcomes.len() >= limit {
                break;
            }

            let current_delegates = direct_delegate_sessions(db, cfg, &lead, agent_type)?;
            let current_unread_counts = db.unread_message_counts()?;
            let current_team_has_capacity = current_delegates.len() < cfg.max_parallel_sessions;
            let current_has_clear_idle_elsewhere = current_delegates.iter().any(|candidate| {
                candidate.id != delegate.id
                    && candidate.state == SessionState::Idle
                    && current_unread_counts
                        .get(&candidate.id)
                        .copied()
                        .unwrap_or(0)
                        == 0
            });

            if !current_has_clear_idle_elsewhere && !current_team_has_capacity {
                break;
            }

            if message.from_session != lead.id {
                continue;
            }

            let task = parse_task_handoff_task(&message.content)
                .unwrap_or_else(|| message.content.clone());

            let outcome = assign_session_in_dir_with_runner_program(
                db,
                cfg,
                &lead.id,
                &task,
                agent_type,
                use_worktree,
                &repo_root,
                &runner_program,
                None,
                SessionGrouping::default(),
            )
            .await?;

            if outcome.session_id == delegate.id {
                continue;
            }

            let _ = db.mark_message_read(message.id)?;
            outcomes.push(RebalanceOutcome {
                from_session_id: delegate.id.clone(),
                message_id: message.id,
                task,
                session_id: outcome.session_id,
                action: outcome.action,
            });
        }
    }

    Ok(outcomes)
}

pub async fn stop_session(db: &StateStore, id: &str) -> Result<()> {
    stop_session_with_options(db, id, true).await
}

#[derive(Debug, Clone, Default, Serialize, PartialEq)]
pub struct BudgetEnforcementOutcome {
    pub token_budget_exceeded: bool,
    pub cost_budget_exceeded: bool,
    pub profile_token_budget_exceeded: bool,
    pub paused_sessions: Vec<String>,
}

impl BudgetEnforcementOutcome {
    pub fn hard_limit_exceeded(&self) -> bool {
        self.token_budget_exceeded
            || self.cost_budget_exceeded
            || self.profile_token_budget_exceeded
    }
}

pub fn enforce_budget_hard_limits(
    db: &StateStore,
    cfg: &Config,
) -> Result<BudgetEnforcementOutcome> {
    let sessions = db.list_sessions()?;
    let total_tokens = sessions
        .iter()
        .map(|session| session.metrics.tokens_used)
        .sum::<u64>();
    let total_cost = sessions
        .iter()
        .map(|session| session.metrics.cost_usd)
        .sum::<f64>();

    let mut outcome = BudgetEnforcementOutcome {
        token_budget_exceeded: cfg.token_budget > 0 && total_tokens >= cfg.token_budget,
        cost_budget_exceeded: cfg.cost_budget_usd > 0.0 && total_cost >= cfg.cost_budget_usd,
        profile_token_budget_exceeded: false,
        paused_sessions: Vec::new(),
    };

    let mut sessions_to_pause = HashSet::new();

    if outcome.token_budget_exceeded || outcome.cost_budget_exceeded {
        for session in sessions.iter().filter(|session| {
            matches!(
                session.state,
                SessionState::Pending | SessionState::Running | SessionState::Idle
            )
        }) {
            sessions_to_pause.insert(session.id.clone());
        }
    }

    for session in sessions.iter().filter(|session| {
        matches!(
            session.state,
            SessionState::Pending | SessionState::Running | SessionState::Idle
        )
    }) {
        let Some(profile) = db.get_session_profile(&session.id)? else {
            continue;
        };
        let Some(token_budget) = profile.token_budget else {
            continue;
        };
        if token_budget > 0 && session.metrics.tokens_used >= token_budget {
            outcome.profile_token_budget_exceeded = true;
            sessions_to_pause.insert(session.id.clone());
        }
    }

    if !outcome.hard_limit_exceeded() {
        return Ok(outcome);
    }

    for session in sessions.into_iter().filter(|session| {
        sessions_to_pause.contains(&session.id)
            && matches!(
                session.state,
                SessionState::Pending | SessionState::Running | SessionState::Idle
            )
    }) {
        stop_session_recorded(db, &session, false)?;
        outcome.paused_sessions.push(session.id);
    }

    Ok(outcome)
}

#[derive(Debug, Clone, Default, Serialize, PartialEq)]
pub struct ConflictEnforcementOutcome {
    pub strategy: crate::config::ConflictResolutionStrategy,
    pub created_incidents: usize,
    pub resolved_incidents: usize,
    pub paused_sessions: Vec<String>,
}

pub fn enforce_conflict_resolution(
    db: &StateStore,
    cfg: &Config,
) -> Result<ConflictEnforcementOutcome> {
    let mut outcome = ConflictEnforcementOutcome {
        strategy: cfg.conflict_resolution.strategy,
        created_incidents: 0,
        resolved_incidents: 0,
        paused_sessions: Vec::new(),
    };

    if !cfg.conflict_resolution.enabled {
        return Ok(outcome);
    }

    let sessions = db.list_sessions()?;
    let sessions_by_id: HashMap<_, _> = sessions
        .iter()
        .cloned()
        .map(|session| (session.id.clone(), session))
        .collect();

    let active_sessions: Vec<_> = sessions
        .into_iter()
        .filter(|session| {
            matches!(
                session.state,
                SessionState::Pending
                    | SessionState::Running
                    | SessionState::Idle
                    | SessionState::Stale
            )
        })
        .collect();

    let mut latest_activity_by_path: BTreeMap<String, Vec<super::FileActivityEntry>> =
        BTreeMap::new();
    for session in &active_sessions {
        let mut seen_paths = HashSet::new();
        for entry in db.list_file_activity(&session.id, 64)? {
            if seen_paths.insert(entry.path.clone()) {
                latest_activity_by_path
                    .entry(entry.path.clone())
                    .or_default()
                    .push(entry);
            }
        }
    }

    let mut paused_once = HashSet::new();

    for (path, mut entries) in latest_activity_by_path {
        entries.retain(|entry| !matches!(entry.action, super::FileActivityAction::Read));
        if entries.len() < 2 {
            continue;
        }

        entries.sort_by_key(|entry| (entry.timestamp, entry.session_id.clone()));
        let latest = entries.last().cloned().expect("entries is not empty");
        for other in entries[..entries.len() - 1].iter() {
            let conflict_key = conflict_incident_key(&path, &latest.session_id, &other.session_id);
            if db.has_open_conflict_incident(&conflict_key)? {
                continue;
            }

            let (active_session_id, paused_session_id, summary) =
                choose_conflict_resolution(&path, &latest, other, cfg.conflict_resolution.strategy);
            let (first_session_id, second_session_id, first_action, second_action) =
                if latest.session_id <= other.session_id {
                    (
                        latest.session_id.clone(),
                        other.session_id.clone(),
                        latest.action.clone(),
                        other.action.clone(),
                    )
                } else {
                    (
                        other.session_id.clone(),
                        latest.session_id.clone(),
                        other.action.clone(),
                        latest.action.clone(),
                    )
                };

            db.upsert_conflict_incident(
                &conflict_key,
                &path,
                &first_session_id,
                &second_session_id,
                &active_session_id,
                &paused_session_id,
                &first_action,
                &second_action,
                conflict_strategy_label(cfg.conflict_resolution.strategy),
                &summary,
            )?;

            if paused_once.insert(paused_session_id.clone()) {
                if let Some(session) = sessions_by_id.get(&paused_session_id) {
                    if matches!(
                        session.state,
                        SessionState::Pending
                            | SessionState::Running
                            | SessionState::Idle
                            | SessionState::Stale
                    ) {
                        stop_session_recorded(db, session, false)?;
                        outcome.paused_sessions.push(paused_session_id.clone());
                    }
                }
            }

            comms::send(
                db,
                &active_session_id,
                &paused_session_id,
                &MessageType::Conflict {
                    file: path.clone(),
                    description: summary.clone(),
                },
            )?;

            db.insert_decision(
                &paused_session_id,
                &format!("Pause work due to conflict on {path}"),
                &[
                    format!("Keep {active_session_id} active"),
                    "Continue concurrently".to_string(),
                ],
                &summary,
            )?;

            if cfg.conflict_resolution.notify_lead {
                if let Some(lead_session_id) = db.latest_task_handoff_source(&paused_session_id)? {
                    if lead_session_id != paused_session_id && lead_session_id != active_session_id
                    {
                        comms::send(
                            db,
                            &paused_session_id,
                            &lead_session_id,
                            &MessageType::Conflict {
                                file: path.clone(),
                                description: format!(
                                    "{} | delegate {} paused",
                                    summary, paused_session_id
                                ),
                            },
                        )?;
                    }
                }
            }

            outcome.created_incidents += 1;
        }
    }

    Ok(outcome)
}

fn conflict_incident_key(path: &str, session_a: &str, session_b: &str) -> String {
    let (first, second) = if session_a <= session_b {
        (session_a, session_b)
    } else {
        (session_b, session_a)
    };
    format!("{path}::{first}::{second}")
}

fn conflict_strategy_label(strategy: crate::config::ConflictResolutionStrategy) -> &'static str {
    match strategy {
        crate::config::ConflictResolutionStrategy::Escalate => "escalate",
        crate::config::ConflictResolutionStrategy::LastWriteWins => "last_write_wins",
        crate::config::ConflictResolutionStrategy::Merge => "merge",
    }
}

fn choose_conflict_resolution(
    path: &str,
    latest: &super::FileActivityEntry,
    other: &super::FileActivityEntry,
    strategy: crate::config::ConflictResolutionStrategy,
) -> (String, String, String) {
    match strategy {
        crate::config::ConflictResolutionStrategy::Escalate => (
            other.session_id.clone(),
            latest.session_id.clone(),
            format!(
                "Escalated overlap on {path}; paused later session {} while {} stays active",
                latest.session_id, other.session_id
            ),
        ),
        crate::config::ConflictResolutionStrategy::LastWriteWins => (
            latest.session_id.clone(),
            other.session_id.clone(),
            format!(
                "Applied last-write-wins on {path}; kept later session {} active and paused {}",
                latest.session_id, other.session_id
            ),
        ),
        crate::config::ConflictResolutionStrategy::Merge => (
            other.session_id.clone(),
            latest.session_id.clone(),
            format!(
                "Queued manual merge on {path}; paused later session {} until merge review against {}",
                latest.session_id, other.session_id
            ),
        ),
    }
}

pub fn record_tool_call(
    db: &StateStore,
    session_id: &str,
    tool_name: &str,
    input_summary: &str,
    output_summary: &str,
    duration_ms: u64,
) -> Result<ToolLogEntry> {
    let session = db
        .get_session(session_id)?
        .ok_or_else(|| anyhow::anyhow!("Session not found: {session_id}"))?;

    let event = ToolCallEvent::new(
        session.id.clone(),
        tool_name,
        input_summary,
        output_summary,
        duration_ms,
    );
    let entry = log_tool_call(db, &event)?;
    db.increment_tool_calls(&session.id)?;

    Ok(entry)
}

pub fn query_tool_calls(
    db: &StateStore,
    session_id: &str,
    page: u64,
    page_size: u64,
) -> Result<ToolLogPage> {
    let session = db
        .get_session(session_id)?
        .ok_or_else(|| anyhow::anyhow!("Session not found: {session_id}"))?;

    ToolLogger::new(db).query(&session.id, page, page_size)
}

pub async fn resume_session(db: &StateStore, cfg: &Config, id: &str) -> Result<String> {
    resume_session_with_program(db, cfg, id, None).await
}

async fn resume_session_with_program(
    db: &StateStore,
    _cfg: &Config,
    id: &str,
    runner_executable_override: Option<&Path>,
) -> Result<String> {
    let session = resolve_session(db, id)?;

    if session.state == SessionState::Completed {
        anyhow::bail!("Completed sessions cannot be resumed: {}", session.id);
    }

    if session.state == SessionState::Running {
        anyhow::bail!("Session is already running: {}", session.id);
    }

    db.update_state_and_pid(&session.id, &SessionState::Pending, None)?;
    if let Some(worktree) = session.worktree.as_ref() {
        if let Err(error) = worktree::sync_shared_dependency_dirs(worktree) {
            tracing::warn!(
                "Shared dependency cache sync warning for resumed session {}: {error}",
                session.id
            );
        }
    }
    let runner_executable = match runner_executable_override {
        Some(program) => program.to_path_buf(),
        None => std::env::current_exe().context("Failed to resolve ECC executable path")?,
    };
    spawn_session_runner_for_program(
        &session.task,
        &session.id,
        &session.agent_type,
        &session.working_dir,
        &runner_executable,
    )
    .await
    .with_context(|| format!("Failed to resume session {}", session.id))?;
    Ok(session.id)
}

async fn assign_session_in_dir_with_runner_program(
    db: &StateStore,
    cfg: &Config,
    lead_id: &str,
    task: &str,
    agent_type: &str,
    use_worktree: bool,
    repo_root: &Path,
    runner_program: &Path,
    profile_name: Option<&str>,
    grouping: SessionGrouping,
) -> Result<AssignmentOutcome> {
    let lead = resolve_session(db, lead_id)?;
    let inherited_grouping = SessionGrouping {
        project: grouping
            .project
            .or_else(|| normalize_group_label(&lead.project)),
        task_group: grouping
            .task_group
            .or_else(|| normalize_group_label(&lead.task_group)),
    };
    let delegates = direct_delegate_sessions(db, cfg, &lead, agent_type)?;
    let delegate_handoff_backlog = delegates
        .iter()
        .map(|session| {
            db.unread_task_handoff_count(&session.id)
                .map(|count| (session.id.clone(), count))
        })
        .collect::<Result<std::collections::HashMap<_, _>>>()?;

    if let Some(idle_delegate) = delegates
        .iter()
        .filter(|session| {
            session.state == SessionState::Idle
                && delegate_handoff_backlog
                    .get(&session.id)
                    .copied()
                    .unwrap_or(0)
                    == 0
        })
        .max_by_key(|session| delegate_selection_key(db, session, task))
    {
        send_task_handoff(db, &lead, &idle_delegate.id, task, "reused idle delegate")?;
        return Ok(AssignmentOutcome {
            session_id: idle_delegate.id.clone(),
            action: AssignmentAction::ReusedIdle,
        });
    }

    if delegates.len() < cfg.max_parallel_sessions {
        let session_id = queue_session_in_dir_with_runner_program(
            db,
            cfg,
            task,
            agent_type,
            use_worktree,
            repo_root,
            runner_program,
            profile_name,
            Some(&lead.id),
            inherited_grouping.clone(),
        )
        .await?;
        send_task_handoff(db, &lead, &session_id, task, "spawned new delegate")?;
        return Ok(AssignmentOutcome {
            session_id,
            action: AssignmentAction::Spawned,
        });
    }

    if let Some(_idle_delegate) = delegates
        .iter()
        .filter(|session| session.state == SessionState::Idle)
        .min_by_key(|session| {
            (
                delegate_handoff_backlog
                    .get(&session.id)
                    .copied()
                    .unwrap_or(0),
                session.updated_at,
            )
        })
    {
        return Ok(AssignmentOutcome {
            session_id: lead.id.clone(),
            action: AssignmentAction::DeferredSaturated,
        });
    }

    if let Some(active_delegate) = delegates
        .iter()
        .filter(|session| matches!(session.state, SessionState::Running | SessionState::Pending))
        .max_by_key(|session| {
            (
                graph_context_match_score(db, &session.id, task),
                -(delegate_handoff_backlog
                    .get(&session.id)
                    .copied()
                    .unwrap_or(0) as i64),
                -session.updated_at.timestamp_millis(),
            )
        })
    {
        if delegate_handoff_backlog
            .get(&active_delegate.id)
            .copied()
            .unwrap_or(0)
            > 0
        {
            return Ok(AssignmentOutcome {
                session_id: lead.id.clone(),
                action: AssignmentAction::DeferredSaturated,
            });
        }

        send_task_handoff(
            db,
            &lead,
            &active_delegate.id,
            task,
            "reused active delegate at capacity",
        )?;
        return Ok(AssignmentOutcome {
            session_id: active_delegate.id.clone(),
            action: AssignmentAction::ReusedActive,
        });
    }

    let session_id = queue_session_in_dir_with_runner_program(
        db,
        cfg,
        task,
        agent_type,
        use_worktree,
        repo_root,
        runner_program,
        profile_name,
        Some(&lead.id),
        inherited_grouping,
    )
    .await?;
    send_task_handoff(db, &lead, &session_id, task, "spawned fallback delegate")?;
    Ok(AssignmentOutcome {
        session_id,
        action: AssignmentAction::Spawned,
    })
}

fn collect_delegation_descendants(
    db: &StateStore,
    session_id: &str,
    remaining_depth: usize,
    current_depth: usize,
    handoff_backlog: &std::collections::HashMap<String, usize>,
    visited: &mut HashSet<String>,
    descendants: &mut Vec<DelegatedSessionSummary>,
) -> Result<()> {
    if remaining_depth == 0 {
        return Ok(());
    }

    for child_id in db.delegated_children(session_id, 50)? {
        if !visited.insert(child_id.clone()) {
            continue;
        }

        let Some(session) = db.get_session(&child_id)? else {
            continue;
        };

        descendants.push(DelegatedSessionSummary {
            depth: current_depth,
            handoff_backlog: handoff_backlog.get(&child_id).copied().unwrap_or(0),
            session,
        });

        collect_delegation_descendants(
            db,
            &child_id,
            remaining_depth.saturating_sub(1),
            current_depth + 1,
            handoff_backlog,
            visited,
            descendants,
        )?;
    }

    Ok(())
}

pub async fn cleanup_session_worktree(db: &StateStore, id: &str) -> Result<()> {
    let session = resolve_session(db, id)?;

    if session.state == SessionState::Running {
        stop_session_with_options(db, &session.id, true).await?;
        db.clear_worktree(&session.id)?;
        return Ok(());
    }

    if let Some(worktree) = session.worktree.as_ref() {
        crate::worktree::remove(worktree)?;
        db.clear_worktree(&session.id)?;
    }

    Ok(())
}

#[derive(Debug, Clone, Serialize)]
pub struct WorktreeMergeOutcome {
    pub session_id: String,
    pub branch: String,
    pub base_branch: String,
    pub already_up_to_date: bool,
    pub cleaned_worktree: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct WorktreeRebaseOutcome {
    pub session_id: String,
    pub branch: String,
    pub base_branch: String,
    pub already_up_to_date: bool,
}

pub async fn merge_session_worktree(
    db: &StateStore,
    id: &str,
    cleanup_worktree: bool,
) -> Result<WorktreeMergeOutcome> {
    let session = resolve_session(db, id)?;

    if matches!(
        session.state,
        SessionState::Pending | SessionState::Running | SessionState::Idle | SessionState::Stale
    ) {
        anyhow::bail!(
            "Cannot merge active session {} while it is {}",
            session.id,
            session.state
        );
    }

    let worktree = session
        .worktree
        .clone()
        .ok_or_else(|| anyhow::anyhow!("Session {} has no attached worktree", session.id))?;
    let outcome = crate::worktree::merge_into_base(&worktree)?;

    if cleanup_worktree {
        crate::worktree::remove(&worktree)?;
        db.clear_worktree(&session.id)?;
    }

    Ok(WorktreeMergeOutcome {
        session_id: session.id,
        branch: outcome.branch,
        base_branch: outcome.base_branch,
        already_up_to_date: outcome.already_up_to_date,
        cleaned_worktree: cleanup_worktree,
    })
}

pub async fn rebase_session_worktree(db: &StateStore, id: &str) -> Result<WorktreeRebaseOutcome> {
    let session = resolve_session(db, id)?;

    if matches!(
        session.state,
        SessionState::Pending | SessionState::Running | SessionState::Idle | SessionState::Stale
    ) {
        anyhow::bail!(
            "Cannot rebase active session {} while it is {}",
            session.id,
            session.state
        );
    }

    let worktree = session
        .worktree
        .clone()
        .ok_or_else(|| anyhow::anyhow!("Session {} has no attached worktree", session.id))?;
    let outcome = crate::worktree::rebase_onto_base(&worktree)?;

    Ok(WorktreeRebaseOutcome {
        session_id: session.id,
        branch: outcome.branch,
        base_branch: outcome.base_branch,
        already_up_to_date: outcome.already_up_to_date,
    })
}

#[derive(Debug, Clone, Serialize)]
pub struct WorktreeMergeFailure {
    pub session_id: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct WorktreeBulkMergeOutcome {
    pub merged: Vec<WorktreeMergeOutcome>,
    pub rebased: Vec<WorktreeRebaseOutcome>,
    pub active_with_worktree_ids: Vec<String>,
    pub conflicted_session_ids: Vec<String>,
    pub dirty_worktree_ids: Vec<String>,
    pub blocked_by_queue_session_ids: Vec<String>,
    pub failures: Vec<WorktreeMergeFailure>,
}

pub async fn merge_ready_worktrees(
    db: &StateStore,
    cleanup_worktree: bool,
) -> Result<WorktreeBulkMergeOutcome> {
    if cleanup_worktree {
        return process_merge_queue(db).await;
    }

    merge_ready_worktrees_one_pass(db, cleanup_worktree).await
}

pub async fn process_merge_queue(db: &StateStore) -> Result<WorktreeBulkMergeOutcome> {
    let mut merged = Vec::new();
    let mut rebased = Vec::new();
    let mut failures = Vec::new();
    let mut attempted_rebase_heads = BTreeMap::<String, String>::new();

    loop {
        let report = build_merge_queue(db)?;
        let mut merged_any = false;

        for entry in &report.ready_entries {
            match merge_session_worktree(db, &entry.session_id, true).await {
                Ok(outcome) => {
                    merged.push(outcome);
                    merged_any = true;
                }
                Err(error) => failures.push(WorktreeMergeFailure {
                    session_id: entry.session_id.clone(),
                    reason: error.to_string(),
                }),
            }
        }

        if merged_any {
            continue;
        }

        let mut rebased_any = false;
        for entry in &report.blocked_entries {
            if !can_auto_rebase_merge_queue_entry(entry) {
                continue;
            }

            let session = resolve_session(db, &entry.session_id)?;
            let Some(worktree) = session.worktree.clone() else {
                continue;
            };
            let base_head = crate::worktree::branch_head_oid(&worktree, &worktree.base_branch)?;
            if attempted_rebase_heads
                .get(&entry.session_id)
                .is_some_and(|last_head| last_head == &base_head)
            {
                continue;
            }
            attempted_rebase_heads.insert(entry.session_id.clone(), base_head);

            match rebase_session_worktree(db, &entry.session_id).await {
                Ok(outcome) => {
                    rebased.push(outcome);
                    rebased_any = true;
                    break;
                }
                Err(error) => failures.push(WorktreeMergeFailure {
                    session_id: entry.session_id.clone(),
                    reason: error.to_string(),
                }),
            }
        }

        if rebased_any {
            continue;
        }

        let (
            active_with_worktree_ids,
            conflicted_session_ids,
            dirty_worktree_ids,
            blocked_by_queue_session_ids,
        ) = classify_merge_queue_report(&report);

        return Ok(WorktreeBulkMergeOutcome {
            merged,
            rebased,
            active_with_worktree_ids,
            conflicted_session_ids,
            dirty_worktree_ids,
            blocked_by_queue_session_ids,
            failures,
        });
    }
}

async fn merge_ready_worktrees_one_pass(
    db: &StateStore,
    cleanup_worktree: bool,
) -> Result<WorktreeBulkMergeOutcome> {
    let sessions = db.list_sessions()?;
    let mut merged = Vec::new();
    let mut active_with_worktree_ids = Vec::new();
    let mut conflicted_session_ids = Vec::new();
    let mut dirty_worktree_ids = Vec::new();
    let mut failures = Vec::new();

    for session in sessions {
        let Some(worktree) = session.worktree.clone() else {
            continue;
        };

        if matches!(
            session.state,
            SessionState::Pending
                | SessionState::Running
                | SessionState::Idle
                | SessionState::Stale
        ) {
            active_with_worktree_ids.push(session.id);
            continue;
        }

        match crate::worktree::merge_readiness(&worktree) {
            Ok(readiness)
                if readiness.status == crate::worktree::MergeReadinessStatus::Conflicted =>
            {
                conflicted_session_ids.push(session.id);
                continue;
            }
            Ok(_) => {}
            Err(error) => {
                failures.push(WorktreeMergeFailure {
                    session_id: session.id,
                    reason: error.to_string(),
                });
                continue;
            }
        }

        match crate::worktree::has_uncommitted_changes(&worktree) {
            Ok(true) => {
                dirty_worktree_ids.push(session.id);
                continue;
            }
            Ok(false) => {}
            Err(error) => {
                failures.push(WorktreeMergeFailure {
                    session_id: session.id,
                    reason: error.to_string(),
                });
                continue;
            }
        }

        match merge_session_worktree(db, &session.id, cleanup_worktree).await {
            Ok(outcome) => merged.push(outcome),
            Err(error) => failures.push(WorktreeMergeFailure {
                session_id: session.id,
                reason: error.to_string(),
            }),
        }
    }

    Ok(WorktreeBulkMergeOutcome {
        merged,
        rebased: Vec::new(),
        active_with_worktree_ids,
        conflicted_session_ids,
        dirty_worktree_ids,
        blocked_by_queue_session_ids: Vec::new(),
        failures,
    })
}

#[derive(Debug, Clone, Serialize)]
pub struct WorktreePruneOutcome {
    pub cleaned_session_ids: Vec<String>,
    pub active_with_worktree_ids: Vec<String>,
    pub retained_session_ids: Vec<String>,
}

pub async fn prune_inactive_worktrees(
    db: &StateStore,
    cfg: &Config,
) -> Result<WorktreePruneOutcome> {
    let sessions = db.list_sessions()?;
    let mut cleaned_session_ids = Vec::new();
    let mut active_with_worktree_ids = Vec::new();
    let mut retained_session_ids = Vec::new();
    let retention = chrono::Duration::seconds(cfg.worktree_retention_secs as i64);
    let now = chrono::Utc::now();

    for session in sessions {
        let Some(_) = session.worktree.as_ref() else {
            continue;
        };

        if matches!(
            session.state,
            SessionState::Pending | SessionState::Running | SessionState::Idle
        ) {
            active_with_worktree_ids.push(session.id);
            continue;
        }

        if retention > chrono::Duration::zero()
            && now.signed_duration_since(session.last_heartbeat_at) < retention
        {
            retained_session_ids.push(session.id);
            continue;
        }

        cleanup_session_worktree(db, &session.id).await?;
        cleaned_session_ids.push(session.id);
    }

    Ok(WorktreePruneOutcome {
        cleaned_session_ids,
        active_with_worktree_ids,
        retained_session_ids,
    })
}

#[derive(Debug, Clone, Serialize)]
pub struct MergeQueueBlocker {
    pub session_id: String,
    pub branch: String,
    pub state: SessionState,
    pub conflicts: Vec<String>,
    pub summary: String,
    pub conflicting_patch_preview: Option<String>,
    pub blocker_patch_preview: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct MergeQueueEntry {
    pub session_id: String,
    pub task: String,
    pub project: String,
    pub task_group: String,
    pub branch: String,
    pub base_branch: String,
    pub state: SessionState,
    pub worktree_health: worktree::WorktreeHealth,
    pub dirty: bool,
    pub queue_position: Option<usize>,
    pub ready_to_merge: bool,
    pub blocked_by: Vec<MergeQueueBlocker>,
    pub suggested_action: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct MergeQueueReport {
    pub ready_entries: Vec<MergeQueueEntry>,
    pub blocked_entries: Vec<MergeQueueEntry>,
}

pub fn build_merge_queue(db: &StateStore) -> Result<MergeQueueReport> {
    let mut sessions = db
        .list_sessions()?
        .into_iter()
        .filter(|session| session.worktree.is_some())
        .collect::<Vec<_>>();
    sessions.sort_by(|left, right| {
        merge_queue_priority(left)
            .cmp(&merge_queue_priority(right))
            .then_with(|| left.project.cmp(&right.project))
            .then_with(|| left.task_group.cmp(&right.task_group))
            .then_with(|| left.updated_at.cmp(&right.updated_at))
            .then_with(|| left.id.cmp(&right.id))
    });

    let mut entries = Vec::new();
    let mut mergeable_sessions = Vec::<Session>::new();
    let mut next_position = 1usize;

    for session in sessions {
        let Some(worktree) = session.worktree.clone() else {
            continue;
        };

        let worktree_health = worktree::health(&worktree)?;
        let dirty = worktree::has_uncommitted_changes(&worktree)?;
        let mut blocked_by = Vec::new();

        if matches!(
            session.state,
            SessionState::Pending
                | SessionState::Running
                | SessionState::Idle
                | SessionState::Stale
        ) {
            blocked_by.push(MergeQueueBlocker {
                session_id: session.id.clone(),
                branch: worktree.branch.clone(),
                state: session.state.clone(),
                conflicts: Vec::new(),
                summary: format!("session is still {}", session_state_label(&session.state)),
                conflicting_patch_preview: None,
                blocker_patch_preview: None,
            });
        } else if worktree_health == worktree::WorktreeHealth::Conflicted {
            let readiness = worktree::merge_readiness(&worktree)?;
            blocked_by.push(MergeQueueBlocker {
                session_id: session.id.clone(),
                branch: worktree.branch.clone(),
                state: session.state.clone(),
                conflicts: readiness.conflicts,
                summary: readiness.summary,
                conflicting_patch_preview: worktree::diff_patch_preview(&worktree, 18)?,
                blocker_patch_preview: None,
            });
        } else if dirty {
            blocked_by.push(MergeQueueBlocker {
                session_id: session.id.clone(),
                branch: worktree.branch.clone(),
                state: session.state.clone(),
                conflicts: Vec::new(),
                summary: "worktree has uncommitted changes".to_string(),
                conflicting_patch_preview: worktree::diff_patch_preview(&worktree, 18)?,
                blocker_patch_preview: None,
            });
        } else {
            for blocker in &mergeable_sessions {
                let Some(blocker_worktree) = blocker.worktree.as_ref() else {
                    continue;
                };
                let Some(conflict) =
                    worktree::branch_conflict_preview(&worktree, blocker_worktree, 12)?
                else {
                    continue;
                };

                blocked_by.push(MergeQueueBlocker {
                    session_id: blocker.id.clone(),
                    branch: blocker_worktree.branch.clone(),
                    state: blocker.state.clone(),
                    conflicts: conflict.conflicts,
                    summary: format!("merge after {} to avoid branch conflicts", blocker.id),
                    conflicting_patch_preview: conflict.right_patch_preview,
                    blocker_patch_preview: conflict.left_patch_preview,
                });
            }
        }

        let ready_to_merge = blocked_by.is_empty();
        let queue_position = if ready_to_merge {
            let position = next_position;
            next_position += 1;
            mergeable_sessions.push(session.clone());
            Some(position)
        } else {
            None
        };

        let suggested_action = if let Some(position) = queue_position {
            format!("merge in queue order #{position}")
        } else if blocked_by
            .iter()
            .any(|blocker| blocker.session_id == session.id)
        {
            blocked_by
                .first()
                .map(|blocker| blocker.summary.clone())
                .unwrap_or_else(|| "resolve merge blockers".to_string())
        } else {
            format!(
                "merge after {}",
                blocked_by
                    .iter()
                    .map(|blocker| blocker.session_id.as_str())
                    .collect::<Vec<_>>()
                    .join(", ")
            )
        };

        entries.push(MergeQueueEntry {
            session_id: session.id,
            task: session.task,
            project: session.project,
            task_group: session.task_group,
            branch: worktree.branch,
            base_branch: worktree.base_branch,
            state: session.state,
            worktree_health,
            dirty,
            queue_position,
            ready_to_merge,
            blocked_by,
            suggested_action,
        });
    }

    let mut ready_entries = entries
        .iter()
        .filter(|entry| entry.ready_to_merge)
        .cloned()
        .collect::<Vec<_>>();
    ready_entries.sort_by_key(|entry| entry.queue_position.unwrap_or(usize::MAX));

    let blocked_entries = entries
        .into_iter()
        .filter(|entry| !entry.ready_to_merge)
        .collect::<Vec<_>>();

    Ok(MergeQueueReport {
        ready_entries,
        blocked_entries,
    })
}

fn can_auto_rebase_merge_queue_entry(entry: &MergeQueueEntry) -> bool {
    !entry.ready_to_merge
        && !entry.dirty
        && entry.worktree_health == worktree::WorktreeHealth::Conflicted
        && !entry.blocked_by.is_empty()
        && entry
            .blocked_by
            .iter()
            .all(|blocker| blocker.session_id == entry.session_id)
}

fn classify_merge_queue_report(
    report: &MergeQueueReport,
) -> (Vec<String>, Vec<String>, Vec<String>, Vec<String>) {
    let mut active = Vec::new();
    let mut conflicted = Vec::new();
    let mut dirty = Vec::new();
    let mut queue_blocked = Vec::new();

    for entry in &report.blocked_entries {
        if entry.blocked_by.iter().any(|blocker| {
            blocker.session_id == entry.session_id
                && matches!(
                    blocker.state,
                    SessionState::Pending
                        | SessionState::Running
                        | SessionState::Idle
                        | SessionState::Stale
                )
        }) {
            active.push(entry.session_id.clone());
        } else if entry.dirty {
            dirty.push(entry.session_id.clone());
        } else if entry.worktree_health == worktree::WorktreeHealth::Conflicted {
            conflicted.push(entry.session_id.clone());
        } else {
            queue_blocked.push(entry.session_id.clone());
        }
    }

    (active, conflicted, dirty, queue_blocked)
}

pub async fn delete_session(db: &StateStore, id: &str) -> Result<()> {
    let session = resolve_session(db, id)?;

    if matches!(
        session.state,
        SessionState::Pending | SessionState::Running | SessionState::Idle
    ) {
        anyhow::bail!(
            "Cannot delete active session {} while it is {}",
            session.id,
            session.state
        );
    }

    if let Some(worktree) = session.worktree.as_ref() {
        let _ = crate::worktree::remove(worktree);
    }

    db.delete_session(&session.id)?;
    Ok(())
}

fn agent_program(cfg: &Config, agent_type: &str) -> Result<PathBuf> {
    let harness = HarnessKind::from_agent_type(agent_type);
    let runner_key = SessionHarnessInfo::runner_key(agent_type);
    if let Some(runner) = cfg.harness_runner(&runner_key) {
        let program = runner.program.trim();
        if program.is_empty() {
            anyhow::bail!("Configured harness runner for {runner_key} is missing a program");
        }
        return Ok(PathBuf::from(program));
    }

    match harness {
        HarnessKind::Claude => Ok(PathBuf::from("claude")),
        HarnessKind::Codex => Ok(PathBuf::from("codex")),
        HarnessKind::OpenCode => Ok(PathBuf::from("opencode")),
        HarnessKind::Gemini => Ok(PathBuf::from("gemini")),
        other => anyhow::bail!("Unsupported agent type: {other}"),
    }
}

fn resolve_session(db: &StateStore, id: &str) -> Result<Session> {
    let session = if id == "latest" {
        db.get_latest_session()?
    } else {
        db.get_session(id)?
    };

    session.ok_or_else(|| anyhow::anyhow!("Session not found: {id}"))
}

fn parse_cron_schedule(expr: &str) -> Result<CronSchedule> {
    let trimmed = expr.trim();
    let normalized = match trimmed.split_whitespace().count() {
        5 => format!("0 {trimmed}"),
        6 | 7 => trimmed.to_string(),
        fields => {
            anyhow::bail!(
                "invalid cron expression `{trimmed}`: expected 5, 6, or 7 fields but found {fields}"
            )
        }
    };
    CronSchedule::from_str(&normalized)
        .with_context(|| format!("invalid cron expression `{trimmed}`"))
}

fn next_schedule_run_at(
    expr: &str,
    after: chrono::DateTime<chrono::Utc>,
) -> Result<chrono::DateTime<chrono::Utc>> {
    parse_cron_schedule(expr)?
        .after(&after)
        .next()
        .map(|value| value.with_timezone(&chrono::Utc))
        .ok_or_else(|| anyhow::anyhow!("cron expression `{expr}` did not yield a future run time"))
}

pub async fn run_session(
    cfg: &Config,
    session_id: &str,
    task: &str,
    agent_type: &str,
    working_dir: &Path,
) -> Result<()> {
    let db = StateStore::open(&cfg.db_path)?;
    let session = resolve_session(&db, session_id)?;

    if session.state != SessionState::Pending {
        tracing::info!(
            "Skipping run_session for {} because state is {}",
            session_id,
            session.state
        );
        return Ok(());
    }

    let agent_program = agent_program(cfg, agent_type)?;
    let profile = db.get_session_profile(session_id)?;
    let command = build_agent_command(
        cfg,
        agent_type,
        &agent_program,
        task,
        session_id,
        working_dir,
        profile.as_ref(),
    );
    capture_command_output(
        cfg.db_path.clone(),
        session_id.to_string(),
        command,
        SessionOutputStore::default(),
        std::time::Duration::from_secs(cfg.heartbeat_interval_secs),
    )
    .await?;
    Ok(())
}

pub async fn activate_pending_worktree_sessions(
    db: &StateStore,
    cfg: &Config,
) -> Result<Vec<String>> {
    activate_pending_worktree_sessions_with(
        db,
        cfg,
        |cfg, session_id, task, agent_type, cwd| async move {
            tokio::spawn(async move {
                if let Err(error) = run_session(&cfg, &session_id, &task, &agent_type, &cwd).await {
                    tracing::error!(
                        "Failed to start queued worktree session {}: {error}",
                        session_id
                    );
                }
            });
            Ok(())
        },
    )
    .await
}

async fn activate_pending_worktree_sessions_with<F, Fut>(
    db: &StateStore,
    cfg: &Config,
    spawn: F,
) -> Result<Vec<String>>
where
    F: Fn(Config, String, String, String, PathBuf) -> Fut,
    Fut: std::future::Future<Output = Result<()>>,
{
    let mut available_slots = cfg
        .max_parallel_worktrees
        .saturating_sub(attached_worktree_count(db)?);
    if available_slots == 0 {
        return Ok(Vec::new());
    }

    let mut started = Vec::new();
    for request in db.pending_worktree_queue(available_slots)? {
        let Some(session) = db.get_session(&request.session_id)? else {
            db.dequeue_pending_worktree(&request.session_id)?;
            continue;
        };

        if session.worktree.is_some()
            || session.pid.is_some()
            || session.state != SessionState::Pending
        {
            db.dequeue_pending_worktree(&session.id)?;
            continue;
        }

        let worktree =
            match worktree::create_for_session_in_repo(&session.id, cfg, &request.repo_root) {
                Ok(worktree) => worktree,
                Err(error) => {
                    db.dequeue_pending_worktree(&session.id)?;
                    db.update_state(&session.id, &SessionState::Failed)?;
                    tracing::warn!(
                        "Failed to create queued worktree for session {}: {error}",
                        session.id
                    );
                    continue;
                }
            };

        if let Err(error) = db.attach_worktree(&session.id, &worktree) {
            let _ = worktree::remove(&worktree);
            db.dequeue_pending_worktree(&session.id)?;
            db.update_state(&session.id, &SessionState::Failed)?;
            return Err(error.context(format!(
                "Failed to attach queued worktree for session {}",
                session.id
            )));
        }

        if let Err(error) = spawn(
            cfg.clone(),
            session.id.clone(),
            session.task.clone(),
            session.agent_type.clone(),
            worktree.path.clone(),
        )
        .await
        {
            let _ = worktree::remove(&worktree);
            let _ = db.clear_worktree_to_dir(&session.id, &request.repo_root);
            db.dequeue_pending_worktree(&session.id)?;
            db.update_state(&session.id, &SessionState::Failed)?;
            tracing::warn!(
                "Failed to start queued worktree session {}: {error}",
                session.id
            );
            continue;
        }

        db.dequeue_pending_worktree(&session.id)?;
        started.push(session.id);
        available_slots = available_slots.saturating_sub(1);
        if available_slots == 0 {
            break;
        }
    }

    Ok(started)
}

async fn queue_session_in_dir(
    db: &StateStore,
    cfg: &Config,
    task: &str,
    agent_type: &str,
    use_worktree: bool,
    repo_root: &Path,
    profile_name: Option<&str>,
    inherited_profile_session_id: Option<&str>,
    grouping: SessionGrouping,
) -> Result<String> {
    queue_session_in_dir_with_runner_program(
        db,
        cfg,
        task,
        agent_type,
        use_worktree,
        repo_root,
        &std::env::current_exe().context("Failed to resolve ECC executable path")?,
        profile_name,
        inherited_profile_session_id,
        grouping,
    )
    .await
}

async fn queue_session_in_dir_with_runner_program(
    db: &StateStore,
    cfg: &Config,
    task: &str,
    agent_type: &str,
    use_worktree: bool,
    repo_root: &Path,
    runner_program: &Path,
    profile_name: Option<&str>,
    inherited_profile_session_id: Option<&str>,
    grouping: SessionGrouping,
) -> Result<String> {
    let profile = resolve_launch_profile(db, cfg, profile_name, inherited_profile_session_id)?;
    let canonical_agent_type = HarnessKind::canonical_agent_type(agent_type);
    queue_session_with_resolved_profile_and_runner_program(
        db,
        cfg,
        task,
        &canonical_agent_type,
        use_worktree,
        repo_root,
        runner_program,
        profile,
        grouping,
    )
    .await
}

async fn queue_session_with_resolved_profile_and_runner_program(
    db: &StateStore,
    cfg: &Config,
    task: &str,
    agent_type: &str,
    use_worktree: bool,
    repo_root: &Path,
    runner_program: &Path,
    profile: Option<SessionAgentProfile>,
    grouping: SessionGrouping,
) -> Result<String> {
    let effective_agent_type = profile
        .as_ref()
        .and_then(|profile| profile.agent.as_deref())
        .unwrap_or(agent_type);
    let session = build_session_record(
        db,
        task,
        &effective_agent_type,
        use_worktree,
        cfg,
        repo_root,
        grouping,
    )?;
    db.insert_session(&session)?;
    if let Some(profile) = profile.as_ref() {
        db.upsert_session_profile(&session.id, profile)?;
    }

    if use_worktree && session.worktree.is_none() {
        db.enqueue_pending_worktree(&session.id, repo_root)?;
        return Ok(session.id);
    }

    let working_dir = session
        .worktree
        .as_ref()
        .map(|worktree| worktree.path.as_path())
        .unwrap_or(repo_root);

    match spawn_session_runner_for_program(
        task,
        &session.id,
        &session.agent_type,
        working_dir,
        runner_program,
    )
    .await
    {
        Ok(()) => Ok(session.id),
        Err(error) => {
            db.update_state(&session.id, &SessionState::Failed)?;

            if let Some(worktree) = session.worktree.as_ref() {
                let _ = crate::worktree::remove(worktree);
            }

            Err(error.context(format!("Failed to queue session {}", session.id)))
        }
    }
}

fn build_session_record(
    db: &StateStore,
    task: &str,
    agent_type: &str,
    use_worktree: bool,
    cfg: &Config,
    repo_root: &Path,
    grouping: SessionGrouping,
) -> Result<Session> {
    let canonical_agent_type =
        SessionHarnessInfo::resolve_requested_agent_type(cfg, agent_type, repo_root);
    let id = uuid::Uuid::new_v4().to_string()[..8].to_string();
    let now = chrono::Utc::now();

    let worktree = if use_worktree && attached_worktree_count(db)? < cfg.max_parallel_worktrees {
        Some(worktree::create_for_session_in_repo(&id, cfg, repo_root)?)
    } else {
        None
    };
    let working_dir = worktree
        .as_ref()
        .map(|worktree| worktree.path.clone())
        .unwrap_or_else(|| repo_root.to_path_buf());
    let project = grouping
        .project
        .as_deref()
        .and_then(normalize_group_label)
        .unwrap_or_else(|| default_project_label(repo_root));
    let task_group = grouping
        .task_group
        .as_deref()
        .and_then(normalize_group_label)
        .unwrap_or_else(|| default_task_group_label(task));

    Ok(Session {
        id,
        task: task.to_string(),
        project,
        task_group,
        agent_type: canonical_agent_type,
        working_dir,
        state: SessionState::Pending,
        pid: None,
        worktree,
        created_at: now,
        updated_at: now,
        last_heartbeat_at: now,
        metrics: SessionMetrics::default(),
    })
}

async fn create_session_in_dir(
    db: &StateStore,
    cfg: &Config,
    task: &str,
    agent_type: &str,
    use_worktree: bool,
    repo_root: &Path,
    agent_program: &Path,
) -> Result<String> {
    let session = build_session_record(
        db,
        task,
        agent_type,
        use_worktree,
        cfg,
        repo_root,
        SessionGrouping::default(),
    )?;

    db.insert_session(&session)?;

    if use_worktree && session.worktree.is_none() {
        db.enqueue_pending_worktree(&session.id, repo_root)?;
        return Ok(session.id);
    }

    let working_dir = session
        .worktree
        .as_ref()
        .map(|worktree| worktree.path.as_path())
        .unwrap_or(repo_root);

    match spawn_claude_code(agent_program, task, &session.id, working_dir).await {
        Ok(pid) => {
            db.update_pid(&session.id, Some(pid))?;
            db.update_state(&session.id, &SessionState::Running)?;
            Ok(session.id)
        }
        Err(error) => {
            db.update_state(&session.id, &SessionState::Failed)?;

            if let Some(worktree) = session.worktree.as_ref() {
                let _ = crate::worktree::remove(worktree);
            }

            Err(error.context(format!("Failed to start session {}", session.id)))
        }
    }
}

fn resolve_launch_profile(
    db: &StateStore,
    cfg: &Config,
    explicit_profile_name: Option<&str>,
    inherited_profile_session_id: Option<&str>,
) -> Result<Option<SessionAgentProfile>> {
    let inherited_profile_name = match inherited_profile_session_id {
        Some(session_id) => db
            .get_session_profile(session_id)?
            .map(|profile| profile.profile_name),
        None => None,
    };
    let profile_name = explicit_profile_name
        .map(ToOwned::to_owned)
        .or(inherited_profile_name)
        .or_else(|| cfg.default_agent_profile.clone());

    profile_name
        .as_deref()
        .map(|name| cfg.resolve_agent_profile(name))
        .transpose()
}

fn attached_worktree_count(db: &StateStore) -> Result<usize> {
    Ok(db
        .list_sessions()?
        .into_iter()
        .filter(|session| session.worktree.is_some())
        .count())
}

fn merge_queue_priority(session: &Session) -> (u8, chrono::DateTime<chrono::Utc>) {
    let active_rank = match session.state {
        SessionState::Completed | SessionState::Failed | SessionState::Stopped => 0,
        SessionState::Pending
        | SessionState::Running
        | SessionState::Idle
        | SessionState::Stale => 1,
    };
    (active_rank, session.updated_at)
}

async fn spawn_session_runner(
    task: &str,
    session_id: &str,
    agent_type: &str,
    working_dir: &Path,
) -> Result<()> {
    spawn_session_runner_for_program(
        task,
        session_id,
        agent_type,
        working_dir,
        &std::env::current_exe().context("Failed to resolve ECC executable path")?,
    )
    .await
}

fn direct_delegate_sessions(
    db: &StateStore,
    cfg: &Config,
    lead: &Session,
    agent_type: &str,
) -> Result<Vec<Session>> {
    let resolved_agent_type =
        SessionHarnessInfo::resolve_requested_agent_type(cfg, agent_type, &lead.working_dir);
    let target_harness = HarnessKind::from_agent_type(&resolved_agent_type);
    let mut sessions = Vec::new();
    for child_id in db.delegated_children(&lead.id, 50)? {
        let Some(session) = db.get_session(&child_id)? else {
            continue;
        };

        if target_harness != HarnessKind::Unknown {
            if HarnessKind::from_agent_type(&session.agent_type) != target_harness {
                continue;
            }
        } else if session.agent_type != resolved_agent_type {
            continue;
        }

        if matches!(
            session.state,
            SessionState::Pending | SessionState::Running | SessionState::Idle
        ) {
            sessions.push(session);
        }
    }

    Ok(sessions)
}

fn delegate_selection_key(db: &StateStore, session: &Session, task: &str) -> (usize, i64) {
    (
        graph_context_match_score(db, &session.id, task),
        -session.updated_at.timestamp_millis(),
    )
}

fn graph_context_match_score(db: &StateStore, session_id: &str, task: &str) -> usize {
    graph_context_matched_terms(db, session_id, task).len()
}

fn graph_context_matched_terms(db: &StateStore, session_id: &str, task: &str) -> Vec<String> {
    let terms = graph_match_terms(task);
    if terms.is_empty() {
        return Vec::new();
    }

    let entities = match db.list_context_entities(Some(session_id), None, 48) {
        Ok(entities) => entities,
        Err(_) => return Vec::new(),
    };

    let mut haystacks = Vec::new();
    for entity in entities {
        haystacks.push(entity.name.to_lowercase());
        haystacks.push(entity.summary.to_lowercase());
        if let Some(path) = entity.path.as_ref() {
            haystacks.push(path.to_lowercase());
        }
        for (key, value) in entity.metadata {
            haystacks.push(key.to_lowercase());
            haystacks.push(value.to_lowercase());
        }
    }

    terms
        .into_iter()
        .filter(|term| haystacks.iter().any(|haystack| haystack.contains(term)))
        .collect()
}

fn graph_match_terms(task: &str) -> Vec<String> {
    let mut terms = Vec::new();
    let mut seen = HashSet::new();
    for token in task
        .split(|ch: char| !(ch.is_ascii_alphanumeric() || matches!(ch, '_' | '.' | '-')))
        .map(str::trim)
        .filter(|token| token.len() >= 3)
    {
        let lowered = token.to_ascii_lowercase();
        if seen.insert(lowered.clone()) {
            terms.push(lowered);
        }
    }
    terms
}

fn summarize_backlog_pressure(
    db: &StateStore,
    cfg: &Config,
    agent_type: &str,
    targets: &[(String, usize)],
) -> Result<BacklogPressureSummary> {
    let mut summary = BacklogPressureSummary::default();

    for (session_id, _) in targets {
        let lead = resolve_session(db, session_id)?;
        let delegates = direct_delegate_sessions(db, cfg, &lead, agent_type)?;
        let has_clear_idle_delegate = delegates.iter().any(|delegate| {
            delegate.state == SessionState::Idle
                && db.unread_task_handoff_count(&delegate.id).unwrap_or(0) == 0
        });
        let has_capacity = delegates.len() < cfg.max_parallel_sessions;

        if has_clear_idle_delegate || has_capacity {
            summary.absorbable_sessions += 1;
        } else {
            summary.saturated_sessions += 1;
        }
    }

    Ok(summary)
}

fn send_task_handoff(
    db: &StateStore,
    from_session: &Session,
    to_session_id: &str,
    task: &str,
    routing_reason: &str,
) -> Result<()> {
    let context = format!(
        "Assigned by {} [{}] | cwd {}{} | {}",
        from_session.id,
        from_session.agent_type,
        from_session.working_dir.display(),
        from_session
            .worktree
            .as_ref()
            .map(|worktree| format!(
                " | worktree {} ({})",
                worktree.branch,
                worktree.path.display()
            ))
            .unwrap_or_default(),
        routing_reason
    );

    crate::comms::send(
        db,
        &from_session.id,
        to_session_id,
        &crate::comms::MessageType::TaskHandoff {
            task: task.to_string(),
            context,
            priority: crate::comms::TaskPriority::Normal,
        },
    )
}

pub(crate) fn parse_task_handoff_task(content: &str) -> Option<String> {
    match comms::parse(content) {
        Some(MessageType::TaskHandoff { task, .. }) => Some(task),
        _ => extract_legacy_handoff_task(content),
    }
}

fn extract_legacy_handoff_task(content: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(content).ok()?;
    value
        .get("task")
        .and_then(|task| task.as_str())
        .map(ToOwned::to_owned)
}

async fn spawn_session_runner_for_program(
    task: &str,
    session_id: &str,
    agent_type: &str,
    working_dir: &Path,
    current_exe: &Path,
) -> Result<()> {
    let stderr_log_path = background_runner_stderr_log_path(working_dir, session_id);
    if let Some(parent) = stderr_log_path.parent() {
        std::fs::create_dir_all(parent).with_context(|| {
            format!(
                "Failed to create ECC runner log directory {}",
                parent.display()
            )
        })?;
    }
    let stderr_log = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&stderr_log_path)
        .with_context(|| {
            format!(
                "Failed to open ECC runner stderr log {}",
                stderr_log_path.display()
            )
        })?;

    let mut command = Command::new(current_exe);
    command
        .arg("run-session")
        .arg("--session-id")
        .arg(session_id)
        .arg("--task")
        .arg(task)
        .arg("--agent")
        .arg(agent_type)
        .arg("--cwd")
        .arg(working_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::from(stderr_log));
    configure_background_runner_command(&mut command);

    let child = command
        .spawn()
        .with_context(|| format!("Failed to spawn ECC runner from {}", current_exe.display()))?;

    child
        .id()
        .ok_or_else(|| anyhow::anyhow!("ECC runner did not expose a process id"))?;
    Ok(())
}

fn background_runner_stderr_log_path(working_dir: &Path, session_id: &str) -> PathBuf {
    working_dir
        .join(".claude")
        .join("ecc2")
        .join("logs")
        .join(format!("{session_id}.runner-stderr.log"))
}

#[cfg(windows)]
fn detached_creation_flags() -> u32 {
    const DETACHED_PROCESS: u32 = 0x0000_0008;
    const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
    DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
}

fn configure_background_runner_command(command: &mut Command) {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;

        // Detach the runner from the caller's shell/session so it keeps
        // processing a live harness session after `ecc-tui start` returns.
        unsafe {
            command.as_std_mut().pre_exec(|| {
                if libc::setsid() == -1 {
                    return Err(std::io::Error::last_os_error());
                }
                Ok(())
            });
        }
    }

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;

        command.as_std_mut().creation_flags(detached_creation_flags());
    }
}

fn build_agent_command(
    cfg: &Config,
    agent_type: &str,
    agent_program: &Path,
    task: &str,
    session_id: &str,
    working_dir: &Path,
    profile: Option<&SessionAgentProfile>,
) -> Command {
    let harness = HarnessKind::from_agent_type(agent_type);
    if let Some(runner) = cfg.harness_runner(&SessionHarnessInfo::runner_key(agent_type)) {
        return build_configured_harness_command(
            runner,
            agent_type,
            agent_program,
            task,
            session_id,
            working_dir,
            profile,
        );
    }

    let task = normalize_task_for_harness(harness, task, profile);
    let mut command = Command::new(agent_program);
    apply_shared_harness_runtime_env(&mut command, agent_type, session_id, working_dir, profile);
    match harness {
        HarnessKind::Claude => {
            command
                .arg("--print")
                .arg("--name")
                .arg(format!("ecc-{session_id}"));
            if let Some(profile) = profile {
                if let Some(model) = profile.model.as_ref() {
                    command.arg("--model").arg(model);
                }
                if !profile.allowed_tools.is_empty() {
                    command
                        .arg("--allowed-tools")
                        .arg(profile.allowed_tools.join(","));
                }
                if !profile.disallowed_tools.is_empty() {
                    command
                        .arg("--disallowed-tools")
                        .arg(profile.disallowed_tools.join(","));
                }
                if let Some(permission_mode) = profile.permission_mode.as_ref() {
                    command.arg("--permission-mode").arg(permission_mode);
                }
                for dir in &profile.add_dirs {
                    command.arg("--add-dir").arg(dir);
                }
                if let Some(max_budget_usd) = profile.max_budget_usd {
                    command
                        .arg("--max-budget-usd")
                        .arg(max_budget_usd.to_string());
                }
                if let Some(prompt) = profile.append_system_prompt.as_ref() {
                    command.arg("--append-system-prompt").arg(prompt);
                }
            }
        }
        HarnessKind::Codex => {
            command
                .arg("exec")
                .arg("--skip-git-repo-check")
                .arg("--sandbox")
                .arg("workspace-write")
                .arg("--cd")
                .arg(working_dir)
                .arg("--color")
                .arg("never");
            if let Some(profile) = profile {
                if let Some(model) = profile.model.as_ref() {
                    command.arg("--model").arg(model);
                }
                for dir in &profile.add_dirs {
                    command.arg("--add-dir").arg(dir);
                }
            }
        }
        HarnessKind::OpenCode => {
            command
                .arg("run")
                .arg("--dir")
                .arg(working_dir)
                .arg("--title")
                .arg(format!("ecc-{session_id}"));
            if let Some(profile) = profile {
                if let Some(model) = profile.model.as_ref() {
                    command.arg("--model").arg(model);
                }
            }
        }
        HarnessKind::Gemini => {
            command.arg("-p");
            if let Some(profile) = profile {
                if let Some(model) = profile.model.as_ref() {
                    command.arg("-m").arg(model);
                }
                if !profile.add_dirs.is_empty() {
                    let include_dirs = profile
                        .add_dirs
                        .iter()
                        .map(|dir| dir.to_string_lossy().to_string())
                        .collect::<Vec<_>>()
                        .join(",");
                    command.arg("--include-directories").arg(include_dirs);
                }
            }
        }
        _ => {}
    }
    command
        .arg(task)
        .current_dir(working_dir)
        .stdin(Stdio::null());
    command
}

fn build_configured_harness_command(
    runner: &crate::config::HarnessRunnerConfig,
    agent_type: &str,
    agent_program: &Path,
    task: &str,
    session_id: &str,
    working_dir: &Path,
    profile: Option<&SessionAgentProfile>,
) -> Command {
    let mut command = Command::new(agent_program);
    apply_shared_harness_runtime_env(&mut command, agent_type, session_id, working_dir, profile);
    for (key, value) in &runner.env {
        if !value.trim().is_empty() {
            command.env(key, value);
        }
    }
    for arg in &runner.base_args {
        if !arg.trim().is_empty() {
            command.arg(arg);
        }
    }
    if let Some(flag) = runner.cwd_flag.as_deref() {
        command.arg(flag).arg(working_dir);
    }
    if let Some(flag) = runner.session_name_flag.as_deref() {
        command.arg(flag).arg(format!("ecc-{session_id}"));
    }
    if let Some(profile) = profile {
        if let (Some(flag), Some(model)) = (runner.model_flag.as_deref(), profile.model.as_ref()) {
            command.arg(flag).arg(model);
        }
        if let Some(flag) = runner.add_dir_flag.as_deref() {
            for dir in &profile.add_dirs {
                command.arg(flag).arg(dir);
            }
        }
        if let Some(flag) = runner.include_directories_flag.as_deref() {
            if !profile.add_dirs.is_empty() {
                let include_dirs = profile
                    .add_dirs
                    .iter()
                    .map(|dir| dir.to_string_lossy().to_string())
                    .collect::<Vec<_>>()
                    .join(",");
                command.arg(flag).arg(include_dirs);
            }
        }
        if let Some(flag) = runner.allowed_tools_flag.as_deref() {
            if !profile.allowed_tools.is_empty() {
                command.arg(flag).arg(profile.allowed_tools.join(","));
            }
        }
        if let Some(flag) = runner.disallowed_tools_flag.as_deref() {
            if !profile.disallowed_tools.is_empty() {
                command.arg(flag).arg(profile.disallowed_tools.join(","));
            }
        }
        if let (Some(flag), Some(permission_mode)) = (
            runner.permission_mode_flag.as_deref(),
            profile.permission_mode.as_ref(),
        ) {
            command.arg(flag).arg(permission_mode);
        }
        if let (Some(flag), Some(max_budget_usd)) = (
            runner.max_budget_usd_flag.as_deref(),
            profile.max_budget_usd,
        ) {
            command.arg(flag).arg(max_budget_usd.to_string());
        }
        if let (Some(flag), Some(prompt)) = (
            runner.append_system_prompt_flag.as_deref(),
            profile.append_system_prompt.as_ref(),
        ) {
            command.arg(flag).arg(prompt);
        }
    }

    let task = normalize_task_for_configured_runner(runner, task, profile);

    if let Some(flag) = runner.task_flag.as_deref() {
        command.arg(flag);
    }
    command
        .arg(task)
        .current_dir(working_dir)
        .stdin(Stdio::null());
    command
}

fn apply_shared_harness_runtime_env(
    command: &mut Command,
    agent_type: &str,
    session_id: &str,
    working_dir: &Path,
    profile: Option<&SessionAgentProfile>,
) {
    let harness_label = SessionHarnessInfo::runner_key(agent_type);
    command.env("ECC_SESSION_ID", session_id);
    command.env("ECC_HARNESS", &harness_label);
    command.env("ECC_WORKING_DIR", working_dir);
    command.env("ECC_PROJECT_DIR", working_dir);
    command.env("CLAUDE_SESSION_ID", session_id);
    command.env("CLAUDE_PROJECT_DIR", working_dir);
    command.env("CLAUDE_CODE_ENTRYPOINT", "cli");
    if let Some(package_manager) = resolve_project_package_manager(working_dir) {
        command.env("CLAUDE_PACKAGE_MANAGER", package_manager);
        command.env("CLAUDE_CODE_PACKAGE_MANAGER", package_manager);
    }
    if let Some(model) = profile.and_then(|profile| profile.model.as_ref()) {
        command.env("CLAUDE_MODEL", model);
    }
    if let Some(plugin_root) = resolve_ecc_plugin_root() {
        command.env("ECC_PLUGIN_ROOT", &plugin_root);
        command.env("CLAUDE_PLUGIN_ROOT", &plugin_root);
    }
}

fn resolve_ecc_plugin_root() -> Option<PathBuf> {
    let mut seeds = Vec::new();
    if let Ok(current_exe) = std::env::current_exe() {
        seeds.push(current_exe);
    }
    seeds.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")));

    for seed in seeds {
        for candidate in seed.ancestors() {
            if is_ecc_plugin_root(candidate) {
                return Some(candidate.to_path_buf());
            }
        }
    }

    None
}

fn is_ecc_plugin_root(candidate: &Path) -> bool {
    candidate.join("scripts/lib/utils.js").is_file() && candidate.join("hooks/hooks.json").is_file()
}

fn resolve_project_package_manager(working_dir: &Path) -> Option<&'static str> {
    if let Ok(package_manager) = std::env::var("CLAUDE_PACKAGE_MANAGER") {
        if let Some(package_manager) = normalize_package_manager_name(&package_manager) {
            return Some(package_manager);
        }
    }

    read_package_manager_from_json(
        &working_dir.join(".claude").join("package-manager.json"),
        "packageManager",
    )
    .or_else(|| read_package_manager_from_package_json(&working_dir.join("package.json")))
    .or_else(|| detect_package_manager_from_lockfile(working_dir))
    .or_else(|| {
        dirs::home_dir().and_then(|home_dir| {
            read_package_manager_from_json(
                &home_dir.join(".claude").join("package-manager.json"),
                "packageManager",
            )
        })
    })
    .or(Some("npm"))
}

fn read_package_manager_from_json(path: &Path, field_name: &str) -> Option<&'static str> {
    let content = std::fs::read_to_string(path).ok()?;
    let value: serde_json::Value = serde_json::from_str(&content).ok()?;
    value
        .get(field_name)
        .and_then(|value| value.as_str())
        .and_then(normalize_package_manager_name)
}

fn read_package_manager_from_package_json(path: &Path) -> Option<&'static str> {
    let package_manager = read_package_manager_from_json(path, "packageManager")?;
    Some(package_manager)
}

fn detect_package_manager_from_lockfile(working_dir: &Path) -> Option<&'static str> {
    [
        ("pnpm", "pnpm-lock.yaml"),
        ("bun", "bun.lockb"),
        ("yarn", "yarn.lock"),
        ("npm", "package-lock.json"),
    ]
    .into_iter()
    .find_map(|(package_manager, lockfile)| {
        working_dir
            .join(lockfile)
            .is_file()
            .then_some(package_manager)
    })
}

fn normalize_package_manager_name(package_manager: &str) -> Option<&'static str> {
    let canonical = package_manager
        .split('@')
        .next()
        .unwrap_or(package_manager)
        .trim();
    match canonical {
        "npm" => Some("npm"),
        "pnpm" => Some("pnpm"),
        "yarn" => Some("yarn"),
        "bun" => Some("bun"),
        _ => None,
    }
}

fn normalize_task_for_harness(
    harness: HarnessKind,
    task: &str,
    profile: Option<&SessionAgentProfile>,
) -> String {
    match harness {
        HarnessKind::Claude => task.to_string(),
        HarnessKind::Codex => render_task_with_profile_projection(
            task,
            profile,
            TaskProjectionSupport {
                supports_model: true,
                supports_add_dirs: true,
                ..TaskProjectionSupport::default()
            },
        ),
        HarnessKind::OpenCode => render_task_with_profile_projection(
            task,
            profile,
            TaskProjectionSupport {
                supports_model: true,
                ..TaskProjectionSupport::default()
            },
        ),
        HarnessKind::Gemini => render_task_with_profile_projection(
            task,
            profile,
            TaskProjectionSupport {
                supports_model: true,
                supports_add_dirs: true,
                ..TaskProjectionSupport::default()
            },
        ),
        _ => task.to_string(),
    }
}

#[derive(Debug, Default, Clone, Copy)]
struct TaskProjectionSupport {
    supports_model: bool,
    supports_add_dirs: bool,
    supports_allowed_tools: bool,
    supports_disallowed_tools: bool,
    supports_permission_mode: bool,
    supports_max_budget_usd: bool,
    supports_append_system_prompt: bool,
}

fn normalize_task_for_configured_runner(
    runner: &crate::config::HarnessRunnerConfig,
    task: &str,
    profile: Option<&SessionAgentProfile>,
) -> String {
    render_task_with_profile_projection(
        task,
        profile,
        TaskProjectionSupport {
            supports_model: runner.model_flag.is_some(),
            supports_add_dirs: runner.add_dir_flag.is_some()
                || runner.include_directories_flag.is_some(),
            supports_allowed_tools: runner.allowed_tools_flag.is_some(),
            supports_disallowed_tools: runner.disallowed_tools_flag.is_some(),
            supports_permission_mode: runner.permission_mode_flag.is_some(),
            supports_max_budget_usd: runner.max_budget_usd_flag.is_some(),
            supports_append_system_prompt: runner.append_system_prompt_flag.is_some()
                && !runner.inline_system_prompt_for_task,
        },
    )
}

fn render_task_with_profile_projection(
    task: &str,
    profile: Option<&SessionAgentProfile>,
    support: TaskProjectionSupport,
) -> String {
    let Some(profile) = profile else {
        return task.to_string();
    };

    let mut sections = Vec::new();
    if !support.supports_append_system_prompt {
        if let Some(system_prompt) = profile.append_system_prompt.as_ref() {
            sections.push(format!("System instructions:\n{system_prompt}"));
        }
    }

    let mut directives = Vec::new();
    if !support.supports_model {
        if let Some(model) = profile.model.as_ref() {
            directives.push(format!("Preferred model: {model}"));
        }
    }
    if !support.supports_add_dirs && !profile.add_dirs.is_empty() {
        directives.push(format!(
            "Additional context dirs: {}",
            profile
                .add_dirs
                .iter()
                .map(|dir| dir.to_string_lossy().to_string())
                .collect::<Vec<_>>()
                .join(", ")
        ));
    }
    if !support.supports_allowed_tools && !profile.allowed_tools.is_empty() {
        directives.push(format!(
            "Allowed tools: {}",
            profile.allowed_tools.join(", ")
        ));
    }
    if !support.supports_disallowed_tools && !profile.disallowed_tools.is_empty() {
        directives.push(format!(
            "Disallowed tools: {}",
            profile.disallowed_tools.join(", ")
        ));
    }
    if !support.supports_permission_mode {
        if let Some(permission_mode) = profile.permission_mode.as_ref() {
            directives.push(format!("Permission mode: {permission_mode}"));
        }
    }
    if !support.supports_max_budget_usd {
        if let Some(max_budget_usd) = profile.max_budget_usd {
            directives.push(format!("Max budget USD: {max_budget_usd}"));
        }
    }
    if let Some(token_budget) = profile.token_budget {
        directives.push(format!("Token budget: {token_budget}"));
    }

    if !directives.is_empty() {
        sections.push(format!(
            "ECC execution profile:\n- {}",
            directives.join("\n- ")
        ));
    }

    if sections.is_empty() {
        return task.to_string();
    }

    sections.push(format!("Task:\n{task}"));
    sections.join("\n\n")
}

async fn spawn_claude_code(
    agent_program: &Path,
    task: &str,
    session_id: &str,
    working_dir: &Path,
) -> Result<u32> {
    let mut command = build_agent_command(
        &Config::default(),
        "claude",
        agent_program,
        task,
        session_id,
        working_dir,
        None,
    );
    let child = command
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .with_context(|| {
            format!(
                "Failed to spawn Claude Code from {}",
                agent_program.display()
            )
        })?;

    child
        .id()
        .ok_or_else(|| anyhow::anyhow!("Claude Code did not expose a process id"))
}

async fn stop_session_with_options(
    db: &StateStore,
    id: &str,
    cleanup_worktree: bool,
) -> Result<()> {
    let session = resolve_session(db, id)?;
    stop_session_recorded(db, &session, cleanup_worktree)
}

fn stop_session_recorded(db: &StateStore, session: &Session, cleanup_worktree: bool) -> Result<()> {
    if let Some(pid) = session.pid {
        kill_process(pid)?;
    }

    db.update_pid(&session.id, None)?;
    db.update_state(&session.id, &SessionState::Stopped)?;

    if cleanup_worktree {
        if let Some(worktree) = session.worktree.as_ref() {
            crate::worktree::remove(worktree)?;
            db.clear_worktree_to_dir(&session.id, &session.working_dir)?;
        }
    }

    Ok(())
}

#[cfg(unix)]
fn kill_process(pid: u32) -> Result<()> {
    send_signal(pid, libc::SIGTERM)?;
    std::thread::sleep(std::time::Duration::from_millis(1200));
    send_signal(pid, libc::SIGKILL)?;
    Ok(())
}

#[cfg(windows)]
fn kill_process(pid: u32) -> Result<()> {
    let status = std::process::Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .status()
        .with_context(|| format!("Failed to invoke taskkill for process {pid}"))?;

    if status.success() {
        Ok(())
    } else {
        Err(anyhow::anyhow!("taskkill exited with status {status}"))
    }
}

#[cfg(unix)]
fn send_signal(pid: u32, signal: i32) -> Result<()> {
    let outcome = unsafe { libc::kill(pid as i32, signal) };
    if outcome == 0 {
        return Ok(());
    }

    let error = std::io::Error::last_os_error();
    if error.raw_os_error() == Some(libc::ESRCH) {
        return Ok(());
    }

    Err(error).with_context(|| format!("Failed to kill process {pid}"))
}

#[cfg(not(unix))]
async fn kill_process(pid: u32) -> Result<()> {
    let status = Command::new("taskkill")
        .args(["/F", "/PID", &pid.to_string()])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .await
        .with_context(|| format!("Failed to invoke taskkill for process {pid}"))?;

    if status.success() {
        Ok(())
    } else {
        anyhow::bail!("taskkill failed for process {pid}");
    }
}

pub struct SessionStatus {
    harness: SessionHarnessInfo,
    profile: Option<SessionAgentProfile>,
    session: Session,
    parent_session: Option<String>,
    delegated_children: Vec<String>,
}

pub struct TeamStatus {
    root: Session,
    handoff_backlog: std::collections::HashMap<String, usize>,
    descendants: Vec<DelegatedSessionSummary>,
}

pub struct AssignmentOutcome {
    pub session_id: String,
    pub action: AssignmentAction,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AssignmentPreview {
    pub session_id: Option<String>,
    pub action: AssignmentAction,
    pub delegate_state: Option<SessionState>,
    pub handoff_backlog: usize,
    pub graph_match_terms: Vec<String>,
}

pub struct InboxDrainOutcome {
    pub message_id: i64,
    pub task: String,
    pub session_id: String,
    pub action: AssignmentAction,
}

pub struct LeadDispatchOutcome {
    pub lead_session_id: String,
    pub unread_count: usize,
    pub routed: Vec<InboxDrainOutcome>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ScheduledRunOutcome {
    pub schedule_id: i64,
    pub session_id: String,
    pub task: String,
    pub cron_expr: String,
    pub next_run_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, Serialize)]
pub struct RemoteDispatchOutcome {
    pub request_id: i64,
    pub task: String,
    pub priority: TaskPriority,
    pub target_session_id: Option<String>,
    pub session_id: Option<String>,
    pub action: RemoteDispatchAction,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case", tag = "type", content = "details")]
pub enum RemoteDispatchAction {
    SpawnedTopLevel,
    Assigned(AssignmentAction),
    DeferredSaturated,
    Failed(String),
}

pub struct RebalanceOutcome {
    pub from_session_id: String,
    pub message_id: i64,
    pub task: String,
    pub session_id: String,
    pub action: AssignmentAction,
}

pub struct LeadRebalanceOutcome {
    pub lead_session_id: String,
    pub rerouted: Vec<RebalanceOutcome>,
}

pub struct CoordinateBacklogOutcome {
    pub dispatched: Vec<LeadDispatchOutcome>,
    pub rebalanced: Vec<LeadRebalanceOutcome>,
    pub remaining_backlog_sessions: usize,
    pub remaining_backlog_messages: usize,
    pub remaining_absorbable_sessions: usize,
    pub remaining_saturated_sessions: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct CoordinationStatus {
    pub backlog_leads: usize,
    pub backlog_messages: usize,
    pub absorbable_sessions: usize,
    pub saturated_sessions: usize,
    pub mode: CoordinationMode,
    pub health: CoordinationHealth,
    pub operator_escalation_required: bool,
    pub auto_dispatch_enabled: bool,
    pub auto_dispatch_limit_per_session: usize,
    pub daemon_activity: super::store::DaemonActivity,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CoordinationMode {
    DispatchFirst,
    DispatchFirstStabilized,
    RebalanceFirstChronicSaturation,
    RebalanceCooloffChronicSaturation,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CoordinationHealth {
    Healthy,
    BacklogAbsorbable,
    Saturated,
    EscalationRequired,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AssignmentAction {
    Spawned,
    ReusedIdle,
    ReusedActive,
    DeferredSaturated,
}

impl AssignmentAction {
    fn label(self) -> &'static str {
        match self {
            Self::Spawned => "spawned",
            Self::ReusedIdle => "reused_idle",
            Self::ReusedActive => "reused_active",
            Self::DeferredSaturated => "deferred_saturated",
        }
    }
}

pub fn preview_assignment_for_task(
    db: &StateStore,
    cfg: &Config,
    lead_id: &str,
    task: &str,
    agent_type: &str,
) -> Result<AssignmentPreview> {
    let lead = resolve_session(db, lead_id)?;
    let delegates = direct_delegate_sessions(db, cfg, &lead, agent_type)?;
    let delegate_handoff_backlog = delegates
        .iter()
        .map(|session| {
            db.unread_task_handoff_count(&session.id)
                .map(|count| (session.id.clone(), count))
        })
        .collect::<Result<HashMap<_, _>>>()?;

    if let Some(idle_delegate) = delegates
        .iter()
        .filter(|session| {
            session.state == SessionState::Idle
                && delegate_handoff_backlog
                    .get(&session.id)
                    .copied()
                    .unwrap_or(0)
                    == 0
        })
        .max_by_key(|session| delegate_selection_key(db, session, task))
    {
        return Ok(AssignmentPreview {
            session_id: Some(idle_delegate.id.clone()),
            action: AssignmentAction::ReusedIdle,
            delegate_state: Some(idle_delegate.state.clone()),
            handoff_backlog: 0,
            graph_match_terms: graph_context_matched_terms(db, &idle_delegate.id, task),
        });
    }

    if delegates.len() < cfg.max_parallel_sessions {
        return Ok(AssignmentPreview {
            session_id: None,
            action: AssignmentAction::Spawned,
            delegate_state: None,
            handoff_backlog: 0,
            graph_match_terms: Vec::new(),
        });
    }

    if let Some(idle_delegate) = delegates
        .iter()
        .filter(|session| session.state == SessionState::Idle)
        .min_by_key(|session| {
            (
                delegate_handoff_backlog
                    .get(&session.id)
                    .copied()
                    .unwrap_or(0),
                session.updated_at,
            )
        })
    {
        let handoff_backlog = delegate_handoff_backlog
            .get(&idle_delegate.id)
            .copied()
            .unwrap_or(0);
        return Ok(AssignmentPreview {
            session_id: Some(idle_delegate.id.clone()),
            action: AssignmentAction::DeferredSaturated,
            delegate_state: Some(idle_delegate.state.clone()),
            handoff_backlog,
            graph_match_terms: graph_context_matched_terms(db, &idle_delegate.id, task),
        });
    }

    if let Some(active_delegate) = delegates
        .iter()
        .filter(|session| matches!(session.state, SessionState::Running | SessionState::Pending))
        .max_by_key(|session| {
            (
                graph_context_match_score(db, &session.id, task),
                -(delegate_handoff_backlog
                    .get(&session.id)
                    .copied()
                    .unwrap_or(0) as i64),
                -session.updated_at.timestamp_millis(),
            )
        })
    {
        let handoff_backlog = delegate_handoff_backlog
            .get(&active_delegate.id)
            .copied()
            .unwrap_or(0);
        return Ok(AssignmentPreview {
            session_id: Some(active_delegate.id.clone()),
            action: if handoff_backlog > 0 {
                AssignmentAction::DeferredSaturated
            } else {
                AssignmentAction::ReusedActive
            },
            delegate_state: Some(active_delegate.state.clone()),
            handoff_backlog,
            graph_match_terms: graph_context_matched_terms(db, &active_delegate.id, task),
        });
    }

    Ok(AssignmentPreview {
        session_id: None,
        action: AssignmentAction::Spawned,
        delegate_state: None,
        handoff_backlog: 0,
        graph_match_terms: Vec::new(),
    })
}

pub fn assignment_action_routes_work(action: AssignmentAction) -> bool {
    !matches!(action, AssignmentAction::DeferredSaturated)
}

fn coordination_mode(activity: &super::store::DaemonActivity) -> CoordinationMode {
    if activity.dispatch_cooloff_active() {
        CoordinationMode::RebalanceCooloffChronicSaturation
    } else if activity.prefers_rebalance_first() {
        CoordinationMode::RebalanceFirstChronicSaturation
    } else if activity.stabilized_after_recovery_at().is_some() {
        CoordinationMode::DispatchFirstStabilized
    } else {
        CoordinationMode::DispatchFirst
    }
}

fn coordination_health(
    backlog_messages: usize,
    saturated_sessions: usize,
    activity: &super::store::DaemonActivity,
) -> CoordinationHealth {
    if activity.operator_escalation_required() {
        CoordinationHealth::EscalationRequired
    } else if saturated_sessions > 0 {
        CoordinationHealth::Saturated
    } else if backlog_messages > 0 {
        CoordinationHealth::BacklogAbsorbable
    } else {
        CoordinationHealth::Healthy
    }
}

pub fn get_coordination_status(db: &StateStore, cfg: &Config) -> Result<CoordinationStatus> {
    let targets = db.unread_task_handoff_targets(db.list_sessions()?.len().max(1))?;
    let pressure = summarize_backlog_pressure(db, cfg, &cfg.default_agent, &targets)?;
    let backlog_messages = targets
        .iter()
        .map(|(_, unread_count)| *unread_count)
        .sum::<usize>();
    let daemon_activity = db.daemon_activity()?;

    Ok(CoordinationStatus {
        backlog_leads: targets.len(),
        backlog_messages,
        absorbable_sessions: pressure.absorbable_sessions,
        saturated_sessions: pressure.saturated_sessions,
        mode: coordination_mode(&daemon_activity),
        health: coordination_health(
            backlog_messages,
            pressure.saturated_sessions,
            &daemon_activity,
        ),
        operator_escalation_required: daemon_activity.operator_escalation_required(),
        auto_dispatch_enabled: cfg.auto_dispatch_unread_handoffs,
        auto_dispatch_limit_per_session: cfg.auto_dispatch_limit_per_session,
        daemon_activity,
    })
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
struct BacklogPressureSummary {
    absorbable_sessions: usize,
    saturated_sessions: usize,
}

struct DelegatedSessionSummary {
    depth: usize,
    handoff_backlog: usize,
    session: Session,
}

impl fmt::Display for SessionStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let s = &self.session;
        writeln!(f, "Session: {}", s.id)?;
        writeln!(f, "Task:    {}", s.task)?;
        writeln!(f, "Agent:   {}", s.agent_type)?;
        writeln!(f, "Harness: {}", self.harness.primary_label)?;
        writeln!(f, "Detected: {}", self.harness.detected_summary())?;
        writeln!(f, "State:   {}", s.state)?;
        if let Some(profile) = self.profile.as_ref() {
            writeln!(f, "Profile: {}", profile.profile_name)?;
            if let Some(model) = profile.model.as_ref() {
                writeln!(f, "Model:   {}", model)?;
            }
            if let Some(permission_mode) = profile.permission_mode.as_ref() {
                writeln!(f, "Perms:   {}", permission_mode)?;
            }
            if let Some(token_budget) = profile.token_budget {
                writeln!(f, "Profile tokens: {}", token_budget)?;
            }
            if let Some(max_budget_usd) = profile.max_budget_usd {
                writeln!(f, "Profile cost: ${max_budget_usd:.4}")?;
            }
        }
        if let Some(parent) = self.parent_session.as_ref() {
            writeln!(f, "Parent:  {}", parent)?;
        }
        if let Some(pid) = s.pid {
            writeln!(f, "PID:     {}", pid)?;
        }
        if let Some(ref wt) = s.worktree {
            writeln!(f, "Branch:  {}", wt.branch)?;
            writeln!(f, "Worktree: {}", wt.path.display())?;
        }
        writeln!(
            f,
            "Tokens:  {} total (in {} / out {})",
            s.metrics.tokens_used, s.metrics.input_tokens, s.metrics.output_tokens
        )?;
        writeln!(f, "Tools:   {}", s.metrics.tool_calls)?;
        writeln!(f, "Files:   {}", s.metrics.files_changed)?;
        writeln!(f, "Cost:    ${:.4}", s.metrics.cost_usd)?;
        writeln!(
            f,
            "Heartbeat: {} ({}s ago)",
            s.last_heartbeat_at,
            chrono::Utc::now()
                .signed_duration_since(s.last_heartbeat_at)
                .num_seconds()
                .max(0)
        )?;
        if !self.delegated_children.is_empty() {
            writeln!(f, "Children: {}", self.delegated_children.join(", "))?;
        }
        writeln!(f, "Created: {}", s.created_at)?;
        write!(f, "Updated: {}", s.updated_at)
    }
}

impl fmt::Display for TeamStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        writeln!(f, "Lead:    {} [{}]", self.root.id, self.root.state)?;
        writeln!(f, "Task:    {}", self.root.task)?;
        writeln!(f, "Agent:   {}", self.root.agent_type)?;
        if let Some(worktree) = self.root.worktree.as_ref() {
            writeln!(f, "Branch:  {}", worktree.branch)?;
        }

        let lead_handoff_backlog = self
            .handoff_backlog
            .get(&self.root.id)
            .copied()
            .unwrap_or(0);
        writeln!(f, "Backlog: {}", lead_handoff_backlog)?;

        if self.descendants.is_empty() {
            return write!(f, "Board:   no delegated sessions");
        }

        writeln!(f, "Board:")?;
        let mut lanes: BTreeMap<&'static str, Vec<&DelegatedSessionSummary>> = BTreeMap::new();
        for summary in &self.descendants {
            lanes
                .entry(session_state_label(&summary.session.state))
                .or_default()
                .push(summary);
        }

        for lane in [
            "Running",
            "Idle",
            "Stale",
            "Pending",
            "Failed",
            "Stopped",
            "Completed",
        ] {
            let Some(items) = lanes.get(lane) else {
                continue;
            };

            writeln!(f, "  {lane}:")?;
            for item in items {
                writeln!(
                    f,
                    "    - {}{} [{}] | backlog {} handoff(s) | {}",
                    "  ".repeat(item.depth.saturating_sub(1)),
                    item.session.id,
                    item.session.agent_type,
                    item.handoff_backlog,
                    item.session.task
                )?;
            }
        }

        Ok(())
    }
}

impl fmt::Display for CoordinationStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let stabilized = self.daemon_activity.stabilized_after_recovery_at();
        let mode = match self.mode {
            CoordinationMode::DispatchFirst => "dispatch-first",
            CoordinationMode::DispatchFirstStabilized => "dispatch-first (stabilized)",
            CoordinationMode::RebalanceFirstChronicSaturation => {
                "rebalance-first (chronic saturation)"
            }
            CoordinationMode::RebalanceCooloffChronicSaturation => {
                "rebalance-cooloff (chronic saturation)"
            }
        };

        writeln!(
            f,
            "Global handoff backlog: {} lead(s) / {} handoff(s) [{} absorbable, {} saturated]",
            self.backlog_leads,
            self.backlog_messages,
            self.absorbable_sessions,
            self.saturated_sessions
        )?;
        writeln!(
            f,
            "Auto-dispatch: {} @ {}/lead",
            if self.auto_dispatch_enabled {
                "on"
            } else {
                "off"
            },
            self.auto_dispatch_limit_per_session
        )?;
        writeln!(f, "Coordination mode: {mode}")?;

        if self.daemon_activity.chronic_saturation_streak > 0 {
            writeln!(
                f,
                "Chronic saturation streak: {} cycle(s)",
                self.daemon_activity.chronic_saturation_streak
            )?;
        }

        if self.operator_escalation_required {
            writeln!(f, "Operator escalation: chronic saturation is not clearing")?;
        }

        if let Some(cleared_at) = self.daemon_activity.chronic_saturation_cleared_at() {
            writeln!(f, "Chronic saturation cleared: {}", cleared_at.to_rfc3339())?;
        }

        if let Some(stabilized_at) = stabilized {
            writeln!(f, "Recovery stabilized: {}", stabilized_at.to_rfc3339())?;
        }

        if let Some(last_dispatch_at) = self.daemon_activity.last_dispatch_at.as_ref() {
            writeln!(
                f,
                "Last daemon dispatch: {} routed / {} deferred across {} lead(s) @ {}",
                self.daemon_activity.last_dispatch_routed,
                self.daemon_activity.last_dispatch_deferred,
                self.daemon_activity.last_dispatch_leads,
                last_dispatch_at.to_rfc3339()
            )?;
        }

        if stabilized.is_none() {
            if let Some(last_recovery_dispatch_at) =
                self.daemon_activity.last_recovery_dispatch_at.as_ref()
            {
                writeln!(
                    f,
                    "Last daemon recovery dispatch: {} handoff(s) across {} lead(s) @ {}",
                    self.daemon_activity.last_recovery_dispatch_routed,
                    self.daemon_activity.last_recovery_dispatch_leads,
                    last_recovery_dispatch_at.to_rfc3339()
                )?;
            }

            if let Some(last_rebalance_at) = self.daemon_activity.last_rebalance_at.as_ref() {
                writeln!(
                    f,
                    "Last daemon rebalance: {} handoff(s) across {} lead(s) @ {}",
                    self.daemon_activity.last_rebalance_rerouted,
                    self.daemon_activity.last_rebalance_leads,
                    last_rebalance_at.to_rfc3339()
                )?;
            }
        }

        if let Some(last_auto_merge_at) = self.daemon_activity.last_auto_merge_at.as_ref() {
            writeln!(
                f,
                "Last daemon auto-merge: {} merged / {} active / {} conflicted / {} dirty / {} failed @ {}",
                self.daemon_activity.last_auto_merge_merged,
                self.daemon_activity.last_auto_merge_active_skipped,
                self.daemon_activity.last_auto_merge_conflicted_skipped,
                self.daemon_activity.last_auto_merge_dirty_skipped,
                self.daemon_activity.last_auto_merge_failed,
                last_auto_merge_at.to_rfc3339()
            )?;
        }

        if let Some(last_auto_prune_at) = self.daemon_activity.last_auto_prune_at.as_ref() {
            writeln!(
                f,
                "Last daemon auto-prune: {} pruned / {} active @ {}",
                self.daemon_activity.last_auto_prune_pruned,
                self.daemon_activity.last_auto_prune_active_skipped,
                last_auto_prune_at.to_rfc3339()
            )?;
        }

        Ok(())
    }
}

fn session_state_label(state: &SessionState) -> &'static str {
    match state {
        SessionState::Pending => "Pending",
        SessionState::Running => "Running",
        SessionState::Idle => "Idle",
        SessionState::Stale => "Stale",
        SessionState::Completed => "Completed",
        SessionState::Failed => "Failed",
        SessionState::Stopped => "Stopped",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{Config, PaneLayout, Theme};
    use crate::session::{Session, SessionAgentProfile, SessionMetrics, SessionState};
    use anyhow::{Context, Result};
    use chrono::{Duration, Utc};
    use std::fs;
    use std::os::unix::fs::PermissionsExt;
    use std::path::{Path, PathBuf};
    use std::process::Command as StdCommand;
    use std::thread;
    use std::time::Duration as StdDuration;

    struct TestDir {
        path: PathBuf,
    }

    impl TestDir {
        fn new(label: &str) -> Result<Self> {
            let path =
                std::env::temp_dir().join(format!("ecc2-{}-{}", label, uuid::Uuid::new_v4()));
            fs::create_dir_all(&path)?;
            Ok(Self { path })
        }

        fn path(&self) -> &Path {
            &self.path
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    fn build_config(root: &Path) -> Config {
        Config {
            db_path: root.join("state.db"),
            worktree_root: root.join("worktrees"),
            worktree_branch_prefix: "ecc".to_string(),
            max_parallel_sessions: 4,
            max_parallel_worktrees: 4,
            worktree_retention_secs: 0,
            session_timeout_secs: 60,
            heartbeat_interval_secs: 5,
            auto_terminate_stale_sessions: false,
            default_agent: "claude".to_string(),
            default_agent_profile: None,
            harness_runners: Default::default(),
            agent_profiles: Default::default(),
            orchestration_templates: Default::default(),
            memory_connectors: Default::default(),
            computer_use_dispatch: crate::config::ComputerUseDispatchConfig::default(),
            auto_dispatch_unread_handoffs: false,
            auto_dispatch_limit_per_session: 5,
            auto_create_worktrees: true,
            auto_merge_ready_worktrees: false,
            desktop_notifications: crate::notifications::DesktopNotificationConfig::default(),
            webhook_notifications: crate::notifications::WebhookNotificationConfig::default(),
            completion_summary_notifications:
                crate::notifications::CompletionSummaryConfig::default(),
            cost_budget_usd: 10.0,
            token_budget: 500_000,
            budget_alert_thresholds: Config::BUDGET_ALERT_THRESHOLDS,
            conflict_resolution: crate::config::ConflictResolutionConfig::default(),
            theme: Theme::Dark,
            pane_layout: PaneLayout::Horizontal,
            pane_navigation: Default::default(),
            linear_pane_size_percent: 35,
            grid_pane_size_percent: 50,
            risk_thresholds: Config::RISK_THRESHOLDS,
        }
    }

    fn build_session(id: &str, state: SessionState, updated_at: chrono::DateTime<Utc>) -> Session {
        Session {
            id: id.to_string(),
            task: format!("task-{id}"),
            project: "workspace".to_string(),
            task_group: "general".to_string(),
            agent_type: "claude".to_string(),
            working_dir: PathBuf::from("/tmp"),
            state,
            pid: None,
            worktree: None,
            created_at: updated_at - Duration::minutes(1),
            updated_at,
            last_heartbeat_at: updated_at,
            metrics: SessionMetrics::default(),
        }
    }

    #[test]
    fn build_agent_command_applies_profile_runner_flags_for_claude() {
        let cfg = Config::default();
        let profile = SessionAgentProfile {
            profile_name: "reviewer".to_string(),
            agent: None,
            model: Some("sonnet".to_string()),
            allowed_tools: vec!["Read".to_string(), "Edit".to_string()],
            disallowed_tools: vec!["Bash".to_string()],
            permission_mode: Some("plan".to_string()),
            add_dirs: vec![PathBuf::from("docs"), PathBuf::from("specs")],
            max_budget_usd: Some(1.25),
            token_budget: Some(750),
            append_system_prompt: Some("Review thoroughly.".to_string()),
        };

        let command = build_agent_command(
            &cfg,
            "claude",
            Path::new("claude"),
            "review this change",
            "sess-1234",
            Path::new("/tmp/repo"),
            Some(&profile),
        );
        let args = command
            .as_std()
            .get_args()
            .map(|value| value.to_string_lossy().to_string())
            .collect::<Vec<_>>();

        assert_eq!(
            args,
            vec![
                "--print",
                "--name",
                "ecc-sess-1234",
                "--model",
                "sonnet",
                "--allowed-tools",
                "Read,Edit",
                "--disallowed-tools",
                "Bash",
                "--permission-mode",
                "plan",
                "--add-dir",
                "docs",
                "--add-dir",
                "specs",
                "--max-budget-usd",
                "1.25",
                "--append-system-prompt",
                "Review thoroughly.",
                "review this change",
            ]
        );
    }

    #[test]
    fn build_agent_command_normalizes_runner_flags_for_codex() {
        let cfg = Config::default();
        let profile = SessionAgentProfile {
            profile_name: "reviewer".to_string(),
            agent: None,
            model: Some("gpt-5.4".to_string()),
            allowed_tools: vec!["Read".to_string()],
            disallowed_tools: vec!["Bash".to_string()],
            permission_mode: Some("plan".to_string()),
            add_dirs: vec![PathBuf::from("docs"), PathBuf::from("specs")],
            max_budget_usd: Some(1.25),
            token_budget: Some(750),
            append_system_prompt: Some("Review thoroughly.".to_string()),
        };

        let command = build_agent_command(
            &cfg,
            "codex",
            Path::new("codex"),
            "review this change",
            "sess-1234",
            Path::new("/tmp/repo"),
            Some(&profile),
        );
        let args = command
            .as_std()
            .get_args()
            .map(|value| value.to_string_lossy().to_string())
            .collect::<Vec<_>>();

        assert_eq!(
            args,
            vec![
                "exec",
                "--skip-git-repo-check",
                "--sandbox",
                "workspace-write",
                "--cd",
                "/tmp/repo",
                "--color",
                "never",
                "--model",
                "gpt-5.4",
                "--add-dir",
                "docs",
                "--add-dir",
                "specs",
                "System instructions:\nReview thoroughly.\n\nECC execution profile:\n- Allowed tools: Read\n- Disallowed tools: Bash\n- Permission mode: plan\n- Max budget USD: 1.25\n- Token budget: 750\n\nTask:\nreview this change",
            ]
        );

        let envs = command_env_map(&command);
        assert_eq!(envs.get("ECC_SESSION_ID"), Some(&"sess-1234".to_string()));
        assert_eq!(
            envs.get("CLAUDE_SESSION_ID"),
            Some(&"sess-1234".to_string())
        );
        assert_eq!(
            envs.get("CLAUDE_PROJECT_DIR"),
            Some(&"/tmp/repo".to_string())
        );
        assert_eq!(envs.get("CLAUDE_CODE_ENTRYPOINT"), Some(&"cli".to_string()));
        assert_eq!(envs.get("ECC_HARNESS"), Some(&"codex".to_string()));
        assert_eq!(envs.get("CLAUDE_MODEL"), Some(&"gpt-5.4".to_string()));
        assert!(
            envs.contains_key("CLAUDE_PLUGIN_ROOT"),
            "shared compatibility env should expose the ECC plugin root"
        );
    }

    #[test]
    fn build_agent_command_normalizes_runner_flags_for_opencode() {
        let cfg = Config::default();
        let profile = SessionAgentProfile {
            profile_name: "builder".to_string(),
            agent: None,
            model: Some("anthropic/claude-sonnet-4".to_string()),
            allowed_tools: Vec::new(),
            disallowed_tools: Vec::new(),
            permission_mode: None,
            add_dirs: vec![PathBuf::from("docs")],
            max_budget_usd: None,
            token_budget: None,
            append_system_prompt: Some("Build carefully.".to_string()),
        };

        let command = build_agent_command(
            &cfg,
            "opencode",
            Path::new("opencode"),
            "stabilize callback flow",
            "sess-9999",
            Path::new("/tmp/repo"),
            Some(&profile),
        );
        let args = command
            .as_std()
            .get_args()
            .map(|value| value.to_string_lossy().to_string())
            .collect::<Vec<_>>();

        assert_eq!(
            args,
            vec![
                "run",
                "--dir",
                "/tmp/repo",
                "--title",
                "ecc-sess-9999",
                "--model",
                "anthropic/claude-sonnet-4",
                "System instructions:\nBuild carefully.\n\nECC execution profile:\n- Additional context dirs: docs\n\nTask:\nstabilize callback flow",
            ]
        );
    }

    #[test]
    fn build_agent_command_normalizes_runner_flags_for_gemini() {
        let cfg = Config::default();
        let profile = SessionAgentProfile {
            profile_name: "investigator".to_string(),
            agent: None,
            model: Some("gemini-2.5-pro".to_string()),
            allowed_tools: vec!["Read".to_string()],
            disallowed_tools: vec!["Bash".to_string()],
            permission_mode: Some("plan".to_string()),
            add_dirs: vec![PathBuf::from("docs"), PathBuf::from("../shared")],
            max_budget_usd: Some(1.0),
            token_budget: Some(500),
            append_system_prompt: Some("Use repo context carefully.".to_string()),
        };

        let command = build_agent_command(
            &cfg,
            "gemini",
            Path::new("gemini"),
            "investigate auth regression",
            "sess-gem1",
            Path::new("/tmp/repo"),
            Some(&profile),
        );
        let args = command
            .as_std()
            .get_args()
            .map(|value| value.to_string_lossy().to_string())
            .collect::<Vec<_>>();

        assert_eq!(
            args,
            vec![
                "-p",
                "-m",
                "gemini-2.5-pro",
                "--include-directories",
                "docs,../shared",
                "System instructions:\nUse repo context carefully.\n\nECC execution profile:\n- Allowed tools: Read\n- Disallowed tools: Bash\n- Permission mode: plan\n- Max budget USD: 1\n- Token budget: 500\n\nTask:\ninvestigate auth regression",
            ]
        );
    }

    #[test]
    fn agent_program_uses_configured_runner_for_cursor() -> Result<()> {
        let mut cfg = Config::default();
        cfg.harness_runners.insert(
            "cursor".to_string(),
            crate::config::HarnessRunnerConfig {
                program: "cursor-agent".to_string(),
                ..Default::default()
            },
        );

        assert_eq!(
            agent_program(&cfg, "cursor")?,
            PathBuf::from("cursor-agent")
        );
        Ok(())
    }

    #[test]
    fn agent_program_uses_configured_runner_for_unknown_custom_harness() -> Result<()> {
        let mut cfg = Config::default();
        cfg.harness_runners.insert(
            "acme-runner".to_string(),
            crate::config::HarnessRunnerConfig {
                program: "acme-agent".to_string(),
                ..Default::default()
            },
        );

        assert_eq!(
            agent_program(&cfg, "acme-runner")?,
            PathBuf::from("acme-agent")
        );
        Ok(())
    }

    #[test]
    fn build_agent_command_uses_configured_runner_for_cursor() {
        let mut cfg = Config::default();
        cfg.harness_runners.insert(
            "cursor".to_string(),
            crate::config::HarnessRunnerConfig {
                program: "cursor-agent".to_string(),
                base_args: vec!["run".to_string()],
                cwd_flag: Some("--cwd".to_string()),
                session_name_flag: Some("--name".to_string()),
                task_flag: Some("--task".to_string()),
                model_flag: Some("--model".to_string()),
                permission_mode_flag: Some("--permission-mode".to_string()),
                add_dir_flag: Some("--context-dir".to_string()),
                inline_system_prompt_for_task: true,
                env: BTreeMap::from([("ECC_HARNESS".to_string(), "cursor".to_string())]),
                ..Default::default()
            },
        );
        let profile = SessionAgentProfile {
            profile_name: "worker".to_string(),
            agent: None,
            model: Some("gpt-5.4".to_string()),
            allowed_tools: Vec::new(),
            disallowed_tools: Vec::new(),
            permission_mode: Some("plan".to_string()),
            add_dirs: vec![PathBuf::from("docs"), PathBuf::from("specs")],
            max_budget_usd: None,
            token_budget: None,
            append_system_prompt: Some("Use repo context carefully.".to_string()),
        };

        let command = build_agent_command(
            &cfg,
            "cursor",
            Path::new("cursor-agent"),
            "fix callback regression",
            "sess-cur1",
            Path::new("/tmp/repo"),
            Some(&profile),
        );
        let args = command
            .as_std()
            .get_args()
            .map(|value| value.to_string_lossy().to_string())
            .collect::<Vec<_>>();

        assert_eq!(
            args,
            vec![
                "run",
                "--cwd",
                "/tmp/repo",
                "--name",
                "ecc-sess-cur1",
                "--model",
                "gpt-5.4",
                "--context-dir",
                "docs",
                "--context-dir",
                "specs",
                "--permission-mode",
                "plan",
                "--task",
                "System instructions:\nUse repo context carefully.\n\nTask:\nfix callback regression",
            ]
        );
        let envs = command_env_map(&command);
        assert_eq!(envs.get("ECC_SESSION_ID"), Some(&"sess-cur1".to_string()));
        assert_eq!(
            envs.get("CLAUDE_SESSION_ID"),
            Some(&"sess-cur1".to_string())
        );
        assert_eq!(
            envs.get("CLAUDE_PROJECT_DIR"),
            Some(&"/tmp/repo".to_string())
        );
        assert_eq!(envs.get("CLAUDE_CODE_ENTRYPOINT"), Some(&"cli".to_string()));
        assert_eq!(envs.get("ECC_HARNESS"), Some(&"cursor".to_string()));
        assert_eq!(envs.get("CLAUDE_MODEL"), Some(&"gpt-5.4".to_string()));
        assert_eq!(envs.get("ECC_PLUGIN_ROOT"), envs.get("CLAUDE_PLUGIN_ROOT"));
    }

    #[test]
    fn build_agent_command_projects_unsupported_profile_fields_for_configured_runner() {
        let mut cfg = Config::default();
        cfg.harness_runners.insert(
            "cursor".to_string(),
            crate::config::HarnessRunnerConfig {
                program: "cursor-agent".to_string(),
                base_args: vec!["run".to_string()],
                task_flag: Some("--task".to_string()),
                model_flag: Some("--model".to_string()),
                ..Default::default()
            },
        );
        let profile = SessionAgentProfile {
            profile_name: "worker".to_string(),
            agent: None,
            model: Some("gpt-5.4".to_string()),
            allowed_tools: vec!["Read".to_string()],
            disallowed_tools: vec!["Bash".to_string()],
            permission_mode: Some("plan".to_string()),
            add_dirs: vec![PathBuf::from("docs"), PathBuf::from("specs")],
            max_budget_usd: Some(2.5),
            token_budget: Some(900),
            append_system_prompt: Some("Use repo context carefully.".to_string()),
        };

        let command = build_agent_command(
            &cfg,
            "cursor",
            Path::new("cursor-agent"),
            "fix callback regression",
            "sess-cur2",
            Path::new("/tmp/repo"),
            Some(&profile),
        );
        let args = command
            .as_std()
            .get_args()
            .map(|value| value.to_string_lossy().to_string())
            .collect::<Vec<_>>();

        assert_eq!(
            args,
            vec![
                "run",
                "--model",
                "gpt-5.4",
                "--task",
                "System instructions:\nUse repo context carefully.\n\nECC execution profile:\n- Additional context dirs: docs, specs\n- Allowed tools: Read\n- Disallowed tools: Bash\n- Permission mode: plan\n- Max budget USD: 2.5\n- Token budget: 900\n\nTask:\nfix callback regression",
            ]
        );
    }

    #[test]
    fn build_agent_command_exports_detected_package_manager_env_from_lockfile() -> Result<()> {
        let tempdir = TestDir::new("manager-package-manager-lockfile")?;
        let repo_root = tempdir.path().join("repo");
        fs::create_dir_all(&repo_root)?;
        write_package_manager_project_files(&repo_root, None, Some("pnpm-lock.yaml"), None)?;

        let cfg = Config::default();
        let command = build_agent_command(
            &cfg,
            "codex",
            Path::new("codex"),
            "inspect dependency graph",
            "sess-pnpm",
            &repo_root,
            None,
        );
        let envs = command_env_map(&command);
        assert_eq!(
            envs.get("CLAUDE_PACKAGE_MANAGER"),
            Some(&"pnpm".to_string())
        );
        assert_eq!(
            envs.get("CLAUDE_CODE_PACKAGE_MANAGER"),
            Some(&"pnpm".to_string())
        );
        Ok(())
    }

    #[test]
    fn build_agent_command_prefers_project_package_manager_config_over_lockfile() -> Result<()> {
        let tempdir = TestDir::new("manager-package-manager-config")?;
        let repo_root = tempdir.path().join("repo");
        fs::create_dir_all(&repo_root)?;
        write_package_manager_project_files(
            &repo_root,
            Some("pnpm@9.0.0"),
            Some("package-lock.json"),
            Some("yarn"),
        )?;

        let cfg = Config::default();
        let command = build_agent_command(
            &cfg,
            "codex",
            Path::new("codex"),
            "inspect dependency graph",
            "sess-yarn",
            &repo_root,
            None,
        );
        let envs = command_env_map(&command);
        assert_eq!(
            envs.get("CLAUDE_PACKAGE_MANAGER"),
            Some(&"yarn".to_string())
        );
        assert_eq!(
            envs.get("CLAUDE_CODE_PACKAGE_MANAGER"),
            Some(&"yarn".to_string())
        );
        Ok(())
    }

    #[test]
    fn build_session_record_canonicalizes_known_agent_aliases() -> Result<()> {
        let tempdir = TestDir::new("manager-canonical-agent-type")?;
        let repo_root = tempdir.path().join("repo");
        init_git_repo(&repo_root)?;

        let cfg = build_config(tempdir.path());
        let db = StateStore::open(&cfg.db_path)?;
        let session = build_session_record(
            &db,
            "Investigate auth callback",
            "gemini-cli",
            false,
            &cfg,
            &repo_root,
            SessionGrouping::default(),
        )?;

        assert_eq!(session.agent_type, "gemini");
        Ok(())
    }

    #[test]
    fn direct_delegate_sessions_matches_harness_aliases_for_existing_rows() -> Result<()> {
        let tempdir = TestDir::new("manager-delegate-alias-match")?;
        let repo_root = tempdir.path().join("repo");
        init_git_repo(&repo_root)?;

        let cfg = build_config(tempdir.path());
        let db = StateStore::open(&cfg.db_path)?;
        let now = Utc::now();

        db.insert_session(&Session {
            id: "lead".to_string(),
            task: "Lead task".to_string(),
            project: "workspace".to_string(),
            task_group: "general".to_string(),
            agent_type: "claude".to_string(),
            working_dir: repo_root.clone(),
            state: SessionState::Running,
            pid: Some(42),
            worktree: None,
            created_at: now,
            updated_at: now,
            last_heartbeat_at: now,
            metrics: SessionMetrics::default(),
        })?;
        db.insert_session(&Session {
            id: "child".to_string(),
            task: "Delegate task".to_string(),
            project: "workspace".to_string(),
            task_group: "general".to_string(),
            agent_type: "claude-code".to_string(),
            working_dir: repo_root.clone(),
            state: SessionState::Idle,
            pid: Some(7),
            worktree: None,
            created_at: now,
            updated_at: now,
            last_heartbeat_at: now,
            metrics: SessionMetrics::default(),
        })?;
        db.send_message(
            "lead",
            "child",
            "{\"task\":\"Delegate task\",\"context\":\"Delegated from lead\"}",
            "task_handoff",
        )?;

        let lead = resolve_session(&db, "lead")?;
        let delegates = direct_delegate_sessions(&db, &cfg, &lead, "claude")?;
        assert_eq!(delegates.len(), 1);
        assert_eq!(delegates[0].id, "child");
        Ok(())
    }

    #[test]
    fn direct_delegate_sessions_resolves_auto_to_configured_harness() -> Result<()> {
        let tempdir = TestDir::new("manager-delegate-auto-custom-harness")?;
        let repo_root = tempdir.path().join("repo");
        init_git_repo(&repo_root)?;
        fs::create_dir_all(repo_root.join(".acme"))?;

        let mut cfg = build_config(tempdir.path());
        cfg.harness_runners.insert(
            "acme-runner".to_string(),
            crate::config::HarnessRunnerConfig {
                project_markers: vec![PathBuf::from(".acme")],
                ..Default::default()
            },
        );
        let db = StateStore::open(&cfg.db_path)?;
        let now = Utc::now();

        db.insert_session(&Session {
            id: "lead".to_string(),
            task: "Lead task".to_string(),
            project: "workspace".to_string(),
            task_group: "general".to_string(),
            agent_type: "acme-runner".to_string(),
            working_dir: repo_root.clone(),
            state: SessionState::Running,
            pid: Some(42),
            worktree: None,
            created_at: now,
            updated_at: now,
            last_heartbeat_at: now,
            metrics: SessionMetrics::default(),
        })?;
        db.insert_session(&Session {
            id: "custom-child".to_string(),
            task: "Delegate task".to_string(),
            project: "workspace".to_string(),
            task_group: "general".to_string(),
            agent_type: "acme-runner".to_string(),
            working_dir: repo_root.clone(),
            state: SessionState::Idle,
            pid: Some(7),
            worktree: None,
            created_at: now,
            updated_at: now,
            last_heartbeat_at: now,
            metrics: SessionMetrics::default(),
        })?;
        db.insert_session(&Session {
            id: "claude-child".to_string(),
            task: "Other delegate task".to_string(),
            project: "workspace".to_string(),
            task_group: "general".to_string(),
            agent_type: "claude".to_string(),
            working_dir: repo_root.clone(),
            state: SessionState::Idle,
            pid: Some(8),
            worktree: None,
            created_at: now,
            updated_at: now,
            last_heartbeat_at: now,
            metrics: SessionMetrics::default(),
        })?;
        db.send_message(
            "lead",
            "custom-child",
            "{\"task\":\"Delegate task\",\"context\":\"Delegated from lead\"}",
            "task_handoff",
        )?;
        db.send_message(
            "lead",
            "claude-child",
            "{\"task\":\"Other delegate task\",\"context\":\"Delegated from lead\"}",
            "task_handoff",
        )?;

        let lead = resolve_session(&db, "lead")?;
        let delegates = direct_delegate_sessions(&db, &cfg, &lead, "auto")?;
        assert_eq!(delegates.len(), 1);
        assert_eq!(delegates[0].id, "custom-child");
        Ok(())
    }

    #[test]
    fn enforce_session_heartbeats_marks_overdue_running_sessions_stale() -> Result<()> {
        let tempdir = TestDir::new("manager-heartbeat-stale")?;
        let cfg = build_config(tempdir.path());
        let db = StateStore::open(&cfg.db_path)?;
        let now = Utc::now();

        db.insert_session(&Session {
            id: "stale-1".to_string(),
            task: "heartbeat overdue".to_string(),
            project: "workspace".to_string(),
            task_group: "general".to_string(),
            agent_type: "claude".to_string(),
            working_dir: PathBuf::from("/tmp"),
            state: SessionState::Running,
            pid: Some(4242),
            worktree: None,
            created_at: now - Duration::minutes(5),
            updated_at: now - Duration::minutes(5),
            last_heartbeat_at: now - Duration::minutes(5),
            metrics: SessionMetrics::default(),
        })?;

        let outcome = enforce_session_heartbeats(&db, &cfg)?;
        let session = db.get_session("stale-1")?.expect("session should exist");

        assert_eq!(outcome.stale_sessions, vec!["stale-1".to_string()]);
        assert!(outcome.auto_terminated_sessions.is_empty());
        assert_eq!(session.state, SessionState::Stale);
        assert_eq!(session.pid, Some(4242));

        Ok(())
    }

    #[test]
    fn enforce_session_heartbeats_auto_terminates_when_enabled() -> Result<()> {
        let tempdir = TestDir::new("manager-heartbeat-terminate")?;
        let mut cfg = build_config(tempdir.path());
        cfg.auto_terminate_stale_sessions = true;
        let db = StateStore::open(&cfg.db_path)?;
        let now = Utc::now();
        let killed = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let killed_clone = killed.clone();

        db.insert_session(&Session {
            id: "stale-2".to_string(),
            task: "terminate overdue".to_string(),
            project: "workspace".to_string(),
            task_group: "general".to_string(),
            agent_type: "claude".to_string(),
            working_dir: PathBuf::from("/tmp"),
            state: SessionState::Running,
            pid: Some(7777),
            worktree: None,
            created_at: now - Duration::minutes(5),
            updated_at: now - Duration::minutes(5),
            last_heartbeat_at: now - Duration::minutes(5),
            metrics: SessionMetrics::default(),
        })?;

        let outcome = enforce_session_heartbeats_with(&db, &cfg, move |pid| {
            killed_clone.lock().unwrap().push(pid);
            Ok(())
        })?;
        let session = db.get_session("stale-2")?.expect("session should exist");

        assert!(outcome.stale_sessions.is_empty());
        assert_eq!(
            outcome.auto_terminated_sessions,
            vec!["stale-2".to_string()]
        );
        assert_eq!(*killed.lock().unwrap(), vec![7777]);
        assert_eq!(session.state, SessionState::Failed);
        assert_eq!(session.pid, None);

        Ok(())
    }

    fn build_daemon_activity() -> super::super::store::DaemonActivity {
        let now = Utc::now();
        super::super::store::DaemonActivity {
            last_dispatch_at: Some(now),
            last_dispatch_routed: 3,
            last_dispatch_deferred: 1,
            last_dispatch_leads: 2,
            chronic_saturation_streak: 2,
            last_recovery_dispatch_at: Some(now - Duration::seconds(5)),
            last_recovery_dispatch_routed: 2,
            last_recovery_dispatch_leads: 1,
            last_rebalance_at: Some(now - Duration::seconds(2)),
            last_rebalance_rerouted: 0,
            last_rebalance_leads: 1,
            last_auto_merge_at: Some(now - Duration::seconds(1)),
            last_auto_merge_merged: 1,
            last_auto_merge_active_skipped: 1,
            last_auto_merge_conflicted_skipped: 0,
            last_auto_merge_dirty_skipped: 0,
            last_auto_merge_failed: 0,
            last_auto_prune_at: Some(now),
            last_auto_prune_pruned: 2,
            last_auto_prune_active_skipped: 1,
        }
    }

    fn init_git_repo(path: &Path) -> Result<()> {
        fs::create_dir_all(path)?;
        run_git(path, ["init", "-q"])?;
        run_git(path, ["config", "user.name", "ECC Tests"])?;
        run_git(path, ["config", "user.email", "ecc-tests@example.com"])?;
        // Keep fixtures hermetic: a global core.hooksPath (e.g. identity-checking
        // pre-push hooks) must not run inside test repos.
        run_git(path, ["config", "core.hooksPath", "hooks-disabled"])?;
        fs::write(path.join("README.md"), "hello\n")?;
        run_git(path, ["add", "README.md"])?;
        run_git(path, ["commit", "-qm", "init"])?;
        Ok(())
    }

    fn run_git<const N: usize>(path: &Path, args: [&str; N]) -> Result<()> {
        let status = StdCommand::new("git")
            .args(args)
            .current_dir(path)
            .status()
            .with_context(|| format!("failed to run git in {}", path.display()))?;

        if !status.success() {
            anyhow::bail!("git command failed in {}", path.display());
        }

        Ok(())
    }

    fn write_fake_claude(root: &Path) -> Result<(PathBuf, PathBuf)> {
        let script_path = root.join("fake-claude.sh");
        let log_path = root.join("fake-claude.log");
        let script = format!(
            "#!/usr/bin/env python3\nimport os\nimport pathlib\nimport signal\nimport sys\nimport time\n\nlog_path = pathlib.Path(r\"{}\")\nlog_path.write_text(os.getcwd() + \"\\n\", encoding=\"utf-8\")\nwith log_path.open(\"a\", encoding=\"utf-8\") as handle:\n    handle.write(\" \".join(sys.argv[1:]) + \"\\n\")\n    handle.write(\"ECC_SESSION_ID=\" + os.environ.get(\"ECC_SESSION_ID\", \"\") + \"\\n\")\n    handle.write(\"CLAUDE_SESSION_ID=\" + os.environ.get(\"CLAUDE_SESSION_ID\", \"\") + \"\\n\")\n    handle.write(\"CLAUDE_PROJECT_DIR=\" + os.environ.get(\"CLAUDE_PROJECT_DIR\", \"\") + \"\\n\")\n    handle.write(\"CLAUDE_CODE_ENTRYPOINT=\" + os.environ.get(\"CLAUDE_CODE_ENTRYPOINT\", \"\") + \"\\n\")\n    handle.write(\"CLAUDE_PACKAGE_MANAGER=\" + os.environ.get(\"CLAUDE_PACKAGE_MANAGER\", \"\") + \"\\n\")\n    handle.write(\"CLAUDE_CODE_PACKAGE_MANAGER=\" + os.environ.get(\"CLAUDE_CODE_PACKAGE_MANAGER\", \"\") + \"\\n\")\n    handle.write(\"CLAUDE_PLUGIN_ROOT=\" + os.environ.get(\"CLAUDE_PLUGIN_ROOT\", \"\") + \"\\n\")\n    handle.write(\"ECC_HARNESS=\" + os.environ.get(\"ECC_HARNESS\", \"\") + \"\\n\")\n\ndef handle_term(signum, frame):\n    raise SystemExit(0)\n\nsignal.signal(signal.SIGTERM, handle_term)\nwhile True:\n    time.sleep(0.1)\n",
            log_path.display()
        );

        fs::write(&script_path, script)?;
        let mut permissions = fs::metadata(&script_path)?.permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&script_path, permissions)?;

        Ok((script_path, log_path))
    }

    fn wait_for_file(path: &Path) -> Result<String> {
        for _ in 0..200 {
            if path.exists() {
                let content = fs::read_to_string(path)
                    .with_context(|| format!("failed to read {}", path.display()))?;
                if content.lines().count() >= 2 {
                    return Ok(content);
                }
            }

            thread::sleep(StdDuration::from_millis(20));
        }

        anyhow::bail!("timed out waiting for {}", path.display());
    }

    fn wait_for_text(path: &Path, needle: &str) -> Result<String> {
        for _ in 0..200 {
            if path.exists() {
                let content = fs::read_to_string(path)
                    .with_context(|| format!("failed to read {}", path.display()))?;
                if content.contains(needle) {
                    return Ok(content);
                }
            }

            thread::sleep(StdDuration::from_millis(20));
        }

        anyhow::bail!("timed out waiting for {}", path.display());
    }

    fn command_env_map(command: &Command) -> BTreeMap<String, String> {
        command
            .as_std()
            .get_envs()
            .filter_map(|(key, value)| {
                value.map(|value| {
                    (
                        key.to_string_lossy().to_string(),
                        value.to_string_lossy().to_string(),
                    )
                })
            })
            .collect()
    }

    #[cfg(unix)]
    #[tokio::test(flavor = "current_thread")]
    async fn background_runner_command_starts_new_session() -> Result<()> {
        let tempdir = TestDir::new("manager-detached-runner")?;
        let script_path = tempdir.path().join("detached-runner.py");
        let log_path = tempdir.path().join("detached-runner.log");
        let script = format!(
            "#!/usr/bin/env python3\nimport os\nimport pathlib\nimport time\n\npath = pathlib.Path(r\"{}\")\npath.write_text(f\"pid={{os.getpid()}} sid={{os.getsid(0)}}\", encoding=\"utf-8\")\ntime.sleep(30)\n",
            log_path.display()
        );
        fs::write(&script_path, script)?;
        let mut permissions = fs::metadata(&script_path)?.permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&script_path, permissions)?;

        let mut command = Command::new(&script_path);
        command
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        configure_background_runner_command(&mut command);

        let mut child = command.spawn()?;
        let child_pid = child.id().context("detached child pid")? as i32;
        let content = wait_for_text(&log_path, "sid=")?;
        let sid = content
            .split_whitespace()
            .find_map(|part| part.strip_prefix("sid="))
            .context("session id should be logged")?
            .parse::<i32>()
            .context("session id should parse")?;
        let parent_sid = unsafe { libc::getsid(0) };

        assert_eq!(sid, child_pid);
        assert_ne!(sid, parent_sid);

        let _ = child.kill().await;
        let _ = child.wait().await;
        Ok(())
    }

    #[test]
    fn background_runner_stderr_log_path_is_session_scoped() {
        let path =
            background_runner_stderr_log_path(Path::new("/tmp/ecc-repo"), "session-123");
        assert_eq!(
            path,
            PathBuf::from("/tmp/ecc-repo/.claude/ecc2/logs/session-123.runner-stderr.log")
        );
    }

    #[cfg(windows)]
    #[test]
    fn detached_creation_flags_include_detach_and_process_group() {
        assert_eq!(detached_creation_flags(), 0x0000_0008 | 0x0000_0200);
    }

    fn write_package_manager_project_files(
        repo_root: &Path,
        package_manager_field: Option<&str>,
        lockfile_name: Option<&str>,
        project_config_package_manager: Option<&str>,
    ) -> Result<()> {
        let package_json = match package_manager_field {
            Some(package_manager_field) => format!(
                "{{\"name\":\"ecc-smoke\",\"packageManager\":\"{package_manager_field}\"}}\n"
            ),
            None => "{\"name\":\"ecc-smoke\"}\n".to_string(),
        };
        fs::write(repo_root.join("package.json"), package_json)?;
        if let Some(lockfile_name) = lockfile_name {
            fs::write(repo_root.join(lockfile_name), "lockfile\n")?;
        }
        if let Some(project_config_package_manager) = project_config_package_manager {
            let claude_dir = repo_root.join(".claude");
            fs::create_dir_all(&claude_dir)?;
            fs::write(
                claude_dir.join("package-manager.json"),
                format!("{{\"packageManager\":\"{project_config_package_manager}\"}}\n"),
            )?;
        }
        Ok(())
    }

    #[tokio::test(flavor = "current_thread")]
    async fn create_session_spawns_process_and_marks_session_running() -> Result<()> {
        let tempdir = TestDir::new("manager-create-session")?;
        let repo_root = tempdir.path().join("repo");
        init_git_repo(&repo_root)?;
        write_package_manager_project_files(&repo_root, None, Some("pnpm-lock.yaml"), None)?;

        let cfg = build_config(tempdir.path());
        let db = StateStore::open(&cfg.db_path)?;
        let (fake_claude, log_path) = write_fake_claude(tempdir.path())?;

        let session_id = create_session_in_dir(
            &db,
            &cfg,
            "implement lifecycle",
            "claude",
            false,
            &repo_root,
            &fake_claude,
        )
        .await?;

        let session = db
            .get_session(&session_id)?
            .context("session should exist")?;
        assert_eq!(session.state, SessionState::Running);
        assert!(
            session.pid.is_some(),
            "spawned session should persist a pid"
        );

        let log = wait_for_file(&log_path)?;
        assert!(log.contains(repo_root.to_string_lossy().as_ref()));
        assert!(log.contains("--print"));
        assert!(log.contains("implement lifecycle"));
        assert!(log.contains(&format!("ECC_SESSION_ID={session_id}")));
        assert!(log.contains(&format!("CLAUDE_SESSION_ID={session_id}")));
        assert!(log.contains(&format!(
            "CLAUDE_PROJECT_DIR={}",
            repo_root.to_string_lossy()
        )));
        assert!(log.contains("CLAUDE_CODE_ENTRYPOINT=cli"));
        assert!(log.contains("CLAUDE_PACKAGE_MANAGER=pnpm"));
        assert!(log.contains("CLAUDE_CODE_PACKAGE_MANAGER=pnpm"));
        assert!(log.contains("ECC_HARNESS=claude"));

        stop_session_with_options(&db, &session_id, false).await?;
        Ok(())
    }

    #[tokio::test(flavor = "current_thread")]
    async fn create_session_resolves_auto_agent_from_repo_markers() -> Result<()> {
        let tempdir = TestDir::new("manager-create-session-auto-agent")?;
        let repo_root = tempdir.path().join("repo");
        init_git_repo(&repo_root)?;
        fs::create_dir_all(repo_root.join(".codex"))?;

        let cfg = build_config(tempdir.path());
        let db = StateStore::open(&cfg.db_path)?;
        let (fake_runner, _log_path) = write_fake_claude(tempdir.path())?;

        let session_id = create_session_in_dir(
            &db,
            &cfg,
            "implement lifecycle",
            "auto",
            false,
            &repo_root,
            &fake_runner,
        )
        .await?;

        let session = db
            .get_session(&session_id)?
            .context("session should exist")?;
        assert_eq!(session.agent_type, "codex");

        stop_session_with_options(&db, &session_id, false).await?;
        Ok(())
    }

    #[tokio::test(flavor = "current_thread")]
    async fn create_session_derives_project_and_task_group_defaults() -> Result<()> {
        let tempdir = TestDir::new("manager-create-session-grouping-defaults")?;
        let repo_root = tempdir.path().join("checkout-api");
        init_git_repo(&repo_root)?;

        let cfg = build_config(tempdir.path());
        let db = StateStore::open(&cfg.db_path)?;
        let (fake_claude, _) = write_fake_claude(tempdir.path())?;

        let session_id = create_session_in_dir(
            &db,
            &cfg,
            "stabilize auth callback",
            "claude",
            false,
            &repo_root,
            &fake_claude,
        )
        .await?;

        let session = db
            .get_session(&session_id)?
            .context("session should exist")?;
        assert_eq!(session.project, "checkout-api");
        assert_eq!(session.task_group, "stabilize auth callback");

        stop_session_with_options(&db, &session_id, false).await?;
        Ok(())
    }

    #[tokio::test(flavor = "current_thread")]
    async fn run_due_schedules_dispatches_due_tasks_and_advances_next_run() -> Result<()> {
        let tempdir = TestDir::new("manager-run-due-schedules")?;
        let repo_root = tempdir.path().join("repo");
        init_git_repo(&repo_root)?;

        let cfg = build_config(tempdir.path());
        let db = StateStore::open(&cfg.db_path)?;
        let (fake_runner, log_path) = write_fake_claude(tempdir.path())?;
        let due_at = Utc::now() - Duration::minutes(1);

        let schedule = db.insert_scheduled_task(
            "*/15 * * * *",
            "Check backlog health",
            "claude",
            None,
            &repo_root,
            "ecc-core",
            "scheduled maintenance",
            true,
            due_at,
        )?;

        let outcomes = run_due_schedules_with_runner_program(&db, &cfg, 10, &fake_runner).await?;
        assert_eq!(outcomes.len(), 1);
        assert_eq!(outcomes[0].schedule_id, schedule.id);
        assert_eq!(outcomes[0].task, "Check backlog health");

        let session = db
            .get_session(&outcomes[0].session_id)?
            .context("scheduled session should exist")?;
        assert_eq!(session.project, "ecc-core");
        assert_eq!(session.task_group, "scheduled maintenance");

        let refreshed = db
            .get_scheduled_task(schedule.id)?
            .context("scheduled task should still exist")?;
        assert!(refreshed.last_run_at.is_some());
        assert!(refreshed.next_run_at > due_at);

        let log = wait_for_file(&log_path)?;
        assert!(log.contains("Check backlog health"));

        stop_session_with_options(&db, &outcomes[0].session_id, true).await?;
        Ok(())
    }

    #[tokio::test(flavor = "current_thread")]
    async fn run_remote_dispatch_requests_prioritizes_critical_targeted_work() -> Result<()> {
        let tempdir = TestDir::new("manager-run-remote-dispatch-priority")?;
        let repo_root = tempdir.path().join("repo");
        init_git_repo(&repo_root)?;

        let cfg = build_config(tempdir.path());
        let db = StateStore::open(&cfg.db_path)?;
        let (fake_runner, _log_path) = write_fake_claude(tempdir.path())?;
        let now = Utc::now();

        db.insert_session(&Session {
            id: "lead".to_string(),
            task: "Lead orchestration".to_string(),
            project: "repo".to_string(),
            task_group: "Lead orchestration".to_string(),
            agent_type: "claude".to_string(),
            working_dir: repo_root.clone(),
            state: SessionState::Running,
            pid: None,
            worktree: None,
            created_at: now,
            updated_at: now,
            last_heartbeat_at: now,
            metrics: SessionMetrics::default(),
        })?;

        let low = create_remote_dispatch_request(
            &db,
            &cfg,
            "Low priority cleanup",
            Some("lead"),
            TaskPriority::Low,
            "claude",
            None,
            true,
            SessionGrouping::default(),
            "cli",
            None,
        )?;
        let critical = create_remote_dispatch_request(
            &db,
            &cfg,
            "Critical production incident",
            Some("lead"),
            TaskPriority::Critical,
            "claude",
            None,
            true,
            SessionGrouping::default(),
            "cli",
            None,
        )?;

        let outcomes = run_remote_dispatch_requests_with_runner_program(
            &db,
            &cfg,
            db.list_pending_remote_dispatch_requests(1)?,
            &fake_runner,
        )
        .await?;
        assert_eq!(outcomes.len(), 1);
        assert_eq!(outcomes[0].request_id, critical.id);
        assert!(matches!(
            outcomes[0].action,
            RemoteDispatchAction::Assigned(AssignmentAction::Spawned)
        ));

        let low_request = db
            .get_remote_dispatch_request(low.id)?
            .context("low priority request should still exist")?;
        assert_eq!(
            low_request.status,
            crate::session::RemoteDispatchStatus::Pending
        );

        let critical_request = db
            .get_remote_dispatch_request(critical.id)?
            .context("critical request should still exist")?;
        assert_eq!(
            critical_request.status,
            crate::session::RemoteDispatchStatus::Dispatched
        );
        assert!(critical_request.result_session_id.is_some());

        Ok(())
    }

    #[tokio::test(flavor = "current_thread")]
    async fn run_remote_dispatch_requests_spawns_top_level_session_when_untargeted() -> Result<()> {
        let tempdir = TestDir::new("manager-run-remote-dispatch-top-level")?;
        let repo_root = tempdir.path().join("repo");
        init_git_repo(&repo_root)?;

        let cfg = build_config(tempdir.path());
        let db = StateStore::open(&cfg.db_path)?;
        let (fake_runner, _log_path) = write_fake_claude(tempdir.path())?;

        let request = db.insert_remote_dispatch_request(
            RemoteDispatchKind::Standard,
            None,
            "Remote phone triage",
            None,
            TaskPriority::High,
            "claude",
            None,
            &repo_root,
            "ecc-core",
            "phone dispatch",
            true,
            "http",
            Some("127.0.0.1"),
        )?;

        let outcomes = run_remote_dispatch_requests_with_runner_program(
            &db,
            &cfg,
            db.list_pending_remote_dispatch_requests(10)?,
            &fake_runner,
        )
        .await?;
        assert_eq!(outcomes.len(), 1);
        assert_eq!(outcomes[0].request_id, request.id);
        assert!(matches!(
            outcomes[0].action,
            RemoteDispatchAction::SpawnedTopLevel
        ));

        let request = db
            .get_remote_dispatch_request(request.id)?
            .context("remote request should still exist")?;
        assert_eq!(
            request.status,
            crate::session::RemoteDispatchStatus::Dispatched
        );
        let session_id = request
            .result_session_id
            .clone()
            .context("spawned top-level request should record a session id")?;
        let session = db
            .get_session(&session_id)?
            .context("spawned session should exist")?;
        assert_eq!(session.project, "ecc-core");
        assert_eq!(session.task_group, "phone dispatch");

        Ok(())
    }

    #[test]
    fn create_computer_use_remote_dispatch_request_uses_config_defaults() -> Result<()> {
        let tempdir = TestDir::new("manager-create-computer-use-remote-defaults")?;
        let repo_root = tempdir.path().join("repo");
        init_git_repo(&repo_root)?;

        let mut cfg = build_config(tempdir.path());
        cfg.computer_use_dispatch = crate::config::ComputerUseDispatchConfig {
            agent: Some("codex".to_string()),
            profile: None,
            use_worktree: false,
            project: Some("ops".to_string()),
            task_group: Some("remote browser".to_string()),
        };
        let db = StateStore::open(&cfg.db_path)?;

        let request = create_computer_use_remote_dispatch_request_in_dir(
            &db,
            &cfg,
            &repo_root,
            "Open the billing portal and confirm the refund banner",
            Some("https://ecc.tools/account"),
            Some("Use the production account flow"),
            None,
            TaskPriority::Critical,
            None,
            None,
            None,
            SessionGrouping::default(),
            "http_computer_use",
            Some("127.0.0.1"),
        )?;

        assert_eq!(request.request_kind, RemoteDispatchKind::ComputerUse);
        assert_eq!(
            request.target_url.as_deref(),
            Some("https://ecc.tools/account")
        );
        assert_eq!(request.agent_type, "codex");
        assert_eq!(request.project, "ops");
        assert_eq!(request.task_group, "remote browser");
        assert!(!request.use_worktree);
        assert!(request.task.contains("Computer-use task."));
        assert!(request.task.contains("Goal: Open the billing portal"));
        assert!(request
            .task
            .contains("Target URL: https://ecc.tools/account"));
        assert!(request
            .task
            .contains("Context: Use the production account flow"));
        Ok(())
    }

    #[tokio::test(flavor = "current_thread")]
    async fn stop_session_kills_process_and_optionally_cleans_worktree() -> Result<()> {
        let tempdir = TestDir::new("manager-stop-session")?;
        let repo_root = tempdir.path().join("repo");
        init_git_repo(&repo_root)?;

        let cfg = build_config(tempdir.path());
        let db = StateStore::open(&cfg.db_path)?;
        let (fake_claude, _) = write_fake_claude(tempdir.path())?;

        let keep_id = create_session_in_dir(
            &db,
            &cfg,
            "keep worktree",
            "claude",
            true,
            &repo_root,
            &fake_claude,
        )
        .await?;
        let keep_session = db.get_session(&keep_id)?.context("keep session missing")?;
        keep_session.pid.context("keep session pid missing")?;
        let keep_worktree = keep_session
            .worktree
            .clone()
            .context("keep session worktree missing")?
            .path;

        stop_session_with_options(&db, &keep_id, false).await?;

        let stopped_keep = db
            .get_session(&keep_id)?
            .context("stopped keep session missing")?;
        assert_eq!(stopped_keep.state, SessionState::Stopped);
        assert_eq!(stopped_keep.pid, None);
        assert!(
            keep_worktree.exists(),
            "worktree should remain when cleanup is disabled"
        );

        let cleanup_id = create_session_in_dir(
            &db,
            &cfg,
            "cleanup worktree",
            "claude",
            true,
            &repo_root,
            &fake_claude,
        )
        .await?;
        let cleanup_session = db
            .get_session(&cleanup_id)?
            .context("cleanup session missing")?;
        let cleanup_worktree = cleanup_session
            .worktree
            .clone()
            .context("cleanup session worktree missing")?
            .path;

        stop_session_with_options(&db, &cleanup_id, true).await?;
        assert!(
            !cleanup_worktree.exists(),
            "worktree should be removed when cleanup is enabled"
        );

        Ok(())
    }

    #[tokio::test(flavor = "current_thread")]
    async fn create_session_with_worktree_limit_queues_without_starting_runner() -> Result<()> {
        let tempdir = TestDir::new("manager-worktree-limit-queue")?;
        let repo_root = tempdir.path().join("repo");
        init_git_repo(&repo_root)?;

        let mut cfg = build_config(tempdir.path());
        cfg.max_parallel_worktrees = 1;
        let db = StateStore::open(&cfg.db_path)?;
        let (fake_claude, log_path) = write_fake_claude(tempdir.path())?;

        let first_id = create_session_in_dir(
            &db,
            &cfg,
            "active worktree",
            "claude",
            true,
            &repo_root,
            &fake_claude,
        )
        .await?;
        let second_id = create_session_in_dir(
            &db,
            &cfg,
            "queued worktree",
            "claude",
            true,
            &repo_root,
            &fake_claude,
        )
        .await?;

        let first = db
            .get_session(&first_id)?
            .context("first session missing")?;
        assert_eq!(first.state, SessionState::Running);
        assert!(first.worktree.is_some());

        let second = db
            .get_session(&second_id)?
            .context("second session missing")?;
        assert_eq!(second.state, SessionState::Pending);
        assert!(second.pid.is_none());
        assert!(second.worktree.is_none());
        assert!(db.pending_worktree_queue_contains(&second_id)?);

        let log = wait_for_file(&log_path)?;
        assert!(log.contains("active worktree"));
        assert!(!log.contains("queued worktree"));

        stop_session_with_options(&db, &first_id, true).await?;
        Ok(())
    }

    #[tokio::test(flavor = "current_thread")]
    async fn activate_pending_worktree_sessions_starts_queued_session_when_slot_opens() -> Result<()>
    {
        let tempdir = TestDir::new("manager-worktree-limit-activate")?;
        let repo_root = tempdir.path().join("repo");
        init_git_repo(&repo_root)?;

        let mut cfg = build_config(tempdir.path());
        cfg.max_parallel_worktrees = 1;
        let db = StateStore::open(&cfg.db_path)?;
        let (fake_claude, _) = write_fake_claude(tempdir.path())?;

        let first_id = create_session_in_dir(
            &db,
            &cfg,
            "active worktree",
            "claude",
            true,
            &repo_root,
            &fake_claude,
        )
        .await?;
        let second_id = create_session_in_dir(
            &db,
            &cfg,
            "queued worktree",
            "claude",
            true,
            &repo_root,
            &fake_claude,
        )
        .await?;

        stop_session_with_options(&db, &first_id, true).await?;

        let launch_log = tempdir.path().join("queued-launch.log");
        let started =
            activate_pending_worktree_sessions_with(&db, &cfg, |_, session_id, task, _, cwd| {
                let launch_log = launch_log.clone();
                async move {
                    fs::write(
                        &launch_log,
                        format!("{session_id}\n{task}\n{}\n", cwd.display()),
                    )?;
                    Ok(())
                }
            })
            .await?;

        assert_eq!(started, vec![second_id.clone()]);
        assert!(!db.pending_worktree_queue_contains(&second_id)?);

        let second = db
            .get_session(&second_id)?
            .context("queued session missing")?;
        let worktree = second
            .worktree
            .context("queued session should gain worktree")?;
        assert_eq!(second.state, SessionState::Pending);
        assert!(worktree.path.exists());

        let launch = fs::read_to_string(&launch_log)?;
        assert!(launch.contains(&second_id));
        assert!(launch.contains("queued worktree"));
        assert!(launch.contains(worktree.path.to_string_lossy().as_ref()));

        crate::worktree::remove(&worktree)?;
        db.clear_worktree_to_dir(&second_id, &repo_root)?;
        Ok(())
    }

    #[tokio::test(flavor = "current_thread")]
    async fn create_session_uses_default_agent_profile_and_persists_launch_settings() -> Result<()>
    {
        let tempdir = TestDir::new("manager-default-agent-profile")?;
        let repo_root = tempdir.path().join("repo");
        init_git_repo(&repo_root)?;

        let mut cfg = build_config(tempdir.path());
        cfg.default_agent_profile = Some("reviewer".to_string());
        cfg.agent_profiles.insert(
            "reviewer".to_string(),
            crate::config::AgentProfileConfig {
                model: Some("sonnet".to_string()),
                allowed_tools: vec!["Read".to_string(), "Edit".to_string()],
                disallowed_tools: vec!["Bash".to_string()],
                permission_mode: Some("plan".to_string()),
                add_dirs: vec![PathBuf::from("docs")],
                token_budget: Some(800),
                append_system_prompt: Some("Review thoroughly.".to_string()),
                ..Default::default()
            },
        );
        let db = StateStore::open(&cfg.db_path)?;
        let (fake_runner, _) = write_fake_claude(tempdir.path())?;

        let session_id = queue_session_in_dir_with_runner_program(
            &db,
            &cfg,
            "review work",
            "claude",
            false,
            &repo_root,
            &fake_runner,
            None,
            None,
            SessionGrouping::default(),
        )
        .await?;

        let profile = db
            .get_session_profile(&session_id)?
            .context("session profile should be persisted")?;
        assert_eq!(profile.profile_name, "reviewer");
        assert_eq!(profile.model.as_deref(), Some("sonnet"));
        assert_eq!(profile.allowed_tools, vec!["Read", "Edit"]);
        assert_eq!(profile.disallowed_tools, vec!["Bash"]);
        assert_eq!(profile.permission_mode.as_deref(), Some("plan"));
        assert_eq!(profile.add_dirs, vec![PathBuf::from("docs")]);
        assert_eq!(profile.token_budget, Some(800));
        assert_eq!(
            profile.append_system_prompt.as_deref(),
            Some("Review thoroughly.")
        );

        Ok(())
    }

    #[test]
    fn enforce_budget_hard_limits_stops_active_sessions_without_cleaning_worktrees() -> Result<()> {
        let tempdir = TestDir::new("manager-budget-pause")?;
        let mut cfg = build_config(tempdir.path());
        cfg.token_budget = 100;
        cfg.cost_budget_usd = 0.0;

        let db = StateStore::open(&cfg.db_path)?;
        let now = Utc::now();
        let worktree_path = tempdir.path().join("keep-worktree");
        fs::create_dir_all(&worktree_path)?;

        db.insert_session(&Session {
            id: "active-over-budget".to_string(),
            task: "pause on hard limit".to_string(),
            project: "workspace".to_string(),
            task_group: "general".to_string(),
            agent_type: "claude".to_string(),
            working_dir: tempdir.path().to_path_buf(),
            state: SessionState::Running,
            pid: Some(999_999),
            worktree: Some(crate::session::WorktreeInfo {
                path: worktree_path.clone(),
                branch: "ecc/active-over-budget".to_string(),
                base_branch: "main".to_string(),
            }),
            created_at: now - Duration::minutes(1),
            updated_at: now,
            last_heartbeat_at: now,
            metrics: SessionMetrics::default(),
        })?;
        db.update_metrics(
            "active-over-budget",
            &SessionMetrics {
                input_tokens: 90,
                output_tokens: 30,
                tokens_used: 120,
                tool_calls: 0,
                files_changed: 0,
                duration_secs: 60,
                cost_usd: 0.0,
            },
        )?;

        let outcome = enforce_budget_hard_limits(&db, &cfg)?;
        assert!(outcome.token_budget_exceeded);
        assert!(!outcome.cost_budget_exceeded);
        assert_eq!(
            outcome.paused_sessions,
            vec!["active-over-budget".to_string()]
        );

        let session = db
            .get_session("active-over-budget")?
            .context("session should still exist")?;
        assert_eq!(session.state, SessionState::Stopped);
        assert_eq!(session.pid, None);
        assert!(
            worktree_path.exists(),
            "hard-limit pauses should preserve worktrees for resume"
        );

        Ok(())
    }

    #[test]
    fn enforce_budget_hard_limits_ignores_inactive_sessions() -> Result<()> {
        let tempdir = TestDir::new("manager-budget-ignore-inactive")?;
        let mut cfg = build_config(tempdir.path());
        cfg.token_budget = 100;
        cfg.cost_budget_usd = 0.0;

        let db = StateStore::open(&cfg.db_path)?;
        let now = Utc::now();

        db.insert_session(&Session {
            id: "completed-over-budget".to_string(),
            task: "already done".to_string(),
            project: "workspace".to_string(),
            task_group: "general".to_string(),
            agent_type: "claude".to_string(),
            working_dir: tempdir.path().to_path_buf(),
            state: SessionState::Completed,
            pid: None,
            worktree: None,
            created_at: now - Duration::minutes(2),
            updated_at: now - Duration::minutes(1),
            last_heartbeat_at: now - Duration::minutes(1),
            metrics: SessionMetrics::default(),
        })?;
        db.update_metrics(
            "completed-over-budget",
            &SessionMetrics {
                input_tokens: 90,
                output_tokens: 30,
                tokens_used: 120,
                tool_calls: 0,
                files_changed: 0,
                duration_secs: 60,
                cost_usd: 0.0,
            },
        )?;

        let outcome = enforce_budget_hard_limits(&db, &cfg)?;
        assert!(outcome.token_budget_exceeded);
        assert!(outcome.paused_sessions.is_empty());

        let session = db
            .get_session("completed-over-budget")?
            .context("completed session should still exist")?;
        assert_eq!(session.state, SessionState::Completed);

        Ok(())
    }

    #[test]
    fn enforce_budget_hard_limits_pauses_sessions_over_profile_token_budget() -> Result<()> {
        let tempdir = TestDir::new("manager-profile-token-budget")?;
        let cfg = build_config(tempdir.path());
        let db = StateStore::open(&cfg.db_path)?;
        let now = Utc::now();

        db.insert_session(&Session {
            id: "profile-over-budget".to_string(),
            task: "review work".to_string(),
            project: "workspace".to_string(),
            task_group: "general".to_string(),
            agent_type: "claude".to_string(),
            working_dir: tempdir.path().to_path_buf(),
            state: SessionState::Running,
            pid: Some(999_998),
            worktree: None,
            created_at: now - Duration::minutes(1),
            updated_at: now,
            last_heartbeat_at: now,
            metrics: SessionMetrics::default(),
        })?;
        db.upsert_session_profile(
            "profile-over-budget",
            &SessionAgentProfile {
                profile_name: "reviewer".to_string(),
                agent: None,
                model: Some("sonnet".to_string()),
                allowed_tools: vec!["Read".to_string()],
                disallowed_tools: Vec::new(),
                permission_mode: Some("plan".to_string()),
                add_dirs: Vec::new(),
                max_budget_usd: None,
                token_budget: Some(75),
                append_system_prompt: None,
            },
        )?;
        db.update_metrics(
            "profile-over-budget",
            &SessionMetrics {
                input_tokens: 60,
                output_tokens: 30,
                tokens_used: 90,
                tool_calls: 0,
                files_changed: 0,
                duration_secs: 60,
                cost_usd: 0.0,
            },
        )?;

        let outcome = enforce_budget_hard_limits(&db, &cfg)?;
        assert!(!outcome.token_budget_exceeded);
        assert!(!outcome.cost_budget_exceeded);
        assert!(outcome.profile_token_budget_exceeded);
        assert_eq!(
            outcome.paused_sessions,
            vec!["profile-over-budget".to_string()]
        );

        let session = db
            .get_session("profile-over-budget")?
            .context("session should still exist")?;
        assert_eq!(session.state, SessionState::Stopped);

        Ok(())
    }

    #[tokio::test(flavor = "current_thread")]
    async fn resume_session_requeues_failed_session() -> Result<()> {
        let tempdir = TestDir::new("manager-resume-session")?;
        let cfg = build_config(tempdir.path());
        let db = StateStore::open(&cfg.db_path)?;
        let now = Utc::now();

        db.insert_session(&Session {
            id: "deadbeef".to_string(),
            task: "resume previous task".to_string(),
            project: "workspace".to_string(),
            task_group: "general".to_string(),
            agent_type: "claude".to_string(),
            working_dir: tempdir.path().join("resume-working-dir"),
            state: SessionState::Failed,
            pid: Some(31337),
            worktree: None,
            created_at: now - Duration::minutes(1),
            updated_at: now,
            last_heartbeat_at: now,
            metrics: SessionMetrics::default(),
        })?;

        fs::create_dir_all(tempdir.path().join("resume-working-dir"))?;
        let (fake_claude, log_path) = write_fake_claude(tempdir.path())?;

        let resumed_id =
            resume_session_with_program(&db, &cfg, "deadbeef", Some(&fake_claude)).await?;
        let resumed = db
            .get_session(&resumed_id)?
            .context("resumed session should exist")?;

        assert_eq!(resumed.state, SessionState::Pending);
        assert_eq!(resumed.pid, None);

        let log = wait_for_file(&log_path)?;
        assert!(log.contains("run-session"));
        assert!(log.contains("--session-id"));
        assert!(log.contains("deadbeef"));
        assert!(log.contains("resume previous task"));
        assert!(log.contains(
            tempdir
                .path()
                .join("resume-working-dir")
                .to_string_lossy()
                .as_ref()
        ));

        Ok(())
    }

    #[tokio::test(flavor = "current_thread")]
    async fn cleanup_session_worktree_removes_path_and_clears_metadata() -> Result<()> {
        let tempdir = TestDir::new("manager-cleanup-worktree")?;
        let repo_root = tempdir.path().join("repo");
        init_git_repo(&repo_root)?;

        let cfg = build_config(tempdir.path());
        let db = StateStore::open(&cfg.db_path)?;
        let (fake_claude, _) = write_fake_claude(tempdir.path())?;

        let session_id = create_session_in_dir(
            &db,
            &cfg,
            "cleanup later",
            "claude",
            true,
            &repo_root,
            &fake_claude,
        )
        .await?;

        stop_session_with_options(&db, &session_id, false).await?;
        let stopped = db
            .get_session(&session_id)?
            .context("stopped session should exist")?;
        let worktree_path = stopped
            .worktree
            .clone()
            .context("stopped session worktree missing")?
            .path;
        assert!(
            worktree_path.exists(),
            "worktree should still exist before cleanup"
        );

        cleanup_session_worktree(&db, &session_id).await?;

        let cleaned = db
            .get_session(&session_id)?
            .context("cleaned session should still exist")?;
        assert!(
            cleaned.worktree.is_none(),
            "worktree metadata should be cleared"
        );
        assert!(!worktree_path.exists(), "worktree path should be removed");

        Ok(())
    }

    #[tokio::test(flavor = "current_thread")]
    async fn prune_inactive_worktrees_cleans_stopped_sessions_only() -> Result<()> {
        let tempdir = TestDir::new("manager-prune-worktrees")?;
        let repo_root = tempdir.path().join("repo");
        init_git_repo(&repo_root)?;

        let cfg = build_config(tempdir.path());
        let db = StateStore::open(&cfg.db_path)?;
        let (fake_claude, _) = write_fake_claude(tempdir.path())?;

        let active_id = create_session_in_dir(
            &db,
            &cfg,
            "active worktree",
            "claude",
            true,
            &repo_root,
            &fake_claude,
        )
        .await?;
        let stopped_id = create_session_in_dir(
            &db,
            &cfg,
            "stopped worktree",
            "claude",
            true,
            &repo_root,
            &fake_claude,
        )
        .await?;

        stop_session_with_options(&db, &stopped_id, false).await?;

        let active_before = db
            .get_session(&active_id)?
            .context("active session should exist")?;
        let active_path = active_before
            .worktree
            .clone()
            .context("active session worktree missing")?
            .path;

        let stopped_before = db
            .get_session(&stopped_id)?
            .context("stopped session should exist")?;
        let stopped_path = stopped_before
            .worktree
            .clone()
            .context("stopped session worktree missing")?
            .path;

        let outcome = prune_inactive_worktrees(&db, &cfg).await?;

        assert_eq!(outcome.cleaned_session_ids, vec![stopped_id.clone()]);
        assert_eq!(outcome.active_with_worktree_ids, vec![active_id.clone()]);
        assert!(outcome.retained_session_ids.is_empty());
        assert!(active_path.exists(), "active worktree should remain");
        assert!(!stopped_path.exists(), "stopped worktree should be removed");

        let active_after = db
            .get_session(&active_id)?
            .context("active session should still exist")?;
        assert!(
            active_after.worktree.is_some(),
            "active session should keep worktree metadata"
        );

        let stopped_after = db
            .get_session(&stopped_id)?
            .context("stopped session should still exist")?;
        assert!(
            stopped_after.worktree.is_none(),
            "stopped session worktree metadata should be cleared"
        );

        Ok(())
    }

    #[tokio::test(flavor = "current_thread")]
    async fn prune_inactive_worktrees_defers_recent_sessions_within_retention() -> Result<()> {
        let tempdir = TestDir::new("manager-prune-worktree-retention")?;
        let repo_root = tempdir.path().join("repo");
        init_git_repo(&repo_root)?;

        let mut cfg = build_config(tempdir.path());
        cfg.worktree_retention_secs = 3600;
        let db = StateStore::open(&cfg.db_path)?;
        let (fake_claude, _) = write_fake_claude(tempdir.path())?;

        let session_id = create_session_in_dir(
            &db,
            &cfg,
            "recently completed worktree",
            "claude",
            true,
            &repo_root,
            &fake_claude,
        )
        .await?;

        stop_session_with_options(&db, &session_id, false).await?;

        let before = db
            .get_session(&session_id)?
            .context("retained session should exist")?;
        let worktree_path = before
            .worktree
            .clone()
            .context("retained session worktree missing")?
            .path;

        let outcome = prune_inactive_worktrees(&db, &cfg).await?;

        assert!(outcome.cleaned_session_ids.is_empty());
        assert!(outcome.active_with_worktree_ids.is_empty());
        assert_eq!(outcome.retained_session_ids, vec![session_id.clone()]);
        assert!(worktree_path.exists(), "retained worktree should remain");
        assert!(
            db.get_session(&session_id)?
                .context("retained session should still exist")?
                .worktree
                .is_some(),
            "retained session should keep worktree metadata"
        );

        crate::worktree::remove(
            &db.get_session(&session_id)?
                .context("retained session should still exist")?
                .worktree
                .context("retained session should still have worktree")?,
        )?;
        db.clear_worktree_to_dir(&session_id, &repo_root)?;

        Ok(())
    }

    #[tokio::test(flavor = "current_thread")]
    async fn merge_session_worktree_merges_branch_and_cleans_worktree() -> Result<()> {
        let tempdir = TestDir::new("manager-merge-worktree")?;
        let repo_root = tempdir.path().join("repo");
        init_git_repo(&repo_root)?;

        let cfg = build_config(tempdir.path());
        let db = StateStore::open(&cfg.db_path)?;
        let (fake_claude, _) = write_fake_claude(tempdir.path())?;

        let session_id = create_session_in_dir(
            &db,
            &cfg,
            "merge later",
            "claude",
            true,
            &repo_root,
            &fake_claude,
        )
        .await?;

        stop_session_with_options(&db, &session_id, false).await?;
        let stopped = db
            .get_session(&session_id)?
            .context("stopped session should exist")?;
        let worktree = stopped
            .worktree
            .clone()
            .context("stopped session worktree missing")?;

        fs::write(worktree.path.join("feature.txt"), "ready to merge\n")?;
        run_git(&worktree.path, ["add", "feature.txt"])?;
        run_git(&worktree.path, ["commit", "-qm", "feature work"])?;

        let outcome = merge_session_worktree(&db, &session_id, true).await?;

        assert_eq!(outcome.session_id, session_id);
        assert_eq!(outcome.branch, worktree.branch);
        assert_eq!(outcome.base_branch, worktree.base_branch);
        assert!(outcome.cleaned_worktree);
        assert!(!outcome.already_up_to_date);
        assert_eq!(
            fs::read_to_string(repo_root.join("feature.txt"))?,
            "ready to merge\n"
        );

        let merged = db
            .get_session(&outcome.session_id)?
            .context("merged session should still exist")?;
        assert!(
            merged.worktree.is_none(),
            "worktree metadata should be cleared"
        );
        assert!(!worktree.path.exists(), "worktree path should be removed");

        let branch_output = StdCommand::new("git")
            .arg("-C")
            .arg(&repo_root)
            .args(["branch", "--list", &worktree.branch])
            .output()?;
        assert!(
            String::from_utf8_lossy(&branch_output.stdout)
                .trim()
                .is_empty(),
            "merged worktree branch should be deleted"
        );

        Ok(())
    }

    #[tokio::test(flavor = "current_thread")]
    async fn merge_ready_worktrees_merges_ready_sessions_and_skips_active_and_dirty() -> Result<()>
    {
        let tempdir = TestDir::new("manager-merge-ready-worktrees")?;
        let repo_root = tempdir.path().join("repo");
        init_git_repo(&repo_root)?;

        let cfg = build_config(tempdir.path());
        let db = StateStore::open(&cfg.db_path)?;
        let now = Utc::now();

        let merged_worktree =
            crate::worktree::create_for_session_in_repo("merge-ready", &cfg, &repo_root)?;
        fs::write(merged_worktree.path.join("merged.txt"), "bulk merge\n")?;
        run_git(&merged_worktree.path, ["add", "merged.txt"])?;
        run_git(&merged_worktree.path, ["commit", "-qm", "merge ready"])?;
        db.insert_session(&Session {
            id: "merge-ready".to_string(),
            task: "merge me".to_string(),
            project: "workspace".to_string(),
            task_group: "general".to_string(),
            agent_type: "claude".to_string(),
            working_dir: merged_worktree.path.clone(),
            state: SessionState::Completed,
            pid: None,
            worktree: Some(merged_worktree.clone()),
            created_at: now,
            updated_at: now,
            last_heartbeat_at: now,
            metrics: SessionMetrics::default(),
        })?;

        let active_worktree =
            crate::worktree::create_for_session_in_repo("active-worktree", &cfg, &repo_root)?;
        db.insert_session(&Session {
            id: "active-worktree".to_string(),
            task: "still running".to_string(),
            project: "workspace".to_string(),
            task_group: "general".to_string(),
            agent_type: "claude".to_string(),
            working_dir: active_worktree.path.clone(),
            state: SessionState::Running,
            pid: Some(12345),
            worktree: Some(active_worktree.clone()),
            created_at: now,
            updated_at: now,
            last_heartbeat_at: now,
            metrics: SessionMetrics::default(),
        })?;

        let dirty_worktree =
            crate::worktree::create_for_session_in_repo("dirty-worktree", &cfg, &repo_root)?;
        fs::write(dirty_worktree.path.join("dirty.txt"), "not committed yet\n")?;
        db.insert_session(&Session {
            id: "dirty-worktree".to_string(),
            task: "needs commit".to_string(),
            project: "workspace".to_string(),
            task_group: "general".to_string(),
            agent_type: "claude".to_string(),
            working_dir: dirty_worktree.path.clone(),
            state: SessionState::Stopped,
            pid: None,
            worktree: Some(dirty_worktree.clone()),
            created_at: now,
            updated_at: now,
            last_heartbeat_at: now,
            metrics: SessionMetrics::default(),
        })?;

        let outcome = merge_ready_worktrees(&db, true).await?;

        assert_eq!(outcome.merged.len(), 1);
        assert_eq!(outcome.merged[0].session_id, "merge-ready");
        assert_eq!(
            outcome.active_with_worktree_ids,
            vec!["active-worktree".to_string()]
        );
        assert_eq!(
            outcome.dirty_worktree_ids,
            vec!["dirty-worktree".to_string()]
        );
        assert!(outcome.conflicted_session_ids.is_empty());
        assert!(outcome.failures.is_empty());

        assert_eq!(
            fs::read_to_string(repo_root.join("merged.txt"))?,
            "bulk merge\n"
        );
        assert!(db
            .get_session("merge-ready")?
            .context("merged session should still exist")?
            .worktree
            .is_none());
        assert!(db
            .get_session("active-worktree")?
            .context("active session should still exist")?
            .worktree
            .is_some());
        assert!(db
            .get_session("dirty-worktree")?
            .context("dirty session should still exist")?
            .worktree
            .is_some());
        assert!(!merged_worktree.path.exists());
        assert!(active_worktree.path.exists());
        assert!(dirty_worktree.path.exists());

        Ok(())
    }

    #[tokio::test(flavor = "current_thread")]
    async fn process_merge_queue_rebases_blocked_session_and_merges_it() -> Result<()> {
        let tempdir = TestDir::new("manager-process-merge-queue-success")?;
        let repo_root = tempdir.path().join("repo");
        init_git_repo(&repo_root)?;

        let cfg = build_config(tempdir.path());
        let db = StateStore::open(&cfg.db_path)?;
        let now = Utc::now();

        let alpha_worktree = worktree::create_for_session_in_repo("alpha", &cfg, &repo_root)?;
        fs::write(alpha_worktree.path.join("README.md"), "hello\nalpha\n")?;
        run_git(&alpha_worktree.path, ["commit", "-am", "alpha change"])?;

        let beta_worktree = worktree::create_for_session_in_repo("beta", &cfg, &repo_root)?;
        fs::write(beta_worktree.path.join("README.md"), "hello\nalpha\n")?;
        run_git(&beta_worktree.path, ["commit", "-am", "beta shared change"])?;
        fs::write(beta_worktree.path.join("README.md"), "hello\nalpha\nbeta\n")?;
        run_git(&beta_worktree.path, ["commit", "-am", "beta follow-up"])?;

        db.insert_session(&Session {
            id: "alpha".to_string(),
            task: "alpha merge".to_string(),
            project: "ecc".to_string(),
            task_group: "merge".to_string(),
            agent_type: "claude".to_string(),
            working_dir: alpha_worktree.path.clone(),
            state: SessionState::Completed,
            pid: None,
            worktree: Some(alpha_worktree.clone()),
            created_at: now - Duration::minutes(2),
            updated_at: now - Duration::minutes(2),
            last_heartbeat_at: now - Duration::minutes(2),
            metrics: SessionMetrics::default(),
        })?;
        db.insert_session(&Session {
            id: "beta".to_string(),
            task: "beta merge".to_string(),
            project: "ecc".to_string(),
            task_group: "merge".to_string(),
            agent_type: "claude".to_string(),
            working_dir: beta_worktree.path.clone(),
            state: SessionState::Completed,
            pid: None,
            worktree: Some(beta_worktree.clone()),
            created_at: now - Duration::minutes(1),
            updated_at: now - Duration::minutes(1),
            last_heartbeat_at: now - Duration::minutes(1),
            metrics: SessionMetrics::default(),
        })?;

        let queue_before = build_merge_queue(&db)?;
        assert_eq!(queue_before.ready_entries.len(), 1);
        assert_eq!(queue_before.ready_entries[0].session_id, "alpha");
        assert_eq!(queue_before.blocked_entries.len(), 1);
        assert_eq!(queue_before.blocked_entries[0].session_id, "beta");

        let outcome = process_merge_queue(&db).await?;

        assert_eq!(
            outcome
                .merged
                .iter()
                .map(|entry| entry.session_id.as_str())
                .collect::<Vec<_>>(),
            vec!["alpha", "beta"]
        );
        assert_eq!(outcome.rebased.len(), 1);
        assert_eq!(outcome.rebased[0].session_id, "beta");
        assert!(outcome.active_with_worktree_ids.is_empty());
        assert!(outcome.conflicted_session_ids.is_empty());
        assert!(outcome.dirty_worktree_ids.is_empty());
        assert!(outcome.blocked_by_queue_session_ids.is_empty());
        assert!(outcome.failures.is_empty());
        assert_eq!(
            fs::read_to_string(repo_root.join("README.md"))?,
            "hello\nalpha\nbeta\n"
        );
        assert!(db
            .get_session("alpha")?
            .context("alpha should still exist")?
            .worktree
            .is_none());
        assert!(db
            .get_session("beta")?
            .context("beta should still exist")?
            .worktree
            .is_none());

        Ok(())
    }

    #[tokio::test(flavor = "current_thread")]
    async fn process_merge_queue_records_failed_rebase_and_leaves_blocked_session() -> Result<()> {
        let tempdir = TestDir::new("manager-process-merge-queue-fail")?;
        let repo_root = tempdir.path().join("repo");
        init_git_repo(&repo_root)?;

        let cfg = build_config(tempdir.path());
        let db = StateStore::open(&cfg.db_path)?;
        let now = Utc::now();

        let alpha_worktree = worktree::create_for_session_in_repo("alpha", &cfg, &repo_root)?;
        fs::write(alpha_worktree.path.join("README.md"), "hello\nalpha\n")?;
        run_git(&alpha_worktree.path, ["commit", "-am", "alpha change"])?;

        let beta_worktree = worktree::create_for_session_in_repo("beta", &cfg, &repo_root)?;
        fs::write(beta_worktree.path.join("README.md"), "hello\nbeta\n")?;
        run_git(&beta_worktree.path, ["commit", "-am", "beta change"])?;

        db.insert_session(&Session {
            id: "alpha".to_string(),
            task: "alpha merge".to_string(),
            project: "ecc".to_string(),
            task_group: "merge".to_string(),
            agent_type: "claude".to_string(),
            working_dir: alpha_worktree.path.clone(),
            state: SessionState::Completed,
            pid: None,
            worktree: Some(alpha_worktree.clone()),
            created_at: now - Duration::minutes(2),
            updated_at: now - Duration::minutes(2),
            last_heartbeat_at: now - Duration::minutes(2),
            metrics: SessionMetrics::default(),
        })?;
        db.insert_session(&Session {
            id: "beta".to_string(),
            task: "beta merge".to_string(),
            project: "ecc".to_string(),
            task_group: "merge".to_string(),
            agent_type: "claude".to_string(),
            working_dir: beta_worktree.path.clone(),
            state: SessionState::Completed,
            pid: None,
            worktree: Some(beta_worktree.clone()),
            created_at: now - Duration::minutes(1),
            updated_at: now - Duration::minutes(1),
            last_heartbeat_at: now - Duration::minutes(1),
            metrics: SessionMetrics::default(),
        })?;

        let outcome = process_merge_queue(&db).await?;

        assert_eq!(
            outcome
                .merged
                .iter()
                .map(|entry| entry.session_id.as_str())
                .collect::<Vec<_>>(),
            vec!["alpha"]
        );
        assert!(outcome.rebased.is_empty());
        assert_eq!(outcome.conflicted_session_ids, vec!["beta".to_string()]);
        assert!(outcome.active_with_worktree_ids.is_empty());
        assert!(outcome.dirty_worktree_ids.is_empty());
        assert!(outcome.blocked_by_queue_session_ids.is_empty());
        assert_eq!(outcome.failures.len(), 1);
        assert_eq!(outcome.failures[0].session_id, "beta");
        assert!(outcome.failures[0].reason.contains("git rebase failed"));
        assert!(db
            .get_session("beta")?
            .context("beta should still exist")?
            .worktree
            .is_some());

        Ok(())
    }

    #[tokio::test(flavor = "current_thread")]
    async fn build_merge_queue_orders_ready_sessions_and_blocks_conflicts() -> Result<()> {
        let tempdir = TestDir::new("manager-merge-queue")?;
        let repo_root = tempdir.path().join("repo");
        init_git_repo(&repo_root)?;

        let cfg = build_config(tempdir.path());
        let db = StateStore::open(&cfg.db_path)?;
        let now = Utc::now();

        let alpha_worktree = worktree::create_for_session_in_repo("alpha", &cfg, &repo_root)?;
        fs::write(alpha_worktree.path.join("README.md"), "alpha\n")?;
        run_git(&alpha_worktree.path, ["add", "README.md"])?;
        run_git(&alpha_worktree.path, ["commit", "-m", "alpha change"])?;

        let beta_worktree = worktree::create_for_session_in_repo("beta", &cfg, &repo_root)?;
        fs::write(beta_worktree.path.join("README.md"), "beta\n")?;
        run_git(&beta_worktree.path, ["add", "README.md"])?;
        run_git(&beta_worktree.path, ["commit", "-m", "beta change"])?;

        let gamma_worktree = worktree::create_for_session_in_repo("gamma", &cfg, &repo_root)?;
        fs::write(gamma_worktree.path.join("src.txt"), "gamma\n")?;
        run_git(&gamma_worktree.path, ["add", "src.txt"])?;
        run_git(&gamma_worktree.path, ["commit", "-m", "gamma change"])?;

        db.insert_session(&Session {
            id: "alpha".to_string(),
            task: "alpha merge".to_string(),
            project: "ecc".to_string(),
            task_group: "merge".to_string(),
            agent_type: "claude".to_string(),
            working_dir: alpha_worktree.path.clone(),
            state: SessionState::Stopped,
            pid: None,
            worktree: Some(alpha_worktree),
            created_at: now - Duration::minutes(3),
            updated_at: now - Duration::minutes(3),
            last_heartbeat_at: now - Duration::minutes(3),
            metrics: SessionMetrics::default(),
        })?;
        db.insert_session(&Session {
            id: "beta".to_string(),
            task: "beta merge".to_string(),
            project: "ecc".to_string(),
            task_group: "merge".to_string(),
            agent_type: "claude".to_string(),
            working_dir: beta_worktree.path.clone(),
            state: SessionState::Stopped,
            pid: None,
            worktree: Some(beta_worktree),
            created_at: now - Duration::minutes(2),
            updated_at: now - Duration::minutes(2),
            last_heartbeat_at: now - Duration::minutes(2),
            metrics: SessionMetrics::default(),
        })?;
        db.insert_session(&Session {
            id: "gamma".to_string(),
            task: "gamma merge".to_string(),
            project: "ecc".to_string(),
            task_group: "merge".to_string(),
            agent_type: "claude".to_string(),
            working_dir: gamma_worktree.path.clone(),
            state: SessionState::Stopped,
            pid: None,
            worktree: Some(gamma_worktree),
            created_at: now - Duration::minutes(1),
            updated_at: now - Duration::minutes(1),
            last_heartbeat_at: now - Duration::minutes(1),
            metrics: SessionMetrics::default(),
        })?;

        let queue = build_merge_queue(&db)?;
        assert_eq!(queue.ready_entries.len(), 2);
        assert_eq!(queue.ready_entries[0].session_id, "alpha");
        assert_eq!(queue.ready_entries[0].queue_position, Some(1));
        assert_eq!(queue.ready_entries[1].session_id, "gamma");
        assert_eq!(queue.ready_entries[1].queue_position, Some(2));

        assert_eq!(queue.blocked_entries.len(), 1);
        let blocked = &queue.blocked_entries[0];
        assert_eq!(blocked.session_id, "beta");
        assert_eq!(blocked.blocked_by.len(), 1);
        assert_eq!(blocked.blocked_by[0].session_id, "alpha");
        assert!(blocked.blocked_by[0]
            .conflicts
            .contains(&"README.md".to_string()));
        assert!(blocked.suggested_action.contains("merge after alpha"));

        Ok(())
    }

    #[tokio::test(flavor = "current_thread")]
    async fn delete_session_removes_inactive_session_and_worktree() -> Result<()> {
        let tempdir = TestDir::new("manager-delete-session")?;
        let repo_root = tempdir.path().join("repo");
        init_git_repo(&repo_root)?;

        let cfg = build_config(tempdir.path());
        let db = StateStore::open(&cfg.db_path)?;
        let (fake_claude, _) = write_fake_claude(tempdir.path())?;

        let session_id = create_session_in_dir(
            &db,
            &cfg,
            "delete later",
            "claude",
            true,
            &repo_root,
            &fake_claude,
        )
        .await?;

        stop_session_with_options(&db, &session_id, false).await?;
        let stopped = db
            .get_session(&session_id)?
            .context("stopped session should exist")?;
        let worktree_path = stopped
            .worktree
            .clone()
            .context("stopped session worktree missing")?
            .path;

        delete_session(&db, &session_id).await?;

        assert!(
            db.get_session(&session_id)?.is_none(),
            "session should be deleted"
        );
        assert!(!worktree_path.exists(), "worktree path should be removed");

        Ok(())
    }

    #[test]
    fn get_status_supports_latest_alias() -> Result<()> {
        let tempdir = TestDir::new("manager-latest-status")?;
        let cfg = build_config(tempdir.path());
        let db = StateStore::open(&cfg.db_path)?;
        let older = Utc::now() - Duration::minutes(2);
        let newer = Utc::now();

        db.insert_session(&build_session("older", SessionState::Running, older))?;
        db.insert_session(&build_session("newer", SessionState::Idle, newer))?;

        let status = get_status(&db, &cfg, "latest")?;
        assert_eq!(status.session.id, "newer");

        Ok(())
    }

    #[test]
    fn get_status_uses_configured_custom_harness_markers() -> Result<()> {
        let tempdir = TestDir::new("manager-custom-harness-status")?;
        fs::create_dir_all(tempdir.path().join(".acme"))?;
        let mut cfg = build_config(tempdir.path());
        cfg.harness_runners.insert(
            "acme-runner".to_string(),
            crate::config::HarnessRunnerConfig {
                project_markers: vec![PathBuf::from(".acme")],
                ..Default::default()
            },
        );
        let db = StateStore::open(&cfg.db_path)?;
        let mut session = build_session("custom", SessionState::Pending, Utc::now());
        session.agent_type = "".to_string();
        session.working_dir = tempdir.path().to_path_buf();
        db.insert_session(&session)?;

        let status = get_status(&db, &cfg, "custom")?;
        assert_eq!(status.harness.primary, HarnessKind::Unknown);
        assert_eq!(status.harness.primary_label, "acme-runner");
        assert_eq!(status.harness.detected_summary(), "acme-runner");

        Ok(())
    }

    #[test]
    fn get_status_surfaces_handoff_lineage() -> Result<()> {
        let tempdir = TestDir::new("manager-status-lineage")?;
        let cfg = build_config(tempdir.path());
        let db = StateStore::open(&cfg.db_path)?;
        let now = Utc::now();

        db.insert_session(&build_session(
            "parent",
            SessionState::Running,
            now - Duration::minutes(2),
        ))?;
        db.insert_session(&build_session(
            "child",
            SessionState::Pending,
            now - Duration::minutes(1),
        ))?;
        db.insert_session(&build_session("sibling", SessionState::Idle, now))?;

        db.send_message(
            "parent",
            "child",
            "{\"task\":\"Review auth flow\",\"context\":\"Delegated from parent\"}",
            "task_handoff",
        )?;
        db.send_message(
            "parent",
            "sibling",
            "{\"task\":\"Check billing\",\"context\":\"Delegated from parent\"}",
            "task_handoff",
        )?;

        let status = get_status(&db, &cfg, "parent")?;
        let rendered = status.to_string();

        assert!(rendered.contains("Children:"));
        assert!(rendered.contains("child"));
        assert!(rendered.contains("sibling"));

        let child_status = get_status(&db, &cfg, "child")?;
        assert_eq!(child_status.parent_session.as_deref(), Some("parent"));

        Ok(())
    }

    #[test]
    fn get_team_status_groups_delegated_children() -> Result<()> {
        let tempdir = TestDir::new("manager-team-status")?;
        let _cfg = build_config(tempdir.path());
        let db = StateStore::open(&tempdir.path().join("state.db"))?;
        let now = Utc::now();

        db.insert_session(&build_session(
            "lead",
            SessionState::Running,
            now - Duration::minutes(3),
        ))?;
        db.insert_session(&build_session(
            "worker-a",
            SessionState::Running,
            now - Duration::minutes(2),
        ))?;
        db.insert_session(&build_session(
            "worker-b",
            SessionState::Pending,
            now - Duration::minutes(1),
        ))?;
        db.insert_session(&build_session("reviewer", SessionState::Completed, now))?;

        db.send_message(
            "lead",
            "worker-a",
            "{\"task\":\"Implement auth\",\"context\":\"Delegated from lead\"}",
            "task_handoff",
        )?;
        db.send_message(
            "lead",
            "worker-b",
            "{\"task\":\"Check billing\",\"context\":\"Delegated from lead\"}",
            "task_handoff",
        )?;
        db.send_message(
            "worker-a",
            "reviewer",
            "{\"task\":\"Review auth\",\"context\":\"Delegated from worker-a\"}",
            "task_handoff",
        )?;

        let team = get_team_status(&db, "lead", 2)?;
        let rendered = team.to_string();

        assert!(rendered.contains("Lead:    lead [running]"));
        assert!(rendered.contains("Running:"));
        assert!(rendered.contains("Pending:"));
        assert!(rendered.contains("Completed:"));
        assert!(rendered.contains("worker-a"));
        assert!(rendered.contains("worker-b"));
        assert!(rendered.contains("reviewer"));

        Ok(())
    }

    #[tokio::test(flavor = "current_thread")]
    async fn assign_session_reuses_idle_delegate_when_available() -> Result<()> {
        let tempdir = TestDir::new("manager-assign-reuse-idle")?;
        let repo_root = tempdir.path().join("repo");
        init_git_repo(&repo_root)?;

        let cfg = build_config(tempdir.path());
        let db = StateStore::open(&cfg.db_path)?;
        let now = Utc::now();

        db.insert_session(&Session {
            id: "lead".to_string(),
            task: "lead task".to_string(),
            project: "workspace".to_string(),
            task_group: "general".to_string(),
            agent_type: "claude".to_string(),
            working_dir: repo_root.clone(),
            state: SessionState::Running,
            pid: Some(42),
            worktree: None,
            created_at: now - Duration::minutes(2),
            updated_at: now - Duration::minutes(2),
            last_heartbeat_at: now - Duration::minutes(2),
            metrics: SessionMetrics::default(),
        })?;
        db.insert_session(&Session {
            id: "idle-worker".to_string(),
            task: "old worker task".to_string(),
            project: "workspace".to_string(),
            task_group: "general".to_string(),
            agent_type: "claude".to_string(),
            working_dir: repo_root.clone(),
            state: SessionState::Idle,
            pid: Some(99),
            worktree: None,
            created_at: now - Duration::minutes(1),
            updated_at: now - Duration::minutes(1),
            last_heartbeat_at: now - Duration::minutes(1),
            metrics: SessionMetrics::default(),
        })?;
        db.send_message(
            "lead",
            "idle-worker",
            "{\"task\":\"old worker task\",\"context\":\"Delegated from lead\"}",
            "task_handoff",
        )?;
        db.mark_messages_read("idle-worker")?;

        let (fake_runner, _) = write_fake_claude(tempdir.path())?;
        let outcome = assign_session_in_dir_with_runner_program(
            &db,
            &cfg,
            "lead",
            "Review billing edge cases",
            "claude",
            true,
            &repo_root,
            &fake_runner,
            None,
            SessionGrouping::default(),
        )
        .await?;

        assert_eq!(outcome.session_id, "idle-worker");
        assert_eq!(outcome.action, AssignmentAction::ReusedIdle);

        let messages = db.list_messages_for_session("idle-worker", 10)?;
        assert!(messages.iter().any(|message| {
            message.msg_type == "task_handoff"
                && message.content.contains("Review billing edge cases")
        }));

        Ok(())
    }

    #[tokio::test(flavor = "current_thread")]
    async fn assign_session_prefers_idle_delegate_with_graph_context_match() -> Result<()> {
        let tempdir = TestDir::new("manager-assign-graph-context-idle")?;
        let repo_root = tempdir.path().join("repo");
        init_git_repo(&repo_root)?;

        let cfg = build_config(tempdir.path());
        let db = StateStore::open(&cfg.db_path)?;
        let now = Utc::now();

        db.insert_session(&Session {
            id: "lead".to_string(),
            task: "lead task".to_string(),
            project: "workspace".to_string(),
            task_group: "general".to_string(),
            agent_type: "claude".to_string(),
            working_dir: repo_root.clone(),
            state: SessionState::Running,
            pid: Some(42),
            worktree: None,
            created_at: now - Duration::minutes(4),
            updated_at: now - Duration::minutes(4),
            last_heartbeat_at: now - Duration::minutes(4),
            metrics: SessionMetrics::default(),
        })?;
        db.insert_session(&Session {
            id: "older-worker".to_string(),
            task: "legacy delegated task".to_string(),
            project: "workspace".to_string(),
            task_group: "general".to_string(),
            agent_type: "claude".to_string(),
            working_dir: repo_root.clone(),
            state: SessionState::Idle,
            pid: Some(100),
            worktree: None,
            created_at: now - Duration::minutes(3),
            updated_at: now - Duration::minutes(3),
            last_heartbeat_at: now - Duration::minutes(3),
            metrics: SessionMetrics::default(),
        })?;
        db.insert_session(&Session {
            id: "auth-worker".to_string(),
            task: "auth delegated task".to_string(),
            project: "workspace".to_string(),
            task_group: "general".to_string(),
            agent_type: "claude".to_string(),
            working_dir: repo_root.clone(),
            state: SessionState::Idle,
            pid: Some(101),
            worktree: None,
            created_at: now - Duration::minutes(2),
            updated_at: now - Duration::minutes(2),
            last_heartbeat_at: now - Duration::minutes(2),
            metrics: SessionMetrics::default(),
        })?;
        db.send_message(
            "lead",
            "older-worker",
            "{\"task\":\"legacy delegated task\",\"context\":\"Delegated from lead\"}",
            "task_handoff",
        )?;
        db.send_message(
            "lead",
            "auth-worker",
            "{\"task\":\"auth delegated task\",\"context\":\"Delegated from lead\"}",
            "task_handoff",
        )?;
        db.mark_messages_read("older-worker")?;
        db.mark_messages_read("auth-worker")?;

        db.upsert_context_entity(
            Some("auth-worker"),
            "file",
            "auth-callback.ts",
            Some("src/auth/callback.ts"),
            "Auth callback recovery edge cases",
            &BTreeMap::new(),
        )?;

        let preview = preview_assignment_for_task(
            &db,
            &cfg,
            "lead",
            "Investigate auth callback recovery",
            "claude",
        )?;
        assert_eq!(preview.action, AssignmentAction::ReusedIdle);
        assert_eq!(preview.session_id.as_deref(), Some("auth-worker"));
        assert_eq!(
            preview.graph_match_terms,
            vec![
                "auth".to_string(),
                "callback".to_string(),
                "recovery".to_string()
            ]
        );

        let (fake_runner, _) = write_fake_claude(tempdir.path())?;
        let outcome = assign_session_in_dir_with_runner_program(
            &db,
            &cfg,
            "lead",
            "Investigate auth callback recovery",
            "claude",
            true,
            &repo_root,
            &fake_runner,
            None,
            SessionGrouping::default(),
        )
        .await?;

        assert_eq!(outcome.action, AssignmentAction::ReusedIdle);
        assert_eq!(outcome.session_id, "auth-worker");

        let auth_messages = db.list_messages_for_session("auth-worker", 10)?;
        assert!(auth_messages.iter().any(|message| {
            message.msg_type == "task_handoff"
                && message
                    .content
                    .contains("Investigate auth callback recovery")
        }));

        Ok(())
    }

    #[tokio::test(flavor = "current_thread")]
    async fn assign_session_spawns_instead_of_reusing_backed_up_idle_delegate() -> Result<()> {
        let tempdir = TestDir::new("manager-assign-spawn-backed-up-idle")?;
        let repo_root = tempdir.path().join("repo");
        init_git_repo(&repo_root)?;

        let cfg = build_config(tempdir.path());
        let db = StateStore::open(&cfg.db_path)?;
        let now = Utc::now();

        db.insert_session(&Session {
            id: "lead".to_string(),
            task: "lead task".to_string(),
            project: "workspace".to_string(),
            task_group: "general".to_string(),
            agent_type: "claude".to_string(),
            working_dir: repo_root.clone(),
            state: SessionState::Running,
            pid: Some(42),
            worktree: None,
            created_at: now - Duration::minutes(3),
            updated_at: now - Duration::minutes(3),
            last_heartbeat_at: now - Duration::minutes(3),
            metrics: SessionMetrics::default(),
        })?;
        db.insert_session(&Session {
            id: "idle-worker".to_string(),
            task: "old worker task".to_string(),
            project: "workspace".to_string(),
            task_group: "general".to_string(),
            agent_type: "claude".to_string(),
            working_dir: repo_root.clone(),
            state: SessionState::Idle,
            pid: Some(99),
            worktree: None,
            created_at: now - Duration::minutes(2),
            updated_at: now - Duration::minutes(2),
            last_heartbeat_at: now - Duration::minutes(2),
            metrics: SessionMetrics::default(),
        })?;
        db.send_message(
            "lead",
            "idle-worker",
            "{\"task\":\"old worker task\",\"context\":\"Delegated from lead\"}",
            "task_handoff",
        )?;

        let (fake_runner, _) = write_fake_claude(tempdir.path())?;
        let outcome = assign_session_in_dir_with_runner_program(
            &db,
            &cfg,
            "lead",
            "Fresh delegated task",
            "claude",
            true,
            &repo_root,
            &fake_runner,
            None,
            SessionGrouping::default(),
        )
        .await?;

        assert_eq!(outcome.action, AssignmentAction::Spawned);
        assert_ne!(outcome.session_id, "idle-worker");

        let idle_messages = db.list_messages_for_session("idle-worker", 10)?;
        let fresh_assignments = idle_messages
            .iter()
            .filter(|message| {
                message.msg_type == "task_handoff"
                    && message.content.contains("Fresh delegated task")
            })
            .count();
        assert_eq!(fresh_assignments, 0);

        let spawned_messages = db.list_messages_for_session(&outcome.session_id, 10)?;
        assert!(spawned_messages.iter().any(|message| {
            message.msg_type == "task_handoff" && message.content.contains("Fresh delegated task")
        }));

        Ok(())
    }

    #[tokio::test(flavor = "current_thread")]
    async fn assign_session_reuses_idle_delegate_when_only_non_handoff_messages_are_unread(
    ) -> Result<()> {
        let tempdir = TestDir::new("manager-assign-reuse-idle-info-inbox")?;
        let repo_root = tempdir.path().join("repo");
        init_git_repo(&repo_root)?;

        let cfg = build_config(tempdir.path());
        let db = StateStore::open(&cfg.db_path)?;
        let now = Utc::now();

        db.insert_session(&Session {
            id: "lead".to_string(),
            task: "lead task".to_string(),
            project: "workspace".to_string(),
            task_group: "general".to_string(),
            agent_type: "claude".to_string(),
            working_dir: repo_root.clone(),
            state: SessionState::Running,
            pid: Some(42),
            worktree: None,
            created_at: now - Duration::minutes(3),
            updated_at: now - Duration::minutes(3),
            last_heartbeat_at: now - Duration::minutes(3),
            metrics: SessionMetrics::default(),
        })?;
        db.insert_session(&Session {
            id: "idle-worker".to_string(),
            task: "old worker task".to_string(),
            project: "workspace".to_string(),
            task_group: "general".to_string(),
            agent_type: "claude".to_string(),
            working_dir: repo_root.clone(),
            state: SessionState::Idle,
            pid: Some(99),
            worktree: None,
            created_at: now - Duration::minutes(2),
            updated_at: now - Duration::minutes(2),
            last_heartbeat_at: now - Duration::minutes(2),
            metrics: SessionMetrics::default(),
        })?;
        db.send_message(
            "lead",
            "idle-worker",
            "{\"task\":\"old worker task\",\"context\":\"Delegated from lead\"}",
            "task_handoff",
        )?;
        db.mark_messages_read("idle-worker")?;
        db.send_message("lead", "idle-worker", "FYI status update", "info")?;

        let (fake_runner, _) = write_fake_claude(tempdir.path())?;
        let outcome = assign_session_in_dir_with_runner_program(
            &db,
            &cfg,
            "lead",
            "Fresh delegated task",
            "claude",
            true,
            &repo_root,
            &fake_runner,
            None,
            SessionGrouping::default(),
        )
        .await?;

        assert_eq!(outcome.action, AssignmentAction::ReusedIdle);
        assert_eq!(outcome.session_id, "idle-worker");

        let idle_messages = db.list_messages_for_session("idle-worker", 10)?;
        assert!(idle_messages.iter().any(|message| {
            message.msg_type == "task_handoff" && message.content.contains("Fresh delegated task")
        }));

        Ok(())
    }

    #[tokio::test(flavor = "current_thread")]
    async fn assign_session_spawns_when_team_has_capacity() -> Result<()> {
        let tempdir = TestDir::new("manager-assign-spawn")?;
        let repo_root = tempdir.path().join("repo");
        init_git_repo(&repo_root)?;

        let cfg = build_config(tempdir.path());
        let db = StateStore::open(&cfg.db_path)?;
        let now = Utc::now();

        db.insert_session(&Session {
            id: "lead".to_string(),
            task: "lead task".to_string(),
            project: "workspace".to_string(),
            task_group: "general".to_string(),
            agent_type: "claude".to_string(),
            working_dir: repo_root.clone(),
            state: SessionState::Running,
            pid: Some(42),
            worktree: None,
            created_at: now - Duration::minutes(3),
            updated_at: now - Duration::minutes(3),
            last_heartbeat_at: now - Duration::minutes(3),
            metrics: SessionMetrics::default(),
        })?;
        db.insert_session(&Session {
            id: "busy-worker".to_string(),
            task: "existing work".to_string(),
            project: "workspace".to_string(),
            task_group: "general".to_string(),
            agent_type: "claude".to_string(),
            working_dir: repo_root.clone(),
            state: SessionState::Running,
            pid: Some(55),
            worktree: None,
            created_at: now - Duration::minutes(2),
            updated_at: now - Duration::minutes(2),
            last_heartbeat_at: now - Duration::minutes(2),
            metrics: SessionMetrics::default(),
        })?;
        db.send_message(
            "lead",
            "busy-worker",
            "{\"task\":\"existing work\",\"context\":\"Delegated from lead\"}",
            "task_handoff",
        )?;

        let (fake_runner, _) = write_fake_claude(tempdir.path())?;
        let outcome = assign_session_in_dir_with_runner_program(
            &db,
            &cfg,
            "lead",
            "New delegated task",
            "claude",
            true,
            &repo_root,
            &fake_runner,
            None,
            SessionGrouping::default(),
        )
        .await?;

        assert_eq!(outcome.action, AssignmentAction::Spawned);
        assert_ne!(outcome.session_id, "busy-worker");

        let spawned = db
            .get_session(&outcome.session_id)?
            .context("spawned delegated session missing")?;
        assert_eq!(spawned.state, SessionState::Pending);

        let messages = db.list_messages_for_session(&outcome.session_id, 10)?;
        assert!(messages.iter().any(|message| {
            message.msg_type == "task_handoff" && message.content.contains("New delegated task")
        }));

        Ok(())
    }

    #[tokio::test(flavor = "current_thread")]
    async fn assign_session_inherits_lead_grouping_for_spawned_delegate() -> Result<()> {
        let tempdir = TestDir::new("manager-assign-grouping-inheritance")?;
        let repo_root = tempdir.path().join("repo");
        init_git_repo(&repo_root)?;

        let cfg = build_config(tempdir.path());
        let db = StateStore::open(&cfg.db_path)?;
        let now = Utc::now();

        db.insert_session(&Session {
            id: "lead".to_string(),
            task: "lead task".to_string(),
            project: "ecc-platform".to_string(),
            task_group: "checkout recovery".to_string(),
            agent_type: "claude".to_string(),
            working_dir: repo_root.clone(),
            state: SessionState::Running,
            pid: Some(42),
            worktree: None,
            created_at: now - Duration::minutes(3),
            updated_at: now - Duration::minutes(3),
            last_heartbeat_at: now - Duration::minutes(3),
            metrics: SessionMetrics::default(),
        })?;

        let (fake_runner, _) = write_fake_claude(tempdir.path())?;
        let outcome = assign_session_in_dir_with_runner_program(
            &db,
            &cfg,
            "lead",
            "investigate webhook retry edge cases",
            "claude",
            true,
            &repo_root,
            &fake_runner,
            None,
            SessionGrouping::default(),
        )
        .await?;

        assert_eq!(outcome.action, AssignmentAction::Spawned);

        let spawned = db
            .get_session(&outcome.session_id)?
            .context("spawned delegated session missing")?;
        assert_eq!(spawned.project, "ecc-platform");
        assert_eq!(spawned.task_group, "checkout recovery");

        Ok(())
    }

    #[tokio::test(flavor = "current_thread")]
    async fn assign_session_defers_when_team_is_saturated() -> Result<()> {
        let tempdir = TestDir::new("manager-assign-defer-saturated")?;
        let repo_root = tempdir.path().join("repo");
        init_git_repo(&repo_root)?;

        let mut cfg = build_config(tempdir.path());
        cfg.max_parallel_sessions = 1;
        let db = StateStore::open(&cfg.db_path)?;
        let now = Utc::now();

        db.insert_session(&Session {
            id: "lead".to_string(),
            task: "lead task".to_string(),
            project: "workspace".to_string(),
            task_group: "general".to_string(),
            agent_type: "claude".to_string(),
            working_dir: repo_root.clone(),
            state: SessionState::Running,
            pid: Some(42),
            worktree: None,
            created_at: now - Duration::minutes(3),
            updated_at: now - Duration::minutes(3),
            last_heartbeat_at: now - Duration::minutes(3),
            metrics: SessionMetrics::default(),
        })?;
        db.insert_session(&Session {
            id: "busy-worker".to_string(),
            task: "existing work".to_string(),
            project: "workspace".to_string(),
            task_group: "general".to_string(),
            agent_type: "claude".to_string(),
            working_dir: repo_root.clone(),
            state: SessionState::Running,
            pid: Some(55),
            worktree: None,
            created_at: now - Duration::minutes(2),
            updated_at: now - Duration::minutes(2),
            last_heartbeat_at: now - Duration::minutes(2),
            metrics: SessionMetrics::default(),
        })?;
        db.send_message(
            "lead",
            "busy-worker",
            "{\"task\":\"existing work\",\"context\":\"Delegated from lead\"}",
            "task_handoff",
        )?;

        let (fake_runner, _) = write_fake_claude(tempdir.path())?;
        let outcome = assign_session_in_dir_with_runner_program(
            &db,
            &cfg,
            "lead",
            "New delegated task",
            "claude",
            true,
            &repo_root,
            &fake_runner,
            None,
            SessionGrouping::default(),
        )
        .await?;

        assert_eq!(outcome.action, AssignmentAction::DeferredSaturated);
        assert_eq!(outcome.session_id, "lead");

        let busy_messages = db.list_messages_for_session("busy-worker", 10)?;
        assert!(!busy_messages.iter().any(|message| {
            message.msg_type == "task_handoff" && message.content.contains("New delegated task")
        }));

        Ok(())
    }

    #[tokio::test(flavor = "current_thread")]
    async fn drain_inbox_routes_unread_task_handoffs_and_marks_them_read() -> Result<()> {
        let tempdir = TestDir::new("manager-drain-inbox")?;
        let repo_root = tempdir.path().join("repo");
        init_git_repo(&repo_root)?;

        let cfg = build_config(tempdir.path());
        let db = StateStore::open(&cfg.db_path)?;
        let now = Utc::now();

        db.insert_session(&Session {
            id: "lead".to_string(),
            task: "lead task".to_string(),
            project: "workspace".to_string(),
            task_group: "general".to_string(),
            agent_type: "claude".to_string(),
            working_dir: repo_root.clone(),
            state: SessionState::Running,
            pid: Some(42),
            worktree: None,
            created_at: now - Duration::minutes(3),
            updated_at: now - Duration::minutes(3),
            last_heartbeat_at: now - Duration::minutes(3),
            metrics: SessionMetrics::default(),
        })?;

        db.send_message(
            "planner",
            "lead",
            "{\"task\":\"Review auth changes\",\"context\":\"Inbound request\"}",
            "task_handoff",
        )?;

        let outcomes = drain_inbox(&db, &cfg, "lead", "claude", true, 5).await?;
        assert_eq!(outcomes.len(), 1);
        assert_eq!(outcomes[0].task, "Review auth changes");
        assert_eq!(outcomes[0].action, AssignmentAction::Spawned);

        let unread = db.unread_message_counts()?;
        assert_eq!(unread.get("lead"), None);

        let messages = db.list_messages_for_session(&outcomes[0].session_id, 10)?;
        assert!(messages.iter().any(|message| {
            message.msg_type == "task_handoff" && message.content.contains("Review auth changes")
        }));

        Ok(())
    }

    #[tokio::test(flavor = "current_thread")]
    async fn drain_inbox_leaves_saturated_handoffs_unread() -> Result<()> {
        let tempdir = TestDir::new("manager-drain-inbox-defer")?;
        let repo_root = tempdir.path().join("repo");
        init_git_repo(&repo_root)?;

        let mut cfg = build_config(tempdir.path());
        cfg.max_parallel_sessions = 1;
        let db = StateStore::open(&cfg.db_path)?;
        let now = Utc::now();

        db.insert_session(&Session {
            id: "lead".to_string(),
            task: "lead task".to_string(),
            project: "workspace".to_string(),
            task_group: "general".to_string(),
            agent_type: "claude".to_string(),
            working_dir: repo_root.clone(),
            state: SessionState::Running,
            pid: Some(42),
            worktree: None,
            created_at: now - Duration::minutes(3),
            updated_at: now - Duration::minutes(3),
            last_heartbeat_at: now - Duration::minutes(3),
            metrics: SessionMetrics::default(),
        })?;
        db.insert_session(&Session {
            id: "busy-worker".to_string(),
            task: "existing work".to_string(),
            project: "workspace".to_string(),
            task_group: "general".to_string(),
            agent_type: "claude".to_string(),
            working_dir: repo_root.clone(),
            state: SessionState::Running,
            pid: Some(55),
            worktree: None,
            created_at: now - Duration::minutes(2),
            updated_at: now - Duration::minutes(2),
            last_heartbeat_at: now - Duration::minutes(2),
            metrics: SessionMetrics::default(),
        })?;
        db.send_message(
            "lead",
            "busy-worker",
            "{\"task\":\"existing work\",\"context\":\"Delegated from lead\"}",
            "task_handoff",
        )?;
        db.send_message(
            "planner",
            "lead",
            "{\"task\":\"Review auth changes\",\"context\":\"Inbound request\"}",
            "task_handoff",
        )?;

        let outcomes = drain_inbox(&db, &cfg, "lead", "claude", true, 5).await?;
        assert_eq!(outcomes.len(), 1);
        assert_eq!(outcomes[0].task, "Review auth changes");
        assert_eq!(outcomes[0].action, AssignmentAction::DeferredSaturated);
        assert_eq!(outcomes[0].session_id, "lead");

        let unread = db.unread_message_counts()?;
        assert_eq!(unread.get("lead"), Some(&1));
        assert_eq!(unread.get("busy-worker"), Some(&1));

        let messages = db.list_messages_for_session("busy-worker", 10)?;
        assert!(!messages.iter().any(|message| {
            message.msg_type == "task_handoff" && message.content.contains("Review auth changes")
        }));

        Ok(())
    }

    #[tokio::test(flavor = "current_thread")]
    async fn drain_inbox_routes_high_priority_handoff_first() -> Result<()> {
        let tempdir = TestDir::new("manager-drain-inbox-priority")?;
        let repo_root = tempdir.path().join("repo");
        init_git_repo(&repo_root)?;

        let cfg = build_config(tempdir.path());
        let db = StateStore::open(&cfg.db_path)?;
        let now = Utc::now();

        db.insert_session(&Session {
            id: "lead".to_string(),
            task: "lead task".to_string(),
            project: "workspace".to_string(),
            task_group: "general".to_string(),
            agent_type: "claude".to_string(),
            working_dir: repo_root.clone(),
            state: SessionState::Running,
            pid: Some(42),
            worktree: None,
            created_at: now - Duration::minutes(3),
            updated_at: now - Duration::minutes(3),
            last_heartbeat_at: now - Duration::minutes(3),
            metrics: SessionMetrics::default(),
        })?;

        db.send_message(
            "planner",
            "lead",
            "{\"task\":\"Document cleanup\",\"context\":\"Inbound request\",\"priority\":\"low\"}",
            "task_handoff",
        )?;
        db.send_message(
            "planner",
            "lead",
            "{\"task\":\"Critical auth outage\",\"context\":\"Inbound request\",\"priority\":\"critical\"}",
            "task_handoff",
        )?;

        let outcomes = drain_inbox(&db, &cfg, "lead", "claude", true, 1).await?;
        assert_eq!(outcomes.len(), 1);
        assert_eq!(outcomes[0].task, "Critical auth outage");
        assert_eq!(outcomes[0].action, AssignmentAction::Spawned);

        let unread = db.unread_task_handoffs_for_session("lead", 10)?;
        assert_eq!(unread.len(), 1);
        assert!(unread[0].content.contains("Document cleanup"));

        let messages = db.list_messages_for_session(&outcomes[0].session_id, 10)?;
        assert!(messages.iter().any(|message| {
            message.msg_type == "task_handoff" && message.content.contains("Critical auth outage")
        }));

        Ok(())
    }

    #[tokio::test(flavor = "current_thread")]
    async fn auto_dispatch_backlog_routes_multiple_lead_inboxes() -> Result<()> {
        let tempdir = TestDir::new("manager-auto-dispatch")?;
        let repo_root = tempdir.path().join("repo");
        init_git_repo(&repo_root)?;

        let mut cfg = build_config(tempdir.path());
        cfg.auto_dispatch_limit_per_session = 5;
        let db = StateStore::open(&cfg.db_path)?;
        let now = Utc::now();

        for lead_id in ["lead-a", "lead-b"] {
            db.insert_session(&Session {
                id: lead_id.to_string(),
                task: format!("{lead_id} task"),
                project: "workspace".to_string(),
                task_group: "general".to_string(),
                agent_type: "claude".to_string(),
                working_dir: repo_root.clone(),
                state: SessionState::Running,
                pid: Some(42),
                worktree: None,
                created_at: now - Duration::minutes(3),
                updated_at: now - Duration::minutes(3),
                last_heartbeat_at: now - Duration::minutes(3),
                metrics: SessionMetrics::default(),
            })?;
        }

        db.send_message(
            "planner",
            "lead-a",
            "{\"task\":\"Review auth\",\"context\":\"Inbound\"}",
            "task_handoff",
        )?;
        db.send_message(
            "planner",
            "lead-b",
            "{\"task\":\"Review billing\",\"context\":\"Inbound\"}",
            "task_handoff",
        )?;

        let outcomes = auto_dispatch_backlog(&db, &cfg, "claude", true, 10).await?;
        assert_eq!(outcomes.len(), 2);
        assert!(outcomes.iter().any(|outcome| {
            outcome.lead_session_id == "lead-a"
                && outcome.unread_count == 1
                && outcome.routed.len() == 1
        }));
        assert!(outcomes.iter().any(|outcome| {
            outcome.lead_session_id == "lead-b"
                && outcome.unread_count == 1
                && outcome.routed.len() == 1
        }));

        let unread = db.unread_task_handoff_targets(10)?;
        assert!(!unread.iter().any(|(session_id, _)| session_id == "lead-a"));
        assert!(!unread.iter().any(|(session_id, _)| session_id == "lead-b"));

        Ok(())
    }

    #[tokio::test(flavor = "current_thread")]
    async fn coordinate_backlog_reports_remaining_backlog_after_limited_pass() -> Result<()> {
        let tempdir = TestDir::new("manager-coordinate-backlog")?;
        let repo_root = tempdir.path().join("repo");
        init_git_repo(&repo_root)?;

        let mut cfg = build_config(tempdir.path());
        cfg.auto_dispatch_limit_per_session = 5;
        let db = StateStore::open(&cfg.db_path)?;
        let now = Utc::now();

        for lead_id in ["lead-a", "lead-b"] {
            db.insert_session(&Session {
                id: lead_id.to_string(),
                task: format!("{lead_id} task"),
                project: "workspace".to_string(),
                task_group: "general".to_string(),
                agent_type: "claude".to_string(),
                working_dir: repo_root.clone(),
                state: SessionState::Running,
                pid: Some(42),
                worktree: None,
                created_at: now - Duration::minutes(3),
                updated_at: now - Duration::minutes(3),
                last_heartbeat_at: now - Duration::minutes(3),
                metrics: SessionMetrics::default(),
            })?;
        }

        db.send_message(
            "planner",
            "lead-a",
            "{\"task\":\"Review auth\",\"context\":\"Inbound\"}",
            "task_handoff",
        )?;
        db.send_message(
            "planner",
            "lead-b",
            "{\"task\":\"Review billing\",\"context\":\"Inbound\"}",
            "task_handoff",
        )?;

        let outcome = coordinate_backlog(&db, &cfg, "claude", true, 1).await?;

        assert_eq!(outcome.dispatched.len(), 1);
        assert_eq!(outcome.rebalanced.len(), 0);
        assert_eq!(outcome.remaining_backlog_sessions, 2);
        assert_eq!(outcome.remaining_backlog_messages, 2);
        assert_eq!(outcome.remaining_absorbable_sessions, 2);
        assert_eq!(outcome.remaining_saturated_sessions, 0);

        Ok(())
    }

    #[tokio::test(flavor = "current_thread")]
    async fn coordinate_backlog_classifies_remaining_saturated_pressure() -> Result<()> {
        let tempdir = TestDir::new("manager-coordinate-saturated")?;
        let repo_root = tempdir.path().join("repo");
        init_git_repo(&repo_root)?;

        let mut cfg = build_config(tempdir.path());
        cfg.max_parallel_sessions = 1;
        cfg.auto_dispatch_limit_per_session = 1;
        let db = StateStore::open(&cfg.db_path)?;
        let now = Utc::now();

        db.insert_session(&Session {
            id: "lead".to_string(),
            task: "worker task".to_string(),
            project: "workspace".to_string(),
            task_group: "general".to_string(),
            agent_type: "claude".to_string(),
            working_dir: repo_root.clone(),
            state: SessionState::Running,
            pid: Some(42),
            worktree: None,
            created_at: now - Duration::minutes(3),
            updated_at: now - Duration::minutes(3),
            last_heartbeat_at: now - Duration::minutes(3),
            metrics: SessionMetrics::default(),
        })?;

        db.insert_session(&Session {
            id: "delegate".to_string(),
            task: "delegate task".to_string(),
            project: "workspace".to_string(),
            task_group: "general".to_string(),
            agent_type: "claude".to_string(),
            working_dir: repo_root.clone(),
            state: SessionState::Running,
            pid: Some(43),
            worktree: None,
            created_at: now - Duration::minutes(2),
            updated_at: now - Duration::minutes(2),
            last_heartbeat_at: now - Duration::minutes(2),
            metrics: SessionMetrics::default(),
        })?;

        db.send_message(
            "lead",
            "delegate",
            "{\"task\":\"seed delegate\",\"context\":\"Delegated from worker\"}",
            "task_handoff",
        )?;
        let _ = db.mark_messages_read("delegate")?;

        db.send_message(
            "planner",
            "lead",
            "{\"task\":\"task-a\",\"context\":\"Inbound\"}",
            "task_handoff",
        )?;
        db.send_message(
            "planner",
            "lead",
            "{\"task\":\"task-b\",\"context\":\"Inbound\"}",
            "task_handoff",
        )?;

        let outcome = coordinate_backlog(&db, &cfg, "claude", true, 10).await?;

        assert_eq!(outcome.remaining_backlog_sessions, 2);
        assert_eq!(outcome.remaining_backlog_messages, 2);
        assert_eq!(outcome.remaining_absorbable_sessions, 1);
        assert_eq!(outcome.remaining_saturated_sessions, 1);

        Ok(())
    }

    #[tokio::test(flavor = "current_thread")]
    async fn rebalance_team_backlog_moves_work_off_backed_up_delegate() -> Result<()> {
        let tempdir = TestDir::new("manager-rebalance-team")?;
        let repo_root = tempdir.path().join("repo");
        init_git_repo(&repo_root)?;

        let mut cfg = build_config(tempdir.path());
        cfg.max_parallel_sessions = 2;
        let db = StateStore::open(&cfg.db_path)?;
        let now = Utc::now();

        db.insert_session(&Session {
            id: "lead".to_string(),
            task: "lead task".to_string(),
            project: "workspace".to_string(),
            task_group: "general".to_string(),
            agent_type: "claude".to_string(),
            working_dir: repo_root.clone(),
            state: SessionState::Running,
            pid: Some(42),
            worktree: None,
            created_at: now - Duration::minutes(4),
            updated_at: now - Duration::minutes(4),
            last_heartbeat_at: now - Duration::minutes(4),
            metrics: SessionMetrics::default(),
        })?;
        db.insert_session(&Session {
            id: "worker-a".to_string(),
            task: "auth lane".to_string(),
            project: "workspace".to_string(),
            task_group: "general".to_string(),
            agent_type: "claude".to_string(),
            working_dir: repo_root.clone(),
            state: SessionState::Idle,
            pid: None,
            worktree: None,
            created_at: now - Duration::minutes(3),
            updated_at: now - Duration::minutes(3),
            last_heartbeat_at: now - Duration::minutes(3),
            metrics: SessionMetrics::default(),
        })?;
        db.insert_session(&Session {
            id: "worker-b".to_string(),
            task: "billing lane".to_string(),
            project: "workspace".to_string(),
            task_group: "general".to_string(),
            agent_type: "claude".to_string(),
            working_dir: repo_root.clone(),
            state: SessionState::Idle,
            pid: None,
            worktree: None,
            created_at: now - Duration::minutes(2),
            updated_at: now - Duration::minutes(2),
            last_heartbeat_at: now - Duration::minutes(2),
            metrics: SessionMetrics::default(),
        })?;

        db.send_message(
            "lead",
            "worker-a",
            "{\"task\":\"Review auth flow\",\"context\":\"Delegated from lead\"}",
            "task_handoff",
        )?;
        db.send_message(
            "lead",
            "worker-a",
            "{\"task\":\"Check billing integration\",\"context\":\"Delegated from lead\"}",
            "task_handoff",
        )?;
        db.send_message(
            "lead",
            "worker-b",
            "{\"task\":\"Existing clear lane\",\"context\":\"Delegated from lead\"}",
            "task_handoff",
        )?;
        let _ = db.mark_messages_read("worker-b")?;

        let outcomes = rebalance_team_backlog(&db, &cfg, "lead", "claude", true, 5).await?;
        assert_eq!(outcomes.len(), 1);
        assert_eq!(outcomes[0].from_session_id, "worker-a");
        assert_eq!(outcomes[0].session_id, "worker-b");
        assert_eq!(outcomes[0].action, AssignmentAction::ReusedIdle);

        let unread = db.unread_message_counts()?;
        assert_eq!(unread.get("worker-a"), Some(&1));
        assert_eq!(unread.get("worker-b"), Some(&1));

        let worker_b_messages = db.list_messages_for_session("worker-b", 10)?;
        assert!(worker_b_messages.iter().any(|message| {
            message.msg_type == "task_handoff" && message.content.contains("Review auth flow")
        }));

        Ok(())
    }

    #[test]
    fn team_status_reports_handoff_backlog_not_generic_inbox_noise() -> Result<()> {
        let tempdir = TestDir::new("manager-team-status-backlog")?;
        let repo_root = tempdir.path().join("repo");
        init_git_repo(&repo_root)?;

        let cfg = build_config(tempdir.path());
        let db = StateStore::open(&cfg.db_path)?;
        let now = Utc::now();

        db.insert_session(&Session {
            id: "lead".to_string(),
            task: "lead task".to_string(),
            project: "workspace".to_string(),
            task_group: "general".to_string(),
            agent_type: "claude".to_string(),
            working_dir: repo_root.clone(),
            state: SessionState::Running,
            pid: Some(42),
            worktree: None,
            created_at: now - Duration::minutes(4),
            updated_at: now - Duration::minutes(4),
            last_heartbeat_at: now - Duration::minutes(4),
            metrics: SessionMetrics::default(),
        })?;
        db.insert_session(&Session {
            id: "worker".to_string(),
            task: "delegate task".to_string(),
            project: "workspace".to_string(),
            task_group: "general".to_string(),
            agent_type: "claude".to_string(),
            working_dir: repo_root,
            state: SessionState::Idle,
            pid: None,
            worktree: None,
            created_at: now - Duration::minutes(3),
            updated_at: now - Duration::minutes(3),
            last_heartbeat_at: now - Duration::minutes(3),
            metrics: SessionMetrics::default(),
        })?;

        db.send_message("lead", "worker", "FYI status update", "info")?;
        db.send_message(
            "lead",
            "worker",
            "{\"task\":\"Delegated work\",\"context\":\"Delegated from lead\"}",
            "task_handoff",
        )?;
        let _ = db.mark_messages_read("worker")?;
        db.send_message("lead", "worker", "FYI reminder", "info")?;

        let status = get_team_status(&db, "lead", 3)?;
        let rendered = format!("{status}");

        assert!(rendered.contains("Backlog: 0"));
        assert!(rendered.contains("| backlog 0 handoff(s) |"));
        assert!(!rendered.contains("Inbox:"));

        Ok(())
    }

    #[test]
    fn coordination_status_display_surfaces_mode_and_activity() {
        let status = CoordinationStatus {
            backlog_leads: 2,
            backlog_messages: 5,
            absorbable_sessions: 1,
            saturated_sessions: 1,
            mode: CoordinationMode::RebalanceFirstChronicSaturation,
            health: CoordinationHealth::Saturated,
            operator_escalation_required: false,
            auto_dispatch_enabled: true,
            auto_dispatch_limit_per_session: 4,
            daemon_activity: build_daemon_activity(),
        };

        let rendered = status.to_string();
        assert!(rendered.contains(
            "Global handoff backlog: 2 lead(s) / 5 handoff(s) [1 absorbable, 1 saturated]"
        ));
        assert!(rendered.contains("Auto-dispatch: on @ 4/lead"));
        assert!(rendered.contains("Coordination mode: rebalance-first (chronic saturation)"));
        assert!(rendered.contains("Chronic saturation streak: 2 cycle(s)"));
        assert!(rendered.contains("Last daemon dispatch: 3 routed / 1 deferred across 2 lead(s)"));
        assert!(rendered.contains("Last daemon recovery dispatch: 2 handoff(s) across 1 lead(s)"));
        assert!(rendered.contains("Last daemon rebalance: 0 handoff(s) across 1 lead(s)"));
        assert!(rendered.contains(
            "Last daemon auto-merge: 1 merged / 1 active / 0 conflicted / 0 dirty / 0 failed"
        ));
        assert!(rendered.contains("Last daemon auto-prune: 2 pruned / 1 active"));
    }

    #[test]
    fn coordination_status_summarizes_real_handoff_backlog() -> Result<()> {
        let tempdir = TestDir::new("manager-coordination-status")?;
        let repo_root = tempdir.path().join("repo");
        init_git_repo(&repo_root)?;

        let cfg = Config {
            max_parallel_sessions: 1,
            ..build_config(tempdir.path())
        };
        let db = StateStore::open(&cfg.db_path)?;
        let now = Utc::now();

        db.insert_session(&build_session("source", SessionState::Running, now))?;
        db.insert_session(&build_session("lead-a", SessionState::Running, now))?;
        db.insert_session(&build_session("lead-b", SessionState::Running, now))?;
        db.insert_session(&build_session(
            "delegate-b",
            SessionState::Idle,
            now - Duration::seconds(1),
        ))?;

        db.send_message(
            "source",
            "lead-a",
            "{\"task\":\"clear docs\",\"context\":\"incoming\"}",
            "task_handoff",
        )?;
        db.send_message(
            "source",
            "lead-b",
            "{\"task\":\"review queue\",\"context\":\"incoming\"}",
            "task_handoff",
        )?;
        db.send_message(
            "lead-b",
            "delegate-b",
            "{\"task\":\"delegate queue\",\"context\":\"routed\"}",
            "task_handoff",
        )?;

        db.record_daemon_dispatch_pass(1, 1, 2)?;

        let status = get_coordination_status(&db, &cfg)?;
        assert_eq!(status.backlog_leads, 3);
        assert_eq!(status.backlog_messages, 3);
        assert_eq!(status.absorbable_sessions, 2);
        assert_eq!(status.saturated_sessions, 1);
        assert_eq!(
            status.mode,
            CoordinationMode::RebalanceFirstChronicSaturation
        );
        assert_eq!(status.health, CoordinationHealth::Saturated);
        assert!(!status.operator_escalation_required);
        assert_eq!(status.daemon_activity.last_dispatch_routed, 1);
        assert_eq!(status.daemon_activity.last_dispatch_deferred, 1);

        Ok(())
    }

    #[test]
    fn enforce_conflict_resolution_pauses_later_session_and_notifies_lead() -> Result<()> {
        let tempdir = TestDir::new("manager-conflict-escalate")?;
        let cfg = build_config(tempdir.path());
        let db = StateStore::open(&cfg.db_path)?;
        let now = Utc::now();

        db.insert_session(&build_session("lead", SessionState::Running, now))?;
        db.insert_session(&build_session(
            "session-a",
            SessionState::Running,
            now - Duration::minutes(2),
        ))?;
        db.insert_session(&build_session(
            "session-b",
            SessionState::Running,
            now - Duration::minutes(1),
        ))?;

        crate::comms::send(
            &db,
            "lead",
            "session-b",
            &crate::comms::MessageType::TaskHandoff {
                task: "Review src/lib.rs".to_string(),
                context: "Lead delegated follow-up".to_string(),
                priority: crate::comms::TaskPriority::Normal,
            },
        )?;

        let metrics_dir = tempdir.path().join("metrics");
        std::fs::create_dir_all(&metrics_dir)?;
        let metrics_path = metrics_dir.join("tool-usage.jsonl");
        std::fs::write(
            &metrics_path,
            concat!(
                "{\"id\":\"evt-1\",\"session_id\":\"session-a\",\"tool_name\":\"Edit\",\"input_summary\":\"Edit src/lib.rs\",\"output_summary\":\"updated logic\",\"file_events\":[{\"path\":\"src/lib.rs\",\"action\":\"modify\"}],\"timestamp\":\"2026-04-09T00:02:00Z\"}\n",
                "{\"id\":\"evt-2\",\"session_id\":\"session-b\",\"tool_name\":\"Write\",\"input_summary\":\"Write src/lib.rs\",\"output_summary\":\"newer change\",\"file_events\":[{\"path\":\"src/lib.rs\",\"action\":\"modify\"}],\"timestamp\":\"2026-04-09T00:03:00Z\"}\n"
            ),
        )?;
        db.sync_tool_activity_metrics(&metrics_path)?;

        let outcome = enforce_conflict_resolution(&db, &cfg)?;
        assert_eq!(outcome.created_incidents, 1);
        assert_eq!(outcome.resolved_incidents, 0);
        assert_eq!(outcome.paused_sessions, vec!["session-b".to_string()]);

        let session_a = db
            .get_session("session-a")?
            .expect("session-a should still exist");
        let session_b = db
            .get_session("session-b")?
            .expect("session-b should still exist");
        assert_eq!(session_a.state, SessionState::Running);
        assert_eq!(session_b.state, SessionState::Stopped);

        assert!(db.has_open_conflict_incident("src/lib.rs::session-a::session-b")?);

        let decisions = db.list_decisions_for_session("session-b", 10)?;
        assert!(decisions
            .iter()
            .any(|entry| entry.decision == "Pause work due to conflict on src/lib.rs"));

        let approval_counts = db.unread_approval_counts()?;
        assert_eq!(approval_counts.get("session-b"), Some(&1usize));
        assert_eq!(approval_counts.get("lead"), Some(&1usize));

        let unread_queue = db.unread_approval_queue(10)?;
        assert!(unread_queue.iter().any(|msg| {
            msg.to_session == "session-b"
                && msg.msg_type == "conflict"
                && msg.content.contains("src/lib.rs")
        }));
        assert!(unread_queue.iter().any(|msg| {
            msg.to_session == "lead"
                && msg.msg_type == "conflict"
                && msg.content.contains("delegate session-b paused")
        }));

        let second_pass = enforce_conflict_resolution(&db, &cfg)?;
        assert_eq!(second_pass.created_incidents, 0);
        assert_eq!(second_pass.paused_sessions, Vec::<String>::new());
        assert_eq!(
            db.list_open_conflict_incidents_for_session("session-b", 10)?
                .len(),
            1
        );

        Ok(())
    }

    #[test]
    fn enforce_conflict_resolution_supports_last_write_wins() -> Result<()> {
        let tempdir = TestDir::new("manager-conflict-last-write-wins")?;
        let mut cfg = build_config(tempdir.path());
        cfg.conflict_resolution.strategy = crate::config::ConflictResolutionStrategy::LastWriteWins;
        cfg.conflict_resolution.notify_lead = false;
        let db = StateStore::open(&cfg.db_path)?;
        let now = Utc::now();

        db.insert_session(&build_session(
            "session-a",
            SessionState::Running,
            now - Duration::minutes(2),
        ))?;
        db.insert_session(&build_session(
            "session-b",
            SessionState::Running,
            now - Duration::minutes(1),
        ))?;

        let metrics_dir = tempdir.path().join("metrics");
        std::fs::create_dir_all(&metrics_dir)?;
        let metrics_path = metrics_dir.join("tool-usage.jsonl");
        std::fs::write(
            &metrics_path,
            concat!(
                "{\"id\":\"evt-1\",\"session_id\":\"session-a\",\"tool_name\":\"Edit\",\"input_summary\":\"Edit src/lib.rs\",\"output_summary\":\"older change\",\"file_events\":[{\"path\":\"src/lib.rs\",\"action\":\"modify\"}],\"timestamp\":\"2026-04-09T00:02:00Z\"}\n",
                "{\"id\":\"evt-2\",\"session_id\":\"session-b\",\"tool_name\":\"Edit\",\"input_summary\":\"Edit src/lib.rs\",\"output_summary\":\"later change\",\"file_events\":[{\"path\":\"src/lib.rs\",\"action\":\"modify\"}],\"timestamp\":\"2026-04-09T00:03:00Z\"}\n"
            ),
        )?;
        db.sync_tool_activity_metrics(&metrics_path)?;

        let outcome = enforce_conflict_resolution(&db, &cfg)?;
        assert_eq!(outcome.created_incidents, 1);
        assert_eq!(outcome.paused_sessions, vec!["session-a".to_string()]);

        let session_a = db
            .get_session("session-a")?
            .expect("session-a should still exist");
        let session_b = db
            .get_session("session-b")?
            .expect("session-b should still exist");
        assert_eq!(session_a.state, SessionState::Stopped);
        assert_eq!(session_b.state, SessionState::Running);

        let incidents = db.list_open_conflict_incidents_for_session("session-a", 10)?;
        assert_eq!(incidents.len(), 1);
        assert_eq!(incidents[0].active_session_id, "session-b");
        assert_eq!(incidents[0].paused_session_id, "session-a");
        assert_eq!(incidents[0].strategy, "last_write_wins");

        Ok(())
    }
}
