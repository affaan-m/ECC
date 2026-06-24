mod comms;
mod config;
mod notifications;
mod observability;
mod session;
mod tui;
mod worktree;

#[cfg(test)]
pub(crate) mod test_support {
    use anyhow::{Context, Result};
    use std::path::{Path, PathBuf};
    use std::sync::{Mutex, MutexGuard, OnceLock};

    static CURRENT_DIR_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

    pub(crate) struct CurrentDirGuard {
        _lock: MutexGuard<'static, ()>,
        original_dir: PathBuf,
    }

    impl CurrentDirGuard {
        pub(crate) fn enter(target_dir: &Path) -> Result<Self> {
            let lock = CURRENT_DIR_LOCK
                .get_or_init(|| Mutex::new(()))
                .lock()
                .expect("current-dir test lock poisoned");
            let original_dir =
                std::env::current_dir().context("Failed to capture current test directory")?;
            std::env::set_current_dir(target_dir).with_context(|| {
                format!("Failed to enter test directory {}", target_dir.display())
            })?;

            Ok(Self {
                _lock: lock,
                original_dir,
            })
        }
    }

    impl Drop for CurrentDirGuard {
        fn drop(&mut self) {
            let _ = std::env::set_current_dir(&self.original_dir);
        }
    }
}

use anyhow::{Context, Result};
use clap::Parser;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::fs::{self, File};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use tracing_subscriber::EnvFilter;

#[derive(Parser, Debug)]
#[command(name = "ecc", version, about = "ECC 2.0 — Agentic IDE control plane")]
struct Cli {
    #[command(subcommand)]
    command: Option<Commands>,
}

#[derive(clap::Args, Debug, Clone, Default)]
struct WorktreePolicyArgs {
    /// Create a dedicated worktree
    #[arg(short = 'w', long = "worktree", action = clap::ArgAction::SetTrue, overrides_with = "no_worktree")]
    worktree: bool,
    /// Skip dedicated worktree creation
    #[arg(long = "no-worktree", action = clap::ArgAction::SetTrue, overrides_with = "worktree")]
    no_worktree: bool,
}

impl WorktreePolicyArgs {
    fn resolve(&self, cfg: &config::Config) -> bool {
        if self.worktree {
            true
        } else if self.no_worktree {
            false
        } else {
            cfg.auto_create_worktrees
        }
    }
}

#[derive(clap::Args, Debug, Clone, Default)]
struct OptionalWorktreePolicyArgs {
    /// Create a dedicated worktree
    #[arg(short = 'w', long = "worktree", action = clap::ArgAction::SetTrue, overrides_with = "no_worktree")]
    worktree: bool,
    /// Skip dedicated worktree creation
    #[arg(long = "no-worktree", action = clap::ArgAction::SetTrue, overrides_with = "worktree")]
    no_worktree: bool,
}

impl OptionalWorktreePolicyArgs {
    fn resolve(&self, default_value: bool) -> bool {
        if self.worktree {
            true
        } else if self.no_worktree {
            false
        } else {
            default_value
        }
    }
}

#[derive(clap::Subcommand, Debug)]
enum Commands {
    /// Launch the TUI dashboard
    Dashboard,
    /// Start a new agent session
    Start {
        /// Task description for the agent
        #[arg(short, long)]
        task: String,
        /// Agent type (defaults to `default_agent` from ecc2.toml)
        #[arg(short, long)]
        agent: Option<String>,
        /// Agent profile defined in ecc2.toml
        #[arg(long)]
        profile: Option<String>,
        #[command(flatten)]
        worktree: WorktreePolicyArgs,
        /// Source session to delegate from
        #[arg(long)]
        from_session: Option<String>,
    },
    /// Delegate a new session from an existing one
    Delegate {
        /// Source session ID or alias
        from_session: String,
        /// Task description for the delegated session
        #[arg(short, long)]
        task: Option<String>,
        /// Agent type (defaults to `default_agent` from ecc2.toml)
        #[arg(short, long)]
        agent: Option<String>,
        /// Agent profile defined in ecc2.toml
        #[arg(long)]
        profile: Option<String>,
        #[command(flatten)]
        worktree: WorktreePolicyArgs,
    },
    /// Launch a named orchestration template
    Template {
        /// Template name defined in ecc2.toml
        name: String,
        /// Optional task injected into the template context
        #[arg(short, long)]
        task: Option<String>,
        /// Source session to delegate the template from
        #[arg(long)]
        from_session: Option<String>,
        /// Template variables in key=value form
        #[arg(long = "var")]
        vars: Vec<String>,
    },
    /// Route work to an existing delegate when possible, otherwise spawn a new one
    Assign {
        /// Lead session ID or alias
        from_session: String,
        /// Task description for the assignment
        #[arg(short, long)]
        task: String,
        /// Agent type (defaults to `default_agent` from ecc2.toml)
        #[arg(short, long)]
        agent: Option<String>,
        /// Agent profile defined in ecc2.toml
        #[arg(long)]
        profile: Option<String>,
        #[command(flatten)]
        worktree: WorktreePolicyArgs,
    },
    /// Route unread task handoffs from a lead session inbox through the assignment policy
    DrainInbox {
        /// Lead session ID or alias
        session_id: String,
        /// Agent type for routed delegates (defaults to `default_agent` from ecc2.toml)
        #[arg(short, long)]
        agent: Option<String>,
        #[command(flatten)]
        worktree: WorktreePolicyArgs,
        /// Maximum unread task handoffs to route
        #[arg(long, default_value_t = 5)]
        limit: usize,
    },
    /// Sweep unread task handoffs across lead sessions and route them through the assignment policy
    AutoDispatch {
        /// Agent type for routed delegates (defaults to `default_agent` from ecc2.toml)
        #[arg(short, long)]
        agent: Option<String>,
        #[command(flatten)]
        worktree: WorktreePolicyArgs,
        /// Maximum lead sessions to sweep in one pass
        #[arg(long, default_value_t = 10)]
        lead_limit: usize,
    },
    /// Dispatch unread handoffs, then rebalance delegate backlog across lead teams
    CoordinateBacklog {
        /// Agent type for routed delegates (defaults to `default_agent` from ecc2.toml)
        #[arg(short, long)]
        agent: Option<String>,
        #[command(flatten)]
        worktree: WorktreePolicyArgs,
        /// Maximum lead sessions to sweep in one pass
        #[arg(long, default_value_t = 10)]
        lead_limit: usize,
        /// Emit machine-readable JSON instead of the human summary
        #[arg(long)]
        json: bool,
        /// Return a non-zero exit code from the final coordination health
        #[arg(long)]
        check: bool,
        /// Keep coordinating until the backlog is healthy, saturated, or max passes is reached
        #[arg(long)]
        until_healthy: bool,
        /// Maximum coordination passes when using --until-healthy
        #[arg(long, default_value_t = 5)]
        max_passes: usize,
    },
    /// Show global coordination, backlog, and daemon policy status
    CoordinationStatus {
        /// Emit machine-readable JSON instead of the human summary
        #[arg(long)]
        json: bool,
        /// Return a non-zero exit code when backlog or saturation needs attention
        #[arg(long)]
        check: bool,
    },
    /// Coordinate only when backlog pressure actually needs work
    MaintainCoordination {
        /// Agent type for routed delegates (defaults to `default_agent` from ecc2.toml)
        #[arg(short, long)]
        agent: Option<String>,
        #[command(flatten)]
        worktree: WorktreePolicyArgs,
        /// Maximum lead sessions to sweep in one pass
        #[arg(long, default_value_t = 10)]
        lead_limit: usize,
        /// Emit machine-readable JSON instead of the human summary
        #[arg(long)]
        json: bool,
        /// Return a non-zero exit code from the final coordination health
        #[arg(long)]
        check: bool,
        /// Maximum coordination passes when maintenance is needed
        #[arg(long, default_value_t = 5)]
        max_passes: usize,
    },
    /// Rebalance unread handoffs across lead teams with backed-up delegates
    RebalanceAll {
        /// Agent type for routed delegates (defaults to `default_agent` from ecc2.toml)
        #[arg(short, long)]
        agent: Option<String>,
        #[command(flatten)]
        worktree: WorktreePolicyArgs,
        /// Maximum lead sessions to sweep in one pass
        #[arg(long, default_value_t = 10)]
        lead_limit: usize,
    },
    /// Rebalance unread handoffs off backed-up delegates onto clearer team capacity
    RebalanceTeam {
        /// Lead session ID or alias
        session_id: String,
        /// Agent type for routed delegates (defaults to `default_agent` from ecc2.toml)
        #[arg(short, long)]
        agent: Option<String>,
        #[command(flatten)]
        worktree: WorktreePolicyArgs,
        /// Maximum handoffs to reroute in one pass
        #[arg(long, default_value_t = 5)]
        limit: usize,
    },
    /// List active sessions
    Sessions,
    /// Show session details
    Status {
        /// Session ID or alias
        session_id: Option<String>,
    },
    /// Show delegated team board for a session
    Team {
        /// Lead session ID or alias
        session_id: Option<String>,
        /// Delegation depth to traverse
        #[arg(long, default_value_t = 2)]
        depth: usize,
    },
    /// Show worktree diff and merge-readiness details for a session
    WorktreeStatus {
        /// Session ID or alias
        session_id: Option<String>,
        /// Show worktree status for all sessions
        #[arg(long)]
        all: bool,
        /// Emit machine-readable JSON instead of the human summary
        #[arg(long)]
        json: bool,
        /// Include a bounded patch preview when a worktree is attached
        #[arg(long)]
        patch: bool,
        /// Return a non-zero exit code when the worktree needs attention
        #[arg(long)]
        check: bool,
    },
    /// Show conflict-resolution protocol for a worktree
    WorktreeResolution {
        /// Session ID or alias
        session_id: Option<String>,
        /// Show conflict protocol for all conflicted worktrees
        #[arg(long)]
        all: bool,
        /// Emit machine-readable JSON instead of the human summary
        #[arg(long)]
        json: bool,
        /// Return a non-zero exit code when conflicted worktrees are present
        #[arg(long)]
        check: bool,
    },
    /// Merge a session worktree branch into its base branch
    MergeWorktree {
        /// Session ID or alias
        session_id: Option<String>,
        /// Merge all ready inactive worktrees
        #[arg(long)]
        all: bool,
        /// Emit machine-readable JSON instead of the human summary
        #[arg(long)]
        json: bool,
        /// Keep the worktree attached after a successful merge
        #[arg(long)]
        keep_worktree: bool,
    },
    /// Show the merge queue for inactive worktrees and any branch-to-branch blockers
    MergeQueue {
        /// Emit machine-readable JSON instead of the human summary
        #[arg(long)]
        json: bool,
        /// Process the queue, auto-rebasing clean blocked worktrees and merging what becomes ready
        #[arg(long)]
        apply: bool,
    },
    /// Prune worktrees for inactive sessions and report any active sessions still holding one
    PruneWorktrees {
        /// Emit machine-readable JSON instead of the human summary
        #[arg(long)]
        json: bool,
    },
    /// Log a significant agent decision for auditability
    LogDecision {
        /// Session ID or alias. Omit to log against the latest session.
        session_id: Option<String>,
        /// The chosen decision or direction
        #[arg(long)]
        decision: String,
        /// Why the agent made this choice
        #[arg(long)]
        reasoning: String,
        /// Alternative considered and rejected; repeat for multiple entries
        #[arg(long = "alternative")]
        alternatives: Vec<String>,
        /// Emit machine-readable JSON instead of the human summary
        #[arg(long)]
        json: bool,
    },
    /// Show recent decision-log entries
    Decisions {
        /// Session ID or alias. Omit to read the latest session.
        session_id: Option<String>,
        /// Show decision log entries across all sessions
        #[arg(long)]
        all: bool,
        /// Emit machine-readable JSON instead of the human summary
        #[arg(long)]
        json: bool,
        /// Maximum decision-log entries to return
        #[arg(long, default_value_t = 20)]
        limit: usize,
    },
    /// Read and write the shared context graph
    Graph {
        #[command(subcommand)]
        command: GraphCommands,
    },
    /// Audit Hermes/OpenClaw-style workspaces and map them onto ECC2
    Migrate {
        #[command(subcommand)]
        command: MigrationCommands,
    },
    /// Manage persistent scheduled task dispatch
    Schedule {
        #[command(subcommand)]
        command: ScheduleCommands,
    },
    /// Manage remote task intake and dispatch
    Remote {
        #[command(subcommand)]
        command: RemoteCommands,
    },
    /// Export sessions, tool spans, and metrics in OTLP-compatible JSON
    ExportOtel {
        /// Session ID or alias. Omit to export all sessions.
        session_id: Option<String>,
        /// Write the export to a file instead of stdout
        #[arg(long)]
        output: Option<PathBuf>,
    },
    /// Stop a running session
    Stop {
        /// Session ID or alias
        session_id: String,
    },
    /// Resume a failed or stopped session
    Resume {
        /// Session ID or alias
        session_id: String,
    },
    /// Send or inspect inter-session messages
    Messages {
        #[command(subcommand)]
        command: MessageCommands,
    },
    /// Run as background daemon
    Daemon,
    #[command(hide = true)]
    RunSession {
        #[arg(long)]
        session_id: String,
        #[arg(long)]
        task: String,
        #[arg(long)]
        agent: String,
        #[arg(long)]
        cwd: PathBuf,
    },
}

#[derive(clap::Subcommand, Debug)]
enum MessageCommands {
    /// Send a structured message between sessions
    Send {
        #[arg(long)]
        from: String,
        #[arg(long)]
        to: String,
        #[arg(long, value_enum)]
        kind: MessageKindArg,
        #[arg(long)]
        text: String,
        #[arg(long)]
        context: Option<String>,
        #[arg(long, value_enum, default_value_t = TaskPriorityArg::Normal)]
        priority: TaskPriorityArg,
        #[arg(long)]
        file: Vec<String>,
    },
    /// Show recent messages for a session
    Inbox {
        session_id: String,
        #[arg(long, default_value_t = 10)]
        limit: usize,
    },
}

#[derive(clap::Subcommand, Debug)]
enum ScheduleCommands {
    /// Add a persistent scheduled task
    Add {
        /// Cron expression in 5, 6, or 7-field form
        #[arg(long)]
        cron: String,
        /// Task description to run on each schedule
        #[arg(short, long)]
        task: String,
        /// Agent type (claude, codex, gemini, opencode)
        #[arg(short, long)]
        agent: Option<String>,
        /// Agent profile defined in ecc2.toml
        #[arg(long)]
        profile: Option<String>,
        #[command(flatten)]
        worktree: WorktreePolicyArgs,
        /// Optional project grouping override
        #[arg(long)]
        project: Option<String>,
        /// Optional task-group grouping override
        #[arg(long)]
        task_group: Option<String>,
        /// Emit machine-readable JSON instead of the human summary
        #[arg(long)]
        json: bool,
    },
    /// List scheduled tasks
    List {
        /// Emit machine-readable JSON instead of the human summary
        #[arg(long)]
        json: bool,
    },
    /// Remove a scheduled task
    Remove {
        /// Schedule ID
        schedule_id: i64,
    },
    /// Dispatch currently due scheduled tasks
    RunDue {
        /// Maximum due schedules to dispatch in one pass
        #[arg(long, default_value_t = 10)]
        limit: usize,
        /// Emit machine-readable JSON instead of the human summary
        #[arg(long)]
        json: bool,
    },
}

#[derive(clap::Subcommand, Debug)]
enum RemoteCommands {
    /// Queue a remote task request
    Add {
        /// Task description to dispatch
        #[arg(short, long)]
        task: String,
        /// Optional lead session ID or alias to route through
        #[arg(long)]
        to_session: Option<String>,
        /// Task priority
        #[arg(long, value_enum, default_value_t = TaskPriorityArg::Normal)]
        priority: TaskPriorityArg,
        /// Agent type (defaults to ECC default agent)
        #[arg(short, long)]
        agent: Option<String>,
        /// Agent profile defined in ecc2.toml
        #[arg(long)]
        profile: Option<String>,
        #[command(flatten)]
        worktree: WorktreePolicyArgs,
        /// Optional project grouping override
        #[arg(long)]
        project: Option<String>,
        /// Optional task-group grouping override
        #[arg(long)]
        task_group: Option<String>,
        /// Emit machine-readable JSON instead of the human summary
        #[arg(long)]
        json: bool,
    },
    /// Queue a remote computer-use task request
    ComputerUse {
        /// Goal to complete with computer-use/browser tools
        #[arg(long)]
        goal: String,
        /// Optional target URL to open first
        #[arg(long)]
        target_url: Option<String>,
        /// Extra context for the operator
        #[arg(long)]
        context: Option<String>,
        /// Optional lead session ID or alias to route through
        #[arg(long)]
        to_session: Option<String>,
        /// Task priority
        #[arg(long, value_enum, default_value_t = TaskPriorityArg::Normal)]
        priority: TaskPriorityArg,
        /// Agent type override (defaults to [computer_use_dispatch] or ECC default agent)
        #[arg(short, long)]
        agent: Option<String>,
        /// Agent profile override (defaults to [computer_use_dispatch] or ECC default profile)
        #[arg(long)]
        profile: Option<String>,
        #[command(flatten)]
        worktree: OptionalWorktreePolicyArgs,
        /// Optional project grouping override
        #[arg(long)]
        project: Option<String>,
        /// Optional task-group grouping override
        #[arg(long)]
        task_group: Option<String>,
        /// Emit machine-readable JSON instead of the human summary
        #[arg(long)]
        json: bool,
    },
    /// List queued remote task requests
    List {
        /// Include already dispatched or failed requests
        #[arg(long)]
        all: bool,
        /// Maximum requests to return
        #[arg(long, default_value_t = 20)]
        limit: usize,
        /// Emit machine-readable JSON instead of the human summary
        #[arg(long)]
        json: bool,
    },
    /// Dispatch queued remote task requests now
    Run {
        /// Maximum queued requests to process
        #[arg(long, default_value_t = 20)]
        limit: usize,
        /// Emit machine-readable JSON instead of the human summary
        #[arg(long)]
        json: bool,
    },
    /// Serve a token-authenticated remote dispatch intake endpoint
    Serve {
        /// Address to bind, for example 127.0.0.1:8787
        #[arg(long, default_value = "127.0.0.1:8787")]
        bind: String,
        /// Bearer token required for POST /dispatch
        #[arg(long)]
        token: String,
    },
}

#[derive(clap::Subcommand, Debug)]
enum MigrationCommands {
    /// Audit a Hermes/OpenClaw-style workspace and map it onto ECC2 features
    Audit {
        /// Path to the legacy Hermes/OpenClaw workspace root
        #[arg(long)]
        source: PathBuf,
        /// Emit machine-readable JSON instead of the human summary
        #[arg(long)]
        json: bool,
    },
    /// Generate an actionable ECC2 migration plan from a legacy workspace audit
    Plan {
        /// Path to the legacy Hermes/OpenClaw workspace root
        #[arg(long)]
        source: PathBuf,
        /// Write the plan to a file instead of stdout
        #[arg(long)]
        output: Option<PathBuf>,
        /// Emit machine-readable JSON instead of the human summary
        #[arg(long)]
        json: bool,
    },
    /// Scaffold migration artifacts on disk from a legacy workspace audit
    Scaffold {
        /// Path to the legacy Hermes/OpenClaw workspace root
        #[arg(long)]
        source: PathBuf,
        /// Directory where scaffolded migration artifacts should be written
        #[arg(long)]
        output_dir: PathBuf,
        /// Emit machine-readable JSON instead of the human summary
        #[arg(long)]
        json: bool,
    },
    /// Import recurring jobs from a legacy cron/jobs.json into ECC2 schedules
    ImportSchedules {
        /// Path to the legacy Hermes/OpenClaw workspace root
        #[arg(long)]
        source: PathBuf,
        /// Preview detected jobs without creating ECC2 schedules
        #[arg(long)]
        dry_run: bool,
        /// Emit machine-readable JSON instead of the human summary
        #[arg(long)]
        json: bool,
    },
    /// Import legacy workspace memory into the ECC2 context graph
    ImportMemory {
        /// Path to the legacy Hermes/OpenClaw workspace root
        #[arg(long)]
        source: PathBuf,
        /// Maximum imported records across all synthesized connectors
        #[arg(long, default_value_t = 100)]
        limit: usize,
        /// Emit machine-readable JSON instead of the human summary
        #[arg(long)]
        json: bool,
    },
    /// Import safe legacy env/service config context into the ECC2 context graph
    ImportEnv {
        /// Path to the legacy Hermes/OpenClaw workspace root
        #[arg(long)]
        source: PathBuf,
        /// Preview detected importable sources without writing to the ECC2 graph
        #[arg(long)]
        dry_run: bool,
        /// Maximum imported records across all synthesized connectors
        #[arg(long, default_value_t = 100)]
        limit: usize,
        /// Emit machine-readable JSON instead of the human summary
        #[arg(long)]
        json: bool,
    },
    /// Scaffold ECC-native orchestration templates from legacy skill markdown
    ImportSkills {
        /// Path to the legacy Hermes/OpenClaw workspace root
        #[arg(long)]
        source: PathBuf,
        /// Directory where imported ECC2 skill artifacts should be written
        #[arg(long)]
        output_dir: PathBuf,
        /// Emit machine-readable JSON instead of the human summary
        #[arg(long)]
        json: bool,
    },
    /// Scaffold ECC-native templates from legacy tool scripts
    ImportTools {
        /// Path to the legacy Hermes/OpenClaw workspace root
        #[arg(long)]
        source: PathBuf,
        /// Directory where imported ECC2 tool artifacts should be written
        #[arg(long)]
        output_dir: PathBuf,
        /// Emit machine-readable JSON instead of the human summary
        #[arg(long)]
        json: bool,
    },
    /// Scaffold ECC-native templates from legacy bridge plugins
    ImportPlugins {
        /// Path to the legacy Hermes/OpenClaw workspace root
        #[arg(long)]
        source: PathBuf,
        /// Directory where imported ECC2 plugin artifacts should be written
        #[arg(long)]
        output_dir: PathBuf,
        /// Emit machine-readable JSON instead of the human summary
        #[arg(long)]
        json: bool,
    },
    /// Import legacy gateway/dispatch tasks into the ECC2 remote queue
    ImportRemote {
        /// Path to the legacy Hermes/OpenClaw workspace root
        #[arg(long)]
        source: PathBuf,
        /// Preview detected requests without creating ECC2 remote queue entries
        #[arg(long)]
        dry_run: bool,
        /// Emit machine-readable JSON instead of the human summary
        #[arg(long)]
        json: bool,
    },
}

#[derive(clap::Subcommand, Debug)]
enum GraphCommands {
    /// Create or update a graph entity
    AddEntity {
        /// Optional source session ID or alias for provenance
        #[arg(long)]
        session_id: Option<String>,
        /// Entity type such as file, function, type, or decision
        #[arg(long = "type")]
        entity_type: String,
        /// Stable entity name
        #[arg(long)]
        name: String,
        /// Optional path associated with the entity
        #[arg(long)]
        path: Option<String>,
        /// Short human summary
        #[arg(long, default_value = "")]
        summary: String,
        /// Metadata in key=value form
        #[arg(long = "meta")]
        metadata: Vec<String>,
        /// Emit machine-readable JSON instead of the human summary
        #[arg(long)]
        json: bool,
    },
    /// Create or update a relation between two entities
    Link {
        /// Optional source session ID or alias for provenance
        #[arg(long)]
        session_id: Option<String>,
        /// Source entity ID
        #[arg(long)]
        from: i64,
        /// Target entity ID
        #[arg(long)]
        to: i64,
        /// Relation type such as references, defines, or depends_on
        #[arg(long)]
        relation: String,
        /// Short human summary
        #[arg(long, default_value = "")]
        summary: String,
        /// Emit machine-readable JSON instead of the human summary
        #[arg(long)]
        json: bool,
    },
    /// List entities in the shared context graph
    Entities {
        /// Filter by source session ID or alias
        #[arg(long)]
        session_id: Option<String>,
        /// Filter by entity type
        #[arg(long = "type")]
        entity_type: Option<String>,
        /// Maximum entities to return
        #[arg(long, default_value_t = 20)]
        limit: usize,
        /// Emit machine-readable JSON instead of the human summary
        #[arg(long)]
        json: bool,
    },
    /// List relations in the shared context graph
    Relations {
        /// Filter to relations touching a specific entity ID
        #[arg(long)]
        entity_id: Option<i64>,
        /// Maximum relations to return
        #[arg(long, default_value_t = 20)]
        limit: usize,
        /// Emit machine-readable JSON instead of the human summary
        #[arg(long)]
        json: bool,
    },
    /// Record an observation against a context graph entity
    AddObservation {
        /// Optional source session ID or alias for provenance
        #[arg(long)]
        session_id: Option<String>,
        /// Entity ID
        #[arg(long)]
        entity_id: i64,
        /// Observation type such as completion_summary, incident_note, or reminder
        #[arg(long = "type")]
        observation_type: String,
        /// Observation priority
        #[arg(long, value_enum, default_value_t = ObservationPriorityArg::Normal)]
        priority: ObservationPriorityArg,
        /// Keep this observation across aggressive compaction
        #[arg(long)]
        pinned: bool,
        /// Observation summary
        #[arg(long)]
        summary: String,
        /// Details in key=value form
        #[arg(long = "detail")]
        details: Vec<String>,
        /// Emit machine-readable JSON instead of the human summary
        #[arg(long)]
        json: bool,
    },
    /// Pin an existing observation so compaction preserves it
    PinObservation {
        /// Observation ID
        #[arg(long)]
        observation_id: i64,
        /// Emit machine-readable JSON instead of the human summary
        #[arg(long)]
        json: bool,
    },
    /// Remove the pin from an existing observation
    UnpinObservation {
        /// Observation ID
        #[arg(long)]
        observation_id: i64,
        /// Emit machine-readable JSON instead of the human summary
        #[arg(long)]
        json: bool,
    },
    /// List observations in the shared context graph
    Observations {
        /// Filter to observations for a specific entity ID
        #[arg(long)]
        entity_id: Option<i64>,
        /// Maximum observations to return
        #[arg(long, default_value_t = 20)]
        limit: usize,
        /// Emit machine-readable JSON instead of the human summary
        #[arg(long)]
        json: bool,
    },
    /// Compact stored observations in the shared context graph
    Compact {
        /// Filter by source session ID or alias
        #[arg(long)]
        session_id: Option<String>,
        /// Maximum observations to retain per entity after compaction
        #[arg(long, default_value_t = 12)]
        keep_observations_per_entity: usize,
        /// Emit machine-readable JSON instead of the human summary
        #[arg(long)]
        json: bool,
    },
    /// Import external memory from a configured connector
    ConnectorSync {
        /// Connector name from ecc2.toml
        #[arg(required_unless_present = "all", conflicts_with = "all")]
        name: Option<String>,
        /// Sync every configured memory connector
        #[arg(long, required_unless_present = "name")]
        all: bool,
        /// Maximum non-empty records to process
        #[arg(long, default_value_t = 256)]
        limit: usize,
        /// Emit machine-readable JSON instead of the human summary
        #[arg(long)]
        json: bool,
    },
    /// Show configured memory connectors plus checkpoint status
    Connectors {
        /// Emit machine-readable JSON instead of the human summary
        #[arg(long)]
        json: bool,
    },
    /// Recall relevant context graph entities for a query
    Recall {
        /// Filter by source session ID or alias
        #[arg(long)]
        session_id: Option<String>,
        /// Natural-language query used for recall scoring
        query: String,
        /// Maximum entities to return
        #[arg(long, default_value_t = 8)]
        limit: usize,
        /// Emit machine-readable JSON instead of the human summary
        #[arg(long)]
        json: bool,
    },
    /// Show one entity plus its incoming and outgoing relations
    Show {
        /// Entity ID
        entity_id: i64,
        /// Maximum incoming/outgoing relations to return
        #[arg(long, default_value_t = 10)]
        limit: usize,
        /// Emit machine-readable JSON instead of the human summary
        #[arg(long)]
        json: bool,
    },
    /// Backfill the context graph from existing decisions and file activity
    Sync {
        /// Source session ID or alias. Omit to backfill the latest session.
        session_id: Option<String>,
        /// Backfill across all sessions
        #[arg(long)]
        all: bool,
        /// Maximum decisions and file events to scan per session
        #[arg(long, default_value_t = 64)]
        limit: usize,
        /// Emit machine-readable JSON instead of the human summary
        #[arg(long)]
        json: bool,
    },
}

#[derive(clap::ValueEnum, Clone, Debug)]
enum MessageKindArg {
    Handoff,
    Query,
    Response,
    Completed,
    Conflict,
}

#[derive(clap::ValueEnum, Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum TaskPriorityArg {
    Low,
    Normal,
    High,
    Critical,
}

impl From<TaskPriorityArg> for comms::TaskPriority {
    fn from(value: TaskPriorityArg) -> Self {
        match value {
            TaskPriorityArg::Low => Self::Low,
            TaskPriorityArg::Normal => Self::Normal,
            TaskPriorityArg::High => Self::High,
            TaskPriorityArg::Critical => Self::Critical,
        }
    }
}

#[derive(clap::ValueEnum, Clone, Debug)]
enum ObservationPriorityArg {
    Low,
    Normal,
    High,
    Critical,
}

impl From<ObservationPriorityArg> for session::ContextObservationPriority {
    fn from(value: ObservationPriorityArg) -> Self {
        match value {
            ObservationPriorityArg::Low => Self::Low,
            ObservationPriorityArg::Normal => Self::Normal,
            ObservationPriorityArg::High => Self::High,
            ObservationPriorityArg::Critical => Self::Critical,
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
struct GraphConnectorSyncStats {
    connector_name: String,
    records_read: usize,
    entities_upserted: usize,
    observations_added: usize,
    skipped_records: usize,
    skipped_unchanged_sources: usize,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
struct GraphConnectorSyncReport {
    connectors_synced: usize,
    records_read: usize,
    entities_upserted: usize,
    observations_added: usize,
    skipped_records: usize,
    skipped_unchanged_sources: usize,
    connectors: Vec<GraphConnectorSyncStats>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
struct GraphConnectorStatus {
    connector_name: String,
    connector_kind: String,
    source_path: String,
    recurse: bool,
    default_session_id: Option<String>,
    default_entity_type: Option<String>,
    default_observation_type: Option<String>,
    synced_sources: usize,
    last_synced_at: Option<chrono::DateTime<chrono::Utc>>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
struct GraphConnectorStatusReport {
    configured_connectors: usize,
    connectors: Vec<GraphConnectorStatus>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum LegacyMigrationReadiness {
    ReadyNow,
    ManualTranslation,
    LocalAuthRequired,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct LegacyMigrationArtifact {
    category: String,
    readiness: LegacyMigrationReadiness,
    source_paths: Vec<String>,
    detected_items: usize,
    mapping: Vec<String>,
    notes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct LegacyMigrationAuditSummary {
    artifact_categories_detected: usize,
    ready_now_categories: usize,
    manual_translation_categories: usize,
    local_auth_required_categories: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct LegacyMigrationAuditReport {
    source: String,
    detected_systems: Vec<String>,
    summary: LegacyMigrationAuditSummary,
    recommended_next_steps: Vec<String>,
    artifacts: Vec<LegacyMigrationArtifact>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct LegacyMigrationPlanStep {
    category: String,
    readiness: LegacyMigrationReadiness,
    title: String,
    target_surface: String,
    source_paths: Vec<String>,
    command_snippets: Vec<String>,
    config_snippets: Vec<String>,
    notes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct LegacyMigrationPlanReport {
    source: String,
    generated_at: String,
    audit_summary: LegacyMigrationAuditSummary,
    steps: Vec<LegacyMigrationPlanStep>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct LegacyMigrationScaffoldReport {
    source: String,
    output_dir: String,
    files_written: Vec<String>,
    steps_scaffolded: usize,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum LegacyScheduleImportJobStatus {
    Ready,
    Imported,
    Disabled,
    Invalid,
    Skipped,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct LegacyScheduleImportJobReport {
    source_path: String,
    job_name: String,
    cron_expr: Option<String>,
    task: Option<String>,
    agent: Option<String>,
    profile: Option<String>,
    project: Option<String>,
    task_group: Option<String>,
    use_worktree: Option<bool>,
    status: LegacyScheduleImportJobStatus,
    reason: Option<String>,
    command_snippet: Option<String>,
    imported_schedule_id: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct LegacyScheduleImportReport {
    source: String,
    source_path: String,
    dry_run: bool,
    jobs_detected: usize,
    ready_jobs: usize,
    imported_jobs: usize,
    disabled_jobs: usize,
    invalid_jobs: usize,
    skipped_jobs: usize,
    jobs: Vec<LegacyScheduleImportJobReport>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct LegacyMemoryImportReport {
    source: String,
    connectors_detected: usize,
    report: GraphConnectorSyncReport,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum LegacyEnvImportSourceStatus {
    Ready,
    Imported,
    ManualOnly,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct LegacyEnvImportSourceReport {
    source_path: String,
    connector_name: Option<String>,
    status: LegacyEnvImportSourceStatus,
    reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct LegacyEnvImportReport {
    source: String,
    dry_run: bool,
    importable_sources: usize,
    imported_sources: usize,
    manual_reentry_sources: usize,
    connectors_detected: usize,
    report: GraphConnectorSyncReport,
    sources: Vec<LegacyEnvImportSourceReport>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct LegacySkillImportEntry {
    source_path: String,
    template_name: String,
    title: String,
    summary: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct LegacySkillImportReport {
    source: String,
    output_dir: String,
    skills_detected: usize,
    templates_generated: usize,
    files_written: Vec<String>,
    skills: Vec<LegacySkillImportEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
struct LegacySkillTemplateFile {
    orchestration_templates: BTreeMap<String, config::OrchestrationTemplateConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct LegacyToolImportEntry {
    source_path: String,
    template_name: String,
    title: String,
    summary: String,
    suggested_surface: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct LegacyToolImportReport {
    source: String,
    output_dir: String,
    tools_detected: usize,
    templates_generated: usize,
    files_written: Vec<String>,
    tools: Vec<LegacyToolImportEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
struct LegacyToolTemplateFile {
    orchestration_templates: BTreeMap<String, config::OrchestrationTemplateConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct LegacyPluginImportEntry {
    source_path: String,
    template_name: String,
    title: String,
    summary: String,
    suggested_surface: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct LegacyPluginImportReport {
    source: String,
    output_dir: String,
    plugins_detected: usize,
    templates_generated: usize,
    files_written: Vec<String>,
    plugins: Vec<LegacyPluginImportEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
struct LegacyPluginTemplateFile {
    orchestration_templates: BTreeMap<String, config::OrchestrationTemplateConfig>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum LegacyRemoteImportRequestStatus {
    Ready,
    Imported,
    Disabled,
    Invalid,
    Skipped,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct LegacyRemoteImportRequestReport {
    source_path: String,
    request_name: String,
    request_kind: session::RemoteDispatchKind,
    task: Option<String>,
    goal: Option<String>,
    target_url: Option<String>,
    context: Option<String>,
    target_session: Option<String>,
    priority: Option<TaskPriorityArg>,
    agent: Option<String>,
    profile: Option<String>,
    project: Option<String>,
    task_group: Option<String>,
    use_worktree: Option<bool>,
    status: LegacyRemoteImportRequestStatus,
    reason: Option<String>,
    command_snippet: Option<String>,
    imported_request_id: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct LegacyRemoteImportReport {
    source: String,
    dry_run: bool,
    requests_detected: usize,
    ready_requests: usize,
    imported_requests: usize,
    disabled_requests: usize,
    invalid_requests: usize,
    skipped_requests: usize,
    requests: Vec<LegacyRemoteImportRequestReport>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
struct RemoteDispatchHttpRequest {
    task: String,
    to_session: Option<String>,
    priority: Option<TaskPriorityArg>,
    agent: Option<String>,
    profile: Option<String>,
    use_worktree: Option<bool>,
    project: Option<String>,
    task_group: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
struct RemoteComputerUseHttpRequest {
    goal: String,
    target_url: Option<String>,
    context: Option<String>,
    to_session: Option<String>,
    priority: Option<TaskPriorityArg>,
    agent: Option<String>,
    profile: Option<String>,
    use_worktree: Option<bool>,
    project: Option<String>,
    task_group: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
struct JsonlMemoryConnectorRecord {
    session_id: Option<String>,
    entity_type: Option<String>,
    entity_name: String,
    path: Option<String>,
    entity_summary: Option<String>,
    metadata: BTreeMap<String, String>,
    observation_type: Option<String>,
    summary: String,
    details: BTreeMap<String, String>,
}

const MARKDOWN_CONNECTOR_SUMMARY_LIMIT: usize = 160;
const MARKDOWN_CONNECTOR_BODY_LIMIT: usize = 4000;
const DOTENV_CONNECTOR_VALUE_LIMIT: usize = 160;

#[derive(Debug, Clone)]
struct MarkdownMemorySection {
    heading: String,
    path: String,
    summary: String,
    body: String,
    line_number: usize,
}

#[derive(Debug, Clone)]
struct DotenvMemoryEntry {
    key: String,
    path: String,
    summary: String,
    details: BTreeMap<String, String>,
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .init();

    let cli = Cli::parse();

    let cfg = config::Config::load()?;
    let db = session::store::StateStore::open(&cfg.db_path)?;

    match cli.command {
        Some(Commands::Dashboard) | None => {
            tui::app::run(db, cfg).await?;
        }
        Some(Commands::Start {
            task,
            agent,
            profile,
            worktree,
            from_session,
        }) => {
            let use_worktree = worktree.resolve(&cfg);
            let source = if let Some(from_session) = from_session.as_ref() {
                let from_id = resolve_session_id(&db, from_session)?;
                Some(
                    db.get_session(&from_id)?
                        .ok_or_else(|| anyhow::anyhow!("Session not found: {from_id}"))?,
                )
            } else {
                None
            };
            let grouping = session::SessionGrouping {
                project: source.as_ref().map(|session| session.project.clone()),
                task_group: source.as_ref().map(|session| session.task_group.clone()),
            };
            let session_id = if let Some(source) = source.as_ref() {
                session::manager::create_session_from_source_with_profile_and_grouping(
                    &db,
                    &cfg,
                    &task,
                    agent.as_deref().unwrap_or(&cfg.default_agent),
                    use_worktree,
                    profile.as_deref(),
                    &source.id,
                    grouping,
                )
                .await?
            } else {
                session::manager::create_session_with_profile_and_grouping(
                    &db,
                    &cfg,
                    &task,
                    agent.as_deref().unwrap_or(&cfg.default_agent),
                    use_worktree,
                    profile.as_deref(),
                    grouping,
                )
                .await?
            };
            if let Some(source) = source {
                let from_id = source.id;
                send_handoff_message(&db, &from_id, &session_id)?;
            }
            println!("Session started: {session_id}");
        }
        Some(Commands::Delegate {
            from_session,
            task,
            agent,
            profile,
            worktree,
        }) => {
            let use_worktree = worktree.resolve(&cfg);
            let from_id = resolve_session_id(&db, &from_session)?;
            let source = db
                .get_session(&from_id)?
                .ok_or_else(|| anyhow::anyhow!("Session not found: {from_id}"))?;
            let task = task.unwrap_or_else(|| {
                format!(
                    "Follow up on {}: {}",
                    short_session(&source.id),
                    source.task
                )
            });

            let session_id =
                session::manager::create_session_from_source_with_profile_and_grouping(
                    &db,
                    &cfg,
                    &task,
                    agent.as_deref().unwrap_or(&cfg.default_agent),
                    use_worktree,
                    profile.as_deref(),
                    &source.id,
                    session::SessionGrouping {
                        project: Some(source.project.clone()),
                        task_group: Some(source.task_group.clone()),
                    },
                )
                .await?;
            send_handoff_message(&db, &source.id, &session_id)?;
            println!(
                "Delegated session started: {} <- {}",
                session_id,
                short_session(&source.id)
            );
        }
        Some(Commands::Template {
            name,
            task,
            from_session,
            vars,
        }) => {
            let source_session_id = from_session
                .as_deref()
                .map(|session_id| resolve_session_id(&db, session_id))
                .transpose()?;
            let outcome = session::manager::launch_orchestration_template(
                &db,
                &cfg,
                &name,
                source_session_id.as_deref(),
                task.as_deref(),
                parse_template_vars(&vars)?,
            )
            .await?;
            println!(
                "Template launched: {} ({} step{})",
                outcome.template_name,
                outcome.created.len(),
                if outcome.created.len() == 1 { "" } else { "s" }
            );
            if let Some(anchor_session_id) = outcome.anchor_session_id.as_deref() {
                println!("Anchor session: {}", short_session(anchor_session_id));
            }
            for step in outcome.created {
                println!(
                    "- {} -> {} | {}",
                    step.step_name,
                    short_session(&step.session_id),
                    step.task
                );
            }
        }
        Some(Commands::Assign {
            from_session,
            task,
            agent,
            profile,
            worktree,
        }) => {
            let use_worktree = worktree.resolve(&cfg);
            let lead_id = resolve_session_id(&db, &from_session)?;
            let outcome = session::manager::assign_session_with_profile_and_grouping(
                &db,
                &cfg,
                &lead_id,
                &task,
                agent.as_deref().unwrap_or(&cfg.default_agent),
                use_worktree,
                profile.as_deref(),
                session::SessionGrouping::default(),
            )
            .await?;
            if session::manager::assignment_action_routes_work(outcome.action) {
                println!(
                    "Assignment routed: {} -> {} ({})",
                    short_session(&lead_id),
                    short_session(&outcome.session_id),
                    match outcome.action {
                        session::manager::AssignmentAction::Spawned => "spawned",
                        session::manager::AssignmentAction::ReusedIdle => "reused-idle",
                        session::manager::AssignmentAction::ReusedActive => "reused-active",
                        session::manager::AssignmentAction::DeferredSaturated => unreachable!(),
                    }
                );
            } else {
                println!(
                    "Assignment deferred: {} is saturated; task stayed in {} inbox",
                    short_session(&lead_id),
                    short_session(&lead_id),
                );
            }
        }
        Some(Commands::DrainInbox {
            session_id,
            agent,
            worktree,
            limit,
        }) => {
            let use_worktree = worktree.resolve(&cfg);
            let lead_id = resolve_session_id(&db, &session_id)?;
            let outcomes = session::manager::drain_inbox(
                &db,
                &cfg,
                &lead_id,
                agent.as_deref().unwrap_or(&cfg.default_agent),
                use_worktree,
                limit,
            )
            .await?;
            if outcomes.is_empty() {
                println!("No unread task handoffs for {}", short_session(&lead_id));
            } else {
                let routed_count = outcomes
                    .iter()
                    .filter(|outcome| {
                        session::manager::assignment_action_routes_work(outcome.action)
                    })
                    .count();
                let deferred_count = outcomes.len().saturating_sub(routed_count);
                println!(
                    "Processed {} inbox task handoff(s) from {} ({} routed, {} deferred)",
                    outcomes.len(),
                    short_session(&lead_id),
                    routed_count,
                    deferred_count
                );
                for outcome in outcomes {
                    println!(
                        "- {} -> {} ({}) | {}",
                        outcome.message_id,
                        short_session(&outcome.session_id),
                        match outcome.action {
                            session::manager::AssignmentAction::Spawned => "spawned",
                            session::manager::AssignmentAction::ReusedIdle => "reused-idle",
                            session::manager::AssignmentAction::ReusedActive => "reused-active",
                            session::manager::AssignmentAction::DeferredSaturated => {
                                "deferred-saturated"
                            }
                        },
                        outcome.task
                    );
                }
            }
        }
        Some(Commands::AutoDispatch {
            agent,
            worktree,
            lead_limit,
        }) => {
            let use_worktree = worktree.resolve(&cfg);
            let outcomes = session::manager::auto_dispatch_backlog(
                &db,
                &cfg,
                agent.as_deref().unwrap_or(&cfg.default_agent),
                use_worktree,
                lead_limit,
            )
            .await?;
            if outcomes.is_empty() {
                println!("No unread task handoff backlog found");
            } else {
                let total_processed: usize =
                    outcomes.iter().map(|outcome| outcome.routed.len()).sum();
                let total_routed: usize = outcomes
                    .iter()
                    .map(|outcome| {
                        outcome
                            .routed
                            .iter()
                            .filter(|item| {
                                session::manager::assignment_action_routes_work(item.action)
                            })
                            .count()
                    })
                    .sum();
                let total_deferred = total_processed.saturating_sub(total_routed);
                println!(
                    "Auto-dispatch processed {} task handoff(s) across {} lead session(s) ({} routed, {} deferred)",
                    total_processed,
                    outcomes.len(),
                    total_routed,
                    total_deferred
                );
                for outcome in outcomes {
                    let routed = outcome
                        .routed
                        .iter()
                        .filter(|item| session::manager::assignment_action_routes_work(item.action))
                        .count();
                    let deferred = outcome.routed.len().saturating_sub(routed);
                    println!(
                        "- {} | unread {} | routed {} | deferred {}",
                        short_session(&outcome.lead_session_id),
                        outcome.unread_count,
                        routed,
                        deferred
                    );
                }
            }
        }
        Some(Commands::CoordinateBacklog {
            agent,
            worktree,
            lead_limit,
            json,
            check,
            until_healthy,
            max_passes,
        }) => {
            let use_worktree = worktree.resolve(&cfg);
            let pass_budget = if until_healthy { max_passes.max(1) } else { 1 };
            let run = run_coordination_loop(
                &db,
                &cfg,
                agent.as_deref().unwrap_or(&cfg.default_agent),
                use_worktree,
                lead_limit,
                pass_budget,
                !json,
            )
            .await?;

            if json {
                println!("{}", serde_json::to_string_pretty(&run)?);
            }

            if check {
                let exit_code = run
                    .final_status
                    .as_ref()
                    .map(coordination_status_exit_code)
                    .unwrap_or(0);
                std::process::exit(exit_code);
            }
        }
        Some(Commands::CoordinationStatus { json, check }) => {
            let status = session::manager::get_coordination_status(&db, &cfg)?;
            println!("{}", format_coordination_status(&status, json)?);
            if check {
                std::process::exit(coordination_status_exit_code(&status));
            }
        }
        Some(Commands::MaintainCoordination {
            agent,
            worktree,
            lead_limit,
            json,
            check,
            max_passes,
        }) => {
            let use_worktree = worktree.resolve(&cfg);
            let initial_status = session::manager::get_coordination_status(&db, &cfg)?;
            let run = if matches!(
                initial_status.health,
                session::manager::CoordinationHealth::Healthy
            ) {
                None
            } else {
                Some(
                    run_coordination_loop(
                        &db,
                        &cfg,
                        agent.as_deref().unwrap_or(&cfg.default_agent),
                        use_worktree,
                        lead_limit,
                        max_passes.max(1),
                        !json,
                    )
                    .await?,
                )
            };
            let final_status = run
                .as_ref()
                .and_then(|run| run.final_status.clone())
                .unwrap_or_else(|| initial_status.clone());

            if json {
                let payload = MaintainCoordinationRun {
                    skipped: run.is_none(),
                    initial_status,
                    run,
                    final_status: final_status.clone(),
                };
                println!("{}", serde_json::to_string_pretty(&payload)?);
            } else if run.is_none() {
                println!("Coordination already healthy");
            }

            if check {
                std::process::exit(coordination_status_exit_code(&final_status));
            }
        }
        Some(Commands::RebalanceAll {
            agent,
            worktree,
            lead_limit,
        }) => {
            let use_worktree = worktree.resolve(&cfg);
            let outcomes = session::manager::rebalance_all_teams(
                &db,
                &cfg,
                agent.as_deref().unwrap_or(&cfg.default_agent),
                use_worktree,
                lead_limit,
            )
            .await?;
            if outcomes.is_empty() {
                println!("No delegate backlog needed global rebalancing");
            } else {
                let total_rerouted: usize =
                    outcomes.iter().map(|outcome| outcome.rerouted.len()).sum();
                println!(
                    "Rebalanced {} task handoff(s) across {} lead session(s)",
                    total_rerouted,
                    outcomes.len()
                );
                for outcome in outcomes {
                    println!(
                        "- {} | rerouted {}",
                        short_session(&outcome.lead_session_id),
                        outcome.rerouted.len()
                    );
                }
            }
        }
        Some(Commands::RebalanceTeam {
            session_id,
            agent,
            worktree,
            limit,
        }) => {
            let use_worktree = worktree.resolve(&cfg);
            let lead_id = resolve_session_id(&db, &session_id)?;
            let outcomes = session::manager::rebalance_team_backlog(
                &db,
                &cfg,
                &lead_id,
                agent.as_deref().unwrap_or(&cfg.default_agent),
                use_worktree,
                limit,
            )
            .await?;
            if outcomes.is_empty() {
                println!(
                    "No delegate backlog needed rebalancing for {}",
                    short_session(&lead_id)
                );
            } else {
                println!(
                    "Rebalanced {} task handoff(s) for {}",
                    outcomes.len(),
                    short_session(&lead_id)
                );
                for outcome in outcomes {
                    println!(
                        "- {} | {} -> {} ({}) | {}",
                        outcome.message_id,
                        short_session(&outcome.from_session_id),
                        short_session(&outcome.session_id),
                        match outcome.action {
                            session::manager::AssignmentAction::Spawned => "spawned",
                            session::manager::AssignmentAction::ReusedIdle => "reused-idle",
                            session::manager::AssignmentAction::ReusedActive => "reused-active",
                            session::manager::AssignmentAction::DeferredSaturated => {
                                "deferred-saturated"
                            }
                        },
                        outcome.task
                    );
                }
            }
        }
        Some(Commands::Sessions) => {
            sync_runtime_session_metrics(&db, &cfg)?;
            let sessions = session::manager::list_sessions(&db)?;
            let harnesses = db.list_session_harnesses().unwrap_or_default();
            for s in sessions {
                let harness = harnesses
                    .get(&s.id)
                    .cloned()
                    .unwrap_or_else(|| {
                        session::SessionHarnessInfo::detect(&s.agent_type, &s.working_dir)
                    })
                    .with_config_detection(&cfg, &s.working_dir)
                    .primary_label;
                println!("{} [{}] [{}] {}", s.id, s.state, harness, s.task);
            }
        }
        Some(Commands::Status { session_id }) => {
            sync_runtime_session_metrics(&db, &cfg)?;
            let id = session_id.unwrap_or_else(|| "latest".to_string());
            let status = session::manager::get_status(&db, &cfg, &id)?;
            println!("{status}");
        }
        Some(Commands::Team { session_id, depth }) => {
            sync_runtime_session_metrics(&db, &cfg)?;
            let id = session_id.unwrap_or_else(|| "latest".to_string());
            let team = session::manager::get_team_status(&db, &id, depth)?;
            println!("{team}");
        }
        Some(Commands::WorktreeStatus {
            session_id,
            all,
            json,
            patch,
            check,
        }) => {
            if all && session_id.is_some() {
                return Err(anyhow::anyhow!(
                    "worktree-status does not accept a session ID when --all is set"
                ));
            }
            let reports = if all {
                session::manager::list_sessions(&db)?
                    .into_iter()
                    .map(|session| build_worktree_status_report(&session, patch))
                    .collect::<Result<Vec<_>>>()?
            } else {
                let id = session_id.unwrap_or_else(|| "latest".to_string());
                let resolved_id = resolve_session_id(&db, &id)?;
                let session = db
                    .get_session(&resolved_id)?
                    .ok_or_else(|| anyhow::anyhow!("Session not found: {resolved_id}"))?;
                vec![build_worktree_status_report(&session, patch)?]
            };
            if json {
                if all {
                    println!("{}", serde_json::to_string_pretty(&reports)?);
                } else {
                    println!("{}", serde_json::to_string_pretty(&reports[0])?);
                }
            } else {
                println!("{}", format_worktree_status_reports_human(&reports));
            }
            if check {
                std::process::exit(worktree_status_reports_exit_code(&reports));
            }
        }
        Some(Commands::WorktreeResolution {
            session_id,
            all,
            json,
            check,
        }) => {
            if all && session_id.is_some() {
                return Err(anyhow::anyhow!(
                    "worktree-resolution does not accept a session ID when --all is set"
                ));
            }
            let reports = if all {
                session::manager::list_sessions(&db)?
                    .into_iter()
                    .map(|session| build_worktree_resolution_report(&session))
                    .collect::<Result<Vec<_>>>()?
                    .into_iter()
                    .filter(|report| report.conflicted)
                    .collect::<Vec<_>>()
            } else {
                let id = session_id.unwrap_or_else(|| "latest".to_string());
                let resolved_id = resolve_session_id(&db, &id)?;
                let session = db
                    .get_session(&resolved_id)?
                    .ok_or_else(|| anyhow::anyhow!("Session not found: {resolved_id}"))?;
                vec![build_worktree_resolution_report(&session)?]
            };
            if json {
                if all {
                    println!("{}", serde_json::to_string_pretty(&reports)?);
                } else {
                    println!("{}", serde_json::to_string_pretty(&reports[0])?);
                }
            } else {
                println!("{}", format_worktree_resolution_reports_human(&reports));
            }
            if check {
                std::process::exit(worktree_resolution_reports_exit_code(&reports));
            }
        }
        Some(Commands::MergeWorktree {
            session_id,
            all,
            json,
            keep_worktree,
        }) => {
            if all && session_id.is_some() {
                return Err(anyhow::anyhow!(
                    "merge-worktree does not accept a session ID when --all is set"
                ));
            }
            if all {
                let outcome = session::manager::merge_ready_worktrees(&db, !keep_worktree).await?;
                if json {
                    println!("{}", serde_json::to_string_pretty(&outcome)?);
                } else {
                    println!("{}", format_bulk_worktree_merge_human(&outcome));
                }
            } else {
                let id = session_id.unwrap_or_else(|| "latest".to_string());
                let resolved_id = resolve_session_id(&db, &id)?;
                let outcome =
                    session::manager::merge_session_worktree(&db, &resolved_id, !keep_worktree)
                        .await?;
                if json {
                    println!("{}", serde_json::to_string_pretty(&outcome)?);
                } else {
                    println!("{}", format_worktree_merge_human(&outcome));
                }
            }
        }
        Some(Commands::MergeQueue { json, apply }) => {
            if apply {
                let outcome = session::manager::process_merge_queue(&db).await?;
                if json {
                    println!("{}", serde_json::to_string_pretty(&outcome)?);
                } else {
                    println!("{}", format_bulk_worktree_merge_human(&outcome));
                }
            } else {
                let report = session::manager::build_merge_queue(&db)?;
                if json {
                    println!("{}", serde_json::to_string_pretty(&report)?);
                } else {
                    println!("{}", format_merge_queue_human(&report));
                }
            }
        }
        Some(Commands::PruneWorktrees { json }) => {
            let outcome = session::manager::prune_inactive_worktrees(&db, &cfg).await?;
            if json {
                println!("{}", serde_json::to_string_pretty(&outcome)?);
            } else {
                println!("{}", format_prune_worktrees_human(&outcome));
            }
        }
        Some(Commands::LogDecision {
            session_id,
            decision,
            reasoning,
            alternatives,
            json,
        }) => {
            let resolved_id = resolve_session_id(&db, session_id.as_deref().unwrap_or("latest"))?;
            let entry = db.insert_decision(&resolved_id, &decision, &alternatives, &reasoning)?;
            if json {
                println!("{}", serde_json::to_string_pretty(&entry)?);
            } else {
                println!("{}", format_logged_decision_human(&entry));
            }
        }
        Some(Commands::Decisions {
            session_id,
            all,
            json,
            limit,
        }) => {
            if all && session_id.is_some() {
                return Err(anyhow::anyhow!(
                    "decisions does not accept a session ID when --all is set"
                ));
            }
            let entries = if all {
                db.list_decisions(limit)?
            } else {
                let resolved_id =
                    resolve_session_id(&db, session_id.as_deref().unwrap_or("latest"))?;
                db.list_decisions_for_session(&resolved_id, limit)?
            };
            if json {
                println!("{}", serde_json::to_string_pretty(&entries)?);
            } else {
                println!("{}", format_decisions_human(&entries, all));
            }
        }
        Some(Commands::Migrate { command }) => match command {
            MigrationCommands::Audit { source, json } => {
                let report = build_legacy_migration_audit_report(&source)?;
                if json {
                    println!("{}", serde_json::to_string_pretty(&report)?);
                } else {
                    println!("{}", format_legacy_migration_audit_human(&report));
                }
            }
            MigrationCommands::Plan {
                source,
                output,
                json,
            } => {
                let audit = build_legacy_migration_audit_report(&source)?;
                let plan = build_legacy_migration_plan_report(&audit);
                let rendered = if json {
                    serde_json::to_string_pretty(&plan)?
                } else {
                    format_legacy_migration_plan_human(&plan)
                };
                if let Some(path) = output {
                    std::fs::write(&path, &rendered)?;
                    println!("Migration plan written to {}", path.display());
                } else {
                    println!("{rendered}");
                }
            }
            MigrationCommands::Scaffold {
                source,
                output_dir,
                json,
            } => {
                let audit = build_legacy_migration_audit_report(&source)?;
                let plan = build_legacy_migration_plan_report(&audit);
                let report = write_legacy_migration_scaffold(&plan, &output_dir)?;
                if json {
                    println!("{}", serde_json::to_string_pretty(&report)?);
                } else {
                    println!("{}", format_legacy_migration_scaffold_human(&report));
                }
            }
            MigrationCommands::ImportSchedules {
                source,
                dry_run,
                json,
            } => {
                let report = import_legacy_schedules(&db, &cfg, &source, dry_run)?;
                if json {
                    println!("{}", serde_json::to_string_pretty(&report)?);
                } else {
                    println!("{}", format_legacy_schedule_import_human(&report));
                }
            }
            MigrationCommands::ImportMemory {
                source,
                limit,
                json,
            } => {
                let report = import_legacy_memory(&db, &cfg, &source, limit)?;
                if json {
                    println!("{}", serde_json::to_string_pretty(&report)?);
                } else {
                    println!("{}", format_legacy_memory_import_human(&report));
                }
            }
            MigrationCommands::ImportEnv {
                source,
                dry_run,
                limit,
                json,
            } => {
                let report = import_legacy_env_services(&db, &source, dry_run, limit)?;
                if json {
                    println!("{}", serde_json::to_string_pretty(&report)?);
                } else {
                    println!("{}", format_legacy_env_import_human(&report));
                }
            }
            MigrationCommands::ImportSkills {
                source,
                output_dir,
                json,
            } => {
                let report = import_legacy_skills(&source, &output_dir)?;
                if json {
                    println!("{}", serde_json::to_string_pretty(&report)?);
                } else {
                    println!("{}", format_legacy_skill_import_human(&report));
                }
            }
            MigrationCommands::ImportTools {
                source,
                output_dir,
                json,
            } => {
                let report = import_legacy_tools(&source, &output_dir)?;
                if json {
                    println!("{}", serde_json::to_string_pretty(&report)?);
                } else {
                    println!("{}", format_legacy_tool_import_human(&report));
                }
            }
            MigrationCommands::ImportPlugins {
                source,
                output_dir,
                json,
            } => {
                let report = import_legacy_plugins(&source, &output_dir)?;
                if json {
                    println!("{}", serde_json::to_string_pretty(&report)?);
                } else {
                    println!("{}", format_legacy_plugin_import_human(&report));
                }
            }
            MigrationCommands::ImportRemote {
                source,
                dry_run,
                json,
            } => {
                let report = import_legacy_remote_dispatch(&db, &cfg, &source, dry_run)?;
                if json {
                    println!("{}", serde_json::to_string_pretty(&report)?);
                } else {
                    println!("{}", format_legacy_remote_import_human(&report));
                }
            }
        },
        Some(Commands::Graph { command }) => match command {
            GraphCommands::AddEntity {
                session_id,
                entity_type,
                name,
                path,
                summary,
                metadata,
                json,
            } => {
                let resolved_session_id = session_id
                    .as_deref()
                    .map(|value| resolve_session_id(&db, value))
                    .transpose()?;
                let metadata = parse_key_value_pairs(&metadata, "graph metadata")?;
                let entity = db.upsert_context_entity(
                    resolved_session_id.as_deref(),
                    &entity_type,
                    &name,
                    path.as_deref(),
                    &summary,
                    &metadata,
                )?;
                if json {
                    println!("{}", serde_json::to_string_pretty(&entity)?);
                } else {
                    println!("{}", format_graph_entity_human(&entity));
                }
            }
            GraphCommands::Link {
                session_id,
                from,
                to,
                relation,
                summary,
                json,
            } => {
                let resolved_session_id = session_id
                    .as_deref()
                    .map(|value| resolve_session_id(&db, value))
                    .transpose()?;
                let relation = db.upsert_context_relation(
                    resolved_session_id.as_deref(),
                    from,
                    to,
                    &relation,
                    &summary,
                )?;
                if json {
                    println!("{}", serde_json::to_string_pretty(&relation)?);
                } else {
                    println!("{}", format_graph_relation_human(&relation));
                }
            }
            GraphCommands::Entities {
                session_id,
                entity_type,
                limit,
                json,
            } => {
                let resolved_session_id = session_id
                    .as_deref()
                    .map(|value| resolve_session_id(&db, value))
                    .transpose()?;
                let entities = db.list_context_entities(
                    resolved_session_id.as_deref(),
                    entity_type.as_deref(),
                    limit,
                )?;
                if json {
                    println!("{}", serde_json::to_string_pretty(&entities)?);
                } else {
                    println!(
                        "{}",
                        format_graph_entities_human(&entities, resolved_session_id.is_some())
                    );
                }
            }
            GraphCommands::Relations {
                entity_id,
                limit,
                json,
            } => {
                let relations = db.list_context_relations(entity_id, limit)?;
                if json {
                    println!("{}", serde_json::to_string_pretty(&relations)?);
                } else {
                    println!("{}", format_graph_relations_human(&relations));
                }
            }
            GraphCommands::AddObservation {
                session_id,
                entity_id,
                observation_type,
                priority,
                pinned,
                summary,
                details,
                json,
            } => {
                let resolved_session_id = session_id
                    .as_deref()
                    .map(|value| resolve_session_id(&db, value))
                    .transpose()?;
                let details = parse_key_value_pairs(&details, "graph observation details")?;
                let observation = db.add_context_observation(
                    resolved_session_id.as_deref(),
                    entity_id,
                    &observation_type,
                    priority.into(),
                    pinned,
                    &summary,
                    &details,
                )?;
                if json {
                    println!("{}", serde_json::to_string_pretty(&observation)?);
                } else {
                    println!("{}", format_graph_observation_human(&observation));
                }
            }
            GraphCommands::PinObservation {
                observation_id,
                json,
            } => {
                let Some(observation) = db.set_context_observation_pinned(observation_id, true)?
                else {
                    return Err(anyhow::anyhow!(
                        "Context graph observation #{observation_id} was not found"
                    ));
                };
                if json {
                    println!("{}", serde_json::to_string_pretty(&observation)?);
                } else {
                    println!("{}", format_graph_observation_human(&observation));
                }
            }
            GraphCommands::UnpinObservation {
                observation_id,
                json,
            } => {
                let Some(observation) = db.set_context_observation_pinned(observation_id, false)?
                else {
                    return Err(anyhow::anyhow!(
                        "Context graph observation #{observation_id} was not found"
                    ));
                };
                if json {
                    println!("{}", serde_json::to_string_pretty(&observation)?);
                } else {
                    println!("{}", format_graph_observation_human(&observation));
                }
            }
            GraphCommands::Observations {
                entity_id,
                limit,
                json,
            } => {
                let observations = db.list_context_observations(entity_id, limit)?;
                if json {
                    println!("{}", serde_json::to_string_pretty(&observations)?);
                } else {
                    println!("{}", format_graph_observations_human(&observations));
                }
            }
            GraphCommands::Compact {
                session_id,
                keep_observations_per_entity,
                json,
            } => {
                let resolved_session_id = session_id
                    .as_deref()
                    .map(|value| resolve_session_id(&db, value))
                    .transpose()?;
                let stats = db.compact_context_graph(
                    resolved_session_id.as_deref(),
                    keep_observations_per_entity,
                )?;
                if json {
                    println!("{}", serde_json::to_string_pretty(&stats)?);
                } else {
                    println!(
                        "{}",
                        format_graph_compaction_stats_human(
                            &stats,
                            resolved_session_id.as_deref(),
                            keep_observations_per_entity,
                        )
                    );
                }
            }
            GraphCommands::ConnectorSync {
                name,
                all,
                limit,
                json,
            } => {
                if all {
                    let report = sync_all_memory_connectors(&db, &cfg, limit)?;
                    if json {
                        println!("{}", serde_json::to_string_pretty(&report)?);
                    } else {
                        println!("{}", format_graph_connector_sync_report_human(&report));
                    }
                } else {
                    let name = name.as_deref().ok_or_else(|| {
                        anyhow::anyhow!("connector name required unless --all is set")
                    })?;
                    let stats = sync_memory_connector(&db, &cfg, name, limit)?;
                    if json {
                        println!("{}", serde_json::to_string_pretty(&stats)?);
                    } else {
                        println!("{}", format_graph_connector_sync_stats_human(&stats));
                    }
                }
            }
            GraphCommands::Connectors { json } => {
                let report = memory_connector_status_report(&db, &cfg)?;
                if json {
                    println!("{}", serde_json::to_string_pretty(&report)?);
                } else {
                    println!("{}", format_graph_connector_status_report_human(&report));
                }
            }
            GraphCommands::Recall {
                session_id,
                query,
                limit,
                json,
            } => {
                let resolved_session_id = session_id
                    .as_deref()
                    .map(|value| resolve_session_id(&db, value))
                    .transpose()?;
                let entries =
                    db.recall_context_entities(resolved_session_id.as_deref(), &query, limit)?;
                if json {
                    println!("{}", serde_json::to_string_pretty(&entries)?);
                } else {
                    println!(
                        "{}",
                        format_graph_recall_human(&entries, resolved_session_id.as_deref(), &query)
                    );
                }
            }
            GraphCommands::Show {
                entity_id,
                limit,
                json,
            } => {
                let detail = db
                    .get_context_entity_detail(entity_id, limit)?
                    .ok_or_else(|| {
                        anyhow::anyhow!("Context graph entity not found: {entity_id}")
                    })?;
                if json {
                    println!("{}", serde_json::to_string_pretty(&detail)?);
                } else {
                    println!("{}", format_graph_entity_detail_human(&detail));
                }
            }
            GraphCommands::Sync {
                session_id,
                all,
                limit,
                json,
            } => {
                if all && session_id.is_some() {
                    return Err(anyhow::anyhow!(
                        "graph sync does not accept a session ID when --all is set"
                    ));
                }
                sync_runtime_session_metrics(&db, &cfg)?;
                let resolved_session_id = if all {
                    None
                } else {
                    Some(resolve_session_id(
                        &db,
                        session_id.as_deref().unwrap_or("latest"),
                    )?)
                };
                let stats = db.sync_context_graph_history(resolved_session_id.as_deref(), limit)?;
                if json {
                    println!("{}", serde_json::to_string_pretty(&stats)?);
                } else {
                    println!(
                        "{}",
                        format_graph_sync_stats_human(&stats, resolved_session_id.as_deref())
                    );
                }
            }
        },
        Some(Commands::ExportOtel { session_id, output }) => {
            sync_runtime_session_metrics(&db, &cfg)?;
            let resolved_session_id = session_id
                .as_deref()
                .map(|value| resolve_session_id(&db, value))
                .transpose()?;
            let export = build_otel_export(&db, resolved_session_id.as_deref())?;
            let rendered = serde_json::to_string_pretty(&export)?;
            if let Some(path) = output {
                std::fs::write(&path, rendered)?;
                println!("OTLP export written to {}", path.display());
            } else {
                println!("{rendered}");
            }
        }
        Some(Commands::Stop { session_id }) => {
            session::manager::stop_session(&db, &session_id).await?;
            println!("Session stopped: {session_id}");
        }
        Some(Commands::Resume { session_id }) => {
            let resumed_id = session::manager::resume_session(&db, &cfg, &session_id).await?;
            println!("Session resumed: {resumed_id}");
        }
        Some(Commands::Messages { command }) => match command {
            MessageCommands::Send {
                from,
                to,
                kind,
                text,
                context,
                priority,
                file,
            } => {
                let from = resolve_session_id(&db, &from)?;
                let to = resolve_session_id(&db, &to)?;
                let message = build_message(kind, text, context, priority, file)?;
                comms::send(&db, &from, &to, &message)?;
                println!(
                    "Message sent: {} -> {}",
                    short_session(&from),
                    short_session(&to)
                );
            }
            MessageCommands::Inbox { session_id, limit } => {
                let session_id = resolve_session_id(&db, &session_id)?;
                let messages = db.list_messages_for_session(&session_id, limit)?;
                let unread_before = db
                    .unread_message_counts()?
                    .get(&session_id)
                    .copied()
                    .unwrap_or(0);
                if unread_before > 0 {
                    let _ = db.mark_messages_read(&session_id)?;
                }

                if messages.is_empty() {
                    println!("No messages for {}", short_session(&session_id));
                } else {
                    println!("Messages for {}", short_session(&session_id));
                    for message in messages {
                        println!(
                            "{} {} -> {} | {}",
                            message.timestamp.format("%H:%M:%S"),
                            short_session(&message.from_session),
                            short_session(&message.to_session),
                            comms::preview(&message.msg_type, &message.content)
                        );
                    }
                }
            }
        },
        Some(Commands::Schedule { command }) => match command {
            ScheduleCommands::Add {
                cron,
                task,
                agent,
                profile,
                worktree,
                project,
                task_group,
                json,
            } => {
                let schedule = session::manager::create_scheduled_task(
                    &db,
                    &cfg,
                    &cron,
                    &task,
                    agent.as_deref().unwrap_or(&cfg.default_agent),
                    profile.as_deref(),
                    worktree.resolve(&cfg),
                    session::SessionGrouping {
                        project,
                        task_group,
                    },
                )?;
                if json {
                    println!("{}", serde_json::to_string_pretty(&schedule)?);
                } else {
                    println!(
                        "Scheduled task {} next runs at {}",
                        schedule.id,
                        schedule.next_run_at.to_rfc3339()
                    );
                    println!(
                        "- {} [{}] | {}",
                        schedule.task, schedule.agent_type, schedule.cron_expr
                    );
                }
            }
            ScheduleCommands::List { json } => {
                let schedules = session::manager::list_scheduled_tasks(&db)?;
                if json {
                    println!("{}", serde_json::to_string_pretty(&schedules)?);
                } else if schedules.is_empty() {
                    println!("No scheduled tasks");
                } else {
                    println!("Scheduled tasks");
                    for schedule in schedules {
                        println!(
                            "#{} {} [{}] | {} | next {}",
                            schedule.id,
                            schedule.task,
                            schedule.agent_type,
                            schedule.cron_expr,
                            schedule.next_run_at.to_rfc3339()
                        );
                    }
                }
            }
            ScheduleCommands::Remove { schedule_id } => {
                if !session::manager::delete_scheduled_task(&db, schedule_id)? {
                    anyhow::bail!("Scheduled task not found: {schedule_id}");
                }
                println!("Removed scheduled task {schedule_id}");
            }
            ScheduleCommands::RunDue { limit, json } => {
                let outcomes = session::manager::run_due_schedules(&db, &cfg, limit).await?;
                if json {
                    println!("{}", serde_json::to_string_pretty(&outcomes)?);
                } else if outcomes.is_empty() {
                    println!("No due scheduled tasks");
                } else {
                    println!("Dispatched {} scheduled task(s)", outcomes.len());
                    for outcome in outcomes {
                        println!(
                            "#{} -> {} | {} | next {}",
                            outcome.schedule_id,
                            short_session(&outcome.session_id),
                            outcome.task,
                            outcome.next_run_at.to_rfc3339()
                        );
                    }
                }
            }
        },
        Some(Commands::Remote { command }) => match command {
            RemoteCommands::Add {
                task,
                to_session,
                priority,
                agent,
                profile,
                worktree,
                project,
                task_group,
                json,
            } => {
                let target_session_id = to_session
                    .as_deref()
                    .map(|value| resolve_session_id(&db, value))
                    .transpose()?;
                let request = session::manager::create_remote_dispatch_request(
                    &db,
                    &cfg,
                    &task,
                    target_session_id.as_deref(),
                    priority.into(),
                    agent.as_deref().unwrap_or(&cfg.default_agent),
                    profile.as_deref(),
                    worktree.resolve(&cfg),
                    session::SessionGrouping {
                        project,
                        task_group,
                    },
                    "cli",
                    None,
                )?;
                if json {
                    println!("{}", serde_json::to_string_pretty(&request)?);
                } else {
                    println!(
                        "Queued remote request #{} [{}] {}",
                        request.id, request.priority, request.task
                    );
                    if let Some(target_session_id) = request.target_session_id.as_deref() {
                        println!("- target {}", short_session(target_session_id));
                    }
                }
            }
            RemoteCommands::ComputerUse {
                goal,
                target_url,
                context,
                to_session,
                priority,
                agent,
                profile,
                worktree,
                project,
                task_group,
                json,
            } => {
                let target_session_id = to_session
                    .as_deref()
                    .map(|value| resolve_session_id(&db, value))
                    .transpose()?;
                let defaults = cfg.computer_use_dispatch_defaults();
                let request = session::manager::create_computer_use_remote_dispatch_request(
                    &db,
                    &cfg,
                    &goal,
                    target_url.as_deref(),
                    context.as_deref(),
                    target_session_id.as_deref(),
                    priority.into(),
                    agent.as_deref(),
                    profile.as_deref(),
                    Some(worktree.resolve(defaults.use_worktree)),
                    session::SessionGrouping {
                        project,
                        task_group,
                    },
                    "cli_computer_use",
                    None,
                )?;
                if json {
                    println!("{}", serde_json::to_string_pretty(&request)?);
                } else {
                    println!(
                        "Queued remote {} request #{} [{}] {}",
                        request.request_kind, request.id, request.priority, goal
                    );
                    if let Some(target_url) = request.target_url.as_deref() {
                        println!("- target url {target_url}");
                    }
                    if let Some(target_session_id) = request.target_session_id.as_deref() {
                        println!("- target {}", short_session(target_session_id));
                    }
                }
            }
            RemoteCommands::List { all, limit, json } => {
                let requests = session::manager::list_remote_dispatch_requests(&db, all, limit)?;
                if json {
                    println!("{}", serde_json::to_string_pretty(&requests)?);
                } else if requests.is_empty() {
                    println!("No remote dispatch requests");
                } else {
                    println!("Remote dispatch requests");
                    for request in requests {
                        let target = request
                            .target_session_id
                            .as_deref()
                            .map(short_session)
                            .unwrap_or_else(|| "new-session".to_string());
                        let label = format_remote_dispatch_kind(request.request_kind);
                        println!(
                            "#{} [{}] {} {} -> {} | {}",
                            request.id,
                            request.priority,
                            label,
                            request.status,
                            target,
                            request.task.lines().next().unwrap_or(&request.task)
                        );
                    }
                }
            }
            RemoteCommands::Run { limit, json } => {
                let outcomes =
                    session::manager::run_remote_dispatch_requests(&db, &cfg, limit).await?;
                if json {
                    println!("{}", serde_json::to_string_pretty(&outcomes)?);
                } else if outcomes.is_empty() {
                    println!("No pending remote dispatch requests");
                } else {
                    println!("Processed {} remote request(s)", outcomes.len());
                    for outcome in outcomes {
                        let target = outcome
                            .target_session_id
                            .as_deref()
                            .map(short_session)
                            .unwrap_or_else(|| "new-session".to_string());
                        let result = outcome
                            .session_id
                            .as_deref()
                            .map(short_session)
                            .unwrap_or_else(|| "-".to_string());
                        println!(
                            "#{} [{}] {} -> {} | {}",
                            outcome.request_id,
                            outcome.priority,
                            target,
                            result,
                            format_remote_dispatch_action(&outcome.action)
                        );
                    }
                }
            }
            RemoteCommands::Serve { bind, token } => {
                run_remote_dispatch_server(&db, &cfg, &bind, &token)?;
            }
        },
        Some(Commands::Daemon) => {
            println!("Starting ECC daemon...");
            session::daemon::run(db, cfg).await?;
        }
        Some(Commands::RunSession {
            session_id,
            task,
            agent,
            cwd,
        }) => {
            session::manager::run_session(&cfg, &session_id, &task, &agent, &cwd).await?;
        }
    }

    Ok(())
}

fn resolve_session_id(db: &session::store::StateStore, value: &str) -> Result<String> {
    if value == "latest" {
        return db
            .get_latest_session()?
            .map(|session| session.id)
            .ok_or_else(|| anyhow::anyhow!("No sessions found"));
    }

    db.get_session(value)?
        .map(|session| session.id)
        .ok_or_else(|| anyhow::anyhow!("Session not found: {value}"))
}

fn sync_runtime_session_metrics(
    db: &session::store::StateStore,
    cfg: &config::Config,
) -> Result<()> {
    db.refresh_session_durations()?;
    db.sync_cost_tracker_metrics(&cfg.cost_metrics_path())?;
    db.sync_tool_activity_metrics(&cfg.tool_activity_metrics_path())?;
    let _ = session::manager::enforce_session_heartbeats(db, cfg)?;
    let _ = session::manager::enforce_budget_hard_limits(db, cfg)?;
    Ok(())
}

fn sync_memory_connector(
    db: &session::store::StateStore,
    cfg: &config::Config,
    name: &str,
    limit: usize,
) -> Result<GraphConnectorSyncStats> {
    let connector = cfg
        .memory_connectors
        .get(name)
        .ok_or_else(|| anyhow::anyhow!("Unknown memory connector: {name}"))?;

    match connector {
        config::MemoryConnectorConfig::JsonlFile(settings) => {
            sync_jsonl_memory_connector(db, name, settings, limit)
        }
        config::MemoryConnectorConfig::JsonlDirectory(settings) => {
            sync_jsonl_directory_memory_connector(db, name, settings, limit)
        }
        config::MemoryConnectorConfig::MarkdownFile(settings) => {
            sync_markdown_memory_connector(db, name, settings, limit)
        }
        config::MemoryConnectorConfig::MarkdownDirectory(settings) => {
            sync_markdown_directory_memory_connector(db, name, settings, limit)
        }
        config::MemoryConnectorConfig::DotenvFile(settings) => {
            sync_dotenv_memory_connector(db, name, settings, limit)
        }
    }
}

fn sync_all_memory_connectors(
    db: &session::store::StateStore,
    cfg: &config::Config,
    limit: usize,
) -> Result<GraphConnectorSyncReport> {
    let mut report = GraphConnectorSyncReport::default();

    for name in cfg.memory_connectors.keys() {
        let stats = sync_memory_connector(db, cfg, name, limit)?;
        report.connectors_synced += 1;
        report.records_read += stats.records_read;
        report.entities_upserted += stats.entities_upserted;
        report.observations_added += stats.observations_added;
        report.skipped_records += stats.skipped_records;
        report.skipped_unchanged_sources += stats.skipped_unchanged_sources;
        report.connectors.push(stats);
    }

    Ok(report)
}

fn memory_connector_status_report(
    db: &session::store::StateStore,
    cfg: &config::Config,
) -> Result<GraphConnectorStatusReport> {
    let mut report = GraphConnectorStatusReport {
        configured_connectors: cfg.memory_connectors.len(),
        connectors: Vec::with_capacity(cfg.memory_connectors.len()),
    };

    for (name, connector) in &cfg.memory_connectors {
        let checkpoint = db.connector_checkpoint_summary(name)?;
        let (
            connector_kind,
            source_path,
            recurse,
            default_session_id,
            default_entity_type,
            default_observation_type,
        ) = describe_memory_connector(connector);
        report.connectors.push(GraphConnectorStatus {
            connector_name: name.to_string(),
            connector_kind,
            source_path,
            recurse,
            default_session_id,
            default_entity_type,
            default_observation_type,
            synced_sources: checkpoint.synced_sources,
            last_synced_at: checkpoint.last_synced_at,
        });
    }

    Ok(report)
}

fn describe_memory_connector(
    connector: &config::MemoryConnectorConfig,
) -> (
    String,
    String,
    bool,
    Option<String>,
    Option<String>,
    Option<String>,
) {
    match connector {
        config::MemoryConnectorConfig::JsonlFile(settings) => (
            "jsonl_file".to_string(),
            settings.path.display().to_string(),
            false,
            settings.session_id.clone(),
            settings.default_entity_type.clone(),
            settings.default_observation_type.clone(),
        ),
        config::MemoryConnectorConfig::JsonlDirectory(settings) => (
            "jsonl_directory".to_string(),
            settings.path.display().to_string(),
            settings.recurse,
            settings.session_id.clone(),
            settings.default_entity_type.clone(),
            settings.default_observation_type.clone(),
        ),
        config::MemoryConnectorConfig::MarkdownFile(settings) => (
            "markdown_file".to_string(),
            settings.path.display().to_string(),
            false,
            settings.session_id.clone(),
            settings.default_entity_type.clone(),
            settings.default_observation_type.clone(),
        ),
        config::MemoryConnectorConfig::MarkdownDirectory(settings) => (
            "markdown_directory".to_string(),
            settings.path.display().to_string(),
            settings.recurse,
            settings.session_id.clone(),
            settings.default_entity_type.clone(),
            settings.default_observation_type.clone(),
        ),
        config::MemoryConnectorConfig::DotenvFile(settings) => (
            "dotenv_file".to_string(),
            settings.path.display().to_string(),
            false,
            settings.session_id.clone(),
            settings.default_entity_type.clone(),
            settings.default_observation_type.clone(),
        ),
    }
}

fn sync_jsonl_memory_connector(
    db: &session::store::StateStore,
    name: &str,
    settings: &config::MemoryConnectorJsonlFileConfig,
    limit: usize,
) -> Result<GraphConnectorSyncStats> {
    if settings.path.as_os_str().is_empty() {
        anyhow::bail!("memory connector {name} has no path configured");
    }

    let file = File::open(&settings.path)
        .with_context(|| format!("open memory connector file {}", settings.path.display()))?;
    let reader = BufReader::new(file);
    let default_session_id = settings
        .session_id
        .as_deref()
        .map(|value| resolve_session_id(db, value))
        .transpose()?;
    let source_path = settings.path.display().to_string();
    let signature = connector_source_signature(&settings.path)?;
    if db.connector_source_is_unchanged(name, &source_path, &signature)? {
        return Ok(GraphConnectorSyncStats {
            connector_name: name.to_string(),
            skipped_unchanged_sources: 1,
            ..Default::default()
        });
    }

    let stats = sync_jsonl_memory_reader(
        db,
        name,
        reader,
        default_session_id.as_deref(),
        settings.default_entity_type.as_deref(),
        settings.default_observation_type.as_deref(),
        limit,
    )?;
    if stats.records_read < limit {
        db.upsert_connector_source_checkpoint(name, &source_path, &signature)?;
    }
    Ok(stats)
}

fn sync_jsonl_directory_memory_connector(
    db: &session::store::StateStore,
    name: &str,
    settings: &config::MemoryConnectorJsonlDirectoryConfig,
    limit: usize,
) -> Result<GraphConnectorSyncStats> {
    if settings.path.as_os_str().is_empty() {
        anyhow::bail!("memory connector {name} has no path configured");
    }
    if !settings.path.is_dir() {
        anyhow::bail!(
            "memory connector {name} path is not a directory: {}",
            settings.path.display()
        );
    }

    let paths = collect_jsonl_paths(&settings.path, settings.recurse)?;
    let default_session_id = settings
        .session_id
        .as_deref()
        .map(|value| resolve_session_id(db, value))
        .transpose()?;

    let mut stats = GraphConnectorSyncStats {
        connector_name: name.to_string(),
        ..Default::default()
    };

    let mut remaining = limit;
    for path in paths {
        if remaining == 0 {
            break;
        }
        let source_path = path.display().to_string();
        let signature = connector_source_signature(&path)?;
        if db.connector_source_is_unchanged(name, &source_path, &signature)? {
            stats.skipped_unchanged_sources += 1;
            continue;
        }
        let file = File::open(&path)
            .with_context(|| format!("open memory connector file {}", path.display()))?;
        let reader = BufReader::new(file);
        let remaining_before = remaining;
        let file_stats = sync_jsonl_memory_reader(
            db,
            name,
            reader,
            default_session_id.as_deref(),
            settings.default_entity_type.as_deref(),
            settings.default_observation_type.as_deref(),
            remaining,
        )?;
        remaining = remaining.saturating_sub(file_stats.records_read);
        stats.records_read += file_stats.records_read;
        stats.entities_upserted += file_stats.entities_upserted;
        stats.observations_added += file_stats.observations_added;
        stats.skipped_records += file_stats.skipped_records;
        stats.skipped_unchanged_sources += file_stats.skipped_unchanged_sources;
        if file_stats.records_read < remaining_before {
            db.upsert_connector_source_checkpoint(name, &source_path, &signature)?;
        }
    }

    Ok(stats)
}

fn sync_jsonl_memory_reader<R: BufRead>(
    db: &session::store::StateStore,
    name: &str,
    reader: R,
    default_session_id: Option<&str>,
    default_entity_type: Option<&str>,
    default_observation_type: Option<&str>,
    limit: usize,
) -> Result<GraphConnectorSyncStats> {
    let default_session_id = default_session_id.map(str::to_string);
    let mut stats = GraphConnectorSyncStats {
        connector_name: name.to_string(),
        ..Default::default()
    };

    for line in reader.lines() {
        let line = line?;
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if stats.records_read >= limit {
            break;
        }
        stats.records_read += 1;

        let record: JsonlMemoryConnectorRecord = match serde_json::from_str(trimmed) {
            Ok(record) => record,
            Err(_) => {
                stats.skipped_records += 1;
                continue;
            }
        };

        import_memory_connector_record(
            db,
            &mut stats,
            default_session_id.as_deref(),
            default_entity_type,
            default_observation_type,
            record,
        )?;
    }

    Ok(stats)
}

fn sync_markdown_memory_connector(
    db: &session::store::StateStore,
    name: &str,
    settings: &config::MemoryConnectorMarkdownFileConfig,
    limit: usize,
) -> Result<GraphConnectorSyncStats> {
    if settings.path.as_os_str().is_empty() {
        anyhow::bail!("memory connector {name} has no path configured");
    }

    let default_session_id = settings
        .session_id
        .as_deref()
        .map(|value| resolve_session_id(db, value))
        .transpose()?;
    let source_path = settings.path.display().to_string();
    let signature = connector_source_signature(&settings.path)?;
    if db.connector_source_is_unchanged(name, &source_path, &signature)? {
        return Ok(GraphConnectorSyncStats {
            connector_name: name.to_string(),
            skipped_unchanged_sources: 1,
            ..Default::default()
        });
    }
    let stats = sync_markdown_memory_path(
        db,
        name,
        "markdown_file",
        &settings.path,
        default_session_id.as_deref(),
        settings.default_entity_type.as_deref(),
        settings.default_observation_type.as_deref(),
        limit,
    )?;
    if stats.records_read < limit {
        db.upsert_connector_source_checkpoint(name, &source_path, &signature)?;
    }
    Ok(stats)
}

fn sync_markdown_directory_memory_connector(
    db: &session::store::StateStore,
    name: &str,
    settings: &config::MemoryConnectorMarkdownDirectoryConfig,
    limit: usize,
) -> Result<GraphConnectorSyncStats> {
    if settings.path.as_os_str().is_empty() {
        anyhow::bail!("memory connector {name} has no path configured");
    }
    if !settings.path.is_dir() {
        anyhow::bail!(
            "memory connector {name} path is not a directory: {}",
            settings.path.display()
        );
    }

    let paths = collect_markdown_paths(&settings.path, settings.recurse)?;
    let default_session_id = settings
        .session_id
        .as_deref()
        .map(|value| resolve_session_id(db, value))
        .transpose()?;

    let mut stats = GraphConnectorSyncStats {
        connector_name: name.to_string(),
        ..Default::default()
    };

    let mut remaining = limit;
    for path in paths {
        if remaining == 0 {
            break;
        }
        let source_path = path.display().to_string();
        let signature = connector_source_signature(&path)?;
        if db.connector_source_is_unchanged(name, &source_path, &signature)? {
            stats.skipped_unchanged_sources += 1;
            continue;
        }
        let remaining_before = remaining;
        let file_stats = sync_markdown_memory_path(
            db,
            name,
            "markdown_directory",
            &path,
            default_session_id.as_deref(),
            settings.default_entity_type.as_deref(),
            settings.default_observation_type.as_deref(),
            remaining,
        )?;
        remaining = remaining.saturating_sub(file_stats.records_read);
        stats.records_read += file_stats.records_read;
        stats.entities_upserted += file_stats.entities_upserted;
        stats.observations_added += file_stats.observations_added;
        stats.skipped_records += file_stats.skipped_records;
        stats.skipped_unchanged_sources += file_stats.skipped_unchanged_sources;
        if file_stats.records_read < remaining_before {
            db.upsert_connector_source_checkpoint(name, &source_path, &signature)?;
        }
    }

    Ok(stats)
}

fn sync_markdown_memory_path(
    db: &session::store::StateStore,
    name: &str,
    connector_kind: &str,
    path: &Path,
    default_session_id: Option<&str>,
    default_entity_type: Option<&str>,
    default_observation_type: Option<&str>,
    limit: usize,
) -> Result<GraphConnectorSyncStats> {
    let body = std::fs::read_to_string(path)
        .with_context(|| format!("read memory connector file {}", path.display()))?;
    let sections = parse_markdown_memory_sections(path, &body, limit);
    let mut stats = GraphConnectorSyncStats {
        connector_name: name.to_string(),
        ..Default::default()
    };

    for section in sections {
        stats.records_read += 1;
        let mut details = BTreeMap::new();
        if !section.body.is_empty() {
            details.insert("body".to_string(), section.body.clone());
        }
        details.insert("source_path".to_string(), path.display().to_string());
        details.insert("line".to_string(), section.line_number.to_string());

        let mut metadata = BTreeMap::new();
        metadata.insert("connector".to_string(), connector_kind.to_string());

        import_memory_connector_record(
            db,
            &mut stats,
            default_session_id,
            default_entity_type,
            default_observation_type,
            JsonlMemoryConnectorRecord {
                session_id: None,
                entity_type: None,
                entity_name: section.heading,
                path: Some(section.path),
                entity_summary: Some(section.summary.clone()),
                metadata,
                observation_type: None,
                summary: section.summary,
                details,
            },
        )?;
    }

    Ok(stats)
}

fn sync_dotenv_memory_connector(
    db: &session::store::StateStore,
    name: &str,
    settings: &config::MemoryConnectorDotenvFileConfig,
    limit: usize,
) -> Result<GraphConnectorSyncStats> {
    if settings.path.as_os_str().is_empty() {
        anyhow::bail!("memory connector {name} has no path configured");
    }

    let body = std::fs::read_to_string(&settings.path)
        .with_context(|| format!("read memory connector file {}", settings.path.display()))?;
    let default_session_id = settings
        .session_id
        .as_deref()
        .map(|value| resolve_session_id(db, value))
        .transpose()?;
    let source_path = settings.path.display().to_string();
    let signature = connector_source_signature(&settings.path)?;
    if db.connector_source_is_unchanged(name, &source_path, &signature)? {
        return Ok(GraphConnectorSyncStats {
            connector_name: name.to_string(),
            skipped_unchanged_sources: 1,
            ..Default::default()
        });
    }
    let entries = parse_dotenv_memory_entries(&settings.path, &body, settings, limit);
    let mut stats = GraphConnectorSyncStats {
        connector_name: name.to_string(),
        ..Default::default()
    };

    for entry in entries {
        stats.records_read += 1;
        import_memory_connector_record(
            db,
            &mut stats,
            default_session_id.as_deref(),
            settings.default_entity_type.as_deref(),
            settings.default_observation_type.as_deref(),
            JsonlMemoryConnectorRecord {
                session_id: None,
                entity_type: None,
                entity_name: entry.key,
                path: Some(entry.path),
                entity_summary: Some(entry.summary.clone()),
                metadata: BTreeMap::from([("connector".to_string(), "dotenv_file".to_string())]),
                observation_type: None,
                summary: entry.summary,
                details: entry.details,
            },
        )?;
    }

    if stats.records_read < limit {
        db.upsert_connector_source_checkpoint(name, &source_path, &signature)?;
    }

    Ok(stats)
}

fn import_memory_connector_record(
    db: &session::store::StateStore,
    stats: &mut GraphConnectorSyncStats,
    default_session_id: Option<&str>,
    default_entity_type: Option<&str>,
    default_observation_type: Option<&str>,
    record: JsonlMemoryConnectorRecord,
) -> Result<()> {
    let session_id = match record.session_id.as_deref() {
        Some(value) => match resolve_session_id(db, value) {
            Ok(resolved) => Some(resolved),
            Err(_) => {
                stats.skipped_records += 1;
                return Ok(());
            }
        },
        None => default_session_id.map(str::to_string),
    };
    let entity_type = record
        .entity_type
        .as_deref()
        .or(default_entity_type)
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let observation_type = record
        .observation_type
        .as_deref()
        .or(default_observation_type)
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let entity_name = record.entity_name.trim();
    let summary = record.summary.trim();

    let Some(entity_type) = entity_type else {
        stats.skipped_records += 1;
        return Ok(());
    };
    let Some(observation_type) = observation_type else {
        stats.skipped_records += 1;
        return Ok(());
    };
    if entity_name.is_empty() || summary.is_empty() {
        stats.skipped_records += 1;
        return Ok(());
    }

    let entity_summary = record
        .entity_summary
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(summary);
    let entity = db.upsert_context_entity(
        session_id.as_deref(),
        entity_type,
        entity_name,
        record.path.as_deref(),
        entity_summary,
        &record.metadata,
    )?;
    db.add_context_observation(
        session_id.as_deref(),
        entity.id,
        observation_type,
        session::ContextObservationPriority::Normal,
        false,
        summary,
        &record.details,
    )?;
    stats.entities_upserted += 1;
    stats.observations_added += 1;
    Ok(())
}

fn collect_jsonl_paths(root: &Path, recurse: bool) -> Result<Vec<PathBuf>> {
    let mut paths = Vec::new();
    collect_jsonl_paths_inner(root, recurse, &mut paths)?;
    paths.sort();
    Ok(paths)
}

fn collect_json_paths(root: &Path, recurse: bool) -> Result<Vec<PathBuf>> {
    let mut paths = Vec::new();
    collect_json_paths_inner(root, recurse, &mut paths)?;
    paths.sort();
    Ok(paths)
}

fn collect_markdown_paths(root: &Path, recurse: bool) -> Result<Vec<PathBuf>> {
    let mut paths = Vec::new();
    collect_markdown_paths_inner(root, recurse, &mut paths)?;
    paths.sort();
    Ok(paths)
}

fn connector_source_signature(path: &Path) -> Result<String> {
    let metadata = std::fs::metadata(path)
        .with_context(|| format!("read memory connector metadata {}", path.display()))?;
    let modified = metadata
        .modified()
        .ok()
        .and_then(|timestamp| timestamp.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    Ok(format!("{}:{modified}", metadata.len()))
}

fn collect_jsonl_paths_inner(root: &Path, recurse: bool, paths: &mut Vec<PathBuf>) -> Result<()> {
    for entry in std::fs::read_dir(root)
        .with_context(|| format!("read memory connector directory {}", root.display()))?
    {
        let entry = entry?;
        let path = entry.path();
        if path.is_dir() {
            if recurse {
                collect_jsonl_paths_inner(&path, recurse, paths)?;
            }
            continue;
        }
        if path
            .extension()
            .and_then(|value| value.to_str())
            .is_some_and(|value| value.eq_ignore_ascii_case("jsonl"))
        {
            paths.push(path);
        }
    }
    Ok(())
}

fn collect_json_paths_inner(root: &Path, recurse: bool, paths: &mut Vec<PathBuf>) -> Result<()> {
    for entry in std::fs::read_dir(root)
        .with_context(|| format!("read memory connector directory {}", root.display()))?
    {
        let entry = entry?;
        let path = entry.path();
        if path.is_dir() {
            if recurse {
                collect_json_paths_inner(&path, recurse, paths)?;
            }
            continue;
        }
        if path
            .extension()
            .and_then(|value| value.to_str())
            .is_some_and(|value| value.eq_ignore_ascii_case("json"))
        {
            paths.push(path);
        }
    }
    Ok(())
}

fn collect_markdown_paths_inner(
    root: &Path,
    recurse: bool,
    paths: &mut Vec<PathBuf>,
) -> Result<()> {
    for entry in std::fs::read_dir(root)
        .with_context(|| format!("read memory connector directory {}", root.display()))?
    {
        let entry = entry?;
        let path = entry.path();
        if path.is_dir() {
            if recurse {
                collect_markdown_paths_inner(&path, recurse, paths)?;
            }
            continue;
        }
        let is_markdown = path
            .extension()
            .and_then(|value| value.to_str())
            .is_some_and(|value| {
                value.eq_ignore_ascii_case("md") || value.eq_ignore_ascii_case("markdown")
            });
        if is_markdown {
            paths.push(path);
        }
    }
    Ok(())
}

fn parse_dotenv_memory_entries(
    path: &Path,
    body: &str,
    settings: &config::MemoryConnectorDotenvFileConfig,
    limit: usize,
) -> Vec<DotenvMemoryEntry> {
    if limit == 0 {
        return Vec::new();
    }

    let mut entries = Vec::new();
    let source_path = path.display().to_string();

    for (index, raw_line) in body.lines().enumerate() {
        if entries.len() >= limit {
            break;
        }

        let line = raw_line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }

        let Some((key, value)) = parse_dotenv_assignment(line) else {
            continue;
        };
        if !dotenv_key_included(key, settings) {
            continue;
        }

        let value = parse_dotenv_value(value);
        let secret_like = dotenv_key_is_secret(key);
        let mut details = BTreeMap::new();
        details.insert("source_path".to_string(), source_path.clone());
        details.insert("line".to_string(), (index + 1).to_string());
        details.insert("key".to_string(), key.to_string());
        details.insert("secret_redacted".to_string(), secret_like.to_string());
        if settings.include_safe_values && !secret_like && !value.is_empty() {
            details.insert(
                "value".to_string(),
                truncate_connector_text(&value, DOTENV_CONNECTOR_VALUE_LIMIT),
            );
        }

        let summary = if secret_like {
            format!("{key} configured (secret redacted)")
        } else if settings.include_safe_values && !value.is_empty() {
            format!(
                "{key}={}",
                truncate_connector_text(&value, DOTENV_CONNECTOR_VALUE_LIMIT)
            )
        } else {
            format!("{key} configured")
        };

        entries.push(DotenvMemoryEntry {
            key: key.to_string(),
            path: format!("{source_path}#{key}"),
            summary,
            details,
        });
    }

    entries
}

fn parse_markdown_memory_sections(
    path: &Path,
    body: &str,
    limit: usize,
) -> Vec<MarkdownMemorySection> {
    if limit == 0 {
        return Vec::new();
    }

    let source_path = path.display().to_string();
    let fallback_heading = path
        .file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("note")
        .trim()
        .to_string();

    let mut sections = Vec::new();
    let mut preamble = Vec::new();
    let mut current_heading: Option<(String, usize)> = None;
    let mut current_body = Vec::new();

    for (index, line) in body.lines().enumerate() {
        let line_number = index + 1;
        if let Some(heading) = markdown_heading_title(line) {
            if let Some((title, start_line)) = current_heading.take() {
                if let Some(section) = markdown_memory_section(
                    &source_path,
                    &title,
                    start_line,
                    &current_body.join("\n"),
                ) {
                    sections.push(section);
                }
            } else if !preamble.join("\n").trim().is_empty() {
                if let Some(section) = markdown_memory_section(
                    &source_path,
                    &fallback_heading,
                    1,
                    &preamble.join("\n"),
                ) {
                    sections.push(section);
                }
            }

            current_heading = Some((heading.to_string(), line_number));
            current_body.clear();
            continue;
        }

        if current_heading.is_some() {
            current_body.push(line.to_string());
        } else {
            preamble.push(line.to_string());
        }
    }

    if let Some((title, start_line)) = current_heading {
        if let Some(section) =
            markdown_memory_section(&source_path, &title, start_line, &current_body.join("\n"))
        {
            sections.push(section);
        }
    } else if let Some(section) =
        markdown_memory_section(&source_path, &fallback_heading, 1, &preamble.join("\n"))
    {
        sections.push(section);
    }

    sections.truncate(limit);
    sections
}

fn markdown_heading_title(line: &str) -> Option<&str> {
    let trimmed = line.trim_start();
    let hashes = trimmed.chars().take_while(|ch| *ch == '#').count();
    if hashes == 0 || hashes > 6 {
        return None;
    }
    let title = trimmed[hashes..].trim_start();
    if title.is_empty() {
        return None;
    }
    Some(title.trim())
}

fn markdown_memory_section(
    source_path: &str,
    heading: &str,
    line_number: usize,
    body: &str,
) -> Option<MarkdownMemorySection> {
    let heading = heading.trim();
    if heading.is_empty() {
        return None;
    }
    let normalized_body = body.trim();
    let summary = markdown_section_summary(heading, normalized_body);
    if summary.is_empty() {
        return None;
    }
    let slug = markdown_heading_slug(heading);
    let path = if slug.is_empty() {
        source_path.to_string()
    } else {
        format!("{source_path}#{slug}")
    };

    Some(MarkdownMemorySection {
        heading: truncate_connector_text(heading, MARKDOWN_CONNECTOR_SUMMARY_LIMIT),
        path,
        summary,
        body: truncate_connector_text(normalized_body, MARKDOWN_CONNECTOR_BODY_LIMIT),
        line_number,
    })
}

fn markdown_section_summary(heading: &str, body: &str) -> String {
    let candidate = body
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or(heading);
    truncate_connector_text(candidate, MARKDOWN_CONNECTOR_SUMMARY_LIMIT)
}

fn markdown_heading_slug(value: &str) -> String {
    let mut slug = String::new();
    let mut last_dash = false;
    for ch in value.chars() {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch.to_ascii_lowercase());
            last_dash = false;
        } else if !last_dash {
            slug.push('-');
            last_dash = true;
        }
    }
    slug.trim_matches('-').to_string()
}

fn truncate_connector_text(value: &str, max_chars: usize) -> String {
    let trimmed = value.trim();
    if trimmed.chars().count() <= max_chars {
        return trimmed.to_string();
    }
    let truncated: String = trimmed.chars().take(max_chars.saturating_sub(1)).collect();
    format!("{truncated}…")
}

fn parse_dotenv_assignment(line: &str) -> Option<(&str, &str)> {
    let trimmed = line.strip_prefix("export ").unwrap_or(line).trim();
    let (key, value) = trimmed.split_once('=')?;
    let key = key.trim();
    if key.is_empty() {
        return None;
    }
    Some((key, value.trim()))
}

fn parse_dotenv_value(raw: &str) -> String {
    let trimmed = raw.trim();
    if let Some(unquoted) = trimmed
        .strip_prefix('"')
        .and_then(|value| value.strip_suffix('"'))
    {
        return unquoted.to_string();
    }
    if let Some(unquoted) = trimmed
        .strip_prefix('\'')
        .and_then(|value| value.strip_suffix('\''))
    {
        return unquoted.to_string();
    }
    trimmed.to_string()
}

fn dotenv_key_included(key: &str, settings: &config::MemoryConnectorDotenvFileConfig) -> bool {
    if settings
        .exclude_keys
        .iter()
        .any(|candidate| candidate == key)
    {
        return false;
    }
    if !settings.include_keys.is_empty()
        && settings
            .include_keys
            .iter()
            .any(|candidate| candidate == key)
    {
        return true;
    }
    if settings.key_prefixes.is_empty() {
        return settings.include_keys.is_empty();
    }
    settings
        .key_prefixes
        .iter()
        .any(|prefix| !prefix.is_empty() && key.starts_with(prefix))
}

fn dotenv_key_is_secret(key: &str) -> bool {
    let upper = key.to_ascii_uppercase();
    [
        "SECRET",
        "TOKEN",
        "PASSWORD",
        "PRIVATE_KEY",
        "API_KEY",
        "CLIENT_SECRET",
        "ACCESS_KEY",
    ]
    .iter()
    .any(|marker| upper.contains(marker))
}

fn build_message(
    kind: MessageKindArg,
    text: String,
    context: Option<String>,
    priority: TaskPriorityArg,
    files: Vec<String>,
) -> Result<comms::MessageType> {
    Ok(match kind {
        MessageKindArg::Handoff => comms::MessageType::TaskHandoff {
            task: text,
            context: context.unwrap_or_default(),
            priority: priority.into(),
        },
        MessageKindArg::Query => comms::MessageType::Query { question: text },
        MessageKindArg::Response => comms::MessageType::Response { answer: text },
        MessageKindArg::Completed => comms::MessageType::Completed {
            summary: text,
            files_changed: files,
        },
        MessageKindArg::Conflict => {
            let file = files
                .first()
                .cloned()
                .ok_or_else(|| anyhow::anyhow!("Conflict messages require at least one --file"))?;
            comms::MessageType::Conflict {
                file,
                description: context.unwrap_or(text),
            }
        }
    })
}

fn format_remote_dispatch_action(action: &session::manager::RemoteDispatchAction) -> String {
    match action {
        session::manager::RemoteDispatchAction::SpawnedTopLevel => "spawned top-level".to_string(),
        session::manager::RemoteDispatchAction::Assigned(action) => match action {
            session::manager::AssignmentAction::Spawned => "spawned delegate".to_string(),
            session::manager::AssignmentAction::ReusedIdle => "reused idle delegate".to_string(),
            session::manager::AssignmentAction::ReusedActive => {
                "reused active delegate".to_string()
            }
            session::manager::AssignmentAction::DeferredSaturated => {
                "deferred (saturated)".to_string()
            }
        },
        session::manager::RemoteDispatchAction::DeferredSaturated => {
            "deferred (saturated)".to_string()
        }
        session::manager::RemoteDispatchAction::Failed(error) => format!("failed: {error}"),
    }
}

fn format_remote_dispatch_kind(kind: session::RemoteDispatchKind) -> &'static str {
    match kind {
        session::RemoteDispatchKind::Standard => "standard",
        session::RemoteDispatchKind::ComputerUse => "computer_use",
    }
}

fn short_session(session_id: &str) -> String {
    session_id.chars().take(8).collect()
}

fn run_remote_dispatch_server(
    db: &session::store::StateStore,
    cfg: &config::Config,
    bind_addr: &str,
    bearer_token: &str,
) -> Result<()> {
    let listener = TcpListener::bind(bind_addr)
        .with_context(|| format!("Failed to bind remote dispatch server on {bind_addr}"))?;
    println!("Remote dispatch server listening on http://{bind_addr}");

    for stream in listener.incoming() {
        match stream {
            Ok(mut stream) => {
                if let Err(error) =
                    handle_remote_dispatch_connection(&mut stream, db, cfg, bearer_token)
                {
                    let _ = write_http_response(
                        &mut stream,
                        500,
                        "application/json",
                        &serde_json::json!({
                            "error": error.to_string(),
                        })
                        .to_string(),
                    );
                }
            }
            Err(error) => tracing::warn!("Remote dispatch accept failed: {error}"),
        }
    }

    Ok(())
}

fn handle_remote_dispatch_connection(
    stream: &mut TcpStream,
    db: &session::store::StateStore,
    cfg: &config::Config,
    bearer_token: &str,
) -> Result<()> {
    let (method, path, headers, body) = read_http_request(stream)?;
    match (method.as_str(), path.as_str()) {
        ("GET", "/health") => write_http_response(
            stream,
            200,
            "application/json",
            &serde_json::json!({"ok": true}).to_string(),
        ),
        ("POST", "/dispatch") => {
            let auth = headers
                .get("authorization")
                .map(String::as_str)
                .unwrap_or_default();
            let expected = format!("Bearer {bearer_token}");
            if auth != expected {
                return write_http_response(
                    stream,
                    401,
                    "application/json",
                    &serde_json::json!({"error": "unauthorized"}).to_string(),
                );
            }

            let payload: RemoteDispatchHttpRequest =
                serde_json::from_slice(&body).context("Invalid remote dispatch JSON body")?;
            if payload.task.trim().is_empty() {
                return write_http_response(
                    stream,
                    400,
                    "application/json",
                    &serde_json::json!({"error": "task is required"}).to_string(),
                );
            }

            let target_session_id = match payload
                .to_session
                .as_deref()
                .map(|value| resolve_session_id(db, value))
                .transpose()
            {
                Ok(value) => value,
                Err(error) => {
                    return write_http_response(
                        stream,
                        400,
                        "application/json",
                        &serde_json::json!({"error": error.to_string()}).to_string(),
                    );
                }
            };
            let requester = stream.peer_addr().ok().map(|addr| addr.ip().to_string());
            let request = match session::manager::create_remote_dispatch_request(
                db,
                cfg,
                &payload.task,
                target_session_id.as_deref(),
                payload.priority.unwrap_or(TaskPriorityArg::Normal).into(),
                payload.agent.as_deref().unwrap_or(&cfg.default_agent),
                payload.profile.as_deref(),
                payload.use_worktree.unwrap_or(cfg.auto_create_worktrees),
                session::SessionGrouping {
                    project: payload.project,
                    task_group: payload.task_group,
                },
                "http",
                requester.as_deref(),
            ) {
                Ok(request) => request,
                Err(error) => {
                    return write_http_response(
                        stream,
                        400,
                        "application/json",
                        &serde_json::json!({"error": error.to_string()}).to_string(),
                    );
                }
            };

            write_http_response(
                stream,
                202,
                "application/json",
                &serde_json::to_string(&request)?,
            )
        }
        ("POST", "/computer-use") => {
            let auth = headers
                .get("authorization")
                .map(String::as_str)
                .unwrap_or_default();
            let expected = format!("Bearer {bearer_token}");
            if auth != expected {
                return write_http_response(
                    stream,
                    401,
                    "application/json",
                    &serde_json::json!({"error": "unauthorized"}).to_string(),
                );
            }

            let payload: RemoteComputerUseHttpRequest =
                serde_json::from_slice(&body).context("Invalid remote computer-use JSON body")?;
            if payload.goal.trim().is_empty() {
                return write_http_response(
                    stream,
                    400,
                    "application/json",
                    &serde_json::json!({"error": "goal is required"}).to_string(),
                );
            }

            let target_session_id = match payload
                .to_session
                .as_deref()
                .map(|value| resolve_session_id(db, value))
                .transpose()
            {
                Ok(value) => value,
                Err(error) => {
                    return write_http_response(
                        stream,
                        400,
                        "application/json",
                        &serde_json::json!({"error": error.to_string()}).to_string(),
                    );
                }
            };
            let requester = stream.peer_addr().ok().map(|addr| addr.ip().to_string());
            let defaults = cfg.computer_use_dispatch_defaults();
            let request = match session::manager::create_computer_use_remote_dispatch_request(
                db,
                cfg,
                &payload.goal,
                payload.target_url.as_deref(),
                payload.context.as_deref(),
                target_session_id.as_deref(),
                payload.priority.unwrap_or(TaskPriorityArg::Normal).into(),
                payload.agent.as_deref(),
                payload.profile.as_deref(),
                Some(payload.use_worktree.unwrap_or(defaults.use_worktree)),
                session::SessionGrouping {
                    project: payload.project,
                    task_group: payload.task_group,
                },
                "http_computer_use",
                requester.as_deref(),
            ) {
                Ok(request) => request,
                Err(error) => {
                    return write_http_response(
                        stream,
                        400,
                        "application/json",
                        &serde_json::json!({"error": error.to_string()}).to_string(),
                    );
                }
            };

            write_http_response(
                stream,
                202,
                "application/json",
                &serde_json::to_string(&request)?,
            )
        }
        _ => write_http_response(
            stream,
            404,
            "application/json",
            &serde_json::json!({"error": "not found"}).to_string(),
        ),
    }
}

fn read_http_request(
    stream: &mut TcpStream,
) -> Result<(String, String, BTreeMap<String, String>, Vec<u8>)> {
    let mut buffer = Vec::new();
    let mut temp = [0_u8; 1024];
    let header_end = loop {
        let read = stream.read(&mut temp)?;
        if read == 0 {
            anyhow::bail!("Unexpected EOF while reading HTTP request");
        }
        buffer.extend_from_slice(&temp[..read]);
        if let Some(index) = buffer.windows(4).position(|window| window == b"\r\n\r\n") {
            break index + 4;
        }
        if buffer.len() > 64 * 1024 {
            anyhow::bail!("HTTP request headers too large");
        }
    };

    let header_text = String::from_utf8(buffer[..header_end].to_vec())
        .context("HTTP request headers were not valid UTF-8")?;
    let mut lines = header_text.split("\r\n");
    let request_line = lines
        .next()
        .filter(|line| !line.trim().is_empty())
        .ok_or_else(|| anyhow::anyhow!("Missing HTTP request line"))?;
    let mut request_parts = request_line.split_whitespace();
    let method = request_parts
        .next()
        .ok_or_else(|| anyhow::anyhow!("Missing HTTP method"))?
        .to_string();
    let path = request_parts
        .next()
        .ok_or_else(|| anyhow::anyhow!("Missing HTTP path"))?
        .to_string();

    let mut headers = BTreeMap::new();
    for line in lines {
        if line.is_empty() {
            break;
        }
        if let Some((key, value)) = line.split_once(':') {
            headers.insert(key.trim().to_ascii_lowercase(), value.trim().to_string());
        }
    }

    let content_length = headers
        .get("content-length")
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(0);
    let mut body = buffer[header_end..].to_vec();
    while body.len() < content_length {
        let read = stream.read(&mut temp)?;
        if read == 0 {
            anyhow::bail!("Unexpected EOF while reading HTTP request body");
        }
        body.extend_from_slice(&temp[..read]);
    }
    body.truncate(content_length);

    Ok((method, path, headers, body))
}

fn write_http_response(
    stream: &mut TcpStream,
    status: u16,
    content_type: &str,
    body: &str,
) -> Result<()> {
    let status_text = match status {
        200 => "OK",
        202 => "Accepted",
        400 => "Bad Request",
        401 => "Unauthorized",
        404 => "Not Found",
        _ => "Internal Server Error",
    };
    write!(
        stream,
        "HTTP/1.1 {status} {status_text}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    )?;
    stream.flush()?;
    Ok(())
}

fn format_coordination_status(
    status: &session::manager::CoordinationStatus,
    json: bool,
) -> Result<String> {
    if json {
        return Ok(serde_json::to_string_pretty(status)?);
    }

    Ok(status.to_string())
}

async fn run_coordination_loop(
    db: &session::store::StateStore,
    cfg: &config::Config,
    agent: &str,
    use_worktree: bool,
    lead_limit: usize,
    pass_budget: usize,
    emit_progress: bool,
) -> Result<CoordinateBacklogRun> {
    let mut final_status = None;
    let mut pass_summaries = Vec::new();

    for pass in 1..=pass_budget.max(1) {
        let outcome =
            session::manager::coordinate_backlog(db, cfg, agent, use_worktree, lead_limit).await?;
        let mut summary = summarize_coordinate_backlog(&outcome);
        summary.pass = pass;
        pass_summaries.push(summary.clone());

        if emit_progress {
            if pass_budget > 1 {
                println!("Pass {pass}/{pass_budget}: {}", summary.message);
            } else {
                println!("{}", summary.message);
            }
        }

        let status = session::manager::get_coordination_status(db, cfg)?;
        let should_stop = matches!(
            status.health,
            session::manager::CoordinationHealth::Healthy
                | session::manager::CoordinationHealth::Saturated
                | session::manager::CoordinationHealth::EscalationRequired
        );
        final_status = Some(status);

        if should_stop {
            break;
        }
    }

    let run = CoordinateBacklogRun {
        pass_budget,
        passes: pass_summaries,
        final_status,
    };

    if emit_progress && pass_budget > 1 {
        if let Some(status) = run.final_status.as_ref() {
            println!(
                "Final coordination health: {:?} | mode {:?} | backlog {} handoff(s) across {} lead(s)",
                status.health, status.mode, status.backlog_messages, status.backlog_leads
            );
        }
    }

    Ok(run)
}

#[derive(Debug, Clone, Serialize)]
struct CoordinateBacklogPassSummary {
    pass: usize,
    processed: usize,
    routed: usize,
    deferred: usize,
    rerouted: usize,
    dispatched_leads: usize,
    rebalanced_leads: usize,
    remaining_backlog_sessions: usize,
    remaining_backlog_messages: usize,
    remaining_absorbable_sessions: usize,
    remaining_saturated_sessions: usize,
    message: String,
}

#[derive(Debug, Clone, Serialize)]
struct CoordinateBacklogRun {
    pass_budget: usize,
    passes: Vec<CoordinateBacklogPassSummary>,
    final_status: Option<session::manager::CoordinationStatus>,
}

#[derive(Debug, Clone, Serialize)]
struct MaintainCoordinationRun {
    skipped: bool,
    initial_status: session::manager::CoordinationStatus,
    run: Option<CoordinateBacklogRun>,
    final_status: session::manager::CoordinationStatus,
}

#[derive(Debug, Clone, Serialize)]
struct WorktreeMergeReadinessReport {
    status: String,
    summary: String,
    conflicts: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
struct WorktreeStatusReport {
    session_id: String,
    task: String,
    session_state: String,
    health: String,
    check_exit_code: i32,
    patch_included: bool,
    attached: bool,
    path: Option<String>,
    branch: Option<String>,
    base_branch: Option<String>,
    diff_summary: Option<String>,
    file_preview: Vec<String>,
    patch_preview: Option<String>,
    merge_readiness: Option<WorktreeMergeReadinessReport>,
}

#[derive(Debug, Clone, Serialize)]
struct WorktreeResolutionReport {
    session_id: String,
    task: String,
    session_state: String,
    attached: bool,
    conflicted: bool,
    check_exit_code: i32,
    path: Option<String>,
    branch: Option<String>,
    base_branch: Option<String>,
    summary: String,
    conflicts: Vec<String>,
    resolution_steps: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct OtlpExport {
    resource_spans: Vec<OtlpResourceSpans>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct OtlpResourceSpans {
    resource: OtlpResource,
    scope_spans: Vec<OtlpScopeSpans>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct OtlpResource {
    attributes: Vec<OtlpKeyValue>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct OtlpScopeSpans {
    scope: OtlpInstrumentationScope,
    spans: Vec<OtlpSpan>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct OtlpInstrumentationScope {
    name: String,
    version: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct OtlpSpan {
    trace_id: String,
    span_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    parent_span_id: Option<String>,
    name: String,
    kind: String,
    start_time_unix_nano: String,
    end_time_unix_nano: String,
    attributes: Vec<OtlpKeyValue>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    links: Vec<OtlpSpanLink>,
    status: OtlpSpanStatus,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct OtlpSpanLink {
    trace_id: String,
    span_id: String,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    attributes: Vec<OtlpKeyValue>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct OtlpSpanStatus {
    code: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct OtlpKeyValue {
    key: String,
    value: OtlpAnyValue,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct OtlpAnyValue {
    #[serde(skip_serializing_if = "Option::is_none")]
    string_value: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    int_value: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    double_value: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    bool_value: Option<bool>,
}

fn build_worktree_status_report(
    session: &session::Session,
    include_patch: bool,
) -> Result<WorktreeStatusReport> {
    let Some(worktree) = session.worktree.as_ref() else {
        return Ok(WorktreeStatusReport {
            session_id: session.id.clone(),
            task: session.task.clone(),
            session_state: session.state.to_string(),
            health: "clear".to_string(),
            check_exit_code: 0,
            patch_included: include_patch,
            attached: false,
            path: None,
            branch: None,
            base_branch: None,
            diff_summary: None,
            file_preview: Vec::new(),
            patch_preview: None,
            merge_readiness: None,
        });
    };

    let diff_summary = worktree::diff_summary(worktree)?;
    let file_preview = worktree::diff_file_preview(worktree, 8)?;
    let patch_preview = if include_patch {
        worktree::diff_patch_preview(worktree, 80)?
    } else {
        None
    };
    let merge_readiness = worktree::merge_readiness(worktree)?;
    let worktree_health = worktree::health(worktree)?;
    let (health, check_exit_code) = match worktree_health {
        worktree::WorktreeHealth::Conflicted => ("conflicted".to_string(), 2),
        worktree::WorktreeHealth::Clear => ("clear".to_string(), 0),
        worktree::WorktreeHealth::InProgress => ("in_progress".to_string(), 1),
    };

    Ok(WorktreeStatusReport {
        session_id: session.id.clone(),
        task: session.task.clone(),
        session_state: session.state.to_string(),
        health,
        check_exit_code,
        patch_included: include_patch,
        attached: true,
        path: Some(worktree.path.display().to_string()),
        branch: Some(worktree.branch.clone()),
        base_branch: Some(worktree.base_branch.clone()),
        diff_summary,
        file_preview,
        patch_preview,
        merge_readiness: Some(WorktreeMergeReadinessReport {
            status: match merge_readiness.status {
                worktree::MergeReadinessStatus::Ready => "ready".to_string(),
                worktree::MergeReadinessStatus::Conflicted => "conflicted".to_string(),
            },
            summary: merge_readiness.summary,
            conflicts: merge_readiness.conflicts,
        }),
    })
}

fn build_worktree_resolution_report(
    session: &session::Session,
) -> Result<WorktreeResolutionReport> {
    let Some(worktree) = session.worktree.as_ref() else {
        return Ok(WorktreeResolutionReport {
            session_id: session.id.clone(),
            task: session.task.clone(),
            session_state: session.state.to_string(),
            attached: false,
            conflicted: false,
            check_exit_code: 0,
            path: None,
            branch: None,
            base_branch: None,
            summary: "No worktree attached".to_string(),
            conflicts: Vec::new(),
            resolution_steps: Vec::new(),
        });
    };

    let merge_readiness = worktree::merge_readiness(worktree)?;
    let conflicted = merge_readiness.status == worktree::MergeReadinessStatus::Conflicted;
    let resolution_steps = if conflicted {
        vec![
            format!(
                "Inspect current patch: ecc worktree-status {} --patch",
                session.id
            ),
            format!("Open worktree: cd {}", worktree.path.display()),
            "Resolve conflicts and stage files: git add <paths>".to_string(),
            format!("Commit the resolution on {}: git commit", worktree.branch),
            format!(
                "Re-check readiness: ecc worktree-status {} --check",
                session.id
            ),
            format!("Merge when clear: ecc merge-worktree {}", session.id),
        ]
    } else {
        Vec::new()
    };

    Ok(WorktreeResolutionReport {
        session_id: session.id.clone(),
        task: session.task.clone(),
        session_state: session.state.to_string(),
        attached: true,
        conflicted,
        check_exit_code: if conflicted { 2 } else { 0 },
        path: Some(worktree.path.display().to_string()),
        branch: Some(worktree.branch.clone()),
        base_branch: Some(worktree.base_branch.clone()),
        summary: merge_readiness.summary,
        conflicts: merge_readiness.conflicts,
        resolution_steps,
    })
}

fn format_worktree_status_human(report: &WorktreeStatusReport) -> String {
    let mut lines = vec![format!(
        "Worktree status for {} [{}]",
        short_session(&report.session_id),
        report.session_state
    )];
    lines.push(format!("Task {}", report.task));
    lines.push(format!("Health {}", report.health));

    if !report.attached {
        lines.push("No worktree attached".to_string());
        return lines.join("\n");
    }

    if let Some(path) = report.path.as_ref() {
        lines.push(format!("Path {path}"));
    }
    if let (Some(branch), Some(base_branch)) = (report.branch.as_ref(), report.base_branch.as_ref())
    {
        lines.push(format!("Branch {branch} (base {base_branch})"));
    }
    if let Some(diff_summary) = report.diff_summary.as_ref() {
        lines.push(diff_summary.clone());
    }
    if !report.file_preview.is_empty() {
        lines.push("Files".to_string());
        for entry in &report.file_preview {
            lines.push(format!("- {entry}"));
        }
    }
    if let Some(merge_readiness) = report.merge_readiness.as_ref() {
        lines.push(merge_readiness.summary.clone());
        for conflict in merge_readiness.conflicts.iter().take(5) {
            lines.push(format!("- conflict {conflict}"));
        }
    }
    if report.patch_included {
        if let Some(patch_preview) = report.patch_preview.as_ref() {
            lines.push("Patch preview".to_string());
            lines.push(patch_preview.clone());
        } else {
            lines.push("Patch preview unavailable".to_string());
        }
    }

    lines.join("\n")
}

fn format_worktree_status_reports_human(reports: &[WorktreeStatusReport]) -> String {
    reports
        .iter()
        .map(format_worktree_status_human)
        .collect::<Vec<_>>()
        .join("\n\n")
}

fn format_worktree_resolution_human(report: &WorktreeResolutionReport) -> String {
    let mut lines = vec![format!(
        "Worktree resolution for {} [{}]",
        short_session(&report.session_id),
        report.session_state
    )];
    lines.push(format!("Task {}", report.task));

    if !report.attached {
        lines.push(report.summary.clone());
        return lines.join("\n");
    }

    if let Some(path) = report.path.as_ref() {
        lines.push(format!("Path {path}"));
    }
    if let (Some(branch), Some(base_branch)) = (report.branch.as_ref(), report.base_branch.as_ref())
    {
        lines.push(format!("Branch {branch} (base {base_branch})"));
    }
    lines.push(report.summary.clone());

    if !report.conflicts.is_empty() {
        lines.push("Conflicts".to_string());
        for conflict in &report.conflicts {
            lines.push(format!("- {conflict}"));
        }
    }

    if report.resolution_steps.is_empty() {
        lines.push("No conflict-resolution steps required".to_string());
    } else {
        lines.push("Resolution steps".to_string());
        for (index, step) in report.resolution_steps.iter().enumerate() {
            lines.push(format!("{}. {step}", index + 1));
        }
    }

    lines.join("\n")
}

fn format_worktree_resolution_reports_human(reports: &[WorktreeResolutionReport]) -> String {
    if reports.is_empty() {
        return "No conflicted worktrees found".to_string();
    }

    reports
        .iter()
        .map(format_worktree_resolution_human)
        .collect::<Vec<_>>()
        .join("\n\n")
}

fn format_worktree_merge_human(outcome: &session::manager::WorktreeMergeOutcome) -> String {
    let mut lines = vec![format!(
        "Merged worktree for {}",
        short_session(&outcome.session_id)
    )];
    lines.push(format!(
        "Branch {} -> {}",
        outcome.branch, outcome.base_branch
    ));
    lines.push(if outcome.already_up_to_date {
        "Result already up to date".to_string()
    } else {
        "Result merged into base".to_string()
    });
    lines.push(if outcome.cleaned_worktree {
        "Cleanup removed worktree and branch".to_string()
    } else {
        "Cleanup kept worktree attached".to_string()
    });
    lines.join("\n")
}

fn format_bulk_worktree_merge_human(
    outcome: &session::manager::WorktreeBulkMergeOutcome,
) -> String {
    let mut lines = Vec::new();
    lines.push(format!("Merged {} ready worktree(s)", outcome.merged.len()));

    for merged in &outcome.merged {
        lines.push(format!(
            "- merged {} -> {} for {}{}",
            merged.branch,
            merged.base_branch,
            short_session(&merged.session_id),
            if merged.already_up_to_date {
                " (already up to date)"
            } else {
                ""
            }
        ));
    }

    if !outcome.rebased.is_empty() {
        lines.push(format!(
            "Rebased {} blocked worktree(s) onto their base branch",
            outcome.rebased.len()
        ));
        for rebased in &outcome.rebased {
            lines.push(format!(
                "- rebased {} onto {} for {}{}",
                rebased.branch,
                rebased.base_branch,
                short_session(&rebased.session_id),
                if rebased.already_up_to_date {
                    " (already up to date)"
                } else {
                    ""
                }
            ));
        }
    }

    if !outcome.active_with_worktree_ids.is_empty() {
        lines.push(format!(
            "Skipped {} active worktree session(s)",
            outcome.active_with_worktree_ids.len()
        ));
    }
    if !outcome.conflicted_session_ids.is_empty() {
        lines.push(format!(
            "Skipped {} conflicted worktree(s)",
            outcome.conflicted_session_ids.len()
        ));
    }
    if !outcome.dirty_worktree_ids.is_empty() {
        lines.push(format!(
            "Skipped {} dirty worktree(s)",
            outcome.dirty_worktree_ids.len()
        ));
    }
    if !outcome.blocked_by_queue_session_ids.is_empty() {
        lines.push(format!(
            "Blocked {} worktree(s) on remaining queue conflicts",
            outcome.blocked_by_queue_session_ids.len()
        ));
    }
    if !outcome.failures.is_empty() {
        lines.push(format!(
            "Encountered {} merge failure(s)",
            outcome.failures.len()
        ));
        for failure in &outcome.failures {
            lines.push(format!(
                "- failed {}: {}",
                short_session(&failure.session_id),
                failure.reason
            ));
        }
    }

    lines.join("\n")
}

fn worktree_status_exit_code(report: &WorktreeStatusReport) -> i32 {
    report.check_exit_code
}

fn worktree_status_reports_exit_code(reports: &[WorktreeStatusReport]) -> i32 {
    reports
        .iter()
        .map(worktree_status_exit_code)
        .max()
        .unwrap_or(0)
}

fn worktree_resolution_reports_exit_code(reports: &[WorktreeResolutionReport]) -> i32 {
    reports
        .iter()
        .map(|report| report.check_exit_code)
        .max()
        .unwrap_or(0)
}

fn format_prune_worktrees_human(outcome: &session::manager::WorktreePruneOutcome) -> String {
    let mut lines = Vec::new();

    if outcome.cleaned_session_ids.is_empty() {
        lines.push("Pruned 0 inactive worktree(s)".to_string());
    } else {
        lines.push(format!(
            "Pruned {} inactive worktree(s)",
            outcome.cleaned_session_ids.len()
        ));
        for session_id in &outcome.cleaned_session_ids {
            lines.push(format!("- cleaned {}", short_session(session_id)));
        }
    }

    if outcome.active_with_worktree_ids.is_empty() {
        lines.push("No active sessions are holding worktrees".to_string());
    } else {
        lines.push(format!(
            "Skipped {} active session(s) still holding worktrees",
            outcome.active_with_worktree_ids.len()
        ));
        for session_id in &outcome.active_with_worktree_ids {
            lines.push(format!("- active {}", short_session(session_id)));
        }
    }

    if outcome.retained_session_ids.is_empty() {
        lines.push("No inactive worktrees are being retained".to_string());
    } else {
        lines.push(format!(
            "Deferred {} inactive worktree(s) still within retention",
            outcome.retained_session_ids.len()
        ));
        for session_id in &outcome.retained_session_ids {
            lines.push(format!("- retained {}", short_session(session_id)));
        }
    }

    lines.join("\n")
}

fn format_logged_decision_human(entry: &session::DecisionLogEntry) -> String {
    let mut lines = vec![
        format!("Logged decision for {}", short_session(&entry.session_id)),
        format!("Decision: {}", entry.decision),
        format!("Why: {}", entry.reasoning),
    ];

    if entry.alternatives.is_empty() {
        lines.push("Alternatives: none recorded".to_string());
    } else {
        lines.push("Alternatives:".to_string());
        for alternative in &entry.alternatives {
            lines.push(format!("- {alternative}"));
        }
    }

    lines.push(format!(
        "Recorded at: {}",
        entry.timestamp.format("%Y-%m-%d %H:%M:%S UTC")
    ));
    lines.join("\n")
}

fn format_decisions_human(entries: &[session::DecisionLogEntry], include_session: bool) -> String {
    if entries.is_empty() {
        return if include_session {
            "No decision-log entries across all sessions yet.".to_string()
        } else {
            "No decision-log entries for this session yet.".to_string()
        };
    }

    let mut lines = vec![format!("Decision log: {} entries", entries.len())];
    for entry in entries {
        let prefix = if include_session {
            format!("{} | ", short_session(&entry.session_id))
        } else {
            String::new()
        };
        lines.push(format!(
            "- [{}] {prefix}{}",
            entry.timestamp.format("%H:%M:%S"),
            entry.decision
        ));
        lines.push(format!("  why {}", entry.reasoning));
        if entry.alternatives.is_empty() {
            lines.push("  alternatives none recorded".to_string());
        } else {
            for alternative in &entry.alternatives {
                lines.push(format!("  alternative {alternative}"));
            }
        }
    }

    lines.join("\n")
}

fn format_graph_entity_human(entity: &session::ContextGraphEntity) -> String {
    let mut lines = vec![
        format!("Context graph entity #{}", entity.id),
        format!("Type: {}", entity.entity_type),
        format!("Name: {}", entity.name),
    ];
    if let Some(path) = &entity.path {
        lines.push(format!("Path: {path}"));
    }
    if let Some(session_id) = &entity.session_id {
        lines.push(format!("Session: {}", short_session(session_id)));
    }
    if entity.summary.is_empty() {
        lines.push("Summary: none recorded".to_string());
    } else {
        lines.push(format!("Summary: {}", entity.summary));
    }
    if entity.metadata.is_empty() {
        lines.push("Metadata: none recorded".to_string());
    } else {
        lines.push("Metadata:".to_string());
        for (key, value) in &entity.metadata {
            lines.push(format!("- {key}={value}"));
        }
    }
    lines.push(format!(
        "Updated: {}",
        entity.updated_at.format("%Y-%m-%d %H:%M:%S UTC")
    ));
    lines.join("\n")
}

fn format_graph_entities_human(
    entities: &[session::ContextGraphEntity],
    include_session: bool,
) -> String {
    if entities.is_empty() {
        return "No context graph entities found.".to_string();
    }

    let mut lines = vec![format!("Context graph entities: {}", entities.len())];
    for entity in entities {
        let mut line = format!("- #{} [{}] {}", entity.id, entity.entity_type, entity.name);
        if include_session {
            line.push_str(&format!(
                " | {}",
                entity
                    .session_id
                    .as_deref()
                    .map(short_session)
                    .unwrap_or_else(|| "global".to_string())
            ));
        }
        if let Some(path) = &entity.path {
            line.push_str(&format!(" | {path}"));
        }
        lines.push(line);
        if !entity.summary.is_empty() {
            lines.push(format!("  summary {}", entity.summary));
        }
    }

    lines.join("\n")
}

fn format_graph_relation_human(relation: &session::ContextGraphRelation) -> String {
    let mut lines = vec![
        format!("Context graph relation #{}", relation.id),
        format!(
            "Edge: #{} [{}] {} -> #{} [{}] {}",
            relation.from_entity_id,
            relation.from_entity_type,
            relation.from_entity_name,
            relation.to_entity_id,
            relation.to_entity_type,
            relation.to_entity_name
        ),
        format!("Relation: {}", relation.relation_type),
    ];
    if let Some(session_id) = &relation.session_id {
        lines.push(format!("Session: {}", short_session(session_id)));
    }
    if relation.summary.is_empty() {
        lines.push("Summary: none recorded".to_string());
    } else {
        lines.push(format!("Summary: {}", relation.summary));
    }
    lines.push(format!(
        "Created: {}",
        relation.created_at.format("%Y-%m-%d %H:%M:%S UTC")
    ));
    lines.join("\n")
}

fn format_graph_relations_human(relations: &[session::ContextGraphRelation]) -> String {
    if relations.is_empty() {
        return "No context graph relations found.".to_string();
    }

    let mut lines = vec![format!("Context graph relations: {}", relations.len())];
    for relation in relations {
        lines.push(format!(
            "- #{} {} -> {} [{}]",
            relation.id, relation.from_entity_name, relation.to_entity_name, relation.relation_type
        ));
        if !relation.summary.is_empty() {
            lines.push(format!("  summary {}", relation.summary));
        }
    }
    lines.join("\n")
}

fn format_graph_observation_human(observation: &session::ContextGraphObservation) -> String {
    let mut lines = vec![
        format!("Context graph observation #{}", observation.id),
        format!(
            "Entity: #{} [{}] {}",
            observation.entity_id, observation.entity_type, observation.entity_name
        ),
        format!("Type: {}", observation.observation_type),
        format!("Priority: {}", observation.priority),
        format!("Pinned: {}", if observation.pinned { "yes" } else { "no" }),
        format!("Summary: {}", observation.summary),
    ];
    if let Some(session_id) = observation.session_id.as_deref() {
        lines.push(format!("Session: {}", short_session(session_id)));
    }
    if observation.details.is_empty() {
        lines.push("Details: none recorded".to_string());
    } else {
        lines.push("Details:".to_string());
        for (key, value) in &observation.details {
            lines.push(format!("- {key}={value}"));
        }
    }
    lines.push(format!(
        "Created: {}",
        observation.created_at.format("%Y-%m-%d %H:%M:%S UTC")
    ));
    lines.join("\n")
}

fn format_graph_observations_human(observations: &[session::ContextGraphObservation]) -> String {
    if observations.is_empty() {
        return "No context graph observations found.".to_string();
    }

    let mut lines = vec![format!(
        "Context graph observations: {}",
        observations.len()
    )];
    for observation in observations {
        let mut line = format!(
            "- #{} [{}/{}{}] {}",
            observation.id,
            observation.observation_type,
            observation.priority,
            if observation.pinned { "/pinned" } else { "" },
            observation.entity_name
        );
        if let Some(session_id) = observation.session_id.as_deref() {
            line.push_str(&format!(" | {}", short_session(session_id)));
        }
        lines.push(line);
        lines.push(format!("  summary {}", observation.summary));
    }

    lines.join("\n")
}

fn build_legacy_migration_audit_report(source: &Path) -> Result<LegacyMigrationAuditReport> {
    let source = source
        .canonicalize()
        .with_context(|| format!("Legacy workspace not found: {}", source.display()))?;
    if !source.is_dir() {
        anyhow::bail!(
            "Legacy workspace source must be a directory: {}",
            source.display()
        );
    }

    let mut artifacts = Vec::new();

    let scheduler_paths = collect_existing_relative_paths(
        &source,
        &["cron/scheduler.py", "jobs.py", "cron/jobs.json"],
    );
    if !scheduler_paths.is_empty() {
        artifacts.push(LegacyMigrationArtifact {
            category: "scheduler".to_string(),
            readiness: LegacyMigrationReadiness::ReadyNow,
            detected_items: scheduler_paths.len(),
            source_paths: scheduler_paths,
            mapping: vec![
                "ecc schedule add".to_string(),
                "ecc schedule list".to_string(),
                "ecc schedule run-due".to_string(),
                "ecc daemon".to_string(),
            ],
            notes: vec![
                "Recurring jobs can be recreated directly in ECC2's persistent scheduler."
                    .to_string(),
                "Translate each legacy cron prompt into an explicit ECC task body before enabling it."
                    .to_string(),
            ],
        });
    }

    let gateway_dir = source.join("gateway");
    if gateway_dir.is_dir() {
        artifacts.push(LegacyMigrationArtifact {
            category: "gateway_dispatch".to_string(),
            readiness: LegacyMigrationReadiness::ReadyNow,
            detected_items: count_files_recursive(&gateway_dir)?,
            source_paths: vec!["gateway".to_string()],
            mapping: vec![
                "ecc remote serve".to_string(),
                "ecc remote add".to_string(),
                "ecc remote computer-use".to_string(),
                "ecc remote run".to_string(),
            ],
            notes: vec![
                "ECC2 already ships a token-authenticated remote dispatch queue and HTTP intake."
                    .to_string(),
                "Remote handlers should be translated to ECC task bodies instead of copied verbatim."
                    .to_string(),
            ],
        });
    }

    let memory_paths = collect_existing_relative_paths(&source, &["memory_tool.py"]);
    if !memory_paths.is_empty() {
        artifacts.push(LegacyMigrationArtifact {
            category: "memory_tool".to_string(),
            readiness: LegacyMigrationReadiness::ReadyNow,
            detected_items: memory_paths.len(),
            source_paths: memory_paths,
            mapping: vec![
                "ecc graph add-observation".to_string(),
                "ecc graph connector-sync".to_string(),
                "ecc graph recall".to_string(),
                "ecc graph connectors".to_string(),
            ],
            notes: vec![
                "ECC2 deep memory now supports persistent observations, recall, compaction, and external connectors."
                    .to_string(),
            ],
        });
    }

    let workspace_dir = source.join("workspace");
    if workspace_dir.is_dir() {
        artifacts.push(LegacyMigrationArtifact {
            category: "workspace_memory".to_string(),
            readiness: LegacyMigrationReadiness::ReadyNow,
            detected_items: count_files_recursive(&workspace_dir)?,
            source_paths: vec!["workspace".to_string()],
            mapping: vec![
                "ecc graph connector-sync".to_string(),
                "ecc graph recall".to_string(),
                "WORKING-CONTEXT.md".to_string(),
            ],
            notes: vec![
                "Import only sanitized operator memory into the shared context graph."
                    .to_string(),
                "Private business data, secrets, and personal archives should stay outside the public repo."
                    .to_string(),
            ],
        });
    }

    let skills_paths = collect_existing_relative_paths(&source, &["skills", "skills/ecc-imports"]);
    if !skills_paths.is_empty() {
        artifacts.push(LegacyMigrationArtifact {
            category: "skills".to_string(),
            readiness: LegacyMigrationReadiness::ManualTranslation,
            detected_items: count_files_recursive(&source.join("skills"))?,
            source_paths: skills_paths,
            mapping: vec![
                "skills/".to_string(),
                "ecc template".to_string(),
                "configure-ecc".to_string(),
            ],
            notes: vec![
                "Reusable skills should be ported one by one into ECC-native skills or orchestration templates."
                    .to_string(),
                "Do not bulk-copy legacy private skills without auditing for secrets and operator-only assumptions."
                    .to_string(),
            ],
        });
    }

    let tools_dir = source.join("tools");
    if tools_dir.is_dir() {
        artifacts.push(LegacyMigrationArtifact {
            category: "tools".to_string(),
            readiness: LegacyMigrationReadiness::ManualTranslation,
            detected_items: count_files_recursive(&tools_dir)?,
            source_paths: vec!["tools".to_string()],
            mapping: vec![
                "agents/".to_string(),
                "commands/".to_string(),
                "hooks/".to_string(),
                "harness_runners.<name>".to_string(),
            ],
            notes: vec![
                "Legacy tool wrappers should be rebuilt as ECC agents, commands, hooks, or configured harness runners."
                    .to_string(),
                "Only the reusable workflow surface should move across; opaque runtime glue should be reimplemented minimally."
                    .to_string(),
            ],
        });
    }

    let plugins_dir = source.join("plugins");
    if plugins_dir.is_dir() {
        artifacts.push(LegacyMigrationArtifact {
            category: "plugins".to_string(),
            readiness: LegacyMigrationReadiness::ManualTranslation,
            detected_items: count_files_recursive(&plugins_dir)?,
            source_paths: vec!["plugins".to_string()],
            mapping: vec![
                "hooks/".to_string(),
                "commands/".to_string(),
                "skills/".to_string(),
            ],
            notes: vec![
                "Bridge plugins normally translate into ECC hooks, commands, or skills instead of one-for-one plugin copies."
                    .to_string(),
            ],
        });
    }

    let env_service_paths = collect_env_service_paths(&source)?;
    if !env_service_paths.is_empty() {
        artifacts.push(LegacyMigrationArtifact {
            category: "env_services".to_string(),
            readiness: LegacyMigrationReadiness::LocalAuthRequired,
            detected_items: env_service_paths.len(),
            source_paths: env_service_paths,
            mapping: vec![
                "Claude connectors / OAuth".to_string(),
                "MCP config".to_string(),
                "local API key setup".to_string(),
            ],
            notes: vec![
                "Secret material should not be imported into ECC2."
                    .to_string(),
                "Re-enter credentials locally through connectors, OAuth, MCP servers, or local env configuration."
                    .to_string(),
            ],
        });
    }

    let summary = LegacyMigrationAuditSummary {
        artifact_categories_detected: artifacts.len(),
        ready_now_categories: artifacts
            .iter()
            .filter(|artifact| artifact.readiness == LegacyMigrationReadiness::ReadyNow)
            .count(),
        manual_translation_categories: artifacts
            .iter()
            .filter(|artifact| artifact.readiness == LegacyMigrationReadiness::ManualTranslation)
            .count(),
        local_auth_required_categories: artifacts
            .iter()
            .filter(|artifact| artifact.readiness == LegacyMigrationReadiness::LocalAuthRequired)
            .count(),
    };

    Ok(LegacyMigrationAuditReport {
        source: source.display().to_string(),
        detected_systems: detect_legacy_workspace_systems(&source, &artifacts),
        summary,
        recommended_next_steps: build_legacy_migration_next_steps(&artifacts),
        artifacts,
    })
}

fn collect_existing_relative_paths(source: &Path, relative_paths: &[&str]) -> Vec<String> {
    let mut matches = Vec::new();
    for relative_path in relative_paths {
        if source.join(relative_path).exists() {
            matches.push((*relative_path).to_string());
        }
    }
    matches
}

fn collect_env_service_paths(source: &Path) -> Result<Vec<String>> {
    let mut matches = Vec::new();
    for file_name in [
        "config.yaml",
        ".env",
        ".env.local",
        ".env.production",
        ".envrc",
    ] {
        if source.join(file_name).is_file() {
            matches.push(file_name.to_string());
        }
    }

    let services_dir = source.join("services");
    if services_dir.is_dir() {
        let service_file_count = count_files_recursive(&services_dir)?;
        if service_file_count > 0 {
            matches.push("services".to_string());
        }
    }

    Ok(matches)
}

fn count_files_recursive(path: &Path) -> Result<usize> {
    if !path.exists() {
        return Ok(0);
    }
    if path.is_file() {
        return Ok(1);
    }

    let mut total = 0usize;
    for entry in fs::read_dir(path)? {
        let entry = entry?;
        let entry_path = entry.path();
        total += count_files_recursive(&entry_path)?;
    }
    Ok(total)
}

fn detect_legacy_workspace_systems(
    source: &Path,
    artifacts: &[LegacyMigrationArtifact],
) -> Vec<String> {
    let mut detected = BTreeSet::new();
    let display = source.display().to_string().to_lowercase();
    if display.contains("hermes")
        || source.join("config.yaml").is_file()
        || source.join("cron").exists()
        || source.join("workspace").exists()
    {
        detected.insert("hermes".to_string());
    }
    if display.contains("openclaw") || source.join(".openclaw").exists() {
        detected.insert("openclaw".to_string());
    }
    if detected.is_empty() && !artifacts.is_empty() {
        detected.insert("legacy_workspace".to_string());
    }
    detected.into_iter().collect()
}

fn build_legacy_migration_next_steps(artifacts: &[LegacyMigrationArtifact]) -> Vec<String> {
    let mut steps = Vec::new();
    let categories: BTreeSet<&str> = artifacts
        .iter()
        .map(|artifact| artifact.category.as_str())
        .collect();

    if categories.contains("scheduler") {
        steps.push(
            "Recreate recurring jobs with `ecc schedule add`, verify them with `ecc schedule list`, then enable processing through `ecc daemon`."
                .to_string(),
        );
    }
    if categories.contains("gateway_dispatch") {
        steps.push(
            "Replace gateway/dispatch entrypoints with `ecc remote serve`, preview/import legacy requests with `ecc migrate import-remote`, then verify them with `ecc remote list` / `ecc remote run`."
                .to_string(),
        );
    }
    if categories.contains("memory_tool") || categories.contains("workspace_memory") {
        steps.push(
            "Import sanitized operator memory through `ecc graph connector-sync`, then use `ecc graph recall` and pinned observations for durable context."
                .to_string(),
        );
    }
    if categories.contains("skills") {
        steps.push(
            "Scaffold translated legacy skills with `ecc migrate import-skills --source <legacy-workspace> --output-dir <dir>`, then promote the reusable ones into ECC skills or orchestration templates one lane at a time instead of bulk-copying them."
                .to_string(),
        );
    }
    if categories.contains("tools") {
        steps.push(
            "Scaffold translated legacy tools with `ecc migrate import-tools --source <legacy-workspace> --output-dir <dir>`, then rebuild the valuable ones as ECC-native commands, hooks, or harness runners instead of shelling back out to the old stack."
                .to_string(),
        );
    }
    if categories.contains("plugins") {
        steps.push(
            "Scaffold translated bridge plugins with `ecc migrate import-plugins --source <legacy-workspace> --output-dir <dir>`, then port the valuable ones into ECC-native hooks, commands, or skills."
                .to_string(),
        );
    }
    if categories.contains("env_services") {
        steps.push(
            "Preview safe env/service context with `ecc migrate import-env --source <legacy-workspace> --dry-run`, then reconfigure credentials locally through Claude connectors, MCP config, OAuth, or local API key setup without importing raw secret material."
                .to_string(),
        );
    }

    if steps.is_empty() {
        steps.push(
            "No recognizable Hermes/OpenClaw migration surfaces were detected; inspect the workspace manually before attempting migration."
                .to_string(),
        );
    }

    steps
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct LegacyScheduleDraft {
    source_path: String,
    job_name: String,
    cron_expr: Option<String>,
    task: Option<String>,
    agent: Option<String>,
    profile: Option<String>,
    project: Option<String>,
    task_group: Option<String>,
    use_worktree: Option<bool>,
    enabled: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct LegacyRemoteDispatchDraft {
    source_path: String,
    request_name: String,
    request_kind: session::RemoteDispatchKind,
    task: Option<String>,
    goal: Option<String>,
    target_url: Option<String>,
    context: Option<String>,
    target_session: Option<String>,
    priority: Option<TaskPriorityArg>,
    agent: Option<String>,
    profile: Option<String>,
    project: Option<String>,
    task_group: Option<String>,
    use_worktree: Option<bool>,
    enabled: bool,
}

fn load_legacy_schedule_drafts(source: &Path) -> Result<Vec<LegacyScheduleDraft>> {
    let jobs_path = source.join("cron/jobs.json");
    if !jobs_path.is_file() {
        return Ok(Vec::new());
    }

    let text = fs::read_to_string(&jobs_path)
        .with_context(|| format!("read legacy scheduler jobs: {}", jobs_path.display()))?;
    let value: serde_json::Value = serde_json::from_str(&text)
        .with_context(|| format!("parse legacy scheduler jobs JSON: {}", jobs_path.display()))?;
    let source_path = jobs_path
        .strip_prefix(source)
        .unwrap_or(&jobs_path)
        .display()
        .to_string();

    let entries: Vec<&serde_json::Value> = match &value {
        serde_json::Value::Array(items) => items.iter().collect(),
        serde_json::Value::Object(map) => {
            if let Some(items) = ["jobs", "schedules", "tasks"]
                .iter()
                .find_map(|key| map.get(*key).and_then(serde_json::Value::as_array))
            {
                items.iter().collect()
            } else {
                vec![&value]
            }
        }
        _ => anyhow::bail!(
            "legacy scheduler jobs file must be a JSON object or array: {}",
            jobs_path.display()
        ),
    };

    Ok(entries
        .into_iter()
        .enumerate()
        .map(|(index, value)| build_legacy_schedule_draft(value, index, &source_path))
        .collect())
}

fn load_legacy_remote_dispatch_drafts(source: &Path) -> Result<Vec<LegacyRemoteDispatchDraft>> {
    let gateway_dir = source.join("gateway");
    if !gateway_dir.is_dir() {
        return Ok(Vec::new());
    }

    let mut drafts = Vec::new();
    for path in collect_json_paths(&gateway_dir, true)? {
        drafts.extend(load_legacy_remote_dispatch_json_file(source, &path)?);
    }
    for path in collect_jsonl_paths(&gateway_dir, true)? {
        drafts.extend(load_legacy_remote_dispatch_jsonl_file(source, &path)?);
    }
    Ok(drafts)
}

fn load_legacy_remote_dispatch_json_file(
    source: &Path,
    path: &Path,
) -> Result<Vec<LegacyRemoteDispatchDraft>> {
    let text = fs::read_to_string(path)
        .with_context(|| format!("read legacy remote dispatch JSON: {}", path.display()))?;
    let value: serde_json::Value = serde_json::from_str(&text)
        .with_context(|| format!("parse legacy remote dispatch JSON: {}", path.display()))?;
    let source_path = path
        .strip_prefix(source)
        .unwrap_or(path)
        .display()
        .to_string();

    let entries = extract_legacy_remote_dispatch_entries(&value);
    Ok(entries
        .into_iter()
        .enumerate()
        .map(|(index, entry)| build_legacy_remote_dispatch_draft(entry, index, &source_path))
        .collect())
}

fn load_legacy_remote_dispatch_jsonl_file(
    source: &Path,
    path: &Path,
) -> Result<Vec<LegacyRemoteDispatchDraft>> {
    let file = File::open(path)
        .with_context(|| format!("open legacy remote dispatch JSONL: {}", path.display()))?;
    let reader = BufReader::new(file);
    let source_path = path
        .strip_prefix(source)
        .unwrap_or(path)
        .display()
        .to_string();

    let mut drafts = Vec::new();
    for (index, line) in reader.lines().enumerate() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }
        let value: serde_json::Value = serde_json::from_str(&line).with_context(|| {
            format!(
                "parse legacy remote dispatch JSONL: {} line {}",
                path.display(),
                index + 1
            )
        })?;
        if !legacy_remote_dispatch_entry_is_relevant(&value) {
            continue;
        }
        drafts.push(build_legacy_remote_dispatch_draft(
            &value,
            drafts.len(),
            &source_path,
        ));
    }
    Ok(drafts)
}

fn extract_legacy_remote_dispatch_entries<'a>(
    value: &'a serde_json::Value,
) -> Vec<&'a serde_json::Value> {
    match value {
        serde_json::Value::Array(items) => items
            .iter()
            .filter(|item| legacy_remote_dispatch_entry_is_relevant(item))
            .collect(),
        serde_json::Value::Object(map) => {
            if let Some(items) = [
                "dispatches",
                "requests",
                "remote_requests",
                "tasks",
                "queue",
                "items",
            ]
            .iter()
            .find_map(|key| map.get(*key).and_then(serde_json::Value::as_array))
            {
                return items
                    .iter()
                    .filter(|item| legacy_remote_dispatch_entry_is_relevant(item))
                    .collect();
            }
            if legacy_remote_dispatch_entry_is_relevant(value) {
                vec![value]
            } else {
                Vec::new()
            }
        }
        _ => Vec::new(),
    }
}

fn legacy_remote_dispatch_entry_is_relevant(value: &serde_json::Value) -> bool {
    if json_string_candidates(
        value,
        &[
            &["task"],
            &["prompt"],
            &["description"],
            &["goal"],
            &["message"],
            &["target_url"],
            &["url"],
            &["to_session"],
            &["target_session"],
            &["lead"],
        ],
    )
    .is_some()
    {
        return true;
    }
    if json_bool_candidates(value, &[&["computer_use"], &["browser"], &["use_browser"]])
        .unwrap_or(false)
    {
        return true;
    }
    json_string_candidates(
        value,
        &[&["kind"], &["type"], &["mode"], &["dispatch_type"]],
    )
    .map(|kind| {
        matches!(
            kind.trim().to_ascii_lowercase().as_str(),
            "dispatch"
                | "remote_dispatch"
                | "remote-dispatch"
                | "task"
                | "computer_use"
                | "computer-use"
                | "computer use"
                | "browser"
                | "browser_task"
                | "operator_browser"
        )
    })
    .unwrap_or(false)
}

fn build_legacy_remote_dispatch_draft(
    value: &serde_json::Value,
    index: usize,
    source_path: &str,
) -> LegacyRemoteDispatchDraft {
    let request_name = json_string_candidates(
        value,
        &[
            &["name"],
            &["id"],
            &["title"],
            &["label"],
            &["request_name"],
        ],
    )
    .unwrap_or_else(|| format!("legacy-remote-request-{}", index + 1));
    let request_kind = detect_legacy_remote_dispatch_kind(value);
    let body_text = json_string_candidates(
        value,
        &[
            &["task"],
            &["prompt"],
            &["description"],
            &["goal"],
            &["message"],
            &["instructions"],
        ],
    );
    let enabled = !json_bool_candidates(value, &[&["disabled"]]).unwrap_or(false)
        && json_bool_candidates(value, &[&["enabled"], &["active"]]).unwrap_or(true);

    LegacyRemoteDispatchDraft {
        source_path: source_path.to_string(),
        request_name,
        request_kind,
        task: (request_kind == session::RemoteDispatchKind::Standard)
            .then(|| body_text.clone())
            .flatten(),
        goal: (request_kind == session::RemoteDispatchKind::ComputerUse)
            .then_some(body_text)
            .flatten(),
        target_url: json_string_candidates(
            value,
            &[
                &["target_url"],
                &["url"],
                &["start_url"],
                &["browser", "url"],
            ],
        ),
        context: json_string_candidates(
            value,
            &[
                &["context"],
                &["notes"],
                &["details"],
                &["browser_context"],
                &["extra_context"],
            ],
        ),
        target_session: json_string_candidates(
            value,
            &[
                &["to_session"],
                &["target_session"],
                &["target_session_id"],
                &["session"],
                &["lead"],
                &["to"],
            ],
        ),
        priority: json_task_priority_candidates(value, &[&["priority"], &["task", "priority"]]),
        agent: json_string_candidates(value, &[&["agent"], &["runner"]]),
        profile: json_string_candidates(value, &[&["profile"], &["agent_profile"]]),
        project: json_string_candidates(value, &[&["project"]]),
        task_group: json_string_candidates(value, &[&["task_group"], &["group"]]),
        use_worktree: json_bool_candidates(value, &[&["use_worktree"], &["worktree"]]),
        enabled,
    }
}

fn detect_legacy_remote_dispatch_kind(value: &serde_json::Value) -> session::RemoteDispatchKind {
    if json_bool_candidates(value, &[&["computer_use"], &["browser"], &["use_browser"]])
        .unwrap_or(false)
    {
        return session::RemoteDispatchKind::ComputerUse;
    }
    if json_string_candidates(
        value,
        &[
            &["target_url"],
            &["url"],
            &["start_url"],
            &["browser", "url"],
        ],
    )
    .is_some()
    {
        return session::RemoteDispatchKind::ComputerUse;
    }
    if let Some(kind) = json_string_candidates(
        value,
        &[&["kind"], &["type"], &["mode"], &["dispatch_type"]],
    ) {
        let normalized = kind.trim().to_ascii_lowercase();
        if matches!(
            normalized.as_str(),
            "computer_use"
                | "computer-use"
                | "computer use"
                | "browser"
                | "browser_task"
                | "operator_browser"
        ) {
            return session::RemoteDispatchKind::ComputerUse;
        }
    }
    session::RemoteDispatchKind::Standard
}

fn build_legacy_schedule_draft(
    value: &serde_json::Value,
    index: usize,
    source_path: &str,
) -> LegacyScheduleDraft {
    let job_name = json_string_candidates(
        value,
        &[
            &["name"],
            &["id"],
            &["title"],
            &["job_name"],
            &["task_name"],
        ],
    )
    .unwrap_or_else(|| format!("legacy-job-{}", index + 1));
    let cron_expr = json_string_candidates(
        value,
        &[
            &["cron"],
            &["schedule"],
            &["cron_expr"],
            &["trigger", "cron"],
            &["timing", "cron"],
        ],
    );
    let task = json_string_candidates(
        value,
        &[
            &["task"],
            &["prompt"],
            &["goal"],
            &["description"],
            &["command"],
            &["task", "prompt"],
            &["task", "description"],
        ],
    );
    let enabled = !json_bool_candidates(value, &[&["disabled"]]).unwrap_or(false)
        && json_bool_candidates(value, &[&["enabled"], &["active"]]).unwrap_or(true);

    LegacyScheduleDraft {
        source_path: source_path.to_string(),
        job_name,
        cron_expr,
        task,
        agent: json_string_candidates(value, &[&["agent"], &["runner"]]),
        profile: json_string_candidates(value, &[&["profile"], &["agent_profile"]]),
        project: json_string_candidates(value, &[&["project"]]),
        task_group: json_string_candidates(value, &[&["task_group"], &["group"]]),
        use_worktree: json_bool_candidates(value, &[&["use_worktree"], &["worktree"]]),
        enabled,
    }
}

fn json_string_candidates(value: &serde_json::Value, paths: &[&[&str]]) -> Option<String> {
    paths
        .iter()
        .find_map(|path| json_lookup(value, path))
        .and_then(json_to_string)
}

fn json_bool_candidates(value: &serde_json::Value, paths: &[&[&str]]) -> Option<bool> {
    paths.iter().find_map(|path| {
        json_lookup(value, path).and_then(|value| match value {
            serde_json::Value::Bool(boolean) => Some(*boolean),
            serde_json::Value::String(text) => match text.trim().to_ascii_lowercase().as_str() {
                "true" | "1" | "yes" | "on" => Some(true),
                "false" | "0" | "no" | "off" => Some(false),
                _ => None,
            },
            _ => None,
        })
    })
}

fn json_task_priority_candidates(
    value: &serde_json::Value,
    paths: &[&[&str]],
) -> Option<TaskPriorityArg> {
    paths.iter().find_map(|path| {
        json_lookup(value, path).and_then(|value| match value {
            serde_json::Value::String(text) => match text.trim().to_ascii_lowercase().as_str() {
                "low" | "p3" => Some(TaskPriorityArg::Low),
                "normal" | "medium" | "default" => Some(TaskPriorityArg::Normal),
                "high" | "urgent" | "p2" | "p1" => Some(TaskPriorityArg::High),
                "critical" | "crit" | "p0" => Some(TaskPriorityArg::Critical),
                _ => None,
            },
            serde_json::Value::Number(number) => number.as_i64().and_then(|value| match value {
                0 => Some(TaskPriorityArg::Low),
                1 => Some(TaskPriorityArg::Normal),
                2 => Some(TaskPriorityArg::High),
                3 => Some(TaskPriorityArg::Critical),
                _ => None,
            }),
            _ => None,
        })
    })
}

fn format_task_priority_arg(priority: TaskPriorityArg) -> &'static str {
    match priority {
        TaskPriorityArg::Low => "low",
        TaskPriorityArg::Normal => "normal",
        TaskPriorityArg::High => "high",
        TaskPriorityArg::Critical => "critical",
    }
}

fn json_lookup<'a>(value: &'a serde_json::Value, path: &[&str]) -> Option<&'a serde_json::Value> {
    let mut current = value;
    for segment in path {
        current = current.get(*segment)?;
    }
    Some(current)
}

fn json_to_string(value: &serde_json::Value) -> Option<String> {
    match value {
        serde_json::Value::String(text) => {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        }
        serde_json::Value::Number(number) => Some(number.to_string()),
        _ => None,
    }
}

fn shell_quote_double(value: &str) -> String {
    format!(
        "\"{}\"",
        value
            .replace('\\', "\\\\")
            .replace('"', "\\\"")
            .replace('\n', "\\n")
    )
}

fn validate_schedule_cron_expr(expr: &str) -> Result<()> {
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
    <cron::Schedule as std::str::FromStr>::from_str(&normalized)
        .with_context(|| format!("invalid cron expression `{trimmed}`"))?;
    Ok(())
}

fn build_legacy_schedule_add_command(draft: &LegacyScheduleDraft) -> Option<String> {
    let cron_expr = draft.cron_expr.as_deref()?;
    let task = draft.task.as_deref()?;
    let mut parts = vec![
        "ecc schedule add".to_string(),
        format!("--cron {}", shell_quote_double(cron_expr)),
        format!("--task {}", shell_quote_double(task)),
    ];
    if let Some(agent) = draft.agent.as_deref() {
        parts.push(format!("--agent {}", shell_quote_double(agent)));
    }
    if let Some(profile) = draft.profile.as_deref() {
        parts.push(format!("--profile {}", shell_quote_double(profile)));
    }
    match draft.use_worktree {
        Some(true) => parts.push("--worktree".to_string()),
        Some(false) => parts.push("--no-worktree".to_string()),
        None => {}
    }
    if let Some(project) = draft.project.as_deref() {
        parts.push(format!("--project {}", shell_quote_double(project)));
    }
    if let Some(task_group) = draft.task_group.as_deref() {
        parts.push(format!("--task-group {}", shell_quote_double(task_group)));
    }
    Some(parts.join(" "))
}

fn import_legacy_schedules(
    db: &session::store::StateStore,
    cfg: &config::Config,
    source: &Path,
    dry_run: bool,
) -> Result<LegacyScheduleImportReport> {
    let source = source
        .canonicalize()
        .with_context(|| format!("Legacy workspace not found: {}", source.display()))?;
    if !source.is_dir() {
        anyhow::bail!(
            "Legacy workspace source must be a directory: {}",
            source.display()
        );
    }

    let drafts = load_legacy_schedule_drafts(&source)?;
    let source_path = source.join("cron/jobs.json");
    let source_path = source_path
        .strip_prefix(&source)
        .unwrap_or(&source_path)
        .display()
        .to_string();

    let mut report = LegacyScheduleImportReport {
        source: source.display().to_string(),
        source_path,
        dry_run,
        jobs_detected: drafts.len(),
        ready_jobs: 0,
        imported_jobs: 0,
        disabled_jobs: 0,
        invalid_jobs: 0,
        skipped_jobs: 0,
        jobs: Vec::new(),
    };

    for draft in drafts {
        let mut item = LegacyScheduleImportJobReport {
            source_path: draft.source_path.clone(),
            job_name: draft.job_name.clone(),
            cron_expr: draft.cron_expr.clone(),
            task: draft.task.clone(),
            agent: draft.agent.clone(),
            profile: draft.profile.clone(),
            project: draft.project.clone(),
            task_group: draft.task_group.clone(),
            use_worktree: draft.use_worktree,
            status: LegacyScheduleImportJobStatus::Ready,
            reason: None,
            command_snippet: build_legacy_schedule_add_command(&draft),
            imported_schedule_id: None,
        };

        if !draft.enabled {
            item.status = LegacyScheduleImportJobStatus::Disabled;
            item.reason = Some("disabled in legacy workspace".to_string());
            report.disabled_jobs += 1;
            report.jobs.push(item);
            continue;
        }

        let cron_expr = match draft.cron_expr.as_deref() {
            Some(value) => value,
            None => {
                item.status = LegacyScheduleImportJobStatus::Invalid;
                item.reason = Some("missing cron expression".to_string());
                report.invalid_jobs += 1;
                report.jobs.push(item);
                continue;
            }
        };
        let task = match draft.task.as_deref() {
            Some(value) => value,
            None => {
                item.status = LegacyScheduleImportJobStatus::Invalid;
                item.reason = Some("missing task/prompt".to_string());
                report.invalid_jobs += 1;
                report.jobs.push(item);
                continue;
            }
        };

        if let Err(error) = validate_schedule_cron_expr(cron_expr) {
            item.status = LegacyScheduleImportJobStatus::Invalid;
            item.reason = Some(error.to_string());
            report.invalid_jobs += 1;
            report.jobs.push(item);
            continue;
        }

        if let Some(profile) = draft.profile.as_deref() {
            if let Err(error) = cfg.resolve_agent_profile(profile) {
                item.status = LegacyScheduleImportJobStatus::Skipped;
                item.reason = Some(format!("profile `{profile}` is not usable here: {error}"));
                report.skipped_jobs += 1;
                report.jobs.push(item);
                continue;
            }
        }

        report.ready_jobs += 1;
        if dry_run {
            report.jobs.push(item);
            continue;
        }

        let schedule = session::manager::create_scheduled_task(
            db,
            cfg,
            cron_expr,
            task,
            draft.agent.as_deref().unwrap_or(&cfg.default_agent),
            draft.profile.as_deref(),
            draft.use_worktree.unwrap_or(cfg.auto_create_worktrees),
            session::SessionGrouping {
                project: draft.project.clone(),
                task_group: draft.task_group.clone(),
            },
        )?;
        item.status = LegacyScheduleImportJobStatus::Imported;
        item.imported_schedule_id = Some(schedule.id);
        report.imported_jobs += 1;
        report.jobs.push(item);
    }

    Ok(report)
}

fn import_legacy_memory(
    db: &session::store::StateStore,
    cfg: &config::Config,
    source: &Path,
    limit: usize,
) -> Result<LegacyMemoryImportReport> {
    let source = source
        .canonicalize()
        .with_context(|| format!("Legacy workspace not found: {}", source.display()))?;
    if !source.is_dir() {
        anyhow::bail!(
            "Legacy workspace source must be a directory: {}",
            source.display()
        );
    }

    let mut import_cfg = cfg.clone();
    import_cfg.memory_connectors.clear();

    let workspace_dir = source.join("workspace");
    if workspace_dir.is_dir() {
        if !collect_markdown_paths(&workspace_dir, true)?.is_empty() {
            import_cfg.memory_connectors.insert(
                "legacy_workspace_markdown".to_string(),
                config::MemoryConnectorConfig::MarkdownDirectory(
                    config::MemoryConnectorMarkdownDirectoryConfig {
                        path: workspace_dir.clone(),
                        recurse: true,
                        session_id: None,
                        default_entity_type: Some("legacy_workspace_note".to_string()),
                        default_observation_type: Some("legacy_workspace_memory".to_string()),
                    },
                ),
            );
        }
        if !collect_jsonl_paths(&workspace_dir, true)?.is_empty() {
            import_cfg.memory_connectors.insert(
                "legacy_workspace_jsonl".to_string(),
                config::MemoryConnectorConfig::JsonlDirectory(
                    config::MemoryConnectorJsonlDirectoryConfig {
                        path: workspace_dir,
                        recurse: true,
                        session_id: None,
                        default_entity_type: Some("legacy_workspace_record".to_string()),
                        default_observation_type: Some("legacy_workspace_memory".to_string()),
                    },
                ),
            );
        }
    }

    let report = sync_all_memory_connectors(db, &import_cfg, limit)?;
    Ok(LegacyMemoryImportReport {
        source: source.display().to_string(),
        connectors_detected: import_cfg.memory_connectors.len(),
        report,
    })
}

fn import_legacy_env_services(
    db: &session::store::StateStore,
    source: &Path,
    dry_run: bool,
    limit: usize,
) -> Result<LegacyEnvImportReport> {
    let source = source
        .canonicalize()
        .with_context(|| format!("Legacy workspace not found: {}", source.display()))?;
    if !source.is_dir() {
        anyhow::bail!(
            "Legacy workspace source must be a directory: {}",
            source.display()
        );
    }

    let env_service_paths = collect_env_service_paths(&source)?;
    let mut report = LegacyEnvImportReport {
        source: source.display().to_string(),
        dry_run,
        importable_sources: 0,
        imported_sources: 0,
        manual_reentry_sources: 0,
        connectors_detected: 0,
        report: GraphConnectorSyncReport::default(),
        sources: Vec::new(),
    };

    let mut import_cfg = config::Config::default();
    for relative_path in env_service_paths {
        if let Some(connector) = build_legacy_env_connector(&source, &relative_path) {
            report.importable_sources += 1;
            report.connectors_detected += 1;
            report.sources.push(LegacyEnvImportSourceReport {
                source_path: relative_path.clone(),
                connector_name: Some(connector.0.clone()),
                status: if dry_run {
                    LegacyEnvImportSourceStatus::Ready
                } else {
                    LegacyEnvImportSourceStatus::Imported
                },
                reason: Some("safe dotenv-style import available".to_string()),
            });
            import_cfg.memory_connectors.insert(
                connector.0,
                config::MemoryConnectorConfig::DotenvFile(connector.1),
            );
        } else {
            report.manual_reentry_sources += 1;
            report.sources.push(LegacyEnvImportSourceReport {
                source_path: relative_path,
                connector_name: None,
                status: LegacyEnvImportSourceStatus::ManualOnly,
                reason: Some(
                    "manual auth/config translation still required; raw secret-bearing config is not imported"
                        .to_string(),
                ),
            });
        }
    }

    if dry_run || import_cfg.memory_connectors.is_empty() {
        return Ok(report);
    }

    let sync_report = sync_all_memory_connectors(db, &import_cfg, limit)?;
    report.imported_sources = sync_report.connectors_synced;
    report.report = sync_report;
    Ok(report)
}

fn build_legacy_env_connector(
    source: &Path,
    relative_path: &str,
) -> Option<(String, config::MemoryConnectorDotenvFileConfig)> {
    let is_importable = matches!(
        relative_path,
        ".env" | ".env.local" | ".env.production" | ".envrc"
    );
    if !is_importable {
        return None;
    }

    let connector_name = format!(
        "legacy_env_{}",
        relative_path
            .chars()
            .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '_' })
            .collect::<String>()
            .trim_matches('_')
    );
    Some((
        connector_name,
        config::MemoryConnectorDotenvFileConfig {
            path: source.join(relative_path),
            session_id: None,
            default_entity_type: Some("legacy_service_config".to_string()),
            default_observation_type: Some("legacy_env_context".to_string()),
            key_prefixes: Vec::new(),
            include_keys: Vec::new(),
            exclude_keys: Vec::new(),
            include_safe_values: true,
        },
    ))
}

fn import_legacy_skills(source: &Path, output_dir: &Path) -> Result<LegacySkillImportReport> {
    let source = source
        .canonicalize()
        .with_context(|| format!("Legacy workspace not found: {}", source.display()))?;
    if !source.is_dir() {
        anyhow::bail!(
            "Legacy workspace source must be a directory: {}",
            source.display()
        );
    }

    let skills_dir = source.join("skills");
    let mut report = LegacySkillImportReport {
        source: source.display().to_string(),
        output_dir: output_dir.display().to_string(),
        skills_detected: 0,
        templates_generated: 0,
        files_written: Vec::new(),
        skills: Vec::new(),
    };
    if !skills_dir.is_dir() {
        return Ok(report);
    }

    let skill_paths = collect_markdown_paths(&skills_dir, true)?;
    if skill_paths.is_empty() {
        return Ok(report);
    }

    fs::create_dir_all(output_dir)
        .with_context(|| format!("create legacy skill output dir {}", output_dir.display()))?;

    let mut templates = BTreeMap::new();
    for path in skill_paths {
        let draft = build_legacy_skill_draft(&source, &skills_dir, &path)?;
        report.skills_detected += 1;
        report.templates_generated += 1;
        report.skills.push(LegacySkillImportEntry {
            source_path: draft.source_path.clone(),
            template_name: draft.template_name.clone(),
            title: draft.title.clone(),
            summary: draft.summary.clone(),
        });
        templates.insert(
            draft.template_name.clone(),
            config::OrchestrationTemplateConfig {
                description: Some(format!(
                    "Migrated legacy skill scaffold from {}",
                    draft.source_path
                )),
                project: Some("legacy-migration".to_string()),
                task_group: Some("legacy skill".to_string()),
                agent: Some("claude".to_string()),
                profile: None,
                worktree: Some(false),
                steps: vec![config::OrchestrationTemplateStepConfig {
                    name: Some("operator".to_string()),
                    task: format!(
                        "Use the migrated legacy skill context from {}.\nLegacy skill title: {}\nLegacy summary: {}\nLegacy excerpt:\n{}\nTranslate and run that workflow for {{{{task}}}}.",
                        draft.source_path, draft.title, draft.summary, draft.excerpt
                    ),
                    agent: None,
                    profile: None,
                    worktree: Some(false),
                    project: Some("legacy-migration".to_string()),
                    task_group: Some("legacy skill".to_string()),
                }],
            },
        );
    }

    let templates_path = output_dir.join("ecc2.imported-skills.toml");
    fs::write(
        &templates_path,
        toml::to_string_pretty(&LegacySkillTemplateFile {
            orchestration_templates: templates,
        })?,
    )
    .with_context(|| {
        format!(
            "write imported skill templates {}",
            templates_path.display()
        )
    })?;
    report
        .files_written
        .push(templates_path.display().to_string());

    let summary_path = output_dir.join("imported-skills.md");
    fs::write(
        &summary_path,
        format_legacy_skill_import_summary_markdown(&report),
    )
    .with_context(|| format!("write imported skill summary {}", summary_path.display()))?;
    report
        .files_written
        .push(summary_path.display().to_string());

    Ok(report)
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct LegacySkillDraft {
    source_path: String,
    template_name: String,
    title: String,
    summary: String,
    excerpt: String,
}

fn build_legacy_skill_draft(
    source: &Path,
    skills_dir: &Path,
    path: &Path,
) -> Result<LegacySkillDraft> {
    let body = fs::read_to_string(path)
        .with_context(|| format!("read legacy skill file {}", path.display()))?;
    let source_path = path
        .strip_prefix(source)
        .unwrap_or(path)
        .display()
        .to_string();
    let relative_to_skills = path.strip_prefix(skills_dir).unwrap_or(path);
    let title = extract_legacy_skill_title(relative_to_skills, &body);
    let summary = extract_legacy_skill_summary(&body).unwrap_or_else(|| title.clone());
    let excerpt = extract_legacy_skill_excerpt(&body, 8, 600).unwrap_or_else(|| summary.clone());
    let template_name = slugify_legacy_skill_template_name(relative_to_skills);

    Ok(LegacySkillDraft {
        source_path,
        template_name,
        title,
        summary,
        excerpt,
    })
}

fn extract_legacy_skill_title(relative_path: &Path, body: &str) -> String {
    for line in body.lines() {
        let trimmed = line.trim();
        if let Some(title) = trimmed.strip_prefix("#") {
            let title = title.trim();
            if !title.is_empty() {
                return title.to_string();
            }
        }
    }
    relative_path
        .file_stem()
        .and_then(|value| value.to_str())
        .map(|value| value.replace(['-', '_'], " "))
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "legacy skill".to_string())
}

fn extract_legacy_skill_summary(body: &str) -> Option<String> {
    body.lines()
        .map(str::trim)
        .find(|line| !line.is_empty() && !line.starts_with('#'))
        .map(ToString::to_string)
}

fn extract_legacy_skill_excerpt(body: &str, max_lines: usize, max_chars: usize) -> Option<String> {
    let mut lines = Vec::new();
    let mut chars = 0usize;
    for line in body.lines().map(str::trim).filter(|line| !line.is_empty()) {
        if chars >= max_chars || lines.len() >= max_lines {
            break;
        }
        let remaining = max_chars.saturating_sub(chars);
        if remaining == 0 {
            break;
        }
        let truncated = truncate_connector_text(line, remaining);
        chars += truncated.len();
        lines.push(truncated);
    }
    if lines.is_empty() {
        None
    } else {
        Some(lines.join("\n"))
    }
}

fn slugify_legacy_skill_template_name(relative_path: &Path) -> String {
    relative_path
        .to_string_lossy()
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() {
                ch.to_ascii_lowercase()
            } else {
                '_'
            }
        })
        .collect::<String>()
        .trim_matches('_')
        .split('_')
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>()
        .join("_")
}

fn format_legacy_skill_import_summary_markdown(report: &LegacySkillImportReport) -> String {
    let mut lines = vec![
        "# Imported legacy skills".to_string(),
        String::new(),
        format!("- Source: `{}`", report.source),
        format!("- Output dir: `{}`", report.output_dir),
        format!("- Skills detected: {}", report.skills_detected),
        format!("- Templates generated: {}", report.templates_generated),
        String::new(),
    ];

    if report.skills.is_empty() {
        lines.push("No legacy skill markdown files were detected.".to_string());
        return lines.join("\n");
    }

    lines.push("## Skills".to_string());
    lines.push(String::new());
    for skill in &report.skills {
        lines.push(format!(
            "- `{}` -> `{}`",
            skill.source_path, skill.template_name
        ));
        lines.push(format!("  - Title: {}", skill.title));
        lines.push(format!("  - Summary: {}", skill.summary));
    }

    lines.join("\n")
}

fn import_legacy_tools(source: &Path, output_dir: &Path) -> Result<LegacyToolImportReport> {
    let source = source
        .canonicalize()
        .with_context(|| format!("Legacy workspace not found: {}", source.display()))?;
    if !source.is_dir() {
        anyhow::bail!(
            "Legacy workspace source must be a directory: {}",
            source.display()
        );
    }

    let tools_dir = source.join("tools");
    let mut report = LegacyToolImportReport {
        source: source.display().to_string(),
        output_dir: output_dir.display().to_string(),
        tools_detected: 0,
        templates_generated: 0,
        files_written: Vec::new(),
        tools: Vec::new(),
    };
    if !tools_dir.is_dir() {
        return Ok(report);
    }

    let tool_paths = collect_legacy_tool_paths(&tools_dir)?;
    if tool_paths.is_empty() {
        return Ok(report);
    }

    fs::create_dir_all(output_dir)
        .with_context(|| format!("create legacy tool output dir {}", output_dir.display()))?;

    let mut templates = BTreeMap::new();
    for path in tool_paths {
        let draft = build_legacy_tool_draft(&source, &tools_dir, &path)?;
        report.tools_detected += 1;
        report.templates_generated += 1;
        report.tools.push(LegacyToolImportEntry {
            source_path: draft.source_path.clone(),
            template_name: draft.template_name.clone(),
            title: draft.title.clone(),
            summary: draft.summary.clone(),
            suggested_surface: draft.suggested_surface.clone(),
        });
        templates.insert(
            draft.template_name.clone(),
            config::OrchestrationTemplateConfig {
                description: Some(format!(
                    "Migrated legacy tool scaffold from {}",
                    draft.source_path
                )),
                project: Some("legacy-migration".to_string()),
                task_group: Some("legacy tool".to_string()),
                agent: Some("claude".to_string()),
                profile: None,
                worktree: Some(false),
                steps: vec![config::OrchestrationTemplateStepConfig {
                    name: Some("operator".to_string()),
                    task: format!(
                        "Use the migrated legacy tool context from {}.\nSuggested ECC target surface: {}\nLegacy tool title: {}\nLegacy summary: {}\nLegacy excerpt:\n{}\nRebuild or wrap that behavior as an ECC-native {} for {{{{task}}}}.",
                        draft.source_path,
                        draft.suggested_surface,
                        draft.title,
                        draft.summary,
                        draft.excerpt,
                        draft.suggested_surface
                    ),
                    agent: None,
                    profile: None,
                    worktree: Some(false),
                    project: Some("legacy-migration".to_string()),
                    task_group: Some("legacy tool".to_string()),
                }],
            },
        );
    }

    let templates_path = output_dir.join("ecc2.imported-tools.toml");
    fs::write(
        &templates_path,
        toml::to_string_pretty(&LegacyToolTemplateFile {
            orchestration_templates: templates,
        })?,
    )
    .with_context(|| format!("write imported tool templates {}", templates_path.display()))?;
    report
        .files_written
        .push(templates_path.display().to_string());

    let summary_path = output_dir.join("imported-tools.md");
    fs::write(
        &summary_path,
        format_legacy_tool_import_summary_markdown(&report),
    )
    .with_context(|| format!("write imported tool summary {}", summary_path.display()))?;
    report
        .files_written
        .push(summary_path.display().to_string());

    Ok(report)
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct LegacyToolDraft {
    source_path: String,
    template_name: String,
    title: String,
    summary: String,
    excerpt: String,
    suggested_surface: String,
}

fn collect_legacy_tool_paths(root: &Path) -> Result<Vec<PathBuf>> {
    let mut paths = Vec::new();
    collect_legacy_tool_paths_inner(root, &mut paths)?;
    paths.sort();
    Ok(paths)
}

fn collect_legacy_tool_paths_inner(root: &Path, paths: &mut Vec<PathBuf>) -> Result<()> {
    let mut entries = fs::read_dir(root)
        .with_context(|| format!("read legacy tools dir {}", root.display()))?
        .collect::<std::io::Result<Vec<_>>>()
        .with_context(|| format!("read entries under {}", root.display()))?;
    entries.sort_by_key(|entry| entry.path());
    for entry in entries {
        let path = entry.path();
        let file_type = entry
            .file_type()
            .with_context(|| format!("read file type for {}", path.display()))?;
        if file_type.is_dir() {
            collect_legacy_tool_paths_inner(&path, paths)?;
            continue;
        }
        if file_type.is_file() && is_legacy_tool_candidate(&path) {
            paths.push(path);
        }
    }
    Ok(())
}

fn is_legacy_tool_candidate(path: &Path) -> bool {
    matches!(
        path.extension().and_then(|ext| ext.to_str()),
        Some("py" | "js" | "ts" | "mjs" | "cjs" | "sh" | "bash" | "zsh" | "rb" | "pl" | "php")
    ) || path.extension().is_none()
}

fn build_legacy_tool_draft(
    source: &Path,
    tools_dir: &Path,
    path: &Path,
) -> Result<LegacyToolDraft> {
    let body =
        fs::read(path).with_context(|| format!("read legacy tool file {}", path.display()))?;
    let body = String::from_utf8_lossy(&body).into_owned();
    let source_path = path
        .strip_prefix(source)
        .unwrap_or(path)
        .display()
        .to_string();
    let relative_to_tools = path.strip_prefix(tools_dir).unwrap_or(path);
    let title = extract_legacy_tool_title(relative_to_tools);
    let summary = extract_legacy_tool_summary(&body).unwrap_or_else(|| title.clone());
    let excerpt = extract_legacy_tool_excerpt(&body, 10, 700).unwrap_or_else(|| summary.clone());
    let template_name = format!(
        "tool_{}",
        slugify_legacy_skill_template_name(relative_to_tools)
    );
    let suggested_surface = classify_legacy_tool_surface(&source_path, &body).to_string();

    Ok(LegacyToolDraft {
        source_path,
        template_name,
        title,
        summary,
        excerpt,
        suggested_surface,
    })
}

fn extract_legacy_tool_title(relative_path: &Path) -> String {
    relative_path
        .file_stem()
        .and_then(|value| value.to_str())
        .map(|value| value.replace(['-', '_'], " "))
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "legacy tool".to_string())
}

fn extract_legacy_tool_summary(body: &str) -> Option<String> {
    body.lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with("#!"))
        .find_map(|line| {
            let stripped = line
                .trim_start_matches("#")
                .trim_start_matches("//")
                .trim_start_matches("--")
                .trim_start_matches("/*")
                .trim_start_matches('*')
                .trim();
            if stripped.is_empty() {
                None
            } else {
                Some(truncate_connector_text(stripped, 160))
            }
        })
}

fn extract_legacy_tool_excerpt(body: &str, max_lines: usize, max_chars: usize) -> Option<String> {
    let mut lines = Vec::new();
    let mut chars = 0usize;
    for line in body.lines().map(str::trim).filter(|line| !line.is_empty()) {
        if line.starts_with("#!") {
            continue;
        }
        if chars >= max_chars || lines.len() >= max_lines {
            break;
        }
        let remaining = max_chars.saturating_sub(chars);
        if remaining == 0 {
            break;
        }
        let truncated = truncate_connector_text(line, remaining);
        chars += truncated.len();
        lines.push(truncated);
    }
    if lines.is_empty() {
        None
    } else {
        Some(lines.join("\n"))
    }
}

fn classify_legacy_tool_surface(source_path: &str, body: &str) -> &'static str {
    let source_lower = source_path.to_ascii_lowercase();
    let body_lower = body.to_ascii_lowercase();
    if source_lower.contains("hook")
        || body_lower.contains("pretooluse")
        || body_lower.contains("posttooluse")
        || body_lower.contains("notification")
    {
        "hook"
    } else if source_lower.contains("runner")
        || source_lower.contains("agent")
        || body_lower.contains("session_name_flag")
        || body_lower.contains("include-directories")
    {
        "harness runner"
    } else {
        "command"
    }
}

fn format_legacy_tool_import_summary_markdown(report: &LegacyToolImportReport) -> String {
    let mut lines = vec![
        "# Imported legacy tools".to_string(),
        String::new(),
        format!("- Source: `{}`", report.source),
        format!("- Output dir: `{}`", report.output_dir),
        format!("- Tools detected: {}", report.tools_detected),
        format!("- Templates generated: {}", report.templates_generated),
        String::new(),
    ];

    if report.tools.is_empty() {
        lines.push("No legacy tool scripts were detected.".to_string());
        return lines.join("\n");
    }

    lines.push("## Tools".to_string());
    lines.push(String::new());
    for tool in &report.tools {
        lines.push(format!(
            "- `{}` -> `{}`",
            tool.source_path, tool.template_name
        ));
        lines.push(format!("  - Title: {}", tool.title));
        lines.push(format!("  - Summary: {}", tool.summary));
        lines.push(format!("  - Suggested surface: {}", tool.suggested_surface));
    }

    lines.join("\n")
}

fn import_legacy_plugins(source: &Path, output_dir: &Path) -> Result<LegacyPluginImportReport> {
    let source = source
        .canonicalize()
        .with_context(|| format!("Legacy workspace not found: {}", source.display()))?;
    if !source.is_dir() {
        anyhow::bail!(
            "Legacy workspace source must be a directory: {}",
            source.display()
        );
    }

    let plugins_dir = source.join("plugins");
    let mut report = LegacyPluginImportReport {
        source: source.display().to_string(),
        output_dir: output_dir.display().to_string(),
        plugins_detected: 0,
        templates_generated: 0,
        files_written: Vec::new(),
        plugins: Vec::new(),
    };
    if !plugins_dir.is_dir() {
        return Ok(report);
    }

    let plugin_paths = collect_legacy_tool_paths(&plugins_dir)?;
    if plugin_paths.is_empty() {
        return Ok(report);
    }

    fs::create_dir_all(output_dir)
        .with_context(|| format!("create legacy plugin output dir {}", output_dir.display()))?;

    let mut templates = BTreeMap::new();
    for path in plugin_paths {
        let draft = build_legacy_plugin_draft(&source, &plugins_dir, &path)?;
        report.plugins_detected += 1;
        report.templates_generated += 1;
        report.plugins.push(LegacyPluginImportEntry {
            source_path: draft.source_path.clone(),
            template_name: draft.template_name.clone(),
            title: draft.title.clone(),
            summary: draft.summary.clone(),
            suggested_surface: draft.suggested_surface.clone(),
        });
        templates.insert(
            draft.template_name.clone(),
            config::OrchestrationTemplateConfig {
                description: Some(format!(
                    "Migrated legacy plugin scaffold from {}",
                    draft.source_path
                )),
                project: Some("legacy-migration".to_string()),
                task_group: Some("legacy plugin".to_string()),
                agent: Some("claude".to_string()),
                profile: None,
                worktree: Some(false),
                steps: vec![config::OrchestrationTemplateStepConfig {
                    name: Some("operator".to_string()),
                    task: format!(
                        "Use the migrated legacy plugin context from {}.\nSuggested ECC target surface: {}\nLegacy plugin title: {}\nLegacy summary: {}\nLegacy excerpt:\n{}\nPort that behavior into an ECC-native {} for {{{{task}}}}.",
                        draft.source_path,
                        draft.suggested_surface,
                        draft.title,
                        draft.summary,
                        draft.excerpt,
                        draft.suggested_surface
                    ),
                    agent: None,
                    profile: None,
                    worktree: Some(false),
                    project: Some("legacy-migration".to_string()),
                    task_group: Some("legacy plugin".to_string()),
                }],
            },
        );
    }

    let templates_path = output_dir.join("ecc2.imported-plugins.toml");
    fs::write(
        &templates_path,
        toml::to_string_pretty(&LegacyPluginTemplateFile {
            orchestration_templates: templates,
        })?,
    )
    .with_context(|| {
        format!(
            "write imported plugin templates {}",
            templates_path.display()
        )
    })?;
    report
        .files_written
        .push(templates_path.display().to_string());

    let summary_path = output_dir.join("imported-plugins.md");
    fs::write(
        &summary_path,
        format_legacy_plugin_import_summary_markdown(&report),
    )
    .with_context(|| format!("write imported plugin summary {}", summary_path.display()))?;
    report
        .files_written
        .push(summary_path.display().to_string());

    Ok(report)
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct LegacyPluginDraft {
    source_path: String,
    template_name: String,
    title: String,
    summary: String,
    excerpt: String,
    suggested_surface: String,
}

fn build_legacy_plugin_draft(
    source: &Path,
    plugins_dir: &Path,
    path: &Path,
) -> Result<LegacyPluginDraft> {
    let body =
        fs::read(path).with_context(|| format!("read legacy plugin file {}", path.display()))?;
    let body = String::from_utf8_lossy(&body).into_owned();
    let source_path = path
        .strip_prefix(source)
        .unwrap_or(path)
        .display()
        .to_string();
    let relative_to_plugins = path.strip_prefix(plugins_dir).unwrap_or(path);
    let title = extract_legacy_tool_title(relative_to_plugins);
    let summary = extract_legacy_tool_summary(&body).unwrap_or_else(|| title.clone());
    let excerpt = extract_legacy_tool_excerpt(&body, 10, 700).unwrap_or_else(|| summary.clone());
    let template_name = format!(
        "plugin_{}",
        slugify_legacy_skill_template_name(relative_to_plugins)
    );
    let suggested_surface = classify_legacy_plugin_surface(&source_path, &body).to_string();

    Ok(LegacyPluginDraft {
        source_path,
        template_name,
        title,
        summary,
        excerpt,
        suggested_surface,
    })
}

fn classify_legacy_plugin_surface(source_path: &str, body: &str) -> &'static str {
    let source_lower = source_path.to_ascii_lowercase();
    let body_lower = body.to_ascii_lowercase();
    if source_lower.contains("hook")
        || body_lower.contains("pretooluse")
        || body_lower.contains("posttooluse")
        || body_lower.contains("notification")
    {
        "hook"
    } else if source_lower.contains("skill")
        || body_lower.contains("skill")
        || body_lower.contains("system prompt")
        || body_lower.contains("context")
    {
        "skill"
    } else {
        "command"
    }
}

fn format_legacy_plugin_import_summary_markdown(report: &LegacyPluginImportReport) -> String {
    let mut lines = vec![
        "# Imported legacy plugins".to_string(),
        String::new(),
        format!("- Source: `{}`", report.source),
        format!("- Output dir: `{}`", report.output_dir),
        format!("- Plugins detected: {}", report.plugins_detected),
        format!("- Templates generated: {}", report.templates_generated),
        String::new(),
    ];

    if report.plugins.is_empty() {
        lines.push("No legacy plugin scripts were detected.".to_string());
        return lines.join("\n");
    }

    lines.push("## Plugins".to_string());
    lines.push(String::new());
    for plugin in &report.plugins {
        lines.push(format!(
            "- `{}` -> `{}`",
            plugin.source_path, plugin.template_name
        ));
        lines.push(format!("  - Title: {}", plugin.title));
        lines.push(format!("  - Summary: {}", plugin.summary));
        lines.push(format!(
            "  - Suggested surface: {}",
            plugin.suggested_surface
        ));
    }

    lines.join("\n")
}

fn build_legacy_remote_add_command(draft: &LegacyRemoteDispatchDraft) -> Option<String> {
    match draft.request_kind {
        session::RemoteDispatchKind::Standard => {
            let task = draft.task.as_deref()?;
            let mut parts = vec![
                "ecc remote add".to_string(),
                format!("--task {}", shell_quote_double(task)),
            ];
            if let Some(target_session) = draft.target_session.as_deref() {
                parts.push(format!(
                    "--to-session {}",
                    shell_quote_double(target_session)
                ));
            }
            if let Some(priority) = draft
                .priority
                .filter(|value| *value != TaskPriorityArg::Normal)
            {
                parts.push(format!("--priority {}", format_task_priority_arg(priority)));
            }
            if let Some(agent) = draft.agent.as_deref() {
                parts.push(format!("--agent {}", shell_quote_double(agent)));
            }
            if let Some(profile) = draft.profile.as_deref() {
                parts.push(format!("--profile {}", shell_quote_double(profile)));
            }
            match draft.use_worktree {
                Some(true) => parts.push("--worktree".to_string()),
                Some(false) => parts.push("--no-worktree".to_string()),
                None => {}
            }
            if let Some(project) = draft.project.as_deref() {
                parts.push(format!("--project {}", shell_quote_double(project)));
            }
            if let Some(task_group) = draft.task_group.as_deref() {
                parts.push(format!("--task-group {}", shell_quote_double(task_group)));
            }
            Some(parts.join(" "))
        }
        session::RemoteDispatchKind::ComputerUse => {
            let goal = draft.goal.as_deref()?;
            let mut parts = vec![
                "ecc remote computer-use".to_string(),
                format!("--goal {}", shell_quote_double(goal)),
            ];
            if let Some(target_url) = draft.target_url.as_deref() {
                parts.push(format!("--target-url {}", shell_quote_double(target_url)));
            }
            if let Some(context) = draft.context.as_deref() {
                parts.push(format!("--context {}", shell_quote_double(context)));
            }
            if let Some(target_session) = draft.target_session.as_deref() {
                parts.push(format!(
                    "--to-session {}",
                    shell_quote_double(target_session)
                ));
            }
            if let Some(priority) = draft
                .priority
                .filter(|value| *value != TaskPriorityArg::Normal)
            {
                parts.push(format!("--priority {}", format_task_priority_arg(priority)));
            }
            if let Some(agent) = draft.agent.as_deref() {
                parts.push(format!("--agent {}", shell_quote_double(agent)));
            }
            if let Some(profile) = draft.profile.as_deref() {
                parts.push(format!("--profile {}", shell_quote_double(profile)));
            }
            match draft.use_worktree {
                Some(true) => parts.push("--worktree".to_string()),
                Some(false) => parts.push("--no-worktree".to_string()),
                None => {}
            }
            if let Some(project) = draft.project.as_deref() {
                parts.push(format!("--project {}", shell_quote_double(project)));
            }
            if let Some(task_group) = draft.task_group.as_deref() {
                parts.push(format!("--task-group {}", shell_quote_double(task_group)));
            }
            Some(parts.join(" "))
        }
    }
}

fn import_legacy_remote_dispatch(
    db: &session::store::StateStore,
    cfg: &config::Config,
    source: &Path,
    dry_run: bool,
) -> Result<LegacyRemoteImportReport> {
    let source = source
        .canonicalize()
        .with_context(|| format!("Legacy workspace not found: {}", source.display()))?;
    if !source.is_dir() {
        anyhow::bail!(
            "Legacy workspace source must be a directory: {}",
            source.display()
        );
    }

    let drafts = load_legacy_remote_dispatch_drafts(&source)?;
    let mut report = LegacyRemoteImportReport {
        source: source.display().to_string(),
        dry_run,
        requests_detected: drafts.len(),
        ready_requests: 0,
        imported_requests: 0,
        disabled_requests: 0,
        invalid_requests: 0,
        skipped_requests: 0,
        requests: Vec::new(),
    };

    for draft in drafts {
        let mut item = LegacyRemoteImportRequestReport {
            source_path: draft.source_path.clone(),
            request_name: draft.request_name.clone(),
            request_kind: draft.request_kind,
            task: draft.task.clone(),
            goal: draft.goal.clone(),
            target_url: draft.target_url.clone(),
            context: draft.context.clone(),
            target_session: draft.target_session.clone(),
            priority: draft.priority,
            agent: draft.agent.clone(),
            profile: draft.profile.clone(),
            project: draft.project.clone(),
            task_group: draft.task_group.clone(),
            use_worktree: draft.use_worktree,
            status: LegacyRemoteImportRequestStatus::Ready,
            reason: None,
            command_snippet: build_legacy_remote_add_command(&draft),
            imported_request_id: None,
        };

        if !draft.enabled {
            item.status = LegacyRemoteImportRequestStatus::Disabled;
            item.reason = Some("disabled in legacy workspace".to_string());
            report.disabled_requests += 1;
            report.requests.push(item);
            continue;
        }

        let body_text = match draft.request_kind {
            session::RemoteDispatchKind::Standard => draft.task.as_deref(),
            session::RemoteDispatchKind::ComputerUse => draft.goal.as_deref(),
        };
        if body_text.is_none() {
            item.status = LegacyRemoteImportRequestStatus::Invalid;
            item.reason = Some(match draft.request_kind {
                session::RemoteDispatchKind::Standard => "missing task/prompt".to_string(),
                session::RemoteDispatchKind::ComputerUse => {
                    "missing computer-use goal/prompt".to_string()
                }
            });
            report.invalid_requests += 1;
            report.requests.push(item);
            continue;
        }

        if let Some(profile) = draft.profile.as_deref() {
            if let Err(error) = cfg.resolve_agent_profile(profile) {
                item.status = LegacyRemoteImportRequestStatus::Skipped;
                item.reason = Some(format!("profile `{profile}` is not usable here: {error}"));
                report.skipped_requests += 1;
                report.requests.push(item);
                continue;
            }
        }

        let target_session_id = match draft.target_session.as_deref() {
            Some(value) => match resolve_session_id(db, value) {
                Ok(resolved) => Some(resolved),
                Err(error) => {
                    item.status = LegacyRemoteImportRequestStatus::Skipped;
                    item.reason = Some(format!(
                        "target session `{value}` is not usable here: {error}"
                    ));
                    report.skipped_requests += 1;
                    report.requests.push(item);
                    continue;
                }
            },
            None => None,
        };

        report.ready_requests += 1;
        if dry_run {
            report.requests.push(item);
            continue;
        }

        let request = match draft.request_kind {
            session::RemoteDispatchKind::Standard => {
                session::manager::create_remote_dispatch_request(
                    db,
                    cfg,
                    body_text.expect("checked task text"),
                    target_session_id.as_deref(),
                    draft.priority.unwrap_or(TaskPriorityArg::Normal).into(),
                    draft.agent.as_deref().unwrap_or(&cfg.default_agent),
                    draft.profile.as_deref(),
                    draft.use_worktree.unwrap_or(cfg.auto_create_worktrees),
                    session::SessionGrouping {
                        project: draft.project.clone(),
                        task_group: draft.task_group.clone(),
                    },
                    "migrate_remote",
                    None,
                )?
            }
            session::RemoteDispatchKind::ComputerUse => {
                let defaults = cfg.computer_use_dispatch_defaults();
                session::manager::create_computer_use_remote_dispatch_request(
                    db,
                    cfg,
                    body_text.expect("checked goal text"),
                    draft.target_url.as_deref(),
                    draft.context.as_deref(),
                    target_session_id.as_deref(),
                    draft.priority.unwrap_or(TaskPriorityArg::Normal).into(),
                    draft.agent.as_deref(),
                    draft.profile.as_deref(),
                    Some(draft.use_worktree.unwrap_or(defaults.use_worktree)),
                    session::SessionGrouping {
                        project: draft.project.clone(),
                        task_group: draft.task_group.clone(),
                    },
                    "migrate_remote_computer_use",
                    None,
                )?
            }
        };

        item.status = LegacyRemoteImportRequestStatus::Imported;
        item.imported_request_id = Some(request.id);
        report.imported_requests += 1;
        report.requests.push(item);
    }

    Ok(report)
}

fn build_legacy_migration_plan_report(
    audit: &LegacyMigrationAuditReport,
) -> LegacyMigrationPlanReport {
    let mut steps = Vec::new();
    let legacy_schedule_drafts =
        load_legacy_schedule_drafts(Path::new(&audit.source)).unwrap_or_default();
    let schedule_commands = legacy_schedule_drafts
        .iter()
        .filter(|draft| draft.enabled)
        .filter_map(build_legacy_schedule_add_command)
        .collect::<Vec<_>>();
    let disabled_schedule_jobs = legacy_schedule_drafts
        .iter()
        .filter(|draft| !draft.enabled)
        .count();
    let invalid_schedule_jobs = legacy_schedule_drafts
        .iter()
        .filter(|draft| draft.enabled && (draft.cron_expr.is_none() || draft.task.is_none()))
        .count();
    let legacy_remote_drafts =
        load_legacy_remote_dispatch_drafts(Path::new(&audit.source)).unwrap_or_default();
    let remote_commands = legacy_remote_drafts
        .iter()
        .filter(|draft| draft.enabled)
        .filter_map(build_legacy_remote_add_command)
        .collect::<Vec<_>>();
    let disabled_remote_requests = legacy_remote_drafts
        .iter()
        .filter(|draft| !draft.enabled)
        .count();
    let invalid_remote_requests = legacy_remote_drafts
        .iter()
        .filter(|draft| {
            draft.enabled
                && match draft.request_kind {
                    session::RemoteDispatchKind::Standard => draft.task.is_none(),
                    session::RemoteDispatchKind::ComputerUse => draft.goal.is_none(),
                }
        })
        .count();

    for artifact in &audit.artifacts {
        let step = match artifact.category.as_str() {
            "scheduler" => LegacyMigrationPlanStep {
                category: artifact.category.clone(),
                readiness: artifact.readiness,
                title: "Recreate Hermes/OpenClaw recurring jobs in ECC2 scheduler".to_string(),
                target_surface: "ECC2 scheduler".to_string(),
                source_paths: artifact.source_paths.clone(),
                command_snippets: if schedule_commands.is_empty() {
                    vec![
                        "ecc schedule add --cron \"<legacy-cron>\" --task \"Translate legacy recurring job from cron/scheduler.py\"".to_string(),
                        "ecc schedule list".to_string(),
                        "ecc daemon".to_string(),
                    ]
                } else {
                    let mut commands = schedule_commands.clone();
                    commands.push("ecc schedule list".to_string());
                    commands.push("ecc daemon".to_string());
                    commands
                },
                config_snippets: Vec::new(),
                notes: {
                    let mut notes = artifact.notes.clone();
                    if !schedule_commands.is_empty() {
                        notes.push(format!(
                            "Recovered {} concrete recurring job(s) from cron/jobs.json.",
                            schedule_commands.len()
                        ));
                    }
                    if disabled_schedule_jobs > 0 {
                        notes.push(format!(
                            "{disabled_schedule_jobs} legacy recurring job(s) are disabled and were left out of generated ECC2 commands."
                        ));
                    }
                    if invalid_schedule_jobs > 0 {
                        notes.push(format!(
                            "{invalid_schedule_jobs} legacy recurring job(s) were missing cron/task fields and still need manual translation."
                        ));
                    }
                    notes
                },
            },
            "gateway_dispatch" => LegacyMigrationPlanStep {
                category: artifact.category.clone(),
                readiness: artifact.readiness,
                title: "Replace legacy gateway intake with ECC2 remote dispatch".to_string(),
                target_surface: "ECC2 remote dispatch".to_string(),
                source_paths: artifact.source_paths.clone(),
                command_snippets: if remote_commands.is_empty() {
                    vec![
                        "ecc remote serve --bind 127.0.0.1:8787 --token <token>".to_string(),
                        "ecc remote add --task \"Translate legacy dispatch workflow\"".to_string(),
                        "ecc remote computer-use --goal \"Translate legacy browser/operator flow\"".to_string(),
                    ]
                } else {
                    let mut commands = vec![
                        "ecc remote serve --bind 127.0.0.1:8787 --token <token>".to_string(),
                    ];
                    commands.extend(remote_commands.clone());
                    commands.push("ecc remote list".to_string());
                    commands.push("ecc remote run".to_string());
                    commands
                },
                config_snippets: Vec::new(),
                notes: {
                    let mut notes = artifact.notes.clone();
                    if !remote_commands.is_empty() {
                        notes.push(format!(
                            "Recovered {} concrete remote dispatch request(s) from gateway JSON/JSONL files.",
                            remote_commands.len()
                        ));
                    }
                    if disabled_remote_requests > 0 {
                        notes.push(format!(
                            "{disabled_remote_requests} legacy remote dispatch request(s) are disabled and were left out of generated ECC2 commands."
                        ));
                    }
                    if invalid_remote_requests > 0 {
                        notes.push(format!(
                            "{invalid_remote_requests} legacy remote dispatch request(s) were missing task/goal fields and still need manual translation."
                        ));
                    }
                    notes
                },
            },
            "memory_tool" => LegacyMigrationPlanStep {
                category: artifact.category.clone(),
                readiness: artifact.readiness,
                title: "Port legacy memory tool usage to ECC2 deep memory".to_string(),
                target_surface: "ECC2 context graph".to_string(),
                source_paths: artifact.source_paths.clone(),
                command_snippets: vec![
                    "ecc graph add-observation --entity-id <id> --type migration_note --summary \"Imported legacy memory pattern\"".to_string(),
                    "ecc graph recall \"<query>\"".to_string(),
                    "ecc graph connectors".to_string(),
                ],
                config_snippets: Vec::new(),
                notes: artifact.notes.clone(),
            },
            "workspace_memory" => LegacyMigrationPlanStep {
                category: artifact.category.clone(),
                readiness: artifact.readiness,
                title: "Import sanitized workspace memory through ECC2 connectors".to_string(),
                target_surface: "ECC2 memory connectors".to_string(),
                source_paths: artifact.source_paths.clone(),
                command_snippets: vec![
                    "ecc graph connector-sync hermes_workspace".to_string(),
                    "ecc graph recall \"<query>\"".to_string(),
                ],
                config_snippets: vec![format!(
                    "[memory_connectors.hermes_workspace]\nkind = \"markdown_directory\"\npath = \"{}\"\nrecurse = true\ndefault_entity_type = \"legacy_workspace_note\"\ndefault_observation_type = \"legacy_workspace_memory\"",
                    Path::new(&audit.source).join("workspace").display()
                )],
                notes: artifact.notes.clone(),
            },
            "skills" => LegacyMigrationPlanStep {
                category: artifact.category.clone(),
                readiness: artifact.readiness,
                title: "Translate reusable legacy skills into ECC-native surfaces".to_string(),
                target_surface: "ECC skills / orchestration templates".to_string(),
                source_paths: artifact.source_paths.clone(),
                command_snippets: vec![
                    format!(
                        "ecc migrate import-skills --source {} --output-dir migration-artifacts/skills",
                        shell_quote_double(&audit.source)
                    ),
                    "ecc template <template-name> --task \"<translated workflow goal>\"".to_string(),
                ],
                config_snippets: vec![
                    "[orchestration_templates.legacy_workflow]\nproject = \"legacy-migration\"\ntask_group = \"legacy workflow\"\nagent = \"claude\"\nworktree = false\n\n[[orchestration_templates.legacy_workflow.steps]]\nname = \"operator\"\ntask = \"Translate and run the legacy workflow for {{task}}\"".to_string(),
                ],
                notes: artifact.notes.clone(),
            },
            "tools" => LegacyMigrationPlanStep {
                category: artifact.category.clone(),
                readiness: artifact.readiness,
                title: "Rebuild valuable legacy tools as ECC agents, hooks, commands, or harness runners".to_string(),
                target_surface: "ECC agents / hooks / commands / harness runners".to_string(),
                source_paths: artifact.source_paths.clone(),
                command_snippets: vec![
                    format!(
                        "ecc migrate import-tools --source {} --output-dir migration-artifacts/tools",
                        shell_quote_double(&audit.source)
                    ),
                    "ecc template <template-name> --task \"Rebuild one legacy tool as an ECC-native command, hook, or harness runner\"".to_string(),
                ],
                config_snippets: vec![
                    "[harness_runners.legacy-runner]\nprogram = \"<runner-binary>\"\nbase_args = []\nproject_markers = [\".legacy-runner\"]".to_string(),
                ],
                notes: artifact.notes.clone(),
            },
            "plugins" => LegacyMigrationPlanStep {
                category: artifact.category.clone(),
                readiness: artifact.readiness,
                title: "Translate legacy bridge plugins into ECC-native automation".to_string(),
                target_surface: "ECC hooks / commands / skills".to_string(),
                source_paths: artifact.source_paths.clone(),
                command_snippets: vec![
                    format!(
                        "ecc migrate import-plugins --source {} --output-dir migration-artifacts/plugins",
                        shell_quote_double(&audit.source)
                    ),
                    "ecc template <template-name> --task \"Port one bridge plugin behavior into an ECC hook, command, or skill\"".to_string(),
                ],
                config_snippets: Vec::new(),
                notes: artifact.notes.clone(),
            },
            "env_services" => LegacyMigrationPlanStep {
                category: artifact.category.clone(),
                readiness: artifact.readiness,
                title: "Reconfigure local auth and connectors without importing secrets".to_string(),
                target_surface: "Claude connectors / MCP / local API key setup".to_string(),
                source_paths: artifact.source_paths.clone(),
                command_snippets: vec![
                    format!(
                        "ecc migrate import-env --source {} --dry-run",
                        shell_quote_double(&audit.source)
                    ),
                    format!(
                        "ecc migrate import-env --source {}",
                        shell_quote_double(&audit.source)
                    ),
                    "ecc graph recall \"<service or env key>\"".to_string(),
                ],
                config_snippets: vec![
                    "# Re-enter connector auth locally; do not copy legacy secrets into ECC2.\n# Typical targets: Google Drive OAuth, GitHub, Stripe, Linear, browser creds.".to_string(),
                ],
                notes: artifact.notes.clone(),
            },
            _ => LegacyMigrationPlanStep {
                category: artifact.category.clone(),
                readiness: artifact.readiness,
                title: format!("Review legacy {} surface", artifact.category),
                target_surface: "Manual ECC2 translation".to_string(),
                source_paths: artifact.source_paths.clone(),
                command_snippets: Vec::new(),
                config_snippets: Vec::new(),
                notes: artifact.notes.clone(),
            },
        };
        steps.push(step);
    }

    LegacyMigrationPlanReport {
        source: audit.source.clone(),
        generated_at: chrono::Utc::now().to_rfc3339(),
        audit_summary: audit.summary.clone(),
        steps,
    }
}

fn write_legacy_migration_scaffold(
    plan: &LegacyMigrationPlanReport,
    output_dir: &Path,
) -> Result<LegacyMigrationScaffoldReport> {
    fs::create_dir_all(output_dir).with_context(|| {
        format!(
            "create migration scaffold output directory: {}",
            output_dir.display()
        )
    })?;

    let plan_path = output_dir.join("migration-plan.md");
    let config_path = output_dir.join("ecc2.migration.toml");

    fs::write(&plan_path, format_legacy_migration_plan_human(plan))
        .with_context(|| format!("write migration plan: {}", plan_path.display()))?;
    fs::write(&config_path, render_legacy_migration_config_scaffold(plan))
        .with_context(|| format!("write migration config scaffold: {}", config_path.display()))?;

    Ok(LegacyMigrationScaffoldReport {
        source: plan.source.clone(),
        output_dir: output_dir.display().to_string(),
        files_written: vec![
            plan_path.display().to_string(),
            config_path.display().to_string(),
        ],
        steps_scaffolded: plan.steps.len(),
    })
}

fn render_legacy_migration_config_scaffold(plan: &LegacyMigrationPlanReport) -> String {
    let mut sections = vec![
        format!(
            "# ECC2 migration scaffold generated from {}\n# Review every section before merging it into a real ecc2.toml.",
            plan.source
        ),
    ];

    for step in &plan.steps {
        if step.config_snippets.is_empty() {
            continue;
        }
        sections.push(format!(
            "\n# {} [{} -> {}]",
            step.title,
            format_legacy_migration_readiness(step.readiness),
            step.target_surface
        ));
        for snippet in &step.config_snippets {
            sections.push(snippet.clone());
        }
    }

    sections.join("\n\n")
}

fn format_legacy_migration_audit_human(report: &LegacyMigrationAuditReport) -> String {
    let mut lines = vec![
        format!("Legacy migration audit: {}", report.source),
        format!(
            "Detected systems: {}",
            if report.detected_systems.is_empty() {
                "none".to_string()
            } else {
                report.detected_systems.join(", ")
            }
        ),
        format!(
            "Artifact categories: {} | ready now {} | manual translation {} | local auth {}",
            report.summary.artifact_categories_detected,
            report.summary.ready_now_categories,
            report.summary.manual_translation_categories,
            report.summary.local_auth_required_categories
        ),
    ];

    if report.artifacts.is_empty() {
        lines.push("No recognizable Hermes/OpenClaw migration surfaces found.".to_string());
        return lines.join("\n");
    }

    lines.push(String::new());
    lines.push("Artifacts".to_string());
    for artifact in &report.artifacts {
        lines.push(format!(
            "- {} [{}] | items {}",
            artifact.category,
            format_legacy_migration_readiness(artifact.readiness),
            artifact.detected_items
        ));
        lines.push(format!("  sources {}", artifact.source_paths.join(", ")));
        lines.push(format!("  map to {}", artifact.mapping.join(", ")));
        for note in &artifact.notes {
            lines.push(format!("  note {note}"));
        }
    }

    lines.push(String::new());
    lines.push("Recommended next steps".to_string());
    for step in &report.recommended_next_steps {
        lines.push(format!("- {step}"));
    }

    lines.join("\n")
}

fn format_legacy_migration_readiness(readiness: LegacyMigrationReadiness) -> &'static str {
    match readiness {
        LegacyMigrationReadiness::ReadyNow => "ready_now",
        LegacyMigrationReadiness::ManualTranslation => "manual_translation",
        LegacyMigrationReadiness::LocalAuthRequired => "local_auth_required",
    }
}

fn format_legacy_migration_plan_human(report: &LegacyMigrationPlanReport) -> String {
    let mut lines = vec![
        format!("Legacy migration plan: {}", report.source),
        format!("Generated at: {}", report.generated_at),
        format!(
            "Audit summary: {} categories | ready now {} | manual translation {} | local auth {}",
            report.audit_summary.artifact_categories_detected,
            report.audit_summary.ready_now_categories,
            report.audit_summary.manual_translation_categories,
            report.audit_summary.local_auth_required_categories
        ),
    ];

    if report.steps.is_empty() {
        lines.push("No migration steps generated.".to_string());
        return lines.join("\n");
    }

    lines.push(String::new());
    lines.push("Plan".to_string());
    for step in &report.steps {
        lines.push(format!(
            "- {} [{}] -> {}",
            step.title,
            format_legacy_migration_readiness(step.readiness),
            step.target_surface
        ));
        if !step.source_paths.is_empty() {
            lines.push(format!("  sources {}", step.source_paths.join(", ")));
        }
        for command in &step.command_snippets {
            lines.push(format!("  command {}", command));
        }
        for snippet in &step.config_snippets {
            lines.push("  config".to_string());
            for line in snippet.lines() {
                lines.push(format!("    {}", line));
            }
        }
        for note in &step.notes {
            lines.push(format!("  note {}", note));
        }
    }

    lines.join("\n")
}

fn format_legacy_migration_scaffold_human(report: &LegacyMigrationScaffoldReport) -> String {
    let mut lines = vec![
        format!("Legacy migration scaffold written for {}", report.source),
        format!("- output dir {}", report.output_dir),
        format!("- steps scaffolded {}", report.steps_scaffolded),
        "- files".to_string(),
    ];
    for path in &report.files_written {
        lines.push(format!("  {}", path));
    }
    lines.join("\n")
}

fn format_legacy_schedule_import_human(report: &LegacyScheduleImportReport) -> String {
    let mut lines = vec![
        format!(
            "Legacy schedule import {} for {}",
            if report.dry_run {
                "preview"
            } else {
                "complete"
            },
            report.source
        ),
        format!("- source path {}", report.source_path),
        format!("- jobs detected {}", report.jobs_detected),
        format!("- ready jobs {}", report.ready_jobs),
        format!("- imported jobs {}", report.imported_jobs),
        format!("- disabled jobs {}", report.disabled_jobs),
        format!("- invalid jobs {}", report.invalid_jobs),
        format!("- skipped jobs {}", report.skipped_jobs),
    ];

    if report.jobs.is_empty() {
        lines.push("- no importable cron/jobs.json entries were found".to_string());
        return lines.join("\n");
    }

    lines.push("Jobs".to_string());
    for job in &report.jobs {
        lines.push(format!(
            "- {} [{}]",
            job.job_name,
            match job.status {
                LegacyScheduleImportJobStatus::Ready => "ready",
                LegacyScheduleImportJobStatus::Imported => "imported",
                LegacyScheduleImportJobStatus::Disabled => "disabled",
                LegacyScheduleImportJobStatus::Invalid => "invalid",
                LegacyScheduleImportJobStatus::Skipped => "skipped",
            }
        ));
        if let Some(cron_expr) = job.cron_expr.as_deref() {
            lines.push(format!("  cron {}", cron_expr));
        }
        if let Some(task) = job.task.as_deref() {
            lines.push(format!("  task {}", task));
        }
        if let Some(command) = job.command_snippet.as_deref() {
            lines.push(format!("  command {}", command));
        }
        if let Some(schedule_id) = job.imported_schedule_id {
            lines.push(format!("  schedule {}", schedule_id));
        }
        if let Some(reason) = job.reason.as_deref() {
            lines.push(format!("  note {}", reason));
        }
    }

    lines.join("\n")
}

fn format_legacy_memory_import_human(report: &LegacyMemoryImportReport) -> String {
    let mut lines = vec![
        format!(
            "Legacy workspace memory import complete for {}",
            report.source
        ),
        format!("- connectors detected {}", report.connectors_detected),
        format!("- connectors synced {}", report.report.connectors_synced),
        format!("- records read {}", report.report.records_read),
        format!("- entities upserted {}", report.report.entities_upserted),
        format!("- observations added {}", report.report.observations_added),
        format!("- skipped records {}", report.report.skipped_records),
        format!(
            "- skipped unchanged sources {}",
            report.report.skipped_unchanged_sources
        ),
    ];

    if !report.report.connectors.is_empty() {
        lines.push("Connectors".to_string());
        for connector in &report.report.connectors {
            lines.push(format!(
                "- {} | records {} | entities {} | observations {} | skipped unchanged {}",
                connector.connector_name,
                connector.records_read,
                connector.entities_upserted,
                connector.observations_added,
                connector.skipped_unchanged_sources
            ));
        }
    }

    lines.join("\n")
}

fn format_legacy_env_import_human(report: &LegacyEnvImportReport) -> String {
    let mut lines = vec![
        format!(
            "Legacy env/service import {} for {}",
            if report.dry_run {
                "preview"
            } else {
                "complete"
            },
            report.source
        ),
        format!("- importable sources {}", report.importable_sources),
        format!("- imported sources {}", report.imported_sources),
        format!("- manual reentry sources {}", report.manual_reentry_sources),
        format!("- connectors detected {}", report.connectors_detected),
        format!("- connectors synced {}", report.report.connectors_synced),
        format!("- records read {}", report.report.records_read),
        format!("- entities upserted {}", report.report.entities_upserted),
        format!("- observations added {}", report.report.observations_added),
        format!("- skipped records {}", report.report.skipped_records),
        format!(
            "- skipped unchanged sources {}",
            report.report.skipped_unchanged_sources
        ),
    ];

    if report.sources.is_empty() {
        lines.push("- no recognized env/service migration sources were found".to_string());
        return lines.join("\n");
    }

    lines.push("Sources".to_string());
    for source in &report.sources {
        let status = match source.status {
            LegacyEnvImportSourceStatus::Ready => "ready",
            LegacyEnvImportSourceStatus::Imported => "imported",
            LegacyEnvImportSourceStatus::ManualOnly => "manual",
        };
        lines.push(format!("- {} [{}]", source.source_path, status));
        if let Some(connector_name) = source.connector_name.as_deref() {
            lines.push(format!("  connector {}", connector_name));
        }
        if let Some(reason) = source.reason.as_deref() {
            lines.push(format!("  note {}", reason));
        }
    }

    lines.join("\n")
}

fn format_legacy_skill_import_human(report: &LegacySkillImportReport) -> String {
    let mut lines = vec![
        format!("Legacy skill import complete for {}", report.source),
        format!("- output dir {}", report.output_dir),
        format!("- skills detected {}", report.skills_detected),
        format!("- templates generated {}", report.templates_generated),
    ];

    if !report.files_written.is_empty() {
        lines.push("Files".to_string());
        for path in &report.files_written {
            lines.push(format!("- {}", path));
        }
    }

    if !report.skills.is_empty() {
        lines.push("Skills".to_string());
        for skill in &report.skills {
            lines.push(format!(
                "- {} -> {}",
                skill.source_path, skill.template_name
            ));
            lines.push(format!("  title {}", skill.title));
            lines.push(format!("  summary {}", skill.summary));
        }
    }

    lines.join("\n")
}

fn format_legacy_tool_import_human(report: &LegacyToolImportReport) -> String {
    let mut lines = vec![
        format!("Legacy tool import complete for {}", report.source),
        format!("- output dir {}", report.output_dir),
        format!("- tools detected {}", report.tools_detected),
        format!("- templates generated {}", report.templates_generated),
    ];

    if !report.files_written.is_empty() {
        lines.push("Files".to_string());
        for path in &report.files_written {
            lines.push(format!("- {}", path));
        }
    }

    if !report.tools.is_empty() {
        lines.push("Tools".to_string());
        for tool in &report.tools {
            lines.push(format!("- {} -> {}", tool.source_path, tool.template_name));
            lines.push(format!("  title {}", tool.title));
            lines.push(format!("  summary {}", tool.summary));
            lines.push(format!("  suggested surface {}", tool.suggested_surface));
        }
    }

    lines.join("\n")
}

fn format_legacy_plugin_import_human(report: &LegacyPluginImportReport) -> String {
    let mut lines = vec![
        format!("Legacy plugin import complete for {}", report.source),
        format!("- output dir {}", report.output_dir),
        format!("- plugins detected {}", report.plugins_detected),
        format!("- templates generated {}", report.templates_generated),
    ];

    if !report.files_written.is_empty() {
        lines.push("Files".to_string());
        for path in &report.files_written {
            lines.push(format!("- {}", path));
        }
    }

    if !report.plugins.is_empty() {
        lines.push("Plugins".to_string());
        for plugin in &report.plugins {
            lines.push(format!(
                "- {} -> {}",
                plugin.source_path, plugin.template_name
            ));
            lines.push(format!("  title {}", plugin.title));
            lines.push(format!("  summary {}", plugin.summary));
            lines.push(format!("  suggested surface {}", plugin.suggested_surface));
        }
    }

    lines.join("\n")
}

fn format_legacy_remote_import_human(report: &LegacyRemoteImportReport) -> String {
    let mut lines = vec![
        format!(
            "Legacy remote dispatch import {} for {}",
            if report.dry_run {
                "preview"
            } else {
                "complete"
            },
            report.source
        ),
        format!("- requests detected {}", report.requests_detected),
        format!("- ready requests {}", report.ready_requests),
        format!("- imported requests {}", report.imported_requests),
        format!("- disabled requests {}", report.disabled_requests),
        format!("- invalid requests {}", report.invalid_requests),
        format!("- skipped requests {}", report.skipped_requests),
    ];

    if report.requests.is_empty() {
        lines.push("- no importable gateway JSON/JSONL request entries were found".to_string());
        return lines.join("\n");
    }

    lines.push("Requests".to_string());
    for request in &report.requests {
        let status = match request.status {
            LegacyRemoteImportRequestStatus::Ready => "ready",
            LegacyRemoteImportRequestStatus::Imported => "imported",
            LegacyRemoteImportRequestStatus::Disabled => "disabled",
            LegacyRemoteImportRequestStatus::Invalid => "invalid",
            LegacyRemoteImportRequestStatus::Skipped => "skipped",
        };
        lines.push(format!(
            "- {} [{} / {}]",
            request.request_name, status, request.request_kind
        ));
        lines.push(format!("  source {}", request.source_path));
        if let Some(task) = request.task.as_deref() {
            lines.push(format!("  task {}", task));
        }
        if let Some(goal) = request.goal.as_deref() {
            lines.push(format!("  goal {}", goal));
        }
        if let Some(target_url) = request.target_url.as_deref() {
            lines.push(format!("  target url {}", target_url));
        }
        if let Some(target_session) = request.target_session.as_deref() {
            lines.push(format!("  target {}", target_session));
        }
        if let Some(command) = request.command_snippet.as_deref() {
            lines.push(format!("  command {}", command));
        }
        if let Some(request_id) = request.imported_request_id {
            lines.push(format!("  request {}", request_id));
        }
        if let Some(reason) = request.reason.as_deref() {
            lines.push(format!("  note {}", reason));
        }
    }

    lines.join("\n")
}

fn format_graph_recall_human(
    entries: &[session::ContextGraphRecallEntry],
    session_id: Option<&str>,
    query: &str,
) -> String {
    if entries.is_empty() {
        return format!("No relevant context graph entities found for query: {query}");
    }

    let scope = session_id
        .map(short_session)
        .unwrap_or_else(|| "all sessions".to_string());
    let mut lines = vec![format!(
        "Relevant memory: {} entries for \"{}\" ({scope})",
        entries.len(),
        query
    )];
    for entry in entries {
        let mut line = format!(
            "- #{} [{}] {} | score {} | relations {} | observations {} | priority {}",
            entry.entity.id,
            entry.entity.entity_type,
            entry.entity.name,
            entry.score,
            entry.relation_count,
            entry.observation_count,
            entry.max_observation_priority
        );
        if entry.has_pinned_observation {
            line.push_str(" | pinned");
        }
        if let Some(session_id) = entry.entity.session_id.as_deref() {
            line.push_str(&format!(" | {}", short_session(session_id)));
        }
        lines.push(line);
        if !entry.matched_terms.is_empty() {
            lines.push(format!("  matches {}", entry.matched_terms.join(", ")));
        }
        if let Some(path) = entry.entity.path.as_deref() {
            lines.push(format!("  path {path}"));
        }
        if !entry.entity.summary.is_empty() {
            lines.push(format!("  summary {}", entry.entity.summary));
        }
    }
    lines.join("\n")
}

fn format_graph_compaction_stats_human(
    stats: &session::ContextGraphCompactionStats,
    session_id: Option<&str>,
    keep_observations_per_entity: usize,
) -> String {
    let scope = session_id
        .map(short_session)
        .unwrap_or_else(|| "all sessions".to_string());
    [
        format!(
            "Context graph compaction complete for {scope} (keep {keep_observations_per_entity} observations per entity)"
        ),
        format!("- entities scanned {}", stats.entities_scanned),
        format!(
            "- duplicate observations deleted {}",
            stats.duplicate_observations_deleted
        ),
        format!(
            "- overflow observations deleted {}",
            stats.overflow_observations_deleted
        ),
        format!("- observations retained {}", stats.observations_retained),
    ]
    .join("\n")
}

fn format_graph_connector_sync_stats_human(stats: &GraphConnectorSyncStats) -> String {
    [
        format!("Memory connector sync complete: {}", stats.connector_name),
        format!("- records read {}", stats.records_read),
        format!("- entities upserted {}", stats.entities_upserted),
        format!("- observations added {}", stats.observations_added),
        format!("- skipped records {}", stats.skipped_records),
        format!(
            "- skipped unchanged sources {}",
            stats.skipped_unchanged_sources
        ),
    ]
    .join("\n")
}

fn format_graph_connector_sync_report_human(report: &GraphConnectorSyncReport) -> String {
    let mut lines = vec![
        format!(
            "Memory connector sync complete: {} connector(s)",
            report.connectors_synced
        ),
        format!("- records read {}", report.records_read),
        format!("- entities upserted {}", report.entities_upserted),
        format!("- observations added {}", report.observations_added),
        format!("- skipped records {}", report.skipped_records),
        format!(
            "- skipped unchanged sources {}",
            report.skipped_unchanged_sources
        ),
    ];

    if !report.connectors.is_empty() {
        lines.push(String::new());
        lines.push("Connectors:".to_string());
        for stats in &report.connectors {
            lines.push(format!("- {}", stats.connector_name));
            lines.push(format!("  records read {}", stats.records_read));
            lines.push(format!("  entities upserted {}", stats.entities_upserted));
            lines.push(format!("  observations added {}", stats.observations_added));
            lines.push(format!("  skipped records {}", stats.skipped_records));
            lines.push(format!(
                "  skipped unchanged sources {}",
                stats.skipped_unchanged_sources
            ));
        }
    }

    lines.join("\n")
}

fn format_graph_connector_status_report_human(report: &GraphConnectorStatusReport) -> String {
    let mut lines = vec![format!(
        "Memory connectors: {} configured",
        report.configured_connectors
    )];

    if report.connectors.is_empty() {
        lines.push("- none".to_string());
        return lines.join("\n");
    }

    for connector in &report.connectors {
        lines.push(format!(
            "- {} [{}]",
            connector.connector_name, connector.connector_kind
        ));
        lines.push(format!("  source {}", connector.source_path));
        if connector.recurse {
            lines.push("  recurse true".to_string());
        }
        lines.push(format!("  synced sources {}", connector.synced_sources));
        lines.push(format!(
            "  last synced {}",
            connector
                .last_synced_at
                .map(|value| value.to_rfc3339())
                .unwrap_or_else(|| "never".to_string())
        ));
        if let Some(session_id) = &connector.default_session_id {
            lines.push(format!("  default session {}", session_id));
        }
        if let Some(entity_type) = &connector.default_entity_type {
            lines.push(format!("  default entity type {}", entity_type));
        }
        if let Some(observation_type) = &connector.default_observation_type {
            lines.push(format!("  default observation type {}", observation_type));
        }
    }

    lines.join("\n")
}

fn format_graph_entity_detail_human(detail: &session::ContextGraphEntityDetail) -> String {
    let mut lines = vec![format_graph_entity_human(&detail.entity)];
    lines.push(String::new());
    lines.push(format!("Outgoing relations: {}", detail.outgoing.len()));
    if detail.outgoing.is_empty() {
        lines.push("- none".to_string());
    } else {
        for relation in &detail.outgoing {
            lines.push(format!(
                "- [{}] {} -> #{} {}",
                relation.relation_type,
                detail.entity.name,
                relation.to_entity_id,
                relation.to_entity_name
            ));
            if !relation.summary.is_empty() {
                lines.push(format!("  summary {}", relation.summary));
            }
        }
    }
    lines.push(format!("Incoming relations: {}", detail.incoming.len()));
    if detail.incoming.is_empty() {
        lines.push("- none".to_string());
    } else {
        for relation in &detail.incoming {
            lines.push(format!(
                "- [{}] #{} {} -> {}",
                relation.relation_type,
                relation.from_entity_id,
                relation.from_entity_name,
                detail.entity.name
            ));
            if !relation.summary.is_empty() {
                lines.push(format!("  summary {}", relation.summary));
            }
        }
    }
    lines.join("\n")
}

fn format_graph_sync_stats_human(
    stats: &session::ContextGraphSyncStats,
    session_id: Option<&str>,
) -> String {
    let scope = session_id
        .map(short_session)
        .unwrap_or_else(|| "all sessions".to_string());
    vec![
        format!("Context graph sync complete for {scope}"),
        format!("- sessions scanned {}", stats.sessions_scanned),
        format!("- decisions processed {}", stats.decisions_processed),
        format!("- file events processed {}", stats.file_events_processed),
        format!("- messages processed {}", stats.messages_processed),
    ]
    .join("\n")
}

fn format_merge_queue_human(report: &session::manager::MergeQueueReport) -> String {
    let mut lines = Vec::new();
    lines.push(format!(
        "Merge queue: {} ready / {} blocked",
        report.ready_entries.len(),
        report.blocked_entries.len()
    ));

    if report.ready_entries.is_empty() {
        lines.push("No merge-ready worktrees queued".to_string());
    } else {
        lines.push("Ready".to_string());
        for entry in &report.ready_entries {
            lines.push(format!(
                "- #{} {} [{}] | {} / {} | {}",
                entry.queue_position.unwrap_or(0),
                entry.session_id,
                entry.branch,
                entry.project,
                entry.task_group,
                entry.task
            ));
        }
    }

    if !report.blocked_entries.is_empty() {
        lines.push(String::new());
        lines.push("Blocked".to_string());
        for entry in &report.blocked_entries {
            lines.push(format!(
                "- {} [{}] | {} / {} | {}",
                entry.session_id,
                entry.branch,
                entry.project,
                entry.task_group,
                entry.suggested_action
            ));
            for blocker in entry.blocked_by.iter().take(2) {
                lines.push(format!(
                    "  blocker {} [{}] | {}",
                    blocker.session_id, blocker.branch, blocker.summary
                ));
                for conflict in blocker.conflicts.iter().take(3) {
                    lines.push(format!("    conflict {conflict}"));
                }
                if let Some(preview) = blocker.conflicting_patch_preview.as_ref() {
                    for line in preview.lines().take(6) {
                        lines.push(format!("    {}", line));
                    }
                }
            }
        }
    }

    lines.join("\n")
}

fn build_otel_export(
    db: &session::store::StateStore,
    session_id: Option<&str>,
) -> Result<OtlpExport> {
    let sessions = if let Some(session_id) = session_id {
        vec![db
            .get_session(session_id)?
            .ok_or_else(|| anyhow::anyhow!("Session not found: {session_id}"))?]
    } else {
        db.list_sessions()?
    };

    let mut spans = Vec::new();
    for session in &sessions {
        spans.extend(build_session_otel_spans(db, session)?);
    }

    Ok(OtlpExport {
        resource_spans: vec![OtlpResourceSpans {
            resource: OtlpResource {
                attributes: vec![
                    otlp_string_attr("service.name", "ecc2"),
                    otlp_string_attr("service.version", env!("CARGO_PKG_VERSION")),
                    otlp_string_attr("telemetry.sdk.language", "rust"),
                ],
            },
            scope_spans: vec![OtlpScopeSpans {
                scope: OtlpInstrumentationScope {
                    name: "ecc2".to_string(),
                    version: env!("CARGO_PKG_VERSION").to_string(),
                },
                spans,
            }],
        }],
    })
}

fn build_session_otel_spans(
    db: &session::store::StateStore,
    session: &session::Session,
) -> Result<Vec<OtlpSpan>> {
    let trace_id = otlp_trace_id(&session.id);
    let session_span_id = otlp_span_id(&format!("session:{}", session.id));
    let parent_link = db.latest_task_handoff_source(&session.id)?;
    let session_end = session.updated_at.max(session.created_at);
    let mut spans = vec![OtlpSpan {
        trace_id: trace_id.clone(),
        span_id: session_span_id.clone(),
        parent_span_id: None,
        name: format!("session {}", session.task),
        kind: "SPAN_KIND_INTERNAL".to_string(),
        start_time_unix_nano: otlp_timestamp_nanos(session.created_at),
        end_time_unix_nano: otlp_timestamp_nanos(session_end),
        attributes: vec![
            otlp_string_attr("ecc.session.id", &session.id),
            otlp_string_attr("ecc.session.state", &session.state.to_string()),
            otlp_string_attr("ecc.agent.type", &session.agent_type),
            otlp_string_attr("ecc.session.task", &session.task),
            otlp_string_attr(
                "ecc.working_dir",
                session.working_dir.to_string_lossy().as_ref(),
            ),
            otlp_int_attr("ecc.metrics.input_tokens", session.metrics.input_tokens),
            otlp_int_attr("ecc.metrics.output_tokens", session.metrics.output_tokens),
            otlp_int_attr("ecc.metrics.tokens_used", session.metrics.tokens_used),
            otlp_int_attr("ecc.metrics.tool_calls", session.metrics.tool_calls),
            otlp_int_attr(
                "ecc.metrics.files_changed",
                u64::from(session.metrics.files_changed),
            ),
            otlp_int_attr("ecc.metrics.duration_secs", session.metrics.duration_secs),
            otlp_double_attr("ecc.metrics.cost_usd", session.metrics.cost_usd),
        ],
        links: parent_link
            .into_iter()
            .map(|parent_session_id| OtlpSpanLink {
                trace_id: otlp_trace_id(&parent_session_id),
                span_id: otlp_span_id(&format!("session:{parent_session_id}")),
                attributes: vec![otlp_string_attr(
                    "ecc.parent_session.id",
                    &parent_session_id,
                )],
            })
            .collect(),
        status: otlp_session_status(&session.state),
    }];

    for entry in db.list_tool_logs_for_session(&session.id)? {
        let span_end = chrono::DateTime::parse_from_rfc3339(&entry.timestamp)
            .unwrap_or_else(|_| session.updated_at.into())
            .with_timezone(&chrono::Utc);
        let span_start = span_end - chrono::Duration::milliseconds(entry.duration_ms as i64);

        spans.push(OtlpSpan {
            trace_id: trace_id.clone(),
            span_id: otlp_span_id(&format!("tool:{}:{}", session.id, entry.id)),
            parent_span_id: Some(session_span_id.clone()),
            name: format!("tool {}", entry.tool_name),
            kind: "SPAN_KIND_INTERNAL".to_string(),
            start_time_unix_nano: otlp_timestamp_nanos(span_start),
            end_time_unix_nano: otlp_timestamp_nanos(span_end),
            attributes: vec![
                otlp_string_attr("ecc.session.id", &entry.session_id),
                otlp_string_attr("tool.name", &entry.tool_name),
                otlp_string_attr("tool.input_summary", &entry.input_summary),
                otlp_string_attr("tool.output_summary", &entry.output_summary),
                otlp_string_attr("tool.trigger_summary", &entry.trigger_summary),
                otlp_string_attr("tool.input_params_json", &entry.input_params_json),
                otlp_int_attr("tool.duration_ms", entry.duration_ms),
                otlp_double_attr("tool.risk_score", entry.risk_score),
            ],
            links: Vec::new(),
            status: OtlpSpanStatus {
                code: "STATUS_CODE_UNSET".to_string(),
                message: None,
            },
        });
    }

    Ok(spans)
}

fn otlp_timestamp_nanos(value: chrono::DateTime<chrono::Utc>) -> String {
    value
        .timestamp_nanos_opt()
        .unwrap_or_default()
        .max(0)
        .to_string()
}

fn otlp_trace_id(seed: &str) -> String {
    format!(
        "{:016x}{:016x}",
        fnv1a64(seed.as_bytes()),
        fnv1a64_with_seed(seed.as_bytes(), 1099511628211)
    )
}

fn otlp_span_id(seed: &str) -> String {
    format!("{:016x}", fnv1a64(seed.as_bytes()))
}

fn fnv1a64(bytes: &[u8]) -> u64 {
    fnv1a64_with_seed(bytes, 14695981039346656037)
}

fn fnv1a64_with_seed(bytes: &[u8], offset_basis: u64) -> u64 {
    let mut hash = offset_basis;
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(1099511628211);
    }
    hash
}

fn otlp_string_attr(key: &str, value: &str) -> OtlpKeyValue {
    OtlpKeyValue {
        key: key.to_string(),
        value: OtlpAnyValue {
            string_value: Some(value.to_string()),
            int_value: None,
            double_value: None,
            bool_value: None,
        },
    }
}

fn otlp_int_attr(key: &str, value: u64) -> OtlpKeyValue {
    OtlpKeyValue {
        key: key.to_string(),
        value: OtlpAnyValue {
            string_value: None,
            int_value: Some(value.to_string()),
            double_value: None,
            bool_value: None,
        },
    }
}

fn otlp_double_attr(key: &str, value: f64) -> OtlpKeyValue {
    OtlpKeyValue {
        key: key.to_string(),
        value: OtlpAnyValue {
            string_value: None,
            int_value: None,
            double_value: Some(value),
            bool_value: None,
        },
    }
}

fn otlp_session_status(state: &session::SessionState) -> OtlpSpanStatus {
    match state {
        session::SessionState::Completed => OtlpSpanStatus {
            code: "STATUS_CODE_OK".to_string(),
            message: None,
        },
        session::SessionState::Failed => OtlpSpanStatus {
            code: "STATUS_CODE_ERROR".to_string(),
            message: Some("session failed".to_string()),
        },
        _ => OtlpSpanStatus {
            code: "STATUS_CODE_UNSET".to_string(),
            message: None,
        },
    }
}

fn summarize_coordinate_backlog(
    outcome: &session::manager::CoordinateBacklogOutcome,
) -> CoordinateBacklogPassSummary {
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
                .filter(|item| session::manager::assignment_action_routes_work(item.action))
                .count()
        })
        .sum();
    let total_deferred = total_processed.saturating_sub(total_routed);
    let total_rerouted: usize = outcome
        .rebalanced
        .iter()
        .map(|rebalance| rebalance.rerouted.len())
        .sum();

    let message = if total_routed == 0
        && total_rerouted == 0
        && outcome.remaining_backlog_sessions == 0
    {
        "Backlog already clear".to_string()
    } else {
        format!(
            "Coordinated backlog: processed {} handoff(s) across {} lead(s) ({} routed, {} deferred); rebalanced {} handoff(s) across {} lead(s); remaining {} handoff(s) across {} session(s) [{} absorbable, {} saturated]",
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
        )
    };

    CoordinateBacklogPassSummary {
        pass: 0,
        processed: total_processed,
        routed: total_routed,
        deferred: total_deferred,
        rerouted: total_rerouted,
        dispatched_leads: outcome.dispatched.len(),
        rebalanced_leads: outcome.rebalanced.len(),
        remaining_backlog_sessions: outcome.remaining_backlog_sessions,
        remaining_backlog_messages: outcome.remaining_backlog_messages,
        remaining_absorbable_sessions: outcome.remaining_absorbable_sessions,
        remaining_saturated_sessions: outcome.remaining_saturated_sessions,
        message,
    }
}

fn coordination_status_exit_code(status: &session::manager::CoordinationStatus) -> i32 {
    match status.health {
        session::manager::CoordinationHealth::Healthy => 0,
        session::manager::CoordinationHealth::BacklogAbsorbable => 1,
        session::manager::CoordinationHealth::Saturated
        | session::manager::CoordinationHealth::EscalationRequired => 2,
    }
}

fn send_handoff_message(db: &session::store::StateStore, from_id: &str, to_id: &str) -> Result<()> {
    let from_session = db
        .get_session(from_id)?
        .ok_or_else(|| anyhow::anyhow!("Session not found: {from_id}"))?;
    let context = format!(
        "Delegated from {} [{}] | cwd {}{}",
        short_session(&from_session.id),
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
            .unwrap_or_default()
    );

    comms::send(
        db,
        &from_session.id,
        to_id,
        &comms::MessageType::TaskHandoff {
            task: from_session.task,
            context,
            priority: comms::TaskPriority::Normal,
        },
    )
}

fn parse_template_vars(values: &[String]) -> Result<BTreeMap<String, String>> {
    parse_key_value_pairs(values, "template vars")
}

fn parse_key_value_pairs(values: &[String], label: &str) -> Result<BTreeMap<String, String>> {
    let mut vars = BTreeMap::new();
    for value in values {
        let (key, raw_value) = value
            .split_once('=')
            .ok_or_else(|| anyhow::anyhow!("{label} must use key=value form: {value}"))?;
        let key = key.trim();
        let raw_value = raw_value.trim();
        if key.is_empty() || raw_value.is_empty() {
            anyhow::bail!("{label} must use non-empty key=value form: {value}");
        }
        vars.insert(key.to_string(), raw_value.to_string());
    }
    Ok(vars)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::Config;
    use crate::session::store::StateStore;
    use crate::session::{Session, SessionMetrics, SessionState};
    use chrono::{Duration, Utc};
    use std::fs;
    use std::path::{Path, PathBuf};

    struct TestDir {
        path: PathBuf,
    }

    impl TestDir {
        fn new(label: &str) -> Result<Self> {
            let path =
                std::env::temp_dir().join(format!("ecc2-main-{label}-{}", uuid::Uuid::new_v4()));
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

    fn build_session(id: &str, task: &str, state: SessionState) -> Session {
        let now = Utc::now();
        Session {
            id: id.to_string(),
            task: task.to_string(),
            project: "workspace".to_string(),
            task_group: "general".to_string(),
            agent_type: "claude".to_string(),
            working_dir: PathBuf::from("/tmp/ecc"),
            state,
            pid: None,
            worktree: None,
            created_at: now - Duration::seconds(5),
            updated_at: now,
            last_heartbeat_at: now,
            metrics: SessionMetrics {
                input_tokens: 120,
                output_tokens: 30,
                tokens_used: 150,
                tool_calls: 2,
                files_changed: 1,
                duration_secs: 5,
                cost_usd: 0.42,
            },
        }
    }

    fn attr_value<'a>(attrs: &'a [OtlpKeyValue], key: &str) -> Option<&'a OtlpAnyValue> {
        attrs
            .iter()
            .find(|attr| attr.key == key)
            .map(|attr| &attr.value)
    }

    #[test]
    fn worktree_policy_defaults_to_config_setting() {
        let mut cfg = Config::default();
        let policy = WorktreePolicyArgs::default();

        assert!(policy.resolve(&cfg));

        cfg.auto_create_worktrees = false;
        assert!(!policy.resolve(&cfg));
    }

    #[test]
    fn worktree_policy_explicit_flags_override_config_setting() {
        let mut cfg = Config::default();
        cfg.auto_create_worktrees = false;

        assert!(WorktreePolicyArgs {
            worktree: true,
            no_worktree: false,
        }
        .resolve(&cfg));

        cfg.auto_create_worktrees = true;
        assert!(!WorktreePolicyArgs {
            worktree: false,
            no_worktree: true,
        }
        .resolve(&cfg));
    }

    #[test]
    fn cli_parses_resume_command() {
        let cli = Cli::try_parse_from(["ecc", "resume", "deadbeef"])
            .expect("resume subcommand should parse");

        match cli.command {
            Some(Commands::Resume { session_id }) => assert_eq!(session_id, "deadbeef"),
            _ => panic!("expected resume subcommand"),
        }
    }

    #[test]
    fn cli_parses_export_otel_command() {
        let cli = Cli::try_parse_from([
            "ecc",
            "export-otel",
            "worker-1234",
            "--output",
            "/tmp/ecc-otel.json",
        ])
        .expect("export-otel should parse");

        match cli.command {
            Some(Commands::ExportOtel { session_id, output }) => {
                assert_eq!(session_id.as_deref(), Some("worker-1234"));
                assert_eq!(output.as_deref(), Some(Path::new("/tmp/ecc-otel.json")));
            }
            _ => panic!("expected export-otel subcommand"),
        }
    }

    #[test]
    fn cli_parses_messages_send_command() {
        let cli = Cli::try_parse_from([
            "ecc",
            "messages",
            "send",
            "--from",
            "planner",
            "--to",
            "worker",
            "--kind",
            "query",
            "--text",
            "Need context",
        ])
        .expect("messages send should parse");

        match cli.command {
            Some(Commands::Messages {
                command:
                    MessageCommands::Send {
                        from,
                        to,
                        kind,
                        text,
                        priority,
                        ..
                    },
            }) => {
                assert_eq!(from, "planner");
                assert_eq!(to, "worker");
                assert!(matches!(kind, MessageKindArg::Query));
                assert_eq!(text, "Need context");
                assert_eq!(priority, TaskPriorityArg::Normal);
            }
            _ => panic!("expected messages send subcommand"),
        }
    }

    #[test]
    fn cli_parses_schedule_add_command() {
        let cli = Cli::try_parse_from([
            "ecc",
            "schedule",
            "add",
            "--cron",
            "*/15 * * * *",
            "--task",
            "Check backlog health",
            "--agent",
            "codex",
            "--profile",
            "planner",
            "--project",
            "ecc-core",
            "--task-group",
            "scheduled maintenance",
        ])
        .expect("schedule add should parse");

        match cli.command {
            Some(Commands::Schedule {
                command:
                    ScheduleCommands::Add {
                        cron,
                        task,
                        agent,
                        profile,
                        project,
                        task_group,
                        ..
                    },
            }) => {
                assert_eq!(cron, "*/15 * * * *");
                assert_eq!(task, "Check backlog health");
                assert_eq!(agent.as_deref(), Some("codex"));
                assert_eq!(profile.as_deref(), Some("planner"));
                assert_eq!(project.as_deref(), Some("ecc-core"));
                assert_eq!(task_group.as_deref(), Some("scheduled maintenance"));
            }
            _ => panic!("expected schedule add subcommand"),
        }
    }

    #[test]
    fn cli_parses_remote_computer_use_command() {
        let cli = Cli::try_parse_from([
            "ecc",
            "remote",
            "computer-use",
            "--goal",
            "Confirm the recovery banner",
            "--target-url",
            "https://ecc.tools/account",
            "--context",
            "Use the production flow",
            "--priority",
            "critical",
            "--agent",
            "codex",
            "--profile",
            "browser",
            "--no-worktree",
        ])
        .expect("remote computer-use should parse");

        match cli.command {
            Some(Commands::Remote {
                command:
                    RemoteCommands::ComputerUse {
                        goal,
                        target_url,
                        context,
                        priority,
                        agent,
                        profile,
                        worktree,
                        ..
                    },
            }) => {
                assert_eq!(goal, "Confirm the recovery banner");
                assert_eq!(target_url.as_deref(), Some("https://ecc.tools/account"));
                assert_eq!(context.as_deref(), Some("Use the production flow"));
                assert_eq!(priority, TaskPriorityArg::Critical);
                assert_eq!(agent.as_deref(), Some("codex"));
                assert_eq!(profile.as_deref(), Some("browser"));
                assert!(worktree.no_worktree);
                assert!(!worktree.worktree);
            }
            _ => panic!("expected remote computer-use subcommand"),
        }
    }

    #[test]
    fn cli_parses_start_with_handoff_source() {
        let cli = Cli::try_parse_from([
            "ecc",
            "start",
            "--task",
            "Follow up",
            "--agent",
            "claude",
            "--from-session",
            "planner",
        ])
        .expect("start with handoff source should parse");

        match cli.command {
            Some(Commands::Start {
                from_session,
                task,
                agent,
                ..
            }) => {
                assert_eq!(task, "Follow up");
                assert_eq!(agent.as_deref(), Some("claude"));
                assert_eq!(from_session.as_deref(), Some("planner"));
            }
            _ => panic!("expected start subcommand"),
        }
    }

    #[test]
    fn cli_parses_start_without_agent_override() {
        let cli = Cli::try_parse_from(["ecc", "start", "--task", "Follow up"])
            .expect("start without --agent should parse");

        match cli.command {
            Some(Commands::Start { task, agent, .. }) => {
                assert_eq!(task, "Follow up");
                assert!(agent.is_none());
            }
            _ => panic!("expected start subcommand"),
        }
    }

    #[test]
    fn cli_parses_start_no_worktree_override() {
        let cli = Cli::try_parse_from(["ecc", "start", "--task", "Follow up", "--no-worktree"])
            .expect("start --no-worktree should parse");

        match cli.command {
            Some(Commands::Start { worktree, .. }) => {
                assert!(!worktree.worktree);
                assert!(worktree.no_worktree);
            }
            _ => panic!("expected start subcommand"),
        }
    }

    #[test]
    fn cli_parses_delegate_command() {
        let cli = Cli::try_parse_from([
            "ecc",
            "delegate",
            "planner",
            "--task",
            "Review auth changes",
            "--agent",
            "codex",
        ])
        .expect("delegate should parse");

        match cli.command {
            Some(Commands::Delegate {
                from_session,
                task,
                agent,
                ..
            }) => {
                assert_eq!(from_session, "planner");
                assert_eq!(task.as_deref(), Some("Review auth changes"));
                assert_eq!(agent.as_deref(), Some("codex"));
            }
            _ => panic!("expected delegate subcommand"),
        }
    }

    #[test]
    fn cli_parses_delegate_worktree_override() {
        let cli = Cli::try_parse_from(["ecc", "delegate", "planner", "--worktree"])
            .expect("delegate --worktree should parse");

        match cli.command {
            Some(Commands::Delegate { worktree, .. }) => {
                assert!(worktree.worktree);
                assert!(!worktree.no_worktree);
            }
            _ => panic!("expected delegate subcommand"),
        }
    }

    #[test]
    fn cli_parses_template_command() {
        let cli = Cli::try_parse_from([
            "ecc",
            "template",
            "feature_development",
            "--task",
            "stabilize auth callback",
            "--from-session",
            "lead",
            "--var",
            "component=billing",
            "--var",
            "area=oauth",
        ])
        .expect("template should parse");

        match cli.command {
            Some(Commands::Template {
                name,
                task,
                from_session,
                vars,
            }) => {
                assert_eq!(name, "feature_development");
                assert_eq!(task.as_deref(), Some("stabilize auth callback"));
                assert_eq!(from_session.as_deref(), Some("lead"));
                assert_eq!(
                    vars,
                    vec!["component=billing".to_string(), "area=oauth".to_string(),]
                );
            }
            _ => panic!("expected template subcommand"),
        }
    }

    #[test]
    fn parse_template_vars_builds_map() {
        let vars =
            parse_template_vars(&["component=billing".to_string(), "area=oauth".to_string()])
                .expect("template vars");

        assert_eq!(
            vars,
            BTreeMap::from([
                ("area".to_string(), "oauth".to_string()),
                ("component".to_string(), "billing".to_string()),
            ])
        );
    }

    #[test]
    fn parse_template_vars_rejects_invalid_entries() {
        let error = parse_template_vars(&["missing-delimiter".to_string()])
            .expect_err("invalid template var should fail");

        assert!(
            error
                .to_string()
                .contains("template vars must use key=value form"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn parse_key_value_pairs_rejects_empty_values() {
        let error = parse_key_value_pairs(&["language=".to_string()], "graph metadata")
            .expect_err("invalid metadata should fail");

        assert!(
            error
                .to_string()
                .contains("graph metadata must use non-empty key=value form"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn cli_parses_team_command() {
        let cli = Cli::try_parse_from(["ecc", "team", "planner", "--depth", "3"])
            .expect("team should parse");

        match cli.command {
            Some(Commands::Team { session_id, depth }) => {
                assert_eq!(session_id.as_deref(), Some("planner"));
                assert_eq!(depth, 3);
            }
            _ => panic!("expected team subcommand"),
        }
    }

    #[test]
    fn cli_parses_worktree_status_command() {
        let cli = Cli::try_parse_from(["ecc", "worktree-status", "planner"])
            .expect("worktree-status should parse");

        match cli.command {
            Some(Commands::WorktreeStatus {
                session_id,
                all,
                json,
                patch,
                check,
            }) => {
                assert_eq!(session_id.as_deref(), Some("planner"));
                assert!(!all);
                assert!(!json);
                assert!(!patch);
                assert!(!check);
            }
            _ => panic!("expected worktree-status subcommand"),
        }
    }

    #[test]
    fn cli_parses_worktree_status_json_flag() {
        let cli = Cli::try_parse_from(["ecc", "worktree-status", "--json"])
            .expect("worktree-status --json should parse");

        match cli.command {
            Some(Commands::WorktreeStatus {
                session_id,
                all,
                json,
                patch,
                check,
            }) => {
                assert_eq!(session_id, None);
                assert!(!all);
                assert!(json);
                assert!(!patch);
                assert!(!check);
            }
            _ => panic!("expected worktree-status subcommand"),
        }
    }

    #[test]
    fn cli_parses_worktree_status_all_flag() {
        let cli = Cli::try_parse_from(["ecc", "worktree-status", "--all"])
            .expect("worktree-status --all should parse");

        match cli.command {
            Some(Commands::WorktreeStatus {
                session_id,
                all,
                json,
                patch,
                check,
            }) => {
                assert_eq!(session_id, None);
                assert!(all);
                assert!(!json);
                assert!(!patch);
                assert!(!check);
            }
            _ => panic!("expected worktree-status subcommand"),
        }
    }

    #[test]
    fn cli_parses_worktree_status_session_id_with_all_flag() {
        let err = Cli::try_parse_from(["ecc", "worktree-status", "planner", "--all"])
            .expect("worktree-status planner --all should parse");

        let command = err.command.expect("expected command");
        let Commands::WorktreeStatus {
            session_id, all, ..
        } = command
        else {
            panic!("expected worktree-status subcommand");
        };

        assert_eq!(session_id.as_deref(), Some("planner"));
        assert!(all);
    }

    #[test]
    fn format_worktree_status_reports_human_joins_multiple_reports() {
        let reports = vec![
            WorktreeStatusReport {
                session_id: "sess-a".to_string(),
                task: "first".to_string(),
                session_state: "running".to_string(),
                health: "in_progress".to_string(),
                check_exit_code: 1,
                patch_included: false,
                attached: false,
                path: None,
                branch: None,
                base_branch: None,
                diff_summary: None,
                file_preview: Vec::new(),
                patch_preview: None,
                merge_readiness: None,
            },
            WorktreeStatusReport {
                session_id: "sess-b".to_string(),
                task: "second".to_string(),
                session_state: "stopped".to_string(),
                health: "clear".to_string(),
                check_exit_code: 0,
                patch_included: false,
                attached: false,
                path: None,
                branch: None,
                base_branch: None,
                diff_summary: None,
                file_preview: Vec::new(),
                patch_preview: None,
                merge_readiness: None,
            },
        ];

        let text = format_worktree_status_reports_human(&reports);
        assert!(text.contains("Worktree status for sess-a [running]"));
        assert!(text.contains("Worktree status for sess-b [stopped]"));
        assert!(text.contains("\n\nWorktree status for sess-b [stopped]"));
    }

    #[test]
    fn cli_parses_worktree_status_patch_flag() {
        let cli = Cli::try_parse_from(["ecc", "worktree-status", "--patch"])
            .expect("worktree-status --patch should parse");

        match cli.command {
            Some(Commands::WorktreeStatus {
                session_id,
                all,
                json,
                patch,
                check,
            }) => {
                assert_eq!(session_id, None);
                assert!(!all);
                assert!(!json);
                assert!(patch);
                assert!(!check);
            }
            _ => panic!("expected worktree-status subcommand"),
        }
    }

    #[test]
    fn build_otel_export_includes_session_and_tool_spans() -> Result<()> {
        let tempdir = TestDir::new("otel-export-session")?;
        let db = StateStore::open(&tempdir.path().join("state.db"))?;
        let session = build_session("session-1", "Investigate export", SessionState::Completed);
        db.insert_session(&session)?;
        db.insert_tool_log(
            &session.id,
            "Write",
            "Write src/lib.rs",
            "{\"file\":\"src/lib.rs\"}",
            "Updated file",
            "manual test",
            120,
            0.75,
            &Utc::now().to_rfc3339(),
        )?;

        let export = build_otel_export(&db, Some("session-1"))?;
        let spans = &export.resource_spans[0].scope_spans[0].spans;
        assert_eq!(spans.len(), 2);

        let session_span = spans
            .iter()
            .find(|span| span.parent_span_id.is_none())
            .expect("session root span");
        let tool_span = spans
            .iter()
            .find(|span| span.parent_span_id.is_some())
            .expect("tool child span");

        assert_eq!(session_span.trace_id, tool_span.trace_id);
        assert_eq!(
            tool_span.parent_span_id.as_deref(),
            Some(session_span.span_id.as_str())
        );
        assert_eq!(session_span.status.code, "STATUS_CODE_OK");
        assert_eq!(
            attr_value(&session_span.attributes, "ecc.session.id")
                .and_then(|value| value.string_value.as_deref()),
            Some("session-1")
        );
        assert_eq!(
            attr_value(&tool_span.attributes, "tool.name")
                .and_then(|value| value.string_value.as_deref()),
            Some("Write")
        );
        assert_eq!(
            attr_value(&tool_span.attributes, "tool.duration_ms")
                .and_then(|value| value.int_value.as_deref()),
            Some("120")
        );

        Ok(())
    }

    #[test]
    fn build_otel_export_links_delegated_session_to_parent_trace() -> Result<()> {
        let tempdir = TestDir::new("otel-export-parent-link")?;
        let db = StateStore::open(&tempdir.path().join("state.db"))?;
        let parent = build_session("lead-1", "Lead task", SessionState::Running);
        let child = build_session("worker-1", "Delegated task", SessionState::Running);
        db.insert_session(&parent)?;
        db.insert_session(&child)?;
        db.send_message(
            &parent.id,
            &child.id,
            "{\"task\":\"Delegated task\",\"context\":\"Delegated from lead\"}",
            "task_handoff",
        )?;

        let export = build_otel_export(&db, Some("worker-1"))?;
        let session_span = export.resource_spans[0].scope_spans[0]
            .spans
            .iter()
            .find(|span| span.parent_span_id.is_none())
            .expect("session root span");

        assert_eq!(session_span.links.len(), 1);
        assert_eq!(session_span.links[0].trace_id, otlp_trace_id("lead-1"));
        assert_eq!(
            session_span.links[0].span_id,
            otlp_span_id("session:lead-1")
        );
        assert_eq!(
            attr_value(&session_span.links[0].attributes, "ecc.parent_session.id")
                .and_then(|value| value.string_value.as_deref()),
            Some("lead-1")
        );

        Ok(())
    }

    #[test]
    fn cli_parses_worktree_status_check_flag() {
        let cli = Cli::try_parse_from(["ecc", "worktree-status", "--check"])
            .expect("worktree-status --check should parse");

        match cli.command {
            Some(Commands::WorktreeStatus {
                session_id,
                all,
                json,
                patch,
                check,
            }) => {
                assert_eq!(session_id, None);
                assert!(!all);
                assert!(!json);
                assert!(!patch);
                assert!(check);
            }
            _ => panic!("expected worktree-status subcommand"),
        }
    }

    #[test]
    fn cli_parses_worktree_resolution_flags() {
        let cli =
            Cli::try_parse_from(["ecc", "worktree-resolution", "planner", "--json", "--check"])
                .expect("worktree-resolution flags should parse");

        match cli.command {
            Some(Commands::WorktreeResolution {
                session_id,
                all,
                json,
                check,
            }) => {
                assert_eq!(session_id.as_deref(), Some("planner"));
                assert!(!all);
                assert!(json);
                assert!(check);
            }
            _ => panic!("expected worktree-resolution subcommand"),
        }
    }

    #[test]
    fn cli_parses_worktree_resolution_all_flag() {
        let cli = Cli::try_parse_from(["ecc", "worktree-resolution", "--all"])
            .expect("worktree-resolution --all should parse");

        match cli.command {
            Some(Commands::WorktreeResolution {
                session_id,
                all,
                json,
                check,
            }) => {
                assert!(session_id.is_none());
                assert!(all);
                assert!(!json);
                assert!(!check);
            }
            _ => panic!("expected worktree-resolution subcommand"),
        }
    }

    #[test]
    fn cli_parses_prune_worktrees_json_flag() {
        let cli = Cli::try_parse_from(["ecc", "prune-worktrees", "--json"])
            .expect("prune-worktrees --json should parse");

        match cli.command {
            Some(Commands::PruneWorktrees { json }) => {
                assert!(json);
            }
            _ => panic!("expected prune-worktrees subcommand"),
        }
    }

    #[test]
    fn cli_parses_merge_worktree_flags() {
        let cli = Cli::try_parse_from([
            "ecc",
            "merge-worktree",
            "deadbeef",
            "--json",
            "--keep-worktree",
        ])
        .expect("merge-worktree flags should parse");

        match cli.command {
            Some(Commands::MergeWorktree {
                session_id,
                all,
                json,
                keep_worktree,
            }) => {
                assert_eq!(session_id.as_deref(), Some("deadbeef"));
                assert!(!all);
                assert!(json);
                assert!(keep_worktree);
            }
            _ => panic!("expected merge-worktree subcommand"),
        }
    }

    #[test]
    fn cli_parses_merge_worktree_all_flags() {
        let cli = Cli::try_parse_from(["ecc", "merge-worktree", "--all", "--json"])
            .expect("merge-worktree --all --json should parse");

        match cli.command {
            Some(Commands::MergeWorktree {
                session_id,
                all,
                json,
                keep_worktree,
            }) => {
                assert!(session_id.is_none());
                assert!(all);
                assert!(json);
                assert!(!keep_worktree);
            }
            _ => panic!("expected merge-worktree subcommand"),
        }
    }

    #[test]
    fn cli_parses_merge_queue_json_flag() {
        let cli = Cli::try_parse_from(["ecc", "merge-queue", "--json"])
            .expect("merge-queue --json should parse");

        match cli.command {
            Some(Commands::MergeQueue { json, apply }) => {
                assert!(json);
                assert!(!apply);
            }
            _ => panic!("expected merge-queue subcommand"),
        }
    }

    #[test]
    fn cli_parses_merge_queue_apply_flag() {
        let cli = Cli::try_parse_from(["ecc", "merge-queue", "--apply", "--json"])
            .expect("merge-queue --apply --json should parse");

        match cli.command {
            Some(Commands::MergeQueue { json, apply }) => {
                assert!(json);
                assert!(apply);
            }
            _ => panic!("expected merge-queue subcommand"),
        }
    }

    #[test]
    fn format_worktree_status_human_includes_readiness_and_conflicts() {
        let report = WorktreeStatusReport {
            session_id: "deadbeefcafefeed".to_string(),
            task: "Review merge readiness".to_string(),
            session_state: "running".to_string(),
            health: "conflicted".to_string(),
            check_exit_code: 2,
            patch_included: true,
            attached: true,
            path: Some("/tmp/ecc/wt-1".to_string()),
            branch: Some("ecc/deadbeefcafefeed".to_string()),
            base_branch: Some("main".to_string()),
            diff_summary: Some("Branch 1 file changed, 2 insertions(+)".to_string()),
            file_preview: vec!["Branch M README.md".to_string()],
            patch_preview: Some("--- Branch diff vs main ---\n+hello".to_string()),
            merge_readiness: Some(WorktreeMergeReadinessReport {
                status: "conflicted".to_string(),
                summary: "Merge blocked by 1 conflict(s): README.md".to_string(),
                conflicts: vec!["README.md".to_string()],
            }),
        };

        let text = format_worktree_status_human(&report);
        assert!(text.contains("Worktree status for deadbeef [running]"));
        assert!(text.contains("Branch ecc/deadbeefcafefeed (base main)"));
        assert!(text.contains("Health conflicted"));
        assert!(text.contains("Branch M README.md"));
        assert!(text.contains("Merge blocked by 1 conflict(s): README.md"));
        assert!(text.contains("- conflict README.md"));
        assert!(text.contains("Patch preview"));
        assert!(text.contains("--- Branch diff vs main ---"));
    }

    #[test]
    fn format_worktree_resolution_human_includes_protocol_steps() {
        let report = WorktreeResolutionReport {
            session_id: "deadbeefcafefeed".to_string(),
            task: "Resolve merge conflict".to_string(),
            session_state: "stopped".to_string(),
            attached: true,
            conflicted: true,
            check_exit_code: 2,
            path: Some("/tmp/ecc/wt-1".to_string()),
            branch: Some("ecc/deadbeefcafefeed".to_string()),
            base_branch: Some("main".to_string()),
            summary: "Merge blocked by 1 conflict(s): README.md".to_string(),
            conflicts: vec!["README.md".to_string()],
            resolution_steps: vec![
                "Inspect current patch: ecc worktree-status deadbeefcafefeed --patch".to_string(),
                "Open worktree: cd /tmp/ecc/wt-1".to_string(),
                "Resolve conflicts and stage files: git add <paths>".to_string(),
            ],
        };

        let text = format_worktree_resolution_human(&report);
        assert!(text.contains("Worktree resolution for deadbeef [stopped]"));
        assert!(text.contains("Merge blocked by 1 conflict(s): README.md"));
        assert!(text.contains("Conflicts"));
        assert!(text.contains("- README.md"));
        assert!(text.contains("Resolution steps"));
        assert!(text.contains("1. Inspect current patch"));
    }

    #[test]
    fn worktree_resolution_reports_exit_code_tracks_conflicts() {
        let clear = WorktreeResolutionReport {
            session_id: "clear".to_string(),
            task: "ok".to_string(),
            session_state: "stopped".to_string(),
            attached: false,
            conflicted: false,
            check_exit_code: 0,
            path: None,
            branch: None,
            base_branch: None,
            summary: "No worktree attached".to_string(),
            conflicts: Vec::new(),
            resolution_steps: Vec::new(),
        };
        let conflicted = WorktreeResolutionReport {
            session_id: "conflicted".to_string(),
            task: "resolve".to_string(),
            session_state: "failed".to_string(),
            attached: true,
            conflicted: true,
            check_exit_code: 2,
            path: Some("/tmp/ecc/wt-2".to_string()),
            branch: Some("ecc/conflicted".to_string()),
            base_branch: Some("main".to_string()),
            summary: "Merge blocked by 1 conflict(s): src/lib.rs".to_string(),
            conflicts: vec!["src/lib.rs".to_string()],
            resolution_steps: vec!["Inspect current patch".to_string()],
        };

        assert_eq!(worktree_resolution_reports_exit_code(&[clear]), 0);
        assert_eq!(worktree_resolution_reports_exit_code(&[conflicted]), 2);
    }

    #[test]
    fn format_prune_worktrees_human_reports_cleaned_and_active_sessions() {
        let text = format_prune_worktrees_human(&session::manager::WorktreePruneOutcome {
            cleaned_session_ids: vec!["deadbeefcafefeed".to_string()],
            active_with_worktree_ids: vec!["facefeed12345678".to_string()],
            retained_session_ids: vec!["retain1234567890".to_string()],
        });

        assert!(text.contains("Pruned 1 inactive worktree(s)"));
        assert!(text.contains("- cleaned deadbeef"));
        assert!(text.contains("Skipped 1 active session(s) still holding worktrees"));
        assert!(text.contains("- active facefeed"));
        assert!(text.contains("Deferred 1 inactive worktree(s) still within retention"));
        assert!(text.contains("- retained retain12"));
    }

    #[test]
    fn format_worktree_merge_human_reports_merge_and_cleanup() {
        let text = format_worktree_merge_human(&session::manager::WorktreeMergeOutcome {
            session_id: "deadbeefcafefeed".to_string(),
            branch: "ecc/deadbeef".to_string(),
            base_branch: "main".to_string(),
            already_up_to_date: false,
            cleaned_worktree: true,
        });

        assert!(text.contains("Merged worktree for deadbeef"));
        assert!(text.contains("Branch ecc/deadbeef -> main"));
        assert!(text.contains("Result merged into base"));
        assert!(text.contains("Cleanup removed worktree and branch"));
    }

    #[test]
    fn format_merge_queue_human_reports_ready_and_blocked_entries() {
        let text = format_merge_queue_human(&session::manager::MergeQueueReport {
            ready_entries: vec![session::manager::MergeQueueEntry {
                session_id: "alpha1234".to_string(),
                task: "merge alpha".to_string(),
                project: "ecc".to_string(),
                task_group: "checkout".to_string(),
                branch: "ecc/alpha1234".to_string(),
                base_branch: "main".to_string(),
                state: session::SessionState::Stopped,
                worktree_health: worktree::WorktreeHealth::InProgress,
                dirty: false,
                queue_position: Some(1),
                ready_to_merge: true,
                blocked_by: Vec::new(),
                suggested_action: "merge in queue order #1".to_string(),
            }],
            blocked_entries: vec![session::manager::MergeQueueEntry {
                session_id: "beta5678".to_string(),
                task: "merge beta".to_string(),
                project: "ecc".to_string(),
                task_group: "checkout".to_string(),
                branch: "ecc/beta5678".to_string(),
                base_branch: "main".to_string(),
                state: session::SessionState::Stopped,
                worktree_health: worktree::WorktreeHealth::InProgress,
                dirty: false,
                queue_position: None,
                ready_to_merge: false,
                blocked_by: vec![session::manager::MergeQueueBlocker {
                    session_id: "alpha1234".to_string(),
                    branch: "ecc/alpha1234".to_string(),
                    state: session::SessionState::Stopped,
                    conflicts: vec!["README.md".to_string()],
                    summary: "merge after alpha1234 to avoid branch conflicts".to_string(),
                    conflicting_patch_preview: Some(
                        "--- Branch diff vs main ---\nREADME.md".to_string(),
                    ),
                    blocker_patch_preview: None,
                }],
                suggested_action: "merge after alpha1234".to_string(),
            }],
        });

        assert!(text.contains("Merge queue: 1 ready / 1 blocked"));
        assert!(text.contains("Ready"));
        assert!(text.contains("#1 alpha1234"));
        assert!(text.contains("Blocked"));
        assert!(text.contains("beta5678"));
        assert!(text.contains("blocker alpha1234"));
        assert!(text.contains("conflict README.md"));
    }

    #[test]
    fn format_bulk_worktree_merge_human_reports_summary_and_skips() {
        let text = format_bulk_worktree_merge_human(&session::manager::WorktreeBulkMergeOutcome {
            merged: vec![session::manager::WorktreeMergeOutcome {
                session_id: "deadbeefcafefeed".to_string(),
                branch: "ecc/deadbeefcafefeed".to_string(),
                base_branch: "main".to_string(),
                already_up_to_date: false,
                cleaned_worktree: true,
            }],
            rebased: vec![session::manager::WorktreeRebaseOutcome {
                session_id: "rebased12345678".to_string(),
                branch: "ecc/rebased12345678".to_string(),
                base_branch: "main".to_string(),
                already_up_to_date: false,
            }],
            active_with_worktree_ids: vec!["running12345678".to_string()],
            conflicted_session_ids: vec!["conflict123456".to_string()],
            dirty_worktree_ids: vec!["dirty123456789".to_string()],
            blocked_by_queue_session_ids: vec!["queue123456789".to_string()],
            failures: vec![session::manager::WorktreeMergeFailure {
                session_id: "fail1234567890".to_string(),
                reason: "base branch not checked out".to_string(),
            }],
        });

        assert!(text.contains("Merged 1 ready worktree(s)"));
        assert!(text.contains("- merged ecc/deadbeefcafefeed -> main for deadbeef"));
        assert!(text.contains("Rebased 1 blocked worktree(s) onto their base branch"));
        assert!(text.contains("- rebased ecc/rebased12345678 onto main for rebased1"));
        assert!(text.contains("Skipped 1 active worktree session(s)"));
        assert!(text.contains("Skipped 1 conflicted worktree(s)"));
        assert!(text.contains("Skipped 1 dirty worktree(s)"));
        assert!(text.contains("Blocked 1 worktree(s) on remaining queue conflicts"));
        assert!(text.contains("Encountered 1 merge failure(s)"));
        assert!(text.contains("- failed fail1234: base branch not checked out"));
    }

    #[test]
    fn format_worktree_status_human_handles_missing_worktree() {
        let report = WorktreeStatusReport {
            session_id: "deadbeefcafefeed".to_string(),
            task: "No worktree here".to_string(),
            session_state: "stopped".to_string(),
            health: "clear".to_string(),
            check_exit_code: 0,
            patch_included: true,
            attached: false,
            path: None,
            branch: None,
            base_branch: None,
            diff_summary: None,
            file_preview: Vec::new(),
            patch_preview: None,
            merge_readiness: None,
        };

        let text = format_worktree_status_human(&report);
        assert!(text.contains("Worktree status for deadbeef [stopped]"));
        assert!(text.contains("Task No worktree here"));
        assert!(text.contains("Health clear"));
        assert!(text.contains("No worktree attached"));
    }

    #[test]
    fn worktree_status_exit_code_tracks_health() {
        let clear = WorktreeStatusReport {
            session_id: "a".to_string(),
            task: "clear".to_string(),
            session_state: "idle".to_string(),
            health: "clear".to_string(),
            check_exit_code: 0,
            patch_included: false,
            attached: false,
            path: None,
            branch: None,
            base_branch: None,
            diff_summary: None,
            file_preview: Vec::new(),
            patch_preview: None,
            merge_readiness: None,
        };
        let in_progress = WorktreeStatusReport {
            session_id: "b".to_string(),
            task: "progress".to_string(),
            session_state: "running".to_string(),
            health: "in_progress".to_string(),
            check_exit_code: 1,
            patch_included: false,
            attached: true,
            path: Some("/tmp/ecc/wt-2".to_string()),
            branch: Some("ecc/b".to_string()),
            base_branch: Some("main".to_string()),
            diff_summary: Some("Branch 1 file changed".to_string()),
            file_preview: vec!["Branch M README.md".to_string()],
            patch_preview: None,
            merge_readiness: Some(WorktreeMergeReadinessReport {
                status: "ready".to_string(),
                summary: "Merge ready into main".to_string(),
                conflicts: Vec::new(),
            }),
        };
        let conflicted = WorktreeStatusReport {
            session_id: "c".to_string(),
            task: "conflict".to_string(),
            session_state: "running".to_string(),
            health: "conflicted".to_string(),
            check_exit_code: 2,
            patch_included: false,
            attached: true,
            path: Some("/tmp/ecc/wt-3".to_string()),
            branch: Some("ecc/c".to_string()),
            base_branch: Some("main".to_string()),
            diff_summary: Some("Branch 1 file changed".to_string()),
            file_preview: vec!["Branch M README.md".to_string()],
            patch_preview: None,
            merge_readiness: Some(WorktreeMergeReadinessReport {
                status: "conflicted".to_string(),
                summary: "Merge blocked by 1 conflict(s): README.md".to_string(),
                conflicts: vec!["README.md".to_string()],
            }),
        };

        assert_eq!(worktree_status_exit_code(&clear), 0);
        assert_eq!(worktree_status_exit_code(&in_progress), 1);
        assert_eq!(worktree_status_exit_code(&conflicted), 2);
    }

    #[test]
    fn worktree_status_reports_exit_code_uses_highest_severity() {
        let reports = vec![
            WorktreeStatusReport {
                session_id: "sess-a".to_string(),
                task: "first".to_string(),
                session_state: "running".to_string(),
                health: "clear".to_string(),
                check_exit_code: 0,
                patch_included: false,
                attached: false,
                path: None,
                branch: None,
                base_branch: None,
                diff_summary: None,
                file_preview: Vec::new(),
                patch_preview: None,
                merge_readiness: None,
            },
            WorktreeStatusReport {
                session_id: "sess-b".to_string(),
                task: "second".to_string(),
                session_state: "running".to_string(),
                health: "in_progress".to_string(),
                check_exit_code: 1,
                patch_included: false,
                attached: false,
                path: None,
                branch: None,
                base_branch: None,
                diff_summary: None,
                file_preview: Vec::new(),
                patch_preview: None,
                merge_readiness: None,
            },
            WorktreeStatusReport {
                session_id: "sess-c".to_string(),
                task: "third".to_string(),
                session_state: "running".to_string(),
                health: "conflicted".to_string(),
                check_exit_code: 2,
                patch_included: false,
                attached: false,
                path: None,
                branch: None,
                base_branch: None,
                diff_summary: None,
                file_preview: Vec::new(),
                patch_preview: None,
                merge_readiness: None,
            },
        ];

        assert_eq!(worktree_status_reports_exit_code(&reports), 2);
    }

    #[test]
    fn cli_parses_assign_command() {
        let cli = Cli::try_parse_from([
            "ecc",
            "assign",
            "lead",
            "--task",
            "Review auth changes",
            "--agent",
            "claude",
        ])
        .expect("assign should parse");

        match cli.command {
            Some(Commands::Assign {
                from_session,
                task,
                agent,
                ..
            }) => {
                assert_eq!(from_session, "lead");
                assert_eq!(task, "Review auth changes");
                assert_eq!(agent.as_deref(), Some("claude"));
            }
            _ => panic!("expected assign subcommand"),
        }
    }

    #[test]
    fn cli_parses_drain_inbox_command() {
        let cli = Cli::try_parse_from([
            "ecc",
            "drain-inbox",
            "lead",
            "--agent",
            "claude",
            "--limit",
            "3",
        ])
        .expect("drain-inbox should parse");

        match cli.command {
            Some(Commands::DrainInbox {
                session_id,
                agent,
                limit,
                ..
            }) => {
                assert_eq!(session_id, "lead");
                assert_eq!(agent.as_deref(), Some("claude"));
                assert_eq!(limit, 3);
            }
            _ => panic!("expected drain-inbox subcommand"),
        }
    }

    #[test]
    fn cli_parses_auto_dispatch_command() {
        let cli = Cli::try_parse_from([
            "ecc",
            "auto-dispatch",
            "--agent",
            "claude",
            "--lead-limit",
            "4",
        ])
        .expect("auto-dispatch should parse");

        match cli.command {
            Some(Commands::AutoDispatch {
                agent, lead_limit, ..
            }) => {
                assert_eq!(agent.as_deref(), Some("claude"));
                assert_eq!(lead_limit, 4);
            }
            _ => panic!("expected auto-dispatch subcommand"),
        }
    }

    #[test]
    fn cli_parses_coordinate_backlog_command() {
        let cli = Cli::try_parse_from([
            "ecc",
            "coordinate-backlog",
            "--agent",
            "claude",
            "--lead-limit",
            "7",
        ])
        .expect("coordinate-backlog should parse");

        match cli.command {
            Some(Commands::CoordinateBacklog {
                agent,
                lead_limit,
                check,
                until_healthy,
                max_passes,
                ..
            }) => {
                assert_eq!(agent.as_deref(), Some("claude"));
                assert_eq!(lead_limit, 7);
                assert!(!check);
                assert!(!until_healthy);
                assert_eq!(max_passes, 5);
            }
            _ => panic!("expected coordinate-backlog subcommand"),
        }
    }

    #[test]
    fn cli_parses_coordinate_backlog_until_healthy_flags() {
        let cli = Cli::try_parse_from([
            "ecc",
            "coordinate-backlog",
            "--until-healthy",
            "--max-passes",
            "3",
        ])
        .expect("coordinate-backlog looping flags should parse");

        match cli.command {
            Some(Commands::CoordinateBacklog {
                json,
                until_healthy,
                max_passes,
                ..
            }) => {
                assert!(!json);
                assert!(until_healthy);
                assert_eq!(max_passes, 3);
            }
            _ => panic!("expected coordinate-backlog subcommand"),
        }
    }

    #[test]
    fn cli_parses_coordinate_backlog_json_flag() {
        let cli = Cli::try_parse_from(["ecc", "coordinate-backlog", "--json"])
            .expect("coordinate-backlog --json should parse");

        match cli.command {
            Some(Commands::CoordinateBacklog {
                json,
                check,
                until_healthy,
                max_passes,
                ..
            }) => {
                assert!(json);
                assert!(!check);
                assert!(!until_healthy);
                assert_eq!(max_passes, 5);
            }
            _ => panic!("expected coordinate-backlog subcommand"),
        }
    }

    #[test]
    fn cli_parses_coordinate_backlog_check_flag() {
        let cli = Cli::try_parse_from(["ecc", "coordinate-backlog", "--check"])
            .expect("coordinate-backlog --check should parse");

        match cli.command {
            Some(Commands::CoordinateBacklog {
                json,
                check,
                until_healthy,
                max_passes,
                ..
            }) => {
                assert!(!json);
                assert!(check);
                assert!(!until_healthy);
                assert_eq!(max_passes, 5);
            }
            _ => panic!("expected coordinate-backlog subcommand"),
        }
    }

    #[test]
    fn cli_parses_rebalance_all_command() {
        let cli = Cli::try_parse_from([
            "ecc",
            "rebalance-all",
            "--agent",
            "claude",
            "--lead-limit",
            "6",
        ])
        .expect("rebalance-all should parse");

        match cli.command {
            Some(Commands::RebalanceAll {
                agent, lead_limit, ..
            }) => {
                assert_eq!(agent.as_deref(), Some("claude"));
                assert_eq!(lead_limit, 6);
            }
            _ => panic!("expected rebalance-all subcommand"),
        }
    }

    #[test]
    fn cli_parses_coordination_status_command() {
        let cli = Cli::try_parse_from(["ecc", "coordination-status"])
            .expect("coordination-status should parse");

        match cli.command {
            Some(Commands::CoordinationStatus { json, check }) => {
                assert!(!json);
                assert!(!check);
            }
            _ => panic!("expected coordination-status subcommand"),
        }
    }

    #[test]
    fn cli_parses_log_decision_command() {
        let cli = Cli::try_parse_from([
            "ecc",
            "log-decision",
            "latest",
            "--decision",
            "Use sqlite",
            "--reasoning",
            "It is already embedded",
            "--alternative",
            "json files",
            "--alternative",
            "memory only",
            "--json",
        ])
        .expect("log-decision should parse");

        match cli.command {
            Some(Commands::LogDecision {
                session_id,
                decision,
                reasoning,
                alternatives,
                json,
            }) => {
                assert_eq!(session_id.as_deref(), Some("latest"));
                assert_eq!(decision, "Use sqlite");
                assert_eq!(reasoning, "It is already embedded");
                assert_eq!(alternatives, vec!["json files", "memory only"]);
                assert!(json);
            }
            _ => panic!("expected log-decision subcommand"),
        }
    }

    #[test]
    fn cli_parses_decisions_command() {
        let cli = Cli::try_parse_from(["ecc", "decisions", "--all", "--limit", "5", "--json"])
            .expect("decisions should parse");

        match cli.command {
            Some(Commands::Decisions {
                session_id,
                all,
                json,
                limit,
            }) => {
                assert!(session_id.is_none());
                assert!(all);
                assert!(json);
                assert_eq!(limit, 5);
            }
            _ => panic!("expected decisions subcommand"),
        }
    }

    #[test]
    fn cli_parses_graph_add_entity_command() {
        let cli = Cli::try_parse_from([
            "ecc",
            "graph",
            "add-entity",
            "--session-id",
            "latest",
            "--type",
            "file",
            "--name",
            "dashboard.rs",
            "--path",
            "ecc2/src/tui/dashboard.rs",
            "--summary",
            "Primary TUI surface",
            "--meta",
            "language=rust",
            "--json",
        ])
        .expect("graph add-entity should parse");

        match cli.command {
            Some(Commands::Graph {
                command:
                    GraphCommands::AddEntity {
                        session_id,
                        entity_type,
                        name,
                        path,
                        summary,
                        metadata,
                        json,
                    },
            }) => {
                assert_eq!(session_id.as_deref(), Some("latest"));
                assert_eq!(entity_type, "file");
                assert_eq!(name, "dashboard.rs");
                assert_eq!(path.as_deref(), Some("ecc2/src/tui/dashboard.rs"));
                assert_eq!(summary, "Primary TUI surface");
                assert_eq!(metadata, vec!["language=rust"]);
                assert!(json);
            }
            _ => panic!("expected graph add-entity subcommand"),
        }
    }

    #[test]
    fn cli_parses_graph_sync_command() {
        let cli = Cli::try_parse_from(["ecc", "graph", "sync", "--all", "--limit", "12", "--json"])
            .expect("graph sync should parse");

        match cli.command {
            Some(Commands::Graph {
                command:
                    GraphCommands::Sync {
                        session_id,
                        all,
                        limit,
                        json,
                    },
            }) => {
                assert!(session_id.is_none());
                assert!(all);
                assert_eq!(limit, 12);
                assert!(json);
            }
            _ => panic!("expected graph sync subcommand"),
        }
    }

    #[test]
    fn cli_parses_graph_recall_command() {
        let cli = Cli::try_parse_from([
            "ecc",
            "graph",
            "recall",
            "--session-id",
            "latest",
            "--limit",
            "4",
            "--json",
            "auth callback recovery",
        ])
        .expect("graph recall should parse");

        match cli.command {
            Some(Commands::Graph {
                command:
                    GraphCommands::Recall {
                        session_id,
                        query,
                        limit,
                        json,
                    },
            }) => {
                assert_eq!(session_id.as_deref(), Some("latest"));
                assert_eq!(query, "auth callback recovery");
                assert_eq!(limit, 4);
                assert!(json);
            }
            _ => panic!("expected graph recall subcommand"),
        }
    }

    #[test]
    fn cli_parses_graph_add_observation_command() {
        let cli = Cli::try_parse_from([
            "ecc",
            "graph",
            "add-observation",
            "--session-id",
            "latest",
            "--entity-id",
            "7",
            "--type",
            "completion_summary",
            "--pinned",
            "--summary",
            "Finished auth callback recovery",
            "--detail",
            "tests_run=2",
            "--json",
        ])
        .expect("graph add-observation should parse");

        match cli.command {
            Some(Commands::Graph {
                command:
                    GraphCommands::AddObservation {
                        session_id,
                        entity_id,
                        observation_type,
                        priority,
                        pinned,
                        summary,
                        details,
                        json,
                    },
            }) => {
                assert_eq!(session_id.as_deref(), Some("latest"));
                assert_eq!(entity_id, 7);
                assert_eq!(observation_type, "completion_summary");
                assert!(matches!(priority, ObservationPriorityArg::Normal));
                assert!(pinned);
                assert_eq!(summary, "Finished auth callback recovery");
                assert_eq!(details, vec!["tests_run=2"]);
                assert!(json);
            }
            _ => panic!("expected graph add-observation subcommand"),
        }
    }

    #[test]
    fn cli_parses_graph_pin_observation_command() {
        let cli = Cli::try_parse_from([
            "ecc",
            "graph",
            "pin-observation",
            "--observation-id",
            "42",
            "--json",
        ])
        .expect("graph pin-observation should parse");

        match cli.command {
            Some(Commands::Graph {
                command:
                    GraphCommands::PinObservation {
                        observation_id,
                        json,
                    },
            }) => {
                assert_eq!(observation_id, 42);
                assert!(json);
            }
            _ => panic!("expected graph pin-observation subcommand"),
        }
    }

    #[test]
    fn cli_parses_graph_unpin_observation_command() {
        let cli = Cli::try_parse_from([
            "ecc",
            "graph",
            "unpin-observation",
            "--observation-id",
            "42",
            "--json",
        ])
        .expect("graph unpin-observation should parse");

        match cli.command {
            Some(Commands::Graph {
                command:
                    GraphCommands::UnpinObservation {
                        observation_id,
                        json,
                    },
            }) => {
                assert_eq!(observation_id, 42);
                assert!(json);
            }
            _ => panic!("expected graph unpin-observation subcommand"),
        }
    }

    #[test]
    fn cli_parses_graph_compact_command() {
        let cli = Cli::try_parse_from([
            "ecc",
            "graph",
            "compact",
            "--session-id",
            "latest",
            "--keep-observations-per-entity",
            "6",
            "--json",
        ])
        .expect("graph compact should parse");

        match cli.command {
            Some(Commands::Graph {
                command:
                    GraphCommands::Compact {
                        session_id,
                        keep_observations_per_entity,
                        json,
                    },
            }) => {
                assert_eq!(session_id.as_deref(), Some("latest"));
                assert_eq!(keep_observations_per_entity, 6);
                assert!(json);
            }
            _ => panic!("expected graph compact subcommand"),
        }
    }

    #[test]
    fn cli_parses_graph_connector_sync_command() {
        let cli = Cli::try_parse_from([
            "ecc",
            "graph",
            "connector-sync",
            "hermes_notes",
            "--limit",
            "32",
            "--json",
        ])
        .expect("graph connector-sync should parse");

        match cli.command {
            Some(Commands::Graph {
                command:
                    GraphCommands::ConnectorSync {
                        name,
                        all,
                        limit,
                        json,
                    },
            }) => {
                assert_eq!(name.as_deref(), Some("hermes_notes"));
                assert!(!all);
                assert_eq!(limit, 32);
                assert!(json);
            }
            _ => panic!("expected graph connector-sync subcommand"),
        }
    }

    #[test]
    fn cli_parses_graph_connector_sync_all_command() {
        let cli = Cli::try_parse_from([
            "ecc",
            "graph",
            "connector-sync",
            "--all",
            "--limit",
            "16",
            "--json",
        ])
        .expect("graph connector-sync --all should parse");

        match cli.command {
            Some(Commands::Graph {
                command:
                    GraphCommands::ConnectorSync {
                        name,
                        all,
                        limit,
                        json,
                    },
            }) => {
                assert_eq!(name, None);
                assert!(all);
                assert_eq!(limit, 16);
                assert!(json);
            }
            _ => panic!("expected graph connector-sync --all subcommand"),
        }
    }

    #[test]
    fn cli_parses_graph_connectors_command() {
        let cli = Cli::try_parse_from(["ecc", "graph", "connectors", "--json"])
            .expect("graph connectors should parse");

        match cli.command {
            Some(Commands::Graph {
                command: GraphCommands::Connectors { json },
            }) => {
                assert!(json);
            }
            _ => panic!("expected graph connectors subcommand"),
        }
    }

    #[test]
    fn cli_parses_migrate_audit_command() {
        let cli = Cli::try_parse_from([
            "ecc",
            "migrate",
            "audit",
            "--source",
            "/tmp/hermes",
            "--json",
        ])
        .expect("migrate audit should parse");

        match cli.command {
            Some(Commands::Migrate {
                command: MigrationCommands::Audit { source, json },
            }) => {
                assert_eq!(source, PathBuf::from("/tmp/hermes"));
                assert!(json);
            }
            _ => panic!("expected migrate audit subcommand"),
        }
    }

    #[test]
    fn cli_parses_migrate_plan_command() {
        let cli = Cli::try_parse_from([
            "ecc",
            "migrate",
            "plan",
            "--source",
            "/tmp/hermes",
            "--output",
            "/tmp/plan.md",
        ])
        .expect("migrate plan should parse");

        match cli.command {
            Some(Commands::Migrate {
                command:
                    MigrationCommands::Plan {
                        source,
                        output,
                        json,
                    },
            }) => {
                assert_eq!(source, PathBuf::from("/tmp/hermes"));
                assert_eq!(output, Some(PathBuf::from("/tmp/plan.md")));
                assert!(!json);
            }
            _ => panic!("expected migrate plan subcommand"),
        }
    }

    #[test]
    fn cli_parses_migrate_scaffold_command() {
        let cli = Cli::try_parse_from([
            "ecc",
            "migrate",
            "scaffold",
            "--source",
            "/tmp/hermes",
            "--output-dir",
            "/tmp/migration-scaffold",
            "--json",
        ])
        .expect("migrate scaffold should parse");

        match cli.command {
            Some(Commands::Migrate {
                command:
                    MigrationCommands::Scaffold {
                        source,
                        output_dir,
                        json,
                    },
            }) => {
                assert_eq!(source, PathBuf::from("/tmp/hermes"));
                assert_eq!(output_dir, PathBuf::from("/tmp/migration-scaffold"));
                assert!(json);
            }
            _ => panic!("expected migrate scaffold subcommand"),
        }
    }

    #[test]
    fn cli_parses_migrate_import_schedules_command() {
        let cli = Cli::try_parse_from([
            "ecc",
            "migrate",
            "import-schedules",
            "--source",
            "/tmp/hermes",
            "--dry-run",
            "--json",
        ])
        .expect("migrate import-schedules should parse");

        match cli.command {
            Some(Commands::Migrate {
                command:
                    MigrationCommands::ImportSchedules {
                        source,
                        dry_run,
                        json,
                    },
            }) => {
                assert_eq!(source, PathBuf::from("/tmp/hermes"));
                assert!(dry_run);
                assert!(json);
            }
            _ => panic!("expected migrate import-schedules subcommand"),
        }
    }

    #[test]
    fn cli_parses_migrate_import_memory_command() {
        let cli = Cli::try_parse_from([
            "ecc",
            "migrate",
            "import-memory",
            "--source",
            "/tmp/hermes",
            "--limit",
            "24",
            "--json",
        ])
        .expect("migrate import-memory should parse");

        match cli.command {
            Some(Commands::Migrate {
                command:
                    MigrationCommands::ImportMemory {
                        source,
                        limit,
                        json,
                    },
            }) => {
                assert_eq!(source, PathBuf::from("/tmp/hermes"));
                assert_eq!(limit, 24);
                assert!(json);
            }
            _ => panic!("expected migrate import-memory subcommand"),
        }
    }

    #[test]
    fn cli_parses_migrate_import_env_command() {
        let cli = Cli::try_parse_from([
            "ecc",
            "migrate",
            "import-env",
            "--source",
            "/tmp/hermes",
            "--dry-run",
            "--limit",
            "42",
            "--json",
        ])
        .expect("migrate import-env should parse");

        match cli.command {
            Some(Commands::Migrate {
                command:
                    MigrationCommands::ImportEnv {
                        source,
                        dry_run,
                        limit,
                        json,
                    },
            }) => {
                assert_eq!(source, PathBuf::from("/tmp/hermes"));
                assert!(dry_run);
                assert_eq!(limit, 42);
                assert!(json);
            }
            _ => panic!("expected migrate import-env subcommand"),
        }
    }

    #[test]
    fn cli_parses_migrate_import_skills_command() {
        let cli = Cli::try_parse_from([
            "ecc",
            "migrate",
            "import-skills",
            "--source",
            "/tmp/hermes",
            "--output-dir",
            "/tmp/out",
            "--json",
        ])
        .expect("migrate import-skills should parse");

        match cli.command {
            Some(Commands::Migrate {
                command:
                    MigrationCommands::ImportSkills {
                        source,
                        output_dir,
                        json,
                    },
            }) => {
                assert_eq!(source, PathBuf::from("/tmp/hermes"));
                assert_eq!(output_dir, PathBuf::from("/tmp/out"));
                assert!(json);
            }
            _ => panic!("expected migrate import-skills subcommand"),
        }
    }

    #[test]
    fn cli_parses_migrate_import_tools_command() {
        let cli = Cli::try_parse_from([
            "ecc",
            "migrate",
            "import-tools",
            "--source",
            "/tmp/hermes",
            "--output-dir",
            "/tmp/out",
            "--json",
        ])
        .expect("migrate import-tools should parse");

        match cli.command {
            Some(Commands::Migrate {
                command:
                    MigrationCommands::ImportTools {
                        source,
                        output_dir,
                        json,
                    },
            }) => {
                assert_eq!(source, PathBuf::from("/tmp/hermes"));
                assert_eq!(output_dir, PathBuf::from("/tmp/out"));
                assert!(json);
            }
            _ => panic!("expected migrate import-tools subcommand"),
        }
    }

    #[test]
    fn cli_parses_migrate_import_plugins_command() {
        let cli = Cli::try_parse_from([
            "ecc",
            "migrate",
            "import-plugins",
            "--source",
            "/tmp/hermes",
            "--output-dir",
            "/tmp/out",
            "--json",
        ])
        .expect("migrate import-plugins should parse");

        match cli.command {
            Some(Commands::Migrate {
                command:
                    MigrationCommands::ImportPlugins {
                        source,
                        output_dir,
                        json,
                    },
            }) => {
                assert_eq!(source, PathBuf::from("/tmp/hermes"));
                assert_eq!(output_dir, PathBuf::from("/tmp/out"));
                assert!(json);
            }
            _ => panic!("expected migrate import-plugins subcommand"),
        }
    }

    #[test]
    fn legacy_migration_audit_report_maps_detected_artifacts() -> Result<()> {
        let tempdir = TestDir::new("legacy-migration-audit")?;
        let root = tempdir.path();
        fs::create_dir_all(root.join("cron"))?;
        fs::create_dir_all(root.join("gateway"))?;
        fs::create_dir_all(root.join("workspace/notes"))?;
        fs::create_dir_all(root.join("skills/ecc-imports"))?;
        fs::create_dir_all(root.join("tools"))?;
        fs::create_dir_all(root.join("plugins"))?;
        fs::write(root.join("config.yaml"), "model: claude\n")?;
        fs::write(root.join("cron/scheduler.py"), "print('tick')\n")?;
        fs::write(root.join("jobs.py"), "JOBS = []\n")?;
        fs::write(root.join("gateway/router.py"), "route = True\n")?;
        fs::write(root.join("memory_tool.py"), "class MemoryTool: pass\n")?;
        fs::write(root.join("workspace/notes/recovery.md"), "# recovery\n")?;
        fs::write(root.join("skills/ecc-imports/research.md"), "# skill\n")?;
        fs::write(root.join("tools/browser.py"), "print('browser')\n")?;
        fs::write(root.join("plugins/reminders.py"), "print('reminders')\n")?;
        fs::write(
            root.join(".env.local"),
            "STRIPE_SECRET_KEY=sk_test_secret\n",
        )?;

        let report = build_legacy_migration_audit_report(root)?;

        assert_eq!(report.detected_systems, vec!["hermes"]);
        assert_eq!(report.summary.artifact_categories_detected, 8);
        assert_eq!(report.summary.ready_now_categories, 4);
        assert_eq!(report.summary.manual_translation_categories, 3);
        assert_eq!(report.summary.local_auth_required_categories, 1);
        assert!(report
            .recommended_next_steps
            .iter()
            .any(|step| step.contains("ecc schedule add")));
        assert!(report
            .recommended_next_steps
            .iter()
            .any(|step| step.contains("ecc remote serve")));

        let scheduler = report
            .artifacts
            .iter()
            .find(|artifact| artifact.category == "scheduler")
            .expect("scheduler artifact");
        assert_eq!(scheduler.readiness, LegacyMigrationReadiness::ReadyNow);
        assert_eq!(scheduler.detected_items, 2);

        let env_services = report
            .artifacts
            .iter()
            .find(|artifact| artifact.category == "env_services")
            .expect("env services artifact");
        assert_eq!(
            env_services.readiness,
            LegacyMigrationReadiness::LocalAuthRequired
        );
        assert!(env_services
            .source_paths
            .contains(&"config.yaml".to_string()));
        assert!(env_services
            .source_paths
            .contains(&".env.local".to_string()));

        Ok(())
    }

    #[test]
    fn legacy_migration_plan_report_generates_workspace_connector_step() -> Result<()> {
        let tempdir = TestDir::new("legacy-migration-plan")?;
        let root = tempdir.path();
        fs::create_dir_all(root.join("cron"))?;
        fs::create_dir_all(root.join("gateway"))?;
        fs::create_dir_all(root.join("workspace/notes"))?;
        fs::create_dir_all(root.join("skills/ecc-imports"))?;
        fs::create_dir_all(root.join("tools"))?;
        fs::create_dir_all(root.join("plugins"))?;
        fs::write(root.join("config.yaml"), "model: claude\n")?;
        fs::write(
            root.join("cron/jobs.json"),
            serde_json::json!({
                "jobs": [
                    {
                        "name": "portal-recovery",
                        "cron": "*/15 * * * *",
                        "prompt": "Check portal-first recovery flow",
                        "agent": "codex",
                        "project": "billing-web",
                        "task_group": "recovery",
                        "use_worktree": false
                    },
                    {
                        "name": "paused-job",
                        "cron": "0 12 * * *",
                        "prompt": "This one stays paused",
                        "disabled": true
                    }
                ]
            })
            .to_string(),
        )?;
        fs::write(
            root.join("gateway/dispatch.jsonl"),
            [
                serde_json::json!({
                    "name": "route-account-recovery",
                    "task": "Handle account recovery triage",
                    "priority": "high",
                    "agent": "codex",
                    "project": "ecc-tools",
                    "task_group": "recovery"
                })
                .to_string(),
                serde_json::json!({
                    "name": "browser-billing-check",
                    "kind": "computer_use",
                    "goal": "Verify the billing portal warning banner",
                    "target_url": "https://ecc.tools/account",
                    "context": "Use the production account flow",
                    "priority": "critical",
                    "use_worktree": false
                })
                .to_string(),
                serde_json::json!({
                    "name": "paused-remote",
                    "task": "Do not migrate this now",
                    "disabled": true
                })
                .to_string(),
            ]
            .join("\n"),
        )?;
        fs::write(root.join("workspace/notes/recovery.md"), "# recovery\n")?;
        fs::write(root.join("skills/ecc-imports/research.md"), "# research\n")?;
        fs::create_dir_all(root.join("tools"))?;
        fs::write(
            root.join("tools/browser.py"),
            "# Verify the billing portal banner\nprint('browser')\n",
        )?;
        fs::write(
            root.join("plugins/recovery.py"),
            "# Account recovery command bridge\nprint('recovery')\n",
        )?;

        let audit = build_legacy_migration_audit_report(root)?;
        let plan = build_legacy_migration_plan_report(&audit);

        let workspace_step = plan
            .steps
            .iter()
            .find(|step| step.category == "workspace_memory")
            .expect("workspace memory step");
        assert_eq!(workspace_step.readiness, LegacyMigrationReadiness::ReadyNow);
        assert!(workspace_step
            .config_snippets
            .iter()
            .any(|snippet| snippet.contains("[memory_connectors.hermes_workspace]")));
        assert!(workspace_step
            .command_snippets
            .contains(&"ecc graph connector-sync hermes_workspace".to_string()));

        let scheduler_step = plan
            .steps
            .iter()
            .find(|step| step.category == "scheduler")
            .expect("scheduler step");
        assert!(scheduler_step
            .command_snippets
            .iter()
            .any(|command| command.contains("ecc schedule add --cron \"*/15 * * * *\"")));
        assert!(!scheduler_step
            .command_snippets
            .iter()
            .any(|command| command.contains("<legacy-cron>")));
        assert!(scheduler_step
            .notes
            .iter()
            .any(|note| note.contains("disabled")));

        let gateway_step = plan
            .steps
            .iter()
            .find(|step| step.category == "gateway_dispatch")
            .expect("gateway step");
        assert!(gateway_step
            .command_snippets
            .iter()
            .any(|command| command
                .contains("ecc remote add --task \"Handle account recovery triage\"")));
        assert!(gateway_step
            .command_snippets
            .iter()
            .any(|command| command.contains(
                "ecc remote computer-use --goal \"Verify the billing portal warning banner\""
            )));
        assert!(!gateway_step
            .command_snippets
            .iter()
            .any(|command| command.contains("Translate legacy dispatch workflow")));
        assert!(gateway_step
            .notes
            .iter()
            .any(|note| note.contains("disabled")));

        let rendered = format_legacy_migration_plan_human(&plan);
        assert!(rendered.contains("Legacy migration plan"));
        assert!(rendered.contains("Import sanitized workspace memory through ECC2 connectors"));
        let env_step = plan
            .steps
            .iter()
            .find(|step| step.category == "env_services")
            .expect("env services step");
        assert!(env_step
            .command_snippets
            .iter()
            .any(|command| command.contains("ecc migrate import-env --source")));
        let skills_step = plan
            .steps
            .iter()
            .find(|step| step.category == "skills")
            .expect("skills step");
        assert!(skills_step
            .command_snippets
            .iter()
            .any(|command| command.contains("ecc migrate import-skills --source")));
        let tools_step = plan
            .steps
            .iter()
            .find(|step| step.category == "tools")
            .expect("tools step");
        assert!(tools_step
            .command_snippets
            .iter()
            .any(|command| command.contains("ecc migrate import-tools --source")));
        let plugins_step = plan
            .steps
            .iter()
            .find(|step| step.category == "plugins")
            .expect("plugins step");
        assert!(plugins_step
            .command_snippets
            .iter()
            .any(|command| command.contains("ecc migrate import-plugins --source")));

        Ok(())
    }

    #[test]
    fn import_legacy_schedules_dry_run_reports_ready_disabled_and_invalid_jobs() -> Result<()> {
        let tempdir = TestDir::new("legacy-schedule-import-dry-run")?;
        let root = tempdir.path();
        fs::create_dir_all(root.join("cron"))?;
        fs::write(
            root.join("cron/jobs.json"),
            serde_json::json!({
                "jobs": [
                    {
                        "name": "portal-recovery",
                        "cron": "*/15 * * * *",
                        "prompt": "Check portal-first recovery flow",
                        "agent": "codex",
                        "project": "billing-web",
                        "task_group": "recovery",
                        "use_worktree": false
                    },
                    {
                        "name": "paused-job",
                        "cron": "0 12 * * *",
                        "prompt": "This one stays paused",
                        "disabled": true
                    },
                    {
                        "name": "broken-job",
                        "prompt": "Missing cron"
                    }
                ]
            })
            .to_string(),
        )?;

        let tempdb = TestDir::new("legacy-schedule-import-dry-run-db")?;
        let db = StateStore::open(&tempdb.path().join("state.db"))?;
        let report = import_legacy_schedules(&db, &config::Config::default(), root, true)?;

        assert!(report.dry_run);
        assert_eq!(report.jobs_detected, 3);
        assert_eq!(report.ready_jobs, 1);
        assert_eq!(report.imported_jobs, 0);
        assert_eq!(report.disabled_jobs, 1);
        assert_eq!(report.invalid_jobs, 1);
        assert_eq!(report.skipped_jobs, 0);
        assert_eq!(report.jobs.len(), 3);
        assert!(report
            .jobs
            .iter()
            .any(|job| job.command_snippet.as_deref() == Some("ecc schedule add --cron \"*/15 * * * *\" --task \"Check portal-first recovery flow\" --agent \"codex\" --no-worktree --project \"billing-web\" --task-group \"recovery\"")));

        Ok(())
    }

    #[test]
    fn import_legacy_schedules_creates_real_ecc2_schedules() -> Result<()> {
        let tempdir = TestDir::new("legacy-schedule-import-live")?;
        let root = tempdir.path();
        fs::create_dir_all(root.join("cron"))?;
        fs::write(
            root.join("cron/jobs.json"),
            serde_json::json!({
                "jobs": [
                    {
                        "name": "portal-recovery",
                        "cron": "*/15 * * * *",
                        "prompt": "Check portal-first recovery flow",
                        "agent": "codex",
                        "project": "billing-web",
                        "task_group": "recovery",
                        "use_worktree": false
                    }
                ]
            })
            .to_string(),
        )?;

        let target_repo = tempdir.path().join("target");
        fs::create_dir_all(&target_repo)?;
        fs::write(target_repo.join(".gitignore"), "target\n")?;

        let tempdb = TestDir::new("legacy-schedule-import-live-db")?;
        let db = StateStore::open(&tempdb.path().join("state.db"))?;
        let _cwd_guard = crate::test_support::CurrentDirGuard::enter(&target_repo)?;
        let report = import_legacy_schedules(&db, &config::Config::default(), root, false)?;

        assert!(!report.dry_run);
        assert_eq!(report.ready_jobs, 1);
        assert_eq!(report.imported_jobs, 1);
        assert_eq!(
            report.jobs[0].status,
            LegacyScheduleImportJobStatus::Imported
        );
        assert!(report.jobs[0].imported_schedule_id.is_some());

        let schedules = db.list_scheduled_tasks()?;
        assert_eq!(schedules.len(), 1);
        assert_eq!(schedules[0].task, "Check portal-first recovery flow");
        assert_eq!(schedules[0].agent_type, "codex");
        assert_eq!(schedules[0].project, "billing-web");
        assert_eq!(schedules[0].task_group, "recovery");
        assert!(!schedules[0].use_worktree);
        assert_eq!(
            schedules[0].working_dir.canonicalize()?,
            target_repo.canonicalize()?
        );

        Ok(())
    }

    #[test]
    fn import_legacy_memory_imports_workspace_markdown_and_jsonl() -> Result<()> {
        let tempdir = TestDir::new("legacy-memory-import")?;
        let root = tempdir.path();
        fs::create_dir_all(root.join("workspace/notes"))?;
        fs::create_dir_all(root.join("workspace/memory"))?;
        fs::write(
            root.join("workspace/notes/recovery.md"),
            r#"# Billing incident
Customer wiped setup and got charged twice after reinstalling.

## Portal routing
Route existing installs to portal first before checkout.
"#,
        )?;
        fs::write(
            root.join("workspace/memory/hermes.jsonl"),
            [
                serde_json::json!({
                    "entity_name": "Billing recovery checklist",
                    "summary": "Use portal-first routing before offering checkout again"
                })
                .to_string(),
                serde_json::json!({
                    "entity_name": "Repair before reinstall",
                    "summary": "Recommend ecc repair before purchase flows"
                })
                .to_string(),
            ]
            .join("\n"),
        )?;

        let tempdb = TestDir::new("legacy-memory-import-db")?;
        let db = StateStore::open(&tempdb.path().join("state.db"))?;
        let report = import_legacy_memory(&db, &config::Config::default(), root, 10)?;

        assert_eq!(report.connectors_detected, 2);
        assert_eq!(report.report.connectors_synced, 2);
        assert_eq!(report.report.records_read, 4);
        assert_eq!(report.report.entities_upserted, 4);
        assert_eq!(report.report.observations_added, 4);

        let recalled = db.recall_context_entities(None, "charged twice portal reinstall", 10)?;
        assert!(recalled
            .iter()
            .any(|entry| entry.entity.name == "Billing incident"));
        assert!(recalled
            .iter()
            .any(|entry| entry.entity.name == "Billing recovery checklist"));
        assert!(recalled
            .iter()
            .any(|entry| entry.entity.name == "Repair before reinstall"));

        Ok(())
    }

    #[test]
    fn import_legacy_memory_reports_no_workspace_connectors_when_absent() -> Result<()> {
        let tempdir = TestDir::new("legacy-memory-import-empty")?;
        let root = tempdir.path();
        fs::create_dir_all(root.join("skills"))?;

        let tempdb = TestDir::new("legacy-memory-import-empty-db")?;
        let db = StateStore::open(&tempdb.path().join("state.db"))?;
        let report = import_legacy_memory(&db, &config::Config::default(), root, 10)?;

        assert_eq!(report.connectors_detected, 0);
        assert_eq!(report.report.connectors_synced, 0);
        assert_eq!(report.report.records_read, 0);
        assert_eq!(report.report.entities_upserted, 0);
        assert_eq!(report.report.observations_added, 0);

        Ok(())
    }

    #[test]
    fn import_legacy_remote_dispatch_dry_run_reports_ready_disabled_and_invalid_requests(
    ) -> Result<()> {
        let tempdir = TestDir::new("legacy-remote-import-dry-run")?;
        let root = tempdir.path();
        fs::create_dir_all(root.join("gateway"))?;
        fs::write(
            root.join("gateway/dispatch.json"),
            serde_json::json!({
                "requests": [
                    {
                        "name": "route-account-recovery",
                        "task": "Handle account recovery triage",
                        "priority": "high",
                        "agent": "codex",
                        "project": "ecc-tools",
                        "task_group": "recovery",
                        "use_worktree": false
                    },
                    {
                        "name": "browser-billing-check",
                        "kind": "computer_use",
                        "goal": "Verify the billing portal warning banner",
                        "target_url": "https://ecc.tools/account",
                        "context": "Use the production account flow",
                        "priority": "critical"
                    },
                    {
                        "name": "paused-remote",
                        "task": "Do not migrate this now",
                        "disabled": true
                    },
                    {
                        "name": "broken-remote",
                        "kind": "computer_use",
                        "context": "Missing goal"
                    }
                ]
            })
            .to_string(),
        )?;

        let tempdb = TestDir::new("legacy-remote-import-dry-run-db")?;
        let db = StateStore::open(&tempdb.path().join("state.db"))?;
        let report = import_legacy_remote_dispatch(&db, &Config::default(), root, true)?;

        assert!(report.dry_run);
        assert_eq!(report.requests_detected, 4);
        assert_eq!(report.ready_requests, 2);
        assert_eq!(report.imported_requests, 0);
        assert_eq!(report.disabled_requests, 1);
        assert_eq!(report.invalid_requests, 1);
        assert_eq!(report.skipped_requests, 0);
        assert_eq!(report.requests.len(), 4);
        assert!(report.requests.iter().any(|request| request.command_snippet.as_deref()
            == Some("ecc remote add --task \"Handle account recovery triage\" --priority high --agent \"codex\" --no-worktree --project \"ecc-tools\" --task-group \"recovery\"")));
        assert!(report.requests.iter().any(|request| request.command_snippet.as_deref()
            == Some("ecc remote computer-use --goal \"Verify the billing portal warning banner\" --target-url \"https://ecc.tools/account\" --context \"Use the production account flow\" --priority critical")));

        Ok(())
    }

    #[test]
    fn import_legacy_remote_dispatch_creates_real_pending_requests() -> Result<()> {
        let tempdir = TestDir::new("legacy-remote-import-live")?;
        let root = tempdir.path();
        fs::create_dir_all(root.join("gateway"))?;
        fs::write(
            root.join("gateway/dispatch.jsonl"),
            [
                serde_json::json!({
                    "name": "route-account-recovery",
                    "task": "Handle account recovery triage",
                    "priority": "high",
                    "agent": "codex",
                    "project": "ecc-tools",
                    "task_group": "recovery",
                    "use_worktree": false
                })
                .to_string(),
                serde_json::json!({
                    "name": "browser-billing-check",
                    "kind": "computer_use",
                    "goal": "Verify the billing portal warning banner",
                    "target_url": "https://ecc.tools/account",
                    "context": "Use the production account flow",
                    "priority": "critical",
                    "project": "remote-ops",
                    "task_group": "browser"
                })
                .to_string(),
            ]
            .join("\n"),
        )?;

        let target_repo = tempdir.path().join("target");
        fs::create_dir_all(&target_repo)?;
        fs::write(target_repo.join(".gitignore"), "target\n")?;

        let tempdb = TestDir::new("legacy-remote-import-live-db")?;
        let db = StateStore::open(&tempdb.path().join("state.db"))?;
        let _cwd_guard = crate::test_support::CurrentDirGuard::enter(&target_repo)?;

        let report = import_legacy_remote_dispatch(&db, &Config::default(), root, false)?;

        assert!(!report.dry_run);
        assert_eq!(report.ready_requests, 2);
        assert_eq!(report.imported_requests, 2);
        assert_eq!(
            report.requests[0].status,
            LegacyRemoteImportRequestStatus::Imported
        );
        assert!(report
            .requests
            .iter()
            .all(|request| request.imported_request_id.is_some()));

        let requests = db.list_pending_remote_dispatch_requests(10)?;
        assert_eq!(requests.len(), 2);
        assert_eq!(
            requests[0].request_kind,
            session::RemoteDispatchKind::ComputerUse
        );
        assert_eq!(requests[0].priority, comms::TaskPriority::Critical);
        assert_eq!(requests[0].project, "remote-ops");
        assert_eq!(requests[0].task_group, "browser");
        assert_eq!(
            requests[0].target_url.as_deref(),
            Some("https://ecc.tools/account")
        );
        assert!(requests[0].task.contains("Computer-use task."));
        assert_eq!(
            requests[1].request_kind,
            session::RemoteDispatchKind::Standard
        );
        assert_eq!(requests[1].priority, comms::TaskPriority::High);
        assert_eq!(requests[1].agent_type, "codex");
        assert_eq!(requests[1].project, "ecc-tools");
        assert_eq!(requests[1].task_group, "recovery");
        assert!(!requests[1].use_worktree);
        assert_eq!(requests[1].task, "Handle account recovery triage");
        assert_eq!(
            requests[1].working_dir.canonicalize()?,
            target_repo.canonicalize()?
        );

        Ok(())
    }

    #[test]
    fn import_legacy_env_dry_run_reports_importable_and_manual_sources() -> Result<()> {
        let tempdir = TestDir::new("legacy-env-import-dry-run")?;
        let root = tempdir.path();
        fs::create_dir_all(root.join("services"))?;
        fs::write(
            root.join(".env.local"),
            "STRIPE_SECRET_KEY=sk_test_secret\nPUBLIC_BASE_URL=https://ecc.tools\n",
        )?;
        fs::write(
            root.join(".envrc"),
            "export OPENAI_API_KEY=sk-openai-secret\nexport PUBLIC_DOCS_URL=https://docs.ecc.tools\n",
        )?;
        fs::write(root.join("config.yaml"), "model: claude\n")?;
        fs::write(
            root.join("services").join("billing.json"),
            "{\"port\": 3000}\n",
        )?;

        let tempdb = TestDir::new("legacy-env-import-dry-run-db")?;
        let db = StateStore::open(&tempdb.path().join("state.db"))?;
        let report = import_legacy_env_services(&db, root, true, 10)?;

        assert!(report.dry_run);
        assert_eq!(report.importable_sources, 2);
        assert_eq!(report.imported_sources, 0);
        assert_eq!(report.manual_reentry_sources, 2);
        assert_eq!(report.connectors_detected, 2);
        assert_eq!(report.report.connectors_synced, 0);
        assert_eq!(
            report
                .sources
                .iter()
                .filter(|item| item.status == LegacyEnvImportSourceStatus::Ready)
                .count(),
            2
        );
        assert!(report.sources.iter().any(|item| {
            item.source_path == "config.yaml"
                && item.status == LegacyEnvImportSourceStatus::ManualOnly
        }));
        assert!(report.sources.iter().any(|item| {
            item.source_path == "services" && item.status == LegacyEnvImportSourceStatus::ManualOnly
        }));

        Ok(())
    }

    #[test]
    fn import_legacy_env_imports_safe_context_into_graph() -> Result<()> {
        let tempdir = TestDir::new("legacy-env-import-live")?;
        let root = tempdir.path();
        fs::write(
            root.join(".env.local"),
            "STRIPE_SECRET_KEY=sk_test_secret\nPUBLIC_BASE_URL=https://ecc.tools\n",
        )?;
        fs::write(
            root.join(".env.production"),
            "export OPENAI_API_KEY=sk-openai-secret\nexport PUBLIC_DOCS_URL=https://docs.ecc.tools\n",
        )?;

        let tempdb = TestDir::new("legacy-env-import-live-db")?;
        let db = StateStore::open(&tempdb.path().join("state.db"))?;
        let report = import_legacy_env_services(&db, root, false, 10)?;

        assert!(!report.dry_run);
        assert_eq!(report.importable_sources, 2);
        assert_eq!(report.imported_sources, 2);
        assert_eq!(report.manual_reentry_sources, 0);
        assert_eq!(report.report.connectors_synced, 2);
        assert_eq!(report.report.records_read, 4);
        assert!(report.sources.iter().all(|item| {
            item.status == LegacyEnvImportSourceStatus::Imported
                || item.status == LegacyEnvImportSourceStatus::Ready
        }));

        let recalled = db.recall_context_entities(None, "stripe docs ecc.tools", 10)?;
        assert!(recalled
            .iter()
            .any(|entry| entry.entity.name == "STRIPE_SECRET_KEY"));
        assert!(recalled
            .iter()
            .any(|entry| entry.entity.name == "PUBLIC_BASE_URL"));
        assert!(recalled
            .iter()
            .any(|entry| entry.entity.name == "PUBLIC_DOCS_URL"));

        let secret = recalled
            .iter()
            .find(|entry| entry.entity.name == "STRIPE_SECRET_KEY")
            .expect("secret entry should exist");
        let observations = db.list_context_observations(Some(secret.entity.id), 5)?;
        assert_eq!(
            observations[0]
                .details
                .get("secret_redacted")
                .map(String::as_str),
            Some("true")
        );
        assert!(!observations[0].details.contains_key("value"));

        Ok(())
    }

    #[test]
    fn import_legacy_skills_writes_template_artifacts() -> Result<()> {
        let tempdir = TestDir::new("legacy-skill-import")?;
        let root = tempdir.path();
        fs::create_dir_all(root.join("skills/ecc-imports"))?;
        fs::create_dir_all(root.join("skills/ops"))?;
        fs::write(
            root.join("skills/ecc-imports/research.md"),
            "# Recovery research\nGather billing/account context before touching checkout logic.\n",
        )?;
        fs::write(
            root.join("skills/ops/recovery.markdown"),
            "# Portal repair\nRoute wiped installs toward repair before presenting new checkout.\n",
        )?;

        let output_dir = root.join("out");
        let report = import_legacy_skills(root, &output_dir)?;

        assert_eq!(report.skills_detected, 2);
        assert_eq!(report.templates_generated, 2);
        assert_eq!(report.files_written.len(), 2);
        assert!(report
            .skills
            .iter()
            .any(|skill| skill.template_name == "ecc_imports_research_md"));
        assert!(report
            .skills
            .iter()
            .any(|skill| skill.template_name == "ops_recovery_markdown"));

        let config_text = fs::read_to_string(output_dir.join("ecc2.imported-skills.toml"))?;
        assert!(config_text.contains("[orchestration_templates.ecc_imports_research_md]"));
        assert!(config_text.contains("[orchestration_templates.ops_recovery_markdown]"));
        assert!(config_text.contains("Translate and run that workflow for {{task}}."));

        let summary_text = fs::read_to_string(output_dir.join("imported-skills.md"))?;
        assert!(summary_text.contains("skills/ecc-imports/research.md"));
        assert!(summary_text.contains("skills/ops/recovery.markdown"));

        Ok(())
    }

    #[test]
    fn import_legacy_tools_writes_template_artifacts() -> Result<()> {
        let tempdir = TestDir::new("legacy-tool-import")?;
        let root = tempdir.path();
        fs::create_dir_all(root.join("tools/browser"))?;
        fs::create_dir_all(root.join("tools/hooks"))?;
        fs::write(
            root.join("tools/browser/check_portal.py"),
            "# Verify the billing portal warning banner\nprint('check banner')\n",
        )?;
        fs::write(
            root.join("tools/hooks/preflight.sh"),
            "#!/usr/bin/env bash\n# PretoolUse guard for dangerous commands\nexit 0\n",
        )?;

        let output_dir = root.join("out");
        let report = import_legacy_tools(root, &output_dir)?;

        assert_eq!(report.tools_detected, 2);
        assert_eq!(report.templates_generated, 2);
        assert_eq!(report.files_written.len(), 2);
        assert!(report
            .tools
            .iter()
            .any(|tool| tool.template_name == "tool_browser_check_portal_py"));
        assert!(report
            .tools
            .iter()
            .any(|tool| tool.template_name == "tool_hooks_preflight_sh"));
        assert!(report
            .tools
            .iter()
            .any(|tool| tool.suggested_surface == "command"));
        assert!(report
            .tools
            .iter()
            .any(|tool| tool.suggested_surface == "hook"));

        let config_text = fs::read_to_string(output_dir.join("ecc2.imported-tools.toml"))?;
        assert!(config_text.contains("[orchestration_templates.tool_browser_check_portal_py]"));
        assert!(config_text.contains("[orchestration_templates.tool_hooks_preflight_sh]"));
        assert!(config_text.contains("Rebuild or wrap that behavior as an ECC-native"));

        let summary_text = fs::read_to_string(output_dir.join("imported-tools.md"))?;
        assert!(summary_text.contains("tools/browser/check_portal.py"));
        assert!(summary_text.contains("tools/hooks/preflight.sh"));
        assert!(summary_text.contains("Suggested surface: hook"));

        Ok(())
    }

    #[test]
    fn import_legacy_plugins_writes_template_artifacts() -> Result<()> {
        let tempdir = TestDir::new("legacy-plugin-import")?;
        let root = tempdir.path();
        fs::create_dir_all(root.join("plugins/hooks"))?;
        fs::create_dir_all(root.join("plugins/skills"))?;
        fs::write(
            root.join("plugins/hooks/review.py"),
            "# PostToolUse notifier for risky changes\nprint('review')\n",
        )?;
        fs::write(
            root.join("plugins/skills/recovery.py"),
            "# Recovery skill bridge for wiped setups\nprint('recovery')\n",
        )?;

        let output_dir = root.join("out");
        let report = import_legacy_plugins(root, &output_dir)?;

        assert_eq!(report.plugins_detected, 2);
        assert_eq!(report.templates_generated, 2);
        assert_eq!(report.files_written.len(), 2);
        assert!(report
            .plugins
            .iter()
            .any(|plugin| plugin.template_name == "plugin_hooks_review_py"));
        assert!(report
            .plugins
            .iter()
            .any(|plugin| plugin.template_name == "plugin_skills_recovery_py"));
        assert!(report
            .plugins
            .iter()
            .any(|plugin| plugin.suggested_surface == "hook"));
        assert!(report
            .plugins
            .iter()
            .any(|plugin| plugin.suggested_surface == "skill"));

        let config_text = fs::read_to_string(output_dir.join("ecc2.imported-plugins.toml"))?;
        assert!(config_text.contains("[orchestration_templates.plugin_hooks_review_py]"));
        assert!(config_text.contains("[orchestration_templates.plugin_skills_recovery_py]"));
        assert!(config_text.contains("Port that behavior into an ECC-native"));

        let summary_text = fs::read_to_string(output_dir.join("imported-plugins.md"))?;
        assert!(summary_text.contains("plugins/hooks/review.py"));
        assert!(summary_text.contains("plugins/skills/recovery.py"));
        assert!(summary_text.contains("Suggested surface: skill"));

        Ok(())
    }

    #[test]
    fn legacy_migration_scaffold_writes_plan_and_config_files() -> Result<()> {
        let tempdir = TestDir::new("legacy-migration-scaffold")?;
        let root = tempdir.path();
        fs::create_dir_all(root.join("workspace/notes"))?;
        fs::create_dir_all(root.join("skills/ecc-imports"))?;
        fs::write(root.join("config.yaml"), "model: claude\n")?;
        fs::write(root.join("workspace/notes/recovery.md"), "# recovery\n")?;
        fs::write(root.join("skills/ecc-imports/triage.md"), "# triage\n")?;

        let audit = build_legacy_migration_audit_report(root)?;
        let plan = build_legacy_migration_plan_report(&audit);
        let output_dir = root.join("out");
        let report = write_legacy_migration_scaffold(&plan, &output_dir)?;

        assert_eq!(report.steps_scaffolded, plan.steps.len());
        assert_eq!(report.files_written.len(), 2);

        let plan_text = fs::read_to_string(output_dir.join("migration-plan.md"))?;
        let config_text = fs::read_to_string(output_dir.join("ecc2.migration.toml"))?;
        assert!(plan_text.contains("Legacy migration plan"));
        assert!(config_text.contains("[memory_connectors.hermes_workspace]"));
        assert!(config_text.contains("[orchestration_templates.legacy_workflow]"));

        Ok(())
    }

    #[test]
    fn format_decisions_human_renders_details() {
        let text = format_decisions_human(
            &[session::DecisionLogEntry {
                id: 1,
                session_id: "sess-12345678".to_string(),
                decision: "Use sqlite for the shared context graph".to_string(),
                alternatives: vec!["json files".to_string(), "memory only".to_string()],
                reasoning: "SQLite keeps the audit trail queryable.".to_string(),
                timestamp: chrono::DateTime::parse_from_rfc3339("2026-04-09T01:02:03Z")
                    .unwrap()
                    .with_timezone(&chrono::Utc),
            }],
            true,
        );

        assert!(text.contains("Decision log: 1 entries"));
        assert!(text.contains("sess-123"));
        assert!(text.contains("Use sqlite for the shared context graph"));
        assert!(text.contains("why SQLite keeps the audit trail queryable."));
        assert!(text.contains("alternative json files"));
        assert!(text.contains("alternative memory only"));
    }

    #[test]
    fn format_graph_entity_detail_human_renders_relations() {
        let detail = session::ContextGraphEntityDetail {
            entity: session::ContextGraphEntity {
                id: 7,
                session_id: Some("sess-12345678".to_string()),
                entity_type: "function".to_string(),
                name: "render_metrics".to_string(),
                path: Some("ecc2/src/tui/dashboard.rs".to_string()),
                summary: "Renders the metrics pane".to_string(),
                metadata: BTreeMap::from([("language".to_string(), "rust".to_string())]),
                created_at: chrono::DateTime::parse_from_rfc3339("2026-04-10T01:02:03Z")
                    .unwrap()
                    .with_timezone(&chrono::Utc),
                updated_at: chrono::DateTime::parse_from_rfc3339("2026-04-10T01:02:03Z")
                    .unwrap()
                    .with_timezone(&chrono::Utc),
            },
            outgoing: vec![session::ContextGraphRelation {
                id: 9,
                session_id: Some("sess-12345678".to_string()),
                from_entity_id: 7,
                from_entity_type: "function".to_string(),
                from_entity_name: "render_metrics".to_string(),
                to_entity_id: 10,
                to_entity_type: "type".to_string(),
                to_entity_name: "MetricsSnapshot".to_string(),
                relation_type: "returns".to_string(),
                summary: "Produces the rendered metrics model".to_string(),
                created_at: chrono::DateTime::parse_from_rfc3339("2026-04-10T01:02:03Z")
                    .unwrap()
                    .with_timezone(&chrono::Utc),
            }],
            incoming: vec![session::ContextGraphRelation {
                id: 8,
                session_id: Some("sess-12345678".to_string()),
                from_entity_id: 6,
                from_entity_type: "file".to_string(),
                from_entity_name: "dashboard.rs".to_string(),
                to_entity_id: 7,
                to_entity_type: "function".to_string(),
                to_entity_name: "render_metrics".to_string(),
                relation_type: "contains".to_string(),
                summary: "Dashboard owns the render path".to_string(),
                created_at: chrono::DateTime::parse_from_rfc3339("2026-04-10T01:02:03Z")
                    .unwrap()
                    .with_timezone(&chrono::Utc),
            }],
        };

        let text = format_graph_entity_detail_human(&detail);
        assert!(text.contains("Context graph entity #7"));
        assert!(text.contains("Outgoing relations: 1"));
        assert!(text.contains("[returns] render_metrics -> #10 MetricsSnapshot"));
        assert!(text.contains("Incoming relations: 1"));
        assert!(text.contains("[contains] #6 dashboard.rs -> render_metrics"));
    }

    #[test]
    fn format_graph_recall_human_renders_scores_and_matches() {
        let text = format_graph_recall_human(
            &[session::ContextGraphRecallEntry {
                entity: session::ContextGraphEntity {
                    id: 11,
                    session_id: Some("sess-12345678".to_string()),
                    entity_type: "file".to_string(),
                    name: "callback.ts".to_string(),
                    path: Some("src/routes/auth/callback.ts".to_string()),
                    summary: "Handles auth callback recovery".to_string(),
                    metadata: BTreeMap::new(),
                    created_at: chrono::DateTime::parse_from_rfc3339("2026-04-10T01:02:03Z")
                        .unwrap()
                        .with_timezone(&chrono::Utc),
                    updated_at: chrono::DateTime::parse_from_rfc3339("2026-04-10T01:02:03Z")
                        .unwrap()
                        .with_timezone(&chrono::Utc),
                },
                score: 319,
                matched_terms: vec![
                    "auth".to_string(),
                    "callback".to_string(),
                    "recovery".to_string(),
                ],
                relation_count: 2,
                observation_count: 1,
                max_observation_priority: session::ContextObservationPriority::High,
                has_pinned_observation: true,
            }],
            Some("sess-12345678"),
            "auth callback recovery",
        );

        assert!(text.contains("Relevant memory: 1 entries"));
        assert!(text.contains("[file] callback.ts | score 319 | relations 2 | observations 1"));
        assert!(text.contains("priority high"));
        assert!(text.contains("| pinned"));
        assert!(text.contains("matches auth, callback, recovery"));
        assert!(text.contains("path src/routes/auth/callback.ts"));
    }

    #[test]
    fn format_graph_observations_human_renders_summaries() {
        let text = format_graph_observations_human(&[session::ContextGraphObservation {
            id: 5,
            session_id: Some("sess-12345678".to_string()),
            entity_id: 11,
            entity_type: "session".to_string(),
            entity_name: "sess-12345678".to_string(),
            observation_type: "completion_summary".to_string(),
            priority: session::ContextObservationPriority::High,
            pinned: true,
            summary: "Finished auth callback recovery with 2 tests".to_string(),
            details: BTreeMap::from([("tests_run".to_string(), "2".to_string())]),
            created_at: chrono::DateTime::parse_from_rfc3339("2026-04-10T01:02:03Z")
                .unwrap()
                .with_timezone(&chrono::Utc),
        }]);

        assert!(text.contains("Context graph observations: 1"));
        assert!(text.contains("[completion_summary/high/pinned] sess-12345678"));
        assert!(text.contains("summary Finished auth callback recovery with 2 tests"));
    }

    #[test]
    fn format_graph_compaction_stats_human_renders_counts() {
        let text = format_graph_compaction_stats_human(
            &session::ContextGraphCompactionStats {
                entities_scanned: 3,
                duplicate_observations_deleted: 2,
                overflow_observations_deleted: 4,
                observations_retained: 9,
            },
            Some("sess-12345678"),
            6,
        );

        assert!(text.contains("Context graph compaction complete for sess-123"));
        assert!(text.contains("keep 6 observations per entity"));
        assert!(text.contains("- entities scanned 3"));
        assert!(text.contains("- duplicate observations deleted 2"));
        assert!(text.contains("- overflow observations deleted 4"));
        assert!(text.contains("- observations retained 9"));
    }

    #[test]
    fn format_graph_connector_sync_stats_human_renders_counts() {
        let text = format_graph_connector_sync_stats_human(&GraphConnectorSyncStats {
            connector_name: "hermes_notes".to_string(),
            records_read: 4,
            entities_upserted: 3,
            observations_added: 3,
            skipped_records: 1,
            skipped_unchanged_sources: 2,
        });

        assert!(text.contains("Memory connector sync complete: hermes_notes"));
        assert!(text.contains("- records read 4"));
        assert!(text.contains("- entities upserted 3"));
        assert!(text.contains("- observations added 3"));
        assert!(text.contains("- skipped records 1"));
        assert!(text.contains("- skipped unchanged sources 2"));
    }

    #[test]
    fn format_graph_connector_sync_report_human_renders_totals_and_connectors() {
        let text = format_graph_connector_sync_report_human(&GraphConnectorSyncReport {
            connectors_synced: 2,
            records_read: 7,
            entities_upserted: 5,
            observations_added: 5,
            skipped_records: 2,
            skipped_unchanged_sources: 3,
            connectors: vec![
                GraphConnectorSyncStats {
                    connector_name: "hermes_notes".to_string(),
                    records_read: 4,
                    entities_upserted: 3,
                    observations_added: 3,
                    skipped_records: 1,
                    skipped_unchanged_sources: 2,
                },
                GraphConnectorSyncStats {
                    connector_name: "workspace_note".to_string(),
                    records_read: 3,
                    entities_upserted: 2,
                    observations_added: 2,
                    skipped_records: 1,
                    skipped_unchanged_sources: 1,
                },
            ],
        });

        assert!(text.contains("Memory connector sync complete: 2 connector(s)"));
        assert!(text.contains("- records read 7"));
        assert!(text.contains("- skipped unchanged sources 3"));
        assert!(text.contains("Connectors:"));
        assert!(text.contains("- hermes_notes"));
        assert!(text.contains("- workspace_note"));
        assert!(text.contains("  skipped unchanged sources 2"));
    }

    #[test]
    fn format_graph_connector_status_report_human_renders_connector_details() {
        let text = format_graph_connector_status_report_human(&GraphConnectorStatusReport {
            configured_connectors: 2,
            connectors: vec![
                GraphConnectorStatus {
                    connector_name: "hermes_notes".to_string(),
                    connector_kind: "jsonl_directory".to_string(),
                    source_path: "/tmp/hermes-notes".to_string(),
                    recurse: true,
                    default_session_id: Some("latest".to_string()),
                    default_entity_type: Some("incident".to_string()),
                    default_observation_type: Some("external_note".to_string()),
                    synced_sources: 3,
                    last_synced_at: Some(
                        chrono::DateTime::parse_from_rfc3339("2026-04-10T12:34:56Z")
                            .unwrap()
                            .with_timezone(&chrono::Utc),
                    ),
                },
                GraphConnectorStatus {
                    connector_name: "workspace_env".to_string(),
                    connector_kind: "dotenv_file".to_string(),
                    source_path: "/tmp/.env".to_string(),
                    recurse: false,
                    default_session_id: None,
                    default_entity_type: None,
                    default_observation_type: None,
                    synced_sources: 0,
                    last_synced_at: None,
                },
            ],
        });

        assert!(text.contains("Memory connectors: 2 configured"));
        assert!(text.contains("- hermes_notes [jsonl_directory]"));
        assert!(text.contains("  source /tmp/hermes-notes"));
        assert!(text.contains("  recurse true"));
        assert!(text.contains("  synced sources 3"));
        assert!(text.contains("  last synced 2026-04-10T12:34:56+00:00"));
        assert!(text.contains("  default session latest"));
        assert!(text.contains("  default entity type incident"));
        assert!(text.contains("  default observation type external_note"));
        assert!(text.contains("- workspace_env [dotenv_file]"));
        assert!(text.contains("  last synced never"));
    }

    #[test]
    fn memory_connector_status_report_includes_checkpoint_state() -> Result<()> {
        let tempdir = TestDir::new("graph-connector-status-report")?;
        let db = session::store::StateStore::open(&tempdir.path().join("state.db"))?;

        let markdown_path = tempdir.path().join("workspace-memory.md");
        fs::write(
            &markdown_path,
            r#"# Billing incident
Customer wiped setup and got charged twice after reinstalling.
"#,
        )?;

        let mut cfg = config::Config::default();
        cfg.memory_connectors.insert(
            "workspace_note".to_string(),
            config::MemoryConnectorConfig::MarkdownFile(
                config::MemoryConnectorMarkdownFileConfig {
                    path: markdown_path.clone(),
                    session_id: Some("latest".to_string()),
                    default_entity_type: Some("note_section".to_string()),
                    default_observation_type: Some("external_note".to_string()),
                },
            ),
        );
        cfg.memory_connectors.insert(
            "workspace_env".to_string(),
            config::MemoryConnectorConfig::DotenvFile(config::MemoryConnectorDotenvFileConfig {
                path: tempdir.path().join(".env"),
                session_id: None,
                default_entity_type: Some("service_config".to_string()),
                default_observation_type: Some("external_config".to_string()),
                key_prefixes: vec!["PUBLIC_".to_string()],
                include_keys: Vec::new(),
                exclude_keys: Vec::new(),
                include_safe_values: true,
            }),
        );

        db.upsert_connector_source_checkpoint(
            "workspace_note",
            &markdown_path.display().to_string(),
            "sig-a",
        )?;

        let report = memory_connector_status_report(&db, &cfg)?;
        assert_eq!(report.configured_connectors, 2);
        assert_eq!(
            report
                .connectors
                .iter()
                .map(|connector| connector.connector_name.as_str())
                .collect::<Vec<_>>(),
            vec!["workspace_env", "workspace_note"]
        );

        let workspace_env = report
            .connectors
            .iter()
            .find(|connector| connector.connector_name == "workspace_env")
            .expect("workspace_env connector should exist");
        assert_eq!(workspace_env.connector_kind, "dotenv_file");
        assert_eq!(workspace_env.synced_sources, 0);
        assert!(workspace_env.last_synced_at.is_none());

        let workspace_note = report
            .connectors
            .iter()
            .find(|connector| connector.connector_name == "workspace_note")
            .expect("workspace_note connector should exist");
        assert_eq!(workspace_note.connector_kind, "markdown_file");
        assert_eq!(
            workspace_note.source_path,
            markdown_path.display().to_string()
        );
        assert_eq!(workspace_note.default_session_id.as_deref(), Some("latest"));
        assert_eq!(
            workspace_note.default_entity_type.as_deref(),
            Some("note_section")
        );
        assert_eq!(
            workspace_note.default_observation_type.as_deref(),
            Some("external_note")
        );
        assert_eq!(workspace_note.synced_sources, 1);
        assert!(workspace_note.last_synced_at.is_some());

        Ok(())
    }

    #[test]
    fn sync_memory_connector_imports_jsonl_observations() -> Result<()> {
        let tempdir = TestDir::new("graph-connector-sync")?;
        let db = session::store::StateStore::open(&tempdir.path().join("state.db"))?;
        let now = chrono::Utc::now();
        db.insert_session(&session::Session {
            id: "session-1".to_string(),
            task: "recovery incident".to_string(),
            project: "ecc-tools".to_string(),
            task_group: "incident".to_string(),
            agent_type: "claude".to_string(),
            working_dir: PathBuf::from("/tmp"),
            state: session::SessionState::Running,
            pid: None,
            worktree: None,
            created_at: now,
            updated_at: now,
            last_heartbeat_at: now,
            metrics: session::SessionMetrics::default(),
        })?;

        let connector_path = tempdir.path().join("hermes-memory.jsonl");
        std::fs::write(
            &connector_path,
            [
                serde_json::json!({
                    "entity_name": "Auth callback recovery",
                    "summary": "Customer wiped setup and got charged twice",
                    "details": {"customer": "viktor"}
                })
                .to_string(),
                serde_json::json!({
                    "session_id": "latest",
                    "entity_type": "file",
                    "entity_name": "callback.ts",
                    "path": "src/routes/auth/callback.ts",
                    "observation_type": "incident_note",
                    "summary": "Recovery flow needs portal-first routing"
                })
                .to_string(),
            ]
            .join("\n"),
        )?;

        let mut cfg = config::Config::default();
        cfg.memory_connectors.insert(
            "hermes_notes".to_string(),
            config::MemoryConnectorConfig::JsonlFile(config::MemoryConnectorJsonlFileConfig {
                path: connector_path,
                session_id: Some("latest".to_string()),
                default_entity_type: Some("incident".to_string()),
                default_observation_type: Some("external_note".to_string()),
            }),
        );

        let stats = sync_memory_connector(&db, &cfg, "hermes_notes", 10)?;
        assert_eq!(stats.records_read, 2);
        assert_eq!(stats.entities_upserted, 2);
        assert_eq!(stats.observations_added, 2);
        assert_eq!(stats.skipped_records, 0);

        let recalled = db.recall_context_entities(None, "charged twice routing", 5)?;
        assert_eq!(recalled.len(), 2);
        assert!(recalled
            .iter()
            .any(|entry| entry.entity.name == "Auth callback recovery"));
        assert!(recalled
            .iter()
            .any(|entry| entry.entity.name == "callback.ts"));

        Ok(())
    }

    #[test]
    fn sync_memory_connector_skips_unchanged_jsonl_sources() -> Result<()> {
        let tempdir = TestDir::new("graph-connector-sync-unchanged")?;
        let db = session::store::StateStore::open(&tempdir.path().join("state.db"))?;
        let now = chrono::Utc::now();
        db.insert_session(&session::Session {
            id: "session-1".to_string(),
            task: "recovery incident".to_string(),
            project: "ecc-tools".to_string(),
            task_group: "incident".to_string(),
            agent_type: "claude".to_string(),
            working_dir: PathBuf::from("/tmp"),
            state: session::SessionState::Running,
            pid: None,
            worktree: None,
            created_at: now,
            updated_at: now,
            last_heartbeat_at: now,
            metrics: session::SessionMetrics::default(),
        })?;

        let connector_path = tempdir.path().join("hermes-memory.jsonl");
        fs::write(
            &connector_path,
            serde_json::json!({
                "entity_name": "Portal routing",
                "summary": "Route reinstalls to portal before checkout",
            })
            .to_string(),
        )?;

        let mut cfg = config::Config::default();
        cfg.memory_connectors.insert(
            "hermes_notes".to_string(),
            config::MemoryConnectorConfig::JsonlFile(config::MemoryConnectorJsonlFileConfig {
                path: connector_path,
                session_id: Some("latest".to_string()),
                default_entity_type: Some("incident".to_string()),
                default_observation_type: Some("external_note".to_string()),
            }),
        );

        let first = sync_memory_connector(&db, &cfg, "hermes_notes", 10)?;
        assert_eq!(first.records_read, 1);
        assert_eq!(first.skipped_unchanged_sources, 0);

        let second = sync_memory_connector(&db, &cfg, "hermes_notes", 10)?;
        assert_eq!(second.records_read, 0);
        assert_eq!(second.entities_upserted, 0);
        assert_eq!(second.observations_added, 0);
        assert_eq!(second.skipped_unchanged_sources, 1);

        Ok(())
    }

    #[test]
    fn sync_memory_connector_imports_jsonl_directory_observations() -> Result<()> {
        let tempdir = TestDir::new("graph-connector-sync-dir")?;
        let db = session::store::StateStore::open(&tempdir.path().join("state.db"))?;
        let now = chrono::Utc::now();
        db.insert_session(&session::Session {
            id: "session-1".to_string(),
            task: "recovery incident".to_string(),
            project: "ecc-tools".to_string(),
            task_group: "incident".to_string(),
            agent_type: "claude".to_string(),
            working_dir: PathBuf::from("/tmp"),
            state: session::SessionState::Running,
            pid: None,
            worktree: None,
            created_at: now,
            updated_at: now,
            last_heartbeat_at: now,
            metrics: session::SessionMetrics::default(),
        })?;

        let connector_dir = tempdir.path().join("hermes-memory");
        fs::create_dir_all(connector_dir.join("nested"))?;
        fs::write(
            connector_dir.join("a.jsonl"),
            [
                serde_json::json!({
                    "entity_name": "Auth callback recovery",
                    "summary": "Customer wiped setup and got charged twice",
                })
                .to_string(),
                serde_json::json!({
                    "entity_name": "Portal routing",
                    "summary": "Route existing installs to portal first",
                })
                .to_string(),
            ]
            .join("\n"),
        )?;
        fs::write(
            connector_dir.join("nested").join("b.jsonl"),
            [
                serde_json::json!({
                    "entity_name": "Billing UX note",
                    "summary": "Warn against buying twice after wiping setup",
                })
                .to_string(),
                "{invalid json}".to_string(),
            ]
            .join("\n"),
        )?;
        fs::write(connector_dir.join("ignore.txt"), "not imported")?;

        let mut cfg = config::Config::default();
        cfg.memory_connectors.insert(
            "hermes_dir".to_string(),
            config::MemoryConnectorConfig::JsonlDirectory(
                config::MemoryConnectorJsonlDirectoryConfig {
                    path: connector_dir,
                    recurse: true,
                    session_id: Some("latest".to_string()),
                    default_entity_type: Some("incident".to_string()),
                    default_observation_type: Some("external_note".to_string()),
                },
            ),
        );

        let stats = sync_memory_connector(&db, &cfg, "hermes_dir", 10)?;
        assert_eq!(stats.records_read, 4);
        assert_eq!(stats.entities_upserted, 3);
        assert_eq!(stats.observations_added, 3);
        assert_eq!(stats.skipped_records, 1);

        let recalled = db.recall_context_entities(None, "charged twice portal billing", 10)?;
        assert_eq!(recalled.len(), 3);
        assert!(recalled
            .iter()
            .any(|entry| entry.entity.name == "Auth callback recovery"));
        assert!(recalled
            .iter()
            .any(|entry| entry.entity.name == "Portal routing"));
        assert!(recalled
            .iter()
            .any(|entry| entry.entity.name == "Billing UX note"));

        Ok(())
    }

    #[test]
    fn sync_memory_connector_imports_markdown_file_sections() -> Result<()> {
        let tempdir = TestDir::new("graph-connector-sync-markdown")?;
        let db = session::store::StateStore::open(&tempdir.path().join("state.db"))?;
        let now = chrono::Utc::now();
        db.insert_session(&session::Session {
            id: "session-1".to_string(),
            task: "knowledge import".to_string(),
            project: "everything-claude-code".to_string(),
            task_group: "memory".to_string(),
            agent_type: "claude".to_string(),
            working_dir: PathBuf::from("/tmp"),
            state: session::SessionState::Running,
            pid: None,
            worktree: None,
            created_at: now,
            updated_at: now,
            last_heartbeat_at: now,
            metrics: session::SessionMetrics::default(),
        })?;

        let connector_path = tempdir.path().join("workspace-memory.md");
        fs::write(
            &connector_path,
            r#"# Billing incident
Customer wiped setup and got charged twice after reinstalling.

## Portal routing
Route existing installs to portal first before presenting checkout again.

## Docs fix
Guide users to repair before reinstall so wiped setups do not buy twice.
"#,
        )?;

        let mut cfg = config::Config::default();
        cfg.memory_connectors.insert(
            "workspace_note".to_string(),
            config::MemoryConnectorConfig::MarkdownFile(
                config::MemoryConnectorMarkdownFileConfig {
                    path: connector_path.clone(),
                    session_id: Some("latest".to_string()),
                    default_entity_type: Some("note_section".to_string()),
                    default_observation_type: Some("external_note".to_string()),
                },
            ),
        );

        let stats = sync_memory_connector(&db, &cfg, "workspace_note", 10)?;
        assert_eq!(stats.records_read, 3);
        assert_eq!(stats.entities_upserted, 3);
        assert_eq!(stats.observations_added, 3);
        assert_eq!(stats.skipped_records, 0);

        let recalled = db.recall_context_entities(None, "charged twice reinstall", 10)?;
        assert!(recalled
            .iter()
            .any(|entry| entry.entity.name == "Billing incident"));
        assert!(recalled.iter().any(|entry| entry.entity.name == "Docs fix"));

        let billing = recalled
            .iter()
            .find(|entry| entry.entity.name == "Billing incident")
            .expect("billing section should exist");
        let expected_anchor_path = format!("{}#billing-incident", connector_path.display());
        assert_eq!(
            billing.entity.path.as_deref(),
            Some(expected_anchor_path.as_str())
        );
        let observations = db.list_context_observations(Some(billing.entity.id), 5)?;
        assert_eq!(observations.len(), 1);
        let expected_source_path = connector_path.display().to_string();
        assert_eq!(
            observations[0]
                .details
                .get("source_path")
                .map(String::as_str),
            Some(expected_source_path.as_str())
        );
        assert!(observations[0]
            .details
            .get("body")
            .is_some_and(|value: &String| value.contains("charged twice")));

        Ok(())
    }

    #[test]
    fn sync_memory_connector_imports_markdown_directory_sections() -> Result<()> {
        let tempdir = TestDir::new("graph-connector-sync-markdown-dir")?;
        let db = session::store::StateStore::open(&tempdir.path().join("state.db"))?;
        let now = chrono::Utc::now();
        db.insert_session(&session::Session {
            id: "session-1".to_string(),
            task: "knowledge import".to_string(),
            project: "everything-claude-code".to_string(),
            task_group: "memory".to_string(),
            agent_type: "claude".to_string(),
            working_dir: PathBuf::from("/tmp"),
            state: session::SessionState::Running,
            pid: None,
            worktree: None,
            created_at: now,
            updated_at: now,
            last_heartbeat_at: now,
            metrics: session::SessionMetrics::default(),
        })?;

        let connector_dir = tempdir.path().join("workspace-notes");
        fs::create_dir_all(connector_dir.join("nested"))?;
        fs::write(
            connector_dir.join("incident.md"),
            r#"# Billing incident
Customer wiped setup and got charged twice after reinstalling.

## Portal routing
Route existing installs to portal first before presenting checkout again.
"#,
        )?;
        fs::write(
            connector_dir.join("nested").join("docs.markdown"),
            r#"# Docs fix
Guide users to repair before reinstall so wiped setups do not buy twice.
"#,
        )?;
        fs::write(connector_dir.join("ignore.txt"), "not imported")?;

        let mut cfg = config::Config::default();
        cfg.memory_connectors.insert(
            "workspace_notes".to_string(),
            config::MemoryConnectorConfig::MarkdownDirectory(
                config::MemoryConnectorMarkdownDirectoryConfig {
                    path: connector_dir.clone(),
                    recurse: true,
                    session_id: Some("latest".to_string()),
                    default_entity_type: Some("note_section".to_string()),
                    default_observation_type: Some("external_note".to_string()),
                },
            ),
        );

        let stats = sync_memory_connector(&db, &cfg, "workspace_notes", 10)?;
        assert_eq!(stats.records_read, 3);
        assert_eq!(stats.entities_upserted, 3);
        assert_eq!(stats.observations_added, 3);
        assert_eq!(stats.skipped_records, 0);

        let recalled = db.recall_context_entities(None, "charged twice portal docs", 10)?;
        assert!(recalled
            .iter()
            .any(|entry| entry.entity.name == "Billing incident"));
        assert!(recalled
            .iter()
            .any(|entry| entry.entity.name == "Portal routing"));
        assert!(recalled.iter().any(|entry| entry.entity.name == "Docs fix"));

        let docs_fix = recalled
            .iter()
            .find(|entry| entry.entity.name == "Docs fix")
            .expect("docs section should exist");
        let expected_anchor_path = format!(
            "{}#docs-fix",
            connector_dir.join("nested").join("docs.markdown").display()
        );
        assert_eq!(
            docs_fix.entity.path.as_deref(),
            Some(expected_anchor_path.as_str())
        );

        Ok(())
    }

    #[test]
    fn sync_memory_connector_imports_dotenv_entries_safely() -> Result<()> {
        let tempdir = TestDir::new("graph-connector-sync-dotenv")?;
        let db = session::store::StateStore::open(&tempdir.path().join("state.db"))?;
        let now = chrono::Utc::now();
        db.insert_session(&session::Session {
            id: "session-1".to_string(),
            task: "service config import".to_string(),
            project: "ecc-tools".to_string(),
            task_group: "memory".to_string(),
            agent_type: "claude".to_string(),
            working_dir: PathBuf::from("/tmp"),
            state: session::SessionState::Running,
            pid: None,
            worktree: None,
            created_at: now,
            updated_at: now,
            last_heartbeat_at: now,
            metrics: session::SessionMetrics::default(),
        })?;

        let connector_path = tempdir.path().join("hermes.env");
        fs::write(
            &connector_path,
            r#"# Hermes service config
STRIPE_SECRET_KEY=sk_test_secret
STRIPE_PRO_PRICE_ID=price_pro_monthly
PUBLIC_BASE_URL="https://ecc.tools"
STRIPE_WEBHOOK_SECRET=whsec_secret
GITHUB_TOKEN=ghp_should_not_import
INVALID LINE
"#,
        )?;

        let mut cfg = config::Config::default();
        cfg.memory_connectors.insert(
            "hermes_env".to_string(),
            config::MemoryConnectorConfig::DotenvFile(config::MemoryConnectorDotenvFileConfig {
                path: connector_path.clone(),
                session_id: Some("latest".to_string()),
                default_entity_type: Some("service_config".to_string()),
                default_observation_type: Some("external_config".to_string()),
                key_prefixes: vec!["STRIPE_".to_string(), "PUBLIC_".to_string()],
                include_keys: Vec::new(),
                exclude_keys: vec!["STRIPE_WEBHOOK_SECRET".to_string()],
                include_safe_values: true,
            }),
        );

        let stats = sync_memory_connector(&db, &cfg, "hermes_env", 10)?;
        assert_eq!(stats.records_read, 3);
        assert_eq!(stats.entities_upserted, 3);
        assert_eq!(stats.observations_added, 3);
        assert_eq!(stats.skipped_records, 0);

        let recalled = db.recall_context_entities(None, "stripe ecc.tools", 10)?;
        assert!(recalled
            .iter()
            .any(|entry| entry.entity.name == "STRIPE_SECRET_KEY"));
        assert!(recalled
            .iter()
            .any(|entry| entry.entity.name == "STRIPE_PRO_PRICE_ID"));
        assert!(recalled
            .iter()
            .any(|entry| entry.entity.name == "PUBLIC_BASE_URL"));
        assert!(!recalled
            .iter()
            .any(|entry| entry.entity.name == "STRIPE_WEBHOOK_SECRET"));
        assert!(!recalled
            .iter()
            .any(|entry| entry.entity.name == "GITHUB_TOKEN"));

        let secret = recalled
            .iter()
            .find(|entry| entry.entity.name == "STRIPE_SECRET_KEY")
            .expect("secret entry should exist");
        let secret_observations = db.list_context_observations(Some(secret.entity.id), 5)?;
        assert_eq!(secret_observations.len(), 1);
        assert_eq!(
            secret_observations[0]
                .details
                .get("secret_redacted")
                .map(String::as_str),
            Some("true")
        );
        assert!(!secret_observations[0].details.contains_key("value"));

        let public_base = recalled
            .iter()
            .find(|entry| entry.entity.name == "PUBLIC_BASE_URL")
            .expect("public base url should exist");
        let public_observations = db.list_context_observations(Some(public_base.entity.id), 5)?;
        assert_eq!(public_observations.len(), 1);
        assert_eq!(
            public_observations[0]
                .details
                .get("value")
                .map(String::as_str),
            Some("https://ecc.tools")
        );

        Ok(())
    }

    #[test]
    fn sync_all_memory_connectors_aggregates_results() -> Result<()> {
        let tempdir = TestDir::new("graph-connector-sync-all")?;
        let db = session::store::StateStore::open(&tempdir.path().join("state.db"))?;
        let now = chrono::Utc::now();
        db.insert_session(&session::Session {
            id: "session-1".to_string(),
            task: "memory import".to_string(),
            project: "everything-claude-code".to_string(),
            task_group: "memory".to_string(),
            agent_type: "claude".to_string(),
            working_dir: PathBuf::from("/tmp"),
            state: session::SessionState::Running,
            pid: None,
            worktree: None,
            created_at: now,
            updated_at: now,
            last_heartbeat_at: now,
            metrics: session::SessionMetrics::default(),
        })?;

        let jsonl_path = tempdir.path().join("hermes-memory.jsonl");
        fs::write(
            &jsonl_path,
            serde_json::json!({
                "entity_name": "Portal routing",
                "summary": "Route reinstalls to portal before checkout",
            })
            .to_string(),
        )?;

        let markdown_path = tempdir.path().join("workspace-memory.md");
        fs::write(
            &markdown_path,
            r#"# Billing incident
Customer wiped setup and got charged twice after reinstalling.

## Docs fix
Guide users to repair before reinstall.
"#,
        )?;

        let mut cfg = config::Config::default();
        cfg.memory_connectors.insert(
            "hermes_notes".to_string(),
            config::MemoryConnectorConfig::JsonlFile(config::MemoryConnectorJsonlFileConfig {
                path: jsonl_path,
                session_id: Some("latest".to_string()),
                default_entity_type: Some("incident".to_string()),
                default_observation_type: Some("external_note".to_string()),
            }),
        );
        cfg.memory_connectors.insert(
            "workspace_note".to_string(),
            config::MemoryConnectorConfig::MarkdownFile(
                config::MemoryConnectorMarkdownFileConfig {
                    path: markdown_path,
                    session_id: Some("latest".to_string()),
                    default_entity_type: Some("note_section".to_string()),
                    default_observation_type: Some("external_note".to_string()),
                },
            ),
        );

        let report = sync_all_memory_connectors(&db, &cfg, 10)?;
        assert_eq!(report.connectors_synced, 2);
        assert_eq!(report.records_read, 3);
        assert_eq!(report.entities_upserted, 3);
        assert_eq!(report.observations_added, 3);
        assert_eq!(report.skipped_records, 0);
        assert_eq!(
            report
                .connectors
                .iter()
                .map(|stats| stats.connector_name.as_str())
                .collect::<Vec<_>>(),
            vec!["hermes_notes", "workspace_note"]
        );

        let recalled = db.recall_context_entities(None, "charged twice portal reinstall", 10)?;
        assert_eq!(recalled.len(), 3);

        Ok(())
    }

    #[test]
    fn format_graph_sync_stats_human_renders_counts() {
        let text = format_graph_sync_stats_human(
            &session::ContextGraphSyncStats {
                sessions_scanned: 2,
                decisions_processed: 3,
                file_events_processed: 5,
                messages_processed: 4,
            },
            Some("sess-12345678"),
        );

        assert!(text.contains("Context graph sync complete for sess-123"));
        assert!(text.contains("- sessions scanned 2"));
        assert!(text.contains("- decisions processed 3"));
        assert!(text.contains("- file events processed 5"));
        assert!(text.contains("- messages processed 4"));
    }

    #[test]
    fn cli_parses_coordination_status_json_flag() {
        let cli = Cli::try_parse_from(["ecc", "coordination-status", "--json"])
            .expect("coordination-status --json should parse");

        match cli.command {
            Some(Commands::CoordinationStatus { json, check }) => {
                assert!(json);
                assert!(!check);
            }
            _ => panic!("expected coordination-status subcommand"),
        }
    }

    #[test]
    fn cli_parses_coordination_status_check_flag() {
        let cli = Cli::try_parse_from(["ecc", "coordination-status", "--check"])
            .expect("coordination-status --check should parse");

        match cli.command {
            Some(Commands::CoordinationStatus { json, check }) => {
                assert!(!json);
                assert!(check);
            }
            _ => panic!("expected coordination-status subcommand"),
        }
    }

    #[test]
    fn cli_parses_maintain_coordination_command() {
        let cli = Cli::try_parse_from(["ecc", "maintain-coordination"])
            .expect("maintain-coordination should parse");

        match cli.command {
            Some(Commands::MaintainCoordination {
                agent,
                json,
                check,
                max_passes,
                ..
            }) => {
                assert!(agent.is_none());
                assert!(!json);
                assert!(!check);
                assert_eq!(max_passes, 5);
            }
            _ => panic!("expected maintain-coordination subcommand"),
        }
    }

    #[test]
    fn cli_parses_maintain_coordination_json_flag() {
        let cli = Cli::try_parse_from(["ecc", "maintain-coordination", "--json"])
            .expect("maintain-coordination --json should parse");

        match cli.command {
            Some(Commands::MaintainCoordination {
                json,
                check,
                max_passes,
                ..
            }) => {
                assert!(json);
                assert!(!check);
                assert_eq!(max_passes, 5);
            }
            _ => panic!("expected maintain-coordination subcommand"),
        }
    }

    #[test]
    fn cli_parses_maintain_coordination_check_flag() {
        let cli = Cli::try_parse_from(["ecc", "maintain-coordination", "--check"])
            .expect("maintain-coordination --check should parse");

        match cli.command {
            Some(Commands::MaintainCoordination {
                json,
                check,
                max_passes,
                ..
            }) => {
                assert!(!json);
                assert!(check);
                assert_eq!(max_passes, 5);
            }
            _ => panic!("expected maintain-coordination subcommand"),
        }
    }

    #[test]
    fn format_coordination_status_emits_json() {
        let status = session::manager::CoordinationStatus {
            backlog_leads: 2,
            backlog_messages: 5,
            absorbable_sessions: 1,
            saturated_sessions: 1,
            mode: session::manager::CoordinationMode::RebalanceFirstChronicSaturation,
            health: session::manager::CoordinationHealth::Saturated,
            operator_escalation_required: false,
            auto_dispatch_enabled: true,
            auto_dispatch_limit_per_session: 4,
            daemon_activity: session::store::DaemonActivity {
                last_dispatch_routed: 3,
                last_dispatch_deferred: 1,
                last_dispatch_leads: 2,
                ..Default::default()
            },
        };

        let rendered =
            format_coordination_status(&status, true).expect("json formatting should succeed");
        let value: serde_json::Value =
            serde_json::from_str(&rendered).expect("valid json should be emitted");
        assert_eq!(value["backlog_leads"], 2);
        assert_eq!(value["backlog_messages"], 5);
        assert_eq!(value["daemon_activity"]["last_dispatch_routed"], 3);
    }

    #[test]
    fn coordination_status_exit_codes_reflect_pressure() {
        let clear = session::manager::CoordinationStatus {
            backlog_leads: 0,
            backlog_messages: 0,
            absorbable_sessions: 0,
            saturated_sessions: 0,
            mode: session::manager::CoordinationMode::DispatchFirst,
            health: session::manager::CoordinationHealth::Healthy,
            operator_escalation_required: false,
            auto_dispatch_enabled: false,
            auto_dispatch_limit_per_session: 5,
            daemon_activity: Default::default(),
        };
        assert_eq!(coordination_status_exit_code(&clear), 0);

        let absorbable = session::manager::CoordinationStatus {
            backlog_messages: 2,
            backlog_leads: 1,
            absorbable_sessions: 1,
            health: session::manager::CoordinationHealth::BacklogAbsorbable,
            ..clear.clone()
        };
        assert_eq!(coordination_status_exit_code(&absorbable), 1);

        let saturated = session::manager::CoordinationStatus {
            saturated_sessions: 1,
            health: session::manager::CoordinationHealth::Saturated,
            ..absorbable
        };
        assert_eq!(coordination_status_exit_code(&saturated), 2);
    }

    #[test]
    fn summarize_coordinate_backlog_reports_clear_state() {
        let summary = summarize_coordinate_backlog(&session::manager::CoordinateBacklogOutcome {
            dispatched: Vec::new(),
            rebalanced: Vec::new(),
            remaining_backlog_sessions: 0,
            remaining_backlog_messages: 0,
            remaining_absorbable_sessions: 0,
            remaining_saturated_sessions: 0,
        });

        assert_eq!(summary.message, "Backlog already clear");
        assert_eq!(summary.processed, 0);
        assert_eq!(summary.rerouted, 0);
    }

    #[test]
    fn summarize_coordinate_backlog_structures_counts() {
        let summary = summarize_coordinate_backlog(&session::manager::CoordinateBacklogOutcome {
            dispatched: vec![session::manager::LeadDispatchOutcome {
                lead_session_id: "lead".into(),
                unread_count: 2,
                routed: vec![
                    session::manager::InboxDrainOutcome {
                        message_id: 1,
                        task: "one".into(),
                        session_id: "a".into(),
                        action: session::manager::AssignmentAction::Spawned,
                    },
                    session::manager::InboxDrainOutcome {
                        message_id: 2,
                        task: "two".into(),
                        session_id: "lead".into(),
                        action: session::manager::AssignmentAction::DeferredSaturated,
                    },
                ],
            }],
            rebalanced: vec![session::manager::LeadRebalanceOutcome {
                lead_session_id: "lead".into(),
                rerouted: vec![session::manager::RebalanceOutcome {
                    from_session_id: "a".into(),
                    message_id: 3,
                    task: "three".into(),
                    session_id: "b".into(),
                    action: session::manager::AssignmentAction::ReusedIdle,
                }],
            }],
            remaining_backlog_sessions: 1,
            remaining_backlog_messages: 2,
            remaining_absorbable_sessions: 1,
            remaining_saturated_sessions: 0,
        });

        assert_eq!(summary.processed, 2);
        assert_eq!(summary.routed, 1);
        assert_eq!(summary.deferred, 1);
        assert_eq!(summary.rerouted, 1);
        assert_eq!(summary.dispatched_leads, 1);
        assert_eq!(summary.rebalanced_leads, 1);
        assert_eq!(summary.remaining_backlog_messages, 2);
    }

    #[test]
    fn cli_parses_rebalance_team_command() {
        let cli = Cli::try_parse_from([
            "ecc",
            "rebalance-team",
            "lead",
            "--agent",
            "claude",
            "--limit",
            "2",
        ])
        .expect("rebalance-team should parse");

        match cli.command {
            Some(Commands::RebalanceTeam {
                session_id,
                agent,
                limit,
                ..
            }) => {
                assert_eq!(session_id, "lead");
                assert_eq!(agent.as_deref(), Some("claude"));
                assert_eq!(limit, 2);
            }
            _ => panic!("expected rebalance-team subcommand"),
        }
    }
}
