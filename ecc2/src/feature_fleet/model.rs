use serde::{Deserialize, Serialize};
use std::fmt;
use std::str::FromStr;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct NormalizedManifest {
    pub schema: String,
    pub id: String,
    pub title: String,
    pub base_branch: String,
    pub default_agent: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_profile: Option<String>,
    pub features: Vec<FeatureManifest>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct FeatureManifest {
    pub id: String,
    pub title: String,
    pub task: String,
    #[serde(default)]
    pub depends_on: Vec<String>,
    #[serde(default)]
    pub owns: Vec<String>,
    #[serde(default)]
    pub contracts: Vec<String>,
    #[serde(default)]
    pub checks: Vec<VerificationCheck>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub profile: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct VerificationCheck {
    pub id: String,
    pub program: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default = "default_working_directory")]
    pub working_directory: String,
    #[serde(default = "default_timeout_seconds")]
    pub timeout_seconds: u64,
    #[serde(default)]
    pub environment_allowlist: Vec<String>,
    #[serde(default = "default_max_output_bytes")]
    pub max_output_bytes: u64,
    pub requires_repository_trust: bool,
}

fn default_working_directory() -> String {
    ".".to_string()
}

const fn default_timeout_seconds() -> u64 {
    900
}

const fn default_max_output_bytes() -> u64 {
    10 * 1024 * 1024
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ParsedManifest {
    pub manifest: NormalizedManifest,
    pub digest: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FleetSchedule {
    pub topological_order: Vec<String>,
    pub initial_ready: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DeclaredCollision {
    pub kind: String,
    pub left_feature: String,
    pub right_feature: String,
    pub detail: String,
    pub required_action: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FleetLifecycleState {
    Planned,
    Running,
    Reviewing,
    Integrating,
    Completed,
    Failed,
}

impl FleetLifecycleState {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Planned => "planned",
            Self::Running => "running",
            Self::Reviewing => "reviewing",
            Self::Integrating => "integrating",
            Self::Completed => "completed",
            Self::Failed => "failed",
        }
    }
}

impl fmt::Display for FleetLifecycleState {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

impl FromStr for FleetLifecycleState {
    type Err = anyhow::Error;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "planned" => Ok(Self::Planned),
            "running" => Ok(Self::Running),
            "reviewing" => Ok(Self::Reviewing),
            "integrating" => Ok(Self::Integrating),
            "completed" => Ok(Self::Completed),
            "failed" => Ok(Self::Failed),
            _ => anyhow::bail!("Unknown Feature Fleet lifecycle state: {value}"),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FleetBlockerKind {
    Collision,
    Dependency,
    Verification,
    Scope,
    Git,
    OperatorApproval,
    Recovery,
}

impl FleetBlockerKind {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Collision => "collision",
            Self::Dependency => "dependency",
            Self::Verification => "verification",
            Self::Scope => "scope",
            Self::Git => "git",
            Self::OperatorApproval => "operator_approval",
            Self::Recovery => "recovery",
        }
    }
}

impl fmt::Display for FleetBlockerKind {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FleetBlocker {
    pub kind: FleetBlockerKind,
    pub code: String,
    pub entity_ids: Vec<String>,
    pub summary: String,
    pub required_resolution_action: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FleetPlan {
    pub experimental: bool,
    pub manifest: NormalizedManifest,
    pub manifest_digest: String,
    pub schedule: FleetSchedule,
    pub collisions: Vec<DeclaredCollision>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FleetRecord {
    pub id: String,
    pub title: String,
    pub repo_root: String,
    pub base_branch: String,
    pub base_oid: String,
    pub manifest_digest: String,
    pub revision: i64,
    pub lifecycle_state: FleetLifecycleState,
    pub blockers: Vec<FleetBlocker>,
    pub features: Vec<FleetFeatureRecord>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FleetFeatureRecord {
    pub id: String,
    pub title: String,
    pub task: String,
    pub depends_on: Vec<String>,
    pub owns: Vec<String>,
    pub contracts: Vec<String>,
    pub checks: Vec<VerificationCheck>,
    pub lifecycle_state: FleetLifecycleState,
    pub blockers: Vec<FleetBlocker>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FleetEvent {
    pub id: i64,
    pub fleet_id: String,
    pub fleet_revision: i64,
    pub event_kind: String,
    pub entity_kind: String,
    pub entity_id: String,
    pub payload: serde_json::Value,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FleetStatusReport {
    pub experimental: bool,
    pub fleet: FleetRecord,
    pub events: Vec<FleetEvent>,
}

#[cfg(test)]
mod tests {
    use super::FleetLifecycleState;
    use std::str::FromStr;

    #[test]
    fn blockers_are_not_lifecycle_states() {
        assert_eq!(
            FleetLifecycleState::from_str("reviewing").expect("reviewing state"),
            FleetLifecycleState::Reviewing
        );
        assert!(FleetLifecycleState::from_str("blocked").is_err());
    }
}
