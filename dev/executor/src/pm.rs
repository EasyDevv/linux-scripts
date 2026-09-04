use crate::cli::{fail, CliError};
use crate::config::NormalizedInstance;
use crate::paths::state_dir;
use crate::runner::{
    extract_port, fingerprint, journal_log, now_ms, run_text_timed, RunOptions, RunResult,
};
use nix::sys::signal::{kill, Signal};
use nix::unistd::Pid;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::{Mutex as AsyncMutex, Notify};

const DEFAULT_BACKOFF: [u64; 6] = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000];
const DEFAULT_BACKOFF_JITTER: f64 = 0.2;
const DEFAULT_NORMAL_RUNTIME_MS: u64 = 60_000;
const DEFAULT_TERMINATION_GRACE_MS: u64 = 5_000;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ManagedProcessState {
    Stopped,
    Starting,
    Running,
    Stopping,
    Backoff,
    Blocked,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedProcessExit {
    pub exit_code: Option<i32>,
    pub signal_code: Option<String>,
    pub at: i64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedProcessSnapshot {
    pub name: String,
    pub state: ManagedProcessState,
    pub pid: u32,
    pub started_at: Option<i64>,
    pub restart_attempts: u32,
    pub next_retry_at: Option<i64>,
    pub last_exit: Option<ManagedProcessExit>,
    pub last_error: Option<String>,
}

#[derive(Clone)]
pub struct ProcessManagerOptions {
    pub systemd_cat_path: PathBuf,
    pub lsof_path: PathBuf,
    pub ps_path: PathBuf,
    pub backoff_delays_ms: Vec<u64>,
    pub backoff_jitter: f64,
    pub normal_runtime_ms: u64,
    pub termination_grace_ms: u64,
    pub on_state_change: Option<Arc<dyn Fn() + Send + Sync>>,
}

impl Default for ProcessManagerOptions {
    fn default() -> Self {
        Self {
            systemd_cat_path: PathBuf::from("/usr/bin/systemd-cat"),
            lsof_path: PathBuf::from("/usr/bin/lsof"),
            ps_path: PathBuf::from("/bin/ps"),
            backoff_delays_ms: DEFAULT_BACKOFF.to_vec(),
            backoff_jitter: DEFAULT_BACKOFF_JITTER,
            normal_runtime_ms: DEFAULT_NORMAL_RUNTIME_MS,
            termination_grace_ms: DEFAULT_TERMINATION_GRACE_MS,
            on_state_change: None,
        }
    }
}

pub struct ProcessManager {
    env: BTreeMap<String, String>,
    options: ProcessManagerOptions,
}

impl ProcessManager {
    pub fn new(env: BTreeMap<String, String>, options: ProcessManagerOptions) -> Self {
        Self { env, options }
    }

    pub fn start(&self, instance: &NormalizedInstance) -> Arc<ManagedProcess> {
        ManagedProcess::spawn(instance.clone(), self.env.clone(), self.options.clone())
    }

    pub async fn clear_state(&self) -> Result<(), CliError> {
        let dir = state_dir();
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).map_err(|e| fail(e.to_string()))?;
        Ok(())
    }

    pub async fn is_active(&self, name: &str, cmd: &str) -> Result<bool, CliError> {
        Ok(!self.instance_runtime_pids(name, cmd).await?.is_empty())
    }

    pub async fn instance_runtime_pids(
        &self,
        name: &str,
        cmd: &str,
    ) -> Result<Vec<u32>, CliError> {
        if let Some(pid) = read_instance_pid(name) {
            if stored_process_matches(name, cmd, pid) {
                return Ok(collect_descendant_pids(pid, &self.options.ps_path));
            }
        }
        Ok(user_processes(&self.options.ps_path)
            .into_iter()
            .filter(|p| p.args.contains(cmd))
            .map(|p| p.pid)
            .collect())
    }

    pub async fn listening_addresses(
        &self,
        name: &str,
        cmd: &str,
    ) -> Result<Vec<String>, CliError> {
        let pids = self.instance_runtime_pids(name, cmd).await?;
        if pids.is_empty() {
            return Ok(vec![]);
        }
        let pid_list = pids
            .iter()
            .map(ToString::to_string)
            .collect::<Vec<_>>()
            .join(",");
        let args = vec![
            self.options.lsof_path.display().to_string(),
            "-Pan".into(),
            "-p".into(),
            pid_list,
            "-iTCP".into(),
            "-sTCP:LISTEN".into(),
            "-Fn".into(),
        ];
        let result = run_text_timed(&args, RunOptions::default());
        Ok(result
            .stdout
            .lines()
            .filter_map(|line| line.strip_prefix('n').map(str::to_string))
            .collect())
    }

    pub async fn runtime_port(&self, name: &str, cmd: &str) -> Result<String, CliError> {
        for address in self.listening_addresses(name, cmd).await? {
            if let Some((_, port)) = address.rsplit_once(':') {
                if port.chars().all(|c| c.is_ascii_digit()) {
                    return Ok(port.to_string());
                }
            }
        }
        Ok(String::new())
    }

    pub fn logged_port(&self, name: &str) -> String {
        let args = vec![
            "/usr/bin/journalctl".into(),
            "--user".into(),
            "-t".into(),
            format!("executor/{name}"),
            "-n".into(),
            "20".into(),
            "--output=cat".into(),
            "--no-pager".into(),
        ];
        let result = run_text_timed(&args, RunOptions::default());
        for line in result.stdout.lines() {
            if let Some(idx) = line.find("localhost:") {
                let rest = &line[idx + "localhost:".len()..];
                let port: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
                if !port.is_empty() {
                    return port;
                }
            }
        }
        String::new()
    }
}

struct Inner {
    snapshot: ManagedProcessSnapshot,
    current_pid: Option<u32>,
    stop: bool,
    restart: bool,
    notify: Arc<Notify>,
}

pub struct ManagedProcess {
    inner: Arc<Mutex<Inner>>,
    ops: AsyncMutex<()>,
    notify: Arc<Notify>,
}

impl ManagedProcess {
    fn spawn(
        instance: NormalizedInstance,
        env: BTreeMap<String, String>,
        options: ProcessManagerOptions,
    ) -> Arc<Self> {
        let notify = Arc::new(Notify::new());
        let inner = Arc::new(Mutex::new(Inner {
            snapshot: ManagedProcessSnapshot {
                name: instance.name.clone(),
                state: ManagedProcessState::Starting,
                pid: 0,
                started_at: None,
                restart_attempts: 0,
                next_retry_at: None,
                last_exit: None,
                last_error: None,
            },
            current_pid: None,
            stop: false,
            restart: false,
            notify: notify.clone(),
        }));
        let process = Arc::new(Self {
            inner: inner.clone(),
            ops: AsyncMutex::new(()),
            notify: notify.clone(),
        });
        tokio::spawn(run_loop(instance, env, options, inner, notify));
        process
    }

    pub fn snapshot(&self) -> ManagedProcessSnapshot {
        self.inner.lock().unwrap().snapshot.clone()
    }

    pub fn state(&self) -> ManagedProcessState {
        self.inner.lock().unwrap().snapshot.state
    }

    pub fn pid(&self) -> u32 {
        self.inner.lock().unwrap().snapshot.pid
    }

    pub fn running(&self) -> bool {
        self.state() == ManagedProcessState::Running
    }

    pub async fn restart(&self) -> Result<(), CliError> {
        let _guard = self.ops.lock().await;
        {
            let mut inner = self.inner.lock().unwrap();
            if matches!(
                inner.snapshot.state,
                ManagedProcessState::Blocked | ManagedProcessState::Stopped
            ) {
                return Ok(());
            }
            inner.restart = true;
            inner.notify.notify_waiters();
            if let Some(pid) = inner.current_pid {
                terminate_tree(pid, 5_000, Path::new("/bin/ps"));
            }
        }
        self.notify.notify_waiters();
        for _ in 0..400 {
            if self.state() == ManagedProcessState::Running && self.pid() > 0 {
                return Ok(());
            }
            if matches!(
                self.state(),
                ManagedProcessState::Blocked | ManagedProcessState::Stopped
            ) {
                break;
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
        Ok(())
    }

    pub async fn stop(&self) -> Result<(), CliError> {
        let _guard = self.ops.lock().await;
        {
            let mut inner = self.inner.lock().unwrap();
            inner.stop = true;
            inner.snapshot.state = ManagedProcessState::Stopping;
            inner.notify.notify_waiters();
            if let Some(pid) = inner.current_pid {
                terminate_tree(pid, 5_000, Path::new("/bin/ps"));
            }
        }
        self.notify.notify_waiters();
        for _ in 0..200 {
            if self.state() == ManagedProcessState::Stopped
                || self.state() == ManagedProcessState::Blocked
            {
                break;
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
        {
            let mut inner = self.inner.lock().unwrap();
            inner.snapshot.state = ManagedProcessState::Stopped;
            inner.snapshot.pid = 0;
        }
        Ok(())
    }
}

async fn run_loop(
    instance: NormalizedInstance,
    env: BTreeMap<String, String>,
    options: ProcessManagerOptions,
    inner: Arc<Mutex<Inner>>,
    notify: Arc<Notify>,
) {
    let tag = format!("executor/{}", instance.name);
    let mut failure_attempts: u32 = 0;
    loop {
        if inner.lock().unwrap().stop {
            break;
        }
        set_state(&inner, &options, ManagedProcessState::Starting);
        journal_log(
            &tag,
            &format!("[executor] starting {}\n", instance.cmd),
            &options.systemd_cat_path.display().to_string(),
        );
        if inner.lock().unwrap().stop {
            break;
        }
        if let Some(issue) = preflight(&instance, &options) {
            set_error(&inner, &options, &issue);
            if issue.contains("already in use by an external process") {
                failure_attempts += 1;
                set_backoff(&inner, &options, failure_attempts);
                wait_backoff(&inner, &notify, &options, failure_attempts).await;
                continue;
            }
            set_state(&inner, &options, ManagedProcessState::Blocked);
            break;
        }
        let child = match spawn_instance(&instance, &env, &options, &tag) {
            Ok(child) => child,
            Err(error) => {
                let permanent = error.contains("No such file") || error.contains("Permission denied");
                set_error(&inner, &options, &error);
                if permanent {
                    set_state(&inner, &options, ManagedProcessState::Blocked);
                    break;
                }
                failure_attempts += 1;
                wait_backoff(&inner, &notify, &options, failure_attempts).await;
                continue;
            }
        };
        let pid = child.id();
        {
            let mut guard = inner.lock().unwrap();
            guard.current_pid = Some(pid);
            guard.snapshot.pid = pid;
            guard.snapshot.started_at = Some(now_ms());
            guard.snapshot.last_error = None;
            guard.snapshot.state = ManagedProcessState::Running;
        }
        notify_change(&options);
        let _ = write_instance_pid(&instance.name, pid);
        let _ = write_instance_identity(&instance.name, pid, &instance.cmd);
        let started = now_ms();
        let status = tokio::task::spawn_blocking(move || child.wait_with_output()).await;
        remove_instance_state(&instance.name);
        {
            let mut guard = inner.lock().unwrap();
            guard.current_pid = None;
            guard.snapshot.pid = 0;
            guard.snapshot.started_at = None;
            if let Ok(Ok(output)) = &status {
                guard.snapshot.last_exit = Some(ManagedProcessExit {
                    exit_code: output.status.code(),
                    signal_code: None,
                    at: now_ms(),
                });
                if output.status.code() == Some(127) {
                    guard.snapshot.last_error =
                        Some("managed command could not be found (exit code 127)".into());
                    guard.snapshot.state = ManagedProcessState::Blocked;
                    notify_change(&options);
                    break;
                }
            }
        }
        if inner.lock().unwrap().stop {
            break;
        }
        if inner.lock().unwrap().restart {
            inner.lock().unwrap().restart = false;
            failure_attempts = 0;
            continue;
        }
        let runtime = (now_ms() - started) as u64;
        if runtime >= options.normal_runtime_ms {
            failure_attempts = 0;
        }
        failure_attempts = failure_attempts.saturating_add(1);
        set_backoff(&inner, &options, failure_attempts);
        wait_backoff(&inner, &notify, &options, failure_attempts).await;
    }
    let mut guard = inner.lock().unwrap();
    if guard.snapshot.state != ManagedProcessState::Blocked {
        guard.snapshot.state = ManagedProcessState::Stopped;
    }
    guard.snapshot.pid = 0;
    notify_change(&options);
}

fn notify_change(options: &ProcessManagerOptions) {
    if let Some(cb) = &options.on_state_change {
        cb();
    }
}

fn set_state(inner: &Arc<Mutex<Inner>>, options: &ProcessManagerOptions, state: ManagedProcessState) {
    inner.lock().unwrap().snapshot.state = state;
    notify_change(options);
}

fn set_error(inner: &Arc<Mutex<Inner>>, options: &ProcessManagerOptions, error: &str) {
    inner.lock().unwrap().snapshot.last_error = Some(short_error(error));
    notify_change(options);
}

fn set_backoff(inner: &Arc<Mutex<Inner>>, options: &ProcessManagerOptions, attempts: u32) {
    let mut guard = inner.lock().unwrap();
    guard.snapshot.restart_attempts = attempts;
    guard.snapshot.state = ManagedProcessState::Backoff;
    let delay = retry_delay(&options.backoff_delays_ms, options.backoff_jitter, attempts);
    guard.snapshot.next_retry_at = Some(now_ms() + delay as i64);
    notify_change(options);
}

async fn wait_backoff(
    inner: &Arc<Mutex<Inner>>,
    notify: &Arc<Notify>,
    options: &ProcessManagerOptions,
    attempts: u32,
) {
    let delay = retry_delay(&options.backoff_delays_ms, options.backoff_jitter, attempts);
    tokio::select! {
        _ = tokio::time::sleep(Duration::from_millis(delay)) => {}
        _ = notify.notified() => {}
    }
    inner.lock().unwrap().snapshot.next_retry_at = None;
}

fn retry_delay(delays: &[u64], jitter: f64, attempt: u32) -> u64 {
    let idx = (attempt.saturating_sub(1) as usize).min(delays.len().saturating_sub(1));
    let base = delays.get(idx).copied().unwrap_or(30_000);
    if jitter == 0.0 {
        return base.max(1);
    }
    let rand = (now_ms() % 1000) as f64 / 1000.0;
    let factor = 1.0 + (rand * 2.0 - 1.0) * jitter;
    ((base as f64) * factor).round().max(1.0) as u64
}

fn short_error(error: &str) -> String {
    error.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(300).collect()
}

fn executable_exists(path: &Path) -> bool {
    path.exists()
}

fn is_directory(path: &str) -> bool {
    Path::new(path).is_dir()
}

fn preflight(instance: &NormalizedInstance, options: &ProcessManagerOptions) -> Option<String> {
    if !is_directory(&instance.dir) {
        return Some("working directory is unavailable".into());
    }
    if !executable_exists(Path::new("/bin/sh")) {
        return Some("shell executable /bin/sh is unavailable".into());
    }
    port_has_foreign_occupant(instance, options)
}

fn port_has_foreign_occupant(
    instance: &NormalizedInstance,
    options: &ProcessManagerOptions,
) -> Option<String> {
    let port = extract_port(&instance.cmd);
    if port.is_empty() {
        return None;
    }
    let args = vec![
        options.lsof_path.display().to_string(),
        "-nP".into(),
        format!("-tiTCP:{port}"),
        "-sTCP:LISTEN".into(),
    ];
    let result = run_text_timed(&args, RunOptions::default());
    if let Some(failure) = control_helper_failure("lsof", &result, true) {
        return Some(format!("port {port} inspection failed: {failure}"));
    }
    let pids = parse_pid_output(&result.stdout);
    if pids.is_empty() {
        return None;
    }
    if let Some(stored) = read_instance_pid(&instance.name) {
        if stored_process_matches(&instance.name, &instance.cmd, stored) {
            let tree: HashSet<u32> = collect_descendant_pids(stored, &options.ps_path)
                .into_iter()
                .collect();
            if pids.iter().all(|pid| tree.contains(pid)) {
                terminate_tree(stored, options.termination_grace_ms, &options.ps_path);
                remove_instance_state(&instance.name);
                return None;
            }
        }
    }
    Some(format!("port {port} is already in use by an external process"))
}

fn control_helper_failure(helper: &str, result: &RunResult, allow_empty: bool) -> Option<String> {
    if result.ok {
        return None;
    }
    if allow_empty
        && result.exit_code == Some(1)
        && result.spawn_error.is_none()
        && !result.timed_out
        && !result.output_overflow
        && result.stdout.trim().is_empty()
        && result.stderr.trim().is_empty()
    {
        return None;
    }
    let detail = if let Some(error) = &result.spawn_error {
        error.clone()
    } else if result.timed_out {
        "timed out".into()
    } else if result.output_overflow {
        "output exceeded the limit".into()
    } else {
        let mut text = match result.exit_code {
            None => "ended without an exit code".into(),
            Some(code) => format!("exited with code {code}"),
        };
        if let Some(signal) = &result.signal_code {
            text.push_str(&format!(" (signal {signal})"));
        }
        if !result.stderr.trim().is_empty() {
            text.push_str(": ");
            text.push_str(&short_error(&result.stderr));
        }
        text
    };
    Some(format!("{helper} helper failed: {detail}"))
}

fn parse_pid_output(output: &str) -> Vec<u32> {
    output
        .lines()
        .filter_map(|line| line.trim().parse().ok())
        .collect()
}

fn logger_usable(path: &Path, tag: &str) -> bool {
    if !executable_exists(path) {
        return false;
    }
    let args = vec![
        path.display().to_string(),
        "-t".into(),
        tag.into(),
        "/bin/true".into(),
    ];
    let result = run_text_timed(&args, RunOptions::default());
    control_helper_failure("systemd-cat", &result, false).is_none()
}

fn spawn_instance(
    instance: &NormalizedInstance,
    env: &BTreeMap<String, String>,
    options: &ProcessManagerOptions,
    tag: &str,
) -> Result<std::process::Child, String> {
    let journaled = logger_usable(&options.systemd_cat_path, tag);
    let mut args = command_args(instance, options, journaled, tag);
    let mut cmd = Command::new(&args[0]);
    cmd.args(&args[1..]);
    cmd.current_dir(&instance.dir);
    cmd.stdin(Stdio::null());
    if journaled {
        cmd.stdout(Stdio::null());
        cmd.stderr(Stdio::null());
    } else {
        cmd.stdout(Stdio::inherit());
        cmd.stderr(Stdio::inherit());
    }
    for (k, v) in env {
        cmd.env(k, v);
    }
    for (k, v) in &instance.env {
        cmd.env(k, v);
    }
    cmd.env("DIR", &instance.dir);
    cmd.env("CMD", &instance.cmd);
    cmd.env("EXECUTOR_NAME", &instance.name);
    cmd.env("EXECUTOR_TAG", tag);
    match cmd.spawn() {
        Ok(child) => Ok(child),
        Err(error) if journaled => {
            args = command_args(instance, options, false, tag);
            let mut fallback = Command::new(&args[0]);
            fallback.args(&args[1..]);
            fallback.current_dir(&instance.dir);
            fallback.stdin(Stdio::null());
            fallback.stdout(Stdio::inherit());
            fallback.stderr(Stdio::inherit());
            for (k, v) in env {
                fallback.env(k, v);
            }
            fallback.env("DIR", &instance.dir);
            fallback.env("CMD", &instance.cmd);
            fallback.env("EXECUTOR_NAME", &instance.name);
            fallback.env("EXECUTOR_TAG", tag);
            fallback.spawn().map_err(|e| e.to_string())
        }
        Err(error) => Err(error.to_string()),
    }
}

fn command_args(
    instance: &NormalizedInstance,
    options: &ProcessManagerOptions,
    journaled: bool,
    tag: &str,
) -> Vec<String> {
    let mut args = vec!["/bin/sh".into(), "-lc".into(), instance.cmd.clone()];
    if executable_exists(Path::new("/usr/bin/setsid")) {
        let mut prefixed = vec!["/usr/bin/setsid".into()];
        prefixed.extend(args);
        args = prefixed;
    }
    if executable_exists(Path::new("/usr/bin/stdbuf")) {
        let mut prefixed = vec![
            "/usr/bin/stdbuf".into(),
            "-oL".into(),
            "-eL".into(),
        ];
        prefixed.extend(args);
        args = prefixed;
    }
    if journaled {
        let mut prefixed = vec![
            options.systemd_cat_path.display().to_string(),
            "-t".into(),
            tag.into(),
        ];
        prefixed.extend(args);
        args = prefixed;
    }
    args
}

fn instance_pid_file(name: &str) -> PathBuf {
    state_dir().join(format!("{name}.pid"))
}

fn instance_identity_file(name: &str) -> PathBuf {
    state_dir().join(format!("{name}.identity.json"))
}

fn write_instance_pid(name: &str, pid: u32) -> Result<(), CliError> {
    fs::create_dir_all(state_dir()).ok();
    fs::write(instance_pid_file(name), format!("{pid}\n")).map_err(|e| fail(e.to_string()))
}

fn write_instance_identity(name: &str, pid: u32, cmd: &str) -> Result<(), CliError> {
    fs::create_dir_all(state_dir()).ok();
    let start_time = read_proc_start_time(pid);
    let body = serde_json::json!({
        "version": 1,
        "pid": pid,
        "startTime": start_time,
        "commandFingerprint": fingerprint(cmd),
    });
    fs::write(instance_identity_file(name), format!("{body}\n")).map_err(|e| fail(e.to_string()))
}

fn read_instance_pid(name: &str) -> Option<u32> {
    fs::read_to_string(instance_pid_file(name))
        .ok()?
        .trim()
        .parse()
        .ok()
}

fn remove_instance_state(name: &str) {
    let _ = fs::remove_file(instance_pid_file(name));
    let _ = fs::remove_file(instance_identity_file(name));
}

fn read_proc_start_time(pid: u32) -> Option<String> {
    let text = fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
    let close = text.rfind(')')?;
    let fields: Vec<&str> = text[close + 1..].split_whitespace().collect();
    fields.get(19).map(|s| s.to_string())
}

fn stored_process_matches(name: &str, cmd: &str, pid: u32) -> bool {
    if !process_exists(pid) {
        return false;
    }
    let text = match fs::read_to_string(instance_identity_file(name)) {
        Ok(text) => text,
        Err(_) => return false,
    };
    let value: serde_json::Value = match serde_json::from_str(&text) {
        Ok(v) => v,
        Err(_) => return false,
    };
    if value.get("version").and_then(|v| v.as_u64()) != Some(1) {
        return false;
    }
    if value.get("pid").and_then(|v| v.as_u64()) != Some(pid as u64) {
        return false;
    }
    let start = value.get("startTime").and_then(|v| v.as_str());
    let stored_fp = value
        .get("commandFingerprint")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if let (Some(stored), Some(actual)) = (start, read_proc_start_time(pid).as_deref()) {
        return stored == actual;
    }
    stored_fp == fingerprint(cmd)
}

fn process_exists(pid: u32) -> bool {
    kill(Pid::from_raw(pid as i32), None).is_ok()
}

struct UserProcess {
    pid: u32,
    args: String,
}

fn user_processes(ps_path: &Path) -> Vec<UserProcess> {
    let uid = unsafe { libc::getuid() }.to_string();
    let args = vec![
        ps_path.display().to_string(),
        "-u".into(),
        uid,
        "-o".into(),
        "pid=,args=".into(),
    ];
    let result = run_text_timed(&args, RunOptions::default());
    result
        .stdout
        .lines()
        .filter_map(|line| {
            let line = line.trim();
            let (pid, rest) = line.split_once(char::is_whitespace)?;
            Some(UserProcess {
                pid: pid.parse().ok()?,
                args: rest.trim().into(),
            })
        })
        .collect()
}

fn child_pids_from_proc(parent: u32) -> Option<Vec<u32>> {
    let text = fs::read_to_string(format!("/proc/{parent}/task/{parent}/children")).ok()?;
    Some(
        text.split_whitespace()
            .filter_map(|s| s.parse().ok())
            .collect(),
    )
}

fn uses_procfs(ps_path: &Path) -> bool {
    ps_path == Path::new("/bin/ps") || ps_path == Path::new("/usr/bin/ps")
}

fn child_pids(parent: u32, ps_path: &Path) -> Vec<u32> {
    if !process_exists(parent) {
        return vec![];
    }
    if uses_procfs(ps_path) {
        if let Some(from_proc) = child_pids_from_proc(parent) {
            return from_proc;
        }
    }
    let args = vec![
        ps_path.display().to_string(),
        "-o".into(),
        "pid=".into(),
        "--ppid".into(),
        parent.to_string(),
    ];
    parse_pid_output(&run_text_timed(&args, RunOptions::default()).stdout)
}

fn collect_descendant_pids(root: u32, ps_path: &Path) -> Vec<u32> {
    let mut queue = vec![root];
    let mut seen = HashSet::new();
    let mut output = Vec::new();
    while let Some(current) = queue.pop() {
        if !seen.insert(current) {
            continue;
        }
        output.push(current);
        queue.extend(child_pids(current, ps_path));
    }
    output
}

fn terminate_tree(root: u32, grace_ms: u64, ps_path: &Path) {
    let mut pids = collect_descendant_pids(root, ps_path);
    pids.reverse();
    for pid in &pids {
        let _ = kill(Pid::from_raw(*pid as i32), Signal::SIGTERM);
    }
    let deadline = std::time::Instant::now() + Duration::from_millis(grace_ms);
    while std::time::Instant::now() < deadline {
        if pids.iter().all(|pid| !process_exists(*pid)) {
            return;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    for pid in &pids {
        let _ = kill(Pid::from_raw(*pid as i32), Signal::SIGKILL);
    }
}
