use std::ffi::c_void;
use std::io;

const SYNCHRONIZE: u32 = 0x0010_0000;
const ERROR_INVALID_PARAMETER: u32 = 87;
const WAIT_OBJECT_0: u32 = 0;
const PROCESS_QUERY_LIMITED_INFORMATION: u32 = 0x1000;

#[repr(C)]
#[derive(Default)]
struct FileTime {
    low: u32,
    high: u32,
}

#[link(name = "kernel32")]
extern "system" {
    #[link_name = "OpenProcess"]
    fn open_process(access: u32, inherit: i32, pid: u32) -> *mut c_void;
    #[link_name = "WaitForSingleObject"]
    fn wait_for_single_object(handle: *mut c_void, milliseconds: u32) -> u32;
    #[link_name = "CloseHandle"]
    fn close_handle(handle: *mut c_void) -> i32;
    #[link_name = "GetProcessTimes"]
    fn get_process_times(
        handle: *mut c_void,
        creation: *mut FileTime,
        exit: *mut FileTime,
        kernel: *mut FileTime,
        user: *mut FileTime,
    ) -> i32;
}

struct ProcessHandle(*mut c_void);

impl ProcessHandle {
    fn open(pid: u32) -> io::Result<Self> {
        // SAFETY: opens a non-inherited process handle for read-only queries.
        let handle =
            unsafe { open_process(SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
        if handle.is_null() {
            return Err(io::Error::last_os_error());
        }
        Ok(Self(handle))
    }

    fn has_exited(&self) -> bool {
        // SAFETY: the owned handle stays open throughout the zero-timeout wait.
        unsafe { wait_for_single_object(self.0, 0) == WAIT_OBJECT_0 }
    }
}

impl Drop for ProcessHandle {
    fn drop(&mut self) {
        // SAFETY: closes this uniquely owned handle exactly once.
        unsafe { close_handle(self.0) };
    }
}

/// Read the exact process creation FILETIME from the spawned child's handle.
///
/// # Safety
/// `handle` must be a valid process handle kept open by its owner for this call.
pub(super) unsafe fn creation_time_from_handle(handle: *mut c_void) -> io::Result<u64> {
    let mut creation = FileTime::default();
    let mut exit = FileTime::default();
    let mut kernel = FileTime::default();
    let mut user = FileTime::default();
    if get_process_times(handle, &mut creation, &mut exit, &mut kernel, &mut user) == 0 {
        return Err(io::Error::last_os_error());
    }
    Ok((u64::from(creation.high) << 32) | u64::from(creation.low))
}

pub(super) fn session_process_is_alive(pid: u32, expected_creation: Option<u64>) -> bool {
    if pid == 0 {
        return false;
    }
    let handle = match ProcessHandle::open(pid) {
        Ok(handle) => handle,
        Err(error) => return retain_after_open_error(error.raw_os_error().unwrap_or(0) as u32),
    };
    if handle.has_exited() {
        return false;
    }
    match expected_creation {
        // Missing legacy identity or a failed query is uncertain, not death.
        // Termination independently requires a confirmed identity below.
        None => true,
        Some(expected) => unsafe { creation_time_from_handle(handle.0) }
            .map(|actual| actual == expected)
            .unwrap_or(true),
    }
}

pub(super) fn with_verified_process<F>(
    pid: u32,
    expected_creation: Option<u64>,
    terminate: F,
) -> io::Result<()>
where
    F: FnOnce() -> io::Result<()>,
{
    let handle = match ProcessHandle::open(pid) {
        Ok(handle) => handle,
        Err(error) if error.raw_os_error() == Some(ERROR_INVALID_PARAMETER as i32) => return Ok(()),
        Err(error) => return Err(error),
    };
    if handle.has_exited() {
        return Ok(());
    }
    let expected = expected_creation.ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::PermissionDenied,
            "Session process identity is unverified; verify and stop the legacy process externally, then retry",
        )
    })?;
    // SAFETY: the owned handle remains open for the query and termination.
    if unsafe { creation_time_from_handle(handle.0) }? != expected {
        return Ok(()); // The recorded process has gone; do not target its replacement.
    }
    // Holding this verified handle prevents PID reuse until taskkill completes.
    // Parent exit alone cannot prove that taskkill /T terminated descendants;
    // preserve every tree-termination error instead of reporting success.
    terminate()
}

fn retain_after_open_error(error: u32) -> bool {
    // A nonexistent PID yields ERROR_INVALID_PARAMETER. Access denial and
    // other unknown failures do not prove termination: preserve the session.
    error != ERROR_INVALID_PARAMETER
}

#[cfg(test)]
mod tests {
    use super::{
        creation_time_from_handle, retain_after_open_error, session_process_is_alive,
        with_verified_process,
    };
    use std::os::windows::io::AsRawHandle;

    #[test]
    fn exited_legacy_process_does_not_require_identity() {
        let mut child = std::process::Command::new("cmd")
            .args(["/C", "exit", "0"])
            .spawn()
            .expect("isolated child");
        child.wait().unwrap();
        with_verified_process(child.id(), None, || {
            panic!("must not terminate an exited process")
        })
        .unwrap();
    }

    #[test]
    fn tree_termination_error_is_preserved_after_parent_exit() {
        let mut child = std::process::Command::new("cmd")
            .args(["/C", "pause"])
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::null())
            .spawn()
            .expect("isolated child");
        let creation = unsafe { creation_time_from_handle(child.as_raw_handle()) }.unwrap();
        let result = with_verified_process(child.id(), Some(creation), || {
            child.kill()?;
            child.wait()?;
            Err(std::io::Error::other(
                "process exited before taskkill completed",
            ))
        });
        let _ = child.kill();
        let _ = child.wait();
        assert!(
            result.is_err(),
            "parent exit does not prove descendant termination"
        );
    }

    #[test]
    fn termination_error_for_a_live_verified_process_is_preserved() {
        let mut child = std::process::Command::new("cmd")
            .args(["/C", "pause"])
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::null())
            .spawn()
            .expect("isolated child");
        let creation = unsafe { creation_time_from_handle(child.as_raw_handle()) }.unwrap();
        let result = with_verified_process(child.id(), Some(creation), || {
            Err(std::io::Error::other("fixture termination failure"))
        });
        let alive = child.try_wait().unwrap().is_none();
        child.kill().unwrap();
        child.wait().unwrap();
        assert!(alive);
        assert_eq!(
            result.unwrap_err().to_string(),
            "fixture termination failure"
        );
    }

    #[test]
    fn reused_identity_is_not_recovered_or_terminated() {
        let mut child = std::process::Command::new("cmd")
            .args(["/C", "pause"])
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::null())
            .spawn()
            .expect("isolated child");
        let creation = unsafe { creation_time_from_handle(child.as_raw_handle()) }.unwrap();
        let alive = session_process_is_alive(child.id(), Some(creation + 1));
        let called = std::cell::Cell::new(false);
        let result = with_verified_process(child.id(), Some(creation + 1), || {
            called.set(true);
            Ok(())
        });
        child.kill().unwrap();
        child.wait().unwrap();
        assert!(!alive);
        result.unwrap();
        assert!(!called.get());
    }

    #[test]
    fn missing_identity_refuses_termination() {
        let called = std::cell::Cell::new(false);
        assert!(with_verified_process(std::process::id(), None, || {
            called.set(true);
            Ok(())
        })
        .is_err());
        assert!(!called.get());
    }

    #[test]
    fn exact_child_identity_allows_termination() {
        let mut child = std::process::Command::new("cmd")
            .args(["/C", "pause"])
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::null())
            .spawn()
            .expect("isolated child");
        let creation = unsafe { creation_time_from_handle(child.as_raw_handle()) }.unwrap();
        let alive = session_process_is_alive(child.id(), Some(creation));
        let called = std::cell::Cell::new(false);
        let result = with_verified_process(child.id(), Some(creation), || {
            called.set(true);
            child.kill()
        });
        if result.is_err() {
            let _ = child.kill();
        }
        child.wait().unwrap();
        assert!(alive);
        result.unwrap();
        assert!(called.get());
    }

    #[test]
    fn current_process_is_alive() {
        assert!(session_process_is_alive(std::process::id(), None));
    }

    #[test]
    fn zero_is_not_a_session_process() {
        assert!(!session_process_is_alive(0, None));
    }

    #[test]
    fn exited_child_is_not_alive() {
        let mut child = std::process::Command::new("cmd")
            .args(["/C", "exit", "0"])
            .spawn()
            .expect("start isolated child");
        let pid = child.id();
        child.wait().expect("wait for isolated child");
        assert!(!session_process_is_alive(pid, None));
    }

    #[test]
    fn live_child_is_alive() {
        let mut child = std::process::Command::new("cmd")
            .args(["/C", "pause"])
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::null())
            .spawn()
            .expect("start isolated live child");
        let alive = session_process_is_alive(child.id(), None);
        child.kill().expect("stop isolated live child");
        child.wait().expect("reap isolated live child");
        assert!(alive);
    }

    #[test]
    fn access_denial_and_unknown_errors_preserve_sessions() {
        assert!(retain_after_open_error(5)); // ERROR_ACCESS_DENIED
        assert!(retain_after_open_error(8)); // ERROR_NOT_ENOUGH_MEMORY
        assert!(!retain_after_open_error(87)); // ERROR_INVALID_PARAMETER
    }
}
