use crate::config::{
    ensure_config_file, read_config, write_config, write_restart_token, NormalizedConfig,
};
use crate::journal::{show_recent_logs, SERVICE_NAME};
use crate::paths::config_file;
use crate::pm::{ProcessManager, ProcessManagerOptions};
use crate::proxy::local_url;
use crate::readiness::{change_and_wait, read_runtime_state, stop_and_verify};
use crate::runner::{print_command, run_inherit};
use crate::supervisor::run_supervisor;
use crate::vite::{is_vite_command, vite_ready_pattern};
use crate::ManagedProcessState;
use std::collections::BTreeMap;
use std::fmt::{Display, Formatter};

#[derive(Debug)]
pub struct CliError {
    pub message: String,
    pub exit_code: i32,
}

impl CliError {
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            exit_code: 1,
        }
    }
}

impl Display for CliError {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
}

impl std::error::Error for CliError {}

pub fn fail(message: impl Into<String>) -> CliError {
    CliError::new(message)
}

pub fn usage() -> String {
    "Usage:
  executor run
  executor list
  executor log <name> [--web|--api|--all] [journalctl args...]
  executor status [<name>]
  executor start <name>
  executor stop <name>
  executor reload <name>
  executor service <start|stop|restart|reload|status>"
        .to_string()
}

fn process_env() -> BTreeMap<String, String> {
    std::env::vars().collect()
}

async fn current_config(required: bool) -> Result<NormalizedConfig, CliError> {
    match read_config(required).await? {
        Some(config) => Ok(config),
        None => Err(fail(format!(
            "Missing config file: {}",
            config_file().display()
        ))),
    }
}

fn pad(value: &str, width: usize) -> String {
    if value.len() >= width {
        value.to_string()
    } else {
        format!("{value:<width$}")
    }
}

async fn get_port_for_display(
    config: &NormalizedConfig,
    name: &str,
    pm: &ProcessManager,
) -> String {
    let cmd = config
        .instances
        .get(name)
        .map(|i| i.cmd.as_str())
        .unwrap_or("");
    let port = config.get_port(name);
    if !port.is_empty() {
        return port;
    }
    if let Ok(port) = pm.runtime_port(name, cmd).await {
        if !port.is_empty() {
            return port;
        }
    }
    pm.logged_port(name)
}

async fn print_port_suffix(
    config: &NormalizedConfig,
    name: &str,
    pm: &ProcessManager,
) {
    let port = get_port_for_display(config, name, pm).await;
    if !port.is_empty() {
        println!("▶ {}", local_url(name));
    }
}

async fn auto_instance_name(config: &NormalizedConfig) -> Result<String, CliError> {
    match config.instance_matching_cwd() {
        Some(name) => {
            eprintln!("[executor] auto-detected instance: {name}");
            Ok(name)
        }
        None => {
            println!("{}", usage());
            Err(CliError {
                message: String::new(),
                exit_code: 1,
            })
        }
    }
}

async fn resolved_instance_name(
    config: &NormalizedConfig,
    name_arg: Option<&str>,
) -> Result<String, CliError> {
    let name = match name_arg {
        Some(name) => name.to_string(),
        None => auto_instance_name(config).await?,
    };
    config.get_instance(&name)?;
    Ok(name)
}

async fn runtime_status(
    config: &NormalizedConfig,
    name: &str,
    runtime: Option<&crate::state::RuntimeStateFile>,
    pm: &ProcessManager,
) -> String {
    if !config.is_enabled(name) {
        return "stopped".into();
    }
    if let Some(runtime) = runtime {
        if let Some(snapshot) = runtime.instances.get(name) {
            return format_state(snapshot.state).to_string();
        }
    }
    let cmd = config.get_instance(name).map(|i| i.cmd.clone()).unwrap_or_default();
    if pm.is_active(name, &cmd).await.unwrap_or(false) {
        "active".into()
    } else {
        "inactive".into()
    }
}

fn format_state(state: ManagedProcessState) -> &'static str {
    match state {
        ManagedProcessState::Stopped => "stopped",
        ManagedProcessState::Starting => "starting",
        ManagedProcessState::Running => "running",
        ManagedProcessState::Stopping => "stopping",
        ManagedProcessState::Backoff => "backoff",
        ManagedProcessState::Blocked => "blocked",
    }
}

pub async fn run_command(command: Option<&str>, args: Vec<String>) -> Result<(), CliError> {
    let pm = ProcessManager::new(process_env(), ProcessManagerOptions::default());
    match command {
        Some("run") => {
            ensure_config_file().await?;
            let port = std::env::var("EXECUTOR_PROXY_PORT")
                .ok()
                .and_then(|value| value.parse().ok())
                .unwrap_or(80);
            run_supervisor(port).await
        }
        Some("list") => {
            let config = current_config(true).await?;
            for (name, instance) in &config.instances {
                let state = if config.is_enabled(name) {
                    "managed"
                } else {
                    "stopped"
                };
                let cmd = if instance.cmd.is_empty() {
                    "-"
                } else {
                    instance.cmd.as_str()
                };
                println!("{name}\t{state}\t{}\t{cmd}", instance.dir);
            }
            Ok(())
        }
        Some("log") | Some("logs") | Some("show-recent-logs") => {
            command_log(&args, command == Some("show-recent-logs"), &pm).await
        }
        Some("status") => command_status(args.first().map(String::as_str), &pm).await,
        Some("start") => command_start(args.first().map(String::as_str), &pm).await,
        Some("stop") => command_stop(args.first().map(String::as_str), &pm).await,
        Some("reload") => command_reload(args.first().map(String::as_str), &pm).await,
        Some("service") => command_service(args.first().map(String::as_str)).await,
        _ => {
            println!("{}", usage());
            Err(CliError {
                message: String::new(),
                exit_code: 1,
            })
        }
    }
}

async fn command_log(
    args: &[String],
    recent_only: bool,
    pm: &ProcessManager,
) -> Result<(), CliError> {
    let config = current_config(true).await?;
    let mut name_arg: Option<String> = None;
    let mut target = "base";
    let mut journal_args: Vec<String> = Vec::new();
    let mut i = 0;
    while i < args.len() {
        let arg = &args[i];
        if arg == "--web" {
            target = "web";
        } else if arg == "--api" {
            target = "api";
        } else if arg == "--all" {
            target = "all";
        } else if name_arg.is_none() && !arg.starts_with('-') {
            name_arg = Some(arg.clone());
        } else {
            journal_args.push(arg.clone());
            if matches!(arg.as_str(), "-n" | "--lines" | "--since") && i + 1 < args.len() {
                i += 1;
                journal_args.push(args[i].clone());
            }
        }
        i += 1;
    }
    let name = resolved_instance_name(&config, name_arg.as_deref()).await?;
    print_port_suffix(&config, &name, pm).await;
    let tags: Vec<String> = match target {
        "web" => vec![format!("executor/{name}/web")],
        "api" => vec![format!("executor/{name}/api")],
        "all" => vec![
            format!("executor/{name}"),
            format!("executor/{name}/web"),
            format!("executor/{name}/api"),
        ],
        _ => vec![format!("executor/{name}")],
    };
    let mut command = vec![
        "/usr/bin/journalctl".into(),
        "--user".into(),
        "--output=cat".into(),
    ];
    for tag in tags {
        command.push("-t".into());
        command.push(tag);
    }
    if recent_only {
        command.extend(["-n".into(), "50".into(), "--no-pager".into()]);
    }
    command.extend(journal_args);
    print_command(&command);
    let code = run_inherit(&command);
    Err(CliError {
        message: String::new(),
        exit_code: code,
    })
}

async fn command_status(name_arg: Option<&str>, pm: &ProcessManager) -> Result<(), CliError> {
    let config = current_config(true).await?;
    let runtime = read_runtime_state().await.ok().flatten();
    if name_arg.is_none() {
        println!("{} {}  STATUS", pad("INSTANCE", 16), pad("URL", 38));
        for name in config.instances.keys() {
            let port = get_port_for_display(&config, name, pm).await;
            let status = runtime_status(&config, name, runtime.as_ref(), pm).await;
            let url = if port == "-" || port.is_empty() {
                "-".into()
            } else {
                local_url(name)
            };
            let port_display = if port.is_empty() { "-" } else { &url };
            println!(
                "{} {}  {status}",
                pad(name, 16),
                pad(port_display, 38)
            );
        }
        return Ok(());
    }
    let name = resolved_instance_name(&config, name_arg).await?;
    let instance = config.get_instance(&name)?;
    let snapshot = runtime.as_ref().and_then(|r| r.instances.get(&name));
    print_port_suffix(&config, &name, pm).await;
    println!("  dir: {}", if instance.dir.is_empty() { "-" } else { &instance.dir });
    println!("  cmd: {}", if instance.cmd.is_empty() { "-" } else { &instance.cmd });
    println!("  enabled: {}", config.is_enabled(&name));
    let status = runtime_status(&config, &name, runtime.as_ref(), pm).await;
    println!("  runtime: {status}");
    if let Some(snapshot) = snapshot {
        println!(
            "  pid: {}",
            if snapshot.pid == 0 {
                "-".into()
            } else {
                snapshot.pid.to_string()
            }
        );
        println!("  restart attempts: {}", snapshot.restart_attempts);
        if let Some(next) = snapshot.next_retry_at {
            let secs = next / 1000;
            let dt = chrono_like(secs);
            println!("  next retry: {dt}");
        }
        if let Some(exit) = &snapshot.last_exit {
            if let Some(signal) = &exit.signal_code {
                println!("  last exit: signal {signal}");
            } else {
                println!(
                    "  last exit: exit {}",
                    exit.exit_code
                        .map(|c| c.to_string())
                        .unwrap_or_else(|| "unknown".into())
                );
            }
        }
        if let Some(err) = &snapshot.last_error {
            println!("  last error: {err}");
        }
    }
    println!("  logs:");
    show_recent_logs(&name);
    println!("  ports:");
    let addresses = pm.listening_addresses(&name, &instance.cmd).await.unwrap_or_default();
    if addresses.is_empty() {
        println!("    (none)");
    } else {
        for address in addresses {
            println!("    {address}");
        }
    }
    Ok(())
}

fn chrono_like(secs: i64) -> String {
    use std::time::{Duration, UNIX_EPOCH};
    let t = UNIX_EPOCH + Duration::from_secs(secs.max(0) as u64);
    format!("{:?}", t)
}

async fn command_start(name_arg: Option<&str>, pm: &ProcessManager) -> Result<(), CliError> {
    let config = current_config(true).await?;
    let name = resolved_instance_name(&config, name_arg).await?;
    write_config(|m| m.set_enabled(&name, true)).await?;
    let cfg2 = current_config(true).await?;
    let instance = cfg2.get_instance(&name)?;
    let port = cfg2.get_port(&name);
    let ready = if !port.is_empty() && is_vite_command(&instance.cmd) {
        Some(vite_ready_pattern())
    } else {
        None
    };
    print_port_suffix(&cfg2, &name, pm).await;
    change_and_wait(
        &name,
        &instance.cmd,
        &instance.dir,
        "[executor] starting ",
        "start",
        ready.as_deref(),
        if port.is_empty() { None } else { Some(port.as_str()) },
    )
    .await
}

async fn command_stop(name_arg: Option<&str>, pm: &ProcessManager) -> Result<(), CliError> {
    let config = current_config(true).await?;
    let name = resolved_instance_name(&config, name_arg).await?;
    write_config(|m| m.set_enabled(&name, false)).await?;
    print_port_suffix(&config, &name, pm).await;
    stop_and_verify(&name).await
}

async fn command_reload(name_arg: Option<&str>, pm: &ProcessManager) -> Result<(), CliError> {
    let config = current_config(true).await?;
    let name = resolved_instance_name(&config, name_arg).await?;
    let token = format!(
        "{}{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis(),
        rand_u32() % 1_000_000
    );
    write_config(|m| m.set_enabled(&name, true)).await?;
    write_restart_token(&name, &token).await?;
    let cfg2 = current_config(true).await?;
    let instance = cfg2.get_instance(&name)?;
    let port = cfg2.get_port(&name);
    let ready = if !port.is_empty() && is_vite_command(&instance.cmd) {
        Some(vite_ready_pattern())
    } else {
        None
    };
    print_port_suffix(&cfg2, &name, pm).await;
    change_and_wait(
        &name,
        &instance.cmd,
        &instance.dir,
        "[executor] starting ",
        "reload",
        ready.as_deref(),
        if port.is_empty() { None } else { Some(port.as_str()) },
    )
    .await
}

fn rand_u32() -> u32 {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    std::time::SystemTime::now().hash(&mut h);
    h.finish() as u32
}

async fn command_service(action: Option<&str>) -> Result<(), CliError> {
    let action = action.unwrap_or("");
    if !matches!(action, "start" | "stop" | "restart" | "reload" | "status") {
        println!("{}", usage());
        return Err(CliError {
            message: String::new(),
            exit_code: 1,
        });
    }
    let code = run_inherit(&[
        "/usr/bin/systemctl".into(),
        "--user".into(),
        action.into(),
        SERVICE_NAME.into(),
    ]);
    Err(CliError {
        message: String::new(),
        exit_code: code,
    })
}
