use anyhow::{bail, Result};
use serde::{Deserialize, Serialize};

use crate::config::{Config, RiskThresholds};
use crate::session::store::StateStore;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCallEvent {
    pub session_id: String,
    pub tool_name: String,
    pub input_summary: String,
    pub input_params_json: String,
    pub output_summary: String,
    pub trigger_summary: String,
    pub duration_ms: u64,
    pub risk_score: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RiskAssessment {
    pub score: f64,
    pub reasons: Vec<String>,
    pub suggested_action: SuggestedAction,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SuggestedAction {
    Allow,
    Review,
    RequireConfirmation,
    Block,
}

impl ToolCallEvent {
    pub fn new(
        session_id: impl Into<String>,
        tool_name: impl Into<String>,
        input_summary: impl Into<String>,
        output_summary: impl Into<String>,
        duration_ms: u64,
    ) -> Self {
        let tool_name = tool_name.into();
        let input_summary = input_summary.into();

        Self {
            session_id: session_id.into(),
            risk_score: Self::compute_risk(&tool_name, &input_summary, &Config::RISK_THRESHOLDS)
                .score,
            tool_name,
            input_summary,
            input_params_json: "{}".to_string(),
            output_summary: output_summary.into(),
            trigger_summary: String::new(),
            duration_ms,
        }
    }

    /// Compute risk from the tool type and input characteristics.
    pub fn compute_risk(
        tool_name: &str,
        input: &str,
        thresholds: &RiskThresholds,
    ) -> RiskAssessment {
        let normalized_tool = tool_name.to_ascii_lowercase();
        let normalized_input = input.to_ascii_lowercase();
        let mut score = 0.0;
        let mut reasons = Vec::new();

        let (base_score, base_reason) = base_tool_risk(&normalized_tool);
        score += base_score;
        if let Some(reason) = base_reason {
            reasons.push(reason.to_string());
        }

        let (file_sensitivity_score, file_sensitivity_reason) =
            assess_file_sensitivity(&normalized_input);
        score += file_sensitivity_score;
        if let Some(reason) = file_sensitivity_reason {
            reasons.push(reason);
        }

        let (blast_radius_score, blast_radius_reason) = assess_blast_radius(&normalized_input);
        score += blast_radius_score;
        if let Some(reason) = blast_radius_reason {
            reasons.push(reason);
        }

        let (irreversibility_score, irreversibility_reason) =
            assess_irreversibility(&normalized_input);
        score += irreversibility_score;
        if let Some(reason) = irreversibility_reason {
            reasons.push(reason);
        }

        let score = score.clamp(0.0, 1.0);
        let suggested_action = SuggestedAction::from_score(score, thresholds);

        RiskAssessment {
            score,
            reasons,
            suggested_action,
        }
    }
}

impl SuggestedAction {
    fn from_score(score: f64, thresholds: &RiskThresholds) -> Self {
        if score >= thresholds.block {
            Self::Block
        } else if score >= thresholds.confirm {
            Self::RequireConfirmation
        } else if score >= thresholds.review {
            Self::Review
        } else {
            Self::Allow
        }
    }
}

fn base_tool_risk(tool_name: &str) -> (f64, Option<&'static str>) {
    match tool_name {
        "bash" => (
            0.20,
            Some("shell execution can modify local or shared state"),
        ),
        "write" | "multiedit" => (0.15, Some("writes files directly")),
        "edit" => (0.10, Some("modifies existing files")),
        _ => (0.05, None),
    }
}

fn assess_file_sensitivity(input: &str) -> (f64, Option<String>) {
    const SECRET_PATTERNS: &[&str] = &[
        ".env",
        "secret",
        "credential",
        "token",
        "api_key",
        "apikey",
        "auth",
        "id_rsa",
        ".pem",
        ".key",
    ];
    const SHARED_INFRA_PATTERNS: &[&str] = &[
        "cargo.toml",
        "package.json",
        "dockerfile",
        ".github/workflows",
        "schema",
        "migration",
        "production",
    ];

    if contains_any(input, SECRET_PATTERNS) {
        (
            0.25,
            Some("targets a sensitive file or credential surface".to_string()),
        )
    } else if contains_any(input, SHARED_INFRA_PATTERNS) {
        (
            0.15,
            Some("targets shared infrastructure or release-critical files".to_string()),
        )
    } else {
        (0.0, None)
    }
}

fn assess_blast_radius(input: &str) -> (f64, Option<String>) {
    const LARGE_SCOPE_PATTERNS: &[&str] = &[
        "**",
        "/*",
        "--all",
        "--recursive",
        "entire repo",
        "all files",
        "across src/",
        "find ",
        " xargs ",
    ];
    const SHARED_STATE_PATTERNS: &[&str] = &[
        "git push --force",
        "git push -f",
        "origin main",
        "origin master",
        "rm -rf .",
        "rm -rf /",
    ];

    if contains_any(input, SHARED_STATE_PATTERNS) {
        (
            0.35,
            Some("has a broad blast radius across shared state or history".to_string()),
        )
    } else if contains_any(input, LARGE_SCOPE_PATTERNS) {
        (
            0.25,
            Some("has a broad blast radius across multiple files or directories".to_string()),
        )
    } else {
        (0.0, None)
    }
}

fn assess_irreversibility(input: &str) -> (f64, Option<String>) {
    const HIGH_IRREVERSIBILITY_PATTERNS: &[&str] = &[
        "rm -rf",
        "git reset --hard",
        "git clean -fd",
        "drop database",
        "drop table",
        "truncate ",
        "shred ",
    ];
    const MODERATE_IRREVERSIBILITY_PATTERNS: &[&str] =
        &["rm -f", "git push --force", "git push -f", "delete from"];

    if contains_any(input, HIGH_IRREVERSIBILITY_PATTERNS) {
        (
            0.45,
            Some("includes an irreversible or destructive operation".to_string()),
        )
    } else if contains_any(input, MODERATE_IRREVERSIBILITY_PATTERNS) {
        (
            0.40,
            Some("includes an irreversible or difficult-to-undo operation".to_string()),
        )
    } else {
        (0.0, None)
    }
}

fn contains_any(input: &str, patterns: &[&str]) -> bool {
    patterns.iter().any(|pattern| input.contains(pattern))
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ToolLogEntry {
    pub id: i64,
    pub session_id: String,
    pub tool_name: String,
    pub input_summary: String,
    pub input_params_json: String,
    pub output_summary: String,
    pub trigger_summary: String,
    pub duration_ms: u64,
    pub risk_score: f64,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ToolLogPage {
    pub entries: Vec<ToolLogEntry>,
    pub page: u64,
    pub page_size: u64,
    pub total: u64,
}

pub struct ToolLogger<'a> {
    db: &'a StateStore,
}

impl<'a> ToolLogger<'a> {
    pub fn new(db: &'a StateStore) -> Self {
        Self { db }
    }

    pub fn log(&self, event: &ToolCallEvent) -> Result<ToolLogEntry> {
        let timestamp = chrono::Utc::now().to_rfc3339();

        self.db.insert_tool_log(
            &event.session_id,
            &event.tool_name,
            &event.input_summary,
            &event.input_params_json,
            &event.output_summary,
            &event.trigger_summary,
            event.duration_ms,
            event.risk_score,
            &timestamp,
        )
    }

    pub fn query(&self, session_id: &str, page: u64, page_size: u64) -> Result<ToolLogPage> {
        if page_size == 0 {
            bail!("page_size must be greater than 0");
        }

        self.db.query_tool_logs(session_id, page.max(1), page_size)
    }
}

pub fn log_tool_call(db: &StateStore, event: &ToolCallEvent) -> Result<ToolLogEntry> {
    ToolLogger::new(db).log(event)
}

#[cfg(test)]
mod tests {
    use super::{SuggestedAction, ToolCallEvent, ToolLogger};
    use crate::config::Config;
    use crate::session::store::StateStore;
    use crate::session::{Session, SessionMetrics, SessionState};
    use std::path::PathBuf;

    fn test_db_path() -> PathBuf {
        std::env::temp_dir().join(format!("ecc2-observability-{}.db", uuid::Uuid::new_v4()))
    }

    fn test_session(id: &str) -> Session {
        let now = chrono::Utc::now();

        Session {
            id: id.to_string(),
            task: "test task".to_string(),
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
        }
    }

    #[test]
    fn computes_sensitive_file_risk() {
        let assessment = ToolCallEvent::compute_risk(
            "Write",
            "Update .env.production with rotated API token",
            &Config::RISK_THRESHOLDS,
        );

        assert!(assessment.score >= Config::RISK_THRESHOLDS.review);
        assert_eq!(assessment.suggested_action, SuggestedAction::Review);
        assert!(assessment
            .reasons
            .iter()
            .any(|reason| reason.contains("sensitive file")));
    }

    #[test]
    fn computes_blast_radius_risk() {
        let assessment = ToolCallEvent::compute_risk(
            "Edit",
            "Apply the same replacement across src/**/*.rs",
            &Config::RISK_THRESHOLDS,
        );

        assert!(assessment.score >= Config::RISK_THRESHOLDS.review);
        assert_eq!(assessment.suggested_action, SuggestedAction::Review);
        assert!(assessment
            .reasons
            .iter()
            .any(|reason| reason.contains("blast radius")));
    }

    #[test]
    fn computes_irreversible_risk() {
        let assessment = ToolCallEvent::compute_risk(
            "Bash",
            "rm -f /tmp/ecc-temp.txt",
            &Config::RISK_THRESHOLDS,
        );

        assert!(assessment.score >= Config::RISK_THRESHOLDS.confirm);
        assert_eq!(
            assessment.suggested_action,
            SuggestedAction::RequireConfirmation,
        );
        assert!(assessment
            .reasons
            .iter()
            .any(|reason| reason.contains("irreversible")));
    }

    #[test]
    fn blocks_combined_high_risk_operations() {
        let assessment = ToolCallEvent::compute_risk(
            "Bash",
            "rm -rf . && git push --force origin main",
            &Config::RISK_THRESHOLDS,
        );

        assert!(assessment.score >= Config::RISK_THRESHOLDS.block);
        assert_eq!(assessment.suggested_action, SuggestedAction::Block);
    }

    #[test]
    fn logger_persists_entries_and_paginates() -> anyhow::Result<()> {
        let db_path = test_db_path();
        let db = StateStore::open(&db_path)?;
        db.insert_session(&test_session("sess-1"))?;

        let logger = ToolLogger::new(&db);

        logger.log(&ToolCallEvent::new("sess-1", "Read", "first", "ok", 5))?;
        logger.log(&ToolCallEvent::new("sess-1", "Write", "second", "ok", 15))?;
        logger.log(&ToolCallEvent::new("sess-1", "Bash", "third", "ok", 25))?;

        let first_page = logger.query("sess-1", 1, 2)?;
        assert_eq!(first_page.total, 3);
        assert_eq!(first_page.entries.len(), 2);
        assert_eq!(first_page.entries[0].tool_name, "Bash");
        assert_eq!(first_page.entries[1].tool_name, "Write");
        assert_eq!(first_page.entries[0].input_params_json, "{}");
        assert_eq!(first_page.entries[0].trigger_summary, "");

        let second_page = logger.query("sess-1", 2, 2)?;
        assert_eq!(second_page.total, 3);
        assert_eq!(second_page.entries.len(), 1);
        assert_eq!(second_page.entries[0].tool_name, "Read");

        std::fs::remove_file(&db_path).ok();

        Ok(())
    }
}
