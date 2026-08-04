use anyhow::Result;
use std::collections::BTreeSet;

use super::model::{DeclaredCollision, FeatureManifest, NormalizedManifest};
use super::scheduler::{build_schedule, transitively_depends_on};

pub fn declared_collisions(manifest: &NormalizedManifest) -> Result<Vec<DeclaredCollision>> {
    build_schedule(manifest)?;
    let mut collisions = Vec::new();

    for (left_index, left) in manifest.features.iter().enumerate() {
        for right in manifest.features.iter().skip(left_index + 1) {
            if are_serialized(manifest, left, right) {
                continue;
            }
            collisions.extend(path_collisions(left, right));
            collisions.extend(contract_collisions(left, right));
        }
    }
    Ok(collisions)
}

fn are_serialized(
    manifest: &NormalizedManifest,
    left: &FeatureManifest,
    right: &FeatureManifest,
) -> bool {
    transitively_depends_on(manifest, &left.id, &right.id)
        || transitively_depends_on(manifest, &right.id, &left.id)
}

fn path_collisions(left: &FeatureManifest, right: &FeatureManifest) -> Vec<DeclaredCollision> {
    let mut collisions = Vec::new();
    for left_path in &left.owns {
        for right_path in &right.owns {
            if ownership_patterns_overlap(left_path, right_path) {
                collisions.push(collision(
                    "path_overlap",
                    left,
                    right,
                    format!("{left_path} overlaps {right_path}"),
                ));
            }
        }
    }
    collisions
}

fn contract_collisions(left: &FeatureManifest, right: &FeatureManifest) -> Vec<DeclaredCollision> {
    let left_contracts = left.contracts.iter().collect::<BTreeSet<_>>();
    let right_contracts = right.contracts.iter().collect::<BTreeSet<_>>();
    left_contracts
        .intersection(&right_contracts)
        .map(|contract| {
            collision(
                "contract_overlap",
                left,
                right,
                format!("both features declare contract {contract}"),
            )
        })
        .collect()
}

fn collision(
    kind: &str,
    left: &FeatureManifest,
    right: &FeatureManifest,
    detail: String,
) -> DeclaredCollision {
    DeclaredCollision {
        kind: kind.to_string(),
        left_feature: left.id.clone(),
        right_feature: right.id.clone(),
        detail,
        required_action: "serialize_or_revise_ownership".to_string(),
    }
}

fn ownership_patterns_overlap(left: &str, right: &str) -> bool {
    let left_prefix = ownership_prefix(left);
    let right_prefix = ownership_prefix(right);
    if left_prefix.has_wildcard && right_prefix.raw.starts_with(left_prefix.raw) {
        return true;
    }
    if right_prefix.has_wildcard && left_prefix.raw.starts_with(right_prefix.raw) {
        return true;
    }

    left_prefix.path == right_prefix.path
        || left_prefix
            .path
            .strip_prefix(right_prefix.path)
            .is_some_and(|suffix| suffix.starts_with('/'))
        || right_prefix
            .path
            .strip_prefix(left_prefix.path)
            .is_some_and(|suffix| suffix.starts_with('/'))
}

struct OwnershipPrefix<'pattern> {
    raw: &'pattern str,
    path: &'pattern str,
    has_wildcard: bool,
}

fn ownership_prefix(pattern: &str) -> OwnershipPrefix<'_> {
    let wildcard = pattern.find(['*', '?', '[']).unwrap_or(pattern.len());
    let raw = &pattern[..wildcard];
    OwnershipPrefix {
        raw,
        path: raw.trim_end_matches('/'),
        has_wildcard: wildcard < pattern.len(),
    }
}

#[cfg(test)]
mod tests {
    use super::declared_collisions;
    use crate::feature_fleet::manifest::parse_manifest_text;
    use crate::feature_fleet::manifest::tests::valid_manifest;

    #[test]
    fn reports_concurrent_path_and_contract_overlap_but_not_serial_dependencies() {
        let concurrent = valid_manifest()
            .replace("depends_on = [\"auth-api\"]\n", "")
            .replace(
                "owns = [\"apps/web/onboarding/**\"]",
                "owns = [\"services/auth/handlers/**\"]\ncontracts = [\"api:auth-v2\"]",
            );
        let parsed = parse_manifest_text(&concurrent, "toml").expect("manifest");
        let collisions = declared_collisions(&parsed.manifest).expect("collisions");

        assert!(collisions.iter().any(|item| item.kind == "path_overlap"));
        assert!(collisions
            .iter()
            .any(|item| item.kind == "contract_overlap"));

        let serialized = valid_manifest().replace(
            "owns = [\"apps/web/onboarding/**\"]",
            "owns = [\"services/auth/handlers/**\"]\ncontracts = [\"api:auth-v2\"]",
        );
        let parsed = parse_manifest_text(&serialized, "toml").expect("manifest");
        assert!(declared_collisions(&parsed.manifest)
            .expect("collisions")
            .is_empty());
    }

    #[test]
    fn conservatively_reports_overlapping_glob_prefixes() {
        let concurrent = valid_manifest()
            .replace("depends_on = [\"auth-api\"]\n", "")
            .replace(
                "owns = [\"services/auth/**\"]",
                "owns = [\"services/auth/handler*\"]",
            )
            .replace(
                "owns = [\"apps/web/onboarding/**\"]",
                "owns = [\"services/auth/handlers/**\"]",
            );
        let parsed = parse_manifest_text(&concurrent, "toml").expect("manifest");

        assert!(declared_collisions(&parsed.manifest)
            .expect("collisions")
            .iter()
            .any(|item| item.kind == "path_overlap"));
    }
}
