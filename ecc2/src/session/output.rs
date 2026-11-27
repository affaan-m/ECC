use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex, MutexGuard};

use serde::{Deserialize, Serialize};
use tokio::sync::broadcast;

pub const OUTPUT_BUFFER_LIMIT: usize = 1000;
/// Maximum number of cross-process output rows applied during one dashboard refresh.
pub const OUTPUT_DELTA_BATCH_LIMIT: usize = 4096;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum OutputStream {
    Stdout,
    Stderr,
}

impl OutputStream {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Stdout => "stdout",
            Self::Stderr => "stderr",
        }
    }

    pub fn from_db_value(value: &str) -> Self {
        match value {
            "stderr" => Self::Stderr,
            _ => Self::Stdout,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OutputLine {
    pub stream: OutputStream,
    pub text: String,
    pub timestamp: String,
}

impl OutputLine {
    pub fn new(
        stream: OutputStream,
        text: impl Into<String>,
        timestamp: impl Into<String>,
    ) -> Self {
        Self {
            stream,
            text: text.into(),
            timestamp: timestamp.into(),
        }
    }

    pub fn with_current_timestamp(stream: OutputStream, text: impl Into<String>) -> Self {
        Self::new(stream, text, chrono::Utc::now().to_rfc3339())
    }

    pub fn occurred_at(&self) -> Option<chrono::DateTime<chrono::Utc>> {
        chrono::DateTime::parse_from_rfc3339(&self.timestamp)
            .ok()
            .map(|timestamp| timestamp.with_timezone(&chrono::Utc))
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OutputEvent {
    pub session_id: String,
    pub line: OutputLine,
}

#[derive(Clone)]
pub struct SessionOutputStore {
    capacity: usize,
    buffers: Arc<Mutex<HashMap<String, VecDeque<OutputLine>>>>,
    tx: broadcast::Sender<OutputEvent>,
}

impl Default for SessionOutputStore {
    fn default() -> Self {
        Self::new(OUTPUT_BUFFER_LIMIT)
    }
}

impl SessionOutputStore {
    pub fn new(capacity: usize) -> Self {
        let capacity = capacity.max(1);
        let (tx, _) = broadcast::channel(capacity.max(16));

        Self {
            capacity,
            buffers: Arc::new(Mutex::new(HashMap::new())),
            tx,
        }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<OutputEvent> {
        self.tx.subscribe()
    }

    pub fn push_line(&self, session_id: &str, stream: OutputStream, text: impl Into<String>) {
        let line = OutputLine::with_current_timestamp(stream, text);

        {
            let mut buffers = self.lock_buffers();
            let buffer = buffers.entry(session_id.to_string()).or_default();
            buffer.push_back(line.clone());

            while buffer.len() > self.capacity {
                let _ = buffer.pop_front();
            }
        }

        let _ = self.tx.send(OutputEvent {
            session_id: session_id.to_string(),
            line,
        });
    }

    pub fn lines(&self, session_id: &str) -> Vec<OutputLine> {
        self.lock_buffers()
            .get(session_id)
            .map(|buffer| buffer.iter().cloned().collect())
            .unwrap_or_default()
    }

    fn lock_buffers(&self) -> MutexGuard<'_, HashMap<String, VecDeque<OutputLine>>> {
        self.buffers
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

#[cfg(test)]
mod tests {
    use super::{OutputStream, SessionOutputStore};

    #[test]
    fn ring_buffer_keeps_most_recent_lines() {
        let store = SessionOutputStore::new(3);

        store.push_line("session-1", OutputStream::Stdout, "line-1");
        store.push_line("session-1", OutputStream::Stdout, "line-2");
        store.push_line("session-1", OutputStream::Stdout, "line-3");
        store.push_line("session-1", OutputStream::Stdout, "line-4");

        let lines = store.lines("session-1");
        let texts: Vec<_> = lines.iter().map(|line| line.text.as_str()).collect();

        assert_eq!(texts, vec!["line-2", "line-3", "line-4"]);
    }

    #[tokio::test]
    async fn pushing_output_broadcasts_events() {
        let store = SessionOutputStore::new(8);
        let mut rx = store.subscribe();

        store.push_line("session-1", OutputStream::Stderr, "problem");

        let event = rx.recv().await.expect("broadcast event");
        assert_eq!(event.session_id, "session-1");
        assert_eq!(event.line.stream, OutputStream::Stderr);
        assert_eq!(event.line.text, "problem");
        assert!(event.line.occurred_at().is_some());
    }
}
