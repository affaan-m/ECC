use anyhow::{Context, Result};
use rusqlite::{Connection, OptionalExtension};
use serde::Serialize;
use std::cmp::Reverse;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::time::Duration;

use crate::comms;
use crate::config::Config;
use crate::observability::{ToolCallEvent, ToolLogEntry, ToolLogPage};

use super::output::{OutputLine, OutputStream, OUTPUT_BUFFER_LIMIT};
use super::{
    default_project_label, default_task_group_label, normalize_group_label,
    ContextGraphCompactionStats, ContextGraphEntity, ContextGraphEntityDetail,
    ContextGraphObservation, ContextGraphRecallEntry, ContextGraphRelation, ContextGraphSyncStats,
    ContextObservationPriority, DecisionLogEntry, FileActivityAction, FileActivityEntry,
    HarnessKind, RemoteDispatchKind, RemoteDispatchRequest, RemoteDispatchStatus, ScheduledTask,
    Session, SessionAgentProfile, SessionBoardMeta, SessionHarnessInfo, SessionMessage,
    SessionMetrics, SessionState, WorktreeInfo,
};

pub struct StateStore {
    conn: Connection,
}

const DEFAULT_CONTEXT_GRAPH_OBSERVATION_RETENTION: usize = 12;

#[derive(Debug, Clone)]
pub struct PendingWorktreeRequest {
    pub session_id: String,
    pub repo_root: PathBuf,
    pub _requested_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct FileActivityOverlap {
    pub path: String,
    pub current_action: FileActivityAction,
    pub other_action: FileActivityAction,
    pub other_session_id: String,
    pub other_session_state: SessionState,
    pub timestamp: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ConnectorCheckpointSummary {
    pub connector_name: String,
    pub synced_sources: usize,
    pub last_synced_at: Option<chrono::DateTime<chrono::Utc>>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ConflictIncident {
    pub id: i64,
    pub conflict_key: String,
    pub path: String,
    pub first_session_id: String,
    pub second_session_id: String,
    pub active_session_id: String,
    pub paused_session_id: String,
    pub first_action: FileActivityAction,
    pub second_action: FileActivityAction,
    pub strategy: String,
    pub summary: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
    pub resolved_at: Option<chrono::DateTime<chrono::Utc>>,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct DaemonActivity {
    pub last_dispatch_at: Option<chrono::DateTime<chrono::Utc>>,
    pub last_dispatch_routed: usize,
    pub last_dispatch_deferred: usize,
    pub last_dispatch_leads: usize,
    pub chronic_saturation_streak: usize,
    pub last_recovery_dispatch_at: Option<chrono::DateTime<chrono::Utc>>,
    pub last_recovery_dispatch_routed: usize,
    pub last_recovery_dispatch_leads: usize,
    pub last_rebalance_at: Option<chrono::DateTime<chrono::Utc>>,
    pub last_rebalance_rerouted: usize,
    pub last_rebalance_leads: usize,
    pub last_auto_merge_at: Option<chrono::DateTime<chrono::Utc>>,
    pub last_auto_merge_merged: usize,
    pub last_auto_merge_active_skipped: usize,
    pub last_auto_merge_conflicted_skipped: usize,
    pub last_auto_merge_dirty_skipped: usize,
    pub last_auto_merge_failed: usize,
    pub last_auto_prune_at: Option<chrono::DateTime<chrono::Utc>>,
    pub last_auto_prune_pruned: usize,
    pub last_auto_prune_active_skipped: usize,
}

impl DaemonActivity {
    pub fn prefers_rebalance_first(&self) -> bool {
        if self.last_dispatch_deferred == 0 {
            return false;
        }

        match (
            self.last_dispatch_at.as_ref(),
            self.last_recovery_dispatch_at.as_ref(),
        ) {
            (Some(dispatch_at), Some(recovery_at)) => recovery_at < dispatch_at,
            (Some(_), None) => true,
            _ => false,
        }
    }

    pub fn dispatch_cooloff_active(&self) -> bool {
        self.prefers_rebalance_first()
            && (self.last_dispatch_deferred >= 2 || self.chronic_saturation_streak >= 3)
    }

    pub fn chronic_saturation_cleared_at(&self) -> Option<&chrono::DateTime<chrono::Utc>> {
        if self.prefers_rebalance_first() {
            return None;
        }

        match (
            self.last_dispatch_at.as_ref(),
            self.last_recovery_dispatch_at.as_ref(),
        ) {
            (Some(dispatch_at), Some(recovery_at)) if recovery_at > dispatch_at => {
                Some(recovery_at)
            }
            _ => None,
        }
    }

    pub fn stabilized_after_recovery_at(&self) -> Option<&chrono::DateTime<chrono::Utc>> {
        if self.last_dispatch_deferred != 0 {
            return None;
        }

        match (
            self.last_dispatch_at.as_ref(),
            self.last_recovery_dispatch_at.as_ref(),
        ) {
            (Some(dispatch_at), Some(recovery_at)) if dispatch_at > recovery_at => {
                Some(dispatch_at)
            }
            _ => None,
        }
    }

    pub fn operator_escalation_required(&self) -> bool {
        self.dispatch_cooloff_active()
            && self.chronic_saturation_streak >= 5
            && self.last_rebalance_rerouted == 0
    }
}

impl StateStore {
    pub fn open(path: &Path) -> Result<Self> {
        let conn = Connection::open(path)?;
        conn.execute_batch("PRAGMA foreign_keys = ON;")?;
        conn.busy_timeout(Duration::from_secs(5))?;
        let store = Self { conn };
        store.init_schema()?;
        Ok(store)
    }

    fn init_schema(&self) -> Result<()> {
        self.conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                task TEXT NOT NULL,
                project TEXT NOT NULL DEFAULT '',
                task_group TEXT NOT NULL DEFAULT '',
                agent_type TEXT NOT NULL,
                harness TEXT NOT NULL DEFAULT 'unknown',
                detected_harnesses_json TEXT NOT NULL DEFAULT '[]',
                working_dir TEXT NOT NULL DEFAULT '.',
                state TEXT NOT NULL DEFAULT 'pending',
                pid INTEGER,
                worktree_path TEXT,
                worktree_branch TEXT,
                worktree_base TEXT,
                input_tokens INTEGER DEFAULT 0,
                output_tokens INTEGER DEFAULT 0,
                tokens_used INTEGER DEFAULT 0,
                tool_calls INTEGER DEFAULT 0,
                files_changed INTEGER DEFAULT 0,
                duration_secs INTEGER DEFAULT 0,
                cost_usd REAL DEFAULT 0.0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                last_heartbeat_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS tool_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                hook_event_id TEXT UNIQUE,
                session_id TEXT NOT NULL REFERENCES sessions(id),
                tool_name TEXT NOT NULL,
                input_summary TEXT,
                input_params_json TEXT NOT NULL DEFAULT '{}',
                output_summary TEXT,
                trigger_summary TEXT NOT NULL DEFAULT '',
                duration_ms INTEGER,
                risk_score REAL DEFAULT 0.0,
                timestamp TEXT NOT NULL,
                file_paths_json TEXT NOT NULL DEFAULT '[]',
                file_events_json TEXT NOT NULL DEFAULT '[]'
            );

            CREATE TABLE IF NOT EXISTS session_profiles (
                session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
                profile_name TEXT NOT NULL,
                model TEXT,
                allowed_tools_json TEXT NOT NULL DEFAULT '[]',
                disallowed_tools_json TEXT NOT NULL DEFAULT '[]',
                permission_mode TEXT,
                add_dirs_json TEXT NOT NULL DEFAULT '[]',
                max_budget_usd REAL,
                token_budget INTEGER,
                append_system_prompt TEXT
            );

            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                from_session TEXT NOT NULL,
                to_session TEXT NOT NULL,
                content TEXT NOT NULL,
                msg_type TEXT NOT NULL DEFAULT 'info',
                read INTEGER DEFAULT 0,
                timestamp TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS session_output (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL REFERENCES sessions(id),
                stream TEXT NOT NULL,
                line TEXT NOT NULL,
                timestamp TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS session_board (
                session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
                lane TEXT NOT NULL,
                project TEXT,
                feature TEXT,
                issue TEXT,
                row_label TEXT,
                previous_lane TEXT,
                previous_row_label TEXT,
                column_index INTEGER NOT NULL DEFAULT 0,
                row_index INTEGER NOT NULL DEFAULT 0,
                stack_index INTEGER NOT NULL DEFAULT 0,
                progress_percent INTEGER NOT NULL DEFAULT 0,
                status_detail TEXT,
                movement_note TEXT,
                activity_kind TEXT,
                activity_note TEXT,
                handoff_backlog INTEGER NOT NULL DEFAULT 0,
                conflict_signal TEXT,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS decision_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                decision TEXT NOT NULL,
                alternatives_json TEXT NOT NULL DEFAULT '[]',
                reasoning TEXT NOT NULL,
                timestamp TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS context_graph_entities (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
                entity_key TEXT NOT NULL UNIQUE,
                entity_type TEXT NOT NULL,
                name TEXT NOT NULL,
                path TEXT,
                summary TEXT NOT NULL DEFAULT '',
                metadata_json TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS context_graph_relations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
                from_entity_id INTEGER NOT NULL REFERENCES context_graph_entities(id) ON DELETE CASCADE,
                to_entity_id INTEGER NOT NULL REFERENCES context_graph_entities(id) ON DELETE CASCADE,
                relation_type TEXT NOT NULL,
                summary TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                UNIQUE(from_entity_id, to_entity_id, relation_type)
            );

            CREATE TABLE IF NOT EXISTS context_graph_observations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
                entity_id INTEGER NOT NULL REFERENCES context_graph_entities(id) ON DELETE CASCADE,
                observation_type TEXT NOT NULL,
                priority INTEGER NOT NULL DEFAULT 1,
                pinned INTEGER NOT NULL DEFAULT 0,
                summary TEXT NOT NULL,
                details_json TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS context_graph_connector_checkpoints (
                connector_name TEXT NOT NULL,
                source_path TEXT NOT NULL,
                source_signature TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (connector_name, source_path)
            );

            CREATE TABLE IF NOT EXISTS pending_worktree_queue (
                session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
                repo_root TEXT NOT NULL,
                requested_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS scheduled_tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                cron_expr TEXT NOT NULL,
                task TEXT NOT NULL,
                agent_type TEXT NOT NULL,
                profile_name TEXT,
                working_dir TEXT NOT NULL,
                project TEXT NOT NULL DEFAULT '',
                task_group TEXT NOT NULL DEFAULT '',
                use_worktree INTEGER NOT NULL DEFAULT 1,
                last_run_at TEXT,
                next_run_at TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS remote_dispatch_requests (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                request_kind TEXT NOT NULL DEFAULT 'standard',
                target_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
                task TEXT NOT NULL,
                target_url TEXT,
                priority INTEGER NOT NULL DEFAULT 1,
                agent_type TEXT NOT NULL,
                profile_name TEXT,
                working_dir TEXT NOT NULL,
                project TEXT NOT NULL DEFAULT '',
                task_group TEXT NOT NULL DEFAULT '',
                use_worktree INTEGER NOT NULL DEFAULT 1,
                source TEXT NOT NULL DEFAULT '',
                requester TEXT,
                status TEXT NOT NULL DEFAULT 'pending',
                result_session_id TEXT,
                result_action TEXT,
                error TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                dispatched_at TEXT
            );

            CREATE TABLE IF NOT EXISTS conflict_incidents (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                conflict_key TEXT NOT NULL UNIQUE,
                path TEXT NOT NULL,
                first_session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                second_session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                active_session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                paused_session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                first_action TEXT NOT NULL,
                second_action TEXT NOT NULL,
                strategy TEXT NOT NULL,
                summary TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                resolved_at TEXT
            );

            CREATE TABLE IF NOT EXISTS daemon_activity (
                id INTEGER PRIMARY KEY CHECK(id = 1),
                last_dispatch_at TEXT,
                last_dispatch_routed INTEGER NOT NULL DEFAULT 0,
                last_dispatch_deferred INTEGER NOT NULL DEFAULT 0,
                last_dispatch_leads INTEGER NOT NULL DEFAULT 0,
                chronic_saturation_streak INTEGER NOT NULL DEFAULT 0,
                last_recovery_dispatch_at TEXT,
                last_recovery_dispatch_routed INTEGER NOT NULL DEFAULT 0,
                last_recovery_dispatch_leads INTEGER NOT NULL DEFAULT 0,
                last_rebalance_at TEXT,
                last_rebalance_rerouted INTEGER NOT NULL DEFAULT 0,
                last_rebalance_leads INTEGER NOT NULL DEFAULT 0,
                last_auto_merge_at TEXT,
                last_auto_merge_merged INTEGER NOT NULL DEFAULT 0,
                last_auto_merge_active_skipped INTEGER NOT NULL DEFAULT 0,
                last_auto_merge_conflicted_skipped INTEGER NOT NULL DEFAULT 0,
                last_auto_merge_dirty_skipped INTEGER NOT NULL DEFAULT 0,
                last_auto_merge_failed INTEGER NOT NULL DEFAULT 0,
                last_auto_prune_at TEXT,
                last_auto_prune_pruned INTEGER NOT NULL DEFAULT 0,
                last_auto_prune_active_skipped INTEGER NOT NULL DEFAULT 0
            );

            CREATE INDEX IF NOT EXISTS idx_sessions_state ON sessions(state);
            CREATE INDEX IF NOT EXISTS idx_tool_log_session ON tool_log(session_id);
            CREATE INDEX IF NOT EXISTS idx_messages_to ON messages(to_session, read);
            CREATE INDEX IF NOT EXISTS idx_session_output_session
                ON session_output(session_id, id);
            CREATE INDEX IF NOT EXISTS idx_session_board_lane ON session_board(lane);
            CREATE INDEX IF NOT EXISTS idx_session_board_coords
                ON session_board(column_index, row_index, stack_index);
            CREATE INDEX IF NOT EXISTS idx_decision_log_session
                ON decision_log(session_id, timestamp, id);
            CREATE INDEX IF NOT EXISTS idx_context_graph_entities_session
                ON context_graph_entities(session_id, entity_type, updated_at, id);
            CREATE INDEX IF NOT EXISTS idx_context_graph_relations_from
                ON context_graph_relations(from_entity_id, created_at, id);
            CREATE INDEX IF NOT EXISTS idx_context_graph_relations_to
                ON context_graph_relations(to_entity_id, created_at, id);
            CREATE INDEX IF NOT EXISTS idx_context_graph_observations_entity
                ON context_graph_observations(entity_id, created_at, id);
            CREATE INDEX IF NOT EXISTS idx_context_graph_connector_checkpoints_updated_at
                ON context_graph_connector_checkpoints(updated_at, connector_name, source_path);
            CREATE INDEX IF NOT EXISTS idx_conflict_incidents_sessions
                ON conflict_incidents(first_session_id, second_session_id, resolved_at, updated_at);
            CREATE INDEX IF NOT EXISTS idx_pending_worktree_queue_requested_at
                ON pending_worktree_queue(requested_at, session_id);
            CREATE INDEX IF NOT EXISTS idx_remote_dispatch_requests_status_priority
                ON remote_dispatch_requests(status, priority DESC, created_at, id);

            INSERT OR IGNORE INTO daemon_activity (id) VALUES (1);
            ",
        )?;
        self.ensure_session_columns()?;
        self.ensure_session_board_columns()?;
        self.refresh_session_board_meta()?;
        Ok(())
    }

    fn ensure_session_columns(&self) -> Result<()> {
        if !self.has_column("sessions", "working_dir")? {
            self.conn
                .execute(
                    "ALTER TABLE sessions ADD COLUMN working_dir TEXT NOT NULL DEFAULT '.'",
                    [],
                )
                .context("Failed to add working_dir column to sessions table")?;
        }

        if !self.has_column("sessions", "pid")? {
            self.conn
                .execute("ALTER TABLE sessions ADD COLUMN pid INTEGER", [])
                .context("Failed to add pid column to sessions table")?;
        }

        if !self.has_column("sessions", "project")? {
            self.conn
                .execute(
                    "ALTER TABLE sessions ADD COLUMN project TEXT NOT NULL DEFAULT ''",
                    [],
                )
                .context("Failed to add project column to sessions table")?;
        }

        if !self.has_column("sessions", "task_group")? {
            self.conn
                .execute(
                    "ALTER TABLE sessions ADD COLUMN task_group TEXT NOT NULL DEFAULT ''",
                    [],
                )
                .context("Failed to add task_group column to sessions table")?;
        }

        if !self.has_column("sessions", "harness")? {
            self.conn
                .execute(
                    "ALTER TABLE sessions ADD COLUMN harness TEXT NOT NULL DEFAULT 'unknown'",
                    [],
                )
                .context("Failed to add harness column to sessions table")?;
        }

        if !self.has_column("sessions", "detected_harnesses_json")? {
            self.conn
                .execute(
                    "ALTER TABLE sessions ADD COLUMN detected_harnesses_json TEXT NOT NULL DEFAULT '[]'",
                    [],
                )
                .context("Failed to add detected_harnesses_json column to sessions table")?;
        }

        if !self.has_column("sessions", "input_tokens")? {
            self.conn
                .execute(
                    "ALTER TABLE sessions ADD COLUMN input_tokens INTEGER NOT NULL DEFAULT 0",
                    [],
                )
                .context("Failed to add input_tokens column to sessions table")?;
        }

        if !self.has_column("sessions", "output_tokens")? {
            self.conn
                .execute(
                    "ALTER TABLE sessions ADD COLUMN output_tokens INTEGER NOT NULL DEFAULT 0",
                    [],
                )
                .context("Failed to add output_tokens column to sessions table")?;
        }

        if !self.has_column("sessions", "tokens_used")? {
            self.conn
                .execute(
                    "ALTER TABLE sessions ADD COLUMN tokens_used INTEGER NOT NULL DEFAULT 0",
                    [],
                )
                .context("Failed to add tokens_used column to sessions table")?;
        }

        if !self.has_column("sessions", "tool_calls")? {
            self.conn
                .execute(
                    "ALTER TABLE sessions ADD COLUMN tool_calls INTEGER NOT NULL DEFAULT 0",
                    [],
                )
                .context("Failed to add tool_calls column to sessions table")?;
        }

        if !self.has_column("sessions", "files_changed")? {
            self.conn
                .execute(
                    "ALTER TABLE sessions ADD COLUMN files_changed INTEGER NOT NULL DEFAULT 0",
                    [],
                )
                .context("Failed to add files_changed column to sessions table")?;
        }

        if !self.has_column("sessions", "duration_secs")? {
            self.conn
                .execute(
                    "ALTER TABLE sessions ADD COLUMN duration_secs INTEGER NOT NULL DEFAULT 0",
                    [],
                )
                .context("Failed to add duration_secs column to sessions table")?;
        }

        if !self.has_column("sessions", "cost_usd")? {
            self.conn
                .execute(
                    "ALTER TABLE sessions ADD COLUMN cost_usd REAL NOT NULL DEFAULT 0.0",
                    [],
                )
                .context("Failed to add cost_usd column to sessions table")?;
        }

        if !self.has_column("sessions", "last_heartbeat_at")? {
            self.conn
                .execute("ALTER TABLE sessions ADD COLUMN last_heartbeat_at TEXT", [])
                .context("Failed to add last_heartbeat_at column to sessions table")?;
            self.conn
                .execute(
                    "UPDATE sessions
                     SET last_heartbeat_at = updated_at
                     WHERE last_heartbeat_at IS NULL",
                    [],
                )
                .context("Failed to backfill last_heartbeat_at column")?;
        }

        if !self.has_column("sessions", "worktree_path")? {
            self.conn
                .execute("ALTER TABLE sessions ADD COLUMN worktree_path TEXT", [])
                .context("Failed to add worktree_path column to sessions table")?;
        }

        if !self.has_column("sessions", "worktree_branch")? {
            self.conn
                .execute("ALTER TABLE sessions ADD COLUMN worktree_branch TEXT", [])
                .context("Failed to add worktree_branch column to sessions table")?;
        }

        if !self.has_column("sessions", "worktree_base")? {
            self.conn
                .execute("ALTER TABLE sessions ADD COLUMN worktree_base TEXT", [])
                .context("Failed to add worktree_base column to sessions table")?;
        }

        if !self.has_column("tool_log", "hook_event_id")? {
            self.conn
                .execute("ALTER TABLE tool_log ADD COLUMN hook_event_id TEXT", [])
                .context("Failed to add hook_event_id column to tool_log table")?;
        }

        if !self.has_column("tool_log", "file_paths_json")? {
            self.conn
                .execute(
                    "ALTER TABLE tool_log ADD COLUMN file_paths_json TEXT NOT NULL DEFAULT '[]'",
                    [],
                )
                .context("Failed to add file_paths_json column to tool_log table")?;
        }

        if !self.has_column("tool_log", "file_events_json")? {
            self.conn
                .execute(
                    "ALTER TABLE tool_log ADD COLUMN file_events_json TEXT NOT NULL DEFAULT '[]'",
                    [],
                )
                .context("Failed to add file_events_json column to tool_log table")?;
        }

        if !self.has_column("tool_log", "input_params_json")? {
            self.conn
                .execute(
                    "ALTER TABLE tool_log ADD COLUMN input_params_json TEXT NOT NULL DEFAULT '{}'",
                    [],
                )
                .context("Failed to add input_params_json column to tool_log table")?;
        }

        if !self.has_column("tool_log", "trigger_summary")? {
            self.conn
                .execute(
                    "ALTER TABLE tool_log ADD COLUMN trigger_summary TEXT NOT NULL DEFAULT ''",
                    [],
                )
                .context("Failed to add trigger_summary column to tool_log table")?;
        }

        if !self.has_column("context_graph_observations", "priority")? {
            self.conn
                .execute(
                    "ALTER TABLE context_graph_observations ADD COLUMN priority INTEGER NOT NULL DEFAULT 1",
                    [],
                )
                .context("Failed to add priority column to context_graph_observations table")?;
        }
        if !self.has_column("context_graph_observations", "pinned")? {
            self.conn
                .execute(
                    "ALTER TABLE context_graph_observations ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0",
                    [],
                )
                .context("Failed to add pinned column to context_graph_observations table")?;
        }

        if !self.has_column("daemon_activity", "last_dispatch_deferred")? {
            self.conn
                .execute(
                    "ALTER TABLE daemon_activity ADD COLUMN last_dispatch_deferred INTEGER NOT NULL DEFAULT 0",
                    [],
                )
                .context("Failed to add last_dispatch_deferred column to daemon_activity table")?;
        }

        if !self.has_column("daemon_activity", "last_recovery_dispatch_at")? {
            self.conn
                .execute(
                    "ALTER TABLE daemon_activity ADD COLUMN last_recovery_dispatch_at TEXT",
                    [],
                )
                .context(
                    "Failed to add last_recovery_dispatch_at column to daemon_activity table",
                )?;
        }

        if !self.has_column("daemon_activity", "last_recovery_dispatch_routed")? {
            self.conn
                .execute(
                    "ALTER TABLE daemon_activity ADD COLUMN last_recovery_dispatch_routed INTEGER NOT NULL DEFAULT 0",
                    [],
                )
                .context("Failed to add last_recovery_dispatch_routed column to daemon_activity table")?;
        }

        if !self.has_column("daemon_activity", "last_recovery_dispatch_leads")? {
            self.conn
                .execute(
                    "ALTER TABLE daemon_activity ADD COLUMN last_recovery_dispatch_leads INTEGER NOT NULL DEFAULT 0",
                    [],
                )
                .context("Failed to add last_recovery_dispatch_leads column to daemon_activity table")?;
        }

        if !self.has_column("daemon_activity", "chronic_saturation_streak")? {
            self.conn
                .execute(
                    "ALTER TABLE daemon_activity ADD COLUMN chronic_saturation_streak INTEGER NOT NULL DEFAULT 0",
                    [],
                )
                .context("Failed to add chronic_saturation_streak column to daemon_activity table")?;
        }

        if !self.has_column("daemon_activity", "last_auto_merge_at")? {
            self.conn
                .execute(
                    "ALTER TABLE daemon_activity ADD COLUMN last_auto_merge_at TEXT",
                    [],
                )
                .context("Failed to add last_auto_merge_at column to daemon_activity table")?;
        }

        if !self.has_column("daemon_activity", "last_auto_merge_merged")? {
            self.conn
                .execute(
                    "ALTER TABLE daemon_activity ADD COLUMN last_auto_merge_merged INTEGER NOT NULL DEFAULT 0",
                    [],
                )
                .context("Failed to add last_auto_merge_merged column to daemon_activity table")?;
        }

        if !self.has_column("daemon_activity", "last_auto_merge_active_skipped")? {
            self.conn
                .execute(
                    "ALTER TABLE daemon_activity ADD COLUMN last_auto_merge_active_skipped INTEGER NOT NULL DEFAULT 0",
                    [],
                )
                .context("Failed to add last_auto_merge_active_skipped column to daemon_activity table")?;
        }

        if !self.has_column("daemon_activity", "last_auto_merge_conflicted_skipped")? {
            self.conn
                .execute(
                    "ALTER TABLE daemon_activity ADD COLUMN last_auto_merge_conflicted_skipped INTEGER NOT NULL DEFAULT 0",
                    [],
                )
                .context("Failed to add last_auto_merge_conflicted_skipped column to daemon_activity table")?;
        }

        if !self.has_column("daemon_activity", "last_auto_merge_dirty_skipped")? {
            self.conn
                .execute(
                    "ALTER TABLE daemon_activity ADD COLUMN last_auto_merge_dirty_skipped INTEGER NOT NULL DEFAULT 0",
                    [],
                )
                .context("Failed to add last_auto_merge_dirty_skipped column to daemon_activity table")?;
        }

        if !self.has_column("daemon_activity", "last_auto_merge_failed")? {
            self.conn
                .execute(
                    "ALTER TABLE daemon_activity ADD COLUMN last_auto_merge_failed INTEGER NOT NULL DEFAULT 0",
                    [],
                )
                .context("Failed to add last_auto_merge_failed column to daemon_activity table")?;
        }

        if !self.has_column("daemon_activity", "last_auto_prune_at")? {
            self.conn
                .execute(
                    "ALTER TABLE daemon_activity ADD COLUMN last_auto_prune_at TEXT",
                    [],
                )
                .context("Failed to add last_auto_prune_at column to daemon_activity table")?;
        }

        if !self.has_column("daemon_activity", "last_auto_prune_pruned")? {
            self.conn
                .execute(
                    "ALTER TABLE daemon_activity ADD COLUMN last_auto_prune_pruned INTEGER NOT NULL DEFAULT 0",
                    [],
                )
                .context("Failed to add last_auto_prune_pruned column to daemon_activity table")?;
        }

        if !self.has_column("daemon_activity", "last_auto_prune_active_skipped")? {
            self.conn
                .execute(
                    "ALTER TABLE daemon_activity ADD COLUMN last_auto_prune_active_skipped INTEGER NOT NULL DEFAULT 0",
                    [],
                )
                .context("Failed to add last_auto_prune_active_skipped column to daemon_activity table")?;
        }

        if !self.has_column("remote_dispatch_requests", "request_kind")? {
            self.conn
                .execute(
                    "ALTER TABLE remote_dispatch_requests ADD COLUMN request_kind TEXT NOT NULL DEFAULT 'standard'",
                    [],
                )
                .context("Failed to add request_kind column to remote_dispatch_requests table")?;
        }

        if !self.has_column("remote_dispatch_requests", "target_url")? {
            self.conn
                .execute(
                    "ALTER TABLE remote_dispatch_requests ADD COLUMN target_url TEXT",
                    [],
                )
                .context("Failed to add target_url column to remote_dispatch_requests table")?;
        }

        self.conn.execute_batch(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_tool_log_hook_event
             ON tool_log(hook_event_id)
             WHERE hook_event_id IS NOT NULL;",
        )?;

        self.backfill_session_harnesses()?;

        Ok(())
    }

    fn ensure_session_board_columns(&self) -> Result<()> {
        if !self.has_column("session_board", "row_label")? {
            self.conn
                .execute("ALTER TABLE session_board ADD COLUMN row_label TEXT", [])
                .context("Failed to add row_label column to session_board table")?;
        }

        if !self.has_column("session_board", "previous_lane")? {
            self.conn
                .execute("ALTER TABLE session_board ADD COLUMN previous_lane TEXT", [])
                .context("Failed to add previous_lane column to session_board table")?;
        }

        if !self.has_column("session_board", "previous_row_label")? {
            self.conn
                .execute("ALTER TABLE session_board ADD COLUMN previous_row_label TEXT", [])
                .context("Failed to add previous_row_label column to session_board table")?;
        }

        if !self.has_column("session_board", "column_index")? {
            self.conn
                .execute(
                    "ALTER TABLE session_board ADD COLUMN column_index INTEGER NOT NULL DEFAULT 0",
                    [],
                )
                .context("Failed to add column_index column to session_board table")?;
        }

        if !self.has_column("session_board", "row_index")? {
            self.conn
                .execute(
                    "ALTER TABLE session_board ADD COLUMN row_index INTEGER NOT NULL DEFAULT 0",
                    [],
                )
                .context("Failed to add row_index column to session_board table")?;
        }

        if !self.has_column("session_board", "stack_index")? {
            self.conn
                .execute(
                    "ALTER TABLE session_board ADD COLUMN stack_index INTEGER NOT NULL DEFAULT 0",
                    [],
                )
                .context("Failed to add stack_index column to session_board table")?;
        }

        if !self.has_column("session_board", "progress_percent")? {
            self.conn
                .execute(
                    "ALTER TABLE session_board ADD COLUMN progress_percent INTEGER NOT NULL DEFAULT 0",
                    [],
                )
                .context("Failed to add progress_percent column to session_board table")?;
        }

        if !self.has_column("session_board", "status_detail")? {
            self.conn
                .execute("ALTER TABLE session_board ADD COLUMN status_detail TEXT", [])
                .context("Failed to add status_detail column to session_board table")?;
        }

        if !self.has_column("session_board", "movement_note")? {
            self.conn
                .execute("ALTER TABLE session_board ADD COLUMN movement_note TEXT", [])
                .context("Failed to add movement_note column to session_board table")?;
        }

        if !self.has_column("session_board", "activity_kind")? {
            self.conn
                .execute("ALTER TABLE session_board ADD COLUMN activity_kind TEXT", [])
                .context("Failed to add activity_kind column to session_board table")?;
        }

        if !self.has_column("session_board", "activity_note")? {
            self.conn
                .execute("ALTER TABLE session_board ADD COLUMN activity_note TEXT", [])
                .context("Failed to add activity_note column to session_board table")?;
        }

        if !self.has_column("session_board", "handoff_backlog")? {
            self.conn
                .execute(
                    "ALTER TABLE session_board ADD COLUMN handoff_backlog INTEGER NOT NULL DEFAULT 0",
                    [],
                )
                .context("Failed to add handoff_backlog column to session_board table")?;
        }

        if !self.has_column("session_board", "conflict_signal")? {
            self.conn
                .execute("ALTER TABLE session_board ADD COLUMN conflict_signal TEXT", [])
                .context("Failed to add conflict_signal column to session_board table")?;
        }

        Ok(())
    }

    fn has_column(&self, table: &str, column: &str) -> Result<bool> {
        let pragma = format!("PRAGMA table_info({table})");
        let mut stmt = self.conn.prepare(&pragma)?;
        let columns = stmt
            .query_map([], |row| row.get::<_, String>(1))?
            .collect::<std::result::Result<Vec<_>, _>>()?;

        Ok(columns.iter().any(|existing| existing == column))
    }

    fn backfill_session_harnesses(&self) -> Result<()> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, agent_type, working_dir FROM sessions")?;
        let updates = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;

        for (session_id, agent_type, working_dir) in updates {
            let canonical_agent_type = HarnessKind::canonical_agent_type(&agent_type);
            let harness =
                SessionHarnessInfo::detect(&canonical_agent_type, Path::new(&working_dir));
            let detected_json =
                serde_json::to_string(&harness.detected).context("serialize detected harnesses")?;
            self.conn.execute(
                "UPDATE sessions
                 SET agent_type = ?2,
                     harness = ?3,
                     detected_harnesses_json = ?4
                 WHERE id = ?1",
                rusqlite::params![
                    session_id,
                    canonical_agent_type,
                    harness.primary_label,
                    detected_json
                ],
            )?;
        }

        Ok(())
    }

    pub fn insert_session(&self, session: &Session) -> Result<()> {
        let harness = SessionHarnessInfo::detect(&session.agent_type, &session.working_dir);
        let detected_json =
            serde_json::to_string(&harness.detected).context("serialize detected harnesses")?;
        self.conn.execute(
            "INSERT INTO sessions (id, task, project, task_group, agent_type, harness, detected_harnesses_json, working_dir, state, pid, worktree_path, worktree_branch, worktree_base, created_at, updated_at, last_heartbeat_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)",
            rusqlite::params![
                session.id,
                session.task,
                session.project,
                session.task_group,
                session.agent_type,
                harness.primary_label,
                detected_json,
                session.working_dir.to_string_lossy().to_string(),
                session.state.to_string(),
                session.pid.map(i64::from),
                session
                    .worktree
                    .as_ref()
                    .map(|w| w.path.to_string_lossy().to_string()),
                session.worktree.as_ref().map(|w| w.branch.clone()),
                session.worktree.as_ref().map(|w| w.base_branch.clone()),
                session.created_at.to_rfc3339(),
                session.updated_at.to_rfc3339(),
                session.last_heartbeat_at.to_rfc3339(),
            ],
        )?;
        self.refresh_session_board_meta()?;
        Ok(())
    }

    pub fn upsert_session_profile(
        &self,
        session_id: &str,
        profile: &SessionAgentProfile,
    ) -> Result<()> {
        let allowed_tools_json = serde_json::to_string(&profile.allowed_tools)
            .context("serialize allowed agent profile tools")?;
        let disallowed_tools_json = serde_json::to_string(&profile.disallowed_tools)
            .context("serialize disallowed agent profile tools")?;
        let add_dirs_json =
            serde_json::to_string(&profile.add_dirs).context("serialize agent profile add_dirs")?;

        self.conn.execute(
            "INSERT INTO session_profiles (
                session_id,
                profile_name,
                model,
                allowed_tools_json,
                disallowed_tools_json,
                permission_mode,
                add_dirs_json,
                max_budget_usd,
                token_budget,
                append_system_prompt
             )
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
             ON CONFLICT(session_id) DO UPDATE SET
                profile_name = excluded.profile_name,
                model = excluded.model,
                allowed_tools_json = excluded.allowed_tools_json,
                disallowed_tools_json = excluded.disallowed_tools_json,
                permission_mode = excluded.permission_mode,
                add_dirs_json = excluded.add_dirs_json,
                max_budget_usd = excluded.max_budget_usd,
                token_budget = excluded.token_budget,
                append_system_prompt = excluded.append_system_prompt",
            rusqlite::params![
                session_id,
                profile.profile_name,
                profile.model,
                allowed_tools_json,
                disallowed_tools_json,
                profile.permission_mode,
                add_dirs_json,
                profile.max_budget_usd,
                profile.token_budget.map(|tokens| tokens as i64),
                profile.append_system_prompt,
            ],
        )?;
        Ok(())
    }

    pub fn get_session_profile(&self, session_id: &str) -> Result<Option<SessionAgentProfile>> {
        self.conn
            .query_row(
                "SELECT
                    profile_name,
                    model,
                    allowed_tools_json,
                    disallowed_tools_json,
                    permission_mode,
                    add_dirs_json,
                    max_budget_usd,
                    token_budget,
                    append_system_prompt
                 FROM session_profiles
                 WHERE session_id = ?1",
                [session_id],
                |row| {
                    let allowed_tools_json: String = row.get(2)?;
                    let disallowed_tools_json: String = row.get(3)?;
                    let add_dirs_json: String = row.get(5)?;
                    Ok(SessionAgentProfile {
                        profile_name: row.get(0)?,
                        model: row.get(1)?,
                        allowed_tools: serde_json::from_str(&allowed_tools_json)
                            .unwrap_or_default(),
                        disallowed_tools: serde_json::from_str(&disallowed_tools_json)
                            .unwrap_or_default(),
                        permission_mode: row.get(4)?,
                        add_dirs: serde_json::from_str(&add_dirs_json).unwrap_or_default(),
                        max_budget_usd: row.get(6)?,
                        token_budget: row
                            .get::<_, Option<i64>>(7)?
                            .map(|tokens| tokens as u64),
                        append_system_prompt: row.get(8)?,
                        agent: None,
                    })
                },
            )
            .optional()
            .map_err(Into::into)
    }

    pub fn update_state_and_pid(
        &self,
        session_id: &str,
        state: &SessionState,
        pid: Option<u32>,
    ) -> Result<()> {
        let updated = self.conn.execute(
            "UPDATE sessions
             SET state = ?1,
                 pid = ?2,
                 updated_at = ?3,
                 last_heartbeat_at = ?3
             WHERE id = ?4",
            rusqlite::params![
                state.to_string(),
                pid.map(i64::from),
                chrono::Utc::now().to_rfc3339(),
                session_id,
            ],
        )?;

        if updated == 0 {
            anyhow::bail!("Session not found: {session_id}");
        }

        self.refresh_session_board_meta()?;
        Ok(())
    }

    pub fn update_state(&self, session_id: &str, state: &SessionState) -> Result<()> {
        let current_state = self
            .conn
            .query_row(
                "SELECT state FROM sessions WHERE id = ?1",
                [session_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?
            .map(|raw| SessionState::from_db_value(&raw))
            .ok_or_else(|| anyhow::anyhow!("Session not found: {session_id}"))?;

        if !current_state.can_transition_to(state) {
            anyhow::bail!(
                "Invalid session state transition: {} -> {}",
                current_state,
                state
            );
        }

        let updated = self.conn.execute(
            "UPDATE sessions
             SET state = ?1,
                 updated_at = ?2,
                 last_heartbeat_at = ?2
             WHERE id = ?3",
            rusqlite::params![
                state.to_string(),
                chrono::Utc::now().to_rfc3339(),
                session_id,
            ],
        )?;

        if updated == 0 {
            anyhow::bail!("Session not found: {session_id}");
        }

        self.refresh_session_board_meta()?;
        Ok(())
    }

    pub fn update_pid(&self, session_id: &str, pid: Option<u32>) -> Result<()> {
        let updated = self.conn.execute(
            "UPDATE sessions
             SET pid = ?1,
                 updated_at = ?2,
                 last_heartbeat_at = ?2
             WHERE id = ?3",
            rusqlite::params![
                pid.map(i64::from),
                chrono::Utc::now().to_rfc3339(),
                session_id,
            ],
        )?;

        if updated == 0 {
            anyhow::bail!("Session not found: {session_id}");
        }

        self.refresh_session_board_meta()?;
        Ok(())
    }

    pub fn clear_worktree(&self, session_id: &str) -> Result<()> {
        let working_dir: String = self.conn.query_row(
            "SELECT working_dir FROM sessions WHERE id = ?1",
            [session_id],
            |row| row.get(0),
        )?;
        self.clear_worktree_to_dir(session_id, Path::new(&working_dir))
    }

    pub fn clear_worktree_to_dir(&self, session_id: &str, working_dir: &Path) -> Result<()> {
        let updated = self.conn.execute(
            "UPDATE sessions
             SET working_dir = ?1,
                 worktree_path = NULL,
                 worktree_branch = NULL,
                 worktree_base = NULL,
                 updated_at = ?2,
                 last_heartbeat_at = ?2
             WHERE id = ?3",
            rusqlite::params![
                working_dir.to_string_lossy().to_string(),
                chrono::Utc::now().to_rfc3339(),
                session_id
            ],
        )?;

        if updated == 0 {
            anyhow::bail!("Session not found: {session_id}");
        }

        self.refresh_session_board_meta()?;
        Ok(())
    }

    pub fn attach_worktree(&self, session_id: &str, worktree: &WorktreeInfo) -> Result<()> {
        let updated = self.conn.execute(
            "UPDATE sessions
             SET working_dir = ?1,
                 worktree_path = ?2,
                 worktree_branch = ?3,
                 worktree_base = ?4,
                 updated_at = ?5,
                 last_heartbeat_at = ?5
             WHERE id = ?6",
            rusqlite::params![
                worktree.path.to_string_lossy().to_string(),
                worktree.path.to_string_lossy().to_string(),
                worktree.branch,
                worktree.base_branch,
                chrono::Utc::now().to_rfc3339(),
                session_id
            ],
        )?;

        if updated == 0 {
            anyhow::bail!("Session not found: {session_id}");
        }

        self.refresh_session_board_meta()?;
        Ok(())
    }

    pub fn enqueue_pending_worktree(&self, session_id: &str, repo_root: &Path) -> Result<()> {
        self.conn.execute(
            "INSERT OR REPLACE INTO pending_worktree_queue (session_id, repo_root, requested_at)
             VALUES (?1, ?2, ?3)",
            rusqlite::params![
                session_id,
                repo_root.to_string_lossy().to_string(),
                chrono::Utc::now().to_rfc3339()
            ],
        )?;
        Ok(())
    }

    pub fn dequeue_pending_worktree(&self, session_id: &str) -> Result<()> {
        self.conn.execute(
            "DELETE FROM pending_worktree_queue WHERE session_id = ?1",
            [session_id],
        )?;
        Ok(())
    }

    pub fn pending_worktree_queue_contains(&self, session_id: &str) -> Result<bool> {
        Ok(self
            .conn
            .query_row(
                "SELECT 1 FROM pending_worktree_queue WHERE session_id = ?1",
                [session_id],
                |_| Ok(()),
            )
            .optional()?
            .is_some())
    }

    pub fn pending_worktree_queue(&self, limit: usize) -> Result<Vec<PendingWorktreeRequest>> {
        let mut stmt = self.conn.prepare(
            "SELECT session_id, repo_root, requested_at
             FROM pending_worktree_queue
             ORDER BY requested_at ASC, session_id ASC
             LIMIT ?1",
        )?;

        let rows = stmt
            .query_map([limit as i64], |row| {
                let requested_at: String = row.get(2)?;
                Ok(PendingWorktreeRequest {
                    session_id: row.get(0)?,
                    repo_root: PathBuf::from(row.get::<_, String>(1)?),
                    _requested_at: chrono::DateTime::parse_from_rfc3339(&requested_at)
                        .unwrap_or_default()
                        .with_timezone(&chrono::Utc),
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;

        Ok(rows)
    }

    pub fn insert_scheduled_task(
        &self,
        cron_expr: &str,
        task: &str,
        agent_type: &str,
        profile_name: Option<&str>,
        working_dir: &Path,
        project: &str,
        task_group: &str,
        use_worktree: bool,
        next_run_at: chrono::DateTime<chrono::Utc>,
    ) -> Result<ScheduledTask> {
        let now = chrono::Utc::now();
        self.conn.execute(
            "INSERT INTO scheduled_tasks (
                cron_expr,
                task,
                agent_type,
                profile_name,
                working_dir,
                project,
                task_group,
                use_worktree,
                next_run_at,
                created_at,
                updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            rusqlite::params![
                cron_expr,
                task,
                agent_type,
                profile_name,
                working_dir.display().to_string(),
                project,
                task_group,
                if use_worktree { 1_i64 } else { 0_i64 },
                next_run_at.to_rfc3339(),
                now.to_rfc3339(),
                now.to_rfc3339(),
            ],
        )?;
        let id = self.conn.last_insert_rowid();
        self.get_scheduled_task(id)?
            .ok_or_else(|| anyhow::anyhow!("Scheduled task {id} was not found after insert"))
    }

    pub fn list_scheduled_tasks(&self) -> Result<Vec<ScheduledTask>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, cron_expr, task, agent_type, profile_name, working_dir, project, task_group,
                    use_worktree, last_run_at, next_run_at, created_at, updated_at
             FROM scheduled_tasks
             ORDER BY next_run_at ASC, id ASC",
        )?;

        let rows = stmt.query_map([], map_scheduled_task)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    pub fn list_due_scheduled_tasks(
        &self,
        now: chrono::DateTime<chrono::Utc>,
        limit: usize,
    ) -> Result<Vec<ScheduledTask>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, cron_expr, task, agent_type, profile_name, working_dir, project, task_group,
                    use_worktree, last_run_at, next_run_at, created_at, updated_at
             FROM scheduled_tasks
             WHERE next_run_at <= ?1
             ORDER BY next_run_at ASC, id ASC
             LIMIT ?2",
        )?;

        let rows = stmt.query_map(
            rusqlite::params![now.to_rfc3339(), limit as i64],
            map_scheduled_task,
        )?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    pub fn get_scheduled_task(&self, schedule_id: i64) -> Result<Option<ScheduledTask>> {
        self.conn
            .query_row(
                "SELECT id, cron_expr, task, agent_type, profile_name, working_dir, project, task_group,
                        use_worktree, last_run_at, next_run_at, created_at, updated_at
                 FROM scheduled_tasks
                 WHERE id = ?1",
                [schedule_id],
                map_scheduled_task,
            )
            .optional()
            .map_err(Into::into)
    }

    pub fn delete_scheduled_task(&self, schedule_id: i64) -> Result<usize> {
        self.conn
            .execute("DELETE FROM scheduled_tasks WHERE id = ?1", [schedule_id])
            .map_err(Into::into)
    }

    pub fn record_scheduled_task_run(
        &self,
        schedule_id: i64,
        last_run_at: chrono::DateTime<chrono::Utc>,
        next_run_at: chrono::DateTime<chrono::Utc>,
    ) -> Result<()> {
        self.conn.execute(
            "UPDATE scheduled_tasks
             SET last_run_at = ?2, next_run_at = ?3, updated_at = ?4
             WHERE id = ?1",
            rusqlite::params![
                schedule_id,
                last_run_at.to_rfc3339(),
                next_run_at.to_rfc3339(),
                chrono::Utc::now().to_rfc3339(),
            ],
        )?;
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub fn insert_remote_dispatch_request(
        &self,
        request_kind: RemoteDispatchKind,
        target_session_id: Option<&str>,
        task: &str,
        target_url: Option<&str>,
        priority: crate::comms::TaskPriority,
        agent_type: &str,
        profile_name: Option<&str>,
        working_dir: &Path,
        project: &str,
        task_group: &str,
        use_worktree: bool,
        source: &str,
        requester: Option<&str>,
    ) -> Result<RemoteDispatchRequest> {
        let now = chrono::Utc::now();
        self.conn.execute(
            "INSERT INTO remote_dispatch_requests (
                request_kind,
                target_session_id,
                task,
                target_url,
                priority,
                agent_type,
                profile_name,
                working_dir,
                project,
                task_group,
                use_worktree,
                source,
                requester,
                status,
                created_at,
                updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, 'pending', ?14, ?15)",
            rusqlite::params![
                request_kind.to_string(),
                target_session_id,
                task,
                target_url,
                task_priority_db_value(priority),
                agent_type,
                profile_name,
                working_dir.display().to_string(),
                project,
                task_group,
                if use_worktree { 1_i64 } else { 0_i64 },
                source,
                requester,
                now.to_rfc3339(),
                now.to_rfc3339(),
            ],
        )?;
        let id = self.conn.last_insert_rowid();
        self.get_remote_dispatch_request(id)?.ok_or_else(|| {
            anyhow::anyhow!("Remote dispatch request {id} was not found after insert")
        })
    }

    pub fn list_remote_dispatch_requests(
        &self,
        include_processed: bool,
        limit: usize,
    ) -> Result<Vec<RemoteDispatchRequest>> {
        let sql = if include_processed {
            "SELECT id, request_kind, target_session_id, task, target_url, priority, agent_type, profile_name, working_dir,
                    project, task_group, use_worktree, source, requester, status,
                    result_session_id, result_action, error, created_at, updated_at, dispatched_at
             FROM remote_dispatch_requests
             ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'failed' THEN 1 ELSE 2 END ASC,
                      priority DESC, created_at ASC, id ASC
             LIMIT ?1"
        } else {
            "SELECT id, request_kind, target_session_id, task, target_url, priority, agent_type, profile_name, working_dir,
                    project, task_group, use_worktree, source, requester, status,
                    result_session_id, result_action, error, created_at, updated_at, dispatched_at
             FROM remote_dispatch_requests
             WHERE status = 'pending'
             ORDER BY priority DESC, created_at ASC, id ASC
             LIMIT ?1"
        };

        let mut stmt = self.conn.prepare(sql)?;
        let rows = stmt.query_map([limit as i64], map_remote_dispatch_request)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    pub fn list_pending_remote_dispatch_requests(
        &self,
        limit: usize,
    ) -> Result<Vec<RemoteDispatchRequest>> {
        self.list_remote_dispatch_requests(false, limit)
    }

    pub fn get_remote_dispatch_request(
        &self,
        request_id: i64,
    ) -> Result<Option<RemoteDispatchRequest>> {
        self.conn
            .query_row(
                "SELECT id, request_kind, target_session_id, task, target_url, priority, agent_type, profile_name, working_dir,
                        project, task_group, use_worktree, source, requester, status,
                        result_session_id, result_action, error, created_at, updated_at, dispatched_at
                 FROM remote_dispatch_requests
                 WHERE id = ?1",
                [request_id],
                map_remote_dispatch_request,
            )
            .optional()
            .map_err(Into::into)
    }

    pub fn record_remote_dispatch_success(
        &self,
        request_id: i64,
        result_session_id: Option<&str>,
        result_action: Option<&str>,
    ) -> Result<()> {
        let now = chrono::Utc::now();
        self.conn.execute(
            "UPDATE remote_dispatch_requests
             SET status = 'dispatched',
                 result_session_id = ?2,
                 result_action = ?3,
                 error = NULL,
                 dispatched_at = ?4,
                 updated_at = ?4
             WHERE id = ?1",
            rusqlite::params![
                request_id,
                result_session_id,
                result_action,
                now.to_rfc3339()
            ],
        )?;
        Ok(())
    }

    pub fn record_remote_dispatch_failure(&self, request_id: i64, error: &str) -> Result<()> {
        let now = chrono::Utc::now();
        self.conn.execute(
            "UPDATE remote_dispatch_requests
             SET status = 'failed',
                 error = ?2,
                 updated_at = ?3
             WHERE id = ?1",
            rusqlite::params![request_id, error, now.to_rfc3339()],
        )?;
        Ok(())
    }

    pub fn update_metrics(&self, session_id: &str, metrics: &SessionMetrics) -> Result<()> {
        self.conn.execute(
            "UPDATE sessions
             SET input_tokens = ?1,
                 output_tokens = ?2,
                 tokens_used = ?3,
                 tool_calls = ?4,
                 files_changed = ?5,
                 duration_secs = ?6,
                 cost_usd = ?7,
                 updated_at = ?8
             WHERE id = ?9",
            rusqlite::params![
                metrics.input_tokens as i64,
                metrics.output_tokens as i64,
                metrics.tokens_used as i64,
                metrics.tool_calls as i64,
                metrics.files_changed,
                metrics.duration_secs as i64,
                metrics.cost_usd,
                chrono::Utc::now().to_rfc3339(),
                session_id,
            ],
        )?;
        self.refresh_session_board_meta()?;
        Ok(())
    }

    pub fn refresh_session_durations(&self) -> Result<()> {
        let now = chrono::Utc::now();
        let mut stmt = self.conn.prepare(
            "SELECT id, state, created_at, updated_at, duration_secs
             FROM sessions",
        )?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, i64>(4)? as u64,
                ))
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;

        for (session_id, state_raw, created_raw, updated_raw, current_duration) in rows {
            let state = SessionState::from_db_value(&state_raw);
            let created_at = chrono::DateTime::parse_from_rfc3339(&created_raw)
                .unwrap_or_default()
                .with_timezone(&chrono::Utc);
            let updated_at = chrono::DateTime::parse_from_rfc3339(&updated_raw)
                .unwrap_or_default()
                .with_timezone(&chrono::Utc);
            let effective_end = match state {
                SessionState::Pending
                | SessionState::Running
                | SessionState::Idle
                | SessionState::Stale => now,
                SessionState::Completed | SessionState::Failed | SessionState::Stopped => {
                    updated_at
                }
            };
            let duration_secs = effective_end
                .signed_duration_since(created_at)
                .num_seconds()
                .max(0) as u64;

            if duration_secs != current_duration {
                self.conn.execute(
                    "UPDATE sessions SET duration_secs = ?1 WHERE id = ?2",
                    rusqlite::params![duration_secs as i64, session_id],
                )?;
            }
        }

        self.refresh_session_board_meta()?;
        Ok(())
    }

    pub fn touch_heartbeat(&self, session_id: &str) -> Result<()> {
        let now = chrono::Utc::now().to_rfc3339();
        let updated = self.conn.execute(
            "UPDATE sessions SET last_heartbeat_at = ?1 WHERE id = ?2",
            rusqlite::params![now, session_id],
        )?;

        if updated == 0 {
            anyhow::bail!("Session not found: {session_id}");
        }

        Ok(())
    }

    pub fn sync_cost_tracker_metrics(&self, metrics_path: &Path) -> Result<()> {
        if !metrics_path.exists() {
            return Ok(());
        }

        #[derive(Default)]
        struct UsageAggregate {
            input_tokens: u64,
            output_tokens: u64,
            cost_usd: f64,
        }

        #[derive(serde::Deserialize)]
        struct CostTrackerRow {
            session_id: String,
            #[serde(default)]
            input_tokens: u64,
            #[serde(default)]
            output_tokens: u64,
            #[serde(default)]
            estimated_cost_usd: f64,
        }

        let file = File::open(metrics_path)
            .with_context(|| format!("Failed to open {}", metrics_path.display()))?;
        let reader = BufReader::new(file);
        let mut aggregates: HashMap<String, UsageAggregate> = HashMap::new();

        for line in reader.lines() {
            let line = line?;
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }

            let Ok(row) = serde_json::from_str::<CostTrackerRow>(trimmed) else {
                continue;
            };
            if row.session_id.trim().is_empty() {
                continue;
            }

            let aggregate = aggregates.entry(row.session_id).or_default();
            aggregate.input_tokens = aggregate.input_tokens.saturating_add(row.input_tokens);
            aggregate.output_tokens = aggregate.output_tokens.saturating_add(row.output_tokens);
            aggregate.cost_usd += row.estimated_cost_usd;
        }

        for (session_id, aggregate) in aggregates {
            self.conn.execute(
                "UPDATE sessions
                 SET input_tokens = ?1,
                     output_tokens = ?2,
                     tokens_used = ?3,
                     cost_usd = ?4
                 WHERE id = ?5",
                rusqlite::params![
                    aggregate.input_tokens as i64,
                    aggregate.output_tokens as i64,
                    aggregate
                        .input_tokens
                        .saturating_add(aggregate.output_tokens) as i64,
                    aggregate.cost_usd,
                    session_id,
                ],
            )?;
        }

        self.refresh_session_board_meta()?;
        Ok(())
    }

    pub fn sync_tool_activity_metrics(&self, metrics_path: &Path) -> Result<()> {
        if !metrics_path.exists() {
            return Ok(());
        }

        #[derive(Default)]
        struct ActivityAggregate {
            tool_calls: u64,
            file_paths: HashSet<String>,
        }

        #[derive(serde::Deserialize)]
        struct ToolActivityRow {
            id: String,
            session_id: String,
            tool_name: String,
            #[serde(default)]
            input_summary: String,
            #[serde(default = "default_input_params_json")]
            input_params_json: String,
            #[serde(default)]
            output_summary: String,
            #[serde(default)]
            duration_ms: u64,
            #[serde(default)]
            file_paths: Vec<String>,
            #[serde(default)]
            file_events: Vec<ToolActivityFileEvent>,
            #[serde(default)]
            timestamp: String,
        }

        #[derive(serde::Deserialize)]
        struct ToolActivityFileEvent {
            path: String,
            action: String,
            #[serde(default)]
            diff_preview: Option<String>,
            #[serde(default)]
            patch_preview: Option<String>,
        }

        let file = File::open(metrics_path)
            .with_context(|| format!("Failed to open {}", metrics_path.display()))?;
        let reader = BufReader::new(file);
        let mut aggregates: HashMap<String, ActivityAggregate> = HashMap::new();
        let mut seen_event_ids = HashSet::new();
        let session_tasks = self
            .list_sessions()?
            .into_iter()
            .map(|session| (session.id, session.task))
            .collect::<HashMap<_, _>>();

        for line in reader.lines() {
            let line = line?;
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }

            let Ok(row) = serde_json::from_str::<ToolActivityRow>(trimmed) else {
                continue;
            };
            if row.id.trim().is_empty()
                || row.session_id.trim().is_empty()
                || row.tool_name.trim().is_empty()
            {
                continue;
            }
            if !seen_event_ids.insert(row.id.clone()) {
                continue;
            }

            let file_paths: Vec<String> = row
                .file_paths
                .into_iter()
                .map(|path| path.trim().to_string())
                .filter(|path| !path.is_empty())
                .collect();
            let file_events: Vec<PersistedFileEvent> = if row.file_events.is_empty() {
                file_paths
                    .iter()
                    .cloned()
                    .map(|path| PersistedFileEvent {
                        path,
                        action: infer_file_activity_action(&row.tool_name),
                        diff_preview: None,
                        patch_preview: None,
                    })
                    .collect()
            } else {
                row.file_events
                    .into_iter()
                    .filter_map(|event| {
                        let path = event.path.trim().to_string();
                        if path.is_empty() {
                            return None;
                        }
                        Some(PersistedFileEvent {
                            path,
                            action: parse_file_activity_action(&event.action)
                                .unwrap_or_else(|| infer_file_activity_action(&row.tool_name)),
                            diff_preview: normalize_optional_string(event.diff_preview),
                            patch_preview: normalize_optional_string(event.patch_preview),
                        })
                    })
                    .collect()
            };
            let file_paths_json =
                serde_json::to_string(&file_paths).unwrap_or_else(|_| "[]".to_string());
            let file_events_json =
                serde_json::to_string(&file_events).unwrap_or_else(|_| "[]".to_string());
            let timestamp = if row.timestamp.trim().is_empty() {
                chrono::Utc::now().to_rfc3339()
            } else {
                row.timestamp
            };
            let risk_score = ToolCallEvent::compute_risk(
                &row.tool_name,
                &row.input_summary,
                &Config::RISK_THRESHOLDS,
            )
            .score;
            let session_id = row.session_id.clone();
            let trigger_summary = session_tasks.get(&session_id).cloned().unwrap_or_default();

            self.conn.execute(
                "INSERT OR IGNORE INTO tool_log (
                    hook_event_id,
                    session_id,
                    tool_name,
                    input_summary,
                    input_params_json,
                    output_summary,
                    trigger_summary,
                    duration_ms,
                    risk_score,
                    timestamp,
                    file_paths_json,
                    file_events_json
                 )
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
                rusqlite::params![
                    row.id,
                    row.session_id,
                    row.tool_name,
                    row.input_summary,
                    row.input_params_json,
                    row.output_summary,
                    trigger_summary,
                    row.duration_ms as i64,
                    risk_score,
                    timestamp,
                    file_paths_json,
                    file_events_json,
                ],
            )?;

            let aggregate = aggregates.entry(session_id).or_default();
            aggregate.tool_calls = aggregate.tool_calls.saturating_add(1);
            for file_path in file_paths {
                aggregate.file_paths.insert(file_path);
            }
            for event in &file_events {
                self.sync_context_graph_file_event(&row.session_id, &row.tool_name, event)?;
            }
        }

        for session in self.list_sessions()? {
            let mut metrics = session.metrics.clone();
            let aggregate = aggregates.get(&session.id);
            metrics.tool_calls = aggregate.map(|item| item.tool_calls).unwrap_or(0);
            metrics.files_changed = aggregate
                .map(|item| item.file_paths.len().min(u32::MAX as usize) as u32)
                .unwrap_or(0);
            self.update_metrics(&session.id, &metrics)?;
        }

        Ok(())
    }

    fn sync_context_graph_decision(
        &self,
        session_id: &str,
        decision: &str,
        alternatives: &[String],
        reasoning: &str,
    ) -> Result<()> {
        let session_entity = self.sync_context_graph_session(session_id)?;
        let mut metadata = BTreeMap::new();
        metadata.insert(
            "alternatives_count".to_string(),
            alternatives.len().to_string(),
        );
        if !alternatives.is_empty() {
            metadata.insert("alternatives".to_string(), alternatives.join(" | "));
        }
        let decision_entity = self.upsert_context_entity(
            Some(session_id),
            "decision",
            decision,
            None,
            reasoning,
            &metadata,
        )?;
        let relation_summary = format!("{} recorded this decision", session_entity.name);
        self.upsert_context_relation(
            Some(session_id),
            session_entity.id,
            decision_entity.id,
            "decided",
            &relation_summary,
        )?;
        Ok(())
    }

    fn sync_context_graph_file_event(
        &self,
        session_id: &str,
        tool_name: &str,
        event: &PersistedFileEvent,
    ) -> Result<()> {
        let session_entity = self.sync_context_graph_session(session_id)?;
        let mut metadata = BTreeMap::new();
        metadata.insert(
            "last_action".to_string(),
            file_activity_action_value(&event.action).to_string(),
        );
        metadata.insert("last_tool".to_string(), tool_name.trim().to_string());
        if let Some(diff_preview) = &event.diff_preview {
            metadata.insert("diff_preview".to_string(), diff_preview.clone());
        }

        let action = file_activity_action_value(&event.action);
        let tool_name = tool_name.trim();
        let summary = if let Some(diff_preview) = &event.diff_preview {
            format!("Last activity: {action} via {tool_name} | {diff_preview}")
        } else {
            format!("Last activity: {action} via {tool_name}")
        };
        let name = context_graph_file_name(&event.path);
        let file_entity = self.upsert_context_entity(
            Some(session_id),
            "file",
            &name,
            Some(&event.path),
            &summary,
            &metadata,
        )?;
        self.upsert_context_relation(
            Some(session_id),
            session_entity.id,
            file_entity.id,
            action,
            &summary,
        )?;
        Ok(())
    }

    fn sync_context_graph_session(&self, session_id: &str) -> Result<ContextGraphEntity> {
        let session = self.get_session(session_id)?;
        let mut metadata = BTreeMap::new();
        let persisted_session_id = if session.is_some() {
            Some(session_id)
        } else {
            None
        };
        let summary = if let Some(session) = session {
            metadata.insert("task".to_string(), session.task.clone());
            metadata.insert("project".to_string(), session.project.clone());
            metadata.insert("task_group".to_string(), session.task_group.clone());
            metadata.insert("agent_type".to_string(), session.agent_type.clone());
            metadata.insert("state".to_string(), session.state.to_string());
            metadata.insert(
                "working_dir".to_string(),
                session.working_dir.display().to_string(),
            );
            if let Some(pid) = session.pid {
                metadata.insert("pid".to_string(), pid.to_string());
            }
            if let Some(worktree) = &session.worktree {
                metadata.insert(
                    "worktree_path".to_string(),
                    worktree.path.display().to_string(),
                );
                metadata.insert("worktree_branch".to_string(), worktree.branch.clone());
                metadata.insert("base_branch".to_string(), worktree.base_branch.clone());
            }

            format!(
                "{} | {} | {} / {}",
                session.state, session.agent_type, session.project, session.task_group
            )
        } else {
            metadata.insert("state".to_string(), "unknown".to_string());
            "session placeholder".to_string()
        };
        self.upsert_context_entity(
            persisted_session_id,
            "session",
            session_id,
            None,
            &summary,
            &metadata,
        )
    }

    fn sync_context_graph_message(
        &self,
        from_session_id: &str,
        to_session_id: &str,
        content: &str,
        msg_type: &str,
    ) -> Result<()> {
        let relation_session_id = self
            .get_session(from_session_id)?
            .map(|session| session.id)
            .filter(|id| !id.is_empty());
        let from_entity = self.sync_context_graph_session(from_session_id)?;
        let to_entity = self.sync_context_graph_session(to_session_id)?;

        let relation_type = match msg_type {
            "task_handoff" => "delegates_to",
            "query" => "queries",
            "response" => "responds_to",
            "completed" => "completed_for",
            "conflict" => "conflicts_with",
            other => other,
        };
        let summary = crate::comms::preview(msg_type, content);

        self.upsert_context_relation(
            relation_session_id.as_deref(),
            from_entity.id,
            to_entity.id,
            relation_type,
            &summary,
        )?;

        Ok(())
    }

    pub fn increment_tool_calls(&self, session_id: &str) -> Result<()> {
        self.conn.execute(
            "UPDATE sessions
             SET tool_calls = tool_calls + 1,
                 updated_at = ?1,
                 last_heartbeat_at = ?1
             WHERE id = ?2",
            rusqlite::params![chrono::Utc::now().to_rfc3339(), session_id],
        )?;
        self.refresh_session_board_meta()?;
        Ok(())
    }

    pub fn list_sessions(&self) -> Result<Vec<Session>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, task, project, task_group, agent_type, working_dir, state, pid, worktree_path, worktree_branch, worktree_base,
                    input_tokens, output_tokens, tokens_used, tool_calls, files_changed, duration_secs, cost_usd,
                    created_at, updated_at, last_heartbeat_at
             FROM sessions ORDER BY updated_at DESC",
        )?;

        let sessions = stmt
            .query_map([], |row| {
                let state_str: String = row.get(6)?;
                let state = SessionState::from_db_value(&state_str);

                let working_dir = PathBuf::from(row.get::<_, String>(5)?);
                let project = row
                    .get::<_, String>(2)
                    .ok()
                    .and_then(|value| normalize_group_label(&value))
                    .unwrap_or_else(|| default_project_label(&working_dir));
                let task: String = row.get(1)?;
                let task_group = row
                    .get::<_, String>(3)
                    .ok()
                    .and_then(|value| normalize_group_label(&value))
                    .unwrap_or_else(|| default_task_group_label(&task));

                let worktree_path: Option<String> = row.get(8)?;
                let worktree = worktree_path.map(|path| super::WorktreeInfo {
                    path: PathBuf::from(path),
                    branch: row.get::<_, String>(9).unwrap_or_default(),
                    base_branch: row.get::<_, String>(10).unwrap_or_default(),
                });

                let created_str: String = row.get(18)?;
                let updated_str: String = row.get(19)?;
                let heartbeat_str: String = row.get(20)?;

                Ok(Session {
                    id: row.get(0)?,
                    task,
                    project,
                    task_group,
                    agent_type: row.get(4)?,
                    working_dir,
                    state,
                    pid: row.get::<_, Option<u32>>(7)?,
                    worktree,
                    created_at: chrono::DateTime::parse_from_rfc3339(&created_str)
                        .unwrap_or_default()
                        .with_timezone(&chrono::Utc),
                    updated_at: chrono::DateTime::parse_from_rfc3339(&updated_str)
                        .unwrap_or_default()
                        .with_timezone(&chrono::Utc),
                    last_heartbeat_at: chrono::DateTime::parse_from_rfc3339(&heartbeat_str)
                        .unwrap_or_else(|_| {
                            chrono::DateTime::parse_from_rfc3339(&updated_str).unwrap_or_default()
                        })
                        .with_timezone(&chrono::Utc),
                    metrics: SessionMetrics {
                        input_tokens: row.get::<_, i64>(11)? as u64,
                        output_tokens: row.get::<_, i64>(12)? as u64,
                        tokens_used: row.get::<_, i64>(13)? as u64,
                        tool_calls: row.get::<_, i64>(14)? as u64,
                        files_changed: row.get(15)?,
                        duration_secs: row.get::<_, i64>(16)? as u64,
                        cost_usd: row.get(17)?,
                    },
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(sessions)
    }

    pub fn list_session_harnesses(&self) -> Result<HashMap<String, SessionHarnessInfo>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, harness, detected_harnesses_json, agent_type, working_dir FROM sessions",
        )?;

        let harnesses = stmt
            .query_map([], |row| {
                let session_id: String = row.get(0)?;
                let harness_label: String = row.get(1)?;
                let detected = serde_json::from_str::<Vec<HarnessKind>>(&row.get::<_, String>(2)?)
                    .unwrap_or_default();
                let agent_type: String = row.get(3)?;
                let working_dir = PathBuf::from(row.get::<_, String>(4)?);
                let info = SessionHarnessInfo::from_persisted(
                    &harness_label,
                    &agent_type,
                    &working_dir,
                    detected,
                );
                Ok((session_id, info))
            })?
            .collect::<std::result::Result<HashMap<_, _>, _>>()?;

        Ok(harnesses)
    }

    pub fn list_session_board_meta(&self) -> Result<HashMap<String, SessionBoardMeta>> {
        let mut stmt = self.conn.prepare(
            "SELECT session_id, lane, project, feature, issue, row_label,
                    previous_lane, previous_row_label,
                    column_index, row_index, stack_index, progress_percent,
                    status_detail, movement_note, activity_kind, activity_note,
                    handoff_backlog, conflict_signal
             FROM session_board",
        )?;

        let meta = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    SessionBoardMeta {
                        lane: row.get(1)?,
                        project: row.get(2)?,
                        feature: row.get(3)?,
                        issue: row.get(4)?,
                        row_label: row.get(5)?,
                        previous_lane: row.get(6)?,
                        previous_row_label: row.get(7)?,
                        column_index: row.get(8)?,
                        row_index: row.get(9)?,
                        stack_index: row.get(10)?,
                        progress_percent: row.get(11)?,
                        status_detail: row.get(12)?,
                        movement_note: row.get(13)?,
                        activity_kind: row.get(14)?,
                        activity_note: row.get(15)?,
                        handoff_backlog: row.get(16)?,
                        conflict_signal: row.get(17)?,
                    },
                ))
            })?
            .collect::<Result<HashMap<_, _>, _>>()?;

        Ok(meta)
    }

    pub fn get_session_harness_info(&self, session_id: &str) -> Result<Option<SessionHarnessInfo>> {
        let mut stmt = self.conn.prepare(
            "SELECT harness, detected_harnesses_json, agent_type, working_dir
             FROM sessions
             WHERE id = ?1",
        )?;

        stmt.query_row([session_id], |row| {
            let harness_label: String = row.get(0)?;
            let detected = serde_json::from_str::<Vec<HarnessKind>>(&row.get::<_, String>(1)?)
                .unwrap_or_default();
            let agent_type: String = row.get(2)?;
            let working_dir = PathBuf::from(row.get::<_, String>(3)?);
            let info = SessionHarnessInfo::from_persisted(
                &harness_label,
                &agent_type,
                &working_dir,
                detected,
            );
            Ok(info)
        })
        .optional()
        .map_err(Into::into)
    }

    pub fn get_latest_session(&self) -> Result<Option<Session>> {
        Ok(self.list_sessions()?.into_iter().next())
    }

    fn refresh_session_board_meta(&self) -> Result<()> {
        self.conn.execute(
            "DELETE FROM session_board
             WHERE session_id NOT IN (SELECT id FROM sessions)",
            [],
        )?;

        let existing_meta = self.list_session_board_meta().unwrap_or_default();
        let sessions = self.list_sessions()?;
        let board_meta = derive_board_meta_map(&sessions);
        let now = chrono::Utc::now().to_rfc3339();

        for session in sessions {
            let mut meta = board_meta
                .get(&session.id)
                .cloned()
                .unwrap_or_else(|| SessionBoardMeta {
                    lane: board_lane_for_state(&session.state).to_string(),
                    ..SessionBoardMeta::default()
                });
            if let Some(previous) = existing_meta.get(&session.id) {
                annotate_board_motion(&mut meta, previous);
            }
            if let Some((activity_kind, activity_note)) =
                self.latest_task_handoff_activity(&session.id)?
            {
                meta.activity_kind = Some(activity_kind);
                meta.activity_note = Some(activity_note);
            } else {
                meta.activity_kind = None;
                meta.activity_note = None;
            }
            meta.handoff_backlog = self.unread_task_handoff_count(&session.id)? as i64;

            self.conn.execute(
                "INSERT INTO session_board (
                    session_id, lane, project, feature, issue, row_label,
                    previous_lane, previous_row_label,
                    column_index, row_index, stack_index, progress_percent,
                    status_detail, movement_note, activity_kind, activity_note,
                    handoff_backlog, conflict_signal, updated_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)
                 ON CONFLICT(session_id) DO UPDATE SET
                    lane = excluded.lane,
                    project = excluded.project,
                    feature = excluded.feature,
                    issue = excluded.issue,
                    row_label = excluded.row_label,
                    previous_lane = excluded.previous_lane,
                    previous_row_label = excluded.previous_row_label,
                    column_index = excluded.column_index,
                    row_index = excluded.row_index,
                    stack_index = excluded.stack_index,
                    progress_percent = excluded.progress_percent,
                    status_detail = excluded.status_detail,
                    movement_note = excluded.movement_note,
                    activity_kind = excluded.activity_kind,
                    activity_note = excluded.activity_note,
                    handoff_backlog = excluded.handoff_backlog,
                    conflict_signal = excluded.conflict_signal,
                    updated_at = excluded.updated_at",
                rusqlite::params![
                    session.id,
                    meta.lane,
                    meta.project,
                    meta.feature,
                    meta.issue,
                    meta.row_label,
                    meta.previous_lane,
                    meta.previous_row_label,
                    meta.column_index,
                    meta.row_index,
                    meta.stack_index,
                    meta.progress_percent,
                    meta.status_detail,
                    meta.movement_note,
                    meta.activity_kind,
                    meta.activity_note,
                    meta.handoff_backlog,
                    meta.conflict_signal,
                    now,
                ],
            )?;
        }

        Ok(())
    }

    pub fn get_session(&self, id: &str) -> Result<Option<Session>> {
        let sessions = self.list_sessions()?;
        Ok(sessions
            .into_iter()
            .find(|session| session.id == id || session.id.starts_with(id)))
    }

    pub fn delete_session(&self, session_id: &str) -> Result<()> {
        self.conn.execute(
            "DELETE FROM session_output WHERE session_id = ?1",
            rusqlite::params![session_id],
        )?;
        self.conn.execute(
            "DELETE FROM tool_log WHERE session_id = ?1",
            rusqlite::params![session_id],
        )?;
        self.conn.execute(
            "DELETE FROM messages WHERE from_session = ?1 OR to_session = ?1",
            rusqlite::params![session_id],
        )?;

        let deleted = self.conn.execute(
            "DELETE FROM sessions WHERE id = ?1",
            rusqlite::params![session_id],
        )?;

        if deleted == 0 {
            anyhow::bail!("Session not found: {session_id}");
        }

        self.refresh_session_board_meta()?;
        Ok(())
    }

    pub fn send_message(&self, from: &str, to: &str, content: &str, msg_type: &str) -> Result<()> {
        self.conn.execute(
            "INSERT INTO messages (from_session, to_session, content, msg_type, timestamp)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![from, to, content, msg_type, chrono::Utc::now().to_rfc3339()],
        )?;
        self.sync_context_graph_message(from, to, content, msg_type)?;
        self.refresh_session_board_meta()?;
        Ok(())
    }

    fn list_messages_sent_by_session(
        &self,
        session_id: &str,
        limit: usize,
    ) -> Result<Vec<SessionMessage>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, from_session, to_session, content, msg_type, read, timestamp
             FROM messages
             WHERE from_session = ?1
             ORDER BY id DESC
             LIMIT ?2",
        )?;

        let mut messages = stmt
            .query_map(rusqlite::params![session_id, limit as i64], |row| {
                let timestamp: String = row.get(6)?;

                Ok(SessionMessage {
                    id: row.get(0)?,
                    from_session: row.get(1)?,
                    to_session: row.get(2)?,
                    content: row.get(3)?,
                    msg_type: row.get(4)?,
                    read: row.get::<_, i64>(5)? != 0,
                    timestamp: chrono::DateTime::parse_from_rfc3339(&timestamp)
                        .unwrap_or_default()
                        .with_timezone(&chrono::Utc),
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        messages.reverse();
        Ok(messages)
    }

    pub fn list_messages_for_session(
        &self,
        session_id: &str,
        limit: usize,
    ) -> Result<Vec<SessionMessage>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, from_session, to_session, content, msg_type, read, timestamp
             FROM messages
             WHERE from_session = ?1 OR to_session = ?1
             ORDER BY id DESC
             LIMIT ?2",
        )?;

        let mut messages = stmt
            .query_map(rusqlite::params![session_id, limit as i64], |row| {
                let timestamp: String = row.get(6)?;

                Ok(SessionMessage {
                    id: row.get(0)?,
                    from_session: row.get(1)?,
                    to_session: row.get(2)?,
                    content: row.get(3)?,
                    msg_type: row.get(4)?,
                    read: row.get::<_, i64>(5)? != 0,
                    timestamp: chrono::DateTime::parse_from_rfc3339(&timestamp)
                        .unwrap_or_default()
                        .with_timezone(&chrono::Utc),
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        messages.reverse();
        Ok(messages)
    }

    pub fn unread_message_counts(&self) -> Result<HashMap<String, usize>> {
        let mut stmt = self.conn.prepare(
            "SELECT to_session, COUNT(*)
             FROM messages
             WHERE read = 0
             GROUP BY to_session",
        )?;

        let counts = stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)? as usize))
            })?
            .collect::<Result<HashMap<_, _>, _>>()?;

        Ok(counts)
    }

    pub fn unread_approval_counts(&self) -> Result<HashMap<String, usize>> {
        let mut stmt = self.conn.prepare(
            "SELECT to_session, COUNT(*)
             FROM messages
             WHERE read = 0 AND msg_type IN ('query', 'conflict')
             GROUP BY to_session",
        )?;

        let counts = stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)? as usize))
            })?
            .collect::<Result<HashMap<_, _>, _>>()?;

        Ok(counts)
    }

    pub fn unread_approval_queue(&self, limit: usize) -> Result<Vec<SessionMessage>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, from_session, to_session, content, msg_type, read, timestamp
             FROM messages
             WHERE read = 0 AND msg_type IN ('query', 'conflict')
             ORDER BY id ASC
             LIMIT ?1",
        )?;

        let messages = stmt.query_map(rusqlite::params![limit as i64], |row| {
            let timestamp: String = row.get(6)?;

            Ok(SessionMessage {
                id: row.get(0)?,
                from_session: row.get(1)?,
                to_session: row.get(2)?,
                content: row.get(3)?,
                msg_type: row.get(4)?,
                read: row.get::<_, i64>(5)? != 0,
                timestamp: chrono::DateTime::parse_from_rfc3339(&timestamp)
                    .unwrap_or_default()
                    .with_timezone(&chrono::Utc),
            })
        })?;

        messages.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    pub fn latest_unread_approval_message(&self) -> Result<Option<SessionMessage>> {
        self.conn
            .query_row(
                "SELECT id, from_session, to_session, content, msg_type, read, timestamp
                 FROM messages
                 WHERE read = 0 AND msg_type IN ('query', 'conflict')
                 ORDER BY id DESC
                 LIMIT 1",
                [],
                |row| {
                    let timestamp: String = row.get(6)?;

                    Ok(SessionMessage {
                        id: row.get(0)?,
                        from_session: row.get(1)?,
                        to_session: row.get(2)?,
                        content: row.get(3)?,
                        msg_type: row.get(4)?,
                        read: row.get::<_, i64>(5)? != 0,
                        timestamp: chrono::DateTime::parse_from_rfc3339(&timestamp)
                            .unwrap_or_default()
                            .with_timezone(&chrono::Utc),
                    })
                },
            )
            .optional()
            .map_err(Into::into)
    }

    pub fn unread_task_handoffs_for_session(
        &self,
        session_id: &str,
        limit: usize,
    ) -> Result<Vec<SessionMessage>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, from_session, to_session, content, msg_type, read, timestamp
             FROM messages
             WHERE to_session = ?1 AND msg_type = 'task_handoff' AND read = 0
             ORDER BY id ASC",
        )?;

        let messages = stmt.query_map(rusqlite::params![session_id], |row| {
            let timestamp: String = row.get(6)?;

            Ok(SessionMessage {
                id: row.get(0)?,
                from_session: row.get(1)?,
                to_session: row.get(2)?,
                content: row.get(3)?,
                msg_type: row.get(4)?,
                read: row.get::<_, i64>(5)? != 0,
                timestamp: chrono::DateTime::parse_from_rfc3339(&timestamp)
                    .unwrap_or_default()
                    .with_timezone(&chrono::Utc),
            })
        })?;

        let mut messages = messages.collect::<Result<Vec<_>, _>>()?;
        messages.sort_by(|left, right| {
            let left_priority = comms::handoff_priority(&left.content);
            let right_priority = comms::handoff_priority(&right.content);
            Reverse(left_priority)
                .cmp(&Reverse(right_priority))
                .then_with(|| left.id.cmp(&right.id))
        });
        messages.truncate(limit);
        Ok(messages)
    }

    pub fn unread_task_handoff_count(&self, session_id: &str) -> Result<usize> {
        self.conn
            .query_row(
                "SELECT COUNT(*)
                 FROM messages
                 WHERE to_session = ?1 AND msg_type = 'task_handoff' AND read = 0",
                rusqlite::params![session_id],
                |row| row.get::<_, i64>(0),
            )
            .map(|count| count as usize)
            .map_err(Into::into)
    }

    pub fn unread_task_handoff_targets(&self, limit: usize) -> Result<Vec<(String, usize)>> {
        let mut stmt = self.conn.prepare(
            "SELECT to_session, content, id
             FROM messages
             WHERE msg_type = 'task_handoff' AND read = 0
             ORDER BY id ASC",
        )?;

        let targets = stmt.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
            ))
        })?;
        let mut aggregated: HashMap<String, (usize, comms::TaskPriority, i64)> = HashMap::new();
        for (to_session, content, id) in targets.collect::<Result<Vec<_>, _>>()? {
            let priority = comms::handoff_priority(&content);
            aggregated
                .entry(to_session)
                .and_modify(|entry| {
                    entry.0 += 1;
                    if priority > entry.1 {
                        entry.1 = priority;
                    }
                    if id < entry.2 {
                        entry.2 = id;
                    }
                })
                .or_insert((1, priority, id));
        }

        let mut targets = aggregated.into_iter().collect::<Vec<_>>();
        targets.sort_by(|(left_session, left), (right_session, right)| {
            Reverse(left.1)
                .cmp(&Reverse(right.1))
                .then_with(|| Reverse(left.0).cmp(&Reverse(right.0)))
                .then_with(|| left.2.cmp(&right.2))
                .then_with(|| left_session.cmp(right_session))
        });
        targets.truncate(limit);
        Ok(targets
            .into_iter()
            .map(|(session_id, (count, _, _))| (session_id, count))
            .collect())
    }

    pub fn mark_messages_read(&self, session_id: &str) -> Result<usize> {
        let updated = self.conn.execute(
            "UPDATE messages SET read = 1 WHERE to_session = ?1 AND read = 0",
            rusqlite::params![session_id],
        )?;

        self.refresh_session_board_meta()?;
        Ok(updated)
    }

    pub fn mark_message_read(&self, message_id: i64) -> Result<usize> {
        let updated = self.conn.execute(
            "UPDATE messages SET read = 1 WHERE id = ?1 AND read = 0",
            rusqlite::params![message_id],
        )?;

        self.refresh_session_board_meta()?;
        Ok(updated)
    }

    pub fn latest_task_handoff_source(&self, session_id: &str) -> Result<Option<String>> {
        self.conn
            .query_row(
                "SELECT from_session
                 FROM messages
                 WHERE to_session = ?1 AND msg_type = 'task_handoff'
                 ORDER BY id DESC
                 LIMIT 1",
                rusqlite::params![session_id],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(Into::into)
    }

    fn latest_task_handoff_activity(
        &self,
        session_id: &str,
    ) -> Result<Option<(String, String)>> {
        let latest_handoff = self
            .conn
            .query_row(
                "SELECT from_session, to_session, content
                 FROM messages
                 WHERE msg_type = 'task_handoff'
                   AND (from_session = ?1 OR to_session = ?1)
                 ORDER BY id DESC
                 LIMIT 1",
                rusqlite::params![session_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                    ))
                },
            )
            .optional()?;

        Ok(latest_handoff.and_then(|(from_session, to_session, content)| {
            let context = extract_task_handoff_context(&content)?;
            let routing_suffix = routing_activity_suffix(&context);

            if session_id == to_session {
                Some((
                    "received".to_string(),
                    format!(
                        "Received from {}{}",
                        short_session_ref(&from_session),
                        routing_suffix
                            .map(|value| format!(" | {value}"))
                            .unwrap_or_default()
                    ),
                ))
            } else if session_id == from_session {
                let (kind, base) = match routing_suffix {
                    Some("spawned") => {
                        ("spawned", format!("Spawned {}", short_session_ref(&to_session)))
                    }
                    Some("spawned fallback") => (
                        "spawned_fallback",
                        format!("Spawned fallback {}", short_session_ref(&to_session)),
                    ),
                    _ => (
                        "delegated",
                        format!("Delegated to {}", short_session_ref(&to_session)),
                    ),
                };
                Some((
                    kind.to_string(),
                    format!(
                        "{base}{}",
                        routing_suffix
                            .filter(|value| !value.starts_with("spawned"))
                            .map(|value| format!(" | {value}"))
                            .unwrap_or_default()
                    ),
                ))
            } else {
                None
            }
        }))
    }

    pub fn insert_decision(
        &self,
        session_id: &str,
        decision: &str,
        alternatives: &[String],
        reasoning: &str,
    ) -> Result<DecisionLogEntry> {
        let timestamp = chrono::Utc::now();
        let alternatives_json = serde_json::to_string(alternatives)
            .context("Failed to serialize decision alternatives")?;

        self.conn.execute(
            "INSERT INTO decision_log (session_id, decision, alternatives_json, reasoning, timestamp)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![
                session_id,
                decision,
                alternatives_json,
                reasoning,
                timestamp.to_rfc3339(),
            ],
        )?;

        self.sync_context_graph_decision(session_id, decision, alternatives, reasoning)?;

        Ok(DecisionLogEntry {
            id: self.conn.last_insert_rowid(),
            session_id: session_id.to_string(),
            decision: decision.to_string(),
            alternatives: alternatives.to_vec(),
            reasoning: reasoning.to_string(),
            timestamp,
        })
    }

    pub fn list_decisions_for_session(
        &self,
        session_id: &str,
        limit: usize,
    ) -> Result<Vec<DecisionLogEntry>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, session_id, decision, alternatives_json, reasoning, timestamp
             FROM (
                 SELECT id, session_id, decision, alternatives_json, reasoning, timestamp
                 FROM decision_log
                 WHERE session_id = ?1
                 ORDER BY timestamp DESC, id DESC
                 LIMIT ?2
             )
             ORDER BY timestamp ASC, id ASC",
        )?;

        let entries = stmt
            .query_map(rusqlite::params![session_id, limit as i64], |row| {
                map_decision_log_entry(row)
            })?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(entries)
    }

    pub fn list_decisions(&self, limit: usize) -> Result<Vec<DecisionLogEntry>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, session_id, decision, alternatives_json, reasoning, timestamp
             FROM (
                 SELECT id, session_id, decision, alternatives_json, reasoning, timestamp
                 FROM decision_log
                 ORDER BY timestamp DESC, id DESC
                 LIMIT ?1
             )
             ORDER BY timestamp ASC, id ASC",
        )?;

        let entries = stmt
            .query_map(rusqlite::params![limit as i64], map_decision_log_entry)?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(entries)
    }

    pub fn sync_context_graph_history(
        &self,
        session_id: Option<&str>,
        per_session_limit: usize,
    ) -> Result<ContextGraphSyncStats> {
        let sessions = if let Some(session_id) = session_id {
            let session = self
                .get_session(session_id)?
                .ok_or_else(|| anyhow::anyhow!("Session not found: {session_id}"))?;
            vec![session]
        } else {
            self.list_sessions()?
        };

        let mut stats = ContextGraphSyncStats::default();
        for session in sessions {
            stats.sessions_scanned = stats.sessions_scanned.saturating_add(1);

            for entry in self.list_decisions_for_session(&session.id, per_session_limit)? {
                self.sync_context_graph_decision(
                    &session.id,
                    &entry.decision,
                    &entry.alternatives,
                    &entry.reasoning,
                )?;
                stats.decisions_processed = stats.decisions_processed.saturating_add(1);
            }

            for entry in self.list_file_activity(&session.id, per_session_limit)? {
                let persisted = PersistedFileEvent {
                    path: entry.path.clone(),
                    action: entry.action.clone(),
                    diff_preview: entry.diff_preview.clone(),
                    patch_preview: entry.patch_preview.clone(),
                };
                self.sync_context_graph_file_event(&session.id, "history", &persisted)?;
                stats.file_events_processed = stats.file_events_processed.saturating_add(1);
            }

            for message in self.list_messages_sent_by_session(&session.id, per_session_limit)? {
                self.sync_context_graph_message(
                    &message.from_session,
                    &message.to_session,
                    &message.content,
                    &message.msg_type,
                )?;
                stats.messages_processed = stats.messages_processed.saturating_add(1);
            }
        }

        Ok(stats)
    }

    pub fn upsert_context_entity(
        &self,
        session_id: Option<&str>,
        entity_type: &str,
        name: &str,
        path: Option<&str>,
        summary: &str,
        metadata: &BTreeMap<String, String>,
    ) -> Result<ContextGraphEntity> {
        let entity_type = entity_type.trim();
        if entity_type.is_empty() {
            return Err(anyhow::anyhow!("Context graph entity type cannot be empty"));
        }
        let name = name.trim();
        if name.is_empty() {
            return Err(anyhow::anyhow!("Context graph entity name cannot be empty"));
        }

        let normalized_path = path.map(str::trim).filter(|value| !value.is_empty());
        let summary = summary.trim();
        let entity_key = context_graph_entity_key(entity_type, name, normalized_path);
        let metadata_json = serde_json::to_string(metadata)
            .context("Failed to serialize context graph metadata")?;
        let timestamp = chrono::Utc::now().to_rfc3339();

        self.conn.execute(
            "INSERT INTO context_graph_entities (
                session_id, entity_key, entity_type, name, path, summary, metadata_json, created_at, updated_at
             )
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)
             ON CONFLICT(entity_key) DO UPDATE SET
                session_id = COALESCE(excluded.session_id, context_graph_entities.session_id),
                summary = CASE
                    WHEN excluded.summary <> '' THEN excluded.summary
                    ELSE context_graph_entities.summary
                END,
                metadata_json = excluded.metadata_json,
                updated_at = excluded.updated_at",
            rusqlite::params![
                session_id,
                entity_key,
                entity_type,
                name,
                normalized_path,
                summary,
                metadata_json,
                timestamp,
            ],
        )?;

        self.conn
            .query_row(
                "SELECT id, session_id, entity_type, name, path, summary, metadata_json, created_at, updated_at
                 FROM context_graph_entities
                 WHERE entity_key = ?1",
                rusqlite::params![entity_key],
                map_context_graph_entity,
            )
            .map_err(Into::into)
    }

    pub fn list_context_entities(
        &self,
        session_id: Option<&str>,
        entity_type: Option<&str>,
        limit: usize,
    ) -> Result<Vec<ContextGraphEntity>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, session_id, entity_type, name, path, summary, metadata_json, created_at, updated_at
             FROM context_graph_entities
             WHERE (?1 IS NULL OR session_id = ?1)
               AND (?2 IS NULL OR entity_type = ?2)
             ORDER BY updated_at DESC, id DESC
             LIMIT ?3",
        )?;

        let entries = stmt
            .query_map(
                rusqlite::params![session_id, entity_type, limit as i64],
                map_context_graph_entity,
            )?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(entries)
    }

    pub fn recall_context_entities(
        &self,
        session_id: Option<&str>,
        query: &str,
        limit: usize,
    ) -> Result<Vec<ContextGraphRecallEntry>> {
        if limit == 0 {
            return Ok(Vec::new());
        }

        let terms = context_graph_recall_terms(query);
        if terms.is_empty() {
            return Ok(Vec::new());
        }

        let candidate_limit = (limit.saturating_mul(12)).clamp(24, 512);
        let mut stmt = self.conn.prepare(
            "SELECT e.id, e.session_id, e.entity_type, e.name, e.path, e.summary, e.metadata_json,
                    e.created_at, e.updated_at,
                    (
                        SELECT COUNT(*)
                        FROM context_graph_relations r
                        WHERE r.from_entity_id = e.id OR r.to_entity_id = e.id
                    ) AS relation_count,
                    COALESCE((
                        SELECT group_concat(summary, ' ')
                        FROM (
                            SELECT summary
                            FROM context_graph_observations o
                            WHERE o.entity_id = e.id
                            ORDER BY o.created_at DESC, o.id DESC
                            LIMIT 4
                        )
                    ), '') AS observation_text,
                    (
                        SELECT COUNT(*)
                        FROM context_graph_observations o
                        WHERE o.entity_id = e.id
                    ) AS observation_count
                    ,
                    COALESCE((
                        SELECT MAX(priority)
                        FROM context_graph_observations o
                        WHERE o.entity_id = e.id
                    ), 1) AS max_observation_priority,
                    COALESCE((
                        SELECT MAX(pinned)
                        FROM context_graph_observations o
                        WHERE o.entity_id = e.id
                    ), 0) AS has_pinned_observation
             FROM context_graph_entities e
             WHERE (?1 IS NULL OR e.session_id = ?1)
             ORDER BY e.updated_at DESC, e.id DESC
             LIMIT ?2",
        )?;

        let candidates = stmt
            .query_map(
                rusqlite::params![session_id, candidate_limit as i64],
                |row| {
                    let entity = map_context_graph_entity(row)?;
                    let relation_count = row.get::<_, i64>(9)?.max(0) as usize;
                    let observation_text = row.get::<_, String>(10)?;
                    let observation_count = row.get::<_, i64>(11)?.max(0) as usize;
                    let max_observation_priority =
                        ContextObservationPriority::from_db_value(row.get::<_, i64>(12)?);
                    let has_pinned_observation = row.get::<_, i64>(13)? != 0;
                    Ok((
                        entity,
                        relation_count,
                        observation_text,
                        observation_count,
                        max_observation_priority,
                        has_pinned_observation,
                    ))
                },
            )?
            .collect::<Result<Vec<_>, _>>()?;

        let now = chrono::Utc::now();
        let mut entries = candidates
            .into_iter()
            .filter_map(
                |(
                    entity,
                    relation_count,
                    observation_text,
                    observation_count,
                    max_observation_priority,
                    has_pinned_observation,
                )| {
                    let matched_terms =
                        context_graph_matched_terms(&entity, &observation_text, &terms);
                    if matched_terms.is_empty() {
                        return None;
                    }

                    Some(ContextGraphRecallEntry {
                        score: context_graph_recall_score(
                            matched_terms.len(),
                            relation_count,
                            observation_count,
                            max_observation_priority,
                            has_pinned_observation,
                            entity.updated_at,
                            now,
                        ),
                        entity,
                        matched_terms,
                        relation_count,
                        observation_count,
                        max_observation_priority,
                        has_pinned_observation,
                    })
                },
            )
            .collect::<Vec<_>>();

        entries.sort_by(|left, right| {
            right
                .score
                .cmp(&left.score)
                .then_with(|| right.entity.updated_at.cmp(&left.entity.updated_at))
                .then_with(|| right.entity.id.cmp(&left.entity.id))
        });
        entries.truncate(limit);

        Ok(entries)
    }

    pub fn get_context_entity_detail(
        &self,
        entity_id: i64,
        relation_limit: usize,
    ) -> Result<Option<ContextGraphEntityDetail>> {
        let entity = self
            .conn
            .query_row(
                "SELECT id, session_id, entity_type, name, path, summary, metadata_json, created_at, updated_at
                 FROM context_graph_entities
                 WHERE id = ?1",
                rusqlite::params![entity_id],
                map_context_graph_entity,
            )
            .optional()?;

        let Some(entity) = entity else {
            return Ok(None);
        };

        let mut outgoing_stmt = self.conn.prepare(
            "SELECT r.id, r.session_id,
                    r.from_entity_id, src.entity_type, src.name,
                    r.to_entity_id, dst.entity_type, dst.name,
                    r.relation_type, r.summary, r.created_at
             FROM context_graph_relations r
             JOIN context_graph_entities src ON src.id = r.from_entity_id
             JOIN context_graph_entities dst ON dst.id = r.to_entity_id
             WHERE r.from_entity_id = ?1
             ORDER BY r.created_at DESC, r.id DESC
             LIMIT ?2",
        )?;
        let outgoing = outgoing_stmt
            .query_map(
                rusqlite::params![entity_id, relation_limit as i64],
                map_context_graph_relation,
            )?
            .collect::<Result<Vec<_>, _>>()?;

        let mut incoming_stmt = self.conn.prepare(
            "SELECT r.id, r.session_id,
                    r.from_entity_id, src.entity_type, src.name,
                    r.to_entity_id, dst.entity_type, dst.name,
                    r.relation_type, r.summary, r.created_at
             FROM context_graph_relations r
             JOIN context_graph_entities src ON src.id = r.from_entity_id
             JOIN context_graph_entities dst ON dst.id = r.to_entity_id
             WHERE r.to_entity_id = ?1
             ORDER BY r.created_at DESC, r.id DESC
             LIMIT ?2",
        )?;
        let incoming = incoming_stmt
            .query_map(
                rusqlite::params![entity_id, relation_limit as i64],
                map_context_graph_relation,
            )?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(Some(ContextGraphEntityDetail {
            entity,
            outgoing,
            incoming,
        }))
    }

    pub fn add_context_observation(
        &self,
        session_id: Option<&str>,
        entity_id: i64,
        observation_type: &str,
        priority: ContextObservationPriority,
        pinned: bool,
        summary: &str,
        details: &BTreeMap<String, String>,
    ) -> Result<ContextGraphObservation> {
        if observation_type.trim().is_empty() {
            return Err(anyhow::anyhow!(
                "Context graph observation type cannot be empty"
            ));
        }
        if summary.trim().is_empty() {
            return Err(anyhow::anyhow!(
                "Context graph observation summary cannot be empty"
            ));
        }

        let now = chrono::Utc::now().to_rfc3339();
        let details_json = serde_json::to_string(details)?;
        self.conn.execute(
            "INSERT INTO context_graph_observations (
                session_id, entity_id, observation_type, priority, pinned, summary, details_json, created_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            rusqlite::params![
                session_id,
                entity_id,
                observation_type.trim(),
                priority.as_db_value(),
                pinned as i64,
                summary.trim(),
                details_json,
                now,
            ],
        )?;
        let observation_id = self.conn.last_insert_rowid();
        self.compact_context_graph_observations(
            None,
            Some(entity_id),
            DEFAULT_CONTEXT_GRAPH_OBSERVATION_RETENTION,
        )?;
        self.conn
            .query_row(
                "SELECT o.id, o.session_id, o.entity_id, e.entity_type, e.name,
                        o.observation_type, o.priority, o.pinned, o.summary, o.details_json, o.created_at
                 FROM context_graph_observations o
                 JOIN context_graph_entities e ON e.id = o.entity_id
                 WHERE o.id = ?1",
                rusqlite::params![observation_id],
                map_context_graph_observation,
            )
            .map_err(Into::into)
    }

    pub fn set_context_observation_pinned(
        &self,
        observation_id: i64,
        pinned: bool,
    ) -> Result<Option<ContextGraphObservation>> {
        let changed = self.conn.execute(
            "UPDATE context_graph_observations
             SET pinned = ?2
             WHERE id = ?1",
            rusqlite::params![observation_id, pinned as i64],
        )?;
        if changed == 0 {
            return Ok(None);
        }
        self.conn
            .query_row(
                "SELECT o.id, o.session_id, o.entity_id, e.entity_type, e.name,
                        o.observation_type, o.priority, o.pinned, o.summary, o.details_json, o.created_at
                 FROM context_graph_observations o
                 JOIN context_graph_entities e ON e.id = o.entity_id
                 WHERE o.id = ?1",
                rusqlite::params![observation_id],
                map_context_graph_observation,
            )
            .optional()
            .map_err(Into::into)
    }

    pub fn compact_context_graph(
        &self,
        session_id: Option<&str>,
        keep_observations_per_entity: usize,
    ) -> Result<ContextGraphCompactionStats> {
        self.compact_context_graph_observations(session_id, None, keep_observations_per_entity)
    }

    pub fn add_session_observation(
        &self,
        session_id: &str,
        observation_type: &str,
        priority: ContextObservationPriority,
        pinned: bool,
        summary: &str,
        details: &BTreeMap<String, String>,
    ) -> Result<ContextGraphObservation> {
        let session_entity = self.sync_context_graph_session(session_id)?;
        self.add_context_observation(
            Some(session_id),
            session_entity.id,
            observation_type,
            priority,
            pinned,
            summary,
            details,
        )
    }

    pub fn list_context_observations(
        &self,
        entity_id: Option<i64>,
        limit: usize,
    ) -> Result<Vec<ContextGraphObservation>> {
        let mut stmt = self.conn.prepare(
            "SELECT o.id, o.session_id, o.entity_id, e.entity_type, e.name,
                    o.observation_type, o.priority, o.pinned, o.summary, o.details_json, o.created_at
             FROM context_graph_observations o
             JOIN context_graph_entities e ON e.id = o.entity_id
             WHERE (?1 IS NULL OR o.entity_id = ?1)
             ORDER BY o.pinned DESC, o.created_at DESC, o.id DESC
             LIMIT ?2",
        )?;

        let entries = stmt
            .query_map(
                rusqlite::params![entity_id, limit as i64],
                map_context_graph_observation,
            )?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(entries)
    }

    pub fn connector_source_is_unchanged(
        &self,
        connector_name: &str,
        source_path: &str,
        source_signature: &str,
    ) -> Result<bool> {
        let stored_signature = self
            .conn
            .query_row(
                "SELECT source_signature
                 FROM context_graph_connector_checkpoints
                 WHERE connector_name = ?1 AND source_path = ?2",
                rusqlite::params![connector_name, source_path],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        Ok(stored_signature
            .as_deref()
            .is_some_and(|stored| stored == source_signature))
    }

    pub fn upsert_connector_source_checkpoint(
        &self,
        connector_name: &str,
        source_path: &str,
        source_signature: &str,
    ) -> Result<()> {
        let now = chrono::Utc::now().to_rfc3339();
        self.conn.execute(
            "INSERT INTO context_graph_connector_checkpoints (
                connector_name, source_path, source_signature, updated_at
             ) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(connector_name, source_path)
             DO UPDATE SET source_signature = excluded.source_signature,
                           updated_at = excluded.updated_at",
            rusqlite::params![connector_name, source_path, source_signature, now],
        )?;
        Ok(())
    }

    pub fn connector_checkpoint_summary(
        &self,
        connector_name: &str,
    ) -> Result<ConnectorCheckpointSummary> {
        self.conn
            .query_row(
                "SELECT COUNT(*), MAX(updated_at)
             FROM context_graph_connector_checkpoints
             WHERE connector_name = ?1",
                rusqlite::params![connector_name],
                |row| {
                    let synced_sources = row.get::<_, i64>(0)? as usize;
                    let last_synced_at = row
                        .get::<_, Option<String>>(1)?
                        .map(|raw| parse_store_timestamp(raw, 1))
                        .transpose()?;
                    Ok(ConnectorCheckpointSummary {
                        connector_name: connector_name.to_string(),
                        synced_sources,
                        last_synced_at,
                    })
                },
            )
            .map_err(Into::into)
    }

    fn compact_context_graph_observations(
        &self,
        session_id: Option<&str>,
        entity_id: Option<i64>,
        keep_observations_per_entity: usize,
    ) -> Result<ContextGraphCompactionStats> {
        let entities_scanned = self.conn.query_row(
            "SELECT COUNT(DISTINCT o.entity_id)
             FROM context_graph_observations o
             JOIN context_graph_entities e ON e.id = o.entity_id
             WHERE (?1 IS NULL OR e.session_id = ?1)
               AND (?2 IS NULL OR o.entity_id = ?2)",
            rusqlite::params![session_id, entity_id],
            |row| row.get::<_, i64>(0),
        )? as usize;

        let duplicate_observations_deleted = self.conn.execute(
            "DELETE FROM context_graph_observations
             WHERE id IN (
                 SELECT id
                 FROM (
                     SELECT o.id,
                            ROW_NUMBER() OVER (
                                PARTITION BY o.entity_id, o.observation_type, o.summary
                                ORDER BY o.pinned DESC, o.created_at DESC, o.id DESC
                            ) AS rn
                     FROM context_graph_observations o
                     JOIN context_graph_entities e ON e.id = o.entity_id
                     WHERE (?1 IS NULL OR e.session_id = ?1)
                       AND (?2 IS NULL OR o.entity_id = ?2)
                 ) ranked
                 WHERE ranked.rn > 1
             )",
            rusqlite::params![session_id, entity_id],
        )?;

        let overflow_observations_deleted = if keep_observations_per_entity == 0 {
            self.conn.execute(
                "DELETE FROM context_graph_observations
                 WHERE id IN (
                     SELECT o.id
                     FROM context_graph_observations o
                     JOIN context_graph_entities e ON e.id = o.entity_id
                     WHERE (?1 IS NULL OR e.session_id = ?1)
                       AND (?2 IS NULL OR o.entity_id = ?2)
                       AND o.pinned = 0
                 )",
                rusqlite::params![session_id, entity_id],
            )?
        } else {
            self.conn.execute(
                "DELETE FROM context_graph_observations
                 WHERE id IN (
                     SELECT id
                     FROM (
                         SELECT o.id,
                                ROW_NUMBER() OVER (
                                    PARTITION BY o.entity_id
                                    ORDER BY o.created_at DESC, o.id DESC
                                ) AS rn
                         FROM context_graph_observations o
                         JOIN context_graph_entities e ON e.id = o.entity_id
                         WHERE (?1 IS NULL OR e.session_id = ?1)
                           AND (?2 IS NULL OR o.entity_id = ?2)
                           AND o.pinned = 0
                     ) ranked
                     WHERE ranked.rn > ?3
                 )",
                rusqlite::params![session_id, entity_id, keep_observations_per_entity as i64],
            )?
        };

        let observations_retained = self.conn.query_row(
            "SELECT COUNT(*)
             FROM context_graph_observations o
             JOIN context_graph_entities e ON e.id = o.entity_id
             WHERE (?1 IS NULL OR e.session_id = ?1)
               AND (?2 IS NULL OR o.entity_id = ?2)",
            rusqlite::params![session_id, entity_id],
            |row| row.get::<_, i64>(0),
        )? as usize;

        Ok(ContextGraphCompactionStats {
            entities_scanned,
            duplicate_observations_deleted,
            overflow_observations_deleted,
            observations_retained,
        })
    }

    pub fn upsert_context_relation(
        &self,
        session_id: Option<&str>,
        from_entity_id: i64,
        to_entity_id: i64,
        relation_type: &str,
        summary: &str,
    ) -> Result<ContextGraphRelation> {
        let relation_type = relation_type.trim();
        if relation_type.is_empty() {
            return Err(anyhow::anyhow!(
                "Context graph relation type cannot be empty"
            ));
        }
        let summary = summary.trim();
        let timestamp = chrono::Utc::now().to_rfc3339();

        self.conn.execute(
            "INSERT INTO context_graph_relations (
                session_id, from_entity_id, to_entity_id, relation_type, summary, created_at
             )
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(from_entity_id, to_entity_id, relation_type) DO UPDATE SET
                session_id = COALESCE(excluded.session_id, context_graph_relations.session_id),
                summary = CASE
                    WHEN excluded.summary <> '' THEN excluded.summary
                    ELSE context_graph_relations.summary
                END",
            rusqlite::params![
                session_id,
                from_entity_id,
                to_entity_id,
                relation_type,
                summary,
                timestamp,
            ],
        )?;

        self.conn
            .query_row(
                "SELECT r.id, r.session_id,
                        r.from_entity_id, src.entity_type, src.name,
                        r.to_entity_id, dst.entity_type, dst.name,
                        r.relation_type, r.summary, r.created_at
                 FROM context_graph_relations r
                 JOIN context_graph_entities src ON src.id = r.from_entity_id
                 JOIN context_graph_entities dst ON dst.id = r.to_entity_id
                 WHERE r.from_entity_id = ?1
                   AND r.to_entity_id = ?2
                   AND r.relation_type = ?3",
                rusqlite::params![from_entity_id, to_entity_id, relation_type],
                map_context_graph_relation,
            )
            .map_err(Into::into)
    }

    pub fn list_context_relations(
        &self,
        entity_id: Option<i64>,
        limit: usize,
    ) -> Result<Vec<ContextGraphRelation>> {
        let mut stmt = self.conn.prepare(
            "SELECT r.id, r.session_id,
                    r.from_entity_id, src.entity_type, src.name,
                    r.to_entity_id, dst.entity_type, dst.name,
                    r.relation_type, r.summary, r.created_at
             FROM context_graph_relations r
             JOIN context_graph_entities src ON src.id = r.from_entity_id
             JOIN context_graph_entities dst ON dst.id = r.to_entity_id
             WHERE (?1 IS NULL OR r.from_entity_id = ?1 OR r.to_entity_id = ?1)
             ORDER BY r.created_at DESC, r.id DESC
             LIMIT ?2",
        )?;

        let relations = stmt
            .query_map(
                rusqlite::params![entity_id, limit as i64],
                map_context_graph_relation,
            )?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(relations)
    }

    pub fn daemon_activity(&self) -> Result<DaemonActivity> {
        self.conn
            .query_row(
                "SELECT last_dispatch_at, last_dispatch_routed, last_dispatch_deferred, last_dispatch_leads,
                        chronic_saturation_streak,
                        last_recovery_dispatch_at, last_recovery_dispatch_routed, last_recovery_dispatch_leads,
                        last_rebalance_at, last_rebalance_rerouted, last_rebalance_leads,
                        last_auto_merge_at, last_auto_merge_merged, last_auto_merge_active_skipped,
                        last_auto_merge_conflicted_skipped, last_auto_merge_dirty_skipped,
                        last_auto_merge_failed, last_auto_prune_at, last_auto_prune_pruned,
                        last_auto_prune_active_skipped
                 FROM daemon_activity
                 WHERE id = 1",
                [],
                |row| {
                    let parse_ts =
                        |value: Option<String>| -> rusqlite::Result<Option<chrono::DateTime<chrono::Utc>>> {
                            value
                                .map(|raw| {
                                    chrono::DateTime::parse_from_rfc3339(&raw)
                                        .map(|ts| ts.with_timezone(&chrono::Utc))
                                        .map_err(|err| {
                                            rusqlite::Error::FromSqlConversionFailure(
                                                0,
                                                rusqlite::types::Type::Text,
                                                Box::new(err),
                                            )
                                        })
                                })
                                .transpose()
                        };

                    Ok(DaemonActivity {
                        last_dispatch_at: parse_ts(row.get(0)?)?,
                        last_dispatch_routed: row.get::<_, i64>(1)? as usize,
                        last_dispatch_deferred: row.get::<_, i64>(2)? as usize,
                        last_dispatch_leads: row.get::<_, i64>(3)? as usize,
                        chronic_saturation_streak: row.get::<_, i64>(4)? as usize,
                        last_recovery_dispatch_at: parse_ts(row.get(5)?)?,
                        last_recovery_dispatch_routed: row.get::<_, i64>(6)? as usize,
                        last_recovery_dispatch_leads: row.get::<_, i64>(7)? as usize,
                        last_rebalance_at: parse_ts(row.get(8)?)?,
                        last_rebalance_rerouted: row.get::<_, i64>(9)? as usize,
                        last_rebalance_leads: row.get::<_, i64>(10)? as usize,
                        last_auto_merge_at: parse_ts(row.get(11)?)?,
                        last_auto_merge_merged: row.get::<_, i64>(12)? as usize,
                        last_auto_merge_active_skipped: row.get::<_, i64>(13)? as usize,
                        last_auto_merge_conflicted_skipped: row.get::<_, i64>(14)? as usize,
                        last_auto_merge_dirty_skipped: row.get::<_, i64>(15)? as usize,
                        last_auto_merge_failed: row.get::<_, i64>(16)? as usize,
                        last_auto_prune_at: parse_ts(row.get(17)?)?,
                        last_auto_prune_pruned: row.get::<_, i64>(18)? as usize,
                        last_auto_prune_active_skipped: row.get::<_, i64>(19)? as usize,
                    })
                },
            )
            .map_err(Into::into)
    }

    pub fn record_daemon_dispatch_pass(
        &self,
        routed: usize,
        deferred: usize,
        leads: usize,
    ) -> Result<()> {
        self.conn.execute(
            "UPDATE daemon_activity
             SET last_dispatch_at = ?1,
                 last_dispatch_routed = ?2,
                 last_dispatch_deferred = ?3,
                 last_dispatch_leads = ?4,
                 chronic_saturation_streak = CASE
                    WHEN ?3 > 0 THEN chronic_saturation_streak + 1
                    ELSE 0
                 END
             WHERE id = 1",
            rusqlite::params![
                chrono::Utc::now().to_rfc3339(),
                routed as i64,
                deferred as i64,
                leads as i64
            ],
        )?;

        Ok(())
    }

    pub fn record_daemon_recovery_dispatch_pass(&self, routed: usize, leads: usize) -> Result<()> {
        self.conn.execute(
            "UPDATE daemon_activity
             SET last_recovery_dispatch_at = ?1,
                 last_recovery_dispatch_routed = ?2,
                 last_recovery_dispatch_leads = ?3,
                 chronic_saturation_streak = 0
             WHERE id = 1",
            rusqlite::params![chrono::Utc::now().to_rfc3339(), routed as i64, leads as i64],
        )?;

        Ok(())
    }

    pub fn record_daemon_rebalance_pass(&self, rerouted: usize, leads: usize) -> Result<()> {
        self.conn.execute(
            "UPDATE daemon_activity
             SET last_rebalance_at = ?1,
                 last_rebalance_rerouted = ?2,
                 last_rebalance_leads = ?3
             WHERE id = 1",
            rusqlite::params![
                chrono::Utc::now().to_rfc3339(),
                rerouted as i64,
                leads as i64
            ],
        )?;

        Ok(())
    }

    pub fn record_daemon_auto_merge_pass(
        &self,
        merged: usize,
        active_skipped: usize,
        conflicted_skipped: usize,
        dirty_skipped: usize,
        failed: usize,
    ) -> Result<()> {
        self.conn.execute(
            "UPDATE daemon_activity
             SET last_auto_merge_at = ?1,
                 last_auto_merge_merged = ?2,
                 last_auto_merge_active_skipped = ?3,
                 last_auto_merge_conflicted_skipped = ?4,
                 last_auto_merge_dirty_skipped = ?5,
                 last_auto_merge_failed = ?6
             WHERE id = 1",
            rusqlite::params![
                chrono::Utc::now().to_rfc3339(),
                merged as i64,
                active_skipped as i64,
                conflicted_skipped as i64,
                dirty_skipped as i64,
                failed as i64,
            ],
        )?;

        Ok(())
    }

    pub fn record_daemon_auto_prune_pass(
        &self,
        pruned: usize,
        active_skipped: usize,
    ) -> Result<()> {
        self.conn.execute(
            "UPDATE daemon_activity
             SET last_auto_prune_at = ?1,
                 last_auto_prune_pruned = ?2,
                 last_auto_prune_active_skipped = ?3
             WHERE id = 1",
            rusqlite::params![
                chrono::Utc::now().to_rfc3339(),
                pruned as i64,
                active_skipped as i64,
            ],
        )?;

        Ok(())
    }

    pub fn delegated_children(&self, session_id: &str, limit: usize) -> Result<Vec<String>> {
        let mut stmt = self.conn.prepare(
            "SELECT to_session
             FROM messages
             WHERE from_session = ?1 AND msg_type = 'task_handoff'
             GROUP BY to_session
             ORDER BY MAX(id) DESC
             LIMIT ?2",
        )?;

        let children = stmt
            .query_map(rusqlite::params![session_id, limit as i64], |row| {
                row.get::<_, String>(0)
            })?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(children)
    }

    pub fn append_output_line(
        &self,
        session_id: &str,
        stream: OutputStream,
        line: &str,
    ) -> Result<()> {
        let now = chrono::Utc::now().to_rfc3339();

        self.conn.execute(
            "INSERT INTO session_output (session_id, stream, line, timestamp)
             VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![session_id, stream.as_str(), line, now],
        )?;

        self.conn.execute(
            "DELETE FROM session_output
             WHERE session_id = ?1
               AND id NOT IN (
                   SELECT id
                   FROM session_output
                   WHERE session_id = ?1
                   ORDER BY id DESC
                   LIMIT ?2
               )",
            rusqlite::params![session_id, OUTPUT_BUFFER_LIMIT as i64],
        )?;

        self.conn.execute(
            "UPDATE sessions
             SET updated_at = ?1,
                 last_heartbeat_at = ?1
             WHERE id = ?2",
            rusqlite::params![chrono::Utc::now().to_rfc3339(), session_id],
        )?;

        Ok(())
    }

    pub fn get_output_lines(&self, session_id: &str, limit: usize) -> Result<Vec<OutputLine>> {
        let mut stmt = self.conn.prepare(
            "SELECT stream, line, timestamp
             FROM (
                 SELECT id, stream, line, timestamp
                 FROM session_output
                 WHERE session_id = ?1
                 ORDER BY id DESC
                 LIMIT ?2
             )
             ORDER BY id ASC",
        )?;

        let lines = stmt
            .query_map(rusqlite::params![session_id, limit as i64], |row| {
                let stream: String = row.get(0)?;
                let text: String = row.get(1)?;
                let timestamp: String = row.get(2)?;

                Ok(OutputLine::new(
                    OutputStream::from_db_value(&stream),
                    text,
                    timestamp,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(lines)
    }

    pub fn insert_tool_log(
        &self,
        session_id: &str,
        tool_name: &str,
        input_summary: &str,
        input_params_json: &str,
        output_summary: &str,
        trigger_summary: &str,
        duration_ms: u64,
        risk_score: f64,
        timestamp: &str,
    ) -> Result<ToolLogEntry> {
        self.conn.execute(
            "INSERT INTO tool_log (session_id, tool_name, input_summary, input_params_json, output_summary, trigger_summary, duration_ms, risk_score, timestamp)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            rusqlite::params![
                session_id,
                tool_name,
                input_summary,
                input_params_json,
                output_summary,
                trigger_summary,
                duration_ms as i64,
                risk_score,
                timestamp,
            ],
        )?;

        Ok(ToolLogEntry {
            id: self.conn.last_insert_rowid(),
            session_id: session_id.to_string(),
            tool_name: tool_name.to_string(),
            input_summary: input_summary.to_string(),
            input_params_json: input_params_json.to_string(),
            output_summary: output_summary.to_string(),
            trigger_summary: trigger_summary.to_string(),
            duration_ms,
            risk_score,
            timestamp: timestamp.to_string(),
        })
    }

    pub fn query_tool_logs(
        &self,
        session_id: &str,
        page: u64,
        page_size: u64,
    ) -> Result<ToolLogPage> {
        let page = page.max(1);
        let offset = (page - 1) * page_size;

        let total = self.conn.query_row(
            "SELECT COUNT(*) FROM tool_log WHERE session_id = ?1",
            rusqlite::params![session_id],
            |row| row.get::<_, i64>(0),
        )? as u64;

        let mut stmt = self.conn.prepare(
            "SELECT id, session_id, tool_name, input_summary, input_params_json, output_summary, trigger_summary, duration_ms, risk_score, timestamp
             FROM tool_log
             WHERE session_id = ?1
             ORDER BY timestamp DESC, id DESC
             LIMIT ?2 OFFSET ?3",
        )?;

        let entries = stmt
            .query_map(
                rusqlite::params![session_id, page_size as i64, offset as i64],
                |row| {
                Ok(ToolLogEntry {
                    id: row.get(0)?,
                    session_id: row.get(1)?,
                    tool_name: row.get(2)?,
                    input_summary: row.get::<_, Option<String>>(3)?.unwrap_or_default(),
                    input_params_json: row
                        .get::<_, Option<String>>(4)?
                        .unwrap_or_else(|| "{}".to_string()),
                    output_summary: row.get::<_, Option<String>>(5)?.unwrap_or_default(),
                    trigger_summary: row.get::<_, Option<String>>(6)?.unwrap_or_default(),
                    duration_ms: row.get::<_, Option<i64>>(7)?.unwrap_or_default() as u64,
                    risk_score: row.get::<_, Option<f64>>(8)?.unwrap_or_default(),
                    timestamp: row.get(9)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(ToolLogPage {
            entries,
            page,
            page_size,
            total,
        })
    }

    pub fn list_tool_logs_for_session(&self, session_id: &str) -> Result<Vec<ToolLogEntry>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, session_id, tool_name, input_summary, input_params_json, output_summary, trigger_summary, duration_ms, risk_score, timestamp
             FROM tool_log
             WHERE session_id = ?1
             ORDER BY timestamp ASC, id ASC",
        )?;

        let entries = stmt
            .query_map(rusqlite::params![session_id], |row| {
                Ok(ToolLogEntry {
                    id: row.get(0)?,
                    session_id: row.get(1)?,
                    tool_name: row.get(2)?,
                    input_summary: row.get::<_, Option<String>>(3)?.unwrap_or_default(),
                    input_params_json: row
                        .get::<_, Option<String>>(4)?
                        .unwrap_or_else(|| "{}".to_string()),
                    output_summary: row.get::<_, Option<String>>(5)?.unwrap_or_default(),
                    trigger_summary: row.get::<_, Option<String>>(6)?.unwrap_or_default(),
                    duration_ms: row.get::<_, Option<i64>>(7)?.unwrap_or_default() as u64,
                    risk_score: row.get::<_, Option<f64>>(8)?.unwrap_or_default(),
                    timestamp: row.get(9)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(entries)
    }

    pub fn list_file_activity(
        &self,
        session_id: &str,
        limit: usize,
    ) -> Result<Vec<FileActivityEntry>> {
        let mut stmt = self.conn.prepare(
            "SELECT session_id, tool_name, input_summary, output_summary, timestamp, file_events_json, file_paths_json
             FROM tool_log
             WHERE session_id = ?1
               AND (
                    (file_events_json IS NOT NULL AND file_events_json != '[]')
                    OR (file_paths_json IS NOT NULL AND file_paths_json != '[]')
               )
             ORDER BY timestamp DESC, id DESC",
        )?;

        let rows = stmt
            .query_map(rusqlite::params![session_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                    row.get::<_, Option<String>>(3)?.unwrap_or_default(),
                    row.get::<_, String>(4)?,
                    row.get::<_, Option<String>>(5)?
                        .unwrap_or_else(|| "[]".to_string()),
                    row.get::<_, Option<String>>(6)?
                        .unwrap_or_else(|| "[]".to_string()),
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;

        let mut events = Vec::new();
        for (
            session_id,
            tool_name,
            input_summary,
            output_summary,
            timestamp,
            file_events_json,
            file_paths_json,
        ) in rows
        {
            let occurred_at = chrono::DateTime::parse_from_rfc3339(&timestamp)
                .unwrap_or_default()
                .with_timezone(&chrono::Utc);
            let summary = if output_summary.trim().is_empty() {
                input_summary
            } else {
                output_summary
            };

            let persisted = parse_persisted_file_events(&file_events_json).unwrap_or_else(|| {
                serde_json::from_str::<Vec<String>>(&file_paths_json)
                    .unwrap_or_default()
                    .into_iter()
                    .filter_map(|path| {
                        let path = path.trim().to_string();
                        if path.is_empty() {
                            return None;
                        }
                        Some(PersistedFileEvent {
                            path,
                            action: infer_file_activity_action(&tool_name),
                            diff_preview: None,
                            patch_preview: None,
                        })
                    })
                    .collect()
            });

            for event in persisted {
                events.push(FileActivityEntry {
                    session_id: session_id.clone(),
                    action: event.action,
                    path: event.path,
                    summary: summary.clone(),
                    diff_preview: event.diff_preview,
                    patch_preview: event.patch_preview,
                    timestamp: occurred_at,
                });
                if events.len() >= limit {
                    return Ok(events);
                }
            }
        }

        Ok(events)
    }

    pub fn list_file_overlaps(
        &self,
        session_id: &str,
        limit: usize,
    ) -> Result<Vec<FileActivityOverlap>> {
        if limit == 0 {
            return Ok(Vec::new());
        }

        let current_activity = self.list_file_activity(session_id, 64)?;
        if current_activity.is_empty() {
            return Ok(Vec::new());
        }

        let mut current_by_path = HashMap::new();
        for entry in current_activity {
            current_by_path.entry(entry.path.clone()).or_insert(entry);
        }

        let mut overlaps = Vec::new();
        let mut seen = HashSet::new();

        for session in self.list_sessions()? {
            if session.id == session_id || !session_state_supports_overlap(&session.state) {
                continue;
            }

            for entry in self.list_file_activity(&session.id, 32)? {
                let Some(current) = current_by_path.get(&entry.path) else {
                    continue;
                };
                if !file_overlap_is_relevant(current, &entry) {
                    continue;
                }
                if !seen.insert((session.id.clone(), entry.path.clone())) {
                    continue;
                }

                overlaps.push(FileActivityOverlap {
                    path: entry.path.clone(),
                    current_action: current.action.clone(),
                    other_action: entry.action.clone(),
                    other_session_id: session.id.clone(),
                    other_session_state: session.state.clone(),
                    timestamp: entry.timestamp,
                });
            }
        }

        overlaps.sort_by_key(|entry| {
            (
                overlap_state_priority(&entry.other_session_state),
                Reverse(entry.timestamp),
                entry.other_session_id.clone(),
                entry.path.clone(),
            )
        });
        overlaps.truncate(limit);
        Ok(overlaps)
    }

    pub fn has_open_conflict_incident(&self, conflict_key: &str) -> Result<bool> {
        let exists = self
            .conn
            .query_row(
                "SELECT 1
                 FROM conflict_incidents
                 WHERE conflict_key = ?1 AND resolved_at IS NULL
                 LIMIT 1",
                rusqlite::params![conflict_key],
                |_| Ok(()),
            )
            .optional()?
            .is_some();
        Ok(exists)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn upsert_conflict_incident(
        &self,
        conflict_key: &str,
        path: &str,
        first_session_id: &str,
        second_session_id: &str,
        active_session_id: &str,
        paused_session_id: &str,
        first_action: &FileActivityAction,
        second_action: &FileActivityAction,
        strategy: &str,
        summary: &str,
    ) -> Result<ConflictIncident> {
        let now = chrono::Utc::now().to_rfc3339();
        self.conn.execute(
            "INSERT INTO conflict_incidents (
                 conflict_key, path, first_session_id, second_session_id,
                 active_session_id, paused_session_id, first_action, second_action,
                 strategy, summary, created_at, updated_at, resolved_at
             )
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11, NULL)
             ON CONFLICT(conflict_key) DO UPDATE SET
                 path = excluded.path,
                 first_session_id = excluded.first_session_id,
                 second_session_id = excluded.second_session_id,
                 active_session_id = excluded.active_session_id,
                 paused_session_id = excluded.paused_session_id,
                 first_action = excluded.first_action,
                 second_action = excluded.second_action,
                 strategy = excluded.strategy,
                 summary = excluded.summary,
                 updated_at = excluded.updated_at,
                 resolved_at = NULL",
            rusqlite::params![
                conflict_key,
                path,
                first_session_id,
                second_session_id,
                active_session_id,
                paused_session_id,
                file_activity_action_value(first_action),
                file_activity_action_value(second_action),
                strategy,
                summary,
                now,
            ],
        )?;

        self.conn
            .query_row(
                "SELECT id, conflict_key, path, first_session_id, second_session_id,
                        active_session_id, paused_session_id, first_action, second_action,
                        strategy, summary, created_at, updated_at, resolved_at
                 FROM conflict_incidents
                 WHERE conflict_key = ?1",
                rusqlite::params![conflict_key],
                map_conflict_incident,
            )
            .map_err(Into::into)
    }

    pub fn resolve_conflict_incidents_not_in(
        &self,
        active_keys: &HashSet<String>,
    ) -> Result<usize> {
        let open = self.list_open_conflict_incidents(512)?;
        let now = chrono::Utc::now().to_rfc3339();
        let mut resolved = 0;

        for incident in open {
            if active_keys.contains(&incident.conflict_key) {
                continue;
            }

            resolved += self.conn.execute(
                "UPDATE conflict_incidents
                 SET resolved_at = ?2, updated_at = ?2
                 WHERE conflict_key = ?1 AND resolved_at IS NULL",
                rusqlite::params![incident.conflict_key, now],
            )?;
        }

        Ok(resolved)
    }

    pub fn list_open_conflict_incidents_for_session(
        &self,
        session_id: &str,
        limit: usize,
    ) -> Result<Vec<ConflictIncident>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, conflict_key, path, first_session_id, second_session_id,
                    active_session_id, paused_session_id, first_action, second_action,
                    strategy, summary, created_at, updated_at, resolved_at
             FROM conflict_incidents
             WHERE resolved_at IS NULL
               AND (
                   first_session_id = ?1
                   OR second_session_id = ?1
                   OR active_session_id = ?1
                   OR paused_session_id = ?1
               )
             ORDER BY updated_at DESC, id DESC
             LIMIT ?2",
        )?;

        let incidents = stmt
            .query_map(
                rusqlite::params![session_id, limit as i64],
                map_conflict_incident,
            )?
            .collect::<Result<Vec<_>, _>>()
            .map_err(anyhow::Error::from)?;
        Ok(incidents)
    }

    fn list_open_conflict_incidents(&self, limit: usize) -> Result<Vec<ConflictIncident>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, conflict_key, path, first_session_id, second_session_id,
                    active_session_id, paused_session_id, first_action, second_action,
                    strategy, summary, created_at, updated_at, resolved_at
             FROM conflict_incidents
             WHERE resolved_at IS NULL
             ORDER BY updated_at DESC, id DESC
             LIMIT ?1",
        )?;

        let incidents = stmt
            .query_map(rusqlite::params![limit as i64], map_conflict_incident)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(anyhow::Error::from)?;
        Ok(incidents)
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
struct PersistedFileEvent {
    path: String,
    action: FileActivityAction,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    diff_preview: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    patch_preview: Option<String>,
}

fn parse_persisted_file_events(value: &str) -> Option<Vec<PersistedFileEvent>> {
    let events = serde_json::from_str::<Vec<PersistedFileEvent>>(value).ok()?;
    let events: Vec<PersistedFileEvent> = events
        .into_iter()
        .filter_map(|event| {
            let path = event.path.trim().to_string();
            if path.is_empty() {
                return None;
            }
            Some(PersistedFileEvent {
                path,
                action: event.action,
                diff_preview: normalize_optional_string(event.diff_preview),
                patch_preview: normalize_optional_string(event.patch_preview),
            })
        })
        .collect();
    if events.is_empty() {
        return None;
    }
    Some(events)
}

fn file_activity_action_value(action: &FileActivityAction) -> &'static str {
    match action {
        FileActivityAction::Read => "read",
        FileActivityAction::Create => "create",
        FileActivityAction::Modify => "modify",
        FileActivityAction::Move => "move",
        FileActivityAction::Delete => "delete",
        FileActivityAction::Touch => "touch",
    }
}

fn board_lane_for_state(state: &SessionState) -> &'static str {
    match state {
        SessionState::Pending => "Inbox",
        SessionState::Running => "In Progress",
        SessionState::Idle => "Review",
        SessionState::Stale | SessionState::Failed => "Blocked",
        SessionState::Completed => "Done",
        SessionState::Stopped => "Stopped",
    }
}

fn derive_board_scope(session: &Session) -> (Option<String>, Option<String>, Option<String>) {
    let project = extract_labeled_scope(&session.task, &["project", "roadmap", "epic"]);
    let feature = extract_labeled_scope(&session.task, &["feature", "workflow", "flow"]);
    let issue = extract_issue_reference(&session.task);
    (project, feature, issue)
}

fn derive_board_meta_map(sessions: &[Session]) -> HashMap<String, SessionBoardMeta> {
    let conflict_signals = derive_board_conflict_signals(sessions);
    let scopes = sessions
        .iter()
        .map(|session| (session.id.clone(), derive_board_scope(session)))
        .collect::<HashMap<_, _>>();

    let mut row_specs = scopes
        .iter()
        .map(|(session_id, (project, feature, issue))| {
            let row_label = issue
                .clone()
                .or_else(|| feature.clone())
                .or_else(|| project.clone())
                .or_else(|| {
                    sessions
                        .iter()
                        .find(|session| &session.id == session_id)
                        .and_then(|session| session.worktree.as_ref())
                        .map(|worktree| worktree.branch.clone())
                })
                .unwrap_or_else(|| "General".to_string());

            let row_rank = if issue.is_some() {
                0
            } else if feature.is_some() {
                1
            } else if project.is_some() {
                2
            } else {
                3
            };

            (session_id.clone(), row_label, row_rank)
        })
        .collect::<Vec<_>>();

    row_specs.sort_by(|left, right| {
        left.2
            .cmp(&right.2)
            .then_with(|| left.1.to_ascii_lowercase().cmp(&right.1.to_ascii_lowercase()))
            .then_with(|| left.0.cmp(&right.0))
    });

    let mut row_indices = HashMap::new();
    let mut next_row_index = 0_i64;
    for (_, row_label, row_rank) in &row_specs {
        let key = (*row_rank, row_label.clone());
        if let std::collections::hash_map::Entry::Vacant(entry) = row_indices.entry(key) {
            entry.insert(next_row_index);
            next_row_index += 1;
        }
    }

    let mut stack_counts: HashMap<(i64, i64), i64> = HashMap::new();
    let mut board_meta = HashMap::new();

    for session in sessions {
        let (project, feature, issue) = scopes
            .get(&session.id)
            .cloned()
            .unwrap_or((None, None, None));
        let (_, row_label, row_rank) = row_specs
            .iter()
            .find(|(session_id, _, _)| session_id == &session.id)
            .cloned()
            .unwrap_or_else(|| (session.id.clone(), "General".to_string(), 4));
        let column_index = board_column_index(&session.state);
        let row_index = row_indices
            .get(&(row_rank, row_label.clone()))
            .copied()
            .unwrap_or_default();
        let stack_index = {
            let entry = stack_counts.entry((column_index, row_index)).or_insert(0);
            let current = *entry;
            *entry += 1;
            current
        };

        board_meta.insert(
            session.id.clone(),
            SessionBoardMeta {
                lane: board_lane_for_state(&session.state).to_string(),
                project,
                feature,
                issue,
                row_label: Some(row_label),
                previous_lane: None,
                previous_row_label: None,
                column_index,
                row_index,
                stack_index,
                progress_percent: derive_board_progress_percent(session),
                status_detail: derive_board_status_detail(session),
                movement_note: None,
                activity_kind: None,
                activity_note: None,
                handoff_backlog: 0,
                conflict_signal: conflict_signals.get(&session.id).cloned(),
            },
        );
    }

    board_meta
}

fn board_column_index(state: &SessionState) -> i64 {
    match state {
        SessionState::Pending => 0,
        SessionState::Running => 1,
        SessionState::Idle => 2,
        SessionState::Stale | SessionState::Failed => 3,
        SessionState::Completed => 4,
        SessionState::Stopped => 5,
    }
}

fn derive_board_progress_percent(session: &Session) -> i64 {
    match session.state {
        SessionState::Pending => 10,
        SessionState::Running => {
            if session.metrics.files_changed > 0 {
                60
            } else if session.worktree.is_some() || session.metrics.tool_calls > 0 {
                45
            } else {
                25
            }
        }
        SessionState::Idle => 85,
        SessionState::Stale => 55,
        SessionState::Completed => 100,
        SessionState::Failed => 65,
        SessionState::Stopped => 0,
    }
}

fn derive_board_status_detail(session: &Session) -> Option<String> {
    let detail = match session.state {
        SessionState::Pending => "Queued",
        SessionState::Running => {
            if session.metrics.files_changed > 0 {
                "Actively editing"
            } else if session.worktree.is_some() {
                "Scoping"
            } else {
                "Booting"
            }
        }
        SessionState::Idle => "Awaiting review",
        SessionState::Stale => "Needs heartbeat",
        SessionState::Completed => "Task complete",
        SessionState::Failed => "Blocked by failure",
        SessionState::Stopped => "Stopped",
    };

    Some(detail.to_string())
}

fn annotate_board_motion(current: &mut SessionBoardMeta, previous: &SessionBoardMeta) {
    if previous.lane != current.lane {
        current.previous_lane = Some(previous.lane.clone());
        current.previous_row_label = previous.row_label.clone();
        current.movement_note = Some(match current.lane.as_str() {
            "Blocked" => "Blocked".to_string(),
            "Done" => "Completed".to_string(),
            _ => format!("Moved {} -> {}", previous.lane, current.lane),
        });
        return;
    }

    if previous.row_label != current.row_label {
        let from = previous
            .row_label
            .clone()
            .unwrap_or_else(|| "General".to_string());
        let to = current
            .row_label
            .clone()
            .unwrap_or_else(|| "General".to_string());
        current.previous_lane = Some(previous.lane.clone());
        current.previous_row_label = previous.row_label.clone();
        current.movement_note = Some(format!("Retargeted {from} -> {to}"));
    }
}

fn extract_labeled_scope(task: &str, labels: &[&str]) -> Option<String> {
    let lowered = task.to_ascii_lowercase();

    for label in labels {
        if let Some(index) = lowered.find(label) {
            let mut tail = task.get(index + label.len()..)?.trim_start_matches([' ', ':', '-', '#']);
            if tail.is_empty() {
                continue;
            }

            if let Some((candidate, _)) = tail
                .split_once('|')
                .or_else(|| tail.split_once(';'))
                .or_else(|| tail.split_once(','))
                .or_else(|| tail.split_once('\n'))
            {
                tail = candidate;
            }

            let words = tail
                .split_whitespace()
                .take(4)
                .collect::<Vec<_>>()
                .join(" ")
                .trim()
                .trim_matches(|ch: char| matches!(ch, '.' | ',' | ';' | ':' | '|'))
                .to_string();

            if !words.is_empty() {
                return Some(words);
            }
        }
    }

    None
}

fn extract_issue_reference(task: &str) -> Option<String> {
    let tokens = task
        .split(|ch: char| ch.is_whitespace() || matches!(ch, ',' | ';' | ':' | '(' | ')'))
        .filter(|token| !token.is_empty());

    for token in tokens {
        if let Some(stripped) = token.strip_prefix('#') {
            if !stripped.is_empty() && stripped.chars().all(|ch| ch.is_ascii_digit()) {
                return Some(format!("#{stripped}"));
            }
        }

        if let Some((prefix, suffix)) = token.split_once('-') {
            if !prefix.is_empty()
                && !suffix.is_empty()
                && prefix.chars().all(|ch| ch.is_ascii_uppercase())
                && suffix.chars().all(|ch| ch.is_ascii_digit())
            {
                return Some(token.trim_matches('.').to_string());
            }
        }
    }

    None
}

fn derive_board_conflict_signals(sessions: &[Session]) -> HashMap<String, String> {
    let active_sessions = sessions
        .iter()
        .filter(|session| {
            matches!(
                session.state,
                SessionState::Pending | SessionState::Running | SessionState::Idle | SessionState::Stale
            )
        })
        .collect::<Vec<_>>();

    let mut sessions_by_branch: HashMap<String, Vec<&Session>> = HashMap::new();
    let mut sessions_by_task: HashMap<String, Vec<&Session>> = HashMap::new();
    let mut sessions_by_scope: HashMap<String, Vec<&Session>> = HashMap::new();

    for session in active_sessions {
        if let Some(worktree) = session.worktree.as_ref() {
            sessions_by_branch
                .entry(worktree.branch.clone())
                .or_default()
                .push(session);
        }

        sessions_by_task
            .entry(session.task.trim().to_ascii_lowercase())
            .or_default()
            .push(session);

        let (project, feature, issue) = derive_board_scope(session);
        if let Some(scope) = issue.or(feature).or(project).filter(|scope| !scope.is_empty()) {
            sessions_by_scope.entry(scope).or_default().push(session);
        }
    }

    let mut signals = HashMap::new();

    for (branch, grouped_sessions) in sessions_by_branch {
        if grouped_sessions.len() < 2 {
            continue;
        }
        for session in grouped_sessions {
            append_conflict_signal(&mut signals, &session.id, format!("Shared branch {branch}"));
        }
    }

    for (task, grouped_sessions) in sessions_by_task {
        if grouped_sessions.len() < 2 {
            continue;
        }
        for session in grouped_sessions {
            append_conflict_signal(
                &mut signals,
                &session.id,
                format!("Shared task {}", truncate_task_for_signal(&task)),
            );
        }
    }

    for (scope, grouped_sessions) in sessions_by_scope {
        if grouped_sessions.len() < 2 {
            continue;
        }
        for session in grouped_sessions {
            append_conflict_signal(
                &mut signals,
                &session.id,
                format!("Shared scope {}", truncate_task_for_signal(&scope)),
            );
        }
    }

    signals
}

fn append_conflict_signal(
    signals: &mut HashMap<String, String>,
    session_id: &str,
    next_signal: String,
) {
    let entry = signals.entry(session_id.to_string()).or_default();
    if entry.is_empty() {
        *entry = next_signal;
        return;
    }

    if !entry.split("; ").any(|existing| existing == next_signal) {
        entry.push_str("; ");
        entry.push_str(&next_signal);
    }
}

fn short_session_ref(session_id: &str) -> String {
    if session_id.chars().count() <= 12 {
        session_id.to_string()
    } else {
        session_id.chars().take(8).collect()
    }
}

fn routing_activity_suffix(context: &str) -> Option<&'static str> {
    let normalized = context.to_ascii_lowercase();
    if normalized.contains("reused idle delegate") {
        Some("reused idle")
    } else if normalized.contains("reused active delegate") {
        Some("reused active")
    } else if normalized.contains("spawned fallback delegate") {
        Some("spawned fallback")
    } else if normalized.contains("spawned new delegate") {
        Some("spawned")
    } else {
        None
    }
}

fn extract_task_handoff_context(content: &str) -> Option<String> {
    if let Some(crate::comms::MessageType::TaskHandoff { context, .. }) = crate::comms::parse(content)
    {
        return Some(context);
    }

    let value: serde_json::Value = serde_json::from_str(content).ok()?;
    value
        .get("context")
        .and_then(|context| context.as_str())
        .map(ToOwned::to_owned)
}

fn truncate_task_for_signal(task: &str) -> String {
    const LIMIT: usize = 28;
    let trimmed = task.trim();
    let count = trimmed.chars().count();
    if count <= LIMIT {
        trimmed.to_string()
    } else {
        format!("{}...", trimmed.chars().take(LIMIT - 3).collect::<String>())
    }
}

fn map_conflict_incident(row: &rusqlite::Row<'_>) -> rusqlite::Result<ConflictIncident> {
    let created_at = parse_timestamp_column(row.get::<_, String>(11)?, 11)?;
    let updated_at = parse_timestamp_column(row.get::<_, String>(12)?, 12)?;
    let resolved_at = row
        .get::<_, Option<String>>(13)?
        .map(|value| parse_timestamp_column(value, 13))
        .transpose()?;

    Ok(ConflictIncident {
        id: row.get(0)?,
        conflict_key: row.get(1)?,
        path: row.get(2)?,
        first_session_id: row.get(3)?,
        second_session_id: row.get(4)?,
        active_session_id: row.get(5)?,
        paused_session_id: row.get(6)?,
        first_action: parse_file_activity_action(&row.get::<_, String>(7)?).ok_or_else(|| {
            rusqlite::Error::InvalidColumnType(
                7,
                "first_action".into(),
                rusqlite::types::Type::Text,
            )
        })?,
        second_action: parse_file_activity_action(&row.get::<_, String>(8)?).ok_or_else(|| {
            rusqlite::Error::InvalidColumnType(
                8,
                "second_action".into(),
                rusqlite::types::Type::Text,
            )
        })?,
        strategy: row.get(9)?,
        summary: row.get(10)?,
        created_at,
        updated_at,
        resolved_at,
    })
}

fn map_scheduled_task(row: &rusqlite::Row<'_>) -> rusqlite::Result<ScheduledTask> {
    let last_run_at = row
        .get::<_, Option<String>>(9)?
        .map(|value| parse_store_timestamp(value, 9))
        .transpose()?;
    let next_run_at = parse_store_timestamp(row.get::<_, String>(10)?, 10)?;
    let created_at = parse_store_timestamp(row.get::<_, String>(11)?, 11)?;
    let updated_at = parse_store_timestamp(row.get::<_, String>(12)?, 12)?;
    Ok(ScheduledTask {
        id: row.get(0)?,
        cron_expr: row.get(1)?,
        task: row.get(2)?,
        agent_type: row.get(3)?,
        profile_name: normalize_optional_string(row.get(4)?),
        working_dir: PathBuf::from(row.get::<_, String>(5)?),
        project: row.get(6)?,
        task_group: row.get(7)?,
        use_worktree: row.get::<_, i64>(8)? != 0,
        last_run_at,
        next_run_at,
        created_at,
        updated_at,
    })
}

fn map_remote_dispatch_request(row: &rusqlite::Row<'_>) -> rusqlite::Result<RemoteDispatchRequest> {
    let created_at = parse_store_timestamp(row.get::<_, String>(18)?, 18)?;
    let updated_at = parse_store_timestamp(row.get::<_, String>(19)?, 19)?;
    let dispatched_at = row
        .get::<_, Option<String>>(20)?
        .map(|value| parse_store_timestamp(value, 20))
        .transpose()?;
    Ok(RemoteDispatchRequest {
        id: row.get(0)?,
        request_kind: RemoteDispatchKind::from_db_value(&row.get::<_, String>(1)?),
        target_session_id: normalize_optional_string(row.get(2)?),
        task: row.get(3)?,
        target_url: normalize_optional_string(row.get(4)?),
        priority: task_priority_from_db_value(row.get::<_, i64>(5)?),
        agent_type: row.get(6)?,
        profile_name: normalize_optional_string(row.get(7)?),
        working_dir: PathBuf::from(row.get::<_, String>(8)?),
        project: row.get(9)?,
        task_group: row.get(10)?,
        use_worktree: row.get::<_, i64>(11)? != 0,
        source: row.get(12)?,
        requester: normalize_optional_string(row.get(13)?),
        status: RemoteDispatchStatus::from_db_value(&row.get::<_, String>(14)?),
        result_session_id: normalize_optional_string(row.get(15)?),
        result_action: normalize_optional_string(row.get(16)?),
        error: normalize_optional_string(row.get(17)?),
        created_at,
        updated_at,
        dispatched_at,
    })
}

fn parse_timestamp_column(
    value: String,
    index: usize,
) -> rusqlite::Result<chrono::DateTime<chrono::Utc>> {
    chrono::DateTime::parse_from_rfc3339(&value)
        .map(|value| value.with_timezone(&chrono::Utc))
        .map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(
                index,
                rusqlite::types::Type::Text,
                Box::new(error),
            )
        })
}

fn parse_file_activity_action(value: &str) -> Option<FileActivityAction> {
    match value.trim().to_ascii_lowercase().as_str() {
        "read" => Some(FileActivityAction::Read),
        "create" => Some(FileActivityAction::Create),
        "modify" | "edit" | "write" => Some(FileActivityAction::Modify),
        "move" | "rename" => Some(FileActivityAction::Move),
        "delete" | "remove" => Some(FileActivityAction::Delete),
        "touch" => Some(FileActivityAction::Touch),
        _ => None,
    }
}

fn normalize_optional_string(value: Option<String>) -> Option<String> {
    value.and_then(|value| {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

fn default_input_params_json() -> String {
    "{}".to_string()
}

fn task_priority_db_value(priority: crate::comms::TaskPriority) -> i64 {
    match priority {
        crate::comms::TaskPriority::Low => 0,
        crate::comms::TaskPriority::Normal => 1,
        crate::comms::TaskPriority::High => 2,
        crate::comms::TaskPriority::Critical => 3,
    }
}

fn task_priority_from_db_value(value: i64) -> crate::comms::TaskPriority {
    match value {
        0 => crate::comms::TaskPriority::Low,
        2 => crate::comms::TaskPriority::High,
        3 => crate::comms::TaskPriority::Critical,
        _ => crate::comms::TaskPriority::Normal,
    }
}

fn infer_file_activity_action(tool_name: &str) -> FileActivityAction {
    let tool_name = tool_name.trim().to_ascii_lowercase();
    if tool_name.contains("read") {
        FileActivityAction::Read
    } else if tool_name.contains("write") {
        FileActivityAction::Create
    } else if tool_name.contains("edit") {
        FileActivityAction::Modify
    } else if tool_name.contains("delete") || tool_name.contains("remove") {
        FileActivityAction::Delete
    } else if tool_name.contains("move") || tool_name.contains("rename") {
        FileActivityAction::Move
    } else {
        FileActivityAction::Touch
    }
}

fn session_state_supports_overlap(state: &SessionState) -> bool {
    matches!(
        state,
        SessionState::Pending | SessionState::Running | SessionState::Idle | SessionState::Stale
    )
}

fn map_decision_log_entry(row: &rusqlite::Row<'_>) -> rusqlite::Result<DecisionLogEntry> {
    let alternatives_json = row
        .get::<_, Option<String>>(3)?
        .unwrap_or_else(|| "[]".to_string());
    let alternatives = serde_json::from_str(&alternatives_json).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(3, rusqlite::types::Type::Text, Box::new(error))
    })?;
    let timestamp = row.get::<_, String>(5)?;
    let timestamp = chrono::DateTime::parse_from_rfc3339(&timestamp)
        .map(|value| value.with_timezone(&chrono::Utc))
        .map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(
                5,
                rusqlite::types::Type::Text,
                Box::new(error),
            )
        })?;

    Ok(DecisionLogEntry {
        id: row.get(0)?,
        session_id: row.get(1)?,
        decision: row.get(2)?,
        alternatives,
        reasoning: row.get(4)?,
        timestamp,
    })
}

fn map_context_graph_entity(row: &rusqlite::Row<'_>) -> rusqlite::Result<ContextGraphEntity> {
    let metadata_json = row
        .get::<_, Option<String>>(6)?
        .unwrap_or_else(|| "{}".to_string());
    let metadata = serde_json::from_str(&metadata_json).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(6, rusqlite::types::Type::Text, Box::new(error))
    })?;
    let created_at = parse_store_timestamp(row.get::<_, String>(7)?, 7)?;
    let updated_at = parse_store_timestamp(row.get::<_, String>(8)?, 8)?;

    Ok(ContextGraphEntity {
        id: row.get(0)?,
        session_id: row.get(1)?,
        entity_type: row.get(2)?,
        name: row.get(3)?,
        path: row.get(4)?,
        summary: row.get(5)?,
        metadata,
        created_at,
        updated_at,
    })
}

fn map_context_graph_relation(row: &rusqlite::Row<'_>) -> rusqlite::Result<ContextGraphRelation> {
    let created_at = parse_store_timestamp(row.get::<_, String>(10)?, 10)?;

    Ok(ContextGraphRelation {
        id: row.get(0)?,
        session_id: row.get(1)?,
        from_entity_id: row.get(2)?,
        from_entity_type: row.get(3)?,
        from_entity_name: row.get(4)?,
        to_entity_id: row.get(5)?,
        to_entity_type: row.get(6)?,
        to_entity_name: row.get(7)?,
        relation_type: row.get(8)?,
        summary: row.get(9)?,
        created_at,
    })
}

fn map_context_graph_observation(
    row: &rusqlite::Row<'_>,
) -> rusqlite::Result<ContextGraphObservation> {
    let details_json = row
        .get::<_, Option<String>>(9)?
        .unwrap_or_else(|| "{}".to_string());
    let details = serde_json::from_str(&details_json).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(9, rusqlite::types::Type::Text, Box::new(error))
    })?;
    let created_at = parse_store_timestamp(row.get::<_, String>(10)?, 10)?;

    Ok(ContextGraphObservation {
        id: row.get(0)?,
        session_id: row.get(1)?,
        entity_id: row.get(2)?,
        entity_type: row.get(3)?,
        entity_name: row.get(4)?,
        observation_type: row.get(5)?,
        priority: ContextObservationPriority::from_db_value(row.get::<_, i64>(6)?),
        pinned: row.get::<_, i64>(7)? != 0,
        summary: row.get(8)?,
        details,
        created_at,
    })
}

fn context_graph_recall_terms(query: &str) -> Vec<String> {
    let mut terms = Vec::new();
    for raw_term in
        query.split(|c: char| !(c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.' | '/')))
    {
        let term = raw_term.trim().to_ascii_lowercase();
        if term.len() < 3 || terms.iter().any(|existing| existing == &term) {
            continue;
        }
        terms.push(term);
    }
    terms
}

fn context_graph_matched_terms(
    entity: &ContextGraphEntity,
    observation_text: &str,
    terms: &[String],
) -> Vec<String> {
    let mut haystacks = vec![
        entity.entity_type.to_ascii_lowercase(),
        entity.name.to_ascii_lowercase(),
        entity.summary.to_ascii_lowercase(),
    ];
    if let Some(path) = entity.path.as_ref() {
        haystacks.push(path.to_ascii_lowercase());
    }
    for (key, value) in &entity.metadata {
        haystacks.push(key.to_ascii_lowercase());
        haystacks.push(value.to_ascii_lowercase());
    }
    if !observation_text.trim().is_empty() {
        haystacks.push(observation_text.to_ascii_lowercase());
    }

    let mut matched = Vec::new();
    for term in terms {
        if haystacks.iter().any(|value| value.contains(term)) {
            matched.push(term.clone());
        }
    }
    matched
}

fn context_graph_recall_score(
    matched_term_count: usize,
    relation_count: usize,
    observation_count: usize,
    max_observation_priority: ContextObservationPriority,
    has_pinned_observation: bool,
    updated_at: chrono::DateTime<chrono::Utc>,
    now: chrono::DateTime<chrono::Utc>,
) -> u64 {
    let recency_bonus = {
        let age = now.signed_duration_since(updated_at);
        if age <= chrono::Duration::hours(1) {
            9
        } else if age <= chrono::Duration::hours(24) {
            6
        } else if age <= chrono::Duration::days(7) {
            3
        } else {
            0
        }
    };

    (matched_term_count as u64 * 100)
        + (relation_count.min(9) as u64 * 10)
        + (observation_count.min(6) as u64 * 8)
        + (max_observation_priority.as_db_value() as u64 * 18)
        + if has_pinned_observation { 48 } else { 0 }
        + recency_bonus
}

fn parse_store_timestamp(
    raw: String,
    column: usize,
) -> rusqlite::Result<chrono::DateTime<chrono::Utc>> {
    chrono::DateTime::parse_from_rfc3339(&raw)
        .map(|value| value.with_timezone(&chrono::Utc))
        .map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(
                column,
                rusqlite::types::Type::Text,
                Box::new(error),
            )
        })
}

fn context_graph_entity_key(entity_type: &str, name: &str, path: Option<&str>) -> String {
    format!(
        "{}::{}::{}",
        entity_type.trim().to_ascii_lowercase(),
        name.trim().to_ascii_lowercase(),
        path.unwrap_or("").trim()
    )
}

fn context_graph_file_name(path: &str) -> String {
    Path::new(path)
        .file_name()
        .and_then(|value| value.to_str())
        .map(|value| value.to_string())
        .unwrap_or_else(|| path.to_string())
}

fn file_overlap_is_relevant(current: &FileActivityEntry, other: &FileActivityEntry) -> bool {
    current.path == other.path
        && !(matches!(current.action, FileActivityAction::Read)
            && matches!(other.action, FileActivityAction::Read))
}

fn overlap_state_priority(state: &SessionState) -> u8 {
    match state {
        SessionState::Running => 0,
        SessionState::Idle => 1,
        SessionState::Pending => 2,
        SessionState::Stale => 3,
        SessionState::Completed => 4,
        SessionState::Failed => 5,
        SessionState::Stopped => 6,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{Duration as ChronoDuration, Utc};
    use std::fs;

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

    fn build_session(id: &str, state: SessionState) -> Session {
        let now = Utc::now();
        Session {
            id: id.to_string(),
            task: "task".to_string(),
            project: "workspace".to_string(),
            task_group: "general".to_string(),
            agent_type: "claude".to_string(),
            working_dir: PathBuf::from("/tmp"),
            state,
            pid: None,
            worktree: None,
            created_at: now - ChronoDuration::minutes(1),
            updated_at: now,
            last_heartbeat_at: now,
            metrics: SessionMetrics::default(),
        }
    }

    #[test]
    fn update_state_rejects_invalid_terminal_transition() -> Result<()> {
        let tempdir = TestDir::new("store-invalid-transition")?;
        let db = StateStore::open(&tempdir.path().join("state.db"))?;

        db.insert_session(&build_session("done", SessionState::Completed))?;

        let error = db
            .update_state("done", &SessionState::Running)
            .expect_err("completed sessions must not transition back to running");

        assert!(error
            .to_string()
            .contains("Invalid session state transition"));
        Ok(())
    }

    #[test]
    fn open_migrates_existing_sessions_table_with_pid_column() -> Result<()> {
        let tempdir = TestDir::new("store-migration")?;
        let db_path = tempdir.path().join("state.db");

        let conn = Connection::open(&db_path)?;
        conn.execute_batch(
            "
            CREATE TABLE sessions (
                id TEXT PRIMARY KEY,
                task TEXT NOT NULL,
                agent_type TEXT NOT NULL,
                working_dir TEXT NOT NULL DEFAULT '.',
                state TEXT NOT NULL DEFAULT 'pending',
                worktree_path TEXT,
                worktree_branch TEXT,
                worktree_base TEXT,
                tokens_used INTEGER DEFAULT 0,
                tool_calls INTEGER DEFAULT 0,
                files_changed INTEGER DEFAULT 0,
                duration_secs INTEGER DEFAULT 0,
                cost_usd REAL DEFAULT 0.0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            ",
        )?;
        drop(conn);

        let db = StateStore::open(&db_path)?;
        let mut stmt = db.conn.prepare("PRAGMA table_info(sessions)")?;
        let column_names = stmt
            .query_map([], |row| row.get::<_, String>(1))?
            .collect::<std::result::Result<Vec<_>, _>>()?;

        assert!(column_names.iter().any(|column| column == "working_dir"));
        assert!(column_names.iter().any(|column| column == "pid"));
        assert!(column_names.iter().any(|column| column == "input_tokens"));
        assert!(column_names.iter().any(|column| column == "output_tokens"));
        assert!(column_names.iter().any(|column| column == "harness"));
        assert!(column_names
            .iter()
            .any(|column| column == "detected_harnesses_json"));
        assert!(column_names
            .iter()
            .any(|column| column == "last_heartbeat_at"));
        Ok(())
    }

    #[test]
    fn open_backfills_session_harness_metadata_for_legacy_rows() -> Result<()> {
        let tempdir = TestDir::new("store-harness-backfill")?;
        let repo_root = tempdir.path().join("repo");
        fs::create_dir_all(repo_root.join(".codex"))?;
        let db_path = tempdir.path().join("state.db");

        let conn = Connection::open(&db_path)?;
        conn.execute_batch(
            "
            CREATE TABLE sessions (
                id TEXT PRIMARY KEY,
                task TEXT NOT NULL,
                project TEXT NOT NULL DEFAULT '',
                task_group TEXT NOT NULL DEFAULT '',
                agent_type TEXT NOT NULL,
                working_dir TEXT NOT NULL DEFAULT '.',
                state TEXT NOT NULL DEFAULT 'pending',
                pid INTEGER,
                worktree_path TEXT,
                worktree_branch TEXT,
                worktree_base TEXT,
                input_tokens INTEGER DEFAULT 0,
                output_tokens INTEGER DEFAULT 0,
                tokens_used INTEGER DEFAULT 0,
                tool_calls INTEGER DEFAULT 0,
                files_changed INTEGER DEFAULT 0,
                duration_secs INTEGER DEFAULT 0,
                cost_usd REAL DEFAULT 0.0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                last_heartbeat_at TEXT NOT NULL
            );
            ",
        )?;
        let now = Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO sessions (
                id, task, project, task_group, agent_type, working_dir, state, pid,
                worktree_path, worktree_branch, worktree_base, input_tokens, output_tokens,
                tokens_used, tool_calls, files_changed, duration_secs, cost_usd, created_at,
                updated_at, last_heartbeat_at
            ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6, 'pending', NULL,
                NULL, NULL, NULL, 0, 0, 0, 0, 0, 0, 0.0, ?7, ?7, ?7
            )",
            rusqlite::params![
                "sess-legacy",
                "Backfill harness metadata",
                "ecc",
                "legacy",
                "gemini-cli",
                repo_root.display().to_string(),
                now,
            ],
        )?;
        drop(conn);

        let db = StateStore::open(&db_path)?;
        let session = db
            .get_session("sess-legacy")?
            .expect("legacy row should still exist");
        assert_eq!(session.agent_type, "gemini");
        let harness = db
            .get_session_harness_info("sess-legacy")?
            .expect("legacy row should be backfilled");
        assert_eq!(harness.primary, HarnessKind::Gemini);
        assert_eq!(harness.primary_label, "gemini");
        assert_eq!(harness.detected, vec![HarnessKind::Codex]);
        Ok(())
    }

    #[test]
    fn insert_session_preserves_custom_harness_label_for_unknown_agent_types() -> Result<()> {
        let tempdir = TestDir::new("store-custom-harness-label")?;
        let db = StateStore::open(&tempdir.path().join("state.db"))?;
        let now = Utc::now();

        db.insert_session(&Session {
            id: "sess-custom".to_string(),
            task: "Run custom harness".to_string(),
            project: "ecc".to_string(),
            task_group: "compat".to_string(),
            agent_type: "acme-runner".to_string(),
            working_dir: PathBuf::from(tempdir.path()),
            state: SessionState::Pending,
            pid: None,
            worktree: None,
            created_at: now,
            updated_at: now,
            last_heartbeat_at: now,
            metrics: SessionMetrics::default(),
        })?;

        let harness = db
            .get_session_harness_info("sess-custom")?
            .expect("custom session should have harness info");
        assert_eq!(harness.primary, HarnessKind::Unknown);
        assert_eq!(harness.primary_label, "acme-runner");
        Ok(())
    }

    #[test]
    fn session_profile_round_trips_with_launch_settings() -> Result<()> {
        let tempdir = TestDir::new("store-session-profile")?;
        let db = StateStore::open(&tempdir.path().join("state.db"))?;
        let now = Utc::now();

        db.insert_session(&Session {
            id: "session-1".to_string(),
            task: "review work".to_string(),
            project: "workspace".to_string(),
            task_group: "general".to_string(),
            agent_type: "claude".to_string(),
            working_dir: PathBuf::from("/tmp"),
            state: SessionState::Pending,
            pid: None,
            worktree: None,
            created_at: now,
            updated_at: now,
            last_heartbeat_at: now,
            metrics: SessionMetrics::default(),
        })?;

        db.upsert_session_profile(
            "session-1",
            &crate::session::SessionAgentProfile {
                agent: None,
                profile_name: "reviewer".to_string(),
                model: Some("sonnet".to_string()),
                allowed_tools: vec!["Read".to_string(), "Edit".to_string()],
                disallowed_tools: vec!["Bash".to_string()],
                permission_mode: Some("plan".to_string()),
                add_dirs: vec![PathBuf::from("docs"), PathBuf::from("specs")],
                max_budget_usd: Some(1.5),
                token_budget: Some(1200),
                append_system_prompt: Some("Review thoroughly.".to_string()),
            },
        )?;

        let profile = db
            .get_session_profile("session-1")?
            .expect("profile should be stored");
        assert_eq!(profile.profile_name, "reviewer");
        assert_eq!(profile.model.as_deref(), Some("sonnet"));
        assert_eq!(profile.allowed_tools, vec!["Read", "Edit"]);
        assert_eq!(profile.disallowed_tools, vec!["Bash"]);
        assert_eq!(profile.permission_mode.as_deref(), Some("plan"));
        assert_eq!(
            profile.add_dirs,
            vec![PathBuf::from("docs"), PathBuf::from("specs")]
        );
        assert_eq!(profile.max_budget_usd, Some(1.5));
        assert_eq!(profile.token_budget, Some(1200));
        assert_eq!(
            profile.append_system_prompt.as_deref(),
            Some("Review thoroughly.")
        );

        Ok(())
    }

    #[test]
    fn sync_cost_tracker_metrics_aggregates_usage_into_sessions() -> Result<()> {
        let tempdir = TestDir::new("store-cost-metrics")?;
        let db = StateStore::open(&tempdir.path().join("state.db"))?;
        let now = Utc::now();

        db.insert_session(&Session {
            id: "session-1".to_string(),
            task: "sync usage".to_string(),
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

        let metrics_dir = tempdir.path().join("metrics");
        fs::create_dir_all(&metrics_dir)?;
        let metrics_path = metrics_dir.join("costs.jsonl");
        fs::write(
            &metrics_path,
            concat!(
                "{\"session_id\":\"session-1\",\"input_tokens\":100,\"output_tokens\":25,\"estimated_cost_usd\":0.11}\n",
                "{\"session_id\":\"session-1\",\"input_tokens\":40,\"output_tokens\":10,\"estimated_cost_usd\":0.05}\n",
                "{\"session_id\":\"other-session\",\"input_tokens\":999,\"output_tokens\":1,\"estimated_cost_usd\":9.99}\n"
            ),
        )?;

        db.sync_cost_tracker_metrics(&metrics_path)?;

        let session = db
            .get_session("session-1")?
            .expect("session should still exist");
        assert_eq!(session.metrics.input_tokens, 140);
        assert_eq!(session.metrics.output_tokens, 35);
        assert_eq!(session.metrics.tokens_used, 175);
        assert!((session.metrics.cost_usd - 0.16).abs() < f64::EPSILON);

        Ok(())
    }

    #[test]
    fn sync_tool_activity_metrics_aggregates_usage_and_logs() -> Result<()> {
        let tempdir = TestDir::new("store-tool-activity")?;
        let db = StateStore::open(&tempdir.path().join("state.db"))?;
        let now = Utc::now();

        db.insert_session(&Session {
            id: "session-1".to_string(),
            task: "sync tools".to_string(),
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
        db.insert_session(&Session {
            id: "session-2".to_string(),
            task: "no activity".to_string(),
            project: "workspace".to_string(),
            task_group: "general".to_string(),
            agent_type: "claude".to_string(),
            working_dir: PathBuf::from("/tmp"),
            state: SessionState::Pending,
            pid: None,
            worktree: None,
            created_at: now,
            updated_at: now,
            last_heartbeat_at: now,
            metrics: SessionMetrics::default(),
        })?;

        let metrics_dir = tempdir.path().join("metrics");
        fs::create_dir_all(&metrics_dir)?;
        let metrics_path = metrics_dir.join("tool-usage.jsonl");
        fs::write(
            &metrics_path,
            concat!(
                "{\"id\":\"evt-1\",\"session_id\":\"session-1\",\"tool_name\":\"Read\",\"input_summary\":\"Read src/lib.rs\",\"input_params_json\":\"{\\\"file_path\\\":\\\"src/lib.rs\\\"}\",\"output_summary\":\"ok\",\"file_paths\":[\"src/lib.rs\"],\"timestamp\":\"2026-04-09T00:00:00Z\"}\n",
                "{\"id\":\"evt-1\",\"session_id\":\"session-1\",\"tool_name\":\"Read\",\"input_summary\":\"Read src/lib.rs\",\"input_params_json\":\"{\\\"file_path\\\":\\\"src/lib.rs\\\"}\",\"output_summary\":\"ok\",\"file_paths\":[\"src/lib.rs\"],\"timestamp\":\"2026-04-09T00:00:00Z\"}\n",
                "{\"id\":\"evt-2\",\"session_id\":\"session-1\",\"tool_name\":\"Write\",\"input_summary\":\"Write README.md\",\"input_params_json\":\"{\\\"file_path\\\":\\\"README.md\\\",\\\"content\\\":\\\"hello\\\"}\",\"output_summary\":\"ok\",\"file_paths\":[\"src/lib.rs\",\"README.md\"],\"timestamp\":\"2026-04-09T00:01:00Z\"}\n"
            ),
        )?;

        db.sync_tool_activity_metrics(&metrics_path)?;

        let session = db
            .get_session("session-1")?
            .expect("session should still exist");
        assert_eq!(session.metrics.tool_calls, 2);
        assert_eq!(session.metrics.files_changed, 2);

        let inactive = db
            .get_session("session-2")?
            .expect("session should still exist");
        assert_eq!(inactive.metrics.tool_calls, 0);
        assert_eq!(inactive.metrics.files_changed, 0);

        let logs = db.query_tool_logs("session-1", 1, 10)?;
        assert_eq!(logs.total, 2);
        assert_eq!(logs.entries[0].tool_name, "Write");
        assert_eq!(logs.entries[1].tool_name, "Read");
        assert_eq!(
            logs.entries[0].input_params_json,
            "{\"file_path\":\"README.md\",\"content\":\"hello\"}"
        );
        assert_eq!(logs.entries[0].trigger_summary, "sync tools");
        assert_eq!(
            logs.entries[1].input_params_json,
            "{\"file_path\":\"src/lib.rs\"}"
        );
        assert_eq!(logs.entries[1].trigger_summary, "sync tools");

        Ok(())
    }

    #[test]
    fn list_file_activity_expands_logged_file_paths() -> Result<()> {
        let tempdir = TestDir::new("store-file-activity")?;
        let db = StateStore::open(&tempdir.path().join("state.db"))?;
        let now = Utc::now();

        db.insert_session(&Session {
            id: "session-1".to_string(),
            task: "sync tools".to_string(),
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

        let metrics_dir = tempdir.path().join("metrics");
        fs::create_dir_all(&metrics_dir)?;
        let metrics_path = metrics_dir.join("tool-usage.jsonl");
        fs::write(
            &metrics_path,
            concat!(
                "{\"id\":\"evt-1\",\"session_id\":\"session-1\",\"tool_name\":\"Read\",\"input_summary\":\"Read src/lib.rs\",\"output_summary\":\"ok\",\"file_paths\":[\"src/lib.rs\"],\"timestamp\":\"2026-04-09T00:00:00Z\"}\n",
                "{\"id\":\"evt-2\",\"session_id\":\"session-1\",\"tool_name\":\"Write\",\"input_summary\":\"Write README.md\",\"output_summary\":\"updated readme\",\"file_paths\":[\"README.md\",\"src/lib.rs\"],\"timestamp\":\"2026-04-09T00:01:00Z\"}\n"
            ),
        )?;

        db.sync_tool_activity_metrics(&metrics_path)?;

        let activity = db.list_file_activity("session-1", 10)?;
        assert_eq!(activity.len(), 3);
        assert_eq!(activity[0].action, FileActivityAction::Create);
        assert_eq!(activity[0].path, "README.md");
        assert_eq!(activity[1].action, FileActivityAction::Create);
        assert_eq!(activity[1].path, "src/lib.rs");
        assert_eq!(activity[2].action, FileActivityAction::Read);
        assert_eq!(activity[2].path, "src/lib.rs");

        Ok(())
    }

    #[test]
    fn list_file_activity_preserves_diff_and_patch_previews() -> Result<()> {
        let tempdir = TestDir::new("store-file-activity-diffs")?;
        let db = StateStore::open(&tempdir.path().join("state.db"))?;
        let now = Utc::now();

        db.insert_session(&Session {
            id: "session-1".to_string(),
            task: "sync tools".to_string(),
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

        let metrics_dir = tempdir.path().join("metrics");
        fs::create_dir_all(&metrics_dir)?;
        let metrics_path = metrics_dir.join("tool-usage.jsonl");
        fs::write(
            &metrics_path,
            concat!(
                "{\"id\":\"evt-1\",\"session_id\":\"session-1\",\"tool_name\":\"Edit\",\"input_summary\":\"Edit src/config.ts\",\"output_summary\":\"updated config\",\"file_paths\":[\"src/config.ts\"],\"file_events\":[{\"path\":\"src/config.ts\",\"action\":\"modify\",\"diff_preview\":\"API_URL=http://localhost:3000 -> API_URL=https://api.example.com\",\"patch_preview\":\"@@\\n- API_URL=http://localhost:3000\\n+ API_URL=https://api.example.com\"}],\"timestamp\":\"2026-04-09T00:00:00Z\"}\n"
            ),
        )?;

        db.sync_tool_activity_metrics(&metrics_path)?;

        let activity = db.list_file_activity("session-1", 10)?;
        assert_eq!(activity.len(), 1);
        assert_eq!(activity[0].action, FileActivityAction::Modify);
        assert_eq!(activity[0].path, "src/config.ts");
        assert_eq!(
            activity[0].diff_preview.as_deref(),
            Some("API_URL=http://localhost:3000 -> API_URL=https://api.example.com")
        );
        assert_eq!(
            activity[0].patch_preview.as_deref(),
            Some("@@\n- API_URL=http://localhost:3000\n+ API_URL=https://api.example.com")
        );

        Ok(())
    }

    #[test]
    fn list_file_overlaps_reports_other_active_sessions_sharing_paths() -> Result<()> {
        let tempdir = TestDir::new("store-file-overlaps")?;
        let db = StateStore::open(&tempdir.path().join("state.db"))?;
        let now = Utc::now();

        db.insert_session(&Session {
            id: "session-1".to_string(),
            task: "focus".to_string(),
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
        db.insert_session(&Session {
            id: "session-2".to_string(),
            task: "delegate".to_string(),
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
            id: "session-3".to_string(),
            task: "done".to_string(),
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

        let metrics_dir = tempdir.path().join("metrics");
        fs::create_dir_all(&metrics_dir)?;
        let metrics_path = metrics_dir.join("tool-usage.jsonl");
        fs::write(
            &metrics_path,
            concat!(
                "{\"id\":\"evt-1\",\"session_id\":\"session-1\",\"tool_name\":\"Edit\",\"input_summary\":\"Edit src/lib.rs\",\"output_summary\":\"updated lib\",\"file_events\":[{\"path\":\"src/lib.rs\",\"action\":\"modify\"}],\"timestamp\":\"2026-04-09T00:02:00Z\"}\n",
                "{\"id\":\"evt-2\",\"session_id\":\"session-2\",\"tool_name\":\"Write\",\"input_summary\":\"Write src/lib.rs\",\"output_summary\":\"touched lib\",\"file_events\":[{\"path\":\"src/lib.rs\",\"action\":\"modify\"}],\"timestamp\":\"2026-04-09T00:03:00Z\"}\n",
                "{\"id\":\"evt-3\",\"session_id\":\"session-3\",\"tool_name\":\"Write\",\"input_summary\":\"Write src/lib.rs\",\"output_summary\":\"completed overlap\",\"file_events\":[{\"path\":\"src/lib.rs\",\"action\":\"modify\"}],\"timestamp\":\"2026-04-09T00:04:00Z\"}\n"
            ),
        )?;

        db.sync_tool_activity_metrics(&metrics_path)?;

        let overlaps = db.list_file_overlaps("session-1", 10)?;
        assert_eq!(overlaps.len(), 1);
        assert_eq!(overlaps[0].path, "src/lib.rs");
        assert_eq!(overlaps[0].current_action, FileActivityAction::Modify);
        assert_eq!(overlaps[0].other_action, FileActivityAction::Modify);
        assert_eq!(overlaps[0].other_session_id, "session-2");
        assert_eq!(overlaps[0].other_session_state, SessionState::Idle);

        Ok(())
    }

    #[test]
    fn conflict_incidents_upsert_and_resolve() -> Result<()> {
        let tempdir = TestDir::new("store-conflict-incidents")?;
        let db = StateStore::open(&tempdir.path().join("state.db"))?;
        let now = Utc::now();

        for id in ["session-a", "session-b"] {
            db.insert_session(&Session {
                id: id.to_string(),
                task: id.to_string(),
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
        }

        let incident = db.upsert_conflict_incident(
            "src/lib.rs::session-a::session-b",
            "src/lib.rs",
            "session-a",
            "session-b",
            "session-a",
            "session-b",
            &FileActivityAction::Modify,
            &FileActivityAction::Modify,
            "escalate",
            "Paused session-b after overlapping modify on src/lib.rs",
        )?;
        assert_eq!(incident.paused_session_id, "session-b");
        assert!(db.has_open_conflict_incident("src/lib.rs::session-a::session-b")?);

        let listed = db.list_open_conflict_incidents_for_session("session-b", 10)?;
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].path, "src/lib.rs");

        let resolved = db.resolve_conflict_incidents_not_in(&HashSet::new())?;
        assert_eq!(resolved, 1);
        assert!(!db.has_open_conflict_incident("src/lib.rs::session-a::session-b")?);

        Ok(())
    }

    #[test]
    fn open_migrates_legacy_tool_log_before_creating_hook_event_index() -> Result<()> {
        let tempdir = TestDir::new("store-legacy-hook-event")?;
        let db_path = tempdir.path().join("state.db");
        let conn = Connection::open(&db_path)?;
        conn.execute_batch(
            "
            CREATE TABLE sessions (
                id TEXT PRIMARY KEY,
                task TEXT NOT NULL,
                agent_type TEXT NOT NULL,
                state TEXT NOT NULL DEFAULT 'pending',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE tool_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                tool_name TEXT NOT NULL,
                input_summary TEXT,
                output_summary TEXT,
                duration_ms INTEGER,
                risk_score REAL DEFAULT 0.0,
                timestamp TEXT NOT NULL
            );
            ",
        )?;
        drop(conn);

        let db = StateStore::open(&db_path)?;
        assert!(db.has_column("tool_log", "hook_event_id")?);

        let conn = Connection::open(&db_path)?;
        let index_count: i64 = conn.query_row(
            "SELECT COUNT(*)
             FROM sqlite_master
             WHERE type = 'index' AND name = 'idx_tool_log_hook_event'",
            [],
            |row| row.get(0),
        )?;
        assert_eq!(index_count, 1);

        Ok(())
    }

    #[test]
    fn insert_and_list_decisions_for_session() -> Result<()> {
        let tempdir = TestDir::new("store-decisions")?;
        let db = StateStore::open(&tempdir.path().join("state.db"))?;
        let now = Utc::now();

        db.insert_session(&Session {
            id: "session-1".to_string(),
            task: "architect".to_string(),
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

        db.insert_decision(
            "session-1",
            "Use sqlite for the shared context graph",
            &["json files".to_string(), "memory only".to_string()],
            "SQLite keeps the audit trail queryable from both CLI and TUI.",
        )?;
        db.insert_decision(
            "session-1",
            "Keep decision logging append-only",
            &["mutable edits".to_string()],
            "Append-only history preserves operator trust and timeline integrity.",
        )?;

        let entries = db.list_decisions_for_session("session-1", 10)?;
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].session_id, "session-1");
        assert_eq!(
            entries[0].decision,
            "Use sqlite for the shared context graph"
        );
        assert_eq!(
            entries[0].alternatives,
            vec!["json files".to_string(), "memory only".to_string()]
        );
        assert_eq!(entries[1].decision, "Keep decision logging append-only");
        assert_eq!(
            entries[1].reasoning,
            "Append-only history preserves operator trust and timeline integrity."
        );

        Ok(())
    }

    #[test]
    fn list_recent_decisions_across_sessions_returns_latest_subset_in_order() -> Result<()> {
        let tempdir = TestDir::new("store-decisions-all")?;
        let db = StateStore::open(&tempdir.path().join("state.db"))?;
        let now = Utc::now();

        for session_id in ["session-a", "session-b", "session-c"] {
            db.insert_session(&Session {
                id: session_id.to_string(),
                task: "decision log".to_string(),
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
        }

        db.insert_decision("session-a", "Oldest", &[], "first")?;
        std::thread::sleep(std::time::Duration::from_millis(2));
        db.insert_decision("session-b", "Middle", &[], "second")?;
        std::thread::sleep(std::time::Duration::from_millis(2));
        db.insert_decision("session-c", "Newest", &[], "third")?;

        let entries = db.list_decisions(2)?;
        assert_eq!(
            entries
                .iter()
                .map(|entry| entry.decision.as_str())
                .collect::<Vec<_>>(),
            vec!["Middle", "Newest"]
        );
        assert_eq!(entries[0].session_id, "session-b");
        assert_eq!(entries[1].session_id, "session-c");

        Ok(())
    }

    #[test]
    fn upsert_and_filter_context_graph_entities() -> Result<()> {
        let tempdir = TestDir::new("store-context-entities")?;
        let db = StateStore::open(&tempdir.path().join("state.db"))?;
        let now = Utc::now();

        db.insert_session(&Session {
            id: "session-1".to_string(),
            task: "context graph".to_string(),
            project: "workspace".to_string(),
            task_group: "knowledge".to_string(),
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

        let mut metadata = BTreeMap::new();
        metadata.insert("language".to_string(), "rust".to_string());
        let file = db.upsert_context_entity(
            Some("session-1"),
            "file",
            "dashboard.rs",
            Some("ecc2/src/tui/dashboard.rs"),
            "Primary dashboard surface",
            &metadata,
        )?;
        let updated = db.upsert_context_entity(
            Some("session-1"),
            "file",
            "dashboard.rs",
            Some("ecc2/src/tui/dashboard.rs"),
            "Updated dashboard summary",
            &metadata,
        )?;
        let decision = db.upsert_context_entity(
            None,
            "decision",
            "Prefer SQLite graph storage",
            None,
            "Keeps graph queryable from CLI and TUI",
            &BTreeMap::new(),
        )?;

        assert_eq!(file.id, updated.id);
        assert_eq!(updated.summary, "Updated dashboard summary");

        let session_entities = db.list_context_entities(Some("session-1"), Some("file"), 10)?;
        assert_eq!(session_entities.len(), 1);
        assert_eq!(session_entities[0].id, file.id);
        assert_eq!(
            session_entities[0].metadata.get("language"),
            Some(&"rust".to_string())
        );

        let all_entities = db.list_context_entities(None, None, 10)?;
        assert_eq!(all_entities.len(), 2);
        assert!(all_entities.iter().any(|entity| entity.id == decision.id));

        Ok(())
    }

    #[test]
    fn add_and_list_context_observations() -> Result<()> {
        let tempdir = TestDir::new("store-context-observations")?;
        let db = StateStore::open(&tempdir.path().join("state.db"))?;
        let now = Utc::now();

        db.insert_session(&Session {
            id: "session-1".to_string(),
            task: "deep memory".to_string(),
            project: "workspace".to_string(),
            task_group: "knowledge".to_string(),
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

        let entity = db.upsert_context_entity(
            Some("session-1"),
            "decision",
            "Prefer recovery-first routing",
            None,
            "Recovered installs should go through the portal first",
            &BTreeMap::new(),
        )?;
        let observation = db.add_context_observation(
            Some("session-1"),
            entity.id,
            "note",
            ContextObservationPriority::Normal,
            false,
            "Customer wiped setup and got charged twice",
            &BTreeMap::from([("customer".to_string(), "viktor".to_string())]),
        )?;

        let observations = db.list_context_observations(Some(entity.id), 10)?;
        assert_eq!(observations.len(), 1);
        assert_eq!(observations[0].id, observation.id);
        assert_eq!(observations[0].entity_name, "Prefer recovery-first routing");
        assert_eq!(observations[0].observation_type, "note");
        assert_eq!(observations[0].priority, ContextObservationPriority::Normal);
        assert!(!observations[0].pinned);
        assert_eq!(
            observations[0].details.get("customer"),
            Some(&"viktor".to_string())
        );

        Ok(())
    }

    #[test]
    fn compact_context_graph_prunes_duplicate_and_overflow_observations() -> Result<()> {
        let tempdir = TestDir::new("store-context-compaction")?;
        let db = StateStore::open(&tempdir.path().join("state.db"))?;
        let now = Utc::now();

        db.insert_session(&Session {
            id: "session-1".to_string(),
            task: "deep memory".to_string(),
            project: "workspace".to_string(),
            task_group: "knowledge".to_string(),
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

        let entity = db.upsert_context_entity(
            Some("session-1"),
            "decision",
            "Prefer recovery-first routing",
            None,
            "Recovered installs should go through the portal first",
            &BTreeMap::new(),
        )?;

        for summary in [
            "old duplicate",
            "keep me",
            "old duplicate",
            "recent",
            "latest",
        ] {
            db.conn.execute(
                "INSERT INTO context_graph_observations (
                    session_id, entity_id, observation_type, priority, summary, details_json, created_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                rusqlite::params![
                    "session-1",
                    entity.id,
                    "note",
                    ContextObservationPriority::Normal.as_db_value(),
                    summary,
                    "{}",
                    chrono::Utc::now().to_rfc3339(),
                ],
            )?;
            std::thread::sleep(std::time::Duration::from_millis(2));
        }

        let stats = db.compact_context_graph(None, 3)?;
        assert_eq!(stats.entities_scanned, 1);
        assert_eq!(stats.duplicate_observations_deleted, 1);
        assert_eq!(stats.overflow_observations_deleted, 1);
        assert_eq!(stats.observations_retained, 3);

        let observations = db.list_context_observations(Some(entity.id), 10)?;
        let summaries = observations
            .iter()
            .map(|observation| observation.summary.as_str())
            .collect::<Vec<_>>();
        assert_eq!(summaries, vec!["latest", "recent", "old duplicate"]);

        Ok(())
    }

    #[test]
    fn add_context_observation_auto_compacts_entity_history() -> Result<()> {
        let tempdir = TestDir::new("store-context-auto-compaction")?;
        let db = StateStore::open(&tempdir.path().join("state.db"))?;
        let now = Utc::now();

        db.insert_session(&Session {
            id: "session-1".to_string(),
            task: "deep memory".to_string(),
            project: "workspace".to_string(),
            task_group: "knowledge".to_string(),
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

        let entity = db.upsert_context_entity(
            Some("session-1"),
            "session",
            "session-1",
            None,
            "Deep-memory worker",
            &BTreeMap::new(),
        )?;

        for index in 0..(DEFAULT_CONTEXT_GRAPH_OBSERVATION_RETENTION + 2) {
            let summary = format!("completion summary {}", index);
            db.add_context_observation(
                Some("session-1"),
                entity.id,
                "completion_summary",
                ContextObservationPriority::Normal,
                false,
                &summary,
                &BTreeMap::new(),
            )?;
            std::thread::sleep(std::time::Duration::from_millis(2));
        }

        let observations = db.list_context_observations(Some(entity.id), 20)?;
        assert_eq!(
            observations.len(),
            DEFAULT_CONTEXT_GRAPH_OBSERVATION_RETENTION
        );
        assert_eq!(observations[0].summary, "completion summary 13");
        assert_eq!(observations.last().unwrap().summary, "completion summary 2");

        Ok(())
    }

    #[test]
    fn recall_context_entities_ranks_matching_entities() -> Result<()> {
        let tempdir = TestDir::new("store-context-recall")?;
        let db = StateStore::open(&tempdir.path().join("state.db"))?;
        let now = Utc::now();

        db.insert_session(&Session {
            id: "session-1".to_string(),
            task: "Investigate auth callback recovery".to_string(),
            project: "ecc-tools".to_string(),
            task_group: "incident".to_string(),
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

        let callback = db.upsert_context_entity(
            Some("session-1"),
            "file",
            "callback.ts",
            Some("src/routes/auth/callback.ts"),
            "Handles auth callback recovery and billing portal fallback",
            &BTreeMap::from([("area".to_string(), "auth".to_string())]),
        )?;
        let recovery = db.upsert_context_entity(
            Some("session-1"),
            "decision",
            "Use recovery-first callback routing",
            None,
            "Auth callback recovery should prefer the billing portal",
            &BTreeMap::new(),
        )?;
        let unrelated = db.upsert_context_entity(
            Some("session-1"),
            "file",
            "dashboard.rs",
            Some("ecc2/src/tui/dashboard.rs"),
            "Renders the TUI dashboard",
            &BTreeMap::new(),
        )?;

        db.upsert_context_relation(
            Some("session-1"),
            callback.id,
            recovery.id,
            "supports",
            "Callback route supports recovery-first routing",
        )?;
        db.upsert_context_relation(
            Some("session-1"),
            callback.id,
            unrelated.id,
            "references",
            "Callback route references the dashboard summary",
        )?;
        db.add_context_observation(
            Some("session-1"),
            recovery.id,
            "incident_note",
            ContextObservationPriority::High,
            true,
            "Previous auth callback recovery incident affected Viktor after a wipe",
            &BTreeMap::new(),
        )?;

        let results =
            db.recall_context_entities(Some("session-1"), "Investigate auth callback recovery", 3)?;

        assert_eq!(results.len(), 2);
        assert_eq!(results[0].entity.id, recovery.id);
        assert!(results[0].matched_terms.iter().any(|term| term == "auth"));
        assert!(results[0]
            .matched_terms
            .iter()
            .any(|term| term == "recovery"));
        assert_eq!(results[0].observation_count, 1);
        assert_eq!(
            results[0].max_observation_priority,
            ContextObservationPriority::High
        );
        assert!(results[0].has_pinned_observation);
        assert_eq!(results[1].entity.id, callback.id);
        assert!(results[1]
            .matched_terms
            .iter()
            .any(|term| term == "callback"));
        assert!(results[1]
            .matched_terms
            .iter()
            .any(|term| term == "recovery"));
        assert_eq!(results[1].relation_count, 2);
        assert_eq!(results[1].observation_count, 0);
        assert_eq!(
            results[1].max_observation_priority,
            ContextObservationPriority::Normal
        );
        assert!(!results[1].has_pinned_observation);
        assert!(!results.iter().any(|entry| entry.entity.id == unrelated.id));

        Ok(())
    }

    #[test]
    fn compact_context_graph_preserves_pinned_observations() -> Result<()> {
        let tempdir = TestDir::new("store-context-pinned-observations")?;
        let db = StateStore::open(&tempdir.path().join("state.db"))?;
        let now = Utc::now();

        db.insert_session(&Session {
            id: "session-1".to_string(),
            task: "deep memory".to_string(),
            project: "workspace".to_string(),
            task_group: "knowledge".to_string(),
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

        let entity = db.upsert_context_entity(
            Some("session-1"),
            "incident",
            "billing-recovery",
            None,
            "Recovery notes",
            &BTreeMap::new(),
        )?;

        db.add_context_observation(
            Some("session-1"),
            entity.id,
            "incident_note",
            ContextObservationPriority::High,
            true,
            "Pinned billing recovery memory",
            &BTreeMap::new(),
        )?;
        std::thread::sleep(std::time::Duration::from_millis(2));
        db.add_context_observation(
            Some("session-1"),
            entity.id,
            "incident_note",
            ContextObservationPriority::Normal,
            false,
            "Newest unpinned memory",
            &BTreeMap::new(),
        )?;

        let stats = db.compact_context_graph(None, 1)?;
        assert_eq!(stats.observations_retained, 2);

        let observations = db.list_context_observations(Some(entity.id), 10)?;
        assert_eq!(observations.len(), 2);
        assert!(observations.iter().any(|entry| entry.pinned));
        assert!(observations
            .iter()
            .any(|entry| entry.summary == "Pinned billing recovery memory"));
        assert!(observations
            .iter()
            .any(|entry| entry.summary == "Newest unpinned memory"));

        Ok(())
    }

    #[test]
    fn set_context_observation_pinned_updates_existing_observation() -> Result<()> {
        let tempdir = TestDir::new("store-context-pin-toggle")?;
        let db = StateStore::open(&tempdir.path().join("state.db"))?;
        let now = Utc::now();

        db.insert_session(&Session {
            id: "session-1".to_string(),
            task: "deep memory".to_string(),
            project: "workspace".to_string(),
            task_group: "knowledge".to_string(),
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

        let entity = db.upsert_context_entity(
            Some("session-1"),
            "incident",
            "billing-recovery",
            None,
            "Recovery notes",
            &BTreeMap::new(),
        )?;

        let observation = db.add_context_observation(
            Some("session-1"),
            entity.id,
            "incident_note",
            ContextObservationPriority::Normal,
            false,
            "Temporarily useful note",
            &BTreeMap::new(),
        )?;
        assert!(!observation.pinned);

        let pinned = db
            .set_context_observation_pinned(observation.id, true)?
            .expect("observation should exist");
        assert!(pinned.pinned);

        let unpinned = db
            .set_context_observation_pinned(observation.id, false)?
            .expect("observation should still exist");
        assert!(!unpinned.pinned);

        Ok(())
    }

    #[test]
    fn connector_checkpoint_summary_reports_synced_sources_and_timestamp() -> Result<()> {
        let tempdir = TestDir::new("store-connector-checkpoint-summary")?;
        let db = StateStore::open(&tempdir.path().join("state.db"))?;

        let empty = db.connector_checkpoint_summary("workspace_notes")?;
        assert_eq!(empty.connector_name, "workspace_notes");
        assert_eq!(empty.synced_sources, 0);
        assert!(empty.last_synced_at.is_none());

        db.upsert_connector_source_checkpoint(
            "workspace_notes",
            "/tmp/notes/incident.md",
            "sig-a",
        )?;
        db.upsert_connector_source_checkpoint("workspace_notes", "/tmp/notes/docs.md", "sig-b")?;

        let summary = db.connector_checkpoint_summary("workspace_notes")?;
        assert_eq!(summary.connector_name, "workspace_notes");
        assert_eq!(summary.synced_sources, 2);
        assert!(summary.last_synced_at.is_some());

        Ok(())
    }

    #[test]
    fn scheduled_tasks_round_trip_and_advance_runs() -> Result<()> {
        let tempdir = TestDir::new("store-scheduled-tasks")?;
        let db = StateStore::open(&tempdir.path().join("state.db"))?;
        let now = Utc::now();
        let due_next_run = now - ChronoDuration::minutes(1);

        let inserted = db.insert_scheduled_task(
            "*/15 * * * *",
            "Check backlog health",
            "claude",
            Some("planner"),
            tempdir.path(),
            "ecc-core",
            "scheduled maintenance",
            true,
            due_next_run,
        )?;

        let listed = db.list_scheduled_tasks()?;
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, inserted.id);
        assert_eq!(listed[0].profile_name.as_deref(), Some("planner"));

        let due = db.list_due_scheduled_tasks(now, 10)?;
        assert_eq!(due.len(), 1);
        assert_eq!(due[0].id, inserted.id);

        let advanced_next_run = now + ChronoDuration::minutes(15);
        db.record_scheduled_task_run(inserted.id, now, advanced_next_run)?;

        let refreshed = db
            .get_scheduled_task(inserted.id)?
            .context("scheduled task should still exist")?;
        assert_eq!(refreshed.last_run_at, Some(now));
        assert_eq!(refreshed.next_run_at, advanced_next_run);

        assert_eq!(db.delete_scheduled_task(inserted.id)?, 1);
        assert!(db.get_scheduled_task(inserted.id)?.is_none());

        Ok(())
    }

    #[test]
    fn context_graph_detail_includes_incoming_and_outgoing_relations() -> Result<()> {
        let tempdir = TestDir::new("store-context-relations")?;
        let db = StateStore::open(&tempdir.path().join("state.db"))?;
        let now = Utc::now();

        db.insert_session(&Session {
            id: "session-1".to_string(),
            task: "context graph".to_string(),
            project: "workspace".to_string(),
            task_group: "knowledge".to_string(),
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

        let file = db.upsert_context_entity(
            Some("session-1"),
            "file",
            "dashboard.rs",
            Some("ecc2/src/tui/dashboard.rs"),
            "",
            &BTreeMap::new(),
        )?;
        let function = db.upsert_context_entity(
            Some("session-1"),
            "function",
            "render_metrics",
            Some("ecc2/src/tui/dashboard.rs"),
            "",
            &BTreeMap::new(),
        )?;
        let decision = db.upsert_context_entity(
            Some("session-1"),
            "decision",
            "Persist graph in sqlite",
            None,
            "",
            &BTreeMap::new(),
        )?;

        db.upsert_context_relation(
            Some("session-1"),
            file.id,
            function.id,
            "contains",
            "Dashboard file contains metrics rendering logic",
        )?;
        db.upsert_context_relation(
            Some("session-1"),
            decision.id,
            function.id,
            "drives",
            "Storage choice drives the function implementation",
        )?;

        let detail = db
            .get_context_entity_detail(function.id, 10)?
            .expect("detail should exist");
        assert_eq!(detail.entity.name, "render_metrics");
        assert_eq!(detail.incoming.len(), 2);
        assert!(detail.outgoing.is_empty());

        let relation_types = detail
            .incoming
            .iter()
            .map(|relation| relation.relation_type.as_str())
            .collect::<Vec<_>>();
        assert!(relation_types.contains(&"contains"));
        assert!(relation_types.contains(&"drives"));

        let filtered_relations = db.list_context_relations(Some(function.id), 10)?;
        assert_eq!(filtered_relations.len(), 2);

        Ok(())
    }

    #[test]
    fn insert_decision_automatically_upserts_context_graph_entity() -> Result<()> {
        let tempdir = TestDir::new("store-context-decision-auto")?;
        let db = StateStore::open(&tempdir.path().join("state.db"))?;
        let now = Utc::now();

        db.insert_session(&Session {
            id: "session-1".to_string(),
            task: "context graph".to_string(),
            project: "workspace".to_string(),
            task_group: "knowledge".to_string(),
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

        db.insert_decision(
            "session-1",
            "Use sqlite for shared context",
            &["json files".to_string(), "memory only".to_string()],
            "SQLite keeps the graph queryable from CLI and TUI",
        )?;

        let entities = db.list_context_entities(Some("session-1"), Some("decision"), 10)?;
        assert_eq!(entities.len(), 1);
        assert_eq!(entities[0].name, "Use sqlite for shared context");
        assert_eq!(
            entities[0].metadata.get("alternatives_count"),
            Some(&"2".to_string())
        );
        assert!(entities[0]
            .summary
            .contains("SQLite keeps the graph queryable"));

        let session_entities = db.list_context_entities(Some("session-1"), Some("session"), 10)?;
        assert_eq!(session_entities.len(), 1);
        assert_eq!(session_entities[0].name, "session-1");
        assert_eq!(
            session_entities[0].metadata.get("task"),
            Some(&"context graph".to_string())
        );

        let relations = db.list_context_relations(Some(session_entities[0].id), 10)?;
        assert_eq!(relations.len(), 1);
        assert_eq!(relations[0].relation_type, "decided");
        assert_eq!(relations[0].to_entity_type, "decision");
        assert_eq!(relations[0].to_entity_name, "Use sqlite for shared context");

        Ok(())
    }

    #[test]
    fn sync_tool_activity_metrics_automatically_upserts_file_entities() -> Result<()> {
        let tempdir = TestDir::new("store-context-file-auto")?;
        let db = StateStore::open(&tempdir.path().join("state.db"))?;
        let now = Utc::now();

        db.insert_session(&Session {
            id: "session-1".to_string(),
            task: "context graph".to_string(),
            project: "workspace".to_string(),
            task_group: "knowledge".to_string(),
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

        let metrics_dir = tempdir.path().join(".claude/metrics");
        std::fs::create_dir_all(&metrics_dir)?;
        let metrics_path = metrics_dir.join("tool-usage.jsonl");
        std::fs::write(
            &metrics_path,
            "{\"id\":\"evt-1\",\"session_id\":\"session-1\",\"tool_name\":\"Edit\",\"input_summary\":\"Edit src/config.ts\",\"output_summary\":\"updated config\",\"file_events\":[{\"path\":\"src/config.ts\",\"action\":\"modify\",\"diff_preview\":\"old -> new\"}],\"timestamp\":\"2026-04-10T00:00:00Z\"}\n",
        )?;

        db.sync_tool_activity_metrics(&metrics_path)?;

        let entities = db.list_context_entities(Some("session-1"), Some("file"), 10)?;
        assert_eq!(entities.len(), 1);
        assert_eq!(entities[0].name, "config.ts");
        assert_eq!(entities[0].path.as_deref(), Some("src/config.ts"));
        assert_eq!(
            entities[0].metadata.get("last_action"),
            Some(&"modify".to_string())
        );
        assert_eq!(
            entities[0].metadata.get("last_tool"),
            Some(&"Edit".to_string())
        );
        assert!(entities[0]
            .summary
            .contains("Last activity: modify via Edit"));

        let session_entities = db.list_context_entities(Some("session-1"), Some("session"), 10)?;
        assert_eq!(session_entities.len(), 1);
        let relations = db.list_context_relations(Some(session_entities[0].id), 10)?;
        assert_eq!(relations.len(), 1);
        assert_eq!(relations[0].relation_type, "modify");
        assert_eq!(relations[0].to_entity_type, "file");
        assert_eq!(relations[0].to_entity_name, "config.ts");

        Ok(())
    }

    #[test]
    fn sync_context_graph_history_backfills_existing_activity() -> Result<()> {
        let tempdir = TestDir::new("store-context-backfill")?;
        let db = StateStore::open(&tempdir.path().join("state.db"))?;
        let now = Utc::now();

        db.insert_session(&Session {
            id: "session-1".to_string(),
            task: "context graph".to_string(),
            project: "workspace".to_string(),
            task_group: "knowledge".to_string(),
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

        db.conn.execute(
            "INSERT INTO decision_log (session_id, decision, alternatives_json, reasoning, timestamp)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![
                "session-1",
                "Backfill historical decision",
                "[]",
                "Historical reasoning",
                "2026-04-10T00:00:00Z",
            ],
        )?;
        db.conn.execute(
            "INSERT INTO tool_log (
                hook_event_id, session_id, tool_name, input_summary, input_params_json, output_summary,
                trigger_summary, duration_ms, risk_score, timestamp, file_paths_json, file_events_json
             )
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            rusqlite::params![
                "evt-backfill",
                "session-1",
                "Write",
                "Write src/backfill.rs",
                "{}",
                "updated file",
                "context graph",
                0i64,
                0.0f64,
                "2026-04-10T00:01:00Z",
                "[\"src/backfill.rs\"]",
                "[{\"path\":\"src/backfill.rs\",\"action\":\"modify\"}]",
            ],
        )?;
        db.conn.execute(
            "INSERT INTO messages (from_session, to_session, content, msg_type, timestamp)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![
                "session-1",
                "session-2",
                "{\"task\":\"Review backfill output\",\"context\":\"graph sync\"}",
                "task_handoff",
                "2026-04-10T00:02:00Z",
            ],
        )?;

        let stats = db.sync_context_graph_history(Some("session-1"), 10)?;
        assert_eq!(stats.sessions_scanned, 1);
        assert_eq!(stats.decisions_processed, 1);
        assert_eq!(stats.file_events_processed, 1);
        assert_eq!(stats.messages_processed, 1);

        let entities = db.list_context_entities(Some("session-1"), None, 10)?;
        assert!(entities
            .iter()
            .any(|entity| entity.entity_type == "decision"
                && entity.name == "Backfill historical decision"));
        assert!(entities.iter().any(|entity| entity.entity_type == "file"
            && entity.path.as_deref() == Some("src/backfill.rs")));
        let session_entity = entities
            .iter()
            .find(|entity| entity.entity_type == "session" && entity.name == "session-1")
            .expect("session entity should exist");
        let relations = db.list_context_relations(Some(session_entity.id), 10)?;
        assert_eq!(relations.len(), 3);
        assert!(relations
            .iter()
            .any(|relation| relation.relation_type == "decided"));
        assert!(relations
            .iter()
            .any(|relation| relation.relation_type == "modify"));
        assert!(relations
            .iter()
            .any(|relation| relation.relation_type == "delegates_to"));

        Ok(())
    }

    #[test]
    fn refresh_session_durations_updates_running_and_terminal_sessions() -> Result<()> {
        let tempdir = TestDir::new("store-duration-metrics")?;
        let db = StateStore::open(&tempdir.path().join("state.db"))?;
        let now = Utc::now();

        db.insert_session(&Session {
            id: "running-1".to_string(),
            task: "live run".to_string(),
            project: "workspace".to_string(),
            task_group: "general".to_string(),
            agent_type: "claude".to_string(),
            working_dir: PathBuf::from("/tmp"),
            state: SessionState::Running,
            pid: Some(1234),
            worktree: None,
            created_at: now - ChronoDuration::seconds(95),
            updated_at: now - ChronoDuration::seconds(1),
            last_heartbeat_at: now - ChronoDuration::seconds(1),
            metrics: SessionMetrics::default(),
        })?;
        db.insert_session(&Session {
            id: "done-1".to_string(),
            task: "finished run".to_string(),
            project: "workspace".to_string(),
            task_group: "general".to_string(),
            agent_type: "claude".to_string(),
            working_dir: PathBuf::from("/tmp"),
            state: SessionState::Completed,
            pid: None,
            worktree: None,
            created_at: now - ChronoDuration::seconds(80),
            updated_at: now - ChronoDuration::seconds(5),
            last_heartbeat_at: now - ChronoDuration::seconds(5),
            metrics: SessionMetrics::default(),
        })?;

        db.refresh_session_durations()?;

        let running = db
            .get_session("running-1")?
            .expect("running session should exist");
        let completed = db
            .get_session("done-1")?
            .expect("completed session should exist");

        assert!(running.metrics.duration_secs >= 95);
        assert!(completed.metrics.duration_secs >= 75);

        Ok(())
    }

    #[test]
    fn touch_heartbeat_updates_last_heartbeat_timestamp() -> Result<()> {
        let tempdir = TestDir::new("store-touch-heartbeat")?;
        let db = StateStore::open(&tempdir.path().join("state.db"))?;
        let now = Utc::now() - ChronoDuration::seconds(30);

        db.insert_session(&Session {
            id: "session-1".to_string(),
            task: "heartbeat".to_string(),
            project: "workspace".to_string(),
            task_group: "general".to_string(),
            agent_type: "claude".to_string(),
            working_dir: PathBuf::from("/tmp"),
            state: SessionState::Running,
            pid: Some(1234),
            worktree: None,
            created_at: now,
            updated_at: now,
            last_heartbeat_at: now,
            metrics: SessionMetrics::default(),
        })?;

        db.touch_heartbeat("session-1")?;

        let session = db
            .get_session("session-1")?
            .expect("session should still exist");
        assert!(session.last_heartbeat_at > now);

        Ok(())
    }

    #[test]
    fn append_output_line_keeps_latest_buffer_window() -> Result<()> {
        let tempdir = TestDir::new("store-output")?;
        let db = StateStore::open(&tempdir.path().join("state.db"))?;
        let now = Utc::now();

        db.insert_session(&Session {
            id: "session-1".to_string(),
            task: "buffer output".to_string(),
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

        for index in 0..(OUTPUT_BUFFER_LIMIT + 5) {
            db.append_output_line("session-1", OutputStream::Stdout, &format!("line-{index}"))?;
        }

        let lines = db.get_output_lines("session-1", OUTPUT_BUFFER_LIMIT)?;
        let texts: Vec<_> = lines.iter().map(|line| line.text.as_str()).collect();

        assert_eq!(lines.len(), OUTPUT_BUFFER_LIMIT);
        assert_eq!(texts.first().copied(), Some("line-5"));
        let expected_last_line = format!("line-{}", OUTPUT_BUFFER_LIMIT + 4);
        assert_eq!(texts.last().copied(), Some(expected_last_line.as_str()));

        Ok(())
    }

    #[test]
    fn message_round_trip_tracks_unread_counts_and_read_state() -> Result<()> {
        let tempdir = TestDir::new("store-messages")?;
        let db = StateStore::open(&tempdir.path().join("state.db"))?;

        db.insert_session(&build_session("planner", SessionState::Running))?;
        db.insert_session(&build_session("worker", SessionState::Pending))?;

        db.send_message(
            "planner",
            "worker",
            "{\"question\":\"Need context\"}",
            "query",
        )?;
        db.send_message(
            "worker",
            "planner",
            "{\"summary\":\"Finished pass\",\"files_changed\":[\"src/app.rs\"]}",
            "completed",
        )?;

        let unread = db.unread_message_counts()?;
        assert_eq!(unread.get("worker"), Some(&1));
        assert_eq!(unread.get("planner"), Some(&1));

        let worker_messages = db.list_messages_for_session("worker", 10)?;
        assert_eq!(worker_messages.len(), 2);
        assert_eq!(worker_messages[0].msg_type, "query");
        assert_eq!(worker_messages[1].msg_type, "completed");

        let updated = db.mark_messages_read("worker")?;
        assert_eq!(updated, 1);

        let unread_after = db.unread_message_counts()?;
        assert_eq!(unread_after.get("worker"), None);
        assert_eq!(unread_after.get("planner"), Some(&1));

        db.send_message(
            "planner",
            "worker-2",
            "{\"task\":\"Review auth flow\",\"context\":\"Delegated from planner\"}",
            "task_handoff",
        )?;
        db.send_message(
            "planner",
            "worker-3",
            "{\"task\":\"Check billing\",\"context\":\"Delegated from planner\",\"priority\":\"high\"}",
            "task_handoff",
        )?;
        db.send_message(
            "planner",
            "worker-4",
            "{\"task\":\"Low priority follow-up\",\"context\":\"Delegated from planner\",\"priority\":\"low\"}",
            "task_handoff",
        )?;
        db.send_message(
            "planner",
            "worker-4",
            "{\"task\":\"Critical production incident\",\"context\":\"Delegated from planner\",\"priority\":\"critical\"}",
            "task_handoff",
        )?;

        assert_eq!(
            db.latest_task_handoff_source("worker-2")?,
            Some("planner".to_string())
        );
        assert_eq!(
            db.delegated_children("planner", 10)?,
            vec![
                "worker-4".to_string(),
                "worker-3".to_string(),
                "worker-2".to_string(),
            ]
        );
        assert_eq!(
            db.unread_task_handoff_targets(10)?,
            vec![
                ("worker-4".to_string(), 2),
                ("worker-3".to_string(), 1),
                ("worker-2".to_string(), 1),
            ]
        );
        let worker_4_handoffs = db.unread_task_handoffs_for_session("worker-4", 10)?;
        assert_eq!(worker_4_handoffs.len(), 2);
        assert!(worker_4_handoffs[0]
            .content
            .contains("Critical production incident"));
        assert!(worker_4_handoffs[1]
            .content
            .contains("Low priority follow-up"));

        let planner_entities = db.list_context_entities(Some("planner"), Some("session"), 10)?;
        assert_eq!(planner_entities.len(), 1);
        let planner_relations = db.list_context_relations(Some(planner_entities[0].id), 10)?;
        assert!(planner_relations.iter().any(|relation| {
            relation.relation_type == "queries" && relation.to_entity_name == "worker"
        }));
        assert!(planner_relations.iter().any(|relation| {
            relation.relation_type == "delegates_to" && relation.to_entity_name == "worker-2"
        }));
        assert!(planner_relations.iter().any(|relation| {
            relation.relation_type == "delegates_to" && relation.to_entity_name == "worker-3"
        }));

        let worker_entity = db
            .list_context_entities(Some("worker"), Some("session"), 10)?
            .into_iter()
            .find(|entity| entity.name == "worker")
            .expect("worker session entity should exist");
        let worker_relations = db.list_context_relations(Some(worker_entity.id), 10)?;
        assert!(worker_relations.iter().any(|relation| {
            relation.relation_type == "completed_for" && relation.to_entity_name == "planner"
        }));

        Ok(())
    }

    #[test]
    fn approval_queue_counts_only_queries_and_conflicts() -> Result<()> {
        let tempdir = TestDir::new("store-approval-queue")?;
        let db = StateStore::open(&tempdir.path().join("state.db"))?;

        db.insert_session(&build_session("planner", SessionState::Running))?;
        db.insert_session(&build_session("worker", SessionState::Pending))?;
        db.insert_session(&build_session("worker-2", SessionState::Pending))?;

        db.send_message(
            "planner",
            "worker",
            "{\"question\":\"Need operator approval\"}",
            "query",
        )?;
        db.send_message(
            "planner",
            "worker",
            "{\"file\":\"src/main.rs\",\"description\":\"Merge conflict\"}",
            "conflict",
        )?;
        db.send_message(
            "worker",
            "planner",
            "{\"summary\":\"Finished pass\",\"files_changed\":[]}",
            "completed",
        )?;
        db.send_message(
            "planner",
            "worker-2",
            "{\"task\":\"Review auth flow\",\"context\":\"Delegated from planner\"}",
            "task_handoff",
        )?;

        let counts = db.unread_approval_counts()?;
        assert_eq!(counts.get("worker"), Some(&2));
        assert_eq!(counts.get("planner"), None);
        assert_eq!(counts.get("worker-2"), None);

        let queue = db.unread_approval_queue(10)?;
        assert_eq!(queue.len(), 2);
        assert_eq!(queue[0].msg_type, "query");
        assert_eq!(queue[1].msg_type, "conflict");

        Ok(())
    }

    #[test]
    fn daemon_activity_round_trips_latest_passes() -> Result<()> {
        let tempdir = TestDir::new("store-daemon-activity")?;
        let db = StateStore::open(&tempdir.path().join("state.db"))?;

        db.record_daemon_dispatch_pass(4, 1, 2)?;
        db.record_daemon_recovery_dispatch_pass(2, 1)?;
        db.record_daemon_rebalance_pass(3, 1)?;
        db.record_daemon_auto_merge_pass(2, 1, 1, 1, 0)?;
        db.record_daemon_auto_prune_pass(3, 1)?;

        let activity = db.daemon_activity()?;
        assert_eq!(activity.last_dispatch_routed, 4);
        assert_eq!(activity.last_dispatch_deferred, 1);
        assert_eq!(activity.last_dispatch_leads, 2);
        assert_eq!(activity.chronic_saturation_streak, 0);
        assert_eq!(activity.last_recovery_dispatch_routed, 2);
        assert_eq!(activity.last_recovery_dispatch_leads, 1);
        assert_eq!(activity.last_rebalance_rerouted, 3);
        assert_eq!(activity.last_rebalance_leads, 1);
        assert_eq!(activity.last_auto_merge_merged, 2);
        assert_eq!(activity.last_auto_merge_active_skipped, 1);
        assert_eq!(activity.last_auto_merge_conflicted_skipped, 1);
        assert_eq!(activity.last_auto_merge_dirty_skipped, 1);
        assert_eq!(activity.last_auto_merge_failed, 0);
        assert_eq!(activity.last_auto_prune_pruned, 3);
        assert_eq!(activity.last_auto_prune_active_skipped, 1);
        assert!(activity.last_dispatch_at.is_some());
        assert!(activity.last_recovery_dispatch_at.is_some());
        assert!(activity.last_rebalance_at.is_some());
        assert!(activity.last_auto_merge_at.is_some());
        assert!(activity.last_auto_prune_at.is_some());

        Ok(())
    }

    #[test]
    fn daemon_activity_detects_rebalance_first_mode() {
        let now = chrono::Utc::now();

        let clear = DaemonActivity::default();
        assert!(!clear.prefers_rebalance_first());
        assert!(!clear.dispatch_cooloff_active());
        assert!(clear.chronic_saturation_cleared_at().is_none());
        assert!(clear.stabilized_after_recovery_at().is_none());

        let unresolved = DaemonActivity {
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
        assert!(unresolved.prefers_rebalance_first());
        assert!(unresolved.dispatch_cooloff_active());
        assert!(unresolved.chronic_saturation_cleared_at().is_none());
        assert!(unresolved.stabilized_after_recovery_at().is_none());

        let persistent = DaemonActivity {
            last_dispatch_deferred: 1,
            chronic_saturation_streak: 3,
            ..unresolved.clone()
        };
        assert!(persistent.prefers_rebalance_first());
        assert!(persistent.dispatch_cooloff_active());
        assert!(!persistent.operator_escalation_required());

        let escalated = DaemonActivity {
            chronic_saturation_streak: 5,
            last_rebalance_rerouted: 0,
            ..persistent.clone()
        };
        assert!(escalated.operator_escalation_required());

        let recovered = DaemonActivity {
            last_recovery_dispatch_at: Some(now + chrono::Duration::seconds(1)),
            last_recovery_dispatch_routed: 1,
            chronic_saturation_streak: 0,
            ..unresolved
        };
        assert!(!recovered.prefers_rebalance_first());
        assert!(!recovered.dispatch_cooloff_active());
        assert_eq!(
            recovered.chronic_saturation_cleared_at(),
            recovered.last_recovery_dispatch_at.as_ref()
        );
        assert!(recovered.stabilized_after_recovery_at().is_none());

        let stabilized = DaemonActivity {
            last_dispatch_at: Some(now + chrono::Duration::seconds(2)),
            last_dispatch_routed: 2,
            last_dispatch_deferred: 0,
            last_dispatch_leads: 1,
            ..recovered
        };
        assert!(!stabilized.prefers_rebalance_first());
        assert!(!stabilized.dispatch_cooloff_active());
        assert!(stabilized.chronic_saturation_cleared_at().is_none());
        assert_eq!(
            stabilized.stabilized_after_recovery_at(),
            stabilized.last_dispatch_at.as_ref()
        );
    }

    #[test]
    fn daemon_activity_tracks_chronic_saturation_streak() -> Result<()> {
        let tempdir = TestDir::new("store-daemon-streak")?;
        let db = StateStore::open(&tempdir.path().join("state.db"))?;

        db.record_daemon_dispatch_pass(0, 1, 1)?;
        db.record_daemon_dispatch_pass(0, 1, 1)?;
        let saturated = db.daemon_activity()?;
        assert_eq!(saturated.chronic_saturation_streak, 2);
        assert!(!saturated.dispatch_cooloff_active());

        db.record_daemon_dispatch_pass(0, 1, 1)?;
        let chronic = db.daemon_activity()?;
        assert_eq!(chronic.chronic_saturation_streak, 3);
        assert!(chronic.dispatch_cooloff_active());

        db.record_daemon_recovery_dispatch_pass(1, 1)?;
        let recovered = db.daemon_activity()?;
        assert_eq!(recovered.chronic_saturation_streak, 0);

        Ok(())
    }
}
