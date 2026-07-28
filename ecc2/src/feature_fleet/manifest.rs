use anyhow::{Context, Result};
use regex::Regex;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::Path;

pub use super::model::{FeatureManifest, NormalizedManifest, ParsedManifest, VerificationCheck};

const SCHEMA_VERSION: &str = "ecc.feature-fleet.v1";
const MAX_MANIFEST_BYTES: usize = 1024 * 1024;
const MAX_FEATURES: usize = 128;
const MAX_FEATURE_RELATIONS: usize = 128;
const MAX_FEATURE_DECLARATIONS: usize = 64;
const MAX_CHECK_TIMEOUT_SECONDS: u64 = 24 * 60 * 60;
const MAX_CHECK_OUTPUT_BYTES: u64 = 100 * 1024 * 1024;

pub fn parse_manifest_path(path: &Path) -> Result<ParsedManifest> {
    let file_size = fs::metadata(path)
        .with_context(|| format!("Failed to inspect fleet manifest {}", path.display()))?
        .len();
    if file_size > MAX_MANIFEST_BYTES as u64 {
        anyhow::bail!(
            "Feature Fleet manifest exceeds the {} byte size limit",
            MAX_MANIFEST_BYTES
        );
    }
    let content = fs::read_to_string(path)
        .with_context(|| format!("Failed to read fleet manifest {}", path.display()))?;
    let format = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("toml");
    parse_manifest_text(&content, format)
        .with_context(|| format!("Invalid fleet manifest {}", path.display()))
}

pub fn parse_manifest_text(content: &str, format: &str) -> Result<ParsedManifest> {
    if content.len() > MAX_MANIFEST_BYTES {
        anyhow::bail!(
            "Feature Fleet manifest exceeds the {} byte size limit",
            MAX_MANIFEST_BYTES
        );
    }
    let manifest = match format.trim().to_ascii_lowercase().as_str() {
        "toml" => toml::from_str::<NormalizedManifest>(content)
            .context("Failed to parse Feature Fleet TOML")?,
        "json" => serde_json::from_str::<NormalizedManifest>(content)
            .context("Failed to parse Feature Fleet JSON")?,
        other => anyhow::bail!("Unsupported Feature Fleet manifest format: {other}"),
    };
    manifest.normalized()
}

impl NormalizedManifest {
    pub fn normalized(self) -> Result<ParsedManifest> {
        let normalized = normalize_manifest(self)?;
        validate_manifest(&normalized)?;
        let canonical =
            serde_json::to_vec(&normalized).context("serialize normalized fleet manifest")?;
        let digest = hex_digest(&canonical);
        Ok(ParsedManifest {
            manifest: normalized,
            digest,
        })
    }
}

fn hex_digest(content: &[u8]) -> String {
    Sha256::digest(content)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn normalize_manifest(manifest: NormalizedManifest) -> Result<NormalizedManifest> {
    let mut features_by_id = BTreeMap::new();
    for feature in manifest.features {
        let normalized = normalize_feature(feature);
        let id = normalized.id.clone();
        if features_by_id.insert(id.clone(), normalized).is_some() {
            anyhow::bail!("Duplicate feature id: {id}");
        }
    }

    Ok(NormalizedManifest {
        schema: manifest.schema.trim().to_string(),
        id: manifest.id.trim().to_string(),
        title: manifest.title.trim().to_string(),
        base_branch: manifest.base_branch.trim().to_string(),
        default_agent: manifest.default_agent.trim().to_string(),
        default_profile: normalize_optional(manifest.default_profile),
        features: features_by_id.into_values().collect(),
    })
}

fn normalize_feature(feature: FeatureManifest) -> FeatureManifest {
    FeatureManifest {
        id: feature.id.trim().to_string(),
        title: feature.title.trim().to_string(),
        task: feature.task.trim().to_string(),
        depends_on: sorted_strings(feature.depends_on),
        owns: sorted_strings(feature.owns),
        contracts: sorted_strings(feature.contracts),
        checks: feature.checks.into_iter().map(normalize_check).collect(),
        agent: normalize_optional(feature.agent),
        profile: normalize_optional(feature.profile),
    }
}

fn normalize_check(check: VerificationCheck) -> VerificationCheck {
    VerificationCheck {
        id: check.id.trim().to_string(),
        program: check.program.trim().to_string(),
        args: check.args,
        working_directory: check.working_directory.trim().to_string(),
        timeout_seconds: check.timeout_seconds,
        environment_allowlist: sorted_strings(check.environment_allowlist),
        max_output_bytes: check.max_output_bytes,
        requires_repository_trust: check.requires_repository_trust,
    }
}

fn normalize_optional(value: Option<String>) -> Option<String> {
    value
        .map(|entry| entry.trim().to_string())
        .filter(|entry| !entry.is_empty())
}

fn sorted_strings(values: Vec<String>) -> Vec<String> {
    values
        .into_iter()
        .map(|value| value.trim().to_string())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}

fn validate_manifest(manifest: &NormalizedManifest) -> Result<()> {
    if manifest.schema != SCHEMA_VERSION {
        anyhow::bail!(
            "Unsupported Feature Fleet schema '{}'; expected {SCHEMA_VERSION}",
            manifest.schema
        );
    }
    validate_slug("fleet id", &manifest.id)?;
    validate_required("title", &manifest.title)?;
    validate_base_branch(&manifest.base_branch)?;
    validate_required("default_agent", &manifest.default_agent)?;
    if let Some(profile) = &manifest.default_profile {
        validate_required("default_profile", profile)?;
    }
    if manifest.features.is_empty() {
        anyhow::bail!("Feature Fleet manifest requires at least one feature");
    }
    if manifest.features.len() > MAX_FEATURES {
        anyhow::bail!("Feature Fleet manifest supports at most {MAX_FEATURES} features");
    }
    for feature in &manifest.features {
        validate_feature(feature)?;
    }
    Ok(())
}

fn validate_feature(feature: &FeatureManifest) -> Result<()> {
    validate_slug("feature id", &feature.id)?;
    validate_required("feature title", &feature.title)?;
    validate_required("feature task", &feature.task)?;
    validate_item_limit(
        &feature.id,
        "dependencies",
        feature.depends_on.len(),
        MAX_FEATURE_RELATIONS,
    )?;
    validate_item_limit(
        &feature.id,
        "ownership declarations",
        feature.owns.len(),
        MAX_FEATURE_DECLARATIONS,
    )?;
    validate_item_limit(
        &feature.id,
        "contract declarations",
        feature.contracts.len(),
        MAX_FEATURE_DECLARATIONS,
    )?;
    validate_item_limit(
        &feature.id,
        "verification checks",
        feature.checks.len(),
        MAX_FEATURE_DECLARATIONS,
    )?;
    for dependency in &feature.depends_on {
        validate_slug("dependency feature id", dependency)?;
    }
    for owned_path in &feature.owns {
        validate_repo_relative("owns", owned_path, false)?;
    }
    for contract in &feature.contracts {
        validate_required("contract", contract)?;
    }
    if let Some(agent) = &feature.agent {
        validate_required("feature agent", agent)?;
    }
    if let Some(profile) = &feature.profile {
        validate_required("feature profile", profile)?;
    }

    let mut check_ids = BTreeSet::new();
    for check in &feature.checks {
        validate_slug("check id", &check.id)?;
        if !check_ids.insert(check.id.as_str()) {
            anyhow::bail!(
                "Feature {} contains duplicate check id {}",
                feature.id,
                check.id
            );
        }
        validate_program(&check.program)?;
        validate_repo_relative("working_directory", &check.working_directory, true)?;
        if check.args.iter().any(|argument| argument.contains('\0')) {
            anyhow::bail!("Feature {} check {} args contain NUL", feature.id, check.id);
        }
        if check.timeout_seconds == 0 || check.timeout_seconds > MAX_CHECK_TIMEOUT_SECONDS {
            anyhow::bail!(
                "Feature {} check {} timeout_seconds must be between 1 and {}",
                feature.id,
                check.id,
                MAX_CHECK_TIMEOUT_SECONDS
            );
        }
        if check.max_output_bytes == 0 || check.max_output_bytes > MAX_CHECK_OUTPUT_BYTES {
            anyhow::bail!(
                "Feature {} check {} max_output_bytes must be between 1 and {}",
                feature.id,
                check.id,
                MAX_CHECK_OUTPUT_BYTES
            );
        }
        for variable in &check.environment_allowlist {
            validate_environment_name(variable)?;
        }
    }
    Ok(())
}

fn validate_item_limit(feature_id: &str, label: &str, actual: usize, maximum: usize) -> Result<()> {
    if actual > maximum {
        anyhow::bail!("Feature {feature_id} supports at most {maximum} {label}");
    }
    Ok(())
}

fn validate_slug(label: &str, value: &str) -> Result<()> {
    let pattern = Regex::new(r"^[a-z0-9][a-z0-9-]{0,62}$").expect("valid slug regex");
    if !pattern.is_match(value) {
        anyhow::bail!("{label} must match [a-z0-9][a-z0-9-]{{0,62}}: {value}");
    }
    Ok(())
}

fn validate_required(label: &str, value: &str) -> Result<()> {
    if value.is_empty() || value.contains('\0') {
        anyhow::bail!("{label} must be a non-empty string without NUL");
    }
    Ok(())
}

fn validate_base_branch(value: &str) -> Result<()> {
    validate_required("base_branch", value)?;
    let invalid_component = value.split('/').any(|component| {
        component.is_empty()
            || component.starts_with('.')
            || component.ends_with('.')
            || component.ends_with(".lock")
    });
    let invalid_character = value.chars().any(|character| {
        character.is_control() || character.is_whitespace() || "~^:?*[\\".contains(character)
    });
    if value == "@"
        || value.starts_with('-')
        || value.ends_with('/')
        || value.contains("..")
        || value.contains("@{")
        || invalid_component
        || invalid_character
    {
        anyhow::bail!("base_branch is not a safe Git branch name: {value}");
    }
    Ok(())
}

fn validate_program(program: &str) -> Result<()> {
    if program.is_empty()
        || program.contains('\0')
        || program.chars().any(char::is_whitespace)
        || program
            .chars()
            .any(|character| ";&|`$<>(){}".contains(character))
    {
        anyhow::bail!(
            "verification program must be one executable token; put arguments in args: {program}"
        );
    }
    Ok(())
}

fn validate_repo_relative(label: &str, value: &str, allow_dot: bool) -> Result<()> {
    if value.is_empty()
        || value.contains('\0')
        || value.starts_with('/')
        || value.starts_with('\\')
        || value.contains('\\')
    {
        anyhow::bail!("{label} path must be repository-relative: {value}");
    }
    if value == "." {
        if allow_dot {
            return Ok(());
        }
        anyhow::bail!("{label} path must identify a repository path or pattern");
    }
    if value
        .split('/')
        .any(|segment| segment.is_empty() || segment == "." || segment == "..")
    {
        anyhow::bail!("{label} path must not contain empty or parent segments: {value}");
    }
    Ok(())
}

fn validate_environment_name(value: &str) -> Result<()> {
    let pattern = Regex::new(r"^[A-Z_][A-Z0-9_]*$").expect("valid environment regex");
    if !pattern.is_match(value) {
        anyhow::bail!("environment_allowlist contains invalid variable name: {value}");
    }
    Ok(())
}

#[cfg(test)]
pub(crate) mod tests {
    use super::{parse_manifest_path, parse_manifest_text};

    const VALID_MANIFEST: &str = r#"
schema = "ecc.feature-fleet.v1"
id = "onboarding-v2"
title = "Onboarding v2"
base_branch = "main"
default_agent = "codex"

[[features]]
id = "auth-api"
title = "Authentication API"
task = "Implement auth."
owns = ["services/auth/**"]
contracts = ["api:auth-v2"]

[[features.checks]]
id = "auth-tests"
program = "cargo"
args = ["test", "-p", "auth"]
working_directory = "."
timeout_seconds = 900
environment_allowlist = ["RUSTUP_HOME", "CARGO_HOME"]
max_output_bytes = 10485760
requires_repository_trust = true

[[features]]
id = "onboarding-ui"
title = "Onboarding UI"
task = "Implement UI."
depends_on = ["auth-api"]
owns = ["apps/web/onboarding/**"]
"#;

    #[test]
    fn parses_and_normalizes_structured_manifest() {
        let parsed = parse_manifest_text(VALID_MANIFEST, "toml").expect("valid manifest");

        assert_eq!(parsed.manifest.id, "onboarding-v2");
        assert_eq!(parsed.manifest.features.len(), 2);
        assert_eq!(parsed.manifest.features[0].id, "auth-api");
        assert_eq!(
            parsed.manifest.features[0].checks[0].args,
            vec!["test", "-p", "auth"]
        );
        assert_eq!(
            parsed.manifest.features[0].checks[0].environment_allowlist,
            vec!["CARGO_HOME", "RUSTUP_HOME"]
        );
        assert_eq!(parsed.digest.len(), 64);
    }

    #[test]
    fn repository_example_is_a_valid_manifest() {
        let path =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("examples/feature-fleet.toml");
        let parsed = parse_manifest_path(&path).expect("repository example");

        assert_eq!(parsed.manifest.id, "feature-fleet-runtime");
        assert_eq!(
            parsed.manifest.features.len(),
            3,
            "example should demonstrate parallel roots and a dependent feature"
        );
    }

    #[test]
    fn normalized_digest_ignores_toml_formatting_and_feature_order() {
        let first = parse_manifest_text(VALID_MANIFEST, "toml").expect("first manifest");
        let mut reversed = first.manifest.clone();
        reversed.features.reverse();
        let reordered = reversed.normalized().expect("reordered manifest");

        assert_eq!(first.digest, reordered.digest);

        let canonical = serde_json::to_string_pretty(&first.manifest).expect("canonical json");
        let reparsed = parse_manifest_text(&canonical, "json").expect("json manifest");
        assert_eq!(first.digest, reparsed.digest);
    }

    #[test]
    fn normalized_digest_changes_with_manifest_semantics() {
        let first = parse_manifest_text(VALID_MANIFEST, "toml").expect("first manifest");
        let reordered = VALID_MANIFEST
            .replace(
                "[[features]]\nid = \"auth-api\"",
                "[[features]]\nid = \"z-auth-api\"",
            )
            .replace(
                "depends_on = [\"auth-api\"]",
                "depends_on = [\"z-auth-api\"]",
            );
        let second = parse_manifest_text(&reordered, "toml").expect("second manifest");

        assert_ne!(
            first.digest, second.digest,
            "semantic changes must change digest"
        );
    }

    #[test]
    fn rejects_shell_strings_and_unsafe_paths() {
        let shell_check = VALID_MANIFEST.replace(
            "program = \"cargo\"\nargs = [\"test\", \"-p\", \"auth\"]",
            "program = \"cargo test -p auth\"\nargs = []",
        );
        let error = parse_manifest_text(&shell_check, "toml").expect_err("shell string rejected");
        assert!(error.to_string().contains("program"));

        let unsafe_path = VALID_MANIFEST.replace(
            "owns = [\"services/auth/**\"]",
            "owns = [\"../outside/**\"]",
        );
        let error = parse_manifest_text(&unsafe_path, "toml").expect_err("unsafe path rejected");
        assert!(error.to_string().contains("owns"));

        let ambiguous_path = VALID_MANIFEST.replace(
            "owns = [\"services/auth/**\"]",
            "owns = [\"services/./auth/**\"]",
        );
        let error = parse_manifest_text(&ambiguous_path, "toml").expect_err("dot segment rejected");
        assert!(error.to_string().contains("owns"));
    }

    #[test]
    fn rejects_invalid_base_branch_and_unknown_fields() {
        let unsafe_branch = VALID_MANIFEST.replace(
            "base_branch = \"main\"",
            "base_branch = \"--upload-pack=malicious\"",
        );
        let error =
            parse_manifest_text(&unsafe_branch, "toml").expect_err("unsafe branch rejected");
        assert!(error.to_string().contains("base_branch"));

        let unknown = VALID_MANIFEST.replace(
            "default_agent = \"codex\"",
            "default_agent = \"codex\"\nunrecognized = true",
        );
        let error = parse_manifest_text(&unknown, "toml").expect_err("unknown field rejected");
        assert!(format!("{error:#}").contains("unrecognized"));

        let implicit_trust = VALID_MANIFEST.replace("requires_repository_trust = true\n", "");
        let error =
            parse_manifest_text(&implicit_trust, "toml").expect_err("trust must be explicit");
        assert!(format!("{error:#}").contains("requires_repository_trust"));
    }

    #[test]
    fn rejects_oversized_manifests() {
        let oversized = format!("{}\n# {}", VALID_MANIFEST, "x".repeat(1024 * 1024));
        let error = parse_manifest_text(&oversized, "toml").expect_err("oversized manifest");
        assert!(error.to_string().contains("size limit"));
    }

    pub(crate) fn valid_manifest() -> &'static str {
        VALID_MANIFEST
    }
}
