use std::path::PathBuf;
use std::process::{ExitStatus, Stdio};

use anyhow::{Context, Result};
use tokio::io::{AsyncBufReadExt, AsyncRead, BufReader};
use tokio::process::Command;
use tokio::sync::{mpsc, oneshot};
use tokio::time::{self, MissedTickBehavior};

use super::output::{OutputStream, SessionOutputStore};
use super::store::StateStore;
use super::SessionState;

type DbAck = std::result::Result<(), String>;

#[derive(Default)]
struct CaptureTasks(Vec<tokio::task::AbortHandle>);

impl Drop for CaptureTasks {
    fn drop(&mut self) {
        for task in &self.0 {
            task.abort();
        }
    }
}

enum DbMessage {
    UpdateState {
        state: SessionState,
        ack: oneshot::Sender<DbAck>,
    },
    UpdatePid {
        pid: Option<u32>,
        creation_time: Option<u64>,
        ack: oneshot::Sender<DbAck>,
    },
    AppendOutputLine {
        stream: OutputStream,
        line: String,
        ack: oneshot::Sender<DbAck>,
    },
    TouchHeartbeat {
        ack: oneshot::Sender<DbAck>,
    },
}

#[derive(Clone)]
struct DbWriter {
    tx: mpsc::UnboundedSender<DbMessage>,
}

impl DbWriter {
    fn start(db_path: PathBuf, session_id: String) -> Self {
        let (tx, rx) = mpsc::unbounded_channel();
        std::thread::spawn(move || run_db_writer(db_path, session_id, rx));
        Self { tx }
    }

    async fn update_state(&self, state: SessionState) -> Result<()> {
        self.send(|ack| DbMessage::UpdateState { state, ack }).await
    }

    async fn update_pid(&self, pid: Option<u32>, creation_time: Option<u64>) -> Result<()> {
        self.send(|ack| DbMessage::UpdatePid {
            pid,
            creation_time,
            ack,
        })
        .await
    }

    async fn append_output_line(&self, stream: OutputStream, line: String) -> Result<()> {
        self.send(|ack| DbMessage::AppendOutputLine { stream, line, ack })
            .await
    }

    async fn touch_heartbeat(&self) -> Result<()> {
        self.send(|ack| DbMessage::TouchHeartbeat { ack }).await
    }

    async fn send<F>(&self, build: F) -> Result<()>
    where
        F: FnOnce(oneshot::Sender<DbAck>) -> DbMessage,
    {
        let (ack_tx, ack_rx) = oneshot::channel();
        self.tx
            .send(build(ack_tx))
            .map_err(|_| anyhow::anyhow!("DB writer channel closed"))?;

        match ack_rx.await {
            Ok(Ok(())) => Ok(()),
            Ok(Err(error)) => Err(anyhow::anyhow!(error)),
            Err(_) => Err(anyhow::anyhow!("DB writer acknowledgement dropped")),
        }
    }
}

fn run_db_writer(db_path: PathBuf, session_id: String, mut rx: mpsc::UnboundedReceiver<DbMessage>) {
    let (opened, open_error) = match StateStore::open(&db_path) {
        Ok(db) => (Some(db), None),
        Err(error) => (None, Some(error.to_string())),
    };

    while let Some(message) = rx.blocking_recv() {
        match message {
            DbMessage::UpdateState { state, ack } => {
                let result = match opened.as_ref() {
                    Some(db) => db
                        .update_state(&session_id, &state)
                        .map_err(|error| error.to_string()),
                    None => Err(open_error
                        .clone()
                        .unwrap_or_else(|| "Failed to open state store".to_string())),
                };
                let _ = ack.send(result);
            }
            DbMessage::UpdatePid {
                pid,
                creation_time,
                ack,
            } => {
                let result = match opened.as_ref() {
                    Some(db) => db
                        .update_pid_with_creation_time(&session_id, pid, creation_time)
                        .map_err(|error| error.to_string()),
                    None => Err(open_error
                        .clone()
                        .unwrap_or_else(|| "Failed to open state store".to_string())),
                };
                let _ = ack.send(result);
            }
            DbMessage::AppendOutputLine { stream, line, ack } => {
                let result = match opened.as_ref() {
                    Some(db) => db
                        .append_output_line(&session_id, stream, &line)
                        .map_err(|error| error.to_string()),
                    None => Err(open_error
                        .clone()
                        .unwrap_or_else(|| "Failed to open state store".to_string())),
                };
                let _ = ack.send(result);
            }
            DbMessage::TouchHeartbeat { ack } => {
                let result = match opened.as_ref() {
                    Some(db) => db
                        .touch_heartbeat(&session_id)
                        .map_err(|error| error.to_string()),
                    None => Err(open_error
                        .clone()
                        .unwrap_or_else(|| "Failed to open state store".to_string())),
                };
                let _ = ack.send(result);
            }
        }
    }
}

pub async fn capture_command_output(
    db_path: PathBuf,
    session_id: String,
    mut command: Command,
    output_store: SessionOutputStore,
    heartbeat_interval: std::time::Duration,
) -> Result<ExitStatus> {
    let db_writer = DbWriter::start(db_path, session_id.clone());

    let mut child = match command
        .kill_on_drop(true)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(child) => child,
        Err(error) => {
            let _ = db_writer.update_state(SessionState::Failed).await;
            return Err(error)
                .with_context(|| format!("Failed to start process for session {}", session_id));
        }
    };
    let mut tasks = CaptureTasks::default();
    let result = async {
        let stdout = match child.stdout.take() {
            Some(stdout) => stdout,
            None => {
                let _ = child.kill().await;
                let _ = child.wait().await;
                anyhow::bail!("Child stdout was not piped");
            }
        };
        let stderr = match child.stderr.take() {
            Some(stderr) => stderr,
            None => {
                let _ = child.kill().await;
                let _ = child.wait().await;
                anyhow::bail!("Child stderr was not piped");
            }
        };

        let pid = child
            .id()
            .ok_or_else(|| anyhow::anyhow!("Spawned process did not expose a process id"))?;
        #[cfg(windows)]
        let creation_time = child.raw_handle().and_then(|handle| {
            // SAFETY: child owns this handle through the database acknowledgement.
            unsafe { super::windows_process::creation_time_from_handle(handle) }.ok()
        });
        #[cfg(not(windows))]
        let creation_time = None;
        db_writer.update_pid(Some(pid), creation_time).await?;
        db_writer.update_state(SessionState::Running).await?;
        db_writer.touch_heartbeat().await?;

        let heartbeat_writer = db_writer.clone();
        let heartbeat_task = tokio::spawn(async move {
            let mut ticker = time::interval(heartbeat_interval);
            ticker.set_missed_tick_behavior(MissedTickBehavior::Delay);
            loop {
                ticker.tick().await;
                if heartbeat_writer.touch_heartbeat().await.is_err() {
                    break;
                }
            }
        });
        tasks.0.push(heartbeat_task.abort_handle());

        let stdout_task = tokio::spawn(capture_stream(
            session_id.clone(),
            stdout,
            OutputStream::Stdout,
            output_store.clone(),
            db_writer.clone(),
        ));
        tasks.0.push(stdout_task.abort_handle());
        let stderr_task = tokio::spawn(capture_stream(
            session_id.clone(),
            stderr,
            OutputStream::Stderr,
            output_store,
            db_writer.clone(),
        ));
        tasks.0.push(stderr_task.abort_handle());

        let status = child.wait().await?;
        heartbeat_task.abort();
        let _ = heartbeat_task.await;
        stdout_task.await??;
        stderr_task.await??;

        let final_state = if status.success() {
            SessionState::Completed
        } else {
            SessionState::Failed
        };
        db_writer.update_pid(None, None).await?;
        db_writer.update_state(final_state).await?;

        Ok(status)
    }
    .await;

    if let Err(error) = result {
        // Keep the owned child available until exit is confirmed. A database
        // failure must not turn a still-running process into an untracked one.
        let termination = match child.try_wait() {
            Ok(Some(_)) => Ok(()),
            _ => child.kill().await,
        };
        if let Err(termination_error) = termination {
            let _ = db_writer.update_state(SessionState::Stale).await;
            return Err(error.context(format!(
                "Could not confirm session child termination; existing process tracking was not cleared: {termination_error}"
            )));
        }
        let _ = db_writer.update_pid(None, None).await;
        let _ = db_writer.update_state(SessionState::Failed).await;
        return Err(error);
    }

    result
}

async fn capture_stream<R>(
    session_id: String,
    reader: R,
    stream: OutputStream,
    output_store: SessionOutputStore,
    db_writer: DbWriter,
) -> Result<()>
where
    R: AsyncRead + Unpin,
{
    let mut lines = BufReader::new(reader).lines();

    while let Some(line) = lines.next_line().await? {
        db_writer.append_output_line(stream, line.clone()).await?;
        output_store.push_line(&session_id, stream, line);
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;
    use std::env;

    use anyhow::Result;
    use chrono::Utc;
    use tokio::process::Command;
    use uuid::Uuid;

    use super::capture_command_output;
    use crate::session::output::{SessionOutputStore, OUTPUT_BUFFER_LIMIT};
    use crate::session::store::StateStore;
    use crate::session::{Session, SessionMetrics, SessionState};

    #[cfg(windows)]
    #[tokio::test]
    async fn capture_command_output_stops_child_after_startup_database_failure() -> Result<()> {
        let db_path = env::temp_dir().join(format!("ecc2-runtime-startup-{}.db", Uuid::new_v4()));
        let db = StateStore::open(&db_path)?;
        let now = Utc::now();
        db.insert_session(&Session {
            id: "startup-failure".into(),
            task: "startup failure".into(),
            project: "workspace".into(),
            task_group: "general".into(),
            agent_type: "test".into(),
            working_dir: env::temp_dir(),
            state: SessionState::Pending,
            pid: None,
            worktree: None,
            created_at: now,
            updated_at: now,
            last_heartbeat_at: now,
            metrics: SessionMetrics::default(),
        })?;
        let fixture = rusqlite::Connection::open(&db_path)?;
        fixture.execute_batch(
            "CREATE TABLE observed_child (pid INTEGER, creation_time TEXT);
             CREATE TRIGGER observe_child AFTER UPDATE OF pid ON sessions
             WHEN NEW.pid IS NOT NULL BEGIN
                 INSERT INTO observed_child VALUES (NEW.pid, NEW.pid_creation_time);
             END;
             CREATE TRIGGER reject_running BEFORE UPDATE OF state ON sessions
             WHEN NEW.state = 'running' BEGIN
                 SELECT RAISE(FAIL, 'injected startup state failure');
             END;",
        )?;
        let mut command = Command::new("cmd");
        command.args(["/C", "ping -n 5 127.0.0.1 >nul"]);
        let result = capture_command_output(
            db_path.clone(),
            "startup-failure".into(),
            command,
            SessionOutputStore::default(),
            std::time::Duration::from_millis(20),
        )
        .await;
        let (pid, creation): (u32, String) = fixture.query_row(
            "SELECT pid, creation_time FROM observed_child LIMIT 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        let creation = Some(creation.parse::<u64>()?);
        let alive = super::super::windows_process::session_process_is_alive(pid, creation);
        if alive {
            // Only terminate the freshly spawned fixture after verifying its identity.
            super::super::windows_process::with_verified_process(pid, creation, || {
                let status = std::process::Command::new("taskkill")
                    .args(["/PID", &pid.to_string(), "/T", "/F"])
                    .output()?
                    .status;
                if status.success() {
                    Ok(())
                } else {
                    Err(std::io::Error::other("fixture cleanup failed"))
                }
            })?;
        }
        let session = db.get_session("startup-failure")?.unwrap();
        drop(fixture);
        drop(db);
        let _ = std::fs::remove_file(db_path);
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("injected startup state failure"));
        assert!(
            !alive,
            "startup failure must not leave an untracked child alive"
        );
        assert_eq!(session.state, SessionState::Failed);
        assert_eq!(session.pid, None);
        Ok(())
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn capture_command_output_records_windows_process_identity() -> Result<()> {
        let db_path = env::temp_dir().join(format!("ecc2-runtime-identity-{}.db", Uuid::new_v4()));
        let db = StateStore::open(&db_path)?;
        let now = Utc::now();
        db.insert_session(&Session {
            id: "identity".to_string(),
            task: "quiet process".to_string(),
            project: "workspace".to_string(),
            task_group: "general".to_string(),
            agent_type: "test".to_string(),
            working_dir: env::temp_dir(),
            state: SessionState::Pending,
            pid: None,
            worktree: None,
            created_at: now,
            updated_at: now,
            last_heartbeat_at: now,
            metrics: SessionMetrics::default(),
        })?;
        let mut command = Command::new("cmd");
        command.args(["/C", "ping -n 3 127.0.0.1 >nul"]);
        let child_path = db_path.clone();
        let task = tokio::spawn(capture_command_output(
            child_path,
            "identity".to_string(),
            command,
            SessionOutputStore::default(),
            std::time::Duration::from_millis(20),
        ));
        let observed = async {
            for _ in 0..100 {
                let session = db.get_session("identity")?.unwrap();
                if session.state == SessionState::Running {
                    if let Some(pid) = session.pid {
                        if let Some(creation) = db.process_creation_time("identity", pid)? {
                            return Ok::<_, anyhow::Error>(
                                super::super::windows_process::session_process_is_alive(
                                    pid,
                                    Some(creation),
                                ),
                            );
                        }
                    }
                }
                tokio::time::sleep(std::time::Duration::from_millis(10)).await;
            }
            Ok(false)
        }
        .await;
        let completed = task.await;
        let finished = db.get_session("identity")?;
        drop(db);
        let _ = std::fs::remove_file(db_path);
        assert!(
            observed?,
            "runtime must persist the exact child identity while running"
        );
        assert!(completed??.success());
        assert_eq!(finished.unwrap().pid, None);
        Ok(())
    }

    #[tokio::test]
    async fn capture_command_output_persists_lines_and_events() -> Result<()> {
        let db_path = env::temp_dir().join(format!("ecc2-runtime-{}.db", Uuid::new_v4()));
        let db = StateStore::open(&db_path)?;
        let session_id = "session-1".to_string();
        let now = Utc::now();

        db.insert_session(&Session {
            id: session_id.clone(),
            task: "stream output".to_string(),
            project: "workspace".to_string(),
            task_group: "general".to_string(),
            agent_type: "test".to_string(),
            working_dir: env::temp_dir(),
            state: SessionState::Pending,
            pid: None,
            worktree: None,
            created_at: now,
            updated_at: now,
            last_heartbeat_at: now,
            metrics: SessionMetrics::default(),
        })?;

        let output_store = SessionOutputStore::default();
        let mut rx = output_store.subscribe();
        #[cfg(windows)]
        let mut command = {
            let mut command = Command::new("cmd");
            command.args(["/C", "echo alpha&echo beta>&2"]);
            command
        };
        #[cfg(not(windows))]
        let mut command = Command::new("/bin/sh");
        #[cfg(not(windows))]
        command
            .arg("-c")
            .arg("printf 'alpha\\n'; printf 'beta\\n' >&2");

        let status = capture_command_output(
            db_path.clone(),
            session_id.clone(),
            command,
            output_store,
            std::time::Duration::from_millis(10),
        )
        .await?;

        assert!(status.success());

        let db = StateStore::open(&db_path)?;
        let session = db
            .get_session(&session_id)?
            .expect("session should still exist");
        assert_eq!(session.state, SessionState::Completed);
        assert_eq!(session.pid, None);

        let lines = db.get_output_lines(&session_id, OUTPUT_BUFFER_LIMIT)?;
        let texts: HashSet<_> = lines.iter().map(|line| line.text.as_str()).collect();
        assert_eq!(lines.len(), 2);
        assert!(texts.contains("alpha"));
        assert!(texts.contains("beta"));

        let mut events = Vec::new();
        while let Ok(event) = rx.try_recv() {
            events.push(event.line.text);
        }

        assert_eq!(events.len(), 2);
        assert!(events.iter().any(|line| line == "alpha"));
        assert!(events.iter().any(|line| line == "beta"));

        let _ = std::fs::remove_file(db_path);

        Ok(())
    }

    #[tokio::test]
    async fn capture_command_output_updates_heartbeat_for_quiet_processes() -> Result<()> {
        let db_path = env::temp_dir().join(format!("ecc2-runtime-heartbeat-{}.db", Uuid::new_v4()));
        let db = StateStore::open(&db_path)?;
        let session_id = "session-heartbeat".to_string();
        let now = Utc::now();

        db.insert_session(&Session {
            id: session_id.clone(),
            task: "quiet process".to_string(),
            project: "workspace".to_string(),
            task_group: "general".to_string(),
            agent_type: "test".to_string(),
            working_dir: env::temp_dir(),
            state: SessionState::Pending,
            pid: None,
            worktree: None,
            created_at: now,
            updated_at: now,
            last_heartbeat_at: now,
            metrics: SessionMetrics::default(),
        })?;

        #[cfg(windows)]
        let mut command = {
            let mut command = Command::new("cmd");
            command.args(["/C", "ping -n 2 127.0.0.1 >nul"]);
            command
        };
        #[cfg(not(windows))]
        let mut command = Command::new("/bin/sh");
        #[cfg(not(windows))]
        command.arg("-c").arg("sleep 0.05");

        let _ = capture_command_output(
            db_path.clone(),
            session_id.clone(),
            command,
            SessionOutputStore::default(),
            std::time::Duration::from_millis(10),
        )
        .await?;

        let db = StateStore::open(&db_path)?;
        let session = db
            .get_session(&session_id)?
            .expect("session should still exist");

        assert!(session.last_heartbeat_at > now);
        assert_eq!(session.state, SessionState::Completed);

        let _ = std::fs::remove_file(db_path);
        Ok(())
    }
}
