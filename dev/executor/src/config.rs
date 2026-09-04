use crate::cli::{fail, CliError};
use crate::paths::{
    config_dir, config_file, control_file, expand_home, state_dir, CONTROL_KEY,
};
use crate::runner::{extract_port, now_ms};
use serde_json::{Map, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::os::unix::fs::OpenOptionsExt;
use std::path::{Path, PathBuf};
use std::thread;
use std::time::{Duration, Instant};
use uuid::Uuid;

const LOCK_TIMEOUT_MS: u64 = 2_000;
const LOCK_STALE_MS: u64 = 30_000;
const LOCK_RETRY_MS: u64 = 25;

#[derive(Clone, Debug)]
pub struct NormalizedInstance {
    pub name: String,
    pub dir: String,
    pub cmd: String,
    pub enabled: bool,
    pub env: BTreeMap<String, String>,
}

#[derive(Clone, Debug)]
pub struct NormalizedConfig {
    pub instances: BTreeMap<String, NormalizedInstance>,
    pub disabled: BTreeSet<String>,
    pub restart_tokens: BTreeMap<String, String>,
}

impl NormalizedConfig {
    pub fn get_instance(&self, name: &str) -> Result<&NormalizedInstance, CliError> {
        self.instances
            .get(name)
            .ok_or_else(|| fail(format!("Unknown executor item: {name}")))
    }

    pub fn has_instance(&self, name: &str) -> bool {
        self.instances.contains_key(name)
    }

    pub fn is_enabled(&self, name: &str) -> bool {
        !self.disabled.contains(name)
    }

    pub fn get_port(&self, name: &str) -> String {
        self.instances
            .get(name)
            .map(|i| extract_port(&i.cmd))
            .unwrap_or_default()
    }

    pub fn instance_matching_cwd(&self) -> Option<String> {
        let pwd = safe_realpath(&std::env::current_dir().ok()?.display().to_string());
        let cwd_base = Path::new(&pwd)
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_string();
        if self.instances.contains_key(&cwd_base) {
            return Some(cwd_base);
        }
        for (name, instance) in &self.instances {
            if safe_realpath(&instance.dir) == pwd {
                return Some(name.clone());
            }
        }
        for (name, instance) in &self.instances {
            let base = Path::new(&instance.dir)
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("");
            if base == cwd_base {
                return Some(name.clone());
            }
        }
        None
    }
}

pub struct ConfigMutator {
    raw: Value,
}

impl ConfigMutator {
    pub fn set_enabled(&mut self, name: &str, enabled: bool) -> Result<(), CliError> {
        let instance = get_raw_instance(&mut self.raw, name)?;
        instance["enabled"] = Value::Bool(enabled);
        if !enabled {
            return Ok(());
        }
        if let Some(control) = self.raw.get_mut(CONTROL_KEY) {
            if let Some(disabled) = control.get_mut("disabled").and_then(Value::as_array_mut) {
                disabled.retain(|item| item.as_str() != Some(name));
            }
        }
        Ok(())
    }

    pub fn set_restart_token(&mut self, name: &str, token: &str) -> Result<(), CliError> {
        get_raw_instance(&mut self.raw, name)?;
        let control = self
            .raw
            .as_object_mut()
            .unwrap()
            .entry(CONTROL_KEY)
            .or_insert_with(|| Value::Object(Map::new()));
        let restart = control
            .as_object_mut()
            .unwrap()
            .entry("restart")
            .or_insert_with(|| Value::Object(Map::new()));
        restart[name] = Value::String(token.into());
        if let Some(obj) = control.as_object_mut() {
            obj.remove("disabled");
        }
        Ok(())
    }
}

fn get_raw_instance<'a>(raw: &'a mut Value, name: &str) -> Result<&'a mut Value, CliError> {
    if name == CONTROL_KEY {
        return Err(fail(format!("Reserved name: {CONTROL_KEY}")));
    }
    let value = raw
        .get_mut(name)
        .ok_or_else(|| fail(format!("Unknown executor item: {name}")))?;
    if !value.is_object() {
        return Err(fail(format!("Unknown executor item: {name}")));
    }
    Ok(value)
}

fn is_process_alive(pid: i32) -> bool {
    match nix::sys::signal::kill(nix::unistd::Pid::from_raw(pid), None) {
        Ok(()) => true,
        Err(nix::errno::Errno::EPERM) => true,
        Err(_) => false,
    }
}

struct LockRecord {
    pid: i32,
    token: Option<String>,
}

fn lock_file_for(path: &Path) -> PathBuf {
    PathBuf::from(format!("{}.lock", path.display()))
}

fn read_lock_record(path: &Path) -> Option<LockRecord> {
    let text = fs::read_to_string(path).ok()?;
    let value: Value = serde_json::from_str(&text).ok()?;
    let pid = value.get("pid")?.as_i64()? as i32;
    if pid <= 0 {
        return None;
    }
    let token = value
        .get("token")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(str::to_string);
    Some(LockRecord { pid, token })
}

fn lock_age_ms(path: &Path) -> u64 {
    fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.elapsed().ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn stale_lock(path: &Path) -> bool {
    if let Some(record) = read_lock_record(path) {
        return !is_process_alive(record.pid);
    }
    lock_age_ms(path) > LOCK_STALE_MS
}

fn release_lock(lock_path: &Path, token: &str) {
    if let Some(record) = read_lock_record(lock_path) {
        if record.pid == std::process::id() as i32 && record.token.as_deref() == Some(token) {
            let _ = fs::remove_file(lock_path);
        }
    }
}

fn acquire_lock(path: &Path) -> Result<impl FnOnce(), CliError> {
    let lock_path = lock_file_for(path);
    let deadline = Instant::now() + Duration::from_millis(LOCK_TIMEOUT_MS);
    while Instant::now() < deadline {
        let token = Uuid::now_v7().to_string();
        let tmp_path = PathBuf::from(format!(
            "{}.{}.{}.tmp",
            lock_path.display(),
            std::process::id(),
            token
        ));
        let write_result = (|| -> std::io::Result<()> {
            let mut file = OpenOptions::new()
                .write(true)
                .create_new(true)
                .mode(0o600)
                .open(&tmp_path)?;
            let body = serde_json::json!({
                "pid": std::process::id(),
                "createdAt": now_ms(),
                "token": token,
            });
            file.write_all(body.to_string().as_bytes())?;
            file.sync_all()?;
            Ok(())
        })();
        if write_result.is_err() {
            let _ = fs::remove_file(&tmp_path);
            thread::sleep(Duration::from_millis(LOCK_RETRY_MS));
            continue;
        }
        match fs::hard_link(&tmp_path, &lock_path) {
            Ok(()) => {
                let _ = fs::remove_file(&tmp_path);
                let lock_path_owned = lock_path.clone();
                let token_owned = token.clone();
                return Ok(move || release_lock(&lock_path_owned, &token_owned));
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                let _ = fs::remove_file(&tmp_path);
                if stale_lock(&lock_path) {
                    let _ = fs::remove_file(&lock_path);
                    continue;
                }
                thread::sleep(Duration::from_millis(LOCK_RETRY_MS));
            }
            Err(error) => {
                let _ = fs::remove_file(&tmp_path);
                return Err(fail(error.to_string()));
            }
        }
    }
    Err(fail(format!(
        "Timed out waiting for config lock: {}",
        path.display()
    )))
}

async fn with_file_lock<T, F: FnOnce() -> Result<T, CliError>>(
    path: &Path,
    operation: F,
) -> Result<T, CliError> {
    let release = acquire_lock(path)?;
    let result = operation();
    release();
    result
}

fn atomic_write(path: &Path, content: &str) -> Result<(), CliError> {
    let tmp = PathBuf::from(format!(
        "{}.{}.{}.tmp",
        path.display(),
        std::process::id(),
        now_ms()
    ));
    let write = (|| -> std::io::Result<()> {
        let mut file = File::create(&tmp)?;
        file.write_all(content.as_bytes())?;
        file.sync_all()?;
        Ok(())
    })();
    if let Err(error) = write {
        let _ = fs::remove_file(&tmp);
        return Err(fail(error.to_string()));
    }
    fs::rename(&tmp, path).map_err(|e| fail(e.to_string()))?;
    let _ = fs::remove_file(&tmp);
    Ok(())
}

fn parse_json_object(text: &str, path: &Path) -> Result<Value, CliError> {
    let parsed: Value =
        serde_json::from_str(text).map_err(|_| fail(format!("Invalid config file: {}", path.display())))?;
    if !parsed.is_object() {
        return Err(fail(format!(
            "Top-level config must be an object ({})",
            path.display()
        )));
    }
    Ok(parsed)
}

pub async fn ensure_config_file() -> Result<(), CliError> {
    fs::create_dir_all(config_dir()).map_err(|e| fail(e.to_string()))?;
    if config_file().exists() {
        return Ok(());
    }
    with_file_lock(&config_file(), || {
        if !config_file().exists() {
            atomic_write(&config_file(), "{}\n")?;
        }
        Ok(())
    })
    .await
}

async fn read_raw_config(required: bool) -> Result<Option<Value>, CliError> {
    ensure_config_file().await?;
    if !config_file().exists() {
        if required {
            return Err(fail(format!(
                "Missing config file: {}",
                config_file().display()
            )));
        }
        return Ok(None);
    }
    let text = fs::read_to_string(config_file()).map_err(|e| fail(e.to_string()))?;
    Ok(Some(parse_json_object(&text, &config_file())?))
}

async fn read_runtime_control() -> Result<Value, CliError> {
    fs::create_dir_all(state_dir()).map_err(|e| fail(e.to_string()))?;
    if !control_file().exists() {
        return Ok(Value::Object(Map::new()));
    }
    let text = fs::read_to_string(control_file()).map_err(|e| fail(e.to_string()))?;
    parse_json_object(&text, &control_file())
}

pub async fn read_config(required: bool) -> Result<Option<NormalizedConfig>, CliError> {
    let Some(raw) = read_raw_config(required).await? else {
        return Ok(None);
    };
    Ok(Some(normalize_config(raw, read_runtime_control().await?)?))
}

fn control_object(raw: &Value) -> Result<Value, CliError> {
    match raw.get(CONTROL_KEY) {
        None => Ok(Value::Object(Map::new())),
        Some(Value::Object(_)) => Ok(raw[CONTROL_KEY].clone()),
        Some(_) => Err(fail(format!("{CONTROL_KEY} must be an object"))),
    }
}

fn normalize_instance(name: &str, value: &Value) -> Result<NormalizedInstance, CliError> {
    let dir = value
        .get("dir")
        .or_else(|| value.get("DIR"))
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| fail(format!("Missing string dir for {name}")))?;
    let cmd = value
        .get("cmd")
        .or_else(|| value.get("CMD"))
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| fail(format!("Missing string cmd for {name}")))?;
    let enabled = match value.get("enabled") {
        None => true,
        Some(Value::Bool(flag)) => *flag,
        Some(_) => {
            return Err(fail(format!(
                "enabled must be a boolean when present ({name})"
            )))
        }
    };
    let mut env = BTreeMap::new();
    if let Some(obj) = value.as_object() {
        for (key, raw_value) in obj {
            if matches!(key.as_str(), "dir" | "DIR" | "cmd" | "CMD" | "enabled") {
                continue;
            }
            env.insert(
                key.clone(),
                match raw_value {
                    Value::String(s) => s.clone(),
                    other => other.to_string().trim_matches('"').to_string(),
                },
            );
        }
    }
    Ok(NormalizedInstance {
        name: name.into(),
        dir: expand_home(dir),
        cmd: cmd.into(),
        enabled,
        env,
    })
}

fn normalize_config(raw: Value, runtime_control: Value) -> Result<NormalizedConfig, CliError> {
    let control = control_object(&raw)?;
    if control.get("restart").is_some() && !control["restart"].is_object() {
        return Err(fail(format!("{CONTROL_KEY}.restart must be an object")));
    }
    if runtime_control.get("restart").is_some() && !runtime_control["restart"].is_object() {
        return Err(fail(format!(
            "{}.restart must be an object",
            control_file().display()
        )));
    }
    let disabled_value = control.get("disabled").cloned().unwrap_or(Value::Array(vec![]));
    if !disabled_value.is_array()
        || !disabled_value
            .as_array()
            .unwrap()
            .iter()
            .all(|item| item.is_string())
    {
        return Err(fail(format!(
            "{CONTROL_KEY}.disabled must contain only strings"
        )));
    }
    let mut instances = BTreeMap::new();
    let mut disabled = BTreeSet::new();
    for item in disabled_value.as_array().unwrap() {
        if let Some(name) = item.as_str() {
            disabled.insert(name.to_string());
        }
    }
    let obj = raw.as_object().ok_or_else(|| fail("Invalid config file"))?;
    for (name, value) in obj {
        if name == CONTROL_KEY {
            continue;
        }
        if !value.is_object() {
            return Err(fail(format!("Invalid config entry for {name}")));
        }
        let instance = normalize_instance(name, value)?;
        if !instance.enabled {
            disabled.insert(name.clone());
        }
        instances.insert(name.clone(), instance);
    }
    let mut restart_tokens = BTreeMap::new();
    if let Some(restart) = control.get("restart").and_then(Value::as_object) {
        for (name, value) in restart {
            restart_tokens.insert(name.clone(), json_to_string(value));
        }
    }
    if let Some(restart) = runtime_control.get("restart").and_then(Value::as_object) {
        for (name, value) in restart {
            restart_tokens.insert(name.clone(), json_to_string(value));
        }
    }
    Ok(NormalizedConfig {
        instances,
        disabled,
        restart_tokens,
    })
}

fn json_to_string(value: &Value) -> String {
    match value {
        Value::String(s) => s.clone(),
        other => other.to_string(),
    }
}

fn safe_realpath(value: &str) -> String {
    fs::canonicalize(value)
        .map(|p| p.display().to_string())
        .unwrap_or_else(|_| value.to_string())
}

pub async fn write_restart_token(name: &str, token: &str) -> Result<(), CliError> {
    fs::create_dir_all(state_dir()).map_err(|e| fail(e.to_string()))?;
    with_file_lock(&control_file(), || {
        let mut raw = if control_file().exists() {
            let text = fs::read_to_string(control_file()).map_err(|e| fail(e.to_string()))?;
            parse_json_object(&text, &control_file())?
        } else {
            Value::Object(Map::new())
        };
        let restart = raw
            .as_object_mut()
            .unwrap()
            .entry("restart")
            .or_insert_with(|| Value::Object(Map::new()));
        restart[name] = Value::String(token.into());
        atomic_write(
            &control_file(),
            &format!("{}\n", serde_json::to_string_pretty(&raw).unwrap()),
        )
    })
    .await
}

pub async fn write_config<F>(mutator: F) -> Result<(), CliError>
where
    F: FnOnce(&mut ConfigMutator) -> Result<(), CliError>,
{
    ensure_config_file().await?;
    with_file_lock(&config_file(), || {
        let text = fs::read_to_string(config_file()).map_err(|e| fail(e.to_string()))?;
        let raw = parse_json_object(&text, &config_file())?;
        let mut m = ConfigMutator { raw };
        mutator(&mut m)?;
        atomic_write(
            &config_file(),
            &format!("{}\n", serde_json::to_string_pretty(&m.raw).unwrap()),
        )
    })
    .await
}

pub fn source_fingerprint() -> Result<String, CliError> {
    let config_text = fs::read_to_string(config_file()).unwrap_or_default();
    let control_text = if control_file().exists() {
        fs::read_to_string(control_file()).unwrap_or_default()
    } else {
        String::new()
    };
    Ok(crate::runner::fingerprint(&format!(
        "{config_text}\0{control_text}"
    )))
}
