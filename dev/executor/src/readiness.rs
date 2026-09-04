use crate::cli::{fail, CliError};
use crate::journal::{
    reload_executor_service, show_executor_service_logs, show_instance_logs,
    verify_executor_service_active,
};
use crate::pm::{ManagedProcessSnapshot, ManagedProcessState, ProcessManager, ProcessManagerOptions};
use crate::runner::{format_since, print_command, run_text, sleep_ms, RunOptions, RunResult};
use crate::state::RuntimeStateFile;
use crate::vite::print_vite_ready_fallback;
use std::collections::BTreeMap;
use std::time::{Duration, Instant};

pub async fn read_runtime_state() -> Result<Option<RuntimeStateFile>, CliError> {
    crate::state::read_runtime_state().await
}

fn process_alive(pid: u32) -> bool {
    if pid == 0 {
        return false;
    }
    match nix::sys::signal::kill(nix::unistd::Pid::from_raw(pid as i32), None) {
        Ok(()) => true,
        Err(nix::errno::Errno::EPERM) => true,
        Err(_) => false,
    }
}

pub fn runtime_state_failure(
    name: &str,
    label: &str,
    snapshot: &ManagedProcessSnapshot,
) -> Option<String> {
    let detail = if let Some(error) = &snapshot.last_error {
        format!(": {error}")
    } else if let Some(exit) = &snapshot.last_exit {
        let mut text = format!(" (exit {}", exit.exit_code.map(|code| code.to_string()).unwrap_or_else(|| "unknown".into()));
        if let Some(signal) = &exit.signal_code {
            text.push_str(&format!(", signal {signal}"));
        }
        text.push(')');
        text
    } else {
        String::new()
    };
    match snapshot.state {
        ManagedProcessState::Blocked => Some(format!(
            "[executor] {label} blocked for {name}{detail}"
        )),
        ManagedProcessState::Backoff => Some(format!(
            "[executor] {label} failed for {name}: instance is in backoff{detail}"
        )),
        ManagedProcessState::Stopped => Some(format!(
            "[executor] {label} failed for {name}: instance is stopped{detail}"
        )),
        _ => None,
    }
}

fn same_runtime_snapshot(left: &ManagedProcessSnapshot, right: &ManagedProcessSnapshot) -> bool {
    left.state == right.state
        && left.pid == right.pid
        && left.started_at == right.started_at
        && left.last_error == right.last_error
        && left.last_exit.as_ref().map(|exit| exit.at) == right.last_exit.as_ref().map(|exit| exit.at)
}

fn runtime_start_observed(
    snapshot: &ManagedProcessSnapshot,
    before: Option<&ManagedProcessSnapshot>,
    require_restart: bool,
) -> bool {
    if snapshot.state != ManagedProcessState::Running || !process_alive(snapshot.pid) {
        return false;
    }
    if !require_restart || before.is_none_or(|before| before.state != ManagedProcessState::Running) {
        return true;
    }
    let before = before.unwrap();
    snapshot.pid != before.pid || snapshot.started_at != before.started_at
}

pub fn runtime_start_complete(
    runtime_available: bool,
    snapshot: Option<&ManagedProcessSnapshot>,
    before: Option<&ManagedProcessSnapshot>,
    require_restart: bool,
) -> bool {
    runtime_available
        && snapshot.is_some_and(|snapshot| runtime_start_observed(snapshot, before, require_restart))
}

pub fn runtime_stop_complete(
    runtime_available: bool,
    snapshot: Option<&ManagedProcessSnapshot>,
    initial_pid: u32,
) -> bool {
    runtime_available
        && snapshot.is_none_or(|snapshot| snapshot.state == ManagedProcessState::Stopped)
        && !process_alive(initial_pid)
}

fn print_readiness_result(args: &[String], result: &RunResult) {
    print_command(args);
    let stdout = result.stdout.trim_end();
    let stderr = result.stderr.trim_end();
    if !stdout.is_empty() {
        println!("{stdout}");
    }
    if !stderr.is_empty() {
        eprintln!("{stderr}");
    }
    let mut details = Vec::new();
    if result.spawn_error.is_some() {
        details.push(result.spawn_error.clone().unwrap());
    }
    if result.timed_out {
        details.push("timed out".into());
    }
    if result.output_overflow {
        details.push("output limit exceeded".into());
    }
    if !details.is_empty() {
        eprintln!(
            "[executor] readiness log query failed: {}",
            details.join(", ")
        );
    }
}

async fn stable_runtime_start(
    name: &str,
    label: &str,
    before: Option<&ManagedProcessSnapshot>,
    require_restart: bool,
) -> Result<bool, CliError> {
    let runtime = read_runtime_state().await?;
    let snapshot = runtime.as_ref().and_then(|runtime| runtime.instances.get(name));
    let Some(snapshot) = snapshot else {
        return Ok(false);
    };
    if let Some(failure) = runtime_state_failure(name, label, snapshot) {
        if before.is_none_or(|before| !same_runtime_snapshot(snapshot, before)) {
            return Err(fail(failure));
        }
    }
    if !runtime_start_complete(true, Some(snapshot), before, require_restart) {
        return Ok(false);
    }
    tokio::time::sleep(Duration::from_millis(100)).await;
    let confirmed_runtime = read_runtime_state().await?;
    let confirmed = confirmed_runtime
        .as_ref()
        .and_then(|runtime| runtime.instances.get(name));
    let Some(confirmed) = confirmed else {
        return Ok(false);
    };
    if let Some(failure) = runtime_state_failure(name, label, confirmed) {
        if before.is_none_or(|before| !same_runtime_snapshot(confirmed, before)) {
            return Err(fail(failure));
        }
    }
    Ok(runtime_start_complete(
        confirmed_runtime.is_some(),
        Some(confirmed),
        before,
        require_restart,
    ))
}

async fn wait_for_log_pattern(
    name: &str,
    pattern: &str,
    since: &str,
    label: &str,
    timeout_seconds: u64,
    port: Option<&str>,
    before: Option<&ManagedProcessSnapshot>,
    require_restart: bool,
) -> Result<(), CliError> {
    let args = vec![
        "/usr/bin/journalctl".into(),
        "--user".into(),
        "-t".into(),
        format!("executor/{name}"),
        "--since".into(),
        since.into(),
        "--output=cat".into(),
        "--no-pager".into(),
    ];
    let deadline = Instant::now() + Duration::from_secs(timeout_seconds);
    let mut conflict_handled = false;
    let mut log_pattern_seen = false;
    let port_conflict = regex_port_conflict();
    while Instant::now() < deadline {
        if stable_runtime_start(name, label, before, require_restart).await? {
            return Ok(());
        }
        let result = run_text(&args, RunOptions::default());
        if result.stdout.contains(pattern) {
            log_pattern_seen = true;
        }
        if !conflict_handled {
            if let Some(port) = port {
                if port_conflict(&result.stdout) {
                    conflict_handled = true;
                    eprintln!(
                        "[executor] port {port} is occupied; refusing to kill an external process"
                    );
                }
            }
        }
        sleep_ms(1_000);
    }
    let result = run_text(&args, RunOptions::default());
    if result.stdout.contains(pattern) {
        log_pattern_seen = true;
    }
    print_readiness_result(&args, &result);
    if log_pattern_seen {
        eprintln!(
            "[executor] observed {label} log output, but runtime state did not reach running"
        );
    }
    let runtime = read_runtime_state().await?;
    if let Some(snapshot) = runtime.as_ref().and_then(|runtime| runtime.instances.get(name)) {
        if let Some(failure) = runtime_state_failure(name, label, snapshot) {
            return Err(fail(failure));
        }
    }
    Err(fail(format!("timed out waiting for {label} on {name}")))
}

fn regex_port_conflict() -> impl Fn(&str) -> bool {
    |stdout: &str| {
        let lower = stdout.to_ascii_lowercase();
        lower.contains("port ") && lower.contains("is already in use")
    }
}

fn address_matches_port(address: &str, port: &str) -> bool {
    address.ends_with(&format!(":{port}"))
}

async fn wait_for_instance_ready(
    name: &str,
    pattern: &str,
    since: &str,
    label: &str,
    cmd: &str,
    dir: &str,
    port: &str,
    timeout_seconds: u64,
) -> Result<(), CliError> {
    let args = vec![
        "/usr/bin/journalctl".into(),
        "--user".into(),
        "-t".into(),
        format!("executor/{name}"),
        "--since".into(),
        since.into(),
        "--output=cat".into(),
        "--no-pager".into(),
    ];
    let started_at = Instant::now();
    let deadline = Instant::now() + Duration::from_secs(timeout_seconds);
    let mut port_ready_at: Option<Instant> = None;
    let mut conflict_handled = false;
    let pm = ProcessManager::new(BTreeMap::new(), ProcessManagerOptions::default());
    while Instant::now() < deadline {
        let runtime = read_runtime_state().await?;
        let snapshot = runtime.as_ref().and_then(|runtime| runtime.instances.get(name));
        if let Some(snapshot) = snapshot {
            if let Some(failure) = runtime_state_failure(name, label, snapshot) {
                return Err(fail(failure));
            }
        }
        let runtime_running = snapshot.is_some_and(|snapshot| {
            snapshot.state == ManagedProcessState::Running && process_alive(snapshot.pid)
        });
        let result = run_text(&args, RunOptions::default());
        if runtime_running && result.stdout.contains(pattern) {
            return Ok(());
        }
        if !conflict_handled && regex_port_conflict()(&result.stdout) {
            conflict_handled = true;
            eprintln!("[executor] port {port} is occupied; refusing to kill an external process");
        }
        if runtime_running {
            let addresses = pm.listening_addresses(name, cmd).await.unwrap_or_default();
            if addresses
                .iter()
                .any(|address| address_matches_port(address, port))
            {
                let ready_at = *port_ready_at.get_or_insert_with(Instant::now);
                if ready_at.elapsed() >= Duration::from_secs(5) {
                    print_vite_ready_fallback(dir, name, port, started_at.elapsed().as_millis() as u64);
                    return Ok(());
                }
            }
        }
        sleep_ms(if port_ready_at.is_some() { 500 } else { 1_000 });
    }
    let result = run_text(&args, RunOptions::default());
    print_readiness_result(&args, &result);
    let runtime = read_runtime_state().await?;
    if let Some(snapshot) = runtime.as_ref().and_then(|runtime| runtime.instances.get(name)) {
        if let Some(failure) = runtime_state_failure(name, label, snapshot) {
            return Err(fail(failure));
        }
    }
    Err(fail(format!("timed out waiting for {label} on {name}")))
}

pub async fn change_and_wait(
    name: &str,
    cmd: &str,
    dir: &str,
    pattern: &str,
    label: &str,
    ready_pattern: Option<&str>,
    ready_port: Option<&str>,
) -> Result<(), CliError> {
    let since = format_since();
    let before_state = read_runtime_state().await.ok().flatten();
    let before = before_state
        .as_ref()
        .and_then(|runtime| runtime.instances.get(name))
        .cloned();
    reload_executor_service()?;
    verify_executor_service_active()?;
    wait_for_log_pattern(
        name,
        pattern,
        &since,
        label,
        15,
        ready_port,
        before.as_ref(),
        label == "reload",
    )
    .await?;
    if let (Some(ready_pattern), Some(ready_port)) = (ready_pattern, ready_port) {
        wait_for_instance_ready(
            name,
            ready_pattern,
            &since,
            &format!("{label} ready"),
            cmd,
            dir,
            ready_port,
            15,
        )
        .await?;
    } else if let Some(ready_pattern) = ready_pattern {
        wait_for_log_pattern(
            name,
            ready_pattern,
            &since,
            &format!("{label} ready"),
            15,
            None,
            None,
            false,
        )
        .await?;
    }
    show_executor_service_logs(Some(&since));
    show_instance_logs(name, Some(&since));
    Ok(())
}

pub async fn stop_and_verify(name: &str) -> Result<(), CliError> {
    let since = format_since();
    let before_state = read_runtime_state().await.ok().flatten();
    let before = before_state
        .as_ref()
        .and_then(|runtime| runtime.instances.get(name))
        .cloned();
    let initial_pid = before.as_ref().map(|snapshot| snapshot.pid).unwrap_or(0);
    reload_executor_service()?;
    verify_executor_service_active()?;
    show_executor_service_logs(Some(&since));
    let args = vec![
        "/usr/bin/journalctl".into(),
        "--user".into(),
        "-t".into(),
        format!("executor/{name}"),
        "--since".into(),
        since.clone(),
        "--output=cat".into(),
        "--no-pager".into(),
    ];
    let deadline = Instant::now() + Duration::from_secs(5);
    while Instant::now() < deadline {
        let runtime = read_runtime_state().await?;
        let snapshot = runtime.as_ref().and_then(|runtime| runtime.instances.get(name));
        if let Some(snapshot) = snapshot {
            if snapshot.state == ManagedProcessState::Running {
                let restarted = before.as_ref().is_none_or(|before| {
                    before.state != ManagedProcessState::Running
                        || snapshot.pid != before.pid
                        || snapshot.started_at != before.started_at
                });
                if restarted {
                    let result = run_text(&args, RunOptions::default());
                    print_readiness_result(&args, &result);
                    return Err(fail(format!(
                        "instance restarted after stop request: {name}"
                    )));
                }
            }
        }
        if runtime_stop_complete(runtime.is_some(), snapshot, initial_pid) {
            show_instance_logs(name, Some(&since));
            return Ok(());
        }
        let result = run_text(&args, RunOptions::default());
        if result.stdout.contains("[executor] starting ") {
            print_readiness_result(&args, &result);
            return Err(fail(format!(
                "instance restarted after stop request: {name}"
            )));
        }
        sleep_ms(1_000);
    }
    let result = run_text(&args, RunOptions::default());
    print_readiness_result(&args, &result);
    let runtime = read_runtime_state().await?;
    let snapshot = runtime.as_ref().and_then(|runtime| runtime.instances.get(name));
    let detail = snapshot
        .map(|snapshot| {
            let error = snapshot
                .last_error
                .as_deref()
                .map(|error| format!(", {error}"))
                .unwrap_or_default();
            format!(" (runtime state: {:?}{error})", snapshot.state)
        })
        .unwrap_or_default();
    show_instance_logs(name, Some(&since));
    Err(fail(format!(
        "timed out waiting for instance to stop: {name}{detail}"
    )))
}
