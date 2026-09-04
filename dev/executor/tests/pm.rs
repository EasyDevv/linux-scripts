use executor::config::NormalizedInstance;
use executor::pm::{ManagedProcessState, ProcessManager, ProcessManagerOptions};
use executor::paths::state_dir;
use std::collections::BTreeMap;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::sync::Mutex;
use std::time::Duration;
use tempfile::TempDir;

static LOCK: Mutex<()> = Mutex::new(());

fn lock() -> std::sync::MutexGuard<'static, ()> {
    LOCK.lock().unwrap_or_else(|error| error.into_inner())
}

fn setup() -> TempDir {
    let dir = TempDir::new().unwrap();
    unsafe {
        std::env::set_var("XDG_RUNTIME_DIR", dir.path().join("runtime"));
    }
    fs::create_dir_all(dir.path().join("runtime/executor")).unwrap();
    dir
}

fn instance(name: &str, cmd: &str, dir: &str) -> NormalizedInstance {
    NormalizedInstance {
        name: name.into(),
        dir: dir.into(),
        cmd: cmd.into(),
        enabled: true,
        env: BTreeMap::new(),
    }
}

fn manager(options: ProcessManagerOptions) -> ProcessManager {
    ProcessManager::new(BTreeMap::new(), options)
}

fn defaults() -> ProcessManagerOptions {
    ProcessManagerOptions {
        systemd_cat_path: "/executor-test/missing-systemd-cat".into(),
        backoff_delays_ms: vec![10, 20, 40],
        backoff_jitter: 0.0,
        normal_runtime_ms: 1_000,
        termination_grace_ms: 100,
        ..ProcessManagerOptions::default()
    }
}

async fn wait_state(
    proc: &executor::pm::ManagedProcess,
    want: ManagedProcessState,
    timeout_ms: u64,
) {
    let deadline = std::time::Instant::now() + Duration::from_millis(timeout_ms);
    while std::time::Instant::now() < deadline {
        if proc.state() == want {
            return;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("timed out waiting for {want:?}, last {:?}", proc.state());
}

fn helper(dir: &std::path::Path, body: &str) -> std::path::PathBuf {
    let path = dir.join(format!("helper-{}", uuid_like()));
    fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
    let mut perms = fs::metadata(&path).unwrap().permissions();
    perms.set_mode(0o755);
    fs::set_permissions(&path, perms).unwrap();
    path
}

fn uuid_like() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos() as u64
}

fn alive(pid: u32) -> bool {
    nix::sys::signal::kill(nix::unistd::Pid::from_raw(pid as i32), None).is_ok()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn missing_cwd_blocks() {
    let _g = lock();
    let _dir = setup();
    let pm = manager(ProcessManagerOptions {
        backoff_delays_ms: vec![10, 20],
        backoff_jitter: 0.0,
        ..defaults()
    });
    let proc = pm.start(&instance("bad", "true", "/no/such/executor-dir"));
    wait_state(&proc, ManagedProcessState::Blocked, 1_500).await;
    assert!(proc
        .snapshot()
        .last_error
        .unwrap_or_default()
        .contains("working directory"));
    let _ = proc.stop().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn journal_fallback_runs() {
    let _g = lock();
    let _dir = setup();
    let pm = manager(defaults());
    let proc = pm.start(&instance("ok", "sleep 30", "/tmp"));
    wait_state(&proc, ManagedProcessState::Running, 2_000).await;
    assert!(proc.pid() > 0);
    assert!(state_dir().join("ok.identity.json").exists());
    let _ = proc.stop().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn failing_logger_does_not_block() {
    let _g = lock();
    let _dir = setup();
    let pm = manager(ProcessManagerOptions {
        systemd_cat_path: "/bin/false".into(),
        backoff_jitter: 0.0,
        ..defaults()
    });
    let proc = pm.start(&instance("ok", "sleep 30", "/tmp"));
    wait_state(&proc, ManagedProcessState::Running, 2_000).await;
    assert!(proc.pid() > 0);
    let _ = proc.stop().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn immediate_exit_backoff() {
    let _g = lock();
    let _dir = setup();
    let pm = manager(defaults());
    let proc = pm.start(&instance("boom", "exit 1", "/tmp"));
    wait_state(&proc, ManagedProcessState::Backoff, 1_500).await;
    let snap = proc.snapshot();
    assert!(snap.restart_attempts >= 1);
    assert!(snap.next_retry_at.is_some());
    let started = std::time::Instant::now();
    let _ = proc.stop().await;
    assert!(started.elapsed() < Duration::from_secs(1));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn concurrent_restart() {
    let _g = lock();
    let _dir = setup();
    let pm = manager(defaults());
    let proc = pm.start(&instance("rst", "sleep 30", "/tmp"));
    wait_state(&proc, ManagedProcessState::Running, 2_000).await;
    let first = proc.pid();
    let _ = tokio::join!(proc.restart(), proc.restart(), proc.restart());
    let deadline = std::time::Instant::now() + Duration::from_secs(2);
    while std::time::Instant::now() < deadline {
        if proc.state() == ManagedProcessState::Running && proc.pid() != first && proc.pid() > 0 {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    assert_eq!(proc.state(), ManagedProcessState::Running);
    assert_ne!(proc.pid(), first);
    let _ = proc.stop().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn restart_during_starting() {
    let _g = lock();
    let dir = setup();
    let logger = helper(dir.path(), "sleep 0.15\nexit 1");
    let pm = manager(ProcessManagerOptions {
        systemd_cat_path: logger,
        ..defaults()
    });
    let proc = pm.start(&instance("start", "sleep 30", "/tmp"));
    let started = std::time::Instant::now();
    let _ = proc.restart().await;
    assert_eq!(proc.state(), ManagedProcessState::Running);
    assert!(proc.pid() > 0);
    assert!(started.elapsed() > Duration::from_millis(100));
    let _ = proc.stop().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn restart_during_backoff() {
    let _g = lock();
    let _dir = setup();
    let pm = manager(ProcessManagerOptions {
        backoff_delays_ms: vec![1_000],
        ..defaults()
    });
    let proc = pm.start(&instance("bo", "sleep 0.2", "/tmp"));
    wait_state(&proc, ManagedProcessState::Backoff, 2_000).await;
    let _ = proc.restart().await;
    assert_eq!(proc.state(), ManagedProcessState::Running);
    assert!(proc.pid() > 0);
    let _ = proc.stop().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn stubborn_descendants() {
    let _g = lock();
    let dir = setup();
    let child_file = dir.path().join("stubborn-child.pid");
    let cmd = format!(
        "trap 'exit 0' TERM INT; (trap '' TERM INT; exec sleep 30) & child=$!; echo $child > {}; wait",
        child_file.display()
    );
    let pm = manager(defaults());
    let proc = pm.start(&instance("stub", &cmd, "/tmp"));
    wait_state(&proc, ManagedProcessState::Running, 2_000).await;
    let deadline = std::time::Instant::now() + Duration::from_secs(2);
    let mut first_child = 0u32;
    while std::time::Instant::now() < deadline {
        if let Ok(text) = fs::read_to_string(&child_file) {
            if let Ok(pid) = text.trim().parse() {
                first_child = pid;
                break;
            }
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    assert!(first_child > 0);
    let first = proc.pid();
    let _ = proc.restart().await;
    wait_state(&proc, ManagedProcessState::Running, 2_000).await;
    assert_ne!(proc.pid(), first);
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert!(!alive(first_child));
    let second: u32 = fs::read_to_string(&child_file)
        .ok()
        .and_then(|text| text.trim().parse().ok())
        .unwrap_or(0);
    let _ = proc.stop().await;
    tokio::time::sleep(Duration::from_millis(200)).await;
    if second > 0 {
        assert!(!alive(second));
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn stale_pid_does_not_kill_external() {
    let _g = lock();
    let _dir = setup();
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let cmd = format!("sleep 5 # --port {port}");
    fs::create_dir_all(state_dir()).unwrap();
    fs::write(
        state_dir().join("stale.pid"),
        format!("{}\n", std::process::id()),
    )
    .unwrap();
    let pm = manager(defaults());
    let proc = pm.start(&instance("stale", &cmd, "/tmp"));
    wait_state(&proc, ManagedProcessState::Backoff, 2_000).await;
    assert!(listener.local_addr().is_ok());
    let _ = proc.stop().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn corrupt_identity_is_unowned() {
    let _g = lock();
    let _dir = setup();
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let cmd = format!("sleep 5 # --port {port}");
    fs::create_dir_all(state_dir()).unwrap();
    fs::write(state_dir().join("corrupt.pid"), format!("{}\n", std::process::id())).unwrap();
    fs::write(state_dir().join("corrupt.identity.json"), "not-json\n").unwrap();
    let pm = manager(defaults());
    let proc = pm.start(&instance("corrupt", &cmd, "/tmp"));
    wait_state(&proc, ManagedProcessState::Backoff, 2_000).await;
    let _ = proc.stop().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn lsof_failure_blocks() {
    let _g = lock();
    let dir = setup();
    let helper = helper(dir.path(), "exit 2");
    let pm = manager(ProcessManagerOptions {
        lsof_path: helper,
        ..defaults()
    });
    let proc = pm.start(&instance("lsof", "sleep 5 # --port 43123", "/tmp"));
    wait_state(&proc, ManagedProcessState::Blocked, 2_000).await;
    assert!(proc
        .snapshot()
        .last_error
        .unwrap_or_default()
        .contains("lsof helper failed"));
    let _ = proc.stop().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn lsof_timeout_blocks() {
    let _g = lock();
    let dir = setup();
    let helper = helper(dir.path(), "sleep 3");
    let pm = manager(ProcessManagerOptions {
        lsof_path: helper,
        ..defaults()
    });
    let proc = pm.start(&instance("lto", "sleep 5 # --port 43124", "/tmp"));
    wait_state(&proc, ManagedProcessState::Blocked, 3_500).await;
    assert!(proc
        .snapshot()
        .last_error
        .unwrap_or_default()
        .contains("timed out"));
    let _ = proc.stop().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn lsof_overflow_blocks() {
    let _g = lock();
    let dir = setup();
    let helper = helper(dir.path(), "head -c 2000000 /dev/zero");
    let pm = manager(ProcessManagerOptions {
        lsof_path: helper,
        ..defaults()
    });
    let proc = pm.start(&instance("lov", "sleep 5 # --port 43125", "/tmp"));
    wait_state(&proc, ManagedProcessState::Blocked, 8_000).await;
    assert!(proc
        .snapshot()
        .last_error
        .unwrap_or_default()
        .contains("output exceeded"));
    let _ = proc.stop().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn ps_failure_still_stops() {
    let _g = lock();
    let dir = setup();
    let helper = helper(dir.path(), "exit 2");
    let pm = manager(ProcessManagerOptions {
        ps_path: helper,
        ..defaults()
    });
    let proc = pm.start(&instance("ps", "exec sleep 30", "/tmp"));
    wait_state(&proc, ManagedProcessState::Running, 2_000).await;
    let pid = proc.pid();
    let _ = proc.stop().await;
    assert_eq!(proc.state(), ManagedProcessState::Stopped);
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert!(!alive(pid));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn port_refuses_external() {
    let _g = lock();
    let _dir = setup();
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let pm = manager(defaults());
    let proc = pm.start(&instance("port", &format!("sleep 5 --port {port}"), "/tmp"));
    wait_state(&proc, ManagedProcessState::Backoff, 2_000).await;
    assert!(listener.local_addr().is_ok());
    let _ = proc.stop().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn established_not_listen() {
    let _g = lock();
    let dir = setup();
    let helper = helper(
        dir.path(),
        r#"for arg in "$@"; do case "$arg" in *LISTEN*) exit 1 ;; esac; done; echo 1; exit 0"#,
    );
    let pm = manager(ProcessManagerOptions {
        lsof_path: helper,
        ..defaults()
    });
    let proc = pm.start(&instance("est", "sleep 30 --port 43126", "/tmp"));
    let deadline = std::time::Instant::now() + Duration::from_secs(2);
    let mut state = proc.state();
    while std::time::Instant::now() < deadline {
        state = proc.state();
        if state == ManagedProcessState::Running || state == ManagedProcessState::Blocked {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    assert_eq!(state, ManagedProcessState::Running);
    let _ = proc.stop().await;
}
