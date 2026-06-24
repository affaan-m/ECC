use chrono::{Duration, Utc};
use crossterm::event::KeyEvent;
use ratatui::{
    prelude::*,
    widgets::{
        Block, Borders, Cell, Clear, HighlightSpacing, Paragraph, Row, Table, TableState, Tabs,
        Wrap,
    },
};
use regex::Regex;
use std::collections::{BTreeMap, HashMap, HashSet, VecDeque};
use std::time::UNIX_EPOCH;
use tokio::sync::broadcast;

use super::widgets::{budget_state, format_currency, format_token_count, BudgetState, TokenMeter};
use crate::comms;
use crate::config::{Config, PaneLayout, PaneNavigationAction, Theme};
use crate::notifications::{DesktopNotifier, NotificationEvent, WebhookNotifier};
use crate::observability::ToolLogEntry;
use crate::session::manager;
use crate::session::output::{
    OutputEvent, OutputLine, OutputStream, SessionOutputStore, OUTPUT_BUFFER_LIMIT,
};
use crate::session::store::{DaemonActivity, FileActivityOverlap, StateStore};
use crate::session::{
    ContextObservationPriority, DecisionLogEntry, FileActivityEntry, Session, SessionGrouping,
    SessionBoardMeta, SessionHarnessInfo, SessionMessage, SessionState,
};
use crate::worktree;

#[cfg(test)]
use crate::session::{SessionMetrics, WorktreeInfo};

const DEFAULT_GRID_SIZE_PERCENT: u16 = 50;
const OUTPUT_PANE_PERCENT: u16 = 70;
const MIN_PANE_SIZE_PERCENT: u16 = 20;
const MAX_PANE_SIZE_PERCENT: u16 = 80;
const PANE_RESIZE_STEP_PERCENT: u16 = 5;
const MAX_LOG_ENTRIES: u64 = 12;
const MAX_DIFF_PREVIEW_LINES: usize = 6;
const MAX_DIFF_PATCH_LINES: usize = 80;
const MAX_METRICS_GRAPH_RELATIONS: usize = 6;
const MAX_FILE_ACTIVITY_PATCH_LINES: usize = 3;

#[derive(Debug, Clone, PartialEq, Eq)]
struct WorktreeDiffColumns {
    removals: Text<'static>,
    additions: Text<'static>,
    hunk_offsets: Vec<usize>,
}

#[derive(Debug, Clone, Copy)]
struct ThemePalette {
    accent: Color,
    row_highlight_bg: Color,
    muted: Color,
    help_border: Color,
}

#[derive(Debug, Clone)]
struct SessionCompletionSummary {
    session_id: String,
    task: String,
    state: SessionState,
    files_changed: u32,
    tokens_used: u64,
    duration_secs: u64,
    cost_usd: f64,
    tests_run: usize,
    tests_passed: usize,
    recent_files: Vec<String>,
    key_decisions: Vec<String>,
    warnings: Vec<String>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
struct TestRunSummary {
    total: usize,
    passed: usize,
}

pub struct Dashboard {
    db: StateStore,
    cfg: Config,
    output_store: SessionOutputStore,
    output_rx: broadcast::Receiver<OutputEvent>,
    notifier: DesktopNotifier,
    webhook_notifier: WebhookNotifier,
    sessions: Vec<Session>,
    session_harnesses: HashMap<String, SessionHarnessInfo>,
    session_output_cache: HashMap<String, Vec<OutputLine>>,
    unread_message_counts: HashMap<String, usize>,
    approval_queue_counts: HashMap<String, usize>,
    approval_queue_preview: Vec<SessionMessage>,
    handoff_backlog_counts: HashMap<String, usize>,
    board_meta_by_session: HashMap<String, SessionBoardMeta>,
    worktree_health_by_session: HashMap<String, worktree::WorktreeHealth>,
    global_handoff_backlog_leads: usize,
    global_handoff_backlog_messages: usize,
    daemon_activity: DaemonActivity,
    selected_messages: Vec<SessionMessage>,
    selected_parent_session: Option<String>,
    selected_child_sessions: Vec<DelegatedChildSummary>,
    focused_delegate_session_id: Option<String>,
    selected_team_summary: Option<TeamSummary>,
    selected_route_preview: Option<String>,
    logs: Vec<ToolLogEntry>,
    selected_diff_summary: Option<String>,
    selected_diff_preview: Vec<String>,
    selected_diff_patch: Option<String>,
    selected_diff_hunk_offsets_unified: Vec<usize>,
    selected_diff_hunk_offsets_split: Vec<usize>,
    selected_diff_hunk: usize,
    diff_view_mode: DiffViewMode,
    selected_conflict_protocol: Option<String>,
    selected_merge_readiness: Option<worktree::MergeReadiness>,
    selected_git_status_entries: Vec<worktree::GitStatusEntry>,
    selected_git_status: usize,
    selected_git_patch: Option<worktree::GitStatusPatchView>,
    selected_git_patch_hunk_offsets_unified: Vec<usize>,
    selected_git_patch_hunk_offsets_split: Vec<usize>,
    selected_git_patch_hunk: usize,
    output_mode: OutputMode,
    graph_entity_filter: GraphEntityFilter,
    output_filter: OutputFilter,
    output_time_filter: OutputTimeFilter,
    timeline_event_filter: TimelineEventFilter,
    timeline_scope: SearchScope,
    selected_pane: Pane,
    selected_session: usize,
    show_help: bool,
    operator_note: Option<String>,
    pane_command_mode: bool,
    output_follow: bool,
    output_scroll_offset: usize,
    last_output_height: usize,
    metrics_scroll_offset: usize,
    last_metrics_height: usize,
    pane_size_percent: u16,
    collapsed_panes: HashSet<Pane>,
    search_input: Option<String>,
    spawn_input: Option<String>,
    commit_input: Option<String>,
    pr_input: Option<String>,
    search_query: Option<String>,
    search_scope: SearchScope,
    search_agent_filter: SearchAgentFilter,
    search_matches: Vec<SearchMatch>,
    selected_search_match: usize,
    active_completion_popup: Option<SessionCompletionSummary>,
    queued_completion_popups: VecDeque<SessionCompletionSummary>,
    session_table_state: TableState,
    last_cost_metrics_signature: Option<(u64, u128)>,
    last_tool_activity_signature: Option<(u64, u128)>,
    last_budget_alert_state: BudgetState,
    last_session_states: HashMap<String, SessionState>,
    last_seen_approval_message_id: Option<i64>,
}

#[derive(Debug, Default, PartialEq, Eq)]
struct SessionSummary {
    total: usize,
    projects: usize,
    task_groups: usize,
    pending: usize,
    running: usize,
    idle: usize,
    stale: usize,
    completed: usize,
    failed: usize,
    stopped: usize,
    unread_messages: usize,
    inbox_sessions: usize,
    conflicted_worktrees: usize,
    in_progress_worktrees: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
enum Pane {
    Sessions,
    Output,
    Metrics,
    Board,
    Log,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum OutputMode {
    SessionOutput,
    Timeline,
    ContextGraph,
    WorktreeDiff,
    ConflictProtocol,
    GitStatus,
    GitPatch,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum GraphEntityFilter {
    All,
    Decisions,
    Files,
    Functions,
    Sessions,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DiffViewMode {
    Split,
    Unified,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum OutputFilter {
    All,
    ErrorsOnly,
    ToolCallsOnly,
    FileChangesOnly,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum OutputTimeFilter {
    AllTime,
    Last15Minutes,
    LastHour,
    Last24Hours,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TimelineEventFilter {
    All,
    Lifecycle,
    Messages,
    ToolCalls,
    FileChanges,
    Decisions,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SearchScope {
    SelectedSession,
    AllSessions,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SearchAgentFilter {
    AllAgents,
    SelectedAgentType,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PaneDirection {
    Left,
    Right,
    Up,
    Down,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct SearchMatch {
    session_id: String,
    line_index: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct GraphDisplayLine {
    session_id: String,
    text: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct PrPromptSpec {
    title: String,
    base_branch: Option<String>,
    labels: Vec<String>,
    reviewers: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TimelineEventType {
    Lifecycle,
    Message,
    ToolCall,
    FileChange,
    Decision,
}

#[derive(Debug, Clone)]
struct TimelineEvent {
    occurred_at: chrono::DateTime<Utc>,
    session_id: String,
    event_type: TimelineEventType,
    summary: String,
    detail_lines: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum SpawnRequest {
    AdHoc {
        requested_count: usize,
        task: String,
    },
    Template {
        name: String,
        task: Option<String>,
        variables: BTreeMap<String, String>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum SpawnPlan {
    AdHoc {
        requested_count: usize,
        spawn_count: usize,
        task: String,
    },
    Template {
        name: String,
        task: Option<String>,
        variables: BTreeMap<String, String>,
        step_count: usize,
    },
}

#[derive(Debug, Clone, Copy)]
struct PaneAreas {
    sessions: Rect,
    output: Option<Rect>,
    metrics: Option<Rect>,
    log: Option<Rect>,
}

impl PaneAreas {
    fn assign(&mut self, pane: Pane, area: Rect) {
        match pane {
            Pane::Sessions => self.sessions = area,
            Pane::Output => self.output = Some(area),
            Pane::Metrics | Pane::Board => self.metrics = Some(area),
            Pane::Log => self.log = Some(area),
        }
    }
}

#[derive(Debug, Clone, Copy)]
struct AggregateUsage {
    total_tokens: u64,
    total_cost_usd: f64,
    token_state: BudgetState,
    cost_state: BudgetState,
    overall_state: BudgetState,
}

#[derive(Debug, Clone)]
struct DelegatedChildSummary {
    session_id: String,
    state: SessionState,
    worktree_health: Option<worktree::WorktreeHealth>,
    approval_backlog: usize,
    handoff_backlog: usize,
    tokens_used: u64,
    files_changed: u32,
    duration_secs: u64,
    task_preview: String,
    branch: Option<String>,
    last_output_preview: Option<String>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
struct TeamSummary {
    total: usize,
    idle: usize,
    running: usize,
    pending: usize,
    stale: usize,
    failed: usize,
    stopped: usize,
}

impl SessionCompletionSummary {
    fn title(&self) -> String {
        match self.state {
            SessionState::Completed => "ECC 2.0: Session completed".to_string(),
            SessionState::Failed => "ECC 2.0: Session failed".to_string(),
            _ => "ECC 2.0: Session summary".to_string(),
        }
    }

    fn subtitle(&self) -> String {
        format!(
            "{} | {}",
            format_session_id(&self.session_id),
            truncate_for_dashboard(&self.task, 88)
        )
    }

    fn notification_body(&self) -> String {
        let tests_line = if self.tests_run > 0 {
            format!(
                "Tests {} run / {} passed",
                self.tests_run, self.tests_passed
            )
        } else {
            "Tests not detected".to_string()
        };

        let warnings_line = if self.warnings.is_empty() {
            "Warnings none".to_string()
        } else {
            format!(
                "Warnings {}",
                truncate_for_dashboard(&self.warnings.join("; "), 88)
            )
        };

        [
            self.subtitle(),
            format!(
                "Files {} | Tokens {} | Duration {}",
                self.files_changed,
                format_token_count(self.tokens_used),
                format_duration(self.duration_secs)
            ),
            tests_line,
            warnings_line,
        ]
        .join("\n")
    }

    fn popup_text(&self) -> String {
        let mut lines = vec![
            self.subtitle(),
            String::new(),
            format!(
                "Files {} | Tokens {} | Cost {} | Duration {}",
                self.files_changed,
                format_token_count(self.tokens_used),
                format_currency(self.cost_usd),
                format_duration(self.duration_secs)
            ),
        ];

        if self.tests_run > 0 {
            lines.push(format!(
                "Tests {} run / {} passed",
                self.tests_run, self.tests_passed
            ));
        } else {
            lines.push("Tests not detected".to_string());
        }

        if !self.recent_files.is_empty() {
            lines.push(String::new());
            lines.push("Recent files".to_string());
            for item in &self.recent_files {
                lines.push(format!("- {item}"));
            }
        }

        if !self.key_decisions.is_empty() {
            lines.push(String::new());
            lines.push("Key decisions".to_string());
            for item in &self.key_decisions {
                lines.push(format!("- {item}"));
            }
        }

        if !self.warnings.is_empty() {
            lines.push(String::new());
            lines.push("Warnings".to_string());
            for item in &self.warnings {
                lines.push(format!("- {item}"));
            }
        }

        lines.push(String::new());
        lines.push("[Enter]/[Space]/[Esc] dismiss".to_string());
        lines.join("\n")
    }
}

fn load_session_harnesses(
    db: &StateStore,
    cfg: &Config,
    sessions: &[Session],
) -> HashMap<String, SessionHarnessInfo> {
    let working_dirs = sessions
        .iter()
        .map(|session| (session.id.as_str(), session.working_dir.as_path()))
        .collect::<HashMap<_, _>>();
    db.list_session_harnesses()
        .unwrap_or_default()
        .into_iter()
        .map(|(session_id, info)| {
            let info = if let Some(working_dir) = working_dirs.get(session_id.as_str()) {
                info.with_config_detection(cfg, working_dir)
            } else {
                info
            };
            (session_id, info)
        })
        .collect()
}

impl Dashboard {
    pub fn new(db: StateStore, cfg: Config) -> Self {
        Self::with_output_store(db, cfg, SessionOutputStore::default())
    }

    pub fn with_output_store(
        db: StateStore,
        cfg: Config,
        output_store: SessionOutputStore,
    ) -> Self {
        let pane_size_percent = configured_pane_size(&cfg, cfg.pane_layout);
        let initial_cost_metrics_signature = metrics_file_signature(&cfg.cost_metrics_path());
        let initial_tool_activity_signature =
            metrics_file_signature(&cfg.tool_activity_metrics_path());
        let _ = db.refresh_session_durations();
        if initial_cost_metrics_signature.is_some() {
            let _ = db.sync_cost_tracker_metrics(&cfg.cost_metrics_path());
        }
        if initial_tool_activity_signature.is_some() {
            let _ = db.sync_tool_activity_metrics(&cfg.tool_activity_metrics_path());
        }
        let sessions = db.list_sessions().unwrap_or_default();
        let session_harnesses = load_session_harnesses(&db, &cfg, &sessions);
        let initial_session_states = sessions
            .iter()
            .map(|session| (session.id.clone(), session.state.clone()))
            .collect();
        let initial_approval_message_id = db
            .latest_unread_approval_message()
            .ok()
            .flatten()
            .map(|message| message.id);
        let output_rx = output_store.subscribe();
        let notifier = DesktopNotifier::new(cfg.desktop_notifications.clone());
        let webhook_notifier = WebhookNotifier::new(cfg.webhook_notifications.clone());
        let mut session_table_state = TableState::default();
        if !sessions.is_empty() {
            session_table_state.select(Some(0));
        }

        let mut dashboard = Self {
            db,
            cfg,
            output_store,
            output_rx,
            notifier,
            webhook_notifier,
            sessions,
            session_harnesses,
            session_output_cache: HashMap::new(),
            unread_message_counts: HashMap::new(),
            approval_queue_counts: HashMap::new(),
            approval_queue_preview: Vec::new(),
            handoff_backlog_counts: HashMap::new(),
            board_meta_by_session: HashMap::new(),
            worktree_health_by_session: HashMap::new(),
            global_handoff_backlog_leads: 0,
            global_handoff_backlog_messages: 0,
            daemon_activity: DaemonActivity::default(),
            selected_messages: Vec::new(),
            selected_parent_session: None,
            selected_child_sessions: Vec::new(),
            focused_delegate_session_id: None,
            selected_team_summary: None,
            selected_route_preview: None,
            logs: Vec::new(),
            selected_diff_summary: None,
            selected_diff_preview: Vec::new(),
            selected_diff_patch: None,
            selected_diff_hunk_offsets_unified: Vec::new(),
            selected_diff_hunk_offsets_split: Vec::new(),
            selected_diff_hunk: 0,
            diff_view_mode: DiffViewMode::Split,
            selected_conflict_protocol: None,
            selected_merge_readiness: None,
            selected_git_status_entries: Vec::new(),
            selected_git_status: 0,
            selected_git_patch: None,
            selected_git_patch_hunk_offsets_unified: Vec::new(),
            selected_git_patch_hunk_offsets_split: Vec::new(),
            selected_git_patch_hunk: 0,
            output_mode: OutputMode::SessionOutput,
            graph_entity_filter: GraphEntityFilter::All,
            output_filter: OutputFilter::All,
            output_time_filter: OutputTimeFilter::AllTime,
            timeline_event_filter: TimelineEventFilter::All,
            timeline_scope: SearchScope::SelectedSession,
            selected_pane: Pane::Sessions,
            selected_session: 0,
            show_help: false,
            operator_note: None,
            pane_command_mode: false,
            output_follow: true,
            output_scroll_offset: 0,
            last_output_height: 0,
            metrics_scroll_offset: 0,
            last_metrics_height: 0,
            pane_size_percent,
            collapsed_panes: HashSet::new(),
            search_input: None,
            spawn_input: None,
            commit_input: None,
            pr_input: None,
            search_query: None,
            search_scope: SearchScope::SelectedSession,
            search_agent_filter: SearchAgentFilter::AllAgents,
            search_matches: Vec::new(),
            selected_search_match: 0,
            active_completion_popup: None,
            queued_completion_popups: VecDeque::new(),
            session_table_state,
            last_cost_metrics_signature: initial_cost_metrics_signature,
            last_tool_activity_signature: initial_tool_activity_signature,
            last_budget_alert_state: BudgetState::Normal,
            last_session_states: initial_session_states,
            last_seen_approval_message_id: initial_approval_message_id,
        };
        sort_sessions_for_display(&mut dashboard.sessions);
        dashboard.unread_message_counts = dashboard.db.unread_message_counts().unwrap_or_default();
        dashboard.sync_approval_queue();
        dashboard.sync_handoff_backlog_counts();
        dashboard.sync_board_meta();
        dashboard.sync_global_handoff_backlog();
        dashboard.sync_selected_output();
        dashboard.sync_selected_diff();
        dashboard.sync_selected_messages();
        dashboard.sync_selected_lineage();
        dashboard.refresh_logs();
        dashboard.last_budget_alert_state = dashboard.aggregate_usage().overall_state;
        dashboard
    }

    pub fn render(&mut self, frame: &mut Frame) {
        let chunks = Layout::default()
            .direction(Direction::Vertical)
            .constraints([
                Constraint::Length(3),
                Constraint::Min(10),
                Constraint::Length(3),
            ])
            .split(frame.area());

        self.render_header(frame, chunks[0]);

        if self.show_help {
            self.render_help(frame, chunks[1]);
        } else {
            let pane_areas = self.pane_areas(chunks[1]);
            self.render_sessions(frame, pane_areas.sessions);
            if let Some(output_area) = pane_areas.output {
                self.render_output(frame, output_area);
            }
            if let Some(metrics_area) = pane_areas.metrics {
                self.render_metrics(frame, metrics_area);
            }

            if let Some(log_area) = pane_areas.log {
                self.render_log(frame, log_area);
            }
        }

        self.render_status_bar(frame, chunks[2]);

        if let Some(summary) = self.active_completion_popup.as_ref() {
            self.render_completion_popup(frame, summary);
        }
    }

    fn render_header(&self, frame: &mut Frame, area: Rect) {
        let running = self
            .sessions
            .iter()
            .filter(|session| session.state == SessionState::Running)
            .count();
        let total = self.sessions.len();
        let palette = self.theme_palette();

        let title = format!(
            " ECC 2.0 | {running} running / {total} total | {} {}% | {} ",
            self.layout_label(),
            self.pane_size_percent,
            self.theme_label()
        );
        let tabs = Tabs::new(
            self.visible_panes()
                .iter()
                .map(|pane| pane.title())
                .collect::<Vec<_>>(),
        )
        .block(Block::default().borders(Borders::ALL).title(title))
        .select(self.selected_pane_index())
        .highlight_style(
            Style::default()
                .fg(palette.accent)
                .add_modifier(Modifier::BOLD),
        );

        frame.render_widget(tabs, area);
    }

    fn render_sessions(&mut self, frame: &mut Frame, area: Rect) {
        let block = Block::default()
            .borders(Borders::ALL)
            .title(" Sessions ")
            .border_style(self.pane_border_style(Pane::Sessions));
        let inner_area = block.inner(area);
        frame.render_widget(block, area);

        if inner_area.is_empty() {
            return;
        }

        let stabilized = self
            .daemon_activity
            .stabilized_after_recovery_at()
            .is_some();
        let summary = SessionSummary::from_sessions(
            &self.sessions,
            &self.handoff_backlog_counts,
            &self.worktree_health_by_session,
            stabilized,
        );
        let mut overview_lines = vec![
            summary_line(&summary),
            attention_queue_line(&summary, stabilized),
            approval_queue_line(&self.approval_queue_counts),
        ];
        if let Some(preview) = approval_queue_preview_line(&self.approval_queue_preview) {
            overview_lines.push(preview);
        }
        let chunks = Layout::default()
            .direction(Direction::Vertical)
            .constraints([
                Constraint::Length(overview_lines.len() as u16),
                Constraint::Min(3),
            ])
            .split(inner_area);

        frame.render_widget(Paragraph::new(overview_lines), chunks[0]);

        let mut previous_project: Option<&str> = None;
        let mut previous_task_group: Option<&str> = None;
        let rows = self.sessions.iter().map(|session| {
            let project_cell = if previous_project == Some(session.project.as_str()) {
                None
            } else {
                previous_project = Some(session.project.as_str());
                previous_task_group = None;
                Some(session.project.clone())
            };
            let task_group_cell = if previous_task_group == Some(session.task_group.as_str()) {
                None
            } else {
                previous_task_group = Some(session.task_group.as_str());
                Some(session.task_group.clone())
            };

            session_row(
                session,
                project_cell,
                task_group_cell,
                self.approval_queue_counts
                    .get(&session.id)
                    .copied()
                    .unwrap_or(0),
                self.handoff_backlog_counts
                    .get(&session.id)
                    .copied()
                    .unwrap_or(0),
            )
        });
        let header = Row::new([
            "ID",
            "Project",
            "Group",
            "Agent",
            "State",
            "Branch",
            "Approvals",
            "Backlog",
            "Tokens",
            "Tools",
            "Files",
            "Duration",
        ])
        .style(Style::default().add_modifier(Modifier::BOLD));
        let widths = [
            Constraint::Length(8),
            Constraint::Length(12),
            Constraint::Length(18),
            Constraint::Length(10),
            Constraint::Length(10),
            Constraint::Min(12),
            Constraint::Length(10),
            Constraint::Length(7),
            Constraint::Length(8),
            Constraint::Length(7),
            Constraint::Length(7),
            Constraint::Length(8),
        ];

        let table = Table::new(rows, widths)
            .header(header)
            .column_spacing(1)
            .highlight_symbol(">> ")
            .highlight_spacing(HighlightSpacing::Always)
            .row_highlight_style(
                Style::default()
                    .bg(self.theme_palette().row_highlight_bg)
                    .add_modifier(Modifier::BOLD),
            );

        let selected = if self.sessions.is_empty() {
            None
        } else {
            Some(self.selected_session.min(self.sessions.len() - 1))
        };
        if self.session_table_state.selected() != selected {
            self.session_table_state.select(selected);
        }

        frame.render_stateful_widget(table, chunks[1], &mut self.session_table_state);
    }

    fn render_output(&mut self, frame: &mut Frame, area: Rect) {
        self.sync_output_scroll(area.height.saturating_sub(2) as usize);

        if self.sessions.get(self.selected_session).is_some()
            && matches!(
                self.output_mode,
                OutputMode::WorktreeDiff | OutputMode::GitPatch
            )
            && self.active_patch_text().is_some()
            && self.diff_view_mode == DiffViewMode::Split
        {
            self.render_split_diff_output(frame, area);
            return;
        }

        let (title, content) = if self.sessions.get(self.selected_session).is_some() {
            match self.output_mode {
                OutputMode::SessionOutput => {
                    let lines = self.visible_output_lines();
                    let content = if lines.is_empty() {
                        Text::from(self.empty_output_message())
                    } else if self.search_query.is_some() {
                        self.render_searchable_output(&lines)
                    } else {
                        Text::from(
                            lines
                                .iter()
                                .map(|line| Line::from(line.text.clone()))
                                .collect::<Vec<_>>(),
                        )
                    };
                    (self.output_title(), content)
                }
                OutputMode::Timeline => {
                    let lines = self.visible_timeline_lines();
                    let content = if lines.is_empty() {
                        Text::from(self.empty_timeline_message())
                    } else {
                        Text::from(lines)
                    };
                    (self.output_title(), content)
                }
                OutputMode::ContextGraph => {
                    let lines = self.visible_graph_lines();
                    let content = if lines.is_empty() {
                        Text::from(self.empty_graph_message())
                    } else if self.search_query.is_some() {
                        self.render_searchable_graph(&lines)
                    } else {
                        Text::from(
                            lines
                                .into_iter()
                                .map(|line| Line::from(line.text))
                                .collect::<Vec<_>>(),
                        )
                    };
                    (self.output_title(), content)
                }
                OutputMode::WorktreeDiff => {
                    let content = if let Some(patch) = self.selected_diff_patch.as_ref() {
                        build_unified_diff_text(patch, self.theme_palette())
                    } else {
                        Text::from(
                            self.selected_diff_summary
                                .as_ref()
                                .map(|summary| {
                                    format!(
                                        "{summary}\n\nNo patch content to preview yet. The worktree may be clean or only have summary-level changes."
                                    )
                                })
                                .unwrap_or_else(|| {
                                    "No worktree diff available for the selected session."
                                        .to_string()
                                }),
                        )
                    };
                    (self.output_title(), content)
                }
                OutputMode::GitPatch => {
                    let content = if let Some(patch) = self.selected_git_patch.as_ref() {
                        build_unified_diff_text(&patch.patch, self.theme_palette())
                    } else {
                        Text::from(
                            "No selected-file patch available for the current git-status entry.",
                        )
                    };
                    (self.output_title(), content)
                }
                OutputMode::ConflictProtocol => {
                    let content = self.selected_conflict_protocol.clone().unwrap_or_else(|| {
                        "No conflicted worktree available for the selected session.".to_string()
                    });
                    (" Conflict Protocol ".to_string(), Text::from(content))
                }
                OutputMode::GitStatus => {
                    let content = if self.selected_git_status_entries.is_empty() {
                        Text::from(self.empty_git_status_message())
                    } else {
                        Text::from(self.visible_git_status_lines())
                    };
                    (self.output_title(), content)
                }
            }
        } else {
            (
                self.output_title(),
                Text::from("No sessions. Press 'n' to start one."),
            )
        };

        let paragraph = Paragraph::new(content)
            .block(
                Block::default()
                    .borders(Borders::ALL)
                    .title(title)
                    .border_style(self.pane_border_style(Pane::Output)),
            )
            .scroll((self.output_scroll_offset as u16, 0));
        frame.render_widget(paragraph, area);
    }

    fn render_split_diff_output(&mut self, frame: &mut Frame, area: Rect) {
        let block = Block::default()
            .borders(Borders::ALL)
            .title(self.output_title())
            .border_style(self.pane_border_style(Pane::Output));
        let inner_area = block.inner(area);
        frame.render_widget(block, area);

        if inner_area.is_empty() {
            return;
        }

        let Some(patch) = self.active_patch_text() else {
            return;
        };
        let columns = build_worktree_diff_columns(patch, self.theme_palette());
        let column_chunks = Layout::default()
            .direction(Direction::Horizontal)
            .constraints([Constraint::Percentage(50), Constraint::Percentage(50)])
            .split(inner_area);

        let removals = Paragraph::new(columns.removals)
            .block(Block::default().borders(Borders::ALL).title(" Removals "))
            .scroll((self.output_scroll_offset as u16, 0))
            .wrap(Wrap { trim: false });
        frame.render_widget(removals, column_chunks[0]);

        let additions = Paragraph::new(columns.additions)
            .block(Block::default().borders(Borders::ALL).title(" Additions "))
            .scroll((self.output_scroll_offset as u16, 0))
            .wrap(Wrap { trim: false });
        frame.render_widget(additions, column_chunks[1]);
    }

    fn output_title(&self) -> String {
        if self.output_mode == OutputMode::Timeline {
            return format!(
                " Timeline{}{}{} ",
                self.timeline_scope.title_suffix(),
                self.timeline_event_filter.title_suffix(),
                self.output_time_filter.title_suffix()
            );
        }

        if self.output_mode == OutputMode::ContextGraph {
            let scope = self.search_scope.title_suffix();
            let filter = self.graph_entity_filter.title_suffix();
            let time = self.output_time_filter.title_suffix();
            if let Some(input) = self.search_input.as_ref() {
                return format!(" Graph{scope}{filter}{time} /{input}_ ");
            }
            if let Some(query) = self.search_query.as_ref() {
                let total = self.search_matches.len();
                let current = if total == 0 {
                    0
                } else {
                    self.selected_search_match.min(total.saturating_sub(1)) + 1
                };
                return format!(" Graph{scope}{filter}{time} /{query} {current}/{total} ");
            }
            return format!(" Graph{scope}{filter}{time} ");
        }

        if self.output_mode == OutputMode::WorktreeDiff {
            return format!(
                " Diff{}{} ",
                self.diff_view_mode.title_suffix(),
                self.diff_hunk_title_suffix()
            );
        }

        if self.output_mode == OutputMode::GitPatch {
            let path = self
                .selected_git_patch
                .as_ref()
                .map(|patch| patch.display_path.as_str())
                .unwrap_or("selected file");
            return format!(
                " Git patch {}{}{} ",
                path,
                self.diff_view_mode.title_suffix(),
                self.diff_hunk_title_suffix()
            );
        }

        if self.output_mode == OutputMode::GitStatus {
            let staged = self
                .selected_git_status_entries
                .iter()
                .filter(|entry| entry.staged)
                .count();
            let unstaged = self
                .selected_git_status_entries
                .iter()
                .filter(|entry| entry.unstaged || entry.untracked)
                .count();
            let total = self.selected_git_status_entries.len();
            let current = if total == 0 {
                0
            } else {
                self.selected_git_status.min(total.saturating_sub(1)) + 1
            };
            return format!(" Git status staged:{staged} unstaged:{unstaged} {current}/{total} ");
        }

        let filter = format!(
            "{}{}",
            self.output_filter.title_suffix(),
            self.output_time_filter.title_suffix()
        );
        let scope = self.search_scope.title_suffix();
        let agent = self.search_agent_title_suffix();
        if let Some(input) = self.search_input.as_ref() {
            return format!(" Output{filter}{scope}{agent} /{input}_ ");
        }

        if let Some(query) = self.search_query.as_ref() {
            let total = self.search_matches.len();
            let current = if total == 0 {
                0
            } else {
                self.selected_search_match.min(total.saturating_sub(1)) + 1
            };
            return format!(" Output{filter}{scope}{agent} /{query} {current}/{total} ");
        }

        format!(" Output{filter}{scope}{agent} ")
    }

    fn empty_output_message(&self) -> &'static str {
        match (self.output_filter, self.output_time_filter) {
            (OutputFilter::All, OutputTimeFilter::AllTime) => "Waiting for session output...",
            (OutputFilter::ErrorsOnly, OutputTimeFilter::AllTime) => {
                "No stderr output for this session yet."
            }
            (OutputFilter::ToolCallsOnly, OutputTimeFilter::AllTime) => {
                "No tool-call output for this session yet."
            }
            (OutputFilter::FileChangesOnly, OutputTimeFilter::AllTime) => {
                "No file-change output for this session yet."
            }
            (OutputFilter::All, _) => "No output lines in the selected time range.",
            (OutputFilter::ErrorsOnly, _) => "No stderr output in the selected time range.",
            (OutputFilter::ToolCallsOnly, _) => "No tool-call output in the selected time range.",
            (OutputFilter::FileChangesOnly, _) => {
                "No file-change output in the selected time range."
            }
        }
    }

    fn empty_git_status_message(&self) -> &'static str {
        "No staged or unstaged changes for this worktree."
    }

    fn empty_timeline_message(&self) -> &'static str {
        match (
            self.timeline_scope,
            self.timeline_event_filter,
            self.output_time_filter,
        ) {
            (SearchScope::AllSessions, TimelineEventFilter::All, OutputTimeFilter::AllTime) => {
                "No timeline events across all sessions yet."
            }
            (
                SearchScope::AllSessions,
                TimelineEventFilter::Lifecycle,
                OutputTimeFilter::AllTime,
            ) => "No lifecycle events across all sessions yet.",
            (
                SearchScope::AllSessions,
                TimelineEventFilter::Messages,
                OutputTimeFilter::AllTime,
            ) => "No message events across all sessions yet.",
            (
                SearchScope::AllSessions,
                TimelineEventFilter::ToolCalls,
                OutputTimeFilter::AllTime,
            ) => "No tool-call events across all sessions yet.",
            (
                SearchScope::AllSessions,
                TimelineEventFilter::FileChanges,
                OutputTimeFilter::AllTime,
            ) => "No file-change events across all sessions yet.",
            (
                SearchScope::AllSessions,
                TimelineEventFilter::Decisions,
                OutputTimeFilter::AllTime,
            ) => "No decision-log events across all sessions yet.",
            (SearchScope::AllSessions, TimelineEventFilter::All, _) => {
                "No timeline events across all sessions in the selected time range."
            }
            (SearchScope::AllSessions, TimelineEventFilter::Lifecycle, _) => {
                "No lifecycle events across all sessions in the selected time range."
            }
            (SearchScope::AllSessions, TimelineEventFilter::Messages, _) => {
                "No message events across all sessions in the selected time range."
            }
            (SearchScope::AllSessions, TimelineEventFilter::ToolCalls, _) => {
                "No tool-call events across all sessions in the selected time range."
            }
            (SearchScope::AllSessions, TimelineEventFilter::FileChanges, _) => {
                "No file-change events across all sessions in the selected time range."
            }
            (SearchScope::AllSessions, TimelineEventFilter::Decisions, _) => {
                "No decision-log events across all sessions in the selected time range."
            }
            (SearchScope::SelectedSession, TimelineEventFilter::All, OutputTimeFilter::AllTime) => {
                "No timeline events for this session yet."
            }
            (
                SearchScope::SelectedSession,
                TimelineEventFilter::Lifecycle,
                OutputTimeFilter::AllTime,
            ) => "No lifecycle events for this session yet.",
            (
                SearchScope::SelectedSession,
                TimelineEventFilter::Messages,
                OutputTimeFilter::AllTime,
            ) => "No message events for this session yet.",
            (
                SearchScope::SelectedSession,
                TimelineEventFilter::ToolCalls,
                OutputTimeFilter::AllTime,
            ) => "No tool-call events for this session yet.",
            (
                SearchScope::SelectedSession,
                TimelineEventFilter::FileChanges,
                OutputTimeFilter::AllTime,
            ) => "No file-change events for this session yet.",
            (
                SearchScope::SelectedSession,
                TimelineEventFilter::Decisions,
                OutputTimeFilter::AllTime,
            ) => "No decision-log events for this session yet.",
            (SearchScope::SelectedSession, TimelineEventFilter::All, _) => {
                "No timeline events in the selected time range."
            }
            (SearchScope::SelectedSession, TimelineEventFilter::Lifecycle, _) => {
                "No lifecycle events in the selected time range."
            }
            (SearchScope::SelectedSession, TimelineEventFilter::Messages, _) => {
                "No message events in the selected time range."
            }
            (SearchScope::SelectedSession, TimelineEventFilter::ToolCalls, _) => {
                "No tool-call events in the selected time range."
            }
            (SearchScope::SelectedSession, TimelineEventFilter::FileChanges, _) => {
                "No file-change events in the selected time range."
            }
            (SearchScope::SelectedSession, TimelineEventFilter::Decisions, _) => {
                "No decision-log events in the selected time range."
            }
        }
    }

    fn empty_graph_message(&self) -> &'static str {
        match (
            self.search_scope,
            self.graph_entity_filter,
            self.output_time_filter,
        ) {
            (SearchScope::SelectedSession, GraphEntityFilter::All, OutputTimeFilter::AllTime) => {
                "No graph entities for this session yet."
            }
            (_, GraphEntityFilter::Decisions, OutputTimeFilter::AllTime) => {
                "No decision graph entities in the current scope yet."
            }
            (_, GraphEntityFilter::Files, OutputTimeFilter::AllTime) => {
                "No file graph entities in the current scope yet."
            }
            (_, GraphEntityFilter::Functions, OutputTimeFilter::AllTime) => {
                "No function graph entities in the current scope yet."
            }
            (_, GraphEntityFilter::Sessions, OutputTimeFilter::AllTime) => {
                "No session graph entities in the current scope yet."
            }
            (SearchScope::AllSessions, GraphEntityFilter::All, OutputTimeFilter::AllTime) => {
                "No graph entities across all sessions yet."
            }
            (_, _, _) => "No graph entities in the selected filter/time range.",
        }
    }

    fn render_searchable_output(&self, lines: &[&OutputLine]) -> Text<'static> {
        let Some(query) = self.search_query.as_deref() else {
            return Text::from(
                lines
                    .iter()
                    .map(|line| Line::from(line.text.clone()))
                    .collect::<Vec<_>>(),
            );
        };

        let selected_session_id = self.selected_session_id();
        let active_match = self.search_matches.get(self.selected_search_match);

        Text::from(
            lines
                .iter()
                .enumerate()
                .map(|(index, line)| {
                    highlight_output_line(
                        &line.text,
                        query,
                        active_match
                            .zip(selected_session_id)
                            .map(|(search_match, session_id)| {
                                search_match.session_id == session_id
                                    && search_match.line_index == index
                            })
                            .unwrap_or(false),
                        self.theme_palette(),
                    )
                })
                .collect::<Vec<_>>(),
        )
    }

    fn render_searchable_graph(&self, lines: &[GraphDisplayLine]) -> Text<'static> {
        let Some(query) = self.search_query.as_deref() else {
            return Text::from(
                lines
                    .iter()
                    .map(|line| Line::from(line.text.clone()))
                    .collect::<Vec<_>>(),
            );
        };

        let active_match = self.search_matches.get(self.selected_search_match);

        Text::from(
            lines
                .iter()
                .enumerate()
                .map(|(index, line)| {
                    highlight_output_line(
                        &line.text,
                        query,
                        active_match
                            .map(|search_match| {
                                search_match.session_id == line.session_id
                                    && search_match.line_index == index
                            })
                            .unwrap_or(false),
                        self.theme_palette(),
                    )
                })
                .collect::<Vec<_>>(),
        )
    }

    fn render_metrics(&mut self, frame: &mut Frame, area: Rect) {
        let side_pane = if self.selected_pane == Pane::Board {
            Pane::Board
        } else {
            Pane::Metrics
        };
        let block = Block::default()
            .borders(Borders::ALL)
            .title(match side_pane {
                Pane::Board => " Board ",
                _ => " Metrics ",
            })
            .border_style(self.pane_border_style(side_pane));
        let inner = block.inner(area);
        frame.render_widget(block, area);

        if inner.is_empty() {
            return;
        }

        if side_pane == Pane::Board {
            frame.render_widget(
                Paragraph::new(self.board_text())
                    .scroll((self.metrics_scroll_offset as u16, 0))
                    .wrap(Wrap { trim: true }),
                inner,
            );
            self.sync_metrics_scroll(inner.height as usize);
            return;
        }

        let chunks = Layout::default()
            .direction(Direction::Vertical)
            .constraints([
                Constraint::Length(2),
                Constraint::Length(2),
                Constraint::Min(1),
            ])
            .split(inner);

        let aggregate = self.aggregate_usage();
        let thresholds = self.cfg.effective_budget_alert_thresholds();
        frame.render_widget(
            TokenMeter::tokens(
                "Token Budget",
                aggregate.total_tokens,
                self.cfg.token_budget,
                thresholds,
            ),
            chunks[0],
        );
        frame.render_widget(
            TokenMeter::currency(
                "Cost Budget",
                aggregate.total_cost_usd,
                self.cfg.cost_budget_usd,
                thresholds,
            ),
            chunks[1],
        );
        frame.render_widget(
            Paragraph::new(self.selected_session_metrics_text())
                .scroll((self.metrics_scroll_offset as u16, 0))
                .wrap(Wrap { trim: true }),
            chunks[2],
        );
        self.sync_metrics_scroll(chunks[2].height as usize);
    }

    fn render_log(&self, frame: &mut Frame, area: Rect) {
        let content = if self.sessions.get(self.selected_session).is_none() {
            "No session selected.".to_string()
        } else if self.logs.is_empty() {
            "No tool logs available for this session yet.".to_string()
        } else {
            self.logs
                .iter()
                .map(|entry| {
                    let mut block = format!(
                        "[{}] {} | {}ms | risk {:.0}%",
                        self.short_timestamp(&entry.timestamp),
                        entry.tool_name,
                        entry.duration_ms,
                        entry.risk_score * 100.0,
                    );
                    if !entry.trigger_summary.trim().is_empty() {
                        block.push_str(&format!(
                            "\nwhy: {}",
                            self.log_field(&entry.trigger_summary)
                        ));
                    }
                    if entry.input_params_json.trim() != "{}" {
                        block.push_str(&format!(
                            "\nparams: {}",
                            self.log_field(&entry.input_params_json)
                        ));
                    }
                    block.push_str(&format!(
                        "\ninput: {}\noutput: {}",
                        self.log_field(&entry.input_summary),
                        self.log_field(&entry.output_summary)
                    ));
                    block
                })
                .collect::<Vec<_>>()
                .join("\n\n")
        };

        let paragraph = Paragraph::new(content)
            .block(
                Block::default()
                    .borders(Borders::ALL)
                    .title(" Log ")
                    .border_style(self.pane_border_style(Pane::Log)),
            )
            .scroll((self.output_scroll_offset as u16, 0))
            .wrap(Wrap { trim: false });
        frame.render_widget(paragraph, area);
    }

    fn render_status_bar(&self, frame: &mut Frame, area: Rect) {
        let base_text = format!(
            " [n]ew session  natural spawn [N]  [a]ssign  re[b]alance  global re[B]alance  dra[i]n inbox  approval jump [I]  [g]lobal dispatch  coordinate [G]lobal  collapse pane [h]  restore panes [H]  timeline [y]  timeline filter [E]  file patch [v]  git status [z]  stage [S]  unstage [U]  reset [R]  commit [C]  create PR [P]  diff mode [V]  hunks [{{/}}]  conflict proto[c]ol  cont[e]nt filter  time [f]ilter  scope [A]  agent filter [o]  [m]erge  merge ready [M]  auto-worktree [t]  auto-merge [w]  toggle [p]olicy  [,/.] dispatch limit  [s]top  [u]resume  [x]cleanup  prune inactive [X]  [d]elete  [r]efresh  [{}] focus pane  [Tab] cycle pane  [{}] move pane  [j/k] scroll  delegate [ or ]  [Enter] open  [+/-] resize  [l]ayout {}  [T]heme {}  [?] help  [q]uit ",
            self.pane_focus_shortcuts_label(),
            self.pane_move_shortcuts_label(),
            self.layout_label(),
            self.theme_label()
        );

        let search_prefix = if self.active_completion_popup.is_some() {
            " completion summary | [Enter]/[Space]/[Esc] dismiss |".to_string()
        } else if let Some(input) = self.spawn_input.as_ref() {
            format!(" spawn>{input}_ | [Enter] queue [Esc] cancel |")
        } else if let Some(input) = self.commit_input.as_ref() {
            format!(" commit>{input}_ | [Enter] commit [Esc] cancel |")
        } else if let Some(input) = self.pr_input.as_ref() {
            format!(
                " pr>{input}_ | [Enter] create draft PR | title | base=branch | labels=a,b | reviewers=a,b | [Esc] cancel |"
            )
        } else if let Some(input) = self.search_input.as_ref() {
            format!(
                " /{input}_ | {} | {} | [Enter] apply [Esc] cancel |",
                self.search_scope.label(),
                self.search_agent_filter_label()
            )
        } else if let Some(query) = self.search_query.as_ref() {
            let total = self.search_matches.len();
            let current = if total == 0 {
                0
            } else {
                self.selected_search_match.min(total.saturating_sub(1)) + 1
            };
            format!(
                " /{query} {current}/{total} | {} | {} | [n/N] navigate [Esc] clear |",
                self.search_scope.label(),
                self.search_agent_filter_label()
            )
        } else if self.pane_command_mode {
            " Ctrl+w | [h/j/k/l] move [1-4] focus [s/v/g] layout [+/-] resize [Esc] cancel |"
                .to_string()
        } else {
            String::new()
        };

        let text = if self.active_completion_popup.is_some()
            || self.spawn_input.is_some()
            || self.commit_input.is_some()
            || self.pr_input.is_some()
            || self.search_input.is_some()
            || self.search_query.is_some()
            || self.pane_command_mode
        {
            format!(" {search_prefix}")
        } else if let Some(note) = self.operator_note.as_ref() {
            format!(" {} |{}", truncate_for_dashboard(note, 96), base_text)
        } else {
            base_text
        };
        let aggregate = self.aggregate_usage();
        let (summary_text, summary_style) = self.aggregate_cost_summary();
        let block = Block::default()
            .borders(Borders::ALL)
            .border_style(aggregate.overall_state.style());
        let inner = block.inner(area);
        frame.render_widget(block, area);

        if inner.is_empty() {
            return;
        }

        let summary_width = summary_text
            .len()
            .min(inner.width.saturating_sub(1) as usize) as u16;
        let chunks = Layout::default()
            .direction(Direction::Horizontal)
            .constraints([Constraint::Min(1), Constraint::Length(summary_width)])
            .split(inner);

        frame.render_widget(
            Paragraph::new(text).style(Style::default().fg(self.theme_palette().muted)),
            chunks[0],
        );
        frame.render_widget(
            Paragraph::new(summary_text)
                .style(summary_style)
                .alignment(Alignment::Right),
            chunks[1],
        );
    }

    fn render_completion_popup(&self, frame: &mut Frame, summary: &SessionCompletionSummary) {
        let popup_area = centered_rect(72, 65, frame.area());
        if popup_area.is_empty() {
            return;
        }

        frame.render_widget(Clear, popup_area);
        let block = Block::default()
            .borders(Borders::ALL)
            .title(format!(" {} ", summary.title()))
            .border_style(self.pane_border_style(Pane::Output));
        let inner = block.inner(popup_area);
        frame.render_widget(block, popup_area);
        if inner.is_empty() {
            return;
        }

        frame.render_widget(
            Paragraph::new(summary.popup_text())
                .wrap(Wrap { trim: true })
                .scroll((0, 0)),
            inner,
        );
    }

    fn render_help(&self, frame: &mut Frame, area: Rect) {
        let help = vec![
            "Keyboard Shortcuts:".to_string(),
            "".to_string(),
            "  n       New session".to_string(),
            "  N       Natural-language multi-agent or template spawn prompt".to_string(),
            "  a       Assign follow-up work from selected session".to_string(),
            "  b       Rebalance backed-up delegate handoff backlog for selected lead".to_string(),
            "  B       Rebalance backed-up delegate handoff backlog across lead teams".to_string(),
            "  i       Drain unread task handoffs from selected lead".to_string(),
            "  I       Jump to the next unread approval/conflict target session".to_string(),
            "  g       Auto-dispatch unread handoffs across lead sessions".to_string(),
            "  G       Dispatch then rebalance backlog across lead teams".to_string(),
            "  K       Toggle selected-session context graph view".to_string(),
            "  h       Collapse the focused non-session pane".to_string(),
            "  H       Restore all collapsed panes".to_string(),
            "  y       Toggle selected-session timeline view".to_string(),
            "  E       Cycle timeline event filter or graph entity filter".to_string(),
            "  v       Toggle selected worktree diff or selected-file patch in output pane"
                .to_string(),
            "  z       Toggle selected worktree git status in output pane".to_string(),
            "  V       Toggle diff view mode between split and unified".to_string(),
            "  {/}     Jump to previous/next diff hunk in the active diff view".to_string(),
            "  S/U/R   Stage, unstage, or reset the selected file or active diff hunk".to_string(),
            "  C       Commit staged changes for the selected worktree".to_string(),
            "  P       Create a draft PR; supports title | base=branch | labels=a,b | reviewers=a,b".to_string(),
            "  c       Show conflict-resolution protocol for selected conflicted worktree"
                .to_string(),
            "  e       Cycle output content filter: all/errors/tool calls/file changes".to_string(),
            "  f       Cycle output or timeline time range between all/15m/1h/24h".to_string(),
            "  A       Toggle search, graph, or timeline scope between selected session and all sessions"
                .to_string(),
            "  o       Toggle search agent filter between all agents and selected agent type"
                .to_string(),
            "  m       Merge selected ready worktree into base and clean it up".to_string(),
            "  M       Merge all ready inactive worktrees and clean them up".to_string(),
            "  l       Cycle pane layout and persist it".to_string(),
            "  T       Toggle theme and persist it".to_string(),
            "  t       Toggle default worktree creation for new sessions and delegated work"
                .to_string(),
            "  p       Toggle daemon auto-dispatch policy and persist config".to_string(),
            "  w       Toggle daemon auto-merge for ready inactive worktrees".to_string(),
            "  ,/.     Decrease/increase auto-dispatch limit per lead".to_string(),
            "  s       Stop selected session".to_string(),
            "  u       Resume selected session".to_string(),
            "  x       Cleanup selected worktree".to_string(),
            "  X       Prune inactive worktrees globally".to_string(),
            "  d       Delete selected inactive session".to_string(),
            format!(
                "  {:<7} Focus Sessions/Output/Metrics/Log directly",
                self.pane_focus_shortcuts_label()
            ),
            "  Ctrl+w  Pane command mode: h/j/k/l move, s/v/g layout, 1-4 focus, +/- resize"
                .to_string(),
            "  Tab     Next pane".to_string(),
            "  S-Tab   Previous pane".to_string(),
            format!(
                "  {:<7} Move pane focus left/down/up/right",
                self.pane_move_shortcuts_label()
            ),
            "  j/↓     Scroll down".to_string(),
            "  k/↑     Scroll up".to_string(),
            "  [ or ]  Focus previous/next delegate in lead Metrics board".to_string(),
            "  Enter   Open focused delegate from lead Metrics board".to_string(),
            "  /       Search session output or graph lines".to_string(),
            "  n/N     Next/previous search match when search is active".to_string(),
            "  Esc     Clear active search or cancel search input".to_string(),
            "  +/=     Increase pane size and persist it".to_string(),
            "  -       Decrease pane size and persist it".to_string(),
            "  r       Refresh".to_string(),
            "  ?       Toggle help".to_string(),
            "  q/C-c   Quit".to_string(),
        ];

        let paragraph = Paragraph::new(help.join("\n")).block(
            Block::default()
                .borders(Borders::ALL)
                .title(" Help ")
                .border_style(Style::default().fg(self.theme_palette().help_border)),
        );
        frame.render_widget(paragraph, area);
    }

    pub fn next_pane(&mut self) {
        let visible_panes = self.visible_panes();
        let next_index = self
            .selected_pane_index()
            .checked_add(1)
            .map(|index| index % visible_panes.len())
            .unwrap_or(0);

        self.selected_pane = visible_panes[next_index];
    }

    pub fn prev_pane(&mut self) {
        let visible_panes = self.visible_panes();
        let previous_index = if self.selected_pane_index() == 0 {
            visible_panes.len() - 1
        } else {
            self.selected_pane_index() - 1
        };

        self.selected_pane = visible_panes[previous_index];
    }

    pub fn focus_pane_number(&mut self, slot: usize) {
        let Some(target) = Pane::from_shortcut(slot) else {
            self.set_operator_note(format!("pane {slot} is not available"));
            return;
        };

        if !self.is_pane_visible(target) {
            self.set_operator_note(format!(
                "{} pane is not visible",
                target.title().to_lowercase()
            ));
            return;
        }

        self.focus_pane(target);
    }

    pub fn focus_pane_left(&mut self) {
        self.move_pane_focus(PaneDirection::Left);
    }

    pub fn focus_pane_right(&mut self) {
        self.move_pane_focus(PaneDirection::Right);
    }

    pub fn focus_pane_up(&mut self) {
        self.move_pane_focus(PaneDirection::Up);
    }

    pub fn focus_pane_down(&mut self) {
        self.move_pane_focus(PaneDirection::Down);
    }

    pub fn begin_pane_command_mode(&mut self) {
        self.pane_command_mode = true;
        self.set_operator_note(
            "pane command mode | h/j/k/l move | s/v/g layout | 1-4 focus | +/- resize".to_string(),
        );
    }

    pub fn is_pane_command_mode(&self) -> bool {
        self.pane_command_mode
    }

    pub fn handle_pane_navigation_key(&mut self, key: KeyEvent) -> bool {
        match self.cfg.pane_navigation.action_for_key(key) {
            Some(PaneNavigationAction::FocusSlot(slot)) => {
                self.focus_pane_number(slot);
                true
            }
            Some(PaneNavigationAction::MoveLeft) => {
                self.focus_pane_left();
                true
            }
            Some(PaneNavigationAction::MoveDown) => {
                self.focus_pane_down();
                true
            }
            Some(PaneNavigationAction::MoveUp) => {
                self.focus_pane_up();
                true
            }
            Some(PaneNavigationAction::MoveRight) => {
                self.focus_pane_right();
                true
            }
            None => false,
        }
    }

    pub fn handle_pane_command_key(&mut self, key: KeyEvent) -> bool {
        if !self.pane_command_mode {
            return false;
        }

        self.pane_command_mode = false;
        match key.code {
            crossterm::event::KeyCode::Esc => {
                self.set_operator_note("pane command cancelled".to_string());
            }
            crossterm::event::KeyCode::Char('h') => self.focus_pane_left(),
            crossterm::event::KeyCode::Char('j') => self.focus_pane_down(),
            crossterm::event::KeyCode::Char('k') => self.focus_pane_up(),
            crossterm::event::KeyCode::Char('l') => self.focus_pane_right(),
            crossterm::event::KeyCode::Char('1') => self.focus_pane_number(1),
            crossterm::event::KeyCode::Char('2') => self.focus_pane_number(2),
            crossterm::event::KeyCode::Char('3') => self.focus_pane_number(3),
            crossterm::event::KeyCode::Char('4') => self.focus_pane_number(4),
            crossterm::event::KeyCode::Char('5') => self.focus_pane_number(5),
            crossterm::event::KeyCode::Char('+') | crossterm::event::KeyCode::Char('=') => {
                self.increase_pane_size()
            }
            crossterm::event::KeyCode::Char('-') => self.decrease_pane_size(),
            crossterm::event::KeyCode::Char('s') => self.set_pane_layout(PaneLayout::Horizontal),
            crossterm::event::KeyCode::Char('v') => self.set_pane_layout(PaneLayout::Vertical),
            crossterm::event::KeyCode::Char('g') => self.set_pane_layout(PaneLayout::Grid),
            _ => self.set_operator_note("unknown pane command".to_string()),
        }
        true
    }

    pub fn collapse_selected_pane(&mut self) {
        if self.selected_pane == Pane::Sessions {
            self.set_operator_note("cannot collapse sessions pane".to_string());
            return;
        }

        if self.visible_detail_panes().len() <= 1 {
            self.set_operator_note("cannot collapse last detail pane".to_string());
            return;
        }

        let collapsed = self.selected_pane;
        self.collapsed_panes.insert(collapsed);
        self.ensure_selected_pane_visible();
        self.set_operator_note(format!(
            "collapsed {} pane",
            collapsed.title().to_lowercase()
        ));
    }

    pub fn restore_collapsed_panes(&mut self) {
        if self.collapsed_panes.is_empty() {
            self.set_operator_note("no collapsed panes".to_string());
            return;
        }

        let restored_count = self.collapsed_panes.len();
        self.collapsed_panes.clear();
        self.ensure_selected_pane_visible();
        self.set_operator_note(format!("restored {restored_count} collapsed pane(s)"));
    }

    pub fn cycle_pane_layout(&mut self) {
        let config_path = crate::config::Config::config_path();
        self.cycle_pane_layout_with_save(&config_path, |cfg| cfg.save());
    }

    pub fn set_pane_layout(&mut self, layout: PaneLayout) {
        let config_path = crate::config::Config::config_path();
        self.set_pane_layout_with_save(layout, &config_path, |cfg| cfg.save());
    }

    fn cycle_pane_layout_with_save<F>(&mut self, config_path: &std::path::Path, save: F)
    where
        F: FnOnce(&Config) -> anyhow::Result<()>,
    {
        let previous_layout = self.cfg.pane_layout;
        let previous_pane_size = self.pane_size_percent;
        let previous_selected_pane = self.selected_pane;

        self.cfg.pane_layout = match self.cfg.pane_layout {
            PaneLayout::Horizontal => PaneLayout::Vertical,
            PaneLayout::Vertical => PaneLayout::Grid,
            PaneLayout::Grid => PaneLayout::Horizontal,
        };
        self.pane_size_percent = configured_pane_size(&self.cfg, self.cfg.pane_layout);
        self.persist_current_pane_size();
        self.ensure_selected_pane_visible();

        match save(&self.cfg) {
            Ok(()) => self.set_operator_note(format!(
                "pane layout set to {} | saved to {}",
                self.layout_label(),
                config_path.display()
            )),
            Err(error) => {
                self.cfg.pane_layout = previous_layout;
                self.pane_size_percent = previous_pane_size;
                self.selected_pane = previous_selected_pane;
                self.set_operator_note(format!("failed to persist pane layout: {error}"));
            }
        }
    }

    fn set_pane_layout_with_save<F>(
        &mut self,
        layout: PaneLayout,
        config_path: &std::path::Path,
        save: F,
    ) where
        F: FnOnce(&Config) -> anyhow::Result<()>,
    {
        if self.cfg.pane_layout == layout {
            self.set_operator_note(format!("pane layout already {}", self.layout_label()));
            return;
        }

        let previous_layout = self.cfg.pane_layout;
        let previous_pane_size = self.pane_size_percent;
        let previous_selected_pane = self.selected_pane;

        self.cfg.pane_layout = layout;
        self.pane_size_percent = configured_pane_size(&self.cfg, self.cfg.pane_layout);
        self.persist_current_pane_size();
        self.ensure_selected_pane_visible();

        match save(&self.cfg) {
            Ok(()) => self.set_operator_note(format!(
                "pane layout set to {} | saved to {}",
                self.layout_label(),
                config_path.display()
            )),
            Err(error) => {
                self.cfg.pane_layout = previous_layout;
                self.pane_size_percent = previous_pane_size;
                self.selected_pane = previous_selected_pane;
                self.set_operator_note(format!("failed to persist pane layout: {error}"));
            }
        }
    }

    fn auto_split_layout_after_spawn(&mut self, spawned_count: usize) -> Option<String> {
        let config_path = crate::config::Config::config_path();
        self.auto_split_layout_after_spawn_with_save(spawned_count, &config_path, |cfg| cfg.save())
    }

    fn auto_split_layout_after_spawn_with_save<F>(
        &mut self,
        spawned_count: usize,
        config_path: &std::path::Path,
        save: F,
    ) -> Option<String>
    where
        F: FnOnce(&Config) -> anyhow::Result<()>,
    {
        if spawned_count <= 1 {
            return None;
        }

        let live_session_count = self.active_session_count();
        let target_layout = recommended_spawn_layout(live_session_count);
        if self.cfg.pane_layout == target_layout {
            self.selected_pane = Pane::Sessions;
            self.ensure_selected_pane_visible();
            return Some(format!(
                "auto-focused sessions in {} layout for {} live session(s)",
                pane_layout_name(target_layout),
                live_session_count
            ));
        }

        let previous_layout = self.cfg.pane_layout;
        let previous_pane_size = self.pane_size_percent;
        let previous_selected_pane = self.selected_pane;

        self.cfg.pane_layout = target_layout;
        self.pane_size_percent = configured_pane_size(&self.cfg, target_layout);
        self.persist_current_pane_size();
        self.selected_pane = Pane::Sessions;
        self.ensure_selected_pane_visible();

        match save(&self.cfg) {
            Ok(()) => Some(format!(
                "auto-split {} layout for {} live session(s)",
                pane_layout_name(target_layout),
                live_session_count
            )),
            Err(error) => {
                self.cfg.pane_layout = previous_layout;
                self.pane_size_percent = previous_pane_size;
                self.selected_pane = previous_selected_pane;
                Some(format!(
                    "spawned {} session(s) but failed to persist auto-split layout to {}: {error}",
                    spawned_count,
                    config_path.display()
                ))
            }
        }
    }

    fn adjust_pane_size_with_save<F>(
        &mut self,
        delta: isize,
        config_path: &std::path::Path,
        save: F,
    ) where
        F: FnOnce(&Config) -> anyhow::Result<()>,
    {
        let previous_size = self.pane_size_percent;
        let previous_linear = self.cfg.linear_pane_size_percent;
        let previous_grid = self.cfg.grid_pane_size_percent;
        let next = (self.pane_size_percent as isize + delta).clamp(
            MIN_PANE_SIZE_PERCENT as isize,
            MAX_PANE_SIZE_PERCENT as isize,
        ) as u16;

        if next == self.pane_size_percent {
            self.set_operator_note(format!(
                "pane size unchanged at {}% for {} layout",
                self.pane_size_percent,
                self.layout_label()
            ));
            return;
        }

        self.pane_size_percent = next;
        self.persist_current_pane_size();

        match save(&self.cfg) {
            Ok(()) => self.set_operator_note(format!(
                "pane size set to {}% for {} layout | saved to {}",
                self.pane_size_percent,
                self.layout_label(),
                config_path.display()
            )),
            Err(error) => {
                self.pane_size_percent = previous_size;
                self.cfg.linear_pane_size_percent = previous_linear;
                self.cfg.grid_pane_size_percent = previous_grid;
                self.set_operator_note(format!("failed to persist pane size: {error}"));
            }
        }
    }

    fn persist_current_pane_size(&mut self) {
        match self.cfg.pane_layout {
            PaneLayout::Horizontal | PaneLayout::Vertical => {
                self.cfg.linear_pane_size_percent = self.pane_size_percent;
            }
            PaneLayout::Grid => {
                self.cfg.grid_pane_size_percent = self.pane_size_percent;
            }
        }
    }

    pub fn toggle_theme(&mut self) {
        let config_path = crate::config::Config::config_path();
        self.toggle_theme_with_save(&config_path, |cfg| cfg.save());
    }

    fn toggle_theme_with_save<F>(&mut self, config_path: &std::path::Path, save: F)
    where
        F: FnOnce(&Config) -> anyhow::Result<()>,
    {
        let previous_theme = self.cfg.theme;
        self.cfg.theme = match self.cfg.theme {
            Theme::Dark => Theme::Light,
            Theme::Light => Theme::Dark,
        };

        match save(&self.cfg) {
            Ok(()) => self.set_operator_note(format!(
                "theme set to {} | saved to {}",
                self.theme_label(),
                config_path.display()
            )),
            Err(error) => {
                self.cfg.theme = previous_theme;
                self.set_operator_note(format!("failed to persist theme: {error}"));
            }
        }
    }

    pub fn increase_pane_size(&mut self) {
        let config_path = crate::config::Config::config_path();
        self.adjust_pane_size_with_save(PANE_RESIZE_STEP_PERCENT as isize, &config_path, |cfg| {
            cfg.save()
        });
    }

    pub fn decrease_pane_size(&mut self) {
        let config_path = crate::config::Config::config_path();
        self.adjust_pane_size_with_save(
            -(PANE_RESIZE_STEP_PERCENT as isize),
            &config_path,
            |cfg| cfg.save(),
        );
    }

    pub fn scroll_down(&mut self) {
        match self.selected_pane {
            Pane::Sessions if !self.sessions.is_empty() => {
                self.selected_session = (self.selected_session + 1).min(self.sessions.len() - 1);
                self.sync_selection();
                self.reset_output_view();
                self.reset_metrics_view();
                self.sync_selected_output();
                self.sync_selected_diff();
                self.sync_selected_messages();
                self.sync_selected_lineage();
                self.refresh_logs();
            }
            Pane::Output => {
                if self.output_mode == OutputMode::GitStatus {
                    self.output_follow = false;
                    if self.selected_git_status + 1 < self.selected_git_status_entries.len() {
                        self.selected_git_status += 1;
                        self.sync_output_scroll(self.last_output_height.max(1));
                    }
                    return;
                }
                let max_scroll = self.max_output_scroll();
                if self.output_follow {
                    return;
                }

                if self.output_scroll_offset >= max_scroll.saturating_sub(1) {
                    self.output_follow = true;
                    self.output_scroll_offset = max_scroll;
                } else {
                    self.output_scroll_offset = self.output_scroll_offset.saturating_add(1);
                }
            }
            Pane::Metrics | Pane::Board => {
                let max_scroll = self.max_metrics_scroll();
                self.metrics_scroll_offset =
                    self.metrics_scroll_offset.saturating_add(1).min(max_scroll);
            }
            Pane::Log => {
                self.output_follow = false;
                self.output_scroll_offset = self.output_scroll_offset.saturating_add(1);
            }
            Pane::Sessions => {}
        }
    }

    pub fn scroll_up(&mut self) {
        match self.selected_pane {
            Pane::Sessions => {
                self.selected_session = self.selected_session.saturating_sub(1);
                self.sync_selection();
                self.reset_output_view();
                self.reset_metrics_view();
                self.sync_selected_output();
                self.sync_selected_diff();
                self.sync_selected_messages();
                self.sync_selected_lineage();
                self.refresh_logs();
            }
            Pane::Output => {
                if self.output_mode == OutputMode::GitStatus {
                    self.output_follow = false;
                    self.selected_git_status = self.selected_git_status.saturating_sub(1);
                    self.sync_output_scroll(self.last_output_height.max(1));
                    return;
                }
                if self.output_follow {
                    self.output_follow = false;
                    self.output_scroll_offset = self.max_output_scroll();
                }

                self.output_scroll_offset = self.output_scroll_offset.saturating_sub(1);
            }
            Pane::Metrics | Pane::Board => {
                self.metrics_scroll_offset = self.metrics_scroll_offset.saturating_sub(1);
            }
            Pane::Log => {
                self.output_follow = false;
                self.output_scroll_offset = self.output_scroll_offset.saturating_sub(1);
            }
        }
    }

    pub fn focus_next_delegate(&mut self) {
        let Some(current_index) = self.focused_delegate_index() else {
            return;
        };
        let next_index = (current_index + 1) % self.selected_child_sessions.len();
        self.set_focused_delegate_by_index(next_index);
    }

    pub fn focus_previous_delegate(&mut self) {
        let Some(current_index) = self.focused_delegate_index() else {
            return;
        };
        let previous_index = if current_index == 0 {
            self.selected_child_sessions.len() - 1
        } else {
            current_index - 1
        };
        self.set_focused_delegate_by_index(previous_index);
    }

    pub fn open_focused_delegate(&mut self) {
        let Some(delegate_session_id) = self
            .focused_delegate_index()
            .and_then(|index| self.selected_child_sessions.get(index))
            .map(|delegate| delegate.session_id.clone())
        else {
            return;
        };

        self.sync_selection_by_id(Some(&delegate_session_id));
        self.reset_output_view();
        self.reset_metrics_view();
        self.sync_selected_output();
        self.sync_selected_diff();
        self.sync_selected_messages();
        self.sync_selected_lineage();
        self.refresh_logs();
        self.set_operator_note(format!(
            "opened delegate {}",
            format_session_id(&delegate_session_id)
        ));
    }

    pub fn focus_next_approval_target(&mut self) {
        self.sync_approval_queue();
        let Some(target_session_id) = self.next_approval_target_session_id() else {
            self.set_operator_note("approval queue clear".to_string());
            return;
        };

        self.sync_selection_by_id(Some(&target_session_id));
        self.reset_output_view();
        self.reset_metrics_view();
        self.sync_selected_output();
        self.sync_selected_diff();
        self.unread_message_counts = self.db.unread_message_counts().unwrap_or_default();
        self.sync_selected_messages();
        self.sync_selected_lineage();
        self.refresh_logs();
        self.set_operator_note(format!(
            "focused approval target {}",
            format_session_id(&target_session_id)
        ));
    }

    pub async fn new_session(&mut self) {
        if self.active_session_count() >= self.cfg.max_parallel_sessions {
            tracing::warn!(
                "Cannot queue new session: active session limit reached ({})",
                self.cfg.max_parallel_sessions
            );
            self.set_operator_note(format!(
                "cannot queue new session: active session limit reached ({})",
                self.cfg.max_parallel_sessions
            ));
            return;
        }

        let task = self.new_session_task();
        let agent = self.cfg.default_agent.clone();
        let grouping = self
            .sessions
            .get(self.selected_session)
            .map(|session| SessionGrouping {
                project: Some(session.project.clone()),
                task_group: Some(session.task_group.clone()),
            })
            .unwrap_or_default();

        let session_id = match manager::create_session_with_grouping(
            &self.db,
            &self.cfg,
            &task,
            &agent,
            self.cfg.auto_create_worktrees,
            grouping,
        )
        .await
        {
            Ok(session_id) => session_id,
            Err(error) => {
                tracing::warn!("Failed to create new session from dashboard: {error}");
                self.set_operator_note(format!("new session failed: {error}"));
                return;
            }
        };

        if let Some(source_session) = self.sessions.get(self.selected_session) {
            let context = format!(
                "Dashboard handoff from {} [{}] | cwd {}{}",
                format_session_id(&source_session.id),
                source_session.agent_type,
                source_session.working_dir.display(),
                source_session
                    .worktree
                    .as_ref()
                    .map(|worktree| format!(
                        " | worktree {} ({})",
                        worktree.branch,
                        worktree.path.display()
                    ))
                    .unwrap_or_default()
            );
            if let Err(error) = comms::send(
                &self.db,
                &source_session.id,
                &session_id,
                &comms::MessageType::TaskHandoff {
                    task: source_session.task.clone(),
                    context,
                    priority: comms::TaskPriority::Normal,
                },
            ) {
                tracing::warn!(
                    "Failed to send handoff from session {} to {}: {error}",
                    source_session.id,
                    session_id
                );
            }
        }

        self.refresh();
        self.sync_selection_by_id(Some(&session_id));
        let queued_for_worktree = self
            .db
            .pending_worktree_queue_contains(&session_id)
            .unwrap_or(false);
        if queued_for_worktree {
            self.set_operator_note(format!(
                "queued session {} pending worktree slot",
                format_session_id(&session_id)
            ));
        } else {
            self.set_operator_note(format!(
                "spawned session {}",
                format_session_id(&session_id)
            ));
        }
        self.reset_output_view();
        self.sync_selected_output();
        self.sync_selected_diff();
        self.sync_selected_messages();
        self.sync_selected_lineage();
        self.refresh_logs();
        self.sync_budget_alerts();
    }

    pub fn toggle_output_mode(&mut self) {
        match self.output_mode {
            OutputMode::SessionOutput => {
                if self.selected_diff_patch.is_some() || self.selected_diff_summary.is_some() {
                    self.output_mode = OutputMode::WorktreeDiff;
                    self.selected_pane = Pane::Output;
                    self.output_follow = false;
                    self.output_scroll_offset = self.current_diff_hunk_offset();
                    self.set_operator_note("showing selected worktree diff".to_string());
                } else {
                    self.set_operator_note("no worktree diff for selected session".to_string());
                }
            }
            OutputMode::WorktreeDiff => {
                self.output_mode = OutputMode::SessionOutput;
                self.reset_output_view();
                self.set_operator_note("showing session output".to_string());
            }
            OutputMode::Timeline => {
                self.output_mode = OutputMode::SessionOutput;
                self.reset_output_view();
                self.set_operator_note("showing session output".to_string());
            }
            OutputMode::ContextGraph => {
                self.output_mode = OutputMode::SessionOutput;
                self.reset_output_view();
                self.set_operator_note("showing session output".to_string());
            }
            OutputMode::ConflictProtocol => {
                self.output_mode = OutputMode::SessionOutput;
                self.reset_output_view();
                self.set_operator_note("showing session output".to_string());
            }
            OutputMode::GitStatus => {
                self.sync_selected_git_patch();
                if self.selected_git_patch.is_some() {
                    self.output_mode = OutputMode::GitPatch;
                    self.selected_pane = Pane::Output;
                    self.output_follow = false;
                    self.output_scroll_offset = self.current_diff_hunk_offset();
                    self.set_operator_note("showing selected file patch".to_string());
                } else {
                    self.set_operator_note(
                        "no patch hunks available for the selected git-status entry".to_string(),
                    );
                }
            }
            OutputMode::GitPatch => {
                self.output_mode = OutputMode::GitStatus;
                self.output_follow = false;
                self.sync_output_scroll(self.last_output_height.max(1));
                self.set_operator_note("showing selected worktree git status".to_string());
            }
        }
    }

    pub fn toggle_git_status_mode(&mut self) {
        match self.output_mode {
            OutputMode::GitStatus | OutputMode::GitPatch => {
                self.output_mode = OutputMode::SessionOutput;
                self.reset_output_view();
                self.set_operator_note("showing session output".to_string());
            }
            _ => {
                let has_worktree = self
                    .sessions
                    .get(self.selected_session)
                    .and_then(|session| session.worktree.as_ref())
                    .is_some();
                if !has_worktree {
                    self.set_operator_note("selected session has no worktree".to_string());
                    return;
                }

                self.sync_selected_git_status();
                self.output_mode = OutputMode::GitStatus;
                self.selected_pane = Pane::Output;
                self.output_follow = false;
                self.sync_output_scroll(self.last_output_height.max(1));
                self.set_operator_note("showing selected worktree git status".to_string());
            }
        }
    }

    pub fn stage_selected_git_status(&mut self) {
        if self.output_mode == OutputMode::GitPatch {
            self.stage_selected_git_hunk();
            return;
        }

        if self.output_mode != OutputMode::GitStatus {
            self.set_operator_note(
                "git staging controls are only available in git status view".to_string(),
            );
            return;
        }

        let Some((entry, worktree)) = self.selected_git_status_context() else {
            self.set_operator_note("no git status entry selected".to_string());
            return;
        };

        if let Err(error) = worktree::stage_path(&worktree, &entry.path) {
            tracing::warn!("Failed to stage {}: {error}", entry.path);
            self.set_operator_note(format!("stage failed for {}: {error}", entry.display_path));
            return;
        }

        self.refresh_after_git_status_action(Some(&entry.path));
        self.set_operator_note(format!("staged {}", entry.display_path));
    }

    pub fn unstage_selected_git_status(&mut self) {
        if self.output_mode == OutputMode::GitPatch {
            self.unstage_selected_git_hunk();
            return;
        }

        if self.output_mode != OutputMode::GitStatus {
            self.set_operator_note(
                "git staging controls are only available in git status view".to_string(),
            );
            return;
        }

        let Some((entry, worktree)) = self.selected_git_status_context() else {
            self.set_operator_note("no git status entry selected".to_string());
            return;
        };

        if let Err(error) = worktree::unstage_path(&worktree, &entry.path) {
            tracing::warn!("Failed to unstage {}: {error}", entry.path);
            self.set_operator_note(format!(
                "unstage failed for {}: {error}",
                entry.display_path
            ));
            return;
        }

        self.refresh_after_git_status_action(Some(&entry.path));
        self.set_operator_note(format!("unstaged {}", entry.display_path));
    }

    pub fn reset_selected_git_status(&mut self) {
        if self.output_mode == OutputMode::GitPatch {
            self.reset_selected_git_hunk();
            return;
        }

        if self.output_mode != OutputMode::GitStatus {
            self.set_operator_note(
                "git staging controls are only available in git status view".to_string(),
            );
            return;
        }

        let Some((entry, worktree)) = self.selected_git_status_context() else {
            self.set_operator_note("no git status entry selected".to_string());
            return;
        };

        if let Err(error) = worktree::reset_path(&worktree, &entry) {
            tracing::warn!("Failed to reset {}: {error}", entry.path);
            self.set_operator_note(format!("reset failed for {}: {error}", entry.display_path));
            return;
        }

        self.refresh_after_git_status_action(Some(&entry.path));
        self.set_operator_note(format!("reset {}", entry.display_path));
    }

    pub fn begin_commit_prompt(&mut self) {
        if !matches!(
            self.output_mode,
            OutputMode::GitStatus | OutputMode::GitPatch
        ) {
            self.set_operator_note(
                "commit prompt is only available in git status view".to_string(),
            );
            return;
        }

        if self
            .sessions
            .get(self.selected_session)
            .and_then(|session| session.worktree.as_ref())
            .is_none()
        {
            self.set_operator_note("selected session has no worktree".to_string());
            return;
        }

        if !self
            .selected_git_status_entries
            .iter()
            .any(|entry| entry.staged)
        {
            self.set_operator_note("no staged changes to commit".to_string());
            return;
        }

        self.commit_input = Some(String::new());
        self.set_operator_note("commit mode | type a message and press Enter".to_string());
    }

    pub fn begin_pr_prompt(&mut self) {
        let Some(session) = self.sessions.get(self.selected_session) else {
            self.set_operator_note("no session selected".to_string());
            return;
        };
        let Some(worktree) = session.worktree.as_ref() else {
            self.set_operator_note("selected session has no worktree".to_string());
            return;
        };
        if worktree::has_uncommitted_changes(worktree).unwrap_or(false) {
            self.set_operator_note(
                "commit or reset worktree changes before creating a PR".to_string(),
            );
            return;
        }

        let seed = worktree::latest_commit_subject(worktree)
            .ok()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| session.task.clone());
        self.pr_input = Some(seed);
        self.set_operator_note(
            "pr mode | title | base=branch | labels=a,b | reviewers=a,b".to_string(),
        );
    }

    fn stage_selected_git_hunk(&mut self) {
        let Some((entry, worktree, _, hunk)) = self.selected_git_patch_context() else {
            self.set_operator_note("no git hunk selected".to_string());
            return;
        };

        if let Err(error) = worktree::stage_hunk(&worktree, &hunk) {
            tracing::warn!("Failed to stage hunk for {}: {error}", entry.path);
            self.set_operator_note(format!(
                "stage hunk failed for {}: {error}",
                entry.display_path
            ));
            return;
        }

        self.refresh_after_git_status_action(Some(&entry.path));
        self.set_operator_note(format!("staged hunk in {}", entry.display_path));
    }

    fn unstage_selected_git_hunk(&mut self) {
        let Some((entry, worktree, _, hunk)) = self.selected_git_patch_context() else {
            self.set_operator_note("no git hunk selected".to_string());
            return;
        };

        if let Err(error) = worktree::unstage_hunk(&worktree, &hunk) {
            tracing::warn!("Failed to unstage hunk for {}: {error}", entry.path);
            self.set_operator_note(format!(
                "unstage hunk failed for {}: {error}",
                entry.display_path
            ));
            return;
        }

        self.refresh_after_git_status_action(Some(&entry.path));
        self.set_operator_note(format!("unstaged hunk in {}", entry.display_path));
    }

    fn reset_selected_git_hunk(&mut self) {
        let Some((entry, worktree, _, hunk)) = self.selected_git_patch_context() else {
            self.set_operator_note("no git hunk selected".to_string());
            return;
        };

        if let Err(error) = worktree::reset_hunk(&worktree, &entry, &hunk) {
            tracing::warn!("Failed to reset hunk for {}: {error}", entry.path);
            self.set_operator_note(format!(
                "reset hunk failed for {}: {error}",
                entry.display_path
            ));
            return;
        }

        self.refresh_after_git_status_action(Some(&entry.path));
        self.set_operator_note(format!("reset hunk in {}", entry.display_path));
    }

    pub fn toggle_diff_view_mode(&mut self) {
        if !matches!(
            self.output_mode,
            OutputMode::WorktreeDiff | OutputMode::GitPatch
        ) || self.active_patch_text().is_none()
        {
            self.set_operator_note("no active worktree diff view to toggle".to_string());
            return;
        }

        self.diff_view_mode = match self.diff_view_mode {
            DiffViewMode::Split => DiffViewMode::Unified,
            DiffViewMode::Unified => DiffViewMode::Split,
        };
        self.output_follow = false;
        self.output_scroll_offset = self.current_diff_hunk_offset();
        self.set_operator_note(format!("diff view set to {}", self.diff_view_mode.label()));
    }

    pub fn next_diff_hunk(&mut self) {
        self.move_diff_hunk(1);
    }

    pub fn prev_diff_hunk(&mut self) {
        self.move_diff_hunk(-1);
    }

    fn move_diff_hunk(&mut self, delta: isize) {
        if !matches!(
            self.output_mode,
            OutputMode::WorktreeDiff | OutputMode::GitPatch
        ) || self.active_patch_text().is_none()
        {
            self.set_operator_note("no active worktree diff to navigate".to_string());
            return;
        }

        let (len, next_offset) = {
            let offsets = self.current_diff_hunk_offsets();
            if offsets.is_empty() {
                self.set_operator_note("no diff hunks in bounded preview".to_string());
                return;
            }

            let len = offsets.len();
            let next =
                (self.current_diff_hunk_index() as isize + delta).rem_euclid(len as isize) as usize;
            (len, offsets[next])
        };

        let next =
            (self.current_diff_hunk_index() as isize + delta).rem_euclid(len as isize) as usize;
        self.set_current_diff_hunk_index(next);
        self.output_follow = false;
        self.output_scroll_offset = next_offset;
        self.set_operator_note(format!("diff hunk {}/{}", next + 1, len));
    }

    pub fn toggle_timeline_mode(&mut self) {
        match self.output_mode {
            OutputMode::Timeline => {
                self.output_mode = OutputMode::SessionOutput;
                self.reset_output_view();
                self.set_operator_note("showing session output".to_string());
            }
            _ => {
                if self.sessions.get(self.selected_session).is_some() {
                    self.output_mode = OutputMode::Timeline;
                    self.selected_pane = Pane::Output;
                    self.output_follow = false;
                    self.output_scroll_offset = 0;
                    self.set_operator_note("showing selected session timeline".to_string());
                } else {
                    self.set_operator_note("no session selected for timeline view".to_string());
                }
            }
        }
    }

    pub fn toggle_conflict_protocol_mode(&mut self) {
        match self.output_mode {
            OutputMode::ConflictProtocol => {
                self.output_mode = OutputMode::SessionOutput;
                self.reset_output_view();
                self.set_operator_note("showing session output".to_string());
            }
            _ => {
                if self.selected_conflict_protocol.is_some() {
                    self.output_mode = OutputMode::ConflictProtocol;
                    self.selected_pane = Pane::Output;
                    self.output_follow = false;
                    self.output_scroll_offset = 0;
                    self.set_operator_note("showing worktree conflict protocol".to_string());
                } else {
                    self.set_operator_note(
                        "no conflicted worktree for selected session".to_string(),
                    );
                }
            }
        }
    }

    pub async fn assign_selected(&mut self) {
        let Some(source_session) = self.sessions.get(self.selected_session) else {
            return;
        };

        let task = self.new_session_task();
        let agent = self.cfg.default_agent.clone();

        let outcome = match manager::assign_session(
            &self.db,
            &self.cfg,
            &source_session.id,
            &task,
            &agent,
            self.cfg.auto_create_worktrees,
        )
        .await
        {
            Ok(outcome) => outcome,
            Err(error) => {
                tracing::warn!(
                    "Failed to assign follow-up work from session {}: {error}",
                    source_session.id
                );
                self.set_operator_note(format!("assignment failed: {error}"));
                return;
            }
        };

        self.refresh();
        self.sync_selection_by_id(Some(&outcome.session_id));
        self.set_operator_note(format!(
            "assigned via {} -> {}",
            assignment_action_label(outcome.action),
            format_session_id(&outcome.session_id)
        ));
        self.reset_output_view();
        self.sync_selected_output();
        self.sync_selected_diff();
        self.sync_selected_messages();
        self.sync_selected_lineage();
        self.refresh_logs();
    }

    pub async fn rebalance_selected_team(&mut self) {
        let Some(source_session) = self.sessions.get(self.selected_session) else {
            return;
        };

        let agent = self.cfg.default_agent.clone();
        let source_session_id = source_session.id.clone();
        let outcomes = match manager::rebalance_team_backlog(
            &self.db,
            &self.cfg,
            &source_session_id,
            &agent,
            self.cfg.auto_create_worktrees,
            self.cfg.auto_dispatch_limit_per_session,
        )
        .await
        {
            Ok(outcomes) => outcomes,
            Err(error) => {
                tracing::warn!(
                    "Failed to rebalance team backlog for session {}: {error}",
                    source_session_id
                );
                self.set_operator_note(format!(
                    "rebalance failed for {}: {error}",
                    format_session_id(&source_session_id)
                ));
                return;
            }
        };

        self.refresh();
        self.sync_selection_by_id(Some(&source_session_id));
        self.sync_selected_output();
        self.sync_selected_diff();
        self.sync_selected_messages();
        self.sync_selected_lineage();
        self.refresh_logs();

        if outcomes.is_empty() {
            self.set_operator_note(format!(
                "no delegate backlog needed rebalancing for {}",
                format_session_id(&source_session_id)
            ));
        } else {
            self.set_operator_note(format!(
                "rebalanced {} delegate handoff(s) for {}",
                outcomes.len(),
                format_session_id(&source_session_id)
            ));
        }
    }

    pub async fn drain_inbox_selected(&mut self) {
        let Some(source_session) = self.sessions.get(self.selected_session) else {
            return;
        };

        let agent = self.cfg.default_agent.clone();
        let source_session_id = source_session.id.clone();

        let outcomes = match manager::drain_inbox(
            &self.db,
            &self.cfg,
            &source_session_id,
            &agent,
            self.cfg.auto_create_worktrees,
            self.cfg.max_parallel_sessions,
        )
        .await
        {
            Ok(outcomes) => outcomes,
            Err(error) => {
                tracing::warn!(
                    "Failed to drain inbox for session {}: {error}",
                    source_session_id
                );
                self.set_operator_note(format!(
                    "drain inbox failed for {}: {error}",
                    format_session_id(&source_session_id)
                ));
                return;
            }
        };

        self.refresh();
        self.sync_selection_by_id(Some(&source_session_id));
        self.sync_selected_output();
        self.sync_selected_diff();
        self.sync_selected_messages();
        self.sync_selected_lineage();
        self.refresh_logs();

        if outcomes.is_empty() {
            self.set_operator_note(format!(
                "no unread handoffs for {}",
                format_session_id(&source_session_id)
            ));
        } else {
            self.set_operator_note(format!(
                "drained {} handoff(s) from {}",
                outcomes.len(),
                format_session_id(&source_session_id)
            ));
        }
    }

    pub async fn auto_dispatch_backlog(&mut self) {
        let agent = self.cfg.default_agent.clone();
        let lead_limit = self.sessions.len().max(1);

        let outcomes = match manager::auto_dispatch_backlog(
            &self.db,
            &self.cfg,
            &agent,
            self.cfg.auto_create_worktrees,
            lead_limit,
        )
        .await
        {
            Ok(outcomes) => outcomes,
            Err(error) => {
                tracing::warn!("Failed to auto-dispatch backlog from dashboard: {error}");
                self.set_operator_note(format!("global auto-dispatch failed: {error}"));
                return;
            }
        };

        let total_processed: usize = outcomes.iter().map(|outcome| outcome.routed.len()).sum();
        let total_routed: usize = outcomes
            .iter()
            .map(|outcome| {
                outcome
                    .routed
                    .iter()
                    .filter(|item| manager::assignment_action_routes_work(item.action))
                    .count()
            })
            .sum();
        let total_deferred = total_processed.saturating_sub(total_routed);
        let selected_session_id = self
            .sessions
            .get(self.selected_session)
            .map(|session| session.id.clone());

        self.refresh();
        self.sync_selection_by_id(selected_session_id.as_deref());
        self.sync_selected_output();
        self.sync_selected_diff();
        self.sync_selected_messages();
        self.sync_selected_lineage();
        self.refresh_logs();

        if total_processed == 0 {
            self.set_operator_note("no unread handoff backlog found".to_string());
        } else {
            self.set_operator_note(format!(
                "auto-dispatch processed {} handoff(s) across {} lead session(s) ({} routed, {} deferred)",
                total_processed,
                outcomes.len(),
                total_routed,
                total_deferred
            ));
        }
    }

    pub async fn rebalance_all_teams(&mut self) {
        let agent = self.cfg.default_agent.clone();
        let lead_limit = self.sessions.len().max(1);

        let outcomes = match manager::rebalance_all_teams(
            &self.db,
            &self.cfg,
            &agent,
            self.cfg.auto_create_worktrees,
            lead_limit,
        )
        .await
        {
            Ok(outcomes) => outcomes,
            Err(error) => {
                tracing::warn!("Failed to rebalance teams from dashboard: {error}");
                self.set_operator_note(format!("global rebalance failed: {error}"));
                return;
            }
        };

        let total_rerouted: usize = outcomes.iter().map(|outcome| outcome.rerouted.len()).sum();
        let selected_session_id = self
            .sessions
            .get(self.selected_session)
            .map(|session| session.id.clone());

        self.refresh();
        self.sync_selection_by_id(selected_session_id.as_deref());
        self.sync_selected_output();
        self.sync_selected_diff();
        self.sync_selected_messages();
        self.sync_selected_lineage();
        self.refresh_logs();

        if total_rerouted == 0 {
            self.set_operator_note("no delegate backlog needed global rebalancing".to_string());
        } else {
            self.set_operator_note(format!(
                "rebalanced {} handoff(s) across {} lead session(s)",
                total_rerouted,
                outcomes.len()
            ));
        }
    }

    pub async fn coordinate_backlog(&mut self) {
        let agent = self.cfg.default_agent.clone();
        let lead_limit = self.sessions.len().max(1);

        let outcome = match manager::coordinate_backlog(
            &self.db,
            &self.cfg,
            &agent,
            self.cfg.auto_create_worktrees,
            lead_limit,
        )
        .await
        {
            Ok(outcomes) => outcomes,
            Err(error) => {
                tracing::warn!("Failed to coordinate backlog from dashboard: {error}");
                self.set_operator_note(format!("global coordinate failed: {error}"));
                return;
            }
        };
        let total_processed: usize = outcome
            .dispatched
            .iter()
            .map(|dispatch| dispatch.routed.len())
            .sum();
        let total_routed: usize = outcome
            .dispatched
            .iter()
            .map(|dispatch| {
                dispatch
                    .routed
                    .iter()
                    .filter(|item| manager::assignment_action_routes_work(item.action))
                    .count()
            })
            .sum();
        let total_deferred = total_processed.saturating_sub(total_routed);
        let total_rerouted: usize = outcome
            .rebalanced
            .iter()
            .map(|rebalance| rebalance.rerouted.len())
            .sum();

        let selected_session_id = self
            .sessions
            .get(self.selected_session)
            .map(|session| session.id.clone());

        self.refresh();
        self.sync_selection_by_id(selected_session_id.as_deref());
        self.sync_selected_output();
        self.sync_selected_diff();
        self.sync_selected_messages();
        self.sync_selected_lineage();
        self.refresh_logs();

        if total_processed == 0 && total_rerouted == 0 && outcome.remaining_backlog_sessions == 0 {
            self.set_operator_note("backlog already clear".to_string());
        } else {
            self.set_operator_note(format!(
                "coordinated backlog: processed {} across {} lead(s) ({} routed, {} deferred), rebalanced {} across {} lead(s), remaining {} across {} session(s) [{} absorbable, {} saturated]",
                total_processed,
                outcome.dispatched.len(),
                total_routed,
                total_deferred,
                total_rerouted,
                outcome.rebalanced.len(),
                outcome.remaining_backlog_messages,
                outcome.remaining_backlog_sessions,
                outcome.remaining_absorbable_sessions,
                outcome.remaining_saturated_sessions
            ));
        }
    }

    pub async fn stop_selected(&mut self) {
        let Some(session) = self.sessions.get(self.selected_session) else {
            return;
        };

        let session_id = session.id.clone();
        if let Err(error) = manager::stop_session(&self.db, &session_id).await {
            tracing::warn!("Failed to stop session {}: {error}", session.id);
            self.set_operator_note(format!(
                "stop failed for {}: {error}",
                format_session_id(&session_id)
            ));
            return;
        }

        self.refresh();
        self.set_operator_note(format!(
            "stopped session {}",
            format_session_id(&session_id)
        ));
    }

    pub async fn resume_selected(&mut self) {
        let Some(session) = self.sessions.get(self.selected_session) else {
            return;
        };

        let session_id = session.id.clone();
        if let Err(error) = manager::resume_session(&self.db, &self.cfg, &session_id).await {
            tracing::warn!("Failed to resume session {}: {error}", session.id);
            self.set_operator_note(format!(
                "resume failed for {}: {error}",
                format_session_id(&session_id)
            ));
            return;
        }

        self.refresh();
        self.set_operator_note(format!(
            "resumed session {}",
            format_session_id(&session_id)
        ));
    }

    pub async fn cleanup_selected_worktree(&mut self) {
        let Some(session) = self.sessions.get(self.selected_session) else {
            return;
        };

        if session.worktree.is_none() {
            return;
        }

        let session_id = session.id.clone();
        if let Err(error) = manager::cleanup_session_worktree(&self.db, &session_id).await {
            tracing::warn!("Failed to cleanup session {} worktree: {error}", session.id);
            self.set_operator_note(format!(
                "cleanup failed for {}: {error}",
                format_session_id(&session_id)
            ));
            return;
        }

        self.refresh();
        self.set_operator_note(format!(
            "cleaned worktree for {}",
            format_session_id(&session_id)
        ));
    }

    pub async fn merge_selected_worktree(&mut self) {
        let Some(session) = self.sessions.get(self.selected_session) else {
            return;
        };

        if session.worktree.is_none() {
            self.set_operator_note("selected session has no worktree to merge".to_string());
            return;
        }

        let session_id = session.id.clone();
        let outcome = match manager::merge_session_worktree(&self.db, &session_id, true).await {
            Ok(outcome) => outcome,
            Err(error) => {
                tracing::warn!("Failed to merge session {} worktree: {error}", session.id);
                self.set_operator_note(format!(
                    "merge failed for {}: {error}",
                    format_session_id(&session_id)
                ));
                return;
            }
        };

        self.refresh();
        self.set_operator_note(format!(
            "merged {} into {} for {}{}",
            outcome.branch,
            outcome.base_branch,
            format_session_id(&session_id),
            if outcome.already_up_to_date {
                " (already up to date)"
            } else {
                ""
            }
        ));
    }

    pub async fn merge_ready_worktrees(&mut self) {
        match manager::merge_ready_worktrees(&self.db, true).await {
            Ok(outcome) => {
                self.refresh();
                if outcome.merged.is_empty()
                    && outcome.rebased.is_empty()
                    && outcome.active_with_worktree_ids.is_empty()
                    && outcome.conflicted_session_ids.is_empty()
                    && outcome.dirty_worktree_ids.is_empty()
                    && outcome.blocked_by_queue_session_ids.is_empty()
                    && outcome.failures.is_empty()
                {
                    self.set_operator_note("no ready worktrees to merge".to_string());
                    return;
                }

                let mut parts = vec![format!("merged {} ready worktree(s)", outcome.merged.len())];
                if !outcome.rebased.is_empty() {
                    parts.push(format!("rebased {}", outcome.rebased.len()));
                }
                if !outcome.active_with_worktree_ids.is_empty() {
                    parts.push(format!(
                        "skipped {} active",
                        outcome.active_with_worktree_ids.len()
                    ));
                }
                if !outcome.conflicted_session_ids.is_empty() {
                    parts.push(format!(
                        "skipped {} conflicted",
                        outcome.conflicted_session_ids.len()
                    ));
                }
                if !outcome.dirty_worktree_ids.is_empty() {
                    parts.push(format!(
                        "skipped {} dirty",
                        outcome.dirty_worktree_ids.len()
                    ));
                }
                if !outcome.blocked_by_queue_session_ids.is_empty() {
                    parts.push(format!(
                        "blocked {} in queue",
                        outcome.blocked_by_queue_session_ids.len()
                    ));
                }
                if !outcome.failures.is_empty() {
                    parts.push(format!("{} failed", outcome.failures.len()));
                }
                self.set_operator_note(parts.join("; "));
            }
            Err(error) => {
                tracing::warn!("Failed to merge ready worktrees: {error}");
                self.set_operator_note(format!("merge ready worktrees failed: {error}"));
            }
        }
    }

    pub async fn prune_inactive_worktrees(&mut self) {
        match manager::prune_inactive_worktrees(&self.db, &self.cfg).await {
            Ok(outcome) => {
                self.refresh();
                if outcome.cleaned_session_ids.is_empty() && outcome.retained_session_ids.is_empty()
                {
                    self.set_operator_note("no inactive worktrees to prune".to_string());
                } else if outcome.cleaned_session_ids.is_empty() {
                    self.set_operator_note(format!(
                        "deferred {} inactive worktree(s) within retention",
                        outcome.retained_session_ids.len()
                    ));
                } else if outcome.active_with_worktree_ids.is_empty() {
                    if outcome.retained_session_ids.is_empty() {
                        self.set_operator_note(format!(
                            "pruned {} inactive worktree(s)",
                            outcome.cleaned_session_ids.len()
                        ));
                    } else {
                        self.set_operator_note(format!(
                            "pruned {} inactive worktree(s); deferred {} within retention",
                            outcome.cleaned_session_ids.len(),
                            outcome.retained_session_ids.len()
                        ));
                    }
                } else {
                    let mut note = format!(
                        "pruned {} inactive worktree(s); skipped {} active session(s)",
                        outcome.cleaned_session_ids.len(),
                        outcome.active_with_worktree_ids.len()
                    );
                    if !outcome.retained_session_ids.is_empty() {
                        note.push_str(&format!(
                            "; deferred {} within retention",
                            outcome.retained_session_ids.len()
                        ));
                    }
                    self.set_operator_note(note);
                }
            }
            Err(error) => {
                tracing::warn!("Failed to prune inactive worktrees: {error}");
                self.set_operator_note(format!("prune inactive worktrees failed: {error}"));
            }
        }
    }

    pub async fn delete_selected_session(&mut self) {
        let Some(session) = self.sessions.get(self.selected_session) else {
            return;
        };

        let session_id = session.id.clone();
        if let Err(error) = manager::delete_session(&self.db, &session_id).await {
            tracing::warn!("Failed to delete session {}: {error}", session.id);
            self.set_operator_note(format!(
                "delete failed for {}: {error}",
                format_session_id(&session_id)
            ));
            return;
        }

        self.refresh();
        self.set_operator_note(format!(
            "deleted session {}",
            format_session_id(&session_id)
        ));
    }

    pub fn refresh(&mut self) {
        self.sync_from_store();
    }

    pub fn toggle_help(&mut self) {
        self.show_help = !self.show_help;
    }

    pub fn is_input_mode(&self) -> bool {
        self.spawn_input.is_some()
            || self.search_input.is_some()
            || self.commit_input.is_some()
            || self.pr_input.is_some()
    }

    pub fn has_active_search(&self) -> bool {
        self.search_query.is_some()
    }

    pub fn is_context_graph_mode(&self) -> bool {
        self.output_mode == OutputMode::ContextGraph
    }

    pub fn has_active_completion_popup(&self) -> bool {
        self.active_completion_popup.is_some()
    }

    pub fn dismiss_completion_popup(&mut self) {
        if self.active_completion_popup.take().is_some() {
            self.active_completion_popup = self.queued_completion_popups.pop_front();
        }
    }

    pub fn begin_spawn_prompt(&mut self) {
        if self.search_input.is_some() {
            self.set_operator_note(
                "finish output search input before opening spawn prompt".to_string(),
            );
            return;
        }

        self.spawn_input = Some(self.spawn_prompt_seed());
        self.set_operator_note(
            "spawn mode | try: give me 3 agents working on fix flaky tests | or: template feature_development for fix flaky tests".to_string(),
        );
    }

    pub fn toggle_search_scope(&mut self) {
        if self.output_mode == OutputMode::Timeline {
            self.timeline_scope = self.timeline_scope.next();
            self.sync_output_scroll(self.last_output_height.max(1));
            self.set_operator_note(format!(
                "timeline scope set to {}",
                self.timeline_scope.label()
            ));
            return;
        }

        if self.output_mode == OutputMode::ContextGraph {
            self.search_scope = self.search_scope.next();
            self.recompute_search_matches();
            self.sync_output_scroll(self.last_output_height.max(1));

            if self.search_query.is_some() {
                self.set_operator_note(format!(
                    "graph scope set to {} | {} match(es)",
                    self.search_scope.label(),
                    self.search_matches.len()
                ));
            } else {
                self.set_operator_note(format!("graph scope set to {}", self.search_scope.label()));
            }
            return;
        }

        if self.output_mode != OutputMode::SessionOutput {
            self.set_operator_note(
                "scope toggle is only available in session output, graph, or timeline view"
                    .to_string(),
            );
            return;
        }

        self.search_scope = self.search_scope.next();
        self.recompute_search_matches();
        self.sync_output_scroll(self.last_output_height.max(1));

        if self.search_query.is_some() {
            self.set_operator_note(format!(
                "search scope set to {} | {} match(es)",
                self.search_scope.label(),
                self.search_matches.len()
            ));
        } else {
            self.set_operator_note(format!("search scope set to {}", self.search_scope.label()));
        }
    }

    pub fn toggle_search_agent_filter(&mut self) {
        if self.output_mode != OutputMode::SessionOutput {
            self.set_operator_note(
                "search agent filter is only available in session output view".to_string(),
            );
            return;
        }

        let Some(selected_agent_type) = self.selected_agent_type().map(str::to_owned) else {
            self.set_operator_note("search agent filter requires a selected session".to_string());
            return;
        };

        self.search_agent_filter = match self.search_agent_filter {
            SearchAgentFilter::AllAgents => SearchAgentFilter::SelectedAgentType,
            SearchAgentFilter::SelectedAgentType => SearchAgentFilter::AllAgents,
        };
        self.recompute_search_matches();
        self.sync_output_scroll(self.last_output_height.max(1));

        if self.search_query.is_some() {
            self.set_operator_note(format!(
                "search agent filter set to {} | {} match(es)",
                self.search_agent_filter.label(&selected_agent_type),
                self.search_matches.len()
            ));
        } else {
            self.set_operator_note(format!(
                "search agent filter set to {}",
                self.search_agent_filter.label(&selected_agent_type)
            ));
        }
    }

    pub fn begin_search(&mut self) {
        if self.spawn_input.is_some() {
            self.set_operator_note("finish spawn prompt before searching output".to_string());
            return;
        }

        if !matches!(
            self.output_mode,
            OutputMode::SessionOutput | OutputMode::ContextGraph
        ) {
            self.set_operator_note(
                "search is only available in session output or graph view".to_string(),
            );
            return;
        }

        self.search_input = Some(self.search_query.clone().unwrap_or_default());
        let mode = if self.output_mode == OutputMode::ContextGraph {
            "graph search"
        } else {
            "search"
        };
        self.set_operator_note(format!("{mode} mode | type a query and press Enter"));
    }

    pub fn push_input_char(&mut self, ch: char) {
        if let Some(input) = self.spawn_input.as_mut() {
            input.push(ch);
        } else if let Some(input) = self.search_input.as_mut() {
            input.push(ch);
        } else if let Some(input) = self.commit_input.as_mut() {
            input.push(ch);
        } else if let Some(input) = self.pr_input.as_mut() {
            input.push(ch);
        }
    }

    pub fn pop_input_char(&mut self) {
        if let Some(input) = self.spawn_input.as_mut() {
            input.pop();
        } else if let Some(input) = self.search_input.as_mut() {
            input.pop();
        } else if let Some(input) = self.commit_input.as_mut() {
            input.pop();
        } else if let Some(input) = self.pr_input.as_mut() {
            input.pop();
        }
    }

    pub fn cancel_input(&mut self) {
        if self.spawn_input.take().is_some() {
            self.set_operator_note("spawn input cancelled".to_string());
        } else if self.search_input.take().is_some() {
            self.set_operator_note("search input cancelled".to_string());
        } else if self.commit_input.take().is_some() {
            self.set_operator_note("commit input cancelled".to_string());
        } else if self.pr_input.take().is_some() {
            self.set_operator_note("pr input cancelled".to_string());
        }
    }

    pub async fn submit_input(&mut self) {
        if self.spawn_input.is_some() {
            self.submit_spawn_prompt().await;
        } else if self.commit_input.is_some() {
            self.submit_commit_prompt();
        } else if self.pr_input.is_some() {
            self.submit_pr_prompt();
        } else {
            self.submit_search();
        }
    }

    fn submit_pr_prompt(&mut self) {
        let Some(input) = self.pr_input.take() else {
            return;
        };

        let request = match parse_pr_prompt(&input) {
            Ok(request) => request,
            Err(error) => {
                self.pr_input = Some(input);
                self.set_operator_note(format!("invalid PR input: {error}"));
                return;
            }
        };

        if request.title.is_empty() {
            self.pr_input = Some(input);
            self.set_operator_note("pr title cannot be empty".to_string());
            return;
        }

        let Some(session) = self.sessions.get(self.selected_session).cloned() else {
            self.set_operator_note("no session selected".to_string());
            return;
        };
        let Some(worktree) = session.worktree.clone() else {
            self.set_operator_note("selected session has no worktree".to_string());
            return;
        };
        if let Ok(true) = worktree::has_uncommitted_changes(&worktree) {
            self.pr_input = Some(input);
            self.set_operator_note(
                "commit or reset worktree changes before creating a PR".to_string(),
            );
            return;
        }

        let body = self.build_pull_request_body(&session);
        let options = worktree::DraftPrOptions {
            base_branch: request.base_branch.clone(),
            labels: request.labels.clone(),
            reviewers: request.reviewers.clone(),
        };
        match worktree::create_draft_pr_with_options(&worktree, &request.title, &body, &options) {
            Ok(url) => {
                self.set_operator_note(format!(
                    "created draft PR for {} against {}: {}",
                    format_session_id(&session.id),
                    options
                        .base_branch
                        .as_deref()
                        .unwrap_or(&worktree.base_branch),
                    url
                ));
            }
            Err(error) => {
                self.pr_input = Some(input);
                self.set_operator_note(format!("draft PR failed: {error}"));
            }
        }
    }

    fn submit_commit_prompt(&mut self) {
        let Some(input) = self.commit_input.take() else {
            return;
        };

        let message = input.trim().to_string();
        let Some(session_id) = self.selected_session_id().map(ToOwned::to_owned) else {
            self.set_operator_note("no session selected".to_string());
            return;
        };
        let Some(worktree) = self
            .sessions
            .get(self.selected_session)
            .and_then(|session| session.worktree.clone())
        else {
            self.set_operator_note("selected session has no worktree".to_string());
            return;
        };

        match worktree::commit_staged(&worktree, &message) {
            Ok(hash) => {
                self.refresh_after_git_status_action(None);
                self.set_operator_note(format!(
                    "committed {} as {}",
                    format_session_id(&session_id),
                    hash
                ));
            }
            Err(error) => {
                self.commit_input = Some(input);
                self.set_operator_note(format!("commit failed: {error}"));
            }
        }
    }

    fn submit_search(&mut self) {
        let Some(input) = self.search_input.take() else {
            return;
        };

        let query = input.trim().to_string();
        if query.is_empty() {
            self.clear_search();
            return;
        }

        if let Err(error) = compile_search_regex(&query) {
            self.search_input = Some(query.clone());
            self.set_operator_note(format!("invalid regex /{query}: {error}"));
            return;
        }

        self.search_query = Some(query.clone());
        self.recompute_search_matches();
        if self.search_matches.is_empty() {
            let mode = if self.output_mode == OutputMode::ContextGraph {
                "graph search"
            } else {
                "search"
            };
            self.set_operator_note(format!("{mode} /{query} found no matches"));
        } else {
            let mode = if self.output_mode == OutputMode::ContextGraph {
                "graph search"
            } else {
                "search"
            };
            self.set_operator_note(format!(
                "{mode} /{query} matched {} line(s) across {} session(s) | n/N navigate matches",
                self.search_matches.len(),
                self.search_match_session_count()
            ));
        }
    }

    fn build_pull_request_body(&self, session: &Session) -> String {
        let mut lines = vec![
            "## Summary".to_string(),
            format!("- Task: {}", session.task),
            format!("- Agent: {}", session.agent_type),
            format!("- Project: {}", session.project),
            format!("- Task group: {}", session.task_group),
        ];
        if let Some(worktree) = session.worktree.as_ref() {
            lines.push(format!(
                "- Branch: {} -> {}",
                worktree.branch, worktree.base_branch
            ));
        }
        if let Some(summary) = self.selected_diff_summary.as_ref() {
            lines.push(format!("- Diff: {summary}"));
        }
        let changed_files = self
            .selected_diff_preview
            .iter()
            .take(5)
            .cloned()
            .collect::<Vec<_>>();
        if !changed_files.is_empty() {
            lines.push(String::new());
            lines.push("## Changed Files".to_string());
            for file in changed_files {
                lines.push(format!("- {file}"));
            }
        }
        lines.push(String::new());
        lines.push("## Session Metrics".to_string());
        lines.push(format!(
            "- Tokens: {} total (in {} / out {})",
            session.metrics.tokens_used,
            session.metrics.input_tokens,
            session.metrics.output_tokens
        ));
        lines.push(format!("- Tool calls: {}", session.metrics.tool_calls));
        lines.push(format!(
            "- Files changed: {}",
            session.metrics.files_changed
        ));
        lines.push(format!(
            "- Duration: {}",
            format_duration(session.metrics.duration_secs)
        ));
        lines.push(String::new());
        lines.push("## Testing".to_string());
        lines.push("- Verified in ECC 2.0 dashboard workflow".to_string());
        lines.join("\n")
    }

    async fn submit_spawn_prompt(&mut self) {
        let Some(input) = self.spawn_input.take() else {
            return;
        };

        let plan = match self.build_spawn_plan(&input) {
            Ok(plan) => plan,
            Err(error) => {
                self.spawn_input = Some(input);
                self.set_operator_note(error);
                return;
            }
        };

        let source_session = self.sessions.get(self.selected_session).cloned();
        let handoff_context = source_session.as_ref().map(|session| {
            format!(
                "Dashboard handoff from {} [{}] | cwd {}{}",
                format_session_id(&session.id),
                session.agent_type,
                session.working_dir.display(),
                session
                    .worktree
                    .as_ref()
                    .map(|worktree| format!(
                        " | worktree {} ({})",
                        worktree.branch,
                        worktree.path.display()
                    ))
                    .unwrap_or_default()
            )
        });
        let source_task = source_session.as_ref().map(|session| session.task.clone());
        let source_session_id = source_session.as_ref().map(|session| session.id.clone());
        let source_grouping = source_session
            .as_ref()
            .map(|session| SessionGrouping {
                project: Some(session.project.clone()),
                task_group: Some(session.task_group.clone()),
            })
            .unwrap_or_default();
        let agent = self.cfg.default_agent.clone();
        let mut created_ids = Vec::new();

        match &plan {
            SpawnPlan::AdHoc {
                requested_count: _,
                spawn_count,
                task,
            } => {
                for task in expand_spawn_tasks(task, *spawn_count) {
                    let session_id = match manager::create_session_with_grouping(
                        &self.db,
                        &self.cfg,
                        &task,
                        &agent,
                        self.cfg.auto_create_worktrees,
                        source_grouping.clone(),
                    )
                    .await
                    {
                        Ok(session_id) => session_id,
                        Err(error) => {
                            let preferred_selection =
                                post_spawn_selection_id(source_session_id.as_deref(), &created_ids);
                            self.refresh_after_spawn(preferred_selection.as_deref());
                            let mut summary = if created_ids.is_empty() {
                                format!("spawn failed: {error}")
                            } else {
                                format!(
                                    "spawn partially completed: {} of {} queued before failure: {error}",
                                    created_ids.len(),
                                    spawn_count
                                )
                            };
                            if let Some(layout_note) =
                                self.auto_split_layout_after_spawn(created_ids.len())
                            {
                                summary.push_str(" | ");
                                summary.push_str(&layout_note);
                            }
                            self.set_operator_note(summary);
                            return;
                        }
                    };

                    if let (Some(source_id), Some(task), Some(context)) = (
                        source_session_id.as_ref(),
                        source_task.as_ref(),
                        handoff_context.as_ref(),
                    ) {
                        if let Err(error) = comms::send(
                            &self.db,
                            source_id,
                            &session_id,
                            &comms::MessageType::TaskHandoff {
                                task: task.clone(),
                                context: context.clone(),
                                priority: comms::TaskPriority::Normal,
                            },
                        ) {
                            tracing::warn!(
                                "Failed to send handoff from session {} to {}: {error}",
                                source_id,
                                session_id
                            );
                        }
                    }

                    created_ids.push(session_id);
                }
            }
            SpawnPlan::Template {
                name,
                task,
                variables,
                ..
            } => match manager::launch_orchestration_template(
                &self.db,
                &self.cfg,
                name,
                source_session_id.as_deref(),
                task.as_deref(),
                variables.clone(),
            )
            .await
            {
                Ok(outcome) => {
                    created_ids.extend(outcome.created.into_iter().map(|step| step.session_id));
                }
                Err(error) => {
                    self.set_operator_note(format!("template launch failed: {error}"));
                    return;
                }
            },
        }

        let preferred_selection =
            post_spawn_selection_id(source_session_id.as_deref(), &created_ids);
        self.refresh_after_spawn(preferred_selection.as_deref());
        let queued_count = created_ids
            .iter()
            .filter(|session_id| {
                self.db
                    .pending_worktree_queue_contains(session_id)
                    .unwrap_or(false)
            })
            .count();
        let mut note = build_spawn_note(&plan, created_ids.len(), queued_count);
        if let Some(layout_note) = self.auto_split_layout_after_spawn(created_ids.len()) {
            note.push_str(" | ");
            note.push_str(&layout_note);
        }
        self.set_operator_note(note);
    }

    pub fn clear_search(&mut self) {
        let had_query = self.search_query.take().is_some();
        let had_input = self.search_input.take().is_some();
        self.search_matches.clear();
        self.selected_search_match = 0;
        if had_query || had_input {
            let mode = if self.output_mode == OutputMode::ContextGraph {
                "graph search"
            } else {
                "output search"
            };
            self.set_operator_note(format!("cleared {mode}"));
        }
    }

    pub fn next_search_match(&mut self) {
        if self.search_matches.is_empty() {
            self.set_operator_note("no output search matches to navigate".to_string());
            return;
        }

        self.selected_search_match = (self.selected_search_match + 1) % self.search_matches.len();
        self.focus_selected_search_match();
        self.set_operator_note(self.search_navigation_note());
    }

    pub fn prev_search_match(&mut self) {
        if self.search_matches.is_empty() {
            self.set_operator_note("no output search matches to navigate".to_string());
            return;
        }

        self.selected_search_match = if self.selected_search_match == 0 {
            self.search_matches.len() - 1
        } else {
            self.selected_search_match - 1
        };
        self.focus_selected_search_match();
        self.set_operator_note(self.search_navigation_note());
    }

    pub fn toggle_output_filter(&mut self) {
        if self.output_mode != OutputMode::SessionOutput {
            self.set_operator_note(
                "output filters are only available in session output view".to_string(),
            );
            return;
        }

        self.output_filter = self.output_filter.next();
        self.recompute_search_matches();
        self.sync_output_scroll(self.last_output_height.max(1));
        self.set_operator_note(format!(
            "output filter set to {}",
            self.output_filter.label()
        ));
    }

    pub fn cycle_output_time_filter(&mut self) {
        if !matches!(
            self.output_mode,
            OutputMode::SessionOutput | OutputMode::Timeline | OutputMode::ContextGraph
        ) {
            self.set_operator_note(
                "time filters are only available in session output, graph, or timeline view"
                    .to_string(),
            );
            return;
        }

        self.output_time_filter = self.output_time_filter.next();
        if matches!(
            self.output_mode,
            OutputMode::SessionOutput | OutputMode::ContextGraph
        ) {
            self.recompute_search_matches();
        }
        self.sync_output_scroll(self.last_output_height.max(1));
        let note_prefix = match self.output_mode {
            OutputMode::Timeline => "timeline range",
            OutputMode::ContextGraph => "graph range",
            _ => "output time filter",
        };
        self.set_operator_note(format!(
            "{note_prefix} set to {}",
            self.output_time_filter.label()
        ));
    }

    pub fn cycle_timeline_event_filter(&mut self) {
        if self.output_mode != OutputMode::Timeline {
            self.set_operator_note(
                "timeline event filters are only available in timeline view".to_string(),
            );
            return;
        }

        self.timeline_event_filter = self.timeline_event_filter.next();
        self.sync_output_scroll(self.last_output_height.max(1));
        self.set_operator_note(format!(
            "timeline filter set to {}",
            self.timeline_event_filter.label()
        ));
    }

    pub fn toggle_context_graph_mode(&mut self) {
        match self.output_mode {
            OutputMode::ContextGraph => {
                self.output_mode = OutputMode::SessionOutput;
                self.reset_output_view();
                self.set_operator_note("showing session output".to_string());
            }
            _ => {
                self.output_mode = OutputMode::ContextGraph;
                self.selected_pane = Pane::Output;
                self.output_follow = false;
                self.output_scroll_offset = 0;
                self.recompute_search_matches();
                self.set_operator_note("showing selected session context graph".to_string());
            }
        }
    }

    pub fn cycle_graph_entity_filter(&mut self) {
        if self.output_mode != OutputMode::ContextGraph {
            self.set_operator_note(
                "graph entity filters are only available in context graph view".to_string(),
            );
            return;
        }

        self.graph_entity_filter = self.graph_entity_filter.next();
        self.recompute_search_matches();
        self.sync_output_scroll(self.last_output_height.max(1));
        self.set_operator_note(format!(
            "graph filter set to {}",
            self.graph_entity_filter.label()
        ));
    }

    pub fn toggle_auto_dispatch_policy(&mut self) {
        self.cfg.auto_dispatch_unread_handoffs = !self.cfg.auto_dispatch_unread_handoffs;
        match self.cfg.save() {
            Ok(()) => {
                let state = if self.cfg.auto_dispatch_unread_handoffs {
                    "enabled"
                } else {
                    "disabled"
                };
                self.set_operator_note(format!(
                    "daemon auto-dispatch {state} | saved to {}",
                    crate::config::Config::config_path().display()
                ));
            }
            Err(error) => {
                self.cfg.auto_dispatch_unread_handoffs = !self.cfg.auto_dispatch_unread_handoffs;
                self.set_operator_note(format!("failed to persist auto-dispatch policy: {error}"));
            }
        }
    }

    pub fn toggle_auto_merge_policy(&mut self) {
        self.cfg.auto_merge_ready_worktrees = !self.cfg.auto_merge_ready_worktrees;
        match self.cfg.save() {
            Ok(()) => {
                let state = if self.cfg.auto_merge_ready_worktrees {
                    "enabled"
                } else {
                    "disabled"
                };
                self.set_operator_note(format!(
                    "daemon auto-merge {state} | saved to {}",
                    crate::config::Config::config_path().display()
                ));
            }
            Err(error) => {
                self.cfg.auto_merge_ready_worktrees = !self.cfg.auto_merge_ready_worktrees;
                self.set_operator_note(format!("failed to persist auto-merge policy: {error}"));
            }
        }
    }

    pub fn toggle_auto_worktree_policy(&mut self) {
        self.cfg.auto_create_worktrees = !self.cfg.auto_create_worktrees;
        match self.cfg.save() {
            Ok(()) => {
                let state = if self.cfg.auto_create_worktrees {
                    "enabled"
                } else {
                    "disabled"
                };
                self.set_operator_note(format!(
                    "default worktree creation {state} | saved to {}",
                    crate::config::Config::config_path().display()
                ));
            }
            Err(error) => {
                self.cfg.auto_create_worktrees = !self.cfg.auto_create_worktrees;
                self.set_operator_note(format!(
                    "failed to persist worktree creation policy: {error}"
                ));
            }
        }
    }

    pub fn adjust_auto_dispatch_limit(&mut self, delta: isize) {
        let next =
            (self.cfg.auto_dispatch_limit_per_session as isize + delta).clamp(1, 50) as usize;
        if next == self.cfg.auto_dispatch_limit_per_session {
            self.set_operator_note(format!(
                "auto-dispatch limit unchanged at {} handoff(s) per lead",
                self.cfg.auto_dispatch_limit_per_session
            ));
            return;
        }

        let previous = self.cfg.auto_dispatch_limit_per_session;
        self.cfg.auto_dispatch_limit_per_session = next;
        match self.cfg.save() {
            Ok(()) => self.set_operator_note(format!(
                "auto-dispatch limit set to {} handoff(s) per lead | saved to {}",
                self.cfg.auto_dispatch_limit_per_session,
                crate::config::Config::config_path().display()
            )),
            Err(error) => {
                self.cfg.auto_dispatch_limit_per_session = previous;
                self.set_operator_note(format!("failed to persist auto-dispatch limit: {error}"));
            }
        }
    }

    pub async fn tick(&mut self) {
        loop {
            match self.output_rx.try_recv() {
                Ok(_event) => {}
                Err(broadcast::error::TryRecvError::Empty) => break,
                Err(broadcast::error::TryRecvError::Lagged(_)) => continue,
                Err(broadcast::error::TryRecvError::Closed) => break,
            }
        }

        if let Err(error) = manager::activate_pending_worktree_sessions(&self.db, &self.cfg).await {
            tracing::warn!("Failed to activate queued worktree sessions: {error}");
        }

        self.sync_from_store();
    }

    fn sync_runtime_metrics(
        &mut self,
    ) -> (
        Option<manager::HeartbeatEnforcementOutcome>,
        Option<manager::BudgetEnforcementOutcome>,
        Option<manager::ConflictEnforcementOutcome>,
    ) {
        if let Err(error) = self.db.refresh_session_durations() {
            tracing::warn!("Failed to refresh session durations: {error}");
        }

        let metrics_path = self.cfg.cost_metrics_path();
        let signature = metrics_file_signature(&metrics_path);
        if signature != self.last_cost_metrics_signature {
            self.last_cost_metrics_signature = signature;
            if signature.is_some() {
                if let Err(error) = self.db.sync_cost_tracker_metrics(&metrics_path) {
                    tracing::warn!("Failed to sync cost tracker metrics: {error}");
                }
            }
        }

        let activity_path = self.cfg.tool_activity_metrics_path();
        let activity_signature = metrics_file_signature(&activity_path);
        if activity_signature != self.last_tool_activity_signature {
            self.last_tool_activity_signature = activity_signature;
            if activity_signature.is_some() {
                if let Err(error) = self.db.sync_tool_activity_metrics(&activity_path) {
                    tracing::warn!("Failed to sync tool activity metrics: {error}");
                }
            }
        }

        let heartbeat_enforcement = match manager::enforce_session_heartbeats(&self.db, &self.cfg) {
            Ok(outcome) => Some(outcome),
            Err(error) => {
                tracing::warn!("Failed to enforce session heartbeats: {error}");
                None
            }
        };

        let budget_enforcement = match manager::enforce_budget_hard_limits(&self.db, &self.cfg) {
            Ok(outcome) => Some(outcome),
            Err(error) => {
                tracing::warn!("Failed to enforce budget hard limits: {error}");
                None
            }
        };

        let conflict_enforcement = match manager::enforce_conflict_resolution(&self.db, &self.cfg) {
            Ok(outcome) => Some(outcome),
            Err(error) => {
                tracing::warn!("Failed to enforce conflict resolution: {error}");
                None
            }
        };

        (
            heartbeat_enforcement,
            budget_enforcement,
            conflict_enforcement,
        )
    }

    fn sync_from_store(&mut self) {
        let (heartbeat_enforcement, budget_enforcement, conflict_enforcement) =
            self.sync_runtime_metrics();
        let selected_id = self.selected_session_id().map(ToOwned::to_owned);
        self.sessions = match self.db.list_sessions() {
            Ok(mut sessions) => {
                sort_sessions_for_display(&mut sessions);
                sessions
            }
            Err(error) => {
                tracing::warn!("Failed to refresh sessions: {error}");
                Vec::new()
            }
        };
        self.session_harnesses = load_session_harnesses(&self.db, &self.cfg, &self.sessions);
        self.unread_message_counts = match self.db.unread_message_counts() {
            Ok(counts) => counts,
            Err(error) => {
                tracing::warn!("Failed to refresh unread message counts: {error}");
                HashMap::new()
            }
        };
        self.sync_approval_queue();
        self.sync_handoff_backlog_counts();
        self.sync_board_meta();
        self.sync_worktree_health_by_session();
        self.sync_session_state_notifications();
        self.sync_approval_notifications();
        self.sync_global_handoff_backlog();
        self.sync_daemon_activity();
        self.sync_output_cache();
        self.sync_selection_by_id(selected_id.as_deref());
        self.ensure_selected_pane_visible();
        self.sync_selected_output();
        self.sync_selected_diff();
        self.sync_selected_git_status();
        self.sync_selected_messages();
        self.sync_selected_lineage();
        self.refresh_logs();
        self.sync_budget_alerts();

        if let Some(outcome) =
            budget_enforcement.filter(|outcome| !outcome.paused_sessions.is_empty())
        {
            self.set_operator_note(budget_auto_pause_note(&outcome));
        }
        if let Some(outcome) = conflict_enforcement.filter(|outcome| outcome.created_incidents > 0)
        {
            self.set_operator_note(conflict_enforcement_note(&outcome));
        }
        if let Some(outcome) = heartbeat_enforcement.filter(|outcome| {
            !outcome.stale_sessions.is_empty() || !outcome.auto_terminated_sessions.is_empty()
        }) {
            self.set_operator_note(heartbeat_enforcement_note(&outcome));
        }
    }

    fn sync_budget_alerts(&mut self) {
        let aggregate = self.aggregate_usage();
        let thresholds = self.cfg.effective_budget_alert_thresholds();
        let current_state = aggregate.overall_state;
        if current_state == self.last_budget_alert_state {
            return;
        }

        let previous_state = self.last_budget_alert_state;
        self.last_budget_alert_state = current_state;

        if current_state <= previous_state {
            return;
        }

        let Some(summary_suffix) = current_state.summary_suffix(thresholds) else {
            return;
        };

        let token_budget = if self.cfg.token_budget > 0 {
            format!(
                "{} / {}",
                format_token_count(aggregate.total_tokens),
                format_token_count(self.cfg.token_budget)
            )
        } else {
            format!("{} / no budget", format_token_count(aggregate.total_tokens))
        };
        let cost_budget = if self.cfg.cost_budget_usd > 0.0 {
            format!(
                "{} / {}",
                format_currency(aggregate.total_cost_usd),
                format_currency(self.cfg.cost_budget_usd)
            )
        } else {
            format!("{} / no budget", format_currency(aggregate.total_cost_usd))
        };

        self.set_operator_note(format!(
            "{summary_suffix} | tokens {token_budget} | cost {cost_budget}"
        ));
        self.notify_desktop(
            NotificationEvent::BudgetAlert,
            "ECC 2.0: Budget alert",
            &format!("{summary_suffix} | tokens {token_budget} | cost {cost_budget}"),
        );
        self.notify_webhook(
            NotificationEvent::BudgetAlert,
            &budget_alert_webhook_body(
                &summary_suffix,
                &token_budget,
                &cost_budget,
                self.active_session_count(),
            ),
        );
    }

    fn sync_session_state_notifications(&mut self) {
        let mut next_states = HashMap::new();
        let mut completion_summaries = Vec::new();
        let mut failed_notifications = Vec::new();
        let mut started_webhooks = Vec::new();
        let mut completion_webhooks = Vec::new();
        let mut failed_webhooks = Vec::new();

        for session in &self.sessions {
            let previous_state = self.last_session_states.get(&session.id);
            if let Some(previous_state) = previous_state {
                if previous_state != &session.state {
                    match session.state {
                        SessionState::Running => {
                            started_webhooks.push(session_started_webhook_body(
                                session,
                                session_compare_url(session).as_deref(),
                            ));
                        }
                        SessionState::Completed => {
                            let summary = self.build_completion_summary(session);
                            self.persist_completion_summary_observation(
                                session,
                                &summary,
                                "completion_summary",
                            );
                            if self.cfg.completion_summary_notifications.enabled {
                                completion_summaries.push(summary.clone());
                            } else if self.cfg.desktop_notifications.session_completed {
                                self.notify_desktop(
                                    NotificationEvent::SessionCompleted,
                                    "ECC 2.0: Session completed",
                                    &format!(
                                        "{} | {}",
                                        format_session_id(&session.id),
                                        truncate_for_dashboard(&session.task, 96)
                                    ),
                                );
                            }
                            completion_webhooks.push(completion_summary_webhook_body(
                                &summary,
                                session,
                                session_compare_url(session).as_deref(),
                            ));
                        }
                        SessionState::Failed => {
                            let summary = self.build_completion_summary(session);
                            self.persist_completion_summary_observation(
                                session,
                                &summary,
                                "failure_summary",
                            );
                            failed_notifications.push((
                                "ECC 2.0: Session failed".to_string(),
                                format!(
                                    "{} | {}",
                                    format_session_id(&session.id),
                                    truncate_for_dashboard(&session.task, 96)
                                ),
                            ));
                            failed_webhooks.push(completion_summary_webhook_body(
                                &summary,
                                session,
                                session_compare_url(session).as_deref(),
                            ));
                        }
                        _ => {}
                    }
                }
            } else if session.state == SessionState::Running {
                started_webhooks.push(session_started_webhook_body(
                    session,
                    session_compare_url(session).as_deref(),
                ));
            }

            next_states.insert(session.id.clone(), session.state.clone());
        }

        for summary in completion_summaries {
            self.deliver_completion_summary(summary);
        }

        for body in started_webhooks {
            self.notify_webhook(NotificationEvent::SessionStarted, &body);
        }

        if self.cfg.desktop_notifications.session_failed {
            for (title, body) in failed_notifications {
                self.notify_desktop(NotificationEvent::SessionFailed, &title, &body);
            }
        }

        for body in completion_webhooks {
            self.notify_webhook(NotificationEvent::SessionCompleted, &body);
        }

        for body in failed_webhooks {
            self.notify_webhook(NotificationEvent::SessionFailed, &body);
        }

        self.last_session_states = next_states;
    }

    fn persist_completion_summary_observation(
        &self,
        session: &Session,
        summary: &SessionCompletionSummary,
        observation_type: &str,
    ) {
        let observation_summary = format!(
            "{} | files {} | tests {}/{} | warnings {}",
            truncate_for_dashboard(&summary.task, 72),
            summary.files_changed,
            summary.tests_passed,
            summary.tests_run,
            summary.warnings.len()
        );
        let details = completion_summary_observation_details(summary, session);
        let priority = if observation_type == "failure_summary" {
            ContextObservationPriority::High
        } else {
            ContextObservationPriority::Normal
        };
        if let Err(error) = self.db.add_session_observation(
            &session.id,
            observation_type,
            priority,
            false,
            &observation_summary,
            &details,
        ) {
            tracing::warn!(
                "Failed to persist completion observation for {}: {error}",
                session.id
            );
        }
    }

    fn sync_approval_notifications(&mut self) {
        let latest_message = match self.db.latest_unread_approval_message() {
            Ok(message) => message,
            Err(error) => {
                tracing::warn!("Failed to refresh latest approval request: {error}");
                return;
            }
        };

        let Some(message) = latest_message else {
            return;
        };

        if self
            .last_seen_approval_message_id
            .is_some_and(|last_seen| message.id <= last_seen)
        {
            return;
        }

        self.last_seen_approval_message_id = Some(message.id);
        let preview =
            truncate_for_dashboard(&comms::preview(&message.msg_type, &message.content), 96);
        self.notify_desktop(
            NotificationEvent::ApprovalRequest,
            "ECC 2.0: Approval needed",
            &format!(
                "{} from {} | {}",
                format_session_id(&message.to_session),
                format_session_id(&message.from_session),
                preview
            ),
        );
        self.notify_webhook(
            NotificationEvent::ApprovalRequest,
            &approval_request_webhook_body(&message, &preview),
        );
    }

    fn deliver_completion_summary(&mut self, summary: SessionCompletionSummary) {
        if self.cfg.completion_summary_notifications.desktop_enabled()
            && self.cfg.desktop_notifications.session_completed
        {
            self.notify_desktop(
                NotificationEvent::SessionCompleted,
                &summary.title(),
                &summary.notification_body(),
            );
        }

        if self.cfg.completion_summary_notifications.popup_enabled() {
            if self.active_completion_popup.is_none() {
                self.active_completion_popup = Some(summary);
            } else {
                self.queued_completion_popups.push_back(summary);
            }
        }
    }

    fn build_completion_summary(&self, session: &Session) -> SessionCompletionSummary {
        let file_activity = match self.db.list_file_activity(&session.id, 5) {
            Ok(entries) => entries,
            Err(error) => {
                tracing::warn!(
                    "Failed to load file activity for completion summary {}: {error}",
                    session.id
                );
                Vec::new()
            }
        };
        let tool_logs = match self.db.list_tool_logs_for_session(&session.id) {
            Ok(entries) => entries,
            Err(error) => {
                tracing::warn!(
                    "Failed to load tool logs for completion summary {}: {error}",
                    session.id
                );
                Vec::new()
            }
        };
        let overlaps = match self.db.list_file_overlaps(&session.id, 3) {
            Ok(entries) => entries,
            Err(error) => {
                tracing::warn!(
                    "Failed to load file overlaps for completion summary {}: {error}",
                    session.id
                );
                Vec::new()
            }
        };

        let tests = summarize_test_runs(&tool_logs, session.state == SessionState::Completed);
        let recent_files = recent_completion_files(&file_activity, session.metrics.files_changed);
        let key_decisions =
            summarize_completion_decisions(&tool_logs, &file_activity, &session.task);
        let warnings = summarize_completion_warnings(
            session,
            &tool_logs,
            &tests,
            self.worktree_health_by_session.get(&session.id),
            self.approval_queue_counts
                .get(&session.id)
                .copied()
                .unwrap_or(0),
            overlaps.len(),
        );

        SessionCompletionSummary {
            session_id: session.id.clone(),
            task: session.task.clone(),
            state: session.state.clone(),
            files_changed: session.metrics.files_changed,
            tokens_used: session.metrics.tokens_used,
            duration_secs: session.metrics.duration_secs,
            cost_usd: session.metrics.cost_usd,
            tests_run: tests.total,
            tests_passed: tests.passed,
            recent_files,
            key_decisions,
            warnings,
        }
    }

    fn notify_desktop(&self, event: NotificationEvent, title: &str, body: &str) {
        let _ = self.notifier.notify(event, title, body);
    }

    fn notify_webhook(&self, event: NotificationEvent, body: &str) {
        let _ = self.webhook_notifier.notify(event, body);
    }

    fn sync_selection(&mut self) {
        if self.sessions.is_empty() {
            self.selected_session = 0;
            self.session_table_state.select(None);
        } else {
            self.selected_session = self.selected_session.min(self.sessions.len() - 1);
            self.session_table_state.select(Some(self.selected_session));
        }
    }

    fn sync_selection_by_id(&mut self, selected_id: Option<&str>) {
        if let Some(selected_id) = selected_id {
            if let Some(index) = self
                .sessions
                .iter()
                .position(|session| session.id == selected_id)
            {
                self.selected_session = index;
            }
        }
        self.sync_selection();
    }

    fn sync_output_cache(&mut self) {
        let active_session_ids: HashSet<_> = self
            .sessions
            .iter()
            .map(|session| session.id.as_str())
            .collect();
        self.session_output_cache
            .retain(|session_id, _| active_session_ids.contains(session_id.as_str()));

        for session in &self.sessions {
            match self.db.get_output_lines(&session.id, OUTPUT_BUFFER_LIMIT) {
                Ok(lines) => {
                    self.output_store.replace_lines(&session.id, lines.clone());
                    self.session_output_cache.insert(session.id.clone(), lines);
                }
                Err(error) => {
                    tracing::warn!("Failed to load session output for {}: {error}", session.id);
                }
            }
        }
    }

    fn ensure_selected_pane_visible(&mut self) {
        if !self.is_pane_visible(self.selected_pane) {
            self.selected_pane = Pane::Sessions;
        }
    }

    fn focus_pane(&mut self, pane: Pane) {
        self.selected_pane = pane;
        self.ensure_selected_pane_visible();
        self.set_operator_note(format!("focused {} pane", pane.title().to_lowercase()));
    }

    fn move_pane_focus(&mut self, direction: PaneDirection) {
        let visible_panes = self.visible_panes();
        if visible_panes.len() <= 1 {
            return;
        }

        let pane_areas = self.pane_areas(Rect::new(0, 0, 100, 40));
        let Some(current_rect) = pane_rect(&pane_areas, self.selected_pane) else {
            return;
        };
        let current_center = pane_center(current_rect);

        let candidate = visible_panes
            .into_iter()
            .filter(|pane| *pane != self.selected_pane)
            .filter_map(|pane| {
                let rect = pane_rect(&pane_areas, pane)?;
                let center = pane_center(rect);
                let dx = center.0 - current_center.0;
                let dy = center.1 - current_center.1;

                let (primary, secondary) = match direction {
                    PaneDirection::Left if dx < 0 => ((-dx) as u16, dy.unsigned_abs()),
                    PaneDirection::Right if dx > 0 => (dx as u16, dy.unsigned_abs()),
                    PaneDirection::Up if dy < 0 => ((-dy) as u16, dx.unsigned_abs()),
                    PaneDirection::Down if dy > 0 => (dy as u16, dx.unsigned_abs()),
                    _ => return None,
                };

                Some((pane, primary, secondary))
            })
            .min_by_key(|(pane, primary, secondary)| (*primary, *secondary, pane.sort_key()));

        if let Some((pane, _, _)) = candidate {
            self.focus_pane(pane);
        }
    }

    fn pane_focus_shortcuts_label(&self) -> String {
        self.cfg.pane_navigation.focus_shortcuts_label()
    }

    fn pane_move_shortcuts_label(&self) -> String {
        self.cfg.pane_navigation.movement_shortcuts_label()
    }

    fn sync_global_handoff_backlog(&mut self) {
        let limit = self.sessions.len().max(1);
        match self.db.unread_task_handoff_targets(limit) {
            Ok(targets) => {
                self.global_handoff_backlog_leads = targets.len();
                self.global_handoff_backlog_messages =
                    targets.iter().map(|(_, unread_count)| *unread_count).sum();
            }
            Err(error) => {
                tracing::warn!("Failed to refresh global handoff backlog: {error}");
                self.global_handoff_backlog_leads = 0;
                self.global_handoff_backlog_messages = 0;
            }
        }
    }

    fn sync_approval_queue(&mut self) {
        self.approval_queue_counts = match self.db.unread_approval_counts() {
            Ok(counts) => counts,
            Err(error) => {
                tracing::warn!("Failed to refresh approval queue counts: {error}");
                HashMap::new()
            }
        };
        self.approval_queue_preview = match self.db.unread_approval_queue(3) {
            Ok(messages) => messages,
            Err(error) => {
                tracing::warn!("Failed to refresh approval queue preview: {error}");
                Vec::new()
            }
        };
    }

    fn sync_handoff_backlog_counts(&mut self) {
        let limit = self.sessions.len().max(1);
        self.handoff_backlog_counts.clear();
        match self.db.unread_task_handoff_targets(limit) {
            Ok(targets) => {
                self.handoff_backlog_counts.extend(targets);
            }
            Err(error) => {
                tracing::warn!("Failed to refresh handoff backlog counts: {error}");
            }
        }
    }

    fn sync_board_meta(&mut self) {
        self.board_meta_by_session = match self.db.list_session_board_meta() {
            Ok(meta) => meta,
            Err(error) => {
                tracing::warn!("Failed to refresh board metadata: {error}");
                HashMap::new()
            }
        };
    }

    fn sync_worktree_health_by_session(&mut self) {
        self.worktree_health_by_session.clear();
        for session in &self.sessions {
            let Some(worktree) = session.worktree.as_ref() else {
                continue;
            };

            match worktree::health(worktree) {
                Ok(health) => {
                    self.worktree_health_by_session
                        .insert(session.id.clone(), health);
                }
                Err(error) => {
                    tracing::warn!(
                        "Failed to refresh worktree health for {}: {error}",
                        session.id
                    );
                }
            }
        }
    }

    fn sync_daemon_activity(&mut self) {
        self.daemon_activity = match self.db.daemon_activity() {
            Ok(activity) => activity,
            Err(error) => {
                tracing::warn!("Failed to refresh daemon activity: {error}");
                DaemonActivity::default()
            }
        };
    }

    fn sync_selected_output(&mut self) {
        if self.selected_session_id().is_none() {
            self.output_scroll_offset = 0;
            self.output_follow = true;
            self.search_matches.clear();
            self.selected_search_match = 0;
            return;
        }

        self.recompute_search_matches();
    }

    fn sync_selected_diff(&mut self) {
        let session = self.sessions.get(self.selected_session);
        let worktree = session.and_then(|session| session.worktree.as_ref());

        self.selected_diff_summary =
            worktree.and_then(|worktree| worktree::diff_summary(worktree).ok().flatten());
        self.selected_diff_preview = worktree
            .and_then(|worktree| worktree::diff_file_preview(worktree, MAX_DIFF_PREVIEW_LINES).ok())
            .unwrap_or_default();
        self.selected_diff_patch = worktree.and_then(|worktree| {
            worktree::diff_patch_preview(worktree, MAX_DIFF_PATCH_LINES)
                .ok()
                .flatten()
        });
        self.selected_diff_hunk_offsets_unified = self
            .selected_diff_patch
            .as_deref()
            .map(build_unified_diff_hunk_offsets)
            .unwrap_or_default();
        self.selected_diff_hunk_offsets_split = self
            .selected_diff_patch
            .as_deref()
            .map(|patch| build_worktree_diff_columns(patch, self.theme_palette()).hunk_offsets)
            .unwrap_or_default();
        if self.selected_diff_hunk >= self.current_diff_hunk_offsets().len() {
            self.selected_diff_hunk = 0;
        }
        self.selected_merge_readiness =
            worktree.and_then(|worktree| worktree::merge_readiness(worktree).ok());
        self.selected_conflict_protocol = session.and_then(|selected_session| {
            worktree
                .zip(self.selected_merge_readiness.as_ref())
                .and_then(|(worktree, merge_readiness)| {
                    build_conflict_protocol(&selected_session.id, worktree, merge_readiness)
                })
                .or_else(|| {
                    let incidents = self
                        .db
                        .list_open_conflict_incidents_for_session(&selected_session.id, 5)
                        .unwrap_or_default();
                    build_session_conflict_protocol(&selected_session.id, &incidents)
                })
        });
        if self.output_mode == OutputMode::WorktreeDiff && self.selected_diff_patch.is_none() {
            self.output_mode = OutputMode::SessionOutput;
        }
        if self.output_mode == OutputMode::ConflictProtocol
            && self.selected_conflict_protocol.is_none()
        {
            self.output_mode = OutputMode::SessionOutput;
        }
        self.sync_selected_git_status();
        self.sync_selected_git_patch();
    }

    fn sync_selected_git_status(&mut self) {
        let session = self.sessions.get(self.selected_session);
        let worktree = session.and_then(|session| session.worktree.as_ref());
        self.selected_git_status_entries = worktree
            .and_then(|worktree| worktree::git_status_entries(worktree).ok())
            .unwrap_or_default();
        if self.selected_git_status >= self.selected_git_status_entries.len() {
            self.selected_git_status = self.selected_git_status_entries.len().saturating_sub(1);
        }
        if matches!(
            self.output_mode,
            OutputMode::GitStatus | OutputMode::GitPatch
        ) && worktree.is_none()
        {
            self.output_mode = OutputMode::SessionOutput;
        }
    }

    fn sync_selected_git_patch(&mut self) {
        let Some((entry, worktree)) = self.selected_git_status_context() else {
            self.selected_git_patch = None;
            self.selected_git_patch_hunk_offsets_unified.clear();
            self.selected_git_patch_hunk_offsets_split.clear();
            self.selected_git_patch_hunk = 0;
            if self.output_mode == OutputMode::GitPatch {
                self.output_mode = OutputMode::GitStatus;
            }
            return;
        };

        self.selected_git_patch = worktree::git_status_patch_view(&worktree, &entry)
            .ok()
            .flatten();
        self.selected_git_patch_hunk_offsets_unified = self
            .selected_git_patch
            .as_ref()
            .map(|patch| build_unified_diff_hunk_offsets(&patch.patch))
            .unwrap_or_default();
        self.selected_git_patch_hunk_offsets_split = self
            .selected_git_patch
            .as_ref()
            .map(|patch| {
                build_worktree_diff_columns(&patch.patch, self.theme_palette()).hunk_offsets
            })
            .unwrap_or_default();
        if self.selected_git_patch_hunk >= self.current_diff_hunk_offsets().len() {
            self.selected_git_patch_hunk = 0;
        }
        if self.output_mode == OutputMode::GitPatch && self.selected_git_patch.is_none() {
            self.output_mode = OutputMode::GitStatus;
        }
    }

    fn selected_git_status_context(
        &self,
    ) -> Option<(worktree::GitStatusEntry, crate::session::WorktreeInfo)> {
        let session = self.sessions.get(self.selected_session)?;
        let worktree = session.worktree.clone()?;
        let entry = self
            .selected_git_status_entries
            .get(self.selected_git_status)
            .cloned()?;
        Some((entry, worktree))
    }

    fn selected_git_patch_context(
        &self,
    ) -> Option<(
        worktree::GitStatusEntry,
        crate::session::WorktreeInfo,
        worktree::GitStatusPatchView,
        worktree::GitPatchHunk,
    )> {
        let (entry, worktree) = self.selected_git_status_context()?;
        let patch = self.selected_git_patch.clone()?;
        let hunk = patch.hunks.get(self.selected_git_patch_hunk).cloned()?;
        Some((entry, worktree, patch, hunk))
    }

    fn refresh_after_git_status_action(&mut self, preferred_path: Option<&str>) {
        let keep_patch_view = self.output_mode == OutputMode::GitPatch;
        let preferred_hunk = self.selected_git_patch_hunk;
        self.refresh();
        self.selected_pane = Pane::Output;
        self.output_follow = false;
        if let Some(path) = preferred_path {
            if let Some(index) = self
                .selected_git_status_entries
                .iter()
                .position(|entry| entry.path == path)
            {
                self.selected_git_status = index;
            }
        }
        self.sync_selected_git_patch();
        if keep_patch_view && self.selected_git_patch.is_some() {
            self.output_mode = OutputMode::GitPatch;
            let max_index = self.current_diff_hunk_offsets().len().saturating_sub(1);
            self.selected_git_patch_hunk = preferred_hunk.min(max_index);
            self.output_scroll_offset = self.current_diff_hunk_offset();
        } else {
            self.output_mode = OutputMode::GitStatus;
        }
        self.sync_output_scroll(self.last_output_height.max(1));
    }

    fn active_patch_text(&self) -> Option<&String> {
        match self.output_mode {
            OutputMode::GitPatch => self.selected_git_patch.as_ref().map(|patch| &patch.patch),
            OutputMode::WorktreeDiff => self.selected_diff_patch.as_ref(),
            _ => None,
        }
    }

    fn current_diff_hunk_offsets(&self) -> &[usize] {
        match self.output_mode {
            OutputMode::GitPatch => match self.diff_view_mode {
                DiffViewMode::Split => &self.selected_git_patch_hunk_offsets_split,
                DiffViewMode::Unified => &self.selected_git_patch_hunk_offsets_unified,
            },
            _ => match self.diff_view_mode {
                DiffViewMode::Split => &self.selected_diff_hunk_offsets_split,
                DiffViewMode::Unified => &self.selected_diff_hunk_offsets_unified,
            },
        }
    }

    fn current_diff_hunk_index(&self) -> usize {
        match self.output_mode {
            OutputMode::GitPatch => self.selected_git_patch_hunk,
            _ => self.selected_diff_hunk,
        }
    }

    fn set_current_diff_hunk_index(&mut self, index: usize) {
        match self.output_mode {
            OutputMode::GitPatch => self.selected_git_patch_hunk = index,
            _ => self.selected_diff_hunk = index,
        }
    }

    fn current_diff_hunk_offset(&self) -> usize {
        self.current_diff_hunk_offsets()
            .get(self.current_diff_hunk_index())
            .copied()
            .unwrap_or(0)
    }

    fn diff_hunk_title_suffix(&self) -> String {
        let total = self.current_diff_hunk_offsets().len();
        if total == 0 {
            String::new()
        } else {
            format!(" {}/{}", self.current_diff_hunk_index() + 1, total)
        }
    }

    fn sync_selected_messages(&mut self) {
        let Some(session_id) = self.selected_session_id().map(ToOwned::to_owned) else {
            self.selected_messages.clear();
            self.sync_approval_queue();
            return;
        };

        let unread_count = self
            .unread_message_counts
            .get(&session_id)
            .copied()
            .unwrap_or(0);
        if unread_count > 0 {
            match self.db.mark_messages_read(&session_id) {
                Ok(_) => {
                    self.unread_message_counts.insert(session_id.clone(), 0);
                }
                Err(error) => {
                    tracing::warn!(
                        "Failed to mark session {} messages as read: {error}",
                        session_id
                    );
                }
            }
        }

        self.selected_messages = match self.db.list_messages_for_session(&session_id, 5) {
            Ok(messages) => messages,
            Err(error) => {
                tracing::warn!("Failed to load session messages: {error}");
                Vec::new()
            }
        };

        self.sync_approval_queue();
    }

    fn sync_selected_lineage(&mut self) {
        let Some(session_id) = self.selected_session_id().map(ToOwned::to_owned) else {
            self.selected_parent_session = None;
            self.selected_child_sessions.clear();
            self.focused_delegate_session_id = None;
            self.selected_team_summary = None;
            self.selected_route_preview = None;
            return;
        };

        self.selected_parent_session = match self.db.latest_task_handoff_source(&session_id) {
            Ok(parent) => parent,
            Err(error) => {
                tracing::warn!("Failed to load session parent linkage: {error}");
                None
            }
        };

        self.selected_child_sessions = match self.db.delegated_children(&session_id, 50) {
            Ok(children) => {
                let mut delegated = Vec::new();
                let mut team = TeamSummary::default();
                let mut route_candidates = Vec::new();

                for child_id in children {
                    match self.db.get_session(&child_id) {
                        Ok(Some(session)) => {
                            team.total += 1;
                            let approval_backlog = self
                                .approval_queue_counts
                                .get(&child_id)
                                .copied()
                                .unwrap_or(0);
                            let handoff_backlog = match self.db.unread_task_handoff_count(&child_id)
                            {
                                Ok(count) => count,
                                Err(error) => {
                                    tracing::warn!(
                                        "Failed to load delegated child handoff backlog {}: {error}",
                                        child_id
                                    );
                                    0
                                }
                            };
                            let state = session.state.clone();
                            match state {
                                SessionState::Idle => team.idle += 1,
                                SessionState::Running => team.running += 1,
                                SessionState::Pending => team.pending += 1,
                                SessionState::Failed => team.failed += 1,
                                SessionState::Stopped => team.stopped += 1,
                                SessionState::Stale => team.stale += 1,
                                SessionState::Completed => {}
                            }

                            route_candidates.push(DelegatedChildSummary {
                                worktree_health: self
                                    .worktree_health_by_session
                                    .get(&child_id)
                                    .copied(),
                                approval_backlog,
                                handoff_backlog,
                                state: state.clone(),
                                session_id: child_id.clone(),
                                tokens_used: session.metrics.tokens_used,
                                files_changed: session.metrics.files_changed,
                                duration_secs: session.metrics.duration_secs,
                                task_preview: truncate_for_dashboard(&session.task, 40),
                                branch: session
                                    .worktree
                                    .as_ref()
                                    .map(|worktree| worktree.branch.clone()),
                                last_output_preview: self
                                    .db
                                    .get_output_lines(&child_id, 1)
                                    .ok()
                                    .and_then(|lines| lines.last().cloned())
                                    .map(|line| truncate_for_dashboard(&line.text, 48)),
                            });
                            delegated.push(DelegatedChildSummary {
                                worktree_health: self
                                    .worktree_health_by_session
                                    .get(&session.id)
                                    .copied(),
                                approval_backlog,
                                handoff_backlog,
                                state,
                                session_id: child_id,
                                tokens_used: session.metrics.tokens_used,
                                files_changed: session.metrics.files_changed,
                                duration_secs: session.metrics.duration_secs,
                                task_preview: truncate_for_dashboard(&session.task, 40),
                                branch: session
                                    .worktree
                                    .as_ref()
                                    .map(|worktree| worktree.branch.clone()),
                                last_output_preview: self
                                    .db
                                    .get_output_lines(&session.id, 1)
                                    .ok()
                                    .and_then(|lines| lines.last().cloned())
                                    .map(|line| truncate_for_dashboard(&line.text, 48)),
                            });
                        }
                        Ok(None) => {}
                        Err(error) => {
                            tracing::warn!(
                                "Failed to load delegated child session {}: {error}",
                                child_id
                            );
                        }
                    }
                }

                self.selected_team_summary = if team.total > 0 { Some(team) } else { None };
                let selected_agent_type = self
                    .selected_agent_type()
                    .unwrap_or(self.cfg.default_agent.as_str())
                    .to_string();
                self.selected_route_preview = self.build_route_preview(
                    &session_id,
                    &selected_agent_type,
                    team.total,
                    &route_candidates,
                );
                delegated.sort_by_key(|delegate| {
                    (
                        delegate_attention_priority(delegate),
                        std::cmp::Reverse(delegate.approval_backlog),
                        std::cmp::Reverse(delegate.handoff_backlog),
                        delegate.session_id.clone(),
                    )
                });
                delegated
            }
            Err(error) => {
                tracing::warn!("Failed to load delegated child sessions: {error}");
                self.selected_team_summary = None;
                self.selected_route_preview = None;
                Vec::new()
            }
        };
        self.sync_focused_delegate_selection();
    }

    fn build_route_preview(
        &self,
        lead_id: &str,
        lead_agent_type: &str,
        delegate_count: usize,
        delegates: &[DelegatedChildSummary],
    ) -> Option<String> {
        if let Some(task) = self.latest_route_task(lead_id) {
            if let Ok(preview) = manager::preview_assignment_for_task(
                &self.db,
                &self.cfg,
                lead_id,
                &task,
                lead_agent_type,
            ) {
                return Some(self.format_assignment_preview(&task, &preview));
            }
        }

        if let Some(idle_clear) = delegates
            .iter()
            .filter(|delegate| {
                delegate.state == SessionState::Idle && delegate.handoff_backlog == 0
            })
            .min_by_key(|delegate| delegate.session_id.as_str())
        {
            return Some(format!(
                "reuse idle {}",
                format_session_id(&idle_clear.session_id)
            ));
        }

        if delegate_count < self.cfg.max_parallel_sessions {
            return Some("spawn new delegate".to_string());
        }

        if let Some(idle_backed_up) = delegates
            .iter()
            .filter(|delegate| delegate.state == SessionState::Idle)
            .min_by_key(|delegate| (delegate.handoff_backlog, delegate.session_id.as_str()))
        {
            return Some(format!(
                "defer; idle {} backlog {}",
                format_session_id(&idle_backed_up.session_id),
                idle_backed_up.handoff_backlog
            ));
        }

        if let Some(active_delegate) = delegates
            .iter()
            .filter(|delegate| {
                matches!(
                    delegate.state,
                    SessionState::Running | SessionState::Pending
                )
            })
            .min_by_key(|delegate| (delegate.handoff_backlog, delegate.session_id.as_str()))
        {
            return Some(format!(
                "{} active {}{}",
                if active_delegate.handoff_backlog > 0 {
                    "defer;"
                } else {
                    "reuse"
                },
                format_session_id(&active_delegate.session_id),
                if active_delegate.handoff_backlog > 0 {
                    format!(" backlog {}", active_delegate.handoff_backlog)
                } else {
                    String::new()
                }
            ));
        }

        if delegate_count == 0 {
            Some("spawn new delegate".to_string())
        } else {
            Some("spawn fallback delegate".to_string())
        }
    }

    fn latest_route_task(&self, session_id: &str) -> Option<String> {
        self.db
            .list_messages_for_session(session_id, 16)
            .ok()?
            .into_iter()
            .rev()
            .find_map(|message| {
                if message.to_session != session_id || message.msg_type != "task_handoff" {
                    return None;
                }
                manager::parse_task_handoff_task(&message.content).or_else(|| Some(message.content))
            })
    }

    fn format_assignment_preview(
        &self,
        task: &str,
        preview: &manager::AssignmentPreview,
    ) -> String {
        let task_preview = truncate_for_dashboard(task, 40);
        let graph_suffix = if preview.graph_match_terms.is_empty() {
            String::new()
        } else {
            format!(
                " | graph {}",
                truncate_for_dashboard(&preview.graph_match_terms.join(", "), 36)
            )
        };

        match preview.action {
            manager::AssignmentAction::Spawned => {
                format!("for `{task_preview}` spawn new delegate")
            }
            manager::AssignmentAction::ReusedIdle => format!(
                "for `{task_preview}` reuse idle {}{}",
                preview
                    .session_id
                    .as_deref()
                    .map(format_session_id)
                    .unwrap_or_else(|| "unknown".to_string()),
                graph_suffix
            ),
            manager::AssignmentAction::ReusedActive => format!(
                "for `{task_preview}` reuse active {}{}",
                preview
                    .session_id
                    .as_deref()
                    .map(format_session_id)
                    .unwrap_or_else(|| "unknown".to_string()),
                graph_suffix
            ),
            manager::AssignmentAction::DeferredSaturated => {
                let state_label = match preview.delegate_state {
                    Some(SessionState::Idle) => "idle",
                    Some(SessionState::Running) | Some(SessionState::Pending) => "active",
                    _ => "delegate",
                };
                format!(
                    "for `{task_preview}` defer; {state_label} {} backlog {}{}",
                    preview
                        .session_id
                        .as_deref()
                        .map(format_session_id)
                        .unwrap_or_else(|| "unknown".to_string()),
                    preview.handoff_backlog,
                    graph_suffix
                )
            }
        }
    }

    fn selected_session_id(&self) -> Option<&str> {
        self.sessions
            .get(self.selected_session)
            .map(|session| session.id.as_str())
    }

    fn selected_output_lines(&self) -> &[OutputLine] {
        self.selected_session_id()
            .and_then(|session_id| self.session_output_cache.get(session_id))
            .map(Vec::as_slice)
            .unwrap_or(&[])
    }

    fn selected_agent_type(&self) -> Option<&str> {
        self.sessions
            .get(self.selected_session)
            .map(|session| session.agent_type.as_str())
    }

    fn search_agent_filter_label(&self) -> String {
        self.search_agent_filter
            .label(self.selected_agent_type().unwrap_or("selected agent"))
            .to_string()
    }

    fn search_agent_title_suffix(&self) -> String {
        match self.selected_agent_type() {
            Some(agent_type) => self
                .search_agent_filter
                .title_suffix(agent_type)
                .to_string(),
            None => String::new(),
        }
    }

    fn visible_output_lines_for_session(&self, session_id: &str) -> Vec<&OutputLine> {
        self.session_output_cache
            .get(session_id)
            .map(|lines| {
                lines
                    .iter()
                    .filter(|line| {
                        self.output_filter.matches(line) && self.output_time_filter.matches(line)
                    })
                    .collect()
            })
            .unwrap_or_default()
    }

    fn visible_output_lines(&self) -> Vec<&OutputLine> {
        self.selected_session_id()
            .map(|session_id| self.visible_output_lines_for_session(session_id))
            .unwrap_or_default()
    }

    fn visible_graph_lines(&self) -> Vec<GraphDisplayLine> {
        let session_scope = match self.search_scope {
            SearchScope::SelectedSession => self.selected_session_id(),
            SearchScope::AllSessions => None,
        };
        let entity_type = self.graph_entity_filter.entity_type();
        let entities = self
            .db
            .list_context_entities(session_scope, entity_type, 48)
            .unwrap_or_default();
        let show_session_label = self.search_scope == SearchScope::AllSessions;

        entities
            .into_iter()
            .filter(|entity| self.output_time_filter.matches_timestamp(entity.updated_at))
            .flat_map(|entity| self.graph_lines_for_entity(entity, show_session_label))
            .collect()
    }

    fn graph_lines_for_entity(
        &self,
        entity: crate::session::ContextGraphEntity,
        show_session_label: bool,
    ) -> Vec<GraphDisplayLine> {
        let session_id = entity.session_id.clone().unwrap_or_default();
        let session_label = if show_session_label {
            if session_id.is_empty() {
                "global ".to_string()
            } else {
                format!("{} ", format_session_id(&session_id))
            }
        } else {
            String::new()
        };
        let entity_title = format!(
            "[{}] {}{:<8} {}",
            entity.updated_at.format("%H:%M:%S"),
            session_label,
            entity.entity_type,
            entity.name
        );
        let mut lines = vec![GraphDisplayLine {
            session_id: session_id.clone(),
            text: entity_title,
        }];

        if let Some(path) = entity.path.as_ref() {
            lines.push(GraphDisplayLine {
                session_id: session_id.clone(),
                text: format!("               path {}", truncate_for_dashboard(path, 96)),
            });
        }

        if !entity.summary.trim().is_empty() {
            lines.push(GraphDisplayLine {
                session_id: session_id.clone(),
                text: format!(
                    "               summary {}",
                    truncate_for_dashboard(&entity.summary, 96)
                ),
            });
        }

        if let Ok(Some(detail)) = self.db.get_context_entity_detail(entity.id, 2) {
            for relation in detail.outgoing {
                lines.push(GraphDisplayLine {
                    session_id: session_id.clone(),
                    text: format!(
                        "               -> {} {}:{}",
                        relation.relation_type,
                        relation.to_entity_type,
                        truncate_for_dashboard(&relation.to_entity_name, 72)
                    ),
                });
            }
            for relation in detail.incoming {
                lines.push(GraphDisplayLine {
                    session_id: session_id.clone(),
                    text: format!(
                        "               <- {} {}:{}",
                        relation.relation_type,
                        relation.from_entity_type,
                        truncate_for_dashboard(&relation.from_entity_name, 72)
                    ),
                });
            }
        }

        lines
    }

    fn session_graph_metrics_lines(&self, session_id: &str) -> Vec<String> {
        let entity = self
            .db
            .list_context_entities(Some(session_id), Some("session"), 4)
            .unwrap_or_default()
            .into_iter()
            .find(|entity| {
                entity.session_id.as_deref() == Some(session_id) || entity.name == session_id
            });
        let Some(entity) = entity else {
            return Vec::new();
        };

        let Ok(Some(detail)) = self
            .db
            .get_context_entity_detail(entity.id, MAX_METRICS_GRAPH_RELATIONS)
        else {
            return Vec::new();
        };

        if detail.outgoing.is_empty() && detail.incoming.is_empty() {
            return Vec::new();
        }

        let mut lines = vec![
            "Context graph".to_string(),
            format!(
                "- outgoing {} | incoming {}",
                detail.outgoing.len(),
                detail.incoming.len()
            ),
        ];

        for relation in detail.outgoing.iter().take(4) {
            lines.push(format!(
                "- -> {} {}:{}",
                relation.relation_type,
                relation.to_entity_type,
                truncate_for_dashboard(&relation.to_entity_name, 72)
            ));
        }

        for relation in detail.incoming.iter().take(2) {
            lines.push(format!(
                "- <- {} {}:{}",
                relation.relation_type,
                relation.from_entity_type,
                truncate_for_dashboard(&relation.from_entity_name, 72)
            ));
        }

        lines
    }

    fn session_graph_recall_lines(&self, session: &Session) -> Vec<String> {
        let query = session.task.trim();
        if query.is_empty() {
            return Vec::new();
        }

        let Ok(entries) = self.db.recall_context_entities(None, query, 4) else {
            return Vec::new();
        };

        let entries = entries
            .into_iter()
            .filter(|entry| {
                !(entry.entity.entity_type == "session" && entry.entity.name == session.id)
            })
            .take(3)
            .collect::<Vec<_>>();
        if entries.is_empty() {
            return Vec::new();
        }

        let mut lines = vec!["Relevant memory".to_string()];
        for entry in entries {
            let mut line = format!(
                "- #{} [{}] {} | score {} | relations {} | observations {} | priority {}",
                entry.entity.id,
                entry.entity.entity_type,
                truncate_for_dashboard(&entry.entity.name, 60),
                entry.score,
                entry.relation_count,
                entry.observation_count,
                entry.max_observation_priority
            );
            if entry.has_pinned_observation {
                line.push_str(" | pinned");
            }
            if let Some(session_id) = entry.entity.session_id.as_deref() {
                if session_id != session.id {
                    line.push_str(&format!(" | {}", format_session_id(session_id)));
                }
            }
            lines.push(line);
            if !entry.matched_terms.is_empty() {
                lines.push(format!("  matches {}", entry.matched_terms.join(", ")));
            }
            if let Some(path) = entry.entity.path.as_deref() {
                lines.push(format!("  path {}", truncate_for_dashboard(path, 72)));
            }
            if !entry.entity.summary.is_empty() {
                lines.push(format!(
                    "  summary {}",
                    truncate_for_dashboard(&entry.entity.summary, 72)
                ));
            }
            if let Ok(observations) = self.db.list_context_observations(Some(entry.entity.id), 1) {
                if let Some(observation) = observations.first() {
                    lines.push(format!(
                        "  memory [{}{}] {}",
                        observation.priority,
                        if observation.pinned { "/pinned" } else { "" },
                        truncate_for_dashboard(&observation.summary, 72)
                    ));
                }
            }
        }

        lines
    }

    fn visible_git_status_lines(&self) -> Vec<Line<'static>> {
        self.selected_git_status_entries
            .iter()
            .enumerate()
            .map(|(index, entry)| {
                let marker = if index == self.selected_git_status {
                    ">>"
                } else {
                    "-"
                };
                let mut flags = Vec::new();
                if entry.conflicted {
                    flags.push("conflict");
                }
                if entry.staged {
                    flags.push("staged");
                }
                if entry.unstaged {
                    flags.push("unstaged");
                }
                if entry.untracked {
                    flags.push("untracked");
                }
                let flag_text = if flags.is_empty() {
                    "clean".to_string()
                } else {
                    flags.join(",")
                };
                Line::from(format!(
                    "{} [{}{}] [{}] {}",
                    marker,
                    entry.index_status,
                    entry.worktree_status,
                    flag_text,
                    entry.display_path
                ))
            })
            .collect()
    }

    fn visible_timeline_lines(&self) -> Vec<Line<'static>> {
        let show_session_label = self.timeline_scope == SearchScope::AllSessions;
        self.timeline_events()
            .into_iter()
            .filter(|event| self.timeline_event_filter.matches(event.event_type))
            .filter(|event| self.output_time_filter.matches_timestamp(event.occurred_at))
            .flat_map(|event| {
                let prefix = if show_session_label {
                    format!("{} ", format_session_id(&event.session_id))
                } else {
                    String::new()
                };
                let mut lines = vec![Line::from(format!(
                    "[{}] {}{:<11} {}",
                    event.occurred_at.format("%H:%M:%S"),
                    prefix,
                    event.event_type.label(),
                    event.summary
                ))];
                lines.extend(
                    event
                        .detail_lines
                        .into_iter()
                        .map(|line| Line::from(format!("               {}", line))),
                );
                lines
            })
            .collect()
    }

    fn timeline_events(&self) -> Vec<TimelineEvent> {
        let mut events = match self.timeline_scope {
            SearchScope::SelectedSession => self
                .sessions
                .get(self.selected_session)
                .map(|session| self.session_timeline_events(session))
                .unwrap_or_default(),
            SearchScope::AllSessions => self
                .sessions
                .iter()
                .flat_map(|session| self.session_timeline_events(session))
                .collect(),
        };
        events.sort_by(|left, right| {
            left.occurred_at
                .cmp(&right.occurred_at)
                .then_with(|| left.session_id.cmp(&right.session_id))
                .then_with(|| left.summary.cmp(&right.summary))
        });
        events
    }

    fn session_timeline_events(&self, session: &Session) -> Vec<TimelineEvent> {
        let mut events = vec![TimelineEvent {
            occurred_at: session.created_at,
            session_id: session.id.clone(),
            event_type: TimelineEventType::Lifecycle,
            summary: format!(
                "created session as {} for {}",
                session.agent_type,
                truncate_for_dashboard(&session.task, 64)
            ),
            detail_lines: Vec::new(),
        }];

        if session.updated_at > session.created_at {
            events.push(TimelineEvent {
                occurred_at: session.updated_at,
                session_id: session.id.clone(),
                event_type: TimelineEventType::Lifecycle,
                summary: format!("state {} | updated session metadata", session.state),
                detail_lines: Vec::new(),
            });
        }

        if let Some(worktree) = session.worktree.as_ref() {
            events.push(TimelineEvent {
                occurred_at: session.updated_at,
                session_id: session.id.clone(),
                event_type: TimelineEventType::Lifecycle,
                summary: format!(
                    "attached worktree {} from {}",
                    worktree.branch, worktree.base_branch
                ),
                detail_lines: Vec::new(),
            });
        }

        let file_activity = self
            .db
            .list_file_activity(&session.id, 64)
            .unwrap_or_default();
        if file_activity.is_empty() && session.metrics.files_changed > 0 {
            events.push(TimelineEvent {
                occurred_at: session.updated_at,
                session_id: session.id.clone(),
                event_type: TimelineEventType::FileChange,
                summary: format!("files touched {}", session.metrics.files_changed),
                detail_lines: Vec::new(),
            });
        } else {
            events.extend(file_activity.into_iter().map(|entry| TimelineEvent {
                occurred_at: entry.timestamp,
                session_id: session.id.clone(),
                event_type: TimelineEventType::FileChange,
                summary: file_activity_summary(&entry),
                detail_lines: file_activity_patch_lines(&entry, MAX_FILE_ACTIVITY_PATCH_LINES),
            }));
        }

        let messages = self
            .db
            .list_messages_for_session(&session.id, 128)
            .unwrap_or_default();
        events.extend(messages.into_iter().map(|message| {
            let (direction, counterpart) = if message.from_session == session.id {
                ("sent", format_session_id(&message.to_session))
            } else {
                ("received", format_session_id(&message.from_session))
            };
            TimelineEvent {
                occurred_at: message.timestamp,
                session_id: session.id.clone(),
                event_type: TimelineEventType::Message,
                summary: format!(
                    "{direction} {} {} | {}",
                    message.msg_type,
                    counterpart,
                    truncate_for_dashboard(
                        &comms::preview(&message.msg_type, &message.content),
                        64
                    )
                ),
                detail_lines: Vec::new(),
            }
        }));

        let decisions = self
            .db
            .list_decisions_for_session(&session.id, 32)
            .unwrap_or_default();
        events.extend(decisions.into_iter().map(|entry| TimelineEvent {
            occurred_at: entry.timestamp,
            session_id: session.id.clone(),
            event_type: TimelineEventType::Decision,
            summary: decision_log_summary(&entry),
            detail_lines: decision_log_detail_lines(&entry),
        }));

        let tool_logs = self
            .db
            .query_tool_logs(&session.id, 1, 128)
            .map(|page| page.entries)
            .unwrap_or_default();
        events.extend(tool_logs.into_iter().filter_map(|entry| {
            parse_rfc3339_to_utc(&entry.timestamp).map(|occurred_at| TimelineEvent {
                occurred_at,
                session_id: session.id.clone(),
                event_type: TimelineEventType::ToolCall,
                summary: format!(
                    "tool {} | {}ms | {}",
                    entry.tool_name,
                    entry.duration_ms,
                    truncate_for_dashboard(&entry.input_summary, 56)
                ),
                detail_lines: tool_log_detail_lines(&entry),
            })
        }));
        events
    }

    fn recompute_search_matches(&mut self) {
        let Some(query) = self.search_query.clone() else {
            self.search_matches.clear();
            self.selected_search_match = 0;
            return;
        };

        let Ok(regex) = compile_search_regex(&query) else {
            self.search_matches.clear();
            self.selected_search_match = 0;
            return;
        };

        self.search_matches = if self.output_mode == OutputMode::ContextGraph {
            self.visible_graph_lines()
                .into_iter()
                .enumerate()
                .filter_map(|(index, line)| {
                    regex.is_match(&line.text).then_some(SearchMatch {
                        session_id: line.session_id,
                        line_index: index,
                    })
                })
                .collect()
        } else {
            self.search_target_session_ids()
                .into_iter()
                .flat_map(|session_id| {
                    self.visible_output_lines_for_session(session_id)
                        .into_iter()
                        .enumerate()
                        .filter_map(|(index, line)| {
                            regex.is_match(&line.text).then_some(SearchMatch {
                                session_id: session_id.to_string(),
                                line_index: index,
                            })
                        })
                        .collect::<Vec<_>>()
                })
                .collect()
        };

        if self.search_matches.is_empty() {
            self.selected_search_match = 0;
            return;
        }

        self.selected_search_match = self
            .selected_search_match
            .min(self.search_matches.len().saturating_sub(1));
        self.focus_selected_search_match();
    }

    fn focus_selected_search_match(&mut self) {
        let Some(search_match) = self.search_matches.get(self.selected_search_match).cloned()
        else {
            return;
        };

        if !search_match.session_id.is_empty()
            && self.selected_session_id() != Some(search_match.session_id.as_str())
        {
            self.sync_selection_by_id(Some(&search_match.session_id));
            self.sync_selected_output();
            self.sync_selected_diff();
            self.sync_selected_messages();
            self.sync_selected_lineage();
            self.refresh_logs();
        }

        self.output_follow = false;
        let viewport_height = self.last_output_height.max(1);
        let offset = search_match
            .line_index
            .saturating_sub(viewport_height.saturating_sub(1) / 2);
        self.output_scroll_offset = offset.min(self.max_output_scroll());
    }

    fn search_navigation_note(&self) -> String {
        let query = self.search_query.as_deref().unwrap_or_default();
        let total = self.search_matches.len();
        let current = if total == 0 {
            0
        } else {
            self.selected_search_match.min(total.saturating_sub(1)) + 1
        };

        let mode = if self.output_mode == OutputMode::ContextGraph {
            "graph search"
        } else {
            "search"
        };
        format!(
            "{mode} /{query} match {current}/{total} | {}",
            self.search_scope.label()
        )
    }

    fn search_match_session_count(&self) -> usize {
        self.search_matches
            .iter()
            .filter(|search_match| !search_match.session_id.is_empty())
            .map(|search_match| search_match.session_id.as_str())
            .collect::<HashSet<_>>()
            .len()
    }

    fn search_target_session_ids(&self) -> Vec<&str> {
        let selected_session_id = self.selected_session_id();
        let selected_agent_type = self.selected_agent_type();

        self.sessions
            .iter()
            .filter(|session| {
                self.search_scope
                    .matches(selected_session_id, session.id.as_str())
                    && self
                        .search_agent_filter
                        .matches(selected_agent_type, session.agent_type.as_str())
            })
            .map(|session| session.id.as_str())
            .collect()
    }

    fn next_approval_target_session_id(&self) -> Option<String> {
        let pending_items: usize = self.approval_queue_counts.values().sum();
        if pending_items == 0 {
            return None;
        }

        let active_session_ids: HashSet<_> =
            self.sessions.iter().map(|session| &session.id).collect();
        let queue = self.db.unread_approval_queue(pending_items).ok()?;
        let mut seen = HashSet::new();
        let ordered_targets = queue
            .into_iter()
            .filter_map(|message| {
                if active_session_ids.contains(&message.to_session)
                    && seen.insert(message.to_session.clone())
                {
                    Some(message.to_session)
                } else {
                    None
                }
            })
            .collect::<Vec<_>>();

        if ordered_targets.is_empty() {
            return None;
        }

        let current_session_id = self.selected_session_id();
        current_session_id
            .and_then(|session_id| {
                ordered_targets
                    .iter()
                    .position(|target_session_id| target_session_id == session_id)
                    .map(|index| ordered_targets[(index + 1) % ordered_targets.len()].clone())
            })
            .or_else(|| ordered_targets.first().cloned())
    }

    fn sync_output_scroll(&mut self, viewport_height: usize) {
        self.last_output_height = viewport_height.max(1);
        if self.output_mode == OutputMode::GitStatus {
            let max_scroll = self.max_output_scroll();
            let centered = self
                .selected_git_status
                .saturating_sub(self.last_output_height.max(1).saturating_sub(1) / 2);
            self.output_scroll_offset = centered.min(max_scroll);
            return;
        }
        let max_scroll = self.max_output_scroll();

        if self.output_follow {
            self.output_scroll_offset = max_scroll;
        } else {
            self.output_scroll_offset = self.output_scroll_offset.min(max_scroll);
        }
    }

    fn max_output_scroll(&self) -> usize {
        let total_lines = if self.output_mode == OutputMode::GitStatus {
            self.selected_git_status_entries.len()
        } else if matches!(
            self.output_mode,
            OutputMode::WorktreeDiff | OutputMode::GitPatch
        ) {
            self.active_patch_text()
                .map(|patch| patch.lines().count())
                .unwrap_or(0)
        } else if self.output_mode == OutputMode::ContextGraph {
            self.visible_graph_lines().len()
        } else if self.output_mode == OutputMode::Timeline {
            self.visible_timeline_lines().len()
        } else {
            self.visible_output_lines().len()
        };
        total_lines.saturating_sub(self.last_output_height.max(1))
    }

    fn sync_metrics_scroll(&mut self, viewport_height: usize) {
        self.last_metrics_height = viewport_height.max(1);
        let max_scroll = self.max_metrics_scroll();
        self.metrics_scroll_offset = self.metrics_scroll_offset.min(max_scroll);
    }

    fn max_metrics_scroll(&self) -> usize {
        self.selected_session_metrics_text()
            .lines()
            .count()
            .saturating_sub(self.last_metrics_height.max(1))
    }

    fn focused_delegate_index(&self) -> Option<usize> {
        if self.selected_child_sessions.is_empty() {
            return None;
        }

        self.focused_delegate_session_id
            .as_deref()
            .and_then(|session_id| {
                self.selected_child_sessions
                    .iter()
                    .position(|delegate| delegate.session_id == session_id)
            })
            .or(Some(0))
    }

    fn set_focused_delegate_by_index(&mut self, index: usize) {
        let Some(delegate) = self.selected_child_sessions.get(index) else {
            return;
        };
        let delegate_session_id = delegate.session_id.clone();

        self.focused_delegate_session_id = Some(delegate_session_id.clone());
        self.ensure_focused_delegate_visible();
        self.set_operator_note(format!(
            "focused delegate {}",
            format_session_id(&delegate_session_id)
        ));
    }

    fn sync_focused_delegate_selection(&mut self) {
        self.focused_delegate_session_id = self
            .focused_delegate_index()
            .and_then(|index| self.selected_child_sessions.get(index))
            .map(|delegate| delegate.session_id.clone());
        self.ensure_focused_delegate_visible();
    }

    fn ensure_focused_delegate_visible(&mut self) {
        let Some(delegate_index) = self.focused_delegate_index() else {
            return;
        };
        let Some(line_index) = self.delegate_metrics_line_index(delegate_index) else {
            return;
        };

        let viewport_height = self.last_metrics_height.max(1);
        if line_index < self.metrics_scroll_offset {
            self.metrics_scroll_offset = line_index;
        } else if line_index >= self.metrics_scroll_offset + viewport_height {
            self.metrics_scroll_offset =
                line_index.saturating_sub(viewport_height.saturating_sub(1));
        }
        self.metrics_scroll_offset = self.metrics_scroll_offset.min(self.max_metrics_scroll());
    }

    fn delegate_metrics_line_index(&self, target_index: usize) -> Option<usize> {
        if target_index >= self.selected_child_sessions.len() {
            return None;
        }

        let mut line_index = self.metrics_line_count_before_delegates();
        for delegate in self.selected_child_sessions.iter().take(target_index) {
            line_index += 1;
            if delegate.last_output_preview.is_some() {
                line_index += 1;
            }
        }

        Some(line_index)
    }

    fn metrics_line_count_before_delegates(&self) -> usize {
        if self.sessions.get(self.selected_session).is_none() {
            return 0;
        }

        let mut line_count = 2;
        if self.selected_parent_session.is_some() {
            line_count += 1;
        }
        if self.selected_team_summary.is_some() {
            line_count += 1;
        }
        line_count += 1;
        line_count += 1;

        let stabilized = self.daemon_activity.stabilized_after_recovery_at();
        if self.daemon_activity.chronic_saturation_streak > 0 {
            line_count += 1;
        }
        if self.daemon_activity.operator_escalation_required() {
            line_count += 1;
        }
        if self
            .daemon_activity
            .chronic_saturation_cleared_at()
            .is_some()
        {
            line_count += 1;
        }
        if stabilized.is_some() {
            line_count += 1;
        }
        if self.daemon_activity.last_dispatch_at.is_some() {
            line_count += 1;
        }
        if stabilized.is_none() {
            if self.daemon_activity.last_recovery_dispatch_at.is_some() {
                line_count += 1;
            }
            if self.daemon_activity.last_rebalance_at.is_some() {
                line_count += 1;
            }
        }
        if self.daemon_activity.last_auto_merge_at.is_some() {
            line_count += 1;
        }
        if self.daemon_activity.last_auto_prune_at.is_some() {
            line_count += 1;
        }
        if self.selected_route_preview.is_some() {
            line_count += 1;
        }
        if !self.selected_child_sessions.is_empty() {
            line_count += 1;
        }

        line_count
    }

    #[cfg(test)]
    fn visible_output_text(&self) -> String {
        self.visible_output_lines()
            .iter()
            .map(|line| line.text.clone())
            .collect::<Vec<_>>()
            .join("\n")
    }

    fn reset_output_view(&mut self) {
        self.output_follow = true;
        self.output_scroll_offset = 0;
    }

    fn reset_metrics_view(&mut self) {
        self.metrics_scroll_offset = 0;
    }

    fn refresh_logs(&mut self) {
        let Some(session_id) = self.selected_session_id().map(ToOwned::to_owned) else {
            self.logs.clear();
            return;
        };

        match self.db.query_tool_logs(&session_id, 1, MAX_LOG_ENTRIES) {
            Ok(page) => self.logs = page.entries,
            Err(error) => {
                tracing::warn!("Failed to load tool logs: {error}");
                self.logs.clear();
            }
        }
    }

    fn aggregate_usage(&self) -> AggregateUsage {
        let thresholds = self.cfg.effective_budget_alert_thresholds();
        let total_tokens = self
            .sessions
            .iter()
            .map(|session| session.metrics.tokens_used)
            .sum();
        let total_cost_usd = self
            .sessions
            .iter()
            .map(|session| session.metrics.cost_usd)
            .sum::<f64>();
        let token_state = budget_state(
            total_tokens as f64,
            self.cfg.token_budget as f64,
            thresholds,
        );
        let cost_state = budget_state(total_cost_usd, self.cfg.cost_budget_usd, thresholds);

        AggregateUsage {
            total_tokens,
            total_cost_usd,
            token_state,
            cost_state,
            overall_state: token_state.max(cost_state),
        }
    }

    fn selected_session_metrics_text(&self) -> String {
        if let Some(session) = self.sessions.get(self.selected_session) {
            let metrics = &session.metrics;
            let selected_profile = self.db.get_session_profile(&session.id).ok().flatten();
            let group_peers = self
                .sessions
                .iter()
                .filter(|candidate| {
                    candidate.project == session.project
                        && candidate.task_group == session.task_group
                })
                .count();
            let mut lines = vec![
                format!(
                    "Selected {} [{}]",
                    &session.id[..8.min(session.id.len())],
                    session.state
                ),
                format!("Task {}", session.task),
                format!(
                    "Project {} | Group {} | Peer sessions {}",
                    session.project, session.task_group, group_peers
                ),
            ];

            if let Some(profile) = selected_profile.as_ref() {
                let model = profile.model.as_deref().unwrap_or("default");
                let permission_mode = profile.permission_mode.as_deref().unwrap_or("default");
                lines.push(format!(
                    "Profile {} | Model {} | Permissions {}",
                    profile.profile_name, model, permission_mode
                ));
                let mut profile_details = Vec::new();
                if let Some(token_budget) = profile.token_budget {
                    profile_details.push(format!(
                        "Profile tokens {}",
                        format_token_count(token_budget)
                    ));
                }
                if let Some(max_budget_usd) = profile.max_budget_usd {
                    profile_details
                        .push(format!("Profile cost {}", format_currency(max_budget_usd)));
                }
                if !profile.allowed_tools.is_empty() {
                    profile_details.push(format!(
                        "Allow {}",
                        truncate_for_dashboard(&profile.allowed_tools.join(", "), 36)
                    ));
                }
                if !profile.disallowed_tools.is_empty() {
                    profile_details.push(format!(
                        "Deny {}",
                        truncate_for_dashboard(&profile.disallowed_tools.join(", "), 36)
                    ));
                }
                if !profile.add_dirs.is_empty() {
                    profile_details.push(format!(
                        "Dirs {}",
                        truncate_for_dashboard(
                            &profile
                                .add_dirs
                                .iter()
                                .map(|path| path.display().to_string())
                                .collect::<Vec<_>>()
                                .join(", "),
                            36
                        )
                    ));
                }
                if !profile_details.is_empty() {
                    lines.push(profile_details.join(" | "));
                }
            }

            if let Some(parent) = self.selected_parent_session.as_ref() {
                lines.push(format!("Delegated from {}", format_session_id(parent)));
            }

            if let Some(team) = self.selected_team_summary {
                lines.push(format!(
                    "Team {}/{} | idle {} | running {} | pending {} | failed {} | stopped {}",
                    team.total,
                    self.cfg.max_parallel_sessions,
                    team.idle,
                    team.running,
                    team.pending,
                    team.failed,
                    team.stopped
                ));
            }

            lines.push(format!(
                "Global handoff backlog {} lead(s) / {} handoff(s) | Auto-dispatch {} @ {}/lead | Auto-worktree {} | Auto-merge {}",
                self.global_handoff_backlog_leads,
                self.global_handoff_backlog_messages,
                if self.cfg.auto_dispatch_unread_handoffs {
                    "on"
                } else {
                    "off"
                },
                self.cfg.auto_dispatch_limit_per_session,
                if self.cfg.auto_create_worktrees {
                    "on"
                } else {
                    "off"
                },
                if self.cfg.auto_merge_ready_worktrees {
                    "on"
                } else {
                    "off"
                }
            ));

            let stabilized = self.daemon_activity.stabilized_after_recovery_at();

            lines.push(format!(
                "Coordination mode {}",
                if self.daemon_activity.dispatch_cooloff_active() {
                    "rebalance-cooloff (chronic saturation)"
                } else if self.daemon_activity.prefers_rebalance_first() {
                    "rebalance-first (chronic saturation)"
                } else if stabilized.is_some() {
                    "dispatch-first (stabilized)"
                } else {
                    "dispatch-first"
                }
            ));

            if self.daemon_activity.chronic_saturation_streak > 0 {
                lines.push(format!(
                    "Chronic saturation streak {} cycle(s)",
                    self.daemon_activity.chronic_saturation_streak
                ));
            }

            if self.daemon_activity.operator_escalation_required() {
                lines.push(
                    "Operator escalation recommended: chronic saturation is not clearing".into(),
                );
            }

            if let Some(cleared_at) = self.daemon_activity.chronic_saturation_cleared_at() {
                lines.push(format!(
                    "Chronic saturation cleared @ {}",
                    self.short_timestamp(&cleared_at.to_rfc3339())
                ));
            }

            if let Some(stabilized_at) = stabilized {
                lines.push(format!(
                    "Recovery stabilized @ {}",
                    self.short_timestamp(&stabilized_at.to_rfc3339())
                ));
            }

            if let Some(last_dispatch_at) = self.daemon_activity.last_dispatch_at.as_ref() {
                lines.push(format!(
                    "Last daemon dispatch {} routed / {} deferred across {} lead(s) @ {}",
                    self.daemon_activity.last_dispatch_routed,
                    self.daemon_activity.last_dispatch_deferred,
                    self.daemon_activity.last_dispatch_leads,
                    self.short_timestamp(&last_dispatch_at.to_rfc3339())
                ));
            }

            if stabilized.is_none() {
                if let Some(last_recovery_dispatch_at) =
                    self.daemon_activity.last_recovery_dispatch_at.as_ref()
                {
                    lines.push(format!(
                        "Last daemon recovery dispatch {} handoff(s) across {} lead(s) @ {}",
                        self.daemon_activity.last_recovery_dispatch_routed,
                        self.daemon_activity.last_recovery_dispatch_leads,
                        self.short_timestamp(&last_recovery_dispatch_at.to_rfc3339())
                    ));
                }

                if let Some(last_rebalance_at) = self.daemon_activity.last_rebalance_at.as_ref() {
                    lines.push(format!(
                        "Last daemon rebalance {} handoff(s) across {} lead(s) @ {}",
                        self.daemon_activity.last_rebalance_rerouted,
                        self.daemon_activity.last_rebalance_leads,
                        self.short_timestamp(&last_rebalance_at.to_rfc3339())
                    ));
                }
            }

            if let Some(last_auto_merge_at) = self.daemon_activity.last_auto_merge_at.as_ref() {
                lines.push(format!(
                    "Last daemon auto-merge {} merged / {} active / {} conflicted / {} dirty / {} failed @ {}",
                    self.daemon_activity.last_auto_merge_merged,
                    self.daemon_activity.last_auto_merge_active_skipped,
                    self.daemon_activity.last_auto_merge_conflicted_skipped,
                    self.daemon_activity.last_auto_merge_dirty_skipped,
                    self.daemon_activity.last_auto_merge_failed,
                    self.short_timestamp(&last_auto_merge_at.to_rfc3339())
                ));
            }

            if let Some(last_auto_prune_at) = self.daemon_activity.last_auto_prune_at.as_ref() {
                lines.push(format!(
                    "Last daemon auto-prune {} pruned / {} active @ {}",
                    self.daemon_activity.last_auto_prune_pruned,
                    self.daemon_activity.last_auto_prune_active_skipped,
                    self.short_timestamp(&last_auto_prune_at.to_rfc3339())
                ));
            }

            if let Some(route_preview) = self.selected_route_preview.as_ref() {
                lines.push(format!("Next route {route_preview}"));
            }

            if !self.selected_child_sessions.is_empty() {
                lines.push("Delegates".to_string());
                for child in &self.selected_child_sessions {
                    let mut child_line = format!(
                        "{} {} [{}] | next {}",
                        if self.focused_delegate_session_id.as_deref()
                            == Some(child.session_id.as_str())
                        {
                            ">>"
                        } else {
                            "-"
                        },
                        format_session_id(&child.session_id),
                        session_state_label(&child.state),
                        delegate_next_action(child)
                    );
                    if let Some(worktree_health) = child.worktree_health {
                        child_line.push_str(&format!(
                            " | worktree {}",
                            delegate_worktree_health_label(worktree_health)
                        ));
                    }
                    child_line.push_str(&format!(
                        " | approvals {} | backlog {} | progress {} tok / {} files / {} | task {}",
                        child.approval_backlog,
                        child.handoff_backlog,
                        format_token_count(child.tokens_used),
                        child.files_changed,
                        format_duration(child.duration_secs),
                        child.task_preview
                    ));
                    if let Some(branch) = child.branch.as_ref() {
                        child_line.push_str(&format!(" | branch {branch}"));
                    }
                    lines.push(child_line);
                    if let Some(last_output_preview) = child.last_output_preview.as_ref() {
                        lines.push(format!("  last output {last_output_preview}"));
                    }
                }
            }

            if let Some(worktree) = session.worktree.as_ref() {
                lines.push(format!(
                    "Branch {} | Base {}",
                    worktree.branch, worktree.base_branch
                ));
                lines.push(format!("Worktree {}", worktree.path.display()));
                if let Some(diff_summary) = self.selected_diff_summary.as_ref() {
                    lines.push(format!("Diff {diff_summary}"));
                }
                if !self.selected_diff_preview.is_empty() {
                    lines.push("Changed files".to_string());
                    for entry in &self.selected_diff_preview {
                        lines.push(format!("- {entry}"));
                    }
                }
                if let Some(merge_readiness) = self.selected_merge_readiness.as_ref() {
                    lines.push(merge_readiness.summary.clone());
                    for conflict in merge_readiness.conflicts.iter().take(3) {
                        lines.push(format!("- conflict {conflict}"));
                    }
                }
                if let Ok(merge_queue) = manager::build_merge_queue(&self.db) {
                    let entry = merge_queue
                        .ready_entries
                        .iter()
                        .chain(merge_queue.blocked_entries.iter())
                        .find(|entry| entry.session_id == session.id);
                    if let Some(entry) = entry {
                        lines.push("Merge queue".to_string());
                        if let Some(position) = entry.queue_position {
                            lines.push(format!(
                                "- ready #{} | {}",
                                position, entry.suggested_action
                            ));
                        } else {
                            lines.push(format!("- blocked | {}", entry.suggested_action));
                        }
                        for blocker in entry.blocked_by.iter().take(2) {
                            lines.push(format!(
                                "  blocker {} [{}] | {}",
                                format_session_id(&blocker.session_id),
                                blocker.branch,
                                blocker.summary
                            ));
                            for conflict in blocker.conflicts.iter().take(3) {
                                lines.push(format!("    conflict {conflict}"));
                            }
                        }
                    }
                }
            }

            if let Some(harness) = self.session_harnesses.get(&session.id) {
                lines.push(format!(
                    "Harness {} | Detected {}",
                    harness.primary_label,
                    harness.detected_summary()
                ));
            }

            lines.push(format!(
                "Tokens {} total | In {} | Out {}",
                format_token_count(metrics.tokens_used),
                format_token_count(metrics.input_tokens),
                format_token_count(metrics.output_tokens),
            ));
            lines.push(format!(
                "Tools {} | Files {}",
                metrics.tool_calls, metrics.files_changed,
            ));
            let recent_file_activity = self
                .db
                .list_file_activity(&session.id, 5)
                .unwrap_or_default();
            if !recent_file_activity.is_empty() {
                lines.push("Recent file activity".to_string());
                for entry in recent_file_activity {
                    lines.push(format!(
                        "- {} {}",
                        self.short_timestamp(&entry.timestamp.to_rfc3339()),
                        file_activity_summary(&entry)
                    ));
                    for detail in file_activity_patch_lines(&entry, 2) {
                        lines.push(format!("  {}", detail));
                    }
                }
            }
            let recent_decisions = self
                .db
                .list_decisions_for_session(&session.id, 5)
                .unwrap_or_default();
            if !recent_decisions.is_empty() {
                lines.push("Recent decisions".to_string());
                for entry in recent_decisions {
                    lines.push(format!(
                        "- {} {}",
                        self.short_timestamp(&entry.timestamp.to_rfc3339()),
                        decision_log_summary(&entry)
                    ));
                    for detail in decision_log_detail_lines(&entry).into_iter().take(3) {
                        lines.push(format!("  {}", detail));
                    }
                }
            }
            lines.extend(self.session_graph_recall_lines(session));
            lines.extend(self.session_graph_metrics_lines(&session.id));
            let file_overlaps = self
                .db
                .list_file_overlaps(&session.id, 3)
                .unwrap_or_default();
            if !file_overlaps.is_empty() {
                lines.push("Potential overlaps".to_string());
                for overlap in file_overlaps {
                    lines.push(format!(
                        "- {}",
                        file_overlap_summary(
                            &overlap,
                            &self.short_timestamp(&overlap.timestamp.to_rfc3339())
                        )
                    ));
                }
            }
            let conflict_incidents = self
                .db
                .list_open_conflict_incidents_for_session(&session.id, 3)
                .unwrap_or_default();
            if !conflict_incidents.is_empty() {
                lines.push("Active conflicts".to_string());
                for incident in conflict_incidents {
                    lines.push(format!(
                        "- {}",
                        conflict_incident_summary(
                            &incident,
                            &self.short_timestamp(&incident.updated_at.to_rfc3339())
                        )
                    ));
                }
            }
            lines.push(format!(
                "Cost ${:.4} | Duration {}s",
                metrics.cost_usd, metrics.duration_secs
            ));

            if let Some(last_output) = self.selected_output_lines().last() {
                lines.push(format!(
                    "Last output {}",
                    truncate_for_dashboard(&last_output.text, 96)
                ));
            }

            lines.push(String::new());
            if self.selected_messages.is_empty() {
                lines.push("Message inbox clear".to_string());
            } else {
                lines.push("Recent messages:".to_string());
                let recent = self
                    .selected_messages
                    .iter()
                    .rev()
                    .take(3)
                    .collect::<Vec<_>>();
                for message in recent.into_iter().rev() {
                    lines.push(format!(
                        "- {} {} -> {} | {}",
                        self.short_timestamp(&message.timestamp.to_rfc3339()),
                        format_session_id(&message.from_session),
                        format_session_id(&message.to_session),
                        comms::preview(&message.msg_type, &message.content)
                    ));
                }
            }

            let attention_items = self.attention_queue_items(3);
            if attention_items.is_empty() {
                lines.push(String::new());
                lines.push("Attention queue clear".to_string());
            } else {
                lines.push(String::new());
                lines.push("Needs attention:".to_string());
                lines.extend(attention_items);
            }

            lines.join("\n")
        } else {
            "No metrics available".to_string()
        }
    }

    fn board_text(&self) -> String {
        if self.sessions.is_empty() {
            return "No sessions available.\n\nStart a session to populate the board.".to_string();
        }

        let mut lines = Vec::new();
        lines.push(format!("Board snapshot | {} sessions", self.sessions.len()));

        if let Some(session) = self.sessions.get(self.selected_session) {
            let meta = self.board_meta_by_session.get(&session.id);
            let branch = session_branch(session);
            lines.push(format!(
                "Focus {} {} | {} | {}{}",
                board_presence_marker(session),
                board_codename(session),
                meta.map(|meta| meta.lane.as_str())
                    .unwrap_or_else(|| board_lane_label(&session.state)),
                format_session_id(&session.id),
                if branch == "-" {
                    String::new()
                } else {
                    format!(" | {branch}")
                }
            ));
            lines.push(format!("Task {}", truncate_for_dashboard(&session.task, 48)));
            if let Some(meta) = meta {
                lines.push(format!(
                    "Progress {:>3}% {}",
                    meta.progress_percent,
                    board_progress_bar(meta.progress_percent)
                ));
                if let Some(status_detail) = meta.status_detail.as_ref() {
                    lines.push(format!("Status {status_detail}"));
                }
                if let Some(movement_note) = meta.movement_note.as_ref() {
                    lines.push(format!("Event {movement_note}"));
                }
                if meta.handoff_backlog > 0 {
                    lines.push(format!("Inbox {} handoff(s)", meta.handoff_backlog));
                }
                if let Some(activity_note) = meta.activity_note.as_ref() {
                    lines.push(format!("Route {activity_note}"));
                }
                lines.push(format!(
                    "Coords C{} R{} S{}",
                    meta.column_index + 1,
                    meta.row_index + 1,
                    meta.stack_index + 1
                ));
                if let Some(row_label) = meta.row_label.as_ref() {
                    lines.push(format!("Row {row_label}"));
                }
                if let Some(project) = meta.project.as_ref() {
                    lines.push(format!("Project {project}"));
                }
                if let Some(feature) = meta.feature.as_ref() {
                    lines.push(format!("Feature {feature}"));
                }
                if let Some(issue) = meta.issue.as_ref() {
                    lines.push(format!("Issue {issue}"));
                }
            }
        }

        let overlap_risks = self.board_overlap_risks();
        if overlap_risks.is_empty() {
            lines.push("Overlap risk clear".to_string());
        } else {
            lines.push("Overlap risk".to_string());
            for risk in overlap_risks {
                lines.push(format!("- {risk}"));
            }
        }

        let lanes = ["Inbox", "In Progress", "Review", "Blocked", "Done", "Stopped"];
        for label in lanes {
            let mut lane_sessions = self
                .sessions
                .iter()
                .filter_map(|session| {
                    let lane = self
                        .board_meta_by_session
                        .get(&session.id)
                        .map(|meta| meta.lane.as_str())
                        .unwrap_or_else(|| board_lane_label(&session.state));
                    if lane == label {
                        Some((session, self.board_meta_by_session.get(&session.id)))
                    } else {
                        None
                    }
                })
                .collect::<Vec<_>>();
            if lane_sessions.is_empty() {
                continue;
            }

            let mut row_risks: HashMap<(i64, String), Vec<String>> = HashMap::new();
            let mut row_backlogs: HashMap<(i64, String), i64> = HashMap::new();
            for (_, meta) in &lane_sessions {
                let Some(meta) = meta else {
                    continue;
                };
                let key = (
                    meta.row_index,
                    meta.row_label
                        .clone()
                        .unwrap_or_else(|| "General".to_string()),
                );
                if let Some(conflict_signal) = meta.conflict_signal.as_ref() {
                    let entry = row_risks.entry(key.clone()).or_default();
                    for risk in conflict_signal.split("; ") {
                        if !entry.iter().any(|existing| existing == risk) {
                            entry.push(risk.to_string());
                        }
                    }
                }
                if meta.handoff_backlog > 0 {
                    *row_backlogs.entry(key).or_default() += meta.handoff_backlog;
                }
            }

            lane_sessions.sort_by(|left, right| {
                let left_meta = left.1.cloned().unwrap_or_default();
                let right_meta = right.1.cloned().unwrap_or_default();
                left_meta
                    .row_index
                    .cmp(&right_meta.row_index)
                    .then_with(|| left_meta.stack_index.cmp(&right_meta.stack_index))
                    .then_with(|| left.0.id.cmp(&right.0.id))
            });

            lines.push(String::new());
            lines.push(format!("{label} ({})", lane_sessions.len()));
            let mut current_row: Option<String> = None;
            for (session, meta) in lane_sessions.into_iter().take(6) {
                let meta = meta.cloned().unwrap_or_default();
                let row_label = meta
                    .row_label
                    .clone()
                    .unwrap_or_else(|| "General".to_string());
                if current_row.as_ref() != Some(&row_label) {
                    current_row = Some(row_label.clone());
                    let row_key = (meta.row_index, row_label.clone());
                    let row_conflict_summary = row_risks
                        .get(&row_key)
                        .filter(|risks| !risks.is_empty())
                        .map(|risks| truncate_for_dashboard(&risks.join(" + "), 42));
                    let row_backlog = row_backlogs.get(&row_key).copied().unwrap_or(0);
                    let row_pressure_summary = if row_backlog > 0 {
                        Some(format!("{} handoff(s)", row_backlog))
                    } else {
                        None
                    };
                    let row_marker = if row_conflict_summary.is_some() {
                        "!"
                    } else if row_pressure_summary.is_some() {
                        "+"
                    } else {
                        "-"
                    };
                    lines.push(format!(
                        "  {} Row {} | {}{}{}",
                        row_marker,
                        meta.row_index + 1,
                        row_label,
                        row_conflict_summary
                            .map(|summary| format!(" | {summary}"))
                            .unwrap_or_default(),
                        row_pressure_summary
                            .map(|summary| format!(" | {summary}"))
                            .unwrap_or_default()
                    ));
                }
                let branch = session_branch(session);
                let branch_suffix = if branch == "-" {
                    String::new()
                } else {
                    format!(" | {branch}")
                };
                let activity_suffix = meta
                    .activity_note
                    .as_ref()
                    .map(|note| format!(" | {}", truncate_for_dashboard(note, 26)))
                    .unwrap_or_default();
                let backlog_suffix = if meta.handoff_backlog > 0 {
                    format!(" | inbox {}", meta.handoff_backlog)
                } else {
                    String::new()
                };
                let kind_marker = board_activity_marker(&meta);
                lines.push(format!(
                    "    {}{} {} {} {} [{}] {:>3}% {} | {}{}{}{}",
                    board_motion_marker(&meta),
                    kind_marker,
                    board_presence_marker(session),
                    board_codename(session),
                    format_session_id(&session.id),
                    session.agent_type,
                    meta.progress_percent,
                    board_progress_bar(meta.progress_percent),
                    truncate_for_dashboard(meta.status_detail.as_deref().unwrap_or(&session.task), 18),
                    activity_suffix,
                    backlog_suffix,
                    branch_suffix
                ));
            }
        }

        lines.join("\n")
    }

    fn board_overlap_risks(&self) -> Vec<String> {
        let mut risks = self
            .board_meta_by_session
            .values()
            .filter_map(|meta| meta.conflict_signal.clone())
            .collect::<Vec<_>>();
        if risks.is_empty() {
            let mut duplicate_branches: HashMap<String, Vec<String>> = HashMap::new();
            let mut duplicate_tasks: HashMap<String, Vec<String>> = HashMap::new();

            for session in self.sessions.iter().filter(|session| {
                matches!(
                    session.state,
                    SessionState::Pending
                        | SessionState::Running
                        | SessionState::Idle
                        | SessionState::Stale
                )
            }) {
                if let Some(worktree) = session.worktree.as_ref() {
                    duplicate_branches
                        .entry(worktree.branch.clone())
                        .or_default()
                        .push(format_session_id(&session.id));
                }
                duplicate_tasks
                    .entry(session.task.trim().to_ascii_lowercase())
                    .or_default()
                    .push(format_session_id(&session.id));
            }

            for (branch, sessions) in duplicate_branches {
                if sessions.len() >= 2 {
                    risks.push(format!("Shared branch {branch}: {}", sessions.join(", ")));
                }
            }
            for (task, sessions) in duplicate_tasks {
                if sessions.len() >= 2 {
                    risks.push(format!(
                        "Shared task {}: {}",
                        truncate_for_dashboard(&task, 32),
                        sessions.join(", ")
                    ));
                }
            }
        }
        risks.sort();
        risks.dedup();
        risks
    }

    fn aggregate_cost_summary(&self) -> (String, Style) {
        let aggregate = self.aggregate_usage();
        let thresholds = self.cfg.effective_budget_alert_thresholds();
        let mut text = if self.cfg.cost_budget_usd > 0.0 {
            format!(
                "Aggregate cost {} / {}",
                format_currency(aggregate.total_cost_usd),
                format_currency(self.cfg.cost_budget_usd),
            )
        } else {
            format!(
                "Aggregate cost {} (no budget)",
                format_currency(aggregate.total_cost_usd)
            )
        };

        if let Some(summary_suffix) = aggregate.overall_state.summary_suffix(thresholds) {
            text.push_str(" | ");
            text.push_str(&summary_suffix);
        }

        (text, aggregate.overall_state.style())
    }

    fn attention_queue_items(&self, limit: usize) -> Vec<String> {
        let mut items = Vec::new();
        let suppress_inbox_attention = self
            .daemon_activity
            .stabilized_after_recovery_at()
            .is_some();

        for session in &self.sessions {
            if self.worktree_health_by_session.get(&session.id).copied()
                == Some(worktree::WorktreeHealth::Conflicted)
            {
                items.push(format!(
                    "- Conflicted worktree {} | {}",
                    format_session_id(&session.id),
                    truncate_for_dashboard(&session.task, 48)
                ));
            }

            let handoff_backlog = self
                .handoff_backlog_counts
                .get(&session.id)
                .copied()
                .unwrap_or(0);
            if handoff_backlog > 0 && !suppress_inbox_attention {
                items.push(format!(
                    "- Backlog {} | {} handoff(s) | {}",
                    format_session_id(&session.id),
                    handoff_backlog,
                    truncate_for_dashboard(&session.task, 40)
                ));
            }

            if matches!(
                session.state,
                SessionState::Failed | SessionState::Stopped | SessionState::Pending
            ) {
                items.push(format!(
                    "- {} {} | {}",
                    session_state_label(&session.state),
                    format_session_id(&session.id),
                    truncate_for_dashboard(&session.task, 48)
                ));
            }

            if items.len() >= limit {
                break;
            }
        }

        items.truncate(limit);
        items
    }

    fn set_operator_note(&mut self, note: String) {
        self.operator_note = Some(note);
    }

    fn active_session_count(&self) -> usize {
        self.sessions
            .iter()
            .filter(|session| {
                matches!(
                    session.state,
                    SessionState::Pending
                        | SessionState::Running
                        | SessionState::Idle
                        | SessionState::Stale
                )
            })
            .count()
    }

    fn refresh_after_spawn(&mut self, select_session_id: Option<&str>) {
        self.refresh();
        self.sync_selection_by_id(select_session_id);
        self.reset_output_view();
        self.reset_metrics_view();
        self.sync_selected_output();
        self.sync_selected_diff();
        self.sync_selected_messages();
        self.sync_selected_lineage();
        self.refresh_logs();
    }

    fn new_session_task(&self) -> String {
        self.sessions
            .get(self.selected_session)
            .map(|session| {
                format!(
                    "Follow up on {}: {}",
                    format_session_id(&session.id),
                    truncate_for_dashboard(&session.task, 96)
                )
            })
            .unwrap_or_else(|| "New ECC 2.0 session".to_string())
    }

    fn spawn_prompt_seed(&self) -> String {
        format!("give me 2 agents working on {}", self.new_session_task())
    }

    fn build_spawn_plan(&self, input: &str) -> Result<SpawnPlan, String> {
        let request = parse_spawn_request(input)?;
        let available_slots = self
            .cfg
            .max_parallel_sessions
            .saturating_sub(self.active_session_count());

        match request {
            SpawnRequest::AdHoc {
                requested_count,
                task,
            } => {
                if available_slots == 0 {
                    return Err(format!(
                        "cannot queue sessions: active session limit reached ({})",
                        self.cfg.max_parallel_sessions
                    ));
                }

                Ok(SpawnPlan::AdHoc {
                    requested_count,
                    spawn_count: requested_count.min(available_slots),
                    task,
                })
            }
            SpawnRequest::Template {
                name,
                task,
                variables,
            } => {
                let repo_root = std::env::current_dir().map_err(|error| {
                    format!("failed to resolve cwd for template preview: {error}")
                })?;
                let source_session = self.sessions.get(self.selected_session);
                let preview_vars = manager::build_template_variables(
                    &repo_root,
                    source_session,
                    task.as_deref(),
                    variables.clone(),
                );
                let template = self
                    .cfg
                    .resolve_orchestration_template(&name, &preview_vars)
                    .map_err(|error| error.to_string())?;
                if available_slots < template.steps.len() {
                    return Err(format!(
                        "template {name} requires {} session slots but only {available_slots} available",
                        template.steps.len()
                    ));
                }

                Ok(SpawnPlan::Template {
                    name,
                    task,
                    variables,
                    step_count: template.steps.len(),
                })
            }
        }
    }

    fn pane_areas(&self, area: Rect) -> PaneAreas {
        let detail_panes = self.visible_detail_panes();
        match self.cfg.pane_layout {
            PaneLayout::Horizontal => {
                let columns = Layout::default()
                    .direction(Direction::Horizontal)
                    .constraints(self.primary_constraints())
                    .split(area);
                let mut pane_areas = PaneAreas {
                    sessions: columns[0],
                    output: None,
                    metrics: None,
                    log: None,
                };
                for (pane, rect) in horizontal_detail_layout(columns[1], &detail_panes) {
                    pane_areas.assign(pane, rect);
                }
                pane_areas
            }
            PaneLayout::Vertical => {
                let rows = Layout::default()
                    .direction(Direction::Vertical)
                    .constraints(self.primary_constraints())
                    .split(area);
                let mut pane_areas = PaneAreas {
                    sessions: rows[0],
                    output: None,
                    metrics: None,
                    log: None,
                };
                for (pane, rect) in vertical_detail_layout(rows[1], &detail_panes) {
                    pane_areas.assign(pane, rect);
                }
                pane_areas
            }
            PaneLayout::Grid => {
                if detail_panes.len() < 3 {
                    let columns = Layout::default()
                        .direction(Direction::Horizontal)
                        .constraints(self.primary_constraints())
                        .split(area);
                    let mut pane_areas = PaneAreas {
                        sessions: columns[0],
                        output: None,
                        metrics: None,
                        log: None,
                    };
                    for (pane, rect) in horizontal_detail_layout(columns[1], &detail_panes) {
                        pane_areas.assign(pane, rect);
                    }
                    pane_areas
                } else {
                    let rows = Layout::default()
                        .direction(Direction::Vertical)
                        .constraints(self.primary_constraints())
                        .split(area);
                    let top_columns = Layout::default()
                        .direction(Direction::Horizontal)
                        .constraints(self.primary_constraints())
                        .split(rows[0]);
                    let bottom_columns = Layout::default()
                        .direction(Direction::Horizontal)
                        .constraints(self.primary_constraints())
                        .split(rows[1]);

                    PaneAreas {
                        sessions: top_columns[0],
                        output: Some(top_columns[1]),
                        metrics: Some(bottom_columns[0]),
                        log: Some(bottom_columns[1]),
                    }
                }
            }
        }
    }

    fn primary_constraints(&self) -> [Constraint; 2] {
        [
            Constraint::Percentage(self.pane_size_percent),
            Constraint::Percentage(100 - self.pane_size_percent),
        ]
    }

    fn visible_panes(&self) -> Vec<Pane> {
        self.layout_panes()
            .into_iter()
            .filter(|pane| !self.collapsed_panes.contains(pane))
            .collect()
    }

    fn visible_detail_panes(&self) -> Vec<Pane> {
        self.layout_panes()
            .into_iter()
            .filter(|pane| !self.collapsed_panes.contains(pane))
            .into_iter()
            .filter(|pane| *pane != Pane::Sessions)
            .collect()
    }

    fn layout_panes(&self) -> Vec<Pane> {
        match self.cfg.pane_layout {
            PaneLayout::Grid => vec![Pane::Sessions, Pane::Output, Pane::Metrics, Pane::Log],
            PaneLayout::Horizontal | PaneLayout::Vertical => {
                vec![Pane::Sessions, Pane::Output, Pane::Metrics]
            }
        }
    }

    fn selected_pane_index(&self) -> usize {
        self.visible_panes()
            .iter()
            .position(|pane| *pane == self.selected_pane)
            .unwrap_or(0)
    }

    fn pane_border_style(&self, pane: Pane) -> Style {
        if self.selected_pane == pane {
            Style::default().fg(self.theme_palette().accent)
        } else {
            Style::default()
        }
    }

    fn layout_label(&self) -> &'static str {
        match self.cfg.pane_layout {
            PaneLayout::Horizontal => "horizontal",
            PaneLayout::Vertical => "vertical",
            PaneLayout::Grid => "grid",
        }
    }

    fn theme_label(&self) -> &'static str {
        match self.cfg.theme {
            Theme::Dark => "dark",
            Theme::Light => "light",
        }
    }

    fn board_pane_visible(&self) -> bool {
        self.cfg.pane_layout == PaneLayout::Grid
            && !self.collapsed_panes.contains(&Pane::Metrics)
            && self.layout_panes().contains(&Pane::Metrics)
    }

    fn is_pane_visible(&self, pane: Pane) -> bool {
        match pane {
            Pane::Board => self.board_pane_visible(),
            _ => self.visible_panes().contains(&pane),
        }
    }

    fn theme_palette(&self) -> ThemePalette {
        match self.cfg.theme {
            Theme::Dark => ThemePalette {
                accent: Color::Cyan,
                row_highlight_bg: Color::DarkGray,
                muted: Color::DarkGray,
                help_border: Color::Yellow,
            },
            Theme::Light => ThemePalette {
                accent: Color::Blue,
                row_highlight_bg: Color::Gray,
                muted: Color::Black,
                help_border: Color::Blue,
            },
        }
    }

    fn log_field<'a>(&self, value: &'a str) -> &'a str {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            "n/a"
        } else {
            trimmed
        }
    }

    fn short_timestamp(&self, timestamp: &str) -> String {
        chrono::DateTime::parse_from_rfc3339(timestamp)
            .map(|value| value.format("%H:%M:%S").to_string())
            .unwrap_or_else(|_| timestamp.to_string())
    }

    #[cfg(test)]
    fn aggregate_cost_summary_text(&self) -> String {
        self.aggregate_cost_summary().0
    }

    #[cfg(test)]
    fn selected_output_text(&self) -> String {
        self.selected_output_lines()
            .iter()
            .map(|line| line.text.clone())
            .collect::<Vec<_>>()
            .join("\n")
    }

    #[cfg(test)]
    fn rendered_output_text(&mut self, width: u16, height: u16) -> String {
        let backend = ratatui::backend::TestBackend::new(width, height);
        let mut terminal = ratatui::Terminal::new(backend).expect("terminal");
        terminal.draw(|frame| self.render(frame)).expect("draw");
        terminal
            .backend()
            .buffer()
            .content()
            .iter()
            .map(|cell| cell.symbol())
            .collect::<String>()
    }
}

impl Pane {
    fn title(self) -> &'static str {
        match self {
            Pane::Sessions => "Sessions",
            Pane::Output => "Output",
            Pane::Metrics => "Metrics",
            Pane::Board => "Board",
            Pane::Log => "Log",
        }
    }

    fn from_shortcut(slot: usize) -> Option<Self> {
        match slot {
            1 => Some(Self::Sessions),
            2 => Some(Self::Output),
            3 => Some(Self::Metrics),
            4 => Some(Self::Log),
            5 => Some(Self::Board),
            _ => None,
        }
    }

    fn sort_key(self) -> u8 {
        match self {
            Self::Sessions => 1,
            Self::Output => 2,
            Self::Metrics => 3,
            Self::Board => 4,
            Self::Log => 5,
        }
    }
}

fn pane_rect(pane_areas: &PaneAreas, pane: Pane) -> Option<Rect> {
    match pane {
        Pane::Sessions => Some(pane_areas.sessions),
        Pane::Output => pane_areas.output,
        Pane::Metrics => pane_areas.metrics,
        Pane::Board => pane_areas.metrics,
        Pane::Log => pane_areas.log,
    }
}

fn pane_center(rect: Rect) -> (i16, i16) {
    (
        rect.x as i16 + rect.width as i16 / 2,
        rect.y as i16 + rect.height as i16 / 2,
    )
}

impl OutputFilter {
    fn next(self) -> Self {
        match self {
            Self::All => Self::ErrorsOnly,
            Self::ErrorsOnly => Self::ToolCallsOnly,
            Self::ToolCallsOnly => Self::FileChangesOnly,
            Self::FileChangesOnly => Self::All,
        }
    }

    fn matches(self, line: &OutputLine) -> bool {
        match self {
            OutputFilter::All => true,
            OutputFilter::ErrorsOnly => line.stream == OutputStream::Stderr,
            OutputFilter::ToolCallsOnly => looks_like_tool_call(&line.text),
            OutputFilter::FileChangesOnly => looks_like_file_change(&line.text),
        }
    }

    fn label(self) -> &'static str {
        match self {
            OutputFilter::All => "all",
            OutputFilter::ErrorsOnly => "errors",
            OutputFilter::ToolCallsOnly => "tool calls",
            OutputFilter::FileChangesOnly => "file changes",
        }
    }

    fn title_suffix(self) -> &'static str {
        match self {
            OutputFilter::All => "",
            OutputFilter::ErrorsOnly => " errors",
            OutputFilter::ToolCallsOnly => " tool calls",
            OutputFilter::FileChangesOnly => " file changes",
        }
    }
}

fn looks_like_tool_call(text: &str) -> bool {
    let lower = text.trim().to_ascii_lowercase();
    if lower.is_empty() {
        return false;
    }

    const TOOL_PREFIXES: &[&str] = &[
        "tool ",
        "tool:",
        "[tool",
        "tool call",
        "calling tool",
        "running tool",
        "invoking tool",
        "using tool",
        "read(",
        "write(",
        "edit(",
        "multi_edit(",
        "bash(",
        "grep(",
        "glob(",
        "search(",
        "ls(",
        "apply_patch(",
    ];

    TOOL_PREFIXES.iter().any(|prefix| lower.starts_with(prefix))
}

fn parse_spawn_request(input: &str) -> Result<SpawnRequest, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err("spawn request cannot be empty".to_string());
    }

    if let Some(template_request) = parse_template_spawn_request(trimmed)? {
        return Ok(template_request);
    }

    let count = Regex::new(r"\b([1-9]\d*)\b")
        .expect("spawn count regex")
        .captures(trimmed)
        .and_then(|captures| captures.get(1))
        .and_then(|count| count.as_str().parse::<usize>().ok())
        .unwrap_or(1);

    let task = extract_spawn_task(trimmed);
    if task.is_empty() {
        return Err("spawn request must include a task description".to_string());
    }

    Ok(SpawnRequest::AdHoc {
        requested_count: count,
        task,
    })
}

fn parse_template_spawn_request(input: &str) -> Result<Option<SpawnRequest>, String> {
    let captures = Regex::new(
        r"(?is)^\s*template\s+(?P<name>[A-Za-z0-9_-]+)(?:\s+for\s+(?P<task>.*?))?(?:\s+with\s+(?P<vars>.+))?\s*$",
    )
    .expect("template spawn regex")
    .captures(input);

    let Some(captures) = captures else {
        return Ok(None);
    };

    let name = captures
        .name("name")
        .map(|value| value.as_str().trim().to_string())
        .ok_or_else(|| "template request must include a template name".to_string())?;
    let task = captures
        .name("task")
        .map(|value| value.as_str().trim().to_string())
        .filter(|value| !value.is_empty());
    let variables = captures
        .name("vars")
        .map(|value| parse_template_request_variables(value.as_str()))
        .transpose()?
        .unwrap_or_default();

    Ok(Some(SpawnRequest::Template {
        name,
        task,
        variables,
    }))
}

fn parse_template_request_variables(input: &str) -> Result<BTreeMap<String, String>, String> {
    let mut variables = BTreeMap::new();
    for entry in input
        .split(',')
        .map(str::trim)
        .filter(|entry| !entry.is_empty())
    {
        let (key, value) = entry
            .split_once('=')
            .ok_or_else(|| format!("template vars must use key=value form: {entry}"))?;
        let key = key.trim();
        let value = value.trim();
        if key.is_empty() || value.is_empty() {
            return Err(format!(
                "template vars must use non-empty key=value form: {entry}"
            ));
        }
        variables.insert(key.to_string(), value.to_string());
    }
    Ok(variables)
}

fn extract_spawn_task(input: &str) -> String {
    let trimmed = input.trim();
    let lower = trimmed.to_ascii_lowercase();

    for marker in ["working on ", "work on ", "for ", ":"] {
        if let Some(start) = lower.find(marker) {
            let task = trimmed[start + marker.len()..]
                .trim_matches(|ch: char| ch.is_whitespace() || ch == ':' || ch == '-');
            if !task.is_empty() {
                return task.to_string();
            }
        }
    }

    let stripped =
        Regex::new(r"(?i)^\s*(give me|spawn|queue|start|launch)\s+\d+\s+(agents?|sessions?)\s*")
            .expect("spawn command regex")
            .replace(trimmed, "");
    let stripped = stripped.trim_matches(|ch: char| ch.is_whitespace() || ch == ':' || ch == '-');
    if !stripped.is_empty() && stripped != trimmed {
        return stripped.to_string();
    }

    trimmed.to_string()
}

fn expand_spawn_tasks(task: &str, count: usize) -> Vec<String> {
    if count <= 1 {
        return vec![task.to_string()];
    }

    (0..count)
        .map(|index| format!("{task} [{}/{}]", index + 1, count))
        .collect()
}

fn build_spawn_note(plan: &SpawnPlan, created_count: usize, queued_count: usize) -> String {
    let mut note = match plan {
        SpawnPlan::AdHoc {
            requested_count,
            spawn_count,
            task,
        } => {
            let task = truncate_for_dashboard(task, 72);
            if spawn_count < requested_count {
                format!(
                    "spawned {created_count} session(s) for {task} (requested {requested_count}, capped at {spawn_count})"
                )
            } else {
                format!("spawned {created_count} session(s) for {task}")
            }
        }
        SpawnPlan::Template {
            name,
            task,
            step_count,
            ..
        } => {
            let scope = task
                .as_ref()
                .map(|task| format!(" for {}", truncate_for_dashboard(task, 72)))
                .unwrap_or_default();
            format!("launched template {name} ({created_count}/{step_count} step(s)){scope}")
        }
    };

    if queued_count > 0 {
        note.push_str(&format!(" | {queued_count} pending worktree slot"));
    }

    note
}

fn post_spawn_selection_id(
    source_session_id: Option<&str>,
    created_ids: &[String],
) -> Option<String> {
    if created_ids.len() > 1 {
        source_session_id
            .map(ToOwned::to_owned)
            .or_else(|| created_ids.first().cloned())
    } else {
        created_ids.first().cloned()
    }
}

fn looks_like_file_change(text: &str) -> bool {
    let lower = text.trim().to_ascii_lowercase();
    if lower.is_empty() {
        return false;
    }

    if lower.contains("applied patch")
        || lower.contains("patch applied")
        || lower.starts_with("diff --git ")
    {
        return true;
    }

    const FILE_CHANGE_VERBS: &[&str] = &[
        "updated ",
        "created ",
        "deleted ",
        "renamed ",
        "modified ",
        "wrote ",
        "editing ",
        "edited ",
        "writing ",
    ];

    FILE_CHANGE_VERBS
        .iter()
        .any(|prefix| lower.starts_with(prefix) && contains_path_like_token(text))
}

fn contains_path_like_token(text: &str) -> bool {
    text.split_whitespace().any(|token| {
        let trimmed = token.trim_matches(|ch: char| {
            matches!(
                ch,
                '[' | ']' | '(' | ')' | '{' | '}' | ',' | ':' | ';' | '"' | '\''
            )
        });

        trimmed.contains('/')
            || trimmed.contains('\\')
            || trimmed.starts_with("./")
            || trimmed.starts_with("../")
            || trimmed
                .rsplit_once('.')
                .map(|(stem, ext)| {
                    !stem.is_empty()
                        && !ext.is_empty()
                        && ext.len() <= 10
                        && ext.chars().all(|ch| ch.is_ascii_alphanumeric())
                })
                .unwrap_or(false)
    })
}

impl OutputTimeFilter {
    fn next(self) -> Self {
        match self {
            Self::AllTime => Self::Last15Minutes,
            Self::Last15Minutes => Self::LastHour,
            Self::LastHour => Self::Last24Hours,
            Self::Last24Hours => Self::AllTime,
        }
    }

    fn matches(self, line: &OutputLine) -> bool {
        match self {
            Self::AllTime => true,
            Self::Last15Minutes => line
                .occurred_at()
                .map(|timestamp| self.matches_timestamp(timestamp))
                .unwrap_or(false),
            Self::LastHour => line
                .occurred_at()
                .map(|timestamp| self.matches_timestamp(timestamp))
                .unwrap_or(false),
            Self::Last24Hours => line
                .occurred_at()
                .map(|timestamp| self.matches_timestamp(timestamp))
                .unwrap_or(false),
        }
    }

    fn matches_timestamp(self, timestamp: chrono::DateTime<Utc>) -> bool {
        match self {
            Self::AllTime => true,
            Self::Last15Minutes => timestamp >= Utc::now() - Duration::minutes(15),
            Self::LastHour => timestamp >= Utc::now() - Duration::hours(1),
            Self::Last24Hours => timestamp >= Utc::now() - Duration::hours(24),
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::AllTime => "all time",
            Self::Last15Minutes => "last 15m",
            Self::LastHour => "last 1h",
            Self::Last24Hours => "last 24h",
        }
    }

    fn title_suffix(self) -> &'static str {
        match self {
            Self::AllTime => "",
            Self::Last15Minutes => " last 15m",
            Self::LastHour => " last 1h",
            Self::Last24Hours => " last 24h",
        }
    }
}

impl DiffViewMode {
    fn label(self) -> &'static str {
        match self {
            Self::Split => "split",
            Self::Unified => "unified",
        }
    }

    fn title_suffix(self) -> &'static str {
        match self {
            Self::Split => " split",
            Self::Unified => " unified",
        }
    }
}

impl TimelineEventFilter {
    fn next(self) -> Self {
        match self {
            Self::All => Self::Lifecycle,
            Self::Lifecycle => Self::Messages,
            Self::Messages => Self::ToolCalls,
            Self::ToolCalls => Self::FileChanges,
            Self::FileChanges => Self::Decisions,
            Self::Decisions => Self::All,
        }
    }

    fn matches(self, event_type: TimelineEventType) -> bool {
        match self {
            Self::All => true,
            Self::Lifecycle => event_type == TimelineEventType::Lifecycle,
            Self::Messages => event_type == TimelineEventType::Message,
            Self::ToolCalls => event_type == TimelineEventType::ToolCall,
            Self::FileChanges => event_type == TimelineEventType::FileChange,
            Self::Decisions => event_type == TimelineEventType::Decision,
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::All => "all events",
            Self::Lifecycle => "lifecycle",
            Self::Messages => "messages",
            Self::ToolCalls => "tool calls",
            Self::FileChanges => "file changes",
            Self::Decisions => "decisions",
        }
    }

    fn title_suffix(self) -> &'static str {
        match self {
            Self::All => "",
            Self::Lifecycle => " lifecycle",
            Self::Messages => " messages",
            Self::ToolCalls => " tool calls",
            Self::FileChanges => " file changes",
            Self::Decisions => " decisions",
        }
    }
}

impl GraphEntityFilter {
    fn next(self) -> Self {
        match self {
            Self::All => Self::Decisions,
            Self::Decisions => Self::Files,
            Self::Files => Self::Functions,
            Self::Functions => Self::Sessions,
            Self::Sessions => Self::All,
        }
    }

    fn entity_type(self) -> Option<&'static str> {
        match self {
            Self::All => None,
            Self::Decisions => Some("decision"),
            Self::Files => Some("file"),
            Self::Functions => Some("function"),
            Self::Sessions => Some("session"),
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::All => "all entities",
            Self::Decisions => "decisions",
            Self::Files => "files",
            Self::Functions => "functions",
            Self::Sessions => "sessions",
        }
    }

    fn title_suffix(self) -> &'static str {
        match self {
            Self::All => "",
            Self::Decisions => " decisions",
            Self::Files => " files",
            Self::Functions => " functions",
            Self::Sessions => " sessions",
        }
    }
}

impl TimelineEventType {
    fn label(self) -> &'static str {
        match self {
            Self::Lifecycle => "lifecycle",
            Self::Message => "message",
            Self::ToolCall => "tool",
            Self::FileChange => "file-change",
            Self::Decision => "decision",
        }
    }
}

fn parse_rfc3339_to_utc(value: &str) -> Option<chrono::DateTime<Utc>> {
    chrono::DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|timestamp| timestamp.with_timezone(&Utc))
}

impl SearchScope {
    fn next(self) -> Self {
        match self {
            Self::SelectedSession => Self::AllSessions,
            Self::AllSessions => Self::SelectedSession,
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::SelectedSession => "selected session",
            Self::AllSessions => "all sessions",
        }
    }

    fn title_suffix(self) -> &'static str {
        match self {
            Self::SelectedSession => "",
            Self::AllSessions => " all sessions",
        }
    }

    fn matches(self, selected_session_id: Option<&str>, session_id: &str) -> bool {
        match self {
            Self::SelectedSession => selected_session_id == Some(session_id),
            Self::AllSessions => true,
        }
    }
}

impl SearchAgentFilter {
    fn matches(self, selected_agent_type: Option<&str>, session_agent_type: &str) -> bool {
        match self {
            Self::AllAgents => true,
            Self::SelectedAgentType => selected_agent_type == Some(session_agent_type),
        }
    }

    fn label(self, selected_agent_type: &str) -> String {
        match self {
            Self::AllAgents => "all agents".to_string(),
            Self::SelectedAgentType => format!("agent {}", selected_agent_type),
        }
    }

    fn title_suffix(self, selected_agent_type: &str) -> String {
        match self {
            Self::AllAgents => String::new(),
            Self::SelectedAgentType => format!(" {}", self.label(selected_agent_type)),
        }
    }
}

impl SessionSummary {
    fn from_sessions(
        sessions: &[Session],
        unread_message_counts: &HashMap<String, usize>,
        worktree_health_by_session: &HashMap<String, worktree::WorktreeHealth>,
        suppress_inbox_attention: bool,
    ) -> Self {
        let projects = sessions
            .iter()
            .map(|session| session.project.as_str())
            .collect::<HashSet<_>>()
            .len();
        let task_groups = sessions
            .iter()
            .map(|session| (session.project.as_str(), session.task_group.as_str()))
            .collect::<HashSet<_>>()
            .len();
        sessions.iter().fold(
            Self {
                total: sessions.len(),
                projects,
                task_groups,
                unread_messages: if suppress_inbox_attention {
                    0
                } else {
                    unread_message_counts.values().sum()
                },
                inbox_sessions: if suppress_inbox_attention {
                    0
                } else {
                    unread_message_counts
                        .values()
                        .filter(|count| **count > 0)
                        .count()
                },
                ..Self::default()
            },
            |mut summary, session| {
                match session.state {
                    SessionState::Pending => summary.pending += 1,
                    SessionState::Running => summary.running += 1,
                    SessionState::Idle => summary.idle += 1,
                    SessionState::Stale => summary.stale += 1,
                    SessionState::Completed => summary.completed += 1,
                    SessionState::Failed => summary.failed += 1,
                    SessionState::Stopped => summary.stopped += 1,
                }
                match worktree_health_by_session.get(&session.id).copied() {
                    Some(worktree::WorktreeHealth::Conflicted) => {
                        summary.conflicted_worktrees += 1;
                    }
                    Some(worktree::WorktreeHealth::InProgress) => {
                        summary.in_progress_worktrees += 1;
                    }
                    Some(worktree::WorktreeHealth::Clear) | None => {}
                }
                summary
            },
        )
    }
}

fn session_row(
    session: &Session,
    project_label: Option<String>,
    task_group_label: Option<String>,
    approval_requests: usize,
    unread_messages: usize,
) -> Row<'static> {
    let state_label = session_state_label(&session.state);
    let state_color = session_state_color(&session.state);
    Row::new(vec![
        Cell::from(format_session_id(&session.id)),
        Cell::from(project_label.unwrap_or_default()),
        Cell::from(task_group_label.unwrap_or_default()),
        Cell::from(session.agent_type.clone()),
        Cell::from(state_label).style(
            Style::default()
                .fg(state_color)
                .add_modifier(Modifier::BOLD),
        ),
        Cell::from(session_branch(session)),
        Cell::from(if approval_requests == 0 {
            "-".to_string()
        } else {
            approval_requests.to_string()
        })
        .style(if approval_requests == 0 {
            Style::default()
        } else {
            Style::default()
                .fg(Color::Yellow)
                .add_modifier(Modifier::BOLD)
        }),
        Cell::from(if unread_messages == 0 {
            "-".to_string()
        } else {
            unread_messages.to_string()
        })
        .style(if unread_messages == 0 {
            Style::default()
        } else {
            Style::default()
                .fg(Color::Magenta)
                .add_modifier(Modifier::BOLD)
        }),
        Cell::from(session.metrics.tokens_used.to_string()),
        Cell::from(session.metrics.tool_calls.to_string()),
        Cell::from(session.metrics.files_changed.to_string()),
        Cell::from(format_duration(session.metrics.duration_secs)),
    ])
}

fn sort_sessions_for_display(sessions: &mut [Session]) {
    sessions.sort_by(|left, right| {
        left.project
            .cmp(&right.project)
            .then_with(|| left.task_group.cmp(&right.task_group))
            .then_with(|| right.updated_at.cmp(&left.updated_at))
            .then_with(|| left.id.cmp(&right.id))
    });
}

fn summary_line(summary: &SessionSummary) -> Line<'static> {
    let mut spans = vec![
        Span::styled(
            format!("Total {}  ", summary.total),
            Style::default().add_modifier(Modifier::BOLD),
        ),
        summary_span("Projects", summary.projects, Color::Cyan),
        summary_span("Groups", summary.task_groups, Color::Magenta),
        summary_span("Running", summary.running, Color::Green),
        summary_span("Idle", summary.idle, Color::Yellow),
        summary_span("Stale", summary.stale, Color::LightRed),
        summary_span("Completed", summary.completed, Color::Blue),
        summary_span("Failed", summary.failed, Color::Red),
        summary_span("Stopped", summary.stopped, Color::DarkGray),
        summary_span("Pending", summary.pending, Color::Reset),
    ];

    if summary.conflicted_worktrees > 0 {
        spans.push(summary_span(
            "Conflicts",
            summary.conflicted_worktrees,
            Color::Red,
        ));
    }

    if summary.in_progress_worktrees > 0 {
        spans.push(summary_span(
            "Worktrees",
            summary.in_progress_worktrees,
            Color::Cyan,
        ));
    }

    Line::from(spans)
}

fn summary_span(label: &str, value: usize, color: Color) -> Span<'static> {
    Span::styled(
        format!("{label} {value}  "),
        Style::default().fg(color).add_modifier(Modifier::BOLD),
    )
}

fn attention_queue_line(summary: &SessionSummary, stabilized: bool) -> Line<'static> {
    if summary.failed == 0
        && summary.stopped == 0
        && summary.pending == 0
        && summary.stale == 0
        && summary.unread_messages == 0
        && summary.conflicted_worktrees == 0
    {
        return Line::from(vec![
            Span::styled(
                "Attention queue clear",
                Style::default()
                    .fg(Color::Green)
                    .add_modifier(Modifier::BOLD),
            ),
            Span::raw(if stabilized {
                "  stabilized backlog absorbed"
            } else {
                "  no failed, stopped, or pending sessions"
            }),
        ]);
    }

    let mut spans = vec![Span::styled(
        "Attention queue  ",
        Style::default()
            .fg(Color::Yellow)
            .add_modifier(Modifier::BOLD),
    )];

    if summary.conflicted_worktrees > 0 {
        spans.push(summary_span(
            "Conflicts",
            summary.conflicted_worktrees,
            Color::Red,
        ));
    }

    spans.extend([
        summary_span("Stale", summary.stale, Color::LightRed),
        summary_span("Backlog", summary.unread_messages, Color::Magenta),
        summary_span("Failed", summary.failed, Color::Red),
        summary_span("Stopped", summary.stopped, Color::DarkGray),
        summary_span("Pending", summary.pending, Color::Yellow),
    ]);

    Line::from(spans)
}

fn approval_queue_line(approval_queue_counts: &HashMap<String, usize>) -> Line<'static> {
    let pending_sessions = approval_queue_counts.len();
    let pending_items: usize = approval_queue_counts.values().sum();

    if pending_items == 0 {
        return Line::from(vec![
            Span::styled(
                "Approval queue clear",
                Style::default()
                    .fg(Color::Green)
                    .add_modifier(Modifier::BOLD),
            ),
            Span::raw("  no unanswered queries or conflicts"),
        ]);
    }

    Line::from(vec![
        Span::styled(
            "Approval queue  ",
            Style::default()
                .fg(Color::Yellow)
                .add_modifier(Modifier::BOLD),
        ),
        summary_span("Pending", pending_items, Color::Yellow),
        summary_span("Sessions", pending_sessions, Color::Yellow),
    ])
}

fn approval_queue_preview_line(messages: &[SessionMessage]) -> Option<Line<'static>> {
    let message = messages.first()?;
    let preview = truncate_for_dashboard(&comms::preview(&message.msg_type, &message.content), 72);

    Some(Line::from(vec![
        Span::raw("- "),
        Span::styled(
            format_session_id(&message.to_session),
            Style::default().add_modifier(Modifier::BOLD),
        ),
        Span::raw(" | "),
        Span::raw(preview),
    ]))
}

fn truncate_for_dashboard(value: &str, max_chars: usize) -> String {
    let trimmed = value.trim();
    if trimmed.chars().count() <= max_chars {
        return trimmed.to_string();
    }

    let truncated: String = trimmed.chars().take(max_chars.saturating_sub(1)).collect();
    format!("{truncated}…")
}

fn configured_pane_size(cfg: &Config, layout: PaneLayout) -> u16 {
    let configured = match layout {
        PaneLayout::Horizontal | PaneLayout::Vertical => cfg.linear_pane_size_percent,
        PaneLayout::Grid => cfg.grid_pane_size_percent,
    };

    configured.clamp(MIN_PANE_SIZE_PERCENT, MAX_PANE_SIZE_PERCENT)
}

fn recommended_spawn_layout(live_session_count: usize) -> PaneLayout {
    if live_session_count >= 3 {
        PaneLayout::Grid
    } else {
        PaneLayout::Vertical
    }
}

fn pane_layout_name(layout: PaneLayout) -> &'static str {
    match layout {
        PaneLayout::Horizontal => "horizontal",
        PaneLayout::Vertical => "vertical",
        PaneLayout::Grid => "grid",
    }
}

fn horizontal_detail_layout(area: Rect, panes: &[Pane]) -> Vec<(Pane, Rect)> {
    match panes {
        [] => Vec::new(),
        [pane] => vec![(*pane, area)],
        [first, second] => {
            let rows = Layout::default()
                .direction(Direction::Vertical)
                .constraints([
                    Constraint::Percentage(OUTPUT_PANE_PERCENT),
                    Constraint::Percentage(100 - OUTPUT_PANE_PERCENT),
                ])
                .split(area);
            vec![(*first, rows[0]), (*second, rows[1])]
        }
        _ => unreachable!("horizontal layouts support at most two detail panes"),
    }
}

fn vertical_detail_layout(area: Rect, panes: &[Pane]) -> Vec<(Pane, Rect)> {
    match panes {
        [] => Vec::new(),
        [pane] => vec![(*pane, area)],
        [first, second] => {
            let columns = Layout::default()
                .direction(Direction::Horizontal)
                .constraints([
                    Constraint::Percentage(OUTPUT_PANE_PERCENT),
                    Constraint::Percentage(100 - OUTPUT_PANE_PERCENT),
                ])
                .split(area);
            vec![(*first, columns[0]), (*second, columns[1])]
        }
        _ => unreachable!("vertical layouts support at most two detail panes"),
    }
}

fn compile_search_regex(query: &str) -> Result<Regex, regex::Error> {
    Regex::new(query)
}

fn highlight_output_line(
    text: &str,
    query: &str,
    is_current_match: bool,
    palette: ThemePalette,
) -> Line<'static> {
    if query.is_empty() {
        return Line::from(text.to_string());
    }

    let Ok(regex) = compile_search_regex(query) else {
        return Line::from(text.to_string());
    };

    let mut spans = Vec::new();
    let mut cursor = 0;
    for matched in regex.find_iter(text) {
        let start = matched.start();
        let end = matched.end();

        if start > cursor {
            spans.push(Span::raw(text[cursor..start].to_string()));
        }

        let match_style = if is_current_match {
            Style::default()
                .bg(palette.accent)
                .fg(Color::Black)
                .add_modifier(Modifier::BOLD)
        } else {
            Style::default().bg(Color::Yellow).fg(Color::Black)
        };
        spans.push(Span::styled(text[start..end].to_string(), match_style));
        cursor = end;
    }

    if cursor < text.len() {
        spans.push(Span::raw(text[cursor..].to_string()));
    }

    if spans.is_empty() {
        Line::from(text.to_string())
    } else {
        Line::from(spans)
    }
}

fn build_worktree_diff_columns(patch: &str, palette: ThemePalette) -> WorktreeDiffColumns {
    let mut removals = Vec::new();
    let mut additions = Vec::new();
    let mut hunk_offsets = Vec::new();
    let mut pending_removals = Vec::new();
    let mut pending_additions = Vec::new();

    for line in patch.lines() {
        if is_diff_removal_line(line) {
            pending_removals.push(line[1..].to_string());
            continue;
        }

        if is_diff_addition_line(line) {
            pending_additions.push(line[1..].to_string());
            continue;
        }

        flush_split_diff_change_block(
            &mut removals,
            &mut additions,
            &mut pending_removals,
            &mut pending_additions,
            palette,
        );

        if line.is_empty() {
            continue;
        }

        if line.starts_with("@@") {
            hunk_offsets.push(removals.len().max(additions.len()));
        }

        let styled_line = if line.starts_with(' ') {
            styled_diff_context_line(line, palette)
        } else {
            styled_diff_meta_line(split_diff_display_line(line), palette)
        };
        removals.push(styled_line.clone());
        additions.push(styled_line);
    }

    flush_split_diff_change_block(
        &mut removals,
        &mut additions,
        &mut pending_removals,
        &mut pending_additions,
        palette,
    );

    WorktreeDiffColumns {
        removals: if removals.is_empty() {
            Text::from("No removals in this bounded preview.")
        } else {
            Text::from(removals)
        },
        additions: if additions.is_empty() {
            Text::from("No additions in this bounded preview.")
        } else {
            Text::from(additions)
        },
        hunk_offsets,
    }
}

fn build_unified_diff_text(patch: &str, palette: ThemePalette) -> Text<'static> {
    let mut lines = Vec::new();
    let mut pending_removals = Vec::new();
    let mut pending_additions = Vec::new();

    for line in patch.lines() {
        if is_diff_removal_line(line) {
            pending_removals.push(line[1..].to_string());
            continue;
        }

        if is_diff_addition_line(line) {
            pending_additions.push(line[1..].to_string());
            continue;
        }

        flush_unified_diff_change_block(
            &mut lines,
            &mut pending_removals,
            &mut pending_additions,
            palette,
        );

        if line.is_empty() {
            continue;
        }

        lines.push(if line.starts_with(' ') {
            styled_diff_context_line(line, palette)
        } else {
            styled_diff_meta_line(line, palette)
        });
    }

    flush_unified_diff_change_block(
        &mut lines,
        &mut pending_removals,
        &mut pending_additions,
        palette,
    );

    Text::from(lines)
}

fn build_unified_diff_hunk_offsets(patch: &str) -> Vec<usize> {
    let mut offsets = Vec::new();
    let mut rendered_index = 0usize;
    let mut pending_removals = 0usize;
    let mut pending_additions = 0usize;

    for line in patch.lines() {
        if is_diff_removal_line(line) {
            pending_removals += 1;
            continue;
        }

        if is_diff_addition_line(line) {
            pending_additions += 1;
            continue;
        }

        if pending_removals > 0 || pending_additions > 0 {
            rendered_index += pending_removals + pending_additions;
            pending_removals = 0;
            pending_additions = 0;
        }

        if line.is_empty() {
            continue;
        }

        if line.starts_with("@@") {
            offsets.push(rendered_index);
        }
        rendered_index += 1;
    }

    offsets
}

fn flush_split_diff_change_block(
    removals: &mut Vec<Line<'static>>,
    additions: &mut Vec<Line<'static>>,
    pending_removals: &mut Vec<String>,
    pending_additions: &mut Vec<String>,
    palette: ThemePalette,
) {
    let pair_count = pending_removals.len().max(pending_additions.len());
    for index in 0..pair_count {
        match (pending_removals.get(index), pending_additions.get(index)) {
            (Some(removal), Some(addition)) => {
                let (removal_mask, addition_mask) =
                    diff_word_change_masks(removal.as_str(), addition.as_str());
                removals.push(styled_diff_change_line(
                    '-',
                    removal,
                    &removal_mask,
                    diff_removal_style(palette),
                    diff_removal_word_style(),
                ));
                additions.push(styled_diff_change_line(
                    '+',
                    addition,
                    &addition_mask,
                    diff_addition_style(palette),
                    diff_addition_word_style(),
                ));
            }
            (Some(removal), None) => {
                removals.push(styled_diff_change_line(
                    '-',
                    removal,
                    &vec![false; tokenize_diff_words(removal).len()],
                    diff_removal_style(palette),
                    diff_removal_word_style(),
                ));
                additions.push(Line::from(""));
            }
            (None, Some(addition)) => {
                removals.push(Line::from(""));
                additions.push(styled_diff_change_line(
                    '+',
                    addition,
                    &vec![false; tokenize_diff_words(addition).len()],
                    diff_addition_style(palette),
                    diff_addition_word_style(),
                ));
            }
            (None, None) => {}
        }
    }

    pending_removals.clear();
    pending_additions.clear();
}

fn flush_unified_diff_change_block(
    lines: &mut Vec<Line<'static>>,
    pending_removals: &mut Vec<String>,
    pending_additions: &mut Vec<String>,
    palette: ThemePalette,
) {
    let pair_count = pending_removals.len().max(pending_additions.len());
    for index in 0..pair_count {
        match (pending_removals.get(index), pending_additions.get(index)) {
            (Some(removal), Some(addition)) => {
                let (removal_mask, addition_mask) =
                    diff_word_change_masks(removal.as_str(), addition.as_str());
                lines.push(styled_diff_change_line(
                    '-',
                    removal,
                    &removal_mask,
                    diff_removal_style(palette),
                    diff_removal_word_style(),
                ));
                lines.push(styled_diff_change_line(
                    '+',
                    addition,
                    &addition_mask,
                    diff_addition_style(palette),
                    diff_addition_word_style(),
                ));
            }
            (Some(removal), None) => lines.push(styled_diff_change_line(
                '-',
                removal,
                &vec![false; tokenize_diff_words(removal).len()],
                diff_removal_style(palette),
                diff_removal_word_style(),
            )),
            (None, Some(addition)) => lines.push(styled_diff_change_line(
                '+',
                addition,
                &vec![false; tokenize_diff_words(addition).len()],
                diff_addition_style(palette),
                diff_addition_word_style(),
            )),
            (None, None) => {}
        }
    }

    pending_removals.clear();
    pending_additions.clear();
}

fn split_diff_display_line(line: &str) -> String {
    if line.starts_with("--- ") && !line.starts_with("--- a/") {
        return line.to_string();
    }

    if let Some(path) = line.strip_prefix("--- a/") {
        return format!("File {path}");
    }

    if let Some(path) = line.strip_prefix("+++ b/") {
        return format!("File {path}");
    }

    line.to_string()
}

fn is_diff_removal_line(line: &str) -> bool {
    line.starts_with('-') && !line.starts_with("--- ")
}

fn is_diff_addition_line(line: &str) -> bool {
    line.starts_with('+') && !line.starts_with("+++ ")
}

fn styled_diff_meta_line(text: impl Into<String>, palette: ThemePalette) -> Line<'static> {
    Line::from(vec![Span::styled(text.into(), diff_meta_style(palette))])
}

fn styled_diff_context_line(text: &str, palette: ThemePalette) -> Line<'static> {
    Line::from(vec![Span::styled(
        text.to_string(),
        diff_context_style(palette),
    )])
}

fn styled_diff_change_line(
    prefix: char,
    body: &str,
    change_mask: &[bool],
    base_style: Style,
    changed_style: Style,
) -> Line<'static> {
    let tokens = tokenize_diff_words(body);
    let mut spans = vec![Span::styled(
        prefix.to_string(),
        base_style.add_modifier(Modifier::BOLD),
    )];

    for (index, token) in tokens.into_iter().enumerate() {
        let style = if change_mask.get(index).copied().unwrap_or(false) {
            changed_style
        } else {
            base_style
        };
        spans.push(Span::styled(token, style));
    }

    Line::from(spans)
}

fn tokenize_diff_words(text: &str) -> Vec<String> {
    if text.is_empty() {
        return Vec::new();
    }

    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut current_is_whitespace: Option<bool> = None;

    for ch in text.chars() {
        let is_whitespace = ch.is_whitespace();
        match current_is_whitespace {
            Some(state) if state == is_whitespace => current.push(ch),
            Some(_) => {
                tokens.push(std::mem::take(&mut current));
                current.push(ch);
                current_is_whitespace = Some(is_whitespace);
            }
            None => {
                current.push(ch);
                current_is_whitespace = Some(is_whitespace);
            }
        }
    }

    if !current.is_empty() {
        tokens.push(current);
    }

    tokens
}

fn diff_word_change_masks(left: &str, right: &str) -> (Vec<bool>, Vec<bool>) {
    let left_tokens = tokenize_diff_words(left);
    let right_tokens = tokenize_diff_words(right);
    let left_len = left_tokens.len();
    let right_len = right_tokens.len();
    let mut lcs = vec![vec![0usize; right_len + 1]; left_len + 1];

    for left_index in (0..left_len).rev() {
        for right_index in (0..right_len).rev() {
            lcs[left_index][right_index] = if left_tokens[left_index] == right_tokens[right_index] {
                lcs[left_index + 1][right_index + 1] + 1
            } else {
                lcs[left_index + 1][right_index].max(lcs[left_index][right_index + 1])
            };
        }
    }

    let mut left_changed = vec![true; left_len];
    let mut right_changed = vec![true; right_len];
    let (mut left_index, mut right_index) = (0usize, 0usize);
    while left_index < left_len && right_index < right_len {
        if left_tokens[left_index] == right_tokens[right_index] {
            left_changed[left_index] = false;
            right_changed[right_index] = false;
            left_index += 1;
            right_index += 1;
        } else if lcs[left_index + 1][right_index] >= lcs[left_index][right_index + 1] {
            left_index += 1;
        } else {
            right_index += 1;
        }
    }

    (left_changed, right_changed)
}

fn diff_meta_style(palette: ThemePalette) -> Style {
    Style::default()
        .fg(palette.accent)
        .add_modifier(Modifier::BOLD)
}

fn diff_context_style(palette: ThemePalette) -> Style {
    Style::default().fg(palette.muted)
}

fn diff_removal_style(palette: ThemePalette) -> Style {
    let color = match palette.accent {
        Color::Blue => Color::Red,
        _ => Color::LightRed,
    };
    Style::default().fg(color)
}

fn diff_addition_style(palette: ThemePalette) -> Style {
    let color = match palette.accent {
        Color::Blue => Color::Green,
        _ => Color::LightGreen,
    };
    Style::default().fg(color)
}

fn diff_removal_word_style() -> Style {
    Style::default()
        .bg(Color::Red)
        .fg(Color::Black)
        .add_modifier(Modifier::BOLD)
}

fn diff_addition_word_style() -> Style {
    Style::default()
        .bg(Color::Green)
        .fg(Color::Black)
        .add_modifier(Modifier::BOLD)
}

fn board_lane_label(state: &SessionState) -> &'static str {
    match state {
        SessionState::Pending => "Inbox",
        SessionState::Running => "In Progress",
        SessionState::Idle => "Review",
        SessionState::Stale | SessionState::Failed => "Blocked",
        SessionState::Completed => "Done",
        SessionState::Stopped => "Stopped",
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

fn session_state_color(state: &SessionState) -> Color {
    match state {
        SessionState::Running => Color::Green,
        SessionState::Idle => Color::Yellow,
        SessionState::Stale => Color::LightRed,
        SessionState::Failed => Color::Red,
        SessionState::Stopped => Color::DarkGray,
        SessionState::Completed => Color::Blue,
        SessionState::Pending => Color::Reset,
    }
}

fn board_codename(session: &Session) -> String {
    const ADJECTIVES: &[&str] = &[
        "Amber", "Cinder", "Moss", "Nova", "Sable", "Slate", "Swift", "Talon",
    ];
    const NOUNS: &[&str] = &[
        "Fox", "Kite", "Lynx", "Otter", "Rook", "Sprite", "Wisp", "Wolf",
    ];

    let seed = session
        .id
        .bytes()
        .fold(0usize, |acc, byte| acc.wrapping_mul(33).wrapping_add(byte as usize));
    format!(
        "{} {}",
        ADJECTIVES[seed % ADJECTIVES.len()],
        NOUNS[(seed / ADJECTIVES.len()) % NOUNS.len()]
    )
}

fn file_activity_summary(entry: &FileActivityEntry) -> String {
    let mut summary = format!(
        "{} {}",
        file_activity_verb(entry.action.clone()),
        truncate_for_dashboard(&entry.path, 72)
    );

    if let Some(diff_preview) = entry.diff_preview.as_ref() {
        summary.push_str(" | ");
        summary.push_str(&truncate_for_dashboard(diff_preview, 56));
    }

    summary
}

fn file_activity_patch_lines(entry: &FileActivityEntry, max_lines: usize) -> Vec<String> {
    entry
        .patch_preview
        .as_deref()
        .map(|patch| {
            patch
                .lines()
                .map(str::trim)
                .filter(|line| !line.is_empty() && *line != "@@" && *line != "+" && *line != "-")
                .take(max_lines)
                .map(|line| truncate_for_dashboard(line, 72))
                .collect()
        })
        .unwrap_or_default()
}

fn file_overlap_summary(entry: &FileActivityOverlap, timestamp: &str) -> String {
    format!(
        "{} {} | {} {} as {} | {}",
        file_activity_verb(entry.current_action.clone()),
        truncate_for_dashboard(&entry.path, 48),
        entry.other_session_state,
        format_session_id(&entry.other_session_id),
        file_activity_verb(entry.other_action.clone()),
        timestamp
    )
}

fn conflict_incident_summary(
    incident: &crate::session::store::ConflictIncident,
    timestamp: &str,
) -> String {
    format!(
        "{} {} | active {} | paused {} | {}",
        timestamp,
        truncate_for_dashboard(&incident.path, 48),
        format_session_id(&incident.active_session_id),
        format_session_id(&incident.paused_session_id),
        incident.strategy.replace('_', "-")
    )
}

fn decision_log_summary(entry: &DecisionLogEntry) -> String {
    format!("decided {}", truncate_for_dashboard(&entry.decision, 72))
}

fn decision_log_detail_lines(entry: &DecisionLogEntry) -> Vec<String> {
    let mut lines = vec![format!(
        "why {}",
        truncate_for_dashboard(&entry.reasoning, 72)
    )];
    if entry.alternatives.is_empty() {
        lines.push("alternatives none recorded".to_string());
    } else {
        for alternative in entry.alternatives.iter().take(3) {
            lines.push(format!(
                "alternative {}",
                truncate_for_dashboard(alternative, 72)
            ));
        }
    }
    lines
}

fn tool_log_detail_lines(entry: &ToolLogEntry) -> Vec<String> {
    let mut lines = Vec::new();
    if !entry.trigger_summary.trim().is_empty() {
        lines.push(format!(
            "why {}",
            truncate_for_dashboard(&entry.trigger_summary, 72)
        ));
    }
    if entry.input_params_json.trim() != "{}" {
        lines.push(format!(
            "params {}",
            truncate_for_dashboard(&entry.input_params_json, 72)
        ));
    }
    lines
}

fn centered_rect(width_percent: u16, height_percent: u16, area: Rect) -> Rect {
    let vertical = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Percentage((100 - height_percent) / 2),
            Constraint::Percentage(height_percent),
            Constraint::Percentage((100 - height_percent) / 2),
        ])
        .split(area);
    Layout::default()
        .direction(Direction::Horizontal)
        .constraints([
            Constraint::Percentage((100 - width_percent) / 2),
            Constraint::Percentage(width_percent),
            Constraint::Percentage((100 - width_percent) / 2),
        ])
        .split(vertical[1])[1]
}

fn summarize_test_runs(
    tool_logs: &[ToolLogEntry],
    assume_success_on_completion: bool,
) -> TestRunSummary {
    let mut summary = TestRunSummary::default();

    for entry in tool_logs {
        if !tool_log_looks_like_test(entry) {
            continue;
        }

        summary.total += 1;
        let failed = tool_log_looks_failed(entry);
        let passed = tool_log_looks_passed(entry);
        if !failed && (passed || assume_success_on_completion) {
            summary.passed += 1;
        }
    }

    summary
}

fn tool_log_looks_like_test(entry: &ToolLogEntry) -> bool {
    let haystack = format!(
        "{} {} {} {}",
        entry.tool_name,
        entry.input_summary,
        extract_tool_command(entry),
        entry.output_summary
    )
    .to_ascii_lowercase();
    const TEST_MARKERS: &[&str] = &[
        "cargo test",
        "npm test",
        "pnpm test",
        "pnpm exec vitest",
        "pnpm exec playwright",
        "yarn test",
        "bun test",
        "vitest",
        "jest",
        "pytest",
        "go test",
        "playwright test",
        "cypress",
        "rspec",
        "phpunit",
        "e2e",
    ];

    TEST_MARKERS.iter().any(|marker| haystack.contains(marker))
}

fn tool_log_looks_failed(entry: &ToolLogEntry) -> bool {
    let haystack = format!(
        "{} {} {} {}",
        entry.tool_name,
        entry.input_summary,
        extract_tool_command(entry),
        entry.output_summary
    )
    .to_ascii_lowercase();
    const FAILURE_MARKERS: &[&str] = &[
        " fail",
        "failed",
        " error",
        "panic",
        "timed out",
        "non-zero",
        "exit code 1",
        "exited with",
    ];

    FAILURE_MARKERS
        .iter()
        .any(|marker| haystack.contains(marker))
}

fn tool_log_looks_passed(entry: &ToolLogEntry) -> bool {
    let haystack = format!(
        "{} {} {} {}",
        entry.tool_name,
        entry.input_summary,
        extract_tool_command(entry),
        entry.output_summary
    )
    .to_ascii_lowercase();
    const SUCCESS_MARKERS: &[&str] = &[" pass", "passed", " ok", "success", "green", "completed"];

    SUCCESS_MARKERS
        .iter()
        .any(|marker| haystack.contains(marker))
}

fn extract_tool_command(entry: &ToolLogEntry) -> String {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&entry.input_params_json) else {
        return String::new();
    };

    value
        .get("command")
        .and_then(serde_json::Value::as_str)
        .map(str::to_owned)
        .unwrap_or_default()
}

fn recent_completion_files(file_activity: &[FileActivityEntry], files_changed: u32) -> Vec<String> {
    if !file_activity.is_empty() {
        return file_activity
            .iter()
            .take(3)
            .map(file_activity_summary)
            .collect();
    }

    if files_changed > 0 {
        return vec![format!("files touched {}", files_changed)];
    }

    Vec::new()
}

fn summarize_completion_decisions(
    tool_logs: &[ToolLogEntry],
    file_activity: &[FileActivityEntry],
    session_task: &str,
) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut decisions = Vec::new();

    for entry in tool_logs.iter().rev() {
        let mut candidates = Vec::new();
        if !entry.trigger_summary.trim().is_empty()
            && entry.trigger_summary.trim() != session_task.trim()
        {
            candidates.push(format!(
                "why {}",
                truncate_for_dashboard(&entry.trigger_summary, 72)
            ));
        }

        let action = if entry.tool_name.eq_ignore_ascii_case("Bash") {
            truncate_for_dashboard(&extract_tool_command(entry), 72)
        } else if !entry.output_summary.trim().is_empty() && entry.output_summary.trim() != "ok" {
            truncate_for_dashboard(&entry.output_summary, 72)
        } else {
            truncate_for_dashboard(&entry.input_summary, 72)
        };

        if !action.trim().is_empty() {
            candidates.push(action);
        }

        for candidate in candidates {
            let normalized = candidate.to_ascii_lowercase();
            if seen.insert(normalized) {
                decisions.push(candidate);
            }
            if decisions.len() >= 3 {
                return decisions;
            }
        }
    }

    for entry in file_activity.iter().take(3) {
        let candidate = file_activity_summary(entry);
        let normalized = candidate.to_ascii_lowercase();
        if seen.insert(normalized) {
            decisions.push(candidate);
        }
        if decisions.len() >= 3 {
            break;
        }
    }

    decisions
}

fn summarize_completion_warnings(
    session: &Session,
    tool_logs: &[ToolLogEntry],
    tests: &TestRunSummary,
    worktree_health: Option<&worktree::WorktreeHealth>,
    approval_backlog: usize,
    overlap_count: usize,
) -> Vec<String> {
    let mut warnings = Vec::new();
    let high_risk_tool_calls = tool_logs
        .iter()
        .filter(|entry| entry.risk_score >= Config::RISK_THRESHOLDS.review)
        .count();

    if session.metrics.files_changed > 0 && tests.total == 0 {
        warnings.push("no test runs detected".to_string());
    }
    if tests.total > tests.passed {
        warnings.push(format!(
            "{} detected test run(s) were not confirmed passed",
            tests.total - tests.passed
        ));
    }
    if high_risk_tool_calls > 0 {
        warnings.push(format!(
            "{high_risk_tool_calls} high-risk tool call(s) recorded"
        ));
    }
    if approval_backlog > 0 {
        warnings.push(format!(
            "{approval_backlog} approval/conflict request(s) remained unread"
        ));
    }
    if overlap_count > 0 {
        warnings.push(format!(
            "{overlap_count} potential file overlap(s) remained"
        ));
    }
    match worktree_health {
        Some(worktree::WorktreeHealth::Conflicted) => {
            warnings.push("worktree still has unresolved conflicts".to_string());
        }
        Some(worktree::WorktreeHealth::InProgress) => {
            warnings.push("worktree still has unmerged changes".to_string());
        }
        Some(worktree::WorktreeHealth::Clear) | None => {}
    }

    warnings
}

fn completion_summary_observation_details(
    summary: &SessionCompletionSummary,
    session: &Session,
) -> BTreeMap<String, String> {
    let mut details = BTreeMap::new();
    details.insert("state".to_string(), session.state.to_string());
    details.insert(
        "files_changed".to_string(),
        summary.files_changed.to_string(),
    );
    details.insert("tokens_used".to_string(), summary.tokens_used.to_string());
    details.insert(
        "duration_secs".to_string(),
        summary.duration_secs.to_string(),
    );
    details.insert("cost_usd".to_string(), format!("{:.4}", summary.cost_usd));
    details.insert("tests_run".to_string(), summary.tests_run.to_string());
    details.insert("tests_passed".to_string(), summary.tests_passed.to_string());
    if !summary.recent_files.is_empty() {
        details.insert("recent_files".to_string(), summary.recent_files.join(" | "));
    }
    if !summary.key_decisions.is_empty() {
        details.insert(
            "key_decisions".to_string(),
            summary.key_decisions.join(" | "),
        );
    }
    if !summary.warnings.is_empty() {
        details.insert("warnings".to_string(), summary.warnings.join(" | "));
    }
    details
}

fn session_started_webhook_body(session: &Session, compare_url: Option<&str>) -> String {
    let mut lines = vec![
        "*ECC 2.0: Session started*".to_string(),
        format!(
            "`{}` {}",
            format_session_id(&session.id),
            truncate_for_dashboard(&session.task, 96)
        ),
        format!(
            "Project `{}` | Group `{}` | Agent `{}`",
            session.project, session.task_group, session.agent_type
        ),
    ];

    if let Some(worktree) = session.worktree.as_ref() {
        lines.push(format!(
            "```text\nbranch: {}\nbase: {}\nworktree: {}\n```",
            worktree.branch,
            worktree.base_branch,
            worktree.path.display()
        ));
    }

    if let Some(compare_url) = compare_url {
        lines.push(format!("PR / compare: {compare_url}"));
    }

    lines.join("\n")
}

fn completion_summary_webhook_body(
    summary: &SessionCompletionSummary,
    session: &Session,
    compare_url: Option<&str>,
) -> String {
    let mut lines = vec![
        format!("*{}*", summary.title()),
        format!(
            "`{}` {}",
            format_session_id(&summary.session_id),
            truncate_for_dashboard(&summary.task, 96)
        ),
        format!(
            "Project `{}` | Group `{}` | State `{}`",
            session.project, session.task_group, session.state
        ),
        format!(
            "Duration `{}` | Files `{}` | Tokens `{}` | Cost `{}`",
            format_duration(summary.duration_secs),
            summary.files_changed,
            format_token_count(summary.tokens_used),
            format_currency(summary.cost_usd)
        ),
        if summary.tests_run > 0 {
            format!(
                "Tests `{}` run / `{}` passed",
                summary.tests_run, summary.tests_passed
            )
        } else {
            "Tests `not detected`".to_string()
        },
    ];

    if !summary.recent_files.is_empty() {
        lines.push(markdown_code_block("Recent files", &summary.recent_files));
    }

    if !summary.key_decisions.is_empty() {
        lines.push(markdown_code_block("Key decisions", &summary.key_decisions));
    }

    if !summary.warnings.is_empty() {
        lines.push(markdown_code_block("Warnings", &summary.warnings));
    }

    if let Some(compare_url) = compare_url {
        lines.push(format!("PR / compare: {compare_url}"));
    }

    lines.join("\n")
}

fn budget_alert_webhook_body(
    summary_suffix: &str,
    token_budget: &str,
    cost_budget: &str,
    active_sessions: usize,
) -> String {
    [
        "*ECC 2.0: Budget alert*".to_string(),
        summary_suffix.to_string(),
        format!("Tokens `{token_budget}`"),
        format!("Cost `{cost_budget}`"),
        format!("Active sessions `{active_sessions}`"),
    ]
    .join("\n")
}

fn approval_request_webhook_body(message: &SessionMessage, preview: &str) -> String {
    [
        "*ECC 2.0: Approval needed*".to_string(),
        format!(
            "To `{}` from `{}`",
            format_session_id(&message.to_session),
            format_session_id(&message.from_session)
        ),
        format!("Type `{}`", message.msg_type),
        markdown_code_block("Request", &[preview.to_string()]),
    ]
    .join("\n")
}

fn markdown_code_block(label: &str, lines: &[String]) -> String {
    format!("{label}\n```text\n{}\n```", lines.join("\n"))
}

fn session_compare_url(session: &Session) -> Option<String> {
    session
        .worktree
        .as_ref()
        .and_then(|worktree| worktree::github_compare_url(worktree).ok().flatten())
}

fn file_activity_verb(action: crate::session::FileActivityAction) -> &'static str {
    match action {
        crate::session::FileActivityAction::Read => "read",
        crate::session::FileActivityAction::Create => "create",
        crate::session::FileActivityAction::Modify => "modify",
        crate::session::FileActivityAction::Move => "move",
        crate::session::FileActivityAction::Delete => "delete",
        crate::session::FileActivityAction::Touch => "touch",
    }
}

fn heartbeat_enforcement_note(outcome: &manager::HeartbeatEnforcementOutcome) -> String {
    if !outcome.auto_terminated_sessions.is_empty() {
        return format!(
            "stale heartbeat detected | auto-terminated {} session(s)",
            outcome.auto_terminated_sessions.len()
        );
    }

    format!(
        "stale heartbeat detected | flagged {} session(s) for attention",
        outcome.stale_sessions.len()
    )
}

fn budget_auto_pause_note(outcome: &manager::BudgetEnforcementOutcome) -> String {
    let cause = match (
        outcome.token_budget_exceeded,
        outcome.cost_budget_exceeded,
        outcome.profile_token_budget_exceeded,
    ) {
        (true, true, _) => "token and cost budgets exceeded",
        (true, false, _) => "token budget exceeded",
        (false, true, _) => "cost budget exceeded",
        (false, false, true) => "profile token budget exceeded",
        (false, false, false) => "budget exceeded",
    };

    format!(
        "{cause} | auto-paused {} active session(s)",
        outcome.paused_sessions.len()
    )
}

fn conflict_enforcement_note(outcome: &manager::ConflictEnforcementOutcome) -> String {
    let strategy = match outcome.strategy {
        crate::config::ConflictResolutionStrategy::Escalate => "escalation",
        crate::config::ConflictResolutionStrategy::LastWriteWins => "last-write-wins",
        crate::config::ConflictResolutionStrategy::Merge => "merge review",
    };

    format!(
        "file conflict detected | opened {} incident(s), auto-paused {} session(s) via {}",
        outcome.created_incidents,
        outcome.paused_sessions.len(),
        strategy
    )
}

fn format_session_id(id: &str) -> String {
    id.chars().take(8).collect()
}

fn build_conflict_protocol(
    session_id: &str,
    worktree: &crate::session::WorktreeInfo,
    merge_readiness: &worktree::MergeReadiness,
) -> Option<String> {
    if merge_readiness.status != worktree::MergeReadinessStatus::Conflicted {
        return None;
    }

    let mut lines = vec![
        format!("Conflict protocol for {}", format_session_id(session_id)),
        format!("Worktree {}", worktree.path.display()),
        format!("Branch {} (base {})", worktree.branch, worktree.base_branch),
        merge_readiness.summary.clone(),
    ];

    if !merge_readiness.conflicts.is_empty() {
        lines.push("Conflicts".to_string());
        for conflict in &merge_readiness.conflicts {
            lines.push(format!("- {conflict}"));
        }
    }

    lines.push("Resolution steps".to_string());
    lines.push(format!(
        "1. Inspect current patch: ecc worktree-status {session_id} --patch"
    ));
    lines.push(format!("2. Open worktree: cd {}", worktree.path.display()));
    lines.push("3. Resolve conflicts and stage files: git add <paths>".to_string());
    lines.push(format!(
        "4. Commit the resolution on {}: git commit",
        worktree.branch
    ));
    lines.push(format!(
        "5. Re-check readiness: ecc worktree-status {session_id} --check"
    ));
    lines.push(format!(
        "6. Merge when clear: ecc merge-worktree {session_id}"
    ));

    Some(lines.join("\n"))
}

fn build_session_conflict_protocol(
    session_id: &str,
    incidents: &[crate::session::store::ConflictIncident],
) -> Option<String> {
    if incidents.is_empty() {
        return None;
    }

    let mut lines = vec![
        format!("Conflict protocol for {}", format_session_id(session_id)),
        "Session overlap incidents".to_string(),
    ];

    for incident in incidents {
        lines.push(format!(
            "- {}",
            conflict_incident_summary(
                incident,
                &incident.updated_at.format("%H:%M:%S").to_string()
            )
        ));
        lines.push(format!("  {}", incident.summary));
    }

    lines.push("Resolution steps".to_string());
    lines.push("1. Inspect the affected session output and recent file activity".to_string());
    lines.push(
        "2. Decide whether to keep the active session, reassign, or merge changes manually"
            .to_string(),
    );
    lines.push(format!(
        "3. Resume the paused session only after reviewing the overlap: ecc resume {}",
        session_id
    ));

    Some(lines.join("\n"))
}

fn assignment_action_label(action: manager::AssignmentAction) -> &'static str {
    match action {
        manager::AssignmentAction::Spawned => "spawned",
        manager::AssignmentAction::ReusedIdle => "reused idle",
        manager::AssignmentAction::ReusedActive => "reused active",
        manager::AssignmentAction::DeferredSaturated => "deferred saturated",
    }
}

fn parse_pr_prompt(input: &str) -> std::result::Result<PrPromptSpec, String> {
    let mut segments = input.split('|').map(str::trim);
    let title = segments.next().unwrap_or_default().trim().to_string();
    if title.is_empty() {
        return Err("missing PR title".to_string());
    }

    let mut request = PrPromptSpec {
        title,
        base_branch: None,
        labels: Vec::new(),
        reviewers: Vec::new(),
    };

    for segment in segments {
        if segment.is_empty() {
            continue;
        }
        let (key, value) = segment
            .split_once('=')
            .ok_or_else(|| format!("expected key=value segment, got `{segment}`"))?;
        let key = key.trim().to_ascii_lowercase();
        let value = value.trim();
        match key.as_str() {
            "base" => {
                if value.is_empty() {
                    return Err("base branch cannot be empty".to_string());
                }
                request.base_branch = Some(value.to_string());
            }
            "labels" | "label" => {
                request.labels = value
                    .split(',')
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(ToOwned::to_owned)
                    .collect();
            }
            "reviewers" | "reviewer" => {
                request.reviewers = value
                    .split(',')
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(ToOwned::to_owned)
                    .collect();
            }
            _ => return Err(format!("unsupported PR field `{key}`")),
        }
    }

    Ok(request)
}

fn delegate_worktree_health_label(health: worktree::WorktreeHealth) -> &'static str {
    match health {
        worktree::WorktreeHealth::Clear => "clear",
        worktree::WorktreeHealth::InProgress => "in progress",
        worktree::WorktreeHealth::Conflicted => "conflicted",
    }
}

fn delegate_next_action(delegate: &DelegatedChildSummary) -> &'static str {
    if delegate.worktree_health == Some(worktree::WorktreeHealth::Conflicted) {
        return "resolve conflict";
    }
    if delegate.approval_backlog > 0 {
        return "review approvals";
    }
    if delegate.handoff_backlog > 0 && delegate.state == SessionState::Idle {
        return "process handoff";
    }
    if delegate.handoff_backlog > 0 {
        return "drain backlog";
    }
    if delegate.worktree_health == Some(worktree::WorktreeHealth::InProgress) {
        return "finish worktree changes";
    }
    match delegate.state {
        SessionState::Pending => "wait for startup",
        SessionState::Running => "let it run",
        SessionState::Idle => "assign next task",
        SessionState::Stale => "inspect stale heartbeat",
        SessionState::Failed => "inspect failure",
        SessionState::Stopped => "resume or reassign",
        SessionState::Completed => "merge or cleanup",
    }
}

fn delegate_attention_priority(delegate: &DelegatedChildSummary) -> u8 {
    if delegate.worktree_health == Some(worktree::WorktreeHealth::Conflicted) {
        return 0;
    }
    if delegate.approval_backlog > 0 {
        return 1;
    }
    if matches!(
        delegate.state,
        SessionState::Stale | SessionState::Failed | SessionState::Stopped
    ) {
        return 2;
    }
    if delegate.handoff_backlog > 0 {
        return 3;
    }
    if delegate.worktree_health == Some(worktree::WorktreeHealth::InProgress) {
        return 4;
    }
    match delegate.state {
        SessionState::Pending => 5,
        SessionState::Running => 6,
        SessionState::Idle => 7,
        SessionState::Completed => 8,
        SessionState::Stale | SessionState::Failed | SessionState::Stopped => unreachable!(),
    }
}

fn session_branch(session: &Session) -> String {
    session
        .worktree
        .as_ref()
        .map(|worktree| worktree.branch.clone())
        .unwrap_or_else(|| "-".to_string())
}

fn board_progress_bar(progress_percent: i64) -> String {
    let clamped = progress_percent.clamp(0, 100);
    let filled = ((clamped + 9) / 10) as usize;
    let empty = 10usize.saturating_sub(filled);
    format!("[{}{}]", "#".repeat(filled), ".".repeat(empty))
}

fn board_presence_marker(session: &Session) -> String {
    let codename = board_codename(session);
    let initials = codename
        .split_whitespace()
        .filter_map(|part| part.chars().next())
        .take(2)
        .collect::<String>()
        .to_ascii_uppercase();
    format!("@{initials}")
}

fn board_motion_marker(meta: &SessionBoardMeta) -> &'static str {
    match meta.movement_note.as_deref() {
        Some("Blocked") => "x",
        Some("Completed") => "*",
        Some(note) if note.starts_with("Moved ") => ">",
        Some(note) if note.starts_with("Retargeted ") => "~",
        _ => ".",
    }
}

fn board_activity_marker(meta: &SessionBoardMeta) -> &'static str {
    match meta.activity_kind.as_deref() {
        Some("received") => "<",
        Some("delegated") => ">",
        Some("spawned") => "+",
        Some("spawned_fallback") => "#",
        _ => "",
    }
}

fn format_duration(duration_secs: u64) -> String {
    let hours = duration_secs / 3600;
    let minutes = (duration_secs % 3600) / 60;
    let seconds = duration_secs % 60;
    format!("{hours:02}:{minutes:02}:{seconds:02}")
}

fn metrics_file_signature(path: &std::path::Path) -> Option<(u64, u128)> {
    let metadata = std::fs::metadata(path).ok()?;
    let modified = metadata
        .modified()
        .ok()?
        .duration_since(UNIX_EPOCH)
        .ok()?
        .as_nanos();
    Some((metadata.len(), modified))
}

#[cfg(test)]
mod tests {
    use anyhow::{Context, Result};
    use chrono::Utc;
    use ratatui::{backend::TestBackend, Terminal};
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::process::Command;
    use uuid::Uuid;

    use super::*;
    use crate::config::{Config, PaneLayout, Theme};

    #[test]
    fn render_sessions_shows_summary_headers_and_selected_row() {
        let mut dashboard = test_dashboard(
            vec![
                sample_session(
                    "run-12345678",
                    "planner",
                    SessionState::Running,
                    Some("feat/run"),
                    128,
                    15,
                ),
                sample_session(
                    "done-87654321",
                    "reviewer",
                    SessionState::Completed,
                    Some("release/v1"),
                    2048,
                    125,
                ),
            ],
            1,
        );
        dashboard.approval_queue_counts = HashMap::from([(String::from("run-12345678"), 2usize)]);
        dashboard.approval_queue_preview = vec![SessionMessage {
            id: 1,
            from_session: "lead-12345678".to_string(),
            to_session: "run-12345678".to_string(),
            content: "{\"question\":\"Need approval to continue\"}".to_string(),
            msg_type: "query".to_string(),
            read: false,
            timestamp: Utc::now(),
        }];

        let rendered = render_dashboard_text(dashboard, 220, 24);
        assert!(rendered.contains("ID"));
        assert!(rendered.contains("Project"));
        assert!(rendered.contains("Group"));
        assert!(rendered.contains("Branch"));
        assert!(rendered.contains("Total 2"));
        assert!(rendered.contains("Running 1"));
        assert!(rendered.contains("Completed 1"));
        assert!(rendered.contains("Approval queue"));
        assert!(rendered.contains("done-876"));
    }

    #[test]
    fn approval_queue_preview_line_uses_target_session_and_preview() {
        let line = approval_queue_preview_line(&[SessionMessage {
            id: 1,
            from_session: "lead-12345678".to_string(),
            to_session: "run-12345678".to_string(),
            content: "{\"question\":\"Need approval to continue\"}".to_string(),
            msg_type: "query".to_string(),
            read: false,
            timestamp: Utc::now(),
        }])
        .expect("approval preview line");

        let rendered = line
            .spans
            .iter()
            .map(|span| span.content.as_ref())
            .collect::<String>();
        assert!(rendered.contains("run-123"));
        assert!(rendered.contains("query"));
    }

    #[test]
    fn sync_selected_messages_refreshes_approval_queue_after_marking_read() {
        let sessions = vec![
            sample_session(
                "lead-12345678",
                "planner",
                SessionState::Running,
                Some("ecc/lead"),
                512,
                42,
            ),
            sample_session(
                "worker-123456",
                "reviewer",
                SessionState::Idle,
                Some("ecc/worker"),
                64,
                5,
            ),
        ];
        let mut dashboard = test_dashboard(sessions, 1);
        for session in &dashboard.sessions {
            dashboard.db.insert_session(session).unwrap();
        }
        dashboard
            .db
            .send_message(
                "lead-12345678",
                "worker-123456",
                "{\"question\":\"Need operator input\"}",
                "query",
            )
            .unwrap();
        dashboard.unread_message_counts = dashboard.db.unread_message_counts().unwrap();

        dashboard.sync_selected_messages();

        assert_eq!(dashboard.approval_queue_counts.get("worker-123456"), None);
        assert!(dashboard.approval_queue_preview.is_empty());
    }

    #[test]
    fn refresh_tracks_latest_unread_approval_before_selected_messages_mark_read() {
        let sessions = vec![sample_session(
            "worker-123456",
            "reviewer",
            SessionState::Idle,
            Some("ecc/worker"),
            64,
            5,
        )];
        let mut dashboard = test_dashboard(sessions, 0);
        for session in &dashboard.sessions {
            dashboard.db.insert_session(session).unwrap();
        }
        dashboard
            .db
            .send_message(
                "lead-12345678",
                "worker-123456",
                "{\"question\":\"Need operator input\"}",
                "query",
            )
            .unwrap();
        let message_id = dashboard
            .db
            .latest_unread_approval_message()
            .unwrap()
            .expect("approval message should exist")
            .id;

        dashboard.refresh();

        assert_eq!(dashboard.last_seen_approval_message_id, Some(message_id));
        assert!(dashboard.approval_queue_preview.is_empty());
    }

    #[test]
    fn focus_next_approval_target_selects_oldest_unread_target() {
        let sessions = vec![
            sample_session(
                "lead-12345678",
                "planner",
                SessionState::Running,
                Some("ecc/lead"),
                512,
                42,
            ),
            sample_session(
                "worker-a",
                "reviewer",
                SessionState::Idle,
                Some("ecc/worker-a"),
                64,
                5,
            ),
            sample_session(
                "worker-b",
                "reviewer",
                SessionState::Idle,
                Some("ecc/worker-b"),
                64,
                5,
            ),
        ];
        let mut dashboard = test_dashboard(sessions, 0);
        for session in &dashboard.sessions {
            dashboard.db.insert_session(session).unwrap();
        }
        dashboard
            .db
            .send_message(
                "lead-12345678",
                "worker-b",
                "{\"question\":\"Need approval on B\"}",
                "query",
            )
            .unwrap();
        dashboard
            .db
            .send_message(
                "lead-12345678",
                "worker-a",
                "{\"question\":\"Need approval on A\"}",
                "query",
            )
            .unwrap();
        dashboard.sync_approval_queue();

        dashboard.focus_next_approval_target();

        assert_eq!(dashboard.selected_session_id(), Some("worker-b"));
        assert_eq!(
            dashboard.operator_note.as_deref(),
            Some("focused approval target worker-b")
        );
    }

    #[test]
    fn focus_next_approval_target_cycles_distinct_targets() {
        let sessions = vec![
            sample_session(
                "lead-12345678",
                "planner",
                SessionState::Running,
                Some("ecc/lead"),
                512,
                42,
            ),
            sample_session(
                "worker-a",
                "reviewer",
                SessionState::Idle,
                Some("ecc/worker-a"),
                64,
                5,
            ),
            sample_session(
                "worker-b",
                "reviewer",
                SessionState::Idle,
                Some("ecc/worker-b"),
                64,
                5,
            ),
        ];
        let mut dashboard = test_dashboard(sessions, 1);
        for session in &dashboard.sessions {
            dashboard.db.insert_session(session).unwrap();
        }
        dashboard
            .db
            .send_message(
                "lead-12345678",
                "worker-a",
                "{\"question\":\"Need approval on A\"}",
                "query",
            )
            .unwrap();
        dashboard
            .db
            .send_message(
                "lead-12345678",
                "worker-a",
                "{\"question\":\"Need another approval on A\"}",
                "conflict",
            )
            .unwrap();
        dashboard
            .db
            .send_message(
                "lead-12345678",
                "worker-b",
                "{\"question\":\"Need approval on B\"}",
                "query",
            )
            .unwrap();
        dashboard.sync_approval_queue();

        dashboard.focus_next_approval_target();

        assert_eq!(dashboard.selected_session_id(), Some("worker-b"));
        assert_eq!(dashboard.approval_queue_counts.get("worker-a"), Some(&2));
        assert_eq!(dashboard.approval_queue_counts.get("worker-b"), None);
    }

    #[test]
    fn focus_next_approval_target_reports_clear_queue() {
        let mut dashboard = test_dashboard(
            vec![sample_session(
                "lead-12345678",
                "planner",
                SessionState::Running,
                Some("ecc/lead"),
                512,
                42,
            )],
            0,
        );

        dashboard.focus_next_approval_target();

        assert_eq!(dashboard.selected_session_id(), Some("lead-12345678"));
        assert_eq!(
            dashboard.operator_note.as_deref(),
            Some("approval queue clear")
        );
    }

    #[test]
    fn selected_session_metrics_text_includes_worktree_output_and_attention_queue() {
        let mut dashboard = test_dashboard(
            vec![
                sample_session(
                    "focus-12345678",
                    "planner",
                    SessionState::Running,
                    Some("ecc/focus"),
                    512,
                    42,
                ),
                sample_session(
                    "failed-87654321",
                    "reviewer",
                    SessionState::Failed,
                    Some("ecc/failed"),
                    64,
                    5,
                ),
            ],
            0,
        );
        dashboard.session_output_cache.insert(
            "focus-12345678".to_string(),
            vec![test_output_line(OutputStream::Stdout, "last useful output")],
        );
        dashboard.selected_diff_summary = Some("1 file changed, 2 insertions(+)".to_string());
        dashboard.selected_diff_preview = vec![
            "Branch M src/main.rs".to_string(),
            "Working ?? notes.txt".to_string(),
        ];
        dashboard.selected_merge_readiness = Some(worktree::MergeReadiness {
            status: worktree::MergeReadinessStatus::Conflicted,
            summary: "Merge blocked by 1 conflict(s): src/main.rs".to_string(),
            conflicts: vec!["src/main.rs".to_string()],
        });

        let text = dashboard.selected_session_metrics_text();
        assert!(text.contains("Branch ecc/focus | Base main"));
        assert!(text.contains("Worktree /tmp/ecc/focus"));
        assert!(text.contains("Diff 1 file changed, 2 insertions(+)"));
        assert!(text.contains("Changed files"));
        assert!(text.contains("- Branch M src/main.rs"));
        assert!(text.contains("- Working ?? notes.txt"));
        assert!(text.contains("Merge blocked by 1 conflict(s): src/main.rs"));
        assert!(text.contains("- conflict src/main.rs"));
        assert!(text.contains("Tokens 512 total | In 384 | Out 128"));
        assert!(text.contains("Last output last useful output"));
        assert!(text.contains("Needs attention:"));
        assert!(text.contains("Failed failed-8 | Render dashboard rows"));
    }

    #[test]
    fn toggle_output_mode_switches_to_worktree_diff_preview() {
        let mut dashboard = test_dashboard(
            vec![sample_session(
                "focus-12345678",
                "planner",
                SessionState::Running,
                Some("ecc/focus"),
                512,
                42,
            )],
            0,
        );
        dashboard.selected_diff_summary = Some("1 file changed".to_string());
        dashboard.selected_diff_patch = Some(
            "--- Branch diff vs main ---\ndiff --git a/src/lib.rs b/src/lib.rs\n@@ -1 +1 @@\n-old line\n+new line".to_string(),
        );

        dashboard.toggle_output_mode();

        assert_eq!(dashboard.output_mode, OutputMode::WorktreeDiff);
        assert_eq!(
            dashboard.operator_note.as_deref(),
            Some("showing selected worktree diff")
        );
        let rendered = dashboard.rendered_output_text(180, 30);
        assert!(rendered.contains("Diff"));
        assert!(rendered.contains("Removals"));
        assert!(rendered.contains("Additions"));
        assert!(rendered.contains("-old line"));
        assert!(rendered.contains("+new line"));
    }

    #[test]
    fn toggle_git_status_mode_renders_selected_worktree_status() -> Result<()> {
        let root = std::env::temp_dir().join(format!("ecc2-git-status-{}", Uuid::new_v4()));
        init_git_repo(&root)?;
        fs::write(root.join("README.md"), "hello from git status\n")?;

        let mut session = sample_session(
            "focus-12345678",
            "planner",
            SessionState::Running,
            Some("ecc/focus"),
            512,
            42,
        );
        session.working_dir = root.clone();
        session.worktree = Some(WorktreeInfo {
            path: root.clone(),
            branch: "main".to_string(),
            base_branch: "main".to_string(),
        });
        let mut dashboard = test_dashboard(vec![session], 0);

        dashboard.toggle_git_status_mode();

        assert_eq!(dashboard.output_mode, OutputMode::GitStatus);
        assert_eq!(
            dashboard.operator_note.as_deref(),
            Some("showing selected worktree git status")
        );
        assert_eq!(
            dashboard.output_title(),
            " Git status staged:0 unstaged:1 1/1 "
        );
        let rendered = dashboard.rendered_output_text(180, 20);
        assert!(rendered.contains("Git status"));
        assert!(rendered.contains("README.md"));

        let _ = fs::remove_dir_all(root);
        Ok(())
    }

    #[test]
    fn toggle_output_mode_from_git_status_opens_selected_file_patch() -> Result<()> {
        let root = std::env::temp_dir().join(format!("ecc2-git-patch-view-{}", Uuid::new_v4()));
        init_git_repo(&root)?;
        fs::write(
            root.join("README.md"),
            "line 1\nline 2\nline 3\nline 4\nline 5\nline 6 updated\n",
        )?;

        let mut session = sample_session(
            "focus-12345678",
            "planner",
            SessionState::Running,
            Some("ecc/focus"),
            512,
            42,
        );
        session.working_dir = root.clone();
        session.worktree = Some(WorktreeInfo {
            path: root.clone(),
            branch: "main".to_string(),
            base_branch: "main".to_string(),
        });
        let mut dashboard = test_dashboard(vec![session], 0);
        let stored = dashboard.sessions[0].clone();
        dashboard.db.insert_session(&stored)?;

        dashboard.toggle_git_status_mode();
        dashboard.toggle_output_mode();

        assert_eq!(dashboard.output_mode, OutputMode::GitPatch);
        assert_eq!(
            dashboard.operator_note.as_deref(),
            Some("showing selected file patch")
        );
        assert!(dashboard.output_title().contains("Git patch README.md"));
        let rendered = dashboard.rendered_output_text(180, 30);
        assert!(rendered.contains("Git patch README.md"));
        assert!(rendered.contains("+line 6 updated"));

        let _ = fs::remove_dir_all(root);
        Ok(())
    }

    #[test]
    fn git_patch_mode_stages_only_selected_hunk() -> Result<()> {
        let root = std::env::temp_dir().join(format!("ecc2-git-patch-stage-{}", Uuid::new_v4()));
        init_git_repo(&root)?;
        let original = (1..=12)
            .map(|index| format!("line {index}"))
            .collect::<Vec<_>>()
            .join("\n");
        fs::write(root.join("notes.txt"), format!("{original}\n"))?;
        run_git(&root, &["add", "notes.txt"])?;
        run_git(&root, &["commit", "-qm", "add notes"])?;

        let updated = (1..=12)
            .map(|index| match index {
                2 => "line 2 changed".to_string(),
                11 => "line 11 changed".to_string(),
                _ => format!("line {index}"),
            })
            .collect::<Vec<_>>()
            .join("\n");
        fs::write(root.join("notes.txt"), format!("{updated}\n"))?;

        let mut session = sample_session(
            "focus-12345678",
            "planner",
            SessionState::Running,
            Some("ecc/focus"),
            512,
            42,
        );
        session.working_dir = root.clone();
        session.worktree = Some(WorktreeInfo {
            path: root.clone(),
            branch: "main".to_string(),
            base_branch: "main".to_string(),
        });
        let mut dashboard = test_dashboard(vec![session], 0);
        let stored = dashboard.sessions[0].clone();
        dashboard.db.insert_session(&stored)?;

        dashboard.toggle_git_status_mode();
        dashboard.toggle_output_mode();
        dashboard.stage_selected_git_status();

        assert_eq!(dashboard.output_mode, OutputMode::GitPatch);
        assert_eq!(
            dashboard.operator_note.as_deref(),
            Some("staged hunk in notes.txt")
        );
        let cached = git_stdout(&root, &["diff", "--cached", "--", "notes.txt"])?;
        assert!(cached.contains("line 2 changed"));
        assert!(!cached.contains("line 11 changed"));
        let working = git_stdout(&root, &["diff", "--", "notes.txt"])?;
        assert!(!working.contains("line 2 changed"));
        assert!(working.contains("line 11 changed"));
        assert!(dashboard.output_title().contains("Git patch notes.txt"));

        let _ = fs::remove_dir_all(root);
        Ok(())
    }

    #[test]
    fn begin_commit_prompt_opens_commit_input_for_staged_entries() {
        let mut dashboard = test_dashboard(
            vec![sample_session(
                "focus-12345678",
                "planner",
                SessionState::Running,
                Some("ecc/focus"),
                512,
                42,
            )],
            0,
        );
        dashboard.output_mode = OutputMode::GitStatus;
        dashboard.selected_git_status_entries = vec![worktree::GitStatusEntry {
            path: "README.md".to_string(),
            display_path: "README.md".to_string(),
            index_status: 'M',
            worktree_status: ' ',
            staged: true,
            unstaged: false,
            untracked: false,
            conflicted: false,
        }];

        dashboard.begin_commit_prompt();

        assert_eq!(dashboard.commit_input.as_deref(), Some(""));
        assert_eq!(
            dashboard.operator_note.as_deref(),
            Some("commit mode | type a message and press Enter")
        );
        let rendered = render_dashboard_text(dashboard, 180, 20);
        assert!(rendered.contains("commit>_"));
    }

    #[test]
    fn begin_pr_prompt_seeds_latest_commit_subject() -> Result<()> {
        let root = std::env::temp_dir().join(format!("ecc2-pr-prompt-{}", Uuid::new_v4()));
        init_git_repo(&root)?;
        fs::write(root.join("README.md"), "seed pr title\n")?;
        run_git(&root, &["commit", "-am", "seed pr title"])?;

        let mut session = sample_session(
            "focus-12345678",
            "planner",
            SessionState::Running,
            Some("ecc/focus"),
            512,
            42,
        );
        session.working_dir = root.clone();
        session.worktree = Some(WorktreeInfo {
            path: root.clone(),
            branch: "main".to_string(),
            base_branch: "main".to_string(),
        });
        let mut dashboard = test_dashboard(vec![session], 0);

        dashboard.begin_pr_prompt();

        assert_eq!(dashboard.pr_input.as_deref(), Some("seed pr title"));
        assert_eq!(
            dashboard.operator_note.as_deref(),
            Some("pr mode | title | base=branch | labels=a,b | reviewers=a,b")
        );

        let _ = fs::remove_dir_all(root);
        Ok(())
    }

    #[test]
    fn parse_pr_prompt_supports_base_labels_and_reviewers() {
        let parsed = parse_pr_prompt(
            "Improve retry flow | base=release/2.0 | labels=billing, ux | reviewers=alice, bob",
        )
        .expect("parse prompt");

        assert_eq!(parsed.title, "Improve retry flow");
        assert_eq!(parsed.base_branch.as_deref(), Some("release/2.0"));
        assert_eq!(parsed.labels, vec!["billing", "ux"]);
        assert_eq!(parsed.reviewers, vec!["alice", "bob"]);
    }

    #[test]
    fn submit_pr_prompt_passes_custom_metadata_to_gh() -> Result<()> {
        let temp_root =
            std::env::temp_dir().join(format!("ecc2-dashboard-pr-submit-{}", Uuid::new_v4()));
        let root = temp_root.join("repo");
        init_git_repo(&root)?;
        let remote = temp_root.join("remote.git");
        run_git(
            &root,
            &["init", "--bare", remote.to_str().expect("utf8 path")],
        )?;
        run_git(
            &root,
            &[
                "remote",
                "add",
                "origin",
                remote.to_str().expect("utf8 path"),
            ],
        )?;
        run_git(&root, &["push", "-u", "origin", "main"])?;
        run_git(&root, &["checkout", "-b", "feat/dashboard-pr"])?;
        fs::write(root.join("README.md"), "dashboard pr\n")?;
        run_git(&root, &["commit", "-am", "dashboard pr"])?;

        let bin_dir = temp_root.join("bin");
        fs::create_dir_all(&bin_dir)?;
        let gh_path = bin_dir.join("gh");
        let args_path = temp_root.join("gh-dashboard-args.txt");
        fs::write(
            &gh_path,
            format!(
                "#!/bin/sh\nprintf '%s\\n' \"$@\" > \"{}\"\nprintf '%s\\n' 'https://github.com/example/repo/pull/789'\n",
                args_path.display()
            ),
        )?;
        let mut perms = fs::metadata(&gh_path)?.permissions();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            perms.set_mode(0o755);
            fs::set_permissions(&gh_path, perms)?;
        }
        #[cfg(not(unix))]
        fs::set_permissions(&gh_path, perms)?;

        let original_path = std::env::var_os("PATH");
        std::env::set_var(
            "PATH",
            format!(
                "{}:{}",
                bin_dir.display(),
                original_path
                    .as_deref()
                    .map(std::ffi::OsStr::to_string_lossy)
                    .unwrap_or_default()
            ),
        );

        let mut session = sample_session(
            "focus-12345678",
            "planner",
            SessionState::Running,
            Some("ecc/focus"),
            512,
            42,
        );
        session.working_dir = root.clone();
        session.worktree = Some(WorktreeInfo {
            path: root.clone(),
            branch: "feat/dashboard-pr".to_string(),
            base_branch: "main".to_string(),
        });
        let mut dashboard = test_dashboard(vec![session], 0);
        dashboard.pr_input = Some(
            "Improve retry flow | base=release/2.0 | labels=billing,ux | reviewers=alice,bob"
                .to_string(),
        );

        dashboard.submit_pr_prompt();

        assert_eq!(
            dashboard.operator_note.as_deref(),
            Some("created draft PR for focus-12 against release/2.0: https://github.com/example/repo/pull/789")
        );
        let gh_args = fs::read_to_string(&args_path)?;
        assert!(gh_args.contains("--base\nrelease/2.0"));
        assert!(gh_args.contains("--label\nbilling"));
        assert!(gh_args.contains("--label\nux"));
        assert!(gh_args.contains("--reviewer\nalice"));
        assert!(gh_args.contains("--reviewer\nbob"));

        if let Some(path) = original_path {
            std::env::set_var("PATH", path);
        } else {
            std::env::remove_var("PATH");
        }
        let _ = fs::remove_dir_all(temp_root);
        Ok(())
    }

    #[test]
    fn toggle_diff_view_mode_switches_to_unified_rendering() {
        let mut dashboard = test_dashboard(
            vec![sample_session(
                "focus-12345678",
                "planner",
                SessionState::Running,
                Some("ecc/focus"),
                512,
                42,
            )],
            0,
        );
        let patch = "--- Branch diff vs main ---\n\
diff --git a/src/lib.rs b/src/lib.rs\n\
@@ -1 +1 @@\n\
-old line\n\
+new line"
            .to_string();
        dashboard.selected_diff_summary = Some("1 file changed".to_string());
        dashboard.selected_diff_patch = Some(patch.clone());
        dashboard.selected_diff_hunk_offsets_split =
            build_worktree_diff_columns(&patch, dashboard.theme_palette()).hunk_offsets;
        dashboard.selected_diff_hunk_offsets_unified = build_unified_diff_hunk_offsets(&patch);
        dashboard.toggle_output_mode();

        dashboard.toggle_diff_view_mode();

        assert_eq!(dashboard.diff_view_mode, DiffViewMode::Unified);
        assert_eq!(dashboard.output_title(), " Diff unified 1/1 ");
        assert_eq!(
            dashboard.operator_note.as_deref(),
            Some("diff view set to unified")
        );
        let rendered = dashboard.rendered_output_text(180, 30);
        assert!(rendered.contains("Diff unified 1/1"));
        assert!(rendered.contains("@@ -1 +1 @@"));
        assert!(rendered.contains("-old line"));
        assert!(rendered.contains("+new line"));
        assert!(!rendered.contains("Removals"));
        assert!(!rendered.contains("Additions"));
    }

    #[test]
    fn diff_hunk_navigation_updates_scroll_offset_and_wraps() {
        let mut dashboard = test_dashboard(
            vec![sample_session(
                "focus-12345678",
                "planner",
                SessionState::Running,
                Some("ecc/focus"),
                512,
                42,
            )],
            0,
        );
        let patch = "--- Branch diff vs main ---\n\
diff --git a/src/lib.rs b/src/lib.rs\n\
@@ -1 +1 @@\n\
-old line\n\
+new line\n\
@@ -5 +5 @@\n\
-second old\n\
+second new"
            .to_string();
        dashboard.selected_diff_patch = Some(patch.clone());
        let split_offsets =
            build_worktree_diff_columns(&patch, dashboard.theme_palette()).hunk_offsets;
        dashboard.selected_diff_hunk_offsets_split = split_offsets.clone();
        dashboard.selected_diff_hunk_offsets_unified = build_unified_diff_hunk_offsets(&patch);
        dashboard.output_mode = OutputMode::WorktreeDiff;

        dashboard.next_diff_hunk();
        assert_eq!(dashboard.selected_diff_hunk, 1);
        assert_eq!(dashboard.output_scroll_offset, split_offsets[1]);
        assert_eq!(dashboard.output_title(), " Diff split 2/2 ");
        assert_eq!(dashboard.operator_note.as_deref(), Some("diff hunk 2/2"));

        dashboard.next_diff_hunk();
        assert_eq!(dashboard.selected_diff_hunk, 0);
        assert_eq!(dashboard.output_scroll_offset, split_offsets[0]);
        assert_eq!(dashboard.output_title(), " Diff split 1/2 ");
        assert_eq!(dashboard.operator_note.as_deref(), Some("diff hunk 1/2"));

        dashboard.prev_diff_hunk();
        assert_eq!(dashboard.selected_diff_hunk, 1);
        assert_eq!(dashboard.output_scroll_offset, split_offsets[1]);
        assert_eq!(dashboard.operator_note.as_deref(), Some("diff hunk 2/2"));
    }

    #[test]
    fn toggle_timeline_mode_renders_selected_session_events() {
        let now = Utc::now();
        let mut session = sample_session(
            "focus-12345678",
            "planner",
            SessionState::Running,
            Some("ecc/focus"),
            512,
            42,
        );
        session.created_at = now - chrono::Duration::hours(2);
        session.updated_at = now - chrono::Duration::minutes(5);
        session.metrics.files_changed = 3;

        let mut dashboard = test_dashboard(vec![session.clone()], 0);
        dashboard.db.insert_session(&session).unwrap();
        dashboard
            .db
            .send_message(
                "lead-12345678",
                "focus-12345678",
                "{\"question\":\"Need review\"}",
                "query",
            )
            .unwrap();
        dashboard
            .db
            .insert_tool_log(
                "focus-12345678",
                "bash",
                "cargo test -q",
                "{\"command\":\"cargo test -q\"}",
                "ok",
                "stabilize planner session",
                240,
                0.2,
                &(now - chrono::Duration::minutes(3)).to_rfc3339(),
            )
            .unwrap();

        dashboard.toggle_timeline_mode();

        assert_eq!(dashboard.output_mode, OutputMode::Timeline);
        assert_eq!(
            dashboard.operator_note.as_deref(),
            Some("showing selected session timeline")
        );
        let rendered = dashboard.rendered_output_text(180, 30);
        assert!(rendered.contains("Timeline"));
        assert!(rendered.contains("created session as planner"));
        assert!(rendered.contains("received query lead-123"));
        assert!(rendered.contains("tool bash"));
        assert!(rendered.contains("why stabilize planner session"));
        assert!(rendered.contains("params {\"command\":\"cargo test -q\"}"));
        assert!(rendered.contains("files touched 3"));
    }

    #[test]
    fn cycle_timeline_event_filter_limits_rendered_events() {
        let now = Utc::now();
        let mut session = sample_session(
            "focus-12345678",
            "planner",
            SessionState::Running,
            Some("ecc/focus"),
            512,
            42,
        );
        session.created_at = now - chrono::Duration::hours(2);
        session.updated_at = now - chrono::Duration::minutes(5);
        session.metrics.files_changed = 1;

        let mut dashboard = test_dashboard(vec![session.clone()], 0);
        dashboard.db.insert_session(&session).unwrap();
        dashboard
            .db
            .send_message(
                "lead-12345678",
                "focus-12345678",
                "{\"question\":\"Need review\"}",
                "query",
            )
            .unwrap();
        dashboard
            .db
            .insert_tool_log(
                "focus-12345678",
                "bash",
                "cargo test -q",
                "{}",
                "ok",
                "",
                240,
                0.2,
                &(now - chrono::Duration::minutes(3)).to_rfc3339(),
            )
            .unwrap();
        dashboard.toggle_timeline_mode();

        dashboard.cycle_timeline_event_filter();
        dashboard.cycle_timeline_event_filter();

        assert_eq!(
            dashboard.timeline_event_filter,
            TimelineEventFilter::Messages
        );
        assert_eq!(
            dashboard.operator_note.as_deref(),
            Some("timeline filter set to messages")
        );
        assert_eq!(dashboard.output_title(), " Timeline messages ");

        let rendered = dashboard.rendered_output_text(180, 30);
        assert!(rendered.contains("received query lead-123"));
        assert!(!rendered.contains("tool bash"));
        assert!(!rendered.contains("files touched 1"));
    }

    #[test]
    fn timeline_and_metrics_render_recent_file_activity_details() -> Result<()> {
        let root = std::env::temp_dir().join(format!("ecc2-file-activity-{}", Uuid::new_v4()));
        fs::create_dir_all(&root)?;
        let now = Utc::now();
        let mut session = sample_session(
            "focus-12345678",
            "planner",
            SessionState::Running,
            Some("ecc/focus"),
            512,
            42,
        );
        session.created_at = now - chrono::Duration::hours(2);
        session.updated_at = now - chrono::Duration::minutes(5);

        let mut dashboard = test_dashboard(vec![session.clone()], 0);
        dashboard.db.insert_session(&session)?;

        let metrics_path = root.join("tool-usage.jsonl");
        fs::write(
            &metrics_path,
            concat!(
                "{\"id\":\"evt-1\",\"session_id\":\"focus-12345678\",\"tool_name\":\"Read\",\"input_summary\":\"Read src/lib.rs\",\"output_summary\":\"ok\",\"file_paths\":[\"src/lib.rs\"],\"timestamp\":\"2026-04-09T00:00:00Z\"}\n",
                "{\"id\":\"evt-2\",\"session_id\":\"focus-12345678\",\"tool_name\":\"Write\",\"input_summary\":\"Write README.md\",\"output_summary\":\"updated readme\",\"file_paths\":[\"README.md\"],\"file_events\":[{\"path\":\"README.md\",\"action\":\"create\",\"diff_preview\":\"+ # ECC 2.0\",\"patch_preview\":\"+ # ECC 2.0\\n+ \\n+ A richer dashboard\"}],\"timestamp\":\"2026-04-09T00:01:00Z\"}\n"
            ),
        )?;
        dashboard.db.sync_tool_activity_metrics(&metrics_path)?;
        dashboard.sync_from_store();

        dashboard.toggle_timeline_mode();
        let rendered = dashboard.rendered_output_text(180, 30);
        assert!(rendered.contains("read src/lib.rs"));
        assert!(rendered.contains("create README.md"));
        assert!(rendered.contains("+ # ECC 2.0"));
        assert!(rendered.contains("+ A richer dashboard"));
        assert!(!rendered.contains("files touched 2"));

        let metrics_text = dashboard.selected_session_metrics_text();
        assert!(metrics_text.contains("Recent file activity"));
        assert!(metrics_text.contains("create README.md"));
        assert!(metrics_text.contains("+ # ECC 2.0"));
        assert!(metrics_text.contains("+ A richer dashboard"));
        assert!(metrics_text.contains("read src/lib.rs"));

        let _ = fs::remove_dir_all(root);
        Ok(())
    }

    #[test]
    fn metrics_text_surfaces_file_activity_conflicts() -> Result<()> {
        let root = std::env::temp_dir().join(format!("ecc2-file-overlaps-{}", Uuid::new_v4()));
        fs::create_dir_all(&root)?;
        let now = Utc::now();
        let mut focus = sample_session(
            "focus-12345678",
            "planner",
            SessionState::Running,
            Some("ecc/focus"),
            512,
            42,
        );
        focus.created_at = now - chrono::Duration::hours(1);
        focus.updated_at = now - chrono::Duration::minutes(3);

        let mut delegate = sample_session(
            "delegate-87654321",
            "coder",
            SessionState::Idle,
            Some("ecc/delegate"),
            256,
            12,
        );
        delegate.created_at = now - chrono::Duration::minutes(50);
        delegate.updated_at = now - chrono::Duration::minutes(2);

        let mut dashboard = test_dashboard(vec![focus.clone(), delegate.clone()], 0);
        dashboard.db.insert_session(&focus)?;
        dashboard.db.insert_session(&delegate)?;

        let metrics_path = root.join("tool-usage.jsonl");
        fs::write(
            &metrics_path,
            concat!(
                "{\"id\":\"evt-1\",\"session_id\":\"focus-12345678\",\"tool_name\":\"Edit\",\"input_summary\":\"Edit src/lib.rs\",\"output_summary\":\"updated lib\",\"file_events\":[{\"path\":\"src/lib.rs\",\"action\":\"modify\"}],\"timestamp\":\"2026-04-09T00:00:00Z\"}\n",
                "{\"id\":\"evt-2\",\"session_id\":\"delegate-87654321\",\"tool_name\":\"Write\",\"input_summary\":\"Write src/lib.rs\",\"output_summary\":\"touched lib\",\"file_events\":[{\"path\":\"src/lib.rs\",\"action\":\"modify\"}],\"timestamp\":\"2026-04-09T00:01:00Z\"}\n"
            ),
        )?;
        dashboard.db.sync_tool_activity_metrics(&metrics_path)?;
        dashboard.sync_from_store();

        let metrics_text = dashboard.selected_session_metrics_text();
        assert!(metrics_text.contains("Active conflicts"));
        assert!(metrics_text.contains("src/lib.rs"));
        assert!(metrics_text.contains("escalate"));
        assert_eq!(
            dashboard
                .db
                .get_session("delegate-87654321")?
                .expect("delegate should exist")
                .state,
            SessionState::Stopped
        );

        let _ = fs::remove_dir_all(root);
        Ok(())
    }

    #[test]
    fn timeline_and_metrics_render_decision_log_entries() -> Result<()> {
        let now = Utc::now();
        let mut session = sample_session(
            "focus-12345678",
            "planner",
            SessionState::Running,
            Some("ecc/focus"),
            256,
            7,
        );
        session.created_at = now - chrono::Duration::hours(1);
        session.updated_at = now - chrono::Duration::minutes(2);

        let mut dashboard = test_dashboard(vec![session.clone()], 0);
        dashboard.db.insert_session(&session)?;
        dashboard.db.insert_decision(
            &session.id,
            "Use sqlite for the shared context graph",
            &["json files".to_string(), "memory only".to_string()],
            "SQLite keeps the audit trail queryable from CLI and TUI.",
        )?;

        dashboard.toggle_timeline_mode();
        let rendered = dashboard.rendered_output_text(180, 30);
        assert!(rendered.contains("decision"));
        assert!(rendered.contains("decided Use sqlite for the shared context graph"));
        assert!(rendered.contains("why SQLite keeps the audit trail queryable"));
        assert!(rendered.contains("alternative json files"));
        assert!(rendered.contains("alternative memory only"));

        let metrics_text = dashboard.selected_session_metrics_text();
        assert!(metrics_text.contains("Recent decisions"));
        assert!(metrics_text.contains("decided Use sqlite for the shared context graph"));
        assert!(metrics_text.contains("alternative json files"));

        dashboard.cycle_timeline_event_filter();
        dashboard.cycle_timeline_event_filter();
        dashboard.cycle_timeline_event_filter();
        dashboard.cycle_timeline_event_filter();
        dashboard.cycle_timeline_event_filter();

        assert_eq!(
            dashboard.timeline_event_filter,
            TimelineEventFilter::Decisions
        );
        assert_eq!(
            dashboard.operator_note.as_deref(),
            Some("timeline filter set to decisions")
        );
        assert_eq!(dashboard.output_title(), " Timeline decisions ");

        Ok(())
    }

    #[test]
    fn timeline_time_filter_hides_old_events() {
        let now = Utc::now();
        let mut session = sample_session(
            "focus-12345678",
            "planner",
            SessionState::Running,
            Some("ecc/focus"),
            512,
            42,
        );
        session.created_at = now - chrono::Duration::hours(3);
        session.updated_at = now - chrono::Duration::hours(2);

        let mut dashboard = test_dashboard(vec![session.clone()], 0);
        dashboard.db.insert_session(&session).unwrap();
        dashboard
            .db
            .insert_tool_log(
                "focus-12345678",
                "bash",
                "cargo test -q",
                "{}",
                "ok",
                "",
                240,
                0.2,
                &(now - chrono::Duration::minutes(3)).to_rfc3339(),
            )
            .unwrap();
        dashboard.toggle_timeline_mode();

        dashboard.cycle_output_time_filter();
        dashboard.cycle_output_time_filter();

        assert_eq!(dashboard.output_time_filter, OutputTimeFilter::LastHour);
        assert_eq!(
            dashboard.operator_note.as_deref(),
            Some("timeline range set to last 1h")
        );
        assert_eq!(dashboard.output_title(), " Timeline last 1h ");

        let rendered = dashboard.rendered_output_text(180, 30);
        assert!(rendered.contains("tool bash"));
        assert!(!rendered.contains("created session as planner"));
        assert!(!rendered.contains("state running"));
    }

    #[test]
    fn timeline_scope_all_sessions_renders_cross_session_events() {
        let now = Utc::now();
        let mut focus = sample_session(
            "focus-12345678",
            "planner",
            SessionState::Running,
            Some("ecc/focus"),
            512,
            42,
        );
        focus.created_at = now - chrono::Duration::hours(2);
        focus.updated_at = now - chrono::Duration::minutes(5);

        let mut review = sample_session(
            "review-87654321",
            "reviewer",
            SessionState::Idle,
            Some("ecc/review"),
            256,
            12,
        );
        review.created_at = now - chrono::Duration::hours(1);
        review.updated_at = now - chrono::Duration::minutes(3);
        review.metrics.files_changed = 2;

        let mut dashboard = test_dashboard(vec![focus.clone(), review.clone()], 0);
        dashboard.db.insert_session(&focus).unwrap();
        dashboard.db.insert_session(&review).unwrap();
        dashboard
            .db
            .insert_tool_log(
                "focus-12345678",
                "bash",
                "cargo test -q",
                "{}",
                "ok",
                "",
                240,
                0.2,
                &(now - chrono::Duration::minutes(4)).to_rfc3339(),
            )
            .unwrap();
        dashboard
            .db
            .insert_tool_log(
                "review-87654321",
                "git",
                "git status --short",
                "{}",
                "ok",
                "",
                120,
                0.1,
                &(now - chrono::Duration::minutes(2)).to_rfc3339(),
            )
            .unwrap();
        dashboard.toggle_timeline_mode();

        dashboard.toggle_search_scope();

        assert_eq!(dashboard.timeline_scope, SearchScope::AllSessions);
        assert_eq!(
            dashboard.operator_note.as_deref(),
            Some("timeline scope set to all sessions")
        );
        assert_eq!(dashboard.output_title(), " Timeline all sessions ");

        let rendered = dashboard.rendered_output_text(180, 30);
        assert!(rendered.contains("focus-12"));
        assert!(rendered.contains("review-8"));
        assert!(rendered.contains("tool bash"));
        assert!(rendered.contains("tool git"));
    }

    #[test]
    fn toggle_context_graph_mode_renders_selected_session_entities_and_relations() -> Result<()> {
        let session = sample_session(
            "focus-12345678",
            "planner",
            SessionState::Running,
            None,
            1,
            1,
        );
        let mut dashboard = test_dashboard(vec![session.clone()], 0);
        dashboard.db.insert_session(&session)?;

        let file = dashboard.db.upsert_context_entity(
            Some(&session.id),
            "file",
            "dashboard.rs",
            Some("ecc2/src/tui/dashboard.rs"),
            "dashboard renderer",
            &std::collections::BTreeMap::new(),
        )?;
        let function = dashboard.db.upsert_context_entity(
            Some(&session.id),
            "function",
            "render_output",
            None,
            "renders the output pane",
            &std::collections::BTreeMap::new(),
        )?;
        dashboard.db.upsert_context_relation(
            Some(&session.id),
            file.id,
            function.id,
            "contains",
            "output rendering path",
        )?;

        dashboard.toggle_context_graph_mode();

        assert_eq!(dashboard.output_mode, OutputMode::ContextGraph);
        assert_eq!(
            dashboard.operator_note.as_deref(),
            Some("showing selected session context graph")
        );
        let rendered = dashboard.rendered_output_text(180, 30);
        assert!(rendered.contains("Graph"));
        assert!(rendered.contains("dashboard.rs"));
        assert!(rendered.contains("summary dashboard renderer"));
        assert!(rendered.contains("-> contains function:render_output"));
        Ok(())
    }

    #[test]
    fn cycle_graph_entity_filter_limits_rendered_entities() -> Result<()> {
        let session = sample_session(
            "focus-12345678",
            "planner",
            SessionState::Running,
            None,
            1,
            1,
        );
        let mut dashboard = test_dashboard(vec![session.clone()], 0);
        dashboard.db.insert_session(&session)?;
        dashboard.db.insert_decision(
            &session.id,
            "Use sqlite graph sync",
            &[],
            "Keeps shared memory queryable",
        )?;
        dashboard.db.upsert_context_entity(
            Some(&session.id),
            "file",
            "dashboard.rs",
            Some("ecc2/src/tui/dashboard.rs"),
            "dashboard renderer",
            &std::collections::BTreeMap::new(),
        )?;

        dashboard.toggle_context_graph_mode();
        dashboard.cycle_graph_entity_filter();

        assert_eq!(dashboard.graph_entity_filter, GraphEntityFilter::Decisions);
        assert_eq!(dashboard.output_title(), " Graph decisions ");
        let rendered = dashboard.rendered_output_text(180, 30);
        assert!(rendered.contains("Use sqlite graph sync"));
        assert!(!rendered.contains("dashboard.rs"));

        dashboard.cycle_graph_entity_filter();
        assert_eq!(dashboard.graph_entity_filter, GraphEntityFilter::Files);
        assert_eq!(dashboard.output_title(), " Graph files ");
        let rendered = dashboard.rendered_output_text(180, 30);
        assert!(rendered.contains("dashboard.rs"));
        assert!(!rendered.contains("Use sqlite graph sync"));
        Ok(())
    }

    #[test]
    fn graph_scope_all_sessions_renders_cross_session_entities() -> Result<()> {
        let focus = sample_session(
            "focus-12345678",
            "planner",
            SessionState::Running,
            None,
            1,
            1,
        );
        let review = sample_session(
            "review-87654321",
            "reviewer",
            SessionState::Running,
            None,
            1,
            1,
        );
        let mut dashboard = test_dashboard(vec![focus.clone(), review.clone()], 0);
        dashboard.db.insert_session(&focus)?;
        dashboard.db.insert_session(&review)?;
        dashboard
            .db
            .insert_decision(&focus.id, "Alpha graph path", &[], "planner path")?;
        dashboard
            .db
            .insert_decision(&review.id, "Beta graph path", &[], "review path")?;

        dashboard.toggle_context_graph_mode();
        dashboard.toggle_search_scope();

        assert_eq!(dashboard.search_scope, SearchScope::AllSessions);
        assert_eq!(
            dashboard.operator_note.as_deref(),
            Some("graph scope set to all sessions")
        );
        assert_eq!(dashboard.output_title(), " Graph all sessions ");
        let rendered = dashboard.rendered_output_text(180, 30);
        assert!(rendered.contains("focus-12"));
        assert!(rendered.contains("review-8"));
        assert!(rendered.contains("Alpha graph path"));
        assert!(rendered.contains("Beta graph path"));
        Ok(())
    }

    #[test]
    fn graph_search_matches_and_switches_selected_session() -> Result<()> {
        let focus = sample_session(
            "focus-12345678",
            "planner",
            SessionState::Running,
            None,
            1,
            1,
        );
        let review = sample_session(
            "review-87654321",
            "reviewer",
            SessionState::Running,
            None,
            1,
            1,
        );
        let mut dashboard = test_dashboard(vec![focus.clone(), review.clone()], 0);
        dashboard.db.insert_session(&focus)?;
        dashboard.db.insert_session(&review)?;
        dashboard
            .db
            .insert_decision(&focus.id, "alpha local graph", &[], "planner path")?;
        dashboard
            .db
            .insert_decision(&review.id, "alpha remote graph", &[], "review path")?;

        dashboard.toggle_context_graph_mode();
        dashboard.toggle_search_scope();
        dashboard.cycle_graph_entity_filter();
        dashboard.begin_search();
        for ch in "alpha.*".chars() {
            dashboard.push_input_char(ch);
        }
        dashboard.submit_search();

        assert_eq!(dashboard.graph_entity_filter, GraphEntityFilter::Decisions);
        assert_eq!(dashboard.search_matches.len(), 2);
        let first_session = dashboard.selected_session_id().map(str::to_string);
        dashboard.next_search_match();
        assert_eq!(
            dashboard.operator_note.as_deref(),
            Some("graph search /alpha.* match 2/2 | all sessions")
        );
        assert_ne!(
            dashboard.selected_session_id().map(str::to_string),
            first_session
        );
        Ok(())
    }

    #[test]
    fn graph_sessions_filter_renders_auto_session_relations() -> Result<()> {
        let session = sample_session(
            "focus-12345678",
            "planner",
            SessionState::Running,
            None,
            1,
            1,
        );
        let mut dashboard = test_dashboard(vec![session.clone()], 0);
        dashboard.db.insert_session(&session)?;
        dashboard.db.insert_decision(
            &session.id,
            "Use graph relations",
            &[],
            "Edges make the context graph navigable",
        )?;

        dashboard.toggle_context_graph_mode();
        dashboard.cycle_graph_entity_filter();
        dashboard.cycle_graph_entity_filter();
        dashboard.cycle_graph_entity_filter();
        dashboard.cycle_graph_entity_filter();

        assert_eq!(dashboard.graph_entity_filter, GraphEntityFilter::Sessions);
        assert_eq!(dashboard.output_title(), " Graph sessions ");
        let rendered = dashboard.rendered_output_text(180, 30);
        assert!(rendered.contains("focus-12345678"));
        assert!(rendered.contains("summary running | planner |"));
        assert!(rendered.contains("-> decided decision:Use graph relations"));
        Ok(())
    }

    #[test]
    fn selected_session_metrics_text_includes_context_graph_relations() -> Result<()> {
        let focus = sample_session(
            "focus-12345678",
            "planner",
            SessionState::Running,
            None,
            1,
            1,
        );
        let delegate = sample_session("delegate-87654321", "coder", SessionState::Idle, None, 1, 1);
        let dashboard = test_dashboard(vec![focus.clone(), delegate.clone()], 0);
        dashboard.db.insert_session(&focus)?;
        dashboard.db.insert_session(&delegate)?;
        dashboard.db.insert_decision(
            &focus.id,
            "Use sqlite graph sync",
            &[],
            "Keeps shared memory queryable",
        )?;
        dashboard.db.send_message(
            &focus.id,
            &delegate.id,
            "{\"task\":\"Review graph edge\",\"context\":\"coordination smoke\"}",
            "task_handoff",
        )?;

        let text = dashboard.selected_session_metrics_text();
        assert!(text.contains("Context graph"));
        assert!(text.contains("outgoing 2 | incoming 0"));
        assert!(text.contains("-> decided decision:Use sqlite graph sync"));
        assert!(text.contains("-> delegates_to session:delegate-87654321"));
        Ok(())
    }

    #[test]
    fn selected_session_metrics_text_includes_relevant_memory() -> Result<()> {
        let mut focus = sample_session(
            "focus-12345678",
            "planner",
            SessionState::Running,
            None,
            1,
            1,
        );
        focus.task = "Investigate auth callback recovery".to_string();
        let mut memory = sample_session("memory-87654321", "coder", SessionState::Idle, None, 1, 1);
        memory.task = "Auth callback recovery notes".to_string();
        let dashboard = test_dashboard(vec![focus.clone(), memory.clone()], 0);
        dashboard.db.insert_session(&focus)?;
        dashboard.db.insert_session(&memory)?;
        dashboard.db.upsert_context_entity(
            Some(&memory.id),
            "file",
            "callback.ts",
            Some("src/routes/auth/callback.ts"),
            "Handles auth callback recovery and billing fallback",
            &BTreeMap::from([("area".to_string(), "auth".to_string())]),
        )?;
        let entity = dashboard
            .db
            .list_context_entities(Some(&memory.id), Some("file"), 10)?
            .into_iter()
            .find(|entry| entry.name == "callback.ts")
            .expect("callback entity");
        dashboard.db.add_context_observation(
            Some(&memory.id),
            entity.id,
            "completion_summary",
            ContextObservationPriority::Normal,
            true,
            "Recovered auth callback incident with billing fallback",
            &BTreeMap::new(),
        )?;

        let text = dashboard.selected_session_metrics_text();
        assert!(text.contains("Relevant memory"));
        assert!(text.contains("[file] callback.ts"));
        assert!(text.contains("| pinned"));
        assert!(text.contains("matches auth, callback, recovery"));
        assert!(text.contains(
            "memory [normal/pinned] Recovered auth callback incident with billing fallback"
        ));
        Ok(())
    }

    #[test]
    fn worktree_diff_columns_split_removed_and_added_lines() {
        let patch = "\
--- Branch diff vs main ---
diff --git a/src/lib.rs b/src/lib.rs
@@ -1,2 +1,2 @@
-old line
 context
+new line

--- Working tree diff ---
diff --git a/src/next.rs b/src/next.rs
@@ -3 +3 @@
-bye
+hello";

        let palette = test_dashboard(Vec::new(), 0).theme_palette();
        let columns = build_worktree_diff_columns(patch, palette);
        let removals = text_plain_text(&columns.removals);
        let additions = text_plain_text(&columns.additions);
        assert!(removals.contains("Branch diff vs main"));
        assert!(removals.contains("-old line"));
        assert!(removals.contains("-bye"));
        assert!(additions.contains("Working tree diff"));
        assert!(additions.contains("+new line"));
        assert!(additions.contains("+hello"));
    }

    #[test]
    fn split_diff_highlights_changed_words() {
        let palette = test_dashboard(Vec::new(), 0).theme_palette();
        let patch = "\
diff --git a/src/lib.rs b/src/lib.rs
@@ -1 +1 @@
-old line
+new line";

        let columns = build_worktree_diff_columns(patch, palette);
        let removal = columns
            .removals
            .lines
            .iter()
            .find(|line| line_plain_text(line) == "-old line")
            .expect("removal line");
        let addition = columns
            .additions
            .lines
            .iter()
            .find(|line| line_plain_text(line) == "+new line")
            .expect("addition line");

        assert_eq!(removal.spans[1].content.as_ref(), "old");
        assert_eq!(removal.spans[1].style, diff_removal_word_style());
        assert_eq!(removal.spans[2].content.as_ref(), " ");
        assert_eq!(removal.spans[2].style, diff_removal_style(palette));
        assert_eq!(addition.spans[1].content.as_ref(), "new");
        assert_eq!(addition.spans[1].style, diff_addition_word_style());
    }

    #[test]
    fn unified_diff_highlights_changed_words() {
        let palette = test_dashboard(Vec::new(), 0).theme_palette();
        let patch = "\
diff --git a/src/lib.rs b/src/lib.rs
@@ -1 +1 @@
-old line
+new line";

        let text = build_unified_diff_text(patch, palette);
        let removal = text
            .lines
            .iter()
            .find(|line| line_plain_text(line) == "-old line")
            .expect("removal line");
        let addition = text
            .lines
            .iter()
            .find(|line| line_plain_text(line) == "+new line")
            .expect("addition line");

        assert_eq!(removal.spans[1].content.as_ref(), "old");
        assert_eq!(removal.spans[1].style, diff_removal_word_style());
        assert_eq!(addition.spans[1].content.as_ref(), "new");
        assert_eq!(addition.spans[1].style, diff_addition_word_style());
    }

    #[test]
    fn toggle_conflict_protocol_mode_switches_to_protocol_view() {
        let mut dashboard = test_dashboard(
            vec![sample_session(
                "focus-12345678",
                "planner",
                SessionState::Running,
                Some("ecc/focus"),
                512,
                42,
            )],
            0,
        );
        dashboard.selected_merge_readiness = Some(worktree::MergeReadiness {
            status: worktree::MergeReadinessStatus::Conflicted,
            summary: "Merge blocked by 1 conflict(s): src/main.rs".to_string(),
            conflicts: vec!["src/main.rs".to_string()],
        });
        dashboard.selected_conflict_protocol = Some(
            "Conflict protocol for focus-12\nResolution steps\n1. Inspect current patch: ecc worktree-status focus-12345678 --patch"
                .to_string(),
        );

        dashboard.toggle_conflict_protocol_mode();

        assert_eq!(dashboard.output_mode, OutputMode::ConflictProtocol);
        assert_eq!(
            dashboard.operator_note.as_deref(),
            Some("showing worktree conflict protocol")
        );
        let rendered = dashboard.rendered_output_text(180, 30);
        assert!(rendered.contains("Conflict Protocol"));
        assert!(rendered.contains("Resolution steps"));
    }

    #[test]
    fn selected_session_metrics_text_includes_team_capacity_summary() {
        let mut dashboard = test_dashboard(
            vec![sample_session(
                "focus-12345678",
                "planner",
                SessionState::Running,
                Some("ecc/focus"),
                512,
                42,
            )],
            0,
        );
        dashboard.selected_team_summary = Some(TeamSummary {
            total: 3,
            idle: 1,
            running: 1,
            pending: 1,
            stale: 0,
            failed: 0,
            stopped: 0,
        });
        dashboard.global_handoff_backlog_leads = 2;
        dashboard.global_handoff_backlog_messages = 5;
        dashboard.selected_route_preview = Some("reuse idle worker-1".to_string());

        let text = dashboard.selected_session_metrics_text();
        assert!(text.contains("Team 3/8 | idle 1 | running 1 | pending 1 | failed 0 | stopped 0"));
        assert!(text.contains(
            "Global handoff backlog 2 lead(s) / 5 handoff(s) | Auto-dispatch off @ 5/lead | Auto-worktree on | Auto-merge off"
        ));
        assert!(text.contains("Coordination mode dispatch-first"));
        assert!(text.contains("Next route reuse idle worker-1"));
    }

    #[test]
    fn selected_session_metrics_text_includes_delegate_task_board() {
        let mut dashboard = test_dashboard(
            vec![sample_session(
                "focus-12345678",
                "planner",
                SessionState::Running,
                Some("ecc/focus"),
                512,
                42,
            )],
            0,
        );
        dashboard.selected_child_sessions = vec![DelegatedChildSummary {
            session_id: "delegate-12345678".to_string(),
            state: SessionState::Running,
            worktree_health: Some(worktree::WorktreeHealth::Conflicted),
            approval_backlog: 1,
            handoff_backlog: 2,
            tokens_used: 1_280,
            files_changed: 3,
            duration_secs: 12,
            task_preview: "Implement rust tui delegate board".to_string(),
            branch: Some("ecc/delegate-12345678".to_string()),
            last_output_preview: Some("Investigating pane selection behavior".to_string()),
        }];

        let text = dashboard.selected_session_metrics_text();
        assert!(
            text.contains(
                "- delegate [Running] | next resolve conflict | worktree conflicted | approvals 1 | backlog 2 | progress 1,280 tok / 3 files / 00:00:12 | task Implement rust tui delegate board | branch ecc/delegate-12345678"
            )
        );
        assert!(text.contains("  last output Investigating pane selection behavior"));
    }

    #[test]
    fn selected_session_metrics_text_marks_focused_delegate_row() {
        let mut dashboard = test_dashboard(
            vec![sample_session(
                "focus-12345678",
                "planner",
                SessionState::Running,
                Some("ecc/focus"),
                512,
                42,
            )],
            0,
        );
        dashboard.selected_child_sessions = vec![
            DelegatedChildSummary {
                session_id: "delegate-12345678".to_string(),
                state: SessionState::Running,
                worktree_health: None,
                approval_backlog: 0,
                handoff_backlog: 0,
                tokens_used: 128,
                files_changed: 1,
                duration_secs: 5,
                task_preview: "First delegate".to_string(),
                branch: None,
                last_output_preview: None,
            },
            DelegatedChildSummary {
                session_id: "delegate-22345678".to_string(),
                state: SessionState::Idle,
                worktree_health: Some(worktree::WorktreeHealth::InProgress),
                approval_backlog: 1,
                handoff_backlog: 2,
                tokens_used: 64,
                files_changed: 2,
                duration_secs: 10,
                task_preview: "Second delegate".to_string(),
                branch: Some("ecc/delegate-22345678".to_string()),
                last_output_preview: Some("Waiting on approval".to_string()),
            },
        ];
        dashboard.focused_delegate_session_id = Some("delegate-22345678".to_string());

        let text = dashboard.selected_session_metrics_text();
        assert!(text.contains("- delegate [Running] | next let it run"));
        assert!(text.contains(
            ">> delegate [Idle] | next review approvals | worktree in progress | approvals 1 | backlog 2 | progress 64 tok / 2 files / 00:00:10 | task Second delegate | branch ecc/delegate-22345678"
        ));
        assert!(text.contains("  last output Waiting on approval"));
    }

    #[test]
    fn focus_next_delegate_wraps_across_delegate_board() {
        let mut dashboard = test_dashboard(
            vec![sample_session(
                "focus-12345678",
                "planner",
                SessionState::Running,
                Some("ecc/focus"),
                512,
                42,
            )],
            0,
        );
        dashboard.selected_child_sessions = vec![
            DelegatedChildSummary {
                session_id: "delegate-12345678".to_string(),
                state: SessionState::Running,
                worktree_health: None,
                approval_backlog: 0,
                handoff_backlog: 0,
                tokens_used: 128,
                files_changed: 1,
                duration_secs: 5,
                task_preview: "First delegate".to_string(),
                branch: None,
                last_output_preview: None,
            },
            DelegatedChildSummary {
                session_id: "delegate-22345678".to_string(),
                state: SessionState::Idle,
                worktree_health: None,
                approval_backlog: 0,
                handoff_backlog: 0,
                tokens_used: 64,
                files_changed: 2,
                duration_secs: 10,
                task_preview: "Second delegate".to_string(),
                branch: None,
                last_output_preview: None,
            },
        ];
        dashboard.focused_delegate_session_id = Some("delegate-12345678".to_string());

        dashboard.focus_next_delegate();
        assert_eq!(
            dashboard.focused_delegate_session_id.as_deref(),
            Some("delegate-22345678")
        );

        dashboard.focus_next_delegate();
        assert_eq!(
            dashboard.focused_delegate_session_id.as_deref(),
            Some("delegate-12345678")
        );
    }

    #[test]
    fn open_focused_delegate_switches_selected_session() {
        let sessions = vec![
            sample_session(
                "lead-12345678",
                "planner",
                SessionState::Running,
                Some("ecc/lead"),
                512,
                42,
            ),
            sample_session(
                "delegate-12345678",
                "claude",
                SessionState::Running,
                Some("ecc/delegate"),
                256,
                12,
            ),
        ];
        let mut dashboard = test_dashboard(sessions, 0);
        dashboard.selected_child_sessions = vec![DelegatedChildSummary {
            session_id: "delegate-12345678".to_string(),
            state: SessionState::Running,
            worktree_health: Some(worktree::WorktreeHealth::InProgress),
            approval_backlog: 1,
            handoff_backlog: 0,
            tokens_used: 256,
            files_changed: 2,
            duration_secs: 12,
            task_preview: "Investigate focused delegate navigation".to_string(),
            branch: Some("ecc/delegate".to_string()),
            last_output_preview: Some("Reviewing lead metrics".to_string()),
        }];
        dashboard.focused_delegate_session_id = Some("delegate-12345678".to_string());
        dashboard.output_follow = false;
        dashboard.output_scroll_offset = 9;
        dashboard.metrics_scroll_offset = 4;

        dashboard.open_focused_delegate();

        assert_eq!(dashboard.selected_session_id(), Some("delegate-12345678"));
        assert!(dashboard.output_follow);
        assert_eq!(dashboard.output_scroll_offset, 0);
        assert_eq!(dashboard.metrics_scroll_offset, 0);
        assert_eq!(
            dashboard.operator_note.as_deref(),
            Some("opened delegate delegate")
        );
    }

    #[test]
    fn selected_session_metrics_text_shows_worktree_and_auto_merge_policy_state() {
        let mut dashboard = test_dashboard(
            vec![sample_session(
                "focus-12345678",
                "planner",
                SessionState::Running,
                Some("ecc/focus"),
                512,
                42,
            )],
            0,
        );
        dashboard.cfg.auto_dispatch_unread_handoffs = true;
        dashboard.cfg.auto_create_worktrees = false;
        dashboard.cfg.auto_merge_ready_worktrees = true;
        dashboard.global_handoff_backlog_leads = 1;
        dashboard.global_handoff_backlog_messages = 2;

        let text = dashboard.selected_session_metrics_text();
        assert!(text.contains(
            "Global handoff backlog 1 lead(s) / 2 handoff(s) | Auto-dispatch on @ 5/lead | Auto-worktree off | Auto-merge on"
        ));
    }

    #[test]
    fn toggle_auto_worktree_policy_persists_config() {
        let tempdir = std::env::temp_dir().join(format!("ecc2-worktree-policy-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&tempdir).unwrap();
        let previous_home = std::env::var_os("HOME");
        std::env::set_var("HOME", &tempdir);

        let mut dashboard = test_dashboard(
            vec![sample_session(
                "focus-12345678",
                "planner",
                SessionState::Running,
                Some("ecc/focus"),
                512,
                42,
            )],
            0,
        );
        dashboard.cfg.auto_create_worktrees = true;

        dashboard.toggle_auto_worktree_policy();

        assert!(!dashboard.cfg.auto_create_worktrees);
        let expected_note = format!(
            "default worktree creation disabled | saved to {}",
            crate::config::Config::config_path().display()
        );
        assert_eq!(
            dashboard.operator_note.as_deref(),
            Some(expected_note.as_str())
        );

        let saved = std::fs::read_to_string(crate::config::Config::config_path()).unwrap();
        assert!(saved.contains("auto_create_worktrees = false"));

        if let Some(home) = previous_home {
            std::env::set_var("HOME", home);
        } else {
            std::env::remove_var("HOME");
        }
        let _ = std::fs::remove_dir_all(tempdir);
    }

    #[test]
    fn selected_session_metrics_text_includes_daemon_activity() {
        let now = Utc::now();
        let mut dashboard = test_dashboard(
            vec![sample_session(
                "focus-12345678",
                "planner",
                SessionState::Running,
                Some("ecc/focus"),
                512,
                42,
            )],
            0,
        );
        dashboard.daemon_activity = DaemonActivity {
            last_dispatch_at: Some(now),
            last_dispatch_routed: 4,
            last_dispatch_deferred: 2,
            last_dispatch_leads: 2,
            chronic_saturation_streak: 0,
            last_recovery_dispatch_at: Some(now + chrono::Duration::seconds(1)),
            last_recovery_dispatch_routed: 1,
            last_recovery_dispatch_leads: 1,
            last_rebalance_at: Some(now + chrono::Duration::seconds(2)),
            last_rebalance_rerouted: 1,
            last_rebalance_leads: 1,
            last_auto_merge_at: Some(now + chrono::Duration::seconds(3)),
            last_auto_merge_merged: 2,
            last_auto_merge_active_skipped: 1,
            last_auto_merge_conflicted_skipped: 1,
            last_auto_merge_dirty_skipped: 0,
            last_auto_merge_failed: 0,
            last_auto_prune_at: Some(now + chrono::Duration::seconds(4)),
            last_auto_prune_pruned: 3,
            last_auto_prune_active_skipped: 1,
        };

        let text = dashboard.selected_session_metrics_text();
        assert!(text.contains("Coordination mode dispatch-first"));
        assert!(text.contains("Chronic saturation cleared @"));
        assert!(text.contains("Last daemon dispatch 4 routed / 2 deferred across 2 lead(s)"));
        assert!(text.contains("Last daemon recovery dispatch 1 handoff(s) across 1 lead(s)"));
        assert!(text.contains("Last daemon rebalance 1 handoff(s) across 1 lead(s)"));
        assert!(text.contains(
            "Last daemon auto-merge 2 merged / 1 active / 1 conflicted / 0 dirty / 0 failed"
        ));
        assert!(text.contains("Last daemon auto-prune 3 pruned / 1 active"));
    }

    #[test]
    fn selected_session_metrics_text_shows_rebalance_first_mode_when_saturation_is_unrecovered() {
        let mut dashboard = test_dashboard(
            vec![sample_session(
                "focus-12345678",
                "planner",
                SessionState::Running,
                Some("ecc/focus"),
                512,
                42,
            )],
            0,
        );
        dashboard.daemon_activity = DaemonActivity {
            last_dispatch_at: Some(Utc::now()),
            last_dispatch_routed: 0,
            last_dispatch_deferred: 1,
            last_dispatch_leads: 1,
            chronic_saturation_streak: 1,
            last_recovery_dispatch_at: None,
            last_recovery_dispatch_routed: 0,
            last_recovery_dispatch_leads: 0,
            last_rebalance_at: Some(Utc::now()),
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

        let text = dashboard.selected_session_metrics_text();
        assert!(text.contains("Coordination mode rebalance-first (chronic saturation)"));
    }

    #[test]
    fn selected_session_metrics_text_shows_rebalance_cooloff_mode_when_saturation_is_chronic() {
        let mut dashboard = test_dashboard(
            vec![sample_session(
                "focus-12345678",
                "planner",
                SessionState::Running,
                Some("ecc/focus"),
                512,
                42,
            )],
            0,
        );
        dashboard.daemon_activity = DaemonActivity {
            last_dispatch_at: Some(Utc::now()),
            last_dispatch_routed: 0,
            last_dispatch_deferred: 3,
            last_dispatch_leads: 1,
            chronic_saturation_streak: 3,
            last_recovery_dispatch_at: None,
            last_recovery_dispatch_routed: 0,
            last_recovery_dispatch_leads: 0,
            last_rebalance_at: Some(Utc::now()),
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

        let text = dashboard.selected_session_metrics_text();
        assert!(text.contains("Coordination mode rebalance-cooloff (chronic saturation)"));
        assert!(text.contains("Chronic saturation streak 3 cycle(s)"));
    }

    #[test]
    fn selected_session_metrics_text_recommends_operator_escalation_when_chronic_saturation_is_stuck(
    ) {
        let mut dashboard = test_dashboard(
            vec![sample_session(
                "focus-12345678",
                "planner",
                SessionState::Running,
                Some("ecc/focus"),
                512,
                42,
            )],
            0,
        );
        dashboard.daemon_activity = DaemonActivity {
            last_dispatch_at: Some(Utc::now()),
            last_dispatch_routed: 0,
            last_dispatch_deferred: 2,
            last_dispatch_leads: 1,
            chronic_saturation_streak: 5,
            last_recovery_dispatch_at: None,
            last_recovery_dispatch_routed: 0,
            last_recovery_dispatch_leads: 0,
            last_rebalance_at: Some(Utc::now()),
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

        let text = dashboard.selected_session_metrics_text();
        assert!(
            text.contains("Operator escalation recommended: chronic saturation is not clearing")
        );
    }

    #[test]
    fn selected_session_metrics_text_shows_stabilized_dispatch_mode_after_recovery() {
        let now = Utc::now();
        let mut dashboard = test_dashboard(
            vec![sample_session(
                "focus-12345678",
                "planner",
                SessionState::Running,
                Some("ecc/focus"),
                512,
                42,
            )],
            0,
        );
        dashboard.daemon_activity = DaemonActivity {
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

        let text = dashboard.selected_session_metrics_text();
        assert!(text.contains("Coordination mode dispatch-first (stabilized)"));
        assert!(text.contains("Recovery stabilized @"));
        assert!(!text.contains("Last daemon recovery dispatch"));
        assert!(!text.contains("Last daemon rebalance"));
    }

    #[test]
    fn attention_queue_suppresses_inbox_pressure_when_stabilized() {
        let now = Utc::now();
        let sessions = vec![sample_session(
            "focus-12345678",
            "planner",
            SessionState::Running,
            Some("ecc/focus"),
            512,
            42,
        )];
        let unread = HashMap::from([(String::from("focus-12345678"), 3usize)]);
        let summary = SessionSummary::from_sessions(&sessions, &unread, &HashMap::new(), true);

        let line = attention_queue_line(&summary, true);
        let rendered = line
            .spans
            .iter()
            .map(|span| span.content.as_ref())
            .collect::<String>();

        assert!(rendered.contains("Attention queue clear"));
        assert!(rendered.contains("stabilized backlog absorbed"));

        let mut dashboard = test_dashboard(sessions, 0);
        dashboard.unread_message_counts = unread;
        dashboard.handoff_backlog_counts =
            HashMap::from([(String::from("focus-12345678"), 3usize)]);
        dashboard.daemon_activity = DaemonActivity {
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

        let text = dashboard.selected_session_metrics_text();
        assert!(text.contains("Attention queue clear"));
        assert!(!text.contains("Needs attention:"));
        assert!(!text.contains("Backlog focus-12"));
    }

    #[test]
    fn summary_line_includes_worktree_health_counts() {
        let sessions = vec![
            sample_session(
                "focus-12345678",
                "planner",
                SessionState::Running,
                Some("ecc/focus"),
                512,
                42,
            ),
            sample_session(
                "worker-1234567",
                "claude",
                SessionState::Idle,
                Some("ecc/worker"),
                256,
                21,
            ),
        ];
        let unread = HashMap::new();
        let worktree_health = HashMap::from([
            (
                String::from("focus-12345678"),
                worktree::WorktreeHealth::Conflicted,
            ),
            (
                String::from("worker-1234567"),
                worktree::WorktreeHealth::InProgress,
            ),
        ]);

        let summary = SessionSummary::from_sessions(&sessions, &unread, &worktree_health, false);
        let rendered = summary_line(&summary)
            .spans
            .iter()
            .map(|span| span.content.as_ref())
            .collect::<String>();

        assert!(rendered.contains("Conflicts 1"));
        assert!(rendered.contains("Worktrees 1"));
    }

    #[test]
    fn attention_queue_keeps_conflicted_worktree_pressure_when_stabilized() {
        let now = Utc::now();
        let sessions = vec![sample_session(
            "focus-12345678",
            "planner",
            SessionState::Running,
            Some("ecc/focus"),
            512,
            42,
        )];
        let unread = HashMap::from([(String::from("focus-12345678"), 3usize)]);
        let worktree_health = HashMap::from([(
            String::from("focus-12345678"),
            worktree::WorktreeHealth::Conflicted,
        )]);

        let summary = SessionSummary::from_sessions(&sessions, &unread, &worktree_health, true);
        let rendered = attention_queue_line(&summary, true)
            .spans
            .iter()
            .map(|span| span.content.as_ref())
            .collect::<String>();

        assert!(rendered.contains("Attention queue"));
        assert!(rendered.contains("Conflicts 1"));
        assert!(!rendered.contains("Attention queue clear"));

        let mut dashboard = test_dashboard(sessions, 0);
        dashboard.unread_message_counts = unread;
        dashboard.handoff_backlog_counts =
            HashMap::from([(String::from("focus-12345678"), 3usize)]);
        dashboard.worktree_health_by_session = worktree_health;
        dashboard.daemon_activity = DaemonActivity {
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

        let text = dashboard.selected_session_metrics_text();
        assert!(text.contains("Needs attention:"));
        assert!(text.contains("Conflicted worktree focus-12"));
        assert!(!text.contains("Backlog focus-12"));
    }

    #[test]
    fn route_preview_uses_graph_context_for_latest_incoming_handoff() {
        let lead = sample_session(
            "lead-12345678",
            "planner",
            SessionState::Running,
            Some("ecc/lead"),
            512,
            42,
        );
        let older_worker = sample_session(
            "older-worker",
            "planner",
            SessionState::Idle,
            Some("ecc/older"),
            128,
            12,
        );
        let auth_worker = sample_session(
            "auth-worker",
            "planner",
            SessionState::Idle,
            Some("ecc/auth"),
            256,
            24,
        );

        let mut dashboard = test_dashboard(
            vec![lead.clone(), older_worker.clone(), auth_worker.clone()],
            0,
        );
        dashboard.db.insert_session(&lead).unwrap();
        dashboard.db.insert_session(&older_worker).unwrap();
        dashboard.db.insert_session(&auth_worker).unwrap();
        dashboard
            .db
            .send_message(
                "lead-12345678",
                "older-worker",
                "{\"task\":\"Legacy delegated work\",\"context\":\"Delegated from lead\"}",
                "task_handoff",
            )
            .unwrap();
        dashboard
            .db
            .send_message(
                "lead-12345678",
                "auth-worker",
                "{\"task\":\"Auth delegated work\",\"context\":\"Delegated from lead\"}",
                "task_handoff",
            )
            .unwrap();
        dashboard.db.mark_messages_read("older-worker").unwrap();
        dashboard.db.mark_messages_read("auth-worker").unwrap();
        dashboard
            .db
            .send_message(
                "planner-root",
                "lead-12345678",
                "{\"task\":\"Investigate auth callback recovery\",\"context\":\"Delegated from planner-root\"}",
                "task_handoff",
            )
            .unwrap();
        dashboard
            .db
            .upsert_context_entity(
                Some("auth-worker"),
                "file",
                "auth-callback.ts",
                Some("src/auth/callback.ts"),
                "Auth callback recovery edge cases",
                &BTreeMap::new(),
            )
            .unwrap();

        dashboard.unread_message_counts = dashboard.db.unread_message_counts().unwrap();
        dashboard.sync_selected_messages();
        dashboard.sync_selected_lineage();

        assert_eq!(
            dashboard.selected_route_preview.as_deref(),
            Some("for `Investigate auth callback recovery` reuse idle auth-wor | graph auth, callback, recovery")
        );
    }

    #[test]
    fn route_preview_ignores_non_handoff_inbox_noise() {
        let lead = sample_session(
            "lead-12345678",
            "planner",
            SessionState::Running,
            Some("ecc/lead"),
            512,
            42,
        );
        let idle_worker = sample_session(
            "idle-worker",
            "planner",
            SessionState::Idle,
            Some("ecc/idle"),
            128,
            12,
        );

        let mut dashboard = test_dashboard(vec![lead.clone(), idle_worker.clone()], 0);
        dashboard.db.insert_session(&lead).unwrap();
        dashboard.db.insert_session(&idle_worker).unwrap();
        dashboard
            .db
            .send_message("lead-12345678", "idle-worker", "FYI status update", "info")
            .unwrap();
        dashboard
            .db
            .send_message(
                "lead-12345678",
                "idle-worker",
                "{\"task\":\"Delegated work\",\"context\":\"Delegated from lead\"}",
                "task_handoff",
            )
            .unwrap();
        dashboard.db.mark_messages_read("idle-worker").unwrap();
        dashboard
            .db
            .send_message("lead-12345678", "idle-worker", "FYI status update", "info")
            .unwrap();

        dashboard.unread_message_counts = dashboard.db.unread_message_counts().unwrap();
        dashboard.sync_selected_lineage();

        assert_eq!(
            dashboard.selected_route_preview.as_deref(),
            Some("reuse idle idle-wor")
        );
        assert_eq!(dashboard.selected_child_sessions.len(), 1);
        assert_eq!(dashboard.selected_child_sessions[0].handoff_backlog, 0);
    }

    #[test]
    fn sync_selected_lineage_populates_delegate_task_and_output_previews() {
        let lead = sample_session(
            "lead-12345678",
            "planner",
            SessionState::Running,
            Some("ecc/lead"),
            512,
            42,
        );
        let mut child = sample_session(
            "worker-12345678",
            "planner",
            SessionState::Running,
            Some("ecc/worker"),
            128,
            12,
        );
        child.task = "Implement delegate metrics board for ECC 2.0".to_string();

        let mut dashboard = test_dashboard(vec![lead.clone(), child.clone()], 0);
        dashboard.db.insert_session(&lead).unwrap();
        dashboard.db.insert_session(&child).unwrap();
        dashboard
            .db
            .update_metrics("worker-12345678", &child.metrics)
            .unwrap();
        dashboard
            .db
            .send_message(
                "lead-12345678",
                "worker-12345678",
                "{\"task\":\"Delegated work\",\"context\":\"Delegated from lead\"}",
                "task_handoff",
            )
            .unwrap();
        dashboard
            .db
            .append_output_line(
                "worker-12345678",
                OutputStream::Stdout,
                "Reviewing delegate metrics board layout",
            )
            .unwrap();
        dashboard
            .approval_queue_counts
            .insert("worker-12345678".into(), 2);
        dashboard.worktree_health_by_session.insert(
            "worker-12345678".into(),
            worktree::WorktreeHealth::InProgress,
        );

        dashboard.sync_selected_lineage();

        assert_eq!(dashboard.selected_child_sessions.len(), 1);
        assert_eq!(
            dashboard.selected_child_sessions[0].worktree_health,
            Some(worktree::WorktreeHealth::InProgress)
        );
        assert_eq!(dashboard.selected_child_sessions[0].approval_backlog, 2);
        assert_eq!(dashboard.selected_child_sessions[0].tokens_used, 128);
        assert_eq!(dashboard.selected_child_sessions[0].files_changed, 2);
        assert_eq!(dashboard.selected_child_sessions[0].duration_secs, 12);
        assert_eq!(
            dashboard.selected_child_sessions[0].task_preview,
            "Implement delegate metrics board for EC…"
        );
        assert_eq!(
            dashboard.selected_child_sessions[0].branch.as_deref(),
            Some("ecc/worker")
        );
        assert_eq!(
            dashboard.selected_child_sessions[0]
                .last_output_preview
                .as_deref(),
            Some("Reviewing delegate metrics board layout")
        );
    }

    #[test]
    fn sync_selected_lineage_prioritizes_conflicted_delegate_rows() {
        let lead = sample_session(
            "lead-12345678",
            "planner",
            SessionState::Running,
            Some("ecc/lead"),
            512,
            42,
        );
        let conflicted = sample_session(
            "worker-conflict",
            "planner",
            SessionState::Running,
            Some("ecc/conflict"),
            128,
            12,
        );
        let idle = sample_session(
            "worker-idle",
            "planner",
            SessionState::Idle,
            Some("ecc/idle"),
            64,
            6,
        );

        let mut dashboard = test_dashboard(vec![lead.clone(), conflicted.clone(), idle.clone()], 0);
        dashboard.db.insert_session(&lead).unwrap();
        dashboard.db.insert_session(&conflicted).unwrap();
        dashboard.db.insert_session(&idle).unwrap();
        dashboard
            .db
            .send_message(
                "lead-12345678",
                "worker-conflict",
                "{\"task\":\"Handle conflict\",\"context\":\"Delegated from lead\"}",
                "task_handoff",
            )
            .unwrap();
        dashboard
            .db
            .send_message(
                "lead-12345678",
                "worker-idle",
                "{\"task\":\"Idle follow-up\",\"context\":\"Delegated from lead\"}",
                "task_handoff",
            )
            .unwrap();
        dashboard.worktree_health_by_session.insert(
            "worker-conflict".into(),
            worktree::WorktreeHealth::Conflicted,
        );

        dashboard.sync_selected_lineage();

        assert_eq!(dashboard.selected_child_sessions.len(), 2);
        assert_eq!(
            dashboard.selected_child_sessions[0].session_id,
            "worker-conflict"
        );
        assert_eq!(
            dashboard.selected_child_sessions[0].worktree_health,
            Some(worktree::WorktreeHealth::Conflicted)
        );
    }

    #[test]
    fn sync_selected_lineage_preserves_focused_delegate_by_session_id() {
        let lead = sample_session(
            "lead-12345678",
            "planner",
            SessionState::Running,
            Some("ecc/lead"),
            512,
            42,
        );
        let conflicted = sample_session(
            "worker-conflict",
            "planner",
            SessionState::Running,
            Some("ecc/conflict"),
            128,
            12,
        );
        let idle = sample_session(
            "worker-idle",
            "planner",
            SessionState::Idle,
            Some("ecc/idle"),
            64,
            6,
        );

        let mut dashboard = test_dashboard(vec![lead.clone(), conflicted.clone(), idle.clone()], 0);
        dashboard.db.insert_session(&lead).unwrap();
        dashboard.db.insert_session(&conflicted).unwrap();
        dashboard.db.insert_session(&idle).unwrap();
        dashboard
            .db
            .send_message(
                "lead-12345678",
                "worker-conflict",
                "{\"task\":\"Handle conflict\",\"context\":\"Delegated from lead\"}",
                "task_handoff",
            )
            .unwrap();
        dashboard
            .db
            .send_message(
                "lead-12345678",
                "worker-idle",
                "{\"task\":\"Idle follow-up\",\"context\":\"Delegated from lead\"}",
                "task_handoff",
            )
            .unwrap();
        dashboard.sync_selected_lineage();
        dashboard.focused_delegate_session_id = Some("worker-idle".to_string());
        dashboard.worktree_health_by_session.insert(
            "worker-conflict".into(),
            worktree::WorktreeHealth::Conflicted,
        );

        dashboard.sync_selected_lineage();

        assert_eq!(
            dashboard.focused_delegate_session_id.as_deref(),
            Some("worker-idle")
        );
    }

    #[test]
    fn sync_selected_lineage_keeps_all_delegate_rows() {
        let lead = sample_session(
            "lead-12345678",
            "planner",
            SessionState::Running,
            Some("ecc/lead"),
            512,
            42,
        );

        let mut sessions = vec![lead.clone()];
        let mut dashboard = test_dashboard(vec![lead.clone()], 0);
        dashboard.db.insert_session(&lead).unwrap();

        for index in 0..5 {
            let child_id = format!("worker-{index}");
            let child = sample_session(
                &child_id,
                "planner",
                SessionState::Running,
                Some(&format!("ecc/{child_id}")),
                64,
                6,
            );
            sessions.push(child.clone());
            dashboard.db.insert_session(&child).unwrap();
            dashboard
                .db
                .send_message(
                    "lead-12345678",
                    &child_id,
                    "{\"task\":\"Delegated work\",\"context\":\"Delegated from lead\"}",
                    "task_handoff",
                )
                .unwrap();
        }

        dashboard.sessions = sessions;
        dashboard.sync_selected_lineage();

        assert_eq!(dashboard.selected_child_sessions.len(), 5);
    }

    #[test]
    fn aggregate_cost_summary_mentions_total_cost() {
        let db = StateStore::open(Path::new(":memory:")).unwrap();
        let mut cfg = Config::default();
        cfg.cost_budget_usd = 10.0;

        let mut dashboard = Dashboard::new(db, cfg);
        dashboard.sessions = vec![budget_session("sess-1", 3_500, 8.25)];

        assert_eq!(
            dashboard.aggregate_cost_summary_text(),
            "Aggregate cost $8.25 / $10.00 | Budget alert 75%"
        );
    }

    #[test]
    fn aggregate_cost_summary_mentions_fifty_percent_alert() {
        let db = StateStore::open(Path::new(":memory:")).unwrap();
        let mut cfg = Config::default();
        cfg.cost_budget_usd = 10.0;

        let mut dashboard = Dashboard::new(db, cfg);
        dashboard.sessions = vec![budget_session("sess-1", 1_000, 5.0)];

        assert_eq!(
            dashboard.aggregate_cost_summary_text(),
            "Aggregate cost $5.00 / $10.00 | Budget alert 50%"
        );
    }

    #[test]
    fn aggregate_cost_summary_uses_custom_threshold_labels() {
        let db = StateStore::open(Path::new(":memory:")).unwrap();
        let mut cfg = Config::default();
        cfg.cost_budget_usd = 10.0;
        cfg.budget_alert_thresholds = crate::config::BudgetAlertThresholds {
            advisory: 0.40,
            warning: 0.70,
            critical: 0.85,
        };

        let mut dashboard = Dashboard::new(db, cfg);
        dashboard.sessions = vec![budget_session("sess-1", 1_000, 7.0)];

        assert_eq!(
            dashboard.aggregate_cost_summary_text(),
            "Aggregate cost $7.00 / $10.00 | Budget alert 70%"
        );
    }

    #[test]
    fn aggregate_cost_summary_mentions_ninety_percent_alert() {
        let db = StateStore::open(Path::new(":memory:")).unwrap();
        let mut cfg = Config::default();
        cfg.cost_budget_usd = 10.0;

        let mut dashboard = Dashboard::new(db, cfg);
        dashboard.sessions = vec![budget_session("sess-1", 1_000, 9.0)];

        assert_eq!(
            dashboard.aggregate_cost_summary_text(),
            "Aggregate cost $9.00 / $10.00 | Budget alert 90%"
        );
    }

    #[test]
    fn sync_budget_alerts_sets_operator_note_when_threshold_is_crossed() {
        let db = StateStore::open(Path::new(":memory:")).unwrap();
        let mut cfg = Config::default();
        cfg.token_budget = 1_000;
        cfg.cost_budget_usd = 10.0;

        let mut dashboard = Dashboard::new(db, cfg);
        dashboard.sessions = vec![budget_session("sess-1", 760, 2.0)];
        dashboard.last_budget_alert_state = BudgetState::Alert50;

        dashboard.sync_budget_alerts();

        assert_eq!(
            dashboard.operator_note.as_deref(),
            Some("Budget alert 75% | tokens 760 / 1,000 | cost $2.00 / $10.00")
        );
        assert_eq!(dashboard.last_budget_alert_state, BudgetState::Alert75);
    }

    #[test]
    fn sync_budget_alerts_uses_custom_threshold_labels() {
        let db = StateStore::open(Path::new(":memory:")).unwrap();
        let mut cfg = Config::default();
        cfg.token_budget = 1_000;
        cfg.cost_budget_usd = 10.0;
        cfg.budget_alert_thresholds = crate::config::BudgetAlertThresholds {
            advisory: 0.40,
            warning: 0.70,
            critical: 0.85,
        };

        let mut dashboard = Dashboard::new(db, cfg);
        dashboard.sessions = vec![budget_session("sess-1", 710, 2.0)];
        dashboard.last_budget_alert_state = BudgetState::Alert50;

        dashboard.sync_budget_alerts();

        assert_eq!(
            dashboard.operator_note.as_deref(),
            Some("Budget alert 70% | tokens 710 / 1,000 | cost $2.00 / $10.00")
        );
        assert_eq!(dashboard.last_budget_alert_state, BudgetState::Alert75);
    }

    #[test]
    fn refresh_auto_pauses_over_budget_sessions_and_sets_operator_note() {
        let db = StateStore::open(Path::new(":memory:")).unwrap();
        let mut cfg = Config::default();
        cfg.token_budget = 100;
        cfg.cost_budget_usd = 0.0;

        db.insert_session(&budget_session("sess-1", 120, 0.0))
            .expect("insert session");
        db.update_metrics(
            "sess-1",
            &SessionMetrics {
                input_tokens: 90,
                output_tokens: 30,
                tokens_used: 120,
                tool_calls: 0,
                files_changed: 0,
                duration_secs: 0,
                cost_usd: 0.0,
            },
        )
        .expect("persist metrics");

        let mut dashboard = Dashboard::new(db, cfg);
        dashboard.refresh();

        assert_eq!(dashboard.sessions.len(), 1);
        assert_eq!(dashboard.sessions[0].state, SessionState::Stopped);
        assert_eq!(
            dashboard.operator_note.as_deref(),
            Some("token budget exceeded | auto-paused 1 active session(s)")
        );
    }

    #[test]
    fn refresh_updates_session_state_snapshot_after_completion() {
        let db = StateStore::open(Path::new(":memory:")).unwrap();
        let now = Utc::now();
        let session = Session {
            id: "done-1".to_string(),
            task: "complete session".to_string(),
            project: "workspace".to_string(),
            task_group: "general".to_string(),
            agent_type: "claude".to_string(),
            working_dir: PathBuf::from("/tmp"),
            state: SessionState::Running,
            pid: None,
            worktree: None,
            created_at: now,
            updated_at: now,
            last_heartbeat_at: now,
            metrics: SessionMetrics::default(),
        };
        db.insert_session(&session).unwrap();

        let mut dashboard = Dashboard::new(db, Config::default());
        dashboard
            .db
            .update_state("done-1", &SessionState::Completed)
            .unwrap();

        dashboard.refresh();

        assert_eq!(dashboard.sessions[0].state, SessionState::Completed);
        assert_eq!(
            dashboard.last_session_states.get("done-1"),
            Some(&SessionState::Completed)
        );
    }

    #[test]
    fn refresh_builds_completion_summary_popup_from_metrics_activity_and_logs() -> Result<()> {
        let root = std::env::temp_dir().join(format!("ecc2-completion-popup-{}", Uuid::new_v4()));
        fs::create_dir_all(root.join(".claude").join("metrics"))?;

        let mut cfg = build_config(&root.join(".claude"));
        cfg.completion_summary_notifications.delivery =
            crate::notifications::CompletionSummaryDelivery::TuiPopup;
        cfg.desktop_notifications.session_completed = false;

        let db = StateStore::open(&cfg.db_path)?;
        let mut session = sample_session(
            "done-12345678",
            "claude",
            SessionState::Running,
            Some("ecc/done"),
            384,
            95,
        );
        session.task = "Finish session summary notifications".to_string();
        db.insert_session(&session)?;

        let metrics_path = cfg.tool_activity_metrics_path();
        fs::create_dir_all(metrics_path.parent().unwrap())?;
        fs::write(
            &metrics_path,
            concat!(
                "{\"id\":\"evt-1\",\"session_id\":\"done-12345678\",\"tool_name\":\"Bash\",\"input_summary\":\"cargo test -q\",\"input_params_json\":\"{\\\"command\\\":\\\"cargo test -q\\\"}\",\"output_summary\":\"ok\",\"timestamp\":\"2026-04-09T00:00:00Z\"}\n",
                "{\"id\":\"evt-2\",\"session_id\":\"done-12345678\",\"tool_name\":\"Write\",\"input_summary\":\"Write README.md\",\"output_summary\":\"updated readme\",\"file_events\":[{\"path\":\"README.md\",\"action\":\"create\",\"diff_preview\":\"+ session summary notifications\",\"patch_preview\":\"+ session summary notifications\"}],\"timestamp\":\"2026-04-09T00:01:00Z\"}\n",
                "{\"id\":\"evt-3\",\"session_id\":\"done-12345678\",\"tool_name\":\"Bash\",\"input_summary\":\"rm -rf build\",\"input_params_json\":\"{\\\"command\\\":\\\"rm -rf build\\\"}\",\"output_summary\":\"ok\",\"timestamp\":\"2026-04-09T00:02:00Z\"}\n"
            ),
        )?;

        let mut dashboard = Dashboard::new(db, cfg);
        dashboard
            .db
            .update_state("done-12345678", &SessionState::Completed)?;

        dashboard.refresh();

        let popup = dashboard
            .active_completion_popup
            .as_ref()
            .expect("completion summary popup");
        let popup_text = popup.popup_text();
        assert!(popup_text.contains("done-123"));
        assert!(popup_text.contains("Tests 1 run / 1 passed"));
        assert!(popup_text.contains("Recent files"));
        assert!(popup_text.contains("create README.md"));
        assert!(popup_text.contains("Warnings"));
        assert!(popup_text.contains("high-risk tool call"));

        let _ = fs::remove_dir_all(root);
        Ok(())
    }

    #[test]
    fn refresh_persists_completion_summary_observation() -> Result<()> {
        let root =
            std::env::temp_dir().join(format!("ecc2-completion-observation-{}", Uuid::new_v4()));
        fs::create_dir_all(root.join(".claude").join("metrics"))?;

        let mut cfg = build_config(&root.join(".claude"));
        cfg.completion_summary_notifications.delivery =
            crate::notifications::CompletionSummaryDelivery::TuiPopup;
        cfg.desktop_notifications.session_completed = false;

        let db = StateStore::open(&cfg.db_path)?;
        let mut session = sample_session(
            "done-observation",
            "claude",
            SessionState::Running,
            Some("ecc/observation"),
            144,
            42,
        );
        session.task = "Recover auth callback after wipe".to_string();
        db.insert_session(&session)?;

        let metrics_path = cfg.tool_activity_metrics_path();
        fs::create_dir_all(metrics_path.parent().unwrap())?;
        fs::write(
            &metrics_path,
            concat!(
                "{\"id\":\"evt-1\",\"session_id\":\"done-observation\",\"tool_name\":\"Bash\",\"input_summary\":\"cargo test -q\",\"input_params_json\":\"{\\\"command\\\":\\\"cargo test -q\\\"}\",\"output_summary\":\"ok\",\"timestamp\":\"2026-04-09T00:00:00Z\"}\n",
                "{\"id\":\"evt-2\",\"session_id\":\"done-observation\",\"tool_name\":\"Write\",\"input_summary\":\"Write src/routes/auth/callback.ts\",\"output_summary\":\"updated callback\",\"file_events\":[{\"path\":\"src/routes/auth/callback.ts\",\"action\":\"modify\",\"diff_preview\":\"portal first\",\"patch_preview\":\"+ portal first\"}],\"timestamp\":\"2026-04-09T00:01:00Z\"}\n"
            ),
        )?;

        let mut dashboard = Dashboard::new(db, cfg);
        dashboard
            .db
            .update_state("done-observation", &SessionState::Completed)?;

        dashboard.refresh();

        let session_entity = dashboard
            .db
            .list_context_entities(Some("done-observation"), Some("session"), 10)?
            .into_iter()
            .find(|entity| entity.name == "done-observation")
            .expect("session entity");
        let observations = dashboard
            .db
            .list_context_observations(Some(session_entity.id), 10)?;
        assert!(!observations.is_empty());
        assert_eq!(observations[0].observation_type, "completion_summary");
        assert!(observations[0]
            .summary
            .contains("Recover auth callback after wipe"));
        assert_eq!(
            observations[0].details.get("tests_run"),
            Some(&"1".to_string())
        );
        assert!(observations[0]
            .details
            .get("recent_files")
            .is_some_and(|value| value.contains("modify src/routes/auth/callback.ts")));

        let _ = fs::remove_dir_all(root);
        Ok(())
    }

    #[test]
    fn dismiss_completion_popup_promotes_the_next_summary() {
        let mut dashboard = test_dashboard(Vec::new(), 0);
        dashboard.active_completion_popup = Some(SessionCompletionSummary {
            session_id: "sess-a".to_string(),
            task: "First".to_string(),
            state: SessionState::Completed,
            files_changed: 1,
            tokens_used: 10,
            duration_secs: 5,
            cost_usd: 0.01,
            tests_run: 1,
            tests_passed: 1,
            recent_files: vec!["create README.md".to_string()],
            key_decisions: vec!["cargo test -q".to_string()],
            warnings: Vec::new(),
        });
        dashboard
            .queued_completion_popups
            .push_back(SessionCompletionSummary {
                session_id: "sess-b".to_string(),
                task: "Second".to_string(),
                state: SessionState::Completed,
                files_changed: 2,
                tokens_used: 20,
                duration_secs: 8,
                cost_usd: 0.02,
                tests_run: 0,
                tests_passed: 0,
                recent_files: vec!["modify src/lib.rs".to_string()],
                key_decisions: vec!["updated lib".to_string()],
                warnings: vec!["no test runs detected".to_string()],
            });

        dashboard.dismiss_completion_popup();

        assert_eq!(
            dashboard
                .active_completion_popup
                .as_ref()
                .map(|summary| summary.session_id.as_str()),
            Some("sess-b")
        );
        assert!(dashboard.queued_completion_popups.is_empty());

        dashboard.dismiss_completion_popup();
        assert!(dashboard.active_completion_popup.is_none());
    }

    #[test]
    fn refresh_syncs_tool_activity_metrics_from_hook_file() {
        let tempdir = std::env::temp_dir().join(format!("ecc2-activity-sync-{}", Uuid::new_v4()));
        fs::create_dir_all(tempdir.join("metrics")).unwrap();
        let db_path = tempdir.join("state.db");
        let db = StateStore::open(&db_path).unwrap();
        let now = Utc::now();

        db.insert_session(&Session {
            id: "sess-1".to_string(),
            task: "sync activity".to_string(),
            project: "workspace".to_string(),
            task_group: "general".to_string(),
            agent_type: "claude".to_string(),
            working_dir: PathBuf::from("/tmp"),
            state: SessionState::Running,
            pid: None,
            worktree: None,
            created_at: now,
            updated_at: now,
            last_heartbeat_at: now,
            metrics: SessionMetrics::default(),
        })
        .unwrap();

        let mut cfg = Config::default();
        cfg.db_path = db_path;

        let mut dashboard = Dashboard::new(db, cfg);
        fs::write(
            tempdir.join("metrics").join("tool-usage.jsonl"),
            "{\"id\":\"evt-1\",\"session_id\":\"sess-1\",\"tool_name\":\"Read\",\"input_summary\":\"Read README.md\",\"output_summary\":\"ok\",\"file_paths\":[\"README.md\"],\"timestamp\":\"2026-04-09T00:00:00Z\"}\n",
        )
        .unwrap();

        dashboard.refresh();

        assert_eq!(dashboard.sessions.len(), 1);
        assert_eq!(dashboard.sessions[0].metrics.tool_calls, 1);
        assert_eq!(dashboard.sessions[0].metrics.files_changed, 1);

        let _ = fs::remove_dir_all(tempdir);
    }

    #[test]
    fn refresh_flags_stale_sessions_and_sets_operator_note() {
        let db = StateStore::open(Path::new(":memory:")).unwrap();
        let mut cfg = Config::default();
        cfg.session_timeout_secs = 60;
        let now = Utc::now();

        db.insert_session(&Session {
            id: "stale-1".to_string(),
            task: "stale session".to_string(),
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
        })
        .unwrap();

        let mut dashboard = Dashboard::new(db, cfg);
        dashboard.refresh();

        assert_eq!(dashboard.sessions.len(), 1);
        assert_eq!(dashboard.sessions[0].state, SessionState::Stale);
        assert_eq!(
            dashboard.operator_note.as_deref(),
            Some("stale heartbeat detected | flagged 1 session(s) for attention")
        );
    }

    #[test]
    fn refresh_enforces_conflicts_and_surfaces_active_incidents() -> Result<()> {
        let tempdir =
            std::env::temp_dir().join(format!("dashboard-conflict-refresh-{}", Uuid::new_v4()));
        fs::create_dir_all(&tempdir)?;
        let mut cfg = build_config(&tempdir);
        cfg.session_timeout_secs = 3600;
        let db = StateStore::open(&cfg.db_path)?;
        let now = Utc::now();

        db.insert_session(&Session {
            id: "session-a".to_string(),
            task: "keep active".to_string(),
            project: "workspace".to_string(),
            task_group: "general".to_string(),
            agent_type: "claude".to_string(),
            working_dir: PathBuf::from("/tmp"),
            state: SessionState::Running,
            pid: None,
            worktree: None,
            created_at: now - Duration::minutes(2),
            updated_at: now - Duration::minutes(2),
            last_heartbeat_at: now - Duration::minutes(2),
            metrics: SessionMetrics::default(),
        })?;
        db.insert_session(&Session {
            id: "session-b".to_string(),
            task: "later overlap".to_string(),
            project: "workspace".to_string(),
            task_group: "general".to_string(),
            agent_type: "claude".to_string(),
            working_dir: PathBuf::from("/tmp"),
            state: SessionState::Running,
            pid: None,
            worktree: None,
            created_at: now - Duration::minutes(1),
            updated_at: now - Duration::minutes(1),
            last_heartbeat_at: now - Duration::minutes(1),
            metrics: SessionMetrics::default(),
        })?;

        fs::create_dir_all(
            cfg.tool_activity_metrics_path()
                .parent()
                .expect("metrics dir"),
        )?;
        fs::write(
            cfg.tool_activity_metrics_path(),
            concat!(
                "{\"id\":\"evt-1\",\"session_id\":\"session-a\",\"tool_name\":\"Edit\",\"input_summary\":\"Edit src/lib.rs\",\"output_summary\":\"older change\",\"file_events\":[{\"path\":\"src/lib.rs\",\"action\":\"modify\"}],\"timestamp\":\"2026-04-09T00:02:00Z\"}\n",
                "{\"id\":\"evt-2\",\"session_id\":\"session-b\",\"tool_name\":\"Write\",\"input_summary\":\"Write src/lib.rs\",\"output_summary\":\"later change\",\"file_events\":[{\"path\":\"src/lib.rs\",\"action\":\"modify\"}],\"timestamp\":\"2026-04-09T00:03:00Z\"}\n"
            ),
        )?;

        let mut dashboard = Dashboard::new(db, cfg);
        dashboard.refresh();
        dashboard.sync_selection_by_id(Some("session-b"));
        dashboard.sync_selected_diff();

        assert_eq!(
            dashboard.operator_note.as_deref(),
            Some("file conflict detected | opened 1 incident(s), auto-paused 1 session(s) via escalation")
        );
        assert_eq!(
            dashboard
                .db
                .get_session("session-b")?
                .expect("session-b should exist")
                .state,
            SessionState::Stopped
        );

        let metrics_text = dashboard.selected_session_metrics_text();
        assert!(metrics_text.contains("Active conflicts"));
        assert!(metrics_text.contains("src/lib.rs"));
        assert!(metrics_text.contains("escalate"));

        let conflict_protocol = dashboard
            .selected_conflict_protocol
            .clone()
            .expect("conflict protocol should be present");
        assert!(conflict_protocol.contains("Session overlap incidents"));
        assert!(conflict_protocol.contains("ecc resume session-b"));

        dashboard.refresh();
        assert_eq!(
            dashboard
                .db
                .list_open_conflict_incidents_for_session("session-b", 10)?
                .len(),
            1
        );

        let _ = fs::remove_dir_all(tempdir);
        Ok(())
    }

    #[test]
    fn selected_session_metrics_text_includes_harness_summary() -> Result<()> {
        let tempdir = std::env::temp_dir().join(format!(
            "ecc2-dashboard-harness-metrics-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(tempdir.join(".claude"))?;
        fs::create_dir_all(tempdir.join(".codex"))?;

        let now = Utc::now();
        let session = Session {
            id: "sess-harness".to_string(),
            task: "Map harness metadata".to_string(),
            project: "ecc".to_string(),
            task_group: "compat".to_string(),
            agent_type: "claude".to_string(),
            working_dir: tempdir.clone(),
            state: SessionState::Running,
            pid: Some(4242),
            worktree: None,
            created_at: now - Duration::minutes(3),
            updated_at: now - Duration::minutes(1),
            last_heartbeat_at: now - Duration::minutes(1),
            metrics: SessionMetrics::default(),
        };

        let dashboard = test_dashboard(vec![session], 0);
        let metrics_text = dashboard.selected_session_metrics_text();
        assert!(metrics_text.contains("Harness claude | Detected claude, codex"));

        let _ = fs::remove_dir_all(tempdir);
        Ok(())
    }

    #[test]
    fn new_session_task_uses_selected_session_context() {
        let dashboard = test_dashboard(
            vec![sample_session(
                "focus-12345678",
                "planner",
                SessionState::Running,
                Some("ecc/focus"),
                512,
                42,
            )],
            0,
        );

        assert_eq!(
            dashboard.new_session_task(),
            "Follow up on focus-12: Render dashboard rows"
        );
    }

    #[test]
    fn active_session_count_only_counts_live_queue_states() {
        let dashboard = test_dashboard(
            vec![
                sample_session("pending-1", "planner", SessionState::Pending, None, 1, 1),
                sample_session("running-1", "planner", SessionState::Running, None, 1, 1),
                sample_session("idle-1", "planner", SessionState::Idle, None, 1, 1),
                sample_session("failed-1", "planner", SessionState::Failed, None, 1, 1),
                sample_session("stopped-1", "planner", SessionState::Stopped, None, 1, 1),
                sample_session("done-1", "planner", SessionState::Completed, None, 1, 1),
            ],
            0,
        );

        assert_eq!(dashboard.active_session_count(), 3);
    }

    #[test]
    fn spawn_prompt_seed_uses_selected_session_context() {
        let dashboard = test_dashboard(
            vec![sample_session(
                "focus-12345678",
                "planner",
                SessionState::Running,
                Some("ecc/focus"),
                512,
                42,
            )],
            0,
        );

        assert_eq!(
            dashboard.spawn_prompt_seed(),
            "give me 2 agents working on Follow up on focus-12: Render dashboard rows"
        );
    }

    #[test]
    fn parse_spawn_request_extracts_count_and_task_from_natural_language() {
        let request = parse_spawn_request("give me 10 agents working on stabilize the queue")
            .expect("spawn request should parse");

        assert_eq!(
            request,
            SpawnRequest::AdHoc {
                requested_count: 10,
                task: "stabilize the queue".to_string(),
            }
        );
    }

    #[test]
    fn parse_spawn_request_defaults_to_single_session_without_count() {
        let request = parse_spawn_request("stabilize the queue").expect("spawn request");

        assert_eq!(
            request,
            SpawnRequest::AdHoc {
                requested_count: 1,
                task: "stabilize the queue".to_string(),
            }
        );
    }

    #[test]
    fn parse_spawn_request_extracts_template_request() {
        let request = parse_spawn_request(
            "template feature_development for stabilize auth callback with component=billing, area=oauth",
        )
        .expect("template request should parse");

        assert_eq!(
            request,
            SpawnRequest::Template {
                name: "feature_development".to_string(),
                task: Some("stabilize auth callback".to_string()),
                variables: BTreeMap::from([
                    ("area".to_string(), "oauth".to_string()),
                    ("component".to_string(), "billing".to_string()),
                ]),
            }
        );
    }

    #[test]
    fn build_spawn_plan_caps_requested_count_to_available_slots() {
        let dashboard = test_dashboard(
            vec![
                sample_session("pending-1", "planner", SessionState::Pending, None, 1, 1),
                sample_session("running-1", "planner", SessionState::Running, None, 1, 1),
                sample_session("idle-1", "planner", SessionState::Idle, None, 1, 1),
            ],
            0,
        );

        let plan = dashboard
            .build_spawn_plan("give me 9 agents working on ship release notes")
            .expect("spawn plan");

        assert_eq!(
            plan,
            SpawnPlan::AdHoc {
                requested_count: 9,
                spawn_count: 5,
                task: "ship release notes".to_string(),
            }
        );
    }

    #[test]
    fn build_spawn_plan_resolves_template_steps() {
        let mut dashboard = test_dashboard(Vec::new(), 0);
        dashboard.cfg.orchestration_templates = BTreeMap::from([(
            "feature_development".to_string(),
            crate::config::OrchestrationTemplateConfig {
                description: None,
                project: None,
                task_group: None,
                agent: Some("claude".to_string()),
                profile: None,
                worktree: Some(true),
                steps: vec![
                    crate::config::OrchestrationTemplateStepConfig {
                        name: Some("planner".to_string()),
                        task: "Plan {{task}}".to_string(),
                        project: None,
                        task_group: None,
                        agent: None,
                        profile: None,
                        worktree: None,
                    },
                    crate::config::OrchestrationTemplateStepConfig {
                        name: Some("builder".to_string()),
                        task: "Build {{task}} in {{component}}".to_string(),
                        project: None,
                        task_group: None,
                        agent: None,
                        profile: None,
                        worktree: None,
                    },
                ],
            },
        )]);

        let plan = dashboard
            .build_spawn_plan(
                "template feature_development for stabilize auth callback with component=billing",
            )
            .expect("template spawn plan");

        assert_eq!(
            plan,
            SpawnPlan::Template {
                name: "feature_development".to_string(),
                task: Some("stabilize auth callback".to_string()),
                variables: BTreeMap::from([("component".to_string(), "billing".to_string(),)]),
                step_count: 2,
            }
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn submit_spawn_prompt_launches_orchestration_template() -> Result<()> {
        let tempdir = std::env::temp_dir().join(format!("dashboard-template-{}", Uuid::new_v4()));
        let repo_root = tempdir.join("repo");
        init_git_repo(&repo_root)?;

        let cwd_guard = crate::test_support::CurrentDirGuard::enter(&repo_root)?;

        let mut cfg = build_config(&tempdir);
        cfg.orchestration_templates = BTreeMap::from([(
            "feature_development".to_string(),
            crate::config::OrchestrationTemplateConfig {
                description: None,
                project: Some("ecc2-smoke".to_string()),
                task_group: Some("{{task}}".to_string()),
                agent: Some("claude".to_string()),
                profile: None,
                worktree: Some(false),
                steps: vec![
                    crate::config::OrchestrationTemplateStepConfig {
                        name: Some("planner".to_string()),
                        task: "Plan {{task}}".to_string(),
                        project: None,
                        task_group: None,
                        agent: None,
                        profile: None,
                        worktree: None,
                    },
                    crate::config::OrchestrationTemplateStepConfig {
                        name: Some("builder".to_string()),
                        task: "Build {{task}} in {{component}}".to_string(),
                        project: None,
                        task_group: None,
                        agent: None,
                        profile: None,
                        worktree: None,
                    },
                ],
            },
        )]);

        let db = StateStore::open(&cfg.db_path)?;
        let mut dashboard = Dashboard::new(db, cfg);
        dashboard.spawn_input = Some(
            "template feature_development for stabilize auth callback with component=billing"
                .to_string(),
        );

        dashboard.submit_spawn_prompt().await;

        let operator_note = dashboard
            .operator_note
            .clone()
            .expect("template launch should set an operator note");
        assert!(
            operator_note.contains(
                "launched template feature_development (2/2 step(s)) for stabilize auth callback"
            ),
            "unexpected operator note: {operator_note}"
        );
        assert_eq!(dashboard.sessions.len(), 2);
        assert!(dashboard
            .sessions
            .iter()
            .all(|session| session.project == "ecc2-smoke"));
        assert!(dashboard
            .sessions
            .iter()
            .all(|session| session.task_group == "stabilize auth callback"));
        let tasks = dashboard
            .sessions
            .iter()
            .map(|session| session.task.as_str())
            .collect::<std::collections::BTreeSet<_>>();
        assert_eq!(
            tasks,
            std::collections::BTreeSet::from([
                "Build stabilize auth callback in billing",
                "Plan stabilize auth callback",
            ])
        );

        drop(cwd_guard);
        let _ = std::fs::remove_dir_all(&tempdir);
        Ok(())
    }

    #[test]
    fn expand_spawn_tasks_suffixes_multi_session_requests() {
        assert_eq!(
            expand_spawn_tasks("stabilize the queue", 3),
            vec![
                "stabilize the queue [1/3]".to_string(),
                "stabilize the queue [2/3]".to_string(),
                "stabilize the queue [3/3]".to_string(),
            ]
        );
    }

    #[test]
    fn refresh_preserves_selected_session_by_id() -> Result<()> {
        let db_path = std::env::temp_dir().join(format!("ecc2-dashboard-{}.db", Uuid::new_v4()));
        let db = StateStore::open(&db_path)?;
        let now = Utc::now();

        db.insert_session(&Session {
            id: "older".to_string(),
            task: "older".to_string(),
            project: "workspace".to_string(),
            task_group: "general".to_string(),
            agent_type: "claude".to_string(),
            working_dir: PathBuf::from("/tmp"),
            state: SessionState::Idle,
            pid: None,
            worktree: None,
            created_at: now,
            updated_at: now,
            last_heartbeat_at: now,
            metrics: SessionMetrics::default(),
        })?;

        db.insert_session(&Session {
            id: "newer".to_string(),
            task: "newer".to_string(),
            project: "workspace".to_string(),
            task_group: "general".to_string(),
            agent_type: "claude".to_string(),
            working_dir: PathBuf::from("/tmp"),
            state: SessionState::Running,
            pid: None,
            worktree: None,
            created_at: now,
            updated_at: now + chrono::Duration::seconds(1),
            last_heartbeat_at: now + chrono::Duration::seconds(1),
            metrics: SessionMetrics::default(),
        })?;

        let mut dashboard = Dashboard::new(db, Config::default());
        dashboard.selected_session = 1;
        dashboard.sync_selection();
        dashboard.refresh();

        assert_eq!(dashboard.selected_session_id(), Some("older"));
        let _ = std::fs::remove_file(db_path);
        Ok(())
    }

    #[test]
    fn metrics_scroll_uses_independent_offset() -> Result<()> {
        let db_path = std::env::temp_dir().join(format!("ecc2-dashboard-{}.db", Uuid::new_v4()));
        let db = StateStore::open(&db_path)?;
        let now = Utc::now();

        db.insert_session(&Session {
            id: "session-1".to_string(),
            task: "inspect output".to_string(),
            project: "workspace".to_string(),
            task_group: "general".to_string(),
            agent_type: "claude".to_string(),
            working_dir: PathBuf::from("/tmp"),
            state: SessionState::Running,
            pid: None,
            worktree: None,
            created_at: now,
            updated_at: now,
            last_heartbeat_at: now,
            metrics: SessionMetrics::default(),
        })?;

        for index in 0..6 {
            db.append_output_line("session-1", OutputStream::Stdout, &format!("line {index}"))?;
        }

        let mut dashboard = Dashboard::new(db, Config::default());
        dashboard.selected_pane = Pane::Output;
        dashboard.refresh();
        dashboard.sync_output_scroll(3);
        dashboard.scroll_up();
        let previous_scroll = dashboard.output_scroll_offset;

        dashboard.selected_pane = Pane::Metrics;
        dashboard.last_metrics_height = 2;
        dashboard.scroll_up();
        dashboard.scroll_down();
        dashboard.scroll_down();

        assert_eq!(dashboard.output_scroll_offset, previous_scroll);
        assert_eq!(dashboard.metrics_scroll_offset, 2);
        let _ = std::fs::remove_file(db_path);
        Ok(())
    }

    #[test]
    fn refresh_loads_selected_session_output_and_follows_tail() -> Result<()> {
        let db_path = std::env::temp_dir().join(format!("ecc2-dashboard-{}.db", Uuid::new_v4()));
        let db = StateStore::open(&db_path)?;
        let now = Utc::now();

        db.insert_session(&Session {
            id: "session-1".to_string(),
            task: "tail output".to_string(),
            project: "workspace".to_string(),
            task_group: "general".to_string(),
            agent_type: "claude".to_string(),
            working_dir: PathBuf::from("/tmp"),
            state: SessionState::Running,
            pid: None,
            worktree: None,
            created_at: now,
            updated_at: now,
            last_heartbeat_at: now,
            metrics: SessionMetrics::default(),
        })?;

        for index in 0..12 {
            db.append_output_line("session-1", OutputStream::Stdout, &format!("line {index}"))?;
        }

        let mut dashboard = Dashboard::new(db, Config::default());
        dashboard.selected_pane = Pane::Output;
        dashboard.refresh();
        dashboard.sync_output_scroll(4);

        assert_eq!(dashboard.output_scroll_offset, 8);
        assert!(dashboard.selected_output_text().contains("line 11"));

        let _ = std::fs::remove_file(db_path);
        Ok(())
    }

    #[test]
    fn submit_search_tracks_matches_and_sets_navigation_note() {
        let mut dashboard = test_dashboard(
            vec![sample_session(
                "focus-12345678",
                "planner",
                SessionState::Running,
                None,
                1,
                1,
            )],
            0,
        );
        dashboard.session_output_cache.insert(
            "focus-12345678".to_string(),
            vec![
                test_output_line(OutputStream::Stdout, "alpha"),
                test_output_line(OutputStream::Stdout, "beta"),
                test_output_line(OutputStream::Stdout, "alpha tail"),
            ],
        );
        dashboard.last_output_height = 2;

        dashboard.begin_search();
        for ch in "alpha.*".chars() {
            dashboard.push_input_char(ch);
        }
        dashboard.submit_search();

        assert_eq!(dashboard.search_query.as_deref(), Some("alpha.*"));
        assert_eq!(
            dashboard.search_matches,
            vec![
                SearchMatch {
                    session_id: "focus-12345678".to_string(),
                    line_index: 0,
                },
                SearchMatch {
                    session_id: "focus-12345678".to_string(),
                    line_index: 2,
                },
            ]
        );
        assert_eq!(dashboard.selected_search_match, 0);
        assert_eq!(
            dashboard.operator_note.as_deref(),
            Some("search /alpha.* matched 2 line(s) across 1 session(s) | n/N navigate matches")
        );
    }

    #[test]
    fn next_search_match_wraps_and_updates_scroll_offset() {
        let mut dashboard = test_dashboard(
            vec![sample_session(
                "focus-12345678",
                "planner",
                SessionState::Running,
                None,
                1,
                1,
            )],
            0,
        );
        dashboard.session_output_cache.insert(
            "focus-12345678".to_string(),
            vec![
                test_output_line(OutputStream::Stdout, "alpha-1"),
                test_output_line(OutputStream::Stdout, "beta"),
                test_output_line(OutputStream::Stdout, "alpha-2"),
            ],
        );
        dashboard.search_query = Some(r"alpha-\d".to_string());
        dashboard.last_output_height = 1;
        dashboard.recompute_search_matches();

        dashboard.next_search_match();
        assert_eq!(dashboard.selected_search_match, 1);
        assert_eq!(dashboard.output_scroll_offset, 2);
        assert_eq!(
            dashboard.operator_note.as_deref(),
            Some(r"search /alpha-\d match 2/2 | selected session")
        );

        dashboard.next_search_match();
        assert_eq!(dashboard.selected_search_match, 0);
        assert_eq!(dashboard.output_scroll_offset, 0);
    }

    #[test]
    fn submit_search_rejects_invalid_regex_and_keeps_input() {
        let mut dashboard = test_dashboard(
            vec![sample_session(
                "focus-12345678",
                "planner",
                SessionState::Running,
                None,
                1,
                1,
            )],
            0,
        );

        dashboard.begin_search();
        for ch in "(".chars() {
            dashboard.push_input_char(ch);
        }
        dashboard.submit_search();

        assert_eq!(dashboard.search_input.as_deref(), Some("("));
        assert!(dashboard.search_query.is_none());
        assert!(dashboard.search_matches.is_empty());
        assert!(dashboard
            .operator_note
            .as_deref()
            .unwrap_or_default()
            .starts_with("invalid regex /(:"));
    }

    #[test]
    fn clear_search_resets_active_query_and_matches() {
        let mut dashboard = test_dashboard(Vec::new(), 0);
        dashboard.search_input = Some("draft".to_string());
        dashboard.search_query = Some("alpha".to_string());
        dashboard.search_matches = vec![
            SearchMatch {
                session_id: "focus-12345678".to_string(),
                line_index: 1,
            },
            SearchMatch {
                session_id: "focus-12345678".to_string(),
                line_index: 3,
            },
        ];
        dashboard.selected_search_match = 1;

        dashboard.clear_search();

        assert!(dashboard.search_input.is_none());
        assert!(dashboard.search_query.is_none());
        assert!(dashboard.search_matches.is_empty());
        assert_eq!(dashboard.selected_search_match, 0);
        assert_eq!(
            dashboard.operator_note.as_deref(),
            Some("cleared output search")
        );
    }

    #[test]
    fn toggle_output_filter_keeps_only_stderr_lines() {
        let mut dashboard = test_dashboard(
            vec![sample_session(
                "focus-12345678",
                "planner",
                SessionState::Running,
                None,
                1,
                1,
            )],
            0,
        );
        dashboard.session_output_cache.insert(
            "focus-12345678".to_string(),
            vec![
                test_output_line(OutputStream::Stdout, "stdout line"),
                test_output_line(OutputStream::Stderr, "stderr line"),
            ],
        );

        dashboard.toggle_output_filter();

        assert_eq!(dashboard.output_filter, OutputFilter::ErrorsOnly);
        assert_eq!(dashboard.visible_output_text(), "stderr line");
        assert_eq!(dashboard.output_title(), " Output errors ");
        assert_eq!(
            dashboard.operator_note.as_deref(),
            Some("output filter set to errors")
        );
    }

    #[test]
    fn toggle_output_filter_cycles_tool_calls_and_file_changes() {
        let mut dashboard = test_dashboard(
            vec![sample_session(
                "focus-12345678",
                "planner",
                SessionState::Running,
                None,
                1,
                1,
            )],
            0,
        );
        dashboard.session_output_cache.insert(
            "focus-12345678".to_string(),
            vec![
                test_output_line(OutputStream::Stdout, "normal output"),
                test_output_line(OutputStream::Stdout, "Read(src/lib.rs)"),
                test_output_line(OutputStream::Stdout, "Updated ecc2/src/tui/dashboard.rs"),
                test_output_line(OutputStream::Stderr, "stderr line"),
            ],
        );

        dashboard.toggle_output_filter();
        assert_eq!(dashboard.output_filter, OutputFilter::ErrorsOnly);
        assert_eq!(dashboard.visible_output_text(), "stderr line");

        dashboard.toggle_output_filter();
        assert_eq!(dashboard.output_filter, OutputFilter::ToolCallsOnly);
        assert_eq!(dashboard.visible_output_text(), "Read(src/lib.rs)");
        assert_eq!(dashboard.output_title(), " Output tool calls ");
        assert_eq!(
            dashboard.operator_note.as_deref(),
            Some("output filter set to tool calls")
        );

        dashboard.toggle_output_filter();
        assert_eq!(dashboard.output_filter, OutputFilter::FileChangesOnly);
        assert_eq!(
            dashboard.visible_output_text(),
            "Updated ecc2/src/tui/dashboard.rs"
        );
        assert_eq!(dashboard.output_title(), " Output file changes ");
        assert_eq!(
            dashboard.operator_note.as_deref(),
            Some("output filter set to file changes")
        );
    }

    #[test]
    fn search_matches_respect_error_only_filter() {
        let mut dashboard = test_dashboard(
            vec![sample_session(
                "focus-12345678",
                "planner",
                SessionState::Running,
                None,
                1,
                1,
            )],
            0,
        );
        dashboard.session_output_cache.insert(
            "focus-12345678".to_string(),
            vec![
                test_output_line(OutputStream::Stdout, "alpha stdout"),
                test_output_line(OutputStream::Stderr, "alpha stderr"),
                test_output_line(OutputStream::Stderr, "beta stderr"),
            ],
        );
        dashboard.output_filter = OutputFilter::ErrorsOnly;
        dashboard.search_query = Some("alpha.*".to_string());
        dashboard.last_output_height = 1;

        dashboard.recompute_search_matches();

        assert_eq!(
            dashboard.search_matches,
            vec![SearchMatch {
                session_id: "focus-12345678".to_string(),
                line_index: 0,
            }]
        );
        assert_eq!(dashboard.visible_output_text(), "alpha stderr\nbeta stderr");
    }

    #[test]
    fn search_matches_respect_tool_call_filter() {
        let mut dashboard = test_dashboard(
            vec![sample_session(
                "focus-12345678",
                "planner",
                SessionState::Running,
                None,
                1,
                1,
            )],
            0,
        );
        dashboard.session_output_cache.insert(
            "focus-12345678".to_string(),
            vec![
                test_output_line(OutputStream::Stdout, "alpha normal"),
                test_output_line(OutputStream::Stdout, "Read(alpha.rs)"),
                test_output_line(OutputStream::Stdout, "Write(beta.rs)"),
            ],
        );
        dashboard.output_filter = OutputFilter::ToolCallsOnly;
        dashboard.search_query = Some("alpha.*".to_string());
        dashboard.last_output_height = 1;

        dashboard.recompute_search_matches();

        assert_eq!(
            dashboard.search_matches,
            vec![SearchMatch {
                session_id: "focus-12345678".to_string(),
                line_index: 0,
            }]
        );
        assert_eq!(
            dashboard.visible_output_text(),
            "Read(alpha.rs)\nWrite(beta.rs)"
        );
    }

    #[test]
    fn search_matches_respect_file_change_filter() {
        let mut dashboard = test_dashboard(
            vec![sample_session(
                "focus-12345678",
                "planner",
                SessionState::Running,
                None,
                1,
                1,
            )],
            0,
        );
        dashboard.session_output_cache.insert(
            "focus-12345678".to_string(),
            vec![
                test_output_line(OutputStream::Stdout, "alpha normal"),
                test_output_line(OutputStream::Stdout, "Updated alpha.rs"),
                test_output_line(OutputStream::Stdout, "Renamed beta.rs to gamma.rs"),
            ],
        );
        dashboard.output_filter = OutputFilter::FileChangesOnly;
        dashboard.search_query = Some("alpha.*".to_string());
        dashboard.last_output_height = 1;

        dashboard.recompute_search_matches();

        assert_eq!(
            dashboard.search_matches,
            vec![SearchMatch {
                session_id: "focus-12345678".to_string(),
                line_index: 0,
            }]
        );
        assert_eq!(
            dashboard.visible_output_text(),
            "Updated alpha.rs\nRenamed beta.rs to gamma.rs"
        );
    }

    #[test]
    fn cycle_output_time_filter_keeps_only_recent_lines() {
        let mut dashboard = test_dashboard(
            vec![sample_session(
                "focus-12345678",
                "planner",
                SessionState::Running,
                None,
                1,
                1,
            )],
            0,
        );
        dashboard.session_output_cache.insert(
            "focus-12345678".to_string(),
            vec![
                test_output_line_minutes_ago(OutputStream::Stdout, "recent line", 5),
                test_output_line_minutes_ago(OutputStream::Stdout, "older line", 45),
                test_output_line_minutes_ago(OutputStream::Stdout, "stale line", 180),
            ],
        );

        dashboard.cycle_output_time_filter();

        assert_eq!(
            dashboard.output_time_filter,
            OutputTimeFilter::Last15Minutes
        );
        assert_eq!(dashboard.visible_output_text(), "recent line");
        assert_eq!(dashboard.output_title(), " Output last 15m ");
        assert_eq!(
            dashboard.operator_note.as_deref(),
            Some("output time filter set to last 15m")
        );
    }

    #[test]
    fn search_matches_respect_time_filter() {
        let mut dashboard = test_dashboard(
            vec![sample_session(
                "focus-12345678",
                "planner",
                SessionState::Running,
                None,
                1,
                1,
            )],
            0,
        );
        dashboard.session_output_cache.insert(
            "focus-12345678".to_string(),
            vec![
                test_output_line_minutes_ago(OutputStream::Stdout, "alpha recent", 10),
                test_output_line_minutes_ago(OutputStream::Stdout, "beta recent", 10),
                test_output_line_minutes_ago(OutputStream::Stdout, "alpha stale", 180),
            ],
        );
        dashboard.output_time_filter = OutputTimeFilter::Last15Minutes;
        dashboard.search_query = Some("alpha.*".to_string());
        dashboard.last_output_height = 1;

        dashboard.recompute_search_matches();

        assert_eq!(
            dashboard.search_matches,
            vec![SearchMatch {
                session_id: "focus-12345678".to_string(),
                line_index: 0,
            }]
        );
        assert_eq!(dashboard.visible_output_text(), "alpha recent\nbeta recent");
    }

    #[test]
    fn search_scope_all_sessions_matches_across_output_buffers() {
        let mut dashboard = test_dashboard(
            vec![
                sample_session(
                    "focus-12345678",
                    "planner",
                    SessionState::Running,
                    None,
                    1,
                    1,
                ),
                sample_session(
                    "review-87654321",
                    "reviewer",
                    SessionState::Running,
                    None,
                    1,
                    1,
                ),
            ],
            0,
        );
        dashboard.session_output_cache.insert(
            "focus-12345678".to_string(),
            vec![test_output_line(OutputStream::Stdout, "alpha local")],
        );
        dashboard.session_output_cache.insert(
            "review-87654321".to_string(),
            vec![test_output_line(OutputStream::Stdout, "alpha global")],
        );
        dashboard.search_query = Some("alpha.*".to_string());

        dashboard.toggle_search_scope();

        assert_eq!(dashboard.search_scope, SearchScope::AllSessions);
        assert_eq!(
            dashboard.search_matches,
            vec![
                SearchMatch {
                    session_id: "focus-12345678".to_string(),
                    line_index: 0,
                },
                SearchMatch {
                    session_id: "review-87654321".to_string(),
                    line_index: 0,
                },
            ]
        );
        assert_eq!(
            dashboard.operator_note.as_deref(),
            Some("search scope set to all sessions | 2 match(es)")
        );
        assert_eq!(
            dashboard.output_title(),
            " Output all sessions /alpha.* 1/2 "
        );
    }

    #[test]
    fn next_search_match_switches_selected_session_in_all_sessions_scope() {
        let mut dashboard = test_dashboard(
            vec![
                sample_session(
                    "focus-12345678",
                    "planner",
                    SessionState::Running,
                    None,
                    1,
                    1,
                ),
                sample_session(
                    "review-87654321",
                    "reviewer",
                    SessionState::Running,
                    None,
                    1,
                    1,
                ),
            ],
            0,
        );
        dashboard.session_output_cache.insert(
            "focus-12345678".to_string(),
            vec![test_output_line(OutputStream::Stdout, "alpha local")],
        );
        dashboard.session_output_cache.insert(
            "review-87654321".to_string(),
            vec![test_output_line(OutputStream::Stdout, "alpha global")],
        );
        dashboard.search_scope = SearchScope::AllSessions;
        dashboard.search_query = Some("alpha.*".to_string());
        dashboard.last_output_height = 1;
        dashboard.recompute_search_matches();

        dashboard.next_search_match();

        assert_eq!(dashboard.selected_session_id(), Some("review-87654321"));
        assert_eq!(dashboard.selected_search_match, 1);
        assert_eq!(
            dashboard.operator_note.as_deref(),
            Some("search /alpha.* match 2/2 | all sessions")
        );
    }

    #[test]
    fn search_agent_filter_selected_agent_type_limits_global_search() {
        let mut dashboard = test_dashboard(
            vec![
                sample_session(
                    "focus-12345678",
                    "planner",
                    SessionState::Running,
                    None,
                    1,
                    1,
                ),
                sample_session(
                    "planner-2222222",
                    "planner",
                    SessionState::Running,
                    None,
                    1,
                    1,
                ),
                sample_session(
                    "review-87654321",
                    "reviewer",
                    SessionState::Running,
                    None,
                    1,
                    1,
                ),
            ],
            0,
        );
        dashboard.session_output_cache.insert(
            "focus-12345678".to_string(),
            vec![test_output_line(OutputStream::Stdout, "alpha local")],
        );
        dashboard.session_output_cache.insert(
            "planner-2222222".to_string(),
            vec![test_output_line(OutputStream::Stdout, "alpha planner")],
        );
        dashboard.session_output_cache.insert(
            "review-87654321".to_string(),
            vec![test_output_line(OutputStream::Stdout, "alpha reviewer")],
        );
        dashboard.search_scope = SearchScope::AllSessions;
        dashboard.search_query = Some("alpha.*".to_string());
        dashboard.recompute_search_matches();

        dashboard.toggle_search_agent_filter();

        assert_eq!(
            dashboard.search_agent_filter,
            SearchAgentFilter::SelectedAgentType
        );
        assert_eq!(
            dashboard.search_matches,
            vec![
                SearchMatch {
                    session_id: "focus-12345678".to_string(),
                    line_index: 0,
                },
                SearchMatch {
                    session_id: "planner-2222222".to_string(),
                    line_index: 0,
                },
            ]
        );
        assert_eq!(
            dashboard.operator_note.as_deref(),
            Some("search agent filter set to agent planner | 2 match(es)")
        );
        assert_eq!(
            dashboard.output_title(),
            " Output all sessions agent planner /alpha.* 1/2 "
        );
    }

    #[tokio::test]
    async fn stop_selected_uses_session_manager_transition() -> Result<()> {
        let db_path = std::env::temp_dir().join(format!("ecc2-dashboard-{}.db", Uuid::new_v4()));
        let db = StateStore::open(&db_path)?;
        let now = Utc::now();

        db.insert_session(&Session {
            id: "running-1".to_string(),
            task: "stop me".to_string(),
            project: "workspace".to_string(),
            task_group: "general".to_string(),
            agent_type: "claude".to_string(),
            state: SessionState::Running,
            working_dir: PathBuf::from("/tmp"),
            pid: Some(999_999),
            worktree: None,
            created_at: now,
            updated_at: now,
            last_heartbeat_at: now,
            metrics: SessionMetrics::default(),
        })?;

        let dashboard_store = StateStore::open(&db_path)?;
        let mut dashboard = Dashboard::new(dashboard_store, Config::default());
        dashboard.stop_selected().await;

        let session = db
            .get_session("running-1")?
            .expect("session should exist after stop");
        assert_eq!(session.state, SessionState::Stopped);
        assert_eq!(session.pid, None);

        let _ = std::fs::remove_file(db_path);
        Ok(())
    }

    #[tokio::test]
    async fn resume_selected_requeues_failed_session() -> Result<()> {
        let db_path = std::env::temp_dir().join(format!("ecc2-dashboard-{}.db", Uuid::new_v4()));
        let db = StateStore::open(&db_path)?;
        let now = Utc::now();

        db.insert_session(&Session {
            id: "failed-1".to_string(),
            task: "resume me".to_string(),
            project: "workspace".to_string(),
            task_group: "general".to_string(),
            agent_type: "claude".to_string(),
            state: SessionState::Failed,
            working_dir: PathBuf::from("/tmp/ecc2-resume"),
            pid: None,
            worktree: Some(WorktreeInfo {
                path: PathBuf::from("/tmp/ecc2-resume"),
                branch: "ecc/failed-1".to_string(),
                base_branch: "main".to_string(),
            }),
            created_at: now,
            updated_at: now,
            last_heartbeat_at: now,
            metrics: SessionMetrics::default(),
        })?;

        let dashboard_store = StateStore::open(&db_path)?;
        let mut dashboard = Dashboard::new(dashboard_store, Config::default());
        dashboard.resume_selected().await;

        let session = db
            .get_session("failed-1")?
            .expect("session should exist after resume");
        assert_eq!(session.state, SessionState::Pending);
        assert_eq!(session.pid, None);

        let _ = std::fs::remove_file(db_path);
        Ok(())
    }

    #[tokio::test]
    async fn cleanup_selected_worktree_clears_session_metadata() -> Result<()> {
        let db_path = std::env::temp_dir().join(format!("ecc2-dashboard-{}.db", Uuid::new_v4()));
        let db = StateStore::open(&db_path)?;
        let now = Utc::now();
        let worktree_path = std::env::temp_dir().join(format!("ecc2-cleanup-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&worktree_path)?;

        db.insert_session(&Session {
            id: "stopped-1".to_string(),
            task: "cleanup me".to_string(),
            project: "workspace".to_string(),
            task_group: "general".to_string(),
            agent_type: "claude".to_string(),
            state: SessionState::Stopped,
            working_dir: worktree_path.clone(),
            pid: None,
            worktree: Some(WorktreeInfo {
                path: worktree_path.clone(),
                branch: "ecc/stopped-1".to_string(),
                base_branch: "main".to_string(),
            }),
            created_at: now,
            updated_at: now,
            last_heartbeat_at: now,
            metrics: SessionMetrics::default(),
        })?;

        let dashboard_store = StateStore::open(&db_path)?;
        let mut dashboard = Dashboard::new(dashboard_store, Config::default());
        dashboard.cleanup_selected_worktree().await;

        let session = db
            .get_session("stopped-1")?
            .expect("session should exist after cleanup");
        assert!(
            session.worktree.is_none(),
            "worktree metadata should be cleared"
        );

        let _ = std::fs::remove_dir_all(worktree_path);
        let _ = std::fs::remove_file(db_path);
        Ok(())
    }

    #[tokio::test]
    async fn prune_inactive_worktrees_sets_operator_note_when_clear() -> Result<()> {
        let db_path = std::env::temp_dir().join(format!("ecc2-dashboard-{}.db", Uuid::new_v4()));
        let db = StateStore::open(&db_path)?;
        let now = Utc::now();

        db.insert_session(&Session {
            id: "running-1".to_string(),
            task: "keep alive".to_string(),
            project: "workspace".to_string(),
            task_group: "general".to_string(),
            agent_type: "claude".to_string(),
            working_dir: PathBuf::from("/tmp"),
            state: SessionState::Running,
            pid: None,
            worktree: None,
            created_at: now,
            updated_at: now,
            last_heartbeat_at: now,
            metrics: SessionMetrics::default(),
        })?;

        let dashboard_store = StateStore::open(&db_path)?;
        let mut dashboard = Dashboard::new(dashboard_store, Config::default());
        dashboard.prune_inactive_worktrees().await;

        assert_eq!(
            dashboard.operator_note.as_deref(),
            Some("no inactive worktrees to prune")
        );

        let _ = std::fs::remove_file(db_path);
        Ok(())
    }

    #[tokio::test]
    async fn prune_inactive_worktrees_reports_pruned_and_skipped_counts() -> Result<()> {
        let db_path = std::env::temp_dir().join(format!("ecc2-dashboard-{}.db", Uuid::new_v4()));
        let db = StateStore::open(&db_path)?;
        let now = Utc::now();
        let active_path = std::env::temp_dir().join(format!("ecc2-active-{}", Uuid::new_v4()));
        let stopped_path = std::env::temp_dir().join(format!("ecc2-stopped-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&active_path)?;
        std::fs::create_dir_all(&stopped_path)?;

        db.insert_session(&Session {
            id: "running-1".to_string(),
            task: "keep worktree".to_string(),
            project: "workspace".to_string(),
            task_group: "general".to_string(),
            agent_type: "claude".to_string(),
            working_dir: active_path.clone(),
            state: SessionState::Running,
            pid: None,
            worktree: Some(WorktreeInfo {
                path: active_path.clone(),
                branch: "ecc/running-1".to_string(),
                base_branch: "main".to_string(),
            }),
            created_at: now,
            updated_at: now,
            last_heartbeat_at: now,
            metrics: SessionMetrics::default(),
        })?;
        db.insert_session(&Session {
            id: "stopped-1".to_string(),
            task: "prune me".to_string(),
            project: "workspace".to_string(),
            task_group: "general".to_string(),
            agent_type: "claude".to_string(),
            working_dir: stopped_path.clone(),
            state: SessionState::Stopped,
            pid: None,
            worktree: Some(WorktreeInfo {
                path: stopped_path.clone(),
                branch: "ecc/stopped-1".to_string(),
                base_branch: "main".to_string(),
            }),
            created_at: now,
            updated_at: now,
            last_heartbeat_at: now,
            metrics: SessionMetrics::default(),
        })?;

        let dashboard_store = StateStore::open(&db_path)?;
        let mut dashboard = Dashboard::new(dashboard_store, Config::default());
        dashboard.prune_inactive_worktrees().await;

        assert_eq!(
            dashboard.operator_note.as_deref(),
            Some("pruned 1 inactive worktree(s); skipped 1 active session(s)")
        );
        assert!(db
            .get_session("stopped-1")?
            .expect("stopped session should exist")
            .worktree
            .is_none());
        assert!(db
            .get_session("running-1")?
            .expect("running session should exist")
            .worktree
            .is_some());

        let _ = std::fs::remove_dir_all(active_path);
        let _ = std::fs::remove_dir_all(stopped_path);
        let _ = std::fs::remove_file(db_path);
        Ok(())
    }

    #[tokio::test]
    async fn prune_inactive_worktrees_reports_retained_sessions_within_retention() -> Result<()> {
        let db_path = std::env::temp_dir().join(format!("ecc2-dashboard-{}.db", Uuid::new_v4()));
        let db = StateStore::open(&db_path)?;
        let now = Utc::now();
        let retained_path = std::env::temp_dir().join(format!("ecc2-retained-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&retained_path)?;

        db.insert_session(&Session {
            id: "stopped-1".to_string(),
            task: "retain me".to_string(),
            project: "workspace".to_string(),
            task_group: "general".to_string(),
            agent_type: "claude".to_string(),
            working_dir: retained_path.clone(),
            state: SessionState::Stopped,
            pid: None,
            worktree: Some(WorktreeInfo {
                path: retained_path.clone(),
                branch: "ecc/stopped-1".to_string(),
                base_branch: "main".to_string(),
            }),
            created_at: now,
            updated_at: now,
            last_heartbeat_at: now,
            metrics: SessionMetrics::default(),
        })?;

        let mut cfg = Config::default();
        cfg.db_path = db_path.clone();
        cfg.worktree_retention_secs = 3600;

        let dashboard_store = StateStore::open(&db_path)?;
        let mut dashboard = Dashboard::new(dashboard_store, cfg);
        dashboard.prune_inactive_worktrees().await;

        assert_eq!(
            dashboard.operator_note.as_deref(),
            Some("deferred 1 inactive worktree(s) within retention")
        );
        assert!(db
            .get_session("stopped-1")?
            .expect("stopped session should exist")
            .worktree
            .is_some());

        let _ = std::fs::remove_dir_all(retained_path);
        let _ = std::fs::remove_file(db_path);
        Ok(())
    }

    #[tokio::test(flavor = "current_thread")]
    async fn merge_selected_worktree_sets_operator_note_when_ready() -> Result<()> {
        let tempdir = std::env::temp_dir().join(format!("dashboard-merge-{}", Uuid::new_v4()));
        let repo_root = tempdir.join("repo");
        init_git_repo(&repo_root)?;

        let cfg = build_config(&tempdir);
        let db = StateStore::open(&cfg.db_path)?;
        let worktree = worktree::create_for_session_in_repo("merge1234", &cfg, &repo_root)?;
        let session_id = "merge1234".to_string();
        let now = Utc::now();
        db.insert_session(&Session {
            id: session_id.clone(),
            task: "merge via dashboard".to_string(),
            project: "workspace".to_string(),
            task_group: "general".to_string(),
            agent_type: "claude".to_string(),
            working_dir: worktree.path.clone(),
            state: SessionState::Completed,
            pid: None,
            worktree: Some(worktree.clone()),
            created_at: now,
            updated_at: now,
            last_heartbeat_at: now,
            metrics: SessionMetrics::default(),
        })?;

        std::fs::write(worktree.path.join("dashboard.txt"), "dashboard merge\n")?;
        Command::new("git")
            .arg("-C")
            .arg(&worktree.path)
            .args(["add", "dashboard.txt"])
            .status()?;
        Command::new("git")
            .arg("-C")
            .arg(&worktree.path)
            .args(["commit", "-qm", "dashboard work"])
            .status()?;

        let mut dashboard = Dashboard::new(db, cfg);
        dashboard.sync_selection_by_id(Some(&session_id));
        dashboard.merge_selected_worktree().await;

        let note = dashboard
            .operator_note
            .clone()
            .context("operator note should be set")?;
        assert!(note.contains("merged ecc/merge1234 into"));
        assert!(note.contains(&format!("for {}", format_session_id(&session_id))));

        let session = dashboard
            .db
            .get_session(&session_id)?
            .context("merged session should still exist")?;
        assert!(
            session.worktree.is_none(),
            "worktree metadata should be cleared"
        );
        assert!(!worktree.path.exists(), "worktree path should be removed");
        assert_eq!(
            std::fs::read_to_string(repo_root.join("dashboard.txt"))?,
            "dashboard merge\n"
        );

        let _ = std::fs::remove_dir_all(&tempdir);
        Ok(())
    }

    #[tokio::test(flavor = "current_thread")]
    async fn merge_ready_worktrees_sets_operator_note_with_skip_summary() -> Result<()> {
        let tempdir =
            std::env::temp_dir().join(format!("dashboard-merge-ready-{}", Uuid::new_v4()));
        let repo_root = tempdir.join("repo");
        init_git_repo(&repo_root)?;

        let cfg = build_config(&tempdir);
        let db = StateStore::open(&cfg.db_path)?;
        let now = Utc::now();

        let merged_worktree =
            worktree::create_for_session_in_repo("merge-ready", &cfg, &repo_root)?;
        std::fs::write(
            merged_worktree.path.join("merged.txt"),
            "dashboard bulk merge\n",
        )?;
        Command::new("git")
            .arg("-C")
            .arg(&merged_worktree.path)
            .args(["add", "merged.txt"])
            .status()?;
        Command::new("git")
            .arg("-C")
            .arg(&merged_worktree.path)
            .args(["commit", "-qm", "dashboard bulk merge"])
            .status()?;
        db.insert_session(&Session {
            id: "merge-ready".to_string(),
            task: "merge via dashboard".to_string(),
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
            worktree::create_for_session_in_repo("active-ready", &cfg, &repo_root)?;
        db.insert_session(&Session {
            id: "active-ready".to_string(),
            task: "still active".to_string(),
            project: "workspace".to_string(),
            task_group: "general".to_string(),
            agent_type: "claude".to_string(),
            working_dir: active_worktree.path.clone(),
            state: SessionState::Running,
            pid: Some(999),
            worktree: Some(active_worktree.clone()),
            created_at: now,
            updated_at: now,
            last_heartbeat_at: now,
            metrics: SessionMetrics::default(),
        })?;

        let mut dashboard = Dashboard::new(db, cfg);
        dashboard.merge_ready_worktrees().await;

        let note = dashboard
            .operator_note
            .clone()
            .context("operator note should be set")?;
        assert!(note.contains("merged 1 ready worktree(s)"));
        assert!(note.contains("skipped 1 active"));
        assert!(dashboard
            .db
            .get_session("merge-ready")?
            .context("merged session should still exist")?
            .worktree
            .is_none());
        assert_eq!(
            std::fs::read_to_string(repo_root.join("merged.txt"))?,
            "dashboard bulk merge\n"
        );

        let _ = std::fs::remove_dir_all(&tempdir);
        Ok(())
    }

    #[tokio::test]
    async fn delete_selected_session_removes_inactive_session() -> Result<()> {
        let db_path = std::env::temp_dir().join(format!("ecc2-dashboard-{}.db", Uuid::new_v4()));
        let db = StateStore::open(&db_path)?;
        let now = Utc::now();

        db.insert_session(&Session {
            id: "done-1".to_string(),
            task: "delete me".to_string(),
            project: "workspace".to_string(),
            task_group: "general".to_string(),
            agent_type: "claude".to_string(),
            working_dir: PathBuf::from("/tmp"),
            state: SessionState::Completed,
            pid: None,
            worktree: None,
            created_at: now,
            updated_at: now,
            last_heartbeat_at: now,
            metrics: SessionMetrics::default(),
        })?;

        let dashboard_store = StateStore::open(&db_path)?;
        let mut dashboard = Dashboard::new(dashboard_store, Config::default());
        dashboard.delete_selected_session().await;

        assert!(
            db.get_session("done-1")?.is_none(),
            "session should be deleted"
        );

        let _ = std::fs::remove_file(db_path);
        Ok(())
    }

    #[tokio::test]
    async fn auto_dispatch_backlog_sets_operator_note_when_clear() -> Result<()> {
        let db_path = std::env::temp_dir().join(format!("ecc2-dashboard-{}.db", Uuid::new_v4()));
        let db = StateStore::open(&db_path)?;
        let now = Utc::now();

        db.insert_session(&Session {
            id: "lead-1".to_string(),
            task: "coordinate".to_string(),
            project: "workspace".to_string(),
            task_group: "general".to_string(),
            agent_type: "claude".to_string(),
            working_dir: PathBuf::from("/tmp"),
            state: SessionState::Running,
            pid: None,
            worktree: None,
            created_at: now,
            updated_at: now,
            last_heartbeat_at: now,
            metrics: SessionMetrics::default(),
        })?;

        let dashboard_store = StateStore::open(&db_path)?;
        let mut dashboard = Dashboard::new(dashboard_store, Config::default());
        dashboard.auto_dispatch_backlog().await;

        assert_eq!(
            dashboard.operator_note.as_deref(),
            Some("no unread handoff backlog found")
        );

        let _ = std::fs::remove_file(db_path);
        Ok(())
    }

    #[tokio::test]
    async fn rebalance_selected_team_sets_operator_note_when_clear() -> Result<()> {
        let db_path = std::env::temp_dir().join(format!("ecc2-dashboard-{}.db", Uuid::new_v4()));
        let db = StateStore::open(&db_path)?;
        let now = Utc::now();

        db.insert_session(&Session {
            id: "lead-1".to_string(),
            task: "coordinate".to_string(),
            project: "workspace".to_string(),
            task_group: "general".to_string(),
            agent_type: "claude".to_string(),
            working_dir: PathBuf::from("/tmp"),
            state: SessionState::Running,
            pid: None,
            worktree: None,
            created_at: now,
            updated_at: now,
            last_heartbeat_at: now,
            metrics: SessionMetrics::default(),
        })?;

        let dashboard_store = StateStore::open(&db_path)?;
        let mut dashboard = Dashboard::new(dashboard_store, Config::default());
        dashboard.rebalance_selected_team().await;

        assert_eq!(
            dashboard.operator_note.as_deref(),
            Some("no delegate backlog needed rebalancing for lead-1")
        );

        let _ = std::fs::remove_file(db_path);
        Ok(())
    }

    #[tokio::test]
    async fn rebalance_all_teams_sets_operator_note_when_clear() -> Result<()> {
        let db_path = std::env::temp_dir().join(format!("ecc2-dashboard-{}.db", Uuid::new_v4()));
        let db = StateStore::open(&db_path)?;
        let now = Utc::now();

        db.insert_session(&Session {
            id: "lead-1".to_string(),
            task: "coordinate".to_string(),
            project: "workspace".to_string(),
            task_group: "general".to_string(),
            agent_type: "claude".to_string(),
            working_dir: PathBuf::from("/tmp"),
            state: SessionState::Running,
            pid: None,
            worktree: None,
            created_at: now,
            updated_at: now,
            last_heartbeat_at: now,
            metrics: SessionMetrics::default(),
        })?;

        let dashboard_store = StateStore::open(&db_path)?;
        let mut dashboard = Dashboard::new(dashboard_store, Config::default());
        dashboard.rebalance_all_teams().await;

        assert_eq!(
            dashboard.operator_note.as_deref(),
            Some("no delegate backlog needed global rebalancing")
        );

        let _ = std::fs::remove_file(db_path);
        Ok(())
    }

    #[tokio::test]
    async fn coordinate_backlog_sets_operator_note_when_clear() -> Result<()> {
        let db_path = std::env::temp_dir().join(format!("ecc2-dashboard-{}.db", Uuid::new_v4()));
        let db = StateStore::open(&db_path)?;
        let now = Utc::now();

        db.insert_session(&Session {
            id: "lead-1".to_string(),
            task: "coordinate".to_string(),
            project: "workspace".to_string(),
            task_group: "general".to_string(),
            agent_type: "claude".to_string(),
            working_dir: PathBuf::from("/tmp"),
            state: SessionState::Running,
            pid: None,
            worktree: None,
            created_at: now,
            updated_at: now,
            last_heartbeat_at: now,
            metrics: SessionMetrics::default(),
        })?;

        let dashboard_store = StateStore::open(&db_path)?;
        let mut dashboard = Dashboard::new(dashboard_store, Config::default());
        dashboard.coordinate_backlog().await;

        assert_eq!(
            dashboard.operator_note.as_deref(),
            Some("backlog already clear")
        );

        let _ = std::fs::remove_file(db_path);
        Ok(())
    }

    #[test]
    fn grid_layout_renders_four_panes() {
        let mut dashboard = test_dashboard(
            vec![sample_session(
                "grid-1",
                "claude",
                SessionState::Running,
                None,
                1,
                1,
            )],
            0,
        );
        dashboard.cfg.pane_layout = PaneLayout::Grid;
        dashboard.pane_size_percent = DEFAULT_GRID_SIZE_PERCENT;

        let areas = dashboard.pane_areas(Rect::new(0, 0, 100, 40));
        let output_area = areas.output.expect("grid layout should include output");
        let metrics_area = areas.metrics.expect("grid layout should include metrics");
        let log_area = areas.log.expect("grid layout should include a log pane");

        assert!(output_area.x > areas.sessions.x);
        assert!(metrics_area.y > areas.sessions.y);
        assert!(log_area.x > metrics_area.x);
    }

    #[test]
    fn collapse_selected_pane_hides_metrics_and_moves_focus() {
        let mut dashboard = test_dashboard(Vec::new(), 0);
        dashboard.selected_pane = Pane::Metrics;

        dashboard.collapse_selected_pane();

        assert_eq!(dashboard.selected_pane, Pane::Sessions);
        assert_eq!(
            dashboard.visible_panes(),
            vec![Pane::Sessions, Pane::Output]
        );
        assert_eq!(
            dashboard.operator_note.as_deref(),
            Some("collapsed metrics pane")
        );
    }

    #[test]
    fn collapse_selected_pane_rejects_sessions_and_last_detail_pane() {
        let mut dashboard = test_dashboard(Vec::new(), 0);

        dashboard.collapse_selected_pane();
        assert_eq!(
            dashboard.operator_note.as_deref(),
            Some("cannot collapse sessions pane")
        );

        dashboard.selected_pane = Pane::Metrics;
        dashboard.collapse_selected_pane();
        dashboard.selected_pane = Pane::Output;
        dashboard.collapse_selected_pane();

        assert_eq!(
            dashboard.operator_note.as_deref(),
            Some("cannot collapse last detail pane")
        );
        assert_eq!(
            dashboard.visible_panes(),
            vec![Pane::Sessions, Pane::Output]
        );
    }

    #[test]
    fn restore_collapsed_panes_restores_hidden_tabs() {
        let mut dashboard = test_dashboard(Vec::new(), 0);
        dashboard.selected_pane = Pane::Metrics;
        dashboard.collapse_selected_pane();

        dashboard.restore_collapsed_panes();

        assert_eq!(
            dashboard.visible_panes(),
            vec![Pane::Sessions, Pane::Output, Pane::Metrics]
        );
        assert_eq!(
            dashboard.operator_note.as_deref(),
            Some("restored 1 collapsed pane(s)")
        );
    }

    #[test]
    fn collapsed_grid_reflows_to_horizontal_detail_stack() {
        let mut dashboard = test_dashboard(Vec::new(), 0);
        dashboard.cfg.pane_layout = PaneLayout::Grid;
        dashboard.pane_size_percent = DEFAULT_GRID_SIZE_PERCENT;
        dashboard.selected_pane = Pane::Log;
        dashboard.collapse_selected_pane();

        let areas = dashboard.pane_areas(Rect::new(0, 0, 100, 40));
        let output_area = areas.output.expect("output should stay visible");
        let metrics_area = areas.metrics.expect("metrics should stay visible");

        assert!(areas.log.is_none());
        assert_eq!(areas.sessions.height, 40);
        assert_eq!(output_area.width, metrics_area.width);
        assert!(metrics_area.y > output_area.y);
    }

    #[test]
    fn pane_resize_clamps_to_bounds() {
        let mut dashboard = test_dashboard(Vec::new(), 0);
        dashboard.cfg.pane_layout = PaneLayout::Grid;
        dashboard.pane_size_percent = DEFAULT_GRID_SIZE_PERCENT;

        for _ in 0..20 {
            dashboard.adjust_pane_size_with_save(5, Path::new("/tmp/ecc2-noop.toml"), |_| Ok(()));
        }
        assert_eq!(dashboard.pane_size_percent, MAX_PANE_SIZE_PERCENT);

        for _ in 0..40 {
            dashboard.adjust_pane_size_with_save(-5, Path::new("/tmp/ecc2-noop.toml"), |_| Ok(()));
        }
        assert_eq!(dashboard.pane_size_percent, MIN_PANE_SIZE_PERCENT);
    }

    #[test]
    fn pane_navigation_skips_log_outside_grid_layouts() {
        let mut dashboard = test_dashboard(Vec::new(), 0);
        dashboard.next_pane();
        dashboard.next_pane();
        dashboard.next_pane();
        assert_eq!(dashboard.selected_pane, Pane::Sessions);

        dashboard.cfg.pane_layout = PaneLayout::Grid;
        dashboard.pane_size_percent = DEFAULT_GRID_SIZE_PERCENT;
        dashboard.next_pane();
        dashboard.next_pane();
        dashboard.next_pane();
        assert_eq!(dashboard.selected_pane, Pane::Log);
    }

    #[test]
    fn focus_pane_number_selects_visible_panes_and_rejects_hidden_targets() {
        let mut dashboard = test_dashboard(Vec::new(), 0);

        dashboard.focus_pane_number(3);

        assert_eq!(dashboard.selected_pane, Pane::Metrics);
        assert_eq!(
            dashboard.operator_note.as_deref(),
            Some("focused metrics pane")
        );

        dashboard.focus_pane_number(4);

        assert_eq!(dashboard.selected_pane, Pane::Metrics);
        assert_eq!(
            dashboard.operator_note.as_deref(),
            Some("log pane is not visible")
        );
    }

    #[test]
    fn directional_pane_focus_uses_grid_neighbors() {
        let mut dashboard = test_dashboard(Vec::new(), 0);
        dashboard.cfg.pane_layout = PaneLayout::Grid;
        dashboard.pane_size_percent = DEFAULT_GRID_SIZE_PERCENT;

        dashboard.focus_pane_right();
        assert_eq!(dashboard.selected_pane, Pane::Output);

        dashboard.focus_pane_down();
        assert_eq!(dashboard.selected_pane, Pane::Log);

        dashboard.focus_pane_left();
        assert_eq!(dashboard.selected_pane, Pane::Metrics);

        dashboard.focus_pane_up();
        assert_eq!(dashboard.selected_pane, Pane::Sessions);
        assert_eq!(
            dashboard.operator_note.as_deref(),
            Some("focused sessions pane")
        );
    }

    #[test]
    fn configured_pane_navigation_keys_override_defaults() {
        let mut dashboard = test_dashboard(Vec::new(), 0);
        dashboard.cfg.pane_navigation.focus_metrics = "e".to_string();
        dashboard.cfg.pane_navigation.move_left = "a".to_string();

        assert!(dashboard.handle_pane_navigation_key(KeyEvent::new(
            crossterm::event::KeyCode::Char('e'),
            crossterm::event::KeyModifiers::NONE,
        )));
        assert_eq!(dashboard.selected_pane, Pane::Metrics);

        assert!(dashboard.handle_pane_navigation_key(KeyEvent::new(
            crossterm::event::KeyCode::Char('a'),
            crossterm::event::KeyModifiers::NONE,
        )));
        assert_eq!(dashboard.selected_pane, Pane::Sessions);
    }

    #[test]
    fn pane_navigation_labels_use_configured_bindings() {
        let mut dashboard = test_dashboard(Vec::new(), 0);
        dashboard.cfg.pane_navigation.focus_sessions = "q".to_string();
        dashboard.cfg.pane_navigation.focus_output = "w".to_string();
        dashboard.cfg.pane_navigation.focus_metrics = "e".to_string();
        dashboard.cfg.pane_navigation.focus_log = "r".to_string();
        dashboard.cfg.pane_navigation.move_left = "a".to_string();
        dashboard.cfg.pane_navigation.move_down = "s".to_string();
        dashboard.cfg.pane_navigation.move_up = "w".to_string();
        dashboard.cfg.pane_navigation.move_right = "d".to_string();

        assert_eq!(dashboard.pane_focus_shortcuts_label(), "q/w/e/r");
        assert_eq!(dashboard.pane_move_shortcuts_label(), "a/s/w/d");
    }

    #[test]
    fn pane_command_mode_handles_focus_and_cancel() {
        let mut dashboard = test_dashboard(Vec::new(), 0);

        dashboard.begin_pane_command_mode();
        assert!(dashboard.is_pane_command_mode());

        assert!(dashboard.handle_pane_command_key(KeyEvent::new(
            crossterm::event::KeyCode::Char('3'),
            crossterm::event::KeyModifiers::NONE,
        )));
        assert_eq!(dashboard.selected_pane, Pane::Metrics);
        assert!(!dashboard.is_pane_command_mode());

        dashboard.begin_pane_command_mode();
        assert!(dashboard.handle_pane_command_key(KeyEvent::new(
            crossterm::event::KeyCode::Esc,
            crossterm::event::KeyModifiers::NONE,
        )));
        assert_eq!(
            dashboard.operator_note.as_deref(),
            Some("pane command cancelled")
        );
        assert!(!dashboard.is_pane_command_mode());
    }

    #[test]
    fn pane_command_mode_sets_layout() {
        let tempdir = std::env::temp_dir().join(format!("ecc2-pane-command-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&tempdir).unwrap();
        let previous_home = std::env::var_os("HOME");
        std::env::set_var("HOME", &tempdir);

        let mut dashboard = test_dashboard(Vec::new(), 0);
        dashboard.cfg.pane_layout = PaneLayout::Horizontal;

        dashboard.begin_pane_command_mode();
        assert!(dashboard.handle_pane_command_key(KeyEvent::new(
            crossterm::event::KeyCode::Char('g'),
            crossterm::event::KeyModifiers::NONE,
        )));

        assert_eq!(dashboard.cfg.pane_layout, PaneLayout::Grid);
        assert!(dashboard
            .operator_note
            .as_deref()
            .is_some_and(|note| note.contains("pane layout set to grid | saved to ")));

        if let Some(home) = previous_home {
            std::env::set_var("HOME", home);
        } else {
            std::env::remove_var("HOME");
        }
        let _ = std::fs::remove_dir_all(tempdir);
    }

    #[test]
    fn cycle_pane_layout_rotates_and_hides_log_when_leaving_grid() {
        let tempdir = std::env::temp_dir().join(format!("ecc2-cycle-pane-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&tempdir).unwrap();
        let previous_home = std::env::var_os("HOME");
        std::env::set_var("HOME", &tempdir);

        let mut dashboard = test_dashboard(Vec::new(), 0);
        dashboard.cfg.pane_layout = PaneLayout::Grid;
        dashboard.cfg.linear_pane_size_percent = 44;
        dashboard.cfg.grid_pane_size_percent = 77;
        dashboard.pane_size_percent = 77;
        dashboard.selected_pane = Pane::Log;

        dashboard.cycle_pane_layout();

        assert_eq!(dashboard.cfg.pane_layout, PaneLayout::Horizontal);
        assert_eq!(dashboard.pane_size_percent, 44);
        assert_eq!(dashboard.selected_pane, Pane::Sessions);

        if let Some(home) = previous_home {
            std::env::set_var("HOME", home);
        } else {
            std::env::remove_var("HOME");
        }
        let _ = std::fs::remove_dir_all(tempdir);
    }

    #[test]
    fn cycle_pane_layout_persists_config() {
        let mut dashboard = test_dashboard(Vec::new(), 0);
        let tempdir = std::env::temp_dir().join(format!("ecc2-layout-policy-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&tempdir).unwrap();
        let config_path = tempdir.join("ecc2.toml");

        dashboard.cycle_pane_layout_with_save(&config_path, |cfg| cfg.save_to_path(&config_path));

        assert_eq!(dashboard.cfg.pane_layout, PaneLayout::Vertical);
        let expected_note = format!(
            "pane layout set to vertical | saved to {}",
            config_path.display()
        );
        assert_eq!(
            dashboard.operator_note.as_deref(),
            Some(expected_note.as_str())
        );

        let saved = std::fs::read_to_string(&config_path).unwrap();
        let loaded: Config = toml::from_str(&saved).unwrap();
        assert_eq!(loaded.pane_layout, PaneLayout::Vertical);
        let _ = std::fs::remove_dir_all(tempdir);
    }

    #[test]
    fn pane_resize_persists_linear_setting() {
        let mut dashboard = test_dashboard(Vec::new(), 0);
        let tempdir = std::env::temp_dir().join(format!("ecc2-pane-size-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&tempdir).unwrap();
        let config_path = tempdir.join("ecc2.toml");

        dashboard.adjust_pane_size_with_save(5, &config_path, |cfg| cfg.save_to_path(&config_path));

        assert_eq!(dashboard.pane_size_percent, 40);
        assert_eq!(dashboard.cfg.linear_pane_size_percent, 40);
        let expected_note = format!(
            "pane size set to 40% for horizontal layout | saved to {}",
            config_path.display()
        );
        assert_eq!(
            dashboard.operator_note.as_deref(),
            Some(expected_note.as_str())
        );

        let saved = std::fs::read_to_string(&config_path).unwrap();
        let loaded: Config = toml::from_str(&saved).unwrap();
        assert_eq!(loaded.linear_pane_size_percent, 40);
        assert_eq!(loaded.grid_pane_size_percent, 50);
        let _ = std::fs::remove_dir_all(tempdir);
    }

    #[test]
    fn cycle_pane_layout_uses_persisted_grid_size() {
        let mut dashboard = test_dashboard(Vec::new(), 0);
        dashboard.cfg.pane_layout = PaneLayout::Vertical;
        dashboard.cfg.linear_pane_size_percent = 41;
        dashboard.cfg.grid_pane_size_percent = 63;
        dashboard.pane_size_percent = 41;

        dashboard.cycle_pane_layout_with_save(Path::new("/tmp/ecc2-noop.toml"), |_| Ok(()));

        assert_eq!(dashboard.cfg.pane_layout, PaneLayout::Grid);
        assert_eq!(dashboard.pane_size_percent, 63);
    }

    #[test]
    fn auto_split_layout_after_spawn_prefers_vertical_for_two_live_sessions() {
        let mut dashboard = test_dashboard(
            vec![
                sample_session("running-1", "planner", SessionState::Running, None, 1, 1),
                sample_session("idle-1", "planner", SessionState::Idle, None, 1, 1),
            ],
            0,
        );

        let note = dashboard.auto_split_layout_after_spawn_with_save(
            2,
            Path::new("/tmp/ecc2-noop.toml"),
            |_| Ok(()),
        );

        assert_eq!(dashboard.cfg.pane_layout, PaneLayout::Vertical);
        assert_eq!(
            dashboard.pane_size_percent,
            dashboard.cfg.linear_pane_size_percent
        );
        assert_eq!(dashboard.selected_pane, Pane::Sessions);
        assert_eq!(
            note.as_deref(),
            Some("auto-split vertical layout for 2 live session(s)")
        );
    }

    #[test]
    fn auto_split_layout_after_spawn_prefers_grid_for_three_live_sessions() {
        let mut dashboard = test_dashboard(
            vec![
                sample_session("pending-1", "planner", SessionState::Pending, None, 1, 1),
                sample_session("running-1", "planner", SessionState::Running, None, 1, 1),
                sample_session("idle-1", "planner", SessionState::Idle, None, 1, 1),
            ],
            1,
        );
        dashboard.selected_pane = Pane::Output;

        let note = dashboard.auto_split_layout_after_spawn_with_save(
            2,
            Path::new("/tmp/ecc2-noop.toml"),
            |_| Ok(()),
        );

        assert_eq!(dashboard.cfg.pane_layout, PaneLayout::Grid);
        assert_eq!(
            dashboard.pane_size_percent,
            dashboard.cfg.grid_pane_size_percent
        );
        assert_eq!(dashboard.selected_pane, Pane::Sessions);
        assert_eq!(
            note.as_deref(),
            Some("auto-split grid layout for 3 live session(s)")
        );
    }

    #[test]
    fn auto_split_layout_after_spawn_focuses_sessions_when_layout_already_matches() {
        let mut dashboard = test_dashboard(
            vec![
                sample_session("pending-1", "planner", SessionState::Pending, None, 1, 1),
                sample_session("running-1", "planner", SessionState::Running, None, 1, 1),
                sample_session("idle-1", "planner", SessionState::Idle, None, 1, 1),
            ],
            1,
        );
        dashboard.cfg.pane_layout = PaneLayout::Grid;
        dashboard.selected_pane = Pane::Output;

        let note = dashboard.auto_split_layout_after_spawn_with_save(
            3,
            Path::new("/tmp/ecc2-noop.toml"),
            |_| Ok(()),
        );

        assert_eq!(dashboard.cfg.pane_layout, PaneLayout::Grid);
        assert_eq!(dashboard.selected_pane, Pane::Sessions);
        assert_eq!(
            note.as_deref(),
            Some("auto-focused sessions in grid layout for 3 live session(s)")
        );
    }

    #[test]
    fn post_spawn_selection_prefers_lead_for_multi_spawn() {
        let preferred = post_spawn_selection_id(
            Some("lead-12345678"),
            &["child-a".to_string(), "child-b".to_string()],
        );

        assert_eq!(preferred.as_deref(), Some("lead-12345678"));
    }

    #[test]
    fn post_spawn_selection_keeps_single_spawn_on_created_session() {
        let preferred = post_spawn_selection_id(Some("lead-12345678"), &["child-a".to_string()]);

        assert_eq!(preferred.as_deref(), Some("child-a"));
    }

    #[test]
    fn post_spawn_selection_falls_back_to_first_created_when_no_lead_exists() {
        let preferred =
            post_spawn_selection_id(None, &["child-a".to_string(), "child-b".to_string()]);

        assert_eq!(preferred.as_deref(), Some("child-a"));
    }

    #[test]
    fn toggle_theme_persists_config() {
        let mut dashboard = test_dashboard(Vec::new(), 0);
        let tempdir = std::env::temp_dir().join(format!("ecc2-theme-policy-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&tempdir).unwrap();
        let config_path = tempdir.join("ecc2.toml");

        dashboard.toggle_theme_with_save(&config_path, |cfg| cfg.save_to_path(&config_path));

        assert_eq!(dashboard.cfg.theme, Theme::Light);
        let expected_note = format!("theme set to light | saved to {}", config_path.display());
        assert_eq!(
            dashboard.operator_note.as_deref(),
            Some(expected_note.as_str())
        );

        let saved = std::fs::read_to_string(&config_path).unwrap();
        let loaded: Config = toml::from_str(&saved).unwrap();
        assert_eq!(loaded.theme, Theme::Light);
        let _ = std::fs::remove_dir_all(tempdir);
    }

    #[test]
    fn light_theme_uses_light_palette_accent() {
        let mut dashboard = test_dashboard(Vec::new(), 0);
        dashboard.cfg.theme = Theme::Light;
        dashboard.selected_pane = Pane::Sessions;

        assert_eq!(
            dashboard.pane_border_style(Pane::Sessions),
            Style::default().fg(Color::Blue)
        );
        assert_eq!(dashboard.theme_palette().row_highlight_bg, Color::Gray);
    }

    fn test_output_line(stream: OutputStream, text: &str) -> OutputLine {
        OutputLine::new(stream, text, Utc::now().to_rfc3339())
    }

    fn test_output_line_minutes_ago(
        stream: OutputStream,
        text: &str,
        minutes_ago: i64,
    ) -> OutputLine {
        OutputLine::new(
            stream,
            text,
            (Utc::now() - chrono::Duration::minutes(minutes_ago)).to_rfc3339(),
        )
    }

    fn line_plain_text(line: &Line<'_>) -> String {
        line.spans
            .iter()
            .map(|span| span.content.as_ref())
            .collect::<String>()
    }

    fn text_plain_text(text: &Text<'_>) -> String {
        text.lines
            .iter()
            .map(line_plain_text)
            .collect::<Vec<_>>()
            .join("\n")
    }

    fn test_dashboard(sessions: Vec<Session>, selected_session: usize) -> Dashboard {
        let selected_session = selected_session.min(sessions.len().saturating_sub(1));
        let cfg = Config::default();
        let notifier = DesktopNotifier::new(cfg.desktop_notifications.clone());
        let webhook_notifier = WebhookNotifier::new(cfg.webhook_notifications.clone());
        let last_session_states = sessions
            .iter()
            .map(|session| (session.id.clone(), session.state.clone()))
            .collect();
        let session_harnesses = sessions
            .iter()
            .map(|session| {
                (
                    session.id.clone(),
                    SessionHarnessInfo::detect(&session.agent_type, &session.working_dir)
                        .with_config_detection(&cfg, &session.working_dir),
                )
            })
            .collect();
        let output_store = SessionOutputStore::default();
        let output_rx = output_store.subscribe();
        let mut session_table_state = TableState::default();
        if !sessions.is_empty() {
            session_table_state.select(Some(selected_session));
        }

        Dashboard {
            db: StateStore::open(Path::new(":memory:")).expect("open test db"),
            pane_size_percent: configured_pane_size(&cfg, cfg.pane_layout),
            cfg,
            output_store,
            output_rx,
            notifier,
            webhook_notifier,
            sessions,
            session_harnesses,
            session_output_cache: HashMap::new(),
            unread_message_counts: HashMap::new(),
            approval_queue_counts: HashMap::new(),
            approval_queue_preview: Vec::new(),
            handoff_backlog_counts: HashMap::new(),
            board_meta_by_session: HashMap::new(),
            worktree_health_by_session: HashMap::new(),
            global_handoff_backlog_leads: 0,
            global_handoff_backlog_messages: 0,
            daemon_activity: DaemonActivity::default(),
            selected_messages: Vec::new(),
            selected_parent_session: None,
            selected_child_sessions: Vec::new(),
            focused_delegate_session_id: None,
            selected_team_summary: None,
            selected_route_preview: None,
            logs: Vec::new(),
            selected_diff_summary: None,
            selected_diff_preview: Vec::new(),
            selected_diff_patch: None,
            selected_diff_hunk_offsets_unified: Vec::new(),
            selected_diff_hunk_offsets_split: Vec::new(),
            selected_diff_hunk: 0,
            diff_view_mode: DiffViewMode::Split,
            selected_conflict_protocol: None,
            selected_merge_readiness: None,
            selected_git_status_entries: Vec::new(),
            selected_git_status: 0,
            selected_git_patch: None,
            selected_git_patch_hunk_offsets_unified: Vec::new(),
            selected_git_patch_hunk_offsets_split: Vec::new(),
            selected_git_patch_hunk: 0,
            output_mode: OutputMode::SessionOutput,
            graph_entity_filter: GraphEntityFilter::All,
            output_filter: OutputFilter::All,
            output_time_filter: OutputTimeFilter::AllTime,
            timeline_event_filter: TimelineEventFilter::All,
            timeline_scope: SearchScope::SelectedSession,
            selected_pane: Pane::Sessions,
            selected_session,
            show_help: false,
            operator_note: None,
            pane_command_mode: false,
            output_follow: true,
            output_scroll_offset: 0,
            last_output_height: 0,
            metrics_scroll_offset: 0,
            last_metrics_height: 0,
            collapsed_panes: HashSet::new(),
            search_input: None,
            spawn_input: None,
            commit_input: None,
            pr_input: None,
            search_query: None,
            search_scope: SearchScope::SelectedSession,
            search_agent_filter: SearchAgentFilter::AllAgents,
            search_matches: Vec::new(),
            selected_search_match: 0,
            active_completion_popup: None,
            queued_completion_popups: VecDeque::new(),
            session_table_state,
            last_cost_metrics_signature: None,
            last_tool_activity_signature: None,
            last_budget_alert_state: BudgetState::Normal,
            last_session_states,
            last_seen_approval_message_id: None,
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
            budget_alert_thresholds: crate::config::Config::BUDGET_ALERT_THRESHOLDS,
            conflict_resolution: crate::config::ConflictResolutionConfig::default(),
            theme: Theme::Dark,
            pane_layout: PaneLayout::Horizontal,
            pane_navigation: Default::default(),
            linear_pane_size_percent: 35,
            grid_pane_size_percent: 50,
            risk_thresholds: Config::RISK_THRESHOLDS,
        }
    }

    fn init_git_repo(path: &Path) -> Result<()> {
        fs::create_dir_all(path)?;
        run_git(path, &["init", "-q"])?;
        run_git(path, &["config", "user.name", "ECC Tests"])?;
        run_git(path, &["config", "user.email", "ecc-tests@example.com"])?;
        // Keep fixtures hermetic: a global core.hooksPath (e.g. identity-checking
        // pre-push hooks) must not run inside test repos.
        run_git(path, &["config", "core.hooksPath", "hooks-disabled"])?;
        fs::write(path.join("README.md"), "hello\n")?;
        run_git(path, &["add", "README.md"])?;
        run_git(path, &["commit", "-qm", "init"])?;
        Ok(())
    }

    fn run_git(path: &Path, args: &[&str]) -> Result<()> {
        let output = Command::new("git")
            .arg("-C")
            .arg(path)
            .args(args)
            .output()?;
        if !output.status.success() {
            anyhow::bail!("{}", String::from_utf8_lossy(&output.stderr));
        }
        Ok(())
    }

    fn git_stdout(path: &Path, args: &[&str]) -> Result<String> {
        let output = Command::new("git")
            .arg("-C")
            .arg(path)
            .args(args)
            .output()?;
        if !output.status.success() {
            anyhow::bail!("{}", String::from_utf8_lossy(&output.stderr));
        }
        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    }

    fn sample_session(
        id: &str,
        agent_type: &str,
        state: SessionState,
        branch: Option<&str>,
        tokens_used: u64,
        duration_secs: u64,
    ) -> Session {
        Session {
            id: id.to_string(),
            task: "Render dashboard rows".to_string(),
            project: "workspace".to_string(),
            task_group: "general".to_string(),
            agent_type: agent_type.to_string(),
            state,
            working_dir: branch
                .map(|branch| PathBuf::from(format!("/tmp/{branch}")))
                .unwrap_or_else(|| PathBuf::from("/tmp")),
            pid: None,
            worktree: branch.map(|branch| WorktreeInfo {
                path: PathBuf::from(format!("/tmp/{branch}")),
                branch: branch.to_string(),
                base_branch: "main".to_string(),
            }),
            created_at: Utc::now(),
            updated_at: Utc::now(),
            last_heartbeat_at: Utc::now(),
            metrics: SessionMetrics {
                input_tokens: tokens_used.saturating_mul(3) / 4,
                output_tokens: tokens_used / 4,
                tokens_used,
                tool_calls: 4,
                files_changed: 2,
                duration_secs,
                cost_usd: 0.42,
            },
        }
    }

    fn budget_session(id: &str, tokens_used: u64, cost_usd: f64) -> Session {
        let now = Utc::now();
        Session {
            id: id.to_string(),
            task: "Budget tracking".to_string(),
            project: "workspace".to_string(),
            task_group: "general".to_string(),
            agent_type: "claude".to_string(),
            state: SessionState::Running,
            working_dir: PathBuf::from("/tmp"),
            pid: None,
            worktree: None,
            created_at: now,
            updated_at: now,
            last_heartbeat_at: now,
            metrics: SessionMetrics {
                input_tokens: tokens_used.saturating_mul(3) / 4,
                output_tokens: tokens_used / 4,
                tokens_used,
                tool_calls: 0,
                files_changed: 0,
                duration_secs: 0,
                cost_usd,
            },
        }
    }

    fn render_dashboard_text(mut dashboard: Dashboard, width: u16, height: u16) -> String {
        let backend = TestBackend::new(width, height);
        let mut terminal = Terminal::new(backend).expect("create terminal");

        terminal
            .draw(|frame| dashboard.render(frame))
            .expect("render dashboard");

        let buffer = terminal.backend().buffer();
        buffer
            .content
            .chunks(buffer.area.width as usize)
            .map(|cells| cells.iter().map(|cell| cell.symbol()).collect::<String>())
            .collect::<Vec<_>>()
            .join("\n")
    }
}
