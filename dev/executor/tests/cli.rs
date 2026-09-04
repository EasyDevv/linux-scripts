use std::fs;
use std::process::Command;
use tempfile::TempDir;

#[test]
fn status_reports_blocked() {
    let dir = TempDir::new().unwrap();
    let config_dir = dir.path().join("systemd/user");
    let runtime_dir = dir.path().join("runtime");
    fs::create_dir_all(&config_dir).unwrap();
    fs::create_dir_all(runtime_dir.join("executor")).unwrap();
    let name = format!("blocked-{}", std::process::id());
    fs::write(
        config_dir.join("executor.json"),
        format!(r#"{{ "{name}": {{ "dir": "/tmp", "cmd": "sleep 5 --port 49123" }} }}"#),
    )
    .unwrap();
    fs::write(
        runtime_dir.join("executor/runtime.json"),
        format!(
            r#"{{ "version": 1, "supervisor": {{ "pid": 1, "version": "0.1.0", "startedAt": 0 }}, "instances": {{ "{name}": {{ "name": "{name}", "state": "blocked", "pid": 0, "startedAt": null, "restartAttempts": 0, "nextRetryAt": null, "lastExit": null, "lastError": "working directory is unavailable" }} }}, "proxy": {{ "pendingRequests": 0, "pendingWebSockets": 0 }} }}"#
        ),
    )
    .unwrap();

    let bin = env!("CARGO_BIN_EXE_executor");
    let output = Command::new(bin)
        .args(["status", &name])
        .env("XDG_CONFIG_HOME", dir.path())
        .env("XDG_RUNTIME_DIR", &runtime_dir)
        .output()
        .unwrap();
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert_eq!(output.status.code(), Some(0), "{stderr}");
    assert!(!stderr.contains("Unhandled"));
    assert!(stdout.contains("runtime: blocked"), "{stdout}");
    assert!(stdout.contains("last error: working directory is unavailable"), "{stdout}");
}
