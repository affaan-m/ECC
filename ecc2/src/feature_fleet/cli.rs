use anyhow::Result;
use clap::{Args, Subcommand};
use std::path::PathBuf;

use crate::session::store::StateStore;

use super::report::{create_human, plan_human, status_human};

#[derive(Args, Debug)]
pub struct FleetArgs {
    /// Fleet state database; overrides the normal ECC database for this command
    #[arg(long, global = true)]
    pub state_db: Option<PathBuf>,
    #[command(subcommand)]
    pub command: FleetCommand,
}

#[derive(Subcommand, Debug)]
pub enum FleetCommand {
    /// Validate a manifest and preview its DAG and declared collisions
    Plan {
        /// Feature Fleet TOML or JSON manifest
        manifest: PathBuf,
        /// Emit machine-readable JSON
        #[arg(long)]
        json: bool,
    },
    /// Persist an approved fleet and pin its base commit
    Create {
        /// Feature Fleet TOML or JSON manifest
        manifest: PathBuf,
        /// Emit machine-readable JSON
        #[arg(long)]
        json: bool,
    },
    /// Show durable fleet and feature state
    Status {
        /// Fleet identifier
        fleet_id: String,
        /// Emit machine-readable JSON
        #[arg(long)]
        json: bool,
    },
}

pub fn execute(command: FleetCommand, db: &StateStore) -> Result<()> {
    match command {
        FleetCommand::Plan { manifest, json } => {
            let plan = super::plan(&manifest)?;
            print_output(&plan, plan_human(&plan), json)?;
        }
        FleetCommand::Create { manifest, json } => {
            let record = super::create(db, &manifest)?;
            print_output(&record, create_human(&record), json)?;
        }
        FleetCommand::Status { fleet_id, json } => {
            let status = super::status(db, &fleet_id)?;
            print_output(&status, status_human(&status), json)?;
        }
    }
    Ok(())
}

fn print_output<T>(value: &T, human: String, json: bool) -> Result<()>
where
    T: serde::Serialize,
{
    if json {
        println!("{}", serde_json::to_string_pretty(value)?);
    } else {
        println!("{human}");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::FleetArgs;
    use clap::Parser;

    #[derive(Parser)]
    struct TestCli {
        #[command(flatten)]
        fleet: FleetArgs,
    }

    #[test]
    fn parses_experimental_fleet_commands() {
        let plan = TestCli::try_parse_from(["fleet", "plan", "fleet.toml", "--json"])
            .expect("fleet plan parses");
        assert!(matches!(
            plan.fleet.command,
            super::FleetCommand::Plan {
                manifest,
                json: true
            } if manifest.as_os_str() == "fleet.toml"
        ));

        let status = TestCli::try_parse_from([
            "fleet",
            "--state-db",
            "/tmp/fleet.db",
            "status",
            "onboarding-v2",
        ])
        .expect("fleet status parses");
        assert!(matches!(
            status.fleet.command,
            super::FleetCommand::Status { fleet_id, json: false }
                if fleet_id == "onboarding-v2"
        ));
        assert_eq!(
            status.fleet.state_db.as_deref(),
            Some(std::path::Path::new("/tmp/fleet.db"))
        );
    }
}
