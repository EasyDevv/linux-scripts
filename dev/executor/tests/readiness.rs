use executor::pm::{ManagedProcessExit, ManagedProcessSnapshot, ManagedProcessState};
use executor::readiness::{runtime_start_complete, runtime_state_failure, runtime_stop_complete};

fn snap(state: ManagedProcessState, pid: u32, err: Option<&str>) -> ManagedProcessSnapshot {
    ManagedProcessSnapshot {
        name: "app".into(),
        state,
        pid,
        started_at: None,
        restart_attempts: 0,
        next_retry_at: None,
        last_exit: None,
        last_error: err.map(str::to_string),
    }
}

#[test]
fn blocked_reports_error() {
    let blocked = runtime_state_failure(
        "web",
        "start",
        &snap(
            ManagedProcessState::Blocked,
            0,
            Some("working directory is unavailable"),
        ),
    )
    .unwrap();
    let backoff = runtime_state_failure(
        "api",
        "reload",
        &ManagedProcessSnapshot {
            last_exit: Some(ManagedProcessExit {
                exit_code: Some(1),
                signal_code: None,
                at: 1,
            }),
            ..snap(ManagedProcessState::Backoff, 0, None)
        },
    )
    .unwrap();
    assert!(blocked.contains("start blocked for web"));
    assert!(blocked.contains("working directory is unavailable"));
    assert!(backoff.contains("reload failed for api"));
    assert!(backoff.contains("instance is in backoff"));
    assert!(backoff.contains("exit 1"));
    assert!(runtime_state_failure("web", "start", &snap(ManagedProcessState::Running, 1, None)).is_none());
}

#[test]
fn start_complete_needs_running_pid() {
    let running = snap(ManagedProcessState::Running, std::process::id(), None);
    assert!(runtime_start_complete(true, Some(&running), None, false));
    assert!(!runtime_start_complete(false, Some(&running), None, false));
    assert!(!runtime_start_complete(
        true,
        Some(&snap(ManagedProcessState::Blocked, 0, None)),
        None,
        false
    ));
}

#[test]
fn stop_complete_when_pid_changes() {
    assert!(runtime_stop_complete(true, None, 999_999_999));
    assert!(!runtime_stop_complete(false, None, 999_999_999));
    assert!(!runtime_stop_complete(true, None, std::process::id()));
    assert!(!runtime_stop_complete(
        true,
        Some(&snap(ManagedProcessState::Stopping, 0, None)),
        999_999_999
    ));
}
