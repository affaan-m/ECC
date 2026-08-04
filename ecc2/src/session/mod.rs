pub mod daemon;
pub mod manager;
pub mod output;
pub mod runtime;
pub mod store;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fmt;
use std::path::Path;
use std::path::PathBuf;

pub type SessionAgentProfile = crate::config::ResolvedAgentProfile;

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum HarnessKind {
    #[default]
    Unknown,
    Claude,
    Codex,
    OpenCode,
    Gemini,
    Cursor,
    Kiro,
    Trae,
    Zed,
    FactoryDroid,
    Windsurf,
}

impl HarnessKind {
    pub fn from_agent_type(agent_type: &str) -> Self {
        match agent_type.trim().to_ascii_lowercase().as_str() {
            "claude" | "claude-code" => Self::Claude,
            "codex" => Self::Codex,
            "opencode" => Self::OpenCode,
            "gemini" | "gemini-cli" => Self::Gemini,
            "cursor" => Self::Cursor,
            "kiro" => Self::Kiro,
            "trae" => Self::Trae,
            "zed" => Self::Zed,
            "factory-droid" | "factory_droid" | "factorydroid" => Self::FactoryDroid,
            "windsurf" => Self::Windsurf,
            _ => Self::Unknown,
        }
    }

    pub fn from_db_value(value: &str) -> Self {
        match value.trim().to_ascii_lowercase().as_str() {
            "claude" => Self::Claude,
            "codex" => Self::Codex,
            "opencode" => Self::OpenCode,
            "gemini" => Self::Gemini,
            "cursor" => Self::Cursor,
            "kiro" => Self::Kiro,
            "trae" => Self::Trae,
            "zed" => Self::Zed,
            "factory_droid" => Self::FactoryDroid,
            "windsurf" => Self::Windsurf,
            _ => Self::Unknown,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Unknown => "unknown",
            Self::Claude => "claude",
            Self::Codex => "codex",
            Self::OpenCode => "opencode",
            Self::Gemini => "gemini",
            Self::Cursor => "cursor",
            Self::Kiro => "kiro",
            Self::Trae => "trae",
            Self::Zed => "zed",
            Self::FactoryDroid => "factory_droid",
            Self::Windsurf => "windsurf",
        }
    }

    pub fn canonical_agent_type(agent_type: &str) -> String {
        match Self::from_agent_type(agent_type) {
            Self::Unknown => agent_type.trim().to_ascii_lowercase(),
            harness => harness.as_str().to_string(),
        }
    }

    fn supports_direct_execution(self) -> bool {
        matches!(
            self,
            Self::Claude | Self::Codex | Self::OpenCode | Self::Gemini
        )
    }

    fn project_markers(self) -> &'static [&'static str] {
        match self {
            Self::Claude => &[".claude"],
            Self::Codex => &[".codex", ".codex-plugin"],
            Self::OpenCode => &[".opencode"],
            Self::Gemini => &[".gemini"],
            Self::Cursor => &[".cursor"],
            Self::Kiro => &[".kiro"],
            Self::Trae => &[".trae"],
            Self::Zed => &[".zed"],
            Self::FactoryDroid => &[".factory-droid", ".factory_droid"],
            Self::Windsurf => &[".windsurf"],
            Self::Unknown => &[],
        }
    }
}

impl fmt::Display for HarnessKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct SessionHarnessInfo {
    pub primary: HarnessKind,
    pub primary_label: String,
    pub detected: Vec<HarnessKind>,
    pub detected_labels: Vec<String>,
}

impl SessionHarnessInfo {
    fn detected_labels_for(detected: &[HarnessKind]) -> Vec<String> {
        detected.iter().map(|harness| harness.to_string()).collect()
    }

    fn configured_detected_labels(cfg: &crate::config::Config, working_dir: &Path) -> Vec<String> {
        let mut labels = Vec::new();
        for (name, runner) in &cfg.harness_runners {
            if runner.project_markers.is_empty() {
                continue;
            }
            if runner
                .project_markers
                .iter()
                .any(|marker| working_dir.join(marker).exists())
            {
                let label = Self::runner_key(name);
                if !label.is_empty() && !labels.contains(&label) {
                    labels.push(label);
                }
            }
        }
        labels
    }

    pub fn runner_key(agent_type: &str) -> String {
        let canonical = HarnessKind::canonical_agent_type(agent_type);
        match HarnessKind::from_agent_type(&canonical) {
            HarnessKind::Unknown if canonical.is_empty() => {
                HarnessKind::Unknown.as_str().to_string()
            }
            HarnessKind::Unknown => canonical,
            harness => harness.as_str().to_string(),
        }
    }

    fn primary_label_for(agent_type: &str, primary: HarnessKind) -> String {
        match primary {
            HarnessKind::Unknown => {
                let label = Self::runner_key(agent_type);
                if label.is_empty() {
                    HarnessKind::Unknown.as_str().to_string()
                } else {
                    label
                }
            }
            harness => harness.as_str().to_string(),
        }
    }

    pub fn detect(agent_type: &str, working_dir: &Path) -> Self {
        let runner_key = Self::runner_key(agent_type);
        let detected = [
            HarnessKind::Claude,
            HarnessKind::Codex,
            HarnessKind::OpenCode,
            HarnessKind::Gemini,
            HarnessKind::Cursor,
            HarnessKind::Kiro,
            HarnessKind::Trae,
            HarnessKind::Zed,
            HarnessKind::FactoryDroid,
            HarnessKind::Windsurf,
        ]
        .into_iter()
        .filter(|harness| {
            harness
                .project_markers()
                .iter()
                .any(|marker| working_dir.join(marker).exists())
        })
        .collect::<Vec<_>>();

        let primary = match HarnessKind::from_agent_type(&runner_key) {
            HarnessKind::Unknown if runner_key == HarnessKind::Unknown.as_str() => {
                detected.first().copied().unwrap_or(HarnessKind::Unknown)
            }
            HarnessKind::Unknown => HarnessKind::Unknown,
            harness => harness,
        };

        let detected_labels = Self::detected_labels_for(&detected);
        Self {
            primary,
            primary_label: Self::primary_label_for(agent_type, primary),
            detected,
            detected_labels,
        }
    }

    pub fn from_persisted(
        harness_label: &str,
        agent_type: &str,
        working_dir: &Path,
        detected: Vec<HarnessKind>,
    ) -> Self {
        let primary = HarnessKind::from_db_value(harness_label);
        if primary == HarnessKind::Unknown && detected.is_empty() && harness_label.trim().is_empty()
        {
            return Self::detect(agent_type, working_dir);
        }

        let normalized_label = harness_label.trim().to_ascii_lowercase();
        let detected_labels = Self::detected_labels_for(&detected);
        Self {
            primary,
            primary_label: if normalized_label.is_empty() {
                Self::primary_label_for(agent_type, primary)
            } else {
                normalized_label
            },
            detected,
            detected_labels,
        }
    }

    pub fn with_config_detection(
        mut self,
        cfg: &crate::config::Config,
        working_dir: &Path,
    ) -> Self {
        for label in Self::configured_detected_labels(cfg, working_dir) {
            if !self.detected_labels.contains(&label) {
                self.detected_labels.push(label);
            }
        }

        if self.primary == HarnessKind::Unknown
            && self.primary_label == HarnessKind::Unknown.as_str()
            && !self.detected_labels.is_empty()
        {
            self.primary_label = self.detected_labels[0].clone();
        }

        self
    }

    pub fn resolve_requested_agent_type(
        cfg: &crate::config::Config,
        requested_agent_type: &str,
        working_dir: &Path,
    ) -> String {
        let canonical = HarnessKind::canonical_agent_type(requested_agent_type);
        if !canonical.is_empty() && canonical != "auto" {
            return canonical;
        }

        let detected = Self::detect("", working_dir).with_config_detection(cfg, working_dir);
        if detected.primary_label != HarnessKind::Unknown.as_str()
            && Self::can_launch_detected_label(cfg, &detected.primary_label)
        {
            return Self::runner_key(&detected.primary_label);
        }

        for label in &detected.detected_labels {
            if Self::can_launch_detected_label(cfg, label) {
                return Self::runner_key(label);
            }
        }

        HarnessKind::Claude.as_str().to_string()
    }

    fn can_launch_detected_label(cfg: &crate::config::Config, label: &str) -> bool {
        cfg.harness_runner(label).is_some()
            || HarnessKind::from_agent_type(label).supports_direct_execution()
    }

    pub fn detected_summary(&self) -> String {
        if self.detected_labels.is_empty() {
            "none detected".to_string()
        } else {
            self.detected_labels.join(", ")
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    pub id: String,
    pub task: String,
    pub project: String,
    pub task_group: String,
    pub agent_type: String,
    pub working_dir: PathBuf,
    pub state: SessionState,
    pub pid: Option<u32>,
    pub worktree: Option<WorktreeInfo>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub last_heartbeat_at: DateTime<Utc>,
    pub metrics: SessionMetrics,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum SessionState {
    Pending,
    Running,
    Idle,
    Stale,
    Completed,
    Failed,
    Stopped,
}

impl fmt::Display for SessionState {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            SessionState::Pending => write!(f, "pending"),
            SessionState::Running => write!(f, "running"),
            SessionState::Idle => write!(f, "idle"),
            SessionState::Stale => write!(f, "stale"),
            SessionState::Completed => write!(f, "completed"),
            SessionState::Failed => write!(f, "failed"),
            SessionState::Stopped => write!(f, "stopped"),
        }
    }
}

impl SessionState {
    pub fn can_transition_to(&self, next: &Self) -> bool {
        if self == next {
            return true;
        }

        matches!(
            (self, next),
            (
                SessionState::Pending,
                SessionState::Running | SessionState::Failed | SessionState::Stopped
            ) | (
                SessionState::Running,
                SessionState::Idle
                    | SessionState::Stale
                    | SessionState::Completed
                    | SessionState::Failed
                    | SessionState::Stopped
            ) | (
                SessionState::Idle,
                SessionState::Running
                    | SessionState::Stale
                    | SessionState::Completed
                    | SessionState::Failed
                    | SessionState::Stopped
            ) | (
                SessionState::Stale,
                SessionState::Running
                    | SessionState::Idle
                    | SessionState::Completed
                    | SessionState::Failed
                    | SessionState::Stopped
            ) | (SessionState::Completed, SessionState::Stopped)
                | (SessionState::Failed, SessionState::Stopped)
        )
    }

    pub fn from_db_value(value: &str) -> Self {
        match value {
            "running" => SessionState::Running,
            "idle" => SessionState::Idle,
            "stale" => SessionState::Stale,
            "completed" => SessionState::Completed,
            "failed" => SessionState::Failed,
            "stopped" => SessionState::Stopped,
            _ => SessionState::Pending,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorktreeInfo {
    pub path: PathBuf,
    pub branch: String,
    pub base_branch: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SessionMetrics {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub tokens_used: u64,
    pub tool_calls: u64,
    pub files_changed: u32,
    pub duration_secs: u64,
    pub cost_usd: f64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct SessionBoardMeta {
    pub lane: String,
    pub project: Option<String>,
    pub feature: Option<String>,
    pub issue: Option<String>,
    pub row_label: Option<String>,
    pub previous_lane: Option<String>,
    pub previous_row_label: Option<String>,
    pub column_index: i64,
    pub row_index: i64,
    pub stack_index: i64,
    pub progress_percent: i64,
    pub status_detail: Option<String>,
    pub movement_note: Option<String>,
    pub activity_kind: Option<String>,
    pub activity_note: Option<String>,
    pub handoff_backlog: i64,
    pub conflict_signal: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionMessage {
    pub id: i64,
    pub from_session: String,
    pub to_session: String,
    pub content: String,
    pub msg_type: String,
    pub read: bool,
    pub timestamp: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ScheduledTask {
    pub id: i64,
    pub cron_expr: String,
    pub task: String,
    pub agent_type: String,
    pub profile_name: Option<String>,
    pub working_dir: PathBuf,
    pub project: String,
    pub task_group: String,
    pub use_worktree: bool,
    pub last_run_at: Option<DateTime<Utc>>,
    pub next_run_at: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RemoteDispatchRequest {
    pub id: i64,
    pub request_kind: RemoteDispatchKind,
    pub target_session_id: Option<String>,
    pub task: String,
    pub target_url: Option<String>,
    pub priority: crate::comms::TaskPriority,
    pub agent_type: String,
    pub profile_name: Option<String>,
    pub working_dir: PathBuf,
    pub project: String,
    pub task_group: String,
    pub use_worktree: bool,
    pub source: String,
    pub requester: Option<String>,
    pub status: RemoteDispatchStatus,
    pub result_session_id: Option<String>,
    pub result_action: Option<String>,
    pub error: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub dispatched_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RemoteDispatchKind {
    Standard,
    ComputerUse,
}

impl fmt::Display for RemoteDispatchKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Standard => write!(f, "standard"),
            Self::ComputerUse => write!(f, "computer_use"),
        }
    }
}

impl RemoteDispatchKind {
    pub fn from_db_value(value: &str) -> Self {
        match value {
            "computer_use" => Self::ComputerUse,
            _ => Self::Standard,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RemoteDispatchStatus {
    Pending,
    Dispatched,
    Failed,
}

impl fmt::Display for RemoteDispatchStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Pending => write!(f, "pending"),
            Self::Dispatched => write!(f, "dispatched"),
            Self::Failed => write!(f, "failed"),
        }
    }
}

impl RemoteDispatchStatus {
    pub fn from_db_value(value: &str) -> Self {
        match value {
            "dispatched" => Self::Dispatched,
            "failed" => Self::Failed,
            _ => Self::Pending,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FileActivityEntry {
    pub session_id: String,
    pub action: FileActivityAction,
    pub path: String,
    pub summary: String,
    pub diff_preview: Option<String>,
    pub patch_preview: Option<String>,
    pub timestamp: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DecisionLogEntry {
    pub id: i64,
    pub session_id: String,
    pub decision: String,
    pub alternatives: Vec<String>,
    pub reasoning: String,
    pub timestamp: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ContextGraphEntity {
    pub id: i64,
    pub session_id: Option<String>,
    pub entity_type: String,
    pub name: String,
    pub path: Option<String>,
    pub summary: String,
    pub metadata: BTreeMap<String, String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ContextGraphRelation {
    pub id: i64,
    pub session_id: Option<String>,
    pub from_entity_id: i64,
    pub from_entity_type: String,
    pub from_entity_name: String,
    pub to_entity_id: i64,
    pub to_entity_type: String,
    pub to_entity_name: String,
    pub relation_type: String,
    pub summary: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ContextGraphEntityDetail {
    pub entity: ContextGraphEntity,
    pub outgoing: Vec<ContextGraphRelation>,
    pub incoming: Vec<ContextGraphRelation>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ContextGraphObservation {
    pub id: i64,
    pub session_id: Option<String>,
    pub entity_id: i64,
    pub entity_type: String,
    pub entity_name: String,
    pub observation_type: String,
    pub priority: ContextObservationPriority,
    pub pinned: bool,
    pub summary: String,
    pub details: BTreeMap<String, String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ContextGraphRecallEntry {
    pub entity: ContextGraphEntity,
    pub score: u64,
    pub matched_terms: Vec<String>,
    pub relation_count: usize,
    pub observation_count: usize,
    pub max_observation_priority: ContextObservationPriority,
    pub has_pinned_observation: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum ContextObservationPriority {
    Low,
    Normal,
    High,
    Critical,
}

impl Default for ContextObservationPriority {
    fn default() -> Self {
        Self::Normal
    }
}

impl fmt::Display for ContextObservationPriority {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Low => write!(f, "low"),
            Self::Normal => write!(f, "normal"),
            Self::High => write!(f, "high"),
            Self::Critical => write!(f, "critical"),
        }
    }
}

impl ContextObservationPriority {
    pub fn from_db_value(value: i64) -> Self {
        match value {
            0 => Self::Low,
            2 => Self::High,
            3 => Self::Critical,
            _ => Self::Normal,
        }
    }

    pub fn as_db_value(self) -> i64 {
        match self {
            Self::Low => 0,
            Self::Normal => 1,
            Self::High => 2,
            Self::Critical => 3,
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct ContextGraphSyncStats {
    pub sessions_scanned: usize,
    pub decisions_processed: usize,
    pub file_events_processed: usize,
    pub messages_processed: usize,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct ContextGraphCompactionStats {
    pub entities_scanned: usize,
    pub duplicate_observations_deleted: usize,
    pub overflow_observations_deleted: usize,
    pub observations_retained: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FileActivityAction {
    Read,
    Create,
    Modify,
    Move,
    Delete,
    Touch,
}

pub fn normalize_group_label(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

pub fn default_project_label(working_dir: &Path) -> String {
    working_dir
        .file_name()
        .and_then(|value| value.to_str())
        .and_then(normalize_group_label)
        .unwrap_or_else(|| "workspace".to_string())
}

pub fn default_task_group_label(task: &str) -> String {
    normalize_group_label(task).unwrap_or_else(|| "general".to_string())
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct SessionGrouping {
    pub project: Option<String>,
    pub task_group: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    struct TestDir {
        path: PathBuf,
    }

    impl TestDir {
        fn new(label: &str) -> Result<Self, Box<dyn std::error::Error>> {
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

    #[test]
    fn detect_session_harness_prefers_agent_type_and_collects_project_markers(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let repo = TestDir::new("session-harness-detect")?;
        fs::create_dir_all(repo.path().join(".codex"))?;
        fs::create_dir_all(repo.path().join(".claude"))?;

        let harness = SessionHarnessInfo::detect("claude", repo.path());
        assert_eq!(harness.primary, HarnessKind::Claude);
        assert_eq!(harness.primary_label, "claude");
        assert_eq!(
            harness.detected,
            vec![HarnessKind::Claude, HarnessKind::Codex]
        );
        assert_eq!(harness.detected_labels, vec!["claude", "codex"]);
        assert_eq!(harness.detected_summary(), "claude, codex");
        Ok(())
    }

    #[test]
    fn detect_session_harness_falls_back_to_project_markers_when_agent_unspecified(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let repo = TestDir::new("session-harness-markers")?;
        fs::create_dir_all(repo.path().join(".gemini"))?;

        let harness = SessionHarnessInfo::detect("", repo.path());
        assert_eq!(harness.primary, HarnessKind::Gemini);
        assert_eq!(harness.primary_label, "gemini");
        assert_eq!(harness.detected, vec![HarnessKind::Gemini]);
        assert_eq!(harness.detected_labels, vec!["gemini"]);
        Ok(())
    }

    #[test]
    fn detect_session_harness_collects_extended_builtin_markers(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let repo = TestDir::new("session-harness-extended-markers")?;
        fs::create_dir_all(repo.path().join(".zed"))?;
        fs::create_dir_all(repo.path().join(".factory-droid"))?;
        fs::create_dir_all(repo.path().join(".windsurf"))?;

        let harness = SessionHarnessInfo::detect("", repo.path());
        assert_eq!(harness.primary, HarnessKind::Zed);
        assert_eq!(harness.primary_label, "zed");
        assert_eq!(
            harness.detected,
            vec![
                HarnessKind::Zed,
                HarnessKind::FactoryDroid,
                HarnessKind::Windsurf
            ]
        );
        assert_eq!(
            harness.detected_labels,
            vec!["zed", "factory_droid", "windsurf"]
        );
        Ok(())
    }

    #[test]
    fn canonical_agent_type_normalizes_known_aliases() {
        assert_eq!(HarnessKind::canonical_agent_type("claude-code"), "claude");
        assert_eq!(HarnessKind::canonical_agent_type("gemini-cli"), "gemini");
        assert_eq!(
            HarnessKind::canonical_agent_type("factory-droid"),
            "factory_droid"
        );
        assert_eq!(
            HarnessKind::canonical_agent_type(" custom-runner "),
            "custom-runner"
        );
    }

    #[test]
    fn detect_session_harness_preserves_custom_agent_label_without_markers() {
        let harness = SessionHarnessInfo::detect(" custom-runner ", Path::new("."));
        assert_eq!(harness.primary, HarnessKind::Unknown);
        assert_eq!(harness.primary_label, "custom-runner");
        assert!(harness.detected.is_empty());
        assert!(harness.detected_labels.is_empty());
    }

    #[test]
    fn detect_session_harness_preserves_custom_agent_label_with_project_markers(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let repo = TestDir::new("session-harness-custom-markers")?;
        fs::create_dir_all(repo.path().join(".claude"))?;
        fs::create_dir_all(repo.path().join(".codex"))?;

        let harness = SessionHarnessInfo::detect("custom-runner", repo.path());
        assert_eq!(harness.primary, HarnessKind::Unknown);
        assert_eq!(harness.primary_label, "custom-runner");
        assert_eq!(
            harness.detected,
            vec![HarnessKind::Claude, HarnessKind::Codex]
        );
        assert_eq!(harness.detected_labels, vec!["claude", "codex"]);
        Ok(())
    }

    #[test]
    fn config_detection_adds_custom_markers_to_detected_summary(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let repo = TestDir::new("session-harness-custom-config")?;
        fs::create_dir_all(repo.path().join(".acme"))?;
        let mut cfg = crate::config::Config::default();
        cfg.harness_runners.insert(
            "acme-runner".to_string(),
            crate::config::HarnessRunnerConfig {
                project_markers: vec![PathBuf::from(".acme")],
                ..Default::default()
            },
        );

        let harness =
            SessionHarnessInfo::detect("", repo.path()).with_config_detection(&cfg, repo.path());
        assert_eq!(harness.primary, HarnessKind::Unknown);
        assert_eq!(harness.primary_label, "acme-runner");
        assert_eq!(harness.detected_labels, vec!["acme-runner"]);
        assert_eq!(harness.detected_summary(), "acme-runner");
        Ok(())
    }

    #[test]
    fn config_detection_preserves_custom_primary_label_and_appends_marker_matches(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let repo = TestDir::new("session-harness-config-append")?;
        fs::create_dir_all(repo.path().join(".acme"))?;
        fs::create_dir_all(repo.path().join(".codex"))?;
        let mut cfg = crate::config::Config::default();
        cfg.harness_runners.insert(
            "acme-runner".to_string(),
            crate::config::HarnessRunnerConfig {
                project_markers: vec![PathBuf::from(".acme")],
                ..Default::default()
            },
        );

        let harness = SessionHarnessInfo::detect("acme-runner", repo.path())
            .with_config_detection(&cfg, repo.path());
        assert_eq!(harness.primary, HarnessKind::Unknown);
        assert_eq!(harness.primary_label, "acme-runner");
        assert_eq!(harness.detected_labels, vec!["codex", "acme-runner"]);
        assert_eq!(harness.detected_summary(), "codex, acme-runner");
        Ok(())
    }

    #[test]
    fn runner_key_uses_canonical_label_for_unknown_harnesses() {
        assert_eq!(
            SessionHarnessInfo::runner_key(" custom-runner "),
            "custom-runner"
        );
        assert_eq!(SessionHarnessInfo::runner_key("claude-code"), "claude");
    }

    #[test]
    fn resolve_requested_agent_type_uses_detected_builtin_marker_for_auto(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let repo = TestDir::new("session-harness-resolve-auto-built-in")?;
        fs::create_dir_all(repo.path().join(".codex"))?;

        let resolved = SessionHarnessInfo::resolve_requested_agent_type(
            &crate::config::Config::default(),
            "auto",
            repo.path(),
        );
        assert_eq!(resolved, "codex");
        Ok(())
    }

    #[test]
    fn resolve_requested_agent_type_uses_configured_marker_for_auto(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let repo = TestDir::new("session-harness-resolve-auto-custom")?;
        fs::create_dir_all(repo.path().join(".acme"))?;
        let mut cfg = crate::config::Config::default();
        cfg.harness_runners.insert(
            "acme-runner".to_string(),
            crate::config::HarnessRunnerConfig {
                project_markers: vec![PathBuf::from(".acme")],
                ..Default::default()
            },
        );

        let resolved = SessionHarnessInfo::resolve_requested_agent_type(&cfg, "auto", repo.path());
        assert_eq!(resolved, "acme-runner");
        Ok(())
    }

    #[test]
    fn resolve_requested_agent_type_skips_nonlaunchable_builtin_markers_without_runner(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let repo = TestDir::new("session-harness-resolve-auto-nonlaunchable")?;
        fs::create_dir_all(repo.path().join(".zed"))?;

        let resolved = SessionHarnessInfo::resolve_requested_agent_type(
            &crate::config::Config::default(),
            "auto",
            repo.path(),
        );
        assert_eq!(resolved, "claude");
        Ok(())
    }

    #[test]
    fn resolve_requested_agent_type_uses_configured_runner_for_extended_builtin_markers(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let repo = TestDir::new("session-harness-resolve-auto-extended-runner")?;
        fs::create_dir_all(repo.path().join(".windsurf"))?;
        let mut cfg = crate::config::Config::default();
        cfg.harness_runners.insert(
            "windsurf".to_string(),
            crate::config::HarnessRunnerConfig {
                program: "windsurf".to_string(),
                ..Default::default()
            },
        );

        let resolved = SessionHarnessInfo::resolve_requested_agent_type(&cfg, "auto", repo.path());
        assert_eq!(resolved, "windsurf");
        Ok(())
    }

    #[test]
    fn resolve_requested_agent_type_falls_back_to_claude_without_markers() {
        let resolved = SessionHarnessInfo::resolve_requested_agent_type(
            &crate::config::Config::default(),
            "auto",
            Path::new("."),
        );
        assert_eq!(resolved, "claude");
    }
}
