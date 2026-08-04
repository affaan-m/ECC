use anyhow::Result;
use std::collections::{BTreeMap, BTreeSet};

use super::model::{FleetSchedule, NormalizedManifest};

pub fn build_schedule(manifest: &NormalizedManifest) -> Result<FleetSchedule> {
    let dependencies = manifest
        .features
        .iter()
        .map(|feature| (feature.id.clone(), feature.depends_on.clone()))
        .collect::<BTreeMap<_, _>>();

    validate_dependencies(&dependencies)?;

    let mut remaining = dependencies.clone();
    let mut completed = BTreeSet::new();
    let mut order = Vec::with_capacity(remaining.len());
    let initial_ready = ready_set(&remaining, &completed);

    while !remaining.is_empty() {
        let ready = ready_set(&remaining, &completed);
        if ready.is_empty() {
            let unresolved = remaining.keys().cloned().collect::<Vec<_>>().join(", ");
            anyhow::bail!("Feature dependency cycle detected among: {unresolved}");
        }
        for feature_id in ready {
            remaining.remove(&feature_id);
            completed.insert(feature_id.clone());
            order.push(feature_id);
        }
    }

    Ok(FleetSchedule {
        topological_order: order,
        initial_ready,
    })
}

pub fn transitively_depends_on(
    manifest: &NormalizedManifest,
    feature_id: &str,
    dependency_id: &str,
) -> bool {
    let dependencies = manifest
        .features
        .iter()
        .map(|feature| (feature.id.as_str(), feature.depends_on.as_slice()))
        .collect::<BTreeMap<_, _>>();
    let mut pending = vec![feature_id];
    let mut visited = BTreeSet::new();

    while let Some(current) = pending.pop() {
        if !visited.insert(current) {
            continue;
        }
        for dependency in dependencies.get(current).copied().unwrap_or_default() {
            if dependency == dependency_id {
                return true;
            }
            pending.push(dependency);
        }
    }
    false
}

fn validate_dependencies(dependencies: &BTreeMap<String, Vec<String>>) -> Result<()> {
    for (feature_id, required) in dependencies {
        for dependency in required {
            if dependency == feature_id {
                anyhow::bail!("Feature {feature_id} cannot depend on itself");
            }
            if !dependencies.contains_key(dependency) {
                anyhow::bail!("Feature {feature_id} depends on unknown feature {dependency}");
            }
        }
    }
    Ok(())
}

fn ready_set(
    remaining: &BTreeMap<String, Vec<String>>,
    completed: &BTreeSet<String>,
) -> Vec<String> {
    remaining
        .iter()
        .filter(|(_, dependencies)| {
            dependencies
                .iter()
                .all(|dependency| completed.contains(dependency))
        })
        .map(|(feature_id, _)| feature_id.clone())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::build_schedule;
    use crate::feature_fleet::manifest::parse_manifest_text;
    use crate::feature_fleet::manifest::tests::valid_manifest;

    #[test]
    fn builds_deterministic_topological_order_and_ready_set() {
        let parsed = parse_manifest_text(valid_manifest(), "toml").expect("manifest");
        let schedule = build_schedule(&parsed.manifest).expect("schedule");

        assert_eq!(
            schedule.topological_order,
            vec!["auth-api", "onboarding-ui"]
        );
        assert_eq!(schedule.initial_ready, vec!["auth-api"]);
    }

    #[test]
    fn rejects_unknown_dependencies_and_cycles() {
        let unknown = valid_manifest().replace(
            "depends_on = [\"auth-api\"]",
            "depends_on = [\"missing-api\"]",
        );
        let parsed = parse_manifest_text(&unknown, "toml").expect("parse unknown dependency");
        let error = build_schedule(&parsed.manifest).expect_err("unknown dependency rejected");
        assert!(error.to_string().contains("missing-api"));

        let cycle = valid_manifest().replace(
            "contracts = [\"api:auth-v2\"]",
            "contracts = [\"api:auth-v2\"]\ndepends_on = [\"onboarding-ui\"]",
        );
        let parsed = parse_manifest_text(&cycle, "toml").expect("parse cycle");
        let error = build_schedule(&parsed.manifest).expect_err("cycle rejected");
        assert!(error.to_string().contains("cycle"));
    }
}
