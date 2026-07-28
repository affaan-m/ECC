use super::model::{FleetPlan, FleetRecord, FleetStatusReport};

pub fn plan_human(plan: &FleetPlan) -> String {
    let mut lines = vec![
        format!("Feature Fleet plan: {} [EXPERIMENTAL]", plan.manifest.id),
        format!("Title: {}", plan.manifest.title),
        format!("Base: {}", plan.manifest.base_branch),
        format!("Manifest digest: {}", plan.manifest_digest),
        format!("Features: {}", plan.manifest.features.len()),
        format!(
            "Initial ready: {}",
            display_list(&plan.schedule.initial_ready)
        ),
        format!(
            "Topological order: {}",
            display_list(&plan.schedule.topological_order)
        ),
    ];

    if plan.collisions.is_empty() {
        lines.push("Declared collisions: none".to_string());
    } else {
        lines.push(format!(
            "Declared collisions: {} (must serialize or revise ownership)",
            plan.collisions.len()
        ));
        for collision in &plan.collisions {
            lines.push(format!(
                "- {}: {} <-> {} | {}",
                collision.kind, collision.left_feature, collision.right_feature, collision.detail
            ));
        }
    }
    lines.join("\n")
}

pub fn create_human(record: &FleetRecord) -> String {
    [
        format!("Feature Fleet created: {} [EXPERIMENTAL]", record.id),
        format!("Base: {} @ {}", record.base_branch, record.base_oid),
        format!("Manifest digest: {}", record.manifest_digest),
        format!("Revision: {}", record.revision),
        format!("Features: {}", record.features.len()),
        format!("Blockers: {}", record.blockers.len()),
    ]
    .join("\n")
}

pub fn status_human(status: &FleetStatusReport) -> String {
    let fleet = &status.fleet;
    let mut lines = vec![
        format!("Feature Fleet status: {} [EXPERIMENTAL]", fleet.id),
        format!("State: {}", fleet.lifecycle_state),
        format!("Revision: {}", fleet.revision),
        format!("Repository: {}", fleet.repo_root),
        format!("Base: {} @ {}", fleet.base_branch, fleet.base_oid),
        format!("Events: {}", status.events.len()),
        format!("Blockers: {}", fleet.blockers.len()),
    ];
    for blocker in &fleet.blockers {
        lines.push(format!(
            "- {}:{} | {} | action: {}",
            blocker.kind, blocker.code, blocker.summary, blocker.required_resolution_action
        ));
    }
    lines.push("Features:".to_string());
    for feature in &fleet.features {
        lines.push(format!(
            "- {} | {} | blockers {} | depends on {}",
            feature.id,
            feature.lifecycle_state,
            feature.blockers.len(),
            display_list(&feature.depends_on)
        ));
    }
    lines.join("\n")
}

fn display_list(values: &[String]) -> String {
    if values.is_empty() {
        "none".to_string()
    } else {
        values.join(", ")
    }
}
