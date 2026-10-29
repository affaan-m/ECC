use anyhow::{Context, Result};
use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::PathBuf;

use crate::notifications::{
    CompletionSummaryConfig, DesktopNotificationConfig, WebhookNotificationConfig,
};

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PaneLayout {
    #[default]
    Horizontal,
    Vertical,
    Grid,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct RiskThresholds {
    pub review: f64,
    pub confirm: f64,
    pub block: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct BudgetAlertThresholds {
    pub advisory: f64,
    pub warning: f64,
    pub critical: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConflictResolutionStrategy {
    Escalate,
    LastWriteWins,
    Merge,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct ConflictResolutionConfig {
    pub enabled: bool,
    pub strategy: ConflictResolutionStrategy,
    pub notify_lead: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct ComputerUseDispatchConfig {
    pub agent: Option<String>,
    pub profile: Option<String>,
    pub use_worktree: bool,
    pub project: Option<String>,
    pub task_group: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct AgentProfileConfig {
    pub inherits: Option<String>,
    pub agent: Option<String>,
    pub model: Option<String>,
    pub allowed_tools: Vec<String>,
    pub disallowed_tools: Vec<String>,
    pub permission_mode: Option<String>,
    pub add_dirs: Vec<PathBuf>,
    pub max_budget_usd: Option<f64>,
    pub token_budget: Option<u64>,
    pub append_system_prompt: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct ResolvedAgentProfile {
    pub profile_name: String,
    pub agent: Option<String>,
    pub model: Option<String>,
    pub allowed_tools: Vec<String>,
    pub disallowed_tools: Vec<String>,
    pub permission_mode: Option<String>,
    pub add_dirs: Vec<PathBuf>,
    pub max_budget_usd: Option<f64>,
    pub token_budget: Option<u64>,
    pub append_system_prompt: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct HarnessRunnerConfig {
    pub program: String,
    pub base_args: Vec<String>,
    pub project_markers: Vec<PathBuf>,
    pub cwd_flag: Option<String>,
    pub session_name_flag: Option<String>,
    pub task_flag: Option<String>,
    pub model_flag: Option<String>,
    pub add_dir_flag: Option<String>,
    pub include_directories_flag: Option<String>,
    pub allowed_tools_flag: Option<String>,
    pub disallowed_tools_flag: Option<String>,
    pub permission_mode_flag: Option<String>,
    pub max_budget_usd_flag: Option<String>,
    pub append_system_prompt_flag: Option<String>,
    pub inline_system_prompt_for_task: bool,
    pub env: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct OrchestrationTemplateConfig {
    pub description: Option<String>,
    pub project: Option<String>,
    pub task_group: Option<String>,
    pub agent: Option<String>,
    pub profile: Option<String>,
    pub worktree: Option<bool>,
    pub steps: Vec<OrchestrationTemplateStepConfig>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct OrchestrationTemplateStepConfig {
    pub name: Option<String>,
    pub task: String,
    pub agent: Option<String>,
    pub profile: Option<String>,
    pub worktree: Option<bool>,
    pub project: Option<String>,
    pub task_group: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum MemoryConnectorConfig {
    JsonlFile(MemoryConnectorJsonlFileConfig),
    JsonlDirectory(MemoryConnectorJsonlDirectoryConfig),
    MarkdownFile(MemoryConnectorMarkdownFileConfig),
    MarkdownDirectory(MemoryConnectorMarkdownDirectoryConfig),
    DotenvFile(MemoryConnectorDotenvFileConfig),
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct MemoryConnectorJsonlFileConfig {
    pub path: PathBuf,
    pub session_id: Option<String>,
    pub default_entity_type: Option<String>,
    pub default_observation_type: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct MemoryConnectorJsonlDirectoryConfig {
    pub path: PathBuf,
    pub recurse: bool,
    pub session_id: Option<String>,
    pub default_entity_type: Option<String>,
    pub default_observation_type: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct MemoryConnectorMarkdownFileConfig {
    pub path: PathBuf,
    pub session_id: Option<String>,
    pub default_entity_type: Option<String>,
    pub default_observation_type: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct MemoryConnectorMarkdownDirectoryConfig {
    pub path: PathBuf,
    pub recurse: bool,
    pub session_id: Option<String>,
    pub default_entity_type: Option<String>,
    pub default_observation_type: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct MemoryConnectorDotenvFileConfig {
    pub path: PathBuf,
    pub session_id: Option<String>,
    pub default_entity_type: Option<String>,
    pub default_observation_type: Option<String>,
    pub key_prefixes: Vec<String>,
    pub include_keys: Vec<String>,
    pub exclude_keys: Vec<String>,
    pub include_safe_values: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ResolvedOrchestrationTemplate {
    pub template_name: String,
    pub description: Option<String>,
    pub project: Option<String>,
    pub task_group: Option<String>,
    pub steps: Vec<ResolvedOrchestrationTemplateStep>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ResolvedOrchestrationTemplateStep {
    pub name: String,
    pub task: String,
    pub agent: Option<String>,
    pub profile: Option<String>,
    pub worktree: bool,
    pub project: Option<String>,
    pub task_group: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Config {
    pub db_path: PathBuf,
    pub worktree_root: PathBuf,
    pub worktree_branch_prefix: String,
    pub max_parallel_sessions: usize,
    pub max_parallel_worktrees: usize,
    pub worktree_retention_secs: u64,
    pub session_timeout_secs: u64,
    pub heartbeat_interval_secs: u64,
    pub auto_terminate_stale_sessions: bool,
    pub default_agent: String,
    pub default_agent_profile: Option<String>,
    pub harness_runners: BTreeMap<String, HarnessRunnerConfig>,
    pub agent_profiles: BTreeMap<String, AgentProfileConfig>,
    pub orchestration_templates: BTreeMap<String, OrchestrationTemplateConfig>,
    pub memory_connectors: BTreeMap<String, MemoryConnectorConfig>,
    pub computer_use_dispatch: ComputerUseDispatchConfig,
    pub auto_dispatch_unread_handoffs: bool,
    pub auto_dispatch_limit_per_session: usize,
    pub auto_create_worktrees: bool,
    pub auto_merge_ready_worktrees: bool,
    pub desktop_notifications: DesktopNotificationConfig,
    pub webhook_notifications: WebhookNotificationConfig,
    pub completion_summary_notifications: CompletionSummaryConfig,
    pub cost_budget_usd: f64,
    pub token_budget: u64,
    pub budget_alert_thresholds: BudgetAlertThresholds,
    pub conflict_resolution: ConflictResolutionConfig,
    pub theme: Theme,
    pub pane_layout: PaneLayout,
    pub pane_navigation: PaneNavigationConfig,
    pub linear_pane_size_percent: u16,
    pub grid_pane_size_percent: u16,
    pub risk_thresholds: RiskThresholds,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct PaneNavigationConfig {
    pub focus_sessions: String,
    pub focus_output: String,
    pub focus_metrics: String,
    pub focus_log: String,
    pub move_left: String,
    pub move_down: String,
    pub move_up: String,
    pub move_right: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PaneNavigationAction {
    FocusSlot(usize),
    MoveLeft,
    MoveDown,
    MoveUp,
    MoveRight,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Theme {
    Dark,
    Light,
}

impl Default for Config {
    fn default() -> Self {
        let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
        Self {
            db_path: home.join(".claude").join("ecc2.db"),
            worktree_root: PathBuf::from("/tmp/ecc-worktrees"),
            worktree_branch_prefix: "ecc".to_string(),
            max_parallel_sessions: 8,
            max_parallel_worktrees: 6,
            worktree_retention_secs: 0,
            session_timeout_secs: 3600,
            heartbeat_interval_secs: 30,
            auto_terminate_stale_sessions: false,
            default_agent: "claude".to_string(),
            default_agent_profile: None,
            harness_runners: BTreeMap::new(),
            agent_profiles: BTreeMap::new(),
            orchestration_templates: BTreeMap::new(),
            memory_connectors: BTreeMap::new(),
            computer_use_dispatch: ComputerUseDispatchConfig::default(),
            auto_dispatch_unread_handoffs: false,
            auto_dispatch_limit_per_session: 5,
            auto_create_worktrees: true,
            auto_merge_ready_worktrees: false,
            desktop_notifications: DesktopNotificationConfig::default(),
            webhook_notifications: WebhookNotificationConfig::default(),
            completion_summary_notifications: CompletionSummaryConfig::default(),
            cost_budget_usd: 10.0,
            token_budget: 500_000,
            budget_alert_thresholds: Self::BUDGET_ALERT_THRESHOLDS,
            conflict_resolution: ConflictResolutionConfig::default(),
            theme: Theme::Dark,
            pane_layout: PaneLayout::Horizontal,
            pane_navigation: PaneNavigationConfig::default(),
            linear_pane_size_percent: 35,
            grid_pane_size_percent: 50,
            risk_thresholds: Self::RISK_THRESHOLDS,
        }
    }
}

impl Config {
    pub const RISK_THRESHOLDS: RiskThresholds = RiskThresholds {
        review: 0.35,
        confirm: 0.60,
        block: 0.85,
    };

    pub const BUDGET_ALERT_THRESHOLDS: BudgetAlertThresholds = BudgetAlertThresholds {
        advisory: 0.50,
        warning: 0.75,
        critical: 0.90,
    };

    pub fn config_path() -> PathBuf {
        Self::config_root().join("ecc2").join("config.toml")
    }

    pub fn cost_metrics_path(&self) -> PathBuf {
        self.db_path
            .parent()
            .unwrap_or_else(|| std::path::Path::new("."))
            .join("metrics")
            .join("costs.jsonl")
    }

    pub fn tool_activity_metrics_path(&self) -> PathBuf {
        self.db_path
            .parent()
            .unwrap_or_else(|| std::path::Path::new("."))
            .join("metrics")
            .join("tool-usage.jsonl")
    }

    pub fn effective_budget_alert_thresholds(&self) -> BudgetAlertThresholds {
        self.budget_alert_thresholds.sanitized()
    }

    pub fn computer_use_dispatch_defaults(&self) -> ResolvedComputerUseDispatchConfig {
        let agent = self
            .computer_use_dispatch
            .agent
            .clone()
            .unwrap_or_else(|| self.default_agent.clone());
        let profile = self
            .computer_use_dispatch
            .profile
            .clone()
            .or_else(|| self.default_agent_profile.clone());
        ResolvedComputerUseDispatchConfig {
            agent,
            profile,
            use_worktree: self.computer_use_dispatch.use_worktree,
            project: self.computer_use_dispatch.project.clone(),
            task_group: self.computer_use_dispatch.task_group.clone(),
        }
    }

    pub fn resolve_agent_profile(&self, name: &str) -> Result<ResolvedAgentProfile> {
        let mut chain = Vec::new();
        self.resolve_agent_profile_inner(name, &mut chain)
    }

    pub fn harness_runner(&self, harness: &str) -> Option<&HarnessRunnerConfig> {
        let key = harness.trim().to_ascii_lowercase();
        self.harness_runners.get(&key)
    }

    pub fn resolve_orchestration_template(
        &self,
        name: &str,
        vars: &BTreeMap<String, String>,
    ) -> Result<ResolvedOrchestrationTemplate> {
        let template = self
            .orchestration_templates
            .get(name)
            .ok_or_else(|| anyhow::anyhow!("Unknown orchestration template: {name}"))?;

        if template.steps.is_empty() {
            anyhow::bail!("orchestration template {name} has no steps");
        }

        let description = interpolate_optional_string(template.description.as_deref(), vars)?;
        let project = interpolate_optional_string(template.project.as_deref(), vars)?;
        let task_group = interpolate_optional_string(template.task_group.as_deref(), vars)?;
        let default_agent = interpolate_optional_string(template.agent.as_deref(), vars)?;
        let default_profile = interpolate_optional_string(template.profile.as_deref(), vars)?;
        if let Some(profile_name) = default_profile.as_deref() {
            self.resolve_agent_profile(profile_name)?;
        }

        let mut steps = Vec::with_capacity(template.steps.len());
        for (index, step) in template.steps.iter().enumerate() {
            let task = interpolate_required_string(&step.task, vars).with_context(|| {
                format!(
                    "resolve task for orchestration template {name} step {}",
                    index + 1
                )
            })?;
            let step_name = interpolate_optional_string(step.name.as_deref(), vars)?
                .unwrap_or_else(|| format!("step {}", index + 1));
            let agent = interpolate_optional_string(
                step.agent.as_deref().or(default_agent.as_deref()),
                vars,
            )?;
            let profile = interpolate_optional_string(
                step.profile.as_deref().or(default_profile.as_deref()),
                vars,
            )?;
            if let Some(profile_name) = profile.as_deref() {
                self.resolve_agent_profile(profile_name)?;
            }

            steps.push(ResolvedOrchestrationTemplateStep {
                name: step_name,
                task,
                agent,
                profile,
                worktree: step
                    .worktree
                    .or(template.worktree)
                    .unwrap_or(self.auto_create_worktrees),
                project: interpolate_optional_string(
                    step.project.as_deref().or(project.as_deref()),
                    vars,
                )?,
                task_group: interpolate_optional_string(
                    step.task_group.as_deref().or(task_group.as_deref()),
                    vars,
                )?,
            });
        }

        Ok(ResolvedOrchestrationTemplate {
            template_name: name.to_string(),
            description,
            project,
            task_group,
            steps,
        })
    }

    fn resolve_agent_profile_inner(
        &self,
        name: &str,
        chain: &mut Vec<String>,
    ) -> Result<ResolvedAgentProfile> {
        if chain.iter().any(|existing| existing == name) {
            chain.push(name.to_string());
            anyhow::bail!("agent profile inheritance cycle: {}", chain.join(" -> "));
        }

        let profile = self
            .agent_profiles
            .get(name)
            .ok_or_else(|| anyhow::anyhow!("Unknown agent profile: {name}"))?;

        chain.push(name.to_string());
        let mut resolved = if let Some(parent) = profile.inherits.as_deref() {
            self.resolve_agent_profile_inner(parent, chain)?
        } else {
            ResolvedAgentProfile::default()
        };
        chain.pop();

        resolved.apply(name, profile);
        Ok(resolved)
    }

    pub fn load() -> Result<Self> {
        let global_paths = Self::global_config_paths();
        let project_paths = std::env::current_dir()
            .ok()
            .map(|cwd| Self::project_config_paths_from(&cwd))
            .unwrap_or_default();
        Self::load_from_paths(&global_paths, &project_paths)
    }

    fn load_from_paths(
        global_paths: &[PathBuf],
        project_override_paths: &[PathBuf],
    ) -> Result<Self> {
        let mut merged = toml::Value::try_from(Self::default())
            .context("serialize default ECC 2.0 config for layered merge")?;

        for path in global_paths.iter().chain(project_override_paths.iter()) {
            if path.exists() {
                Self::merge_config_file(&mut merged, path)?;
            }
        }

        merged
            .try_into()
            .context("deserialize merged ECC 2.0 config")
    }

    #[cfg(test)]
    fn config_root() -> PathBuf {
        // Each test thread gets its own scratch root, so `Config::save()` can
        // never overwrite the developer's real config.
        struct TestConfigRoot(PathBuf);

        impl TestConfigRoot {
            fn new() -> Self {
                let path = std::env::temp_dir()
                    .join(format!("ecc2-test-config-{}", uuid::Uuid::new_v4()));
                std::fs::create_dir(&path).expect("create private ECC 2 test config root");
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700))
                        .expect("restrict ECC 2 test config root permissions");
                }
                Self(path)
            }
        }

        impl Drop for TestConfigRoot {
            fn drop(&mut self) {
                if let Err(error) = std::fs::remove_dir_all(&self.0) {
                    if error.kind() != std::io::ErrorKind::NotFound {
                        eprintln!(
                            "failed to remove ECC 2 test config root {}: {error}",
                            self.0.display()
                        );
                    }
                }
            }
        }

        thread_local! {
            static ROOT: TestConfigRoot = TestConfigRoot::new();
        }

        ROOT.with(|root| root.0.clone())
    }

    #[cfg(not(test))]
    fn config_root() -> PathBuf {
        dirs::config_dir().unwrap_or_else(|| {
            dirs::home_dir()
                .unwrap_or_else(|| PathBuf::from("."))
                .join(".config")
        })
    }

    #[cfg(test)]
    fn legacy_global_config_path() -> PathBuf {
        Self::config_root().join(".claude").join("ecc2.toml")
    }

    #[cfg(not(test))]
    fn legacy_global_config_path() -> PathBuf {
        dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(".claude")
            .join("ecc2.toml")
    }

    fn global_config_paths() -> Vec<PathBuf> {
        let legacy = Self::legacy_global_config_path();
        let primary = Self::config_path();

        if legacy == primary {
            vec![primary]
        } else {
            vec![legacy, primary]
        }
    }

    fn project_config_paths_from(start: &std::path::Path) -> Vec<PathBuf> {
        let global_paths = Self::global_config_paths();
        let mut current = Some(start);

        while let Some(path) = current {
            let legacy = path.join(".claude").join("ecc2.toml");
            let primary = path.join("ecc2.toml");
            let mut matches = Vec::new();

            if legacy.exists() && !global_paths.iter().any(|global| global == &legacy) {
                matches.push(legacy);
            }
            if primary.exists() && !global_paths.iter().any(|global| global == &primary) {
                matches.push(primary);
            }

            if !matches.is_empty() {
                return matches;
            }
            current = path.parent();
        }

        Vec::new()
    }

    fn merge_config_file(base: &mut toml::Value, path: &std::path::Path) -> Result<()> {
        let content = std::fs::read_to_string(path)
            .with_context(|| format!("read ECC 2.0 config from {}", path.display()))?;
        let overlay: toml::Value = toml::from_str(&content)
            .with_context(|| format!("parse ECC 2.0 config from {}", path.display()))?;
        Self::merge_toml_values(base, overlay);
        Ok(())
    }

    fn merge_toml_values(base: &mut toml::Value, overlay: toml::Value) {
        match (base, overlay) {
            (toml::Value::Table(base_table), toml::Value::Table(overlay_table)) => {
                for (key, overlay_value) in overlay_table {
                    if let Some(base_value) = base_table.get_mut(&key) {
                        Self::merge_toml_values(base_value, overlay_value);
                    } else {
                        base_table.insert(key, overlay_value);
                    }
                }
            }
            (base_value, overlay_value) => *base_value = overlay_value,
        }
    }

    pub fn save(&self) -> Result<()> {
        self.save_to_path(&Self::config_path())
    }

    pub fn save_to_path(&self, path: &std::path::Path) -> Result<()> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let content = toml::to_string_pretty(self)?;
        std::fs::write(path, content)?;
        Ok(())
    }
}

impl Default for PaneNavigationConfig {
    fn default() -> Self {
        Self {
            focus_sessions: "1".to_string(),
            focus_output: "2".to_string(),
            focus_metrics: "3".to_string(),
            focus_log: "4".to_string(),
            move_left: "ctrl-h".to_string(),
            move_down: "ctrl-j".to_string(),
            move_up: "ctrl-k".to_string(),
            move_right: "ctrl-l".to_string(),
        }
    }
}

impl PaneNavigationConfig {
    pub fn action_for_key(&self, key: KeyEvent) -> Option<PaneNavigationAction> {
        [
            (&self.focus_sessions, PaneNavigationAction::FocusSlot(1)),
            (&self.focus_output, PaneNavigationAction::FocusSlot(2)),
            (&self.focus_metrics, PaneNavigationAction::FocusSlot(3)),
            (&self.focus_log, PaneNavigationAction::FocusSlot(4)),
            (&self.move_left, PaneNavigationAction::MoveLeft),
            (&self.move_down, PaneNavigationAction::MoveDown),
            (&self.move_up, PaneNavigationAction::MoveUp),
            (&self.move_right, PaneNavigationAction::MoveRight),
        ]
        .into_iter()
        .find_map(|(binding, action)| shortcut_matches(binding, key).then_some(action))
    }

    pub fn focus_shortcuts_label(&self) -> String {
        [
            self.focus_sessions.as_str(),
            self.focus_output.as_str(),
            self.focus_metrics.as_str(),
            self.focus_log.as_str(),
        ]
        .into_iter()
        .map(shortcut_label)
        .collect::<Vec<_>>()
        .join("/")
    }

    pub fn movement_shortcuts_label(&self) -> String {
        [
            self.move_left.as_str(),
            self.move_down.as_str(),
            self.move_up.as_str(),
            self.move_right.as_str(),
        ]
        .into_iter()
        .map(shortcut_label)
        .collect::<Vec<_>>()
        .join("/")
    }
}

fn shortcut_matches(spec: &str, key: KeyEvent) -> bool {
    parse_shortcut(spec)
        .is_some_and(|(modifiers, code)| key.modifiers == modifiers && key.code == code)
}

fn parse_shortcut(spec: &str) -> Option<(KeyModifiers, KeyCode)> {
    let normalized = spec.trim().to_ascii_lowercase().replace('+', "-");
    if normalized.is_empty() {
        return None;
    }

    if normalized == "tab" {
        return Some((KeyModifiers::NONE, KeyCode::Tab));
    }

    if normalized == "shift-tab" || normalized == "s-tab" {
        return Some((KeyModifiers::SHIFT, KeyCode::BackTab));
    }

    if let Some(rest) = normalized
        .strip_prefix("ctrl-")
        .or_else(|| normalized.strip_prefix("c-"))
    {
        return parse_single_char(rest).map(|ch| (KeyModifiers::CONTROL, KeyCode::Char(ch)));
    }

    parse_single_char(&normalized).map(|ch| (KeyModifiers::NONE, KeyCode::Char(ch)))
}

fn parse_single_char(value: &str) -> Option<char> {
    let mut chars = value.chars();
    let ch = chars.next()?;
    (chars.next().is_none()).then_some(ch)
}

fn shortcut_label(spec: &str) -> String {
    let normalized = spec.trim().to_ascii_lowercase().replace('+', "-");
    if normalized == "tab" {
        return "Tab".to_string();
    }
    if normalized == "shift-tab" || normalized == "s-tab" {
        return "S-Tab".to_string();
    }
    if let Some(rest) = normalized
        .strip_prefix("ctrl-")
        .or_else(|| normalized.strip_prefix("c-"))
    {
        if let Some(ch) = parse_single_char(rest) {
            return format!("Ctrl+{ch}");
        }
    }
    normalized
}

impl Default for RiskThresholds {
    fn default() -> Self {
        Config::RISK_THRESHOLDS
    }
}

impl Default for BudgetAlertThresholds {
    fn default() -> Self {
        Config::BUDGET_ALERT_THRESHOLDS
    }
}

impl Default for ConflictResolutionStrategy {
    fn default() -> Self {
        Self::Escalate
    }
}

impl Default for ConflictResolutionConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            strategy: ConflictResolutionStrategy::Escalate,
            notify_lead: true,
        }
    }
}

impl ResolvedAgentProfile {
    fn apply(&mut self, profile_name: &str, config: &AgentProfileConfig) {
        self.profile_name = profile_name.to_string();
        if let Some(agent) = config.agent.as_ref() {
            self.agent = Some(agent.clone());
        }
        if let Some(model) = config.model.as_ref() {
            self.model = Some(model.clone());
        }
        merge_unique(&mut self.allowed_tools, &config.allowed_tools);
        merge_unique(&mut self.disallowed_tools, &config.disallowed_tools);
        if let Some(permission_mode) = config.permission_mode.as_ref() {
            self.permission_mode = Some(permission_mode.clone());
        }
        merge_unique(&mut self.add_dirs, &config.add_dirs);
        if let Some(max_budget_usd) = config.max_budget_usd {
            self.max_budget_usd = Some(max_budget_usd);
        }
        if let Some(token_budget) = config.token_budget {
            self.token_budget = Some(token_budget);
        }
        self.append_system_prompt = match (
            self.append_system_prompt.take(),
            config.append_system_prompt.as_ref(),
        ) {
            (Some(parent), Some(child)) => Some(format!("{parent}\n\n{child}")),
            (Some(parent), None) => Some(parent),
            (None, Some(child)) => Some(child.clone()),
            (None, None) => None,
        };
    }
}

impl Default for HarnessRunnerConfig {
    fn default() -> Self {
        Self {
            program: String::new(),
            base_args: Vec::new(),
            project_markers: Vec::new(),
            cwd_flag: None,
            session_name_flag: None,
            task_flag: None,
            model_flag: None,
            add_dir_flag: None,
            include_directories_flag: None,
            allowed_tools_flag: None,
            disallowed_tools_flag: None,
            permission_mode_flag: None,
            max_budget_usd_flag: None,
            append_system_prompt_flag: None,
            inline_system_prompt_for_task: true,
            env: BTreeMap::new(),
        }
    }
}

impl Default for ComputerUseDispatchConfig {
    fn default() -> Self {
        Self {
            agent: None,
            profile: None,
            use_worktree: false,
            project: None,
            task_group: None,
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ResolvedComputerUseDispatchConfig {
    pub agent: String,
    pub profile: Option<String>,
    pub use_worktree: bool,
    pub project: Option<String>,
    pub task_group: Option<String>,
}

fn merge_unique<T>(base: &mut Vec<T>, additions: &[T])
where
    T: Clone + PartialEq,
{
    for value in additions {
        if !base.contains(value) {
            base.push(value.clone());
        }
    }
}

fn interpolate_optional_string(
    value: Option<&str>,
    vars: &BTreeMap<String, String>,
) -> Result<Option<String>> {
    value
        .map(|value| interpolate_required_string(value, vars))
        .transpose()
        .map(|value| {
            value.and_then(|value| {
                let trimmed = value.trim();
                if trimmed.is_empty() {
                    None
                } else {
                    Some(trimmed.to_string())
                }
            })
        })
}

fn interpolate_required_string(value: &str, vars: &BTreeMap<String, String>) -> Result<String> {
    let placeholder = Regex::new(r"\{\{\s*([A-Za-z0-9_-]+)\s*\}\}")
        .expect("orchestration template placeholder regex");
    let mut missing = Vec::new();
    let rendered = placeholder.replace_all(value, |captures: &regex::Captures<'_>| {
        let key = captures
            .get(1)
            .map(|capture| capture.as_str())
            .unwrap_or_default();
        match vars.get(key) {
            Some(value) => value.to_string(),
            None => {
                missing.push(key.to_string());
                String::new()
            }
        }
    });

    if !missing.is_empty() {
        missing.sort();
        missing.dedup();
        anyhow::bail!(
            "missing orchestration template variable(s): {}",
            missing.join(", ")
        );
    }

    Ok(rendered.into_owned())
}

impl BudgetAlertThresholds {
    pub fn sanitized(self) -> Self {
        let values = [self.advisory, self.warning, self.critical];
        let valid = values.into_iter().all(f64::is_finite)
            && self.advisory > 0.0
            && self.advisory < self.warning
            && self.warning < self.critical
            && self.critical < 1.0;

        if valid {
            self
        } else {
            Self::default()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        BudgetAlertThresholds, ComputerUseDispatchConfig, Config, ConflictResolutionConfig,
        ConflictResolutionStrategy, PaneLayout, ResolvedComputerUseDispatchConfig,
    };
    use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
    use std::collections::BTreeMap;
    use std::path::PathBuf;
    use uuid::Uuid;

    #[test]
    fn default_includes_positive_budget_thresholds() {
        let config = Config::default();

        assert!(config.cost_budget_usd > 0.0);
        assert!(config.token_budget > 0);
    }

    #[test]
    fn missing_budget_fields_fall_back_to_defaults() {
        let legacy_config = r#"
db_path = "/tmp/ecc2.db"
worktree_root = "/tmp/ecc-worktrees"
max_parallel_sessions = 8
max_parallel_worktrees = 6
worktree_retention_secs = 0
session_timeout_secs = 3600
heartbeat_interval_secs = 30
auto_terminate_stale_sessions = false
default_agent = "claude"
theme = "Dark"
"#;

        let config: Config = toml::from_str(legacy_config).unwrap();
        let defaults = Config::default();

        assert_eq!(
            config.worktree_branch_prefix,
            defaults.worktree_branch_prefix
        );
        assert_eq!(
            config.worktree_retention_secs,
            defaults.worktree_retention_secs
        );
        assert_eq!(config.cost_budget_usd, defaults.cost_budget_usd);
        assert_eq!(config.token_budget, defaults.token_budget);
        assert_eq!(
            config.budget_alert_thresholds,
            defaults.budget_alert_thresholds
        );
        assert_eq!(config.conflict_resolution, defaults.conflict_resolution);
        assert_eq!(config.pane_layout, defaults.pane_layout);
        assert_eq!(config.pane_navigation, defaults.pane_navigation);
        assert_eq!(
            config.linear_pane_size_percent,
            defaults.linear_pane_size_percent
        );
        assert_eq!(
            config.grid_pane_size_percent,
            defaults.grid_pane_size_percent
        );
        assert_eq!(config.risk_thresholds, defaults.risk_thresholds);
        assert_eq!(
            config.auto_dispatch_unread_handoffs,
            defaults.auto_dispatch_unread_handoffs
        );
        assert_eq!(
            config.auto_dispatch_limit_per_session,
            defaults.auto_dispatch_limit_per_session
        );
        assert_eq!(config.auto_create_worktrees, defaults.auto_create_worktrees);
        assert_eq!(
            config.auto_merge_ready_worktrees,
            defaults.auto_merge_ready_worktrees
        );
        assert_eq!(config.desktop_notifications, defaults.desktop_notifications);
        assert_eq!(config.webhook_notifications, defaults.webhook_notifications);
        assert_eq!(
            config.auto_terminate_stale_sessions,
            defaults.auto_terminate_stale_sessions
        );
    }

    #[test]
    fn default_pane_layout_is_horizontal() {
        assert_eq!(Config::default().pane_layout, PaneLayout::Horizontal);
    }

    #[test]
    fn default_pane_sizes_match_dashboard_defaults() {
        let config = Config::default();

        assert_eq!(config.linear_pane_size_percent, 35);
        assert_eq!(config.grid_pane_size_percent, 50);
    }

    #[test]
    fn pane_layout_deserializes_from_toml() {
        let config: Config = toml::from_str(r#"pane_layout = "grid""#).unwrap();

        assert_eq!(config.pane_layout, PaneLayout::Grid);
    }

    #[test]
    fn worktree_branch_prefix_deserializes_from_toml() {
        let config: Config = toml::from_str(r#"worktree_branch_prefix = "bots/ecc""#).unwrap();

        assert_eq!(config.worktree_branch_prefix, "bots/ecc");
    }

    #[test]
    fn layered_config_merges_global_and_project_overrides() {
        let tempdir = std::env::temp_dir().join(format!("ecc2-config-{}", Uuid::new_v4()));
        let legacy_global_path = tempdir.join("legacy-global.toml");
        let global_path = tempdir.join("config.toml");
        let project_path = tempdir.join("ecc2.toml");
        std::fs::create_dir_all(&tempdir).unwrap();
        std::fs::write(
            &legacy_global_path,
            r#"
max_parallel_worktrees = 6
auto_create_worktrees = false

[desktop_notifications]
enabled = true
session_completed = false
"#,
        )
        .unwrap();
        std::fs::write(
            &global_path,
            r#"
auto_merge_ready_worktrees = true

[pane_navigation]
focus_sessions = "q"
move_right = "d"
"#,
        )
        .unwrap();
        std::fs::write(
            &project_path,
            r#"
max_parallel_worktrees = 2
auto_dispatch_limit_per_session = 9

[desktop_notifications]
approval_requests = false

[pane_navigation]
focus_metrics = "e"
"#,
        )
        .unwrap();

        let config =
            Config::load_from_paths(&[legacy_global_path, global_path], &[project_path]).unwrap();
        assert_eq!(config.max_parallel_worktrees, 2);
        assert!(!config.auto_create_worktrees);
        assert!(config.auto_merge_ready_worktrees);
        assert_eq!(config.auto_dispatch_limit_per_session, 9);
        assert!(config.desktop_notifications.enabled);
        assert!(!config.desktop_notifications.session_completed);
        assert!(!config.desktop_notifications.approval_requests);
        assert_eq!(config.pane_navigation.focus_sessions, "q");
        assert_eq!(config.pane_navigation.focus_metrics, "e");
        assert_eq!(config.pane_navigation.move_right, "d");

        let _ = std::fs::remove_dir_all(tempdir);
    }

    #[test]
    fn project_config_discovery_prefers_nearest_directory_and_new_path() {
        let tempdir = std::env::temp_dir().join(format!("ecc2-config-{}", Uuid::new_v4()));
        let project_root = tempdir.join("project");
        let nested_dir = project_root.join("src").join("module");
        std::fs::create_dir_all(project_root.join(".claude")).unwrap();
        std::fs::create_dir_all(&nested_dir).unwrap();
        std::fs::write(project_root.join(".claude").join("ecc2.toml"), "").unwrap();
        std::fs::write(project_root.join("ecc2.toml"), "").unwrap();

        let paths = Config::project_config_paths_from(&nested_dir);
        assert_eq!(
            paths,
            vec![
                project_root.join(".claude").join("ecc2.toml"),
                project_root.join("ecc2.toml")
            ]
        );

        let _ = std::fs::remove_dir_all(tempdir);
    }

    #[test]
    fn config_path_under_test_is_sandboxed_away_from_user_config() {
        let path = Config::config_path();
        assert!(
            path.starts_with(std::env::temp_dir()),
            "tests must never resolve the real user config, got {}",
            path.display()
        );
    }

    #[test]
    fn legacy_config_path_under_test_is_sandboxed_away_from_user_home() {
        let path = Config::legacy_global_config_path();
        assert!(
            path.starts_with(std::env::temp_dir()),
            "tests must never read the real legacy user config, got {}",
            path.display()
        );
        assert!(path.ends_with(".claude/ecc2.toml"));
    }

    #[test]
    fn config_path_under_test_is_stable_within_a_test() {
        assert_eq!(Config::config_path(), Config::config_path());
    }

    #[test]
    fn config_path_under_test_is_distinct_across_test_threads() {
        let current = Config::config_path();
        let other = std::thread::spawn(Config::config_path)
            .join()
            .expect("config path thread should complete");
        assert_ne!(current, other);
    }

    #[cfg(unix)]
    #[test]
    fn config_root_under_test_is_owner_only() {
        use std::os::unix::fs::PermissionsExt;

        let root = Config::config_root();
        let mode = std::fs::metadata(root).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o700);
    }

    #[test]
    fn primary_config_path_uses_xdg_style_location() {
        let path = Config::config_path();
        assert!(path.ends_with("ecc2/config.toml"));
    }

    #[test]
    fn pane_navigation_deserializes_from_toml() {
        let config: Config = toml::from_str(
            r#"
[pane_navigation]
focus_sessions = "q"
focus_output = "w"
focus_metrics = "e"
focus_log = "r"
move_left = "a"
move_down = "s"
move_up = "w"
move_right = "d"
"#,
        )
        .unwrap();

        assert_eq!(config.pane_navigation.focus_sessions, "q");
        assert_eq!(config.pane_navigation.focus_output, "w");
        assert_eq!(config.pane_navigation.focus_metrics, "e");
        assert_eq!(config.pane_navigation.focus_log, "r");
        assert_eq!(config.pane_navigation.move_left, "a");
        assert_eq!(config.pane_navigation.move_down, "s");
        assert_eq!(config.pane_navigation.move_up, "w");
        assert_eq!(config.pane_navigation.move_right, "d");
    }

    #[test]
    fn pane_navigation_matches_default_shortcuts() {
        let navigation = Config::default().pane_navigation;

        assert_eq!(
            navigation.action_for_key(KeyEvent::new(KeyCode::Char('1'), KeyModifiers::NONE)),
            Some(super::PaneNavigationAction::FocusSlot(1))
        );
        assert_eq!(
            navigation.action_for_key(KeyEvent::new(KeyCode::Char('l'), KeyModifiers::CONTROL)),
            Some(super::PaneNavigationAction::MoveRight)
        );
    }

    #[test]
    fn pane_navigation_matches_custom_shortcuts() {
        let navigation = super::PaneNavigationConfig {
            focus_sessions: "q".to_string(),
            focus_output: "w".to_string(),
            focus_metrics: "e".to_string(),
            focus_log: "r".to_string(),
            move_left: "a".to_string(),
            move_down: "s".to_string(),
            move_up: "w".to_string(),
            move_right: "d".to_string(),
        };

        assert_eq!(
            navigation.action_for_key(KeyEvent::new(KeyCode::Char('e'), KeyModifiers::NONE)),
            Some(super::PaneNavigationAction::FocusSlot(3))
        );
        assert_eq!(
            navigation.action_for_key(KeyEvent::new(KeyCode::Char('d'), KeyModifiers::NONE)),
            Some(super::PaneNavigationAction::MoveRight)
        );
    }

    #[test]
    fn default_risk_thresholds_are_applied() {
        assert_eq!(Config::default().risk_thresholds, Config::RISK_THRESHOLDS);
    }

    #[test]
    fn default_budget_alert_thresholds_are_applied() {
        assert_eq!(
            Config::default().budget_alert_thresholds,
            Config::BUDGET_ALERT_THRESHOLDS
        );
    }

    #[test]
    fn budget_alert_thresholds_deserialize_from_toml() {
        let config: Config = toml::from_str(
            r#"
[budget_alert_thresholds]
advisory = 0.40
warning = 0.70
critical = 0.85
"#,
        )
        .unwrap();

        assert_eq!(
            config.budget_alert_thresholds,
            BudgetAlertThresholds {
                advisory: 0.40,
                warning: 0.70,
                critical: 0.85,
            }
        );
        assert_eq!(
            config.effective_budget_alert_thresholds(),
            config.budget_alert_thresholds
        );
    }

    #[test]
    fn desktop_notifications_deserialize_from_toml() {
        let config: Config = toml::from_str(
            r#"
[desktop_notifications]
enabled = true
session_completed = false
session_failed = true
budget_alerts = true
approval_requests = false

[desktop_notifications.quiet_hours]
enabled = true
start_hour = 21
end_hour = 7
"#,
        )
        .unwrap();

        assert!(config.desktop_notifications.enabled);
        assert!(!config.desktop_notifications.session_completed);
        assert!(config.desktop_notifications.session_failed);
        assert!(config.desktop_notifications.budget_alerts);
        assert!(!config.desktop_notifications.approval_requests);
        assert!(config.desktop_notifications.quiet_hours.enabled);
        assert_eq!(config.desktop_notifications.quiet_hours.start_hour, 21);
        assert_eq!(config.desktop_notifications.quiet_hours.end_hour, 7);
    }

    #[test]
    fn conflict_resolution_deserializes_from_toml() {
        let config: Config = toml::from_str(
            r#"
[conflict_resolution]
enabled = true
strategy = "last_write_wins"
notify_lead = false
"#,
        )
        .unwrap();

        assert_eq!(
            config.conflict_resolution,
            ConflictResolutionConfig {
                enabled: true,
                strategy: ConflictResolutionStrategy::LastWriteWins,
                notify_lead: false,
            }
        );
    }

    #[test]
    fn computer_use_dispatch_deserializes_from_toml() {
        let config: Config = toml::from_str(
            r#"
[computer_use_dispatch]
agent = "codex"
profile = "browser"
use_worktree = true
project = "ops"
task_group = "remote browser"
"#,
        )
        .unwrap();

        assert_eq!(
            config.computer_use_dispatch,
            ComputerUseDispatchConfig {
                agent: Some("codex".to_string()),
                profile: Some("browser".to_string()),
                use_worktree: true,
                project: Some("ops".to_string()),
                task_group: Some("remote browser".to_string()),
            }
        );
        assert_eq!(
            config.computer_use_dispatch_defaults(),
            ResolvedComputerUseDispatchConfig {
                agent: "codex".to_string(),
                profile: Some("browser".to_string()),
                use_worktree: true,
                project: Some("ops".to_string()),
                task_group: Some("remote browser".to_string()),
            }
        );
    }

    #[test]
    fn agent_profiles_resolve_inheritance_and_defaults() {
        let config: Config = toml::from_str(
            r#"
default_agent_profile = "reviewer"

[agent_profiles.base]
model = "sonnet"
allowed_tools = ["Read"]
permission_mode = "plan"
add_dirs = ["docs"]
append_system_prompt = "Be careful."

[agent_profiles.reviewer]
inherits = "base"
allowed_tools = ["Edit"]
disallowed_tools = ["Bash"]
token_budget = 1200
append_system_prompt = "Review thoroughly."
"#,
        )
        .unwrap();

        let profile = config.resolve_agent_profile("reviewer").unwrap();
        assert_eq!(config.default_agent_profile.as_deref(), Some("reviewer"));
        assert_eq!(profile.profile_name, "reviewer");
        assert_eq!(profile.model.as_deref(), Some("sonnet"));
        assert_eq!(profile.allowed_tools, vec!["Read", "Edit"]);
        assert_eq!(profile.disallowed_tools, vec!["Bash"]);
        assert_eq!(profile.permission_mode.as_deref(), Some("plan"));
        assert_eq!(profile.add_dirs, vec![PathBuf::from("docs")]);
        assert_eq!(profile.token_budget, Some(1200));
        assert_eq!(
            profile.append_system_prompt.as_deref(),
            Some("Be careful.\n\nReview thoroughly.")
        );
    }

    #[test]
    fn agent_profile_resolution_rejects_inheritance_cycles() {
        let config: Config = toml::from_str(
            r#"
[agent_profiles.a]
inherits = "b"

[agent_profiles.b]
inherits = "a"
"#,
        )
        .unwrap();

        let error = config
            .resolve_agent_profile("a")
            .expect_err("profile inheritance cycles must fail");
        assert!(error
            .to_string()
            .contains("agent profile inheritance cycle"));
    }

    #[test]
    fn harness_runners_deserialize_from_toml() {
        let config: Config = toml::from_str(
            r#"
[harness_runners.cursor]
program = "cursor-agent"
base_args = ["run"]
project_markers = [".cursor", ".cursor/rules"]
cwd_flag = "--cwd"
session_name_flag = "--name"
task_flag = "--task"
model_flag = "--model"
permission_mode_flag = "--permission-mode"
inline_system_prompt_for_task = true

[harness_runners.cursor.env]
ECC_HARNESS = "cursor"
"#,
        )
        .unwrap();

        let runner = config.harness_runner("cursor").expect("cursor runner");
        assert_eq!(runner.program, "cursor-agent");
        assert_eq!(runner.base_args, vec!["run"]);
        assert_eq!(
            runner.project_markers,
            vec![PathBuf::from(".cursor"), PathBuf::from(".cursor/rules")]
        );
        assert_eq!(runner.cwd_flag.as_deref(), Some("--cwd"));
        assert_eq!(runner.session_name_flag.as_deref(), Some("--name"));
        assert_eq!(runner.task_flag.as_deref(), Some("--task"));
        assert_eq!(runner.model_flag.as_deref(), Some("--model"));
        assert_eq!(
            runner.permission_mode_flag.as_deref(),
            Some("--permission-mode")
        );
        assert!(runner.inline_system_prompt_for_task);
        assert_eq!(
            runner.env.get("ECC_HARNESS").map(String::as_str),
            Some("cursor")
        );
    }

    #[test]
    fn orchestration_templates_resolve_steps_and_interpolate_variables() {
        let config: Config = toml::from_str(
            r#"
default_agent = "claude"
default_agent_profile = "reviewer"

[agent_profiles.reviewer]
model = "sonnet"

[orchestration_templates.feature_development]
description = "Ship {{task}}"
project = "{{project}}"
task_group = "{{task_group}}"
profile = "reviewer"
worktree = true

[[orchestration_templates.feature_development.steps]]
name = "planner"
task = "Plan {{task}}"
agent = "claude"

[[orchestration_templates.feature_development.steps]]
name = "reviewer"
task = "Review {{task}} in {{component}}"
profile = "reviewer"
worktree = false
"#,
        )
        .unwrap();

        let vars = BTreeMap::from([
            ("task".to_string(), "stabilize auth callback".to_string()),
            ("project".to_string(), "ecc-core".to_string()),
            ("task_group".to_string(), "auth callback".to_string()),
            ("component".to_string(), "billing".to_string()),
        ]);
        let template = config
            .resolve_orchestration_template("feature_development", &vars)
            .unwrap();

        assert_eq!(template.template_name, "feature_development");
        assert_eq!(
            template.description.as_deref(),
            Some("Ship stabilize auth callback")
        );
        assert_eq!(template.project.as_deref(), Some("ecc-core"));
        assert_eq!(template.task_group.as_deref(), Some("auth callback"));
        assert_eq!(template.steps.len(), 2);
        assert_eq!(template.steps[0].name, "planner");
        assert_eq!(template.steps[0].task, "Plan stabilize auth callback");
        assert_eq!(template.steps[0].agent.as_deref(), Some("claude"));
        assert_eq!(template.steps[0].profile.as_deref(), Some("reviewer"));
        assert!(template.steps[0].worktree);
        assert_eq!(
            template.steps[1].task,
            "Review stabilize auth callback in billing"
        );
        assert!(!template.steps[1].worktree);
    }

    #[test]
    fn orchestration_templates_fail_when_required_variables_are_missing() {
        let config: Config = toml::from_str(
            r#"
[orchestration_templates.feature_development]
[[orchestration_templates.feature_development.steps]]
task = "Plan {{task}} for {{component}}"
"#,
        )
        .unwrap();

        let error = config
            .resolve_orchestration_template(
                "feature_development",
                &BTreeMap::from([("task".to_string(), "fix retry".to_string())]),
            )
            .expect_err("missing template variables must fail");
        let error_text = format!("{error:#}");
        assert!(error_text
            .contains("resolve task for orchestration template feature_development step 1"));
        assert!(error_text.contains("missing orchestration template variable(s): component"));
    }

    #[test]
    fn memory_connectors_deserialize_from_toml() {
        let config: Config = toml::from_str(
            r#"
[memory_connectors.hermes_notes]
kind = "jsonl_file"
path = "/tmp/hermes-memory.jsonl"
session_id = "latest"
default_entity_type = "incident"
default_observation_type = "external_note"
"#,
        )
        .unwrap();

        let connector = config
            .memory_connectors
            .get("hermes_notes")
            .expect("connector should deserialize");
        match connector {
            crate::config::MemoryConnectorConfig::JsonlFile(settings) => {
                assert_eq!(settings.path, PathBuf::from("/tmp/hermes-memory.jsonl"));
                assert_eq!(settings.session_id.as_deref(), Some("latest"));
                assert_eq!(settings.default_entity_type.as_deref(), Some("incident"));
                assert_eq!(
                    settings.default_observation_type.as_deref(),
                    Some("external_note")
                );
            }
            _ => panic!("expected jsonl_file connector"),
        }
    }

    #[test]
    fn memory_jsonl_directory_connectors_deserialize_from_toml() {
        let config: Config = toml::from_str(
            r#"
[memory_connectors.hermes_dir]
kind = "jsonl_directory"
path = "/tmp/hermes-memory"
recurse = true
default_entity_type = "incident"
default_observation_type = "external_note"
"#,
        )
        .unwrap();

        let connector = config
            .memory_connectors
            .get("hermes_dir")
            .expect("connector should deserialize");
        match connector {
            crate::config::MemoryConnectorConfig::JsonlDirectory(settings) => {
                assert_eq!(settings.path, PathBuf::from("/tmp/hermes-memory"));
                assert!(settings.recurse);
                assert_eq!(settings.default_entity_type.as_deref(), Some("incident"));
                assert_eq!(
                    settings.default_observation_type.as_deref(),
                    Some("external_note")
                );
            }
            _ => panic!("expected jsonl_directory connector"),
        }
    }

    #[test]
    fn memory_markdown_file_connectors_deserialize_from_toml() {
        let config: Config = toml::from_str(
            r#"
[memory_connectors.workspace_note]
kind = "markdown_file"
path = "/tmp/hermes-memory.md"
session_id = "latest"
default_entity_type = "note_section"
default_observation_type = "external_note"
"#,
        )
        .unwrap();

        let connector = config
            .memory_connectors
            .get("workspace_note")
            .expect("connector should deserialize");
        match connector {
            crate::config::MemoryConnectorConfig::MarkdownFile(settings) => {
                assert_eq!(settings.path, PathBuf::from("/tmp/hermes-memory.md"));
                assert_eq!(settings.session_id.as_deref(), Some("latest"));
                assert_eq!(
                    settings.default_entity_type.as_deref(),
                    Some("note_section")
                );
                assert_eq!(
                    settings.default_observation_type.as_deref(),
                    Some("external_note")
                );
            }
            _ => panic!("expected markdown_file connector"),
        }
    }

    #[test]
    fn memory_markdown_directory_connectors_deserialize_from_toml() {
        let config: Config = toml::from_str(
            r#"
[memory_connectors.workspace_notes]
kind = "markdown_directory"
path = "/tmp/hermes-memory"
recurse = true
session_id = "latest"
default_entity_type = "note_section"
default_observation_type = "external_note"
"#,
        )
        .unwrap();

        let connector = config
            .memory_connectors
            .get("workspace_notes")
            .expect("connector should deserialize");
        match connector {
            crate::config::MemoryConnectorConfig::MarkdownDirectory(settings) => {
                assert_eq!(settings.path, PathBuf::from("/tmp/hermes-memory"));
                assert!(settings.recurse);
                assert_eq!(settings.session_id.as_deref(), Some("latest"));
                assert_eq!(
                    settings.default_entity_type.as_deref(),
                    Some("note_section")
                );
                assert_eq!(
                    settings.default_observation_type.as_deref(),
                    Some("external_note")
                );
            }
            _ => panic!("expected markdown_directory connector"),
        }
    }

    #[test]
    fn memory_dotenv_file_connectors_deserialize_from_toml() {
        let config: Config = toml::from_str(
            r#"
[memory_connectors.hermes_env]
kind = "dotenv_file"
path = "/tmp/hermes.env"
session_id = "latest"
default_entity_type = "service_config"
default_observation_type = "external_config"
key_prefixes = ["STRIPE_", "PUBLIC_"]
include_keys = ["PUBLIC_BASE_URL"]
exclude_keys = ["STRIPE_WEBHOOK_SECRET"]
include_safe_values = true
"#,
        )
        .unwrap();

        let connector = config
            .memory_connectors
            .get("hermes_env")
            .expect("connector should deserialize");
        match connector {
            crate::config::MemoryConnectorConfig::DotenvFile(settings) => {
                assert_eq!(settings.path, PathBuf::from("/tmp/hermes.env"));
                assert_eq!(settings.session_id.as_deref(), Some("latest"));
                assert_eq!(
                    settings.default_entity_type.as_deref(),
                    Some("service_config")
                );
                assert_eq!(
                    settings.default_observation_type.as_deref(),
                    Some("external_config")
                );
                assert_eq!(settings.key_prefixes, vec!["STRIPE_", "PUBLIC_"]);
                assert_eq!(settings.include_keys, vec!["PUBLIC_BASE_URL"]);
                assert_eq!(settings.exclude_keys, vec!["STRIPE_WEBHOOK_SECRET"]);
                assert!(settings.include_safe_values);
            }
            _ => panic!("expected dotenv_file connector"),
        }
    }

    #[test]
    fn completion_summary_notifications_deserialize_from_toml() {
        let config: Config = toml::from_str(
            r#"
[completion_summary_notifications]
enabled = true
delivery = "desktop_and_tui_popup"
"#,
        )
        .unwrap();

        assert!(config.completion_summary_notifications.enabled);
        assert_eq!(
            config.completion_summary_notifications.delivery,
            crate::notifications::CompletionSummaryDelivery::DesktopAndTuiPopup
        );
    }

    #[test]
    fn webhook_notifications_deserialize_from_toml() {
        let config: Config = toml::from_str(
            r#"
[webhook_notifications]
enabled = true
session_started = true
session_completed = true
session_failed = true
budget_alerts = true
approval_requests = false

[[webhook_notifications.targets]]
provider = "slack"
url = "https://hooks.slack.test/services/abc"

[[webhook_notifications.targets]]
provider = "discord"
url = "https://discord.test/api/webhooks/123"
"#,
        )
        .unwrap();

        assert!(config.webhook_notifications.enabled);
        assert!(config.webhook_notifications.session_started);
        assert_eq!(config.webhook_notifications.targets.len(), 2);
        assert_eq!(
            config.webhook_notifications.targets[0].provider,
            crate::notifications::WebhookProvider::Slack
        );
        assert_eq!(
            config.webhook_notifications.targets[1].provider,
            crate::notifications::WebhookProvider::Discord
        );
    }

    #[test]
    fn invalid_budget_alert_thresholds_fall_back_to_defaults() {
        let config: Config = toml::from_str(
            r#"
[budget_alert_thresholds]
advisory = 0.80
warning = 0.70
critical = 1.10
"#,
        )
        .unwrap();

        assert_eq!(
            config.effective_budget_alert_thresholds(),
            Config::BUDGET_ALERT_THRESHOLDS
        );
    }

    #[test]
    fn save_round_trips_automation_settings() {
        let path = std::env::temp_dir().join(format!("ecc2-config-{}.toml", Uuid::new_v4()));
        let mut config = Config::default();
        config.auto_dispatch_unread_handoffs = true;
        config.auto_dispatch_limit_per_session = 9;
        config.auto_create_worktrees = false;
        config.auto_merge_ready_worktrees = true;
        config.desktop_notifications.session_completed = false;
        config.webhook_notifications.enabled = true;
        config.webhook_notifications.targets = vec![crate::notifications::WebhookTarget {
            provider: crate::notifications::WebhookProvider::Slack,
            url: "https://hooks.slack.test/services/abc".to_string(),
        }];
        config.completion_summary_notifications.delivery =
            crate::notifications::CompletionSummaryDelivery::TuiPopup;
        config.desktop_notifications.quiet_hours.enabled = true;
        config.desktop_notifications.quiet_hours.start_hour = 21;
        config.desktop_notifications.quiet_hours.end_hour = 7;
        config.worktree_branch_prefix = "bots/ecc".to_string();
        config.budget_alert_thresholds = BudgetAlertThresholds {
            advisory: 0.45,
            warning: 0.70,
            critical: 0.88,
        };
        config.conflict_resolution.strategy = ConflictResolutionStrategy::Merge;
        config.conflict_resolution.notify_lead = false;
        config.pane_navigation.focus_metrics = "e".to_string();
        config.pane_navigation.move_right = "d".to_string();
        config.linear_pane_size_percent = 42;
        config.grid_pane_size_percent = 55;

        config.save_to_path(&path).unwrap();
        let content = std::fs::read_to_string(&path).unwrap();
        let loaded: Config = toml::from_str(&content).unwrap();

        assert!(loaded.auto_dispatch_unread_handoffs);
        assert_eq!(loaded.auto_dispatch_limit_per_session, 9);
        assert!(!loaded.auto_create_worktrees);
        assert!(loaded.auto_merge_ready_worktrees);
        assert!(!loaded.desktop_notifications.session_completed);
        assert!(loaded.webhook_notifications.enabled);
        assert_eq!(loaded.webhook_notifications.targets.len(), 1);
        assert_eq!(
            loaded.webhook_notifications.targets[0].provider,
            crate::notifications::WebhookProvider::Slack
        );
        assert_eq!(
            loaded.completion_summary_notifications.delivery,
            crate::notifications::CompletionSummaryDelivery::TuiPopup
        );
        assert!(loaded.desktop_notifications.quiet_hours.enabled);
        assert_eq!(loaded.desktop_notifications.quiet_hours.start_hour, 21);
        assert_eq!(loaded.desktop_notifications.quiet_hours.end_hour, 7);
        assert_eq!(loaded.worktree_branch_prefix, "bots/ecc");
        assert_eq!(
            loaded.budget_alert_thresholds,
            BudgetAlertThresholds {
                advisory: 0.45,
                warning: 0.70,
                critical: 0.88,
            }
        );
        assert_eq!(
            loaded.conflict_resolution.strategy,
            ConflictResolutionStrategy::Merge
        );
        assert!(!loaded.conflict_resolution.notify_lead);
        assert_eq!(loaded.pane_navigation.focus_metrics, "e");
        assert_eq!(loaded.pane_navigation.move_right, "d");
        assert_eq!(loaded.linear_pane_size_percent, 42);
        assert_eq!(loaded.grid_pane_size_percent, 55);

        let _ = std::fs::remove_file(path);
    }
}
