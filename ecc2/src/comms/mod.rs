use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::fmt;

use crate::session::store::StateStore;

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum TaskPriority {
    Low,
    #[default]
    Normal,
    High,
    Critical,
}

impl fmt::Display for TaskPriority {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let label = match self {
            Self::Low => "low",
            Self::Normal => "normal",
            Self::High => "high",
            Self::Critical => "critical",
        };
        write!(f, "{label}")
    }
}

/// Message types for inter-agent communication.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum MessageType {
    /// Task handoff from one agent to another
    TaskHandoff {
        task: String,
        context: String,
        #[serde(default)]
        priority: TaskPriority,
    },
    /// Agent requesting information from another
    Query { question: String },
    /// Response to a query
    Response { answer: String },
    /// Notification of completion
    Completed {
        summary: String,
        files_changed: Vec<String>,
    },
    /// Conflict detected (e.g., two agents editing the same file)
    Conflict { file: String, description: String },
}

/// Send a structured message between sessions.
pub fn send(db: &StateStore, from: &str, to: &str, msg: &MessageType) -> Result<()> {
    let content = serde_json::to_string(msg)?;
    let msg_type = message_type_name(msg);
    db.send_message(from, to, &content, msg_type)?;
    Ok(())
}

/// Persist an ECC-generated assignment with native provenance. Ordinary
/// user handoffs must continue through send(), which marks them external.
pub fn send_native_assignment(
    db: &StateStore,
    from: &str,
    to: &str,
    msg: &MessageType,
) -> Result<()> {
    if !matches!(msg, MessageType::TaskHandoff { .. }) {
        anyhow::bail!("Native assignment notice must be a task handoff");
    }
    db.send_native_assignment_notice(from, to, &serde_json::to_string(msg)?)
}

pub fn message_type_name(msg: &MessageType) -> &'static str {
    match msg {
        MessageType::TaskHandoff { .. } => "task_handoff",
        MessageType::Query { .. } => "query",
        MessageType::Response { .. } => "response",
        MessageType::Completed { .. } => "completed",
        MessageType::Conflict { .. } => "conflict",
    }
}

pub fn parse(content: &str) -> Option<MessageType> {
    serde_json::from_str(content).ok()
}

pub fn preview(msg_type: &str, content: &str) -> String {
    match parse(content) {
        Some(MessageType::TaskHandoff { task, .. }) => {
            let priority = handoff_priority(content);
            if priority == TaskPriority::Normal {
                format!("handoff {}", truncate(&task, 56))
            } else {
                format!(
                    "handoff [{}] {}",
                    priority_label(priority),
                    truncate(&task, 48)
                )
            }
        }
        Some(MessageType::Query { question }) => {
            format!("query {}", truncate(&question, 56))
        }
        Some(MessageType::Response { answer }) => {
            format!("response {}", truncate(&answer, 56))
        }
        Some(MessageType::Completed {
            summary,
            files_changed,
        }) => {
            if files_changed.is_empty() {
                format!("completed {}", truncate(&summary, 48))
            } else {
                format!(
                    "completed {} | {} files",
                    truncate(&summary, 40),
                    files_changed.len()
                )
            }
        }
        Some(MessageType::Conflict { file, description }) => {
            format!("conflict {} | {}", file, truncate(&description, 40))
        }
        None => format!("{} {}", msg_type.replace('_', " "), truncate(content, 56)),
    }
}

pub fn handoff_priority(content: &str) -> TaskPriority {
    match parse(content) {
        Some(MessageType::TaskHandoff { priority, .. }) => priority,
        _ => extract_legacy_handoff_priority(content),
    }
}

fn extract_legacy_handoff_priority(content: &str) -> TaskPriority {
    let value: serde_json::Value = match serde_json::from_str(content) {
        Ok(value) => value,
        Err(_) => return TaskPriority::Normal,
    };
    match value
        .get("priority")
        .and_then(|priority| priority.as_str())
        .unwrap_or("normal")
    {
        "low" => TaskPriority::Low,
        "high" => TaskPriority::High,
        "critical" => TaskPriority::Critical,
        _ => TaskPriority::Normal,
    }
}

fn priority_label(priority: TaskPriority) -> &'static str {
    match priority {
        TaskPriority::Low => "low",
        TaskPriority::Normal => "normal",
        TaskPriority::High => "high",
        TaskPriority::Critical => "critical",
    }
}

fn truncate(value: &str, max_chars: usize) -> String {
    let trimmed = value.trim();
    if trimmed.chars().count() <= max_chars {
        return trimmed.to_string();
    }

    let truncated: String = trimmed.chars().take(max_chars.saturating_sub(1)).collect();
    format!("{truncated}…")
}
