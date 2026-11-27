#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::collections::BTreeMap;

    #[test]
    fn candidate_id_addresses_canonical_config_and_normalized_references() {
        let first = CandidateSpec::new(
            json!({"model": "fixed", "limits": {"steps": 3, "tools": ["read"]}}),
            vec![" trace://two ".into(), "trace://one".into()],
            vec!["evidence://two".into(), " evidence://one ".into()],
        )
        .unwrap();
        let second = CandidateSpec::new(
            json!({"limits": {"tools": ["read"], "steps": 3}, "model": "fixed"}),
            vec!["trace://one".into(), "trace://two".into()],
            vec!["evidence://one".into(), "evidence://two".into()],
        )
        .unwrap();

        assert_eq!(first.id, second.id);
        assert_eq!(first.canonical_config, second.canonical_config);
        assert_eq!(first.trace_refs, vec!["trace://one", "trace://two"]);
        assert_eq!(
            first.evidence_refs,
            vec!["evidence://one", "evidence://two"]
        );
    }

    #[test]
    fn candidate_id_changes_when_any_immutable_reference_changes() {
        let original = CandidateSpec::new(
            json!({"model": "fixed"}),
            vec!["trace://one".into()],
            vec!["evidence://one".into()],
        )
        .unwrap();
        let changed_trace = CandidateSpec::new(
            json!({"model": "fixed"}),
            vec!["trace://two".into()],
            vec!["evidence://one".into()],
        )
        .unwrap();
        let changed_evidence = CandidateSpec::new(
            json!({"model": "fixed"}),
            vec!["trace://one".into()],
            vec!["evidence://two".into()],
        )
        .unwrap();

        assert_ne!(original.id, changed_trace.id);
        assert_ne!(original.id, changed_evidence.id);
    }

    #[test]
    fn candidate_integrity_rejects_reference_tampering() {
        let mut candidate = CandidateSpec::new(
            json!({"model": "fixed"}),
            vec!["trace://one".into()],
            vec!["evidence://one".into()],
        )
        .unwrap();
        candidate.trace_refs = vec!["trace://tampered".into()];

        assert!(candidate.verify_integrity().is_err());

        let mut noncanonical = CandidateSpec::new(
            json!({"model": "fixed"}),
            vec!["trace://one".into(), "trace://two".into()],
            vec!["evidence://one".into()],
        )
        .unwrap();
        noncanonical.trace_refs.reverse();
        assert!(noncanonical.verify_integrity().is_err());
    }

    #[test]
    fn persisted_candidate_integrity_accepts_only_exact_v1_or_v2_ids() {
        let candidate = CandidateSpec::new(
            json!({"model": "fixed", "limits": {"steps": 3}}),
            vec!["trace://one".into()],
            vec!["evidence://one".into()],
        )
        .unwrap();
        let legacy_id = candidate.legacy_id();

        candidate.verify_persisted_id(&candidate.id).unwrap();
        candidate.verify_persisted_id(&legacy_id).unwrap();
        assert!(candidate
            .verify_persisted_id(&"a".repeat(64))
            .unwrap_err()
            .to_string()
            .contains("content address"));
    }

    #[test]
    fn policy_requires_explicit_unique_seeds_and_minimum_samples() {
        let policy = PromotionPolicy {
            min_samples: 3,
            min_mean_delta: 0.05,
            min_win_rate: 2.0 / 3.0,
        };
        let duplicate = vec![
            paired(7, 1.0, 0.0),
            paired(7, 1.0, 0.0),
            paired(9, 1.0, 0.0),
        ];
        assert!(policy.compare(&duplicate).is_err());

        let too_few = vec![paired(7, 1.0, 0.0), paired(8, 1.0, 0.0)];
        let decision = policy.compare(&too_few).unwrap();
        assert!(!decision.passed);
        assert!(decision
            .failures
            .iter()
            .any(|failure| failure.contains("minimum sample")));
    }

    #[test]
    fn thresholds_are_deterministic_and_all_must_pass() {
        let policy = PromotionPolicy {
            min_samples: 3,
            min_mean_delta: 0.1,
            min_win_rate: 0.75,
        };
        let samples = vec![
            paired(1, 0.9, 0.7),
            paired(2, 0.8, 0.7),
            paired(3, 0.6, 0.7),
            paired(4, 0.8, 0.7),
        ];
        let first = policy.compare(&samples).unwrap();
        let second = policy.compare(&samples).unwrap();

        assert_eq!(first, second);
        assert!(!first.passed);
        assert_eq!(first.win_rate, 0.75);
        assert!(first
            .failures
            .iter()
            .any(|failure| failure.contains("mean delta")));
    }

    #[test]
    fn evaluator_is_called_for_each_explicit_seed_in_order() {
        let mut evaluator = RecordedEvaluator::new(
            BTreeMap::from([
                (("candidate".into(), 4), 0.9),
                (("baseline".into(), 4), 0.5),
                (("candidate".into(), 2), 0.8),
                (("baseline".into(), 2), 0.6),
            ]),
            true,
        );

        let samples = evaluate_paired(&mut evaluator, "candidate", "baseline", &[4, 2]).unwrap();
        assert_eq!(samples, vec![paired(4, 0.9, 0.5), paired(2, 0.8, 0.6)]);
        assert_eq!(
            evaluator.calls(),
            &[
                ("candidate".into(), 4),
                ("baseline".into(), 4),
                ("candidate".into(), 2),
                ("baseline".into(), 2)
            ]
        );
    }

    fn paired(seed: u64, candidate_score: f64, baseline_score: f64) -> PairedSample {
        PairedSample {
            seed,
            candidate_score,
            baseline_score,
        }
    }
}
use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CandidateSpec {
    pub id: String,
    pub canonical_config: String,
    pub trace_refs: Vec<String>,
    pub evidence_refs: Vec<String>,
}

impl CandidateSpec {
    pub fn new(config: Value, trace_refs: Vec<String>, evidence_refs: Vec<String>) -> Result<Self> {
        let trace_refs = normalize_refs("trace", trace_refs)?;
        let evidence_refs = normalize_refs("evidence", evidence_refs)?;
        let canonical_config = serde_json::to_string(&canonicalize(config))?;
        if canonical_config.len() > 1024 * 1024 {
            bail!("candidate configuration exceeds 1 MiB");
        }
        let artifact = serde_json::to_string(&CanonicalCandidateArtifact {
            config: serde_json::from_str(&canonical_config)?,
            trace_refs: &trace_refs,
            evidence_refs: &evidence_refs,
        })?;
        let id = sha256_hex(artifact.as_bytes());
        Ok(Self {
            id,
            canonical_config,
            trace_refs,
            evidence_refs,
        })
    }

    pub fn verify_integrity(&self) -> Result<()> {
        self.verify_persisted_id(&self.id)?;
        if self.id != self.id_for_v2()? {
            bail!("candidate content address or canonical configuration is invalid");
        }
        Ok(())
    }

    pub fn legacy_id(&self) -> String {
        sha256_hex(self.canonical_config.as_bytes())
    }

    pub fn verify_persisted_id(&self, persisted_id: &str) -> Result<()> {
        let value: Value = serde_json::from_str(&self.canonical_config)?;
        let rebuilt = Self::new(value, self.trace_refs.clone(), self.evidence_refs.clone())?;
        let is_v1 = persisted_id == self.legacy_id();
        let is_v2 = persisted_id == rebuilt.id;
        if rebuilt.canonical_config != self.canonical_config
            || (!is_v1 && !is_v2)
            || (is_v2
                && (rebuilt.trace_refs != self.trace_refs
                    || rebuilt.evidence_refs != self.evidence_refs))
        {
            bail!("candidate content address or canonical configuration is invalid");
        }
        Ok(())
    }

    pub(crate) fn id_for_v2(&self) -> Result<String> {
        Ok(Self::new(
            serde_json::from_str(&self.canonical_config)?,
            self.trace_refs.clone(),
            self.evidence_refs.clone(),
        )?
        .id)
    }
}

#[derive(Serialize)]
struct CanonicalCandidateArtifact<'a> {
    config: Value,
    trace_refs: &'a [String],
    evidence_refs: &'a [String],
}

fn normalize_refs(kind: &str, refs: Vec<String>) -> Result<Vec<String>> {
    if refs.is_empty() || refs.iter().any(|reference| reference.trim().is_empty()) {
        bail!("at least one non-empty {kind} reference is required");
    }
    if refs.len() > 100 || refs.iter().any(|reference| reference.len() > 4096) {
        bail!("{kind} references exceed bounded limits");
    }
    let mut normalized = refs
        .into_iter()
        .map(|reference| reference.trim().to_string())
        .collect::<Vec<_>>();
    normalized.sort();
    normalized.dedup();
    Ok(normalized)
}

fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn canonicalize(value: Value) -> Value {
    match value {
        Value::Object(entries) => Value::Object(
            entries
                .into_iter()
                .map(|(key, value)| (key, canonicalize(value)))
                .collect::<BTreeMap<_, _>>()
                .into_iter()
                .collect(),
        ),
        Value::Array(values) => Value::Array(values.into_iter().map(canonicalize).collect()),
        other => other,
    }
}

pub trait Evaluator {
    fn name(&self) -> &str;
    fn evaluate(&mut self, candidate_id: &str, seed: u64) -> Result<f64>;
    fn health_check(&mut self, candidate_id: &str) -> Result<bool>;
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecordedEvidence {
    pub evaluator: String,
    pub scores: BTreeMap<String, BTreeMap<u64, f64>>,
    pub health: BTreeMap<String, bool>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HealthEvidenceSnapshot {
    pub schema_version: u8,
    pub evaluator: String,
    pub candidate_id: String,
    pub asserted_healthy: bool,
}

impl HealthEvidenceSnapshot {
    pub fn new(evaluator: &str, candidate_id: &str, asserted_healthy: bool) -> Result<Self> {
        let snapshot = Self {
            schema_version: 1,
            evaluator: evaluator.to_string(),
            candidate_id: candidate_id.to_string(),
            asserted_healthy,
        };
        snapshot.verify()?;
        Ok(snapshot)
    }

    pub fn canonical_json(&self) -> Result<String> {
        self.verify()?;
        Ok(serde_json::to_string(self)?)
    }

    pub fn digest(&self) -> Result<String> {
        Ok(sha256_hex(self.canonical_json()?.as_bytes()))
    }

    pub fn verify(&self) -> Result<()> {
        if self.schema_version != 1
            || self.evaluator != "recorded-v1"
            || self.candidate_id.len() != 64
            || !self
                .candidate_id
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        {
            bail!("invalid canonical health evidence snapshot");
        }
        Ok(())
    }
}

pub struct RecordedEvaluator {
    name: String,
    scores: BTreeMap<(String, u64), f64>,
    health_ok: bool,
    health_candidate: Option<String>,
    calls: Vec<(String, u64)>,
}

impl RecordedEvaluator {
    #[cfg(test)]
    pub fn new(scores: BTreeMap<(String, u64), f64>, health_ok: bool) -> Self {
        Self {
            name: "recorded-v1".into(),
            scores,
            health_ok,
            health_candidate: None,
            calls: Vec::new(),
        }
    }

    pub fn from_evidence(evidence: RecordedEvidence) -> Result<Self> {
        if evidence.evaluator != "recorded-v1" {
            bail!("CLI evidence evaluator must be recorded-v1");
        }
        let score_count = evidence.scores.values().map(BTreeMap::len).sum::<usize>();
        if score_count > 20_000 || evidence.scores.keys().any(|id| id.len() != 64) {
            bail!("recorded evidence exceeds bounded score or candidate limits");
        }
        if evidence.health.len() != 1 {
            bail!("exactly one candidate-keyed health assertion is required");
        }
        let (health_candidate, health_ok) = evidence
            .health
            .into_iter()
            .next()
            .context("candidate-keyed health evidence is required")?;
        let scores = evidence
            .scores
            .into_iter()
            .flat_map(|(id, values)| {
                values
                    .into_iter()
                    .map(move |(seed, score)| ((id.clone(), seed), score))
            })
            .collect();
        Ok(Self {
            name: evidence.evaluator,
            scores,
            health_ok,
            health_candidate: Some(health_candidate),
            calls: Vec::new(),
        })
    }

    pub fn health_evidence_snapshot(&self) -> Result<HealthEvidenceSnapshot> {
        HealthEvidenceSnapshot::new(
            &self.name,
            self.health_candidate
                .as_deref()
                .context("candidate-keyed health evidence is required")?,
            self.health_ok,
        )
    }

    #[cfg(test)]
    pub fn calls(&self) -> &[(String, u64)] {
        &self.calls
    }
}

impl Evaluator for RecordedEvaluator {
    fn name(&self) -> &str {
        &self.name
    }

    fn evaluate(&mut self, candidate_id: &str, seed: u64) -> Result<f64> {
        self.calls.push((candidate_id.to_string(), seed));
        let score = *self
            .scores
            .get(&(candidate_id.to_string(), seed))
            .with_context(|| format!("missing recorded score for {candidate_id} seed {seed}"))?;
        if !score.is_finite() || !(0.0..=1.0).contains(&score) {
            bail!("score must be finite and between 0 and 1");
        }
        Ok(score)
    }

    fn health_check(&mut self, candidate_id: &str) -> Result<bool> {
        if self
            .health_candidate
            .as_deref()
            .is_some_and(|expected| expected != candidate_id)
        {
            bail!("health evidence does not match promoted candidate");
        }
        Ok(self.health_ok)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PairedSample {
    pub seed: u64,
    pub candidate_score: f64,
    pub baseline_score: f64,
}

pub fn evaluate_paired(
    evaluator: &mut dyn Evaluator,
    candidate_id: &str,
    baseline_id: &str,
    seeds: &[u64],
) -> Result<Vec<PairedSample>> {
    if seeds.is_empty() {
        bail!("at least one explicit seed is required");
    }
    if seeds.len() > 10_000 {
        bail!("seed count exceeds 10000");
    }
    if seeds.iter().copied().collect::<BTreeSet<_>>().len() != seeds.len() {
        bail!("seeds must be unique");
    }
    seeds
        .iter()
        .map(|seed| {
            Ok(PairedSample {
                seed: *seed,
                candidate_score: evaluator.evaluate(candidate_id, *seed)?,
                baseline_score: evaluator.evaluate(baseline_id, *seed)?,
            })
        })
        .collect()
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct PromotionPolicy {
    pub min_samples: usize,
    pub min_mean_delta: f64,
    pub min_win_rate: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Comparison {
    pub passed: bool,
    pub sample_count: usize,
    pub candidate_mean: f64,
    pub baseline_mean: f64,
    pub mean_delta: f64,
    pub win_rate: f64,
    pub failures: Vec<String>,
}

impl PromotionPolicy {
    pub fn validate(self) -> Result<()> {
        if self.min_samples == 0 {
            bail!("minimum samples must be positive");
        }
        if !self.min_mean_delta.is_finite() {
            bail!("minimum mean delta must be finite");
        }
        if !self.min_win_rate.is_finite() || !(0.0..=1.0).contains(&self.min_win_rate) {
            bail!("minimum win rate must be between 0 and 1");
        }
        Ok(())
    }

    pub fn compare(self, samples: &[PairedSample]) -> Result<Comparison> {
        self.validate()?;
        if samples.is_empty() {
            bail!("samples cannot be empty");
        }
        if samples
            .iter()
            .map(|sample| sample.seed)
            .collect::<BTreeSet<_>>()
            .len()
            != samples.len()
        {
            bail!("sample seeds must be unique");
        }
        if samples.iter().any(|s| {
            !s.candidate_score.is_finite()
                || !s.baseline_score.is_finite()
                || !(0.0..=1.0).contains(&s.candidate_score)
                || !(0.0..=1.0).contains(&s.baseline_score)
        }) {
            bail!("scores must be finite and between 0 and 1");
        }
        let count = samples.len();
        let candidate_mean = samples.iter().map(|s| s.candidate_score).sum::<f64>() / count as f64;
        let baseline_mean = samples.iter().map(|s| s.baseline_score).sum::<f64>() / count as f64;
        let mean_delta = candidate_mean - baseline_mean;
        let win_rate = samples
            .iter()
            .filter(|s| s.candidate_score > s.baseline_score)
            .count() as f64
            / count as f64;
        let mut failures = Vec::new();
        if count < self.min_samples {
            failures.push(format!(
                "minimum sample count is {}, got {count}",
                self.min_samples
            ));
        }
        if mean_delta < self.min_mean_delta {
            failures.push(format!(
                "mean delta {mean_delta:.6} is below {:.6}",
                self.min_mean_delta
            ));
        }
        if win_rate < self.min_win_rate {
            failures.push(format!(
                "win rate {win_rate:.6} is below {:.6}",
                self.min_win_rate
            ));
        }
        Ok(Comparison {
            passed: failures.is_empty(),
            sample_count: count,
            candidate_mean,
            baseline_mean,
            mean_delta,
            win_rate,
            failures,
        })
    }
}
