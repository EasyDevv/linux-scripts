use crate::cli::CliError;
use crate::config::{ensure_config_file, read_config, source_fingerprint, NormalizedConfig, NormalizedInstance};
use crate::paths::{config_dir, config_name, runtime_state_file, SAFETY_POLL_INTERVAL_MS, CONFIG_WATCH_DEBOUNCE_MS};
use crate::pm::{ManagedProcess, ProcessManager, ProcessManagerOptions};
use crate::proxy::{LocalProxy, LocalProxyOptions};
use crate::runner::now_ms;
use crate::state::{write_runtime_state, RuntimeStateFile, SupervisorInfo};
use notify::{Config, RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::signal::unix::{signal, SignalKind};

struct ManagedEntry {
    spec_key: String,
    process: Arc<ManagedProcess>,
}

enum ReconcileAction {
    Start {
        name: String,
        instance: NormalizedInstance,
        spec_key: String,
    },
    Replace {
        name: String,
        instance: NormalizedInstance,
        spec_key: String,
    },
    Stop {
        name: String,
    },
}

fn spec_key(config: &NormalizedConfig, instance: &NormalizedInstance) -> String {
    format!(
        "{}|{}|{:?}|{}",
        instance.dir,
        instance.cmd,
        instance.env,
        config.restart_tokens.get(&instance.name).cloned().unwrap_or_default()
    )
}

fn build_reconcile_plan(
    managed: &HashMap<String, ManagedEntry>,
    config: &NormalizedConfig,
) -> Vec<ReconcileAction> {
    let mut plan = Vec::new();
    let mut desired = std::collections::HashSet::new();
    for (name, instance) in &config.instances {
        desired.insert(name.clone());
        let current = managed.get(name);
        if !config.is_enabled(name) {
            if current.is_some() {
                plan.push(ReconcileAction::Stop { name: name.clone() });
            }
            continue;
        }
        let next = spec_key(config, instance);
        match current {
            None => plan.push(ReconcileAction::Start {
                name: name.clone(),
                instance: instance.clone(),
                spec_key: next,
            }),
            Some(entry) if entry.spec_key != next => plan.push(ReconcileAction::Replace {
                name: name.clone(),
                instance: instance.clone(),
                spec_key: next,
            }),
            Some(_) => {}
        }
    }
    for name in managed.keys() {
        if !desired.contains(name) {
            plan.push(ReconcileAction::Stop { name: name.clone() });
        }
    }
    plan
}

pub async fn run_supervisor(proxy_port: u16) -> Result<(), CliError> {
    ensure_config_file().await?;
    let env: std::collections::BTreeMap<_, _> = std::env::vars().collect();
    let started_at = now_ms();
    let managed: Arc<Mutex<HashMap<String, ManagedEntry>>> = Arc::new(Mutex::new(HashMap::new()));
    let dirty = Arc::new(Mutex::new(true));
    let stopping = Arc::new(Mutex::new(false));
    let proxy = LocalProxy::bind(
        proxy_port,
        5_000,
        Some({
            let managed = managed.clone();
            Arc::new(move |name: String| {
                if let Some(entry) = managed.lock().unwrap().get(&name) {
                    let process = entry.process.clone();
                    tokio::spawn(async move {
                        let _ = process.restart().await;
                    });
                }
            })
        }),
        120_000,
        LocalProxyOptions::default(),
    )
    .await
    .map_err(|e| CliError::new(e.to_string()))?;

    let save = {
        let managed = managed.clone();
        let proxy_port_unused = proxy.port();
        let _ = proxy_port_unused;
        move |proxy: &LocalProxy| {
            let instances = managed
                .lock()
                .unwrap()
                .iter()
                .map(|(name, entry)| (name.clone(), entry.process.snapshot()))
                .collect();
            let state = RuntimeStateFile {
                version: 1,
                supervisor: SupervisorInfo {
                    pid: std::process::id(),
                    version: env!("CARGO_PKG_VERSION").into(),
                    started_at,
                },
                instances,
                proxy: proxy.snapshot(),
            };
            let _ = write_runtime_state(&state);
        }
    };

    let pm = ProcessManager::new(
        env,
        ProcessManagerOptions {
            on_state_change: Some(Arc::new({
                // runtime writes happen from reconcile loop
                || {}
            })),
            ..ProcessManagerOptions::default()
        },
    );

    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<()>();
    let tx2 = tx.clone();
    let mut watcher = RecommendedWatcher::new(
        move |_| {
            let _ = tx.send(());
        },
        Config::default(),
    )
    .ok();
    if let Some(watcher) = watcher.as_mut() {
        let _ = watcher.watch(&config_dir(), RecursiveMode::NonRecursive);
    }

    let mut sighup = signal(SignalKind::hangup()).map_err(|e| CliError::new(e.to_string()))?;
    let mut sigterm = signal(SignalKind::terminate()).map_err(|e| CliError::new(e.to_string()))?;
    let mut sigint = signal(SignalKind::interrupt()).map_err(|e| CliError::new(e.to_string()))?;
    let mut last_fp = String::new();
    let mut last_config: Option<NormalizedConfig> = None;

    loop {
        if *stopping.lock().unwrap() {
            break;
        }
        let is_dirty = *dirty.lock().unwrap();
        if is_dirty {
            *dirty.lock().unwrap() = false;
            match source_fingerprint() {
                Ok(fp) if fp == last_fp => {}
                Ok(fp) => {
                    last_fp = fp;
                    match read_config(false).await {
                        Ok(Some(config)) => {
                            last_config = Some(config.clone());
                            proxy.update(&config);
                            let plan = {
                                let guard = managed.lock().unwrap();
                                build_reconcile_plan(&guard, &config)
                            };
                            for action in plan {
                                match action {
                                    ReconcileAction::Start {
                                        name,
                                        instance,
                                        spec_key,
                                    } => {
                                        let process = pm.start(&instance);
                                        managed.lock().unwrap().insert(
                                            name,
                                            ManagedEntry { spec_key, process },
                                        );
                                    }
                                    ReconcileAction::Replace {
                                        name,
                                        instance,
                                        spec_key,
                                    } => {
                                        if let Some(current) = managed.lock().unwrap().remove(&name)
                                        {
                                            let _ = current.process.stop().await;
                                        }
                                        let process = pm.start(&instance);
                                        managed.lock().unwrap().insert(
                                            name,
                                            ManagedEntry { spec_key, process },
                                        );
                                    }
                                    ReconcileAction::Stop { name } => {
                                        if let Some(current) = managed.lock().unwrap().remove(&name)
                                        {
                                            let _ = current.process.stop().await;
                                        }
                                    }
                                }
                            }
                        }
                        Ok(None) => {}
                        Err(error) => eprintln!("{}", error.message),
                    }
                }
                Err(error) => eprintln!("{}", error.message),
            }
            save(&proxy);
        }

        tokio::select! {
            _ = sighup.recv() => { *dirty.lock().unwrap() = true; }
            _ = sigterm.recv() => { *stopping.lock().unwrap() = true; }
            _ = sigint.recv() => { *stopping.lock().unwrap() = true; }
            _ = rx.recv() => {
                tokio::time::sleep(Duration::from_millis(CONFIG_WATCH_DEBOUNCE_MS)).await;
                *dirty.lock().unwrap() = true;
            }
            _ = tokio::time::sleep(Duration::from_millis(SAFETY_POLL_INTERVAL_MS)) => {
                *dirty.lock().unwrap() = true;
            }
        }
        let _ = tx2;
        let _ = runtime_state_file();
        let _ = config_name();
        let _ = last_config.as_ref();
    }

    let _ = proxy.stop(None).await;
    let names: Vec<_> = managed.lock().unwrap().keys().cloned().collect();
    for name in names {
        if let Some(entry) = managed.lock().unwrap().remove(&name) {
            let _ = entry.process.stop().await;
        }
    }
    save(&proxy);
    Ok(())
}
