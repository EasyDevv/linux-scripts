use std::path::{Path, PathBuf};

pub const CONTROL_KEY: &str = "$control";
pub const SERVICE_NAME: &str = "executor.service";
pub const SAFETY_POLL_INTERVAL_MS: u64 = 30_000;
pub const CONFIG_WATCH_DEBOUNCE_MS: u64 = 75;

pub fn home() -> PathBuf {
    PathBuf::from(std::env::var("HOME").unwrap_or_default())
}

pub fn xdg_config_home() -> PathBuf {
    std::env::var("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| home().join(".config"))
}

pub fn xdg_runtime_dir() -> PathBuf {
    std::env::var("XDG_RUNTIME_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("/tmp"))
}

pub fn config_file() -> PathBuf {
    xdg_config_home().join("systemd/user/executor.json")
}

pub fn config_dir() -> PathBuf {
    config_file()
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .to_path_buf()
}

pub fn config_name() -> &'static str {
    "executor.json"
}

pub fn state_dir() -> PathBuf {
    xdg_runtime_dir().join("executor")
}

pub fn control_file() -> PathBuf {
    state_dir().join("control.json")
}

pub fn runtime_state_file() -> PathBuf {
    state_dir().join("runtime.json")
}

pub fn expand_home(value: &str) -> String {
    if value == "~" {
        return home().display().to_string();
    }
    if let Some(rest) = value.strip_prefix("~/") {
        return home().join(rest).display().to_string();
    }
    value.to_string()
}
