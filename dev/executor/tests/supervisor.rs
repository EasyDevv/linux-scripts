use std::fs;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};
use tempfile::TempDir;

fn alive(pid: u32) -> bool {
    nix::sys::signal::kill(nix::unistd::Pid::from_raw(pid as i32), None).is_ok()
}

#[tokio::test]
async fn blocked_does_not_stop_healthy() {
    let dir = TempDir::new().unwrap();
    let config_dir = dir.path().join("systemd/user");
    let runtime_dir = dir.path().join("runtime");
    fs::create_dir_all(&config_dir).unwrap();
    fs::create_dir_all(&runtime_dir).unwrap();
    let bad = format!("bad-{}", std::process::id());
    let good = format!("good-{}", std::process::id());
    let missing = dir.path().join("missing").display().to_string();
    fs::write(
        config_dir.join("executor.json"),
        format!(
            r#"{{ "{bad}": {{ "dir": "{missing}", "cmd": "sleep 5" }}, "{good}": {{ "dir": "/tmp", "cmd": "sleep 5" }} }}"#
        ),
    )
    .unwrap();

    let bin = env!("CARGO_BIN_EXE_executor");
    let mut child = Command::new(bin)
        .args(["run"])
        .env("XDG_CONFIG_HOME", dir.path())
        .env("XDG_RUNTIME_DIR", &runtime_dir)
        .env("EXECUTOR_PROXY_PORT", "0")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();

    let runtime_path = runtime_dir.join("executor/runtime.json");
    let deadline = Instant::now() + Duration::from_secs(5);
    let mut good_pid = 0u32;
    while Instant::now() < deadline {
        if let Ok(text) = fs::read_to_string(&runtime_path) {
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) {
                let bad_state = value["instances"][&bad]["state"].as_str();
                let good_state = value["instances"][&good]["state"].as_str();
                if bad_state == Some("blocked") && good_state == Some("running") {
                    good_pid = value["instances"][&good]["pid"].as_u64().unwrap_or(0) as u32;
                    break;
                }
            }
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    assert!(good_pid > 0, "healthy instance did not start");
    assert!(alive(good_pid));
    fs::write(config_dir.join("executor.json"), "{ malformed").unwrap();
    tokio::time::sleep(Duration::from_millis(150)).await;
    assert!(alive(good_pid));
    let _ = nix::sys::signal::kill(
        nix::unistd::Pid::from_raw(child.id() as i32),
        nix::sys::signal::Signal::SIGTERM,
    );
    let _ = child.wait();
}
