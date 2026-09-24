use anyhow::{Context, Result};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use crate::config::Config;
use crate::session::WorktreeInfo;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MergeReadinessStatus {
    Ready,
    Conflicted,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MergeReadiness {
    pub status: MergeReadinessStatus,
    pub summary: String,
    pub conflicts: Vec<String>,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
pub enum WorktreeHealth {
    Clear,
    InProgress,
    Conflicted,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct MergeOutcome {
    pub branch: String,
    pub base_branch: String,
    pub already_up_to_date: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct RebaseOutcome {
    pub branch: String,
    pub base_branch: String,
    pub already_up_to_date: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct BranchConflictPreview {
    pub left_branch: String,
    pub right_branch: String,
    pub conflicts: Vec<String>,
    pub left_patch_preview: Option<String>,
    pub right_patch_preview: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct GitStatusEntry {
    pub path: String,
    pub display_path: String,
    pub index_status: char,
    pub worktree_status: char,
    pub staged: bool,
    pub unstaged: bool,
    pub untracked: bool,
    pub conflicted: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct DraftPrOptions {
    pub base_branch: Option<String>,
    pub labels: Vec<String>,
    pub reviewers: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GitPatchSectionKind {
    Staged,
    Unstaged,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitPatchHunk {
    pub section: GitPatchSectionKind,
    pub header: String,
    pub patch: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitStatusPatchView {
    pub path: String,
    pub display_path: String,
    pub patch: String,
    pub hunks: Vec<GitPatchHunk>,
}

/// Create a new git worktree for an agent session.
pub fn create_for_session(session_id: &str, cfg: &Config) -> Result<WorktreeInfo> {
    let repo_root = std::env::current_dir().context("Failed to resolve repository root")?;
    create_for_session_in_repo(session_id, cfg, &repo_root)
}

pub(crate) fn create_for_session_in_repo(
    session_id: &str,
    cfg: &Config,
    repo_root: &Path,
) -> Result<WorktreeInfo> {
    let branch = branch_name_for_session(session_id, cfg, repo_root)?;
    let path = cfg.worktree_root.join(session_id);

    // Get current branch as base
    let base = get_current_branch(repo_root)?;

    std::fs::create_dir_all(&cfg.worktree_root)
        .context("Failed to create worktree root directory")?;

    let output = Command::new("git")
        .arg("-C")
        .arg(repo_root)
        .args(["worktree", "add", "-b", &branch])
        .arg(&path)
        .arg("HEAD")
        .output()
        .context("Failed to run git worktree add")?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        anyhow::bail!("git worktree add failed: {stderr}");
    }

    tracing::info!(
        "Created worktree at {} on branch {}",
        path.display(),
        branch
    );

    let info = WorktreeInfo {
        path,
        branch,
        base_branch: base,
    };

    if let Err(error) = sync_shared_dependency_dirs_in_repo(&info, repo_root) {
        tracing::warn!(
            "Shared dependency cache sync warning for {}: {error}",
            info.path.display()
        );
    }

    Ok(info)
}

pub fn sync_shared_dependency_dirs(worktree: &WorktreeInfo) -> Result<Vec<String>> {
    let repo_root = base_checkout_path(worktree)?;
    sync_shared_dependency_dirs_in_repo(worktree, &repo_root)
}

pub(crate) fn branch_name_for_session(
    session_id: &str,
    cfg: &Config,
    repo_root: &Path,
) -> Result<String> {
    let prefix = cfg.worktree_branch_prefix.trim().trim_matches('/');
    if prefix.is_empty() {
        anyhow::bail!("worktree_branch_prefix cannot be empty");
    }

    let branch = format!("{prefix}/{session_id}");
    validate_branch_name(repo_root, &branch).with_context(|| {
        format!(
            "Invalid worktree branch '{branch}' derived from prefix '{}' and session id '{session_id}'",
            cfg.worktree_branch_prefix
        )
    })?;

    Ok(branch)
}

/// Remove a worktree and its branch.
pub fn remove(worktree: &WorktreeInfo) -> Result<()> {
    let repo_root = match base_checkout_path(worktree) {
        Ok(path) => path,
        Err(error) => {
            tracing::warn!(
                "Falling back to filesystem-only cleanup for {}: {error}",
                worktree.path.display()
            );
            if worktree.path.exists() {
                if let Err(remove_error) = std::fs::remove_dir_all(&worktree.path) {
                    tracing::warn!(
                        "Fallback worktree directory cleanup warning for {}: {remove_error}",
                        worktree.path.display()
                    );
                }
            }
            return Ok(());
        }
    };
    let output = Command::new("git")
        .arg("-C")
        .arg(&repo_root)
        .args(["worktree", "remove", "--force"])
        .arg(&worktree.path)
        .output()
        .context("Failed to remove worktree")?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        tracing::warn!("Worktree removal warning: {stderr}");
        if worktree.path.exists() {
            if let Err(remove_error) = std::fs::remove_dir_all(&worktree.path) {
                tracing::warn!(
                    "Fallback worktree directory cleanup warning for {}: {remove_error}",
                    worktree.path.display()
                );
            }
        }
    }

    let branch_output = Command::new("git")
        .arg("-C")
        .arg(&repo_root)
        .args(["branch", "-D", &worktree.branch])
        .output()
        .context("Failed to delete worktree branch")?;

    if !branch_output.status.success() {
        let stderr = String::from_utf8_lossy(&branch_output.stderr);
        tracing::warn!(
            "Worktree branch deletion warning for {}: {stderr}",
            worktree.branch
        );
    }

    Ok(())
}

/// List all active worktrees.
pub fn list() -> Result<Vec<String>> {
    let output = Command::new("git")
        .args(["worktree", "list", "--porcelain"])
        .output()
        .context("Failed to list worktrees")?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let worktrees: Vec<String> = stdout
        .lines()
        .filter(|l| l.starts_with("worktree "))
        .map(|l| l.trim_start_matches("worktree ").to_string())
        .collect();

    Ok(worktrees)
}

pub fn diff_summary(worktree: &WorktreeInfo) -> Result<Option<String>> {
    let base_ref = format!("{}...HEAD", worktree.base_branch);
    let committed = git_diff_shortstat(&worktree.path, &[&base_ref])?;
    let working = git_diff_shortstat(&worktree.path, &[])?;

    let mut parts = Vec::new();
    if let Some(committed) = committed {
        parts.push(format!("Branch {committed}"));
    }
    if let Some(working) = working {
        parts.push(format!("Working tree {working}"));
    }

    if parts.is_empty() {
        Ok(Some(format!("Clean relative to {}", worktree.base_branch)))
    } else {
        Ok(Some(parts.join(" | ")))
    }
}

pub fn git_status_entries(worktree: &WorktreeInfo) -> Result<Vec<GitStatusEntry>> {
    let output = Command::new("git")
        .arg("-C")
        .arg(&worktree.path)
        .args(["status", "--porcelain=v1", "--untracked-files=all"])
        .output()
        .context("Failed to load git status entries")?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        anyhow::bail!("git status failed: {stderr}");
    }

    Ok(String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(parse_git_status_entry)
        .collect())
}

pub fn stage_path(worktree: &WorktreeInfo, path: &str) -> Result<()> {
    let output = Command::new("git")
        .arg("-C")
        .arg(&worktree.path)
        .args(["add", "--"])
        .arg(path)
        .output()
        .with_context(|| format!("Failed to stage {}", path))?;
    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        anyhow::bail!("git add failed for {path}: {stderr}");
    }
}

pub fn unstage_path(worktree: &WorktreeInfo, path: &str) -> Result<()> {
    let output = Command::new("git")
        .arg("-C")
        .arg(&worktree.path)
        .args(["reset", "HEAD", "--"])
        .arg(path)
        .output()
        .with_context(|| format!("Failed to unstage {}", path))?;
    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        anyhow::bail!("git reset failed for {path}: {stderr}");
    }
}

pub fn reset_path(worktree: &WorktreeInfo, entry: &GitStatusEntry) -> Result<()> {
    if entry.untracked {
        let target = worktree.path.join(&entry.path);
        if !target.exists() {
            return Ok(());
        }
        let metadata = fs::symlink_metadata(&target)
            .with_context(|| format!("Failed to inspect untracked path {}", target.display()))?;
        if metadata.is_dir() {
            fs::remove_dir_all(&target)
                .with_context(|| format!("Failed to remove {}", target.display()))?;
        } else {
            fs::remove_file(&target)
                .with_context(|| format!("Failed to remove {}", target.display()))?;
        }
        return Ok(());
    }

    let output = Command::new("git")
        .arg("-C")
        .arg(&worktree.path)
        .args(["restore", "--source=HEAD", "--staged", "--worktree", "--"])
        .arg(&entry.path)
        .output()
        .with_context(|| format!("Failed to reset {}", entry.path))?;
    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        anyhow::bail!("git restore failed for {}: {stderr}", entry.path);
    }
}

pub fn git_status_patch_view(
    worktree: &WorktreeInfo,
    entry: &GitStatusEntry,
) -> Result<Option<GitStatusPatchView>> {
    if entry.untracked {
        return Ok(None);
    }

    let staged_patch =
        git_diff_patch_text_for_paths(&worktree.path, &["--cached"], &[entry.path.clone()])?;
    let unstaged_patch = git_diff_patch_text_for_paths(&worktree.path, &[], &[entry.path.clone()])?;

    let mut sections = Vec::new();
    let mut hunks = Vec::new();

    if !staged_patch.trim().is_empty() {
        sections.push(format!("--- Staged diff ---\n{}", staged_patch.trim_end()));
        hunks.extend(extract_patch_hunks(
            GitPatchSectionKind::Staged,
            &staged_patch,
        ));
    }
    if !unstaged_patch.trim().is_empty() {
        sections.push(format!(
            "--- Working tree diff ---\n{}",
            unstaged_patch.trim_end()
        ));
        hunks.extend(extract_patch_hunks(
            GitPatchSectionKind::Unstaged,
            &unstaged_patch,
        ));
    }

    if sections.is_empty() {
        Ok(None)
    } else {
        Ok(Some(GitStatusPatchView {
            path: entry.path.clone(),
            display_path: entry.display_path.clone(),
            patch: sections.join("\n\n"),
            hunks,
        }))
    }
}

pub fn stage_hunk(worktree: &WorktreeInfo, hunk: &GitPatchHunk) -> Result<()> {
    if hunk.section != GitPatchSectionKind::Unstaged {
        anyhow::bail!("selected hunk is already staged");
    }
    git_apply_patch(
        &worktree.path,
        &["--cached"],
        &hunk.patch,
        "stage selected hunk",
    )
}

pub fn unstage_hunk(worktree: &WorktreeInfo, hunk: &GitPatchHunk) -> Result<()> {
    if hunk.section != GitPatchSectionKind::Staged {
        anyhow::bail!("selected hunk is not staged");
    }
    git_apply_patch(
        &worktree.path,
        &["-R", "--cached"],
        &hunk.patch,
        "unstage selected hunk",
    )
}

pub fn reset_hunk(
    worktree: &WorktreeInfo,
    entry: &GitStatusEntry,
    hunk: &GitPatchHunk,
) -> Result<()> {
    if entry.untracked {
        anyhow::bail!("cannot reset hunks for untracked files");
    }

    match hunk.section {
        GitPatchSectionKind::Unstaged => {
            git_apply_patch(&worktree.path, &["-R"], &hunk.patch, "reset selected hunk")
        }
        GitPatchSectionKind::Staged => {
            if entry.unstaged {
                anyhow::bail!(
                    "cannot reset a staged hunk while the file also has unstaged changes; unstage it first"
                );
            }
            git_apply_patch(
                &worktree.path,
                &["-R", "--index"],
                &hunk.patch,
                "reset selected staged hunk",
            )
        }
    }
}

pub fn commit_staged(worktree: &WorktreeInfo, message: &str) -> Result<String> {
    let message = message.trim();
    if message.is_empty() {
        anyhow::bail!("commit message cannot be empty");
    }
    if !has_staged_changes(worktree)? {
        anyhow::bail!("no staged changes to commit");
    }

    let output = Command::new("git")
        .arg("-C")
        .arg(&worktree.path)
        .args(["commit", "-m", message])
        .output()
        .context("Failed to create commit")?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        anyhow::bail!("git commit failed: {stderr}");
    }

    let rev_parse = Command::new("git")
        .arg("-C")
        .arg(&worktree.path)
        .args(["rev-parse", "--short", "HEAD"])
        .output()
        .context("Failed to resolve commit hash")?;
    if !rev_parse.status.success() {
        let stderr = String::from_utf8_lossy(&rev_parse.stderr);
        anyhow::bail!("git rev-parse failed: {stderr}");
    }

    Ok(String::from_utf8_lossy(&rev_parse.stdout)
        .trim()
        .to_string())
}

pub fn latest_commit_subject(worktree: &WorktreeInfo) -> Result<String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(&worktree.path)
        .args(["log", "-1", "--pretty=%s"])
        .output()
        .context("Failed to read latest commit subject")?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        anyhow::bail!("git log failed: {stderr}");
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

pub fn create_draft_pr(worktree: &WorktreeInfo, title: &str, body: &str) -> Result<String> {
    create_draft_pr_with_options(worktree, title, body, &DraftPrOptions::default())
}

pub fn create_draft_pr_with_options(
    worktree: &WorktreeInfo,
    title: &str,
    body: &str,
    options: &DraftPrOptions,
) -> Result<String> {
    create_draft_pr_with_gh(worktree, title, body, options, Path::new("gh"))
}

pub fn github_compare_url(worktree: &WorktreeInfo) -> Result<Option<String>> {
    let repo_root = base_checkout_path(worktree)?;
    let origin = git_remote_origin_url(&repo_root)?;
    let Some(repo_url) = github_repo_web_url(&origin) else {
        return Ok(None);
    };

    Ok(Some(format!(
        "{repo_url}/compare/{}...{}?expand=1",
        percent_encode_git_ref(&worktree.base_branch),
        percent_encode_git_ref(&worktree.branch)
    )))
}

fn create_draft_pr_with_gh(
    worktree: &WorktreeInfo,
    title: &str,
    body: &str,
    options: &DraftPrOptions,
    gh_bin: &Path,
) -> Result<String> {
    let title = title.trim();
    if title.is_empty() {
        anyhow::bail!("PR title cannot be empty");
    }

    let base_branch = options
        .base_branch
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(&worktree.base_branch);

    let push = Command::new("git")
        .arg("-C")
        .arg(&worktree.path)
        .args(["push", "-u", "origin", &worktree.branch])
        .output()
        .context("Failed to push worktree branch before PR creation")?;
    if !push.status.success() {
        let stderr = String::from_utf8_lossy(&push.stderr);
        anyhow::bail!("git push failed: {stderr}");
    }

    let mut command = Command::new(gh_bin);
    command
        .arg("pr")
        .arg("create")
        .arg("--draft")
        .arg("--base")
        .arg(base_branch)
        .arg("--head")
        .arg(&worktree.branch)
        .arg("--title")
        .arg(title)
        .arg("--body")
        .arg(body);
    for label in options
        .labels
        .iter()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        command.arg("--label").arg(label);
    }
    for reviewer in options
        .reviewers
        .iter()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        command.arg("--reviewer").arg(reviewer);
    }
    let output = command
        .current_dir(&worktree.path)
        .output()
        .context("Failed to create draft PR with gh")?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        anyhow::bail!("gh pr create failed: {stderr}");
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn git_remote_origin_url(repo_root: &Path) -> Result<String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(repo_root)
        .args(["remote", "get-url", "origin"])
        .output()
        .context("Failed to resolve git origin remote")?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        anyhow::bail!("git remote get-url origin failed: {stderr}");
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn github_repo_web_url(origin: &str) -> Option<String> {
    let trimmed = origin.trim().trim_end_matches(".git");
    if trimmed.is_empty() {
        return None;
    }

    if let Some(rest) = trimmed.strip_prefix("git@") {
        let (host, path) = rest.split_once(':')?;
        return Some(format!("https://{host}/{}", path.trim_start_matches('/')));
    }

    if let Some(rest) = trimmed.strip_prefix("ssh://") {
        return parse_httpish_remote(rest);
    }

    if let Some(rest) = trimmed.strip_prefix("https://") {
        return parse_httpish_remote(rest);
    }

    if let Some(rest) = trimmed.strip_prefix("http://") {
        return parse_httpish_remote(rest);
    }

    None
}

fn parse_httpish_remote(rest: &str) -> Option<String> {
    let without_user = rest.strip_prefix("git@").unwrap_or(rest);
    let (host, path) = without_user.split_once('/')?;
    Some(format!("https://{host}/{}", path.trim_start_matches('/')))
}

fn percent_encode_git_ref(value: &str) -> String {
    let mut encoded = String::with_capacity(value.len());
    for byte in value.bytes() {
        let ch = byte as char;
        if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.' | '~') {
            encoded.push(ch);
        } else {
            encoded.push('%');
            encoded.push_str(&format!("{byte:02X}"));
        }
    }
    encoded
}

pub fn diff_file_preview(worktree: &WorktreeInfo, limit: usize) -> Result<Vec<String>> {
    let mut preview = Vec::new();
    let base_ref = format!("{}...HEAD", worktree.base_branch);

    let committed = git_diff_name_status(&worktree.path, &[&base_ref])?;
    if !committed.is_empty() {
        preview.extend(
            committed
                .into_iter()
                .map(|entry| format!("Branch {entry}"))
                .take(limit.saturating_sub(preview.len())),
        );
    }

    if preview.len() < limit {
        let working = git_status_short(&worktree.path)?;
        if !working.is_empty() {
            preview.extend(
                working
                    .into_iter()
                    .map(|entry| format!("Working {entry}"))
                    .take(limit.saturating_sub(preview.len())),
            );
        }
    }

    Ok(preview)
}

pub fn diff_patch_preview(worktree: &WorktreeInfo, max_lines: usize) -> Result<Option<String>> {
    let mut remaining = max_lines.max(1);
    let mut sections = Vec::new();
    let base_ref = format!("{}...HEAD", worktree.base_branch);

    let committed = git_diff_patch_lines(&worktree.path, &[&base_ref])?;
    if !committed.is_empty() && remaining > 0 {
        let taken = take_preview_lines(&committed, &mut remaining);
        sections.push(format!(
            "--- Branch diff vs {} ---\n{}",
            worktree.base_branch,
            taken.join("\n")
        ));
    }

    let working = git_diff_patch_lines(&worktree.path, &[])?;
    if !working.is_empty() && remaining > 0 {
        let taken = take_preview_lines(&working, &mut remaining);
        sections.push(format!("--- Working tree diff ---\n{}", taken.join("\n")));
    }

    if sections.is_empty() {
        Ok(None)
    } else {
        Ok(Some(sections.join("\n\n")))
    }
}

pub fn merge_readiness(worktree: &WorktreeInfo) -> Result<MergeReadiness> {
    let mut readiness = merge_readiness_for_branches(
        &base_checkout_path(worktree)?,
        &worktree.base_branch,
        &worktree.branch,
    )?;
    readiness.summary = match readiness.status {
        MergeReadinessStatus::Ready => format!("Merge ready into {}", worktree.base_branch),
        MergeReadinessStatus::Conflicted => {
            let conflict_summary = readiness
                .conflicts
                .iter()
                .take(3)
                .cloned()
                .collect::<Vec<_>>()
                .join(", ");
            let overflow = readiness.conflicts.len().saturating_sub(3);
            let detail = if overflow > 0 {
                format!("{conflict_summary}, +{overflow} more")
            } else {
                conflict_summary
            };
            format!(
                "Merge blocked by {} conflict(s): {detail}",
                readiness.conflicts.len()
            )
        }
    };
    Ok(readiness)
}

pub fn merge_readiness_for_branches(
    repo_root: &Path,
    left_branch: &str,
    right_branch: &str,
) -> Result<MergeReadiness> {
    let output = Command::new("git")
        .arg("-C")
        .arg(repo_root)
        .args(["merge-tree", "--write-tree", left_branch, right_branch])
        .output()
        .context("Failed to generate merge readiness preview")?;

    let merged_output = format!(
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    let conflicts = merged_output
        .lines()
        .filter_map(parse_merge_conflict_path)
        .collect::<Vec<_>>();

    if output.status.success() {
        return Ok(MergeReadiness {
            status: MergeReadinessStatus::Ready,
            summary: format!("Merge ready: {right_branch} into {left_branch}"),
            conflicts: Vec::new(),
        });
    }

    if !conflicts.is_empty() {
        let conflict_summary = conflicts
            .iter()
            .take(3)
            .cloned()
            .collect::<Vec<_>>()
            .join(", ");
        let overflow = conflicts.len().saturating_sub(3);
        let detail = if overflow > 0 {
            format!("{conflict_summary}, +{overflow} more")
        } else {
            conflict_summary
        };

        return Ok(MergeReadiness {
            status: MergeReadinessStatus::Conflicted,
            summary: format!(
                "Merge blocked between {left_branch} and {right_branch} by {} conflict(s): {detail}",
                conflicts.len()
            ),
            conflicts,
        });
    }

    let stderr = String::from_utf8_lossy(&output.stderr);
    anyhow::bail!("git merge-tree failed: {stderr}");
}

pub fn branch_conflict_preview(
    left: &WorktreeInfo,
    right: &WorktreeInfo,
    max_lines: usize,
) -> Result<Option<BranchConflictPreview>> {
    if left.base_branch != right.base_branch {
        return Ok(None);
    }

    let repo_root = base_checkout_path(left)?;
    let readiness = merge_readiness_for_branches(&repo_root, &left.branch, &right.branch)?;
    if readiness.status != MergeReadinessStatus::Conflicted {
        return Ok(None);
    }

    Ok(Some(BranchConflictPreview {
        left_branch: left.branch.clone(),
        right_branch: right.branch.clone(),
        conflicts: readiness.conflicts.clone(),
        left_patch_preview: diff_patch_preview_for_paths(left, &readiness.conflicts, max_lines)?,
        right_patch_preview: diff_patch_preview_for_paths(right, &readiness.conflicts, max_lines)?,
    }))
}

pub fn health(worktree: &WorktreeInfo) -> Result<WorktreeHealth> {
    let merge_readiness = merge_readiness(worktree)?;
    if merge_readiness.status == MergeReadinessStatus::Conflicted {
        return Ok(WorktreeHealth::Conflicted);
    }

    if diff_file_preview(worktree, 1)?.is_empty() {
        Ok(WorktreeHealth::Clear)
    } else {
        Ok(WorktreeHealth::InProgress)
    }
}

pub fn has_uncommitted_changes(worktree: &WorktreeInfo) -> Result<bool> {
    Ok(!git_status_short(&worktree.path)?.is_empty())
}

pub fn has_staged_changes(worktree: &WorktreeInfo) -> Result<bool> {
    Ok(git_status_entries(worktree)?
        .iter()
        .any(|entry| entry.staged))
}

pub fn merge_into_base(worktree: &WorktreeInfo) -> Result<MergeOutcome> {
    let readiness = merge_readiness(worktree)?;
    if readiness.status == MergeReadinessStatus::Conflicted {
        anyhow::bail!(readiness.summary);
    }

    if has_uncommitted_changes(worktree)? {
        anyhow::bail!(
            "Worktree {} has uncommitted changes; commit or discard them before merging",
            worktree.branch
        );
    }

    let repo_root = base_checkout_path(worktree)?;
    let current_branch = get_current_branch(&repo_root)?;
    if current_branch != worktree.base_branch {
        anyhow::bail!(
            "Base branch {} is not checked out in repo root (currently {})",
            worktree.base_branch,
            current_branch
        );
    }

    if !git_status_short(&repo_root)?.is_empty() {
        anyhow::bail!(
            "Repository root {} has uncommitted changes; commit or stash them before merging",
            repo_root.display()
        );
    }

    let output = Command::new("git")
        .arg("-C")
        .arg(&repo_root)
        .args(["merge", "--no-edit", &worktree.branch])
        .output()
        .context("Failed to merge worktree branch into base")?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        anyhow::bail!("git merge failed: {stderr}");
    }

    let merged_output = format!(
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );

    Ok(MergeOutcome {
        branch: worktree.branch.clone(),
        base_branch: worktree.base_branch.clone(),
        already_up_to_date: merged_output.contains("Already up to date."),
    })
}

pub fn rebase_onto_base(worktree: &WorktreeInfo) -> Result<RebaseOutcome> {
    if has_uncommitted_changes(worktree)? {
        anyhow::bail!(
            "Worktree {} has uncommitted changes; commit or discard them before rebasing",
            worktree.branch
        );
    }

    let repo_root = base_checkout_path(worktree)?;
    let before_head = branch_head_oid_in_repo(&repo_root, &worktree.branch)?;
    let output = Command::new("git")
        .arg("-C")
        .arg(&worktree.path)
        .args(["rebase", &worktree.base_branch])
        .output()
        .context("Failed to rebase worktree branch onto base")?;

    if !output.status.success() {
        let abort_output = Command::new("git")
            .arg("-C")
            .arg(&worktree.path)
            .args(["rebase", "--abort"])
            .output()
            .context("Failed to abort unsuccessful rebase")?;
        let abort_warning = if abort_output.status.success() {
            String::new()
        } else {
            format!(
                " (rebase abort warning: {})",
                String::from_utf8_lossy(&abort_output.stderr).trim()
            )
        };
        let stderr = format!(
            "{}\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        anyhow::bail!("git rebase failed: {}{}", stderr.trim(), abort_warning);
    }

    let after_head = branch_head_oid_in_repo(&repo_root, &worktree.branch)?;
    let rebase_output = format!(
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );

    Ok(RebaseOutcome {
        branch: worktree.branch.clone(),
        base_branch: worktree.base_branch.clone(),
        already_up_to_date: before_head == after_head || rebase_output.contains("up to date"),
    })
}

pub fn branch_head_oid(worktree: &WorktreeInfo, branch: &str) -> Result<String> {
    let repo_root = base_checkout_path(worktree)?;
    branch_head_oid_in_repo(&repo_root, branch)
}

fn git_diff_shortstat(worktree_path: &Path, extra_args: &[&str]) -> Result<Option<String>> {
    let mut command = Command::new("git");
    command
        .arg("-C")
        .arg(worktree_path)
        .arg("diff")
        .arg("--shortstat");
    command.args(extra_args);

    let output = command
        .output()
        .context("Failed to generate worktree diff summary")?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        tracing::warn!(
            "Worktree diff summary warning for {}: {stderr}",
            worktree_path.display()
        );
        return Ok(None);
    }

    let summary = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if summary.is_empty() {
        Ok(None)
    } else {
        Ok(Some(summary))
    }
}

fn git_diff_name_status(worktree_path: &Path, extra_args: &[&str]) -> Result<Vec<String>> {
    let mut command = Command::new("git");
    command
        .arg("-C")
        .arg(worktree_path)
        .arg("diff")
        .arg("--name-status");
    command.args(extra_args);

    let output = command
        .output()
        .context("Failed to generate worktree diff file preview")?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        tracing::warn!(
            "Worktree diff file preview warning for {}: {stderr}",
            worktree_path.display()
        );
        return Ok(Vec::new());
    }

    Ok(parse_nonempty_lines(&output.stdout))
}

fn git_diff_patch_lines(worktree_path: &Path, extra_args: &[&str]) -> Result<Vec<String>> {
    let mut command = Command::new("git");
    command
        .arg("-C")
        .arg(worktree_path)
        .arg("diff")
        .args(["--stat", "--patch", "--find-renames"]);
    command.args(extra_args);

    let output = command
        .output()
        .context("Failed to generate worktree patch preview")?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        tracing::warn!(
            "Worktree patch preview warning for {}: {stderr}",
            worktree_path.display()
        );
        return Ok(Vec::new());
    }

    Ok(parse_nonempty_lines(&output.stdout))
}

fn git_diff_patch_text_for_paths(
    worktree_path: &Path,
    extra_args: &[&str],
    paths: &[String],
) -> Result<String> {
    if paths.is_empty() {
        return Ok(String::new());
    }

    let mut command = Command::new("git");
    command
        .arg("-C")
        .arg(worktree_path)
        .arg("diff")
        .args(["--patch", "--find-renames"]);
    command.args(extra_args);
    command.arg("--");
    for path in paths {
        command.arg(path);
    }

    let output = command
        .output()
        .context("Failed to generate filtered git patch")?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        anyhow::bail!("git diff failed: {stderr}");
    }

    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

fn git_diff_patch_lines_for_paths(
    worktree_path: &Path,
    extra_args: &[&str],
    paths: &[String],
) -> Result<Vec<String>> {
    if paths.is_empty() {
        return Ok(Vec::new());
    }

    let mut command = Command::new("git");
    command
        .arg("-C")
        .arg(worktree_path)
        .arg("diff")
        .args(["--stat", "--patch", "--find-renames"]);
    command.args(extra_args);
    command.arg("--");
    for path in paths {
        command.arg(path);
    }

    let output = command
        .output()
        .context("Failed to generate filtered worktree patch preview")?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        tracing::warn!(
            "Filtered worktree patch preview warning for {}: {stderr}",
            worktree_path.display()
        );
        return Ok(Vec::new());
    }

    Ok(parse_nonempty_lines(&output.stdout))
}

fn extract_patch_hunks(section: GitPatchSectionKind, patch_text: &str) -> Vec<GitPatchHunk> {
    let lines: Vec<&str> = patch_text.lines().collect();
    let Some(diff_start) = lines
        .iter()
        .position(|line| line.starts_with("diff --git "))
    else {
        return Vec::new();
    };
    let Some(first_hunk_start) = lines
        .iter()
        .enumerate()
        .skip(diff_start)
        .find_map(|(index, line)| line.starts_with("@@").then_some(index))
    else {
        return Vec::new();
    };

    let header_lines = lines[diff_start..first_hunk_start].to_vec();
    let hunk_starts = lines
        .iter()
        .enumerate()
        .skip(first_hunk_start)
        .filter_map(|(index, line)| line.starts_with("@@").then_some(index))
        .collect::<Vec<_>>();

    hunk_starts
        .iter()
        .enumerate()
        .map(|(position, start)| {
            let end = hunk_starts
                .get(position + 1)
                .copied()
                .unwrap_or(lines.len());
            let mut patch_lines = header_lines
                .iter()
                .map(|line| (*line).to_string())
                .collect::<Vec<_>>();
            patch_lines.extend(lines[*start..end].iter().map(|line| (*line).to_string()));
            GitPatchHunk {
                section,
                header: lines[*start].to_string(),
                patch: format!("{}\n", patch_lines.join("\n")),
            }
        })
        .collect()
}

fn git_apply_patch(worktree_path: &Path, args: &[&str], patch: &str, action: &str) -> Result<()> {
    let mut child = Command::new("git")
        .arg("-C")
        .arg(worktree_path)
        .arg("apply")
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .with_context(|| format!("Failed to {action}"))?;

    {
        let stdin = child
            .stdin
            .as_mut()
            .context("Failed to open git apply stdin")?;
        stdin
            .write_all(patch.as_bytes())
            .with_context(|| format!("Failed to write patch for {action}"))?;
    }

    let output = child
        .wait_with_output()
        .with_context(|| format!("Failed to wait for git apply while trying to {action}"))?;
    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        anyhow::bail!("git apply failed while trying to {action}: {stderr}");
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct SharedDependencyStrategy {
    label: &'static str,
    dir_name: &'static str,
    fingerprint_files: Vec<&'static str>,
}

fn sync_shared_dependency_dirs_in_repo(
    worktree: &WorktreeInfo,
    repo_root: &Path,
) -> Result<Vec<String>> {
    let mut applied = Vec::new();
    for strategy in detect_shared_dependency_strategies(repo_root) {
        if sync_shared_dependency_dir(worktree, repo_root, &strategy)? {
            applied.push(strategy.label.to_string());
        }
    }
    Ok(applied)
}

fn detect_shared_dependency_strategies(repo_root: &Path) -> Vec<SharedDependencyStrategy> {
    let mut strategies = Vec::new();

    if repo_root.join("node_modules").is_dir() {
        if repo_root.join("pnpm-lock.yaml").is_file() && repo_root.join("package.json").is_file() {
            strategies.push(SharedDependencyStrategy {
                label: "node_modules (pnpm)",
                dir_name: "node_modules",
                fingerprint_files: vec!["package.json", "pnpm-lock.yaml"],
            });
        } else if repo_root.join("bun.lockb").is_file() && repo_root.join("package.json").is_file()
        {
            strategies.push(SharedDependencyStrategy {
                label: "node_modules (bun)",
                dir_name: "node_modules",
                fingerprint_files: vec!["package.json", "bun.lockb"],
            });
        } else if repo_root.join("yarn.lock").is_file() && repo_root.join("package.json").is_file()
        {
            strategies.push(SharedDependencyStrategy {
                label: "node_modules (yarn)",
                dir_name: "node_modules",
                fingerprint_files: vec!["package.json", "yarn.lock"],
            });
        } else if repo_root.join("package-lock.json").is_file()
            && repo_root.join("package.json").is_file()
        {
            strategies.push(SharedDependencyStrategy {
                label: "node_modules (npm)",
                dir_name: "node_modules",
                fingerprint_files: vec!["package.json", "package-lock.json"],
            });
        }
    }

    if repo_root.join("target").is_dir() && repo_root.join("Cargo.toml").is_file() {
        let mut fingerprint_files = vec!["Cargo.toml"];
        if repo_root.join("Cargo.lock").is_file() {
            fingerprint_files.push("Cargo.lock");
        }
        strategies.push(SharedDependencyStrategy {
            label: "target (cargo)",
            dir_name: "target",
            fingerprint_files,
        });
    }

    if repo_root.join(".venv").is_dir() {
        let python_files = [
            "uv.lock",
            "poetry.lock",
            "Pipfile.lock",
            "requirements.txt",
            "pyproject.toml",
            "setup.py",
            "setup.cfg",
        ];
        let fingerprint_files = python_files
            .into_iter()
            .filter(|file| repo_root.join(file).is_file())
            .collect::<Vec<_>>();
        if !fingerprint_files.is_empty() {
            strategies.push(SharedDependencyStrategy {
                label: ".venv (python)",
                dir_name: ".venv",
                fingerprint_files,
            });
        }
    }

    strategies
}

fn sync_shared_dependency_dir(
    worktree: &WorktreeInfo,
    repo_root: &Path,
    strategy: &SharedDependencyStrategy,
) -> Result<bool> {
    let root_dir = repo_root.join(strategy.dir_name);
    if !root_dir.exists() {
        return Ok(false);
    }

    let worktree_dir = worktree.path.join(strategy.dir_name);
    let worktree_is_symlink = fs::symlink_metadata(&worktree_dir)
        .map(|metadata| metadata.file_type().is_symlink())
        .unwrap_or(false);
    let root_fingerprint = dependency_fingerprint(repo_root, &strategy.fingerprint_files)?;
    let worktree_fingerprint =
        dependency_fingerprint(&worktree.path, &strategy.fingerprint_files).ok();

    if worktree_fingerprint.as_deref() != Some(root_fingerprint.as_str()) {
        if worktree_is_symlink {
            remove_symlink(&worktree_dir)?;
            fs::create_dir_all(&worktree_dir).with_context(|| {
                format!(
                    "Failed to create independent {} directory in {}",
                    strategy.dir_name,
                    worktree.path.display()
                )
            })?;
        }
        return Ok(false);
    }

    if worktree_dir.exists() {
        if is_symlink_to(&worktree_dir, &root_dir)? {
            return Ok(true);
        }
        return Ok(false);
    }

    create_dir_symlink(&root_dir, &worktree_dir).with_context(|| {
        format!(
            "Failed to link shared dependency cache {} into {}",
            strategy.dir_name,
            worktree.path.display()
        )
    })?;
    Ok(true)
}

fn dependency_fingerprint(root: &Path, files: &[&str]) -> Result<String> {
    let mut hasher = Sha256::new();
    for rel in files {
        let path = root.join(rel);
        let content = fs::read(&path).with_context(|| {
            format!(
                "Failed to read dependency fingerprint input {}",
                path.display()
            )
        })?;
        hasher.update(rel.as_bytes());
        hasher.update([0]);
        hasher.update(&content);
        hasher.update([0xff]);
    }
    // sha2 0.11 output arrays no longer implement LowerHex; hex-encode manually.
    Ok(hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect())
}

fn is_symlink_to(path: &Path, target: &Path) -> Result<bool> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => {
            return Err(error).with_context(|| {
                format!("Failed to inspect dependency cache link {}", path.display())
            })
        }
    };
    if !metadata.file_type().is_symlink() {
        return Ok(false);
    }

    let linked = fs::read_link(path)
        .with_context(|| format!("Failed to read dependency cache link {}", path.display()))?;
    Ok(linked == target)
}

fn remove_symlink(path: &Path) -> Result<()> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::IsADirectory => fs::remove_dir(path)
            .with_context(|| format!("Failed to remove dependency cache link {}", path.display())),
        Err(error) => Err(error)
            .with_context(|| format!("Failed to remove dependency cache link {}", path.display())),
    }
}

#[cfg(unix)]
fn create_dir_symlink(src: &Path, dst: &Path) -> std::io::Result<()> {
    std::os::unix::fs::symlink(src, dst)
}

#[cfg(windows)]
fn create_dir_symlink(src: &Path, dst: &Path) -> std::io::Result<()> {
    std::os::windows::fs::symlink_dir(src, dst)
}

pub fn diff_patch_preview_for_paths(
    worktree: &WorktreeInfo,
    paths: &[String],
    max_lines: usize,
) -> Result<Option<String>> {
    if paths.is_empty() {
        return Ok(None);
    }

    let mut remaining = max_lines.max(1);
    let mut sections = Vec::new();
    let base_ref = format!("{}...HEAD", worktree.base_branch);

    let committed = git_diff_patch_lines_for_paths(&worktree.path, &[&base_ref], paths)?;
    if !committed.is_empty() && remaining > 0 {
        let taken = take_preview_lines(&committed, &mut remaining);
        sections.push(format!(
            "--- Branch diff vs {} ---\n{}",
            worktree.base_branch,
            taken.join("\n")
        ));
    }

    let working = git_diff_patch_lines_for_paths(&worktree.path, &[], paths)?;
    if !working.is_empty() && remaining > 0 {
        let taken = take_preview_lines(&working, &mut remaining);
        sections.push(format!("--- Working tree diff ---\n{}", taken.join("\n")));
    }

    if sections.is_empty() {
        Ok(None)
    } else {
        Ok(Some(sections.join("\n\n")))
    }
}

fn git_status_short(worktree_path: &Path) -> Result<Vec<String>> {
    let output = Command::new("git")
        .arg("-C")
        .arg(worktree_path)
        .args(["status", "--short"])
        .output()
        .context("Failed to generate worktree status preview")?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        tracing::warn!(
            "Worktree status preview warning for {}: {stderr}",
            worktree_path.display()
        );
        return Ok(Vec::new());
    }

    Ok(parse_nonempty_lines(&output.stdout))
}

fn branch_head_oid_in_repo(repo_root: &Path, branch: &str) -> Result<String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(repo_root)
        .args(["rev-parse", branch])
        .output()
        .context("Failed to resolve branch head")?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        anyhow::bail!("git rev-parse failed: {stderr}");
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn validate_branch_name(repo_root: &Path, branch: &str) -> Result<()> {
    let output = Command::new("git")
        .arg("-C")
        .arg(repo_root)
        .args(["check-ref-format", "--branch", branch])
        .output()
        .context("Failed to validate worktree branch name")?;

    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if stderr.is_empty() {
            anyhow::bail!("branch name is not a valid git ref");
        } else {
            anyhow::bail!("{stderr}");
        }
    }
}

fn parse_git_status_entry(line: &str) -> Option<GitStatusEntry> {
    if line.len() < 4 {
        return None;
    }
    let bytes = line.as_bytes();
    let index_status = bytes[0] as char;
    let worktree_status = bytes[1] as char;
    let raw_path = line.get(3..)?.trim();
    if raw_path.is_empty() {
        return None;
    }
    let display_path = raw_path.to_string();
    let normalized_path = raw_path
        .split(" -> ")
        .last()
        .unwrap_or(raw_path)
        .trim()
        .to_string();
    let conflicted = matches!(
        (index_status, worktree_status),
        ('U', _) | (_, 'U') | ('A', 'A') | ('D', 'D')
    );
    Some(GitStatusEntry {
        path: normalized_path,
        display_path,
        index_status,
        worktree_status,
        staged: index_status != ' ' && index_status != '?',
        unstaged: worktree_status != ' ' && worktree_status != '?',
        untracked: index_status == '?' && worktree_status == '?',
        conflicted,
    })
}

fn parse_nonempty_lines(stdout: &[u8]) -> Vec<String> {
    String::from_utf8_lossy(stdout)
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(ToOwned::to_owned)
        .collect()
}

fn take_preview_lines(lines: &[String], remaining: &mut usize) -> Vec<String> {
    let count = (*remaining).min(lines.len());
    let taken = lines.iter().take(count).cloned().collect::<Vec<_>>();
    *remaining = remaining.saturating_sub(count);
    taken
}

fn parse_merge_conflict_path(line: &str) -> Option<String> {
    if !line.contains("CONFLICT") {
        return None;
    }

    line.split(" in ")
        .nth(1)
        .map(str::trim)
        .filter(|path| !path.is_empty())
        .map(ToOwned::to_owned)
}

fn get_current_branch(repo_root: &Path) -> Result<String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(repo_root)
        .args(["rev-parse", "--abbrev-ref", "HEAD"])
        .output()
        .context("Failed to get current branch")?;

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn base_checkout_path(worktree: &WorktreeInfo) -> Result<PathBuf> {
    let output = Command::new("git")
        .arg("-C")
        .arg(&worktree.path)
        .args(["worktree", "list", "--porcelain"])
        .output()
        .context("Failed to resolve git worktree list")?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        anyhow::bail!("git worktree list --porcelain failed: {stderr}");
    }

    let target_branch = format!("refs/heads/{}", worktree.base_branch);
    let mut current_path: Option<PathBuf> = None;
    let mut current_branch: Option<String> = None;
    let mut fallback: Option<PathBuf> = None;

    for line in String::from_utf8_lossy(&output.stdout).lines() {
        if line.is_empty() {
            if let Some(path) = current_path.take() {
                if fallback.is_none() && path != worktree.path {
                    fallback = Some(path.clone());
                }
                if current_branch.as_deref() == Some(target_branch.as_str())
                    && path != worktree.path
                {
                    return Ok(path);
                }
            }
            current_branch = None;
            continue;
        }

        if let Some(path) = line.strip_prefix("worktree ") {
            current_path = Some(PathBuf::from(path.trim()));
        } else if let Some(branch) = line.strip_prefix("branch ") {
            current_branch = Some(branch.trim().to_string());
        }
    }

    if let Some(path) = current_path.take() {
        if fallback.is_none() && path != worktree.path {
            fallback = Some(path.clone());
        }
        if current_branch.as_deref() == Some(target_branch.as_str()) && path != worktree.path {
            return Ok(path);
        }
    }

    fallback.context(format!(
        "Failed to locate base checkout for {} from git worktree list",
        worktree.base_branch
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use anyhow::Result;
    use std::fs;
    use std::process::Command;
    use uuid::Uuid;

    fn run_git(repo: &Path, args: &[&str]) -> Result<()> {
        let output = Command::new("git")
            .arg("-C")
            .arg(repo)
            .args(args)
            .output()?;
        if !output.status.success() {
            anyhow::bail!("{}", String::from_utf8_lossy(&output.stderr));
        }
        Ok(())
    }

    fn git_stdout(repo: &Path, args: &[&str]) -> Result<String> {
        let output = Command::new("git")
            .arg("-C")
            .arg(repo)
            .args(args)
            .output()?;
        if !output.status.success() {
            anyhow::bail!("{}", String::from_utf8_lossy(&output.stderr));
        }
        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    }

    fn init_repo(root: &Path) -> Result<PathBuf> {
        let repo = root.join("repo");
        fs::create_dir_all(&repo)?;

        run_git(&repo, &["init", "-b", "main"])?;
        run_git(&repo, &["config", "user.email", "ecc@example.com"])?;
        run_git(&repo, &["config", "user.name", "ECC"])?;
        fs::write(repo.join("README.md"), "hello\n")?;
        run_git(&repo, &["add", "README.md"])?;
        run_git(&repo, &["commit", "-m", "init"])?;

        Ok(repo)
    }

    #[test]
    fn create_for_session_uses_configured_branch_prefix() -> Result<()> {
        let root = std::env::temp_dir().join(format!("ecc2-worktree-prefix-{}", Uuid::new_v4()));
        let repo = init_repo(&root)?;
        let mut cfg = Config::default();
        cfg.worktree_root = root.join("worktrees");
        cfg.worktree_branch_prefix = "bots/ecc".to_string();

        let worktree = create_for_session_in_repo("worker-123", &cfg, &repo)?;
        assert_eq!(worktree.branch, "bots/ecc/worker-123");

        let branch = Command::new("git")
            .arg("-C")
            .arg(&repo)
            .args(["rev-parse", "--abbrev-ref", "bots/ecc/worker-123"])
            .output()?;
        assert!(branch.status.success());
        assert_eq!(
            String::from_utf8_lossy(&branch.stdout).trim(),
            "bots/ecc/worker-123"
        );

        remove(&worktree)?;
        let _ = fs::remove_dir_all(root);
        Ok(())
    }

    #[test]
    fn create_for_session_rejects_invalid_branch_prefix() -> Result<()> {
        let root =
            std::env::temp_dir().join(format!("ecc2-worktree-invalid-prefix-{}", Uuid::new_v4()));
        let repo = init_repo(&root)?;
        let mut cfg = Config::default();
        cfg.worktree_root = root.join("worktrees");
        cfg.worktree_branch_prefix = "bad prefix".to_string();

        let error = create_for_session_in_repo("worker-123", &cfg, &repo).unwrap_err();
        let message = error.to_string();
        assert!(message.contains("Invalid worktree branch"));
        assert!(message.contains("bad prefix"));
        assert!(!cfg.worktree_root.join("worker-123").exists());

        let _ = fs::remove_dir_all(root);
        Ok(())
    }

    #[test]
    fn diff_summary_reports_clean_and_dirty_worktrees() -> Result<()> {
        let root = std::env::temp_dir().join(format!("ecc2-worktree-{}", Uuid::new_v4()));
        let repo = init_repo(&root)?;

        let worktree_dir = root.join("wt-1");
        run_git(
            &repo,
            &[
                "worktree",
                "add",
                "-b",
                "ecc/test",
                worktree_dir.to_str().expect("utf8 path"),
                "HEAD",
            ],
        )?;

        let info = WorktreeInfo {
            path: worktree_dir.clone(),
            branch: "ecc/test".to_string(),
            base_branch: "main".to_string(),
        };

        assert_eq!(
            diff_summary(&info)?,
            Some("Clean relative to main".to_string())
        );

        fs::write(worktree_dir.join("README.md"), "hello\nmore\n")?;
        let dirty = diff_summary(&info)?.expect("dirty summary");
        assert!(dirty.contains("Working tree"));
        assert!(dirty.contains("file changed"));

        let _ = Command::new("git")
            .arg("-C")
            .arg(&repo)
            .args(["worktree", "remove", "--force"])
            .arg(&worktree_dir)
            .output();
        let _ = fs::remove_dir_all(root);
        Ok(())
    }

    #[test]
    fn diff_file_preview_reports_branch_and_working_tree_files() -> Result<()> {
        let root = std::env::temp_dir().join(format!("ecc2-worktree-preview-{}", Uuid::new_v4()));
        let repo = init_repo(&root)?;

        let worktree_dir = root.join("wt-1");
        run_git(
            &repo,
            &[
                "worktree",
                "add",
                "-b",
                "ecc/test",
                worktree_dir.to_str().expect("utf8 path"),
                "HEAD",
            ],
        )?;

        fs::write(worktree_dir.join("src.txt"), "branch\n")?;
        run_git(&worktree_dir, &["add", "src.txt"])?;
        run_git(&worktree_dir, &["commit", "-m", "branch file"])?;
        fs::write(worktree_dir.join("README.md"), "hello\nworking\n")?;

        let info = WorktreeInfo {
            path: worktree_dir.clone(),
            branch: "ecc/test".to_string(),
            base_branch: "main".to_string(),
        };

        let preview = diff_file_preview(&info, 6)?;
        assert!(preview
            .iter()
            .any(|line| line.contains("Branch A") && line.contains("src.txt")));
        assert!(preview
            .iter()
            .any(|line| line.contains("Working M") && line.contains("README.md")));

        let _ = Command::new("git")
            .arg("-C")
            .arg(&repo)
            .args(["worktree", "remove", "--force"])
            .arg(&worktree_dir)
            .output();
        let _ = fs::remove_dir_all(root);
        Ok(())
    }

    #[test]
    fn diff_patch_preview_reports_branch_and_working_tree_sections() -> Result<()> {
        let root = std::env::temp_dir().join(format!("ecc2-worktree-patch-{}", Uuid::new_v4()));
        let repo = init_repo(&root)?;

        let worktree_dir = root.join("wt-1");
        run_git(
            &repo,
            &[
                "worktree",
                "add",
                "-b",
                "ecc/test",
                worktree_dir.to_str().expect("utf8 path"),
                "HEAD",
            ],
        )?;

        fs::write(worktree_dir.join("src.txt"), "branch\n")?;
        run_git(&worktree_dir, &["add", "src.txt"])?;
        run_git(&worktree_dir, &["commit", "-m", "branch file"])?;
        fs::write(worktree_dir.join("README.md"), "hello\nworking\n")?;

        let info = WorktreeInfo {
            path: worktree_dir.clone(),
            branch: "ecc/test".to_string(),
            base_branch: "main".to_string(),
        };

        let preview = diff_patch_preview(&info, 40)?.expect("patch preview");
        assert!(preview.contains("--- Branch diff vs main ---"));
        assert!(preview.contains("--- Working tree diff ---"));
        assert!(preview.contains("src.txt"));
        assert!(preview.contains("README.md"));

        let _ = Command::new("git")
            .arg("-C")
            .arg(&repo)
            .args(["worktree", "remove", "--force"])
            .arg(&worktree_dir)
            .output();
        let _ = fs::remove_dir_all(root);
        Ok(())
    }

    #[test]
    fn merge_readiness_reports_ready_worktree() -> Result<()> {
        let root =
            std::env::temp_dir().join(format!("ecc2-worktree-merge-ready-{}", Uuid::new_v4()));
        let repo = init_repo(&root)?;

        let worktree_dir = root.join("wt-1");
        run_git(
            &repo,
            &[
                "worktree",
                "add",
                "-b",
                "ecc/test",
                worktree_dir.to_str().expect("utf8 path"),
                "HEAD",
            ],
        )?;

        fs::write(worktree_dir.join("src.txt"), "branch only\n")?;
        run_git(&worktree_dir, &["add", "src.txt"])?;
        run_git(&worktree_dir, &["commit", "-m", "branch file"])?;

        let info = WorktreeInfo {
            path: worktree_dir.clone(),
            branch: "ecc/test".to_string(),
            base_branch: "main".to_string(),
        };

        let readiness = merge_readiness(&info)?;
        assert_eq!(readiness.status, MergeReadinessStatus::Ready);
        assert!(readiness.summary.contains("Merge ready into main"));
        assert!(readiness.conflicts.is_empty());

        let _ = Command::new("git")
            .arg("-C")
            .arg(&repo)
            .args(["worktree", "remove", "--force"])
            .arg(&worktree_dir)
            .output();
        let _ = fs::remove_dir_all(root);
        Ok(())
    }

    #[test]
    fn merge_readiness_reports_conflicted_worktree() -> Result<()> {
        let root =
            std::env::temp_dir().join(format!("ecc2-worktree-merge-conflict-{}", Uuid::new_v4()));
        let repo = init_repo(&root)?;

        let worktree_dir = root.join("wt-1");
        run_git(
            &repo,
            &[
                "worktree",
                "add",
                "-b",
                "ecc/test",
                worktree_dir.to_str().expect("utf8 path"),
                "HEAD",
            ],
        )?;

        fs::write(worktree_dir.join("README.md"), "hello\nbranch\n")?;
        run_git(&worktree_dir, &["commit", "-am", "branch change"])?;
        fs::write(repo.join("README.md"), "hello\nmain\n")?;
        run_git(&repo, &["commit", "-am", "main change"])?;

        let info = WorktreeInfo {
            path: worktree_dir.clone(),
            branch: "ecc/test".to_string(),
            base_branch: "main".to_string(),
        };

        let readiness = merge_readiness(&info)?;
        assert_eq!(readiness.status, MergeReadinessStatus::Conflicted);
        assert!(readiness.summary.contains("Merge blocked by 1 conflict"));
        assert_eq!(readiness.conflicts, vec!["README.md".to_string()]);

        let _ = Command::new("git")
            .arg("-C")
            .arg(&repo)
            .args(["worktree", "remove", "--force"])
            .arg(&worktree_dir)
            .output();
        let _ = fs::remove_dir_all(root);
        Ok(())
    }

    #[test]
    fn rebase_onto_base_replays_simple_branch_after_base_advances() -> Result<()> {
        let root =
            std::env::temp_dir().join(format!("ecc2-worktree-rebase-success-{}", Uuid::new_v4()));
        let repo = init_repo(&root)?;

        let alpha_dir = root.join("wt-alpha");
        run_git(
            &repo,
            &[
                "worktree",
                "add",
                "-b",
                "ecc/alpha",
                alpha_dir.to_str().expect("utf8 path"),
                "HEAD",
            ],
        )?;
        fs::write(alpha_dir.join("README.md"), "hello\nalpha\n")?;
        run_git(&alpha_dir, &["commit", "-am", "alpha change"])?;

        let beta_dir = root.join("wt-beta");
        run_git(
            &repo,
            &[
                "worktree",
                "add",
                "-b",
                "ecc/beta",
                beta_dir.to_str().expect("utf8 path"),
                "HEAD",
            ],
        )?;
        fs::write(beta_dir.join("README.md"), "hello\nalpha\n")?;
        run_git(&beta_dir, &["commit", "-am", "beta shared change"])?;
        fs::write(beta_dir.join("README.md"), "hello\nalpha\nbeta\n")?;
        run_git(&beta_dir, &["commit", "-am", "beta follow-up"])?;

        run_git(&repo, &["merge", "--no-edit", "ecc/alpha"])?;

        let beta = WorktreeInfo {
            path: beta_dir.clone(),
            branch: "ecc/beta".to_string(),
            base_branch: "main".to_string(),
        };
        let readiness_before = merge_readiness(&beta)?;
        assert_eq!(readiness_before.status, MergeReadinessStatus::Conflicted);

        let outcome = rebase_onto_base(&beta)?;
        assert_eq!(outcome.branch, "ecc/beta");
        assert_eq!(outcome.base_branch, "main");
        assert!(!outcome.already_up_to_date);

        let readiness_after = merge_readiness(&beta)?;
        assert_eq!(readiness_after.status, MergeReadinessStatus::Ready);
        assert_eq!(
            fs::read_to_string(beta_dir.join("README.md"))?,
            "hello\nalpha\nbeta\n"
        );

        let _ = Command::new("git")
            .arg("-C")
            .arg(&repo)
            .args(["worktree", "remove", "--force"])
            .arg(&alpha_dir)
            .output();
        let _ = Command::new("git")
            .arg("-C")
            .arg(&repo)
            .args(["worktree", "remove", "--force"])
            .arg(&beta_dir)
            .output();
        let _ = fs::remove_dir_all(root);
        Ok(())
    }

    #[test]
    fn rebase_onto_base_aborts_failed_rebase() -> Result<()> {
        let root =
            std::env::temp_dir().join(format!("ecc2-worktree-rebase-fail-{}", Uuid::new_v4()));
        let repo = init_repo(&root)?;

        let worktree_dir = root.join("wt-conflict");
        run_git(
            &repo,
            &[
                "worktree",
                "add",
                "-b",
                "ecc/conflict",
                worktree_dir.to_str().expect("utf8 path"),
                "HEAD",
            ],
        )?;

        fs::write(worktree_dir.join("README.md"), "hello\nbranch\n")?;
        run_git(&worktree_dir, &["commit", "-am", "branch change"])?;
        fs::write(repo.join("README.md"), "hello\nmain\n")?;
        run_git(&repo, &["commit", "-am", "main change"])?;

        let info = WorktreeInfo {
            path: worktree_dir.clone(),
            branch: "ecc/conflict".to_string(),
            base_branch: "main".to_string(),
        };

        let error = rebase_onto_base(&info).expect_err("rebase should fail");
        assert!(error.to_string().contains("git rebase failed"));
        assert!(git_status_short(&worktree_dir)?.is_empty());
        assert_eq!(
            merge_readiness(&info)?.status,
            MergeReadinessStatus::Conflicted
        );

        let _ = Command::new("git")
            .arg("-C")
            .arg(&repo)
            .args(["worktree", "remove", "--force"])
            .arg(&worktree_dir)
            .output();
        let _ = fs::remove_dir_all(root);
        Ok(())
    }

    #[test]
    fn branch_conflict_preview_reports_conflicting_branches() -> Result<()> {
        let root = std::env::temp_dir().join(format!(
            "ecc2-worktree-branch-conflict-preview-{}",
            Uuid::new_v4()
        ));
        let repo = init_repo(&root)?;

        let left_dir = root.join("wt-left");
        run_git(
            &repo,
            &[
                "worktree",
                "add",
                "-b",
                "ecc/left",
                left_dir.to_str().expect("utf8 path"),
                "HEAD",
            ],
        )?;
        fs::write(left_dir.join("README.md"), "left\n")?;
        run_git(&left_dir, &["add", "README.md"])?;
        run_git(&left_dir, &["commit", "-m", "left change"])?;

        let right_dir = root.join("wt-right");
        run_git(
            &repo,
            &[
                "worktree",
                "add",
                "-b",
                "ecc/right",
                right_dir.to_str().expect("utf8 path"),
                "HEAD",
            ],
        )?;
        fs::write(right_dir.join("README.md"), "right\n")?;
        run_git(&right_dir, &["add", "README.md"])?;
        run_git(&right_dir, &["commit", "-m", "right change"])?;

        let left = WorktreeInfo {
            path: left_dir.clone(),
            branch: "ecc/left".to_string(),
            base_branch: "main".to_string(),
        };
        let right = WorktreeInfo {
            path: right_dir.clone(),
            branch: "ecc/right".to_string(),
            base_branch: "main".to_string(),
        };

        let preview =
            branch_conflict_preview(&left, &right, 12)?.expect("expected branch conflict preview");
        assert_eq!(preview.conflicts, vec!["README.md".to_string()]);
        assert!(preview
            .left_patch_preview
            .as_ref()
            .is_some_and(|preview| preview.contains("README.md")));
        assert!(preview
            .right_patch_preview
            .as_ref()
            .is_some_and(|preview| preview.contains("README.md")));

        let _ = Command::new("git")
            .arg("-C")
            .arg(&repo)
            .args(["worktree", "remove", "--force"])
            .arg(&left_dir)
            .output();
        let _ = Command::new("git")
            .arg("-C")
            .arg(&repo)
            .args(["worktree", "remove", "--force"])
            .arg(&right_dir)
            .output();
        let _ = fs::remove_dir_all(root);
        Ok(())
    }

    #[test]
    fn git_status_helpers_stage_unstage_reset_and_commit() -> Result<()> {
        let root = std::env::temp_dir().join(format!("ecc2-git-status-helpers-{}", Uuid::new_v4()));
        let repo = init_repo(&root)?;
        let worktree = WorktreeInfo {
            path: repo.clone(),
            branch: "main".to_string(),
            base_branch: "main".to_string(),
        };

        fs::write(repo.join("README.md"), "hello updated\n")?;
        fs::write(repo.join("notes.txt"), "draft\n")?;

        let mut entries = git_status_entries(&worktree)?;
        let readme = entries
            .iter()
            .find(|entry| entry.path == "README.md")
            .expect("tracked README entry");
        assert!(readme.unstaged);
        let notes = entries
            .iter()
            .find(|entry| entry.path == "notes.txt")
            .expect("untracked notes entry");
        assert!(notes.untracked);

        stage_path(&worktree, "notes.txt")?;
        entries = git_status_entries(&worktree)?;
        let notes = entries
            .iter()
            .find(|entry| entry.path == "notes.txt")
            .expect("staged notes entry");
        assert!(notes.staged);
        assert!(!notes.untracked);

        unstage_path(&worktree, "notes.txt")?;
        entries = git_status_entries(&worktree)?;
        let notes = entries
            .iter()
            .find(|entry| entry.path == "notes.txt")
            .expect("restored notes entry");
        assert!(notes.untracked);

        let notes_entry = notes.clone();
        reset_path(&worktree, &notes_entry)?;
        assert!(!repo.join("notes.txt").exists());

        stage_path(&worktree, "README.md")?;
        let hash = commit_staged(&worktree, "update readme")?;
        assert!(!hash.is_empty());
        assert!(git_status_entries(&worktree)?.is_empty());

        let output = Command::new("git")
            .arg("-C")
            .arg(&repo)
            .args(["log", "-1", "--pretty=%s"])
            .output()?;
        assert_eq!(
            String::from_utf8_lossy(&output.stdout).trim(),
            "update readme"
        );

        let _ = fs::remove_dir_all(root);
        Ok(())
    }

    #[test]
    fn git_status_patch_view_supports_hunk_stage_and_unstage() -> Result<()> {
        let root = std::env::temp_dir().join(format!("ecc2-hunk-stage-{}", Uuid::new_v4()));
        let repo = init_repo(&root)?;
        let worktree = WorktreeInfo {
            path: repo.clone(),
            branch: "main".to_string(),
            base_branch: "main".to_string(),
        };

        let original = (1..=12)
            .map(|index| format!("line {index}"))
            .collect::<Vec<_>>()
            .join("\n");
        fs::write(repo.join("notes.txt"), format!("{original}\n"))?;
        run_git(&repo, &["add", "notes.txt"])?;
        run_git(&repo, &["commit", "-m", "add notes"])?;

        let updated = (1..=12)
            .map(|index| match index {
                2 => "line 2 changed".to_string(),
                11 => "line 11 changed".to_string(),
                _ => format!("line {index}"),
            })
            .collect::<Vec<_>>()
            .join("\n");
        fs::write(repo.join("notes.txt"), format!("{updated}\n"))?;

        let entry = git_status_entries(&worktree)?
            .into_iter()
            .find(|entry| entry.path == "notes.txt")
            .expect("notes status entry");
        let patch =
            git_status_patch_view(&worktree, &entry)?.expect("selected-file patch view for notes");
        assert_eq!(patch.hunks.len(), 2);
        assert!(patch
            .hunks
            .iter()
            .all(|hunk| hunk.section == GitPatchSectionKind::Unstaged));

        stage_hunk(&worktree, &patch.hunks[0])?;

        let cached = git_stdout(&repo, &["diff", "--cached", "--", "notes.txt"])?;
        assert!(cached.contains("line 2 changed"));
        assert!(!cached.contains("line 11 changed"));

        let working = git_stdout(&repo, &["diff", "--", "notes.txt"])?;
        assert!(!working.contains("line 2 changed"));
        assert!(working.contains("line 11 changed"));

        let entry = git_status_entries(&worktree)?
            .into_iter()
            .find(|entry| entry.path == "notes.txt")
            .expect("notes status entry after stage");
        let patch = git_status_patch_view(&worktree, &entry)?.expect("patch after hunk stage");
        let staged_hunk = patch
            .hunks
            .iter()
            .find(|hunk| hunk.section == GitPatchSectionKind::Staged)
            .cloned()
            .expect("staged hunk");

        unstage_hunk(&worktree, &staged_hunk)?;

        let cached = git_stdout(&repo, &["diff", "--cached", "--", "notes.txt"])?;
        assert!(cached.trim().is_empty());

        let working = git_stdout(&repo, &["diff", "--", "notes.txt"])?;
        assert!(working.contains("line 2 changed"));
        assert!(working.contains("line 11 changed"));

        let _ = fs::remove_dir_all(root);
        Ok(())
    }

    #[test]
    fn reset_hunk_discards_unstaged_then_staged_hunks() -> Result<()> {
        let root = std::env::temp_dir().join(format!("ecc2-hunk-reset-{}", Uuid::new_v4()));
        let repo = init_repo(&root)?;
        let worktree = WorktreeInfo {
            path: repo.clone(),
            branch: "main".to_string(),
            base_branch: "main".to_string(),
        };

        let original = (1..=12)
            .map(|index| format!("line {index}"))
            .collect::<Vec<_>>()
            .join("\n");
        fs::write(repo.join("notes.txt"), format!("{original}\n"))?;
        run_git(&repo, &["add", "notes.txt"])?;
        run_git(&repo, &["commit", "-m", "add notes"])?;

        let updated = (1..=12)
            .map(|index| match index {
                2 => "line 2 changed".to_string(),
                11 => "line 11 changed".to_string(),
                _ => format!("line {index}"),
            })
            .collect::<Vec<_>>()
            .join("\n");
        fs::write(repo.join("notes.txt"), format!("{updated}\n"))?;

        let entry = git_status_entries(&worktree)?
            .into_iter()
            .find(|entry| entry.path == "notes.txt")
            .expect("notes status entry");
        let patch =
            git_status_patch_view(&worktree, &entry)?.expect("selected-file patch view for notes");
        stage_hunk(&worktree, &patch.hunks[0])?;

        let entry = git_status_entries(&worktree)?
            .into_iter()
            .find(|entry| entry.path == "notes.txt")
            .expect("notes status entry after stage");
        let patch = git_status_patch_view(&worktree, &entry)?.expect("patch after stage");
        let unstaged_hunk = patch
            .hunks
            .iter()
            .find(|hunk| hunk.section == GitPatchSectionKind::Unstaged)
            .cloned()
            .expect("unstaged hunk");
        reset_hunk(&worktree, &entry, &unstaged_hunk)?;

        let working = git_stdout(&repo, &["diff", "--", "notes.txt"])?;
        assert!(working.trim().is_empty());

        let entry = git_status_entries(&worktree)?
            .into_iter()
            .find(|entry| entry.path == "notes.txt")
            .expect("notes status entry after unstaged reset");
        assert!(!entry.unstaged);

        let patch = git_status_patch_view(&worktree, &entry)?.expect("staged-only patch");
        let staged_hunk = patch
            .hunks
            .iter()
            .find(|hunk| hunk.section == GitPatchSectionKind::Staged)
            .cloned()
            .expect("staged hunk");
        reset_hunk(&worktree, &entry, &staged_hunk)?;

        assert!(git_stdout(&repo, &["diff", "--cached", "--", "notes.txt"])?
            .trim()
            .is_empty());
        assert!(git_stdout(&repo, &["diff", "--", "notes.txt"])?
            .trim()
            .is_empty());
        assert_eq!(
            fs::read_to_string(repo.join("notes.txt"))?,
            format!("{original}\n")
        );

        let _ = fs::remove_dir_all(root);
        Ok(())
    }

    #[test]
    fn latest_commit_subject_reads_head_subject() -> Result<()> {
        let root = std::env::temp_dir().join(format!("ecc2-pr-subject-{}", Uuid::new_v4()));
        let repo = init_repo(&root)?;
        fs::write(repo.join("README.md"), "subject test\n")?;
        run_git(&repo, &["commit", "-am", "subject test"])?;

        let worktree = WorktreeInfo {
            path: repo.clone(),
            branch: "main".to_string(),
            base_branch: "main".to_string(),
        };

        assert_eq!(latest_commit_subject(&worktree)?, "subject test");

        let _ = fs::remove_dir_all(root);
        Ok(())
    }

    #[test]
    fn create_draft_pr_pushes_branch_and_invokes_gh() -> Result<()> {
        let root = std::env::temp_dir().join(format!("ecc2-pr-create-{}", Uuid::new_v4()));
        let repo = init_repo(&root)?;
        let remote = root.join("remote.git");
        run_git(
            &root,
            &["init", "--bare", remote.to_str().expect("utf8 path")],
        )?;
        run_git(
            &repo,
            &[
                "remote",
                "add",
                "origin",
                remote.to_str().expect("utf8 path"),
            ],
        )?;
        run_git(&repo, &["push", "-u", "origin", "main"])?;
        run_git(&repo, &["checkout", "-b", "feat/pr-test"])?;
        fs::write(repo.join("README.md"), "pr test\n")?;
        run_git(&repo, &["commit", "-am", "pr test"])?;

        let bin_dir = root.join("bin");
        fs::create_dir_all(&bin_dir)?;
        let gh_path = bin_dir.join("gh");
        let args_path = root.join("gh-args.txt");
        fs::write(
            &gh_path,
            format!(
                "#!/bin/sh\nprintf '%s\\n' \"$@\" > \"{}\"\nprintf '%s\\n' 'https://github.com/example/repo/pull/123'\n",
                args_path.display()
            ),
        )?;
        let mut perms = fs::metadata(&gh_path)?.permissions();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            perms.set_mode(0o755);
            fs::set_permissions(&gh_path, perms)?;
        }
        #[cfg(not(unix))]
        fs::set_permissions(&gh_path, perms)?;

        let worktree = WorktreeInfo {
            path: repo.clone(),
            branch: "feat/pr-test".to_string(),
            base_branch: "main".to_string(),
        };

        let url = create_draft_pr_with_gh(
            &worktree,
            "My PR",
            "Body line",
            &DraftPrOptions::default(),
            &gh_path,
        )?;
        assert_eq!(url, "https://github.com/example/repo/pull/123");

        let remote_branch = Command::new("git")
            .arg("--git-dir")
            .arg(&remote)
            .args(["branch", "--list", "feat/pr-test"])
            .output()?;
        assert!(remote_branch.status.success());
        assert_eq!(
            String::from_utf8_lossy(&remote_branch.stdout).trim(),
            "feat/pr-test"
        );

        let gh_args = fs::read_to_string(&args_path)?;
        assert!(gh_args.contains("pr\ncreate\n--draft"));
        assert!(gh_args.contains("--base\nmain"));
        assert!(gh_args.contains("--head\nfeat/pr-test"));
        assert!(gh_args.contains("--title\nMy PR"));
        assert!(gh_args.contains("--body\nBody line"));

        let _ = fs::remove_dir_all(root);
        Ok(())
    }

    #[test]
    fn create_draft_pr_forwards_custom_base_labels_and_reviewers() -> Result<()> {
        let root = std::env::temp_dir().join(format!("ecc2-pr-create-options-{}", Uuid::new_v4()));
        let repo = init_repo(&root)?;
        let remote = root.join("remote.git");
        run_git(
            &root,
            &["init", "--bare", remote.to_str().expect("utf8 path")],
        )?;
        run_git(
            &repo,
            &[
                "remote",
                "add",
                "origin",
                remote.to_str().expect("utf8 path"),
            ],
        )?;
        run_git(&repo, &["push", "-u", "origin", "main"])?;
        run_git(&repo, &["checkout", "-b", "feat/pr-options"])?;
        fs::write(repo.join("README.md"), "pr options\n")?;
        run_git(&repo, &["commit", "-am", "pr options"])?;

        let bin_dir = root.join("bin");
        fs::create_dir_all(&bin_dir)?;
        let gh_path = bin_dir.join("gh");
        let args_path = root.join("gh-args-options.txt");
        fs::write(
            &gh_path,
            format!(
                "#!/bin/sh\nprintf '%s\\n' \"$@\" > \"{}\"\nprintf '%s\\n' 'https://github.com/example/repo/pull/456'\n",
                args_path.display()
            ),
        )?;
        let mut perms = fs::metadata(&gh_path)?.permissions();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            perms.set_mode(0o755);
            fs::set_permissions(&gh_path, perms)?;
        }
        #[cfg(not(unix))]
        fs::set_permissions(&gh_path, perms)?;

        let worktree = WorktreeInfo {
            path: repo.clone(),
            branch: "feat/pr-options".to_string(),
            base_branch: "main".to_string(),
        };
        let options = DraftPrOptions {
            base_branch: Some("release/2.0".to_string()),
            labels: vec!["billing".to_string(), "ui".to_string()],
            reviewers: vec!["alice".to_string(), "bob".to_string()],
        };

        let url = create_draft_pr_with_gh(&worktree, "My PR", "Body line", &options, &gh_path)?;
        assert_eq!(url, "https://github.com/example/repo/pull/456");

        let gh_args = fs::read_to_string(&args_path)?;
        assert!(gh_args.contains("--base\nrelease/2.0"));
        assert!(gh_args.contains("--label\nbilling"));
        assert!(gh_args.contains("--label\nui"));
        assert!(gh_args.contains("--reviewer\nalice"));
        assert!(gh_args.contains("--reviewer\nbob"));

        let _ = fs::remove_dir_all(root);
        Ok(())
    }

    #[test]
    fn github_compare_url_uses_origin_remote_and_encodes_refs() -> Result<()> {
        let root = std::env::temp_dir().join(format!("ecc2-compare-url-{}", Uuid::new_v4()));
        let repo = init_repo(&root)?;
        run_git(
            &repo,
            &["remote", "add", "origin", "git@github.com:example/ecc.git"],
        )?;

        let worktree = WorktreeInfo {
            path: repo.clone(),
            branch: "ecc/worker-123".to_string(),
            base_branch: "main".to_string(),
        };

        let url = github_compare_url(&worktree)?.expect("compare url");
        assert_eq!(
            url,
            "https://github.com/example/ecc/compare/main...ecc%2Fworker-123?expand=1"
        );

        let _ = fs::remove_dir_all(root);
        Ok(())
    }

    #[test]
    fn github_repo_web_url_supports_multiple_remote_formats() {
        assert_eq!(
            github_repo_web_url("git@github.com:example/ecc.git").as_deref(),
            Some("https://github.com/example/ecc")
        );
        assert_eq!(
            github_repo_web_url("https://github.example.com/org/repo.git").as_deref(),
            Some("https://github.example.com/org/repo")
        );
        assert_eq!(
            github_repo_web_url("ssh://git@github.example.com/org/repo.git").as_deref(),
            Some("https://github.example.com/org/repo")
        );
    }

    #[test]
    fn create_for_session_links_shared_node_modules_cache() -> Result<()> {
        let root =
            std::env::temp_dir().join(format!("ecc2-worktree-node-cache-{}", Uuid::new_v4()));
        let repo = init_repo(&root)?;
        fs::write(repo.join("package.json"), "{\n  \"name\": \"repo\"\n}\n")?;
        fs::write(
            repo.join("package-lock.json"),
            "{\n  \"lockfileVersion\": 3\n}\n",
        )?;
        fs::create_dir_all(repo.join("node_modules"))?;
        fs::write(repo.join("node_modules/.cache-marker"), "shared\n")?;
        run_git(&repo, &["add", "package.json", "package-lock.json"])?;
        run_git(&repo, &["commit", "-m", "add node deps"])?;

        let mut cfg = Config::default();
        cfg.worktree_root = root.join("worktrees");
        let worktree = create_for_session_in_repo("worker-123", &cfg, &repo)?;

        let node_modules = worktree.path.join("node_modules");
        assert!(fs::symlink_metadata(&node_modules)?
            .file_type()
            .is_symlink());
        assert_eq!(fs::read_link(&node_modules)?, repo.join("node_modules"));

        remove(&worktree)?;
        let _ = fs::remove_dir_all(root);
        Ok(())
    }

    #[test]
    fn sync_shared_dependency_dirs_falls_back_when_lockfiles_diverge() -> Result<()> {
        let root =
            std::env::temp_dir().join(format!("ecc2-worktree-node-fallback-{}", Uuid::new_v4()));
        let repo = init_repo(&root)?;
        fs::write(repo.join("package.json"), "{\n  \"name\": \"repo\"\n}\n")?;
        fs::write(
            repo.join("package-lock.json"),
            "{\n  \"lockfileVersion\": 3\n}\n",
        )?;
        fs::create_dir_all(repo.join("node_modules"))?;
        fs::write(repo.join("node_modules/.cache-marker"), "shared\n")?;
        run_git(&repo, &["add", "package.json", "package-lock.json"])?;
        run_git(&repo, &["commit", "-m", "add node deps"])?;

        let mut cfg = Config::default();
        cfg.worktree_root = root.join("worktrees");
        let worktree = create_for_session_in_repo("worker-123", &cfg, &repo)?;

        let node_modules = worktree.path.join("node_modules");
        assert!(fs::symlink_metadata(&node_modules)?
            .file_type()
            .is_symlink());

        fs::write(
            worktree.path.join("package-lock.json"),
            "{\n  \"lockfileVersion\": 4\n}\n",
        )?;
        let applied = sync_shared_dependency_dirs(&worktree)?;
        assert!(applied.is_empty());
        assert!(node_modules.is_dir());
        assert!(!fs::symlink_metadata(&node_modules)?
            .file_type()
            .is_symlink());
        assert!(repo.join("node_modules/.cache-marker").exists());

        remove(&worktree)?;
        let _ = fs::remove_dir_all(root);
        Ok(())
    }

    #[test]
    fn create_for_session_links_shared_cargo_target_cache() -> Result<()> {
        let root =
            std::env::temp_dir().join(format!("ecc2-worktree-cargo-cache-{}", Uuid::new_v4()));
        let repo = init_repo(&root)?;
        fs::write(
            repo.join("Cargo.toml"),
            "[package]\nname = \"repo\"\nversion = \"0.1.0\"\nedition = \"2021\"\n",
        )?;
        fs::write(repo.join("Cargo.lock"), "# lock\n")?;
        fs::create_dir_all(repo.join("target/debug"))?;
        fs::write(repo.join("target/debug/.cache-marker"), "shared\n")?;
        run_git(&repo, &["add", "Cargo.toml", "Cargo.lock"])?;
        run_git(&repo, &["commit", "-m", "add cargo deps"])?;

        let mut cfg = Config::default();
        cfg.worktree_root = root.join("worktrees");
        let worktree = create_for_session_in_repo("worker-123", &cfg, &repo)?;

        let target = worktree.path.join("target");
        assert!(fs::symlink_metadata(&target)?.file_type().is_symlink());
        assert_eq!(fs::read_link(&target)?, repo.join("target"));

        remove(&worktree)?;
        let _ = fs::remove_dir_all(root);
        Ok(())
    }
}
